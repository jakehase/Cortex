from __future__ import annotations

from typing import Any, Dict

from cortex_server.modules.reasoning_approvals import grant_allows_step


HIGH_RISK_PREFIXES = (
    "/bridge",
    "/diplomat",
    "/homeassistant/service",
    "/cron/schedule",
    "/forge/commit",
    "/openclaw",
    "/oracle_sandbox",
    "/browser/notary",
    "/browser/sandbox",
)

MEDIUM_RISK_PREFIXES = (
    "/homeassistant",
    "/cron/trigger",
    "/queue/schedule",
    "/workflow_async",
    "/automation",
)


def evaluate_step_permission(step: Dict[str, Any], *, workflow_metadata: Dict[str, Any] | None = None) -> Dict[str, Any]:
    workflow_metadata = dict(workflow_metadata or {})
    step_metadata = dict((step.get("metadata") or {})) if isinstance(step.get("metadata"), dict) else {}
    endpoint = str(step.get("endpoint") or "")
    method = str(step.get("method") or "POST").upper()

    risk = "low"
    matched_prefix = None
    for prefix in HIGH_RISK_PREFIXES:
        if endpoint.startswith(prefix):
            risk = "high"
            matched_prefix = prefix
            break
    if matched_prefix is None:
        for prefix in MEDIUM_RISK_PREFIXES:
            if endpoint.startswith(prefix):
                risk = "medium"
                matched_prefix = prefix
                break

    approval_required = bool(step_metadata.get("approval_required")) or risk == "high"
    approval_grant = grant_allows_step(step, workflow_metadata=workflow_metadata, risk=risk)
    approved = bool(approval_grant)

    allow = True
    reason = "ok"
    if approval_required and not approved:
        allow = False
        reason = "approval_required"
    if method not in {"GET", "POST"}:
        allow = False
        reason = "unsupported_method"

    return {
        "allow": allow,
        "reason": reason,
        "risk": risk,
        "approval_required": approval_required,
        "approved": approved,
        "approval_grant_id": approval_grant.get("grant_id") if approval_grant else None,
        "matched_prefix": matched_prefix,
        "endpoint": endpoint,
        "method": method,
    }


__all__ = ["evaluate_step_permission"]
