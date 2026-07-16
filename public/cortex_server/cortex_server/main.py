"""
The Cortex - Local Knowledge Graph and Tool Server
Main entry point and FastAPI application factory.
"""

from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
import importlib
import hashlib
import hmac
import json
import logging
import math
import os
import sqlite3
from pathlib import Path
import re
from typing import Any, Dict, Mapping, Optional, Tuple

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi

from cortex_server.middleware.error_handler import register_exception_handlers, RequestIDMiddleware
from cortex_server.middleware.request_timeout import RequestTimeoutMiddleware
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.middleware.event_ledger_middleware import EventLedgerMiddleware
from cortex_server.middleware.observability import ObservabilityMiddleware
from cortex_server.middleware.request_body_limit import (
    DEFAULT_BODY_IDLE_TIMEOUT_SECONDS,
    DEFAULT_BODY_TOTAL_TIMEOUT_SECONDS,
    DEFAULT_MAX_BUFFERED_BODY_BYTES,
    DEFAULT_MAX_CONCURRENT_BODY_READS,
    DEFAULT_MAX_UNAUTHENTICATED_BODY_READS,
    DEFAULT_MAX_UNAUTHENTICATED_BUFFERED_BODY_BYTES,
    RequestBodyLimitMiddleware,
    configured_max_request_body_bytes,
)
from cortex_server.middleware.write_authorization import MUTATING_METHODS, WriteAuthorizationMiddleware
from cortex_server.routers import websockets
import asyncio
import subprocess
from dataclasses import dataclass
import threading
import time
import weakref


logger = logging.getLogger(__name__)

DANGEROUS_ROUTERS = {
    "lab_fixed",
    "architect",
    "oracle_budget",
    "plugin_test",
    "test_module",
    "demo",
}

LIFECYCLE_SERVICES = ("redis", "scheduler", "chronos", "awareness")

DEFAULT_REQUIRED_PATHS = frozenset({"/l22/store", "/knowledge/search"})
DEFAULT_REQUIRED_ROUTERS = frozenset({"l22", "knowledge"})
PRODUCTION_REQUIRED_PATHS = DEFAULT_REQUIRED_PATHS | frozenset(
    {"/nexus/orchestrate", "/orchestrator/runtime-delivery/readiness"}
)
PRODUCTION_REQUIRED_ROUTERS = DEFAULT_REQUIRED_ROUTERS | frozenset(
    {"nexus", "orchestrator"}
)


def _not_started_lifecycle_checks():
    return {
        name: {"ok": False, "error": "not started"}
        for name in LIFECYCLE_SERVICES
    }


@dataclass(frozen=True)
class WebSocketSecurityConfig:
    """Security policy captured once for a specific application instance."""

    write_auth_mode: str
    write_token: str
    write_token_header: str
    admin_token: str
    allowed_origins: frozenset[str]


@dataclass(frozen=True)
class ReadinessConfig:
    required_paths: frozenset[str]
    required_routers: frozenset[str]


@dataclass(frozen=True)
class ReadScopeCredential:
    """A principal credential captured when an application is constructed."""

    credential_id: str
    secret: str
    allowed_scopes: Tuple[str, ...]


@dataclass(frozen=True)
class ReadAuthorizationConfig:
    """Immutable read-side security policy for one application instance."""

    credentials: Tuple[ReadScopeCredential, ...]
    admin_token: str
    codec_admin_token: str
    configuration_error: Optional[str] = None

    @property
    def configured(self) -> bool:
        return bool(self.credentials or self.admin_token or self.codec_admin_token)


@dataclass(frozen=True)
class ReadPrincipal:
    """Authenticated identity used to authorize sensitive read surfaces."""

    role: str
    credential_id: str = ""
    tenant_id: str = ""
    workspace_id: str = ""
    storage_workspace_id: str = ""
    agent_id: str = ""
    user_id: str = ""
    channel_id: str = ""
    session_id: str = ""


@dataclass(frozen=True)
class ReadRoutePolicy:
    """Security metadata and matcher captured for one concrete read route."""

    path: str
    methods: frozenset[str]
    policy: str
    path_regex: Any


class SharedServiceStartupError(RuntimeError):
    """A shared service has owners but its singleton task is no longer usable."""


class _SharedServiceOwners:
    """Per-event-loop ownership for services used by app lifespans.

    A threading lock protects only short state transitions.  It is deliberately
    never held across an await, so sequential lifespans created by separate
    event loops cannot inherit an asyncio primitive bound to an old loop.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # Values are removed explicitly by the final owner. Weak keys are an
        # additional safeguard for loops whose startup never acquired a
        # service. A live task may itself retain its loop, so weak keys alone
        # must not be relied on for lifecycle cleanup.
        self._loops = weakref.WeakKeyDictionary()

    @staticmethod
    def _new_loop_state():
        return {
            name: {"owners": {}, "starting": False, "task": None, "error": None}
            for name in ("scheduler", "chronos", "awareness")
        }

    def _state(self, loop, name, *, create=True):
        services = self._loops.get(loop)
        if services is None and create:
            services = self._new_loop_state()
            self._loops[loop] = services
        return None if services is None else services[name]

    def _prune_loop_locked(self, loop):
        services = self._loops.get(loop)
        if services is not None and all(
            not state["owners"] and not state["starting"] and state["task"] is None
            for state in services.values()
        ):
            self._loops.pop(loop, None)

    def registry_size(self):
        """Return the number of loop entries (primarily for diagnostics/tests)."""
        with self._lock:
            return len(self._loops)

    async def acquire(self, name, app, start, rollback=None):
        loop = asyncio.get_running_loop()
        while True:
            with self._lock:
                state = self._state(loop, name)
                if id(app) in state["owners"]:
                    return
                task = state["task"]
                healthy = task is None or not task.done()
                if state["owners"] and healthy and not state["starting"]:
                    state["owners"][id(app)] = app
                    if task is not None:
                        app.state.background_tasks.add(task)
                    app.state.lifecycle_checks[name] = {"ok": True, "error": None}
                    return
                if state["owners"] and not healthy:
                    # Never join or replace a dead singleton while its current
                    # owners still own its cleanup.  Recovery here would either
                    # corrupt the reference count or race the final stop.
                    error = state["error"]
                    if error is None:
                        if task.cancelled():
                            error = "CancelledError: background task was cancelled"
                        else:
                            exception = task.exception()
                            error = (
                                f"{type(exception).__name__}: {exception}"
                                if exception is not None
                                else "RuntimeError: background task exited unexpectedly"
                            )
                        state["error"] = error
                        for owner in state["owners"].values():
                            owner.state.lifecycle_checks[name] = {
                                "ok": False,
                                "error": error,
                            }
                    raise SharedServiceStartupError(
                        f"shared {name} service is unavailable"
                    )
                if not state["owners"] and not state["starting"]:
                    state["starting"] = True
                    break
            # Cross-loop safe waiting: never await a Future/Lock made by a
            # different loop. Startup transitions are expected to be brief.
            await asyncio.sleep(0)

        task = None
        try:
            task = await start()
            if task is not None:
                await asyncio.sleep(0)
                if task.done():
                    task.result()
        except BaseException as exc:
            try:
                if task is not None:
                    if not task.done():
                        task.cancel()
                        await asyncio.gather(task, return_exceptions=True)
                    if rollback is not None:
                        await rollback()
            except BaseException:
                logger.exception("Failed to roll back %s startup cleanly", name)
            finally:
                with self._lock:
                    state = self._state(loop, name)
                    state["starting"] = False
                    state["error"] = f"{type(exc).__name__}: {exc}"
                    self._prune_loop_locked(loop)
            raise

        with self._lock:
            state = self._state(loop, name)
            state["starting"] = False
            state["task"] = task
            state["error"] = None
            state["owners"][id(app)] = app
        app.state.lifecycle_checks[name] = {"ok": True, "error": None}
        if task is not None:
            app.state.background_tasks.add(task)
            task.add_done_callback(
                lambda finished, owner_loop=loop: self._task_finished(
                    owner_loop, name, finished
                )
            )

    def _task_finished(self, loop, name, task):
        if task.cancelled():
            error = "CancelledError: background task was cancelled"
        else:
            try:
                exception = task.exception()
            except asyncio.CancelledError:
                exception = asyncio.CancelledError()
            error = (f"{type(exception).__name__}: {exception}" if exception is not None
                     else "RuntimeError: background task exited unexpectedly")
        with self._lock:
            state = self._state(loop, name, create=False)
            if state is None or state["task"] is not task:
                return
            state["error"] = error
            owners = tuple(state["owners"].values())
        for app in owners:
            app.state.lifecycle_checks[name] = {"ok": False, "error": error}

    async def release(self, name, app, stop):
        loop = asyncio.get_running_loop()
        with self._lock:
            state = self._state(loop, name, create=False)
            if state is None:
                return
            if id(app) not in state["owners"]:
                return
            state["owners"].pop(id(app), None)
            if state["owners"]:
                return
            task = state["task"]
            state["task"] = None
            state["error"] = None
            # Reuse the transition flag while final-owner shutdown is in
            # progress, preventing a new owner from starting into a concurrent
            # stop operation.
            state["starting"] = True
        try:
            if task is not None and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            await stop()
        finally:
            with self._lock:
                state["starting"] = False
                self._prune_loop_locked(loop)


_shared_service_owners = _SharedServiceOwners()


def _effective_routes(routes):
    """Yield concrete routes, expanding lazy router groups recursively."""
    for route in routes:
        effective_candidates = getattr(route, "effective_candidates", None)
        if callable(effective_candidates):
            yield from _effective_routes(effective_candidates())
        else:
            yield route


def _route_paths(routes) -> set[str]:
    """Return concrete paths, including FastAPI's lazily included routers."""
    return {
        path
        for route in _effective_routes(routes)
        if (path := getattr(route, "path", None)) is not None
    }


