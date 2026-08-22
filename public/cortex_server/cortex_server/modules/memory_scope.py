"""Authenticated principal scoping for Cortex memory and Codec calls."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import ipaddress
import json
import os
import re
from typing import Any, Dict, Iterable, Mapping, Optional

from fastapi import HTTPException, Request


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
MEMORY_PRINCIPAL_HEADERS = {
    "tenant_id": "x-cortex-tenant-id",
    "workspace_id": "x-cortex-workspace-id",
    "agent_id": "x-cortex-agent-id",
    "user_id": "x-cortex-user-id",
    "channel_id": "x-cortex-channel-id",
    "session_id": "x-cortex-session-id",
}
_CLAIM_ALIASES = {
    "tenant_id": "tenant_id",
    "tenantId": "tenant_id",
    "workspace_id": "workspace_id",
    "workspaceId": "workspace_id",
    "agent_id": "agent_id",
    "agentId": "agent_id",
    "user_id": "user_id",
    "userId": "user_id",
    "channel_id": "channel_id",
    "channelId": "channel_id",
    "session_id": "session_id",
    "sessionId": "session_id",
}
_SERVER_NAMESPACE_CLAIMS = frozenset({
    "storage_workspace_id",
    "memory_principal_key",
    "knowledge_principal_key",
    "codec_session_key",
    "scope_credential_id",
})


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


def configured_internal_memory_headers() -> Optional[Dict[str, str]]:
    """Build signed internal-call headers from explicit credential and scope config.

    Both ``CORTEX_INTERNAL_MEMORY_CREDENTIAL_ID`` and the full JSON object in
    ``CORTEX_INTERNAL_MEMORY_SCOPE`` are required. Absence means the internal
    memory capability is unavailable; this helper never selects an identity or
    creates a secret implicitly.
    """

    credential_id = os.getenv("CORTEX_INTERNAL_MEMORY_CREDENTIAL_ID", "").strip()
    raw_scope = os.getenv("CORTEX_INTERNAL_MEMORY_SCOPE", "").strip()
    if not credential_id and not raw_scope:
        return None
    if not credential_id or not raw_scope:
        raise MemoryScopeAuthError(
            "internal memory calls require both credential id and exact principal scope"
        )
    try:
        parsed_scope = json.loads(raw_scope)
    except json.JSONDecodeError as exc:
        raise MemoryScopeAuthError("CORTEX_INTERNAL_MEMORY_SCOPE must be valid JSON") from exc
    if not isinstance(parsed_scope, dict):
        raise MemoryScopeAuthError("CORTEX_INTERNAL_MEMORY_SCOPE must be a principal object")

    scope = normalize_principal_scope(parsed_scope)
    credentials = _configured_credentials()
    credential = credentials.get(_normalize(credential_id, "scope_credential_id"))
    if credential is None:
        raise MemoryScopeAuthError("configured internal memory credential is unavailable")
    if not any(
        memory_scope_policy_matches(scope, allowed, credential_id)
        for allowed in credential["allowed_scopes"]
    ):
        raise MemoryScopeAuthError(
            "configured internal memory credential is not authorized for its exact scope"
        )
    signature = memory_scope_signature(
        **scope,
        credential_id=credential_id,
        secret=str(credential["secret"]),
    )
    if not signature:
        raise MemoryScopeAuthError("configured internal memory credential cannot sign requests")
    return {
        **{
            MEMORY_PRINCIPAL_HEADERS[field]: scope[field]
            for field in PRINCIPAL_FIELDS
        },
        "x-cortex-scope-credential-id": credential_id,
        "x-cortex-scope-signature": signature,
    }


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

    def isolation_key(self, namespace: str) -> str:
        """Return an opaque, credential-rotation-stable key for principal-local state."""

        bounded_namespace = str(namespace or "").strip()
        if not bounded_namespace or len(bounded_namespace) > 80:
            raise ValueError("principal isolation namespace must be bounded and non-empty")
        canonical = "\0".join((bounded_namespace, *(self.scope[field] for field in PRINCIPAL_FIELDS)))
        return f"principal:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"

    @property
    def memory_principal_key(self) -> str:
        return self.isolation_key("semantic-memory")

    @property
    def codec_session_key(self) -> str:
        """Opaque server-derived Codec key; never accept a caller-selected key."""

        return self.isolation_key("codec-session")

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
            "memory_principal_key": self.memory_principal_key,
        }

    def scoped_resource_id(self, namespace: str, external_id: object) -> str:
        """Map a caller-visible graph identifier into this principal's namespace."""

        raw = str(external_id or "").strip()
        if not raw or len(raw) > 512:
            raise MemoryScopeAuthError("resource identifier must be bounded and non-empty")
        prefix = f"p-{hashlib.sha256(self.isolation_key(namespace).encode('utf-8')).hexdigest()[:20]}-"
        if raw.startswith(prefix):
            if not re.fullmatch(r"p-[0-9a-f]{20}-[0-9a-f]{40}", raw):
                raise MemoryScopeAuthError("malformed principal-scoped resource identifier")
            return raw
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]
        return f"{prefix}{digest}"


