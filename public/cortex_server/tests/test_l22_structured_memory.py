import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import os
import sqlite3
import threading
import time
from types import SimpleNamespace
import uuid

import pytest
from fastapi import HTTPException

# Router import constructs its persistence client, so keep collection-time state
# inside the writable test sandbox rather than an operator path.
os.environ.setdefault("CORTEX_CHROMA_DIR", "/tmp/cortex-l22-structured-tests-chroma")

from cortex_server.routers import l22, librarian
from cortex_server.modules.bounded_health_probe import SingleFlightHealthProbe


class _OperationCollection:
    """Small Chroma-shaped store for durable-operation interleaving tests."""

    def __init__(self):
        self.rows = {}
        self.add_calls = 0

    @staticmethod
    def _matches(metadata, where):
        if not where:
            return True
        if "$and" in where:
            return all(_OperationCollection._matches(metadata, item) for item in where["$and"])
        return all(
            metadata.get(key) == (value.get("$eq") if isinstance(value, dict) else value)
            for key, value in where.items()
        )

    def add(self, *, ids, documents, metadatas):
        self.add_calls += 1
        for memory_id, document, metadata in zip(ids, documents, metadatas):
            self.rows[str(memory_id)] = {
                "document": str(document),
                "metadata": dict(metadata),
            }

    def get(
        self,
        *,
        ids=None,
        where=None,
        where_document=None,
        limit=None,
        offset=0,
        include=None,
        **_kwargs,
    ):
        selected = list(ids) if ids is not None else sorted(self.rows)
        selected = [
            memory_id
            for memory_id in selected
            if memory_id in self.rows
            and self._matches(self.rows[memory_id]["metadata"], where)
            and (
                not where_document
                or str(where_document.get("$contains") or "")
                in self.rows[memory_id]["document"]
            )
        ]
        selected = selected[max(0, int(offset or 0)) :]
        if limit is not None:
            selected = selected[: max(0, int(limit))]
        return {
            "ids": selected,
            "documents": [self.rows[memory_id]["document"] for memory_id in selected],
            "metadatas": [self.rows[memory_id]["metadata"] for memory_id in selected],
        }

    def update(self, *, ids, metadatas):
        for memory_id, metadata in zip(ids, metadatas):
            self.rows[str(memory_id)]["metadata"] = dict(metadata)

    def delete(self, *, ids):
        for memory_id in ids:
            self.rows.pop(str(memory_id), None)


def _configure_operation_stores(monkeypatch, tmp_path):
    monkeypatch.setenv(
        "CORTEX_L22_STRUCTURED_DB", str(tmp_path / "l22-structured.sqlite3")
    )
    monkeypatch.setenv(
        "CORTEX_L22_MEMORY_OPERATION_DB", str(tmp_path / "l22-operations.sqlite3")
    )
    monkeypatch.setenv(
        "CORTEX_FACT_SUPERSESSION_JOURNAL_DIR", str(tmp_path / "fact-journal")
    )
    monkeypatch.setenv(
        "CORTEX_FACT_SUPERSESSION_LOCK_PATH", str(tmp_path / "fact.lock")
    )
    monkeypatch.setattr(librarian, "_FALLBACK_LOG_PATH", tmp_path / "fallback.jsonl")
    collection = _OperationCollection()
    monkeypatch.setattr(l22, "collection", collection)
    monkeypatch.setattr(librarian, "collection", collection)
    return collection


def _operation_principal(name="owner"):
    return SimpleNamespace(
        tenant_id="tenant-operations",
        storage_workspace_id=f"workspace-{name}",
        memory_principal_key=f"principal:{name}",
        credential_id=f"credential-{name}",
    )


def _operation_id(principal, key):
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"cortex:l22:{principal.tenant_id}:"
            f"{principal.storage_workspace_id}:{key}",
        )
    )


@pytest.mark.asyncio
async def test_agg_f059_l22_status_is_off_loop_and_bounds_both_stores(monkeypatch):
    principal = SimpleNamespace(
        memory_principal_key="l22-health-principal",
        codec_session_key="l22-health-codec-session",
        tenant_id="tenant-health",
        storage_workspace_id="workspace-health",
    )
    collection_calls = []
    structured_calls = []
    worker_threads = []

    class RecordingCollection:
        def get(self, **kwargs):
            worker_threads.append(threading.current_thread().name)
            collection_calls.append(kwargs)
            return {
                "metadatas": [
                    {"memory_principal_key": principal.memory_principal_key}
                    for _ in range(3)
                ]
            }

    def structured_records(**kwargs):
        structured_calls.append(kwargs)
        return [{"id": "one"}, {"id": "two"}]

    monkeypatch.setattr(l22, "collection", RecordingCollection())
    monkeypatch.setattr(l22, "list_structured_memory_records", structured_records)
    monkeypatch.setattr(l22, "memory_principal_for_request", lambda _request: principal)
    monkeypatch.setattr(l22, "_memory_scope_auth_ready", lambda: True)
    monkeypatch.setattr(l22, "_L22_HEALTH_PRINCIPAL_SCAN_MAX_ROWS", 2)
    monkeypatch.setattr(l22, "_L22_HEALTH_STRUCTURED_MAX_ROWS", 3)
    monkeypatch.setattr(
        l22,
        "_L22_STATUS_PROBE",
        SingleFlightHealthProbe("l22-status-bounds-test"),
    )

    result = await l22.l22_status(object())

    assert result["success"] is True, (
        result,
        collection_calls,
        structured_calls,
        worker_threads,
    )
    assert result["memory_count"] == 2
    assert result["memory_count_is_lower_bound"] is True
    assert result["memory_scan_limit"] == 2
    assert result["structured_memory_count"] == 2
    assert result["structured_memory_scan_limit"] == 3
    assert collection_calls[0]["limit"] == 3
    assert structured_calls[0]["limit"] == 3
    assert len(worker_threads) == 1
    assert worker_threads[0].startswith("cortex-health-probe")


