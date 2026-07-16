import asyncio
import os
from pathlib import Path
import subprocess
import textwrap
from types import SimpleNamespace

import pytest

from cortex_server.tools import docker_wrapper


def _compose_service_definition(compose: str, service: str) -> str:
    marker = f"\n  {service}:\n"
    section = compose.split(marker, 1)[1]
    lines = []
    for line in section.splitlines(keepends=True):
        if line.startswith("  ") and len(line) > 2 and not line[2].isspace():
            break
        lines.append(line)
    return "".join(lines)


def _compose_init_script(compose: str, service: str, mounts: dict[str, Path]) -> str:
    section = _compose_service_definition(compose, service)
    script = section.split("      - |\n", 1)[1].split("\n    restart:", 1)[0]
    script = textwrap.dedent(script).replace("$$", "$")
    for container_path, host_path in mounts.items():
        script = script.replace(container_path, str(host_path))
    return script


def _volume_tree(root: Path) -> list[tuple[str, bool, int, str]]:
    snapshot = []
    for path in sorted(root.rglob("*")):
        snapshot.append(
            (
                path.relative_to(root).as_posix(),
                path.is_symlink(),
                path.lstat().st_mode,
                os.readlink(path) if path.is_symlink() else "",
            )
        )
    return snapshot


VOLUME_INITIALIZERS = (
    (
        "cortex-memory-volume-init",
        "CORTEX_CHROMA_MOUNT_ID",
        "cortex-chroma.volume-id",
        "/memory",
        Path(".cortex-durable-memory"),
    ),
    (
        "cortex-runtime-delivery-volume-init",
        "CORTEX_RUNTIME_DELIVERY_MOUNT_ID",
        "cortex-runtime-delivery.volume-id",
        "/state",
        Path("runtime_delivery/.cortex-durable-runtime-delivery"),
    ),
    (
        "cortex-knowledge-volume-init",
        "CORTEX_KNOWLEDGE_MOUNT_ID",
        "cortex-knowledge.volume-id",
        "/knowledge",
        Path(".cortex-durable-knowledge"),
    ),
)


def test_production_container_healthcheck_uses_readiness_not_liveness():
    dockerfile = (Path(__file__).resolve().parents[2] / "Dockerfile").read_text(encoding="utf-8")

    assert "curl -fsS http://localhost:8888/ready >/dev/null" in dockerfile
    assert "runtime-delivery/readiness" not in dockerfile
    assert "http://localhost:8888/orchestrator/runtime/delivery/readiness" not in dockerfile
    assert "http://localhost:8888/health" not in dockerfile


def test_production_container_packages_adaptive_routing_services():
    dockerfile = (Path(__file__).resolve().parents[2] / "Dockerfile").read_text(encoding="utf-8")

    assert "COPY cortex_server/services/ ./services/" in dockerfile


def test_production_container_pid1_has_allocator_and_connection_hardening():
    dockerfile = (Path(__file__).resolve().parents[2] / "Dockerfile").read_text(encoding="utf-8")

    assert "ENV MALLOC_ARENA_MAX=2" in dockerfile
    assert "ENV MALLOC_TRIM_THRESHOLD_=131072" in dockerfile
    assert dockerfile.index("ENV MALLOC_ARENA_MAX=2") < dockerfile.index('CMD ["python"')
    assert '"--limit-concurrency", "128"' in dockerfile
    assert '"--timeout-keep-alive", "5"' in dockerfile


def test_compose_mounts_and_identifies_durable_memory_volume():
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(encoding="utf-8")

    assert "cortex-chroma:/app/cortex_server/chroma_db:rw" in compose
    assert "CORTEX_CHROMA_DIR: /app/cortex_server/chroma_db" in compose
    assert "CORTEX_CHROMA_MOUNT_ID:" in compose
    assert "CORTEX_MEMORY_SCOPE_CREDENTIALS:" in compose
    assert "CORTEX_MEMORY_SCOPE_SECRET:" not in compose
    assert "CORTEX_CODEC_ADMIN_TOKEN:" in compose
    assert "CORTEX_WRITE_AUTH_MODE: token_required" in compose
    assert "CORTEX_WRITE_TOKEN:" in compose
    assert "CORTEX_AGENT_ACK_CREDENTIALS:" in compose
    assert "CORTEX_RELEASE_VERIFIER_CREDENTIALS:" in compose
    assert "NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY:" in compose
    assert "NEXUS_OUTCOME_FEEDBACK_TOKEN: ${NEXUS_OUTCOME_FEEDBACK_TOKEN:?" in compose
    assert "cortex-memory-volume-init:" in compose


