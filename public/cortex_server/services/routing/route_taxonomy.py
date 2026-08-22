from __future__ import annotations

from typing import Dict, Iterable, List


_ROUTE_TAXONOMY_VERSION = "r9.route_taxonomy.v1"

_INTENT_DEFAULTS = {
    "qa": "fastlane_memory",
    "coding": "deliberate_council",
    "planning": "deliberate_council",
    "research": "research_grounded",
    "creative": "creative_fractal",
    "reminder": "safe_reminder",
}

_INTENT_ALLOWED = {
    "qa": ["fastlane_memory", "deliberate_council"],
    "coding": ["deliberate_council", "fastlane_memory"],
    "planning": ["deliberate_council", "fastlane_memory"],
    "research": ["research_grounded", "deliberate_council", "fastlane_memory"],
    "creative": ["creative_fractal", "deliberate_council"],
    "reminder": ["safe_reminder", "fastlane_memory"],
}

_HIGH_RISK_OVERRIDES = {
    "qa": ["deliberate_council"],
    "coding": ["deliberate_council"],
    "planning": ["deliberate_council"],
    "research": ["research_grounded", "deliberate_council"],
    "creative": ["deliberate_council"],
    "reminder": ["safe_reminder", "deliberate_council"],
}

_CRITICAL_RISK_OVERRIDES = {
    "qa": ["deliberate_council"],
    "coding": ["deliberate_council"],
    "planning": ["deliberate_council"],
    "research": ["research_grounded"],
    "creative": ["deliberate_council"],
    "reminder": ["deliberate_council"],
}

_RISK_FLAG_BUCKETS = {
    "critical": {"destructive_action", "financial", "medical", "legal", "security_critical"},
    "high": {"security_change", "pii", "prod_incident", "sensitive_data"},
    "medium": {"live_state", "code_change", "external_side_effect", "approval_required"},
}


def taxonomy_version() -> str:
    return _ROUTE_TAXONOMY_VERSION


def classify_risk_tier(risk_flags: Iterable[str]) -> str:
    flags = {str(flag).strip() for flag in risk_flags if str(flag).strip()}
    if flags & _RISK_FLAG_BUCKETS["critical"]:
        return "critical"
    if flags & _RISK_FLAG_BUCKETS["high"]:
        return "high"
    if flags & _RISK_FLAG_BUCKETS["medium"]:
        return "medium"
    return "low"


def allowed_chains_for_intent(intent: str, risk_tier: str = "low") -> List[str]:
    intent = str(intent or "qa")
    risk_tier = str(risk_tier or "low")
    if risk_tier == "critical":
        return list(_CRITICAL_RISK_OVERRIDES.get(intent, _CRITICAL_RISK_OVERRIDES["qa"]))
    if risk_tier == "high":
        return list(_HIGH_RISK_OVERRIDES.get(intent, _HIGH_RISK_OVERRIDES["qa"]))
    return list(_INTENT_ALLOWED.get(intent, _INTENT_ALLOWED["qa"]))


def default_chain_for_intent(intent: str, risk_tier: str = "low") -> str:
    allowed = allowed_chains_for_intent(intent, risk_tier=risk_tier)
    preferred = _INTENT_DEFAULTS.get(str(intent or "qa"), "fastlane_memory")
    return preferred if preferred in allowed else allowed[0]


def canonical_route_taxonomy() -> Dict[str, object]:
    intents = {}
    for intent, default in _INTENT_DEFAULTS.items():
        intents[intent] = {
            "default_chain": default,
            "allowed_chains": list(_INTENT_ALLOWED[intent]),
            "high_risk_allowed_chains": list(_HIGH_RISK_OVERRIDES.get(intent, [])),
            "critical_risk_allowed_chains": list(_CRITICAL_RISK_OVERRIDES.get(intent, [])),
        }
    return {
        "version": _ROUTE_TAXONOMY_VERSION,
        "risk_tiers": ["low", "medium", "high", "critical"],
        "intents": intents,
        "notes": [
            "low-risk intents may use lower-latency chains",
            "high/critical risk trims candidate space toward deliberate or grounded chains",
            "creative routing is not allowed under critical risk",
        ],
    }


def validate_route(intent: str, chain_id: str, *, risk_tier: str = "low") -> Dict[str, object]:
    allowed = allowed_chains_for_intent(intent, risk_tier=risk_tier)
    return {
        "intent": intent,
        "risk_tier": risk_tier,
        "chain_id": chain_id,
        "allowed_chains": allowed,
        "valid": str(chain_id) in allowed,
    }