@pytest.mark.asyncio
async def test_agg_f059_l22_status_timeout_remains_single_flight(monkeypatch):
    principal = SimpleNamespace(memory_principal_key="l22-slow-principal")
    release = threading.Event()
    calls = []

    def slow_payload(_principal):
        calls.append(threading.current_thread().name)
        release.wait(timeout=0.25)
        return {"success": True, "status": "active"}

    monkeypatch.setattr(l22, "memory_principal_for_request", lambda _request: principal)
    monkeypatch.setattr(l22, "_l22_status_payload", slow_payload)
    monkeypatch.setattr(l22, "_memory_scope_auth_ready", lambda: True)
    monkeypatch.setattr(
        l22,
        "_L22_STATUS_PROBE",
        SingleFlightHealthProbe("l22-status-timeout-test"),
    )
    monkeypatch.setenv("CORTEX_HEALTH_PROBE_TIMEOUT_SECONDS", "0.03")

    started = time.perf_counter()
    first = await l22.l22_status(object())
    second = await l22.l22_status(object())
    elapsed = time.perf_counter() - started
    release.set()
    await asyncio.sleep(0.03)

    assert first["probe_status"] == "timeout"
    assert second["probe_status"] == "timeout"
    assert elapsed < 0.15
    assert len(calls) == 1
    assert calls[0].startswith("cortex-health-probe")


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


def test_semantic_l22_rejects_byte_amplification_before_hash_or_publish(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "bounded.sqlite3"))
    monkeypatch.setenv("CORTEX_L22_MAX_CONTENT_BYTES", "8")
    monkeypatch.setattr(
        l22,
        "sha256",
        lambda *_args, **_kwargs: pytest.fail("rejected request reached hashing"),
    )
    monkeypatch.setattr(
        l22,
        "_add_memory_with_supersession",
        lambda *_args, **_kwargs: pytest.fail("rejected request reached publication"),
    )

    with pytest.raises(HTTPException) as content_error:
        l22.store_memory_record(content="x" * 9)
    assert content_error.value.status_code == 413

    with pytest.raises(HTTPException) as metadata_error:
        l22.store_memory_record(content="ok", metadata={"value": "x" * 20_000})
    assert metadata_error.value.status_code == 422

    with pytest.raises(HTTPException) as key_error:
        l22.store_memory_record(content="ok", idempotency_key="é" * 129)
    assert key_error.value.status_code == 422


def test_l22_idempotency_ledger_prunes_scoped_count_bytes_and_age_with_replay_fallback(
    monkeypatch, tmp_path
):
    db_path = tmp_path / "idempotency-retention.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(db_path))
    monkeypatch.setenv("CORTEX_L22_IDEMPOTENCY_MAX_RECORDS", "2")
    rows = {}
    published = []

    class Collection:
        def get(self, ids, include):
            found = [row_id for row_id in ids if row_id in rows]
            return {"ids": found, "metadatas": [rows[row_id] for row_id in found]}

    def add_record(memory_id, _text, metadata, **_scope):
        published.append(memory_id)
        rows[memory_id] = dict(metadata)

    monkeypatch.setattr(l22, "collection", Collection())
    monkeypatch.setattr(l22, "_add_memory_with_supersession", add_record)
    scope = {"tenant_id": "tenant-a", "workspace_id": "workspace-a"}

    results = [
        l22.store_memory_record(
            content=f"decision {index}",
            idempotency_key=f"key-{index}",
            **scope,
        )
        for index in range(3)
    ]
    l22.store_memory_record(
        content="other workspace",
        idempotency_key="other-key",
        tenant_id="tenant-a",
        workspace_id="workspace-b",
    )

    connection = l22._structured_memory_connection()
    try:
        retained_a = connection.execute(
            "SELECT idempotency_key FROM memory_idempotency "
            "WHERE tenant_id = ? AND workspace_id = ? ORDER BY idempotency_key",
            ("tenant-a", "workspace-a"),
        ).fetchall()
        retained_b = connection.execute(
            "SELECT idempotency_key FROM memory_idempotency "
            "WHERE tenant_id = ? AND workspace_id = ?",
            ("tenant-a", "workspace-b"),
        ).fetchall()
    finally:
        connection.close()

    assert [row[0] for row in retained_a] == ["key-1", "key-2"]
    assert [row[0] for row in retained_b] == ["other-key"]

    replay = l22.store_memory_record(
        content="decision 0",
        idempotency_key="key-0",
        **scope,
    )
    assert replay["id"] == results[0]["id"]
    assert replay["idempotent_replay"] is True
    assert published.count(results[0]["id"]) == 1

    connection = l22._structured_memory_connection()
    try:
        connection.execute(
            "UPDATE memory_idempotency SET created_at = '2000-01-01T00:00:00+00:00' "
            "WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ?",
            ("tenant-a", "workspace-a", "key-2"),
        )
        connection.commit()
    finally:
        connection.close()

    monkeypatch.setenv("CORTEX_L22_IDEMPOTENCY_TTL_SECONDS", "1")
    assert l22._prune_memory_idempotency_ledger() >= 1

    monkeypatch.setenv("CORTEX_L22_IDEMPOTENCY_MAX_RECORDS", "10")
    monkeypatch.setenv("CORTEX_L22_IDEMPOTENCY_MAX_BYTES", "1")
    l22._prune_memory_idempotency_ledger()
    connection = l22._structured_memory_connection()
    try:
        assert connection.execute("SELECT COUNT(*) FROM memory_idempotency").fetchone()[0] == 0
    finally:
        connection.close()

    monkeypatch.setenv(
        "CORTEX_L22_IDEMPOTENCY_MAX_BYTES", str(l22._L22_IDEMPOTENCY_MAX_BYTES)
    )
    restart_replay = l22.store_memory_record(
        content="decision 0",
        idempotency_key="key-0",
        **scope,
    )
    assert restart_replay["id"] == results[0]["id"]
    assert restart_replay["idempotent_replay"] is True
    assert published.count(results[0]["id"]) == 1
    with pytest.raises(HTTPException) as conflict:
        l22.store_memory_record(
            content="changed decision",
            idempotency_key="key-0",
            **scope,
        )
    assert conflict.value.status_code == 409

    monkeypatch.setenv(
        "CORTEX_L22_IDEMPOTENCY_MAX_BYTES", str(l22._L22_IDEMPOTENCY_MAX_BYTES)
    )
    connection = l22._structured_memory_connection()
    try:
        connection.execute(
            "INSERT INTO memory_idempotency VALUES (?, ?, ?, ?, ?, ?)",
            (
                "legacy-tenant",
                "legacy-workspace",
                "legacy-key",
                "f" * 64,
                json.dumps({"id": "non-deterministic-legacy-id"}),
                "2000-01-01T00:00:00+00:00",
            ),
        )
        connection.commit()
    finally:
        connection.close()
    with pytest.raises(RuntimeError, match="require migration"):
        l22._prune_memory_idempotency_ledger()
    connection = l22._structured_memory_connection()
    try:
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_idempotency WHERE tenant_id = ?",
            ("legacy-tenant",),
        ).fetchone()[0] == 1
    finally:
        connection.close()


