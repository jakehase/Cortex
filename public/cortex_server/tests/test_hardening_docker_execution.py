import asyncio
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import textwrap
from types import SimpleNamespace

import pytest
import chromadb

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
    replacements = []
    for index, (container_path, host_path) in enumerate(
        sorted(mounts.items(), key=lambda item: len(item[0]), reverse=True)
    ):
        placeholder = f"__CORTEX_TEST_MOUNT_{index}__"
        script = re.sub(
            rf"(?<![A-Za-z0-9_.\-/]){re.escape(container_path)}",
            placeholder,
            script,
        )
        replacements.append((placeholder, str(host_path)))
    for placeholder, host_path in replacements:
        script = script.replace(placeholder, host_path)
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


def _initialize_test_chroma_authority(root: Path) -> None:
    client = chromadb.PersistentClient(path=str(root))
    collection = client.get_or_create_collection(
        name="cortex_memory",
        embedding_function=None,
    )
    collection.add(
        ids=["preserved-memory-row"],
        embeddings=[[0.5]],
        documents=["preserved memory"],
    )


def _initialize_test_reasoning_authority(path: Path) -> None:
    from cortex_server.modules.reasoning_store import list_docs

    list_docs("reasoning_processes", db_path=path)
    with sqlite3.connect(path) as connection:
        connection.execute(
            "INSERT INTO reasoning_documents(namespace, doc_id, created_at, updated_at, payload) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                "reasoning_processes",
                "preserved-reasoning-row",
                "2026-07-16T00:00:00+00:00",
                "2026-07-16T00:00:00+00:00",
                '{"process_id":"preserved-reasoning-row"}',
            ),
        )


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
    (
        "cortex-app-state-volume-init",
        "CORTEX_APP_STATE_MOUNT_ID",
        "cortex-app-state.volume-id",
        "/application",
        Path(".cortex-durable-app-state"),
    ),
    (
        "cortex-reasoning-volume-init",
        "CORTEX_REASONING_MOUNT_ID",
        "cortex-reasoning.volume-id",
        "/reasoning",
        Path(".cortex-durable-reasoning"),
    ),
    (
        "cortex-release-verifier-state-volume-init",
        "CORTEX_RELEASE_CONTROLLER_MOUNT_ID",
        "cortex-release-verifier-state.volume-id",
        "/controller",
        Path(".cortex-durable-release-controller"),
    ),
    (
        "cortex-release-manager-state-volume-init",
        "CORTEX_RELEASE_CONTROLLER_MOUNT_ID",
        "cortex-release-manager-state.volume-id",
        "/controller",
        Path(".cortex-durable-release-controller"),
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


def test_production_images_and_openclaw_inputs_are_immutable():
    public_root = Path(__file__).resolve().parents[2]
    dockerfile = (public_root / "Dockerfile").read_text(encoding="utf-8")
    compose = (public_root / "docker-compose.yml").read_text(encoding="utf-8")
    from_line = next(line for line in dockerfile.splitlines() if line.startswith("FROM "))
    assert re.fullmatch(
        r"FROM python:3\.11\.15-slim@sha256:[0-9a-f]{64}",
        from_line,
    )
    assert "openclaw@latest" not in dockerfile
    assert re.search(r"ARG OPENCLAW_VERSION=\d{4}\.\d+\.\d+", dockerfile)
    assert re.search(r"ARG OPENCLAW_INTEGRITY=sha512-[A-Za-z0-9+/]+=*", dockerfile)
    assert 'npm view "openclaw@${OPENCLAW_VERSION}" dist.integrity' in dockerfile
    assert re.search(
        r"image: rhasspy/wyoming-piper:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}",
        compose,
    )
    cortex_image = (
        "${CORTEX_IMAGE_REPOSITORY:?set the published Cortex image repository}"
        "@sha256:${CORTEX_IMAGE_DIGEST:?set the 64-character lowercase Cortex image digest}"
    )
    resolved = compose.replace(
        cortex_image,
        "registry.invalid/cortex@sha256:" + "a" * 64,
    )
    image_lines = [
        line.strip().removeprefix("image: ")
        for line in resolved.splitlines()
        if line.strip().startswith("image: ")
    ]
    assert len(image_lines) == 13
    assert all(
        re.fullmatch(r"[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}", image)
        for image in image_lines
    )
    assert "CORTEX_IMAGE_REF" not in compose
    assert "build:" not in compose
    for service in (
        "cortex-brain",
        "cortex-volume-bootstrap",
        "cortex-volume-adopt-source",
        "release-verifier",
        "release-manager",
    ):
        definition = _compose_service_definition(compose, service)
        assert f"image: {cortex_image}" in definition
        assert "build:" not in definition


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
    assert "cortex-app-state-volume-init:" in compose
    assert "cortex-reasoning-volume-init:" in compose
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
    assert 'CORTEX_RELEASE_CONTROLLER_REQUIRE_EXISTING_STATE: "true"' in manager
    assert "cortex-release-manager-state-volume-init:" in manager
    assert "CORTEX_WRITE_TOKEN:" not in manager


def test_volume_identity_markers_are_minted_only_by_explicit_bootstrap():
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(encoding="utf-8")

    assert 'profiles: ["bootstrap"]' in compose
    assert "cortex-volume-bootstrap:" in compose
    assert "./continuity:/continuity:rw" in compose
    assert compose.count("./continuity:/continuity:ro") == 7
    assert "CORTEX_CHROMA_MOUNT_ID:-" not in compose
    assert "CORTEX_RUNTIME_DELIVERY_MOUNT_ID:-" not in compose
    assert "CORTEX_KNOWLEDGE_MOUNT_ID:-" not in compose
    assert compose.count('if [ ! -e "$$marker" ]; then') == 7
    assert compose.count("refusing blank replacement volume") == 7
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


def test_explicit_bootstrap_initializes_every_identity_and_controller_ledger(tmp_path):
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    mounts = {
        "/continuity": tmp_path / "continuity",
        "/seed": tmp_path / "seed",
        "/memory": tmp_path / "memory",
        "/knowledge": tmp_path / "knowledge",
        "/state": tmp_path / "state",
        "/application": tmp_path / "application",
        "/reasoning": tmp_path / "reasoning",
        "/verifier-controller": tmp_path / "verifier-controller",
        "/manager-controller": tmp_path / "manager-controller",
    }
    for path in mounts.values():
        path.mkdir()
    (mounts["/seed"] / "cortex_graph.db").write_text("seed-graph", encoding="utf-8")
    identities = {
        "CORTEX_BOOTSTRAP_PYTHON": sys.executable,
        "CORTEX_CHROMA_MOUNT_ID": "bootstrap-chroma-id",
        "CORTEX_KNOWLEDGE_MOUNT_ID": "bootstrap-knowledge-id",
        "CORTEX_RUNTIME_DELIVERY_MOUNT_ID": "bootstrap-runtime-id",
        "CORTEX_APP_STATE_MOUNT_ID": "bootstrap-application-id",
        "CORTEX_REASONING_MOUNT_ID": "bootstrap-reasoning-id",
        "CORTEX_RELEASE_VERIFIER_STATE_MOUNT_ID": "bootstrap-verifier-id",
        "CORTEX_RELEASE_MANAGER_STATE_MOUNT_ID": "bootstrap-manager-id",
    }

    completed = subprocess.run(
        [
            "/bin/sh",
            "-ec",
            _compose_init_script(compose, "cortex-volume-bootstrap", mounts),
        ],
        capture_output=True,
        check=False,
        env={**os.environ, **identities},
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
    assert len(list(mounts["/continuity"].glob("*.volume-id"))) == 7
    assert (mounts["/continuity"] / "cortex-volume-set.complete").read_text(
        encoding="utf-8"
    ).strip() == "cortex.volume-set.v1"
    assert (mounts["/knowledge"] / "cortex_graph.db").read_text(
        encoding="utf-8"
    ) == "seed-graph"
    assert (mounts["/memory"] / ".cortex-memory-authority").read_text(
        encoding="utf-8"
    ).strip() == "cortex.memory-authority.v1:bootstrap-chroma-id:cortex_memory"
    memory_client = chromadb.PersistentClient(path=str(mounts["/memory"]))
    assert memory_client.get_collection("cortex_memory", embedding_function=None).count() == 0
    assert (
        memory_client.get_collection(
            "cortex-durability-readiness", embedding_function=None
        ).count()
        == 0
    )
    reasoning_database = mounts["/reasoning"] / "reasoning_runtime.db"
    assert (mounts["/reasoning"] / ".cortex-reasoning-authority").read_text(
        encoding="utf-8"
    ).strip() == (
        "cortex.reasoning-authority.v1:bootstrap-reasoning-id:reasoning_runtime.db"
    )
    with sqlite3.connect(f"file:{reasoning_database}?mode=ro", uri=True) as connection:
        assert connection.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        assert {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        } >= {"reasoning_documents", "reasoning_events"}
    for controller in ("/verifier-controller", "/manager-controller"):
        assert json.loads(
            (mounts[controller] / "observations.json").read_text(encoding="utf-8")
        ) == {
            "version": "cortex.release-controller-observations.v1",
            "windows": {},
        }


def test_interrupted_volume_bootstrap_resumes_matching_transaction(tmp_path):
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    mounts = {
        "/continuity": tmp_path / "continuity",
        "/seed": tmp_path / "seed",
        "/memory": tmp_path / "memory",
        "/knowledge": tmp_path / "knowledge",
        "/state": tmp_path / "state",
        "/application": tmp_path / "application",
        "/reasoning": tmp_path / "reasoning",
        "/verifier-controller": tmp_path / "verifier-controller",
        "/manager-controller": tmp_path / "manager-controller",
    }
    for path in mounts.values():
        path.mkdir()
    (mounts["/seed"] / "cortex_graph.db").write_text(
        "seed-graph", encoding="utf-8"
    )
    identities = {
        "CORTEX_BOOTSTRAP_PYTHON": sys.executable,
        "CORTEX_CHROMA_MOUNT_ID": "resume-chroma-id",
        "CORTEX_KNOWLEDGE_MOUNT_ID": "resume-knowledge-id",
        "CORTEX_RUNTIME_DELIVERY_MOUNT_ID": "resume-runtime-id",
        "CORTEX_APP_STATE_MOUNT_ID": "resume-application-id",
        "CORTEX_REASONING_MOUNT_ID": "resume-reasoning-id",
        "CORTEX_RELEASE_VERIFIER_STATE_MOUNT_ID": "resume-verifier-id",
        "CORTEX_RELEASE_MANAGER_STATE_MOUNT_ID": "resume-manager-id",
    }
    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    real_mv = shutil.which("mv")
    assert real_mv is not None
    fake_mv = fake_bin / "mv"
    fake_mv.write_text(
        textwrap.dedent(
            f"""\
            #!/bin/sh
            {real_mv} "$@"
            status=$?
            [ "$status" -eq 0 ] || exit "$status"
            case "$*" in
              *cortex-chroma.volume-id*) exit 97 ;;
            esac
            """
        ),
        encoding="utf-8",
    )
    fake_mv.chmod(0o755)
    script = _compose_init_script(compose, "cortex-volume-bootstrap", mounts)

    interrupted = subprocess.run(
        ["/bin/sh", "-ec", script],
        capture_output=True,
        check=False,
        env={
            **os.environ,
            **identities,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
        },
        text=True,
    )

    assert interrupted.returncode == 97
    journal = mounts["/continuity"] / "cortex-volume-bootstrap.journal"
    assert journal.is_file()
    assert (mounts["/continuity"] / "cortex-chroma.volume-id").is_file()
    assert not (mounts["/continuity"] / "cortex-volume-set.complete").exists()

    mismatched = subprocess.run(
        ["/bin/sh", "-ec", script],
        capture_output=True,
        check=False,
        env={
            **os.environ,
            **identities,
            "CORTEX_CHROMA_MOUNT_ID": "different-chroma-id",
        },
        text=True,
    )
    assert mismatched.returncode != 0
    assert "another revision or volume set" in mismatched.stderr

    recovered = subprocess.run(
        ["/bin/sh", "-ec", script],
        capture_output=True,
        check=False,
        env={**os.environ, **identities},
        text=True,
    )

    assert recovered.returncode == 0, recovered.stderr
    assert "complete" in journal.read_text(encoding="utf-8").splitlines()
    assert len(list(mounts["/continuity"].glob("*.volume-id"))) == 7
    assert (mounts["/continuity"] / "cortex-volume-set.complete").read_text(
        encoding="utf-8"
    ).strip() == "cortex.volume-set.v1"

    initialized = subprocess.run(
        [
            "/bin/sh",
            "-ec",
            _compose_init_script(
                compose,
                "cortex-memory-volume-init",
                {"/continuity": mounts["/continuity"], "/memory": mounts["/memory"]},
            ),
        ],
        capture_output=True,
        check=False,
        env={**os.environ, "CORTEX_CHROMA_MOUNT_ID": identities["CORTEX_CHROMA_MOUNT_ID"]},
        text=True,
    )
    assert initialized.returncode == 0, initialized.stderr

    rerun = subprocess.run(
        ["/bin/sh", "-ec", script],
        capture_output=True,
        check=False,
        env={**os.environ, **identities},
        text=True,
    )
    assert rerun.returncode == 0, rerun.stderr
    assert len(list(mounts["/continuity"].glob("*.volume-id"))) == 7


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
        "/application": tmp_path / "application",
        "/reasoning": tmp_path / "reasoning",
        "/controller": tmp_path / "controller",
    }
    for path in mounts.values():
        path.mkdir()
    identity = "deployment-volume-id"
    (mounts["/continuity"] / manifest_name).write_text(
        identity + "\n", encoding="utf-8"
    )
    (mounts["/continuity"] / "cortex-volume-set.complete").write_text(
        "cortex.volume-set.v1\n", encoding="utf-8"
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
    "service,credential,manifest_name,volume_mount,marker_name,authority_name,authority_value,error",
    (
        (
            "cortex-memory-volume-init",
            "CORTEX_CHROMA_MOUNT_ID",
            "cortex-chroma.volume-id",
            "/memory",
            ".cortex-durable-memory",
            ".cortex-memory-authority",
            "cortex.memory-authority.v1:deployment-volume-id:cortex_memory",
            "memory authority database is missing",
        ),
        (
            "cortex-reasoning-volume-init",
            "CORTEX_REASONING_MOUNT_ID",
            "cortex-reasoning.volume-id",
            "/reasoning",
            ".cortex-durable-reasoning",
            ".cortex-reasoning-authority",
            "cortex.reasoning-authority.v1:deployment-volume-id:reasoning_runtime.db",
            "reasoning database is missing",
        ),
    ),
)
def test_ordinary_startup_rejects_lost_authority_database_without_mutation(
    tmp_path,
    service,
    credential,
    manifest_name,
    volume_mount,
    marker_name,
    authority_name,
    authority_value,
    error,
):
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    continuity = tmp_path / "continuity"
    volume = tmp_path / volume_mount.removeprefix("/")
    continuity.mkdir()
    volume.mkdir()
    identity = "deployment-volume-id"
    (continuity / manifest_name).write_text(identity + "\n", encoding="utf-8")
    (continuity / "cortex-volume-set.complete").write_text(
        "cortex.volume-set.v1\n",
        encoding="utf-8",
    )
    (volume / marker_name).write_text(identity + "\n", encoding="utf-8")
    (volume / authority_name).write_text(authority_value + "\n", encoding="utf-8")
    before = _volume_tree(volume)

    completed = subprocess.run(
        [
            "/bin/sh",
            "-ec",
            _compose_init_script(
                compose,
                service,
                {"/continuity": continuity, volume_mount: volume},
            ),
        ],
        capture_output=True,
        check=False,
        env={**os.environ, credential: identity},
        text=True,
    )

    assert completed.returncode != 0
    assert error in completed.stderr
    assert _volume_tree(volume) == before


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
        "/application": tmp_path / "application",
        "/reasoning": tmp_path / "reasoning",
        "/controller": tmp_path / "controller",
    }
    for path in mounts.values():
        path.mkdir()
    identity = "deployment-volume-id"
    manifest = mounts["/continuity"] / manifest_name
    manifest.write_text(identity + "\n", encoding="utf-8")
    (mounts["/continuity"] / "cortex-volume-set.complete").write_text(
        "cortex.volume-set.v1\n", encoding="utf-8"
    )
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


