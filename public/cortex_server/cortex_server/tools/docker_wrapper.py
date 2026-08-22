"""
Docker CLI Wrapper - Async wrapper for Docker operations.
"""

import asyncio
import json
import os
import re
import stat
import time
from pathlib import Path, PurePosixPath
from typing import AsyncIterator, Dict, List, Optional, Sequence, Tuple, Any
from pydantic import BaseModel, Field
from .subprocess_lifecycle import (
    close_process_transports,
    observe_task,
    spawn_owned,
    stop_process,
)


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
    labels: Dict[str, str] = Field(default_factory=dict)


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


DEFAULT_TIMEOUT = 60.0
CLEANUP_GRACE = 1.0
MAX_OUTPUT_BYTES = 1024 * 1024
_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/+\-]{0,254}$")
_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_RUNTIME_SOCKET_PATHS = (
    "/run/docker.sock", "/var/run/docker.sock", "/run/containerd/containerd.sock",
    "/run/podman/podman.sock", "/var/run/crio/crio.sock",
)
_SENSITIVE_PATHS = (
    "/etc", "/proc", "/sys", "/dev",
    "/var/lib/docker", "/var/lib/containers",
)


async def _stop_process(proc: Any) -> None:
    """Terminate a child and bound both escalation reap attempts."""
    await stop_process(proc, CLEANUP_GRACE)


async def _spawn_owned(*args: str, **kwargs: Any) -> Any:
    """Spawn a child without allowing cancellation to orphan it mid-creation."""
    return await spawn_owned(
        asyncio.create_subprocess_exec(*args, **kwargs), CLEANUP_GRACE, _stop_process
    )


async def _settle_tasks(tasks: List["asyncio.Task[Any]"]) -> None:
    """Cancel and observe subprocess tasks within a finite cleanup budget."""
    for task in tasks:
        if not task.done():
            task.cancel()
    done, pending = await asyncio.wait(tasks, timeout=CLEANUP_GRACE)
    for task in done:
        try:
            task.result()
        except BaseException:
            pass
    for task in pending:
        observe_task(task)


def _identifier(value: str, kind: str) -> str:
    if not value or value.startswith("-") or not _IDENTIFIER.fullmatch(value):
        raise DockerError(f"Invalid Docker {kind}")
    return value


def _environment(env: Dict[str, str]) -> List[str]:
    """Return deterministic Docker environment assignments with safe names."""
    values = []
    for key in sorted(env):
        if not _ENV_NAME.fullmatch(key) or "\x00" in str(env[key]):
            raise DockerError("Invalid Docker environment")
        values.append(f"{key}={env[key]}")
    return values


def _paths_overlap(left: Path, right: Path) -> bool:
    """Return whether either absolute path contains the other."""
    return left == right or left in right.parents or right in left.parents


def _mount(host: str, container: str) -> str:
    """Resolve host mounts before launch, including symlinks, and force ro/rw modes."""
    # This API supports Linux bind paths only.  Parse the optional mode as a
    # deliberately small grammar instead of passing Docker ambiguous strings.
    # In particular, a colon in the host could be a Windows drive prefix and a
    # second colon in the container could hide an unsupported mount option.
    if not host or ":" in host or "\x00" in host or not container or "\x00" in container:
        raise DockerError("Invalid Docker bind mount")
    parts = container.split(":")
    if len(parts) == 1:
        container, access = parts[0], "ro"
    elif len(parts) == 2 and parts[1] in {"ro", "rw"}:
        container, access = parts
    else:
        raise DockerError("Invalid Docker bind mount")
    if not container.startswith("/"):
        raise DockerError("Invalid Docker bind mount")
    try:
        resolved = Path(host).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        raise DockerError("Invalid Docker bind mount") from None
    # Resolve both sides so aliases such as /var/run -> /run cannot bypass this
    # boundary.  Reject every Unix socket as well as known runtime endpoints.
    try:
        is_socket = stat.S_ISSOCK(resolved.stat().st_mode)
    except OSError:
        raise DockerError("Invalid Docker bind mount") from None
    runtime_sockets = {Path(p).resolve(strict=False) for p in _RUNTIME_SOCKET_PATHS}
    if is_socket or any(_paths_overlap(resolved, socket) for socket in runtime_sockets):
        raise DockerError("Docker runtime sockets cannot be bind mounted")
    configured_roots = os.getenv("CORTEX_DOCKER_MOUNT_ROOTS")
    roots = []
    if configured_roots:
        try:
            for value in configured_roots.split(os.pathsep):
                if not value or not Path(value).expanduser().is_absolute():
                    raise ValueError
                root = Path(value).expanduser().resolve(strict=True)
                if root == Path("/") or not root.is_dir():
                    raise ValueError
                roots.append(root)
        except (OSError, RuntimeError, ValueError):
            roots = []
    sensitive = tuple(Path(p).resolve(strict=False) for p in _SENSITIVE_PATHS) + (
        (Path.home() / ".ssh").resolve(strict=False),
        (Path.home() / ".docker").resolve(strict=False),
    )
    if resolved == Path("/") or any(_paths_overlap(resolved, p) for p in sensitive) or not any(resolved == root or root in resolved.parents for root in roots):
        raise DockerError("Docker bind mount is outside configured roots")
    return f"{resolved}:{container}:{access}"


