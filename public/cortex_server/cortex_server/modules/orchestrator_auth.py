"""Execution authority for L26 workflow steps that call Cortex endpoints.

Before this module, workflow steps were bare self-HTTP calls: they 403'd under
production write/read auth unless the caller embedded tokens in
``step.headers``, which were then persisted in plaintext in SQLite.

Now:

* credential-bearing headers are rejected when a workflow is created
  (``find_credential_headers``) and stripped from any legacy stored step at
  send time (``strip_credential_headers``);
* the workflow records WHO created it (``bind_execution_authority``): the
  authenticated principal's credential id and scope, or the global admin.
  The record holds no secret and is sealed with an HMAC over the server-only
  delegation secret, so caller-supplied metadata cannot forge it;
* at execution time ``execution_headers`` re-derives fresh credentials for that
  authority from server configuration (signed principal scope headers, or the
  admin token) and they are attached only to the outgoing in-process request;
* ``internal_client`` dispatches steps through the ASGI app in process (no
  network self-call) so the full auth middleware still applies.

A workflow with no valid sealed authority runs its steps without credentials,
and they fail honestly.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

import httpx

AUTHORITY_KEY = "_execution_authority"
_SEAL_CONTEXT = b"cortex.orchestrator.execution-authority.v1\n"
_PRINCIPAL_FIELDS = ("tenant_id", "workspace_id", "agent_id", "user_id", "channel_id", "session_id")
_FORBIDDEN_EXACT = frozenset({
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
})
_FORBIDDEN_FRAGMENTS = ("token", "secret", "signature", "password", "api-key", "apikey", "credential")


def _is_credential_header(name: Any) -> bool:
    lowered = str(name or "").strip().lower()
    if not lowered:
        return False
    if lowered in _FORBIDDEN_EXACT or lowered.startswith("x-cortex-"):
        return True
    return any(fragment in lowered for fragment in _FORBIDDEN_FRAGMENTS)


def _iter_steps(steps: Iterable[Any]) -> Iterable[Tuple[str, Mapping[str, Any]]]:
    for idx, step in enumerate(steps or [], start=1):
        if not isinstance(step, Mapping):
            continue
        label = str(step.get("node_id") or f"step_{idx}")
        yield label, step
        metadata = step.get("metadata") if isinstance(step.get("metadata"), Mapping) else {}
        compensation = metadata.get("compensation")
        if isinstance(compensation, Mapping):
            compensation = [compensation]
        if isinstance(compensation, list):
            for cidx, comp in enumerate(compensation, start=1):
                if isinstance(comp, Mapping):
                    yield f"{label}:compensate:{cidx}", comp


def find_credential_headers(steps: Iterable[Any]) -> List[str]:
    """Return '<step>:<header>' for every credential-bearing header in steps."""

    found: List[str] = []
    for label, step in _iter_steps(steps):
        headers = step.get("headers")
        if isinstance(headers, Mapping):
            for name in headers.keys():
                if _is_credential_header(name):
                    found.append(f"{label}:{str(name).lower()}")
    return found


def strip_credential_headers(headers: Any) -> Dict[str, str]:
    if not isinstance(headers, Mapping):
        return {}
    return {str(k): str(v) for k, v in headers.items() if not _is_credential_header(k)}


def _seal_secret() -> str:
    secret = str(os.getenv("CORTEX_ACTION_DELEGATION_SECRET", "") or "")
    return secret if len(secret.encode("utf-8")) >= 32 else ""


def _canonical(authority: Mapping[str, Any]) -> bytes:
    unsigned = {k: authority[k] for k in sorted(authority) if k != "seal"}
    return json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _seal(authority: Mapping[str, Any]) -> str:
    secret = _seal_secret()
    if not secret:
        return ""
    return hmac.new(secret.encode("utf-8"), _SEAL_CONTEXT + _canonical(authority), hashlib.sha256).hexdigest()


def authority_from_request(http_request: Any) -> Dict[str, Any]:
    """Describe the authenticated caller (no secrets)."""

    state = getattr(http_request, "state", None) if http_request is not None else None
    principal = getattr(state, "cortex_principal", None) if state is not None else None
    role = str(getattr(principal, "role", "") or "")
    credential_id = str(getattr(principal, "credential_id", "") or "")
    if role == "principal" and credential_id:
        scope = {field: str(getattr(principal, field, "") or "") for field in _PRINCIPAL_FIELDS}
        if all(scope.values()):
            return {"kind": "principal", "credential_id": credential_id, "scope": scope}
    if role == "admin" and credential_id == "cortex-admin":
        return {"kind": "admin"}
    return {"kind": "none"}


def bind_execution_authority(metadata: Optional[Mapping[str, Any]], http_request: Any) -> Dict[str, Any]:
    """Return metadata with caller-supplied authority removed and the real one sealed in."""

    out = dict(metadata or {})
    out.pop(AUTHORITY_KEY, None)
    authority = authority_from_request(http_request)
    if authority["kind"] != "none":
        seal = _seal(authority)
        if seal:
            authority = {**authority, "seal": seal}
        else:
            authority = {**authority, "seal": "", "unsealed_reason": "delegation_secret_not_configured"}
        out[AUTHORITY_KEY] = authority
    return out


def verified_authority(metadata: Optional[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    authority = (metadata or {}).get(AUTHORITY_KEY)
    if not isinstance(authority, Mapping):
        return None
    seal = str(authority.get("seal") or "")
    expected = _seal(authority)
    if not seal or not expected or not hmac.compare_digest(seal, expected):
        return None
    if authority.get("kind") not in {"principal", "admin"}:
        return None
    return dict(authority)


def _write_token_headers() -> Dict[str, str]:
    token = os.getenv("CORTEX_WRITE_TOKEN", "").strip()
    header = os.getenv("CORTEX_WRITE_TOKEN_HEADER", "x-cortex-write-token").strip().lower()
    return {header: token} if token and header else {}


def _principal_headers(authority: Mapping[str, Any]) -> Optional[Dict[str, str]]:
    from cortex_server.modules.memory_scope import (
        MEMORY_PRINCIPAL_HEADERS,
        MemoryScopeAuthError,
        _configured_credentials,
        memory_scope_policy_matches,
        memory_scope_signature,
        normalize_principal_scope,
    )

    credential_id = str(authority.get("credential_id") or "")
    try:
        scope = normalize_principal_scope(dict(authority.get("scope") or {}))
        credential = _configured_credentials().get(credential_id)
    except (MemoryScopeAuthError, ValueError):
        return None
    if credential is None:
        return None
    if not any(memory_scope_policy_matches(scope, allowed, credential_id) for allowed in credential["allowed_scopes"]):
        return None
    signature = memory_scope_signature(**scope, credential_id=credential_id, secret=str(credential["secret"]))
    if not signature:
        return None
    return {
        **{MEMORY_PRINCIPAL_HEADERS[field]: scope[field] for field in _PRINCIPAL_FIELDS},
        "x-cortex-scope-credential-id": credential_id,
        "x-cortex-scope-signature": signature,
    }


def execution_headers(metadata: Optional[Mapping[str, Any]]) -> Tuple[Dict[str, str], str]:
    """Fresh, never-persisted credentials for the workflow's sealed authority.

    Returns (headers, label) where label is one of 'principal', 'admin',
    'unbound' or 'unavailable:<reason>'.
    """

    authority = verified_authority(metadata)
    if authority is None:
        return {}, "unbound"
    if authority["kind"] == "admin":
        admin_token = os.getenv("CORTEX_ADMIN_TOKEN", "").strip()
        if not admin_token:
            return {}, "unavailable:admin_token_not_configured"
        return {**_write_token_headers(), "x-cortex-admin-token": admin_token}, "admin"
    headers = _principal_headers(authority)
    if headers is None:
        return {}, "unavailable:principal_credential_not_configured"
    return {**_write_token_headers(), **headers}, "principal"


def _cortex_app() -> Any:
    module = sys.modules.get("cortex_server.main")
    return getattr(module, "app", None) if module is not None else None


def internal_client(timeout: float = 30.0) -> httpx.AsyncClient:
    """In-process ASGI client when the Cortex app is loaded; loopback HTTP otherwise."""

    app = _cortex_app()
    if app is not None:
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), timeout=timeout)
        setattr(client, "cortex_transport", "in_process_asgi")
        return client
    client = httpx.AsyncClient(timeout=timeout)
    setattr(client, "cortex_transport", "loopback_http")
    return client


def authority_summary(metadata: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    authority = verified_authority(metadata)
    if authority is None:
        raw = (metadata or {}).get(AUTHORITY_KEY)
        return {"bound": False, "kind": (raw or {}).get("kind") if isinstance(raw, Mapping) else None}
    out: Dict[str, Any] = {"bound": True, "kind": authority["kind"]}
    if authority["kind"] == "principal":
        out["credential_id"] = authority.get("credential_id")
        out["user_id"] = (authority.get("scope") or {}).get("user_id")
    return out


__all__ = [
    "AUTHORITY_KEY",
    "authority_from_request",
    "authority_summary",
    "bind_execution_authority",
    "execution_headers",
    "find_credential_headers",
    "internal_client",
    "strip_credential_headers",
    "verified_authority",
]
