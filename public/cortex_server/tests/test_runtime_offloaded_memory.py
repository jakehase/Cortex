from pathlib import Path
import json
import os

import pytest

from cortex_server.runtime import RuntimeMemoryStore, normalize_session_event
from cortex_server.runtime.offloaded_memory import RuntimeMemoryLimitError


def test_runtime_memory_store_writes_hot_index_and_shards(tmp_path: Path):
    store = RuntimeMemoryStore(tmp_path / "memory")
    process_path = store.write_process_note(process_id="proc_123", title="Plan", note="Need to land the retry loop")
    event = normalize_session_event("proc_123", "started", tool="codex", session_id="sess_1", session_name="issue-9", summary="worker started")
    session_path = store.write_session_event(event)

    assert (tmp_path / "memory" / "MEMORY.md").exists()
    assert process_path.exists()
    assert session_path.exists()
    assert "Non-authoritative runtime notes only" in (tmp_path / "memory" / "MEMORY.md").read_text(encoding="utf-8")
    assert "authority: non-authoritative" in process_path.read_text(encoding="utf-8")
    assert "retry loop" in process_path.read_text(encoding="utf-8")
    assert "authority: non-authoritative" in session_path.read_text(encoding="utf-8")
    assert "worker started" in session_path.read_text(encoding="utf-8")


def test_runtime_memory_layout_rejects_dangling_hot_index_symlink(tmp_path: Path):
    root = tmp_path / "memory"
    root.mkdir()
    external = tmp_path / "must-not-be-created.md"
    (root / "MEMORY.md").symlink_to(external)
    store = RuntimeMemoryStore(root)

    with pytest.raises(ValueError, match="regular non-symlink"):
        store.ensure_layout()

    assert not external.exists()


def test_runtime_memory_existing_hot_index_does_not_consume_creation_quota(
    monkeypatch, tmp_path: Path
):
    store = RuntimeMemoryStore(tmp_path / "memory")
    store.ensure_layout()
    monkeypatch.setattr(
        "cortex_server.runtime.offloaded_memory.assert_runtime_delivery_volume_capacity",
        lambda *_args, **_kwargs: pytest.fail(
            "existing hot index was charged as a new allocation"
        ),
    )

    store.ensure_layout()


@pytest.mark.parametrize("session_id", ["../escape", "a/b", "..", "x" * 129])
def test_runtime_memory_store_rejects_session_path_escape(tmp_path: Path, session_id: str):
    store = RuntimeMemoryStore(tmp_path / "memory")
    event = normalize_session_event(
        "proc_123", "started", session_id=session_id, summary="unsafe id"
    )

    with pytest.raises(ValueError, match="bounded opaque identifier"):
        store.write_session_event(event)
    assert not (tmp_path / "escape.md").exists()


def test_runtime_memory_store_accepts_common_openclaw_session_key(tmp_path: Path):
    store = RuntimeMemoryStore(tmp_path / "memory")
    event = normalize_session_event(
        "proc_123",
        "started",
        session_id="agent:main:tenant-a:user-a",
        summary="compatible OpenClaw session",
    )

    path = store.write_session_event(event)

    assert path.name == "proc_123__agent:main:tenant-a:user-a.md"
    assert "compatible OpenClaw session" in path.read_text(encoding="utf-8")


def test_runtime_memory_store_rejects_oversized_event_before_partial_append(tmp_path: Path):
    store = RuntimeMemoryStore(
        tmp_path / "memory",
        max_event_bytes=240,
        max_shard_bytes=500,
        max_total_bytes=4000,
    )
    with pytest.raises(RuntimeMemoryLimitError, match="event exceeds"):
        store.write_process_note(
            process_id="proc_123", title="large", note="x" * 1000
        )

    assert not store._process_path("proc_123").exists()
    assert not store._daily_path().exists()