_READ_SCOPE_FIELDS = (
    "tenant_id",
    "workspace_id",
    "agent_id",
    "user_id",
    "channel_id",
    "session_id",
)
_READ_SCOPE_HEADERS = {
    field: f"x-cortex-{field.replace('_', '-')}" for field in _READ_SCOPE_FIELDS
}
_RUNTIME_ROUTE_PREFIX = r"(?:orchestrator|conductor)"
_RUNTIME_RESOURCE_PATH = re.compile(
    rf"^/{_RUNTIME_ROUTE_PREFIX}/runtime/(?:process|delivery|roadmap|trace|lineage|policy-explain|policy-history|self-review|postmortem)/([^/]+)$"
)
_RUNTIME_TRACEABILITY_PATH = re.compile(
    rf"^/{_RUNTIME_ROUTE_PREFIX}/runtime/processes/([^/]+)/traceability$"
)
_RUNTIME_COLLECTION_PATHS = frozenset(
    f"/{prefix}/runtime/{resource}"
    for prefix in ("orchestrator", "conductor")
    for resource in ("processes", "sessions", "watchers")
)
_RUNTIME_STATUS_PATHS = frozenset(
    f"/{prefix}/runtime/status" for prefix in ("orchestrator", "conductor")
)
_CODEC_ADMIN_READ_ROUTE_PATHS = frozenset(
    {
        "/nexus/codec/status",
        "/nexus/codec/benchmark",
        "/nexus/codec/policy",
        "/nexus/codec/lineage",
        "/nexus/codec/memory/{memory_id}/lineage",
        "/nexus/codec/corpus-replay",
        "/nexus/codec/corpus-replay/live-reexecute/backends",
        "/nexus/codec/corpus-replay/live-reexecute/reports",
        "/nexus/codec/corpus-replay/reports",
        "/nexus/codec/corpus-replay/diff",
        "/nexus/codec/corpus-replay/active-policy",
        "/nexus/codec/corpus-replay/plans",
        "/nexus/codec/corpus-replay/corpus-versions",
        "/nexus/codec/corpus-replay/retention",
        "/nexus/codec/corpus-replay/export",
    }
)
_PRINCIPAL_MUTATION_PREFIXES = (
    "/nexus/orchestrate",
    "/nexus/codec/events",
    "/nexus/outcome/feedback",
    "/nexus/assurance/receipt",
    "/nexus/commit",
    "/nexus/index",
    "/oracle/chat",
    "/augmenter/chat",
    "/knowledge/search",
    "/knowledge/prior-art-gate",
    "/knowledge/query",
    "/knowledge/structural/",
    "/knowledge/nodes",
    "/knowledge/edges",
    "/l22/",
    "/librarian/",
    "/orchestrator/runtime/plan",
    "/conductor/runtime/plan",
    "/orchestrator/runtime/session/",
    "/conductor/runtime/session/",
    "/orchestrator/runtime/watchers/register",
    "/conductor/runtime/watchers/register",
    "/orchestrator/runtime/memory/note",
    "/conductor/runtime/memory/note",
    "/orchestrator/runtime/tools/ingest",
    "/conductor/runtime/tools/ingest",
    "/orchestrator/runtime/delivery/reconcile/",
    "/conductor/runtime/delivery/reconcile/",
    "/orchestrator/runtime/delivery/rollback/",
    "/conductor/runtime/delivery/rollback/",
    "/orchestrator/runtime/roadmap/reconcile/",
    "/conductor/runtime/roadmap/reconcile/",
    "/orchestrator/runtime/policy-apply/",
    "/conductor/runtime/policy-apply/",
    "/orchestrator/runtime/policy-rollback/",
    "/conductor/runtime/policy-rollback/",
    "/orchestrator/runtime/homeostasis/",
    "/conductor/runtime/homeostasis/",
    "/orchestrator/runtime/wake/",
    "/conductor/runtime/wake/",
    "/orchestrator/runtime/cancel/",
    "/conductor/runtime/cancel/",
    "/orchestrator/runtime/pause/",
    "/conductor/runtime/pause/",
    "/orchestrator/runtime/resume/",
    "/conductor/runtime/resume/",
)
_TRANSPORT_AUTH_EXEMPT_RELEASE_PREFIXES = (
    "/orchestrator/runtime/delivery/handoffs/",
    "/conductor/runtime/delivery/handoffs/",
)
_INDEPENDENT_RELEASE_PRINCIPAL_AUTH_PREFIXES = (
    *_TRANSPORT_AUTH_EXEMPT_RELEASE_PREFIXES,
    "/orchestrator/runtime/delivery/artifacts/",
    "/conductor/runtime/delivery/artifacts/",
)
_RUNTIME_MUTATION_RESOURCE_PATH = re.compile(
    rf"^/{_RUNTIME_ROUTE_PREFIX}/runtime/(?:delivery/(?:reconcile|rollback)|roadmap/reconcile|policy-(?:apply|rollback)|homeostasis/(?:freeze|rollback|resume)|(?:wake|cancel|pause|resume))/([^/]+)(?:/[^/]+)?$"
)


def _production_environment() -> bool:
    return os.getenv("CORTEX_ENV", os.getenv("CORTEX_ENVIRONMENT", "development")).strip().lower() in {
        "production",
        "prod",
        "staging",
    }


def _principal_mutation_path_allowed(path: str) -> bool:
    normalized = str(path or "")
    return any(
        normalized == prefix.rstrip("/") or normalized.startswith(prefix)
        for prefix in _PRINCIPAL_MUTATION_PREFIXES
    )


async def _runtime_mutation_resource_id(request) -> Optional[str]:
    match = _RUNTIME_MUTATION_RESOURCE_PATH.fullmatch(str(request.url.path or ""))
    if match:
        return match.group(1)
    if "/runtime/" not in str(request.url.path or ""):
        return None
    try:
        payload = await request.json()
    except Exception:
        return None
    if not isinstance(payload, Mapping):
        return None
    return str(payload.get("process_id") or "").strip() or None


async def _principal_mutation_payload_error(request, principal: ReadPrincipal) -> Optional[str]:
    """Reject a second, conflicting identity embedded in a mutation body."""

    content_type = str(request.headers.get("content-type") or "").lower()
    if "json" not in content_type:
        return None
    try:
        payload = await request.json()
    except Exception:
        return None
    if not isinstance(payload, Mapping):
        return None
    expected = {
        "tenant_id": principal.tenant_id,
        "workspace_id": principal.workspace_id,
        "storage_workspace_id": principal.storage_workspace_id,
        "agent_id": principal.agent_id,
        "user_id": principal.user_id,
        "channel_id": principal.channel_id,
        "session_id": principal.session_id,
    }
    candidates = [payload]
    if isinstance(payload.get("scope"), Mapping):
        candidates.append(payload["scope"])
    for candidate in candidates:
        for field, expected_value in expected.items():
            supplied = str(candidate.get(field) or "").strip()
            if supplied and not hmac.compare_digest(supplied, expected_value):
                return f"mutation payload {field} conflicts with authenticated principal"
        owner = str(candidate.get("owner") or "").strip()
        if owner and owner not in {principal.user_id, principal.agent_id}:
            return "mutation payload owner conflicts with authenticated principal"
    return None
