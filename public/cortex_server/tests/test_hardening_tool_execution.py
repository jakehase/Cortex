import asyncio
import json
import os
import subprocess
import threading

import pytest
from fastapi import HTTPException

from cortex_server.models.requests import FFMPEGConvertRequest
from cortex_server.routers import tools as tools_router
from cortex_server.services.tool_service import ToolService
from cortex_server.tools import docker_wrapper, ffmpeg_wrapper, git_wrapper


class Completed:
    def __init__(self, stdout="", stderr="", returncode=0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


class HangingProcess:
    """A child that ignores terminate and exits only after kill."""

    def __init__(self):
        self.returncode = None
        self.terminated = 0
        self.killed = 0
        self.waited = 0
        self.stdout = HangingStream()
        self.stderr = HangingStream()

    async def communicate(self):
        await asyncio.Event().wait()

    async def wait(self):
        self.waited += 1
        if self.killed:
            self.returncode = -9
            return self.returncode
        await asyncio.Event().wait()

    def terminate(self):
        self.terminated += 1

    def kill(self):
        self.killed += 1


class HangingStream:
    async def read(self, size=-1):
        await asyncio.Event().wait()


class CancellationResistantStream:
    """Model a pipe held open by a descendant after the direct child exits."""

    class Transport:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    def __init__(self, release, started):
        self.release = release
        self.started = started
        self._transport = self.Transport()

    async def read(self, size=-1):
        self.started.set()
        while not self.release.is_set():
            try:
                await self.release.wait()
            except asyncio.CancelledError:
                continue
        return b""


class AsyncChunks:
    def __init__(self, *chunks):
        self.chunks = list(chunks)

    async def read(self, size=-1):
        await asyncio.sleep(0)
        return self.chunks.pop(0) if self.chunks else b""


class RepeatedAsyncChunks:
    """Deterministic large stream that never materializes the whole payload."""

    def __init__(self, total, byte=b"x"):
        self.remaining = total
        self.byte = byte
        self.read_sizes = []
        self.largest_chunk = 0

    async def read(self, size=-1):
        await asyncio.sleep(0)
        self.read_sizes.append(size)
        if not self.remaining:
            return b""
        count = self.remaining if size < 0 else min(size, self.remaining)
        self.remaining -= count
        self.largest_chunk = max(self.largest_chunk, count)
        return self.byte * count


class AsyncDoneProcess:
    def __init__(self, stdout=(), stderr=(), returncode=0):
        self.stdout = AsyncChunks(*stdout)
        self.stderr = AsyncChunks(*stderr)
        self.returncode = returncode

    async def wait(self):
        return self.returncode

    def terminate(self):
        self.returncode = -15

    def kill(self):
        self.returncode = -9


class SyncChunks:
    def __init__(self, *chunks):
        self.chunks = list(chunks)

    def read(self, size=-1):
        return self.chunks.pop(0) if self.chunks else b""

    def close(self):
        pass


class SyncDoneProcess:
    def __init__(self, cmd, **kwargs):
        self.cmd = cmd
        self.kwargs = kwargs
        self.stdout = SyncChunks(b" updated", b" \n")
        self.stderr = SyncChunks()
        self.returncode = 0

    def wait(self, timeout=None):
        return self.returncode

    def terminate(self):
        pass

    def kill(self):
        pass


def repo(tmp_path):
    (tmp_path / ".git").mkdir()
    return git_wrapper.GitRepo(str(tmp_path))


@pytest.mark.parametrize("bad", ["--upload-pack=evil", "-b", "has space", "bad\x00ref"])
def test_git_rejects_option_like_and_malformed_refs_before_launch(monkeypatch, tmp_path, bad):
    called = False

    def no_process(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("must reject before spawning")

    monkeypatch.setattr(subprocess, "Popen", no_process)
    with pytest.raises(git_wrapper.GitError, match="Invalid Git"):
        repo(tmp_path).pull(remote=bad)
    assert called is False


def test_git_uses_option_terminators_and_preserves_success_contract(monkeypatch, tmp_path):
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return SyncDoneProcess(cmd, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", fake_run)
    result = repo(tmp_path).pull(remote="origin", branch="main", rebase=True)

    assert calls[0][0] == ["git", "pull", "--rebase", "--", "origin", "main"]
    assert calls[0][1]["stdout"] is subprocess.PIPE
    assert calls[0][1]["stderr"] is subprocess.PIPE
    assert result.model_dump() == {"success": True, "stdout": "updated", "stderr": "", "returncode": 0}


def test_sync_git_capture_keeps_only_bounded_tail(monkeypatch, tmp_path):
    monkeypatch.setattr(git_wrapper, "MAX_OUTPUT_CHARS", 8)
    def fake_popen(cmd, **kwargs):
        proc = SyncDoneProcess(cmd, **kwargs)
        proc.stdout = SyncChunks(b"pre", b"fix-", b"TAIL")
        proc.stderr = SyncChunks(b"sec", b"ret-", b"ERR")
        proc.returncode = 1
        return proc

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    result = repo(tmp_path)._run("status")

    assert result.stdout == "fix-TAIL"
    assert result.stderr == "cret-ERR"


def test_sync_git_clone_uses_bounded_incremental_capture(monkeypatch):
    monkeypatch.setattr(git_wrapper, "MAX_OUTPUT_CHARS", 6)

    def fake_popen(cmd, **kwargs):
        proc = SyncDoneProcess(cmd, **kwargs)
        proc.stdout = SyncChunks(b"discard", b"-TAIL")
        proc.stderr = SyncChunks(b"old", b"-ERROR")
        return proc

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    result = git_wrapper.GitRepo.clone("local-source", "destination")
    assert result.stdout == "d-TAIL"
    assert result.stderr == "-ERROR"


def test_sync_git_timeout_terminates_kills_and_reaps(monkeypatch, tmp_path):
    class SyncHangingProcess(SyncDoneProcess):
        def __init__(self, cmd, **kwargs):
            super().__init__(cmd, **kwargs)
            self.returncode = None
            self.waited = self.terminated = self.killed = 0

        def wait(self, timeout=None):
            self.waited += 1
            if self.killed:
                self.returncode = -9
                return self.returncode
            raise subprocess.TimeoutExpired(self.cmd, timeout)

        def terminate(self):
            self.terminated += 1

        def kill(self):
            self.killed += 1

    holder = {}

    def fake_popen(cmd, **kwargs):
        holder["proc"] = SyncHangingProcess(cmd, **kwargs)
        return holder["proc"]

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(git_wrapper, "DEFAULT_TIMEOUT", 0.001)
    monkeypatch.setattr(git_wrapper, "TERMINATE_GRACE", 0.001)
    with pytest.raises(git_wrapper.GitError, match="timed out"):
        repo(tmp_path)._run("status")
    proc = holder["proc"]
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)
    assert proc.waited == 3


def test_sync_git_timeout_returns_while_late_reaper_retains_ownership(monkeypatch, tmp_path):
    class TrackedStream(SyncChunks):
        def __init__(self):
            super().__init__()
            self.closed = False

        def close(self):
            self.closed = True

    class NeverReaps(SyncDoneProcess):
        def __init__(self, cmd, **kwargs):
            super().__init__(cmd, **kwargs)
            self.returncode = None
            self.stdout = TrackedStream()
            self.stderr = TrackedStream()
            self.wait_timeouts = []
            self.final_wait_started = threading.Event()
            self.final_wait_finished = threading.Event()
            self.release_final_wait = threading.Event()
            self.terminated = self.killed = 0

        def wait(self, timeout=None):
            self.wait_timeouts.append(timeout)
            if timeout is not None:
                raise subprocess.TimeoutExpired(self.cmd, timeout)
            self.final_wait_started.set()
            self.release_final_wait.wait()
            self.returncode = -9
            self.final_wait_finished.set()
            return self.returncode

        def terminate(self):
            self.terminated += 1

        def kill(self):
            self.killed += 1

    proc = NeverReaps(["git", "status"])
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: proc)
    monkeypatch.setattr(git_wrapper, "TERMINATE_GRACE", 0.01)

    result = []

    def run():
        try:
            git_wrapper._bounded_sync_command(["git", "status"], timeout=0.001)
        except BaseException as exc:
            result.append(exc)

    caller = threading.Thread(target=run)
    caller.start()

    try:
        assert proc.final_wait_started.wait(0.1)
        caller.join(0.1)
        assert not caller.is_alive()
        assert (proc.terminated, proc.killed) == (1, 1)
        assert proc.wait_timeouts == [pytest.approx(0.001, abs=0.01), 0.01, 0.01, None]
        assert proc.stdout.closed and proc.stderr.closed
    finally:
        proc.release_final_wait.set()
    assert proc.final_wait_finished.wait(0.1)
    assert proc.returncode == -9
    assert len(result) == 1
    assert isinstance(result[0], git_wrapper.GitError)
    assert "timed out" in str(result[0])


@pytest.mark.asyncio
async def test_git_timeout_escalates_and_reaps(monkeypatch, tmp_path):
    proc = HangingProcess()
    monkeypatch.setattr(git_wrapper, "DEFAULT_TIMEOUT", 0.001)
    monkeypatch.setattr(git_wrapper, "TERMINATE_GRACE", 0.001)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))

    with pytest.raises(git_wrapper.GitError, match="timed out"):
        await repo(tmp_path)._run_async("status")

    assert (proc.terminated, proc.killed) == (1, 1)
    assert proc.returncode == -9
    assert proc.waited >= 2


