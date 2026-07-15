import json
import sqlite3

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


def test_structured_l22_memory_is_scoped_for_reads_counts_and_deletes(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "scoped.sqlite3"))
    tenant_a = {"tenant_id": "tenant-a", "workspace_id": "workspace-a"}
    tenant_b = {"tenant_id": "tenant-b", "workspace_id": "workspace-b"}

    first = l22.store_structured_memory_record(
        content="tenant a state",
        memory_type="codec_state",
        metadata={"codec_session_key": "shared-session"},
        **tenant_a,
    )
    second = l22.store_structured_memory_record(
        content="tenant b state",
        memory_type="codec_state",
        metadata={"codec_session_key": "shared-session"},
        **tenant_b,
    )

    rows_a = l22.list_structured_memory_records(
        memory_type="codec_state", lookup_key="shared-session", **tenant_a
    )
    rows_b = l22.list_structured_memory_records(
        memory_type="codec_state", lookup_key="shared-session", **tenant_b
    )
    assert [row["id"] for row in rows_a] == [first["id"]]
    assert [row["id"] for row in rows_b] == [second["id"]]
    assert l22.count_structured_memory_records(**tenant_a) == 1
    assert l22.delete_structured_memory_records([second["id"]], **tenant_a) == 0
    assert l22.delete_structured_memory_records([second["id"]], **tenant_b) == 1


def test_legacy_unscoped_structured_rows_migrate_only_to_reserved_default_scope(monkeypatch, tmp_path):
    db_path = tmp_path / "legacy.sqlite3"
    connection = sqlite3.connect(db_path)
    connection.execute(
        "CREATE TABLE structured_memory (id TEXT PRIMARY KEY, memory_type TEXT NOT NULL, "
        "lookup_key TEXT NOT NULL DEFAULT '', content TEXT NOT NULL, metadata_json TEXT NOT NULL, "
        "created_at TEXT NOT NULL)"
    )
    connection.execute(
        "INSERT INTO structured_memory VALUES (?, ?, ?, ?, ?, ?)",
        ("legacy", "codec_state", "shared", "legacy state", "{}", "2026-01-01T00:00:00Z"),
    )
    connection.commit()
    connection.close()
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(db_path))

    assert [row["id"] for row in l22.list_structured_memory_records(lookup_key="shared")] == ["legacy"]
    assert l22.list_structured_memory_records(
        lookup_key="shared", tenant_id="tenant-a", workspace_id="workspace-a"
    ) == []


def test_l22_idempotency_is_durable_scoped_and_rejects_payload_reuse(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "idempotency.sqlite3"))
    rows = {}

    class Collection:
        def get(self, ids, include):
            found = [row_id for row_id in ids if row_id in rows]
            return {"ids": found, "metadatas": [rows[row_id] for row_id in found]}

    def add_record(memory_id, _text, metadata, **_scope):
        rows[memory_id] = dict(metadata)

    monkeypatch.setattr(l22, "collection", Collection())
    monkeypatch.setattr(l22, "_add_memory_with_supersession", add_record)
    scope = {"tenant_id": "tenant-a", "workspace_id": "workspace-a"}

    first = l22.store_memory_record(
        content="one durable decision",
        idempotency_key="hook-123",
        **scope,
    )
    replay = l22.store_memory_record(
        content="one durable decision",
        idempotency_key="hook-123",
        **scope,
    )
    other_scope = l22.store_memory_record(
        content="one durable decision",
        idempotency_key="hook-123",
        tenant_id="tenant-b",
        workspace_id="workspace-b",
    )

    assert replay["id"] == first["id"]
    assert replay["idempotent_replay"] is True
    assert other_scope["id"] != first["id"]
    assert len(rows) == 2
    with pytest.raises(HTTPException) as exc_info:
        l22.store_memory_record(
            content="different decision",
            idempotency_key="hook-123",
            **scope,
        )
    assert exc_info.value.status_code == 409
