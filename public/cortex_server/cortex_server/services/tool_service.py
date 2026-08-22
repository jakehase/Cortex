"""
Tool Service - Business logic for CLI tool operations.
"""

from pathlib import Path
import re
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
from cortex_server.modules.execution_capabilities import (
    ExecutionCapabilityDenied,
    ExecutionGrant,
    authorize_git_remote_url,
    require_execution_grant,
    resolve_authorized_path,
)


_SAFE_GIT_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$")


def _safe_git_ref(value: Optional[str], *, field: str, required: bool = False) -> Optional[str]:
    text = str(value or "").strip()
    if not text and not required:
        return None
    if (
        not text
        or not _SAFE_GIT_REF.fullmatch(text)
        or ".." in text
        or "@{" in text
        or text.endswith(".")
        or text.endswith("/")
    ):
        raise ExecutionCapabilityDenied(
            "execution_git_ref_invalid",
            f"Git {field} is not a bounded safe ref/name",
            status_code=400,
        )
    return text


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
            n = await run_git_async(
                GitRepo._command("-C", repo_path, "config", "--local", "user.name"),
                timeout=5,
                env=GitRepo._environment(),
            )
            e = await run_git_async(
                GitRepo._command("-C", repo_path, "config", "--local", "user.email"),
                timeout=5,
                env=GitRepo._environment(),
            )
            name = n.stdout.strip()
            email = e.stdout.strip()
            if name and email:
                return True, ""
            return False, "Repository-local Git identity missing. Set user.name and user.email in the authorized repository."
        except Exception as e:
            return False, "Git identity check failed"

    """Service for tool operations."""
    
    def __init__(self):
        self.ffmpeg = FFmpegWrapper()
        self.docker = Docker()
    
    # FFmpeg operations
    async def ffmpeg_convert(self, request: FFMPEGConvertRequest, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Convert media file."""
        action = "tools.ffmpeg.convert"
        require_execution_grant(grant, action)
        input_path = resolve_authorized_path(grant, action, request.input_path, require_file=True)
        output_path = resolve_authorized_path(grant, action, request.output_path)
        self._trace_start(trace_context, "ffmpeg.convert", {"input_path": request.input_path, "output_path": request.output_path})
        try:
            result = await self.ffmpeg.convert(
                input_path=str(input_path),
                output_path=str(output_path),
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
    
    async def ffmpeg_extract_audio(self, request: FFMPEGExtractAudioRequest, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Extract audio from video."""
        action = "tools.ffmpeg.extract_audio"
        require_execution_grant(grant, action)
        input_path = resolve_authorized_path(grant, action, request.input_path, require_file=True)
        output_path = resolve_authorized_path(grant, action, request.output_path)
        self._trace_start(trace_context, "ffmpeg.extract_audio", {"input_path": request.input_path, "output_path": request.output_path})
        try:
            result = await self.ffmpeg.extract_audio(
                input_path=str(input_path),
                output_path=str(output_path),
                format=request.format,
            )
            payload = {"success": True, "output": result}
            self._trace_finish(trace_context, "ffmpeg.extract_audio", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "ffmpeg.extract_audio", payload)
            return payload
    
    async def ffmpeg_thumbnail(self, request: FFMPEGThumbnailRequest, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create video thumbnail."""
        action = "tools.ffmpeg.thumbnail"
        require_execution_grant(grant, action)
        input_path = resolve_authorized_path(grant, action, request.input_path, require_file=True)
        output_path = resolve_authorized_path(grant, action, request.output_path)
        self._trace_start(trace_context, "ffmpeg.thumbnail", {"input_path": request.input_path, "output_path": request.output_path})
        try:
            result = await self.ffmpeg.create_thumbnail(
                input_path=str(input_path),
                output_path=str(output_path),
                time=request.time,
            )
            payload = {"success": True, "output": result}
            self._trace_finish(trace_context, "ffmpeg.thumbnail", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "ffmpeg.thumbnail", payload)
            return payload
    
    async def ffmpeg_info(self, input_path: str, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Get media file info."""
        action = "tools.ffmpeg.info"
        require_execution_grant(grant, action)
        safe_input = resolve_authorized_path(grant, action, input_path, require_file=True)
        self._trace_start(trace_context, "ffmpeg.info", {"input_path": input_path})
        try:
            info = await self.ffmpeg.get_info(str(safe_input))
            payload = {"success": True, "info": info}
            self._trace_finish(trace_context, "ffmpeg.info", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "ffmpeg.info", payload)
            return payload
    
    # Git operations
    async def git_clone(self, request: GitCloneRequest, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Clone a repository."""
        action = "tools.git.clone"
        require_execution_grant(grant, action)
        repo_url = authorize_git_remote_url(grant, action, request.repo_url)
        branch = _safe_git_ref(request.branch, field="branch")
        destination = resolve_authorized_path(grant, action, request.destination)
        self._trace_start(trace_context, "git.clone", {"repo_url": request.repo_url, "destination": request.destination, "branch": request.branch, "depth": request.depth})
        try:
            result = await GitRepo.clone_async(
                url=repo_url,
                path=str(destination),
                branch=branch,
                depth=request.depth,
            )
            payload = {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            await self._trace_finish_async(trace_context, "git.clone", payload, repo_path=str(destination), capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.clone", payload, repo_path=str(destination), capture_git=True)
            return payload
    
    async def git_pull(self, request: GitPullRequest, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Pull from remote."""
        action = "tools.git.pull"
        require_execution_grant(grant, action)
        repo_path = resolve_authorized_path(grant, action, request.repo_path, require_directory=True)
        remote = _safe_git_ref(request.remote, field="remote", required=True)
        branch = _safe_git_ref(request.branch, field="branch")
        self._trace_start(trace_context, "git.pull", {"repo_path": request.repo_path, "remote": request.remote, "branch": request.branch, "rebase": request.rebase})
        try:
            repo = GitRepo(str(repo_path))
            authorize_git_remote_url(grant, action, await repo.remote_url_async(remote))
            result = await repo.pull_async(
                remote=remote,
                branch=branch,
                rebase=request.rebase,
            )
            payload = {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            await self._trace_finish_async(trace_context, "git.pull", payload, repo_path=str(repo_path), capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.pull", payload, repo_path=str(repo_path), capture_git=True)
            return payload
    
    async def git_status(self, repo_path: str, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Get repository status."""
        action = "tools.git.status"
        require_execution_grant(grant, action)
        safe_repo_path = resolve_authorized_path(grant, action, repo_path, require_directory=True)
        self._trace_start(trace_context, "git.status", {"repo_path": repo_path})
        try:
            repo = GitRepo(str(safe_repo_path))
            status = await repo.status_async()
            payload = {
                "success": True,
                "staged": [s.dict() for s in status["staged"]],
                "unstaged": [s.dict() for s in status["unstaged"]],
                "untracked": [s.dict() for s in status["untracked"]],
            }
            await self._trace_finish_async(trace_context, "git.status", payload, repo_path=str(safe_repo_path), capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.status", payload, repo_path=str(safe_repo_path), capture_git=True)
            return payload
    
    async def git_log(self, repo_path: str, max_count: int = 10, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Get commit log."""
        action = "tools.git.log"
        require_execution_grant(grant, action)
        safe_repo_path = resolve_authorized_path(grant, action, repo_path, require_directory=True)
        self._trace_start(trace_context, "git.log", {"repo_path": repo_path, "max_count": max_count})
        try:
            repo = GitRepo(str(safe_repo_path))
            commits = await repo.log_async(max_count=max_count)
            payload = {
                "success": True,
                "commits": [c.dict() for c in commits],
            }
            await self._trace_finish_async(trace_context, "git.log", payload, repo_path=str(safe_repo_path), capture_git=False)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.log", payload, repo_path=str(safe_repo_path), capture_git=False)
            return payload
    
    async def git_init(self, repo_path: str, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Initialize a new git repository."""
        action = "tools.git.init"
        require_execution_grant(grant, action)
        safe_repo_path = resolve_authorized_path(grant, action, repo_path)
        self._trace_start(trace_context, "git.init", {"repo_path": repo_path})
        try:
            result = await run_git_async(
                GitRepo._command("init", "--", str(safe_repo_path)),
                env=GitRepo._environment(),
            )
            payload = {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            await self._trace_finish_async(
                trace_context,
                "git.init",
                payload,
                repo_path=str(safe_repo_path),
                capture_git=True,
            )
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(
                trace_context,
                "git.init",
                payload,
                repo_path=str(safe_repo_path),
                capture_git=True,
            )
            return payload
    
    async def git_add(self, repo_path: str, files: str = ".", *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Add files to staging."""
        action = "tools.git.add"
        require_execution_grant(grant, action)
        safe_repo_path = resolve_authorized_path(grant, action, repo_path, require_directory=True)
        if not files or files.startswith("-") or Path(files).is_absolute() or ".." in Path(files).parts:
            raise ValueError("git add path must be a relative path below the authorized repository")
        stage_path = (safe_repo_path / files).resolve(strict=False)
        if stage_path != safe_repo_path and safe_repo_path not in stage_path.parents:
            raise ValueError("git add path escapes the authorized repository")
        self._trace_start(trace_context, "git.add", {"repo_path": repo_path, "files": files})
        try:
            repo = GitRepo(str(safe_repo_path))
            result = await repo._run_async("add", "--", files)
            payload = {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            await self._trace_finish_async(trace_context, "git.add", payload, repo_path=str(safe_repo_path), capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.add", payload, repo_path=str(safe_repo_path), capture_git=True)
            return payload
    
    async def git_commit(self, repo_path: str, message: str, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a commit."""
        action = "tools.git.commit"
        require_execution_grant(grant, action)
        safe_repo_path = resolve_authorized_path(grant, action, repo_path, require_directory=True)
        self._trace_start(trace_context, "git.commit", {"repo_path": repo_path, "message": message})
        try:
            repo = GitRepo(str(safe_repo_path))
            ok, err = await self._git_identity_configured(str(safe_repo_path))
            if not ok:
                payload = {"success": False, "error": err, "error_code": "git_identity_missing"}
                await self._trace_finish_async(trace_context, "git.commit", payload, repo_path=str(safe_repo_path), capture_git=True)
                return payload

            result = await repo.commit_async(message)
            payload = {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            await self._trace_finish_async(trace_context, "git.commit", payload, repo_path=str(safe_repo_path), capture_git=True)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            await self._trace_finish_async(trace_context, "git.commit", payload, repo_path=str(safe_repo_path), capture_git=True)
            return payload
    
    # Docker operations
    async def docker_run(self, request: DockerRunRequest, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Run a container."""
        action = "tools.docker.run"
        require_execution_grant(grant, action)
        safe_volumes = {
            str(resolve_authorized_path(grant, action, host_path, must_exist=True)): container_path
            for host_path, container_path in request.volumes.items()
        }
        if any(not (Path(host_path).is_file() or Path(host_path).is_dir()) for host_path in safe_volumes):
            raise ExecutionCapabilityDenied(
                "execution_docker_volume_type_denied",
                "Docker bind sources must be regular files or directories",
                status_code=403,
            )
        self._trace_start(trace_context, "docker.run", {"image": request.image, "command": request.command, "name": request.name})
        try:
            config = ContainerConfig(
                image=request.image,
                command=request.command,
                name=request.name,
                env=request.env,
                ports=request.ports,
                volumes=safe_volumes,
            )
            container = await self.docker.containers.run(config)
            payload = {"success": True, "container": container.dict()}
            self._trace_finish(trace_context, "docker.run", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "docker.run", payload)
            return payload
    
    async def docker_list(self, all: bool = False, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """List containers."""
        require_execution_grant(grant, "tools.docker.list")
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
    
    async def docker_stop(self, container_id: str, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Stop a container."""
        require_execution_grant(grant, "tools.docker.stop")
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
    
    async def docker_build(self, request: DockerBuildRequest, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Build an image."""
        action = "tools.docker.build"
        require_execution_grant(grant, action)
        context_path = resolve_authorized_path(grant, action, request.path, require_directory=True)
        raw_dockerfile = Path(request.dockerfile)
        dockerfile_path = raw_dockerfile if raw_dockerfile.is_absolute() else context_path / raw_dockerfile
        dockerfile_path = resolve_authorized_path(grant, action, dockerfile_path, require_file=True)
        if context_path != dockerfile_path and context_path not in dockerfile_path.parents:
            raise ValueError("dockerfile must remain within the authorized build context")
        self._trace_start(trace_context, "docker.build", {"path": request.path, "tag": request.tag, "dockerfile": request.dockerfile})
        try:
            result = await self.docker.images.build(
                path=str(context_path),
                tag=request.tag,
                dockerfile=str(dockerfile_path),
            )
            payload = {"success": True, "output": result}
            self._trace_finish(trace_context, "docker.build", payload)
            return payload
        except Exception as e:
            payload = {"success": False, "error": self._safe_error(e)}
            self._trace_finish(trace_context, "docker.build", payload)
            return payload
    
    async def docker_pull(self, image_name: str, tag: str = "latest", *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Pull an image."""
        require_execution_grant(grant, "tools.docker.pull")
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
    
    async def docker_logs(self, container_id: str, tail: int = 100, *, grant: ExecutionGrant, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Get container logs."""
        require_execution_grant(grant, "tools.docker.logs")
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
