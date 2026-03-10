from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from cortex_server.modules.latency_budget_governor import classify_task_archetype


DEFAULT_ARTIFACT_DIR = Path("/opt/clawdbot/artifacts/nexus_orchestration")

BASELINE_POLICY_BY_ARCHETYPE = {
    "simple_qa": "fastlane_memory",
    "citation_required": "fastlane_memory",
    "tool_use": "fastlane_memory",
    "ops_triage": "deliberate_council",
    "planning": "deliberate_council",
    "coding": "deliberate_council",
    "risk_sensitive": "deliberate_council",
    "complex_general": "deliberate_council",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class OutcomeTuner:
    def __init__(self, artifact_dir: Optional[Path] = None):
        self.artifact_dir = artifact_dir or DEFAULT_ARTIFACT_DIR
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = self.artifact_dir / "outcomes.jsonl"
        self.state_path = self.artifact_dir / "latest.json"
        self.report_path = self.artifact_dir / "latest.md"
        self.state = self._load_state()

    def _load_state(self) -> Dict[str, Any]:
        if self.state_path.exists():
            try:
                data = json.loads(self.state_path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
        return {"version": "nexus.outcome_tuner.v1", "count": 0, "archetypes": {}, "last": None}

    @staticmethod
    def _safe(value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, dict):
            return {str(k): OutcomeTuner._safe(v) for k, v in list(value.items())[:64]}
        if isinstance(value, (list, tuple)):
            return [OutcomeTuner._safe(v) for v in list(value)[:64]]
        return repr(value)

    @staticmethod
    def detect_user_correction(query: str) -> bool:
        q = (query or "").strip().lower()
        return any(q.startswith(prefix) for prefix in ["actually", "correction", "retry", "fix this", "recover", "again"]) or "recovery" in q

    @staticmethod
    def query_hash(query: str) -> str:
        return hashlib.sha256((query or "").encode("utf-8")).hexdigest()[:16]

    def _policy_row(self, archetype: str, policy: str) -> Dict[str, Any]:
        arch = self.state.setdefault("archetypes", {}).setdefault(
            archetype,
            {
                "baseline_policy": BASELINE_POLICY_BY_ARCHETYPE.get(archetype, "fastlane_memory"),
                "decisions": {"stage": "shadow", "recommended_policy": None, "rollout_percent": 0, "reason": "collecting_evidence"},
                "policies": {},
            },
        )
        return arch.setdefault("policies", {}).setdefault(
            policy,
            {"count": 0, "success_rate": 0.0, "validator_rate": 0.0, "correction_rate": 0.0, "avg_latency_ms": 0.0, "avg_reward": 0.0},
        )

    def _update_ema(self, row: Dict[str, Any], *, success: float, validator: float, correction: float, latency_ms: float, reward: float) -> None:
        row["count"] = int(row.get("count", 0)) + 1
        n = row["count"]
        for key, value in {
            "success_rate": success,
            "validator_rate": validator,
            "correction_rate": correction,
            "avg_latency_ms": latency_ms,
            "avg_reward": reward,
        }.items():
            row[key] = round(((float(row.get(key, 0.0)) * (n - 1)) + float(value)) / n, 4)

    def _compute_reward(self, record: Dict[str, Any]) -> float:
        success = 1.0 if record.get("execution_success") else 0.0
        validator = 1.0 if record.get("validator_result", {}).get("pass") else 0.0
        correction_penalty = 0.2 if record.get("user_correction") else 0.0
        recovery_penalty = 0.15 if record.get("recovery_needed") else 0.0
        latency_ms = float(record.get("latency_ms") or 0.0)
        latency_bonus = 0.15 if latency_ms <= 1200 else 0.08 if latency_ms <= 2200 else 0.0
        return round(max(0.0, min(1.0, (0.45 * success) + (0.30 * validator) + latency_bonus - correction_penalty - recovery_penalty)), 4)

    def _recompute_decision(self, archetype: str) -> Dict[str, Any]:
        arch = self.state.setdefault("archetypes", {}).setdefault(archetype, {"baseline_policy": BASELINE_POLICY_BY_ARCHETYPE.get(archetype, "fastlane_memory"), "decisions": {}, "policies": {}})
        baseline_policy = arch.get("baseline_policy") or BASELINE_POLICY_BY_ARCHETYPE.get(archetype, "fastlane_memory")
        policies = arch.get("policies") or {}
        baseline = policies.get(baseline_policy, {"count": 0, "avg_reward": 0.0, "success_rate": 0.0, "validator_rate": 0.0, "correction_rate": 0.0, "avg_latency_ms": 999999})
        best_policy = baseline_policy
        best_row = baseline
        for policy, row in policies.items():
            if policy == baseline_policy:
                continue
            if float(row.get("avg_reward", 0.0)) > float(best_row.get("avg_reward", 0.0)):
                best_policy = policy
                best_row = row

        decision = {"stage": "shadow", "recommended_policy": None, "rollout_percent": 0, "reason": "collecting_evidence"}
        if best_policy != baseline_policy:
            delta_reward = float(best_row.get("avg_reward", 0.0)) - float(baseline.get("avg_reward", 0.0))
            enough_shadow = int(best_row.get("count", 0)) >= 5 and int(baseline.get("count", 0)) >= 3
            safe = float(best_row.get("validator_rate", 0.0)) >= max(0.9, float(baseline.get("validator_rate", 0.0)) - 0.02)
            low_correction = float(best_row.get("correction_rate", 0.0)) <= float(baseline.get("correction_rate", 0.0)) + 0.02
            if enough_shadow and delta_reward >= 0.05 and safe and low_correction:
                decision = {"stage": "recommend", "recommended_policy": best_policy, "rollout_percent": 0, "reason": f"shadow win +{delta_reward:.3f}"}
            if int(best_row.get("count", 0)) >= 8 and delta_reward >= 0.08 and safe and low_correction:
                decision = {"stage": "bounded_rollout", "recommended_policy": best_policy, "rollout_percent": 10, "reason": f"bounded rollout win +{delta_reward:.3f}"}
        arch["decisions"] = decision
        return decision

    def get_policy_hint(self, *, archetype: str, query: str) -> Dict[str, Any]:
        arch = self.state.setdefault("archetypes", {}).setdefault(
            archetype,
            {"baseline_policy": BASELINE_POLICY_BY_ARCHETYPE.get(archetype, "fastlane_memory"), "decisions": {"stage": "shadow", "recommended_policy": None, "rollout_percent": 0, "reason": "collecting_evidence"}, "policies": {}},
        )
        decision = arch.get("decisions") or {"stage": "shadow", "recommended_policy": None, "rollout_percent": 0, "reason": "collecting_evidence"}
        stage = str(decision.get("stage") or "shadow")
        rollout_percent = int(decision.get("rollout_percent") or 0)
        bucket = int(hashlib.sha256(f"{archetype}|{query}".encode("utf-8")).hexdigest(), 16) % 100
        apply = stage == "bounded_rollout" and bucket < max(0, min(100, rollout_percent))
        return {
            "archetype": archetype,
            "baseline_policy": arch.get("baseline_policy"),
            "stage": stage,
            "recommended_policy": decision.get("recommended_policy"),
            "rollout_percent": rollout_percent,
            "apply_recommendation": apply,
            "reason": decision.get("reason"),
        }

    def observe(self, record: Dict[str, Any]) -> Dict[str, Any]:
        record = dict(record)
        record.setdefault("ts", _now_iso())
        record.setdefault("query_hash", self.query_hash(str(record.get("query") or "")))
        record.setdefault("user_correction", self.detect_user_correction(str(record.get("query") or "")))
        record.setdefault("task_archetype", classify_task_archetype(str(record.get("query") or "")))
        reward = self._compute_reward(record)
        record["reward"] = reward

        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(self._safe(record), ensure_ascii=False) + "\n")

        archetype = str(record.get("task_archetype") or "simple_qa")
        policy = str(record.get("policy_label") or record.get("routing_method") or "unknown")
        row = self._policy_row(archetype, policy)
        self._update_ema(
            row,
            success=1.0 if record.get("execution_success") else 0.0,
            validator=1.0 if record.get("validator_result", {}).get("pass") else 0.0,
            correction=1.0 if record.get("user_correction") else 0.0,
            latency_ms=float(record.get("latency_ms") or 0.0),
            reward=reward,
        )
        decision = self._recompute_decision(archetype)
        self.state["count"] = int(self.state.get("count", 0)) + 1
        self.state["last"] = record
        self.state_path.write_text(json.dumps(self.state, ensure_ascii=False, indent=2), encoding="utf-8")
        self._render_report()
        return {"decision": decision, "state_path": str(self.state_path), "report_path": str(self.report_path)}

    def _render_report(self) -> None:
        lines = [
            "# Nexus Outcome Tuner",
            "",
            f"- Updated: {_now_iso()}",
            f"- Events observed: {int(self.state.get('count', 0))}",
            "",
        ]
        for archetype, data in sorted((self.state.get("archetypes") or {}).items()):
            decision = data.get("decisions") or {}
            lines.append(f"## {archetype}")
            lines.append(f"- Baseline policy: `{data.get('baseline_policy')}`")
            lines.append(f"- Stage: **{decision.get('stage', 'shadow')}**")
            lines.append(f"- Recommended policy: `{decision.get('recommended_policy')}`")
            lines.append(f"- Rollout percent: {int(decision.get('rollout_percent', 0))}%")
            lines.append(f"- Reason: {decision.get('reason', 'n/a')}")
            lines.append("")
            lines.append("| Policy | Count | Success | Validator | Correction | Avg latency ms | Avg reward |")
            lines.append("|---|---:|---:|---:|---:|---:|---:|")
            for policy, row in sorted((data.get("policies") or {}).items()):
                lines.append(
                    f"| {policy} | {int(row.get('count', 0))} | {float(row.get('success_rate', 0.0)):.2f} | {float(row.get('validator_rate', 0.0)):.2f} | {float(row.get('correction_rate', 0.0)):.2f} | {float(row.get('avg_latency_ms', 0.0)):.1f} | {float(row.get('avg_reward', 0.0)):.2f} |"
                )
            lines.append("")
        self.report_path.write_text("\n".join(lines), encoding="utf-8")