@pytest.mark.parametrize(
    "service,manifest_name",
    (
        (
            "cortex-release-verifier-state-volume-init",
            "cortex-release-verifier-state.volume-id",
        ),
        (
            "cortex-release-manager-state-volume-init",
            "cortex-release-manager-state.volume-id",
        ),
    ),
)
def test_controller_initializers_reject_missing_observation_store_without_mutation(
    tmp_path, service, manifest_name
):
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    continuity = tmp_path / "continuity"
    controller = tmp_path / "controller"
    continuity.mkdir()
    controller.mkdir()
    identity = "controller-volume-id"
    (continuity / manifest_name).write_text(identity + "\n", encoding="utf-8")
    (continuity / "cortex-volume-set.complete").write_text(
        "cortex.volume-set.v1\n", encoding="utf-8"
    )
    (controller / ".cortex-durable-release-controller").write_text(
        identity + "\n", encoding="utf-8"
    )
    before = _volume_tree(controller)

    completed = subprocess.run(
        [
            "/bin/sh",
            "-ec",
            _compose_init_script(
                compose,
                service,
                {"/continuity": continuity, "/controller": controller},
            ),
        ],
        capture_output=True,
        check=False,
        env={**os.environ, "CORTEX_RELEASE_CONTROLLER_MOUNT_ID": identity},
        text=True,
    )

    assert completed.returncode != 0
    assert "observations are missing or unsafe" in completed.stderr
    assert _volume_tree(controller) == before