_PUBLIC_REDACTED_READ_PATHS = frozenset(
    {
        "/nexus/context",
        "/nexus/status",
        "/oracle/status",
        "/meta_conductor/status",
        "/orchestrator/runtime-delivery/readiness",
        "/conductor/runtime-delivery/readiness",
    }
)
_PUBLIC_READ_PATHS = frozenset(
    {
        "/",
        "/capabilities",
        "/docs",
        "/docs/oauth2-redirect",
        "/health",
        "/openapi.json",
        "/ready",
        "/redoc",
    }
)
_AUTHENTICATED_REDACTED_READ_PATHS = frozenset(
    {
        "/meta_conductor/kernel/status",
        "/meta_conductor/kernel/telemetry",
        "/mission_control/capabilities",
        "/mission_control/status",
        "/nexus/kernel/status",
        "/nexus/kernel/telemetry",
        "/oracle/kernel/status",
        "/oracle/kernel/telemetry",
        *_RUNTIME_STATUS_PATHS,
    }
)
_READ_POLICY_METADATA_KEY = "x-cortex-read-policy"
_READ_POLICIES = frozenset(
    {
        "public",
        "public_redacted",
        "authenticated_redacted",
        "admin_redacted",
        "runtime_collection",
        "runtime_resource",
        "mission_control_resource",
    }
)
_OPERATIONAL_REDACTED_KEYS = frozenset(
    {
        "active_goals",
        "active_projects",
        "actor_session_key",
        "chat_id",
        "compiled_prompt",
        "conversation_id",
        "cold_context",
        "controller_session_id",
        "durable_facts",
        "failure_patterns",
        "hot_turns",
        "learned_memory",
        "lessons",
        "memory_facts",
        "open_loops",
        "preferences",
        "process_session_key",
        "prompt",
        "prompt_preview",
        "raw_prompt",
        "session_id",
        "session_ids",
        "session_key",
        "session_keys",
        "warm_notes",
    }
)


def _parse_read_scope_credentials(raw: str) -> Tuple[ReadScopeCredential, ...]:
    """Validate and freeze the existing principal-scope credential registry."""
    from cortex_server.modules.memory_scope import (
        MemoryScopeAuthError,
        canonical_memory_scope_message,
        normalize_memory_scope_policy,
    )

    if not str(raw or "").strip():
        return ()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("CORTEX_MEMORY_SCOPE_CREDENTIALS must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError("CORTEX_MEMORY_SCOPE_CREDENTIALS must be a credential object")

    credentials = []
    for raw_id, value in sorted(parsed.items(), key=lambda row: str(row[0])):
        credential_id = str(raw_id or "").strip()
        secret = str((value or {}).get("secret") or "").strip() if isinstance(value, dict) else ""
        allowed = value.get("allowed_scopes") if isinstance(value, dict) else None
        if not secret or not isinstance(allowed, list) or not allowed:
            raise ValueError(f"principal scope credential {credential_id!r} is invalid")
        normalized_scopes = []
        try:
            for scope in allowed:
                if not isinstance(scope, Mapping):
                    raise ValueError(f"principal scope credential {credential_id!r} has an invalid allowed scope")
                normalized = normalize_memory_scope_policy(scope, credential_id)
                session_policy = normalized["session_id"]
                validation_scope = {
                    **{field: normalized[field] for field in _READ_SCOPE_FIELDS[:-1]},
                    "session_id": (
                        f"{session_policy['prefix']}x"
                        if isinstance(session_policy, Mapping)
                        else session_policy
                    ),
                }
                # This validates the credential id with the same bounded opaque
                # identifier rules used by the memory boundary.
                canonical_memory_scope_message(credential_id, validation_scope)
                normalized_scopes.append(
                    json.dumps(normalized, sort_keys=True, separators=(",", ":"))
                )
        except MemoryScopeAuthError as exc:
            raise ValueError(str(exc)) from exc
        credentials.append(
            ReadScopeCredential(
                credential_id=credential_id,
                secret=secret,
                allowed_scopes=tuple(normalized_scopes),
            )
        )
    return tuple(credentials)


def _declared_read_policy(path: str) -> str:
    """Return the policy to attach to a route during inventory construction.

    The small public/authenticated sets and resource-shaped routes are explicit.
    Everything else is administrator-only, which makes newly loaded read routes
    fail closed instead of inheriting access from their spelling.
    """
    normalized = str(path or "/").rstrip("/") or "/"
    if normalized in _PUBLIC_READ_PATHS:
        return "public"
    if normalized in _PUBLIC_REDACTED_READ_PATHS:
        return "public_redacted"
    if normalized in _AUTHENTICATED_REDACTED_READ_PATHS:
        return "authenticated_redacted"
    if normalized in _RUNTIME_COLLECTION_PATHS:
        return "runtime_collection"
    if _RUNTIME_RESOURCE_PATH.fullmatch(normalized) or _RUNTIME_TRACEABILITY_PATH.fullmatch(normalized):
        return "runtime_resource"
    if re.fullmatch(r"/mission_control/objectives/[^/]+(?:/activity|/lineage)?", normalized):
        return "mission_control_resource"
    return "admin_redacted"


def _attach_read_route_policies(app: FastAPI) -> Tuple[ReadRoutePolicy, ...]:
    """Attach explicit metadata to every concrete GET/HEAD route."""
    inventory = []
    for route in _effective_routes(app.routes):
        methods = frozenset(
            str(method).upper() for method in (getattr(route, "methods", None) or ())
        )
        read_methods = methods & {"GET", "HEAD"}
        path = str(getattr(route, "path", "") or "")
        if not read_methods or not path:
            continue
        extra = dict(getattr(route, "openapi_extra", None) or {})
        policy = str(extra.get(_READ_POLICY_METADATA_KEY) or _declared_read_policy(path))
        if policy not in _READ_POLICIES:
            raise RuntimeError(f"invalid read policy {policy!r} declared for {path}")
        extra[_READ_POLICY_METADATA_KEY] = policy
        if hasattr(route, "openapi_extra"):
            route.openapi_extra = extra
        setattr(route, "cortex_read_policy", policy)
        path_regex = getattr(route, "path_regex", None)
        if path_regex is None:
            path_regex = re.compile(f"^{re.escape(path)}$")
        inventory.append(
            ReadRoutePolicy(
                path=path,
                methods=read_methods,
                policy=policy,
                path_regex=path_regex,
            )
        )
    return tuple(inventory)


def _read_surface_policy(
    path: str,
    method: str,
    inventory: Tuple[ReadRoutePolicy, ...],
) -> str:
    """Resolve only pre-attached route metadata; unknown reads fail closed."""
    normalized_method = str(method or "GET").upper()
    for route_policy in inventory:
        if normalized_method in route_policy.methods and route_policy.path_regex.fullmatch(path):
            return route_policy.policy
    return "admin_redacted"


def _read_scope_values(headers) -> Optional[Dict[str, str]]:
    values = {
        field: str(headers.get(header_name, "") or "").strip()
        for field, header_name in _READ_SCOPE_HEADERS.items()
    }
    if not any(values.values()):
        return None
    if not all(values.values()):
        return {}
    return values


def _authenticate_sensitive_read(request, config: ReadAuthorizationConfig) -> Tuple[Optional[ReadPrincipal], Optional[str]]:
    """Authenticate an admin token or a fully signed Cortex principal scope."""
    from cortex_server.middleware.write_authorization import token_matches
    from cortex_server.modules.memory_scope import (
        AuthenticatedMemoryPrincipal,
        canonical_memory_scope_message,
        memory_scope_policy_matches,
        normalize_principal_scope,
    )

    if token_matches(request.headers.get("x-cortex-admin-token", ""), config.admin_token):
        return ReadPrincipal(role="admin", credential_id="cortex-admin"), None
    if token_matches(request.headers.get("x-cortex-codec-admin-token", ""), config.codec_admin_token):
        return ReadPrincipal(role="codec_admin", credential_id="codec-admin"), None

    if config.configuration_error:
        return None, "sensitive read authorization is misconfigured"
    if not config.configured:
        return None, "sensitive read authorization is not configured"

    scope = _read_scope_values(request.headers)
    credential_id = str(request.headers.get("x-cortex-scope-credential-id", "") or "").strip()
    signature = str(request.headers.get("x-cortex-scope-signature", "") or "").strip()
    if scope is None and not credential_id and not signature:
        return None, "sensitive read authorization required"
    if not scope or not credential_id or not signature:
        return None, "full signed principal scope is required"

    credential = next(
        (row for row in config.credentials if row.credential_id == credential_id),
        None,
    )
    if credential is None:
        return None, "sensitive read authorization required"
    try:
        normalized_scope = normalize_principal_scope(scope)
        allowed = any(
            memory_scope_policy_matches(
                normalized_scope,
                json.loads(policy),
                credential.credential_id,
            )
            for policy in credential.allowed_scopes
        )
    except (ValueError, json.JSONDecodeError):
        return None, "invalid principal scope"
    if not allowed:
        return None, "principal is not authorized for the requested scope"
    try:
        message = canonical_memory_scope_message(credential_id, normalized_scope)
    except ValueError:
        return None, "invalid principal scope"
    expected = hmac.new(
        credential.secret.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None, "sensitive read authorization required"
    memory_principal = AuthenticatedMemoryPrincipal(
        credential_id=credential_id,
        **normalized_scope,
    )
    return ReadPrincipal(
        role="principal",
        credential_id=credential_id,
        storage_workspace_id=memory_principal.storage_workspace_id,
        **normalized_scope,
    ), None


def _codec_admin_read_path_allowed(
    path: str,
    method: str,
    inventory: Tuple[ReadRoutePolicy, ...],
) -> bool:
    """Authorize the specialized credential only on enumerated codec reads."""

    normalized_method = str(method or "GET").upper()
    return any(
        route_policy.path in _CODEC_ADMIN_READ_ROUTE_PATHS
        and normalized_method in route_policy.methods
        and route_policy.path_regex.fullmatch(path)
        for route_policy in inventory
    )


def _runtime_process_for_read_authorization(process_id: str) -> Optional[Dict[str, Any]]:
    """Resolve a runtime resource at the authorization boundary."""
    from cortex_server.modules.reasoning_scheduler import load_state

    process = (load_state().get("processes") or {}).get(str(process_id or ""))
    return dict(process) if isinstance(process, dict) else None


def _resource_identity_values(
    process: Mapping[str, Any],
) -> Tuple[set[str], set[str], set[str], set[str], set[str]]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), Mapping) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), Mapping) else {}
    scopes = [process, metadata]
    for container in (process, metadata):
        for key in ("principal", "principal_scope", "scope"):
            value = container.get(key) if isinstance(container, Mapping) else None
            if isinstance(value, Mapping):
                scopes.append(value)

    tenants = {
        str(scope.get("tenant_id") or "").strip()
        for scope in scopes
        if str(scope.get("tenant_id") or "").strip()
    }
    storage_workspaces = {
        str(scope.get("storage_workspace_id") or "").strip()
        for scope in scopes
        if str(scope.get("storage_workspace_id") or "").strip()
    }
    owners = {
        str(scope.get("owner") or "").strip()
        for scope in scopes
        if str(scope.get("owner") or "").strip()
    }
    users = {
        str(scope.get("user_id") or "").strip()
        for scope in scopes
        if str(scope.get("user_id") or "").strip()
    }
    agents = {
        str(scope.get("agent_id") or "").strip()
        for scope in scopes
        if str(scope.get("agent_id") or "").strip()
    }
    return tenants, storage_workspaces, owners, users, agents


