"""Stage 1 of the temporal memory contract port (cortex.memory.temporal.v1).

Adapted from the q9 ``test_temporal_memory_contract.py`` to the live APIs:
filters travel in ``MemorySearchFilters``, legacy rows keep the live
permissive semantics (``include_unknown_time`` defaults to True) and are only
labelled "time unknown", and the v1 contract is opt-in per write through an
explicit ``temporal`` object.
"""
from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from cortex_server.routers import knowledge, l22, librarian
from cortex_server.runtime import memory_governance, temporal_contract
from cortex_server.runtime.memory_governance import (
    MemoryFilterError,
    MemoryGovernanceError,
    MemorySearchFilters,
)


TENANT = "tenant-temporal"
WORKSPACE = "workspace-temporal"
PRINCIPAL_A = "principal:" + "a" * 64
PRINCIPAL_B = "principal:" + "b" * 64
MARKER = "synthetic temporal marker"
V1 = "cortex.memory.temporal.v1"


# ---------------------------------------------------------------------------
# Isolation helpers
# ---------------------------------------------------------------------------


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
    monkeypatch.setattr(librarian, "_recover_fact_supersessions", lambda: None)


def governed_row(memory_id, text, *, temporal=None, ingested_at=None, principal=PRINCIPAL_A, extra=None):
    """Build a row exactly as the governed write path would store it."""

    metadata = {"memory_principal_key": principal, **(extra or {})}
    if temporal is not None:
        metadata = temporal_contract.apply_temporal_memory_contract(metadata, temporal, stamp=False)
        metadata = temporal_contract.stamp_temporal_ingestion(metadata, ingested_at=ingested_at)
    normalized = librarian._normalize_memory_metadata(metadata, tenant_id=TENANT, workspace_id=WORKSPACE)
    governed = librarian.prepare_governed_memory_write(
        principal_key=principal, content=text, metadata=normalized
    )
    return {"id": memory_id, "text": text, "metadata": governed}


def search(query=MARKER, **filters):
    return librarian.robust_search(
        query,
        n_results=5,
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
        memory_principal_key=PRINCIPAL_A,
        filters=MemorySearchFilters.from_mapping(filters) if filters else None,
    )


def ids(result):
    return [row["id"] for row in result["results"]]


def _principal_stub():
    return SimpleNamespace(
        tenant_id=TENANT,
        storage_workspace_id=WORKSPACE,
        memory_principal_key=PRINCIPAL_A,
        credential_id="credential-temporal",
    )


def patch_route_principals(monkeypatch):
    monkeypatch.setattr(librarian, "_route_memory_principal", lambda _request, _http=None: _principal_stub())
    monkeypatch.setattr(l22, "_route_memory_principal", lambda _request, _http=None: _principal_stub())
    monkeypatch.setattr(knowledge, "_route_principal", lambda _request, _http=None: _principal_stub())


# ---------------------------------------------------------------------------
# Contract normalisation and rejection (new writes only)
# ---------------------------------------------------------------------------


def test_contract_keeps_event_observation_and_system_ingestion_distinct():
    contract = temporal_contract.TemporalMemoryContract(
        kind="event",
        event_id="event-1",
        event_type="date_of_service",
        occurred_at="2026-01-10T09:30:00-06:00",
        observed_at="2026-01-12T08:00:00-06:00",
        precision="instant",
        timezone="America/Chicago",
        source_authority=90,
        uncertainty=0.05,
        source_lineage=[
            temporal_contract.SourceLineageRef(
                source_id="synthetic-ledger",
                evidence_id="line-7",
                version_id="v3",
                source_available=True,
            )
        ],
    )

    metadata = temporal_contract.apply_temporal_memory_contract({}, contract)

    assert metadata["temporal_schema_version"] == V1
    assert metadata["temporal_kind"] == "event"
    assert metadata["occurred_at"] == "2026-01-10T15:30:00.000Z"
    assert metadata["observed_at"] == "2026-01-12T14:00:00.000Z"
    assert metadata["ingested_at"].endswith("Z")
    assert metadata["ingested_at"] not in {metadata["occurred_at"], metadata["observed_at"]}
    assert metadata["temporal_timezone"] == "America/Chicago"
    assert metadata["source_authority"] == 90 and metadata["uncertainty"] == 0.05
    assert json.loads(metadata["source_lineage_json"])[0]["source_available"] is True
    assert metadata["source_lineage_count"] == 1
    assert json.loads(metadata["supersedes_json"]) == []
    # Every stored contract field is a flat scalar (survives the Chroma envelope).
    assert all(isinstance(value, (str, int, float, bool)) for value in metadata.values())
    # The router re-exports the contract for q9 API parity.
    assert librarian.TemporalMemoryContract is temporal_contract.TemporalMemoryContract
    assert librarian.TEMPORAL_MEMORY_SCHEMA_VERSION == V1