def test_l22_idempotency_write_fails_closed_when_active_row_cannot_fit(
    monkeypatch, tmp_path
):
    monkeypatch.setenv(
        "CORTEX_L22_STRUCTURED_DB", str(tmp_path / "idempotency-too-small.sqlite3")
    )
    monkeypatch.setenv("CORTEX_L22_IDEMPOTENCY_MAX_BYTES", "1")
    durable_rows = {}

    class Collection:
        def get(self, ids, include):
            found = [row_id for row_id in ids if row_id in durable_rows]
            return {
                "ids": found,
                "metadatas": [durable_rows[row_id] for row_id in found],
            }

    def add_record(memory_id, _text, metadata, **_scope):
        durable_rows[memory_id] = dict(metadata)

    monkeypatch.setattr(l22, "collection", Collection())
    monkeypatch.setattr(l22, "_add_memory_with_supersession", add_record)

    with pytest.raises(RuntimeError, match="cannot retain the active replay row"):
        l22.store_memory_record(
            content="bounded decision",
            idempotency_key="active-key",
            tenant_id="tenant-a",
            workspace_id="workspace-a",
        )

    connection = l22._structured_memory_connection()
    try:
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_idempotency"
        ).fetchone()[0] == 0
    finally:
        connection.close()


def test_l22_idempotency_retention_refuses_eviction_without_durable_fallback(
    monkeypatch, tmp_path
):
    db_path = tmp_path / "idempotency-missing-fallback.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(db_path))
    monkeypatch.setenv("CORTEX_L22_IDEMPOTENCY_MAX_RECORDS", "2")
    rows = {}
    published = []

    class Collection:
        def get(self, ids, include):
            found = [row_id for row_id in ids if row_id in rows]
            return {
                "ids": found,
                "metadatas": [rows[row_id] for row_id in found],
            }

    def add_record(memory_id, _text, metadata, **_scope):
        published.append(memory_id)
        rows[memory_id] = dict(metadata)

    monkeypatch.setattr(l22, "collection", Collection())
    monkeypatch.setattr(l22, "_add_memory_with_supersession", add_record)
    scope = {"tenant_id": "tenant-a", "workspace_id": "workspace-a"}
    first = l22.store_memory_record(
        content="original decision",
        idempotency_key="key-0",
        **scope,
    )
    l22.store_memory_record(
        content="newer decision",
        idempotency_key="key-1",
        **scope,
    )
    rows.pop(first["id"])
    monkeypatch.setenv("CORTEX_L22_IDEMPOTENCY_MAX_RECORDS", "1")

    with pytest.raises(RuntimeError, match="durable replay fallback"):
        l22._prune_memory_idempotency_ledger()

    connection = l22._structured_memory_connection()
    try:
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_idempotency"
        ).fetchone()[0] == 2
    finally:
        connection.close()
    with pytest.raises(HTTPException) as missing_physical_replay:
        l22.store_memory_record(
            content="original decision",
            idempotency_key="key-0",
            **scope,
        )
    assert missing_physical_replay.value.status_code == 503
    assert "operation authority unavailable" in str(
        missing_physical_replay.value.detail
    )
    with pytest.raises(HTTPException) as conflict:
        l22.store_memory_record(
            content="changed decision",
            idempotency_key="key-0",
            **scope,
        )
    assert conflict.value.status_code == 409
    assert published.count(first["id"]) == 1

    # A fresh operation reaches the bounded replay cache. The missing physical
    # fallback for key-0 must still make pruning fail atomically: the permanent
    # operation authority is not a substitute for the stored replay result.
    published_before = list(published)
    with pytest.raises(RuntimeError, match="durable replay fallback"):
        l22.store_memory_record(
            content="third decision",
            idempotency_key="key-2",
            **scope,
        )
    assert published == published_before
    connection = l22._structured_memory_connection()
    try:
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_idempotency"
        ).fetchone()[0] == 2
    finally:
        connection.close()
    assert published.count(first["id"]) == 1


def test_l22_cancel_before_store_is_scoped_durable_and_replay_idempotent(
    monkeypatch, tmp_path
):
    collection = _configure_operation_stores(monkeypatch, tmp_path)
    owner = _operation_principal()
    selected_principal = {"value": owner}
    monkeypatch.setattr(
        l22,
        "_route_memory_principal",
        lambda _request, _http_request: selected_principal["value"],
    )
    key = "delete-before-arrival"
    expected_id = _operation_id(owner, key)
    request = l22.L22StoreOperationRequest(
        idempotency_key=key,
        expected_id=expected_id,
        fact_key="owner-file:synthetic:0",
        operation_generation=1,
    )

    unknown = asyncio.run(l22.l22_store_status(request))
    assert unknown == {
        "known": False,
        "status": "unknown",
        "id": expected_id,
        "operation_generation": 1,
        "visibility_fenced": False,
        "projection_status": "unknown",
    }
    cancelled = asyncio.run(l22.l22_cancel_store(request))
    assert cancelled["status"] == "cancelled"
    assert cancelled["visibility_fenced"] is True
    assert cancelled["projection_status"] == "complete"
    markers_before = [
        row
        for row in librarian._quota_fallback_rows()
        if row.get("kind") == "id_supersession"
    ]
    assert len(markers_before) == 1
    assert markers_before[0]["memory_principal_key"] == owner.memory_principal_key

    repeated = asyncio.run(l22.l22_cancel_store(request))
    assert repeated["projection_status"] == "complete"
    assert len([
        row
        for row in librarian._quota_fallback_rows()
        if row.get("kind") == "id_supersession"
    ]) == 1

    with pytest.raises(HTTPException) as late_store:
        l22.store_memory_record(
            content="late deleted source payload",
            metadata={
                "fact_key": "owner-file:synthetic:0",
                "memory_principal_key": owner.memory_principal_key,
            },
            tenant_id=owner.tenant_id,
            workspace_id=owner.storage_workspace_id,
            idempotency_key=key,
            operation_generation=1,
        )
    assert late_store.value.status_code == 409
    assert collection.rows == {}

    foreign = _operation_principal("foreign")
    selected_principal["value"] = foreign
    with pytest.raises(HTTPException) as guessed_owner_operation:
        asyncio.run(l22.l22_store_status(request))
    assert guessed_owner_operation.value.status_code == 403
    foreign_request = l22.L22StoreOperationRequest(
        idempotency_key=key,
        expected_id=_operation_id(foreign, key),
        fact_key="owner-file:synthetic:0",
        operation_generation=1,
    )
    assert asyncio.run(l22.l22_store_status(foreign_request))["status"] == "unknown"
    selected_principal["value"] = owner
    assert asyncio.run(l22.l22_store_status(request))["status"] == "cancelled"


