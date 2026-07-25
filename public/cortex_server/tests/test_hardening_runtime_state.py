import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from cortex_server.runtime.maintenance_queue import MaintenanceQueueItem, MaintenanceQueueStore
from cortex_server.runtime.session_contract import normalize_session_event
from cortex_server.runtime.session_registry import SessionRegistryStore


def _queue_item(item_id, *, status="pending", process_id=None, transition="2026-01-01T00:00:00Z", padding=""):
    return MaintenanceQueueItem(
        item_id=item_id,
        status=status,
        objective=f"objective {item_id}",
        source_text=f"source {item_id}{padding}",
        process_id=process_id,
        last_transition_at=transition,
    )


def _event(process_id, session_id, kind, summary):
    return normalize_session_event(
        process_id,
        kind,
        session_id=session_id,
        summary=summary,
        payload={"summary": summary},
    )


def test_session_concurrent_writers_do_not_erase_unrelated_records(tmp_path):
    path = tmp_path / "sessions.json"

    def register(index):
        # Separate instances exercise the process lock rather than only one mutex.
        SessionRegistryStore(path).register(process_id=f"proc-{index}", session_id=f"sess-{index}")

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(register, range(30)))

    rows = SessionRegistryStore(path).list()
    assert {(row.process_id, row.session_id) for row in rows} == {
        (f"proc-{index}", f"sess-{index}") for index in range(30)
    }


def test_concurrent_session_events_preserve_unique_questions(tmp_path):
    path = tmp_path / "sessions.json"
    SessionRegistryStore(path).register(process_id="proc", session_id="sess")

    def block(index):
        SessionRegistryStore(path).apply_event(_event("proc", "sess", "session.blocked", f"question-{index}"))

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(block, range(20)))

    record = SessionRegistryStore(path).get(process_id="proc", session_id="sess")
    assert record.status == "blocked"
    assert set(record.open_questions) == {f"question-{index}" for index in range(20)}


def test_session_registry_retains_active_and_newest_terminal_records(tmp_path):
    store = SessionRegistryStore(tmp_path / "sessions.json", max_sessions=3)
    store.register(process_id="active", session_id="active")
    for index in range(3):
        process = f"done-{index}"
        store.register(process_id=process, session_id=process)
        event = _event(process, process, "session.finished", "done")
        event.ts = f"2026-01-0{index + 1}T00:00:00Z"
        store.apply_event(event)

    rows = store.list()
    assert {row.process_id for row in rows} == {"active", "done-1", "done-2"}


def test_session_registry_rejects_excess_active_records_without_losing_prior_state(tmp_path):
    path = tmp_path / "sessions.json"
    store = SessionRegistryStore(path, max_sessions=1)
    store.register(process_id="keep", session_id="keep")
    prior = path.read_bytes()

    with pytest.raises(ValueError, match="active session count exceeds limit"):
        store.register(process_id="overflow", session_id="overflow")

    assert path.read_bytes() == prior
    assert [row.process_id for row in store.list()] == ["keep"]


@pytest.mark.parametrize(
    ("kwargs", "metadata", "questions", "message"),
    [
        ({"max_question_bytes": 5}, {}, ["123456"], "question exceeds size limit"),
        ({"max_metadata_bytes": 8}, {"payload": "too large"}, [], "metadata exceeds size limit"),
    ],
)
def test_session_item_byte_limits_fail_closed(tmp_path, kwargs, metadata, questions, message):
    path = tmp_path / "sessions.json"
    store = SessionRegistryStore(path, **kwargs)
    store.register(process_id="keep", session_id="keep")
    prior = path.read_bytes()

    with pytest.raises(ValueError, match=message):
        if questions:
            store.apply_event(_event("keep", "keep", "session.blocked", questions[0]))
        else:
            store.register(process_id="bad", session_id="bad", metadata=metadata)

    assert path.read_bytes() == prior


