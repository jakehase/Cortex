"""Stage 2/3 of the temporal memory contract port (cortex.memory.temporal.v1).

Explicit supersession with history, authority, uncertainty and lineage;
graph validation; the same-fact guard; v1 writes that name
``temporal.supersedes``; scoped lineage verification; and Codec temporal
lineage. Adapted from the q9 ``test_temporal_memory_contract.py`` to the live
APIs, keeping the live roll-forward recovery design and the live automatic
same-fact_key retirement of ordinary writes.
"""
from __future__ import annotations

import json
from hashlib import sha256
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from cortex_server.modules import cortex_codec
from cortex_server.routers import l22, librarian
from cortex_server.runtime import temporal_contract
from cortex_server.runtime.memory_governance import (
    MemoryGovernanceStore,
    MemorySearchFilters,
    temporal_visibility,
)


TENANT = "tenant-temporal-stage2"
WORKSPACE = "workspace-temporal-stage2"
PRINCIPAL_A = "principal:" + "a" * 64
PRINCIPAL_B = "principal:" + "b" * 64
MARKER = "synthetic stage2 marker"
V1 = "cortex.memory.temporal.v1"
LEGACY_RETIREMENT_KEYS = {
    "version", "operation", "transaction_id", "memory_ids", "superseded_by",
    "reason", "created_at", "tenant_id", "workspace_id", "memory_principal_key",
    "quota_transaction_id", "quota_charge_bytes", "quota_payload_hash",
    "quota_credential_id",
}


class SimulatedProcessCrash(BaseException):
    pass


def _compare(stored, operator, expected):
    if stored is None:
        return False
    try:
        if operator == "$lte":
            return stored <= expected
        if operator == "$gte":
            return stored >= expected
        if operator == "$lt":
            return stored < expected
        if operator == "$gt":
            return stored > expected
    except TypeError:
        return False
    if operator == "$eq":
        return stored == expected
    if operator == "$ne":
        return stored != expected
    if operator == "$in":
        return stored in expected
    if operator == "$nin":
        return stored not in expected
    raise AssertionError(f"unsupported operator {operator}")


class MemoryCollection:
    """Chroma-shaped fake implementing the where operators the server emits."""

    def __init__(self, rows=None):
        self.rows = {}
        self.get_calls = []
        for row in rows or []:
            self.rows[str(row["id"])] = {
                "document": str(row.get("text") or ""),
                "metadata": dict(row.get("metadata") or {}),
            }

    @classmethod
    def _matches(cls, metadata, where):
        if not where:
            return True
        for key, value in where.items():
            if key == "$and":
                if not all(cls._matches(metadata, item) for item in value):
                    return False
            elif key == "$or":
                if not any(cls._matches(metadata, item) for item in value):
                    return False
            elif isinstance(value, dict):
                if not all(_compare(metadata.get(key), op, arg) for op, arg in value.items()):
                    return False
            elif metadata.get(key) != value:
                return False
        return True

    def get(self, *, ids=None, where=None, where_document=None, include=None, limit=None, offset=None, **_kwargs):
        self.get_calls.append({"ids": list(ids) if ids is not None else None, "where": where})
        requested = set(str(value) for value in ids) if ids is not None else None
        selected = []
        for memory_id, row in self.rows.items():
            if requested is not None and memory_id not in requested:
                continue
            if not self._matches(row["metadata"], where):
                continue
            contains = (where_document or {}).get("$contains") if isinstance(where_document, dict) else None
            if contains and str(contains) not in row["document"]:
                continue
            selected.append((memory_id, row))
        selected = selected[max(0, int(offset or 0)):]
        if limit is not None:
            selected = selected[: int(limit)]
        return {
            "ids": [memory_id for memory_id, _ in selected],
            "documents": [row["document"] for _, row in selected],
            "metadatas": [dict(row["metadata"]) for _, row in selected],
        }

    def query(self, *, where=None, n_results=5, **_kwargs):
        selected = [
            (memory_id, row)
            for memory_id, row in self.rows.items()
            if self._matches(row["metadata"], where)
        ][: int(n_results)]
        return {
            "ids": [[memory_id for memory_id, _ in selected]],
            "documents": [[row["document"] for _, row in selected]],
            "metadatas": [[dict(row["metadata"]) for _, row in selected]],
            "distances": [[0.05 + (index * 0.01) for index, _ in enumerate(selected)]],
        }

    def add(self, *, ids, documents, metadatas, **_kwargs):
        for memory_id, document, metadata in zip(ids, documents, metadatas):
            if memory_id in self.rows:
                raise RuntimeError("duplicate id")
            self.rows[str(memory_id)] = {"document": str(document), "metadata": dict(metadata)}

    def update(self, *, ids, metadatas, **_kwargs):
        for memory_id, metadata in zip(ids, metadatas):
            self.rows[str(memory_id)]["metadata"] = dict(metadata)

    def delete(self, *, ids, **_kwargs):
        for memory_id in ids:
            self.rows.pop(str(memory_id), None)

    def count(self):
        return len(self.rows)


@pytest.fixture(autouse=True)
def _isolated_temporal_memory_state(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_MEMORY_GOVERNANCE_DB", str(tmp_path / "memory_governance.sqlite3"))
    monkeypatch.setenv("CORTEX_FACT_SUPERSESSION_JOURNAL_DIR", str(tmp_path / "fact-journal"))
    monkeypatch.setenv("CORTEX_FACT_SUPERSESSION_LOCK_PATH", str(tmp_path / "fact.lock"))
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "l22-structured.sqlite3"))
    monkeypatch.setenv("CORTEX_L22_MEMORY_OPERATION_DB", str(tmp_path / "l22-operations.sqlite3"))
    empty_root = tmp_path / "empty-local-memory"
    empty_root.mkdir()
    monkeypatch.setenv(librarian._LOCAL_FILE_MEMORY_ROOTS_ENV, str(empty_root))
    monkeypatch.setattr(librarian, "_FALLBACK_LOG_PATH", tmp_path / "fallback.jsonl")