def _source_adoption_fixture(tmp_path: Path) -> tuple[dict[str, Path], dict[str, str]]:
    mounts = {
        "/continuity": tmp_path / "continuity",
        "/source-memory": tmp_path / "source-memory",
        "/source": tmp_path / "source",
        "/application": tmp_path / "application",
        "/knowledge": tmp_path / "knowledge",
        "/reasoning": tmp_path / "reasoning",
        "/verifier-controller": tmp_path / "verifier-controller",
        "/manager-controller": tmp_path / "manager-controller",
    }
    for path in mounts.values():
        path.mkdir()
    (mounts["/source-memory"] / ".cortex-durable-memory").write_text(
        "cortex-chroma-v1\n", encoding="utf-8"
    )
    _initialize_test_chroma_authority(mounts["/source-memory"])
    runtime = mounts["/source"] / "runtime_delivery"
    runtime.mkdir()
    (runtime / ".cortex-durable-runtime-delivery").write_text(
        "cortex-runtime-delivery-v1\n", encoding="utf-8"
    )
    (runtime / "active-rollback.json").write_text(
        '{"release":"active"}\n', encoding="utf-8"
    )
    source_knowledge = mounts["/source"] / "knowledge"
    source_knowledge.mkdir()
    (source_knowledge / "cortex_graph.db").write_text(
        "preserved-knowledge", encoding="utf-8"
    )
    _initialize_test_reasoning_authority(
        mounts["/source"] / "reasoning_runtime.db"
    )
    (mounts["/source"] / "nexus_outcome_feedback_receipts.json").write_text(
        '{"consumed":["jti-preserved"]}\n', encoding="utf-8"
    )
    identities = {
        "CORTEX_BOOTSTRAP_PYTHON": sys.executable,
        "CORTEX_SOURCE_CHROMA_MOUNT_ID": "cortex-chroma-v1",
        "CORTEX_SOURCE_RUNTIME_DELIVERY_MOUNT_ID": "cortex-runtime-delivery-v1",
        "CORTEX_CHROMA_MOUNT_ID": "adopted-chroma-id",
        "CORTEX_KNOWLEDGE_MOUNT_ID": "adopted-knowledge-id",
        "CORTEX_RUNTIME_DELIVERY_MOUNT_ID": "adopted-runtime-id",
        "CORTEX_APP_STATE_MOUNT_ID": "adopted-application-id",
        "CORTEX_REASONING_MOUNT_ID": "adopted-reasoning-id",
        "CORTEX_RELEASE_VERIFIER_STATE_MOUNT_ID": "adopted-verifier-id",
        "CORTEX_RELEASE_MANAGER_STATE_MOUNT_ID": "adopted-manager-id",
        "CORTEX_ADOPTION_MAX_SOURCE_BYTES": "1048576",
        "CORTEX_ADOPTION_MAX_SOURCE_ENTRIES": "1000",
    }
    return mounts, identities


