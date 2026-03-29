from __future__ import annotations

from typing import Any, Dict, List

from services.routing._compat import optional_import


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
    archetype = _classify_task_archetype(query, risk_flags, complexity_gate)
    if archetype in _ARCHETYPE_TO_INTENT:
        return _ARCHETYPE_TO_INTENT[archetype]
    if any(k in q for k in ["plan", "roadmap", "strategy", "tradeoff", "architecture"]):
        return "planning"
    return "qa"


def build_route_features(query: str, *, risk_flags: List[str] | None = None, historical_success: float = 0.5) -> Dict[str, Any]:
    q = (query or "").strip()
    tokens = [token for token in q.lower().replace("?", " ").replace(",", " ").split() if token]
    risk_flags = list(risk_flags or [])
    complexity = min(1.0, max(0.0, len(tokens) / 40.0))
    complexity_gate = {"score": round(complexity, 4), "hard": complexity >= 0.42}
    archetype = _classify_task_archetype(query, risk_flags, complexity_gate) or "local_fallback"
    intent = infer_intent(query, risk_flags=risk_flags, complexity_gate=complexity_gate)
    uncertainty = 1.0 if any(k in q.lower() for k in ["maybe", "unclear", "not sure", "unknown"]) else 0.35
    urgency = 1.0 if any(k in q.lower() for k in ["urgent", "asap", "right now", "immediately"]) else 0.2
    creativity = 1.0 if intent == "creative" else 0.0
    return {
        "query": query,
        "intent": intent,
        "archetype": archetype,
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
    }