@pytest.mark.asyncio
async def test_git_cancellation_reaps_child_and_propagates(monkeypatch, tmp_path):
    proc = HangingProcess()
    spawned = asyncio.Event()

    async def create_process(*args, **kwargs):
        spawned.set()
        return proc

    monkeypatch.setattr(git_wrapper, "TERMINATE_GRACE", 0.001)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    task = asyncio.create_task(repo(tmp_path)._run_async("status"))
    await spawned.wait()
    await asyncio.sleep(0)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)


@pytest.mark.asyncio
async def test_git_drain_failure_cancels_siblings_reaps_child_and_propagates(monkeypatch):
    class FailingStream:
        async def read(self, size=-1):
            await asyncio.sleep(0)
            raise RuntimeError("pipe read failed")

    class TrackedHangingStream:
        def __init__(self):
            self.cancelled = asyncio.Event()

        async def read(self, size=-1):
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.cancelled.set()
                raise

    proc = HangingProcess()
    proc.stdout = FailingStream()
    proc.stderr = TrackedHangingStream()
    monkeypatch.setattr(git_wrapper, "TERMINATE_GRACE", 0.001)
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc)
    )

    with pytest.raises(RuntimeError, match="pipe read failed"):
        await git_wrapper.run_git_async(["git", "status"])

    assert proc.stderr.cancelled.is_set()
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)


@pytest.mark.asyncio
async def test_git_wait_failure_reaps_child_and_propagates(monkeypatch):
    class FirstWaitFails(HangingProcess):
        async def wait(self):
            self.waited += 1
            if self.waited == 1:
                raise RuntimeError("wait failed")
            if self.killed:
                self.returncode = -9
                return self.returncode
            await asyncio.Event().wait()

    proc = FirstWaitFails()
    monkeypatch.setattr(git_wrapper, "TERMINATE_GRACE", 0.001)
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc)
    )

    with pytest.raises(RuntimeError, match="wait failed"):
        await git_wrapper.run_git_async(["git", "status"])

    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)


@pytest.mark.asyncio
async def test_git_cancellation_does_not_wait_forever_for_spawn(monkeypatch, tmp_path, recwarn):
    proc = HangingProcess()
    started = asyncio.Event()
    release = asyncio.Event()

    async def create_process(*args, **kwargs):
        started.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            await release.wait()
        return proc

    monkeypatch.setattr(git_wrapper, "TERMINATE_GRACE", 0.01)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    task = asyncio.create_task(repo(tmp_path)._run_async("status"))
    await started.wait()
    then = asyncio.get_running_loop().time()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 0.1)
    assert asyncio.get_running_loop().time() - then < 0.1

    release.set()
    await asyncio.sleep(0.03)
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)
    assert not [w for w in recwarn if issubclass(w.category, RuntimeWarning)]


@pytest.mark.asyncio
async def test_docker_identifiers_fail_closed_without_launch(monkeypatch):
    called = False

    async def no_process(*args, **kwargs):
        nonlocal called
        called = True

    monkeypatch.setattr(docker_wrapper, "_run_cmd", no_process)
    with pytest.raises(docker_wrapper.DockerError, match="Invalid Docker"):
        await docker_wrapper.ContainerManager().start("--help")
    assert called is False


