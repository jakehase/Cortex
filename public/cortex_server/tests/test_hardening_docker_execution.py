import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from cortex_server.tools import docker_wrapper


def test_production_container_healthcheck_uses_readiness_not_liveness():
    dockerfile = (Path(__file__).resolve().parents[2] / "Dockerfile").read_text(encoding="utf-8")

    assert "CMD curl -f http://localhost:8888/ready || exit 1" in dockerfile
    assert "CMD curl -f http://localhost:8888/health || exit 1" not in dockerfile


def test_production_container_packages_adaptive_routing_services():
    dockerfile = (Path(__file__).resolve().parents[2] / "Dockerfile").read_text(encoding="utf-8")

    assert "COPY cortex_server/services/ ./services/" in dockerfile


def test_compose_mounts_and_identifies_durable_memory_volume():
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(encoding="utf-8")

    assert "cortex-chroma:/app/cortex_server/chroma_db:rw" in compose
    assert "CORTEX_CHROMA_DIR: /app/cortex_server/chroma_db" in compose
    assert "CORTEX_CHROMA_MOUNT_ID:" in compose
    assert "CORTEX_MEMORY_SCOPE_SECRET:" in compose
    assert "cortex-memory-volume-init:" in compose


class HangingStream:
    async def read(self, size=-1):
        await asyncio.Event().wait()


class ChunkStream:
    def __init__(self, *chunks):
        self.chunks = list(chunks)

    async def read(self, size=-1):
        await asyncio.sleep(0)
        return self.chunks.pop(0) if self.chunks else b""


class CompletedProcess:
    def __init__(self, stdout=(), stderr=(), returncode=0):
        self.stdout = ChunkStream(*stdout)
        self.stderr = ChunkStream(*stderr)
        self.returncode = returncode

    async def wait(self):
        return self.returncode

    def terminate(self):
        self.returncode = -15

    def kill(self):
        self.returncode = -9


class TerminableProcess:
    def __init__(self):
        self.returncode = None
        self.stdout = HangingStream()
        self.stderr = HangingStream()
        self.exited = asyncio.Event()
        self.terminated = 0

    async def wait(self):
        await self.exited.wait()
        return self.returncode

    def terminate(self):
        self.terminated += 1
        self.returncode = -15
        self.exited.set()

    def kill(self):
        self.returncode = -9
        self.exited.set()


async def run_command(kind, timeout=None):
    if kind == "captured":
        return await docker_wrapper._run_cmd(["docker", "ps"], timeout=timeout)
    return [line async for line in docker_wrapper._stream_cmd(["docker", "pull"])]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["captured", "streaming"])
async def test_docker_timeout_bounds_stalled_spawn(monkeypatch, kind):
    spawn_started = asyncio.Event()
    spawn_cancelled = asyncio.Event()

    async def stalled_spawn(*args, **kwargs):
        spawn_started.set()
        try:
            await asyncio.Event().wait()
        finally:
            spawn_cancelled.set()

    monkeypatch.setattr(docker_wrapper, "_spawn_owned", stalled_spawn)
    monkeypatch.setattr(docker_wrapper, "DEFAULT_TIMEOUT", 0.01)

    with pytest.raises(docker_wrapper.DockerError, match="timed out"):
        await asyncio.wait_for(run_command(kind, timeout=0.01), 0.2)

    assert spawn_started.is_set()
    assert spawn_cancelled.is_set()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["captured", "streaming"])
async def test_docker_spawn_and_execution_share_one_deadline(monkeypatch, kind):
    now = 100.0
    proc = TerminableProcess()

    def monotonic():
        return now

    async def budget_consuming_spawn(*args, **kwargs):
        nonlocal now
        now = 102.0
        return proc

    monkeypatch.setattr(docker_wrapper, "time", SimpleNamespace(monotonic=monotonic))
    monkeypatch.setattr(docker_wrapper, "_spawn_owned", budget_consuming_spawn)
    monkeypatch.setattr(docker_wrapper, "DEFAULT_TIMEOUT", 1.0)

    with pytest.raises(docker_wrapper.DockerError, match="timed out"):
        await asyncio.wait_for(run_command(kind, timeout=1.0), 0.2)

    assert proc.terminated == 1


@pytest.mark.asyncio
async def test_docker_captured_stdout_at_limit_remains_complete(monkeypatch):
    proc = CompletedProcess(stdout=(b"1234", b"5678"))
    monkeypatch.setattr(docker_wrapper, "MAX_OUTPUT_BYTES", 8)
    monkeypatch.setattr(docker_wrapper, "_spawn_owned", lambda *a, **k: asyncio.sleep(0, result=proc))

    assert await docker_wrapper._run_cmd(["docker", "ps"]) == "12345678"


@pytest.mark.asyncio
async def test_docker_captured_stdout_overflow_fails_closed(monkeypatch):
    proc = CompletedProcess(stdout=(b'{"ID":"first"}\n', b'{"ID":"second"}\n'))
    monkeypatch.setattr(docker_wrapper, "MAX_OUTPUT_BYTES", 20)
    monkeypatch.setattr(docker_wrapper, "_spawn_owned", lambda *a, **k: asyncio.sleep(0, result=proc))

    with pytest.raises(docker_wrapper.DockerError, match="output limit exceeded"):
        await docker_wrapper._run_cmd(["docker", "ps", "--format", "{{json .}}"])


@pytest.mark.asyncio
async def test_docker_stderr_overflow_keeps_bounded_failure_diagnostic(monkeypatch):
    proc = CompletedProcess(stderr=(b"discarded", b"useful-tail"), returncode=1)
    monkeypatch.setattr(docker_wrapper, "MAX_OUTPUT_BYTES", 11)
    monkeypatch.setattr(docker_wrapper, "_spawn_owned", lambda *a, **k: asyncio.sleep(0, result=proc))

    with pytest.raises(docker_wrapper.DockerError, match="^useful-tail$"):
        await docker_wrapper._run_cmd(["docker", "ps"])