def test_contract_rejection_cases():
    good = {"kind": "state", "valid_from": "2026-01-01T00:00:00Z"}
    with pytest.raises(ValueError, match="system-owned"):
        temporal_contract.apply_temporal_memory_contract({"ingested_at": "2026-01-01T00:00:00Z"}, good)
    with pytest.raises(ValueError, match="system-owned"):
        temporal_contract.apply_temporal_memory_contract({"temporal_schema_version": V1}, good)
    with pytest.raises(ValueError, match="system-owned"):
        temporal_contract.prepare_temporal_write_metadata({"temporal_schema_version": V1}, None)
    with pytest.raises(ValueError, match="valid_until"):
        temporal_contract.apply_temporal_memory_contract({"valid_until": "2026-03-01T00:00:00Z"}, good)
    with pytest.raises(ValueError, match="conflicts with metadata field valid_from"):
        temporal_contract.apply_temporal_memory_contract({"valid_from": "2025-01-01T00:00:00Z"}, good)
    # Same instant in a different spelling is not a conflict.
    same = temporal_contract.apply_temporal_memory_contract(
        {"valid_from": "2026-01-01T00:00:00+00:00"}, good, stamp=False
    )
    assert same["valid_from"] == "2026-01-01T00:00:00.000Z"

    with pytest.raises(ValidationError, match="offset-aware RFC3339"):
        temporal_contract.TemporalMemoryContract(
            kind="event", occurred_at="2026-01-01 00:00:00", precision="instant"
        )
    with pytest.raises(ValidationError, match="offset-aware RFC3339"):
        temporal_contract.TemporalMemoryContract(valid_from="2026-01-01T00:00:00")
    with pytest.raises(ValidationError, match="use occurred_on"):
        temporal_contract.TemporalMemoryContract(valid_from="2026-01-01")
    with pytest.raises(ValidationError, match="explicit instant precision"):
        temporal_contract.TemporalMemoryContract(kind="event", occurred_at="2026-01-01T00:00:00Z")
    with pytest.raises(ValidationError, match="explicit date precision"):
        temporal_contract.TemporalMemoryContract(kind="event", occurred_on="2026-01-01")
    with pytest.raises(ValidationError, match="mutually exclusive"):
        temporal_contract.TemporalMemoryContract(
            kind="event",
            occurred_at="2026-01-01T00:00:00Z",
            occurred_on="2026-01-01",
            precision="instant",
        )
    with pytest.raises(ValidationError, match="earlier than valid_to"):
        temporal_contract.TemporalMemoryContract(
            valid_from="2026-02-01T00:00:00Z", valid_to="2026-02-01T00:00:00Z"
        )
    with pytest.raises(ValidationError, match="earlier than valid_to"):
        temporal_contract.TemporalMemoryContract(
            valid_from="2026-03-01T00:00:00Z", valid_to="2026-02-01T00:00:00Z"
        )
    too_many = [{"source_id": f"source-{index}"} for index in range(17)]
    with pytest.raises(ValidationError):
        temporal_contract.TemporalMemoryContract(source_lineage=too_many)
    with pytest.raises(ValueError, match="record bound"):
        temporal_contract.normalize_temporal_contract_metadata({"source_lineage": too_many})
    with pytest.raises(ValidationError, match="duplicate"):
        temporal_contract.TemporalMemoryContract(supersedes=["a", "a"])
    with pytest.raises(ValidationError):
        temporal_contract.TemporalMemoryContract(source_authority=101)
    with pytest.raises(ValidationError):
        temporal_contract.TemporalMemoryContract(uncertainty=1.5)


def test_write_request_models_accept_only_an_optional_explicit_temporal_object():
    for model, kwargs in (
        (librarian.EmbedRequest, {"text": "x"}),
        (librarian.NovelEmbedRequest, {"text": "x"}),
        (l22.L22StoreRequest, {"content": "x"}),
        (l22.L22NovelStoreRequest, {"content": "x"}),
    ):
        assert model(**kwargs).temporal is None
        parsed = model(**kwargs, temporal={"kind": "state", "valid_from": "2026-01-01T00:00:00Z"})
        assert parsed.temporal.valid_from == "2026-01-01T00:00:00.000Z"
        with pytest.raises(ValidationError):
            model(**kwargs, temporal={"kind": "state", "valid_from": "2026-01-01"})
    # Without a temporal object the caller's metadata object passes through untouched.
    metadata = {"observed_at": "2026-01-01T00:00:00Z", "valid_to": "anything"}
    assert temporal_contract.prepare_temporal_write_metadata(metadata, None) is metadata
    assert temporal_contract.prepare_temporal_write_metadata(None, None) is None


