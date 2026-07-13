import json
import threading
from copy import deepcopy
from pathlib import Path

import pytest

from services.truth_engine.confabulation_detector import detect_confabulation
from services.truth_engine.pre_send_guard import guard_output
from services.world_state import snapshot_manager
from services.world_state.snapshot_manager import load_snapshot, rollback_snapshot, save_snapshot
from services.world_state.update_pipeline import apply_events, deterministic_merge, merge_event


def _snapshot(label="current", **extra):
    return {
        "version": "world_state.v1",
        "entities": {
            "service": {
                "state": {"status": label},
                "confidence": 0.9,
                "provenance": [f"probe:{label}"],
            }
        },
        **extra,
    }


def test_missing_load_keeps_legacy_empty_world_state_contract(tmp_path):
    assert load_snapshot(tmp_path / "missing.json") == {
        "version": "world_state.v1",
        "entities": {},
    }


@pytest.mark.parametrize(
    "bad_snapshot",
    [
        [],
        {"version": "world_state.v0", "entities": {}},
        {"version": "world_state.v1", "entities": []},
        {"version": "world_state.v1", "entities": {"x": {"state": []}}},
        {"version": "world_state.v1", "entities": {"x": {"provenance": {}}}},
        {"version": "world_state.v1", "entities": {"x": {"confidence": float("nan")}}},
    ],
)
def test_save_rejects_invalid_schema_and_non_json_values_without_touching_current(
    tmp_path, bad_snapshot
):
    target = tmp_path / "world.json"
    original = b'{"sentinel":"must remain byte-identical"}\n'
    target.write_bytes(original)

    with pytest.raises(ValueError):
        save_snapshot(target, bad_snapshot)

    assert target.read_bytes() == original


def test_save_is_fsynced_atomic_and_preserves_safe_schema_extensions(tmp_path, monkeypatch):
    target = tmp_path / "world.json"
    fsynced = []
    real_fsync = snapshot_manager.os.fsync

    def recording_fsync(fd):
        fsynced.append(fd)
        return real_fsync(fd)

    monkeypatch.setattr(snapshot_manager.os, "fsync", recording_fsync)
    value = _snapshot("healthy", checkpoint={"sequence": 7})

    assert save_snapshot(target, value) == target
    assert load_snapshot(target) == value
    assert len(fsynced) == 2  # temporary file, then containing directory
    assert not list(tmp_path.glob(f".{target.name}.*.tmp"))


def test_interrupted_atomic_replace_leaves_existing_bytes_and_cleans_temp(tmp_path, monkeypatch):
    target = tmp_path / "world.json"
    save_snapshot(target, _snapshot("old"))
    original = target.read_bytes()

    def interrupted_replace(_source, _target):
        raise OSError("simulated interruption before commit")

    monkeypatch.setattr(snapshot_manager.os, "replace", interrupted_replace)
    with pytest.raises(OSError, match="simulated interruption"):
        save_snapshot(target, _snapshot("new"))

    assert target.read_bytes() == original
    assert not list(tmp_path.glob(f".{target.name}.*.tmp"))


@pytest.mark.parametrize(
    "source_bytes",
    [
        None,
        b'{"version":"world_state.v1","entities":',
        b'{"version":"world_state.v1","entities":[],"x":1}',
        b'{"version":"world_state.v1","entities":{"x":{"confidence":NaN}}}',
        b'\xff\xfe not utf-8',
    ],
)
def test_rollback_missing_or_corrupt_source_fails_closed_byte_for_byte(tmp_path, source_bytes):
    current = tmp_path / "current.json"
    source = tmp_path / "rollback.json"
    save_snapshot(current, _snapshot("live"))
    before = current.read_bytes()
    if source_bytes is not None:
        source.write_bytes(source_bytes)

    error = FileNotFoundError if source_bytes is None else ValueError
    with pytest.raises(error):
        rollback_snapshot(current, source)

    assert current.read_bytes() == before