def test_docker_mount_policy_allows_configured_root_and_defaults_read_only(monkeypatch, tmp_path):
    root = tmp_path / "allowed"
    host = root / "project"
    host.mkdir(parents=True)
    monkeypatch.setenv("CORTEX_DOCKER_MOUNT_ROOTS", str(root))

    assert docker_wrapper._mount(str(host), "/workspace") == f"{host.resolve()}:/workspace:ro"
    assert docker_wrapper._mount(str(host), "/workspace:ro") == f"{host.resolve()}:/workspace:ro"
    assert docker_wrapper._mount(str(host), "/workspace:rw") == f"{host.resolve()}:/workspace:rw"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "container_path",
    [
        "",
        "workspace",
        "/workspace:",
        "/workspace:RO",
        "/workspace:Rw",
        "/workspace:z",
        "/workspace:ro,rshared",
        "/workspace:ro:rw",
        "/workspace::ro",
        "/work:space",
    ],
)
async def test_docker_rejects_invalid_bind_mode_before_launch(monkeypatch, tmp_path, container_path):
    host = tmp_path / "project"
    host.mkdir()
    monkeypatch.setenv("CORTEX_DOCKER_MOUNT_ROOTS", str(tmp_path))
    monkeypatch.setattr(docker_wrapper, "_run_cmd", lambda *a, **k: pytest.fail("spawned Docker"))

    config = docker_wrapper.ContainerConfig(image="alpine", volumes={str(host): container_path})
    with pytest.raises(docker_wrapper.DockerError, match="bind mount"):
        await docker_wrapper.ContainerManager().run(config)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("container_path", "expected"),
    [
        ("/workspace", "/workspace:ro"),
        ("/workspace:ro", "/workspace:ro"),
        ("/workspace:rw", "/workspace:rw"),
    ],
)
async def test_docker_run_accepts_supported_bind_modes(monkeypatch, tmp_path, container_path, expected):
    host = tmp_path / "project"
    host.mkdir()
    calls = []

    async def fake_run(args, **kwargs):
        calls.append(args)
        return "abc123\n"

    manager = docker_wrapper.ContainerManager()
    monkeypatch.setenv("CORTEX_DOCKER_MOUNT_ROOTS", str(tmp_path))
    monkeypatch.setattr(docker_wrapper, "_run_cmd", fake_run)
    monkeypatch.setattr(manager, "inspect", lambda cid: asyncio.sleep(0, result=docker_wrapper.Container(id=cid, name="n", image="alpine", status="running")))

    await manager.run(docker_wrapper.ContainerConfig(image="alpine", volumes={str(host): container_path}))

    assert calls == [["docker", "run", "-d", "-v", f"{host.resolve()}:{expected}", "--", "alpine"]]


@pytest.mark.asyncio
@pytest.mark.parametrize("host_path", ["", "C:\\project", "C:/project"])
async def test_docker_rejects_blank_or_windows_ambiguous_host_before_launch(monkeypatch, host_path):
    monkeypatch.setattr(docker_wrapper, "_run_cmd", lambda *a, **k: pytest.fail("spawned Docker"))
    config = docker_wrapper.ContainerConfig(image="alpine", volumes={host_path: "/workspace"})

    with pytest.raises(docker_wrapper.DockerError, match="bind mount"):
        await docker_wrapper.ContainerManager().run(config)


@pytest.mark.parametrize("configured_roots", [None, "", os.pathsep])
def test_docker_mount_policy_rejects_unset_or_empty_roots(monkeypatch, tmp_path, configured_roots):
    host = tmp_path / "project"
    host.mkdir()
    if configured_roots is None:
        monkeypatch.delenv("CORTEX_DOCKER_MOUNT_ROOTS", raising=False)
        monkeypatch.chdir(tmp_path)
    else:
        monkeypatch.setenv("CORTEX_DOCKER_MOUNT_ROOTS", configured_roots)

    with pytest.raises(docker_wrapper.DockerError, match="outside configured roots"):
        docker_wrapper._mount(str(host), "/workspace")


@pytest.mark.parametrize("configured_roots", ["/", "relative", "/does/not/exist"])
def test_docker_mount_policy_rejects_broad_or_invalid_roots(monkeypatch, tmp_path, configured_roots):
    host = tmp_path / "project"
    host.mkdir()
    monkeypatch.setenv("CORTEX_DOCKER_MOUNT_ROOTS", configured_roots)

    with pytest.raises(docker_wrapper.DockerError, match="outside configured roots"):
        docker_wrapper._mount(str(host), "/workspace")


@pytest.mark.asyncio
async def test_docker_run_without_bind_mounts_works_without_configured_roots(monkeypatch):
    calls = []

    async def fake_run(args, **kwargs):
        calls.append(args)
        return "abc123\n"

    manager = docker_wrapper.ContainerManager()
    monkeypatch.delenv("CORTEX_DOCKER_MOUNT_ROOTS", raising=False)
    monkeypatch.setattr(docker_wrapper, "_run_cmd", fake_run)
    monkeypatch.setattr(manager, "inspect", lambda cid: asyncio.sleep(0, result=docker_wrapper.Container(id=cid, name="n", image="alpine", status="running")))

    await manager.run(docker_wrapper.ContainerConfig(image="alpine:3"))

    assert calls == [["docker", "run", "-d", "--", "alpine:3"]]


@pytest.mark.parametrize("target", ["outside", "symlink"])
def test_docker_mount_policy_rejects_traversal_and_symlink_escape(monkeypatch, tmp_path, target):
    root = tmp_path / "allowed"
    root.mkdir()
    outside = tmp_path / "private"
    outside.mkdir()
    candidate = root / ".." / "private"
    if target == "symlink":
        candidate = root / "escape"
        candidate.symlink_to(outside, target_is_directory=True)
    monkeypatch.setenv("CORTEX_DOCKER_MOUNT_ROOTS", str(root))

    with pytest.raises(docker_wrapper.DockerError, match="outside configured roots"):
        docker_wrapper._mount(str(candidate), "/data")


def test_docker_sensitive_paths_include_container_engine_storage():
    assert "/var/lib/docker" in docker_wrapper._SENSITIVE_PATHS
    assert "/var/lib/containers" in docker_wrapper._SENSITIVE_PATHS


