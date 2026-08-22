from pathlib import Path
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
    expired = store.session_dir / "expired.md.1"
    expired.write_text("old", encoding="utf-8")
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