def test_compose_mounts_and_identifies_durable_runtime_delivery_volume():
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(encoding="utf-8")

    assert "cortex-runtime-delivery:/opt/clawdbot/runtime-volume:rw" in compose
    assert "ORCHESTRATOR_RUNTIME_DELIVERY_ROOT: /opt/clawdbot/runtime-volume/runtime_delivery" in compose
    assert "REASONING_STORE_DB_PATH: /opt/clawdbot/reasoning/reasoning_runtime.db" in compose
    assert "CORTEX_DB_PATH: /opt/clawdbot/knowledge/cortex_graph.db" in compose
    assert "CORTEX_DB_SEED_PATH: /app/seed/cortex_graph.db" not in compose
    assert 'cp /seed/cortex_graph.db "$$knowledge_temporary"' in compose
    assert "./knowledge:/app/cortex_server/knowledge" not in compose
    assert "CORTEX_RUNTIME_DELIVERY_MOUNT_ID:" in compose
    assert "CORTEX_REQUIRED_PATHS: ${CORTEX_REQUIRED_PATHS:-}" in compose
    assert "CORTEX_REQUIRED_ROUTERS: ${CORTEX_REQUIRED_ROUTERS:-}" in compose
    assert "cortex-runtime-delivery-volume-init:" in compose
    assert "marker=/state/runtime_delivery/.cortex-durable-runtime-delivery" in compose
    assert "sync \"$${parent}\"" in compose
    assert "/state/runtime_delivery/release_workflow/artifacts" in compose
    assert "/state/runtime_delivery/production_build_loop/locks" in compose
    assert "/state/runtime_delivery/session_event_inbox" in compose
    assert "cortex-knowledge:/opt/clawdbot/knowledge:rw" in compose
    assert "CORTEX_KNOWLEDGE_MOUNT_ID:" in compose
    assert "cortex-knowledge-volume-init:" in compose
    assert "chmod 0700 /state /state/runtime_delivery" in compose
    assert "release-verifier:" in compose
    assert "release-manager:" in compose
    assert "CORTEX_RELEASE_VERIFIER_HEALTH_URL:" in compose
    assert "CORTEX_RELEASE_MANAGER_HEALTH_URL:" in compose
    assert "cortex-runtime-delivery:" in compose


def test_compose_runs_distinct_capability_checked_release_controllers():
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(encoding="utf-8")
    brain = _compose_service_definition(compose, "cortex-brain")
    verifier = _compose_service_definition(compose, "release-verifier")
    manager = _compose_service_definition(compose, "release-manager")

    assert "cortex-runtime-delivery:/opt/clawdbot/runtime-volume:rw" in brain
    assert "ORCHESTRATOR_RUNTIME_DELIVERY_ROOT: /opt/clawdbot/runtime-volume/runtime_delivery" in brain
    assert "cortex-app-state:/opt/clawdbot/state:rw" in brain
    assert "cortex-knowledge:/opt/clawdbot/knowledge:rw" in brain
    assert "cortex-reasoning:/opt/clawdbot/reasoning:rw" in brain
    assert "CORTEX_RUNTIME_DELIVERY_PREALLOCATE_RECOVERY_RESERVE: \"true\"" in brain

    assert "python -m cortex_server.runtime.release_verifier_worker" in verifier
    assert "CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET:" in verifier
    assert "CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN:" in verifier
    assert "CORTEX_RELEASE_MEASUREMENT_URL: http://cortex-brain:8888/release-observation" in verifier
    assert "cortex-release-verifier-state:/controller-state:rw" in verifier
    assert "CORTEX_WRITE_TOKEN:" not in verifier

    assert "python -m cortex_server.runtime.release_manager_worker" in manager
    assert "CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET:" not in manager
    assert "CORTEX_RELEASE_MEASUREMENT_URL: http://cortex-brain:8888/release-observation" in manager
    assert "cortex-release-manager-state:/controller-state:rw" in manager
    assert "CORTEX_WRITE_TOKEN:" not in manager