def install(monkeypatch, collection):
    monkeypatch.setattr(librarian, "collection", collection)
    monkeypatch.setattr(l22, "collection", collection)


def governed_row(
    memory_id,
    text,
    *,
    temporal=None,
    ingested_at=None,
    principal=PRINCIPAL_A,
    extra=None,
    tenant=TENANT,
    workspace=WORKSPACE,
):
    """Build a row exactly as the governed write path would store it."""

    metadata = {"memory_principal_key": principal, **(extra or {})}
    if temporal is not None:
        metadata = temporal_contract.apply_temporal_memory_contract(metadata, temporal, stamp=False)
        metadata = temporal_contract.stamp_temporal_ingestion(metadata, ingested_at=ingested_at)
    normalized = librarian._normalize_memory_metadata(metadata, tenant_id=tenant, workspace_id=workspace)
    governed = librarian.prepare_governed_memory_write(
        principal_key=principal, content=text, metadata=normalized
    )
    return {"id": memory_id, "text": text, "metadata": governed}


def state_row(memory_id, valid_from, *, fact_key="synthetic.fact", principal=PRINCIPAL_A, authority=80, extra=None):
    return governed_row(
        memory_id,
        MARKER,
        temporal={"kind": "state", "valid_from": valid_from, "source_authority": authority},
        ingested_at=valid_from,
        principal=principal,
        extra={**({"fact_key": fact_key} if fact_key else {}), **(extra or {})},
    )


def search(**filters):
    return librarian.robust_search(
        MARKER,
        n_results=10,
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
        memory_principal_key=PRINCIPAL_A,
        filters=MemorySearchFilters.from_mapping(filters) if filters else None,
    )


def journal_entries():
    journal_dir = librarian._fact_supersession_journal_dir()
    if not journal_dir.exists():
        return []
    return [
        librarian._read_fact_supersession_journal(path)
        for path in sorted(journal_dir.glob("*.json"))
    ]


def crash_on_update(monkeypatch, collection, call_number):
    original = collection.update
    calls = {"count": 0}

    def update(**kwargs):
        calls["count"] += 1
        if calls["count"] == call_number:
            raise SimulatedProcessCrash()
        return original(**kwargs)

    monkeypatch.setattr(collection, "update", update)
    return original


def _principal_stub():
    return SimpleNamespace(
        tenant_id=TENANT,
        storage_workspace_id=WORKSPACE,
        memory_principal_key=PRINCIPAL_A,
        credential_id="credential-temporal-stage2",
    )


LINEAGE = [{"source_id": "synthetic-source", "evidence_id": "evidence-9", "version_id": "v9", "source_available": True}]


# ---------------------------------------------------------------------------
# Explicit supersession: history, authority, uncertainty, lineage
# ---------------------------------------------------------------------------


def test_explicit_supersession_keeps_history_authority_uncertainty_and_lineage(monkeypatch):
    collection = MemoryCollection([
        state_row("old", "2026-01-01T00:00:00Z", authority=60),
        state_row("new", "2026-02-01T00:00:00Z", authority=90),
    ])
    install(monkeypatch, collection)

    result = librarian.supersede_memory_records(
        ["old"],
        superseded_by="new",
        reason="authoritative_correction",
        valid_to="2026-02-01T00:00:00+00:00",
        source_authority=95,
        uncertainty=0.02,
        source_lineage=LINEAGE,
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
        memory_principal_key=PRINCIPAL_A,
    )

    assert result["updated"] == 1 and result["ids"] == ["old"]
    assert result["supersession_graph"] == {
        "replacement": "new",
        "supersedes": ["old"],
        "cycle_checked": True,
        "valid_to": "2026-02-01T00:00:00.000Z",
    }
    old = collection.rows["old"]["metadata"]
    assert old["memory_status"] == "superseded"
    assert old["superseded_by"] == "new"
    assert old["valid_to"] == "2026-02-01T00:00:00.000Z"  # explicit business-time end
    assert old["valid_until"] == "2026-02-01T00:00:00Z"
    assert old["superseded_at"] != old["valid_to"]  # lifecycle stays wall-clock
    assert old["supersession_reason"] == "authoritative_correction"
    assert old["temporal_schema_version"] == V1
    replacement = collection.rows["new"]["metadata"]
    assert json.loads(replacement["supersedes_json"]) == ["old"]
    assert replacement["supersession_source_authority"] == 95
    assert replacement["supersession_uncertainty"] == 0.02
    assert json.loads(replacement["supersession_lineage_json"])[0]["evidence_id"] == "evidence-9"
    assert replacement["supersession_recorded_at"]
    assert replacement["source_authority"] == 90  # the row's own authority is untouched
    assert replacement["memory_status"] == "active"
    assert journal_entries() == []

    # History is retained: the prior value answers an as_of inside its window.
    january = search(as_of="2026-01-15T00:00:00Z")
    february = search(as_of="2026-02-15T00:00:00Z")
    assert [row["id"] for row in january["results"]] == ["old"]
    assert [row["id"] for row in february["results"]] == ["new"]
    assert [row["id"] for row in search()["results"]] == ["new"]

    # Re-applying the same explicit request is idempotent for the links.
    librarian.supersede_memory_records(
        ["old"],
        superseded_by="new",
        valid_to="2026-02-01T00:00:00Z",
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
        memory_principal_key=PRINCIPAL_A,
    )
    assert json.loads(collection.rows["new"]["metadata"]["supersedes_json"]) == ["old"]


