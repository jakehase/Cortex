"""
L9 Counterfactual Invariant Forge (CIF)

L9-native architecture transcendence primitive:
- Builds a lightweight causal graph from architecture intent text.
- Runs deterministic adversarial counterfactual scenarios.
- Mines architecture invariants from weak points.
- Scores robustness, reversibility, and novelty-distance.
- Emits decision telemetry with shadow/canary/active gating modes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple
import hashlib
import json
import os
import re


_ALLOWED_MODES = {"off", "shadow", "canary", "active"}

_STATE_ROOT = Path(os.getenv("L9_CIF_STATE_ROOT", "/opt/clawdbot/state/l9_cif"))
_HISTORY_PATH = _STATE_ROOT / "decision_history.jsonl"
_LATEST_DECISION_PATH = _STATE_ROOT / "latest_decision.json"
_LATEST_INVARIANTS_PATH = _STATE_ROOT / "invariants_latest.json"
_LATEST_NOVELTY_PATH = _STATE_ROOT / "novelty_latest.json"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_json(path: Path, default: Any) -> Any:
    try:
        if path.exists() and path.is_file():
            return json.loads(path.read_text())
    except Exception:
        pass
    return default


def _safe_write_json(path: Path, payload: Any) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    except Exception:
        pass


def _append_history(payload: Dict[str, Any]) -> None:
    try:
        _HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _HISTORY_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except Exception:
        return float(default)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return int(default)


def _mode() -> str:
    mode = str(os.getenv("L9_CIF_MODE", "shadow") or "shadow").strip().lower()
    return mode if mode in _ALLOWED_MODES else "shadow"


def _canary_hit(query: str, percent: int) -> bool:
    pct = max(0, min(100, int(percent)))
    if pct <= 0:
        return False
    if pct >= 100:
        return True
    bucket = int(hashlib.sha256((query or "").encode("utf-8")).hexdigest(), 16) % 100
    return bucket < pct


def _normalize_text(text: str) -> str:
    q = (text or "").lower()
    q = q.replace("-", " ").replace("/", " ")
    q = re.sub(r"\s+", " ", q).strip()
    return q


def _tokenize(text: str) -> List[str]:
    raw = re.split(r"[^a-z0-9_]+", _normalize_text(text))
    return [tok for tok in raw if len(tok) >= 3]


def _fingerprint_tokens(tokens: List[str]) -> str:
    key = "|".join(sorted(set(tokens))[:80])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _build_causal_graph(query: str) -> Dict[str, Any]:
    q = _normalize_text(query)
    node_catalog = [
        ("edge", ["edge", "gateway", "ingress", "api"]),
        ("orchestrator", ["orchestrat", "router", "coordinator", "nexus"]),
        ("service", ["service", "worker", "microservice"]),
        ("queue", ["queue", "stream", "kafka", "pubsub", "bus"]),
        ("cache", ["cache", "redis", "memcache"]),
        ("storage", ["storage", "database", "db", "postgres", "mysql", "s3"]),
        ("observability", ["monitor", "trace", "telemetry", "alert", "dashboard"]),
        ("rollback", ["rollback", "feature flag", "canary", "blue green"]),
    ]

    selected_nodes: List[str] = []
    for name, markers in node_catalog:
        if any(m in q for m in markers):
            selected_nodes.append(name)

    if not selected_nodes:
        selected_nodes = ["edge", "orchestrator", "service", "storage", "observability", "rollback"]

    selected_nodes = list(dict.fromkeys(selected_nodes))

    edges: List[Tuple[str, str]] = []
    for i in range(len(selected_nodes) - 1):
        edges.append((selected_nodes[i], selected_nodes[i + 1]))

    if "queue" in selected_nodes and "service" in selected_nodes:
        edges.append(("service", "queue"))
    if "cache" in selected_nodes and "storage" in selected_nodes:
        edges.append(("cache", "storage"))

    critical_path = selected_nodes[:]
    return {
        "nodes": [{"id": n, "critical": n in {"edge", "orchestrator", "service", "storage"}} for n in selected_nodes],
        "edges": [{"from": a, "to": b} for a, b in edges],
        "critical_path": critical_path,
    }


def _generate_counterfactuals(query: str, graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    q = _normalize_text(query)
    n_nodes = len(graph.get("nodes") or [])
    n_edges = len(graph.get("edges") or [])

    resilience_markers = {
        "zone_outage": ["multi zone", "multi region", "replica", "failover", "high availability", "no spof", "no single point of failure"],
        "network_partition": ["retry", "timeout", "circuit breaker", "backoff", "bulkhead", "graceful degradation"],
        "schema_drift": ["backward compatible", "schema version", "compatibility", "expand contract", "schema migration plan"],
        "rollback_regression": ["rollback", "roll back", "feature flag", "canary", "blue green", "safe rollback"],
        "latency_spike": ["queue", "autoscale", "rate limit", "degrade gracefully", "load shed", "shed load"],
    }

    architecture_hardening_markers = [
        "high availability",
        "fault tolerance",
        "no spof",
        "no single point of failure",
        "redundant",
        "redundancy",
        "failover",
        "graceful degradation",
        "circuit breaker",
        "rollback",
        "safe rollback",
        "feature flag",
        "canary",
        "blue green",
        "observability",
        "slo",
    ]
    architecture_risk_markers = [
        "single point of failure",
        "big bang",
        "hard cutover",
        "irreversible",
        "no rollback",
        "manual only",
        "no monitoring",
    ]

    specs = [
        ("zone_outage", "Primary zone outage under peak load", 0.55),
        ("network_partition", "Cross-service partition while writes continue", 0.58),
        ("schema_drift", "Schema migration drift between service versions", 0.52),
        ("rollback_regression", "Partial rollback leaves mixed binaries", 0.57),
        ("latency_spike", "Tail-latency spike causes cascading retries", 0.54),
    ]

    scenarios: List[Dict[str, Any]] = []
    # Reward richer, dependency-aware topologies and explicit hardening language.
    topology_bonus = min(0.10, max(0.0, (n_nodes - 4) * 0.012 + max(0, n_edges - (n_nodes - 1)) * 0.008))
    hardening_hits = sum(1 for mk in architecture_hardening_markers if mk in q)
    hardening_bonus = min(0.14, hardening_hits * 0.018)
    risk_hits = sum(1 for mk in architecture_risk_markers if mk in q)
    risk_penalty = min(0.18, risk_hits * 0.05)

    for sid, title, base_survival in specs:
        hits = sum(1 for mk in resilience_markers[sid] if mk in q)
        marker_bonus = min(0.24, hits * 0.06)
        survival = max(0.12, min(0.98, base_survival + topology_bonus + hardening_bonus + marker_bonus - risk_penalty))
        scenarios.append(
            {
                "id": sid,
                "title": title,
                "resilience_markers_hit": hits,
                "survival_score": round(survival, 3),
            }
        )

    return scenarios


def _mine_invariants(query: str, scenarios: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    invariants: List[Dict[str, Any]] = [
        {
            "id": "inv_no_spof",
            "statement": "Critical-path components must have no single point of failure.",
            "why": "Prevent full outage from isolated component loss.",
        },
        {
            "id": "inv_rollback_first_class",
            "statement": "Every risky deployment must have a reversible rollback path validated before release.",
            "why": "Contain blast radius and reduce time-to-recovery.",
        },
        {
            "id": "inv_observability_guard",
            "statement": "Decision-critical paths require telemetry coverage sufficient to detect degradation within one check interval.",
            "why": "Guarantee rapid detection for counterfactual failures.",
        },
    ]

    low = [s for s in scenarios if float(s.get("survival_score", 0.0)) < 0.60]
    low_ids = {s.get("id") for s in low}

    if "schema_drift" in low_ids:
        invariants.append(
            {
                "id": "inv_schema_compat",
                "statement": "Schema changes must remain backward compatible for at least one deploy window.",
                "why": "Avoid mixed-version data corruption during rollouts.",
            }
        )

    if "network_partition" in low_ids or "latency_spike" in low_ids:
        invariants.append(
            {
                "id": "inv_retry_budget",
                "statement": "Retries must be bounded by timeout budgets and protected by circuit-breaker policy.",
                "why": "Prevent retry storms and secondary outages.",
            }
        )

    q = _normalize_text(query)
    if any(m in q for m in ["stateful", "database", "transaction", "write"]):
        invariants.append(
            {
                "id": "inv_write_safety",
                "statement": "Write paths require idempotency keying or exactly-once compensation semantics.",
                "why": "Maintain correctness during replay/retry conditions.",
            }
        )

    # Deduplicate by invariant id.
    dedup: Dict[str, Dict[str, Any]] = {}
    for inv in invariants:
        dedup[str(inv.get("id"))] = inv
    return list(dedup.values())


def _reversibility_score(query: str) -> float:
    q = _normalize_text(query)
    positive_markers = [
        "rollback",
        "roll back",
        "safe rollback",
        "feature flag",
        "canary",
        "blue green",
        "progressive",
        "guardrail",
        "abort",
        "drain",
        "staged",
    ]
    negative_markers = [
        "big bang",
        "all at once",
        "irreversible",
        "no rollback",
        "hard cutover",
        "one way migration",
    ]

    pos = sum(1 for m in positive_markers if m in q)
    neg = sum(1 for m in negative_markers if m in q)

    score = 0.50 + min(0.34, pos * 0.045) - min(0.30, neg * 0.08)

    explicit_safety = ("rollback" in q or "roll back" in q) and any(k in q for k in ["safe", "validated", "tested", "plan", "strategy"])
    if explicit_safety:
        score += 0.04

    if "feature flag" in q and "canary" in q:
        score += 0.02

    return max(0.05, min(0.98, score))


def _robustness_score(scenarios: List[Dict[str, Any]]) -> float:
    if not scenarios:
        return 0.5
    vals = [float(s.get("survival_score", 0.0)) for s in scenarios]
    return max(0.05, min(0.99, sum(vals) / len(vals)))


def _load_recent_history(limit: int = 120) -> List[Dict[str, Any]]:
    try:
        if not _HISTORY_PATH.exists() or not _HISTORY_PATH.is_file():
            return []
        rows = []
        with _HISTORY_PATH.open("r", encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    item = json.loads(ln)
                    if isinstance(item, dict):
                        rows.append(item)
                except Exception:
                    continue
        return rows[-limit:]
    except Exception:
        return []


def _novelty_distance(query: str) -> Dict[str, Any]:
    q = _normalize_text(query)
    tokens = sorted(set(_tokenize(query)))
    fp = _fingerprint_tokens(tokens)

    novelty_markers = [
        "novel",
        "transcendent",
        "breakthrough",
        "counterfactual",
        "anti fragile",
        "topology mutation",
        "emergent",
        "self improving",
        "non linear",
        "out of distribution",
        "causal invariant",
        "metamorphic",
    ]
    marker_hits = sum(1 for m in novelty_markers if m in q)

    history = _load_recent_history(limit=180)
    prev = [h for h in history if isinstance(h.get("tokens"), list)]
    if not prev:
        baseline = max(0.72, min(0.9, 0.72 + marker_hits * 0.02))
        return {
            "score": round(baseline, 3),
            "nearest_similarity": 0.0,
            "fingerprint": fp,
            "history_compared": 0,
            "tokens": tokens,
            "lexical_novelty": 1.0,
            "marker_hits": marker_hits,
        }

    def jaccard(a: set, b: set) -> float:
        if not a and not b:
            return 1.0
        den = len(a | b)
        if den <= 0:
            return 0.0
        return len(a & b) / den

    cur = set(tokens)
    max_sim = 0.0
    for it in prev:
        other = set([str(t) for t in it.get("tokens", [])])
        max_sim = max(max_sim, jaccard(cur, other))

    lexical_novelty = max(0.0, min(1.0, 1.0 - max_sim))
    marker_boost = min(0.45, marker_hits * 0.06)
    novelty = max(lexical_novelty, min(0.95, lexical_novelty + marker_boost * 1.5))

    return {
        "score": round(novelty, 3),
        "nearest_similarity": round(max_sim, 3),
        "fingerprint": fp,
        "history_compared": len(prev),
        "tokens": tokens,
        "lexical_novelty": round(lexical_novelty, 3),
        "marker_hits": marker_hits,
    }


def run_l9_cif(query: str, constraints: Dict[str, Any] | None = None) -> Dict[str, Any]:
    mode = _mode()
    if mode == "off":
        return {
            "enabled": False,
            "mode": "off",
            "decision": {
                "accepted": True,
                "gating_active": False,
                "base_pass": True,
                "reason": "disabled",
            },
        }

    graph = _build_causal_graph(query)
    scenarios = _generate_counterfactuals(query, graph)
    invariants = _mine_invariants(query, scenarios)
    novelty = _novelty_distance(query)

    robustness = _robustness_score(scenarios)
    reversibility = _reversibility_score(query)
    novelty_score = float(novelty.get("score", 0.0))

    intent = str((constraints or {}).get("intent") or "").strip().lower()
    novelty_min_strict = _env_float("L9_CIF_NOVELTY_MIN", 0.35)
    novelty_min_arch = _env_float("L9_CIF_NOVELTY_MIN_ARCH", 0.0)
    novelty_min_effective = novelty_min_strict if intent in {"l9_novelty"} else novelty_min_arch

    thresholds = {
        "robustness_min": _env_float("L9_CIF_ROBUSTNESS_MIN", 0.62),
        "reversibility_min": _env_float("L9_CIF_REVERSIBILITY_MIN", 0.58),
        "novelty_min": novelty_min_effective,
    }

    composite = 0.50 * robustness + 0.30 * reversibility + 0.20 * novelty_score
    base_pass = (
        robustness >= float(thresholds["robustness_min"])
        and reversibility >= float(thresholds["reversibility_min"])
        and novelty_score >= float(thresholds["novelty_min"])
    )

    canary_percent = max(0, min(100, _env_int("L9_CIF_CANARY_PERCENT", 10)))
    canary_hit = _canary_hit(query, canary_percent)
    gating_active = mode == "active" or (mode == "canary" and canary_hit)
    accepted = bool(base_pass) if gating_active else True

    reasons: List[str] = []
    if robustness < float(thresholds["robustness_min"]):
        reasons.append("robustness_below_threshold")
    if reversibility < float(thresholds["reversibility_min"]):
        reasons.append("reversibility_below_threshold")
    if novelty_score < float(thresholds["novelty_min"]):
        reasons.append("novelty_below_threshold")
    if not reasons:
        reasons.append("all_thresholds_passed")

    payload = {
        "enabled": True,
        "name": "L9 Counterfactual Invariant Forge",
        "version": "cif.v1",
        "mode": mode,
        "constraints": constraints or {},
        "threshold_profile": "strict_novelty" if intent in {"l9_novelty"} else "architecture_baseline",
        "scores": {
            "robustness": round(robustness, 3),
            "reversibility": round(reversibility, 3),
            "novelty_distance": round(novelty_score, 3),
            "composite": round(composite, 3),
        },
        "thresholds": {k: round(float(v), 3) for k, v in thresholds.items()},
        "decision": {
            "base_pass": bool(base_pass),
            "gating_active": bool(gating_active),
            "accepted": bool(accepted),
            "reasons": reasons,
            "canary": {
                "percent": canary_percent,
                "hit": canary_hit,
            },
        },
        "causal_graph": graph,
        "counterfactuals": scenarios,
        "invariants": invariants,
        "novelty": {
            "score": novelty.get("score"),
            "nearest_similarity": novelty.get("nearest_similarity"),
            "lexical_novelty": novelty.get("lexical_novelty"),
            "marker_hits": novelty.get("marker_hits"),
            "fingerprint": novelty.get("fingerprint"),
            "history_compared": novelty.get("history_compared"),
        },
        "timestamp": _utc_now_iso(),
    }

    _safe_write_json(_LATEST_DECISION_PATH, payload)
    _safe_write_json(
        _LATEST_INVARIANTS_PATH,
        {
            "timestamp": payload["timestamp"],
            "version": payload["version"],
            "invariants": invariants,
            "count": len(invariants),
        },
    )
    _safe_write_json(
        _LATEST_NOVELTY_PATH,
        {
            "timestamp": payload["timestamp"],
            "version": payload["version"],
            "novelty": payload["novelty"],
            "scores": payload["scores"],
            "thresholds": payload["thresholds"],
        },
    )

    _append_history(
        {
            "timestamp": payload["timestamp"],
            "query_hash": hashlib.sha256((query or "").encode("utf-8")).hexdigest()[:16],
            "tokens": novelty.get("tokens", []),
            "fingerprint": novelty.get("fingerprint"),
            "scores": payload["scores"],
            "thresholds": payload["thresholds"],
            "decision": payload["decision"],
            "mode": mode,
        }
    )

    return payload


def get_l9_cif_status() -> Dict[str, Any]:
    mode = _mode()
    latest = _read_json(_LATEST_DECISION_PATH, {})

    freshness_seconds = None
    try:
        ts = str((latest or {}).get("timestamp") or "")
        if ts:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            freshness_seconds = int((datetime.now(timezone.utc) - dt).total_seconds())
    except Exception:
        freshness_seconds = None

    return {
        "enabled": mode != "off",
        "mode": mode,
        "state_root": str(_STATE_ROOT),
        "latest_decision": latest if isinstance(latest, dict) else {},
        "freshness_seconds": freshness_seconds,
        "history_path": str(_HISTORY_PATH),
    }