@pytest.mark.parametrize("engine_name", ["docker", "containers"])
@pytest.mark.parametrize("candidate_kind", ["root", "descendant", "symlink"])
def test_docker_rejects_engine_storage_even_if_parent_is_configured(
    monkeypatch, tmp_path, engine_name, candidate_kind
):
    allowed = tmp_path / "var"
    engine = allowed / "lib" / engine_name
    descendant = engine / "volumes" / "project"
    descendant.mkdir(parents=True)
    candidate = engine if candidate_kind == "root" else descendant
    if candidate_kind == "symlink":
        candidate = allowed / f"{engine_name}-alias"
        candidate.symlink_to(descendant, target_is_directory=True)
    monkeypatch.setattr(docker_wrapper, "_SENSITIVE_PATHS", (str(engine),))
    monkeypatch.setenv("CORTEX_DOCKER_MOUNT_ROOTS", str(allowed))

    with pytest.raises(docker_wrapper.DockerError, match="outside configured roots"):
        docker_wrapper._mount(str(candidate), "/engine:rw")


def test_docker_rejects_ancestor_of_sensitive_path(monkeypatch, tmp_path):
    allowed = tmp_path / "allowed"
    sensitive = allowed / "nested" / "credentials"
    sensitive.mkdir(parents=True)
    monkeypatch.setattr(docker_wrapper, "_SENSITIVE_PATHS", (str(sensitive),))
    monkeypatch.setenv("CORTEX_DOCKER_MOUNT_ROOTS", str(allowed))

    with pytest.raises(docker_wrapper.DockerError, match="outside configured roots"):
        docker_wrapper._mount(str(allowed), "/data")


def test_docker_rejects_ancestor_of_runtime_socket(monkeypatch, tmp_path):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    socket_path = allowed / "runtime" / "engine.sock"
    monkeypatch.setattr(docker_wrapper, "_RUNTIME_SOCKET_PATHS", (str(socket_path),))
    monkeypatch.setenv("CORTEX_DOCKER_MOUNT_ROOTS", str(allowed))

    with pytest.raises(docker_wrapper.DockerError, match="runtime sockets"):
        docker_wrapper._mount(str(allowed), "/data")


def test_docker_rejects_runtime_socket_and_symlink_alias_before_root_policy(monkeypatch, tmp_path):
    endpoint = tmp_path / "docker.sock"
    alias = tmp_path / "socket-alias"
    endpoint.touch()
    alias.symlink_to(endpoint)
    monkeypatch.setattr(docker_wrapper.stat, "S_ISSOCK", lambda mode: True)
    monkeypatch.setenv("CORTEX_DOCKER_MOUNT_ROOTS", str(tmp_path))
    for candidate in (endpoint, alias):
        with pytest.raises(docker_wrapper.DockerError, match="runtime sockets"):
            docker_wrapper._mount(str(candidate), "/run/docker.sock")


@pytest.mark.asyncio
async def test_docker_run_normalizes_environment_and_places_image_after_terminator(monkeypatch):
    calls = []

    async def fake_run(args, **kwargs):
        calls.append(args)
        return "abc123\n"

    manager = docker_wrapper.ContainerManager()
    monkeypatch.setattr(docker_wrapper, "_run_cmd", fake_run)
    monkeypatch.setattr(manager, "inspect", lambda cid: asyncio.sleep(0, result=docker_wrapper.Container(id=cid, name="n", image="alpine", status="running")))

    container = await manager.run(docker_wrapper.ContainerConfig(image="alpine:3", env={"Z": "2", "A": "1"}, command=["echo", "ok"]))

    assert calls[0] == ["docker", "run", "-d", "-e", "A=1", "-e", "Z=2", "--", "alpine:3", "echo", "ok"]
    assert container.id == "abc123"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "inspect_failure",
    [
        docker_wrapper.DockerError("Docker command timed out"),
        json.JSONDecodeError("invalid inspect output", "", 0),
    ],
)
async def test_detached_docker_run_returns_created_container_when_inspect_fails(
    monkeypatch, inspect_failure
):
    container_id = "a" * 64

    async def fake_run(args, **kwargs):
        return f"{container_id}\n"

    async def failed_inspect(candidate):
        assert candidate == container_id
        raise inspect_failure

    manager = docker_wrapper.ContainerManager()
    monkeypatch.setattr(docker_wrapper, "_run_cmd", fake_run)
    monkeypatch.setattr(manager, "inspect", failed_inspect)

    container = await manager.run(
        docker_wrapper.ContainerConfig(image="alpine:3", name="worker")
    )

    assert container == docker_wrapper.Container(
        id=container_id[:12], name="worker", image="alpine:3", status=""
    )


@pytest.mark.asyncio
async def test_concurrent_detached_runs_keep_their_ids_when_inspection_fails(monkeypatch):
    ids = iter(("a" * 64, "b" * 64))

    async def fake_run(args, **kwargs):
        container_id = next(ids)
        await asyncio.sleep(0)
        return container_id

    async def failed_inspect(candidate):
        await asyncio.sleep(0)
        raise docker_wrapper.DockerError(f"inspect failed for {candidate}")

    manager = docker_wrapper.ContainerManager()
    monkeypatch.setattr(docker_wrapper, "_run_cmd", fake_run)
    monkeypatch.setattr(manager, "inspect", failed_inspect)

    first, second = await asyncio.gather(
        manager.run(docker_wrapper.ContainerConfig(image="alpine:3")),
        manager.run(docker_wrapper.ContainerConfig(image="alpine:3")),
    )

    assert {first.id, second.id} == {"a" * 12, "b" * 12}


@pytest.mark.asyncio
async def test_docker_run_rejects_invalid_container_id_before_inspection(monkeypatch):
    async def fake_run(args, **kwargs):
        return "safe-id\nforged-id"

    manager = docker_wrapper.ContainerManager()
    monkeypatch.setattr(docker_wrapper, "_run_cmd", fake_run)
    monkeypatch.setattr(manager, "inspect", lambda cid: pytest.fail("inspected invalid ID"))

    with pytest.raises(docker_wrapper.DockerError, match="Invalid Docker container ID"):
        await manager.run(docker_wrapper.ContainerConfig(image="alpine:3"))


@pytest.mark.asyncio
async def test_docker_rejects_bad_environment_name_before_launch(monkeypatch):
    monkeypatch.setattr(docker_wrapper, "_run_cmd", lambda *a, **k: pytest.fail("spawned Docker"))
    with pytest.raises(docker_wrapper.DockerError, match="environment"):
        await docker_wrapper.ContainerManager().run(docker_wrapper.ContainerConfig(image="alpine", env={"BAD-NAME": "x"}))