# ---------------------------------------------------------------------------
# Admission (v1 rows) and legacy semantics
# ---------------------------------------------------------------------------


def test_valid_time_and_knowledge_time_are_separate_and_valid_to_is_exclusive(monkeypatch):
    old = governed_row(
        "old",
        MARKER,
        temporal={
            "kind": "state",
            "valid_from": "2026-01-01T00:00:00Z",
            "valid_to": "2026-02-01T00:00:00Z",
            "observed_at": "2026-01-02T00:00:00Z",
            "source_authority": 80,
        },
        ingested_at="2026-01-02T01:00:00Z",
        extra={
            "memory_status": "superseded",
            "superseded_by": "new",
            "superseded_at": "2026-03-01T00:00:00Z",
        },
    )
    new = governed_row(
        "new",
        MARKER,
        temporal={
            "kind": "state",
            "valid_from": "2026-02-01T00:00:00Z",
            "observed_at": "2026-03-01T00:00:00Z",
            "source_authority": 95,
        },
        ingested_at="2026-03-01T01:00:00Z",
    )
    foreign = governed_row(
        "foreign",
        MARKER,
        temporal={"kind": "state", "valid_from": "2025-01-01T00:00:00Z"},
        ingested_at="2025-01-01T00:00:00Z",
        principal=PRINCIPAL_B,
    )
    install(monkeypatch, MemoryCollection([old, new, foreign]))

    january = search(as_of="2026-01-15T00:00:00Z", as_known_at="2026-02-15T00:00:00Z")
    boundary = search(as_of="2026-02-01T00:00:00Z")
    just_before = search(as_of="2026-01-31T23:59:59Z")
    late_gap = search(as_of="2026-02-15T00:00:00Z", as_known_at="2026-02-20T00:00:00Z")
    known_later = search(as_of="2026-02-15T00:00:00Z", as_known_at="2026-03-02T00:00:00Z")

    assert ids(january) == ["old"]
    assert ids(boundary) == ["new"]  # valid_to is exclusive
    assert ids(just_before) == ["old"]
    assert late_gap["results"] == []
    assert ids(known_later) == ["new"]
    assert all(
        row["id"] != "foreign"
        for result in (january, boundary, just_before, known_later)
        for row in result["results"]
    )
    assert january["results"][0]["metadata"]["temporal_admission"] == "valid_and_known"
    assert january["results"][0]["metadata"]["temporal_query_match"] is True
    assert boundary["results"][0]["metadata"]["temporal_admission"] == "valid_at_as_of"
    assert known_later["as_of"] == "2026-02-15T00:00:00.000000Z"
    assert known_later["as_known_at"] == "2026-03-02T00:00:00.000000Z"
    assert known_later["temporal_contract_version"] == V1
    block = known_later["results"][0]["temporal"]
    assert block["schema_version"] == V1
    assert block["time_known"] is True
    assert block["valid_to"] is None
    assert block["ingested_at"] == "2026-03-01T01:00:00.000Z"
    assert block["admission"] == "valid_and_known"


def test_date_only_boundary_is_indeterminate_and_distinct_events_do_not_invent_a_clock(monkeypatch):
    date_only = governed_row(
        "date-only",
        MARKER,
        temporal={
            "kind": "event",
            "event_id": "service-date-only",
            "event_type": "date_of_service",
            "occurred_on": "2026-01-10",
            "precision": "date",
            "timezone": "America/Chicago",
        },
        ingested_at="2026-01-11T00:00:00Z",
    )["metadata"]

    strict_same_day = memory_governance.temporal_visibility(
        date_only, as_of="2026-01-10T23:59:59Z", include_unknown_time=False
    )
    permissive_same_day = memory_governance.temporal_visibility(
        date_only, as_of="2026-01-10T23:59:59Z", include_unknown_time=True
    )
    next_day = memory_governance.temporal_visibility(date_only, as_of="2026-01-11T00:00:00Z")
    day_before = memory_governance.temporal_visibility(date_only, as_of="2026-01-09T23:59:59Z")
    assert strict_same_day.visible is False
    assert strict_same_day.reason == "date_boundary_indeterminate"
    assert permissive_same_day.visible is True
    assert permissive_same_day.admission == "date_boundary_indeterminate"
    assert permissive_same_day.query_match is False
    assert next_day.visible is True and next_day.query_match is True
    assert day_before.visible is False and day_before.reason == "occurs_after_as_of"

    install(monkeypatch, MemoryCollection([{"id": "date-only", "text": MARKER, "metadata": date_only}]))
    strict = search(as_of="2026-01-10T23:59:59Z", include_unknown_time=False)
    permissive = search(as_of="2026-01-10T23:59:59Z", include_unknown_time=True)
    assert strict["results"] == []
    row = permissive["results"][0]
    assert row["metadata"]["temporal_admission"] == "date_boundary_indeterminate"
    assert row["metadata"]["temporal_query_match"] is False
    assert row["temporal"]["occurred_on"] == "2026-01-10"
    assert row["temporal"]["precision"] == "date"
    assert row["temporal"]["query_match"] is False

    service = governed_row(
        "service",
        "event",
        temporal={
            "kind": "event",
            "event_id": "service-1",
            "event_type": "date_of_service",
            "occurred_at": "2026-01-10T15:00:00Z",
            "observed_at": "2026-01-10T16:00:00Z",
            "precision": "instant",
        },
        ingested_at="2026-01-10T17:00:00Z",
        extra={"fact_key": "encounter.service"},
    )["metadata"]
    receipt = governed_row(
        "receipt",
        "event",
        temporal={
            "kind": "event",
            "event_id": "receipt-1",
            "event_type": "payment_receipt",
            "occurred_at": "2026-01-20T15:00:00Z",
            "observed_at": "2026-01-20T16:00:00Z",
            "precision": "instant",
        },
        ingested_at="2026-01-20T17:00:00Z",
        extra={"fact_key": "payment.receipt"},
    )["metadata"]
    filters = MemorySearchFilters.from_mapping(
        {"as_of": "2026-01-15T00:00:00Z", "as_known_at": "2026-01-15T00:00:00Z"}
    )
    assert memory_governance.row_matches_filters(service, filters) is True
    assert memory_governance.row_matches_filters(receipt, filters) is False
    assert service["event_type"] != receipt["event_type"]
    assert service["fact_key"] != receipt["fact_key"]


