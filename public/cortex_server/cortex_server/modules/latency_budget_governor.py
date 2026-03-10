from __future__ import annotations

import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


DEFAULT_ARTIFACT_DIR = Path("/opt/clawdbot/artifacts/nexus_latency")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def classify_task_archetype(query: str, risk_flags: Optional[List[str]] = None, complexity_gate: Optional[Dict[str, Any]] = None) -> str:
    q = (query or "").lower()
    if any(x in q for x in ["cite", "citation", "source:", "sources", "with sources"]):
        return "citation_required"
    if any(x in q for x in ["incident", "latency spike", "rollback", "outage", "triage", "on-call", "502", "burn rate"]):
        return "ops_triage"
    if any(x in q for x in ["implement", "refactor", "bug fix", "unit test", "python", "api", "code"]):
        return "coding"
    if any(x in q for x in ["tool", "inspect", "service", "api", "query logs", "orchestration"]):
        return "tool_use"
    if any(x in q for x in ["plan", "strategy", "roadmap", "constraints", "tradeoff", "architecture"]):
        return "planning"
    if risk_flags:
        return "risk_sensitive"
    if complexity_gate and complexity_gate.get("hard"):
        return "complex_general"
    return "simple_qa"


class LatencyBudgetGovernor:
    def __init__(self, artifact_dir: Optional[Path] = None):
        self.artifact_dir = artifact_dir or DEFAULT_ARTIFACT_DIR
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = self.artifact_dir / "decisions.jsonl"
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
        return {"version": "latency.governor.v1", "count": 0, "profiles": {}, "last": None}

    def plan(
        self,
        query: str,
        risk_flags: Optional[List[str]] = None,
        complexity_gate: Optional[Dict[str, Any]] = None,
        fastlane_cfg: Optional[Dict[str, Any]] = None,
        optimizer_cfg: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        archetype = classify_task_archetype(query, risk_flags=risk_flags, complexity_gate=complexity_gate)
        max_latency_ms = int((fastlane_cfg or {}).get("max_latency_ms", 2200))
        max_context_tokens = int((optimizer_cfg or {}).get("max_context_tokens", 1200))
        complexity_score = float((complexity_gate or {}).get("score", 0.0))
        prefetch_enabled = archetype in {"simple_qa", "tool_use", "citation_required", "ops_triage"} and not bool((complexity_gate or {}).get("hard", False))
        if archetype in {"planning", "coding"}:
            max_latency_ms = max(max_latency_ms, 2600)
        if archetype == "citation_required":
            max_context_tokens = min(max_context_tokens, 900)
        return {
            "archetype": archetype,
            "cheap_route": "fastlane" if not bool((complexity_gate or {}).get("hard", False)) else "deliberate",
            "max_latency_ms": max_latency_ms,
            "max_context_tokens": max_context_tokens,
            "prefetch_enabled": prefetch_enabled,
            "prefetch_targets": ["retrieval", "context"] if prefetch_enabled else [],
            "escalate_on": {
                "risk_flags": bool(risk_flags),
                "complexity_hard": bool((complexity_gate or {}).get("hard", False)),
                "low_confidence_below": 0.84 if archetype in {"simple_qa", "citation_required"} else 0.74,
                "budget_pressure_after_ms": int(max_latency_ms * (0.75 if complexity_score < 0.4 else 0.9)),
            },
        }

    def speculative_prefetch(
        self,
        query: str,
        *,
        enabled: bool,
        retrieve_fn: Optional[Callable[[], List[Dict[str, Any]]]] = None,
        context_fn: Optional[Callable[[], Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        if not enabled:
            return {"enabled": False, "results": {}, "timings_ms": {}, "used_parallel": False}

        tasks: Dict[str, Callable[[], Any]] = {}
        if retrieve_fn is not None:
            tasks["retrieval"] = retrieve_fn
        if context_fn is not None:
            tasks["context"] = context_fn
        if not tasks:
            return {"enabled": True, "results": {}, "timings_ms": {}, "used_parallel": False}

        results: Dict[str, Any] = {}
        timings: Dict[str, int] = {}
        start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=min(2, len(tasks))) as pool:
            future_map = {}
            for name, fn in tasks.items():
                task_start = time.perf_counter()
                future_map[pool.submit(fn)] = (name, task_start)
            for future in as_completed(future_map):
                name, task_start = future_map[future]
                try:
                    results[name] = future.result()
                except Exception as exc:  # noqa: BLE001
                    results[name] = {"error": str(exc)}
                timings[name] = int((time.perf_counter() - task_start) * 1000)
        timings["wall"] = int((time.perf_counter() - start) * 1000)
        return {"enabled": True, "results": results, "timings_ms": timings, "used_parallel": len(tasks) > 1}

    def should_escalate(
        self,
        *,
        confidence: float,
        elapsed_ms: int,
        risk_flags: Optional[List[str]],
        complexity_gate: Optional[Dict[str, Any]],
        validator_result: Optional[Dict[str, Any]],
        plan: Dict[str, Any],
        already_escalated: bool,
    ) -> Dict[str, Any]:
        if already_escalated:
            return {"escalate": True, "reason": "already_escalated"}
        if risk_flags:
            return {"escalate": True, "reason": "risk_flags"}
        if bool((complexity_gate or {}).get("hard", False)):
            return {"escalate": True, "reason": "complexity_hard"}
        if float(confidence) < float(((plan.get("escalate_on") or {}).get("low_confidence_below", 0.84))):
            return {"escalate": True, "reason": "low_confidence"}
        if validator_result and int(validator_result.get("missing_constraints_count", 0)) > 0:
            return {"escalate": True, "reason": "missing_constraints"}
        if elapsed_ms >= int(((plan.get("escalate_on") or {}).get("budget_pressure_after_ms", 1800))):
            return {"escalate": True, "reason": "budget_pressure"}
        return {"escalate": False, "reason": "within_budget"}

    def observe(self, event: Dict[str, Any]) -> Dict[str, Any]:
        event = dict(event)
        event.setdefault("ts", _now_iso())
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")

        profile = str(event.get("archetype") or "unknown")
        prof = self.state.setdefault("profiles", {}).setdefault(
            profile,
            {"count": 0, "avg_latency_ms": 0.0, "avg_tokens": 0.0, "escalation_rate": 0.0, "prefetch_hit_rate": 0.0},
        )
        prof["count"] = int(prof.get("count", 0)) + 1
        n = prof["count"]
        latency = float(event.get("latency_ms") or 0.0)
        tokens = float(event.get("token_budget_used") or 0.0)
        escalated = 1.0 if event.get("escalated") else 0.0
        prefetch_hit = 1.0 if event.get("prefetch_used") else 0.0
        for key, value in {
            "avg_latency_ms": latency,
            "avg_tokens": tokens,
            "escalation_rate": escalated,
            "prefetch_hit_rate": prefetch_hit,
        }.items():
            prof[key] = round(((float(prof.get(key, 0.0)) * (n - 1)) + value) / n, 3)
        self.state["count"] = int(self.state.get("count", 0)) + 1
        self.state["last"] = event
        _safe_write(self.state_path, self.state)
        self._render_report()
        return {"state_path": str(self.state_path), "report_path": str(self.report_path), "profiles": self.state.get("profiles", {})}

    def _render_report(self) -> None:
        lines = [
            "# Nexus Latency Governor",
            "",
            f"- Updated: {_now_iso()}",
            f"- Decisions observed: {int(self.state.get('count', 0))}",
            "",
            "| Archetype | Count | Avg latency ms | Avg token budget used | Escalation rate | Prefetch hit rate |",
            "|---|---:|---:|---:|---:|---:|",
        ]
        for archetype, row in sorted((self.state.get("profiles") or {}).items()):
            lines.append(
                f"| {archetype} | {int(row.get('count', 0))} | {float(row.get('avg_latency_ms', 0.0)):.1f} | {float(row.get('avg_tokens', 0.0)):.1f} | {float(row.get('escalation_rate', 0.0)):.2f} | {float(row.get('prefetch_hit_rate', 0.0)):.2f} |"
            )
        self.report_path.write_text("\n".join(lines), encoding="utf-8")