@pytest.mark.asyncio
async def test_docker_output_is_bounded_and_inspect_environment_is_normalized(monkeypatch):
    real_run_cmd = docker_wrapper._run_cmd
    monkeypatch.setattr(docker_wrapper, "MAX_OUTPUT_BYTES", 9)
    payload = [{"Id": "1234567890abcdef", "Name": "/demo", "Config": {"Image": "img", "Env": ["A=1", "TOKEN=a=b", "malformed"]}, "State": {"Status": "running"}}]

    async def fake_run(args, **kwargs):
        assert args[-2:] == ["--", "safe-id"]
        return json.dumps(payload)

    monkeypatch.setattr(docker_wrapper, "_run_cmd", fake_run)
    container = await docker_wrapper.ContainerManager().inspect("safe-id")
    assert container.id == "1234567890ab"
    assert container.env == {"A": "1", "TOKEN": "a=b"}

    done = AsyncDoneProcess(stdout=(b"0123", b"4567", b"89TAIL"))
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=done))
    assert await real_run_cmd(["docker", "ps"]) == "56789TAIL"


@pytest.mark.asyncio
async def test_docker_timeout_terminates_kills_and_reaps(monkeypatch):
    proc = HangingProcess()
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))
    with pytest.raises(docker_wrapper.DockerError, match="timed out"):
        await docker_wrapper._run_cmd(["docker", "ps"], timeout=0.001)
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["drain", "wait"])
async def test_docker_task_failure_reaps_child_and_is_sanitized(monkeypatch, failure):
    monkeypatch.setattr(docker_wrapper, "CLEANUP_GRACE", 0.01)

    class BrokenStream:
        async def read(self, size=-1):
            raise RuntimeError("transport details must not escape")

    class FailingProcess(HangingProcess):
        async def wait(self):
            self.waited += 1
            if failure == "wait" and self.waited == 1:
                raise RuntimeError("watcher details must not escape")
            if self.killed:
                self.returncode = -9
                return self.returncode
            await asyncio.Event().wait()

    proc = FailingProcess()
    if failure == "drain":
        proc.stderr = BrokenStream()
    else:
        proc.stdout = AsyncChunks()
        proc.stderr = AsyncChunks()
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc)
    )

    with pytest.raises(docker_wrapper.DockerError, match="^Docker command failed$") as exc:
        await asyncio.wait_for(docker_wrapper._run_cmd(["docker", "ps"]), 0.1)

    assert exc.value.__cause__ is None
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)


@pytest.mark.asyncio
@pytest.mark.parametrize("cancel", [False, True])
async def test_docker_cleanup_bounds_descendant_held_pipe_drains(monkeypatch, cancel):
    proc = HangingProcess()
    release = asyncio.Event()
    stdout_started = asyncio.Event()
    stderr_started = asyncio.Event()
    proc.stdout = CancellationResistantStream(release, stdout_started)
    proc.stderr = CancellationResistantStream(release, stderr_started)
    monkeypatch.setattr(docker_wrapper, "CLEANUP_GRACE", 0.01)
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc)
    )

    timeout = None if cancel else 0.001
    task = asyncio.create_task(docker_wrapper._run_cmd(["docker", "ps"], timeout=timeout))
    await asyncio.gather(stdout_started.wait(), stderr_started.wait())
    then = asyncio.get_running_loop().time()
    if cancel:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 0.1)
    else:
        with pytest.raises(docker_wrapper.DockerError, match="timed out"):
            await asyncio.wait_for(task, 0.1)

    assert asyncio.get_running_loop().time() - then < 0.1
    assert proc.stdout._transport.closed
    assert proc.stderr._transport.closed
    release.set()
    await asyncio.sleep(0)
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_docker_cancellation_during_pending_spawn_owns_and_reaps_child(monkeypatch):
    proc = HangingProcess()
    spawn_started = asyncio.Event()
    release_spawn = asyncio.Event()

    async def create_process(*args, **kwargs):
        spawn_started.set()
        await release_spawn.wait()
        return proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    task = asyncio.create_task(docker_wrapper._run_cmd(["docker", "ps"]))
    await spawn_started.wait()
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    release_spawn.set()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)
    assert proc.waited >= 2


@pytest.mark.asyncio
async def test_docker_cancellation_does_not_wait_forever_for_spawn(monkeypatch, recwarn):
    proc = HangingProcess()
    started = asyncio.Event()
    release = asyncio.Event()

    async def create_process(*args, **kwargs):
        started.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            await release.wait()
        return proc

    monkeypatch.setattr(docker_wrapper, "CLEANUP_GRACE", 0.01)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    task = asyncio.create_task(docker_wrapper._run_cmd(["docker", "ps"]))
    await started.wait()
    then = asyncio.get_running_loop().time()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 0.1)
    assert asyncio.get_running_loop().time() - then < 0.1

    release.set()
    await asyncio.sleep(0.03)
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)
    assert not [w for w in recwarn if issubclass(w.category, RuntimeWarning)]


@pytest.mark.asyncio
@pytest.mark.parametrize("wrapper", [git_wrapper, docker_wrapper])
async def test_async_cleanup_bounds_nonreturning_post_kill_wait(monkeypatch, wrapper, recwarn):
    class Transport:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    class Stream:
        def __init__(self):
            self._transport = Transport()

    class NeverReaps(HangingProcess):
        def __init__(self):
            super().__init__()
            self.stdout = Stream()
            self.stderr = Stream()
            self._transport = Transport()
            self.release = asyncio.Event()

        async def wait(self):
            self.waited += 1
            await self.release.wait()
            self.returncode = -9
            return self.returncode

    proc = NeverReaps()
    grace_name = "TERMINATE_GRACE" if wrapper is git_wrapper else "CLEANUP_GRACE"
    monkeypatch.setattr(wrapper, grace_name, 0.01)
    then = asyncio.get_running_loop().time()
    await asyncio.wait_for(wrapper._stop_process(proc), 0.1)
    assert asyncio.get_running_loop().time() - then < 0.1
    assert (proc.terminated, proc.killed) == (1, 1)
    assert proc._transport.closed
    assert proc.stdout._transport.closed
    assert proc.stderr._transport.closed

    proc.release.set()
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert not [w for w in recwarn if issubclass(w.category, RuntimeWarning)]