def test_runtime_memory_store_rotates_shards_and_prunes_expired_files(tmp_path: Path):
    store = RuntimeMemoryStore(
        tmp_path / "memory",
        max_event_bytes=500,
        max_shard_bytes=550,
        max_total_bytes=5000,
        max_rotations=1,
        retention_days=1,
    )
    store.ensure_layout()
    expired = store.session_dir / "proc_old__sess_old.md.1"
    expired.write_text(
        "## old\nauthority: non-authoritative\nold\n",
        encoding="utf-8",
    )
    expired.chmod(0o600)
    old = 1_600_000_000
    os.utime(expired, (old, old))

    for index in range(5):
        store.write_process_note(
            process_id="proc_123",
            title=f"note-{index}",
            note="bounded runtime detail " * 5,
        )

    active = store._process_path("proc_123")
    rotated = store._rotation_path(active, 1)
    assert active.stat().st_size <= store.max_shard_bytes
    assert rotated.exists()
    assert not store._rotation_path(active, 2).exists()
    assert not expired.exists()
    assert store._stored_bytes() <= store.max_total_bytes


def test_runtime_memory_store_prunes_oldest_notes_to_finite_file_cap(tmp_path: Path):
    store = RuntimeMemoryStore(
        tmp_path / "memory",
        max_event_bytes=1000,
        max_shard_bytes=2000,
        max_total_bytes=10_000,
        max_files=2,
        retention_days=30,
    )
    store.ensure_layout()
    oldest = store.session_dir / "proc_old__sess_old.md"
    newer = store.session_dir / "proc_new__sess_new.md"
    oldest.write_text(
        "## old\nauthority: non-authoritative\nold\n",
        encoding="utf-8",
    )
    newer.write_text(
        "## new\nauthority: non-authoritative\nnew\n",
        encoding="utf-8",
    )
    oldest.chmod(0o600)
    newer.chmod(0o600)
    os.utime(oldest, (1_600_000_000, 1_600_000_000))
    os.utime(newer, (1_700_000_000, 1_700_000_000))

    store.write_process_note(
        process_id="proc_123",
        title="bounded",
        note="authoritative state was already handed off",
    )

    assert not oldest.exists()
    assert not newer.exists()
    assert len(store._managed_files()) == 2
    health = store.retention_health()
    assert health["ok"] is True
    assert health["retention"]["currentFiles"] == 2
    assert health["retention"]["pruned"]["totalFiles"] == 2
    assert health["retention"]["errors"] == []


def test_runtime_memory_retention_never_deletes_unrecognized_files(tmp_path: Path):
    store = RuntimeMemoryStore(
        tmp_path / "memory",
        max_event_bytes=1000,
        max_shard_bytes=2000,
        max_total_bytes=10_000,
        max_files=3,
        retention_days=1,
    )
    store.ensure_layout()
    operator_file = store.session_dir / "operator-preserved.txt"
    operator_file.write_text("not owned by the runtime note store", encoding="utf-8")
    os.utime(operator_file, (1_600_000_000, 1_600_000_000))

    store.write_process_note(
        process_id="proc_123",
        title="bounded",
        note="authoritative state was already handed off",
    )

    assert operator_file.read_text(encoding="utf-8") == (
        "not owned by the runtime note store"
    )
    health = store.retention_health()
    assert health["ok"] is False
    assert health["retention"]["unmanagedFiles"] == 1
    assert health["retention"]["withinPolicy"] is False


def test_runtime_memory_rejected_write_does_not_prune_existing_shards(tmp_path: Path):
    store = RuntimeMemoryStore(
        tmp_path / "memory",
        max_event_bytes=500,
        max_shard_bytes=550,
        max_total_bytes=600,
        max_files=10,
        retention_days=1,
    )
    store.ensure_layout()
    prior = store.session_dir / "proc_old__sess_old.md"
    prior.write_text(
        "## old\nauthority: non-authoritative\n" + ("x" * 430),
        encoding="utf-8",
    )
    prior.chmod(0o600)
    os.utime(prior, (1_600_000_000, 1_600_000_000))

    process = store._process_path("proc_123")
    daily = store._daily_path()
    with pytest.raises(RuntimeMemoryLimitError, match="cannot satisfy"):
        with store._transaction():
            store._append_bounded(
                (
                    (process, b"authority: non-authoritative\n" + (b"y" * 370)),
                    (daily, b"authority: non-authoritative\n" + (b"z" * 370)),
                )
            )

    assert prior.exists()
    assert prior.read_text(encoding="utf-8").endswith("x" * 430)
    assert not process.exists()
    assert not daily.exists()


