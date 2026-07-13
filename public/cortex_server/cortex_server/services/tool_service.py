"""
Tool Service - Business logic for CLI tool operations.
"""

from typing import Dict, Any, Optional
from cortex_server.tools.ffmpeg_wrapper import FFmpegWrapper
from cortex_server.tools.git_wrapper import GitRepo, run_git_async
from cortex_server.tools.docker_wrapper import Docker, ContainerConfig
from cortex_server.models.requests import (
    FFMPEGConvertRequest, FFMPEGExtractAudioRequest, FFMPEGThumbnailRequest,
    GitCloneRequest, GitPullRequest, GitCommitRequest,
    DockerRunRequest, DockerBuildRequest,
)
from cortex_server.modules.runtime_trace import (
    emit_output_events,
    git_diff_snapshot,
    git_diff_snapshot_async,
    git_status_snapshot,
    git_status_snapshot_async,
    record_trace_event,
    shell_preview,
)


class ToolService:

    @staticmethod
    def _safe_error(_: Exception) -> str:
        """Do not expose command lines, host paths, or subprocess stderr via the API."""
        return "Tool operation failed"

    def _trace_start(self, trace_context: Optional[Dict[str, Any]], tool_name: str, payload: Optional[Dict[str, Any]] = None) -> None:
        record_trace_event(trace_context, "tool_call_started", {"tool": tool_name, **dict(payload or {})})

    def _trace_finish(
        self,
        trace_context: Optional[Dict[str, Any]],
        tool_name: str,
        result: Optional[Dict[str, Any]] = None,
        *,
        repo_path: Optional[str] = None,
        capture_git: bool = False,
    ) -> None:
        payload = {"tool": tool_name, **dict(result or {})}
        record_trace_event(trace_context, "tool_call_finished", payload)
        if result is not None:
            emit_output_events(
                trace_context,
                stdout=(result.get("stdout") if isinstance(result, dict) else None),
                stderr=(result.get("stderr") if isinstance(result, dict) else None),
                prefix="tool_call",
            )
        if capture_git and repo_path:
            status = git_status_snapshot(repo_path)
            if status:
                record_trace_event(trace_context, "git_status_snapshot", status)
            unstaged = git_diff_snapshot(repo_path, cached=False)
            if unstaged and (unstaged.get("stat_lines") or unstaged.get("patch_preview")):
                record_trace_event(trace_context, "git_diff_snapshot", unstaged)
            cached = git_diff_snapshot(repo_path, cached=True)
            if cached and (cached.get("stat_lines") or cached.get("patch_preview")):
                record_trace_event(trace_context, "git_diff_cached_snapshot", cached)

    async def _trace_finish_async(self, trace_context, tool_name, result=None, *, repo_path=None, capture_git=False):
        self._trace_finish(trace_context, tool_name, result, repo_path=repo_path, capture_git=False)
        if not capture_git or not repo_path or trace_context is None:
            return
        status = await git_status_snapshot_async(repo_path)
        if status:
            record_trace_event(trace_context, "git_status_snapshot", status)
        unstaged = await git_diff_snapshot_async(repo_path, cached=False)
        if unstaged and (unstaged.get("stat_lines") or unstaged.get("patch_preview")):
            record_trace_event(trace_context, "git_diff_snapshot", unstaged)
        cached = await git_diff_snapshot_async(repo_path, cached=True)
        if cached and (cached.get("stat_lines") or cached.get("patch_preview")):
            record_trace_event(trace_context, "git_diff_cached_snapshot", cached)
    
    async def _git_identity_configured(self, repo_path: str) -> tuple[bool, str]:
        try:
            n = await run_git_async(["git", "-C", repo_path, "config", "user.name"], timeout=5)
            e = await run_git_async(["git", "-C", repo_path, "config", "user.email"], timeout=5)
            name = n.stdout.strip()
            email = e.stdout.strip()
            if name and email:
                return True, ""

            # fallback global
            ng = await run_git_async(["git", "config", "--global", "user.name"], timeout=5)
            eg = await run_git_async(["git", "config", "--global", "user.email"], timeout=5)
            gname = ng.stdout.strip()
            gemail = eg.stdout.strip()
            if gname and gemail:
                return True, ""
            return False, "Git identity missing. Set user.name and user.email (repo or global)."
        except Exception as e:
            return False, f"Git identity check failed: {str(e)}"

    """Service for tool operations."""
    
    def __init__(self):
        self.ffmpeg = FFmpegWrapper()
        self.docker = Docker()
    
    # FFmpeg operations
    async def ffmpeg_convert(self, request: FFMPEGConvertRequest, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Convert media file."""
        self._trace_start(trace_context, "ffmpeg.convert", {"input_path": request.input_path, "output_path": request.output_path})
        try:
            result = await self.ffmpeg.convert(
                input_path=request.input_path,
                output_path=request.output_path,
                codec=request.codec,
                quality=request.quality,
                start_time=request.start_time,
                duration=request.duration,
            )
            payload = {"success": True, "output": result}
            self._trace_finish(trace_context, "ffmpeg.convert", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "ffmpeg.convert", payload)
            return payload
    
    async def ffmpeg_extract_audio(self, request: FFMPEGExtractAudioRequest, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Extract audio from video."""
        self._trace_start(trace_context, "ffmpeg.extract_audio", {"input_path": request.input_path, "output_path": request.output_path})
        try:
            result = await self.ffmpeg.extract_audio(
                input_path=request.input_path,
                output_path=request.output_path,
                format=request.format,
            )
            payload = {"success": True, "output": result}
            self._trace_finish(trace_context, "ffmpeg.extract_audio", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "ffmpeg.extract_audio", payload)
            return payload
    
    async def ffmpeg_thumbnail(self, request: FFMPEGThumbnailRequest, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create video thumbnail."""
        self._trace_start(trace_context, "ffmpeg.thumbnail", {"input_path": request.input_path, "output_path": request.output_path})
        try:
            result = await self.ffmpeg.create_thumbnail(
                input_path=request.input_path,
                output_path=request.output_path,
                time=request.time,
            )
            payload = {"success": True, "output": result}
            self._trace_finish(trace_context, "ffmpeg.thumbnail", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "ffmpeg.thumbnail", payload)
            return payload
    
    async def ffmpeg_info(self, input_path: str, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Get media file info."""
        self._trace_start(trace_context, "ffmpeg.info", {"input_path": input_path})
        try:
            info = await self.ffmpeg.get_info(input_path)
            payload = {"success": True, "info": info}
            self._trace_finish(trace_context, "ffmpeg.info", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "ffmpeg.info", payload)
            return payload
    
    # Git operations
    async def git_clone(self, request: GitCloneRequest, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Clone a repository."""
        self._trace_start(trace_context, "git.clone", {"repo_url": request.repo_url, "destination": request.destination, "branch": request.branch, "depth": request.depth})
        try:
            result = await GitRepo.clone_async(
                url=request.repo_url,
                path=request.destination,
                branch=request.branch,
                depth=request.depth,
            )
            payload = {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            await self._trace_finish_async(trace_context, "git.clone", payload, repo_path=request.destination, capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.clone", payload, repo_path=request.destination, capture_git=True)
            return payload
    
    async def git_pull(self, request: GitPullRequest, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Pull from remote."""
        self._trace_start(trace_context, "git.pull", {"repo_path": request.repo_path, "remote": request.remote, "branch": request.branch, "rebase": request.rebase})
        try:
            repo = GitRepo(request.repo_path)
            result = await repo.pull_async(
                remote=request.remote,
                branch=request.branch,
                rebase=request.rebase,
            )
            payload = {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            await self._trace_finish_async(trace_context, "git.pull", payload, repo_path=request.repo_path, capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.pull", payload, repo_path=request.repo_path, capture_git=True)
            return payload
    
    async def git_status(self, repo_path: str, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Get repository status."""
        self._trace_start(trace_context, "git.status", {"repo_path": repo_path})
        try:
            repo = GitRepo(repo_path)
            status = await repo.status_async()
            payload = {
                "success": True,
                "staged": [s.dict() for s in status["staged"]],
                "unstaged": [s.dict() for s in status["unstaged"]],
                "untracked": [s.dict() for s in status["untracked"]],
            }
            await self._trace_finish_async(trace_context, "git.status", payload, repo_path=repo_path, capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.status", payload, repo_path=repo_path, capture_git=True)
            return payload
    
    async def git_log(self, repo_path: str, max_count: int = 10, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Get commit log."""
        self._trace_start(trace_context, "git.log", {"repo_path": repo_path, "max_count": max_count})
        try:
            repo = GitRepo(repo_path)
            commits = await repo.log_async(max_count=max_count)
            payload = {
                "success": True,
                "commits": [c.dict() for c in commits],
            }
            await self._trace_finish_async(trace_context, "git.log", payload, repo_path=repo_path, capture_git=False)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.log", payload, repo_path=repo_path, capture_git=False)
            return payload
    
    async def git_init(self, repo_path: str, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Initialize a new git repository."""
        self._trace_start(trace_context, "git.init", {"repo_path": repo_path})
        try:
            result = await run_git_async(["git", "init", "--", repo_path])
            payload = {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            await self._trace_finish_async(trace_context, "git.init", payload, repo_path=repo_path, capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.init", payload, repo_path=repo_path, capture_git=True)
            return payload
    
    async def git_add(self, repo_path: str, files: str = ".", *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Add files to staging."""
        self._trace_start(trace_context, "git.add", {"repo_path": repo_path, "files": files})
        try:
            repo = GitRepo(repo_path)
            result = await repo._run_async("add", "--", files)
            payload = {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            await self._trace_finish_async(trace_context, "git.add", payload, repo_path=repo_path, capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.add", payload, repo_path=repo_path, capture_git=True)
            return payload
    
    async def git_commit(self, repo_path: str, message: str, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a commit."""
        self._trace_start(trace_context, "git.commit", {"repo_path": repo_path, "message": message})
        try:
            ok, err = await self._git_identity_configured(repo_path)
            if not ok:
                payload = {"success": False, "error": err, "error_code": "git_identity_missing"}
                await self._trace_finish_async(trace_context, "git.commit", payload, repo_path=repo_path, capture_git=True)
                return payload

            repo = GitRepo(repo_path)
            result = await repo.commit_async(message)
            payload = {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            await self._trace_finish_async(trace_context, "git.commit", payload, repo_path=repo_path, capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.commit", payload, repo_path=repo_path, capture_git=True)
            return payload
    
    # Docker operations
    async def docker_run(self, request: DockerRunRequest, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Run a container."""
        self._trace_start(trace_context, "docker.run", {"image": request.image, "command": request.command, "name": request.name})
        try:
            config = ContainerConfig(
                image=request.image,
                command=request.command,
                name=request.name,
                env=request.env,
                ports=request.ports,
                volumes=request.volumes,
            )
            container = await self.docker.containers.run(config)
            payload = {"success": True, "container": container.dict()}
            self._trace_finish(trace_context, "docker.run", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "docker.run", payload)
            return payload
    
    async def docker_list(self, all: bool = False, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """List containers."""
        self._trace_start(trace_context, "docker.list", {"all": all})
        try:
            containers = await self.docker.containers.list(all=all)
            payload = {"success": True, "containers": [c.dict() for c in containers]}
            self._trace_finish(trace_context, "docker.list", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "docker.list", payload)
            return payload
    
    async def docker_stop(self, container_id: str, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Stop a container."""
        self._trace_start(trace_context, "docker.stop", {"container_id": container_id})
        try:
            await self.docker.containers.stop(container_id)
            payload = {"success": True}
            self._trace_finish(trace_context, "docker.stop", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "docker.stop", payload)
            return payload
    
    async def docker_build(self, request: DockerBuildRequest, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Build an image."""
        self._trace_start(trace_context, "docker.build", {"path": request.path, "tag": request.tag, "dockerfile": request.dockerfile})
        try:
            result = await self.docker.images.build(
                path=request.path,
                tag=request.tag,
                dockerfile=request.dockerfile,
            )
            payload = {"success": True, "output": result}
            self._trace_finish(trace_context, "docker.build", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "docker.build", payload)
            return payload
    
    async def docker_pull(self, image_name: str, tag: str = "latest", *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Pull an image."""
        self._trace_start(trace_context, "docker.pull", {"image_name": image_name, "tag": tag})
        try:
            await self.docker.images.pull(image_name, tag)
            payload = {"success": True}
            self._trace_finish(trace_context, "docker.pull", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "docker.pull", payload)
            return payload
    
    async def docker_logs(self, container_id: str, tail: int = 100, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Get container logs."""
        self._trace_start(trace_context, "docker.logs", {"container_id": container_id, "tail": tail})
        try:
            logs = []
            async for line in self.docker.containers.logs(container_id, tail=tail):
                logs.append(line)
            payload = {"success": True, "logs": logs}
            self._trace_finish(trace_context, "docker.logs", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "docker.logs", payload)
            return payload