def _principal_can_read_process(principal: ReadPrincipal, process: Optional[Mapping[str, Any]]) -> bool:
    if principal.role == "admin":
        return True
    if not isinstance(process, Mapping):
        return False
    tenants, storage_workspaces, owners, users, agents = _resource_identity_values(process)
    if tenants != {principal.tenant_id}:
        return False
    if storage_workspaces != {principal.storage_workspace_id}:
        return False

    # Ownership metadata must be complete enough to bind the resource to this
    # exact principal. Conflicting or legacy-unowned resources are admin-only.
    if users != {principal.user_id}:
        return False
    if agents != {principal.agent_id}:
        return False
    principal_owners = {principal.user_id, principal.agent_id} - {""}
    if not owners or not owners.issubset(principal_owners):
        return False
    return True


def _runtime_resource_id(path: str, query_params) -> Optional[str]:
    normalized = str(path or "/").rstrip("/") or "/"
    match = _RUNTIME_RESOURCE_PATH.fullmatch(normalized) or _RUNTIME_TRACEABILITY_PATH.fullmatch(normalized)
    if match:
        return match.group(1)
    if normalized in {
        "/orchestrator/runtime/sessions",
        "/orchestrator/runtime/watchers",
        "/conductor/runtime/sessions",
        "/conductor/runtime/watchers",
    }:
        return str(query_params.get("process_id") or "").strip() or None
    return None


def _redacted_value(value: Any) -> Any:
    if isinstance(value, list):
        return []
    if isinstance(value, Mapping):
        return {}
    return "[REDACTED]"


def _redact_operational_payload(value: Any) -> Any:
    """Recursively remove raw user/session/memory material from telemetry."""
    if isinstance(value, list):
        return [_redact_operational_payload(item) for item in value]
    if not isinstance(value, Mapping):
        return value
    redacted = {}
    for key, item in value.items():
        normalized = str(key).strip().lower().replace("-", "_")
        sensitive = (
            normalized in _OPERATIONAL_REDACTED_KEYS
            or "prompt" in normalized
            or ("session" in normalized and (normalized.endswith("_id") or normalized.endswith("_key") or normalized.endswith("_ids") or normalized.endswith("_keys")))
        )
        redacted[key] = _redacted_value(item) if sensitive else _redact_operational_payload(item)
    return redacted


def _filter_runtime_collection(payload: Any, principal: ReadPrincipal) -> Any:
    if principal.role == "admin" or not isinstance(payload, dict):
        return payload
    collection_key = next(
        (key for key in ("processes", "sessions", "watchers") if isinstance(payload.get(key), list)),
        None,
    )
    if collection_key is None:
        return payload

    authorized = []
    for row in payload[collection_key]:
        if not isinstance(row, Mapping):
            continue
        process_id = str(row.get("process_id") or "").strip()
        process = row if collection_key == "processes" else _runtime_process_for_read_authorization(process_id)
        if process_id and _principal_can_read_process(principal, process):
            authorized.append(row)
    filtered = dict(payload)
    filtered[collection_key] = authorized
    for count_key in ("total", "count", f"{collection_key[:-1]}_count"):
        if count_key in filtered:
            filtered[count_key] = len(authorized)
    return filtered


async def _transform_sensitive_json_response(response, *, principal: Optional[ReadPrincipal], policy: str):
    """Transform only JSON reads while preserving status, headers, and background work."""
    from starlette.responses import Response

    content_type = str(response.headers.get("content-type") or "").lower()
    if "application/json" not in content_type:
        return response
    body = b"".join([chunk async for chunk in response.body_iterator])
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            background=response.background,
        )

    if policy == "runtime_collection" and principal is not None:
        payload = _filter_runtime_collection(payload, principal)
    if policy.endswith("_redacted"):
        payload = _redact_operational_payload(payload)
    transformed = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = dict(response.headers)
    headers.pop("content-length", None)
    return Response(
        content=transformed,
        status_code=response.status_code,
        headers=headers,
        background=response.background,
    )


