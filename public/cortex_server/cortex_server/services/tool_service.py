"""
Tool Service - Business logic for CLI tool operations.
"""

from typing import Dict, Any, Optional
from cortex_server.tools.ffmpeg_wrapper import FFmpegWrapper
from cortex_server.tools.git_wrapper import GitRepo
from cortex_server.tools.docker_wrapper import Docker, ContainerConfig
from cortex_server.models.requests import (
    FFMPEGConvertRequest, FFMPEGExtractAudioRequest, FFMPEGThumbnailRequest,
    GitCloneRequest, GitPullRequest, GitCommitRequest,
    DockerRunRequest, DockerBuildRequest,
)


class ToolService:
    
    def _git_identity_configured(self, repo_path: str) -> tuple[bool, str]:
        import subprocess
        try:
            n = subprocess.run(["git", "-C", repo_path, "config", "user.name"], capture_output=True, text=True)
            e = subprocess.run(["git", "-C", repo_path, "config", "user.email"], capture_output=True, text=True)
            name = n.stdout.strip()
            email = e.stdout.strip()
            if name and email:
                return True, ""

            # fallback global
            ng = subprocess.run(["git", "config", "--global", "user.name"], capture_output=True, text=True)
            eg = subprocess.run(["git", "config", "--global", "user.email"], capture_output=True, text=True)
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
    async def ffmpeg_convert(self, request: FFMPEGConvertRequest) -> Dict[str, Any]:
        """Convert media file."""
        try:
            result = await self.ffmpeg.convert(
                input_path=request.input_path,
                output_path=request.output_path,
                codec=request.codec,
                quality=request.quality,
                start_time=request.start_time,
                duration=request.duration,
            )
            return {"success": True, "output": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def ffmpeg_extract_audio(self, request: FFMPEGExtractAudioRequest) -> Dict[str, Any]:
        """Extract audio from video."""
        try:
            result = await self.ffmpeg.extract_audio(
                input_path=request.input_path,
                output_path=request.output_path,
                format=request.format,
            )
            return {"success": True, "output": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def ffmpeg_thumbnail(self, request: FFMPEGThumbnailRequest) -> Dict[str, Any]:
        """Create video thumbnail."""
        try:
            result = await self.ffmpeg.create_thumbnail(
                input_path=request.input_path,
                output_path=request.output_path,
                time=request.time,
            )
            return {"success": True, "output": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def ffmpeg_info(self, input_path: str) -> Dict[str, Any]:
        """Get media file info."""
        try:
            info = await self.ffmpeg.get_info(input_path)
            return {"success": True, "info": info}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # Git operations
    async def git_clone(self, request: GitCloneRequest) -> Dict[str, Any]:
        """Clone a repository."""
        try:
            result = await GitRepo.clone_async(
                url=request.repo_url,
                path=request.destination,
                branch=request.branch,
                depth=request.depth,
            )
            return {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def git_pull(self, request: GitPullRequest) -> Dict[str, Any]:
        """Pull from remote."""
        try:
            repo = GitRepo(request.repo_path)
            result = await repo.pull_async(
                remote=request.remote,
                branch=request.branch,
                rebase=request.rebase,
            )
            return {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def git_status(self, repo_path: str) -> Dict[str, Any]:
        """Get repository status."""
        try:
            repo = GitRepo(repo_path)
            status = repo.status()
            return {
                "success": True,
                "staged": [s.dict() for s in status["staged"]],
                "unstaged": [s.dict() for s in status["unstaged"]],
                "untracked": [s.dict() for s in status["untracked"]],
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def git_log(self, repo_path: str, max_count: int = 10) -> Dict[str, Any]:
        """Get commit log."""
        try:
            repo = GitRepo(repo_path)
            commits = repo.log(max_count=max_count)
            return {
                "success": True,
                "commits": [c.dict() for c in commits],
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def git_init(self, repo_path: str) -> Dict[str, Any]:
        """Initialize a new git repository."""
        try:
            import subprocess
            result = subprocess.run(
                ["git", "init", repo_path],
                capture_output=True,
                text=True
            )
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def git_add(self, repo_path: str, files: str = ".") -> Dict[str, Any]:
        """Add files to staging."""
        try:
            repo = GitRepo(repo_path)
            result = repo._run("add", files)
            return {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def git_commit(self, repo_path: str, message: str) -> Dict[str, Any]:
        """Create a commit."""
        try:
            ok, err = self._git_identity_configured(repo_path)
            if not ok:
                return {"success": False, "error": err, "error_code": "git_identity_missing"}

            repo = GitRepo(repo_path)
            result = repo.commit(message)
            return {
                "success": result.success,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # Docker operations
    async def docker_run(self, request: DockerRunRequest) -> Dict[str, Any]:
        """Run a container."""
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
            return {"success": True, "container": container.dict()}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def docker_list(self, all: bool = False) -> Dict[str, Any]:
        """List containers."""
        try:
            containers = await self.docker.containers.list(all=all)
            return {"success": True, "containers": [c.dict() for c in containers]}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def docker_stop(self, container_id: str) -> Dict[str, Any]:
        """Stop a container."""
        try:
            await self.docker.containers.stop(container_id)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def docker_build(self, request: DockerBuildRequest) -> Dict[str, Any]:
        """Build an image."""
        try:
            result = await self.docker.images.build(
                path=request.path,
                tag=request.tag,
                dockerfile=request.dockerfile,
            )
            return {"success": True, "output": result}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def docker_pull(self, image_name: str, tag: str = "latest") -> Dict[str, Any]:
        """Pull an image."""
        try:
            await self.docker.images.pull(image_name, tag)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def docker_logs(self, container_id: str, tail: int = 100) -> Dict[str, Any]:
        """Get container logs."""
        try:
            logs = []
            async for line in self.docker.containers.logs(container_id, tail=tail):
                logs.append(line)
            return {"success": True, "logs": logs}
        except Exception as e:
            return {"success": False, "error": str(e)}