def test_runtime_memory_expired_shard_frees_byte_quota_before_admission(tmp_path: Path):
    store = RuntimeMemoryStore(
        tmp_path / "memory",
        max_event_bytes=500,
        max_shard_bytes=550,
        max_total_bytes=600,
        max_files=10,
        retention_days=1,
    )
    store.ensure_layout()
    expired = store.session_dir / "proc_old__sess_old.md"
    expired.write_text(
        "## old\nauthority: non-authoritative\n" + ("x" * 430),
        encoding="utf-8",
    )
    expired.chmod(0o600)
    os.utime(expired, (1_600_000_000, 1_600_000_000))

    path = store.write_process_note(
        process_id="proc_123",
        title="bounded",
        note="y" * 180,
    )

    assert not expired.exists()
    assert path.exists()
    assert store._daily_path().exists()
    assert store._stored_bytes() <= store.max_total_bytes


def test_runtime_memory_oversized_owned_shard_degrades_then_converges(tmp_path: Path):
    store = RuntimeMemoryStore(
        tmp_path / "memory",
        max_event_bytes=180,
        max_shard_bytes=200,
        max_total_bytes=1000,
        max_files=10,
        max_rotations=1,
        retention_days=30,
    )
    store.ensure_layout()
    oversized = store._process_path("proc_123")
    oversized.write_text(
        "## oversized\nauthority: non-authoritative\n" + ("x" * 300),
        encoding="utf-8",
    )
    oversized.chmod(0o600)

    before = store.retention_health()
    assert before["ok"] is False
    assert before["retention"]["managedFiles"] == 1
    assert before["retention"]["oversizedFiles"] == 1

    store.write_process_note(process_id="proc_123", title="note", note="bounded")

    assert oversized.stat().st_size <= store.max_shard_bytes
    assert not store._rotation_path(oversized, 1).exists()
    after = store.retention_health()
    assert after["ok"] is True
    assert after["retention"]["oversizedFiles"] == 0


def test_runtime_memory_refuses_unowned_pending_path_collision(tmp_path: Path):
    store = RuntimeMemoryStore(tmp_path / "memory")
    store.ensure_layout()
    collision = store._process_path("proc_123")
    collision.write_text("operator-owned content\n", encoding="utf-8")

    with pytest.raises(RuntimeMemoryLimitError, match="not owned"):
        store.write_process_note(process_id="proc_123", title="note", note="content")

    assert collision.read_text(encoding="utf-8") == "operator-owned content\n"
    assert store._is_managed_shard(collision) is False
    assert not store._daily_path().exists()


def test_runtime_memory_refuses_embedded_authority_marker_as_ownership(tmp_path: Path):
    store = RuntimeMemoryStore(tmp_path / "memory")
    store.ensure_layout()
    collision = store._process_path("proc_123")
    content = b"operator-owned\nauthority: non-authoritative\ndo not delete\n"
    collision.write_bytes(content)
    collision.chmod(0o600)

    assert store._is_managed_shard(collision) is False
    with pytest.raises(RuntimeMemoryLimitError, match="not owned"):
        store.write_process_note(process_id="proc_123", title="note", note="content")

    assert collision.read_bytes() == content