def load_dynamic_routers(app: FastAPI, *, safe_mode: bool = True) -> dict:
    """Dynamically discover and mount routers from cortex_server.routers."""
    routers_dir = Path(__file__).parent / "routers"
    report = {"loaded": [], "safeModeSkipped": [], "failed": [], "missingRouter": []}
    for file_path in routers_dir.glob("*.py"):
        module_name = file_path.stem
        if module_name == "__init__" or module_name.startswith("_"):
            continue
        if module_name == "websockets":
            continue
        if safe_mode and module_name in DANGEROUS_ROUTERS:
            logger.warning("SAFE_MODE: skipping dangerous router '%s'", module_name)
            report["safeModeSkipped"].append(module_name)
            continue
        try:
            module = importlib.import_module(f"cortex_server.routers.{module_name}")
        except Exception as e:
            logger.warning("Skipping router '%s' due to import error: %s", module_name, e)
            report["failed"].append({"router": module_name, "error": f"{type(e).__name__}: {e}"})
            continue
        router = getattr(module, "router", None)
        if router is not None:
            app.include_router(router, prefix=f"/{module_name}", tags=[module_name.title()])
            report["loaded"].append(module_name)
        else:
            report["missingRouter"].append(module_name)
    for key in ("loaded", "safeModeSkipped", "missingRouter"):
        report[key].sort()
    report["failed"].sort(key=lambda row: row["router"])
    app.state.router_load_report = report
    return report


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    from cortex_server.services.parser_service import ParserService

    parser_workspace_roots = tuple(
        str(Path(value).expanduser().resolve())
        for value in os.getenv("CORTEX_WORKSPACE_ROOTS", os.getcwd()).split(os.pathsep)
        if value
    )
    production_environment = _production_environment()
    write_auth_mode = os.getenv("CORTEX_WRITE_AUTH_MODE", "token_or_loopback").strip().lower()
    write_token = os.getenv("CORTEX_WRITE_TOKEN", "").strip()
    write_token_header = os.getenv("CORTEX_WRITE_TOKEN_HEADER", "x-cortex-write-token").strip().lower()
    max_request_body_bytes = configured_max_request_body_bytes(
        os.getenv("CORTEX_MAX_REQUEST_BODY_BYTES")
    )
    def _bounded_body_float(name: str, default: float, maximum: float) -> float:
        try:
            value = float(os.getenv(name, str(default)))
            if not math.isfinite(value) or value <= 0:
                raise ValueError
        except ValueError as exc:
            raise RuntimeError(f"{name} must be a positive finite number") from exc
        return min(value, maximum)

    def _bounded_body_int(name: str, default: int, maximum: int) -> int:
        raw = os.getenv(name, str(default)).strip()
        if not raw.isdecimal() or int(raw) <= 0:
            raise RuntimeError(f"{name} must be a positive integer")
        return min(int(raw), maximum)

    body_idle_timeout_seconds = _bounded_body_float(
        "CORTEX_BODY_IDLE_TIMEOUT_SECONDS", DEFAULT_BODY_IDLE_TIMEOUT_SECONDS, 10.0
    )
    body_total_timeout_seconds = _bounded_body_float(
        "CORTEX_BODY_TOTAL_TIMEOUT_SECONDS", DEFAULT_BODY_TOTAL_TIMEOUT_SECONDS, 30.0
    )
    max_concurrent_body_reads = _bounded_body_int(
        "CORTEX_MAX_CONCURRENT_BODY_READS", DEFAULT_MAX_CONCURRENT_BODY_READS, 256
    )
    max_buffered_body_bytes = _bounded_body_int(
        "CORTEX_MAX_BUFFERED_BODY_BYTES", DEFAULT_MAX_BUFFERED_BODY_BYTES, 256 * 1024 * 1024
    )
    max_unauthenticated_body_reads = _bounded_body_int(
        "CORTEX_MAX_UNAUTHENTICATED_BODY_READS",
        DEFAULT_MAX_UNAUTHENTICATED_BODY_READS,
        16,
    )
    max_unauthenticated_buffered_body_bytes = _bounded_body_int(
        "CORTEX_MAX_UNAUTHENTICATED_BUFFERED_BODY_BYTES",
        DEFAULT_MAX_UNAUTHENTICATED_BUFFERED_BODY_BYTES,
        32 * 1024 * 1024,
    )
    safe_mode = os.getenv("CORTEX_SAFE_MODE", "true").lower() in {"1", "true", "yes", "on"}
    admin_token = os.getenv("CORTEX_ADMIN_TOKEN", "").strip()
    codec_admin_token = os.getenv("CORTEX_CODEC_ADMIN_TOKEN", "").strip() or admin_token
    read_configuration_error = None
    try:
        read_credentials = _parse_read_scope_credentials(
            os.getenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", "")
        )
    except ValueError as exc:
        if production_environment:
            raise RuntimeError(f"invalid production principal credential registry: {exc}") from exc
        read_credentials = ()
        read_configuration_error = str(exc)
    if production_environment and not read_credentials:
        raise RuntimeError("production requires at least one valid principal scope credential")
    read_authorization = ReadAuthorizationConfig(
        credentials=read_credentials,
        admin_token=admin_token,
        codec_admin_token=codec_admin_token,
        configuration_error=read_configuration_error,
    )
    if production_environment:
        from cortex_server.runtime.production_build_loop import validate_production_delivery_credentials

        validate_production_delivery_credentials()
    baseline_required_paths = (
        PRODUCTION_REQUIRED_PATHS if production_environment else DEFAULT_REQUIRED_PATHS
    )
    baseline_required_routers = (
        PRODUCTION_REQUIRED_ROUTERS if production_environment else DEFAULT_REQUIRED_ROUTERS
    )
    readiness_config = ReadinessConfig(
        required_paths=baseline_required_paths
        | frozenset(
            value.strip()
            for value in os.getenv("CORTEX_REQUIRED_PATHS", "").split(",")
            if value.strip()
        ),
        required_routers=baseline_required_routers
        | frozenset(
            value.strip()
            for value in os.getenv("CORTEX_REQUIRED_ROUTERS", "").split(",")
            if value.strip()
        ),
    )
    fail_closed_memory = os.getenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "true").lower() in {"1", "true", "yes", "on"}
    try:
        redis_startup_timeout = float(os.getenv("CORTEX_REDIS_STARTUP_TIMEOUT_SECONDS", "2.0"))
        if not math.isfinite(redis_startup_timeout):
            raise ValueError
    except ValueError:
        redis_startup_timeout = 2.0
    # Configuration must not be able to turn startup into an unbounded wait.
    redis_startup_timeout = min(max(redis_startup_timeout, 0.1), 30.0)
    try:
        redis_monitor_interval = float(
            os.getenv("CORTEX_REDIS_MONITOR_INTERVAL_SECONDS", "5.0")
        )
        if not math.isfinite(redis_monitor_interval):
            raise ValueError
    except ValueError:
        redis_monitor_interval = 5.0
    redis_monitor_interval = min(max(redis_monitor_interval, 0.1), 300.0)
    allowed_origins = frozenset(
        origin.strip()
        for origin in os.getenv(
            "CORTEX_ALLOW_ORIGINS", "http://localhost,https://localhost"
        ).split(",")
        if origin.strip()
    )
    websocket_security = WebSocketSecurityConfig(
        write_auth_mode=write_auth_mode,
        write_token=write_token,
        write_token_header=write_token_header,
        admin_token=admin_token,
        allowed_origins=allowed_origins,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.lifecycle_checks = _not_started_lifecycle_checks()
        # Initialize every cleanup reference before the first operation that can
        # fail.  In particular, cancellation may arrive at any startup await.
        redis_worker = None
        redis_monitor = None
        redis_executor = None
        acquired = []
        app.state.background_tasks = set()
        try:
            if fail_closed_memory:
                route_paths = _route_paths(app.routes)
                required_paths = {"/l22/store", "/knowledge/search"}
                missing_paths = sorted(required_paths - route_paths)
                if missing_paths:
                    raise RuntimeError(
                        f"Fail-closed startup: missing required memory endpoints: {', '.join(missing_paths)}"
                    )

            def start_and_check_redis() -> None:
                result = subprocess.run(
                    ["redis-server", "--daemonize", "yes"], check=False,
                    timeout=redis_startup_timeout,
                )
                if result.returncode != 0:
                    raise RuntimeError(f"redis-server exited with status {result.returncode}")
                from cortex_server.worker import check_redis_connection
                if check_redis_connection() is not True:
                    raise RuntimeError("Redis connectivity check did not confirm readiness")

            redis_executor = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="cortex-redis"
            )
            async def run_redis_check(function):
                # Poll the owned executor future so lifecycle shutdown does not
                # depend on a cross-thread event-loop callback being delivered
                # after cancellation has begun.
                future = redis_executor.submit(function)
                while not future.done():
                    await asyncio.sleep(0.01)
                return future.result()

            redis_worker = asyncio.create_task(
                run_redis_check(start_and_check_redis), name="cortex-redis-startup"
            )
            redis_startup_pending = False
            try:
                await asyncio.wait_for(asyncio.shield(redis_worker), timeout=redis_startup_timeout)
                app.state.lifecycle_checks["redis"] = {"ok": True, "error": None}
                logger.info("Redis is reachable for background task processing")
            except asyncio.TimeoutError:
                redis_startup_pending = True
                error = f"Redis startup timed out after {redis_startup_timeout:g} seconds"
                app.state.lifecycle_checks["redis"] = {"ok": False, "error": error}
                logger.warning("Redis is not ready: %s", error)
            except subprocess.TimeoutExpired:
                error = f"Redis startup timed out after {redis_startup_timeout:g} seconds"
                app.state.lifecycle_checks["redis"] = {"ok": False, "error": error}
                logger.warning("Redis is not ready: %s", error)
            except Exception as e:
                app.state.lifecycle_checks["redis"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                logger.warning("Redis is not ready: %s", e)

            async def monitor_redis() -> None:
                from cortex_server.worker import check_redis_connection

                previously_ok = app.state.lifecycle_checks["redis"]["ok"]
                if redis_startup_pending:
                    try:
                        await asyncio.shield(redis_worker)
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        app.state.lifecycle_checks["redis"] = {
                            "ok": False,
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                        logger.warning("Late Redis startup failed: %s", exc)
                        previously_ok = False
                    else:
                        app.state.lifecycle_checks["redis"] = {
                            "ok": True,
                            "error": None,
                        }
                        logger.info("Redis connectivity recovered after startup timeout")
                        previously_ok = True

                while True:
                    await asyncio.sleep(redis_monitor_interval)
                    connectivity_check = asyncio.create_task(
                        run_redis_check(check_redis_connection),
                        name="cortex-redis-connectivity-check",
                    )
                    try:
                        reachable = await asyncio.shield(connectivity_check)
                        if reachable is not True:
                            raise RuntimeError(
                                "Redis connectivity check did not confirm readiness"
                            )
                    except asyncio.CancelledError:
                        # Cancelling an asyncio wrapper cannot stop a function that is
                        # already running in an executor. Observe the bounded socket
                        # check before allowing lifespan shutdown to complete.
                        await asyncio.gather(connectivity_check, return_exceptions=True)
                        raise
                    except Exception as exc:
                        app.state.lifecycle_checks["redis"] = {
                            "ok": False,
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                        if previously_ok:
                            logger.warning("Redis connectivity monitor failed: %s", exc)
                        previously_ok = False
                    else:
                        app.state.lifecycle_checks["redis"] = {
                            "ok": True,
                            "error": None,
                        }
                        if not previously_ok:
                            logger.info("Redis connectivity recovered")
                        previously_ok = True

            redis_monitor = asyncio.create_task(
                monitor_redis(), name="cortex-redis-monitor"
            )

            async def stop_service(name):
                if name == "awareness":
                    from cortex_server.routers.awareness import stop_awareness
                    await stop_awareness()
                elif name == "chronos":
                    from cortex_server.modules.chronos import get_chronos
                    get_chronos().stop()
                else:
                    from cortex_server.scheduler import stop_scheduler
                    await stop_scheduler()

            try:
                from cortex_server.scheduler import start_scheduler
                async def start_main_scheduler():
                    start_scheduler()
                await _shared_service_owners.acquire(
                    "scheduler", app, start_main_scheduler,
                    lambda: stop_service("scheduler"),
                )
                acquired.append("scheduler")
            except Exception as e:
                app.state.lifecycle_checks["scheduler"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                logger.warning("Scheduler is not ready: %s", e)
            try:
                from cortex_server.modules.chronos import get_chronos
                async def start_chronos():
                    return asyncio.create_task(get_chronos().start_scheduler(), name="cortex-chronos")
                await _shared_service_owners.acquire(
                    "chronos", app, start_chronos,
                    lambda: stop_service("chronos"),
                )
                acquired.append("chronos")
            except Exception as e:
                app.state.lifecycle_checks["chronos"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                logger.warning("Chronos is not ready: %s", e)
            try:
                from cortex_server.routers.awareness import start_awareness
                await _shared_service_owners.acquire(
                    "awareness", app, start_awareness,
                    lambda: stop_service("awareness"),
                )
                acquired.append("awareness")
            except Exception as e:
                app.state.lifecycle_checks["awareness"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                logger.warning("Awareness is not ready: %s", e)
            yield
        finally:
            try:
                if redis_monitor is not None:
                    redis_monitor.cancel()
                    await asyncio.gather(redis_monitor, return_exceptions=True)
                # The worker has enforceable subprocess and socket timeouts. Keep it
                # strongly referenced and observe it before the lifespan disappears.
                if redis_worker is not None:
                    await asyncio.gather(redis_worker, return_exceptions=True)
                if redis_executor is not None:
                    redis_executor.shutdown(wait=True, cancel_futures=True)
                for name in reversed(acquired):
                    try:
                        await _shared_service_owners.release(
                            name, app, lambda name=name: stop_service(name)
                        )
                    except BaseException:
                        logger.exception("Failed to stop %s cleanly", name)
            finally:
                app.state.lifecycle_checks = _not_started_lifecycle_checks()

    app = FastAPI(
        title="The Cortex",
        description="Local Knowledge Graph and Tool Server",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )
    app.state.websocket_security = websocket_security
    app.state.readiness_config = readiness_config
    app.state.read_authorization = read_authorization
    app.state.max_request_body_bytes = max_request_body_bytes
    app.state.request_body_admission = {
        "idle_timeout_seconds": body_idle_timeout_seconds,
        "total_timeout_seconds": body_total_timeout_seconds,
        "max_concurrent_body_reads": max_concurrent_body_reads,
        "max_buffered_body_bytes": max_buffered_body_bytes,
        "max_unauthenticated_body_reads": max_unauthenticated_body_reads,
        "max_unauthenticated_buffered_body_bytes": max_unauthenticated_buffered_body_bytes,
    }
    app.state.lifecycle_checks = _not_started_lifecycle_checks()
    app.state.parser_service = ParserService(workspace_roots=parser_workspace_roots)

    app.add_middleware(
        WriteAuthorizationMiddleware,
        mode=write_auth_mode,
        token=write_token,
        header_name=write_token_header,
        allowed_origins=allowed_origins,
        exempt_prefixes=_TRANSPORT_AUTH_EXEMPT_RELEASE_PREFIXES,
        sensitive_prefixes=("/nexus/codec",),
        sensitive_token=codec_admin_token,
        sensitive_exempt_paths=("/nexus/codec/events",),
    )

    @app.middleware("http")
    async def admin_guard(request, call_next):
        if safe_mode and request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            p = request.url.path
            if any(p.startswith(f"/{r}/") or p == f"/{r}" for r in DANGEROUS_ROUTERS):
                if not admin_token or request.headers.get("x-cortex-admin-token", "") != admin_token:
                    from fastapi.responses import JSONResponse
                    return JSONResponse(status_code=403, content={"success": False, "error": "admin token required"})
        if production_environment and request.method.upper() in MUTATING_METHODS:
            path = str(request.url.path or "")
            if any(path.startswith(prefix) for prefix in _INDEPENDENT_RELEASE_PRINCIPAL_AUTH_PREFIXES):
                # Release consumers use revision-bound recipient/verifier
                # HMACs. Artifact ingestion still passes through the separate
                # transport write-token middleware; public handoff claims do
                # not because their recipient credential is the transport.
                return await call_next(request)
            principal, error = _authenticate_sensitive_read(request, read_authorization)
            if principal is None:
                from fastapi.responses import JSONResponse

                unavailable = "not configured" in str(error) or "misconfigured" in str(error)
                return JSONResponse(
                    status_code=503 if unavailable else 403,
                    content={"success": False, "error": error},
                )
            request.state.cortex_principal = principal
            is_global_admin = (
                principal.role == "admin"
                and principal.credential_id == "cortex-admin"
            )
            is_codec_admin_for_codec = (
                principal.role == "codec_admin"
                and principal.credential_id == "codec-admin"
                and (path == "/nexus/codec" or path.startswith("/nexus/codec/"))
            )
            if not is_global_admin and not is_codec_admin_for_codec:
                if principal.role != "principal":
                    from fastapi.responses import JSONResponse

                    return JSONResponse(
                        status_code=403,
                        content={"success": False, "error": "administrator authorization required for global mutation"},
                    )
                if not _principal_mutation_path_allowed(path):
                    from fastapi.responses import JSONResponse

                    return JSONResponse(
                        status_code=403,
                        content={"success": False, "error": "administrator authorization required for global mutation"},
                    )
                payload_error = await _principal_mutation_payload_error(request, principal)
                if payload_error:
                    from fastapi.responses import JSONResponse

                    return JSONResponse(
                        status_code=403,
                        content={"success": False, "error": payload_error},
                    )
                process_id = await _runtime_mutation_resource_id(request)
                if process_id:
                    process = _runtime_process_for_read_authorization(process_id)
                    if not _principal_can_read_process(principal, process):
                        from fastapi.responses import JSONResponse

                        return JSONResponse(
                            status_code=403,
                            content={"success": False, "error": "principal does not own the runtime resource"},
                        )
        if request.method.upper() not in {"GET", "HEAD"}:
            return await call_next(request)
        policy = _read_surface_policy(
            request.url.path,
            request.method,
            getattr(app.state, "read_route_policies", ()),
        )
        if policy == "public":
            return await call_next(request)

        principal = None
        if policy != "public_redacted":
            principal, error = _authenticate_sensitive_read(request, read_authorization)
            if principal is None:
                from fastapi.responses import JSONResponse

                unavailable = "not configured" in str(error) or "misconfigured" in str(error)
                return JSONResponse(
                    status_code=503 if unavailable else 403,
                    content={"success": False, "error": error},
                )
            if principal.role == "codec_admin" and not _codec_admin_read_path_allowed(
                request.url.path,
                request.method,
                getattr(app.state, "read_route_policies", ()),
            ):
                from fastapi.responses import JSONResponse

                return JSONResponse(
                    status_code=403,
                    content={"success": False, "error": "codec administrator credential is restricted to codec reads"},
                )
            if policy.startswith("admin_") and principal.role not in {"admin", "codec_admin"}:
                from fastapi.responses import JSONResponse

                return JSONResponse(
                    status_code=403,
                    content={"success": False, "error": "administrator read authorization required"},
                )

            resource_id = _runtime_resource_id(request.url.path, request.query_params)
            if policy in {"runtime_resource", "mission_control_resource"}:
                if policy == "mission_control_resource":
                    resource_id = str(request.url.path.split("/objectives/", 1)[1].split("/", 1)[0]).strip()
                process = _runtime_process_for_read_authorization(resource_id or "")
                if process is not None and not _principal_can_read_process(principal, process):
                    from fastapi.responses import JSONResponse

                    return JSONResponse(
                        status_code=403,
                        content={"success": False, "error": "principal is not authorized for this resource"},
                    )
                if process is None and principal.role != "admin":
                    # Do not let a signed principal use an unowned or unknown
                    # resource id to reach secondary stores keyed by that id.
                    from fastapi.responses import JSONResponse

                    return JSONResponse(
                        status_code=404,
                        content={"success": False, "error": "resource not found"},
                    )
            elif policy == "runtime_collection" and resource_id:
                process = _runtime_process_for_read_authorization(resource_id)
                if process is None:
                    from fastapi.responses import JSONResponse

                    return JSONResponse(
                        status_code=404,
                        content={"success": False, "error": "resource not found"},
                    )
                if not _principal_can_read_process(principal, process):
                    from fastapi.responses import JSONResponse

                    return JSONResponse(
                        status_code=403,
                        content={"success": False, "error": "principal is not authorized for this resource"},
                    )
            request.state.cortex_read_principal = principal

        response = await call_next(request)
        if request.method.upper() == "HEAD" or response.status_code == 204:
            return response
        return await _transform_sensitive_json_response(
            response,
            principal=principal,
            policy=policy,
        )

    # CORS middleware (tightened default; configurable via env)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Custom middleware
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(ObservabilityMiddleware)
    app.add_middleware(RequestTimeoutMiddleware, timeout_seconds=30, exclude_paths=["/health", "/", "/oracle/chat", "/oracle/status", "/oracle/ledger", "/augmenter/chat", "/bard/speak", "/homeassistant/voice/assist_tts"])
    app.add_middleware(EventLedgerMiddleware)
    app.add_middleware(HUDMiddleware)
    # This must remain the last added user middleware: Starlette places the
    # most recently added middleware outermost, before auth and body parsing.
    app.add_middleware(
        RequestBodyLimitMiddleware,
        max_body_bytes=max_request_body_bytes,
        idle_timeout_seconds=body_idle_timeout_seconds,
        total_timeout_seconds=body_total_timeout_seconds,
        max_concurrent_body_reads=max_concurrent_body_reads,
        max_buffered_body_bytes=max_buffered_body_bytes,
        max_unauthenticated_body_reads=max_unauthenticated_body_reads,
        max_unauthenticated_buffered_body_bytes=max_unauthenticated_buffered_body_bytes,
        write_auth_mode=write_auth_mode,
        write_token=write_token,
        write_token_header=write_token_header,
        allowed_origins=tuple(allowed_origins),
        auth_exempt_prefixes=_TRANSPORT_AUTH_EXEMPT_RELEASE_PREFIXES,
    )
    register_exception_handlers(app)

    # API Routers
    router_load_report = load_dynamic_routers(app, safe_mode=safe_mode)
    app.include_router(websockets.router, tags=["WebSockets"])

    def readiness_payload() -> dict:
        route_paths = _route_paths(app.routes)
        required_paths = readiness_config.required_paths
        required_routers = readiness_config.required_routers
        loaded_routers = set(router_load_report["loaded"])
        missing_paths = sorted(required_paths - route_paths)
        missing_routers = sorted(required_routers - loaded_routers)
        configured_graph = os.getenv("CORTEX_DB_PATH", "").strip()
        graph_path = Path(configured_graph or ("/opt/clawdbot/state/knowledge/cortex_graph.db" if production_environment else Path(__file__).resolve().parents[2] / "cortex_graph.db")).expanduser().resolve()
        graph_error = None
        graph_quick_check = None
        try:
            if not graph_path.is_file() or graph_path.is_symlink():
                raise RuntimeError("configured graph database is not a regular file")
            if production_environment and Path("/opt/clawdbot/state") not in graph_path.parents:
                raise RuntimeError("production graph database is outside the durable state volume")
            with sqlite3.connect(f"file:{graph_path}?mode=ro", uri=True, timeout=2.0) as connection:
                row = connection.execute("PRAGMA quick_check").fetchone()
            graph_quick_check = str(row[0] if row else "")
            if graph_quick_check != "ok":
                raise RuntimeError(f"graph database quick_check failed: {graph_quick_check}")
        except (OSError, RuntimeError, sqlite3.Error) as exc:
            graph_error = f"{type(exc).__name__}: {exc}"
        try:
            from cortex_server.middleware.event_ledger_middleware import probe_event_ledger_durability

            event_ledger_check = probe_event_ledger_durability()
        except Exception as exc:
            event_ledger_check = {"ok": False, "status": "degraded", "error": f"{type(exc).__name__}: {exc}"}
        try:
            from cortex_server.routers.librarian import probe_memory_backend_readiness

            memory_backend_check = probe_memory_backend_readiness()
        except Exception as exc:
            memory_backend_check = {"ok": False, "status": "degraded", "error": f"{type(exc).__name__}: {exc}"}
        try:
            from cortex_server.runtime.production_build_loop import probe_runtime_delivery_readiness

            runtime_delivery_check = probe_runtime_delivery_readiness(
                Path(os.getenv("ORCHESTRATOR_RUNTIME_DELIVERY_ROOT", "/opt/clawdbot/state/runtime_delivery"))
            )
        except Exception as exc:
            runtime_delivery_check = {"ready": False, "status": "not_ready", "error": f"{type(exc).__name__}: {exc}"}
        checks = {
            "requiredPaths": {"ok": not missing_paths, "missing": missing_paths},
            "requiredRouters": {"ok": not missing_routers, "missing": missing_routers},
            "structuralGraph": {
                "ok": graph_error is None,
                "required": production_environment,
                "degraded": graph_error is not None,
                "path": str(graph_path),
                "quickCheck": graph_quick_check,
                "error": graph_error,
            },
            "writeAuthorization": {
                "ok": write_auth_mode == "token_or_loopback" or (write_auth_mode == "token_required" and bool(write_token)),
                "mode": write_auth_mode,
                "tokenConfigured": bool(write_token),
            },
            "readAuthorization": {
                "ok": read_authorization.configured and not read_authorization.configuration_error,
                "required": production_environment,
                "degraded": not (read_authorization.configured and not read_authorization.configuration_error),
                "mode": "signed_principal_or_admin",
                "principalCredentialsConfigured": bool(read_authorization.credentials),
                "adminTokenConfigured": bool(read_authorization.admin_token or read_authorization.codec_admin_token),
                "error": read_authorization.configuration_error,
            },
            "routerImports": {
                "ok": not any(row["router"] in required_routers for row in router_load_report["failed"]),
                "failed": [row for row in router_load_report["failed"] if row["router"] in required_routers],
            },
            "eventLedgerDurability": event_ledger_check,
            "memoryBackendDurability": memory_backend_check,
            "runtimeDelivery": {
                "ok": bool(runtime_delivery_check.get("ready")),
                "required": production_environment,
                "status": runtime_delivery_check.get("status"),
                "checks": runtime_delivery_check.get("checks", {}),
                "error": runtime_delivery_check.get("error"),
            },
        }
        checks.update(getattr(app.state, "lifecycle_checks", {}))
        scheduler_check = checks.get("scheduler")
        if scheduler_check is not None and scheduler_check.get("ok"):
            try:
                from cortex_server.scheduler import scheduler

                if not scheduler.running:
                    raise RuntimeError("scheduler is not running")
            except Exception as exc:
                checks["scheduler"] = {
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                }
        ready = all(
            check["ok"]
            for check in checks.values()
            if check.get("required", True)
        )
        return {
            "status": "ready" if ready else "not_ready",
            "ready": ready,
            "service": "cortex",
            "checks": checks,
            "routerLoad": {
                "loadedCount": len(router_load_report["loaded"]),
                "safeModeSkipped": router_load_report["safeModeSkipped"],
                "failed": router_load_report["failed"],
                "missingRouter": router_load_report["missingRouter"],
            },
        }

    readiness_probe_task: Optional[asyncio.Task] = None
    readiness_probe_lock = asyncio.Lock()
    readiness_cache_payload: Optional[dict] = None
    readiness_cache_recorded_at = 0.0
    readiness_cache_ttl_seconds = 1.0

    async def async_readiness_payload() -> dict:
        """Single-flight blocking probes off the event loop with a hard deadline."""

        nonlocal readiness_probe_task, readiness_cache_payload, readiness_cache_recorded_at
        async with readiness_probe_lock:
            if (
                readiness_cache_payload is not None
                and time.monotonic() - readiness_cache_recorded_at <= readiness_cache_ttl_seconds
            ):
                return readiness_cache_payload
            if readiness_probe_task is not None and readiness_probe_task.done():
                # A prior caller may have hit the aggregate deadline while the
                # worker completed later. Never serve that potentially stale
                # result; start a fresh check for this request.
                readiness_probe_task = None
            if readiness_probe_task is None:
                readiness_probe_task = asyncio.create_task(
                    asyncio.to_thread(readiness_payload),
                    name="cortex-readiness-probe",
                )
            probe = readiness_probe_task
        try:
            payload = await asyncio.wait_for(asyncio.shield(probe), timeout=5.0)
        except asyncio.TimeoutError:
            return {
                "status": "not_ready",
                "ready": False,
                "service": "cortex",
                "checks": {
                    "readinessProbe": {
                        "ok": False,
                        "error": "readiness probe exceeded the 5 second aggregate deadline",
                    }
                },
                "routerLoad": {
                    "loadedCount": len(router_load_report["loaded"]),
                    "safeModeSkipped": router_load_report["safeModeSkipped"],
                    "failed": router_load_report["failed"],
                    "missingRouter": router_load_report["missingRouter"],
                },
            }
        except Exception as exc:
            async with readiness_probe_lock:
                if readiness_probe_task is probe and probe.done():
                    readiness_probe_task = None
            return {
                "status": "not_ready",
                "ready": False,
                "service": "cortex",
                "checks": {
                    "readinessProbe": {
                        "ok": False,
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                },
                "routerLoad": {
                    "loadedCount": len(router_load_report["loaded"]),
                    "safeModeSkipped": router_load_report["safeModeSkipped"],
                    "failed": router_load_report["failed"],
                    "missingRouter": router_load_report["missingRouter"],
                },
            }
        async with readiness_probe_lock:
            if readiness_probe_task is probe:
                readiness_probe_task = None
            readiness_cache_payload = payload
            readiness_cache_recorded_at = time.monotonic()
        return payload

    # Router-level readiness aliases reuse this exact single-flight worker.
    # Storing the callable on the application keeps the router free of a
    # dependency on create_app's closure while preserving one admission path.
    app.state.async_readiness_payload = async_readiness_payload

    @app.get("/ready")
    async def readiness_check():
        from fastapi.responses import JSONResponse
        payload = await async_readiness_payload()
        return JSONResponse(status_code=200 if payload["ready"] else 503, content=payload)

    @app.get("/capabilities")
    async def capability_inventory():
        capabilities = []
        for route in _effective_routes(app.routes):
            methods = sorted(method for method in (getattr(route, "methods", None) or []) if method not in {"HEAD", "OPTIONS"})
            if not methods:
                continue
            capabilities.append({
                "path": getattr(route, "path", ""),
                "methods": methods,
                "write": any(method in MUTATING_METHODS for method in methods),
                "readPolicy": (
                    getattr(route, "cortex_read_policy", None)
                    if any(method in {"GET", "HEAD"} for method in methods)
                    else None
                ),
                "name": getattr(route, "name", None),
            })
        return {
            "schemaVersion": "cortex.capability_inventory.v1",
            "security": {
                "writeAuthorizationMode": write_auth_mode,
                "writeTokenConfigured": bool(write_token),
                "writeTokenHeader": write_token_header,
                "sensitiveReadAuthorizationMode": "signed_principal_or_admin",
                "sensitiveReadAuthorizationConfigured": read_authorization.configured and not read_authorization.configuration_error,
            },
            "capabilityCount": len(capabilities),
            "writeCapabilityCount": sum(1 for row in capabilities if row["write"]),
            "capabilities": sorted(capabilities, key=lambda row: (row["path"], row["methods"])),
        }

    @app.get("/health")
    async def health_check():
        from fastapi.responses import JSONResponse

        readiness = await async_readiness_payload()
        payload = {
            "status": "healthy" if readiness["ready"] else "degraded",
            "service": "cortex",
            "contract": {
                "identity_phrase": "Cortex-first orchestration active",
                "activation_metadata_available": True,
                "activation_metadata_source": "derived",
            },
            "one_brain": {
                "autonomy_control_plane": True,
                "event_ledger": bool(readiness["checks"]["eventLedgerDurability"]["ok"]),
                "memory_backend": bool(readiness["checks"]["memoryBackendDurability"]["ok"]),
            },
            "security": {
                "writeAuthorizationMode": write_auth_mode,
                "writeTokenConfigured": bool(write_token),
                "sensitiveReadAuthorizationMode": "signed_principal_or_admin",
                "sensitiveReadAuthorizationConfigured": read_authorization.configured and not read_authorization.configuration_error,
                "networkBind": os.getenv("CORTEX_HOST", "127.0.0.1"),
            },
            "readiness": readiness["ready"],
        }
        return JSONResponse(status_code=200 if readiness["ready"] else 503, content=payload)

    @app.get("/")
    async def root():
        return {
            "name": "The Cortex",
            "version": "1.0.0",
            "description": "Local Knowledge Graph and Tool Server",
            "endpoints": {
                "docs": "/docs",
                "health": "/health",
                "graph": "/graph",
                "parse": "/parse",
                "tools": "/tools",
                "websockets": "/ws",
            },
        }

    # Route loading is now complete. Capture immutable policy metadata once so
    # request authorization never depends on path-name heuristics.
    app.state.read_route_policies = _attach_read_route_policies(app)

    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )
        components = schema.setdefault("components", {})
        security_schemes = components.setdefault("securitySchemes", {})
        security_schemes["CortexWriteToken"] = {
            "type": "apiKey",
            "in": "header",
            "name": write_token_header,
            "description": "Required for non-loopback mutating requests and browser requests from untrusted origins in token_or_loopback mode.",
        }
        security_schemes["CortexAdminToken"] = {
            "type": "apiKey",
            "in": "header",
            "name": "x-cortex-admin-token",
            "description": "Administrator credential for cross-resource operational reads.",
        }
        security_schemes["CortexCodecAdminToken"] = {
            "type": "apiKey",
            "in": "header",
            "name": "x-cortex-codec-admin-token",
            "description": "Specialized codec administrator credential accepted only on enumerated /nexus/codec control and read routes.",
        }
        security_schemes["CortexPrincipalSignature"] = {
            "type": "apiKey",
            "in": "header",
            "name": "x-cortex-scope-signature",
            "description": "HMAC signature over the complete Cortex tenant/workspace/agent/user/channel/session principal scope.",
        }
        for path, path_item in schema.get("paths", {}).items():
            for method in ("post", "put", "patch", "delete"):
                operation = path_item.get(method)
                if operation:
                    operation["security"] = [{"CortexWriteToken": []}]
                    operation["x-cortex-write-authorization-mode"] = write_auth_mode
            operation = path_item.get("get")
            read_policy = (
                operation.get(_READ_POLICY_METADATA_KEY, "admin_redacted")
                if operation
                else None
            )
            if operation and read_policy not in {"public", "public_redacted"}:
                admin_security = [{"CortexAdminToken": []}]
                if path in _CODEC_ADMIN_READ_ROUTE_PATHS:
                    admin_security.append({"CortexCodecAdminToken": []})
                operation["security"] = admin_security
                if not read_policy.startswith("admin_"):
                    operation["security"].append({"CortexPrincipalSignature": []})
                operation["x-cortex-read-authorization-mode"] = "signed_principal_or_admin"
                if read_policy.startswith("admin_"):
                    operation["x-cortex-read-admin-required"] = True
        app.openapi_schema = schema
        return schema

    app.openapi = custom_openapi
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("CORTEX_HOST", "127.0.0.1"), port=int(os.getenv("CORTEX_PORT", "8000")))