def authenticate_memory_principal(
    *,
    tenant_id: Optional[str],
    workspace_id: Optional[str],
    scope: Optional[Mapping[str, object]],
    credential_id: Optional[str],
    signature: Optional[str],
    production: bool,
    allow_local_development: bool = False,
) -> AuthenticatedMemoryPrincipal:
    credentials = _configured_credentials()
    if not credentials and (production or not allow_local_development):
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
        if normalized != local_principal_scope():
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


def production_memory_scope_mode() -> bool:
    environment = os.getenv(
        "CORTEX_ENV",
        os.getenv("CORTEX_ENVIRONMENT", "development"),
    ).strip().lower()
    strict = os.getenv("CORTEX_MEMORY_SCOPE_STRICT", "").strip().lower()
    return environment in {"production", "prod", "staging"} or strict in {
        "1", "true", "yes", "on",
    }


def authenticate_memory_headers(
    headers: Mapping[str, object],
    *,
    allow_local_development: bool = False,
) -> AuthenticatedMemoryPrincipal:
    """Authenticate the complete principal asserted by Cortex memory headers."""

    has_identity = any(
        str(headers.get(name, "") or "").strip()
        for name in (
            *MEMORY_PRINCIPAL_HEADERS.values(),
            "x-cortex-scope-credential-id",
            "x-cortex-scope-signature",
        )
    )
    raw_scope: Optional[Dict[str, str]] = None
    tenant_id: Optional[str] = None
    workspace_id: Optional[str] = None
    if has_identity:
        missing = [
            field
            for field, name in MEMORY_PRINCIPAL_HEADERS.items()
            if not str(headers.get(name, "") or "").strip()
        ]
        if missing:
            raise MemoryScopeAuthError(
                f"full authenticated principal scope is required: {', '.join(missing)}"
            )
        raw_scope = {
            field: _normalize(headers.get(name), field)
            for field, name in MEMORY_PRINCIPAL_HEADERS.items()
        }
        tenant_id = raw_scope["tenant_id"]
        workspace_id = raw_scope["workspace_id"]

    return authenticate_memory_principal(
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        scope=raw_scope,
        credential_id=str(headers.get("x-cortex-scope-credential-id", "") or ""),
        signature=str(headers.get("x-cortex-scope-signature", "") or ""),
        production=production_memory_scope_mode(),
        allow_local_development=allow_local_development,
    )