def test_explicit_supersession_journal_rolls_forward_idempotently_after_crash(monkeypatch):
    collection = MemoryCollection([
        state_row("old", "2026-01-01T00:00:00Z"),
        state_row("new", "2026-02-01T00:00:00Z"),
    ])
    install(monkeypatch, collection)
    # Crash after the retired row is written but before the replacement row.
    original_update = crash_on_update(monkeypatch, collection, 2)

    with pytest.raises(SimulatedProcessCrash):
        librarian.supersede_memory_records(
            ["old"],
            superseded_by="new",
            valid_to="2026-02-01T00:00:00Z",
            source_authority=95,
            uncertainty=0.25,
            source_lineage=LINEAGE,
            tenant_id=TENANT,
            workspace_id=WORKSPACE,
            memory_principal_key=PRINCIPAL_A,
        )

    [entry] = journal_entries()
    assert entry["operation"] == "retire_ids" and entry["version"] == 3
    assert entry["supersession_link"] == {
        "update_replacement": True,
        "replacement_memory_id": "new",
        "valid_to": "2026-02-01T00:00:00.000Z",
        "source_authority": 95,
        "uncertainty": 0.25,
        "source_lineage": temporal_contract.normalize_source_lineage(LINEAGE),
    }
    assert collection.rows["old"]["metadata"]["valid_to"] == "2026-02-01T00:00:00.000Z"
    assert json.loads(collection.rows["new"]["metadata"].get("supersedes_json") or "[]") == []

    monkeypatch.setattr(collection, "update", original_update)
    librarian._recover_fact_supersessions()

    assert journal_entries() == []
    old = dict(collection.rows["old"]["metadata"])
    new = dict(collection.rows["new"]["metadata"])
    assert old["memory_status"] == "superseded" and old["valid_to"] == "2026-02-01T00:00:00.000Z"
    assert json.loads(new["supersedes_json"]) == ["old"]
    assert new["supersession_source_authority"] == 95
    assert new["supersession_uncertainty"] == 0.25
    assert new["supersession_recorded_at"] == entry["created_at"]

    # A duplicate replay of the same durable entry converges on the same state.
    librarian._write_fact_supersession_journal(entry)
    librarian._recover_fact_supersessions()
    assert journal_entries() == []
    assert collection.rows["old"]["metadata"] == old
    assert collection.rows["new"]["metadata"] == new


