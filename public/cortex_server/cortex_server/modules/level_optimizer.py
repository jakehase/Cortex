"""Level optimization algorithms for Nexus orchestration.

Implements:
1) Contextual bandit level scheduler (Thompson sampling)
2) Token-budget knapsack planner
3) Semantic delta cache for prompt/retrieval reuse
4) Anytime early-exit confidence gate
5) Counterfactual replay harness for level-policy evaluation
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import hashlib
import json
import random
import re


DEFAULT_STATE_DIR = Path("/opt/clawdbot/state")


ARM_LIBRARY: Dict[str, Dict[str, Any]] = {
    "fastlane_minimal": {
        "levels": [5, 34],
        "policy": "fastlane",
        "description": "Low-latency QA path with validator",
    },
    "fastlane_memory": {
        "levels": [5, 34, 7, 22],
        "policy": "fastlane",
        "description": "Fastlane with memory context reinforcement",
    },
    "deliberate_council": {
        "levels": [5, 15, 32, 34],
        "policy": "deliberate",
        "description": "Multi-perspective path for tradeoffs and constraints",
    },
    "creative_fractal": {
        "levels": [13, 29, 32, 34],
        "policy": "creative",
        "description": "Recursive ideation/synthesis path",
    },
}


def _safe_load_json(path: Path, default: Dict[str, Any]) -> Dict[str, Any]:
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return default


def _safe_write_json(path: Path, payload: Dict[str, Any]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


class ContextualBanditScheduler:
    """Simple contextual Thompson sampling scheduler for level-arm selection."""

    def __init__(self, state_path: Optional[Path] = None):
        self.state_path = state_path or (DEFAULT_STATE_DIR / "nexus_bandit_state.json")
        self.state = _safe_load_json(self.state_path, {"contexts": {}, "version": "v1"})

    @staticmethod
    def context_bucket(query: str, risk_flags: List[str], complexity_hard: bool, brainstorm: bool) -> str:
        if brainstorm:
            return "brainstorm"
        if complexity_hard or bool(risk_flags):
            return "complex_or_risk"
        q = (query or "").lower()
        if any(k in q for k in ["plan", "strategy", "architecture", "tradeoff", "optimize"]):
            return "planning"
        return "simple"

    def _arm_state(self, context: str, arm: str) -> Dict[str, float]:
        ctx = self.state.setdefault("contexts", {}).setdefault(context, {})
        return ctx.setdefault(arm, {"alpha": 1.0, "beta": 1.0, "plays": 0, "reward_sum": 0.0})

    def select_arm(self, context: str, query: str, candidates: Optional[List[str]] = None) -> Dict[str, Any]:
        arms = [a for a in (candidates or list(ARM_LIBRARY.keys())) if a in ARM_LIBRARY]
        if not arms:
            arms = ["fastlane_minimal"]

        # Deterministic seed per query gives stable behavior/testability.
        seed = int(hashlib.sha256(f"{context}|{query}".encode("utf-8")).hexdigest()[:12], 16)
        rng = random.Random(seed)

        best_arm = arms[0]
        best_sample = -1.0
        samples: Dict[str, float] = {}
        for arm in arms:
            st = self._arm_state(context, arm)
            sample = rng.betavariate(float(st.get("alpha", 1.0)), float(st.get("beta", 1.0)))
            samples[arm] = sample
            if sample > best_sample:
                best_sample = sample
                best_arm = arm

        return {
            "context": context,
            "selected_arm": best_arm,
            "sample": round(best_sample, 4),
            "samples": {k: round(v, 4) for k, v in samples.items()},
            "levels": list(ARM_LIBRARY[best_arm]["levels"]),
            "policy": ARM_LIBRARY[best_arm]["policy"],
            "description": ARM_LIBRARY[best_arm]["description"],
        }

    def update(self, context: str, arm: str, reward: float) -> None:
        st = self._arm_state(context, arm)
        r = max(0.0, min(1.0, float(reward)))
        # Fractional beta-binomial update.
        st["alpha"] = float(st.get("alpha", 1.0)) + r
        st["beta"] = float(st.get("beta", 1.0)) + (1.0 - r)
        st["plays"] = int(st.get("plays", 0)) + 1
        st["reward_sum"] = float(st.get("reward_sum", 0.0)) + r
        _safe_write_json(self.state_path, self.state)


@dataclass
class BudgetItem:
    item_id: str
    cost: int
    utility: float
    payload: Dict[str, Any]


class TokenBudgetPlanner:
    """0/1 knapsack planner for token-aware context allocation."""

    @staticmethod
    def estimate_tokens(text: str) -> int:
        if not text:
            return 1
        # Fast approximation.
        return max(1, int(len(text) / 4))

    def allocate(self, budget: int, items: List[BudgetItem]) -> Dict[str, Any]:
        cap = max(1, int(budget))
        if not items:
            return {"budget": cap, "used": 0, "utility": 0.0, "selected_ids": []}

        # Bound DP width for safety.
        cap = min(cap, 4096)
        n = len(items)
        dp = [[0.0] * (cap + 1) for _ in range(n + 1)]
        take = [[False] * (cap + 1) for _ in range(n + 1)]

        for i in range(1, n + 1):
            item = items[i - 1]
            w = max(1, int(item.cost))
            v = float(item.utility)
            for c in range(cap + 1):
                best = dp[i - 1][c]
                choose = False
                if w <= c:
                    alt = dp[i - 1][c - w] + v
                    if alt > best:
                        best = alt
                        choose = True
                dp[i][c] = best
                take[i][c] = choose

        c = cap
        selected_ids: List[str] = []
        used = 0
        for i in range(n, 0, -1):
            if take[i][c]:
                item = items[i - 1]
                selected_ids.append(item.item_id)
                w = max(1, int(item.cost))
                used += w
                c -= w

        selected_ids.reverse()
        return {
            "budget": cap,
            "used": min(cap, used),
            "utility": round(dp[n][cap], 4),
            "selected_ids": selected_ids,
        }


class SemanticDeltaCache:
    """Query-delta and retrieval reuse cache."""

    def __init__(self, state_path: Optional[Path] = None):
        self.state_path = state_path or (DEFAULT_STATE_DIR / "nexus_semantic_delta_cache.json")
        self.state = _safe_load_json(self.state_path, {"last": {}, "entries": {}, "version": "v1"})

    @staticmethod
    def _normalize(query: str) -> List[str]:
        tokens = re.findall(r"[a-zA-Z0-9_]+", (query or "").lower())
        return [t for t in tokens if len(t) > 2]

    @staticmethod
    def _similarity(a: List[str], b: List[str]) -> float:
        sa, sb = set(a), set(b)
        if not sa and not sb:
            return 1.0
        if not sa or not sb:
            return 0.0
        return len(sa & sb) / max(1, len(sa | sb))

    @staticmethod
    def _hash_query(query: str) -> str:
        return hashlib.sha256((query or "").encode("utf-8")).hexdigest()[:16]

    def analyze(self, query: str) -> Dict[str, Any]:
        current = self._normalize(query)
        last_q = str((self.state.get("last") or {}).get("query", ""))
        last = self._normalize(last_q)
        sim = self._similarity(current, last)

        retained = sorted(set(current) & set(last))[:32]
        changed = sorted(set(current) - set(last))[:32]

        return {
            "has_last": bool(last_q),
            "similarity": round(sim, 4),
            "retained_terms": retained,
            "changed_terms": changed,
            "novelty": round(1.0 - sim, 4),
            "last_query_hash": self._hash_query(last_q) if last_q else "",
        }

    def maybe_reuse_retrieval(self, query: str, min_similarity: float = 0.62) -> List[Dict[str, Any]]:
        delta = self.analyze(query)
        if float(delta.get("similarity", 0.0)) < float(min_similarity):
            return []

        last = self.state.get("last") or {}
        items = last.get("retrieval") if isinstance(last.get("retrieval"), list) else []
        return [x for x in items[:2] if isinstance(x, dict)]

    def update(self, query: str, retrieval: List[Dict[str, Any]], semantic_digest: Optional[Dict[str, Any]] = None) -> None:
        qh = self._hash_query(query)
        self.state["entries"] = self.state.get("entries", {})
        self.state["entries"][qh] = {
            "query": query,
            "retrieval": retrieval[:5],
            "semantic_digest": semantic_digest or {},
        }
        self.state["last"] = self.state["entries"][qh]
        _safe_write_json(self.state_path, self.state)


def should_early_exit(confidence: float, risk_flags: List[str], complexity_hard: bool, escalated: bool, threshold: float = 0.84) -> Tuple[bool, str]:
    if escalated:
        return False, "escalated"
    if complexity_hard:
        return False, "complexity_hard"
    if risk_flags:
        return False, "risk_sensitive"
    if float(confidence) >= float(threshold):
        return True, "confidence_gate"
    return False, "low_confidence"


def run_counterfactual_replay(
    dataset_path: str,
    limit: int = 500,
    exploration_seed: int = 41,
) -> Dict[str, Any]:
    """Offline replay comparing heuristic baseline vs bandit policy.

    Dataset JSONL schema (minimal):
      {"query": "...", "risk_flags": [...], "complexity_hard": bool, "quality": 0..1, "tokens": int}
    """
    path = Path(dataset_path)
    if not path.exists():
        return {"success": False, "error": f"dataset not found: {dataset_path}"}

    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if isinstance(obj, dict) and obj.get("query"):
                    rows.append(obj)
            except Exception:
                continue
            if len(rows) >= max(1, min(int(limit), 5000)):
                break

    if not rows:
        return {"success": False, "error": "no valid rows in dataset"}

    rng = random.Random(int(exploration_seed))

    def baseline_arm(row: Dict[str, Any]) -> str:
        q = str(row.get("query", "")).lower()
        if "brainstorm" in q:
            return "creative_fractal"
        if row.get("complexity_hard") or row.get("risk_flags"):
            return "deliberate_council"
        return "fastlane_memory"

    def estimate_tokens(arm: str) -> int:
        return 120 * len(ARM_LIBRARY.get(arm, {}).get("levels", [5, 34]))

    def estimate_quality(row: Dict[str, Any], arm: str) -> float:
        observed = row.get("quality")
        if isinstance(observed, (int, float)):
            base = float(observed)
        else:
            base = 0.62
        bonus = 0.0
        if arm == "deliberate_council" and (row.get("complexity_hard") or row.get("risk_flags")):
            bonus += 0.08
        if arm == "fastlane_minimal" and (row.get("complexity_hard") or row.get("risk_flags")):
            bonus -= 0.10
        if arm == "creative_fractal" and "brainstorm" in str(row.get("query", "")).lower():
            bonus += 0.06
        jitter = rng.uniform(-0.02, 0.02)
        return max(0.0, min(1.0, base + bonus + jitter))

    baseline_quality = 0.0
    baseline_tokens = 0
    bandit_quality = 0.0
    bandit_tokens = 0

    scheduler = ContextualBanditScheduler(state_path=DEFAULT_STATE_DIR / "nexus_bandit_replay_tmp.json")
    scheduler.state = {"contexts": {}, "version": "replay_v1"}

    for row in rows:
        q = str(row.get("query", ""))
        rf = row.get("risk_flags") if isinstance(row.get("risk_flags"), list) else []
        complexity_hard = bool(row.get("complexity_hard", False))
        brainstorm = "brainstorm" in q.lower()
        ctx = scheduler.context_bucket(q, rf, complexity_hard, brainstorm)

        b_arm = baseline_arm(row)
        baseline_quality += estimate_quality(row, b_arm)
        baseline_tokens += int(row.get("tokens") or estimate_tokens(b_arm))

        chosen = scheduler.select_arm(ctx, q)
        a_arm = chosen["selected_arm"]
        q_score = estimate_quality(row, a_arm)
        t_cost = int(row.get("tokens") or estimate_tokens(a_arm))
        bandit_quality += q_score
        bandit_tokens += t_cost

        # Replay update objective balances quality and token economy.
        reward = max(0.0, min(1.0, q_score - min(0.25, t_cost / 6000.0)))
        scheduler.update(ctx, a_arm, reward)

    n = len(rows)
    result = {
        "success": True,
        "rows": n,
        "baseline": {
            "avg_quality": round(baseline_quality / n, 4),
            "avg_tokens": int(baseline_tokens / n),
        },
        "bandit": {
            "avg_quality": round(bandit_quality / n, 4),
            "avg_tokens": int(bandit_tokens / n),
        },
    }
    result["delta"] = {
        "quality": round(result["bandit"]["avg_quality"] - result["baseline"]["avg_quality"], 4),
        "tokens": int(result["bandit"]["avg_tokens"] - result["baseline"]["avg_tokens"]),
    }
    return result
