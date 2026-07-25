from __future__ import annotations

import re
from typing import Any, Dict
from urllib.parse import unquote, urlsplit

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

_MALFORMED_ESCAPE_RE = re.compile(r"%(?![0-9A-Fa-f]{2})")
_ENCODED_SEPARATOR_RE = re.compile(r"%(?:2f|5c)", re.IGNORECASE)


def _endpoint_path(endpoint: str) -> tuple[str, bool]:
    try:
        path = urlsplit(endpoint).path
    except ValueError:
        # Malformed authority syntax must not prevent relative-path risk checks.
        path = endpoint.split("#", 1)[0].split("?", 1)[0]

    malformed = bool(_MALFORMED_ESCAPE_RE.search(path))
    encoded_separator = bool(_ENCODED_SEPARATOR_RE.search(path))
    try:
        decoded = unquote(path, encoding="utf-8", errors="strict")
    except UnicodeDecodeError:
        return path, False

    ambiguous_segment = any(segment in {".", ".."} for segment in decoded.split("/"))
    valid = not (malformed or encoded_separator or "\\" in decoded or ambiguous_segment)
    return decoded, valid


def _matches_path_prefix(path: str, prefix: str) -> bool:
    boundary = prefix.rstrip("/") or "/"
    return path == boundary or (boundary != "/" and path.startswith(boundary + "/"))


def evaluate_step_permission(step: Dict[str, Any], *, workflow_metadata: Dict[str, Any] | None = None) -> Dict[str, Any]:
    step = dict(step or {})
    workflow_metadata = dict(workflow_metadata or {})
    step_metadata = dict((step.get("metadata") or {})) if isinstance(step.get("metadata"), dict) else {}
    endpoint = str(step.get("endpoint") or "")
    endpoint_path, endpoint_path_valid = _endpoint_path(endpoint)
    method = str(step.get("method") or "POST").upper()

    risk = "low"
    matched_prefix = None
    for prefix in HIGH_RISK_PREFIXES:
        if _matches_path_prefix(endpoint_path, prefix):
            risk = "high"
            matched_prefix = prefix
            break
    if matched_prefix is None:
        for prefix in MEDIUM_RISK_PREFIXES:
            if _matches_path_prefix(endpoint_path, prefix):
                risk = "medium"
                matched_prefix = prefix
                break

    approval_required = bool(step_metadata.get("approval_required")) or risk == "high"
    approval_step = dict(step)
    approval_step["endpoint"] = endpoint_path
    approval_grant = (
        grant_allows_step(approval_step, workflow_metadata=workflow_metadata, risk=risk)
        if endpoint_path_valid
        else None
    )
    approved = bool(approval_grant)

    allow = True
    reason = "ok"
    if approval_required and not approved:
        allow = False
        reason = "approval_required"
    if not endpoint_path_valid:
        allow = False
        reason = "invalid_endpoint"
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