def test_question_count_is_bounded_deterministically(tmp_path):
    store = SessionRegistryStore(tmp_path / "sessions.json", max_questions=3)
    for index in range(5):
        store.apply_event(_event("proc", "sess", "session.blocked", f"q{index}"))
    assert store.get(process_id="proc", session_id="sess").open_questions == ["q2", "q3", "q4"]


@pytest.mark.parametrize("payload", [b"{not-json", b'{"unexpected":"object"}'])
def test_session_corruption_fails_closed_and_is_not_rewritten(tmp_path, payload):
    path = tmp_path / "sessions.json"
    path.write_bytes(payload)
    store = SessionRegistryStore(path)

    with pytest.raises((ValueError, json.JSONDecodeError)):
        store.register(process_id="new", session_id="new")

    assert path.read_bytes() == payload


def _persisted_session(**overrides):
    row = {
        "process_id": "proc",
        "session_id": "sess",
        "status": "registered",
        "source": "runtime",
        "stale_after_seconds": 900,
        "registered_at": "2026-01-01T00:00:00Z",
        "retry_count": 0,
        "open_questions": [],
        "watcher_ids": [],
        "parent_process": None,
        "metadata": {},
    }
    row.update(overrides)
    return row


@pytest.mark.parametrize(
    ("store_kwargs", "payload", "message"),
    [
        ({"max_sessions": 1}, [_persisted_session(), _persisted_session(session_id="other")], "record count"),
        ({}, [_persisted_session(open_questions={"question": "not-a-list"})], "open_questions must be a list"),
        ({"max_questions": 1}, [_persisted_session(open_questions=["one", "two"])], "question count"),
        ({"max_question_bytes": 4}, [_persisted_session(open_questions=["12345"])], "question exceeds"),
        ({}, [_persisted_session(open_questions=[1])], "questions must be strings"),
        ({}, [_persisted_session(metadata=[])], "metadata must be an object"),
        ({"max_metadata_bytes": 8}, [_persisted_session(metadata={"x": "123"})], "metadata exceeds"),
        ({}, [_persisted_session(retry_count="0")], "retry_count must be an integer"),
        ({}, [_persisted_session(watcher_ids="watcher")], "watcher_ids must be a list"),
        ({}, [_persisted_session(parent_process=[])], "parent_process must be an object"),
    ],
)
def test_session_load_rejects_externally_supplied_invalid_bounds_and_types(
    tmp_path, store_kwargs, payload, message
):
    path = tmp_path / "sessions.json"
    original = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    path.write_bytes(original)
    store = SessionRegistryStore(path, **store_kwargs)

    with pytest.raises(ValueError, match=message):
        store.get(process_id="proc", session_id="sess")
    assert path.read_bytes() == original

    with pytest.raises(ValueError, match=message):
        store.list()
    assert path.read_bytes() == original


def test_session_load_accepts_exact_question_and_metadata_byte_boundaries(tmp_path):
    path = tmp_path / "sessions.json"
    metadata = {"x": "é"}
    metadata_bytes = len(json.dumps(metadata, ensure_ascii=False).encode("utf-8"))
    payload = [_persisted_session(open_questions=["éé"], metadata=metadata)]
    original = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    path.write_bytes(original)

    rows = SessionRegistryStore(
        path, max_sessions=1, max_questions=1, max_question_bytes=4, max_metadata_bytes=metadata_bytes
    ).list()

    assert rows[0].open_questions == ["éé"]
    assert rows[0].metadata == metadata
    assert path.read_bytes() == original


def test_session_load_rejects_state_over_file_cap_without_read_bytes(tmp_path, monkeypatch):
    path = tmp_path / "sessions.json"
    original = b" " * 1025
    path.write_bytes(original)
    monkeypatch.setattr(type(path), "read_bytes", lambda _self: pytest.fail("unbounded read_bytes used"))

    with pytest.raises(ValueError, match="registry exceeds size limit"):
        SessionRegistryStore(path, max_state_bytes=1024).list()

    assert path.open("rb").read() == original


