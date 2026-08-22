from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
from typing import Any, Dict, List, Optional

from cortex_server.modules.reasoning_failures import (
    FAILURE_APPROVAL_REQUIRED,
    FAILURE_DEPENDENCY_BLOCKED,
    FAILURE_HALT_CANCELLED,
    FAILURE_POLICY_CONTRACTS,
    FAILURE_POST_VERIFICATION,
    FAILURE_PRE_VERIFICATION,
    FAILURE_TIMEOUT,
    FAILURE_DEADLINE,
    normalize_failure_code,
)


INCIDENT_GENERIC_FAILURE = "generic_failure"
INCIDENT_DEPENDENCY_BLOCKED = "dependency_blocked"
INCIDENT_CANCELLED = "cancelled"
INCIDENT_OPERATOR_CANCELLED = "operator_cancelled"
INCIDENT_DEADLINE_EXCEEDED = "deadline_exceeded"
INCIDENT_APPROVAL_BLOCKED = "approval_blocked"
INCIDENT_VERIFICATION_FAILED = "verification_failed"
INCIDENT_TIMEOUT = "timeout"
INCIDENT_HALT_CANCELLED = "halt_cancelled"
INCIDENT_EXECUTION_FAILED = "execution_failed"

SEVERITY_LOW = "low"
SEVERITY_MEDIUM = "medium"
SEVERITY_HIGH = "high"

POLICY_PATCHABLE_SETTINGS = {
    "execution_mode",
    "max_parallelism",
    "verification_mode",
    "same_tick_drain",
    "strict_requires_contracts",
    "enforce_policy",
    "step_timeout_seconds",
    "retry_max_attempts",
    "retry_backoff_seconds",
    "retry_on_timeout",
    "retry_on_status_codes",
    "retry_on_error_types",
    "workflow_deadline_seconds",
}

POLICY_AUTO_APPLY_SAFE_SETTINGS = {
    "step_timeout_seconds",
    "retry_max_attempts",
    "retry_backoff_seconds",
    "retry_on_timeout",
    "retry_on_status_codes",
    "retry_on_error_types",
    "workflow_deadline_seconds",
}

POLICY_CONFIRMATION_REQUIRED_SETTINGS = POLICY_PATCHABLE_SETTINGS - POLICY_AUTO_APPLY_SAFE_SETTINGS

POLICY_EXECUTION_MODES = {"sequential", "parallel"}
POLICY_VERIFICATION_MODES = {"basic", "strict"}


def _coerce_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in {0, 1}:
        return bool(value)
    text = str(value).strip().lower()
    if text in {"true", "1", "yes", "on"}:
        return True
    if text in {"false", "0", "no", "off"}:
        return False
    return None



def normalize_policy_setting_value(setting: str, value: Any) -> Dict[str, Any]:
    key = str(setting or "").strip()
    if key not in POLICY_PATCHABLE_SETTINGS:
        return {"ok": False, "reason": "unsupported_setting", "value": value}
    if value is None:
        return {"ok": True, "value": None}
    try:
        if key == "execution_mode":
            normalized = str(value).strip().lower()
            if normalized not in POLICY_EXECUTION_MODES:
                raise ValueError("expected one of sequential|parallel")
            return {"ok": True, "value": normalized}
        if key == "verification_mode":
            normalized = str(value).strip().lower()
            if normalized not in POLICY_VERIFICATION_MODES:
                raise ValueError("expected one of basic|strict")
            return {"ok": True, "value": normalized}
        if key in {"same_tick_drain", "strict_requires_contracts", "enforce_policy", "retry_on_timeout"}:
            normalized = _coerce_bool(value)
            if normalized is None:
                raise ValueError("expected boolean")
            return {"ok": True, "value": normalized}
        if key in {"max_parallelism", "retry_max_attempts"}:
            normalized = int(value)
            if normalized < 1 or normalized > 64:
                raise ValueError("expected integer between 1 and 64")
            return {"ok": True, "value": normalized}
        if key in {"step_timeout_seconds", "retry_backoff_seconds", "workflow_deadline_seconds"}:
            normalized = float(value)
            if normalized < 0:
                raise ValueError("expected non-negative number")
            if key != "retry_backoff_seconds" and normalized == 0:
                raise ValueError("expected positive number")
            return {"ok": True, "value": round(normalized, 3)}
        if key == "retry_on_status_codes":
            if not isinstance(value, (list, tuple)):
                raise ValueError("expected list of HTTP status codes")
            codes = sorted({int(x) for x in value})
            if any(code < 100 or code > 599 for code in codes):
                raise ValueError("status codes must be between 100 and 599")
            return {"ok": True, "value": codes}
        if key == "retry_on_error_types":
            if not isinstance(value, (list, tuple)):
                raise ValueError("expected list of error type strings")
            normalized = sorted({str(x).strip().lower() for x in value if str(x).strip()})
            return {"ok": True, "value": normalized}
    except Exception as exc:
        return {"ok": False, "reason": "invalid_value", "detail": str(exc), "value": value}
    return {"ok": False, "reason": "unsupported_setting", "value": value}



