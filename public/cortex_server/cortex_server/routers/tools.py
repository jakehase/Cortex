"""
Tools Router - API endpoints for CLI tool operations.
"""

from fastapi import APIRouter, Request, HTTPException
import shutil
from cortex_server.models.requests import (
    FFMPEGConvertRequest, FFMPEGExtractAudioRequest, FFMPEGThumbnailRequest,
    GitCloneRequest, GitPullRequest,
    DockerRunRequest, DockerBuildRequest,
    ToolResultResponse
)
from cortex_server.modules.runtime_trace import extract_trace_context
from cortex_server.services.tool_service import ToolService
from cortex_server.tools.git_wrapper import run_git_async

router = APIRouter()
service = ToolService()


def _internal_failure():
    """Return a stable, redacted failure without implying a safe retry."""
    raise HTTPException(status_code=500, detail="Tool operation failed")


def _tool_response(result):
    ok = bool((result or {}).get("success", False))
    if ok:
        return ToolResultResponse.success(result)
    raise HTTPException(status_code=500, detail="Tool operation failed")


# FFmpeg endpoints
@router.post("/ffmpeg/convert", response_model=ToolResultResponse)
async def ffmpeg_convert(request: FFMPEGConvertRequest, http_request: Request):
    """Convert media file using FFmpeg."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "ffmpeg.convert", "scope": "tool:ffmpeg:convert"})
        result = await service.ffmpeg_convert(request, trace_context=trace_context)
        return _tool_response(result)
    except Exception as e:
        return _internal_failure()


@router.post("/ffmpeg/extract-audio", response_model=ToolResultResponse)
async def ffmpeg_extract_audio(request: FFMPEGExtractAudioRequest, http_request: Request):
    """Extract audio from video file."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "ffmpeg.extract_audio", "scope": "tool:ffmpeg:extract_audio"})
        result = await service.ffmpeg_extract_audio(request, trace_context=trace_context)
        return _tool_response(result)
    except Exception as e:
        return _internal_failure()


@router.post("/ffmpeg/thumbnail", response_model=ToolResultResponse)
async def ffmpeg_thumbnail(request: FFMPEGThumbnailRequest, http_request: Request):
    """Create thumbnail from video."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "ffmpeg.thumbnail", "scope": "tool:ffmpeg:thumbnail"})
        result = await service.ffmpeg_thumbnail(request, trace_context=trace_context)
        return _tool_response(result)
    except Exception as e:
        return _internal_failure()


@router.get("/ffmpeg/info")
async def ffmpeg_info(input_path: str, http_request: Request):
    """Get media file information."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "ffmpeg.info", "scope": "tool:ffmpeg:info"})
        result = await service.ffmpeg_info(input_path, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": result.get("success", True), "data": result, "error": result.get("error")}
    except Exception as e:
        return _internal_failure()


# Git endpoints
@router.post("/git/clone", response_model=ToolResultResponse)
async def git_clone(request: GitCloneRequest, http_request: Request):
    """Clone a Git repository."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.clone", "scope": "tool:git:clone", "repo_path": request.destination})
        result = await service.git_clone(request, trace_context=trace_context)
        return _tool_response(result)
    except Exception as e:
        return _internal_failure()


@router.post("/git/pull", response_model=ToolResultResponse)
async def git_pull(request: GitPullRequest, http_request: Request):
    """Pull from remote."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.pull", "scope": "tool:git:pull", "repo_path": request.repo_path})
        result = await service.git_pull(request, trace_context=trace_context)
        return _tool_response(result)
    except Exception as e:
        return _internal_failure()