def test_lifecycle_and_ingestion_bound_knowledge_time():
    retired = governed_row(
        "retired",
        "x",
        temporal={"kind": "state", "valid_from": "2026-01-01T00:00:00Z"},
        ingested_at="2026-01-01T00:00:00Z",
        extra={"memory_status": "superseded", "superseded_at": "2026-02-01T00:00:00Z"},
    )["metadata"]
    before = memory_governance.temporal_visibility(retired, as_known_at="2026-01-31T00:00:00Z")
    after = memory_governance.temporal_visibility(retired, as_known_at="2026-02-01T00:00:00Z")
    unborn = memory_governance.temporal_visibility(retired, as_known_at="2025-12-31T00:00:00Z")
    assert before.visible is True and before.admission == "known_by_as_known_at"
    assert after.visible is False and after.reason == "inactive_by_as_known_at"
    assert unborn.visible is False and unborn.reason == "ingested_after_as_known_at"


def test_legacy_rows_stay_visible_for_as_of_and_are_labelled_time_unknown(monkeypatch):
    governed_legacy = governed_row("governed-legacy", "legacy temporal fixture")
    raw_legacy = {
        "id": "raw-legacy",
        "text": "legacy temporal fixture",
        "metadata": librarian._normalize_memory_metadata(
            {"memory_principal_key": PRINCIPAL_A}, tenant_id=TENANT, workspace_id=WORKSPACE
        ),
    }
    assert "temporal_schema_version" not in governed_legacy["metadata"]
    install(monkeypatch, MemoryCollection([governed_legacy, raw_legacy]))

    current = search("legacy temporal fixture")
    history = search("legacy temporal fixture", as_of="2020-01-01T00:00:00Z")
    strict = search("legacy temporal fixture", as_of="2020-01-01T00:00:00Z", include_unknown_time=False)

    assert sorted(ids(current)) == ["governed-legacy", "raw-legacy"]
    # Live permissive semantics are preserved: legacy rows remain returned.
    assert sorted(ids(history)) == ["governed-legacy", "raw-legacy"]
    for row in history["results"]:
        assert row["temporal"]["schema_version"] is None
        assert row["temporal"]["time_known"] is False
        assert row["temporal"]["reason"] == "legacy_or_unspecified"
        assert row["temporal"]["admission"] == "legacy_temporal_unknown"
        assert row["metadata"]["temporal_admission"] == "legacy_temporal_unknown"
        assert row["metadata"]["temporal_query_match"] is False
        assert row["source_lineage"] == []
    for row in current["results"]:
        assert row["temporal"]["time_known"] is False
        assert "temporal_admission" not in row["metadata"]
    # Strict queries keep the live behaviour for rows without valid time.
    assert strict["results"] == []