def policy_setting_conflicts(*, settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    current = {str(k): v for k, v in dict(settings or {}).items() if v is not None}
    conflicts: List[Dict[str, Any]] = []

    execution_mode = str(current.get("execution_mode") or "").strip().lower()
    max_parallelism = current.get("max_parallelism")
    try:
        max_parallelism_value = int(max_parallelism) if max_parallelism is not None else None
    except Exception:
        max_parallelism_value = None
    if max_parallelism_value is not None and max_parallelism_value > 1 and execution_mode and execution_mode != "parallel":
        conflicts.append(
            {
                "code": "execution_parallelism_mismatch",
                "settings": ["execution_mode", "max_parallelism"],
                "summary": "max_parallelism > 1 requires execution_mode=parallel",
            }
        )

    verification_mode = str(current.get("verification_mode") or "").strip().lower()
    if bool(current.get("strict_requires_contracts")) and verification_mode and verification_mode != "strict":
        conflicts.append(
            {
                "code": "verification_contracts_mismatch",
                "settings": ["strict_requires_contracts", "verification_mode"],
                "summary": "strict_requires_contracts=true expects verification_mode=strict",
            }
        )

    return conflicts



def classify_incident(*, node_id: str, status: Optional[str], error: Optional[str], error_code: Optional[str] = None, blocked_by: Any = None, attempts: Optional[int] = None, success: Optional[bool] = None) -> Dict[str, Any]:
    status_str = str(status or "unknown")
    error_str = str(error or "")
    code = normalize_failure_code(error_code, error=error, success=success)
    category = INCIDENT_GENERIC_FAILURE
    severity = SEVERITY_MEDIUM
    if status_str == "blocked":
        category = INCIDENT_DEPENDENCY_BLOCKED
    elif status_str == "cancelled":
        category = INCIDENT_CANCELLED
        severity = SEVERITY_LOW
    if code == FAILURE_DEADLINE:
        category = INCIDENT_DEADLINE_EXCEEDED
        severity = SEVERITY_HIGH
    elif code == FAILURE_APPROVAL_REQUIRED:
        category = INCIDENT_APPROVAL_BLOCKED
        severity = SEVERITY_HIGH
    elif code in {FAILURE_PRE_VERIFICATION, FAILURE_POST_VERIFICATION, FAILURE_POLICY_CONTRACTS}:
        category = INCIDENT_VERIFICATION_FAILED
        severity = SEVERITY_HIGH
    elif code == FAILURE_TIMEOUT:
        category = INCIDENT_TIMEOUT
        severity = SEVERITY_HIGH
    elif code == FAILURE_HALT_CANCELLED:
        category = INCIDENT_HALT_CANCELLED
        severity = SEVERITY_MEDIUM
    elif code == FAILURE_DEPENDENCY_BLOCKED:
        category = INCIDENT_DEPENDENCY_BLOCKED
        severity = SEVERITY_MEDIUM
    elif status_str == "failed" or success is False:
        category = INCIDENT_EXECUTION_FAILED
        severity = SEVERITY_HIGH
    if "operator" in error_str.lower() and category == INCIDENT_CANCELLED:
        category = INCIDENT_OPERATOR_CANCELLED
    summary = f"{node_id}: {category}"
    if error_str:
        summary += f" ({error_str})"
    return {
        "node_id": node_id,
        "status": status_str,
        "category": category,
        "severity": severity,
        "error": error_str or None,
        "error_code": code or None,
        "attempts": int(attempts or 0),
        "blocked_by": blocked_by,
        "summary": summary,
    }



def incident_report(*, process: Dict[str, Any], execution_trace: List[Dict[str, Any]], incidents: List[Dict[str, Any]], policy_outcome_evaluation: List[Dict[str, Any]]) -> Dict[str, Any]:
    trace_by_node = {str(row.get("node_id") or ""): row for row in (execution_trace or []) if str(row.get("node_id") or "").strip()}
    detailed: List[Dict[str, Any]] = []
    for item in incidents or []:
        node_id = str(item.get("node_id") or "")
        trace = trace_by_node.get(node_id, {})
        detailed.append(
            classify_incident(
                node_id=node_id,
                status=item.get("status") or trace.get("status"),
                error=item.get("last_error") or trace.get("error"),
                error_code=item.get("error_code") or trace.get("error_code"),
                blocked_by=item.get("blocked_by"),
                attempts=trace.get("attempts"),
                success=trace.get("success"),
            )
        )
    detailed.sort(key=lambda row: (0 if row.get("severity") == "high" else 1, str(row.get("node_id") or "")))
    root = detailed[0] if detailed else None
    mismatches = [row for row in (policy_outcome_evaluation or []) if str(row.get("outcome") or "") not in {"match", "observed"}]
    return {
        "incidents": detailed,
        "incident_count": len(detailed),
        "high_severity_count": sum(1 for row in detailed if row.get("severity") == "high"),
        "root_cause": root,
        "policy_mismatches": mismatches,
    }



def workflow_postmortem(*, process: Dict[str, Any], execution_trace: List[Dict[str, Any]], incident_report: Dict[str, Any], policy_outcome_evaluation: List[Dict[str, Any]], epistemic_drift_summary: Dict[str, Any]) -> Dict[str, Any]:
    root = incident_report.get("root_cause") if isinstance(incident_report, dict) else None
    status = str(process.get("status") or "unknown")
    successful = sum(1 for row in (execution_trace or []) if row.get("success") is True)
    failed = sum(1 for row in (execution_trace or []) if row.get("success") is False)
    title = f"Process {process.get('process_id')} ended {status}"
    summary_bits = [f"{successful} successful steps", f"{failed} failed steps"]
    if root:
        summary_bits.append(f"root cause: {root.get('summary')}")
    if int((epistemic_drift_summary or {}).get("changed_step_count", 0) or 0) > 0:
        summary_bits.append(f"epistemic drift on {epistemic_drift_summary.get('changed_step_count')} step(s)")
    narrative = "; ".join(summary_bits)
    recommendations: List[str] = []
    category = str((root or {}).get("category") or "")
    if category == "approval_blocked":
        recommendations.append("Provide scoped approval grants before rerun.")
    elif category == "verification_failed":
        recommendations.append("Review verification contracts or success criteria before rerun.")
    elif category == "timeout":
        recommendations.append("Increase timeout or allow retry on timeout with backoff.")
    elif category == "dependency_blocked":
        recommendations.append("Inspect upstream failed/blocked nodes and rerun after clearing dependency issues.")
    elif category == "execution_failed":
        recommendations.append("Inspect node error details and consider retry/compensation policy adjustments.")
    if not recommendations:
        recommendations.append("Inspect execution trace and policy outcome evaluation before rerun.")
    return {
        "title": title,
        "summary": narrative,
        "root_cause": root,
        "recommendations": recommendations,
        "policy_outcome_evaluation": policy_outcome_evaluation,
        "epistemic_drift_summary": epistemic_drift_summary,
    }



def rerun_recommendations(*, incident_report: Dict[str, Any], postmortem: Dict[str, Any], process: Dict[str, Any]) -> List[Dict[str, Any]]:
    root = incident_report.get("root_cause") if isinstance(incident_report, dict) else None
    category = str((root or {}).get("category") or "")
    recommendations: List[Dict[str, Any]] = []
    if category == "approval_blocked":
        recommendations.append({"action": "rerun_with_approval", "reason": "Approval gate blocked the prior run", "parameters": {"requires_approval_grants": True}})
    elif category == "verification_failed":
        recommendations.append({"action": "review_contracts_then_rerun", "reason": "Verification failed before completion", "parameters": {"review_contracts": True}})
    elif category == "timeout":
        recommendations.append({"action": "rerun_with_higher_timeout", "reason": "Timeout was root cause", "parameters": {"increase_timeout": True, "enable_retry_on_timeout": True}})
    elif category == "dependency_blocked":
        recommendations.append({"action": "rerun_after_upstream_fix", "reason": "A dependency was blocked or failed", "parameters": {"inspect_dependencies": True}})
    elif category == "execution_failed":
        recommendations.append({"action": "rerun_with_retry_or_compensation", "reason": "Execution failure suggests transient or side-effect-sensitive behavior", "parameters": {"enable_retry": True, "consider_compensation": True}})
    if not recommendations:
        recommendations.append({"action": "inspect_then_rerun", "reason": "No strong rerun heuristic matched", "parameters": {"inspect_trace": True}})
    return recommendations



def policy_adaptation_hooks(*, policy: Dict[str, Any], incident_report: Dict[str, Any], policy_outcome_evaluation: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    hooks: List[Dict[str, Any]] = []
    root = incident_report.get("root_cause") if isinstance(incident_report, dict) else None
    category = str((root or {}).get("category") or "")
    settings = policy.get("settings") if isinstance(policy.get("settings"), dict) else {}
    if category == "timeout":
        current_timeout = settings.get("step_timeout_seconds")
        current_backoff = settings.get("retry_backoff_seconds")
        current_attempts = settings.get("retry_max_attempts")
        try:
            timeout_value = float(current_timeout) if current_timeout is not None else None
        except Exception:
            timeout_value = None
        try:
            backoff_value = float(current_backoff) if current_backoff is not None else 0.0
        except Exception:
            backoff_value = 0.0
        try:
            attempts_value = int(current_attempts) if current_attempts is not None else 1
        except Exception:
            attempts_value = 1
        hooks.append(
            {
                "target": "scheduler",
                "suggestion": "increase_timeout_or_retry_backoff",
                "reason": "Observed timeout incident",
                "proposed_settings": {
                    "step_timeout_seconds": round(max(timeout_value * 2 if timeout_value else 30.0, 1.0), 3),
                    "retry_on_timeout": True,
                    "retry_max_attempts": max(2, attempts_value),
                    "retry_backoff_seconds": max(0.5, backoff_value),
                },
            }
        )
    if category == "approval_blocked":
        hooks.append({"target": "verification", "suggestion": "preflight_approval_check", "reason": "Observed approval-blocked incident", "proposed_settings": {"strict_requires_contracts": True}})
    if category == "verification_failed":
        hooks.append({"target": "verification", "suggestion": "tighten_contract_authoring", "reason": "Observed verification failure", "proposed_settings": {"verification_mode": "strict"}})
    if category == "dependency_blocked":
        hooks.append({"target": "routing", "suggestion": "surface_dependency_risk_earlier", "reason": "Dependency blockage suggests better preflight or ordering checks", "proposed_settings": {"execution_mode": settings.get("execution_mode")}})
    mismatches = [row for row in (policy_outcome_evaluation or []) if str(row.get("outcome") or "") not in {"match", "observed"}]
    for row in mismatches:
        hooks.append({"target": row.get("domain"), "suggestion": "review_policy_domain", "reason": row.get("operator_summary"), "proposed_settings": {}})
    return hooks



def _policy_recommendation_version(*, current_settings: Dict[str, Any], proposed_settings: Dict[str, Any], changes: List[Dict[str, Any]], conflicts: List[Dict[str, Any]], skipped: List[Dict[str, Any]]) -> str:
    payload = {
        "current_settings": current_settings,
        "proposed_settings": proposed_settings,
        "changes": changes,
        "conflicts": conflicts,
        "skipped": skipped,
    }
    digest = hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:12]
    return f"polrec_{digest}"



def policy_patch_preview(*, policy: Dict[str, Any], hooks: List[Dict[str, Any]]) -> Dict[str, Any]:
    policy = policy if isinstance(policy, dict) else {}
    settings = dict((policy.get("settings") or {})) if isinstance(policy.get("settings"), dict) else {}
    proposed = dict(settings)
    change_map: Dict[str, Dict[str, Any]] = {}
    skipped: List[Dict[str, Any]] = []

    for hook in hooks or []:
        if not isinstance(hook, dict):
            continue
        target = hook.get("target")
        suggestion = hook.get("suggestion")
        reason = hook.get("reason")
        for key, value in dict(hook.get("proposed_settings") or {}).items():
            if key not in POLICY_PATCHABLE_SETTINGS:
                skipped.append({"setting": key, "value": value, "target": target, "reason": reason, "suggestion": suggestion, "skipped": "unsupported_setting"})
                continue
            normalized = normalize_policy_setting_value(key, value)
            if not bool(normalized.get("ok")):
                skipped.append({"setting": key, "value": value, "target": target, "reason": reason, "suggestion": suggestion, "skipped": normalized.get("reason") or "invalid_value", "detail": normalized.get("detail")})
                continue
            value = normalized.get("value")
            before = settings.get(key)
            after = proposed.get(key)
            if value is None or after == value:
                continue
            proposed[key] = value
            existing = change_map.get(key)
            if not existing:
                existing = {
                    "setting": key,
                    "before": before,
                    "after": value,
                    "target": target,
                    "reason": reason,
                    "sources": [],
                }
                change_map[key] = existing
            else:
                existing["after"] = value
                if target:
                    existing["target"] = target
                if reason:
                    existing["reason"] = reason
            if suggestion or reason:
                existing["sources"].append({"suggestion": suggestion, "reason": reason, "target": target})

    changes = [change_map[key] for key in sorted(change_map)]
    metadata_overrides = {row["setting"]: row["after"] for row in changes}
    operations = [
        {
            "op": "replace" if row["setting"] in settings else "add",
            "path": f"/workflow/metadata/{row['setting']}",
            "setting": row["setting"],
            "value": row["after"],
            "target": row.get("target"),
            "reason": row.get("reason"),
        }
        for row in changes
    ]
    conflicts = policy_setting_conflicts(settings=proposed)
    invalid_items = [row for row in skipped if str(row.get("skipped") or "") == "invalid_value"]
    recommendation_version = _policy_recommendation_version(
        current_settings=settings,
        proposed_settings=proposed,
        changes=changes,
        conflicts=conflicts,
        skipped=skipped,
    )
    return {
        "current_settings": settings,
        "proposed_settings": proposed,
        "changes": changes,
        "change_count": len(changes),
        "metadata_overrides": metadata_overrides,
        "operations": operations,
        "apply_target": "workflow.metadata",
        "apply_mode": "merge",
        "rebuild_policy_required": bool(changes),
        "recommendation_version": recommendation_version,
        "supported_settings": sorted(POLICY_PATCHABLE_SETTINGS),
        "conflicts": conflicts,
        "conflict_count": len(conflicts),
        "invalid_setting_count": len(invalid_items),
        "valid": not conflicts and not invalid_items,
        "skipped": skipped,
    }



def apply_policy_patch_preview(*, workflow_metadata: Dict[str, Any], preview: Dict[str, Any]) -> Dict[str, Any]:
    metadata = dict(workflow_metadata or {})
    preview = preview if isinstance(preview, dict) else {}
    if str(preview.get("apply_target") or "") != "workflow.metadata":
        return {
            "applied": False,
            "applied_count": 0,
            "updated_metadata": metadata,
            "applied_settings": [],
            "skipped": [{"skipped": "unsupported_apply_target", "apply_target": preview.get("apply_target")}],
        }
    if str(preview.get("apply_mode") or "merge") != "merge":
        return {
            "applied": False,
            "applied_count": 0,
            "updated_metadata": metadata,
            "applied_settings": [],
            "skipped": [{"skipped": "unsupported_apply_mode", "apply_mode": preview.get("apply_mode")}],
        }

    overrides = dict(preview.get("metadata_overrides") or {})
    applied_settings: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = list(preview.get("skipped") or [])
    conflicts = [dict(row) for row in (preview.get("conflicts") or []) if isinstance(row, dict)]
    if conflicts:
        return {
            "applied": False,
            "applied_count": 0,
            "updated_metadata": metadata,
            "applied_settings": [],
            "rebuild_policy_required": False,
            "conflicts": conflicts,
            "skipped": skipped + [{"skipped": "conflict_detected", "conflicts": conflicts}],
        }
    updated = dict(metadata)
    for key, value in overrides.items():
        if key not in POLICY_PATCHABLE_SETTINGS:
            skipped.append({"setting": key, "value": value, "skipped": "unsupported_setting"})
            continue
        before = updated.get(key)
        if before == value and not (value is None and key in updated):
            continue
        if value is None:
            updated.pop(key, None)
        else:
            updated[key] = value
        applied_settings.append({"setting": key, "before": before, "after": value, "op": "remove" if value is None else ("replace" if before is not None else "add")})

    return {
        "applied": bool(applied_settings),
        "applied_count": len(applied_settings),
        "updated_metadata": updated,
        "applied_settings": applied_settings,
        "rebuild_policy_required": bool(preview.get("rebuild_policy_required", bool(applied_settings))),
        "skipped": skipped,
    }



def select_policy_patch_preview(*, preview: Dict[str, Any], include_settings: Optional[List[str]] = None, metadata_overrides: Optional[Dict[str, Any]] = None, allow_confirmation_required: bool = False) -> Dict[str, Any]:
    preview = preview if isinstance(preview, dict) else {}
    current_settings = dict(preview.get("current_settings") or {})
    supported_settings = sorted(POLICY_PATCHABLE_SETTINGS)
    selected = {str(x) for x in (include_settings or []) if str(x).strip()}
    filter_enabled = bool(selected)
    override_values = dict(metadata_overrides or {})
    source_changes = {
        str(row.get("setting") or ""): dict(row)
        for row in (preview.get("changes") or [])
        if isinstance(row, dict) and str(row.get("setting") or "").strip()
    }

    skipped: List[Dict[str, Any]] = list(preview.get("skipped") or [])
    change_map: Dict[str, Dict[str, Any]] = {}

    for key, row in source_changes.items():
        if filter_enabled and key not in selected:
            continue
        copied = dict(row)
        copied["sources"] = [dict(src) for src in (row.get("sources") or []) if isinstance(src, dict)]
        change_map[key] = copied

    if filter_enabled:
        for key in sorted(selected):
            if key not in POLICY_PATCHABLE_SETTINGS:
                skipped.append({"setting": key, "skipped": "unsupported_setting_selection"})
            elif key not in source_changes and key not in override_values:
                skipped.append({"setting": key, "skipped": "not_present_in_preview"})

    for key, value in override_values.items():
        key = str(key)
        if key not in POLICY_PATCHABLE_SETTINGS:
            skipped.append({"setting": key, "value": value, "skipped": "unsupported_setting"})
            continue
        if filter_enabled and key not in selected:
            skipped.append({"setting": key, "value": value, "skipped": "not_selected"})
            continue
        normalized = normalize_policy_setting_value(key, value) if value is not None else {"ok": True, "value": None}
        if not bool(normalized.get("ok")):
            skipped.append({"setting": key, "value": value, "skipped": normalized.get("reason") or "invalid_value", "detail": normalized.get("detail")})
            continue
        value = normalized.get("value")
        before = current_settings.get(key)
        if before == value and not (value is None and key in current_settings):
            continue
        existing = change_map.get(key)
        if not existing:
            existing = {
                "setting": key,
                "before": before,
                "after": value,
                "target": "operator",
                "reason": "operator_override",
                "sources": [],
            }
            change_map[key] = existing
        else:
            existing["after"] = value
            existing["target"] = "operator"
            existing["reason"] = "operator_override"
        existing.setdefault("sources", []).append({"suggestion": "operator_override", "reason": "operator_override", "target": "operator"})

    filtered_change_map: Dict[str, Dict[str, Any]] = {}
    for key, row in change_map.items():
        if key in POLICY_CONFIRMATION_REQUIRED_SETTINGS and not allow_confirmation_required:
            skipped.append({"setting": key, "value": row.get("after"), "skipped": "confirmation_required"})
            continue
        filtered_change_map[key] = row

    changes = [filtered_change_map[key] for key in sorted(filtered_change_map)]
    metadata_overrides_out = {row["setting"]: row["after"] for row in changes}
    proposed_settings = dict(current_settings)
    for key, value in metadata_overrides_out.items():
        if value is None:
            proposed_settings.pop(key, None)
        else:
            proposed_settings[key] = value
    operations = [
        {
            "op": ("remove" if row.get("after") is None else ("replace" if row["setting"] in current_settings else "add")),
            "path": f"/workflow/metadata/{row['setting']}",
            "setting": row["setting"],
            "value": row.get("after"),
            "target": row.get("target"),
            "reason": row.get("reason"),
        }
        for row in changes
    ]
    conflicts = policy_setting_conflicts(settings=proposed_settings)
    invalid_items = [row for row in skipped if str(row.get("skipped") or "") == "invalid_value"]
    recommendation_version = _policy_recommendation_version(
        current_settings=current_settings,
        proposed_settings=proposed_settings,
        changes=changes,
        conflicts=conflicts,
        skipped=skipped,
    )
    return {
        "current_settings": current_settings,
        "proposed_settings": proposed_settings,
        "changes": changes,
        "change_count": len(changes),
        "metadata_overrides": metadata_overrides_out,
        "operations": operations,
        "apply_target": str(preview.get("apply_target") or "workflow.metadata"),
        "apply_mode": str(preview.get("apply_mode") or "merge"),
        "rebuild_policy_required": bool(changes),
        "recommendation_version": recommendation_version,
        "supported_settings": supported_settings,
        "auto_apply_safe_settings": sorted(POLICY_AUTO_APPLY_SAFE_SETTINGS),
        "confirmation_required_settings": sorted(POLICY_CONFIRMATION_REQUIRED_SETTINGS),
        "conflicts": conflicts,
        "conflict_count": len(conflicts),
        "invalid_setting_count": len(invalid_items),
        "valid": not conflicts and not invalid_items,
        "skipped": skipped,
    }



def workflow_self_review(*, process: Dict[str, Any], policy: Dict[str, Any], execution_trace: List[Dict[str, Any]], step_influences: List[Dict[str, Any]], belief_summary: Dict[str, Any], incident_report: Dict[str, Any], postmortem: Dict[str, Any]) -> Dict[str, Any]:
    total_steps = len(execution_trace or [])
    successful_steps = sum(1 for row in (execution_trace or []) if row.get("success") is True)
    failed_steps = sum(1 for row in (execution_trace or []) if row.get("success") is False)
    drift_changed = sum(1 for row in (step_influences or []) if bool(((row.get("belief_delta") or {}).get("changed"))))
    root = incident_report.get("root_cause") if isinstance(incident_report, dict) else None
    score = 1.0
    if total_steps:
        score -= failed_steps / max(1, total_steps)
    score -= min(0.4, drift_changed * 0.1)
    if root and str(root.get("severity") or "") == "high":
        score -= 0.2
    score = max(0.0, round(score, 3))
    strengths: List[str] = []
    weaknesses: List[str] = []
    if successful_steps:
        strengths.append(f"Completed {successful_steps}/{total_steps} steps")
    if int((belief_summary or {}).get("count", 0) or 0) > 0:
        strengths.append(f"Produced/used {belief_summary.get('count')} beliefs")
    if failed_steps:
        weaknesses.append(f"{failed_steps} step(s) failed")
    if drift_changed:
        weaknesses.append(f"Belief context drifted on {drift_changed} step(s)")
    if root:
        weaknesses.append(f"Root cause: {root.get('summary')}")
    return {"score": score, "strengths": strengths, "weaknesses": weaknesses, "root_cause": root, "summary": (postmortem or {}).get("summary"), "next_actions": (postmortem or {}).get("recommendations") or []}



def parse_dt_maybe(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None



def filter_processes_by_hours(processes: List[Dict[str, Any]], hours: Optional[float]) -> List[Dict[str, Any]]:
    if hours is None:
        return [row for row in (processes or []) if isinstance(row, dict)]
    try:
        window_hours = float(hours)
    except Exception:
        return [row for row in (processes or []) if isinstance(row, dict)]
    if window_hours <= 0:
        return [row for row in (processes or []) if isinstance(row, dict)]
    cutoff = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    out: List[Dict[str, Any]] = []
    for process in processes or []:
        if not isinstance(process, dict):
            continue
        created = parse_dt_maybe(process.get("created_at"))
        if created and created >= cutoff:
            out.append(process)
    return out



def incident_trends(*, processes: List[Dict[str, Any]], execution_trace_fn) -> Dict[str, Any]:
    categories: Dict[str, int] = {}
    statuses: Dict[str, int] = {}
    roots: Dict[str, int] = {}
    total = 0
    for process in processes or []:
        if not isinstance(process, dict):
            continue
        total += 1
        status = str(process.get("status") or "unknown")
        statuses[status] = statuses.get(status, 0) + 1
        trace = execution_trace_fn(process)
        incidents = []
        for node_id, row in (process.get("nodes") or {}).items():
            if isinstance(row, dict) and str(row.get("status") or "") in {"failed", "blocked", "cancelled"}:
                incidents.append({"node_id": node_id, "status": row.get("status"), "blocked_by": row.get("blocked_by"), "last_error": row.get("last_error"), "error_code": row.get("last_error_code")})
        report = incident_report(process=process, execution_trace=trace, incidents=incidents, policy_outcome_evaluation=[])
        root = report.get("root_cause") if isinstance(report, dict) else None
        if root:
            category = str(root.get("category") or "unknown")
            categories[category] = categories.get(category, 0) + 1
            roots[str(root.get("summary") or category)] = roots.get(str(root.get("summary") or category), 0) + 1
    return {"process_count": total, "by_status": statuses, "by_root_category": categories, "top_root_summaries": sorted(({"summary": k, "count": v} for k, v in roots.items()), key=lambda row: (-row["count"], row["summary"]))[:10]}



def _safe_rate(numerator: int, denominator: int) -> float:
    return round((numerator / denominator), 4) if denominator else 0.0



def _trend_direction(delta: float, *, improving_when_negative: bool = False) -> str:
    if abs(delta) < 0.0001:
        return "flat"
    if improving_when_negative:
        return "improving" if delta < 0 else "worsening"
    return "improving" if delta > 0 else "worsening"



def analytics_summary(*, processes: List[Dict[str, Any]], execution_trace_fn, hours: Optional[float] = None, bucket_hours: float = 6.0) -> Dict[str, Any]:
    filtered = filter_processes_by_hours(processes, hours)
    base = incident_trends(processes=filtered, execution_trace_fn=execution_trace_fn)
    try:
        bucket_hours_value = float(bucket_hours)
    except Exception:
        bucket_hours_value = 6.0
    if bucket_hours_value <= 0:
        bucket_hours_value = 6.0

    buckets: Dict[str, Dict[str, Any]] = {}
    retry_exhausted_count = 0
    timeout_process_count = 0
    approval_blocked_process_count = 0

    for process in filtered:
        if not isinstance(process, dict):
            continue
        created = parse_dt_maybe(process.get("created_at")) or datetime.now(timezone.utc)
        epoch_hours = int(created.timestamp() // int(bucket_hours_value * 3600))
        bucket_start = datetime.fromtimestamp(epoch_hours * int(bucket_hours_value * 3600), tz=timezone.utc)
        bucket_end = bucket_start + timedelta(hours=bucket_hours_value)
        bucket_key = bucket_start.isoformat()
        bucket = buckets.setdefault(
            bucket_key,
            {
                "start_at": bucket_start.isoformat(),
                "end_at": bucket_end.isoformat(),
                "process_count": 0,
                "by_status": {},
                "by_root_category": {},
                "timeout_process_count": 0,
                "approval_blocked_process_count": 0,
                "retry_exhausted_process_count": 0,
            },
        )
        bucket["process_count"] += 1
        status = str(process.get("status") or "unknown")
        bucket["by_status"][status] = bucket["by_status"].get(status, 0) + 1

        trace = execution_trace_fn(process)
        incidents = []
        nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}
        has_retry_exhausted = False
        for node_id, row in nodes.items():
            if not isinstance(row, dict):
                continue
            node_status = str(row.get("status") or "")
            if node_status in {"failed", "blocked", "cancelled"}:
                incidents.append({"node_id": node_id, "status": row.get("status"), "blocked_by": row.get("blocked_by"), "last_error": row.get("last_error"), "error_code": row.get("last_error_code")})
            try:
                attempts = int(row.get("attempts", 0) or 0)
                max_attempts = int(row.get("max_attempts", 1) or 1)
            except Exception:
                attempts = 0
                max_attempts = 1
            if node_status == "failed" and attempts >= max_attempts and max_attempts > 1:
                has_retry_exhausted = True
        report = incident_report(process=process, execution_trace=trace, incidents=incidents, policy_outcome_evaluation=[])
        root = report.get("root_cause") if isinstance(report, dict) else None
        category = str((root or {}).get("category") or "unknown")
        bucket["by_root_category"][category] = bucket["by_root_category"].get(category, 0) + 1
        if category == INCIDENT_TIMEOUT:
            timeout_process_count += 1
            bucket["timeout_process_count"] += 1
        if category == INCIDENT_APPROVAL_BLOCKED:
            approval_blocked_process_count += 1
            bucket["approval_blocked_process_count"] += 1
        if has_retry_exhausted:
            retry_exhausted_count += 1
            bucket["retry_exhausted_process_count"] += 1

    bucket_rows = [buckets[key] for key in sorted(buckets)]
    for bucket in bucket_rows:
        process_count = int(bucket.get("process_count", 0) or 0)
        completed = int((bucket.get("by_status") or {}).get("completed", 0) or 0)
        failed = int((bucket.get("by_status") or {}).get("failed", 0) or 0)
        cancelled = int((bucket.get("by_status") or {}).get("cancelled", 0) or 0)
        bucket["completed_count"] = completed
        bucket["failed_count"] = failed
        bucket["cancelled_count"] = cancelled
        bucket["success_rate"] = _safe_rate(completed, process_count)
        bucket["failure_rate"] = _safe_rate(failed, process_count)

    total = int(base.get("process_count", 0) or 0)
    completed_count = int((base.get("by_status") or {}).get("completed", 0) or 0)
    failed_count = int((base.get("by_status") or {}).get("failed", 0) or 0)
    cancelled_count = int((base.get("by_status") or {}).get("cancelled", 0) or 0)
    first_bucket = bucket_rows[0] if bucket_rows else None
    last_bucket = bucket_rows[-1] if bucket_rows else None
    success_rate = _safe_rate(completed_count, total)
    failure_rate = _safe_rate(failed_count, total)
    trend_summary = {
        "bucket_count": len(bucket_rows),
        "first_bucket_start_at": first_bucket.get("start_at") if isinstance(first_bucket, dict) else None,
        "last_bucket_start_at": last_bucket.get("start_at") if isinstance(last_bucket, dict) else None,
        "success_rate_delta": round(float((last_bucket or {}).get("success_rate", 0.0) or 0.0) - float((first_bucket or {}).get("success_rate", 0.0) or 0.0), 4) if first_bucket and last_bucket else 0.0,
        "failure_rate_delta": round(float((last_bucket or {}).get("failure_rate", 0.0) or 0.0) - float((first_bucket or {}).get("failure_rate", 0.0) or 0.0), 4) if first_bucket and last_bucket else 0.0,
        "timeout_delta": int((last_bucket or {}).get("timeout_process_count", 0) or 0) - int((first_bucket or {}).get("timeout_process_count", 0) or 0) if first_bucket and last_bucket else 0,
        "approval_blocked_delta": int((last_bucket or {}).get("approval_blocked_process_count", 0) or 0) - int((first_bucket or {}).get("approval_blocked_process_count", 0) or 0) if first_bucket and last_bucket else 0,
        "retry_exhausted_delta": int((last_bucket or {}).get("retry_exhausted_process_count", 0) or 0) - int((first_bucket or {}).get("retry_exhausted_process_count", 0) or 0) if first_bucket and last_bucket else 0,
    }
    trend_summary["success_rate_direction"] = _trend_direction(float(trend_summary["success_rate_delta"] or 0.0))
    trend_summary["failure_rate_direction"] = _trend_direction(float(trend_summary["failure_rate_delta"] or 0.0), improving_when_negative=True)
    trend_summary["timeout_direction"] = _trend_direction(float(trend_summary["timeout_delta"] or 0.0), improving_when_negative=True)
    trend_summary["operator_summary"] = f"trend: success={trend_summary['success_rate_direction']}, failure={trend_summary['failure_rate_direction']}, timeout={trend_summary['timeout_direction']}"

    root_category_dashboard = sorted(
        (
            {
                "category": category,
                "count": count,
                "share": _safe_rate(int(count or 0), total),
            }
            for category, count in (base.get("by_root_category") or {}).items()
        ),
        key=lambda row: (-row["count"], row["category"]),
    )[:10]
    return {
        "process_count": total,
        "window_hours": hours,
        "bucket_hours": bucket_hours_value,
        "by_status": base.get("by_status") or {},
        "by_root_category": base.get("by_root_category") or {},
        "top_root_summaries": base.get("top_root_summaries") or [],
        "root_category_dashboard": root_category_dashboard,
        "completed_count": completed_count,
        "failed_count": failed_count,
        "cancelled_count": cancelled_count,
        "success_rate": success_rate,
        "failure_rate": failure_rate,
        "timeout_process_count": timeout_process_count,
        "approval_blocked_process_count": approval_blocked_process_count,
        "retry_exhausted_process_count": retry_exhausted_count,
        "buckets": bucket_rows,
        "trend_summary": trend_summary,
        "operator_summary": f"analytics: {total} processes, success_rate={success_rate}, failure_rate={failure_rate}; {trend_summary['operator_summary']}",
    }



def analytics_report(*, processes: List[Dict[str, Any]], execution_trace_fn, hours: Optional[float] = None, bucket_hours: float = 6.0, title: Optional[str] = None) -> Dict[str, Any]:
    analytics = analytics_summary(
        processes=processes,
        execution_trace_fn=execution_trace_fn,
        hours=hours,
        bucket_hours=bucket_hours,
    )
    payload = {
        "window_hours": analytics.get("window_hours"),
        "bucket_hours": analytics.get("bucket_hours"),
        "process_count": analytics.get("process_count"),
        "by_status": analytics.get("by_status"),
        "by_root_category": analytics.get("by_root_category"),
        "trend_summary": analytics.get("trend_summary"),
        "root_category_dashboard": analytics.get("root_category_dashboard"),
    }
    digest = hashlib.sha1(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:12]
    highlights = [
        f"success_rate={analytics.get('success_rate', 0.0)}",
        f"failure_rate={analytics.get('failure_rate', 0.0)}",
        f"timeouts={analytics.get('timeout_process_count', 0)}",
        f"retry_exhausted={analytics.get('retry_exhausted_process_count', 0)}",
        str((analytics.get("trend_summary") or {}).get("operator_summary") or "trend: unavailable"),
    ]
    return {
        "report_id": f"analytics_{digest}",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "title": title or "runtime_analytics_snapshot",
        "kind": "runtime_analytics_report",
        "analytics": analytics,
        "highlights": highlights,
        "operator_summary": f"report analytics_{digest}: {analytics.get('operator_summary')}",
    }



def analytics_report_markdown(*, report: Dict[str, Any]) -> str:
    report = report if isinstance(report, dict) else {}
    analytics = report.get("analytics") if isinstance(report.get("analytics"), dict) else {}
    trend_summary = analytics.get("trend_summary") if isinstance(analytics.get("trend_summary"), dict) else {}
    highlights = [str(item) for item in (report.get("highlights") or []) if str(item).strip()]
    lines = [
        f"# {report.get('title') or 'Runtime analytics snapshot'}",
        "",
        f"- Report ID: {report.get('report_id') or 'unknown'}",
        f"- Generated at: {report.get('generated_at') or 'unknown'}",
        f"- Window hours: {analytics.get('window_hours')}",
        f"- Bucket hours: {analytics.get('bucket_hours')}",
        f"- Process count: {analytics.get('process_count', 0)}",
        f"- Success rate: {analytics.get('success_rate', 0.0)}",
        f"- Failure rate: {analytics.get('failure_rate', 0.0)}",
        f"- Timeout processes: {analytics.get('timeout_process_count', 0)}",
        f"- Approval blocked processes: {analytics.get('approval_blocked_process_count', 0)}",
        f"- Retry exhausted processes: {analytics.get('retry_exhausted_process_count', 0)}",
        "",
        "## Highlights",
    ]
    if highlights:
        lines.extend(f"- {item}" for item in highlights)
    else:
        lines.append("- No highlights")
    lines.extend(
        [
            "",
            "## Trend summary",
            f"- Buckets: {trend_summary.get('bucket_count', 0)}",
            f"- Success direction: {trend_summary.get('success_rate_direction') or 'flat'}",
            f"- Failure direction: {trend_summary.get('failure_rate_direction') or 'flat'}",
            f"- Timeout direction: {trend_summary.get('timeout_direction') or 'flat'}",
            f"- Operator summary: {trend_summary.get('operator_summary') or 'trend: unavailable'}",
        ]
    )
    return "\n".join(lines)



def analytics_comparison(*, processes: List[Dict[str, Any]], execution_trace_fn, hours: float = 24.0, bucket_hours: float = 6.0) -> Dict[str, Any]:
    try:
        window_hours = float(hours)
    except Exception:
        window_hours = 24.0
    if window_hours <= 0:
        window_hours = 24.0
    now = datetime.now(timezone.utc)
    current_cutoff = now - timedelta(hours=window_hours)
    previous_cutoff = now - timedelta(hours=window_hours * 2)

    current: List[Dict[str, Any]] = []
    previous: List[Dict[str, Any]] = []
    for process in processes or []:
        if not isinstance(process, dict):
            continue
        created = parse_dt_maybe(process.get("created_at"))
        if created is None:
            continue
        if created >= current_cutoff:
            current.append(process)
        elif created >= previous_cutoff:
            previous.append(process)

    current_summary = analytics_summary(processes=current, execution_trace_fn=execution_trace_fn, hours=None, bucket_hours=bucket_hours)
    previous_summary = analytics_summary(processes=previous, execution_trace_fn=execution_trace_fn, hours=None, bucket_hours=bucket_hours)

    deltas = {
        "process_count_delta": int(current_summary.get("process_count", 0) or 0) - int(previous_summary.get("process_count", 0) or 0),
        "success_rate_delta": round(float(current_summary.get("success_rate", 0.0) or 0.0) - float(previous_summary.get("success_rate", 0.0) or 0.0), 4),
        "failure_rate_delta": round(float(current_summary.get("failure_rate", 0.0) or 0.0) - float(previous_summary.get("failure_rate", 0.0) or 0.0), 4),
        "timeout_process_count_delta": int(current_summary.get("timeout_process_count", 0) or 0) - int(previous_summary.get("timeout_process_count", 0) or 0),
        "approval_blocked_process_count_delta": int(current_summary.get("approval_blocked_process_count", 0) or 0) - int(previous_summary.get("approval_blocked_process_count", 0) or 0),
        "retry_exhausted_process_count_delta": int(current_summary.get("retry_exhausted_process_count", 0) or 0) - int(previous_summary.get("retry_exhausted_process_count", 0) or 0),
    }
    directions = {
        "success_rate_direction": _trend_direction(float(deltas["success_rate_delta"] or 0.0)),
        "failure_rate_direction": _trend_direction(float(deltas["failure_rate_delta"] or 0.0), improving_when_negative=True),
        "timeout_direction": _trend_direction(float(deltas["timeout_process_count_delta"] or 0.0), improving_when_negative=True),
        "approval_blocked_direction": _trend_direction(float(deltas["approval_blocked_process_count_delta"] or 0.0), improving_when_negative=True),
        "retry_exhausted_direction": _trend_direction(float(deltas["retry_exhausted_process_count_delta"] or 0.0), improving_when_negative=True),
    }
    return {
        "window_hours": window_hours,
        "bucket_hours": bucket_hours,
        "current": current_summary,
        "previous": previous_summary,
        "deltas": deltas,
        "directions": directions,
        "operator_summary": f"comparison: success={directions['success_rate_direction']}, failure={directions['failure_rate_direction']}, timeout={directions['timeout_direction']}",
    }



def _unique_strings(values: List[Any]) -> List[str]:
    seen = set()
    out: List[str] = []
    for value in values or []:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out



def process_trace_surface(*, process: Dict[str, Any], events: List[Dict[str, Any]]) -> Dict[str, Any]:
    process = process if isinstance(process, dict) else {}
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}

    event_ids: List[str] = []
    revision_ids: List[str] = []
    recommendation_versions: List[str] = []
    for event in events or []:
        if not isinstance(event, dict):
            continue
        event_id = str(event.get("event_id") or "").strip()
        if event_id:
            event_ids.append(event_id)
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        revision_id = str(payload.get("revision_id") or "").strip()
        if revision_id:
            revision_ids.append(revision_id)
        recommendation_version = str(payload.get("recommendation_version") or "").strip()
        if recommendation_version:
            recommendation_versions.append(recommendation_version)

    produced_belief_ids: List[str] = []
    for node in nodes.values():
        if not isinstance(node, dict):
            continue
        result = node.get("result") if isinstance(node.get("result"), dict) else {}
        produced_belief_ids.extend(result.get("produced_belief_ids") or [])

    event_ids = _unique_strings(event_ids)
    revision_ids = _unique_strings(revision_ids)
    recommendation_versions = _unique_strings(recommendation_versions)
    produced_belief_ids = _unique_strings(produced_belief_ids)

    return {
        "process_id": process.get("process_id"),
        "task_id": process.get("task_id"),
        "workflow_id": metadata.get("workflow_id"),
        "status": process.get("status"),
        "event_ids": event_ids,
        "revision_ids": revision_ids,
        "recommendation_versions": recommendation_versions,
        "produced_belief_ids": produced_belief_ids,
        "operator_summary": f"trace: {len(event_ids)} events, {len(revision_ids)} revisions, {len(produced_belief_ids)} belief ids",
    }



def trace_correlation_summary(*, processes: List[Dict[str, Any]], get_runtime_events_fn, hours: Optional[float] = None) -> Dict[str, Any]:
    filtered = filter_processes_by_hours(processes, hours)
    revision_counts: Dict[str, int] = {}
    recommendation_counts: Dict[str, int] = {}
    belief_counts: Dict[str, int] = {}
    process_rows: List[Dict[str, Any]] = []

    for process in filtered:
        process_id = str(process.get("process_id") or "").strip()
        if not process_id:
            continue
        events = get_runtime_events_fn(process_id, limit=200)
        trace = process_trace_surface(process=process, events=events)
        process_rows.append(
            {
                "process_id": trace.get("process_id"),
                "task_id": trace.get("task_id"),
                "workflow_id": trace.get("workflow_id"),
                "status": trace.get("status"),
                "event_ids": trace.get("event_ids") or [],
                "revision_ids": trace.get("revision_ids") or [],
                "recommendation_versions": trace.get("recommendation_versions") or [],
                "produced_belief_ids": trace.get("produced_belief_ids") or [],
                "operator_summary": trace.get("operator_summary"),
            }
        )
        for revision_id in trace.get("revision_ids") or []:
            revision_counts[revision_id] = revision_counts.get(revision_id, 0) + 1
        for recommendation_version in trace.get("recommendation_versions") or []:
            recommendation_counts[recommendation_version] = recommendation_counts.get(recommendation_version, 0) + 1
        for claim_id in trace.get("produced_belief_ids") or []:
            belief_counts[claim_id] = belief_counts.get(claim_id, 0) + 1

    top_revision_ids = sorted(
        ({"revision_id": key, "count": value} for key, value in revision_counts.items()),
        key=lambda row: (-row["count"], row["revision_id"]),
    )[:10]
    top_recommendation_versions = sorted(
        ({"recommendation_version": key, "count": value} for key, value in recommendation_counts.items()),
        key=lambda row: (-row["count"], row["recommendation_version"]),
    )[:10]
    top_belief_ids = sorted(
        ({"claim_id": key, "count": value} for key, value in belief_counts.items()),
        key=lambda row: (-row["count"], row["claim_id"]),
    )[:10]

    return {
        "window_hours": hours,
        "process_count": len(process_rows),
        "processes": process_rows,
        "top_revision_ids": top_revision_ids,
        "top_recommendation_versions": top_recommendation_versions,
        "top_belief_ids": top_belief_ids,
        "operator_summary": f"correlation: {len(process_rows)} processes, {len(top_revision_ids)} revision ids, {len(top_belief_ids)} belief ids",
    }


__all__ = [
    "POLICY_PATCHABLE_SETTINGS",
    "analytics_comparison",
    "analytics_report",
    "analytics_report_markdown",
    "analytics_summary",
    "process_trace_surface",
    "trace_correlation_summary",
    "classify_incident",
    "filter_processes_by_hours",
    "incident_report",
    "incident_trends",
    "parse_dt_maybe",
    "policy_adaptation_hooks",
    "policy_patch_preview",
    "apply_policy_patch_preview",
    "select_policy_patch_preview",
    "rerun_recommendations",
    "workflow_postmortem",
    "workflow_self_review",
]