@pytest.mark.asyncio
async def test_docker_stream_frames_chunks_and_bounds_total_output(monkeypatch):
    proc = AsyncDoneProcess(stdout=(b"first\nsec", b"ond\nlast"))
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))
    assert [line async for line in docker_wrapper._stream_cmd(["docker", "pull"])] == ["first", "second", "last"]

    proc = AsyncDoneProcess(stdout=(b"1234", b"5"))
    proc.returncode = None
    monkeypatch.setattr(docker_wrapper, "MAX_OUTPUT_BYTES", 4)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))
    with pytest.raises(docker_wrapper.DockerError, match="output limit"):
        _ = [line async for line in docker_wrapper._stream_cmd(["docker", "pull"])]
    assert proc.returncode == -15


@pytest.mark.asyncio
async def test_docker_stream_timeout_and_generator_close_reap_child(monkeypatch):
    proc = HangingProcess()
    monkeypatch.setattr(docker_wrapper, "DEFAULT_TIMEOUT", 0.001)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))
    with pytest.raises(docker_wrapper.DockerError, match="timed out"):
        _ = [line async for line in docker_wrapper._stream_cmd(["docker", "pull"])]
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)

    proc = HangingProcess()
    proc.stdout = AsyncChunks(b"one\n", b"two\n")
    monkeypatch.setattr(docker_wrapper, "DEFAULT_TIMEOUT", 60)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))
    stream = docker_wrapper._stream_cmd(["docker", "pull"])
    assert await anext(stream) == "one"
    await stream.aclose()
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)


@pytest.mark.asyncio
async def test_docker_stream_cancellation_reaps_child_and_propagates(monkeypatch):
    proc = HangingProcess()
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))
    stream = docker_wrapper._stream_cmd(["docker", "logs"])
    task = asyncio.create_task(anext(stream))
    await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)


@pytest.mark.asyncio
async def test_ffprobe_incrementally_bounds_both_streams(monkeypatch):
    wrapper = ffmpeg_wrapper.FFmpegWrapper()
    document = b'{"format":{"duration":"1"}}'
    monkeypatch.setattr(ffmpeg_wrapper, "MAX_OUTPUT_CHARS", len(document))
    proc = AsyncDoneProcess(stdout=(b"discard-me", document[:12], document[12:]),
                            stderr=(b"discard", b"ed-error"))
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))
    assert await wrapper.get_info("input") == {"format": {"duration": "1"}}


@pytest.mark.asyncio
async def test_ffprobe_timeout_terminates_kills_and_reaps(monkeypatch):
    proc = HangingProcess()
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))
    with pytest.raises(ffmpeg_wrapper.FFmpegError, match="timed out"):
        await ffmpeg_wrapper.FFmpegWrapper().get_info("input", timeout=0.001)
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)
    assert proc.waited >= 2


@pytest.mark.asyncio
async def test_ffmpeg_high_stdout_is_drained_without_deadlock(monkeypatch):
    stdout = RepeatedAsyncChunks(2 * 1024 * 1024)
    proc = AsyncDoneProcess(stderr=())
    proc.stdout = stdout
    calls = []

    async def create_process(*args, **kwargs):
        calls.append((args, kwargs))
        return proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    result = await ffmpeg_wrapper.FFmpegWrapper().run(["ffmpeg", "input"], timeout=5)

    assert result == ""
    assert stdout.remaining == 0
    assert stdout.largest_chunk == ffmpeg_wrapper.READ_CHUNK_BYTES
    assert set(stdout.read_sizes) == {ffmpeg_wrapper.READ_CHUNK_BYTES}
    assert calls == [
        (("ffmpeg", "input"), {"stdout": asyncio.subprocess.PIPE, "stderr": asyncio.subprocess.PIPE})
    ]


@pytest.mark.asyncio
async def test_ffmpeg_exited_child_with_inherited_open_pipe_has_bounded_failure(monkeypatch, recwarn):
    """A descendant retaining an fd must not make the final drain unbounded."""
    proc = AsyncDoneProcess(stderr=())
    proc.stdout = HangingStream()
    created = []
    real_create_task = asyncio.create_task

    def tracked_create_task(coro):
        task = real_create_task(coro)
        created.append(task)
        return task

    monkeypatch.setattr(ffmpeg_wrapper.asyncio, "create_task", tracked_create_task)
    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        lambda *a, **k: asyncio.sleep(0, result=proc),
    )

    loop = asyncio.get_running_loop()
    started = loop.time()
    with pytest.raises(ffmpeg_wrapper.FFmpegError) as raised:
        await ffmpeg_wrapper.FFmpegWrapper().run(
            ["ffmpeg", "input"], timeout=0.02
        )
    elapsed = loop.time() - started

    assert str(raised.value) == "ffmpeg timed out after 0.02s"
    assert elapsed < 0.2
    assert created and all(task.done() for task in created)
    assert not [warning for warning in recwarn if issubclass(warning.category, RuntimeWarning)]


@pytest.mark.asyncio
async def test_ffmpeg_deadline_cleanup_awaits_delayed_reap_and_leaves_no_wait_task(monkeypatch):
    """Reaping may require multiple loop turns after kill."""
    class DelayedReapProcess(HangingProcess):
        def __init__(self):
            super().__init__()
            self.reaped = False

        async def wait(self):
            self.waited += 1
            if not self.killed:
                await asyncio.Event().wait()
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            self.returncode = -9
            self.reaped = True
            return self.returncode

    proc = DelayedReapProcess()
    monkeypatch.setattr(ffmpeg_wrapper, "CLEANUP_REAP_GRACE", 0.1)
    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        lambda *a, **k: asyncio.sleep(0, result=proc),
    )

    with pytest.raises(ffmpeg_wrapper.FFmpegError, match="timed out"):
        await ffmpeg_wrapper.FFmpegWrapper().run(["ffmpeg", "input"], timeout=0.001)

    assert proc.reaped is True
    assert proc.waited >= 2
    await asyncio.sleep(0)
    current = asyncio.current_task()
    assert not [task for task in asyncio.all_tasks() if task is not current and not task.done()]


@pytest.mark.asyncio
async def test_ffmpeg_newline_free_stderr_is_chunked_and_bounded(monkeypatch):
    monkeypatch.setattr(ffmpeg_wrapper, "MAX_OUTPUT_CHARS", 4096)
    stderr = RepeatedAsyncChunks(3 * 1024 * 1024)
    proc = AsyncDoneProcess()
    proc.stderr = stderr
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))

    result = await ffmpeg_wrapper.FFmpegWrapper().run(["ffmpeg", "input"], timeout=5)

    assert result == "x" * 4096
    assert stderr.remaining == 0
    assert stderr.largest_chunk == ffmpeg_wrapper.READ_CHUNK_BYTES
    assert set(stderr.read_sizes) == {ffmpeg_wrapper.READ_CHUNK_BYTES}