def test_l22_inflight_publication_serializes_cancel_then_retires_both_stores(
    monkeypatch, tmp_path
):
    collection = _configure_operation_stores(monkeypatch, tmp_path)
    principal = _operation_principal()
    monkeypatch.setattr(
        l22,
        "_route_memory_principal",
        lambda _request, _http_request: principal,
    )
    publication_started = threading.Event()
    release_publication = threading.Event()
    cancel_attempted = threading.Event()

    def blocked_publish(memory_id, text, metadata, **_scope):
        publication_started.set()
        if not release_publication.wait(timeout=5):
            pytest.fail("synthetic publication was never released")
        collection.add(ids=[memory_id], documents=[text], metadatas=[metadata])

    original_cancel = l22._cancel_memory_store_operation

    def observed_cancel(identity, *, reason):
        cancel_attempted.set()
        return original_cancel(identity, reason=reason)

    monkeypatch.setattr(l22, "_add_memory_with_supersession", blocked_publish)
    monkeypatch.setattr(l22, "_cancel_memory_store_operation", observed_cancel)
    key = "inflight-cancel-race"
    fact_key = "owner-file:inflight:0"
    expected_id = _operation_id(principal, key)
    store_kwargs = {
        "content": "inflight synthetic fact",
        "metadata": {
            "fact_key": fact_key,
            "memory_principal_key": principal.memory_principal_key,
        },
        "tenant_id": principal.tenant_id,
        "workspace_id": principal.storage_workspace_id,
        "idempotency_key": key,
        "operation_generation": 1,
    }
    request = l22.L22StoreOperationRequest(
        idempotency_key=key,
        expected_id=expected_id,
        fact_key=fact_key,
        operation_generation=1,
    )

    with ThreadPoolExecutor(max_workers=2) as executor:
        store_future = executor.submit(l22.store_memory_record, **store_kwargs)
        assert publication_started.wait(timeout=2)
        pending = asyncio.run(l22.l22_store_status(request))
        assert pending["status"] == "prepared"
        assert pending["visibility_fenced"] is False
        assert expected_id not in collection.rows

        cancel_future = executor.submit(
            lambda: asyncio.run(l22.l22_cancel_store(request))
        )
        assert cancel_attempted.wait(timeout=2)
        assert cancel_future.done() is False
        release_publication.set()
        stored = store_future.result(timeout=5)
        cancelled = cancel_future.result(timeout=5)

    assert stored["id"] == expected_id
    assert cancelled["status"] == "cancelled"
    assert cancelled["projection_status"] == "complete"
    assert collection.add_calls == 1
    assert collection.rows[expected_id]["metadata"]["memory_status"] == "superseded"
    assert librarian._memory_visible_for_query(
        "", collection.rows[expected_id]["metadata"]
    ) is False
    assert asyncio.run(l22.l22_store_status(request))["status"] == "cancelled"


def test_l22_timeout_unknown_row_is_hidden_then_exact_replay_commits_once(
    monkeypatch, tmp_path
):
    collection = _configure_operation_stores(monkeypatch, tmp_path)
    principal = _operation_principal()
    monkeypatch.setattr(
        l22,
        "_route_memory_principal",
        lambda _request, _http_request: principal,
    )
    key = "response-timeout"
    expected_id = _operation_id(principal, key)
    publication_calls = []

    def publish_then_timeout(memory_id, text, metadata, **_scope):
        publication_calls.append(memory_id)
        collection.add(ids=[memory_id], documents=[text], metadatas=[metadata])
        raise TimeoutError("synthetic response timeout after durable publication")

    monkeypatch.setattr(l22, "_add_memory_with_supersession", publish_then_timeout)
    store_kwargs = {
        "content": "timeout unknown durable fact",
        "metadata": {
            "fact_key": "owner-file:timeout:0",
            "memory_principal_key": principal.memory_principal_key,
        },
        "tenant_id": principal.tenant_id,
        "workspace_id": principal.storage_workspace_id,
        "idempotency_key": key,
        "operation_generation": 1,
    }
    with pytest.raises(TimeoutError, match="response timeout"):
        l22.store_memory_record(**store_kwargs)

    request = l22.L22StoreOperationRequest(
        idempotency_key=key,
        expected_id=expected_id,
        fact_key="owner-file:timeout:0",
        operation_generation=1,
    )
    pending = asyncio.run(l22.l22_store_status(request))
    assert pending["status"] == "prepared"
    assert pending["visibility_fenced"] is False
    assert pending["projection_status"] == "not_required"
    assert librarian._memory_visible_for_query(
        "", collection.rows[expected_id]["metadata"]
    ) is False

    replay = l22.store_memory_record(**store_kwargs)
    assert replay["id"] == expected_id
    assert replay["idempotent_replay"] is True
    assert publication_calls == [expected_id]
    committed = asyncio.run(l22.l22_store_status(request))
    assert committed["status"] == "committed"
    assert committed["visibility_fenced"] is True
    assert committed["projection_status"] == "not_required"
    assert librarian._memory_visible_for_query(
        "", collection.rows[expected_id]["metadata"]
    ) is True


