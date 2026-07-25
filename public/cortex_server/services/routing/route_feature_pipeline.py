from __future__ import annotations

from typing import Any, Dict, List

from services.routing._compat import optional_import
from services.routing.route_taxonomy import allowed_chains_for_intent, classify_risk_tier, default_chain_for_intent, taxonomy_version


_ARCHETYPE_TO_INTENT = {
    "citation_required": "research",
    "ops_triage": "research",
    "coding": "coding",
    "tool_use": "research",
    "planning": "planning",
    "risk_sensitive": "research",
    "complex_general": "qa",
    "simple_qa": "qa",
}


def _classify_task_archetype(query: str, risk_flags: List[str], complexity_gate: Dict[str, Any]) -> str | None:
    module = optional_import("cortex_server.modules.latency_budget_governor")
    classify = getattr(module, "classify_task_archetype", None) if module else None
    if callable(classify):
        try:
            return str(classify(query, risk_flags=risk_flags, complexity_gate=complexity_gate))
        except Exception:
            return None
    return None


def _token_set(query: str) -> set[str]:
    return {token for token in query.replace("?", " ").replace(",", " ").split() if token}


def _contains_token_or_phrase(q: str, tokens: set[str], patterns: List[str]) -> bool:
    for pattern in patterns:
        if " " in pattern:
            if pattern in q:
                return True
        elif pattern in tokens:
            return True
    return False


def infer_intent(query: str, *, risk_flags: List[str] | None = None, complexity_gate: Dict[str, Any] | None = None) -> str:
    q = (query or "").lower()
    tokens = _token_set(q)
    risk_flags = list(risk_flags or [])
    complexity_gate = dict(complexity_gate or {})
    if _contains_token_or_phrase(q, tokens, ["brainstorm", "ideas", "novel", "creative"]):
        return "creative"
    if _contains_token_or_phrase(q, tokens, ["fix", "bug", "stack trace", "test", "pytest", "compile"]):
        return "coding"
    if _contains_token_or_phrase(q, tokens, ["remind", "later", "schedule"]):
        return "reminder"
    if _contains_token_or_phrase(q, tokens, ["research", "compare", "survey", "find sources", "current", "latest", "sources"]):
        return "research"
    if _contains_token_or_phrase(q, tokens, ["plan", "roadmap", "strategy", "tradeoff", "architecture"]):
        return "planning"
    archetype = _classify_task_archetype(query, risk_flags, complexity_gate)
    if archetype in _ARCHETYPE_TO_INTENT:
        return _ARCHETYPE_TO_INTENT[archetype]
    return "qa"


def _latency_plan(query: str, *, risk_flags: List[str], complexity_gate: Dict[str, Any], governor: Any = None) -> Dict[str, Any]:
    if governor is None:
        return {
            "archetype": _classify_task_archetype(query, risk_flags, complexity_gate) or "simple_qa",
            "cheap_route": "fastlane",
            "max_latency_ms": 2200,
            "max_context_tokens": 1200,
            "prefetch_enabled": False,
            "prefetch_targets": [],
            "escalate_on": {},
        }
    try:
        return dict(governor.plan(query, risk_flags=risk_flags, complexity_gate=complexity_gate))
    except Exception:
        return {
            "archetype": _classify_task_archetype(query, risk_flags, complexity_gate) or "simple_qa",
            "cheap_route": "fastlane",
            "max_latency_ms": 2200,
            "max_context_tokens": 1200,
            "prefetch_enabled": False,
            "prefetch_targets": [],
            "escalate_on": {},
        }