def _unsigned_local_memory_opt_in() -> bool:
    return os.getenv("CORTEX_ALLOW_UNSIGNED_LOCAL_MEMORY_PRINCIPAL", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _request_is_loopback(request: Request) -> bool:
    client = request.client
    host = str(client.host if client is not None else "").strip()
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def authenticate_memory_request(
    request: Request,
) -> AuthenticatedMemoryPrincipal:
    """Authenticate headers, admitting unsigned local scope only on opted-in loopback."""

    local_opt_in = _unsigned_local_memory_opt_in()
    credentials_configured = bool(_configured_credentials())
    loopback = _request_is_loopback(request)
    if local_opt_in and not credentials_configured and not loopback:
        raise MemoryScopeAuthError(
            "unsigned local memory principal is restricted to a loopback client"
        )
    return authenticate_memory_headers(
        request.headers,
        allow_local_development=(
            local_opt_in
            and loopback
            and not production_memory_scope_mode()
        ),
    )


def _iter_identity_claims(value: object, *, path: str = "body") -> Iterable[tuple[str, object, str]]:
    """Yield identity-bearing JSON fields, including nested metadata/scope objects."""

    if isinstance(value, Mapping):
        for raw_key, item in value.items():
            key = str(raw_key)
            claim_field = _CLAIM_ALIASES.get(key)
            if claim_field is not None:
                yield claim_field, item, f"{path}.{key}"
            elif key in _SERVER_NAMESPACE_CLAIMS or key == "session_key":
                yield key, item, f"{path}.{key}"
            if isinstance(item, (Mapping, list, tuple)):
                yield from _iter_identity_claims(item, path=f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            if isinstance(item, (Mapping, list, tuple)):
                yield from _iter_identity_claims(item, path=f"{path}[{index}]")


def validate_memory_principal_claims(
    principal: AuthenticatedMemoryPrincipal,
    claims: Iterable[tuple[str, object, str]],
) -> None:
    """Reject every caller identity/namespace claim that disagrees with auth."""

    expected = {
        **principal.scope,
        "storage_workspace_id": principal.storage_workspace_id,
        "memory_principal_key": principal.memory_principal_key,
        "knowledge_principal_key": principal.isolation_key("knowledge-graph"),
        "codec_session_key": principal.codec_session_key,
        "scope_credential_id": principal.credential_id,
    }
    for field, raw_value, path in claims:
        supplied = str(raw_value or "").strip()
        if not supplied:
            continue
        if field == "session_key":
            allowed = {principal.session_id, principal.codec_session_key}
            if supplied not in allowed:
                raise MemoryScopeAuthError(f"{path} does not match the authenticated principal session")
            continue
        if supplied != str(expected[field]):
            raise MemoryScopeAuthError(f"{path} does not match the authenticated memory principal")


def scoped_memory_metadata(
    principal: AuthenticatedMemoryPrincipal,
    metadata: Optional[Mapping[str, object]] = None,
) -> Dict[str, object]:
    """Validate caller metadata, then overwrite identity with server authority."""

    supplied = dict(metadata or {})
    validate_memory_principal_claims(
        principal,
        _iter_identity_claims(supplied, path="metadata"),
    )
    return {**supplied, **principal.storage_metadata}


def principal_memory_where(principal: AuthenticatedMemoryPrincipal) -> Dict[str, str]:
    return {"memory_principal_key": principal.memory_principal_key}


async def require_authenticated_memory_principal(request: Request) -> AuthenticatedMemoryPrincipal:
    """Shared FastAPI dependency for every memory/Codec compatibility route."""

    try:
        principal = authenticate_memory_request(request)
        claims = []
        for key, value in request.query_params.multi_items():
            claim_field = _CLAIM_ALIASES.get(key)
            if claim_field is not None or key in _SERVER_NAMESPACE_CLAIMS or key == "session_key":
                claims.append((claim_field or key, value, f"query.{key}"))
        for header_name in ("x-session-id", "x-chat-id"):
            if str(request.headers.get(header_name, "") or "").strip():
                claims.append(("session_key", request.headers.get(header_name), f"header.{header_name}"))

        body: Any = None
        content_type = str(request.headers.get("content-type", "") or "").lower()
        if request.method.upper() not in {"GET", "HEAD"} and "json" in content_type:
            try:
                body = await request.json()
            except Exception:
                body = None  # FastAPI's body parser retains authority for malformed JSON.
        if body is not None:
            claims.extend(_iter_identity_claims(body))

        validate_memory_principal_claims(principal, claims)
        body_idempotency = str(body.get("idempotency_key") or "").strip() if isinstance(body, Mapping) else ""
        header_idempotency = str(
            request.headers.get("x-idempotency-key")
            or request.headers.get("idempotency-key")
            or ""
        ).strip()
        if body_idempotency and header_idempotency and body_idempotency != header_idempotency:
            raise MemoryScopeAuthError("body and header idempotency keys do not match")
        request.state.authenticated_memory_principal = principal
        request.state.memory_idempotency_key = body_idempotency or header_idempotency
        return principal
    except MemoryScopeAuthError as exc:
        status_code = 503 if "not configured" in str(exc) else 403
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


def memory_principal_for_request(request: Request) -> AuthenticatedMemoryPrincipal:
    principal = getattr(request.state, "authenticated_memory_principal", None)
    if not isinstance(principal, AuthenticatedMemoryPrincipal):
        raise HTTPException(status_code=500, detail="authenticated memory principal dependency was not applied")
    return principal


def request_memory_idempotency_key(request: Request, body_value: Optional[str] = None) -> Optional[str]:
    resolved = str(
        body_value
        or getattr(request.state, "memory_idempotency_key", "")
        or ""
    ).strip()
    return resolved or None


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