def test_l22_process_death_replay_adopts_prior_writer_quota_without_duplicate(
    monkeypatch, tmp_path
):
    collection = _configure_operation_stores(monkeypatch, tmp_path)
    principal = _operation_principal()
    writer = {
        "value": {
            "token": "writer-before-crash",
            "pid": 101,
            "start_ticks": "1001",
            "boot_id": "boot-test",
        }
    }
    monkeypatch.setattr(l22, "_quota_writer_identity", lambda: dict(writer["value"]))

    class ProcessDeath(BaseException):
        pass

    key = "process-death-after-publication"
    expected_id = _operation_id(principal, key)
    first_call = {"value": True}

    def publish_then_die(memory_id, text, metadata, **_scope):
        collection.add(ids=[memory_id], documents=[text], metadatas=[metadata])
        if first_call["value"]:
            first_call["value"] = False
            raise ProcessDeath("synthetic process death")

    monkeypatch.setattr(l22, "_add_memory_with_supersession", publish_then_die)
    store_kwargs = {
        "content": "crash replay durable fact",
        "metadata": {
            "fact_key": "owner-file:crash:0",
            "memory_principal_key": principal.memory_principal_key,
        },
        "tenant_id": principal.tenant_id,
        "workspace_id": principal.storage_workspace_id,
        "idempotency_key": key,
        "operation_generation": 1,
    }
    with pytest.raises(ProcessDeath):
        l22.store_memory_record(**store_kwargs)
    connection = l22._structured_memory_connection()
    try:
        assert connection.execute(
            "SELECT status FROM l22_quota_records WHERE memory_id = ?",
            (expected_id,),
        ).fetchone()[0] == "reserved"
    finally:
        connection.close()

    writer["value"] = {
        "token": "writer-after-restart",
        "pid": 202,
        "start_ticks": "2002",
        "boot_id": "boot-test",
    }
    replay = l22.store_memory_record(**store_kwargs)
    assert replay["id"] == expected_id
    assert replay["idempotent_replay"] is True
    assert collection.add_calls == 1
    connection = l22._structured_memory_connection()
    try:
        assert connection.execute(
            "SELECT status FROM l22_quota_records WHERE memory_id = ?",
            (expected_id,),
        ).fetchone()[0] == "committed"
    finally:
        connection.close()


def test_l22_process_death_after_replay_cache_commit_recovers_prepared_operation(
    monkeypatch, tmp_path
):
    collection = _configure_operation_stores(monkeypatch, tmp_path)
    principal = _operation_principal()

    def publish(memory_id, text, metadata, **_scope):
        collection.add(ids=[memory_id], documents=[text], metadatas=[metadata])

    class ProcessDeath(BaseException):
        pass

    original_finalize = l22._finalize_memory_quota
    die_once = {"value": True}

    def finalize_then_die(memory_id, *, require_owner=True):
        if die_once["value"]:
            die_once["value"] = False
            raise ProcessDeath("synthetic death after replay cache commit")
        return original_finalize(memory_id, require_owner=require_owner)

    monkeypatch.setattr(l22, "_add_memory_with_supersession", publish)
    monkeypatch.setattr(l22, "_finalize_memory_quota", finalize_then_die)
    key = "death-after-replay-cache"
    expected_id = _operation_id(principal, key)
    store_kwargs = {
        "content": "cache committed before process death",
        "metadata": {
            "fact_key": "owner-file:cache-crash:0",
            "memory_principal_key": principal.memory_principal_key,
        },
        "tenant_id": principal.tenant_id,
        "workspace_id": principal.storage_workspace_id,
        "idempotency_key": key,
        "operation_generation": 1,
    }
    with pytest.raises(ProcessDeath):
        l22.store_memory_record(**store_kwargs)

    identity = l22._memory_store_operation_identity(
        tenant=principal.tenant_id,
        workspace=principal.storage_workspace_id,
        memory_principal_key=principal.memory_principal_key,
        idempotency_key=key,
        memory_id=expected_id,
        request_hash=l22.prepare_memory_store_request(**store_kwargs)["request_hash"],
        fact_key="owner-file:cache-crash:0",
        generation=1,
    )
    assert l22._get_memory_store_operation(identity)["status"] == "prepared"
    connection = l22._structured_memory_connection()
    try:
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_idempotency WHERE idempotency_key = ?",
            (key,),
        ).fetchone()[0] == 1
    finally:
        connection.close()

    replay = l22.store_memory_record(**store_kwargs)
    assert replay["id"] == expected_id
    assert replay["idempotent_replay"] is True
    assert collection.add_calls == 1
    assert l22._get_memory_store_operation(identity)["status"] == "committed"