def test_session_atomic_write_interruption_preserves_previous_file(tmp_path, monkeypatch):
    from cortex_server.runtime import session_registry

    path = tmp_path / "sessions.json"
    store = SessionRegistryStore(path)
    store.register(process_id="keep", session_id="keep")
    prior = path.read_bytes()
    monkeypatch.setattr(session_registry.os, "replace", lambda *_: (_ for _ in ()).throw(OSError("injected")))

    with pytest.raises(OSError, match="injected"):
        store.register(process_id="new", session_id="new")

    assert path.read_bytes() == prior
    assert list(tmp_path.glob(".sessions.json.*.tmp")) == []


def test_session_atomic_write_fsyncs_file_and_parent_directory(tmp_path, monkeypatch):
    from cortex_server.runtime import session_registry

    calls = []
    real_fsync = session_registry.os.fsync
    monkeypatch.setattr(session_registry.os, "fsync", lambda fd: (calls.append(fd), real_fsync(fd))[1])
    SessionRegistryStore(tmp_path / "sessions.json").register(process_id="p", session_id="s")
    assert len(calls) >= 2


def test_maintenance_concurrent_enqueues_have_unique_identities_and_processes(tmp_path):
    path = tmp_path / "queue.json"

    def enqueue(index):
        item = MaintenanceQueueItem(
            objective=f"objective {index}", source_text=f"source {index}", process_id=f"proc-{index}"
        )
        MaintenanceQueueStore(path).enqueue(item)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(enqueue, range(30)))

    rows = MaintenanceQueueStore(path).list()
    assert len({row.item_id for row in rows}) == 30
    assert {row.process_id for row in rows} == {f"proc-{index}" for index in range(30)}


def test_maintenance_stale_version_cannot_erase_an_unrelated_enqueue(tmp_path):
    store = MaintenanceQueueStore(tmp_path / "queue.json")
    store.enqueue(_queue_item("first", process_id="proc-first"))
    stale_version = store.get_state().updated_at
    store.enqueue(_queue_item("concurrent", process_id="proc-concurrent"))

    with pytest.raises(RuntimeError, match="stale maintenance queue version"):
        store.replace_items([_queue_item("first", process_id="replacement")], expected_updated_at=stale_version)

    assert {(row.item_id, row.process_id) for row in store.list()} == {
        ("first", "proc-first"),
        ("concurrent", "proc-concurrent"),
    }


def test_maintenance_clock_rollback_cannot_reissue_stale_version(tmp_path, monkeypatch):
    from cortex_server.runtime import maintenance_queue

    store = MaintenanceQueueStore(tmp_path / "queue.json")
    monkeypatch.setattr(maintenance_queue, "_now_iso", lambda: "2026-01-01T00:00:00.000Z")
    store.enqueue(_queue_item("first", process_id="proc-first"))
    stale_version = store.get_state().updated_at

    monkeypatch.setattr(maintenance_queue, "_now_iso", lambda: "2026-01-01T00:00:01.000Z")
    store.enqueue(_queue_item("second", process_id="proc-second"))
    forward_version = store.get_state().updated_at

    # Rewind through the stale token. An unequal-only version check would
    # publish it again here and let the stale replacement pass its CAS.
    monkeypatch.setattr(maintenance_queue, "_now_iso", lambda: stale_version)
    store.enqueue(_queue_item("third", process_id="proc-third"))
    current_version = store.get_state().updated_at

    assert current_version > forward_version
    with pytest.raises(RuntimeError, match="stale maintenance queue version"):
        store.replace_items([_queue_item("first", process_id="replacement")], expected_updated_at=stale_version)
    assert {row.item_id for row in store.list()} == {"first", "second", "third"}


def test_maintenance_retention_preserves_active_and_newest_terminal(tmp_path):
    store = MaintenanceQueueStore(tmp_path / "queue.json", max_items=3)
    store.enqueue(_queue_item("active"))
    for index in range(3):
        store.enqueue(_queue_item(f"done-{index}", status="completed", transition=f"2026-01-0{index + 1}T00:00:00Z"))
    assert {row.item_id for row in store.list()} == {"active", "done-1", "done-2"}


