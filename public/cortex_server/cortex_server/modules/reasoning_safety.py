from __future__ import annotations

import json
import os
import re
from typing import Any, Dict
from urllib.parse import unquote, urlsplit

from cortex_server.modules.reasoning_approvals import consume_approval_grant, grant_allows_step


HIGH_RISK_PREFIXES = (
    "/bridge",
    "/diplomat",
    "/homeassistant/service",
    "/homeassistant/services",
    "/homeassistant/events",
    "/homeassistant/policy",
    "/homeassistant/voice",
    "/cron/schedule",
    "/forge/commit",
    "/tools",
    "/openclaw",
    "/oracle_sandbox",
    "/browser/notary",
    "/browser/sandbox",
    "/agent-work",
    "/host",
    "/docker",
    "/filesystem",
    "/fs",
    "/lab",
    "/device",
    "/send",
    "/egress",
    "/shell",
    "/terminal",
    "/command",
    "/subprocess",
    "/exec",
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


# Workflow HTTP actions are capabilities, not arbitrary paths.  Keep the
# default registry deliberately narrow; deployments can add reviewed exact
# method/path entries with REASONING_WORKFLOW_ACTION_POLICIES.
DEFAULT_ACTION_POLICIES = {
    "POST /oracle/chat": "low",
    "GET /oracle/status": "low",
    "GET /oracle/kernel/status": "low",
    "POST /users/get": "low",
    "POST /librarian/search": "low",
    "GET /librarian/search": "low",
    "POST /knowledge/search": "low",
    "POST /validator/validate": "low",
    "POST /ethicist/evaluate": "low",
    "POST /council/deliberate": "medium",
}
_ALLOWED_METHODS = frozenset({"GET", "POST"})
_ALLOWED_RISKS = frozenset({"low", "medium", "high"})


def _configured_action_policies() -> Dict[str, str]:
    policies = dict(DEFAULT_ACTION_POLICIES)
    raw = str(os.getenv("REASONING_WORKFLOW_ACTION_POLICIES") or "").strip()
    if not raw:
        return policies
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return policies
    if not isinstance(parsed, dict):
        return policies
    for raw_action, raw_risk in parsed.items():
        action = " ".join(str(raw_action or "").strip().split())
        risk = str(raw_risk or "").strip().lower()
        try:
            method, endpoint = action.split(" ", 1)
        except ValueError:
            continue
        if method.upper() not in _ALLOWED_METHODS or not endpoint.startswith("/") or risk not in _ALLOWED_RISKS:
            continue
        policies[f"{method.upper()} {endpoint}"] = risk
    return policies


def classify_action(step: Dict[str, Any]) -> Dict[str, Any]:
    endpoint = str(step.get("endpoint") or "")
    endpoint_path, endpoint_path_valid = _endpoint_path(endpoint)
    method = str(step.get("method") or "POST").upper().strip()
    if method not in _ALLOWED_METHODS:
        return {"known": False, "risk": "unknown", "matched_prefix": None, "reason": "unsupported_method"}

    for prefix in HIGH_RISK_PREFIXES:
        if _matches_path_prefix(endpoint_path, prefix):
            return {
                "known": endpoint_path_valid,
                "risk": "high",
                "matched_prefix": prefix,
                "reason": "classified" if endpoint_path_valid else "invalid_endpoint",
            }
    for prefix in MEDIUM_RISK_PREFIXES:
        if _matches_path_prefix(endpoint_path, prefix):
            return {
                "known": endpoint_path_valid,
                "risk": "medium",
                "matched_prefix": prefix,
                "reason": "classified" if endpoint_path_valid else "invalid_endpoint",
            }

    risk = _configured_action_policies().get(f"{method} {endpoint_path}")
    if risk:
        return {
            "known": endpoint_path_valid,
            "risk": risk,
            "matched_prefix": endpoint_path,
            "reason": "classified" if endpoint_path_valid else "invalid_endpoint",
        }
    if not endpoint_path_valid:
        return {"known": False, "risk": "unknown", "matched_prefix": None, "reason": "invalid_endpoint"}
    return {"known": False, "risk": "unknown", "matched_prefix": None, "reason": "unknown_action"}


def evaluate_step_permission(
    step: Dict[str, Any],
    *,
    workflow_metadata: Dict[str, Any] | None = None,
    consume_approval: bool = False,
) -> Dict[str, Any]:
    step = dict(step or {})
    workflow_metadata = dict(workflow_metadata or {})
    step_metadata = dict((step.get("metadata") or {})) if isinstance(step.get("metadata"), dict) else {}
    endpoint = str(step.get("endpoint") or "")
    endpoint_path, endpoint_path_valid = _endpoint_path(endpoint)
    method = str(step.get("method") or "POST").upper()

    classification = classify_action(step)
    risk = str(classification.get("risk") or "unknown")
    matched_prefix = classification.get("matched_prefix")

    approval_required = bool(step_metadata.get("approval_required")) or risk == "high"
    approval_grant = grant_allows_step(step, workflow_metadata=workflow_metadata, risk=risk) if classification.get("known") else None
    approved = bool(approval_grant)
    consumption = None
    if approved and approval_required and consume_approval:
        consumption = consume_approval_grant(
            approval_grant or {},
            step=step,
            workflow_metadata=workflow_metadata,
        )
        approved = bool(consumption.get("consumed"))

    allow = bool(classification.get("known"))
    reason = "ok"
    if not classification.get("known"):
        reason = str(classification.get("reason") or "unknown_action")
    elif approval_required and not approved:
        allow = False
        reason = (
            "approval_replayed"
            if isinstance(consumption, dict) and consumption.get("reason") == "approval_replayed"
            else (
                "approval_consumption_failed"
                if isinstance(consumption, dict)
                else "approval_required"
            )
        )
    if method not in _ALLOWED_METHODS:
        allow = False
        reason = "unsupported_method"

    return {
        "allow": allow,
        "reason": reason,
        "risk": risk,
        "approval_required": approval_required,
        "approved": approved,
        "approval_grant_id": approval_grant.get("grant_id") if approval_grant else None,
        "approval_consumption": consumption,
        "matched_prefix": matched_prefix,
        "known_action": bool(classification.get("known")),
        "endpoint": endpoint,
        "method": method,
    }


__all__ = ["classify_action", "evaluate_step_permission"]
