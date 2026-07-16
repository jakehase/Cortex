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


def test_l22_quota_serializes_workspace_and_global_durable_admission(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "quota.sqlite3"))
    monkeypatch.setenv("CORTEX_L22_WORKSPACE_RECORDS", "1")
    monkeypatch.setenv("CORTEX_L22_GLOBAL_RECORDS", "2")
    rows = {}

    class Collection:
        def get(self, ids, include):
            found = [row_id for row_id in ids if row_id in rows]
            return {"ids": found, "metadatas": [rows[row_id] for row_id in found]}

    def add_record(memory_id, _text, metadata, **_scope):
        rows[memory_id] = dict(metadata)

    monkeypatch.setattr(l22, "collection", Collection())
    monkeypatch.setattr(l22, "_add_memory_with_supersession", add_record)

    l22.store_memory_record(content="workspace a", tenant_id="tenant", workspace_id="a")
    with pytest.raises(HTTPException) as workspace_full:
        l22.store_memory_record(content="workspace a again", tenant_id="tenant", workspace_id="a")
    assert workspace_full.value.status_code == 507

    l22.store_memory_record(content="workspace b", tenant_id="tenant", workspace_id="b")
    with pytest.raises(HTTPException) as global_full:
        l22.store_memory_record(content="workspace c", tenant_id="tenant", workspace_id="c")
    assert global_full.value.status_code == 507
    assert "global record quota" in str(global_full.value.detail)


def test_l22_quota_reconciles_crash_after_chroma_publication(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "quota-recovery.sqlite3"))
    monkeypatch.setattr(l22, "_L22_QUOTA_RESERVATION_TIMEOUT_SECONDS", 0)
    rows = {}

    class Collection:
        def get(self, ids, include):
            found = [row_id for row_id in ids if row_id in rows]
            return {"ids": found, "metadatas": [rows[row_id] for row_id in found]}

    monkeypatch.setattr(l22, "collection", Collection())
    l22._reserve_memory_quota(
        memory_id="crash-published",
        tenant="tenant",
        workspace="workspace",
        credential="credential",
        charge_bytes=8192,
        payload_hash="a" * 64,
    )
    rows["crash-published"] = {"idempotency_hash": "a" * 64}
    l22._reserve_memory_quota(
        memory_id="next-write",
        tenant="tenant",
        workspace="workspace",
        credential="credential",
        charge_bytes=8192,
        payload_hash="b" * 64,
    )

    connection = l22._structured_memory_connection()
    try:
        statuses = dict(connection.execute(
            "SELECT memory_id, status FROM l22_quota_records ORDER BY memory_id"
        ).fetchall())
    finally:
        connection.close()
    assert statuses == {"crash-published": "committed", "next-write": "reserved"}


def test_l22_expired_live_writer_lease_cannot_be_reclaimed_or_fenced(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "live-lease.sqlite3"))
    monkeypatch.setenv("CORTEX_L22_WORKSPACE_RECORDS", "1")
    clock = {"now": 0.0}
    writer = {
        "identity": {
            "token": "writer-a",
            "pid": 101,
            "start_ticks": "1001",
            "boot_id": "boot-a",
        }
    }
    monkeypatch.setattr(l22.time, "time", lambda: clock["now"])
    monkeypatch.setattr(l22, "_quota_writer_identity", lambda: dict(writer["identity"]))
    monkeypatch.setattr(l22, "_quota_owner_proven_dead", lambda _row: False)
    monkeypatch.setattr(
        l22.collection,
        "get",
        lambda **_kwargs: {"ids": [], "metadatas": []},
    )

    assert l22._reserve_memory_quota(
        memory_id="writer-a-memory",
        tenant="tenant",
        workspace="workspace",
        credential="credential",
        charge_bytes=60,
        payload_hash="a" * 64,
    ) == "new"
    clock["now"] = l22._L22_QUOTA_RESERVATION_TIMEOUT_SECONDS + 1
    writer["identity"] = {
        "token": "writer-b",
        "pid": 202,
        "start_ticks": "2002",
        "boot_id": "boot-a",
    }

    with pytest.raises(HTTPException) as full:
        l22._reserve_memory_quota(
            memory_id="writer-b-memory",
            tenant="tenant",
            workspace="workspace",
            credential="credential",
            charge_bytes=60,
            payload_hash="b" * 64,
        )
    assert full.value.status_code == 507
    with pytest.raises(HTTPException, match="fenced"):
        l22._fence_memory_quota("writer-a-memory", "a" * 64)
    with pytest.raises(HTTPException, match="fenced"):
        l22._finalize_memory_quota("writer-a-memory")

    connection = l22._structured_memory_connection()
    try:
        row = connection.execute(
            "SELECT status, owner_token FROM l22_quota_records WHERE memory_id = ?",
            ("writer-a-memory",),
        ).fetchone()
    finally:
        connection.close()
    assert (row["status"], row["owner_token"]) == ("reserved", "writer-a")