def test_maintenance_corruption_and_interrupted_replace_preserve_prior_content(tmp_path, monkeypatch):
    from cortex_server.runtime import maintenance_queue

    path = tmp_path / "queue.json"
    path.write_bytes(b"not-json")
    with pytest.raises(json.JSONDecodeError):
        MaintenanceQueueStore(path).enqueue(_queue_item("new"))
    assert path.read_bytes() == b"not-json"

    path.unlink()
    store = MaintenanceQueueStore(path)
    store.enqueue(_queue_item("keep"))
    prior = path.read_bytes()
    monkeypatch.setattr(maintenance_queue.os, "replace", lambda *_: (_ for _ in ()).throw(OSError("injected")))
    with pytest.raises(OSError, match="injected"):
        store.enqueue(_queue_item("new"))
    assert path.read_bytes() == prior
    assert list(tmp_path.glob(".queue.json.*.tmp")) == []


@pytest.mark.parametrize("operation", ["list", "get", "claim"])
def test_maintenance_load_rejects_state_over_file_cap_without_unbounded_read(tmp_path, monkeypatch, operation):
    path = tmp_path / "queue.json"
    original = b" " * 1025
    path.write_bytes(original)
    monkeypatch.setattr(type(path), "read_bytes", lambda _self: pytest.fail("unbounded read_bytes used"))
    store = MaintenanceQueueStore(path, max_state_bytes=1024)

    with pytest.raises(ValueError, match="state exceeds size limit"):
        if operation == "list":
            store.list()
        elif operation == "get":
            store.get("missing")
        else:
            store.claim_next(claimed_at="2026-01-01T00:00:00Z", process_id_for_item=lambda row: "proc")

    assert path.open("rb").read() == original


@pytest.mark.parametrize("operation", ["list", "get", "claim"])
def test_maintenance_load_rejects_too_many_valid_items_via_all_read_paths(tmp_path, operation):
    path = tmp_path / "queue.json"
    payload = {
        "version": "cortex.maintenance_queue.v1",
        "updated_at": "2026-01-01T00:00:00Z",
        "max_active_items": 1,
        "items": [_item_dump_for_test(_queue_item("one")), _item_dump_for_test(_queue_item("two"))],
    }
    original = json.dumps(payload).encode("utf-8")
    path.write_bytes(original)
    store = MaintenanceQueueStore(path, max_items=1)

    with pytest.raises(ValueError, match="item count exceeds limit"):
        if operation == "list":
            store.list()
        elif operation == "get":
            store.get("one")
        else:
            store.claim_next(claimed_at="2026-01-01T00:00:00Z", process_id_for_item=lambda row: "proc")

    assert path.read_bytes() == original


def _item_dump_for_test(item):
    return item.model_dump() if hasattr(item, "model_dump") else item.dict()


def test_maintenance_load_accepts_exact_file_and_item_boundaries(tmp_path):
    path = tmp_path / "queue.json"
    payload = {
        "version": "cortex.maintenance_queue.v1",
        "updated_at": "2026-01-01T00:00:00Z",
        "max_active_items": 1,
        "items": [_item_dump_for_test(_queue_item("one"))],
    }
    encoded = json.dumps(payload).encode("utf-8")
    original = encoded + (b" " * (1024 - len(encoded)))
    assert len(original) == 1024
    path.write_bytes(original)

    rows = MaintenanceQueueStore(path, max_items=1, max_state_bytes=1024).list()

    assert [row.item_id for row in rows] == ["one"]
    assert path.read_bytes() == original


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ([], "state must be an object"),
        ({"items": {}}, "items must be a list"),
        ({"items": ["bad"]}, "items must be objects"),
    ],
)
def test_maintenance_load_rejects_malformed_container_types_without_rewrite(tmp_path, payload, message):
    path = tmp_path / "queue.json"
    original = json.dumps(payload).encode("utf-8")
    path.write_bytes(original)

    with pytest.raises(ValueError, match=message):
        MaintenanceQueueStore(path).list()

    assert path.read_bytes() == original