def test_strict_prefilter_never_drops_v1_rows_and_python_recheck_is_authoritative(monkeypatch):
    event = governed_row(
        "event",
        MARKER,
        temporal={
            "kind": "event",
            "occurred_at": "2026-01-10T15:00:00Z",
            "precision": "instant",
        },
        ingested_at="2026-01-10T16:00:00Z",
    )
    install(monkeypatch, MemoryCollection([event]))
    filters = MemorySearchFilters.from_mapping(
        {"as_of": "2026-01-15T00:00:00Z", "include_unknown_time": False}
    )
    where = memory_governance.compile_chroma_where({"memory_principal_key": PRINCIPAL_A}, filters)
    assert {"temporal_schema_version": V1} in where["$and"][1]["$or"]
    assert MemoryCollection._matches(event["metadata"], where)

    assert ids(search(as_of="2026-01-15T00:00:00Z", include_unknown_time=False)) == ["event"]
    assert search(as_of="2026-01-09T00:00:00Z", include_unknown_time=False)["results"] == []


def test_structural_memory_address_filters_compile_and_recheck():
    filters = MemorySearchFilters.from_mapping(
        {"subjects": ["Jake"], "topics": ["memory-architecture"]}
    )
    where = memory_governance.compile_chroma_where(
        {"memory_principal_key": PRINCIPAL_A}, filters
    )

    assert {"subject": "Jake"} in where["$and"]
    assert {"topic": "memory-architecture"} in where["$and"]
    assert memory_governance.row_matches_filters(
        {
            "memory_status": "active",
            "subject": "Jake",
            "topic": "memory-architecture",
        },
        filters,
    ) is True
    assert memory_governance.row_matches_filters(
        {
            "memory_status": "active",
            "subject": "Morgan",
            "topic": "memory-architecture",
        },
        filters,
    ) is False
    assert memory_governance.row_matches_filters(
        {
            "memory_status": "active",
            "subject": "Jake",
            "topic": "billing",
        },
        filters,
    ) is False
    assert librarian.MemorySearchFilterRequest(
        subjects=["Jake"], topics=["memory-architecture"]
    ).model_dump(exclude_none=True) == {
        "subjects": ["Jake"],
        "topics": ["memory-architecture"],
        "include_stale": False,
        "include_unknown_time": True,
        "include_conflicts": False,
    }


# ---------------------------------------------------------------------------
# Request handling: top-level fields, conflicts and 422 vs 503
# ---------------------------------------------------------------------------


def test_filter_parse_problems_are_filter_errors_not_governance_outages():
    for value in ("2026-01-10", "2026-01-10T00:00:00", "yesterday"):
        with pytest.raises(MemoryFilterError):
            MemorySearchFilters.from_mapping({"as_of": value})
        with pytest.raises(MemoryFilterError):
            MemorySearchFilters.from_mapping({"as_known_at": value})


@pytest.mark.asyncio
async def test_top_level_temporal_fields_are_honoured_on_every_search_route(monkeypatch):
    patch_route_principals(monkeypatch)
    captured = []

    def fake_search(*args, **kwargs):
        captured.append(kwargs.get("filters"))
        return {"query": "q", "results": [], "search_mode": "semantic", "degraded": False, "warning": None}

    monkeypatch.setattr(librarian, "robust_search", fake_search)
    monkeypatch.setattr(librarian, "search_with_novelty", fake_search)
    monkeypatch.setattr(l22, "robust_search", fake_search)
    monkeypatch.setattr(l22, "search_with_novelty", fake_search)
    monkeypatch.setattr(knowledge, "robust_search", fake_search)

    top = {"as_of": "2026-01-15T00:00:00Z", "as_known_at": "2026-02-01T00:00:00+00:00", "include_temporally_unknown": False}
    await librarian.search_memory(librarian.SearchRequest(query="q", **top))
    await librarian.search_memory_novel(librarian.NovelSearchRequest(query="q", **top))
    await librarian.recall_memory(librarian.RecallRequest(query="q", **top))
    await l22.l22_search(l22.L22SearchRequest(query="q", **top))
    await l22.l22_search_novel(l22.L22NovelSearchRequest(query="q", **top))
    await knowledge.search_knowledge(knowledge.KnowledgeSearchRequest(query="q", **top))

    assert len(captured) == 6
    for filters in captured:
        assert filters.as_of == "2026-01-15T00:00:00.000000Z"
        assert filters.as_known_at == "2026-02-01T00:00:00.000000Z"
        assert filters.include_unknown_time is False

    captured.clear()
    # Not provided: live default (include unknown time) is kept.
    await librarian.search_memory(librarian.SearchRequest(query="q", as_of="2026-01-15T00:00:00Z"))
    assert captured[0].include_unknown_time is True
    # Same field both places with the same instant is fine.
    await librarian.search_memory(
        librarian.SearchRequest(
            query="q",
            as_of="2026-01-15T00:00:00Z",
            filters={"as_of": "2026-01-15T00:00:00+00:00", "statuses": ["active"]},
        )
    )
    assert captured[1].as_of == "2026-01-15T00:00:00.000000Z"
    assert captured[1].statuses == ("active",)

    conflicting = (
        (librarian.search_memory, librarian.SearchRequest(query="q", as_of="2026-01-15T00:00:00Z", filters={"as_of": "2026-01-16T00:00:00Z"})),
        (librarian.search_memory_novel, librarian.NovelSearchRequest(query="q", as_known_at="2026-01-15T00:00:00Z", filters={"as_known_at": "2026-01-16T00:00:00Z"})),
        (librarian.recall_memory, librarian.RecallRequest(query="q", include_temporally_unknown=False, filters={"include_unknown_time": True})),
        (l22.l22_search, l22.L22SearchRequest(query="q", as_of="2026-01-15T00:00:00Z", filters={"as_of": "2026-01-16T00:00:00Z"})),
        (l22.l22_search_novel, l22.L22NovelSearchRequest(query="q", as_of="2026-01-15T00:00:00Z", filters={"as_of": "2026-01-16T00:00:00Z"})),
        (knowledge.search_knowledge, knowledge.KnowledgeSearchRequest(query="q", as_of="2026-01-15T00:00:00Z", filters={"as_of": "2026-01-16T00:00:00Z"})),
    )
    for route, request in conflicting:
        with pytest.raises(HTTPException) as raised:
            await route(request)
        assert raised.value.status_code == 422
        assert "conflicts" in str(raised.value.detail)