_SAFE_DOCKER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_SAFE_IMAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,254}$")
_SAFE_ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
_CORTEX_MANAGED_LABEL = "com.cortex.execution.managed"


def _require_docker_identifier(value: str, *, kind: str) -> str:
    text = str(value or "").strip()
    pattern = _SAFE_IMAGE if kind == "image" else _SAFE_DOCKER_NAME
    if not pattern.fullmatch(text):
        raise DockerError(f"invalid Docker {kind}")
    return text


def _safe_container_path(value: str) -> str:
    path = PurePosixPath(str(value or ""))
    if not path.is_absolute() or ".." in path.parts:
        raise DockerError("container volume path must be absolute and normalized")
    return str(path)


async def _run_cmd(
    args: List[str],
    timeout: Optional[float] = DEFAULT_TIMEOUT,
    capture: bool = True,
) -> str:
    """Run a Docker CLI command."""
    deadline = time.monotonic() + (timeout or DEFAULT_TIMEOUT)
    try:
        proc = await asyncio.wait_for(
            _spawn_owned(
                *args,
                stdout=asyncio.subprocess.PIPE if capture else None,
                stderr=asyncio.subprocess.PIPE,
            ),
            max(0.0, deadline - time.monotonic()),
        )
    except asyncio.TimeoutError:
        raise DockerError("Docker command timed out") from None
    
    async def drain(stream: Any) -> Tuple[bytearray, bool]:
        retained = bytearray()
        overflowed = False
        if stream is None:
            return retained, overflowed
        while True:
            chunk = await stream.read(64 * 1024)
            if not chunk:
                return retained, overflowed
            if len(chunk) >= MAX_OUTPUT_BYTES:
                overflowed = overflowed or len(chunk) > MAX_OUTPUT_BYTES or bool(retained)
                retained[:] = chunk[-MAX_OUTPUT_BYTES:]
            else:
                overflow = len(retained) + len(chunk) - MAX_OUTPUT_BYTES
                if overflow > 0:
                    overflowed = True
                    del retained[:overflow]
                retained.extend(chunk)

    stdout_task = asyncio.create_task(drain(proc.stdout)) if capture else None
    stderr_task = asyncio.create_task(drain(proc.stderr))
    tasks = [asyncio.create_task(proc.wait()), stderr_task]
    if stdout_task is not None:
        tasks.append(stdout_task)
    try:
        done, pending = await asyncio.wait(
            tasks,
            timeout=max(0.0, deadline - time.monotonic()),
            return_when=asyncio.FIRST_EXCEPTION,
        )
        for task in done:
            if task.cancelled():
                raise asyncio.CancelledError
            failure = task.exception()
            if failure is not None:
                raise failure
        if pending:
            raise asyncio.TimeoutError
        results = [task.result() for task in tasks]
    except asyncio.TimeoutError:
        for task in tasks:
            task.cancel()
        await _stop_process(proc)
        close_process_transports(proc)
        await _settle_tasks(tasks)
        raise DockerError("Docker command timed out")
    except asyncio.CancelledError:
        for task in tasks:
            task.cancel()
        await _stop_process(proc)
        close_process_transports(proc)
        await _settle_tasks(tasks)
        raise
    except Exception:
        for task in tasks:
            task.cancel()
        await _stop_process(proc)
        close_process_transports(proc)
        await _settle_tasks(tasks)
        raise DockerError("Docker command failed") from None

    stderr = bytes(results[1][0])
    stdout = bytes(results[2][0]) if stdout_task is not None else b""
    stdout_overflowed = results[2][1] if stdout_task is not None else False
    
    if proc.returncode != 0:
        raise DockerError((stderr or b"Unknown error").decode(errors="replace").strip())
    if stdout_overflowed:
        raise DockerError("Docker command output limit exceeded")
    
    return stdout.decode(errors="replace") if stdout else ""


