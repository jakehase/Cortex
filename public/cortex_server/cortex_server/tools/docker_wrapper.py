"""
Docker CLI Wrapper - Async wrapper for Docker operations.
"""

import asyncio
import json
from typing import AsyncIterator, Dict, List, Optional, Sequence, Any
from pydantic import BaseModel, Field


class DockerError(Exception):
    """Exception raised for Docker errors."""
    pass


class Container(BaseModel):
    """Docker container information."""
    id: str
    name: str
    image: str
    status: str
    ports: List[str] = Field(default_factory=list)
    volumes: List[str] = Field(default_factory=list)
    env: Dict[str, str] = Field(default_factory=dict)


class Image(BaseModel):
    """Docker image information."""
    id: str
    repo_tags: List[str] = Field(default_factory=list)
    size: int
    created: str


class Volume(BaseModel):
    """Docker volume information."""
    name: str
    driver: str
    mountpoint: str
    size: Optional[int] = None


class ContainerConfig(BaseModel):
    """Container configuration."""
    image: str
    command: Optional[Sequence[str]] = None
    env: Dict[str, str] = Field(default_factory=dict)
    ports: Dict[str, str] = Field(default_factory=dict)  # container_port -> host_port
    volumes: Dict[str, str] = Field(default_factory=dict)  # host_path -> container_path
    name: Optional[str] = None
    detach: bool = True


async def _run_cmd(
    args: List[str],
    timeout: Optional[float] = None,
    capture: bool = True,
) -> str:
    """Run a Docker CLI command."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE if capture else None,
        stderr=asyncio.subprocess.PIPE,
    )
    
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise DockerError(f"Command timed out: {' '.join(args)}")
    except asyncio.CancelledError:
        proc.kill()
        raise
    
    if proc.returncode != 0:
        raise DockerError(stderr.decode().strip() if stderr else "Unknown error")
    
    return stdout.decode() if stdout else ""


async def _stream_cmd(args: List[str]) -> AsyncIterator[str]:
    """Stream output from a command."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    
    try:
        if proc.stdout:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                yield line.decode(errors="ignore").rstrip()
    finally:
        if proc.returncode is None:
            proc.terminate()


def _parse_size_bytes(size_str: str) -> int:
    """Parse Docker size string to bytes."""
    size_str = size_str.strip()
    if not size_str:
        return 0
    
    # Remove 'B' suffix and get unit
    if size_str.endswith('B'):
        size_str = size_str[:-1]
    
    multipliers = {
        'B': 1,
        'KB': 1024,
        'MB': 1024**2,
        'GB': 1024**3,
        'TB': 1024**4,
    }
    
    for unit, mult in sorted(multipliers.items(), key=lambda x: -len(x[0])):
        if size_str.endswith(unit):
            try:
                return int(float(size_str[:-len(unit)]) * mult)
            except ValueError:
                return 0
    
    try:
        return int(float(size_str))
    except ValueError:
        return 0


class ContainerManager:
    """Manage Docker containers."""
    
    async def run(self, config: ContainerConfig) -> Container:
        """Run a new container."""
        args = ["docker", "run"]
        
        if config.detach:
            args.append("-d")
        
        if config.name:
            args.extend(["--name", config.name])
        
        for k, v in config.env.items():
            args.extend(["-e", f"{k}={v}"])
        
        for cport, hport in config.ports.items():
            args.extend(["-p", f"{hport}:{cport}"])
        
        for hpath, cpath in config.volumes.items():
            args.extend(["-v", f"{hpath}:{cpath}"])
        
        args.append(config.image)
        
        if config.command:
            args.extend(config.command)
        
        container_id = (await _run_cmd(args)).strip()
        return await self.inspect(container_id)
    
    async def start(self, container_id: str) -> None:
        """Start a container."""
        await _run_cmd(["docker", "start", container_id])
    
    async def stop(self, container_id: str, timeout: int = 10) -> None:
        """Stop a container."""
        await _run_cmd(["docker", "stop", "-t", str(timeout), container_id])
    
    async def restart(self, container_id: str) -> None:
        """Restart a container."""
        await _run_cmd(["docker", "restart", container_id])
    
    async def pause(self, container_id: str) -> None:
        """Pause a container."""
        await _run_cmd(["docker", "pause", container_id])
    
    async def unpause(self, container_id: str) -> None:
        """Unpause a container."""
        await _run_cmd(["docker", "unpause", container_id])
    
    async def remove(self, container_id: str, force: bool = False, volumes: bool = False) -> None:
        """Remove a container."""
        args = ["docker", "rm"]
        if force:
            args.append("-f")
        if volumes:
            args.append("-v")
        args.append(container_id)
        await _run_cmd(args)
    
    async def list(self, all: bool = False) -> List[Container]:
        """List containers."""
        args = ["docker", "ps", "--format", "{{json .}}"]
        if all:
            args.insert(2, "-a")
        
        output = await _run_cmd(args)
        containers = []
        
        for line in output.strip().splitlines():
            if line.strip():
                try:
                    data = json.loads(line)
                    containers.append(Container(
                        id=data.get("ID", ""),
                        name=data.get("Names", ""),
                        image=data.get("Image", ""),
                        status=data.get("Status", ""),
                        ports=data.get("Ports", "").split(", ") if data.get("Ports") else [],
                    ))
                except json.JSONDecodeError:
                    continue
        
        return containers
    
    async def inspect(self, container_id: str) -> Container:
        """Inspect a container."""
        output = await _run_cmd(["docker", "inspect", container_id])
        data = json.loads(output)[0]
        
        config = data.get("Config", {})
        state = data.get("State", {})
        
        return Container(
            id=data.get("Id", "")[:12],
            name=data.get("Name", "").lstrip("/"),
            image=config.get("Image", ""),
            status=state.get("Status", ""),
            env=config.get("Env", []),
        )
    
    async def logs(
        self,
        container_id: str,
        follow: bool = False,
        tail: int = 100,
        since: Optional[str] = None,
    ) -> AsyncIterator[str]:
        """Get container logs."""
        args = ["docker", "logs", "--tail", str(tail)]
        if follow:
            args.append("-f")
        if since:
            args.extend(["--since", since])
        args.append(container_id)
        
        async for line in _stream_cmd(args):
            yield line
    
    async def exec_run(
        self,
        container_id: str,
        cmd: Sequence[str],
        stream: bool = False,
    ) -> Any:
        """Execute a command in a container."""
        args = ["docker", "exec", container_id] + list(cmd)
        
        if stream:
            return _stream_cmd(args)
        else:
            return await _run_cmd(args)