def test_runtime_memory_refuses_unowned_rotation_collision(tmp_path: Path):
    store = RuntimeMemoryStore(
        tmp_path / "memory",
        max_event_bytes=500,
        max_shard_bytes=550,
        max_total_bytes=5000,
        max_rotations=1,
        retention_days=30,
    )
    store.ensure_layout()
    current = store._process_path("proc_123")
    current.write_text(
        "## owned\nauthority: non-authoritative\n" + ("x" * 460),
        encoding="utf-8",
    )
    current.chmod(0o600)
    collision = store._rotation_path(current, 1)
    collision.write_text("operator-owned rotation\n", encoding="utf-8")

    with pytest.raises(RuntimeMemoryLimitError, match="rotation target is not owned"):
        store.write_process_note(
            process_id="proc_123", title="rotate", note="y" * 100
        )

    assert collision.read_text(encoding="utf-8") == "operator-owned rotation\n"
    assert current.exists()


def test_runtime_memory_accepts_strict_legacy_daily_shard(tmp_path: Path):
    store = RuntimeMemoryStore(tmp_path / "memory", retention_days=30)
    store.ensure_layout()
    daily = store._daily_path()
    daily.write_text("- process legacy: baseline note\n", encoding="utf-8")
    daily.chmod(0o600)

    store.write_process_note(process_id="proc_123", title="note", note="content")

    assert store._is_managed_shard(daily) is True
    assert "baseline note" in daily.read_text(encoding="utf-8")
    assert store.retention_health()["ok"] is True


def test_runtime_memory_accepts_multiline_legacy_daily_shard(tmp_path: Path):
    store = RuntimeMemoryStore(tmp_path / "memory", retention_days=30)
    store.ensure_layout()
    daily = store._daily_path()
    daily.write_text(
        "- process legacy: multiline title\n"
        "title continuation — multiline note\n"
        "note continuation\n",
        encoding="utf-8",
    )
    daily.chmod(0o600)

    store.write_process_note(process_id="proc_123", title="note", note="content")

    assert store._is_managed_shard(daily) is True
    assert "note continuation" in daily.read_text(encoding="utf-8")
    assert store.retention_health()["ok"] is True


def test_runtime_memory_refuses_hard_linked_shard_ownership(tmp_path: Path):
    store = RuntimeMemoryStore(tmp_path / "memory")
    store.ensure_layout()
    external = tmp_path / "operator-owned.md"
    external.write_text(
        "## external\nauthority: non-authoritative\ndo not change\n",
        encoding="utf-8",
    )
    collision = store._process_path("proc_123")
    os.link(external, collision)
    before = external.read_bytes()

    with pytest.raises(RuntimeMemoryLimitError, match="not owned"):
        store.write_process_note(process_id="proc_123", title="note", note="content")

    assert external.read_bytes() == before
    assert collision.read_bytes() == before
    assert external.stat().st_nlink == 2


def test_runtime_memory_health_rejects_special_files(tmp_path: Path):
    store = RuntimeMemoryStore(tmp_path / "memory")
    store.ensure_layout()
    os.mkfifo(store.session_dir / "operator-pipe")

    health = store.retention_health()

    assert health["ok"] is False
    assert health["retention"]["withinPolicy"] is False
    assert any("special entry" in error for error in health["retention"]["errors"])


def test_runtime_memory_health_rejects_symlinked_control_file(tmp_path: Path):
    store = RuntimeMemoryStore(tmp_path / "memory")
    store.ensure_layout()
    target = tmp_path / "operator-lock"
    target.write_text("not a runtime lock", encoding="utf-8")
    store._lock_path.symlink_to(target)

    health = store.retention_health()

    assert health["ok"] is False
    assert any(
        "control path is not a regular non-symlink" in error
        for error in health["retention"]["errors"]
    )


def test_runtime_memory_records_partial_prune_failure(monkeypatch, tmp_path: Path):
    store = RuntimeMemoryStore(
        tmp_path / "memory",
        max_event_bytes=1000,
        max_shard_bytes=2000,
        max_total_bytes=10_000,
        max_files=2,
        retention_days=30,
    )
    store.ensure_layout()
    first = store.session_dir / "a__session.md"
    second = store.session_dir / "b__session.md"
    for path in (first, second):
        path.write_text(
            "## retained\nauthority: non-authoritative\nnote\n",
            encoding="utf-8",
        )
        path.chmod(0o600)
    real_unlink = Path.unlink

    def fail_second(path, *args, **kwargs):
        if path == second:
            raise OSError("simulated retention unlink failure")
        return real_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_second)

    with pytest.raises(RuntimeMemoryLimitError, match="retention prune failed"):
        store.write_process_note(process_id="proc_123", title="note", note="content")

    state = json.loads(store.retention_state_path.read_text(encoding="utf-8"))
    assert state["lastPrunedFiles"] == 1
    assert state["lastPrunedBytes"] > 0
    assert any("simulated retention unlink failure" in row for row in state["errors"])
    assert first.exists() is False
    assert second.exists() is True
    assert store.retention_health()["ok"] is False