@router.get("/git/status")
async def git_status(repo_path: str, http_request: Request):
    """Get Git repository status."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.status", "scope": "tool:git:status", "repo_path": repo_path})
        result = await service.git_status(repo_path, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except Exception as e:
        return _internal_failure()


@router.get("/git/log")
async def git_log(repo_path: str, max_count: int = 10, http_request: Request = None):
    """Get Git commit log."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.log", "scope": "tool:git:log", "repo_path": repo_path})
        result = await service.git_log(repo_path, max_count, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except Exception as e:
        return _internal_failure()


@router.post("/git/init")
async def git_init(repo_path: str, http_request: Request):
    """Initialize a new Git repository."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.init", "scope": "tool:git:init", "repo_path": repo_path})
        result = await service.git_init(repo_path, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except Exception as e:
        return _internal_failure()


@router.post("/git/add")
async def git_add(repo_path: str, files: str = ".", http_request: Request = None):
    """Add files to staging area."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.add", "scope": "tool:git:add", "repo_path": repo_path})
        result = await service.git_add(repo_path, files, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except Exception as e:
        return _internal_failure()


@router.post("/git/commit")
async def git_commit(repo_path: str, message: str, http_request: Request = None):
    """Create a commit."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "git.commit", "scope": "tool:git:commit", "repo_path": repo_path})
        result = await service.git_commit(repo_path, message, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except Exception as e:
        return _internal_failure()


# Docker endpoints
@router.post("/docker/run", response_model=ToolResultResponse)
async def docker_run(request: DockerRunRequest, http_request: Request):
    """Run a Docker container."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "docker.run", "scope": "tool:docker:run"})
        result = await service.docker_run(request, trace_context=trace_context)
        return _tool_response(result)
    except Exception as e:
        return _internal_failure()


@router.get("/docker/containers")
async def docker_list(all: bool = False, http_request: Request = None):
    """List Docker containers."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "docker.list", "scope": "tool:docker:list"})
        result = await service.docker_list(all, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except Exception as e:
        return _internal_failure()


@router.post("/docker/stop/{container_id}")
async def docker_stop(container_id: str, http_request: Request):
    """Stop a Docker container."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "docker.stop", "scope": "tool:docker:stop"})
        result = await service.docker_stop(container_id, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except Exception as e:
        return _internal_failure()


@router.post("/docker/build", response_model=ToolResultResponse)
async def docker_build(request: DockerBuildRequest, http_request: Request):
    """Build a Docker image."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "docker.build", "scope": "tool:docker:build"})
        result = await service.docker_build(request, trace_context=trace_context)
        return _tool_response(result)
    except Exception as e:
        return _internal_failure()


@router.post("/docker/pull")
async def docker_pull(image_name: str, tag: str = "latest", http_request: Request = None):
    """Pull a Docker image."""
    try:
        trace_context = extract_trace_context(http_request, defaults={"tool_name": "docker.pull", "scope": "tool:docker:pull"})
        result = await service.docker_pull(image_name, tag, trace_context=trace_context)
        if not result.get("success", False):
            return _internal_failure()
        return {"success": True, "data": result, "error": result.get("error")}
    except Exception as e:
        return _internal_failure()

@router.get("/status")
async def tools_status():
    """L17 status + preflight checks for core tools."""
    checks = {
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "git": shutil.which("git") is not None,
        "docker": shutil.which("docker") is not None,
    }

    git_identity = {"user_name": None, "user_email": None, "configured": False}
    try:
        n = await run_git_async(["git", "config", "--global", "user.name"], timeout=5)
        e = await run_git_async(["git", "config", "--global", "user.email"], timeout=5)
        git_identity["user_name"] = n.stdout.strip() or None
        git_identity["user_email"] = e.stdout.strip() or None
        git_identity["configured"] = bool(git_identity["user_name"] and git_identity["user_email"])
    except Exception:
        pass

    all_ok = all(checks.values())
    return {
        "success": True,
        "level": 17,
        "name": "Exoskeleton/Tools",
        "status": "active" if all_ok else "degraded",
        "tools": checks,
        "git_identity": git_identity,
        "capabilities": [
            "ffmpeg", "git", "docker", "tool_preflight"
        ],
    }
