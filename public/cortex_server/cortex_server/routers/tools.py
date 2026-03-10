"""
Tools Router - API endpoints for CLI tool operations.
"""

from fastapi import APIRouter
from cortex_server.models.requests import (
    FFMPEGConvertRequest, FFMPEGExtractAudioRequest, FFMPEGThumbnailRequest,
    GitCloneRequest, GitPullRequest,
    DockerRunRequest, DockerBuildRequest,
    ToolResultResponse
)
from cortex_server.services.tool_service import ToolService

router = APIRouter()
service = ToolService()


# FFmpeg endpoints
@router.post("/ffmpeg/convert", response_model=ToolResultResponse)
async def ffmpeg_convert(request: FFMPEGConvertRequest):
    """Convert media file using FFmpeg."""
    try:
        result = await service.ffmpeg_convert(request)
        return ToolResultResponse.success(result)
    except Exception as e:
        return ToolResultResponse.failure(str(e))


@router.post("/ffmpeg/extract-audio", response_model=ToolResultResponse)
async def ffmpeg_extract_audio(request: FFMPEGExtractAudioRequest):
    """Extract audio from video file."""
    try:
        result = await service.ffmpeg_extract_audio(request)
        return ToolResultResponse.success(result)
    except Exception as e:
        return ToolResultResponse.failure(str(e))


@router.post("/ffmpeg/thumbnail", response_model=ToolResultResponse)
async def ffmpeg_thumbnail(request: FFMPEGThumbnailRequest):
    """Create thumbnail from video."""
    try:
        result = await service.ffmpeg_thumbnail(request)
        return ToolResultResponse.success(result)
    except Exception as e:
        return ToolResultResponse.failure(str(e))


@router.get("/ffmpeg/info")
async def ffmpeg_info(input_path: str):
    """Get media file information."""
    try:
        result = await service.ffmpeg_info(input_path)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


# Git endpoints
@router.post("/git/clone", response_model=ToolResultResponse)
async def git_clone(request: GitCloneRequest):
    """Clone a Git repository."""
    try:
        result = await service.git_clone(request)
        return ToolResultResponse.success(result)
    except Exception as e:
        return ToolResultResponse.failure(str(e))


@router.post("/git/pull", response_model=ToolResultResponse)
async def git_pull(request: GitPullRequest):
    """Pull from remote."""
    try:
        result = await service.git_pull(request)
        return ToolResultResponse.success(result)
    except Exception as e:
        return ToolResultResponse.failure(str(e))


@router.get("/git/status")
async def git_status(repo_path: str):
    """Get Git repository status."""
    try:
        result = await service.git_status(repo_path)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/git/log")
async def git_log(repo_path: str, max_count: int = 10):
    """Get Git commit log."""
    try:
        result = await service.git_log(repo_path, max_count)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/git/init")
async def git_init(repo_path: str):
    """Initialize a new Git repository."""
    try:
        result = await service.git_init(repo_path)
        return {"success": result["success"], "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/git/add")
async def git_add(repo_path: str, files: str = "."):
    """Add files to staging area."""
    try:
        result = await service.git_add(repo_path, files)
        return {"success": result["success"], "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/git/commit")
async def git_commit(repo_path: str, message: str):
    """Create a commit."""
    try:
        result = await service.git_commit(repo_path, message)
        return {"success": result["success"], "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


# Docker endpoints
@router.post("/docker/run", response_model=ToolResultResponse)
async def docker_run(request: DockerRunRequest):
    """Run a Docker container."""
    try:
        result = await service.docker_run(request)
        return ToolResultResponse.success(result)
    except Exception as e:
        return ToolResultResponse.failure(str(e))


@router.get("/docker/containers")
async def docker_list(all: bool = False):
    """List Docker containers."""
    try:
        result = await service.docker_list(all)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/docker/stop/{container_id}")
async def docker_stop(container_id: str):
    """Stop a Docker container."""
    try:
        result = await service.docker_stop(container_id)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.post("/docker/build", response_model=ToolResultResponse)
async def docker_build(request: DockerBuildRequest):
    """Build a Docker image."""
    try:
        result = await service.docker_build(request)
        return ToolResultResponse.success(result)
    except Exception as e:
        return ToolResultResponse.failure(str(e))


@router.post("/docker/pull")
async def docker_pull(image_name: str, tag: str = "latest"):
    """Pull a Docker image."""
    try:
        result = await service.docker_pull(image_name, tag)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}