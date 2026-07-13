import asyncio
from types import SimpleNamespace

import pytest

from cortex_server.tools import docker_wrapper


class HangingStream:
    async def read(self, size=-1):
        await asyncio.Event().wait()


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
