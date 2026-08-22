from __future__ import annotations

from typing import Any, Dict, Optional


FAILURE_GENERIC = "generic_failure"
FAILURE_POLICY_CONTRACTS = "policy_requires_contracts"
FAILURE_PRE_VERIFICATION = "pre_verification_failed"
FAILURE_POST_VERIFICATION = "post_verification_failed"
FAILURE_TIMEOUT = "timeout"
FAILURE_DEADLINE = "workflow_deadline_exceeded"
FAILURE_CANCELLED = "cancelled"
FAILURE_APPROVAL_REQUIRED = "approval_required"
FAILURE_UNSUPPORTED_METHOD = "unsupported_method"
FAILURE_EXCEPTION = "execution_exception"
FAILURE_DEPENDENCY_BLOCKED = "blocked_due_to_unmet_dependencies"
FAILURE_HALT_CANCELLED = "cancelled_due_to_halt"


def normalize_failure_code(error_code: Optional[str], *, error: Optional[str] = None, error_type: Optional[str] = None, success: Optional[bool] = None) -> Optional[str]:
    code = str(error_code or "").strip()
    if code:
        return code
    if success is True:
        return None
    error_type_str = str(error_type or "").strip().lower()
    error_str = str(error or "").strip().lower()
    if error_type_str == "timeout" or error_str.startswith("timeout:"):
        return FAILURE_TIMEOUT
    if error_str in {
        FAILURE_POLICY_CONTRACTS,
        FAILURE_PRE_VERIFICATION,
        FAILURE_POST_VERIFICATION,
        FAILURE_DEADLINE,
        FAILURE_APPROVAL_REQUIRED,
        FAILURE_UNSUPPORTED_METHOD,
        FAILURE_DEPENDENCY_BLOCKED,
        FAILURE_HALT_CANCELLED,
    }:
        return error_str
    if error_str:
        return FAILURE_EXCEPTION
    return FAILURE_GENERIC



def enrich_failure(result: Dict[str, Any], *, error_code: Optional[str] = None) -> Dict[str, Any]:
    out = dict(result or {})
    normalized = normalize_failure_code(
        error_code or out.get("error_code"),
        error=out.get("error"),
        error_type=out.get("error_type"),
        success=out.get("success"),
    )
    if normalized:
        out["error_code"] = normalized
    return out


__all__ = [
    "FAILURE_APPROVAL_REQUIRED",
    "FAILURE_CANCELLED",
    "FAILURE_DEADLINE",
    "FAILURE_DEPENDENCY_BLOCKED",
    "FAILURE_EXCEPTION",
    "FAILURE_GENERIC",
    "FAILURE_HALT_CANCELLED",
    "FAILURE_POLICY_CONTRACTS",
    "FAILURE_POST_VERIFICATION",
    "FAILURE_PRE_VERIFICATION",
    "FAILURE_TIMEOUT",
    "FAILURE_UNSUPPORTED_METHOD",
    "enrich_failure",
    "normalize_failure_code",
]
