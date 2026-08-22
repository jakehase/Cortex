"""Fail-closed capabilities for host and model-generated execution.

The ordinary Cortex write token proves only that a caller may make a mutating
HTTP request.  It must never, by itself, authorize a host process or filesystem
mutation.  Dangerous routes therefore require all of the following:

* an exact action in ``CORTEX_EXECUTION_ALLOWED_ACTIONS``;
* a separate capability secret in ``CORTEX_EXECUTION_CAPABILITY_TOKEN``;
* the same secret in the configured request header; and
* for filesystem actions, a target below a narrow configured root.

There are deliberately no default actions or roots.  Wildcard actions and
broad roots are rejected instead of being interpreted permissively.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
import secrets
from typing import Iterable, Optional
from urllib.parse import urlsplit


DEFAULT_CAPABILITY_HEADER = "x-cortex-execution-capability"
_GRANT_MARKER = object()
_UNISOLATED_ACTION_PREFIXES = ("tools.ffmpeg.",)
_UNISOLATED_ACTIONS = frozenset({
    "tools.docker.build",
    "tools.docker.logs",
    "tools.docker.pull",
    "tools.git.add",
    "tools.git.pull",
})


class ExecutionCapabilityDenied(RuntimeError):
    """A dangerous action or path was not authorized by the capability policy."""

    def __init__(self, code: str, detail: str, *, status_code: int = 403):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.status_code = status_code


@dataclass(frozen=True)
class ExecutionGrant:
    """Opaque, request-local evidence that one exact execution action was allowed."""

    action: str
    request_path: Optional[str] = None
    _marker: object = field(default=None, repr=False, compare=False)


def _csv(name: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in os.getenv(name, "").split(",") if part.strip())


def configured_actions() -> tuple[str, ...]:
    """Return valid exact actions; wildcard entries never enable an action."""
    return tuple(action for action in _csv("CORTEX_EXECUTION_ALLOWED_ACTIONS") if "*" not in action)


def capability_header_name() -> str:
    value = os.getenv("CORTEX_EXECUTION_CAPABILITY_HEADER", DEFAULT_CAPABILITY_HEADER).strip().lower()
    return value or DEFAULT_CAPABILITY_HEADER


def execution_capability_status() -> dict:
    roots = configured_roots()
    actions = configured_actions()
    executable_actions = tuple(
        action
        for action in actions
        if action not in _UNISOLATED_ACTIONS
        and not any(action.startswith(prefix) for prefix in _UNISOLATED_ACTION_PREFIXES)
    )
    return {
        "enabled": bool(executable_actions and roots and os.getenv("CORTEX_EXECUTION_CAPABILITY_TOKEN", "").strip()),
        "allowedActions": list(actions),
        "executableActions": list(executable_actions),
        "allowedRoots": [str(root) for root in roots],
        "allowedGitHosts": list(configured_git_hosts()),
        "degradedActionPrefixes": list(_UNISOLATED_ACTION_PREFIXES),
        "degradedActions": sorted(_UNISOLATED_ACTIONS),
        "capabilityTokenConfigured": bool(os.getenv("CORTEX_EXECUTION_CAPABILITY_TOKEN", "").strip()),
        "capabilityHeader": capability_header_name(),
        "defaultDeny": True,
    }


def configured_git_hosts() -> tuple[str, ...]:
    """Return exact HTTPS authorities allowed for capability-scoped Git egress."""
    hosts = []
    for raw in _csv("CORTEX_EXECUTION_GIT_ALLOWED_HOSTS"):
        value = raw.lower().rstrip(".")
        if value and "/" not in value and "@" not in value and value not in hosts:
            hosts.append(value)
    return tuple(hosts)


def authorize_git_remote_url(grant: ExecutionGrant, action: str, value: str) -> str:
    """Allow only explicit HTTPS Git authorities; reject helpers, SSH, and file URLs."""
    require_execution_grant(grant, action)
    raw = str(value or "").strip()
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as exc:
        raise ExecutionCapabilityDenied(
            "execution_git_remote_invalid",
            "Git remote URL is malformed",
            status_code=400,
        ) from exc
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ExecutionCapabilityDenied(
            "execution_git_remote_denied",
            "Git remotes must use an allowlisted HTTPS authority without credentials",
            status_code=403,
        )
    host = parsed.hostname.lower().rstrip(".")
    authority = f"{host}:{port}" if port not in (None, 443) else host
    if authority not in configured_git_hosts():
        raise ExecutionCapabilityDenied(
            "execution_git_host_denied",
            "Git remote authority is not allowlisted",
            status_code=403,
        )
    return raw


def authorize_execution_action(
    action: str,
    presented_token: Optional[str],
    *,
    request_path: Optional[str] = None,
) -> ExecutionGrant:
    """Authorize one exact action using an independently configured credential."""
    allowed = configured_actions()
    if action not in allowed:
        raise ExecutionCapabilityDenied(
            "execution_action_disabled",
            f"execution action is disabled: {action}",
            status_code=503,
        )
    if action in _UNISOLATED_ACTIONS or any(action.startswith(prefix) for prefix in _UNISOLATED_ACTION_PREFIXES):
        raise ExecutionCapabilityDenied(
            "execution_isolation_unavailable",
            f"execution action requires an OS-isolated worker: {action}",
            status_code=503,
        )

    expected = os.getenv("CORTEX_EXECUTION_CAPABILITY_TOKEN", "").strip()
    if not expected:
        raise ExecutionCapabilityDenied(
            "execution_capability_unconfigured",
            "execution capability token is not configured",
            status_code=503,
        )
    if not presented_token or not secrets.compare_digest(str(presented_token), expected):
        raise ExecutionCapabilityDenied(
            "execution_capability_invalid",
            "a valid execution capability is required",
            status_code=403,
        )
    return ExecutionGrant(action=action, request_path=request_path, _marker=_GRANT_MARKER)


def authorize_execution_request(request, action: str) -> ExecutionGrant:
    """Authorize an action from a Starlette/FastAPI request without importing FastAPI."""
    token = request.headers.get(capability_header_name()) if request is not None else None
    path = getattr(getattr(request, "url", None), "path", None)
    return authorize_execution_action(action, token, request_path=path)


def require_execution_grant(grant: ExecutionGrant, action: str) -> None:
    if not isinstance(grant, ExecutionGrant) or grant._marker is not _GRANT_MARKER:
        raise ExecutionCapabilityDenied(
            "execution_grant_missing",
            f"an execution grant is required for: {action}",
            status_code=403,
        )
    if grant.action != action:
        raise ExecutionCapabilityDenied(
            "execution_grant_action_mismatch",
            f"execution grant does not authorize: {action}",
            status_code=403,
        )


def _is_narrow_root(path: Path) -> bool:
    """Reject filesystem-wide and credential-bearing parent roots."""
    forbidden = {
        Path("/"),
        Path("/app"),
        Path("/etc"),
        Path("/home"),
        Path("/opt"),
        Path("/opt/clawdbot"),
        Path("/root"),
        Path("/root/.openclaw"),
        Path("/tmp"),
        Path("/usr"),
        Path("/var"),
    }
    credential_components = {".aws", ".config", ".gnupg", ".kube", ".openclaw", ".ssh"}
    system_trees = (Path("/dev"), Path("/proc"), Path("/run"), Path("/sys"), Path("/var"))
    return (
        path.is_absolute()
        and path not in forbidden
        and len(path.parts) >= 3
        and not credential_components.intersection(path.parts)
        and not any(path == base or base in path.parents for base in system_trees)
        and path.is_dir()
    )


def configured_roots() -> tuple[Path, ...]:
    roots = []
    for value in _csv("CORTEX_EXECUTION_ALLOWED_ROOTS"):
        candidate = Path(value)
        if not candidate.is_absolute():
            continue
        resolved = candidate.resolve(strict=False)
        if _is_narrow_root(resolved) and resolved not in roots:
            roots.append(resolved)
    return tuple(roots)


def _within(candidate: Path, root: Path) -> bool:
    return candidate == root or root in candidate.parents


def resolve_authorized_path(
    grant: ExecutionGrant,
    action: str,
    value: str | Path,
    *,
    must_exist: bool = False,
    require_file: bool = False,
    require_directory: bool = False,
) -> Path:
    """Resolve a host path and prove that it remains beneath an allowed root."""
    require_execution_grant(grant, action)
    raw = Path(value)
    if not raw.is_absolute():
        raise ExecutionCapabilityDenied(
            "execution_path_not_absolute",
            "execution paths must be absolute",
            status_code=400,
        )
    roots = configured_roots()
    if not roots:
        raise ExecutionCapabilityDenied(
            "execution_roots_unconfigured",
            "no narrow execution roots are configured",
            status_code=503,
        )
    candidate = raw.resolve(strict=False)
    if not any(_within(candidate, root) for root in roots):
        raise ExecutionCapabilityDenied(
            "execution_path_outside_roots",
            "execution path is outside the configured roots",
            status_code=403,
        )
    if must_exist and not candidate.exists():
        raise ExecutionCapabilityDenied(
            "execution_path_missing",
            "execution path does not exist",
            status_code=400,
        )
    if require_file and (not candidate.exists() or not candidate.is_file()):
        raise ExecutionCapabilityDenied(
            "execution_path_not_file",
            "execution path must be an existing file",
            status_code=400,
        )
    if require_directory and (not candidate.exists() or not candidate.is_dir()):
        raise ExecutionCapabilityDenied(
            "execution_path_not_directory",
            "execution path must be an existing directory",
            status_code=400,
        )
    return candidate


def resolve_authorized_paths(
    grant: ExecutionGrant,
    action: str,
    values: Iterable[str | Path],
    **kwargs,
) -> tuple[Path, ...]:
    return tuple(resolve_authorized_path(grant, action, value, **kwargs) for value in values)


def unsafe_lab_execution_enabled() -> bool:
    """The legacy subprocess is never a sandbox, even when an action is configured."""
    return False