def _run_source_adoption(
    compose: str,
    mounts: dict[str, Path],
    identities: dict[str, str],
    *,
    path: str | None = None,
) -> subprocess.CompletedProcess[str]:
    environment = {**os.environ, **identities}
    if path is not None:
        environment["PATH"] = path
    return subprocess.run(
        [
            "/bin/sh",
            "-ec",
            _compose_init_script(compose, "cortex-volume-adopt-source", mounts),
        ],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )


def test_source_volume_adoption_preserves_split_state_and_completed_rerun_is_noop(tmp_path):
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    mounts, identities = _source_adoption_fixture(tmp_path)

    completed = _run_source_adoption(compose, mounts, identities)

    assert completed.returncode == 0, completed.stderr
    assert (
        mounts["/application"] / "nexus_outcome_feedback_receipts.json"
    ).read_text(encoding="utf-8") == '{"consumed":["jti-preserved"]}\n'
    assert not (mounts["/application"] / "runtime_delivery").exists()
    assert not (mounts["/application"] / "knowledge").exists()
    assert (mounts["/knowledge"] / "cortex_graph.db").read_text(
        encoding="utf-8"
    ) == "preserved-knowledge"
    with sqlite3.connect(
        f"file:{mounts['/reasoning'] / 'reasoning_runtime.db'}?mode=ro",
        uri=True,
    ) as connection:
        assert connection.execute(
            "SELECT doc_id FROM reasoning_documents WHERE namespace = ?",
            ("reasoning_processes",),
        ).fetchone()[0] == "preserved-reasoning-row"
    adopted_memory = chromadb.PersistentClient(path=str(mounts["/source-memory"]))
    assert adopted_memory.get_collection(
        "cortex_memory", embedding_function=None
    ).count() == 1
    assert adopted_memory.get_collection(
        "cortex-durability-readiness", embedding_function=None
    ).count() == 0
    assert (mounts["/source-memory"] / ".cortex-memory-authority").read_text(
        encoding="utf-8"
    ).strip() == "cortex.memory-authority.v1:adopted-chroma-id:cortex_memory"
    assert (mounts["/reasoning"] / ".cortex-reasoning-authority").read_text(
        encoding="utf-8"
    ).strip() == (
        "cortex.reasoning-authority.v1:adopted-reasoning-id:reasoning_runtime.db"
    )
    assert (mounts["/source"] / "runtime_delivery/active-rollback.json").is_file()
    assert "complete" in (
        mounts["/continuity"] / "cortex-source-adoption.journal"
    ).read_text(encoding="utf-8").splitlines()
    manifests = sorted(mounts["/continuity"].glob("*.volume-id"))
    assert len(manifests) == 7
    assert (
        mounts["/continuity"] / "cortex-volume-set.complete"
    ).read_text(encoding="utf-8").strip() == "cortex.volume-set.v1"
    for controller in ("/verifier-controller", "/manager-controller"):
        payload = (mounts[controller] / "observations.json").read_text(encoding="utf-8")
        assert json.loads(payload) == {
            "version": "cortex.release-controller-observations.v1",
            "windows": {},
        }

    application_receipts = mounts["/application"] / "nexus_outcome_feedback_receipts.json"
    application_receipts.write_text('{"consumed":["jti-after-adoption"]}\n', encoding="utf-8")
    (mounts["/continuity"] / "cortex-volume-set.complete").unlink()
    rerun = _run_source_adoption(compose, mounts, identities)

    assert rerun.returncode == 0, rerun.stderr
    assert "already complete" in rerun.stdout
    assert json.loads(application_receipts.read_text(encoding="utf-8")) == {
        "consumed": ["jti-after-adoption"]
    }
    assert (mounts["/continuity"] / "cortex-volume-set.complete").is_file()