@pytest.mark.parametrize(
    "failure_point",
    ["before_quota_admission", "before_fallback_tombstone", "before_journal_cleanup"],
)
def test_l22_cancelled_cross_store_retirement_replays_every_crash_edge_and_new_generation(
    monkeypatch, tmp_path, failure_point
):
    collection = _configure_operation_stores(monkeypatch, tmp_path)
    principal = _operation_principal()

    def publish(memory_id, text, metadata, **_scope):
        collection.add(ids=[memory_id], documents=[text], metadatas=[metadata])

    monkeypatch.setattr(l22, "_add_memory_with_supersession", publish)
    old_key = "generation-one"
    fact_key = "owner-file:generation:0"
    stored = l22.store_memory_record(
        content="generation one content",
        metadata={
            "fact_key": fact_key,
            "memory_principal_key": principal.memory_principal_key,
        },
        tenant_id=principal.tenant_id,
        workspace_id=principal.storage_workspace_id,
        idempotency_key=old_key,
        operation_generation=1,
    )
    librarian._persist_fallback_memory(
        stored["id"],
        "generation one content",
        stored["metadata"],
        reason="synthetic mirrored fallback",
        mode="test",
    )
    identity = l22._memory_store_operation_identity(
        tenant=principal.tenant_id,
        workspace=principal.storage_workspace_id,
        memory_principal_key=principal.memory_principal_key,
        idempotency_key=old_key,
        memory_id=stored["id"],
        fact_key=fact_key,
        generation=1,
    )
    cancellation = l22._cancel_memory_store_operation(
        identity, reason="owner_source_deleted_or_revoked"
    )
    assert cancellation["status"] == "cancelled"
    assert cancellation["projection_status"] == "pending"
    assert librarian._memory_visible_for_query("", stored["metadata"]) is False

    if failure_point == "before_quota_admission":
        original = librarian._recover_retirement_journal_with_quota_locked

        def fail_once(*_args, **_kwargs):
            raise RuntimeError("crash before quota admission")

        monkeypatch.setattr(
            librarian, "_recover_retirement_journal_with_quota_locked", fail_once
        )
    elif failure_point == "before_fallback_tombstone":
        original = librarian._append_fallback_id_tombstone

        def fail_once(*_args, **_kwargs):
            raise RuntimeError("crash before fallback tombstone")

        monkeypatch.setattr(librarian, "_append_fallback_id_tombstone", fail_once)
    else:
        original = librarian._remove_fact_supersession_journal

        def fail_once(*_args, **_kwargs):
            raise RuntimeError("crash before journal cleanup")

        monkeypatch.setattr(librarian, "_remove_fact_supersession_journal", fail_once)

    with pytest.raises(Exception, match="memory retirement|crash before"):
        l22._project_cancelled_memory_store_operation(
            identity,
            reason="owner_source_deleted_or_revoked",
            credential_id=principal.credential_id,
        )
    journal_dir = tmp_path / "fact-journal"
    assert len(list(journal_dir.glob("*.json"))) == 1
    operation = l22._get_memory_store_operation(identity)
    assert operation["status"] == "cancelled"
    assert operation["projection_status"] == "pending"
    assert librarian._memory_visible_for_query(
        "", collection.rows[stored["id"]]["metadata"]
    ) is False

    if failure_point == "before_quota_admission":
        monkeypatch.setattr(
            librarian, "_recover_retirement_journal_with_quota_locked", original
        )
    elif failure_point == "before_fallback_tombstone":
        monkeypatch.setattr(librarian, "_append_fallback_id_tombstone", original)
    else:
        monkeypatch.setattr(librarian, "_remove_fact_supersession_journal", original)

    completed = l22._project_cancelled_memory_store_operation(
        identity,
        reason="owner_source_deleted_or_revoked",
        credential_id=principal.credential_id,
    )
    assert completed["projection_status"] == "complete"
    assert list(journal_dir.glob("*.json")) == []
    assert collection.rows[stored["id"]]["metadata"]["memory_status"] == "superseded"
    assert librarian._read_fallback_rows(
        tenant_id=principal.tenant_id,
        workspace_id=principal.storage_workspace_id,
        memory_principal_key=principal.memory_principal_key,
    ) == []
    historical = librarian._read_fallback_rows(
        tenant_id=principal.tenant_id,
        workspace_id=principal.storage_workspace_id,
        memory_principal_key=principal.memory_principal_key,
        include_historical=True,
    )
    assert [row["id"] for row in historical] == [stored["id"]]
    assert historical[0]["metadata"]["memory_status"] == "superseded"
    connection = l22._structured_memory_connection()
    try:
        assert connection.execute(
            "SELECT COUNT(*) FROM structured_memory "
            "WHERE memory_type = 'quota_side_effect'"
        ).fetchone()[0] == 1
    finally:
        connection.close()

    new_key = "generation-two"
    replacement = l22.store_memory_record(
        content="generation one content",
        metadata={
            "fact_key": fact_key,
            "memory_principal_key": principal.memory_principal_key,
        },
        tenant_id=principal.tenant_id,
        workspace_id=principal.storage_workspace_id,
        idempotency_key=new_key,
        operation_generation=2,
    )
    assert replacement["id"] != stored["id"]
    assert librarian._memory_visible_for_query("", replacement["metadata"]) is True
    assert l22._get_memory_store_operation(identity)["status"] == "cancelled"


def test_l22_cancelled_generation_cache_evicts_without_reopening_replay(
    monkeypatch, tmp_path
):
    collection = _configure_operation_stores(monkeypatch, tmp_path)
    monkeypatch.setenv("CORTEX_L22_IDEMPOTENCY_MAX_RECORDS", "1")
    principal = _operation_principal()
    monkeypatch.setattr(
        l22,
        "_route_memory_principal",
        lambda _request, _http_request: principal,
    )

    def publish(memory_id, text, metadata, **_scope):
        collection.add(ids=[memory_id], documents=[text], metadatas=[metadata])

    monkeypatch.setattr(l22, "_add_memory_with_supersession", publish)
    fact_key = "owner-file:bounded-generation:0"
    first_key = "bounded-generation-one"
    first = l22.store_memory_record(
        content="bounded generation content",
        metadata={
            "fact_key": fact_key,
            "memory_principal_key": principal.memory_principal_key,
        },
        tenant_id=principal.tenant_id,
        workspace_id=principal.storage_workspace_id,
        idempotency_key=first_key,
        operation_generation=1,
    )
    cancel_request = l22.L22StoreOperationRequest(
        idempotency_key=first_key,
        expected_id=first["id"],
        fact_key=fact_key,
        operation_generation=1,
    )
    cancelled = asyncio.run(l22.l22_cancel_store(cancel_request))
    assert cancelled["status"] == "cancelled"
    assert cancelled["projection_status"] == "complete"

    second_key = "bounded-generation-two"
    second = l22.store_memory_record(
        content="bounded generation content",
        metadata={
            "fact_key": fact_key,
            "memory_principal_key": principal.memory_principal_key,
        },
        tenant_id=principal.tenant_id,
        workspace_id=principal.storage_workspace_id,
        idempotency_key=second_key,
        operation_generation=2,
    )
    assert second["id"] != first["id"]
    assert librarian._memory_visible_for_query("", second["metadata"]) is True
    connection = l22._structured_memory_connection()
    try:
        assert [
            row[0]
            for row in connection.execute(
                "SELECT idempotency_key FROM memory_idempotency"
            ).fetchall()
        ] == [second_key]
    finally:
        connection.close()

    with pytest.raises(HTTPException) as cancelled_replay:
        l22.store_memory_record(
            content="bounded generation content",
            metadata={
                "fact_key": fact_key,
                "memory_principal_key": principal.memory_principal_key,
            },
            tenant_id=principal.tenant_id,
            workspace_id=principal.storage_workspace_id,
            idempotency_key=first_key,
            operation_generation=1,
        )
    assert cancelled_replay.value.status_code == 409
    assert "durably cancelled" in str(cancelled_replay.value.detail)


