from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


ASSURANCE_VERSION = "nexus.assurance.v1"


HIGH_RISK_FLAGS = {"medical", "legal", "financial", "safety", "security"}
IRREVERSIBLE_HINTS = {"legal", "medical", "financial", "security"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _confidence_band(score: float) -> str:
    x = float(score)
    if x >= 0.84:
        return "high"
    if x >= 0.62:
        return "medium"
    return "low"


def _risk_tier(risk_flags: List[str]) -> str:
    flags = set(risk_flags or [])
    if flags & HIGH_RISK_FLAGS:
        return "high"
    if flags:
        return "medium"
    return "low"


def _reversibility_tier(risk_flags: List[str], routing_method: str, query: str = "") -> str:
    flags = set(risk_flags or [])
    q = (query or "").lower()
    if flags & IRREVERSIBLE_HINTS:
        return "difficult"
    if routing_method in {"incident_chain_forced", "coding_chain_forced"}:
        return "moderate"
    if any(x in q for x in ["delete", "migrate", "cutover", "deploy", "rollback"]):
        return "moderate"
    return "easy"


def build_validator_summary(
    *,
    checks: Optional[Dict[str, Any]],
    validator_result: Optional[Dict[str, Any]],
    cognitive_quality: Optional[Dict[str, Any]],
    execution_transaction: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    checks = checks or {}
    validator_result = validator_result or {}
    cognitive_quality = cognitive_quality or {}
    execution_transaction = execution_transaction or {}

    pass_flag = bool(validator_result.get("pass"))
    reasons: List[str] = []
    if checks.get("contradiction_detected"):
        reasons.append("contradiction_detected")
    if checks.get("overclaim_detected"):
        reasons.append("overclaim_detected")
    if int(checks.get("missing_constraints_count", 0)) > 0:
        reasons.append("missing_constraints")
    if checks.get("shallow_confidence_risk"):
        reasons.append("shallow_confidence_risk")
    if execution_transaction.get("status") != "completed":
        reasons.append("execution_transaction_incomplete")

    validator_confidence = (
        0.45
        + (0.22 if pass_flag else 0.0)
        + (0.12 if not checks.get("overclaim_detected") else -0.08)
        + (0.08 if not checks.get("contradiction_detected") else -0.08)
        + (0.08 if int(checks.get("missing_constraints_count", 0)) == 0 else -0.06)
        + (0.08 * float(cognitive_quality.get("consistency", 0.0)))
    )
    validator_confidence = max(0.0, min(1.0, validator_confidence))

    return {
        "pass": pass_flag,
        "confidence": round(validator_confidence, 3),
        "confidence_band": _confidence_band(validator_confidence),
        "checks": {
            "contradiction_detected": bool(checks.get("contradiction_detected", False)),
            "overclaim_detected": bool(checks.get("overclaim_detected", False)),
            "required_fields_ok": bool(checks.get("required_fields_ok", False)) if checks else None,
            "missing_constraints_count": int(checks.get("missing_constraints_count", 0)),
            "missing_constraints": list(checks.get("missing_constraints", []) or []),
            "has_structure": bool(checks.get("has_structure", False)) if checks else None,
            "too_short": bool(checks.get("too_short", False)) if checks else None,
            "shallow_confidence_risk": bool(checks.get("shallow_confidence_risk", False)),
            "validation_source": checks.get("validation_source") if checks else None,
        },
        "reason_codes": reasons,
        "transaction_complete": execution_transaction.get("status") == "completed",
    }


def build_memory_commit_decision(
    *,
    query: str,
    response: str,
    risk_flags: List[str],
    validator_summary: Dict[str, Any],
    world_grounding: Optional[Dict[str, Any]],
    durable_store_result: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    world_grounding = world_grounding or {}
    reasons: List[str] = []
    eligible = True
    review_required = bool(set(risk_flags or []) & HIGH_RISK_FLAGS)

    if not (query or "").strip() or not (response or "").strip():
        eligible = False
        reasons.append("empty_content")
    if not bool(validator_summary.get("pass")):
        eligible = False
        reasons.append("validator_not_passed")
    if bool((validator_summary.get("checks") or {}).get("overclaim_detected")):
        eligible = False
        reasons.append("overclaim_detected")
    if bool((validator_summary.get("checks") or {}).get("contradiction_detected")):
        eligible = False
        reasons.append("contradiction_detected")
    if review_required:
        eligible = False
        reasons.append("high_risk_requires_review")
    if bool(world_grounding.get("required", False)) and int(world_grounding.get("evidence_count", 0)) <= 0:
        eligible = False
        reasons.append("missing_world_evidence")

    write_status = None
    stored_id = None
    if isinstance(durable_store_result, dict):
        write_status = durable_store_result.get("status") or durable_store_result.get("write_status")
        stored_id = durable_store_result.get("id")
        if write_status not in {None, "stored", "stored_below_threshold"}:
            eligible = False
            reasons.append("durable_write_failed")

    return {
        "eligible": eligible,
        "reasons": reasons,
        "review_required": review_required,
        "write_status": write_status,
        "stored_id": stored_id,
    }


def build_orchestration_assurance(
    *,
    query: str,
    routing_method: str,
    risk_flags: List[str],
    checks: Optional[Dict[str, Any]],
    validator_result: Optional[Dict[str, Any]],
    cognitive_quality: Optional[Dict[str, Any]],
    world_grounding: Optional[Dict[str, Any]],
    execution_transaction: Optional[Dict[str, Any]],
    route_health: Optional[Dict[str, Any]],
    fastlane: Optional[Dict[str, Any]],
    policy_hint: Optional[Dict[str, Any]],
    tool_path_observability: Optional[Dict[str, Any]],
    routing_markers: Optional[Dict[str, Any]],
    latency_budget: Optional[Dict[str, Any]],
    recommended_levels: Optional[List[Dict[str, Any]]] = None,
    quality_score: float = 0.0,
) -> Dict[str, Any]:
    world_grounding = world_grounding or {}
    execution_transaction = execution_transaction or {}
    route_health = route_health or {}
    policy_hint = policy_hint or {}
    tool_path_observability = tool_path_observability or {}
    routing_markers = routing_markers or {}
    latency_budget = latency_budget or {}
    recommended_levels = recommended_levels or []

    validator_summary = build_validator_summary(
        checks=checks,
        validator_result=validator_result,
        cognitive_quality=cognitive_quality,
        execution_transaction=execution_transaction,
    )

    route_reasons: List[str] = []
    route_degraded = False
    dependencies = (route_health.get("dependencies") if isinstance(route_health.get("dependencies"), dict) else route_health) or {}
    if isinstance(dependencies, dict):
        for name, dep in dependencies.items():
            if isinstance(dep, dict) and str(dep.get("state", "closed")) != "closed":
                route_degraded = True
                route_reasons.append(f"dependency_{name}_{dep.get('state')}")

    reasons: List[str] = []
    verdict = "pass"
    release_decision = "release"
    memory_decision = build_memory_commit_decision(
        query=query,
        response=str((fastlane or {}).get("answer") or ""),
        risk_flags=risk_flags,
        validator_summary=validator_summary,
        world_grounding=world_grounding,
    )

    if execution_transaction.get("status") != "completed":
        verdict = "block"
        release_decision = "block"
        reasons.append("execution_transaction_incomplete")
    if bool((checks or {}).get("overclaim_detected")) or bool((checks or {}).get("contradiction_detected")):
        verdict = "degraded" if verdict != "block" else verdict
        release_decision = "repair" if release_decision != "block" else release_decision
        reasons.extend([x for x in ["overclaim_detected" if bool((checks or {}).get("overclaim_detected")) else None, "contradiction_detected" if bool((checks or {}).get("contradiction_detected")) else None] if x])
    if int((checks or {}).get("missing_constraints_count", 0)) > 0:
        if verdict == "pass":
            verdict = "warn"
        release_decision = "downgrade" if release_decision == "release" else release_decision
        reasons.append("missing_constraints")
    if bool((fastlane or {}).get("escalated")):
        if verdict == "pass":
            verdict = "warn"
        release_decision = "repair" if release_decision == "release" else release_decision
        reasons.append("fastlane_escalated")
    if bool(world_grounding.get("required", False)) and int(world_grounding.get("evidence_count", 0)) <= 0:
        verdict = "degraded" if verdict != "block" else verdict
        release_decision = "downgrade" if release_decision == "release" else release_decision
        reasons.append("world_grounding_without_evidence")
    if bool(world_grounding.get("degraded", False)):
        if verdict == "pass":
            verdict = "warn"
        reasons.append("world_grounding_degraded")
    if route_degraded:
        if verdict == "pass":
            verdict = "warn"
        reasons.extend(route_reasons)
    if set(risk_flags or []) & HIGH_RISK_FLAGS and not bool(validator_summary.get("pass")):
        verdict = "block"
        release_decision = "block"
        reasons.append("high_risk_without_validator_pass")
    if verdict == "pass" and float(quality_score or 0.0) < 0.62:
        verdict = "warn"
        reasons.append("low_quality_score")

    observed_evidence = []
    if bool(tool_path_observability.get("attempted")):
        observed_evidence.extend(list(tool_path_observability.get("steps", []) or []))
    if bool(world_grounding.get("required", False)):
        observed_evidence.append("world_grounding")
    if int(world_grounding.get("evidence_count", 0)) > 0:
        observed_evidence.append("grounded_evidence")
    if recommended_levels:
        observed_evidence.append("level_routing")

    return {
        "version": ASSURANCE_VERSION,
        "verdict": verdict,
        "release_decision": release_decision,
        "reason_codes": sorted(set(reasons)),
        "summary": {
            "risk_tier": _risk_tier(risk_flags),
            "reversibility": _reversibility_tier(risk_flags, routing_method, query),
            "confidence_band": _confidence_band(float(quality_score or 0.0)),
            "quality_score": round(float(quality_score or 0.0), 3),
            "routing_method": routing_method,
            "policy_stage": str(policy_hint.get("stage", "shadow")),
            "policy_recommended": policy_hint.get("recommended_policy"),
        },
        "validators": validator_summary,
        "route_health": route_health,
        "memory_commit": memory_decision,
        "evidence": {
            "observed_sources": observed_evidence,
            "world_grounding_required": bool(world_grounding.get("required", False)),
            "world_grounding_mode": world_grounding.get("mode", "not_required"),
            "world_evidence_count": int(world_grounding.get("evidence_count", 0)),
        },
        "fallbacks": {
            "l9_fallback": any(item.get("method") == "l9_fallback" for item in recommended_levels),
            "qa_fastlane_escalated": bool((fastlane or {}).get("escalated")),
            "world_grounding_degraded": bool(world_grounding.get("degraded", False)),
            "route_health_degraded": route_degraded,
        },
        "latency_budget": {
            "archetype": latency_budget.get("archetype"),
            "cheap_route": latency_budget.get("cheap_route"),
            "max_latency_ms": latency_budget.get("max_latency_ms"),
        },
        "receipt": {
            "tx_id": execution_transaction.get("tx_id"),
            "tx_status": execution_transaction.get("status"),
            "journal_path": execution_transaction.get("journal_path"),
            "generated_at": _now_iso(),
        },
        "routing_markers": {
            "world_grounding_required": bool(routing_markers.get("world_grounding_required", False)),
            "l9_triggered": bool(routing_markers.get("l9_triggered", False)),
            "brainstorm_triggered": bool(routing_markers.get("brainstorm_triggered", False)),
            "research_triggered": bool(routing_markers.get("research_triggered", False)),
        },
    }