class ImageManager:
    """Manage Docker images."""
    
    async def pull(self, image_name: str, tag: str = "latest") -> None:
        """Pull an image."""
        await _run_cmd(["docker", "pull", f"{image_name}:{tag}"])
    
    async def build(
        self,
        path: str,
        tag: str,
        dockerfile: str = "Dockerfile",
        build_args: Optional[Dict[str, str]] = None,
    ) -> str:
        """Build an image."""
        args = ["docker", "build", "-t", tag, "-f", dockerfile]
        
        if build_args:
            for k, v in build_args.items():
                args.extend(["--build-arg", f"{k}={v}"])
        
        args.append(path)
        return await _run_cmd(args)
    
    async def list(self) -> List[Image]:
        """List images."""
        output = await _run_cmd(["docker", "images", "--format", "{{json .}}"])
        images = []
        
        for line in output.strip().splitlines():
            if line.strip():
                try:
                    data = json.loads(line)
                    repo = data.get("Repository", "")
                    img_tag = data.get("Tag", "")
                    images.append(Image(
                        id=data.get("ID", ""),
                        repo_tags=[f"{repo}:{img_tag}"] if repo and img_tag else [],
                        size=_parse_size_bytes(data.get("Size", "0B")),
                        created=data.get("CreatedAt", ""),
                    ))
                except json.JSONDecodeError:
                    continue
        
        return images
    
    async def remove(self, image_id: str, force: bool = False) -> None:
        """Remove an image."""
        args = ["docker", "rmi"]
        if force:
            args.append("-f")
        args.append(image_id)
        await _run_cmd(args)


class VolumeManager:
    """Manage Docker volumes."""
    
    async def create(self, name: str, driver: str = "local") -> Volume:
        """Create a volume."""
        await _run_cmd(["docker", "volume", "create", "--driver", driver, name])
        return await self.inspect(name)
    
    async def list(self) -> List[Volume]:
        """List volumes."""
        output = await _run_cmd(["docker", "volume", "ls", "--format", "{{json .}}"])
        volumes = []
        
        for line in output.strip().splitlines():
            if line.strip():
                try:
                    data = json.loads(line)
                    volumes.append(Volume(
                        name=data.get("Name", ""),
                        driver=data.get("Driver", ""),
                        mountpoint=data.get("Mountpoint", ""),
                    ))
                except json.JSONDecodeError:
                    continue
        
        return volumes
    
    async def remove(self, name: str) -> None:
        """Remove a volume."""
        await _run_cmd(["docker", "volume", "rm", name])
    
    async def inspect(self, name: str) -> Volume:
        """Inspect a volume."""
        output = await _run_cmd(["docker", "volume", "inspect", name])
        data = json.loads(output)[0]
        
        return Volume(
            name=data.get("Name", ""),
            driver=data.get("Driver", ""),
            mountpoint=data.get("Mountpoint", ""),
        )


class Docker:
    """Main Docker interface."""
    
    def __init__(self):
        self.containers = ContainerManager()
        self.images = ImageManager()
        self.volumes = VolumeManager()
    
    async def version(self) -> Dict[str, str]:
        """Get Docker version info."""
        output = await _run_cmd(["docker", "version", "--format", "{{json .}}"])
        return json.loads(output)