def _health_summary(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    deps = snapshot.get("dependencies") if isinstance(snapshot, dict) else {}
    if not isinstance(deps, dict):
        deps = {}
    unhealthy = sorted([name for name, row in deps.items() if isinstance(row, dict) and not bool(row.get("healthy", False))])
    return {
        "dependency_count": len(deps),
        "unhealthy_dependencies": unhealthy,
        "health_degraded": bool(unhealthy),
    }


def build_route_features(
    query: str,
    *,
    risk_flags: List[str] | None = None,
    historical_success: float = 0.5,
    latency_governor: Any = None,
    runtime_policy: Dict[str, Any] | None = None,
    outcome_tuner: Any = None,
    route_health: Any = None,
) -> Dict[str, Any]:
    q = (query or "").strip()
    tokens = [token for token in q.lower().replace("?", " ").replace(",", " ").split() if token]
    risk_flags = list(risk_flags or [])
    complexity = min(1.0, max(0.0, len(tokens) / 40.0))
    complexity_gate = {"score": round(complexity, 4), "hard": complexity >= 0.42}
    archetype = _classify_task_archetype(query, risk_flags, complexity_gate) or "local_fallback"
    intent = infer_intent(query, risk_flags=risk_flags, complexity_gate=complexity_gate)
    risk_tier = classify_risk_tier(risk_flags)
    allowed_chain_ids = allowed_chains_for_intent(intent, risk_tier=risk_tier)
    default_chain = default_chain_for_intent(intent, risk_tier=risk_tier)
    uncertainty = 1.0 if any(k in q.lower() for k in ["maybe", "unclear", "not sure", "unknown"]) else 0.35
    urgency = 1.0 if any(k in q.lower() for k in ["urgent", "asap", "right now", "immediately"]) else 0.2
    creativity = 1.0 if intent == "creative" else 0.0
    latency_plan = _latency_plan(
        query,
        risk_flags=risk_flags,
        complexity_gate=complexity_gate,
        governor=latency_governor,
    )
    runtime_policy = dict(runtime_policy or {})
    health_snapshot: Dict[str, Any] = {}
    if isinstance(route_health, dict):
        health_snapshot = dict(route_health)
    elif route_health is not None and callable(getattr(route_health, "snapshot", None)):
        try:
            result = route_health.snapshot()
            health_snapshot = dict(result) if isinstance(result, dict) else {}
        except Exception:
            health_snapshot = {}
    runtime_health = _health_summary(health_snapshot)
    outcome_hint: Dict[str, Any] = {}
    if outcome_tuner is not None and callable(getattr(outcome_tuner, "get_policy_hint", None)):
        try:
            result = outcome_tuner.get_policy_hint(archetype=archetype, query=query)
            outcome_hint = dict(result) if isinstance(result, dict) else {}
        except Exception:
            outcome_hint = {}
    budget_pressure_ms = int((latency_plan.get("escalate_on") or {}).get("budget_pressure_after_ms", 0) or 0)
    timeout_pressure = bool(runtime_health["health_degraded"]) or (budget_pressure_ms and budget_pressure_ms <= 1800)
    return {
        "query": query,
        "intent": intent,
        "archetype": archetype,
        "risk_tier": risk_tier,
        "route_taxonomy_version": taxonomy_version(),
        "allowed_chain_ids": allowed_chain_ids,
        "default_chain": default_chain,
        "token_count": len(tokens),
        "complexity": round(complexity, 4),
        "complexity_gate": complexity_gate,
        "uncertainty": round(uncertainty, 4),
        "urgency": round(urgency, 4),
        "risk_flags": risk_flags,
        "risk_count": len(risk_flags),
        "historical_success": float(historical_success),
        "creativity": creativity,
        "coding": 1.0 if intent == "coding" else 0.0,
        "research": 1.0 if intent == "research" else 0.0,
        "planning": 1.0 if intent == "planning" else 0.0,
        "uses_cortex_classifier": archetype != "local_fallback",
        "route_context": {
            "latency_plan": latency_plan,
            "runtime_policy": {
                "complexity_hard_threshold": runtime_policy.get("complexity_hard_threshold"),
                "fastlane_escalation_threshold": runtime_policy.get("fastlane_escalation_threshold"),
                "l9_auto_activation_threshold": runtime_policy.get("l9_auto_activation_threshold"),
                "autotune_enabled": runtime_policy.get("autotune_enabled"),
            },
            "outcome_hint": {
                "stage": outcome_hint.get("stage"),
                "recommended_policy": outcome_hint.get("recommended_policy"),
                "decision_confidence": outcome_hint.get("decision_confidence"),
            },
            "health": runtime_health,
            "prefetch_enabled": bool(latency_plan.get("prefetch_enabled", False)),
            "cheap_route": latency_plan.get("cheap_route"),
            "budget_pressure_after_ms": budget_pressure_ms,
            "timeout_pressure": bool(timeout_pressure),
            "recent_level_efficacy": float(outcome_hint.get("decision_confidence", 0.0) or 0.0),
        },
    }