@pytest.mark.asyncio
async def test_ffmpeg_chunked_stderr_preserves_progress_parsing(monkeypatch):
    monkeypatch.setattr(ffmpeg_wrapper, "MAX_OUTPUT_CHARS", 4096)
    proc = AsyncDoneProcess(
        stderr=(
            b"x" * ffmpeg_wrapper.READ_CHUNK_BYTES,
            b"x" * (ffmpeg_wrapper.READ_CHUNK_BYTES - len(b"\rtime=00:00:")) + b"\rtime=00:00:",
            b"12.50 speed=1.25x\r",
        )
    )
    monkeypatch.setattr(asyncio, "create_subprocess_exec", lambda *a, **k: asyncio.sleep(0, result=proc))
    progress = []

    result = await ffmpeg_wrapper.FFmpegWrapper().run(
        ["ffmpeg", "input"],
        timeout=5,
        total_time=20,
        on_progress=lambda current, total, speed: progress.append((current, total, speed)),
    )

    assert len(result.encode()) <= 4096
    assert progress == [(12.5, 20, 1.25)]


@pytest.mark.asyncio
async def test_ffmpeg_progress_callback_failure_reaps_child_and_settles_drains(monkeypatch):
    class ExitedWaitProcess(HangingProcess):
        def __init__(self):
            super().__init__()
            self.initial_wait_complete = False

        async def wait(self):
            self.waited += 1
            if self.killed:
                self.returncode = -9
                return self.returncode
            if not self.initial_wait_complete:
                self.initial_wait_complete = True
                return None
            await asyncio.Event().wait()

    proc = ExitedWaitProcess()
    proc.stderr = AsyncChunks(b"time=00:00:01.00 speed=1.0x\r")
    created = []
    real_create_task = asyncio.create_task

    def tracked_create_task(coro):
        task = real_create_task(coro)
        created.append(task)
        return task

    def fail_progress(*args):
        raise RuntimeError("progress callback failed")

    monkeypatch.setattr(ffmpeg_wrapper.asyncio, "create_task", tracked_create_task)
    monkeypatch.setattr(
        asyncio,
        "create_subprocess_exec",
        lambda *a, **k: asyncio.sleep(0, result=proc),
    )

    with pytest.raises(RuntimeError, match="progress callback failed"):
        await ffmpeg_wrapper.FFmpegWrapper().run(
            ["ffmpeg", "input"], on_progress=fail_progress
        )

    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)
    assert proc.waited >= 3
    assert created and all(task.done() for task in created)


@pytest.mark.asyncio
async def test_ffmpeg_cancellation_terminates_kills_reaps_and_propagates(monkeypatch):
    proc = HangingProcess()
    spawned = asyncio.Event()

    async def create_process(*args, **kwargs):
        spawned.set()
        return proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    task = asyncio.create_task(ffmpeg_wrapper.FFmpegWrapper().run(["ffmpeg", "input"]))
    await spawned.wait()
    await asyncio.sleep(0)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)
    assert proc.waited >= 2


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["run", "get_info"])
async def test_ffmpeg_pending_spawn_cancellation_returns_before_late_child_cleanup(monkeypatch, operation):
    proc = HangingProcess()
    spawn_started = asyncio.Event()
    release_spawn = asyncio.Event()

    async def create_process(*args, **kwargs):
        spawn_started.set()
        try:
            await release_spawn.wait()
        except asyncio.CancelledError:
            # Model a subprocess factory that created a child while cancellation
            # raced with its final bookkeeping and returns that child later.
            await release_spawn.wait()
        return proc

    monkeypatch.setattr(ffmpeg_wrapper, "SPAWN_CANCEL_GRACE", 0.001)
    monkeypatch.setattr(ffmpeg_wrapper, "CLEANUP_REAP_GRACE", 0.001)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    wrapper = ffmpeg_wrapper.FFmpegWrapper()
    coroutine = wrapper.run(["ffmpeg", "input"]) if operation == "run" else wrapper.get_info("input")
    task = asyncio.create_task(coroutine)
    await spawn_started.wait()
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 0.1)

    release_spawn.set()
    for _ in range(100):
        if proc.returncode is not None:
            break
        await asyncio.sleep(0.001)
    assert (proc.terminated, proc.killed, proc.returncode) == (1, 1, -9)
    assert proc.waited >= 2


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["run", "get_info"])
async def test_ffmpeg_timeout_during_never_resolving_spawn_returns_promptly(monkeypatch, operation):
    spawn_started = asyncio.Event()

    async def create_process(*args, **kwargs):
        spawn_started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(ffmpeg_wrapper, "SPAWN_CANCEL_GRACE", 0.001)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_process)
    wrapper = ffmpeg_wrapper.FFmpegWrapper()
    coroutine = (
        wrapper.run(["ffmpeg", "input"], timeout=0.001)
        if operation == "run"
        else wrapper.get_info("input", timeout=0.001)
    )

    with pytest.raises(ffmpeg_wrapper.FFmpegError, match="timed out"):
        await asyncio.wait_for(coroutine, 0.1)
    assert spawn_started.is_set()


def test_ffmpeg_output_options_precede_output_path():
    wrapper = ffmpeg_wrapper.FFmpegWrapper()
    job = ffmpeg_wrapper.FFmpegJob(
        input=ffmpeg_wrapper.FFmpegInput(path="in.mp4"),
        output=ffmpeg_wrapper.FFmpegOutput(path="out.webm", format="webm", codec="vp9", quality=22, codec_options={"threads": "2"}),
    )
    args = wrapper.build_convert_args(job)
    output_index = args.index("out.webm")
    assert output_index == len(args) - 1
    assert args.index("-c:v") < output_index
    assert args.index("-crf") < output_index
    assert args.index("-f") < output_index
    assert args.index("-threads") < output_index