def test_l22_retention_rejects_wrong_principal_operation_contract_atomically(
    monkeypatch, tmp_path
):
    collection = _configure_operation_stores(monkeypatch, tmp_path)
    monkeypatch.setenv("CORTEX_L22_IDEMPOTENCY_MAX_RECORDS", "2")
    principal = _operation_principal()

    def publish(memory_id, text, metadata, **_scope):
        collection.add(ids=[memory_id], documents=[text], metadatas=[metadata])

    monkeypatch.setattr(l22, "_add_memory_with_supersession", publish)
    stored = [
        l22.store_memory_record(
            content=f"principal-bound decision {index}",
            metadata={"memory_principal_key": principal.memory_principal_key},
            tenant_id=principal.tenant_id,
            workspace_id=principal.storage_workspace_id,
            idempotency_key=f"principal-key-{index}",
        )
        for index in range(2)
    ]
    collection.rows[stored[0]["id"]]["metadata"]["memory_principal_key"] = (
        "principal:foreign"
    )
    monkeypatch.setenv("CORTEX_L22_IDEMPOTENCY_MAX_RECORDS", "1")

    with pytest.raises(RuntimeError, match="durable replay fallback"):
        l22._prune_memory_idempotency_ledger()
    connection = l22._structured_memory_connection()
    try:
        assert connection.execute(
            "SELECT COUNT(*) FROM memory_idempotency"
        ).fetchone()[0] == 2
    finally:
        connection.close()


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


def test_authenticated_librarian_endpoints_share_l22_workspace_admission(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("CORTEX_L22_WORKSPACE_RECORDS", "1")
    monkeypatch.setattr(librarian, "_FALLBACK_LOG_PATH", tmp_path / "fallback.jsonl")

    class Collection:
        def __init__(self):
            self.rows = {}

        def add(self, *, ids, documents, metadatas):
            self.rows[ids[0]] = {
                "document": documents[0],
                "metadata": dict(metadatas[0]),
            }

        def get(self, *, ids=None, include=None, **_kwargs):
            requested = list(ids or [])
            found = [memory_id for memory_id in requested if memory_id in self.rows]
            return {
                "ids": found,
                "metadatas": [self.rows[memory_id]["metadata"] for memory_id in found],
            }

    collection = Collection()
    monkeypatch.setattr(librarian, "collection", collection)
    monkeypatch.setattr(l22, "collection", collection)

    primary_db = tmp_path / "primary.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(primary_db))
    stored = asyncio.run(librarian.embed_memory(librarian.EmbedRequest(text="primary")))
    assert stored.status == "stored"
    with pytest.raises(HTTPException, match="workspace record quota"):
        asyncio.run(librarian.embed_memory(librarian.EmbedRequest(text="overflow")))

    monkeypatch.setattr(
        librarian,
        "_build_novel_metadata",
        lambda **kwargs: {
            **dict(kwargs.get("metadata") or {}),
            "novelty_score": 1.0,
            "novelty_bucket": "high",
            "novelty_fingerprint": "novel-fingerprint",
        },
    )
    novel_db = tmp_path / "novel.sqlite3"
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(novel_db))
    novel = asyncio.run(
        librarian.embed_memory_novel(librarian.NovelEmbedRequest(text="novel"))
    )
    assert novel.status == "stored"
    with pytest.raises(HTTPException, match="workspace record quota"):
        asyncio.run(
            librarian.embed_memory_novel(
                librarian.NovelEmbedRequest(text="novel overflow")
            )
        )

    for db_path in (primary_db, novel_db):
        connection = sqlite3.connect(db_path)
        try:
            row = connection.execute(
                "SELECT status, tenant_id, credential_id FROM l22_quota_records"
            ).fetchone()
        finally:
            connection.close()
        assert row == ("committed", librarian.DEFAULT_TENANT_ID, "local-development")


def test_concurrent_librarian_writers_cannot_overbook_aggregate_quota(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "concurrent.sqlite3"))
    monkeypatch.setenv("CORTEX_L22_WORKSPACE_RECORDS", "1")
    monkeypatch.setattr(librarian, "_FALLBACK_LOG_PATH", tmp_path / "fallback.jsonl")
    entered = threading.Event()
    release = threading.Event()

    class BlockingCollection:
        def __init__(self):
            self.rows = {}

        def add(self, *, ids, documents, metadatas):
            entered.set()
            if not release.wait(timeout=5):
                raise RuntimeError("test publication was not released")
            self.rows[ids[0]] = dict(metadatas[0])

        def get(self, *, ids=None, include=None, **_kwargs):
            found = [memory_id for memory_id in list(ids or []) if memory_id in self.rows]
            return {"ids": found, "metadatas": [self.rows[memory_id] for memory_id in found]}

    collection = BlockingCollection()
    monkeypatch.setattr(librarian, "collection", collection)
    monkeypatch.setattr(l22, "collection", collection)

    def write(text):
        return asyncio.run(librarian.embed_memory(librarian.EmbedRequest(text=text)))

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(write, "first")
        assert entered.wait(timeout=5)
        second = executor.submit(write, "second")
        with pytest.raises(HTTPException, match="workspace record quota"):
            second.result(timeout=5)
        release.set()
        assert first.result(timeout=5).status == "stored"

    connection = l22._structured_memory_connection()
    try:
        usage = connection.execute(
            "SELECT record_count FROM l22_quota_usage "
            "WHERE scope_type = 'global' AND scope_id = '*'"
        ).fetchone()[0]
    finally:
        connection.close()
    assert usage == 1