def test_rollback_commits_valid_snapshot_and_returns_same_value(tmp_path):
    current = tmp_path / "current.json"
    source = tmp_path / "rollback.json"
    save_snapshot(current, _snapshot("live"))
    expected = _snapshot("known-good", checkpoint={"sequence": 3})
    save_snapshot(source, expected)

    assert rollback_snapshot(current, source) == expected
    assert load_snapshot(current) == expected


def test_concurrent_saves_never_publish_partial_or_mixed_json(tmp_path):
    target = tmp_path / "world.json"
    workers = 12
    barrier = threading.Barrier(workers)
    errors = []

    def writer(index):
        try:
            barrier.wait(timeout=5)
            save_snapshot(target, _snapshot(f"writer-{index}", writer=index))
        except BaseException as exc:  # retain failures from worker threads for the assertion
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert not errors
    assert all(not thread.is_alive() for thread in threads)
    published = json.loads(target.read_text(encoding="utf-8"))
    winner = published["writer"]
    assert published == _snapshot(f"writer-{winner}", writer=winner)
    assert not list(tmp_path.glob(f".{target.name}.*.tmp"))


def test_lower_confidence_event_cannot_replace_values_or_claim_their_provenance():
    existing = {
        "entity_id": "svc",
        "kind": "service",
        "state": {"owner": "ops", "status": "healthy"},
        "confidence": 0.95,
        "provenance": ["signed-probe"],
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    incoming = {
        "entity_id": "svc",
        "state": {"status": "compromised", "region": "unknown"},
        "confidence": 0.2,
        "provenance": ["anonymous-report"],
        "updated_at": "2099-01-01T00:00:00+00:00",
    }

    merged = deterministic_merge(existing, incoming)

    assert merged["state"] == existing["state"]
    assert merged["confidence"] == 0.95
    assert merged["provenance"] == ["signed-probe"]
    assert merged["updated_at"] == existing["updated_at"]


def test_higher_confidence_event_updates_fields_with_matching_provenance():
    world = {
        "version": "world_state.v1",
        "entities": {
            "svc": {
                "entity_id": "svc",
                "state": {"owner": "ops", "status": "unknown"},
                "confidence": 0.4,
                "provenance": ["inventory"],
            }
        },
    }
    event = {
        "entity_id": "svc",
        "state": {"status": "healthy"},
        "confidence": 0.9,
        "provenance": ["signed-probe"],
        "updated_at": "2026-02-01T00:00:00+00:00",
    }

    entity = merge_event(world, event)["entities"]["svc"]

    assert entity["state"] == {"owner": "ops", "status": "healthy"}
    assert entity["confidence"] == 0.9
    assert entity["provenance"] == ["inventory", "signed-probe"]


def test_event_application_preserves_world_state_v1_shape_and_bounds_provenance():
    events = [
        {
            "entity_id": "svc",
            "state": {"sequence": i},
            "confidence": 0.8,
            "provenance": [f"event-{i}"],
        }
        for i in range(20)
    ]

    result = apply_events(events)

    assert set(result) == {"version", "entities"}
    assert result["version"] == "world_state.v1"
    assert result["entities"]["svc"]["state"] == {"sequence": 19}
    assert result["entities"]["svc"]["provenance"] == [f"event-{i}" for i in range(8, 20)]


@pytest.mark.parametrize("field,bad_value", [
    ("state", []),
    ("state", ""),
    ("state", 0),
    ("provenance", {}),
    ("provenance", ""),
    ("provenance", False),
])
def test_supplied_event_containers_fail_closed_without_mutating_inputs(field, bad_value):
    initial = _snapshot("unchanged", checkpoint={"sequence": [1]})
    event = {
        "entity_id": "new-service",
        "state": {"status": "healthy"},
        "provenance": ["probe"],
    }
    event[field] = bad_value
    initial_before = deepcopy(initial)
    event_before = deepcopy(event)

    with pytest.raises(ValueError):
        apply_events([event], initial_state=initial)

    assert initial == initial_before
    assert event == event_before


@pytest.mark.parametrize("field", ["state", "provenance"])
@pytest.mark.parametrize("value_mode", ["missing", "none"])
def test_missing_or_none_event_containers_use_empty_defaults(field, value_mode):
    event = {"entity_id": "svc", "confidence": 0.5}
    if value_mode == "none":
        event[field] = None

    entity = apply_events([event])["entities"]["svc"]

    assert entity["state"] == {}
    assert entity["provenance"] == []


def test_correctly_typed_empty_event_containers_are_preserved():
    event = {"entity_id": "svc", "state": {}, "provenance": []}

    result = apply_events([event])

    assert result["entities"]["svc"]["state"] == {}
    assert result["entities"]["svc"]["provenance"] == []
    assert result["entities"]["svc"]["state"] is not event["state"]
    assert result["entities"]["svc"]["provenance"] is not event["provenance"]


@pytest.mark.parametrize("bad_initial", [
    {},
    [],
    {"version": "world_state.v1"},
    {"entities": {}},
    {"version": "world_state.v0", "entities": {}},
    {"version": "world_state.v1", "entities": []},
    {"version": "world_state.v1", "entities": {"svc": {"state": []}}},
    {"version": "world_state.v1", "entities": {"svc": {"provenance": {}}}},
])
def test_supplied_initial_state_must_have_valid_required_schema_without_mutation(bad_initial):
    before = deepcopy(bad_initial)

    with pytest.raises(ValueError):
        apply_events([], initial_state=bad_initial)

    assert bad_initial == before


def test_valid_empty_initial_state_is_preserved_and_detached():
    initial = {"version": "world_state.v1", "entities": {}}

    result = apply_events([], initial_state=initial)

    assert result == initial
    assert result is not initial
    assert result["entities"] is not initial["entities"]


@pytest.mark.parametrize("field,bad_value", [("state", []), ("provenance", {})])
def test_invalid_existing_entity_container_rejects_without_partial_mutation(field, bad_value):
    world = _snapshot("unchanged")
    world["entities"]["service"][field] = bad_value
    before = deepcopy(world)

    with pytest.raises(ValueError):
        merge_event(world, {"entity_id": "service", "state": {}, "provenance": []})

    assert world == before


@pytest.mark.parametrize(
    "bad_count",
    [
        "1",
        True,
        -1,
        0.5,
        [],
        {},
        float("nan"),
        float("inf"),
        -float("inf"),
    ],
)
def test_malformed_contradiction_counts_are_blocked_instead_of_raising(bad_count):
    result = guard_output(
        claims=[{"claim_id": "claim-1", "evidence": ["source"], "contradiction_count": bad_count}]
    )

    assert result["action"] == "block"
    assert {issue["reason"] for issue in result["issues"]} == {
        "invalid_contradiction_metadata"
    }


def test_pathologically_large_contradiction_count_is_guarded_without_exception():
    result = guard_output(
        claims=[
            {
                "claim_id": "claim-large",
                "evidence": ["source"],
                "contradiction_count": 10**10000,
            }
        ]
    )

    assert result["action"] == "block"
    assert any(issue["reason"] == "invalid_contradiction_metadata" for issue in result["issues"])


@pytest.mark.parametrize("claims", [None, "claim", {"claim_id": "x"}, [42]])
def test_malformed_claim_container_is_fail_closed(claims):
    result = detect_confabulation(claims)

    assert result["flagged"] is True
    assert any(issue["reason"] == "invalid_claim_metadata" for issue in result["issues"])


def test_missing_evidence_clarifies_but_real_contradiction_blocks():
    clarify = guard_output(claims=[{"claim_id": "c1", "contradiction_count": 0}])
    blocked = guard_output(
        claims=[{"claim_id": "c2", "evidence": ["source"], "contradiction_count": 1}]
    )

    assert clarify["action"] == "clarify"
    assert blocked["action"] == "block"