@pytest.mark.asyncio
async def test_date_only_as_of_is_422_while_backend_failures_stay_503(monkeypatch):
    patch_route_principals(monkeypatch)
    install(monkeypatch, MemoryCollection())

    requests = (
        (librarian.search_memory, librarian.SearchRequest(query="q", as_of="2026-01-10")),
        (librarian.search_memory, librarian.SearchRequest(query="q", filters={"as_of": "2026-01-10"})),
        (librarian.search_memory_novel, librarian.NovelSearchRequest(query="q", filters={"as_known_at": "2026-01-10"})),
        (librarian.recall_memory, librarian.RecallRequest(query="q", as_known_at="2026-01-10")),
        (l22.l22_search, l22.L22SearchRequest(query="q", as_of="2026-01-10")),
        (l22.l22_search_novel, l22.L22NovelSearchRequest(query="q", filters={"as_of": "2026-01-10"})),
        (knowledge.search_knowledge, knowledge.KnowledgeSearchRequest(query="q", as_of="2026-01-10")),
    )
    for route, request in requests:
        with pytest.raises(HTTPException) as raised:
            await route(request)
        assert raised.value.status_code == 422, route.__name__

    def backend_down(*_args, **_kwargs):
        raise MemoryGovernanceError("governance database unavailable")

    monkeypatch.setattr(librarian, "robust_search", backend_down)
    monkeypatch.setattr(l22, "robust_search", backend_down)
    monkeypatch.setattr(knowledge, "robust_search", backend_down)
    for route, request in (
        (librarian.search_memory, librarian.SearchRequest(query="q", as_of="2026-01-10T00:00:00Z")),
        (l22.l22_search, l22.L22SearchRequest(query="q", as_of="2026-01-10T00:00:00Z")),
        (knowledge.search_knowledge, knowledge.KnowledgeSearchRequest(query="q", as_of="2026-01-10T00:00:00Z")),
    ):
        with pytest.raises(HTTPException) as raised:
            await route(request)
        assert raised.value.status_code == 503


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_temporal_block_and_declared_lineage_are_present_on_results(monkeypatch):
    patch_route_principals(monkeypatch)
    fact = governed_row(
        "fact",
        MARKER,
        temporal={
            "kind": "state",
            "valid_from": "2026-01-01T00:00:00Z",
            "valid_to": "2026-06-01T00:00:00Z",
            "source_authority": 70,
            "source_lineage": [
                {
                    "source_id": "synthetic-source",
                    "memory_id": "deleted-source-id",
                    "evidence_id": "line-12",
                    "version_id": "version-2",
                }
            ],
            "supersedes": ["prior-id"],
        },
        ingested_at="2026-01-02T00:00:00Z",
    )
    legacy = governed_row("legacy", MARKER)
    install(monkeypatch, MemoryCollection([fact, legacy]))

    response = await librarian.search_memory(
        librarian.SearchRequest(query=MARKER, n_results=5, as_of="2026-03-01T00:00:00Z")
    )
    assert response.as_of == "2026-03-01T00:00:00.000000Z"
    assert response.as_known_at is None
    assert response.temporal_contract_version == V1
    rows = {row.id: row for row in response.results}
    assert set(rows) == {"fact", "legacy"}
    block = rows["fact"].temporal
    assert block["schema_version"] == V1
    assert block["time_known"] is True
    assert block["kind"] == "state"
    assert block["valid_to"] == "2026-06-01T00:00:00.000Z"
    assert block["valid_from"].startswith("2026-01-01T00:00:00")
    assert block["supersedes"] == ["prior-id"]
    assert block["admission"] == "valid_at_as_of"
    lineage = rows["fact"].source_lineage[0]
    assert lineage["memory_id"] == "deleted-source-id"
    assert lineage["evidence_id"] == "line-12"
    assert lineage["version_id"] == "version-2"
    # Stage 2: a memory_id reference is checked (scoped, read-only) and the
    # deleted source is reported as missing; its content is never fabricated.
    assert lineage["source_availability"] == "missing_or_out_of_scope"
    assert lineage["source_available"] is False
    assert "content" not in lineage
    assert rows["legacy"].temporal["time_known"] is False
    assert rows["legacy"].temporal["valid_until"] is None
    assert rows["legacy"].source_lineage == []

    novel = await librarian.search_memory_novel(
        librarian.NovelSearchRequest(query=MARKER, as_of="2026-03-01T00:00:00Z")
    )
    assert novel.temporal_contract_version == V1
    assert all(row.temporal is not None for row in novel.results)

    l22_result = await l22.l22_search(l22.L22SearchRequest(query=MARKER, as_of="2026-03-01T00:00:00Z"))
    assert l22_result["temporal_contract_version"] == V1
    assert all("temporal" in row and "source_lineage" in row for row in l22_result["results"])
    knowledge_result = await knowledge.search_knowledge(
        knowledge.KnowledgeSearchRequest(query=MARKER, as_known_at="2026-03-01T00:00:00Z")
    )
    assert knowledge_result["as_known_at"] == "2026-03-01T00:00:00.000000Z"
    assert all("temporal" in row for row in knowledge_result["results"])


