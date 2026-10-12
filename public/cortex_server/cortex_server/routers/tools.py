"""
Tools Router - API endpoints for CLI tool operations.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
import shutil
from pydantic import BaseModel, Field
from cortex_server.models.requests import (
    FFMPEGConvertRequest, FFMPEGExtractAudioRequest, FFMPEGThumbnailRequest,
    GitCloneRequest, GitPullRequest,
    DockerRunRequest, DockerBuildRequest,
    ToolResultResponse
)
from cortex_server.modules.runtime_trace import extract_trace_context
from cortex_server.modules.action_capabilities import require_action_capability
from cortex_server.modules.execution_capabilities import (
    ExecutionCapabilityDenied,
    authorize_execution_request,
    execution_capability_status,
    resolve_authorized_path,
)
from cortex_server.modules.level_route_status import capability_report
from cortex_server.services.tool_service import ToolService
from cortex_server.tools.git_wrapper import GitError, GitRepo

router = APIRouter()
service = ToolService()


class GitStatusActionRequest(BaseModel):
    repo_path: str = Field(..., min_length=1, max_length=4096)


class GitLogActionRequest(BaseModel):
    repo_path: str = Field(..., min_length=1, max_length=4096)
    max_count: int = Field(default=10, ge=1, le=50)


def _internal_failure():
    """Return a stable, redacted failure without implying a safe retry."""
    raise HTTPException(status_code=500, detail="Tool operation failed")


def _grant(http_request: Request, action: str):
    try:
        return authorize_execution_request(http_request, action)
    except ExecutionCapabilityDenied as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error": exc.code, "message": exc.detail, "action": action},
        ) from exc


def _denied(exc: ExecutionCapabilityDenied, action: str) -> HTTPException:
    """Policy denials are 4xx/503 with a machine code, never an opaque 500."""
    return HTTPException(
        status_code=exc.status_code,
        detail={"error": exc.code, "message": exc.detail, "action": action},
    )


def _repo_preflight(grant, action: str, repo_path: str) -> None:
    """Refuse paths whose repository root would fall outside the authorized root."""
    try:
        resolved = resolve_authorized_path(grant, action, repo_path, require_directory=True)
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, action) from exc
    try:
        GitRepo(str(resolved))
    except GitError as exc:
        outside = "outside the authorized root" in str(exc)
        raise HTTPException(
            status_code=403 if outside else 400,
            detail={
                "error": "repo_outside_root" if outside else "not_a_repository",
                "message": "repository root is outside the authorized root" if outside
                else "no git repository at or above this path within the authorized root",
                "action": action,
            },
        ) from exc


def _tool_response(result):
    ok = bool((result or {}).get("success", False))
    if ok:
        return ToolResultResponse.success(result)
    raise HTTPException(status_code=500, detail="Tool operation failed")


# FFmpeg endpoints
@router.post("/ffmpeg/convert", response_model=ToolResultResponse, dependencies=[Depends(require_action_capability)])
async def ffmpeg_convert(request: FFMPEGConvertRequest, http_request: Request):
    """Convert media file using FFmpeg."""
    grant = _grant(http_request, "tools.ffmpeg.convert")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "ffmpeg.convert", "scope": "tool:ffmpeg:convert"})
        result = await service.ffmpeg_convert(request, grant=grant, trace_context=trace_context)
        return _tool_response(result)
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.post("/ffmpeg/extract-audio", response_model=ToolResultResponse, dependencies=[Depends(require_action_capability)])
async def ffmpeg_extract_audio(request: FFMPEGExtractAudioRequest, http_request: Request):
    """Extract audio from video file."""
    grant = _grant(http_request, "tools.ffmpeg.extract_audio")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "ffmpeg.extract_audio", "scope": "tool:ffmpeg:extract_audio"})
        result = await service.ffmpeg_extract_audio(request, grant=grant, trace_context=trace_context)
        return _tool_response(result)
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.post("/ffmpeg/thumbnail", response_model=ToolResultResponse, dependencies=[Depends(require_action_capability)])
async def ffmpeg_thumbnail(request: FFMPEGThumbnailRequest, http_request: Request):
    """Create thumbnail from video."""
    grant = _grant(http_request, "tools.ffmpeg.thumbnail")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "ffmpeg.thumbnail", "scope": "tool:ffmpeg:thumbnail"})
        result = await service.ffmpeg_thumbnail(request, grant=grant, trace_context=trace_context)
        return _tool_response(result)
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.get("/ffmpeg/info")
async def ffmpeg_info(input_path: str, http_request: Request):
    """Get media file information."""
    grant = _grant(http_request, "tools.ffmpeg.info")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "ffmpeg.info", "scope": "tool:ffmpeg:info"})
        result = await service.ffmpeg_info(input_path, grant=grant, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": result.get("success", True), "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


# Git endpoints
@router.post("/git/clone", response_model=ToolResultResponse, dependencies=[Depends(require_action_capability)])
async def git_clone(request: GitCloneRequest, http_request: Request):
    """Clone a Git repository."""
    grant = _grant(http_request, "tools.git.clone")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.clone", "scope": "tool:git:clone", "repo_path": request.destination})
        result = await service.git_clone(request, grant=grant, trace_context=trace_context)
        return _tool_response(result)
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.post("/git/pull", response_model=ToolResultResponse, dependencies=[Depends(require_action_capability)])
async def git_pull(request: GitPullRequest, http_request: Request):
    """Pull from remote."""
    grant = _grant(http_request, "tools.git.pull")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.pull", "scope": "tool:git:pull", "repo_path": request.repo_path})
        result = await service.git_pull(request, grant=grant, trace_context=trace_context)
        return _tool_response(result)
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.get("/git/status")
async def git_status(repo_path: str, http_request: Request):
    """Get Git repository status."""
    grant = _grant(http_request, "tools.git.status")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.status", "scope": "tool:git:status", "repo_path": repo_path})
        result = await service.git_status(repo_path, grant=grant, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.post("/git/status", dependencies=[Depends(require_action_capability)])
async def git_status_action(request: GitStatusActionRequest, http_request: Request):
    """Return status through a body-bound one-shot action capability."""
    grant = _grant(http_request, "tools.git.status")
    _repo_preflight(grant, "tools.git.status", request.repo_path)
    try:
        trace_context = extract_trace_context(
            http_request,
            defaults={
                "tool_name": "git.status",
                "scope": "tool:git:status",
                "repo_path": request.repo_path,
            },
        )
        result = await service.git_status(
            request.repo_path,
            grant=grant,
            trace_context=trace_context,
        )
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error": exc.code, "message": exc.detail, "action": "tools.git.status"},
        ) from exc
    except Exception:
        return _internal_failure()


@router.get("/git/log")
async def git_log(repo_path: str, max_count: int = 10, http_request: Request = None):
    """Get Git commit log."""
    grant = _grant(http_request, "tools.git.log")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.log", "scope": "tool:git:log", "repo_path": repo_path})
        result = await service.git_log(repo_path, max_count, grant=grant, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.post("/git/log", dependencies=[Depends(require_action_capability)])
async def git_log_action(request: GitLogActionRequest, http_request: Request):
    """Read-only commit log through a body-bound one-shot action capability."""
    grant = _grant(http_request, "tools.git.log")
    _repo_preflight(grant, "tools.git.log", request.repo_path)
    try:
        trace_context = extract_trace_context(
            http_request,
            defaults={"tool_name": "git.log", "scope": "tool:git:log", "repo_path": request.repo_path},
        )
        result = await service.git_log(
            request.repo_path, request.max_count, grant=grant, trace_context=trace_context,
        )
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, "tools.git.log") from exc
    except Exception:
        return _internal_failure()


@router.post("/git/init", dependencies=[Depends(require_action_capability)])
async def git_init(repo_path: str, http_request: Request):
    """Initialize a new Git repository."""
    grant = _grant(http_request, "tools.git.init")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.init", "scope": "tool:git:init", "repo_path": repo_path})
        result = await service.git_init(repo_path, grant=grant, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.post("/git/add", dependencies=[Depends(require_action_capability)])
async def git_add(repo_path: str, files: str = ".", http_request: Request = None):
    """Add files to staging area."""
    grant = _grant(http_request, "tools.git.add")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.add", "scope": "tool:git:add", "repo_path": repo_path})
        result = await service.git_add(repo_path, files, grant=grant, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.post("/git/commit", dependencies=[Depends(require_action_capability)])
async def git_commit(repo_path: str, message: str, http_request: Request = None):
    """Create a commit."""
    grant = _grant(http_request, "tools.git.commit")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.commit", "scope": "tool:git:commit", "repo_path": repo_path})
        result = await service.git_commit(repo_path, message, grant=grant, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


# Docker endpoints
@router.post("/docker/run", response_model=ToolResultResponse, dependencies=[Depends(require_action_capability)])
async def docker_run(request: DockerRunRequest, http_request: Request):
    """Run a Docker container."""
    grant = _grant(http_request, "tools.docker.run")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "docker.run", "scope": "tool:docker:run"})
        result = await service.docker_run(request, grant=grant, trace_context=trace_context)
        return _tool_response(result)
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.get("/docker/containers")
async def docker_list(all: bool = False, http_request: Request = None):
    """List Docker containers."""
    grant = _grant(http_request, "tools.docker.list")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "docker.list", "scope": "tool:docker:list"})
        result = await service.docker_list(all, grant=grant, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.post("/docker/stop/{container_id}", dependencies=[Depends(require_action_capability)])
async def docker_stop(container_id: str, http_request: Request):
    """Stop a Docker container."""
    grant = _grant(http_request, "tools.docker.stop")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "docker.stop", "scope": "tool:docker:stop"})
        result = await service.docker_stop(container_id, grant=grant, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.post("/docker/build", response_model=ToolResultResponse, dependencies=[Depends(require_action_capability)])
async def docker_build(request: DockerBuildRequest, http_request: Request):
    """Build a Docker image."""
    grant = _grant(http_request, "tools.docker.build")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "docker.build", "scope": "tool:docker:build"})
        result = await service.docker_build(request, grant=grant, trace_context=trace_context)
        return _tool_response(result)
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()


@router.post("/docker/pull", dependencies=[Depends(require_action_capability)])
async def docker_pull(image_name: str, tag: str = "latest", http_request: Request = None):
    """Pull a Docker image."""
    grant = _grant(http_request, "tools.docker.pull")
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "docker.pull", "scope": "tool:docker:pull"})
        result = await service.docker_pull(image_name, tag, grant=grant, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except ExecutionCapabilityDenied as exc:
        raise _denied(exc, grant.action) from exc
    except Exception as e:
        return _internal_failure()

_STATUS_CAPABILITIES = {
    "git_status": [("POST", "/git/status")],
    "git_log": [("POST", "/git/log")],
    "git_status_query": [("GET", "/git/status")],
    "git_log_query": [("GET", "/git/log")],
    "git_clone": [("POST", "/git/clone")],
    "git_pull": [("POST", "/git/pull")],
    "git_init": [("POST", "/git/init")],
    "git_add": [("POST", "/git/add")],
    "git_commit": [("POST", "/git/commit")],
    "ffmpeg": [("POST", "/ffmpeg/convert")],
    "docker_run": [("POST", "/docker/run")],
    "docker_list": [("GET", "/docker/containers")],
}
_CAPABILITY_TOOL = {name: ("ffmpeg" if name.startswith("ffmpeg") else "docker" if name.startswith("docker") else "git")
                    for name in _STATUS_CAPABILITIES}
_CAPABILITY_ACTION = {
    "git_status": "tools.git.status", "git_status_query": "tools.git.status",
    "git_log": "tools.git.log", "git_log_query": "tools.git.log",
    "git_clone": "tools.git.clone", "git_pull": "tools.git.pull", "git_init": "tools.git.init",
    "git_add": "tools.git.add", "git_commit": "tools.git.commit",
    "ffmpeg": "tools.ffmpeg.convert", "docker_run": "tools.docker.run", "docker_list": "tools.docker.list",
}


@router.get("/status")
async def tools_status(request: Request = None):
    """L17 status: per-tool binaries, per-action policy, and only mounted routes."""
    checks = {
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "git": shutil.which("git") is not None,
        "docker": shutil.which("docker") is not None,
    }
    capability_policy = execution_capability_status(required_actions=("tools.git.status",))
    tools_policy = execution_capability_status(required_action_prefixes=("tools.",))
    executable = set(tools_policy.get("executableActions") or [])
    ready = bool(tools_policy.get("capabilityTokenConfigured")) and bool(tools_policy.get("allowedRoots"))
    blocked = {}
    for name, action in _CAPABILITY_ACTION.items():
        if not checks[_CAPABILITY_TOOL[name]]:
            blocked[name] = f"{_CAPABILITY_TOOL[name]} binary not installed"
        elif action in tools_policy.get("degradedActions", []) or any(
            action.startswith(prefix) for prefix in tools_policy.get("degradedActionPrefixes", [])
        ):
            blocked[name] = "requires an OS-isolated worker (refused)"
        elif action not in executable or not ready:
            blocked[name] = f"execution action {action} not enabled"
    report = capability_report(request, "/tools", _STATUS_CAPABILITIES, extra_unavailable=blocked)
    read_only = [c for c in report["capabilities"] if c in {"git_status", "git_log", "git_status_query", "git_log_query"}]
    return {
        "success": True,
        "level": 17,
        "name": "Exoskeleton/Tools",
        "status": "active" if read_only else ("limited" if report["capabilities"] else "unavailable"),
        "tools": checks,
        "git_identity": {"inspected": False, "reason": "requires an explicit execution capability"},
        "capabilities": report["capabilities"],
        "unavailable": report["unavailable"],
        "mounted_routes": report["mounted_routes"],
        "configuredActions": list(tools_policy.get("allowedActions") or []),
        "executionCapabilityPolicy": capability_policy,
    }