def test_runtime_memory_health_exposes_over_limit_retention_state(monkeypatch, tmp_path: Path):
    delivery_root = tmp_path / "runtime-delivery"
    store = RuntimeMemoryStore(
        delivery_root / "memory",
        max_event_bytes=1000,
        max_shard_bytes=2000,
        max_total_bytes=10_000,
        max_files=2,
        retention_days=30,
        delivery_root=delivery_root,
    )
    store.ensure_layout()
    for index in range(3):
        (store.session_dir / f"legacy-{index}.md").write_text("legacy", encoding="utf-8")

    direct = store.retention_health()
    assert direct["ok"] is False
    assert direct["fileCount"] >= 4
    assert direct["oldestModifiedAt"] is not None
    assert direct["retention"]["currentFiles"] == 3
    assert direct["retention"]["maxFiles"] == 2
    assert direct["retention"]["withinPolicy"] is False
    assert "pruned" in direct["retention"]
    assert "errors" in direct["retention"]

    monkeypatch.setenv("ORCHESTRATOR_RUNTIME_DELIVERY_ROOT", str(delivery_root))
    monkeypatch.setenv("CORTEX_RUNTIME_MEMORY_MAX_FILES", "2")
    from cortex_server.routers import knowledge

    endpoint = knowledge._runtime_offloaded_memory_health()
    assert endpoint["ok"] is False
    assert endpoint["authority"] == "non_authoritative_runtime_notes"
    assert endpoint["retention"]["currentFiles"] == 3

    monkeypatch.delenv("CORTEX_RUNTIME_MEMORY_MAX_FILES")
    probe = RuntimeMemoryStore(
        tmp_path / "audit-probe" / "memory",
        delivery_root=tmp_path / "audit-probe",
    )
    probe.ensure_layout()
    for index in range(1205):
        (probe.root / f"legacy-note-{index}.md").write_text("x", encoding="utf-8")
    probe_health = probe.retention_health()
    assert probe_health["fileCount"] == 1206
    assert probe_health["retention"]["currentFiles"] == 1205
    assert probe_health["retention"]["unmanagedFiles"] == 1205
    assert probe_health["retention"]["maxFiles"] == 1000
    assert probe_health["ok"] is False


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("CORTEX_RUNTIME_MEMORY_MAX_EVENT_BYTES", "0"),
        ("CORTEX_RUNTIME_MEMORY_MAX_EVENT_BYTES", str(64 * 1024 + 1)),
        ("CORTEX_RUNTIME_MEMORY_MAX_SHARD_BYTES", str(4 * 1024 * 1024 + 1)),
        ("CORTEX_RUNTIME_MEMORY_MAX_TOTAL_BYTES", str(64 * 1024 * 1024 + 1)),
        ("CORTEX_RUNTIME_MEMORY_MAX_FILES", "1001"),
        ("CORTEX_RUNTIME_MEMORY_MAX_ROTATIONS", "4"),
        ("CORTEX_RUNTIME_MEMORY_RETENTION_DAYS", "31"),
        ("CORTEX_RUNTIME_MEMORY_MAX_FILES", "9" * 100),
    ],
)
def test_runtime_memory_rejects_configuration_above_source_limits(
    monkeypatch, tmp_path: Path, name: str, value: str
):
    monkeypatch.setenv(name, value)

    with pytest.raises(ValueError, match="must be"):
        RuntimeMemoryStore(tmp_path / "memory")