def test_old_format_journal_entries_still_recover_unchanged(monkeypatch):
    collection = MemoryCollection([
        state_row("old", "2026-01-01T00:00:00Z"),
        state_row("new", "2026-02-01T00:00:00Z"),
    ])
    install(monkeypatch, collection)
    before = collection.get(ids=["old"], include=["metadatas"])
    original_update = crash_on_update(monkeypatch, collection, 1)

    with pytest.raises(SimulatedProcessCrash):
        librarian.supersede_memory_records(
            ["old"],
            superseded_by="new",
            tenant_id=TENANT,
            workspace_id=WORKSPACE,
            memory_principal_key=PRINCIPAL_A,
        )

    [entry] = journal_entries()
    # A non-explicit request writes exactly the pre-Stage-2 entry and hash.
    assert set(entry) == LEGACY_RETIREMENT_KEYS
    ids, metadatas = librarian._retirement_primary_projection(entry, before)
    marker = librarian._fallback_id_tombstone_marker(
        entry["memory_ids"],
        superseded_by=entry["superseded_by"],
        reason=entry["reason"],
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
        memory_principal_key=PRINCIPAL_A,
        transaction_id=entry["transaction_id"],
        operation_generation=None,
        stored_at=entry["created_at"],
    )
    legacy_hash = sha256(json.dumps(
        {"version": "cortex.memory-retirement.v2", "ids": ids, "metadatas": metadatas, "fallback": marker},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")).hexdigest()
    assert entry["quota_payload_hash"] == legacy_hash

    monkeypatch.setattr(collection, "update", original_update)
    librarian._recover_fact_supersessions()
    assert journal_entries() == []
    old = collection.rows["old"]["metadata"]
    assert old["memory_status"] == "superseded" and old["superseded_by"] == "new"
    assert "valid_to" not in old  # no explicit end: wall-clock retirement only
    assert old["valid_until"]
    assert json.loads(collection.rows["new"]["metadata"].get("supersedes_json") or "[]") == []
    assert "supersession_recorded_at" not in collection.rows["new"]["metadata"]


def test_inflight_stage1_fact_revision_journal_keeps_declared_supersedes(monkeypatch):
    other = state_row("other-fact", "2026-01-01T00:00:00Z", fact_key="fact.other")
    prior = state_row("same-fact-prior", "2026-01-01T00:00:00Z", fact_key="fact.inflight")
    collection = MemoryCollection([other, prior])
    install(monkeypatch, collection)
    metadata = governed_row(
        "inflight-new",
        MARKER,
        temporal={"kind": "state", "valid_from": "2026-02-01T00:00:00Z", "supersedes": ["other-fact"]},
        ingested_at="2026-02-01T00:00:00Z",
        extra={"fact_key": "fact.inflight"},
    )["metadata"]
    # Written by the Stage-1 code: no explicit_supersession block.
    librarian._write_fact_supersession_journal({
        "version": 1,
        "transaction_id": "stage1-inflight",
        "fact_key": "fact.inflight",
        "memory_id": "inflight-new",
        "text": MARKER,
        "metadata": metadata,
        "created_at": "2026-02-01T00:00:01+00:00",
        "tenant_id": TENANT,
        "workspace_id": WORKSPACE,
    })

    librarian._recover_fact_supersessions()

    assert journal_entries() == []
    assert collection.rows["inflight-new"]["metadata"]["memory_status"] == "active"
    # The live same-fact_key replacement still happens...
    assert collection.rows["same-fact-prior"]["metadata"]["memory_status"] == "superseded"
    assert "valid_to" not in collection.rows["same-fact-prior"]["metadata"]
    # ...but the Stage-1 declared supersedes is not reinterpreted on replay.
    assert collection.rows["other-fact"]["metadata"]["memory_status"] == "active"


# ---------------------------------------------------------------------------
# Graph validation and the same-fact guard
# ---------------------------------------------------------------------------


def test_graph_validation_rejects_missing_foreign_and_cyclic_targets_without_changes(monkeypatch):
    collection = MemoryCollection([
        state_row("a-old", "2026-01-01T00:00:00Z"),
        state_row("a-new", "2026-02-01T00:00:00Z"),
        state_row("b-row", "2026-01-01T00:00:00Z", principal=PRINCIPAL_B),
    ])
    install(monkeypatch, collection)
    snapshot = json.loads(json.dumps(collection.rows))
    common = dict(tenant_id=TENANT, workspace_id=WORKSPACE, memory_principal_key=PRINCIPAL_A)

    cases = (
        (["missing-id"], "a-new", {"valid_to": "2026-02-01T00:00:00Z"}, "missing or outside"),
        (["b-row"], "a-new", {"source_authority": 50}, "missing or outside"),
        (["a-old", "b-row"], "a-new", {"uncertainty": 0.3}, "missing or outside"),
        (["a-old"], "b-row", {"valid_to": "2026-02-01T00:00:00Z"}, "superseded_by is missing"),
        (["a-new"], "a-new", {"valid_to": "2026-02-01T00:00:00Z"}, "itself"),
        (["a-old"], "a-new", {"valid_to": "2025-12-01T00:00:00Z"}, "later than the prior valid_from"),
        (["a-old"], "a-new", {"valid_to": "2026-02-01"}, "offset-aware"),
    )
    for targets, replacement, extra, message in cases:
        with pytest.raises(ValueError, match=message):
            librarian.supersede_memory_records(targets, superseded_by=replacement, **extra, **common)
    assert collection.rows == snapshot
    assert journal_entries() == []

    # a-old already (transitively) supersedes a-new: linking back is a cycle.
    collection.rows["a-old"]["metadata"]["supersedes_json"] = json.dumps(["a-new"])
    with pytest.raises(librarian.SupersessionValidationError, match="cycle"):
        librarian.supersede_memory_records(
            ["a-old"], superseded_by="a-new", valid_to="2026-02-01T00:00:00Z", **common
        )
    with pytest.raises(ValueError, match="cycle"):
        librarian._validate_supersession_graph(
            ["a-old"], "a-new", tenant_id=TENANT, workspace_id=WORKSPACE, memory_principal_key=PRINCIPAL_A
        )
    with pytest.raises(ValueError, match="missing or outside"):
        librarian._validate_supersession_graph(
            ["a-old"], "missing", tenant_id=TENANT, workspace_id=WORKSPACE, memory_principal_key=PRINCIPAL_A
        )
    assert collection.rows["a-old"]["metadata"]["memory_status"] == "active"
    assert collection.rows["b-row"]["metadata"] == snapshot["b-row"]["metadata"]

    # A plain (non-explicit) request keeps the live partial semantics.
    plain = librarian.supersede_memory_records(["b-row", "missing-id"], **common)
    assert plain["updated"] == 0 and plain["missing"] == ["b-row", "missing-id"]
    assert "supersession_graph" not in plain
    assert collection.rows["b-row"]["metadata"] == snapshot["b-row"]["metadata"]


@pytest.mark.asyncio
async def test_same_fact_guard_and_request_validation_are_http_422(monkeypatch):
    collection = MemoryCollection([
        state_row("old", "2026-01-01T00:00:00Z", fact_key="plan.tier"),
        state_row("payment", "2026-02-01T00:00:00Z", fact_key="payment.receipt"),
        state_row("tier-new", "2026-02-01T00:00:00Z", fact_key="plan.tier"),
    ])
    install(monkeypatch, collection)
    monkeypatch.setattr(librarian, "_route_memory_principal", lambda _request, _http=None: _principal_stub())
    snapshot = json.loads(json.dumps(collection.rows))

    for request in (
        librarian.SupersedeRequest(memory_ids=["old"], superseded_by="payment", valid_to="2026-02-01T00:00:00Z"),
        librarian.SupersedeRequest(memory_ids=["old"], superseded_by="payment", source_lineage=LINEAGE),
        librarian.SupersedeRequest(memory_ids=["old"], superseded_by="tier-new", valid_to="2025-06-01T00:00:00Z"),
        librarian.SupersedeRequest(memory_ids=["missing"], superseded_by="tier-new", uncertainty=0.5),
    ):
        with pytest.raises(HTTPException) as raised:
            await librarian.supersede_memory(request)
        assert raised.value.status_code == 422
    assert collection.rows == snapshot

    with pytest.raises(HTTPException) as raised:
        await librarian.supersede_memory(
            librarian.SupersedeRequest(memory_ids=["old"], superseded_by="payment", valid_to="2026-02-01T00:00:00Z")
        )
    assert "same fact_key" in str(raised.value.detail)

    for bad in (
        {"valid_to": "2026-02-01"},
        {"valid_to": "2026-02-01T00:00:00"},
        {"source_authority": 101},
        {"source_authority": True},
        {"uncertainty": 1.5},
        {"source_lineage": [{"source_id": f"s-{index}"} for index in range(17)]},
    ):
        with pytest.raises(ValidationError):
            librarian.SupersedeRequest(memory_ids=["old"], **bad)

    accepted = await librarian.supersede_memory(
        librarian.SupersedeRequest(
            memory_ids=["old"],
            superseded_by="tier-new",
            valid_to="2026-02-01T00:00:00Z",
            source_authority=70,
            source_lineage=LINEAGE,
        )
    )
    assert accepted["success"] is True and accepted["ids"] == ["old"]
    assert collection.rows["old"]["metadata"]["valid_to"] == "2026-02-01T00:00:00.000Z"
    assert json.loads(collection.rows["tier-new"]["metadata"]["supersedes_json"]) == ["old"]

    # The live route without explicit fields is unchanged (no graph checks).
    legacy = await librarian.supersede_memory(librarian.SupersedeRequest(memory_ids=["payment", "nope"]))
    assert legacy["missing"] == ["nope"] and "supersession_graph" not in legacy


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_v1_write_with_temporal_supersedes_sets_valid_to_and_validates_first(monkeypatch):
    probe = librarian.EmbedRequest(text="probe")
    principal = librarian._route_memory_principal(probe, None)
    scope = dict(principal=principal.memory_principal_key, tenant=principal.tenant_id, workspace=principal.storage_workspace_id)

    def row(memory_id, valid_from, fact_key):
        return governed_row(
            memory_id,
            "plan tier fact",
            temporal={"kind": "state", "valid_from": valid_from},
            ingested_at=valid_from,
            extra={"fact_key": fact_key},
            **scope,
        )

    collection = MemoryCollection([
        row("old", "2026-01-01T00:00:00Z", "plan.tier"),
        row("sibling", "2026-01-15T00:00:00Z", "plan.tier"),
        row("other", "2026-01-01T00:00:00Z", "billing.cycle"),
        row("late", "2026-05-01T00:00:00Z", "plan.tier"),
    ])
    install(monkeypatch, collection)
    snapshot = json.loads(json.dumps(collection.rows))

    def request(supersedes):
        return librarian.EmbedRequest(
            text="plan tier is enterprise",
            metadata={"fact_key": "plan.tier"},
            temporal={"kind": "state", "valid_from": "2026-03-01T00:00:00Z", "supersedes": supersedes},
        )

    # Validation runs before any governed staging or storage.
    for supersedes, message in (
        (["missing-id"], "missing or outside"),
        (["other"], "same fact_key"),
        (["late"], "later than the prior valid_from"),
    ):
        with pytest.raises(HTTPException) as raised:
            await librarian.embed_memory(request(supersedes))
        assert raised.value.status_code == 422
        assert message in str(raised.value.detail)
    assert collection.rows == snapshot
    assert journal_entries() == []

    response = await librarian.embed_memory(request(["old"]))

    assert response.status == "stored"
    new = collection.rows[response.id]["metadata"]
    assert new["memory_status"] == "active"
    assert json.loads(new["supersedes_json"]) == ["old"]
    old = collection.rows["old"]["metadata"]
    assert old["memory_status"] == "superseded"
    assert old["superseded_by"] == response.id
    assert old["valid_to"] == "2026-03-01T00:00:00.000Z"  # = new valid_from
    assert old["supersession_reason"] == "explicit_temporal_supersession"
    # The live automatic same-fact_key retirement still covers unlisted rows.
    sibling = collection.rows["sibling"]["metadata"]
    assert sibling["memory_status"] == "superseded"
    assert sibling["supersession_reason"] == "newer_fact_key_revision"
    assert "valid_to" not in sibling
    assert collection.rows["other"]["metadata"]["memory_status"] == "active"
    assert journal_entries() == []


def test_l22_v1_store_validates_explicit_supersedes_before_staging(monkeypatch):
    collection = MemoryCollection([state_row("l22-old", "2026-01-01T00:00:00Z", fact_key="l22.fact")])
    install(monkeypatch, collection)

    def metadata(supersedes):
        return temporal_contract.prepare_temporal_write_metadata(
            {"memory_principal_key": PRINCIPAL_A, "fact_key": "l22.fact"},
            {"kind": "state", "valid_from": "2026-02-01T00:00:00Z", "supersedes": supersedes},
            stamp=False,
        )

    for idempotency_key in (None, "l22-temporal-supersedes"):
        with pytest.raises(HTTPException) as raised:
            l22.store_memory_record(
                content="l22 correction",
                metadata=metadata(["missing-id"]),
                tenant_id=TENANT,
                workspace_id=WORKSPACE,
                idempotency_key=idempotency_key,
            )
        assert raised.value.status_code == 422
    assert set(collection.rows) == {"l22-old"}
    assert journal_entries() == []

    stored = l22.store_memory_record(
        content="l22 correction",
        metadata=metadata(["l22-old"]),
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
    )
    retired = collection.rows["l22-old"]["metadata"]
    assert retired["superseded_by"] == stored["id"]
    assert retired["valid_to"] == "2026-02-01T00:00:00.000Z"
    assert collection.rows[stored["id"]]["metadata"]["memory_status"] == "active"


def test_v1_write_without_fact_key_rolls_forward_explicit_supersession_after_crash(monkeypatch):
    target = state_row("target", "2026-01-01T00:00:00Z", fact_key=None)
    collection = MemoryCollection([target])
    install(monkeypatch, collection)
    metadata = governed_row(
        "v1-new",
        MARKER,
        temporal={"kind": "state", "valid_from": "2026-04-01T00:00:00Z", "supersedes": ["target"]},
        ingested_at="2026-04-01T00:00:00Z",
    )["metadata"]
    # Update 1 retires the explicit target; update 2 would activate the new row.
    original_update = crash_on_update(monkeypatch, collection, 2)

    with pytest.raises(SimulatedProcessCrash):
        librarian._add_memory_with_supersession(
            "v1-new", MARKER, metadata, tenant_id=TENANT, workspace_id=WORKSPACE
        )

    assert collection.rows["v1-new"]["metadata"]["supersession_pending"] is True
    assert librarian._memory_visible_for_query("", collection.rows["v1-new"]["metadata"]) is False
    entries = journal_entries()
    assert [entry.get("operation", "fact_revision") for entry in entries] == ["fact_revision"]
    assert entries[0]["fact_key"] == ""
    assert entries[0]["explicit_supersession"] == {
        "memory_ids": ["target"],
        "valid_to": "2026-04-01T00:00:00.000Z",
    }

    monkeypatch.setattr(collection, "update", original_update)
    librarian._recover_fact_supersessions()

    assert journal_entries() == []
    assert collection.rows["v1-new"]["metadata"]["memory_status"] == "active"
    assert "supersession_pending" not in collection.rows["v1-new"]["metadata"]
    retired = collection.rows["target"]["metadata"]
    assert retired["memory_status"] == "superseded"
    assert retired["superseded_by"] == "v1-new"
    assert retired["valid_to"] == "2026-04-01T00:00:00.000Z"


def test_legacy_writes_keep_live_same_fact_key_auto_retirement(monkeypatch):
    collection = MemoryCollection([
        state_row("v1-prior", "2026-01-01T00:00:00Z", fact_key="legacy.fact"),
        {"id": "legacy-prior", "text": "legacy", "metadata": librarian._normalize_memory_metadata(
            {"memory_principal_key": PRINCIPAL_A, "fact_key": "legacy.fact"},
            tenant_id=TENANT, workspace_id=WORKSPACE,
        )},
        state_row("unrelated", "2026-01-01T00:00:00Z", fact_key="other.fact"),
    ])
    install(monkeypatch, collection)

    # A non-v1 write carrying a supersedes_json key is still an ordinary write.
    librarian._add_memory_with_supersession(
        "legacy-new",
        "legacy correction",
        {"memory_principal_key": PRINCIPAL_A, "fact_key": "legacy.fact", "supersedes_json": '["unrelated"]'},
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
    )

    for prior in ("v1-prior", "legacy-prior"):
        metadata = collection.rows[prior]["metadata"]
        assert metadata["memory_status"] == "superseded"
        assert metadata["superseded_by"] == "legacy-new"
        assert metadata["supersession_reason"] == "newer_fact_key_revision"
        assert "valid_to" not in metadata
        assert metadata["valid_until"]
    assert collection.rows["unrelated"]["metadata"]["memory_status"] == "active"
    assert collection.rows["legacy-new"]["metadata"]["memory_status"] == "active"
    assert journal_entries() == []

    # A v1 write without explicit supersedes also keeps the live auto-retirement.
    v1_new = state_row("v1-new", "2026-03-01T00:00:00Z", fact_key="legacy.fact")
    librarian._add_memory_with_supersession(
        "v1-new", MARKER, v1_new["metadata"], tenant_id=TENANT, workspace_id=WORKSPACE
    )
    assert collection.rows["legacy-new"]["metadata"]["memory_status"] == "superseded"
    assert "valid_to" not in collection.rows["legacy-new"]["metadata"]


# ---------------------------------------------------------------------------
# Authority and lineage presentation
# ---------------------------------------------------------------------------


def test_source_authority_ranks_only_temporal_v1_rows():
    legacy = {"source_authority": 95}
    v1 = {"temporal_schema_version": V1, "source_authority": 95}
    assert librarian._authority_rank(legacy) == librarian._authority_rank({})
    assert librarian._authority_rank(v1) == 95
    assert librarian._authority_rank({**v1, "authority_rank": 40}) == 40
    assert librarian._authority_rank({**v1, "source_authority": True}) == librarian._authority_rank({})
    assert librarian._normalize_memory_metadata(dict(v1))["authority_rank"] == 95
    assert librarian._normalize_memory_metadata(dict(legacy))["authority_rank"] == librarian._authority_rank({})

    store = MemoryGovernanceStore()
    for memory_id, metadata in (
        ("gov-v1", {**v1, "fact_key": "gov.v1"}),
        ("gov-legacy", {**legacy, "fact_key": "gov.legacy"}),
    ):
        store.record_fact(principal_key=PRINCIPAL_A, memory_id=memory_id, content=memory_id, metadata=metadata)
    connection = store._connect()
    try:
        authority = {
            row["memory_id"]: row["authority"]
            for row in connection.execute("SELECT memory_id, authority FROM facts").fetchall()
        }
    finally:
        connection.close()
    assert authority == {"gov-v1": 95, "gov-legacy": 0}


def test_supporting_values_stay_co_current_and_explicit_conflict_is_component_scoped():
    store = MemoryGovernanceStore()
    common = {
        "claim_key": "claim.supporting-details",
        "observed_at": "2026-01-01T00:00:00Z",
    }
    store.record_fact(
        principal_key=PRINCIPAL_A,
        memory_id="summary",
        content="The service is available.",
        metadata={**common, "fact_key": "summary", "fact_value": "available", "authority_rank": 40},
    )
    store.record_fact(
        principal_key=PRINCIPAL_A,
        memory_id="detail",
        content="The service is available on the internal lane.",
        metadata={**common, "fact_key": "detail", "fact_value": "internal lane", "authority_rank": 50},
    )
    store.record_fact(
        principal_key=PRINCIPAL_A,
        memory_id="outage",
        content="The service is unavailable.",
        metadata={
            **common,
            "fact_key": "outage",
            "fact_value": "unavailable",
            "authority_rank": 90,
            "contradicts_ids": ["summary"],
        },
    )

    projection = store.conflict_projection(
        principal_key=PRINCIPAL_A,
        memory_ids=["summary", "detail", "outage"],
    )
    assert projection["summary"]["fact_status"] == "conflicted"
    assert projection["outage"]["fact_status"] == "active"
    assert projection["detail"]["fact_status"] == "active"
    assert any(
        edge["reason"] == "explicit_contradiction"
        for edge in projection["summary"]["edges"]
    )


def test_explicit_supersession_json_dominates_projection_without_erasing_history():
    store = MemoryGovernanceStore()
    common = {"claim_key": "claim.execution-plane", "fact_value": "legacy"}
    store.record_fact(
        principal_key=PRINCIPAL_A,
        memory_id="execution-old",
        content="Use the legacy execution plane.",
        metadata={**common, "fact_key": "execution-old"},
    )
    store.record_fact(
        principal_key=PRINCIPAL_A,
        memory_id="execution-new",
        content="Use the current execution plane.",
        metadata={
            "claim_key": "claim.execution-plane",
            "fact_key": "execution-new",
            "fact_value": "current",
            "supersedes_json": '["execution-old"]',
        },
    )
    projection = store.conflict_projection(
        principal_key=PRINCIPAL_A,
        memory_ids=["execution-old", "execution-new"],
    )
    assert projection["execution-old"]["fact_status"] == "superseded"
    assert projection["execution-new"]["fact_status"] == "active"

    historical = {
        "temporal_schema_version": V1,
        "temporal_kind": "state",
        "valid_from": "2026-01-01T00:00:00.000Z",
        "valid_to": "2026-02-01T00:00:00.000Z",
        "ingested_at": "2026-01-01T00:00:00.000Z",
        "memory_status": "superseded",
    }
    assert temporal_contract.temporal_presentation(historical)["valid_to"] == "2026-02-01T00:00:00.000Z"
    assert temporal_visibility(historical).visible is False
    assert temporal_visibility(historical, as_of="2026-01-15T00:00:00Z").visible is True


def test_lineage_verification_reports_scope_without_returning_content(monkeypatch):
    lineage = [
        {"source_id": "s-1", "memory_id": "src"},
        {"source_id": "s-2", "memory_id": "foreign-src"},
        {"source_id": "s-3", "memory_id": "deleted-id"},
        {"source_id": "s-4", "evidence_id": "external-7", "source_available": True},
    ]
    fact = governed_row(
        "fact",
        MARKER,
        temporal={"kind": "state", "valid_from": "2026-01-01T00:00:00Z", "source_lineage": lineage},
        ingested_at="2026-01-01T00:00:00Z",
    )
    source = {"id": "src", "text": "CONFIDENTIAL SOURCE BODY", "metadata": librarian._normalize_memory_metadata(
        {"memory_principal_key": PRINCIPAL_A}, tenant_id=TENANT, workspace_id=WORKSPACE
    )}
    foreign = {"id": "foreign-src", "text": "FOREIGN BODY", "metadata": librarian._normalize_memory_metadata(
        {"memory_principal_key": PRINCIPAL_B}, tenant_id=TENANT, workspace_id=WORKSPACE
    )}
    collection = MemoryCollection([fact, source, foreign])
    install(monkeypatch, collection)

    result = search()
    row = next(item for item in result["results"] if item["id"] == "fact")
    views = {ref["source_id"]: ref for ref in row["source_lineage"]}
    assert views["s-1"]["source_availability"] == "verified" and views["s-1"]["source_available"] is True
    assert views["s-2"]["source_availability"] == "missing_or_out_of_scope"
    assert views["s-2"]["source_available"] is False
    assert views["s-3"]["source_availability"] == "missing_or_out_of_scope"
    assert views["s-4"]["source_availability"] == "declared"
    assert views["s-4"]["source_available"] is True  # declared value kept, not verified
    rendered = json.dumps(row["source_lineage"])
    assert "CONFIDENTIAL SOURCE BODY" not in rendered and "FOREIGN BODY" not in rendered
    assert all("content" not in ref and "text" not in ref for ref in row["source_lineage"])
    lineage_lookups = [
        call for call in collection.get_calls
        if call["ids"] and set(call["ids"]) & {"src", "foreign-src", "deleted-id"}
    ]
    assert len(lineage_lookups) == 1 and len(lineage_lookups[0]["ids"]) <= 16

    # Without a resolver (or when the lookup fails) references stay declared.
    declared = temporal_contract.source_lineage_view(fact["metadata"])
    assert {ref["source_availability"] for ref in declared} == {"declared"}

    def unavailable(_ids):
        raise RuntimeError("backend down")

    failed = temporal_contract.source_lineage_view(fact["metadata"], resolve_memory_ids=unavailable)
    assert {ref["source_availability"] for ref in failed} == {"declared"}


# ---------------------------------------------------------------------------
# Codec temporal lineage (Stage 3)
# ---------------------------------------------------------------------------


def test_l22_structured_and_codec_round_trip_explicit_temporal_lineage(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_L22_STRUCTURED_DB", str(tmp_path / "structured.sqlite3"))
    monkeypatch.setenv("CORTEX_L22_PREALLOCATE_RECOVERY_RESERVE", "false")
    prepared = librarian.apply_temporal_memory_contract(
        {"lookup_key": "temporal-codec-fixture"},
        librarian.TemporalMemoryContract(
            kind="state",
            valid_from="2026-01-01T00:00:00Z",
            precision="unknown",
            source_lineage=[
                librarian.SourceLineageRef(
                    source_id="codec-source",
                    event_id="event-7",
                    occurred_at="2026-01-01T00:00:00Z",
                    observed_at="2026-01-02T00:00:00Z",
                    source_available=True,
                )
            ],
        ),
    )
    stored = l22.store_structured_memory_record(
        content=json.dumps({"summary": "synthetic temporal codec state"}),
        memory_type="codec_state",
        metadata=prepared,
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
    )
    rows = l22.list_structured_memory_records(
        memory_type="codec_state",
        lookup_key="temporal-codec-fixture",
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
    )
    assert rows[0]["id"] == stored["id"]
    assert rows[0]["metadata"]["valid_from"] == "2026-01-01T00:00:00.000Z"
    assert json.loads(rows[0]["metadata"]["source_lineage_json"])[0]["event_id"] == "event-7"

    codec_state = {
        "version": cortex_codec.CODEC_VERSION,
        "schema_version": cortex_codec.CODEC_SCHEMA_VERSION,
        "generated_at": "2026-01-03T00:00:00Z",
        "source_refs": [
            {
                "source_id": "codec-source",
                "event_id": "event-7",
                "event_type": "date_of_service",
                "occurred_at": "2026-01-01T00:00:00Z",
                "observed_at": "2026-01-02T00:00:00Z",
                "ingested_at": "2026-01-02T01:00:00Z",
                "source_available": True,
            }
        ],
        "world_state": {
            "durable_facts": ["synthetic fact"],
            "fact_revisions": [
                {
                    "bucket": "durable_facts",
                    "superseded_text": "old synthetic fact",
                    "replacement_text": "synthetic fact",
                    "superseded_memory_id": "old-id",
                    "replacement_memory_id": "new-id",
                    "valid_from": "2026-01-01T00:00:00Z",
                    "valid_to": "2026-02-01T00:00:00Z",
                    "source_refs": [{"source_id": "codec-source", "event_id": "event-7"}],
                }
            ],
        },
    }
    migrated = cortex_codec._migrate_codec_state(codec_state)
    compact = cortex_codec._compact_codec_state(migrated)
    ref = compact["source_refs"][0]
    revision = compact["world_state"]["fact_revisions"][0]
    assert migrated["temporal_contract_version"] == V1
    assert compact["temporal_contract_version"] == V1
    assert ref["occurred_at"] == "2026-01-01T00:00:00.000Z"
    assert ref["observed_at"] == "2026-01-02T00:00:00.000Z"
    assert ref["ingested_at"] == "2026-01-02T01:00:00.000Z"
    assert ref["source_available"] is True
    assert revision["superseded_memory_id"] == "old-id"
    assert revision["replacement_memory_id"] == "new-id"
    assert revision["valid_to"] == "2026-02-01T00:00:00.000Z"
    assert revision["source_refs"] == [{"source_id": "codec-source", "event_id": "event-7"}]
    assert cortex_codec._stable_state_view(compact)["temporal_contract_version"] == V1

    legacy = cortex_codec._migrate_codec_state(
        {
            "world_state": {"durable_facts": ["legacy fact"]},
            "source_refs": [{"event_id": None, "session_key": "s-1", "event_kind": "event", "ts": None}],
        }
    )
    assert legacy.get("temporal_contract_version") is None
    assert legacy["source_refs"] == [{"session_key": "s-1", "event_kind": "event"}]
    assert "temporal_contract_version" not in cortex_codec._compact_codec_state(legacy)
    assert "temporal_contract_version" not in cortex_codec._stable_state_view(legacy)
    assert cortex_codec._migrate_codec_state({"world_state": {}})["source_refs"] == []


def test_codec_source_refs_keep_explicit_time_and_accumulate_newest_first():
    refs = cortex_codec._source_refs_from_events([
        {
            "text": "service recorded",
            "event_id": "evt-1",
            "ts": "2026-01-05T00:00:00Z",
            "metadata": {
                "occurred_at": "2026-01-01T10:00:00-06:00",
                "event_type": "date_of_service",
                "source_lineage": [{"source_id": "ledger", "evidence_id": "row-1"}],
            },
        },
        {"text": "generic event", "event_id": "evt-2", "created_at": "2026-01-06T00:00:00Z"},
        {
            "text": "conflicting claim",
            "event_id": "evt-3",
            "occurred_at": "2026-01-02T00:00:00Z",
            "metadata": {"occurred_at": "2026-01-03T00:00:00Z"},
        },
    ])
    by_event = {ref.get("event_id"): ref for ref in refs}
    assert refs[0]["event_id"] == "evt-1"  # event refs precede declared lineage
    assert by_event["evt-1"]["occurred_at"] == "2026-01-01T16:00:00.000Z"
    assert by_event["evt-1"]["ts"] == "2026-01-05T00:00:00Z"
    assert by_event["evt-1"]["event_type"] == "date_of_service"
    # A generic timestamp never becomes an occurrence/observation time.
    assert "occurred_at" not in by_event["evt-2"] and "observed_at" not in by_event["evt-2"]
    assert by_event["evt-2"]["ts"] == "2026-01-06T00:00:00Z"
    # Conflicting top-level and metadata claims are not silently merged.
    assert by_event["evt-3"]["occurred_at"] == "2026-01-02T00:00:00.000Z"
    assert any(ref.get("evidence_id") == "row-1" for ref in refs)

    previous = cortex_codec.build_codec_state(
        [{"text": f"note {index}", "event_id": f"prev-{index}"} for index in range(20)]
    )
    assert len(previous["source_refs"]) == 16
    lifecycle_ref = "f" * 64
    many_lineage = [{"source_id": f"lineage-{index}"} for index in range(16)]
    state = cortex_codec.build_codec_state(
        [{
            "text": "Remember this durable fact: lane is fast.",
            "event_id": lifecycle_ref,
            "event_kind": "codec_lifecycle",
            "metadata": {"source_lineage": many_lineage},
        }],
        previous_state=previous,
    )
    assert len(state["source_refs"]) == 16
    assert state["source_refs"][0]["event_id"] == lifecycle_ref
    assert state["source_refs"][0]["event_kind"] == "codec_lifecycle"
    assert "temporal_contract_version" not in state

    # Maximal rich refs never push the compacted source state past its bound;
    # the newest ref survives.
    bulky = [
        {
            "event_id": f"{index:02d}" + "e" * 1000,
            "source_id": "s" * 1024,
            "evidence_id": "v" * 1024,
            "version_id": "w" * 1024,
            "locator": "l" * 1024,
            "supersedes": [f"id-{index}-{n}" + "x" * 100 for n in range(32)],
        }
        for index in range(16)
    ]
    compact = cortex_codec._compact_codec_state({**state, "source_refs": bulky})
    encoded = json.dumps(compact, ensure_ascii=False, sort_keys=True)
    assert len(encoded) < cortex_codec.CODEC_STATE_MAX_SERIALIZED_CHARS
    assert compact["source_refs"][0]["event_id"].startswith("00")