async def _stream_cmd(args: List[str]) -> AsyncIterator[str]:
    """Stream bounded, line-framed output under one total command deadline."""
    deadline = time.monotonic() + DEFAULT_TIMEOUT
    try:
        proc = await asyncio.wait_for(
            _spawn_owned(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            ),
            max(0.0, deadline - time.monotonic()),
        )
    except asyncio.TimeoutError:
        raise DockerError("Docker command timed out") from None

    pending = bytearray()
    output_bytes = 0
    try:
        if proc.stdout:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise DockerError("Docker command timed out")
                try:
                    chunk = await asyncio.wait_for(proc.stdout.read(64 * 1024), remaining)
                except asyncio.TimeoutError:
                    raise DockerError("Docker command timed out") from None
                if not chunk:
                    break
                output_bytes += len(chunk)
                if output_bytes > MAX_OUTPUT_BYTES:
                    raise DockerError("Docker command output limit exceeded")
                pending.extend(chunk)
                while b"\n" in pending:
                    line, _, rest = pending.partition(b"\n")
                    pending = bytearray(rest)
                    yield line.decode(errors="ignore").rstrip()
            if pending:
                yield bytes(pending).decode(errors="ignore").rstrip()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise DockerError("Docker command timed out")
        try:
            await asyncio.wait_for(proc.wait(), remaining)
        except asyncio.TimeoutError:
            raise DockerError("Docker command timed out") from None
        if proc.returncode != 0:
            raise DockerError("Docker command failed")
    finally:
        await _stop_process(proc)


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
        """Run a container with a non-networked, read-only default sandbox."""
        image = _require_docker_identifier(config.image, kind="image")
        if config.ports:
            raise DockerError("published ports are disabled by the constrained Docker capability")
        args = [
            "docker", "run",
            "--pull=never",
            "--network=none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--pids-limit=128",
            "--memory=512m",
            "--cpus=1",
            "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
            "--label", f"{_CORTEX_MANAGED_LABEL}=true",
        ]
        
        if config.detach:
            args.append("-d")
        
        if config.name:
            args.extend(["--name", _require_docker_identifier(config.name, kind="name")])

        for assignment in _environment(config.env):
            if len(assignment.partition("=")[2]) > 8192:
                raise DockerError("invalid container environment entry")
            args.extend(["-e", assignment])
        
        for hpath, cpath in config.volumes.items():
            args.extend(["-v", _mount(hpath, cpath)])
        
        args.extend(["--", image])
        
        if config.command:
            args.extend(config.command)
        
        container_id = _identifier(
            (await _run_cmd(args)).strip(), "container ID"
        )
        try:
            return await self.inspect(container_id)
        except Exception:
            if not config.detach:
                raise
            # `docker run -d` returning an ID is the creation commit point.
            # Inspection only enriches the response and must not turn that
            # success into a retryable creation failure.
            return Container(
                id=container_id[:12],
                name=config.name or "",
                image=config.image,
                status="",
            )
    
    async def start(self, container_id: str) -> None:
        """Start a container."""
        await _run_cmd(["docker", "start", "--", _identifier(container_id, "container ID")])
    
    async def stop(self, container_id: str, timeout: int = 10) -> None:
        """Stop only a container created by the constrained Cortex runner."""
        requested_id = _identifier(container_id, "container ID")
        if not isinstance(timeout, int) or isinstance(timeout, bool) or not 0 <= timeout <= 300:
            raise DockerError("Invalid Docker stop timeout")
        output = await _run_cmd(["docker", "inspect", "--", requested_id])
        try:
            data = json.loads(output)[0]
            labels = (data.get("Config") or {}).get("Labels") or {}
            resolved_id = _identifier(str(data.get("Id") or ""), "container ID")
        except (IndexError, KeyError, TypeError, json.JSONDecodeError, DockerError) as exc:
            raise DockerError("unable to prove Docker container ownership") from exc
        if not isinstance(labels, dict) or str(labels.get(_CORTEX_MANAGED_LABEL) or "").lower() != "true":
            raise DockerError("refusing to stop a container not owned by Cortex execution")
        await _run_cmd(["docker", "stop", "-t", str(timeout), "--", resolved_id])
    
    async def restart(self, container_id: str) -> None:
        """Restart a container."""
        await _run_cmd(["docker", "restart", "--", _identifier(container_id, "container ID")])
    
    async def pause(self, container_id: str) -> None:
        """Pause a container."""
        await _run_cmd(["docker", "pause", "--", _identifier(container_id, "container ID")])
    
    async def unpause(self, container_id: str) -> None:
        """Unpause a container."""
        await _run_cmd(["docker", "unpause", "--", _identifier(container_id, "container ID")])
    
    async def remove(self, container_id: str, force: bool = False, volumes: bool = False) -> None:
        """Remove a container."""
        args = ["docker", "rm"]
        if force:
            args.append("-f")
        if volumes:
            args.append("-v")
        args.extend(["--", _identifier(container_id, "container ID")])
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
        output = await _run_cmd(["docker", "inspect", "--", _identifier(container_id, "container ID")])
        data = json.loads(output)[0]
        
        config = data.get("Config", {})
        state = data.get("State", {})
        
        env_rows = config.get("Env") if isinstance(config.get("Env"), list) else []
        env = {}
        for row in env_rows:
            key, separator, value = str(row).partition("=")
            if separator and _SAFE_ENV_KEY.fullmatch(key):
                env[key] = value
        labels = config.get("Labels") if isinstance(config.get("Labels"), dict) else {}
        return Container(
            id=data.get("Id", "")[:12],
            name=data.get("Name", "").lstrip("/"),
            image=config.get("Image", ""),
            status=state.get("Status", ""),
            env=env,
            labels={str(key): str(value) for key, value in labels.items()},
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
        args.extend(["--", _identifier(container_id, "container ID")])
        
        async for line in _stream_cmd(args):
            yield line
    
    async def exec_run(
        self,
        container_id: str,
        cmd: Sequence[str],
        stream: bool = False,
    ) -> Any:
        """Execute a command in a container."""
        args = ["docker", "exec", "--", _identifier(container_id, "container ID")] + list(cmd)
        
        if stream:
            return _stream_cmd(args)
        else:
            return await _run_cmd(args)


class ImageManager:
    """Manage Docker images."""
    
    async def pull(self, image_name: str, tag: str = "latest") -> None:
        """Pull an image."""
        image = _require_docker_identifier(image_name, kind="image")
        safe_tag = _require_docker_identifier(tag, kind="tag")
        await _run_cmd(["docker", "pull", "--", f"{image}:{safe_tag}"])
    
    async def build(
        self,
        path: str,
        tag: str,
        dockerfile: str = "Dockerfile",
        build_args: Optional[Dict[str, str]] = None,
    ) -> str:
        """Build an image without allowing Dockerfile-controlled egress."""
        safe_tag = _require_docker_identifier(tag, kind="tag")
        if dockerfile.startswith("-") or "\x00" in dockerfile:
            raise DockerError("Invalid Dockerfile")
        args = [
            "docker", "build",
            "--network=none",
            "--pull=false",
            "-t", safe_tag,
            "-f", dockerfile,
        ]
        
        if build_args:
            for k, v in build_args.items():
                if not _SAFE_ENV_KEY.fullmatch(str(k)) or "\x00" in str(v) or len(str(v)) > 8192:
                    raise DockerError("Invalid Docker build argument")
                args.extend(["--build-arg", f"{k}={v}"])
        
        args.extend(["--", path])
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
        args.extend(["--", _identifier(image_id, "image ID")])
        await _run_cmd(args)


class VolumeManager:
    """Manage Docker volumes."""
    
    async def create(self, name: str, driver: str = "local") -> Volume:
        """Create a volume."""
        await _run_cmd(["docker", "volume", "create", "--driver", _identifier(driver, "volume driver"), "--", _identifier(name, "volume name")])
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
        await _run_cmd(["docker", "volume", "rm", "--", _identifier(name, "volume name")])
    
    async def inspect(self, name: str) -> Volume:
        """Inspect a volume."""
        output = await _run_cmd(["docker", "volume", "inspect", "--", _identifier(name, "volume name")])
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