@pytest.mark.asyncio
async def test_ffmpeg_extract_audio_keeps_added_options_before_output(monkeypatch):
    wrapper = ffmpeg_wrapper.FFmpegWrapper()
    monkeypatch.setattr(wrapper, "get_info", lambda *a, **k: asyncio.sleep(0, result={}))
    captured = {}

    async def fake_run(args, **kwargs):
        captured["args"] = args
        return "ok"

    monkeypatch.setattr(wrapper, "run", fake_run)
    assert await wrapper.extract_audio("in.mov", "out.mp3") == "ok"
    assert captured["args"][-1] == "out.mp3"
    assert captured["args"].index("-b:a") < len(captured["args"]) - 1


@pytest.mark.asyncio
async def test_service_redacts_internal_tool_failure(monkeypatch):
    service = ToolService()

    async def explode(**kwargs):
        raise RuntimeError("password=hunter2 at /home/private/input.mov")

    monkeypatch.setattr(service.ffmpeg, "convert", explode)
    result = await service.ffmpeg_convert(FFMPEGConvertRequest(input_path="in", output_path="out"))
    assert result == {"success": False, "error": "Tool operation failed"}
    assert "hunter2" not in repr(result)


def test_api_translates_failure_to_redacted_non_200_without_retry_encouragement():
    with pytest.raises(HTTPException) as raised:
        tools_router._tool_response({"success": False, "error": "host /secret/path token=abc"})

    assert raised.value.status_code == 500
    assert raised.value.detail == "Tool operation failed"
    detail = raised.value.detail.lower()
    assert "secret" not in detail and "token" not in detail and "retry" not in detail


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("endpoint", "service_method", "args"),
    [
        (tools_router.git_status, "git_status", ("repo",)),
        (tools_router.git_log, "git_log", ("repo", 10)),
        (tools_router.git_init, "git_init", ("repo",)),
        (tools_router.git_add, "git_add", ("repo", ".")),
        (tools_router.git_commit, "git_commit", ("repo", "message")),
        (tools_router.docker_list, "docker_list", (False,)),
        (tools_router.docker_stop, "docker_stop", ("container",)),
        (tools_router.docker_pull, "docker_pull", ("image", "latest")),
    ],
)
async def test_plain_tool_endpoints_translate_failed_results_to_sanitized_non_200(
    monkeypatch, endpoint, service_method, args
):
    async def fail(*args, **kwargs):
        return {"success": False, "error": "/secret token=abc"}

    monkeypatch.setattr(tools_router, "extract_trace_context", lambda *a, **k: {})
    monkeypatch.setattr(tools_router.service, service_method, fail)
    with pytest.raises(HTTPException) as raised:
        await endpoint(*args, http_request=object())
    assert raised.value.status_code == 500
    assert raised.value.detail == "Tool operation failed"


@pytest.mark.asyncio
async def test_ffprobe_info_translates_failed_result_to_redacted_non_200(monkeypatch):
    async def fail(*args, **kwargs):
        return {"success": False, "error": "/secret/media.mov token=abc"}

    monkeypatch.setattr(tools_router, "extract_trace_context", lambda *a, **k: {})
    monkeypatch.setattr(tools_router.service, "ffmpeg_info", fail)
    with pytest.raises(HTTPException) as raised:
        await tools_router.ffmpeg_info("media.mov", http_request=object())
    assert raised.value.status_code == 500
    assert raised.value.detail == "Tool operation failed"


@pytest.mark.asyncio
async def test_ffprobe_info_preserves_successful_service_payload(monkeypatch):
    payload = {"success": True, "format": {"duration": "1.25"}, "streams": [{"codec_name": "h264"}]}

    async def succeed(*args, **kwargs):
        return payload

    monkeypatch.setattr(tools_router, "extract_trace_context", lambda *a, **k: {})
    monkeypatch.setattr(tools_router.service, "ffmpeg_info", succeed)
    response = await tools_router.ffmpeg_info("media.mov", http_request=object())
    assert response == {"success": True, "data": payload, "error": None}


def test_git_init_and_status_probes_reuse_async_bounded_runner(monkeypatch):
    calls = []

    async def bounded(cmd, cwd=None, timeout=60):
        calls.append((cmd, timeout))
        return git_wrapper.GitResult(success=True, stdout="value", stderr="", returncode=0)

    monkeypatch.setattr("cortex_server.services.tool_service.run_git_async", bounded)
    result = asyncio.run(ToolService().git_init("repo"))
    assert result == {"success": True, "stdout": "value", "stderr": ""}
    assert calls == [(["git", "init", "--", "repo"], 60)]

    calls.clear()
    monkeypatch.setattr(tools_router, "run_git_async", bounded)
    status = asyncio.run(tools_router.tools_status())
    assert status["git_identity"] == {"user_name": "value", "user_email": "value", "configured": True}
    assert calls == [
        (["git", "config", "--global", "user.name"], 5),
        (["git", "config", "--global", "user.email"], 5),
    ]


def test_git_identity_probes_reuse_async_bounded_runner(monkeypatch):
    calls = []

    async def bounded(cmd, cwd=None, timeout=60):
        calls.append((cmd, timeout))
        value = "" if "-C" in cmd else "global-value"
        return git_wrapper.GitResult(success=bool(value), stdout=value, stderr="", returncode=0 if value else 1)

    monkeypatch.setattr("cortex_server.services.tool_service.run_git_async", bounded)
    assert asyncio.run(ToolService()._git_identity_configured("repo")) == (True, "")
    assert calls == [
        (["git", "-C", "repo", "config", "user.name"], 5),
        (["git", "-C", "repo", "config", "user.email"], 5),
        (["git", "config", "--global", "user.name"], 5),
        (["git", "config", "--global", "user.email"], 5),
    ]


@pytest.mark.asyncio
async def test_git_service_command_yields_to_event_loop(monkeypatch):
    entered = asyncio.Event()
    release = asyncio.Event()

    async def bounded(cmd, cwd=None, timeout=60):
        entered.set()
        await release.wait()
        return git_wrapper.GitResult(success=True, stdout="initialized", stderr="", returncode=0)

    monkeypatch.setattr("cortex_server.services.tool_service.run_git_async", bounded)
    monkeypatch.setattr(ToolService, "_trace_finish", lambda *a, **k: None)
    task = asyncio.create_task(ToolService().git_init("repo"))
    await entered.wait()
    ticked = False

    async def ticker():
        nonlocal ticked
        await asyncio.sleep(0)
        ticked = True

    await ticker()
    assert ticked and not task.done()
    release.set()
    assert await task == {"success": True, "stdout": "initialized", "stderr": ""}