@pytest.mark.asyncio
async def test_non_temporal_requests_keep_their_existing_shape(monkeypatch):
    patch_route_principals(monkeypatch)
    install(monkeypatch, MemoryCollection([governed_row("legacy", MARKER)]))

    request_filters = librarian.MemorySearchFilterRequest(statuses=["active"])
    assert librarian.resolve_request_memory_filters(
        librarian.SearchRequest(query="q", filters=request_filters)
    ) == librarian.parse_memory_search_filters(request_filters)
    assert librarian.resolve_request_memory_filters(librarian.SearchRequest(query="q")) is None

    result = search()
    assert "as_of" not in result and "temporal_contract_version" not in result
    assert "temporal_admission" not in result["results"][0]["metadata"]

    l22_result = await l22.l22_search(l22.L22SearchRequest(query=MARKER))
    assert set(l22_result) == {"query", "results", "search_mode", "degraded", "warning"}
    knowledge_result = await knowledge.search_knowledge(knowledge.KnowledgeSearchRequest(query=MARKER))
    assert set(knowledge_result) == {"query", "results", "search_mode", "degraded", "available", "warning"}
    novel = await l22.l22_search_novel(l22.L22NovelSearchRequest(query=MARKER))
    assert set(novel) == {"query", "novelty_weight", "semantic_weight", "results"}
    response = await librarian.search_memory(librarian.SearchRequest(query=MARKER))
    assert response.as_of is None and response.temporal_contract_version is None


# ---------------------------------------------------------------------------
# Write paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_librarian_embed_applies_contract_before_governed_preparation(monkeypatch):
    collection = MemoryCollection()
    monkeypatch.setattr(librarian, "collection", collection)
    monkeypatch.setattr(l22, "collection", collection)
    request = librarian.EmbedRequest(
        text="contract governed write",
        metadata={"project": "temporal-stage1"},
        temporal={
            "kind": "state",
            "valid_from": "2026-01-01T00:00:00Z",
            "valid_to": "2026-02-01T00:00:00Z",
            "source_lineage": [{"source_id": "ledger", "evidence_id": "row-1"}],
        },
    )
    principal = librarian._route_memory_principal(request, None)

    response = await librarian.embed_memory(request)

    stored = collection.rows[response.id]["metadata"]
    assert stored["temporal_schema_version"] == V1
    assert stored["valid_to"] == "2026-02-01T00:00:00.000Z"
    assert stored["valid_from"].startswith("2026-01-01T00:00:00")
    assert stored["ingested_at"].endswith("Z")
    assert stored["privacy_classification"] == "private"  # admission ran on the result
    assert stored["observed_at_epoch"] and stored["valid_from_epoch"]
    assert "valid_until" not in stored
    native = librarian.prepare_memory_metadata_for_storage(stored)
    envelope_fields = json.loads(
        native.get(librarian._STORAGE_METADATA_FIELDS_KEY, '{"fields": {}}')
    )["fields"]
    for key in ("temporal_schema_version", "valid_to", "ingested_at", "source_lineage_json", "temporal_kind"):
        assert key in native and key not in envelope_fields

    monkeypatch.setattr(librarian, "_recover_fact_supersessions", lambda: None)
    key = principal.memory_principal_key
    common = dict(n_results=5, tenant_id=principal.tenant_id, workspace_id=principal.storage_workspace_id, memory_principal_key=key)
    inside = librarian.robust_search("contract governed write", filters=MemorySearchFilters.from_mapping({"as_of": "2026-01-31T00:00:00Z"}), **common)
    at_end = librarian.robust_search("contract governed write", filters=MemorySearchFilters.from_mapping({"as_of": "2026-02-01T00:00:00Z"}), **common)
    not_yet_known = librarian.robust_search("contract governed write", filters=MemorySearchFilters.from_mapping({"as_known_at": "2026-01-15T00:00:00Z"}), **common)
    assert ids(inside) == [response.id]
    assert at_end["results"] == []
    assert not_yet_known["results"] == []

    for bad in (
        librarian.EmbedRequest(text="x", metadata={"ingested_at": "2026-01-01T00:00:00Z"}, temporal={"kind": "fact"}),
        librarian.EmbedRequest(text="x", metadata={"temporal_schema_version": V1}),
        librarian.NovelEmbedRequest(text="x", metadata={"ingested_at": "2026-01-01T00:00:00Z"}, temporal={"kind": "fact"}),
    ):
        route = librarian.embed_memory if isinstance(bad, librarian.EmbedRequest) else librarian.embed_memory_novel
        with pytest.raises(HTTPException) as raised:
            await route(bad)
        assert raised.value.status_code == 422
    assert len(collection.rows) == 1


