"""Authenticated principal scoping for Cortex memory and Codec calls."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import json
import os
import re
from typing import Dict, Mapping, Optional


MEMORY_SCOPE_VERSION = "cortex.memory.principal.v2"
PRINCIPAL_FIELDS = (
    "tenant_id",
    "workspace_id",
    "agent_id",
    "user_id",
    "channel_id",
    "session_id",
)
_SCOPE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$")
_DYNAMIC_SESSION_POLICY_FIELDS = frozenset({"type", "prefix", "max_length"})


class MemoryScopeAuthError(ValueError):
    """Raised when caller-supplied memory identity is not authorized."""


def default_tenant_id() -> str:
    return os.getenv("CORTEX_DEFAULT_TENANT_ID", "cortex-local").strip() or "cortex-local"


def default_workspace_id() -> str:
    return os.getenv("CORTEX_DEFAULT_WORKSPACE_ID", "default").strip() or "default"


def _normalize(value: object, field: str) -> str:
    text = str(value or "").strip()
    if not _SCOPE_ID_RE.fullmatch(text):
        raise MemoryScopeAuthError(f"{field} must be a bounded opaque identifier")
    return text


def local_principal_scope() -> Dict[str, str]:
    """Reserved compatibility principal for an unconfigured local developer instance."""

    return {
        "tenant_id": default_tenant_id(),
        "workspace_id": default_workspace_id(),
        "agent_id": "local-agent",
        "user_id": "local-user",
        "channel_id": "local-channel",
        "session_id": "local-session",
    }


def normalize_principal_scope(
    scope: Optional[Mapping[str, object]],
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> Dict[str, str]:
    if scope is None:
        normalized = local_principal_scope()
        if tenant_id is not None:
            normalized["tenant_id"] = _normalize(tenant_id, "tenant_id")
        if workspace_id is not None:
            normalized["workspace_id"] = _normalize(workspace_id, "workspace_id")
    else:
        unknown = set(scope) - set(PRINCIPAL_FIELDS)
        if unknown:
            raise MemoryScopeAuthError(f"unrecognized memory scope fields: {', '.join(sorted(unknown))}")
        missing = [field for field in PRINCIPAL_FIELDS if not str(scope.get(field) or "").strip()]
        if missing:
            raise MemoryScopeAuthError(f"missing memory scope fields: {', '.join(missing)}")
        normalized = {field: _normalize(scope.get(field), field) for field in PRINCIPAL_FIELDS}

    supplied_tenant = _normalize(tenant_id or normalized["tenant_id"], "tenant_id")
    supplied_workspace = _normalize(workspace_id or normalized["workspace_id"], "workspace_id")
    if supplied_tenant != normalized["tenant_id"] or supplied_workspace != normalized["workspace_id"]:
        raise MemoryScopeAuthError("flat tenant/workspace fields must match the principal scope")
    return normalized


def canonical_memory_scope_message(credential_id: str, scope: Mapping[str, str]) -> bytes:
    values = [MEMORY_SCOPE_VERSION, _normalize(credential_id, "scope_credential_id")]
    values.extend(_normalize(scope.get(field), field) for field in PRINCIPAL_FIELDS)
    return "\n".join(values).encode("utf-8")


def memory_scope_signature(
    tenant_id: str,
    workspace_id: str,
    *,
    agent_id: str = "local-agent",
    user_id: str = "local-user",
    channel_id: str = "local-channel",
    session_id: str = "local-session",
    credential_id: str = "local",
    secret: Optional[str] = None,
) -> str:
    signing_secret = str(secret or "").strip()
    if not signing_secret:
        return ""
    scope = normalize_principal_scope(
        {
            "tenant_id": tenant_id,
            "workspace_id": workspace_id,
            "agent_id": agent_id,
            "user_id": user_id,
            "channel_id": channel_id,
            "session_id": session_id,
        }
    )
    return hmac.new(
        signing_secret.encode("utf-8"),
        canonical_memory_scope_message(credential_id, scope),
        hashlib.sha256,
    ).hexdigest()


def _configured_credentials() -> Dict[str, Dict[str, object]]:
    raw = os.getenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MemoryScopeAuthError("CORTEX_MEMORY_SCOPE_CREDENTIALS must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise MemoryScopeAuthError("CORTEX_MEMORY_SCOPE_CREDENTIALS must be a credential object")
    credentials: Dict[str, Dict[str, object]] = {}
    for raw_id, value in parsed.items():
        credential_id = _normalize(raw_id, "scope_credential_id")
        if not isinstance(value, dict) or not str(value.get("secret") or "").strip():
            raise MemoryScopeAuthError(f"memory scope credential {credential_id!r} is invalid")
        allowed = value.get("allowed_scopes")
        if not isinstance(allowed, list) or not allowed:
            raise MemoryScopeAuthError(f"memory scope credential {credential_id!r} needs allowed_scopes")
        credentials[credential_id] = {"secret": str(value["secret"]), "allowed_scopes": allowed}
    return credentials


def normalize_memory_scope_policy(allowed: object, credential_id: str) -> Dict[str, object]:
    """Validate and normalize an exact or bounded dynamic-session policy."""
    if not isinstance(allowed, dict):
        raise MemoryScopeAuthError(f"memory scope credential {credential_id!r} has an invalid allowed scope")
    unknown = set(allowed) - set(PRINCIPAL_FIELDS)
    missing = [field for field in PRINCIPAL_FIELDS if field not in allowed]
    if unknown or missing:
        raise MemoryScopeAuthError(f"memory scope credential {credential_id!r} has an invalid allowed scope")

    policy: Dict[str, object] = {
        field: _normalize(allowed.get(field), field)
        for field in PRINCIPAL_FIELDS[:-1]
    }

    session_policy = allowed.get("session_id")
    if not isinstance(session_policy, dict):
        policy["session_id"] = _normalize(session_policy, "session_id")
        return policy

    if set(session_policy) - _DYNAMIC_SESSION_POLICY_FIELDS:
        raise MemoryScopeAuthError(f"memory scope credential {credential_id!r} has an invalid dynamic session policy")
    if str(session_policy.get("type") or "").strip() != "signed_dynamic":
        raise MemoryScopeAuthError(f"memory scope credential {credential_id!r} has an invalid dynamic session policy")
    prefix = _normalize(session_policy.get("prefix"), "dynamic session prefix")
    try:
        max_length = int(session_policy.get("max_length", 128))
    except (TypeError, ValueError) as exc:
        raise MemoryScopeAuthError(
            f"memory scope credential {credential_id!r} has an invalid dynamic session policy"
        ) from exc
    if max_length < len(prefix) + 1 or max_length > 128:
        raise MemoryScopeAuthError(f"memory scope credential {credential_id!r} has an invalid dynamic session policy")
    policy["session_id"] = {
        "type": "signed_dynamic",
        "prefix": prefix,
        "max_length": max_length,
    }
    return policy


def memory_scope_policy_matches(scope: Mapping[str, object], allowed: object, credential_id: str) -> bool:
    """Match a normalized principal against a validated credential policy."""

    normalized_scope = normalize_principal_scope(scope)
    policy = normalize_memory_scope_policy(allowed, credential_id)
    fixed_scope = {field: policy[field] for field in PRINCIPAL_FIELDS[:-1]}
    session_policy = policy["session_id"]
    if not isinstance(session_policy, dict):
        return (
            fixed_scope == {field: normalized_scope[field] for field in PRINCIPAL_FIELDS[:-1]}
            and session_policy == normalized_scope["session_id"]
        )
    session_id = normalized_scope["session_id"]
    return (
        fixed_scope == {field: normalized_scope[field] for field in PRINCIPAL_FIELDS[:-1]}
        and session_id.startswith(str(session_policy["prefix"]))
        and len(session_id) <= int(session_policy["max_length"])
    )


def _allowed_scope_matches(scope: Mapping[str, str], allowed: object, credential_id: str) -> bool:
    """Backward-compatible internal alias for policy matching."""

    return memory_scope_policy_matches(scope, allowed, credential_id)


@dataclass(frozen=True)
class AuthenticatedMemoryPrincipal:
    credential_id: str
    tenant_id: str
    workspace_id: str
    agent_id: str
    user_id: str
    channel_id: str
    session_id: str

    @property
    def scope(self) -> Dict[str, str]:
        return {field: getattr(self, field) for field in PRINCIPAL_FIELDS}

    @property
    def storage_workspace_id(self) -> str:
        if self.credential_id == "local-development" and self.scope == local_principal_scope():
            return self.workspace_id
        canonical = "\0".join(self.scope[field] for field in PRINCIPAL_FIELDS)
        return f"principal-{hashlib.sha256(canonical.encode('utf-8')).hexdigest()[:48]}"

    @property
    def storage_metadata(self) -> Dict[str, str]:
        return {
            **self.scope,
            "scope_credential_id": self.credential_id,
            "storage_workspace_id": self.storage_workspace_id,
        }


def authenticate_memory_principal(
    *,
    tenant_id: Optional[str],
    workspace_id: Optional[str],
    scope: Optional[Mapping[str, object]],
    credential_id: Optional[str],
    signature: Optional[str],
    production: bool,
) -> AuthenticatedMemoryPrincipal:
    credentials = _configured_credentials()
    if not credentials and production:
        raise MemoryScopeAuthError("principal-scoped memory credentials are not configured")
    if production and scope is None:
        raise MemoryScopeAuthError("full principal memory scope is required in production")
    normalized = normalize_principal_scope(
        scope,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
    )
    supplied_id = str(credential_id or "").strip()

    if not credentials:
        if normalized["tenant_id"] != default_tenant_id() or normalized["workspace_id"] != default_workspace_id():
            raise MemoryScopeAuthError("non-default memory principals require a scoped credential")
        return AuthenticatedMemoryPrincipal(credential_id="local-development", **normalized)

    if not supplied_id or supplied_id not in credentials:
        raise MemoryScopeAuthError("unknown memory scope credential")
    credential = credentials[supplied_id]
    allowed_matches = [
        memory_scope_policy_matches(normalized, allowed, supplied_id)
        for allowed in credential["allowed_scopes"]
    ]
    if not any(allowed_matches):
        raise MemoryScopeAuthError("credential is not authorized for the requested principal scope")
    expected = memory_scope_signature(
        **normalized,
        credential_id=supplied_id,
        secret=str(credential["secret"]),
    )
    if not hmac.compare_digest(str(signature or ""), expected):
        raise MemoryScopeAuthError("invalid authenticated memory principal signature")
    return AuthenticatedMemoryPrincipal(credential_id=supplied_id, **normalized)


def authenticated_memory_scope_fields(
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> Dict[str, object]:
    """Return local-development fields for internal compatibility callers."""

    scope = local_principal_scope()
    if tenant_id is not None:
        scope["tenant_id"] = _normalize(tenant_id, "tenant_id")
    if workspace_id is not None:
        scope["workspace_id"] = _normalize(workspace_id, "workspace_id")
    return {"tenant_id": scope["tenant_id"], "workspace_id": scope["workspace_id"], "scope": scope}