def test_l22_reclaims_only_an_expired_kernel_proven_dead_owner(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "dead-lease.sqlite3"))
    monkeypatch.setenv("CORTEX_L22_WORKSPACE_RECORDS", "1")
    clock = {"now": 0.0}
    writer = {
        "identity": {
            "token": "writer-a",
            "pid": 101,
            "start_ticks": "1001",
            "boot_id": "boot-a",
        }
    }
    monkeypatch.setattr(l22.time, "time", lambda: clock["now"])
    monkeypatch.setattr(l22, "_quota_writer_identity", lambda: dict(writer["identity"]))
    monkeypatch.setattr(l22, "_quota_owner_proven_dead", lambda _row: True)
    monkeypatch.setattr(
        l22.collection,
        "get",
        lambda **_kwargs: {"ids": [], "metadatas": []},
    )
    l22._reserve_memory_quota(
        memory_id="dead-writer-memory",
        tenant="tenant",
        workspace="workspace",
        credential="credential",
        charge_bytes=60,
        payload_hash="a" * 64,
    )
    clock["now"] = l22._L22_QUOTA_RESERVATION_TIMEOUT_SECONDS + 1
    writer["identity"] = {
        "token": "writer-b",
        "pid": 202,
        "start_ticks": "2002",
        "boot_id": "boot-a",
    }

    assert l22._reserve_memory_quota(
        memory_id="replacement-memory",
        tenant="tenant",
        workspace="workspace",
        credential="credential",
        charge_bytes=60,
        payload_hash="b" * 64,
    ) == "new"


def test_l22_preallocates_physical_recovery_capacity(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "quota.sqlite3"))
    monkeypatch.setenv("CORTEX_L22_PREALLOCATE_RECOVERY_RESERVE", "true")
    monkeypatch.setenv("CORTEX_L22_RECOVERY_RESERVE_BYTES", "16384")

    connection = l22._structured_memory_connection()
    connection.close()
    reserve = tmp_path / l22._L22_PHYSICAL_RESERVE_FILE
    assert reserve.stat().st_size == 16384
    assert reserve.stat().st_blocks * 512 >= 16384
    expected_usage = sum(
        path.stat().st_size
        for path in tmp_path.rglob("*")
        if path.is_file() and path.name != l22._L22_PHYSICAL_RESERVE_FILE
    )
    assert l22._l22_volume_usage() == expected_usage


def test_l22_retains_charge_when_publish_raises_after_durable_add(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "partial.sqlite3"))
    rows = {}

    class Collection:
        def get(self, ids, include):
            found = [row_id for row_id in ids if row_id in rows]
            return {"ids": found, "metadatas": [rows[row_id] for row_id in found]}

    def add_then_fail(memory_id, _text, metadata, **_scope):
        rows[memory_id] = dict(metadata)
        raise RuntimeError("response lost after durable Chroma add")

    monkeypatch.setattr(l22, "collection", Collection())
    monkeypatch.setattr(l22, "_add_memory_with_supersession", add_then_fail)
    with pytest.raises(RuntimeError, match="response lost"):
        l22.store_memory_record(content="durably added before failure")

    connection = l22._structured_memory_connection()
    try:
        record = connection.execute(
            "SELECT memory_id, status FROM l22_quota_records"
        ).fetchone()
    finally:
        connection.close()
    assert record["memory_id"] in rows
    assert record["status"] == "committed"


def test_l22_backfills_preexisting_chroma_and_structured_rows_once(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "backfill.sqlite3"))
    connection = l22._structured_memory_connection()
    connection.execute(
        "INSERT INTO structured_memory(id, tenant_id, workspace_id, memory_type, lookup_key, "
        "content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "legacy-structured",
            "tenant-a",
            "workspace-a",
            "codec",
            "",
            "structured content",
            json.dumps({"scope_credential_id": "credential-a"}),
            "2026-01-01T00:00:00Z",
        ),
    )
    connection.commit()
    connection.close()

    class Collection:
        def get(self, *, limit, offset, include):
            if offset:
                return {"ids": [], "metadatas": [], "documents": []}
            return {
                "ids": ["legacy-chroma"],
                "metadatas": [
                    {
                        "tenant_id": "tenant-b",
                        "storage_workspace_id": "workspace-b",
                        "scope_credential_id": "credential-b",
                    }
                ],
                "documents": ["chroma content"],
            }

    monkeypatch.setattr(l22, "collection", Collection())
    l22._backfill_l22_quota_ledger()
    l22._backfill_l22_quota_ledger()

    connection = l22._structured_memory_connection()
    try:
        records = connection.execute(
            "SELECT memory_id, status FROM l22_quota_records ORDER BY memory_id"
        ).fetchall()
        global_usage = connection.execute(
            "SELECT record_count FROM l22_quota_usage WHERE scope_type = 'global' AND scope_id = '*'"
        ).fetchone()[0]
    finally:
        connection.close()
    assert [(row["memory_id"], row["status"]) for row in records] == [
        ("legacy-chroma", "committed"),
        ("legacy-structured", "committed"),
    ]
    assert global_usage == 2