def test_volume_identity_markers_are_minted_only_by_explicit_bootstrap():
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(encoding="utf-8")

    assert 'profiles: ["bootstrap"]' in compose
    assert "cortex-volume-bootstrap:" in compose
    assert "./continuity:/continuity:rw" in compose
    assert compose.count("./continuity:/continuity:ro") == 3
    assert "CORTEX_CHROMA_MOUNT_ID:-" not in compose
    assert "CORTEX_RUNTIME_DELIVERY_MOUNT_ID:-" not in compose
    assert "CORTEX_KNOWLEDGE_MOUNT_ID:-" not in compose
    assert compose.count('if [ ! -e "$$marker" ]; then') == 3
    assert compose.count("refusing blank replacement volume") == 3
    assert compose.count("run explicit bootstrap or restore") == 3


def test_blank_replacement_volumes_fail_before_ordinary_initialization_mutates_them():
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(encoding="utf-8")
    memory_init = _compose_service_definition(compose, "cortex-memory-volume-init")
    runtime_init = _compose_service_definition(
        compose, "cortex-runtime-delivery-volume-init"
    )
    knowledge_init = _compose_service_definition(
        compose, "cortex-knowledge-volume-init"
    )

    assert memory_init.index('if [ ! -e "$$marker" ]; then') < memory_init.index(
        'cat "$$marker"'
    )
    assert "mv \"$$temporary\" \"$$marker\"" not in memory_init
    assert runtime_init.index('if [ ! -e "$$marker" ]; then') < runtime_init.index(
        "for directory in"
    )
    assert "mv \"$$temporary\" \"$$marker\"" not in runtime_init
    assert knowledge_init.index('if [ ! -e "$$marker" ]; then') < knowledge_init.index(
        'if [ ! -f "$$database" ]'
    )
    assert "CORTEX_DB_SEED_PATH" not in knowledge_init


@pytest.mark.parametrize(
    "service,credential,manifest_name,volume_mount,marker_relative",
    VOLUME_INITIALIZERS,
)
def test_blank_replacement_volume_commands_exit_without_mutation(
    tmp_path,
    service,
    credential,
    manifest_name,
    volume_mount,
    marker_relative,
):
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    mounts = {
        "/continuity": tmp_path / "continuity",
        "/memory": tmp_path / "memory",
        "/knowledge": tmp_path / "knowledge",
        "/state": tmp_path / "state",
    }
    for path in mounts.values():
        path.mkdir()
    identity = "deployment-volume-id"
    (mounts["/continuity"] / manifest_name).write_text(
        identity + "\n", encoding="utf-8"
    )
    volume = mounts[volume_mount]
    before = _volume_tree(volume)

    completed = subprocess.run(
        ["/bin/sh", "-ec", _compose_init_script(compose, service, mounts)],
        capture_output=True,
        check=False,
        env={**os.environ, credential: identity},
        text=True,
    )

    assert completed.returncode != 0
    assert "refusing blank replacement volume" in completed.stderr
    assert _volume_tree(volume) == before == []


@pytest.mark.parametrize(
    "service,credential,manifest_name,volume_mount,marker_relative",
    VOLUME_INITIALIZERS,
)
def test_symlink_volume_identity_markers_are_rejected_before_initialization(
    tmp_path,
    service,
    credential,
    manifest_name,
    volume_mount,
    marker_relative,
):
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    mounts = {
        "/continuity": tmp_path / "continuity",
        "/memory": tmp_path / "memory",
        "/knowledge": tmp_path / "knowledge",
        "/state": tmp_path / "state",
    }
    for path in mounts.values():
        path.mkdir()
    identity = "deployment-volume-id"
    manifest = mounts["/continuity"] / manifest_name
    manifest.write_text(identity + "\n", encoding="utf-8")
    marker = mounts[volume_mount] / marker_relative
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.symlink_to(manifest)
    volume = mounts[volume_mount]
    before = _volume_tree(volume)

    completed = subprocess.run(
        ["/bin/sh", "-ec", _compose_init_script(compose, service, mounts)],
        capture_output=True,
        check=False,
        env={**os.environ, credential: identity},
        text=True,
    )

    assert completed.returncode != 0
    assert "regular non-symlink file" in completed.stderr
    assert _volume_tree(volume) == before


def test_compose_enforces_allocator_and_cgroup_oom_boundaries():
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(encoding="utf-8")

    assert 'MALLOC_ARENA_MAX: "2"' in compose
    assert 'MALLOC_TRIM_THRESHOLD_: "131072"' in compose
    assert "mem_limit: 3g" in compose
    assert "mem_reservation: 2g" in compose
    assert "memswap_limit: 3584m" in compose
    assert "oom_kill_disable: false" in compose
    assert "pids_limit: 512" in compose


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