def test_l22_idempotent_temporal_store_stamps_ingestion_deterministically(monkeypatch):
    rows = {}

    class Collection:
        def get(self, ids, include):
            found = [row_id for row_id in ids if row_id in rows]
            return {"ids": found, "metadatas": [rows[row_id] for row_id in found]}

    def add_record(memory_id, _text, metadata, **_scope):
        rows[memory_id] = dict(metadata)

    monkeypatch.setattr(l22, "collection", Collection())
    monkeypatch.setattr(l22, "_add_memory_with_supersession", add_record)
    metadata = temporal_contract.prepare_temporal_write_metadata(
        {"lookup_key": "temporal-idempotency"},
        {"kind": "state", "valid_from": "2026-01-01T00:00:00Z"},
        stamp=False,
    )
    assert "ingested_at" not in metadata
    scope = {"tenant_id": TENANT, "workspace_id": WORKSPACE}

    first = l22.store_memory_record(content="temporal decision", metadata=metadata, idempotency_key="temporal-hook", **scope)
    replay = l22.store_memory_record(content="temporal decision", metadata=metadata, idempotency_key="temporal-hook", **scope)

    assert replay["id"] == first["id"]
    assert replay["idempotent_replay"] is True
    assert len(rows) == 1
    stored = rows[first["id"]]
    assert stored["temporal_schema_version"] == V1
    ingested = datetime.fromisoformat(stored["ingested_at"].replace("Z", "+00:00"))
    observed = datetime.fromisoformat(stored["observed_at"].replace("Z", "+00:00"))
    assert ingested == observed  # undeclared observation == ingestion instant

    plain = l22.store_memory_record(content="plain decision", metadata={"lookup_key": "plain"}, **scope)
    assert "temporal_schema_version" not in rows[plain["id"]]
    assert "ingested_at" not in rows[plain["id"]]


@pytest.mark.asyncio
async def test_l22_routes_reject_system_owned_temporal_keys(monkeypatch):
    patch_route_principals(monkeypatch)
    calls = []
    monkeypatch.setattr(l22, "store_memory_record", lambda **kwargs: calls.append(kwargs) or {"status": "stored"})
    monkeypatch.setattr(l22, "scoped_memory_metadata", lambda _principal, metadata: dict(metadata or {}))

    with pytest.raises(HTTPException) as raised:
        await l22.l22_store(
            l22.L22StoreRequest(content="x", metadata={"ingested_at": "2026-01-01T00:00:00Z"}, temporal={"kind": "fact"})
        )
    assert raised.value.status_code == 422
    with pytest.raises(HTTPException) as raised:
        await l22.l22_store(l22.L22StoreRequest(content="x", metadata={"temporal_schema_version": V1}))
    assert raised.value.status_code == 422
    assert calls == []

    await l22.l22_store(l22.L22StoreRequest(content="x", temporal={"kind": "state", "valid_from": "2026-01-01T00:00:00Z"}))
    forwarded = calls[0]["metadata"]
    assert forwarded["temporal_schema_version"] == V1
    assert "ingested_at" not in forwarded  # stamped inside store_memory_record
    await l22.l22_store(l22.L22StoreRequest(content="x", metadata={"note": "legacy"}))
    assert calls[1]["metadata"] == {"note": "legacy"}