def test_interrupted_source_adoption_is_rerunnable_and_withholds_manifests(tmp_path):
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    mounts, identities = _source_adoption_fixture(tmp_path)
    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    counter = tmp_path / "sync-count"
    real_sync = shutil.which("sync")
    assert real_sync is not None
    fake_sync = fake_bin / "sync"
    fake_sync.write_text(
        textwrap.dedent(
            f"""\
            #!/bin/sh
            count=0
            if [ -f {counter} ]; then count=$(cat {counter}); fi
            count=$((count + 1))
            printf '%s\n' "$count" > {counter}
            if [ "$count" -eq 6 ]; then exit 97; fi
            exec {real_sync} "$@"
            """
        ),
        encoding="utf-8",
    )
    fake_sync.chmod(0o755)

    interrupted = _run_source_adoption(
        compose,
        mounts,
        identities,
        path=f"{fake_bin}:{os.environ['PATH']}",
    )

    assert interrupted.returncode == 97
    assert (mounts["/continuity"] / "cortex-source-adoption.journal").is_file()
    assert list(mounts["/continuity"].glob("*.volume-id")) == []
    assert not (mounts["/continuity"] / "cortex-volume-set.complete").exists()
    assert (mounts["/source-memory"] / ".cortex-durable-memory").read_text(
        encoding="utf-8"
    ).strip() == "cortex-chroma-v1"

    recovered = _run_source_adoption(compose, mounts, identities)
    assert recovered.returncode == 0, recovered.stderr
    assert len(list(mounts["/continuity"].glob("*.volume-id"))) == 7
    assert "complete" in (
        mounts["/continuity"] / "cortex-source-adoption.journal"
    ).read_text(encoding="utf-8").splitlines()


def test_source_volume_adoption_rejects_over_bound_source_before_mutation(tmp_path):
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    mounts, identities = _source_adoption_fixture(tmp_path)
    identities["CORTEX_ADOPTION_MAX_SOURCE_BYTES"] = "1"
    targets = (
        "/application",
        "/knowledge",
        "/reasoning",
        "/verifier-controller",
        "/manager-controller",
    )

    rejected = _run_source_adoption(compose, mounts, identities)

    assert rejected.returncode != 0
    assert "source size exceeds CORTEX_ADOPTION_MAX_SOURCE_BYTES" in rejected.stderr
    assert not (mounts["/continuity"] / "cortex-source-adoption.journal").exists()
    assert list(mounts["/continuity"].glob("*.volume-id")) == []
    assert all(_volume_tree(mounts[target]) == [] for target in targets)


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
