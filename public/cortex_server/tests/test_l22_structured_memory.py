import concurrent.futures
import json
import sqlite3
import uuid

import pytest
from fastapi import HTTPException

from cortex_server.routers import l22


def test_structured_l22_memory_round_trip_and_delete(monkeypatch, tmp_path):
    db_path = tmp_path / "l22-structured.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(db_path))

    first = l22.store_structured_memory_record(
        content=json.dumps({"summary": "first state"}),
        memory_type="codec_state",
        tags=["codec_state"],
        metadata={
            "codec_session_key": "session-a",
            "codec_generated_at": "2026-07-09T20:00:00+00:00",
            "codec_fingerprint": "fp-a",
        },
    )
    l22.store_structured_memory_record(
        content=json.dumps({"summary": "other state"}),
        memory_type="codec_state",
        metadata={
            "codec_session_key": "session-b",
            "codec_generated_at": "2026-07-09T20:01:00+00:00",
            "codec_fingerprint": "fp-b",
        },
    )

    rows = l22.list_structured_memory_records(memory_type="codec_state", lookup_key="session-a", limit=10)
    assert len(rows) == 1
    assert rows[0]["id"] == first["id"]
    assert rows[0]["metadata"]["codec_fingerprint"] == "fp-a"
    assert rows[0]["metadata"]["persistence_backend"] == "l22_structured_sqlite_v1"
    assert l22.count_structured_memory_records() == 2

    assert l22.delete_structured_memory_records([first["id"]]) == 1
    assert l22.list_structured_memory_records(memory_type="codec_state", lookup_key="session-a", limit=10) == []


def test_structured_l22_rejects_oversized_codec_state(monkeypatch, tmp_path):
    db_path = tmp_path / "l22-structured-size-guard.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(db_path))
    monkeypatch.setattr(l22, "_CODEC_MAX_CONTENT_BYTES", 1024)

    with pytest.raises(HTTPException) as exc:
        l22.store_structured_memory_record(
            content=json.dumps({"rollup_state": "x" * 2048}),
            memory_type="codec_state",
            metadata={"codec_session_key": "oversized-session"},
        )

    assert exc.value.status_code == 413
    assert not db_path.exists()


def test_structured_connection_initializes_once_under_concurrency(monkeypatch, tmp_path):
    db_path = tmp_path / "concurrent.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(db_path))
    l22._STRUCTURED_DB_INITIALIZED_PATHS.discard(str(db_path.resolve()))

    def connect_and_close(_index):
        connection = l22._structured_memory_connection()
        connection.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(connect_and_close, range(32)))

    with sqlite3.connect(db_path) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "structured_memory" in tables


def test_structured_connection_reinitializes_recreated_database(monkeypatch, tmp_path):
    db_path = tmp_path / "recreated.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(db_path))
    first = l22._structured_memory_connection()
    first.close()
    db_path.unlink()

    second = l22._structured_memory_connection()
    second.close()
    with sqlite3.connect(db_path) as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "structured_memory" in tables


def test_physical_usage_counts_active_files_but_excludes_recovery_artifacts(monkeypatch, tmp_path):
    db_path = tmp_path / "l22_structured.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(db_path))
    db_path.write_bytes(b"a" * 10)
    (tmp_path / "l22_structured.sqlite3-wal").write_bytes(b"b" * 11)
    (tmp_path / "chroma.sqlite3").write_bytes(b"c" * 12)
    segment = tmp_path / str(uuid.uuid4())
    segment.mkdir()
    (segment / "data_level0.bin").write_bytes(b"d" * 13)
    (tmp_path / "l22_structured.sqlite3.quarantine-incident").write_bytes(b"q" * 1000)
    (tmp_path / "l22_structured.sqlite3.superseded-compaction").write_bytes(b"s" * 1000)
    (tmp_path / ".l22-physical-recovery-reserve").write_bytes(b"r" * 1000)

    assert l22._l22_active_physical_usage() == 46


def test_physical_quota_rejects_before_database_initialization(monkeypatch, tmp_path):
    db_path = tmp_path / "quota.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(db_path))
    monkeypatch.setattr(l22, "_MAX_PHYSICAL_BYTES", 1)

    with pytest.raises(HTTPException) as exc:
        l22.store_structured_memory_record(
            content="bounded fact",
            memory_type="codec_state",
            metadata={"codec_session_key": "quota-session"},
        )
    assert exc.value.status_code == 507
    assert not db_path.exists()


def test_codec_records_are_bounded_by_session_and_snapshot_caps(monkeypatch, tmp_path):
    db_path = tmp_path / "bounded.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(db_path))
    monkeypatch.setattr(l22, "_MAX_PHYSICAL_BYTES", 100 * 1024 * 1024)
    monkeypatch.setattr(l22, "_CODEC_MAX_SESSIONS", 3)
    monkeypatch.setattr(l22, "_CODEC_MAX_SNAPSHOTS_PER_SESSION", 2)

    for session in range(6):
        for revision in range(4):
            l22.store_structured_memory_record(
                content=json.dumps({"session": session, "revision": revision}),
                memory_type="codec_state",
                metadata={
                    "codec_session_key": f"session-{session}",
                    "codec_generated_at": f"2026-07-22T20:{session:02d}:{revision:02d}+00:00",
                },
            )

    rows = l22.list_structured_memory_records(memory_type="codec_state", limit=100)
    assert len(rows) == 6
    assert {row["lookup_key"] for row in rows} == {"session-3", "session-4", "session-5"}
    assert all(sum(row["lookup_key"] == key for row in rows) == 2 for key in {"session-3", "session-4", "session-5"})


def test_recovery_reserve_is_fully_allocated(monkeypatch, tmp_path):
    reserve = tmp_path / "reserve.bin"
    monkeypatch.setenv("CORTEX_L22_RECOVERY_RESERVE_FILE", str(reserve))
    monkeypatch.setattr(l22, "_PREALLOCATE_RECOVERY_RESERVE", True)
    monkeypatch.setattr(l22, "_RECOVERY_RESERVE_BYTES", 2 * 1024 * 1024)

    l22._preallocate_recovery_reserve()

    assert reserve.stat().st_size == 2 * 1024 * 1024
    assert reserve.stat().st_blocks * 512 >= 2 * 1024 * 1024