def test_librarian_fallback_and_supersession_publications_remain_charged(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "fallback.sqlite3"))
    monkeypatch.setattr(librarian, "_FALLBACK_LOG_PATH", tmp_path / "fallback.jsonl")

    class DownCollection:
        def add(self, **_kwargs):
            raise RuntimeError("embedding unavailable")

        def get(self, *, ids=None, include=None, **_kwargs):
            return {"ids": [], "metadatas": []}

    down = DownCollection()
    monkeypatch.setattr(librarian, "collection", down)
    monkeypatch.setattr(l22, "collection", down)
    fallback = asyncio.run(
        librarian.embed_memory(librarian.EmbedRequest(text="fallback durable"))
    )
    assert fallback.status == "stored_fallback_lexical"

    connection = l22._structured_memory_connection()
    try:
        fallback_status = connection.execute(
            "SELECT status FROM l22_quota_records WHERE memory_id = ?",
            (fallback.id,),
        ).fetchone()[0]
    finally:
        connection.close()
    assert fallback_status == "committed"

    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "supersession.sqlite3"))
    monkeypatch.setenv(
        "CORTEX_FACT_SUPERSESSION_JOURNAL_DIR",
        str(tmp_path / "fact-journal"),
    )

    class FactCollection:
        def __init__(self):
            self.rows = {}

        def add(self, *, ids, documents, metadatas):
            self.rows[ids[0]] = {
                "document": documents[0],
                "metadata": dict(metadatas[0]),
            }

        def get(self, *, ids=None, where=None, include=None, **_kwargs):
            if ids is not None:
                selected = [memory_id for memory_id in ids if memory_id in self.rows]
            else:
                selected = [
                    memory_id
                    for memory_id, row in self.rows.items()
                    if all(row["metadata"].get(key) == value for key, value in (where or {}).items())
                ]
            return {
                "ids": selected,
                "documents": [self.rows[memory_id]["document"] for memory_id in selected],
                "metadatas": [self.rows[memory_id]["metadata"] for memory_id in selected],
            }

        def update(self, *, ids, metadatas):
            for memory_id, metadata in zip(ids, metadatas):
                self.rows[memory_id]["metadata"] = dict(metadata)

        def delete(self, *, ids):
            for memory_id in ids:
                self.rows.pop(memory_id, None)

    facts = FactCollection()
    monkeypatch.setattr(librarian, "collection", facts)
    monkeypatch.setattr(l22, "collection", facts)
    first = asyncio.run(
        librarian.embed_memory(
            librarian.EmbedRequest(text="old fact", metadata={"fact_key": "color"})
        )
    )
    second = asyncio.run(
        librarian.embed_memory(
            librarian.EmbedRequest(text="new fact", metadata={"fact_key": "color"})
        )
    )
    assert facts.rows[first.id]["metadata"]["memory_status"] == "superseded"
    assert facts.rows[second.id]["metadata"]["memory_status"] == "active"

    connection = l22._structured_memory_connection()
    try:
        charged = connection.execute(
            "SELECT COUNT(*) FROM l22_quota_records WHERE status = 'committed'"
        ).fetchone()[0]
        side_effects = connection.execute(
            "SELECT COUNT(*) FROM structured_memory WHERE memory_type = 'quota_side_effect'"
        ).fetchone()[0]
    finally:
        connection.close()
    assert charged == 3
    assert side_effects == 1


def test_v1_complete_restart_reconciles_librarian_rows_then_stops(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "restart.sqlite3"))
    monkeypatch.setattr(l22, "_quota_fallback_rows", lambda: [])
    connection = l22._structured_memory_connection()
    connection.execute(
        "INSERT INTO l22_quota_state(key, value) VALUES ('legacy_backfill', 'v1-complete')"
    )
    connection.commit()
    connection.close()
    scans = []

    class Collection:
        def get(self, *, limit, offset, include):
            scans.append(offset)
            return {
                "ids": ["post-v1-librarian"],
                "metadatas": [{
                    "tenant_id": "tenant",
                    "storage_workspace_id": "workspace",
                    "scope_credential_id": "credential",
                }],
                "documents": ["unaccounted librarian row"],
            }

    monkeypatch.setattr(l22, "collection", Collection())
    l22._backfill_l22_quota_ledger()
    l22._backfill_l22_quota_ledger()
    assert scans == [0]

    connection = l22._structured_memory_connection()
    try:
        state = connection.execute(
            "SELECT value FROM l22_quota_state WHERE key = 'legacy_backfill'"
        ).fetchone()[0]
        record = connection.execute(
            "SELECT status FROM l22_quota_records WHERE memory_id = 'post-v1-librarian'"
        ).fetchone()[0]
    finally:
        connection.close()
    assert state == l22._L22_QUOTA_BACKFILL_VERSION
    assert record == "committed"


def test_restart_reconciliation_finalizes_uncertain_fallback_publication(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "uncertain.sqlite3"))
    monkeypatch.setattr(librarian, "_FALLBACK_LOG_PATH", tmp_path / "fallback.jsonl")
    monkeypatch.setattr(l22, "_L22_QUOTA_RESERVATION_TIMEOUT_SECONDS", 0)

    class EmptyCollection:
        def get(self, **_kwargs):
            return {"ids": [], "metadatas": []}

    monkeypatch.setattr(l22, "collection", EmptyCollection())
    l22._reserve_memory_quota(
        memory_id="uncertain-fallback",
        tenant=librarian.DEFAULT_TENANT_ID,
        workspace=librarian.DEFAULT_WORKSPACE_ID,
        credential="local-development",
        charge_bytes=8192,
        payload_hash="a" * 64,
    )
    librarian._persist_fallback_memory(
        "uncertain-fallback",
        "durable fallback before restart",
        {"scope_credential_id": "local-development"},
        reason="response lost",
        mode="embed",
    )

    l22._reconcile_l22_quota_reservations()
    connection = l22._structured_memory_connection()
    try:
        status = connection.execute(
            "SELECT status FROM l22_quota_records WHERE memory_id = 'uncertain-fallback'"
        ).fetchone()[0]
    finally:
        connection.close()
    assert status == "committed"
