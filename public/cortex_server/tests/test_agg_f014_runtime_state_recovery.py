import asyncio
import hashlib
import inspect
import json
import logging

import pytest

from cortex_server.modules.execution_transaction import (
    ExecutionTransaction,
    RetryPolicy,
    TransactionRecoveryError,
    TransactionStepError,
)
from cortex_server.modules import consciousness_integration
from cortex_server.routers import awareness, sentinel
from cortex_server.runtime import resilient_json_state
from cortex_server.runtime.resilient_json_state import (
    ResilientJSONStateStore,
    StateCorruptionError,
    StateRecoveryRequiredError,
)
from cortex_server.runtime.maintenance_queue import MaintenanceQueueItem, MaintenanceQueueStore


def _versioned_state(payload):
    if not isinstance(payload, dict) or type(payload.get("version")) is not int:
        raise ValueError("versioned state is invalid")
    return dict(payload)


def test_valid_backup_is_retained_when_atomic_restore_fails(tmp_path, monkeypatch):
    path = tmp_path / "state.json"
    store = ResilientJSONStateStore(path, validator=_versioned_state)
    store.save({"version": 1})
    backup = path.with_suffix(".json.bak")
    backup_bytes = backup.read_bytes()
    path.write_bytes(b"{corrupt-primary")

    monkeypatch.setattr(
        resilient_json_state.os,
        "replace",
        lambda *_args: (_ for _ in ()).throw(OSError("injected restore failure")),
    )

    with pytest.raises(StateCorruptionError, match="valid backup could not restore"):
        store.load(default_factory=lambda: {"version": 0})

    assert backup.read_bytes() == backup_bytes
    assert list(tmp_path.glob("state.json.bak.corrupt.*")) == []
    assert len(list(tmp_path.glob("state.json.corrupt.*"))) == 1
    assert store.health["reason"].startswith("primary_corrupt_backup_restore_failed")
    assert store.health["quarantine_path"] == "[REDACTED]"
    assert len(store.health["quarantine_path_sha256"]) == 64
    assert str(tmp_path) not in json.dumps(store.health)


def test_invalid_orphaned_backup_is_quarantined(tmp_path):
    path = tmp_path / "state.json"
    backup = path.with_suffix(".json.bak")
    malformed = b"{invalid-orphaned-backup"
    backup.write_bytes(malformed)
    store = ResilientJSONStateStore(path, validator=_versioned_state)

    with pytest.raises(StateCorruptionError, match="backup is invalid"):
        store.load(default_factory=lambda: {"version": 0})

    quarantines = list(tmp_path.glob("state.json.bak.corrupt.*"))
    assert len(quarantines) == 1 and quarantines[0].read_bytes() == malformed
    assert not path.exists()
    assert store.health["write_blocked"] is True


def test_save_time_recovery_requires_explicit_reload_before_overwrite(tmp_path):
    path = tmp_path / "state.json"
    store = ResilientJSONStateStore(path, validator=_versioned_state)
    store.save({"version": 1})
    path.write_bytes(b"{corrupt-after-load")

    with pytest.raises(StateRecoveryRequiredError, match="reload before saving"):
        store.save({"version": 2})

    assert json.loads(path.read_text(encoding="utf-8")) == {"version": 1}
    assert store.health["write_blocked"] is True
    with pytest.raises(StateRecoveryRequiredError, match="writes are blocked"):
        store.save({"version": 2})

    assert store.load(default_factory=lambda: {"version": 0}) == {"version": 1}
    store.save({"version": 2})
    assert json.loads(path.read_text(encoding="utf-8")) == {"version": 2}


def test_valid_but_stale_backup_is_repaired_before_it_can_roll_state_backward(
    tmp_path, monkeypatch
):
    path = tmp_path / "state.json"
    store = ResilientJSONStateStore(path, validator=_versioned_state)
    store.save({"version": 1})
    backup = path.with_suffix(".json.bak")
    original_atomic_write = store._atomic_write

    def fail_backup_once(target, encoded):
        if target == backup:
            raise OSError("injected backup failure")
        return original_atomic_write(target, encoded)

    monkeypatch.setattr(store, "_atomic_write", fail_backup_once)
    store.save({"version": 2})
    assert json.loads(path.read_text(encoding="utf-8")) == {"version": 2}
    assert json.loads(backup.read_text(encoding="utf-8")) == {"version": 1}
    assert store.health["reason"].startswith("backup_write_failed")

    monkeypatch.setattr(store, "_atomic_write", original_atomic_write)
    assert store.load(default_factory=lambda: {"version": 0}) == {"version": 2}
    assert json.loads(backup.read_text(encoding="utf-8")) == {"version": 2}
    assert store.health["reason"] == "stale_backup_replaced"

    path.write_bytes(b"{corrupt-latest-primary")
    recovered = ResilientJSONStateStore(path, validator=_versioned_state)
    assert recovered.load(default_factory=lambda: {"version": 0}) == {"version": 2}


def test_repeated_unrecoverable_loads_reuse_one_quarantine_evidence_file(tmp_path):
    path = tmp_path / "state.json"
    malformed = b"{same-corrupt-evidence"
    path.write_bytes(malformed)

    store = ResilientJSONStateStore(path, validator=_versioned_state)
    for candidate in (
        store,
        store,
        ResilientJSONStateStore(path, validator=_versioned_state),
    ):
        with pytest.raises(StateCorruptionError):
            candidate.load(default_factory=lambda: {"version": 0})

    quarantines = list(tmp_path.glob("state.json.corrupt.*"))
    assert len(quarantines) == 1
    assert quarantines[0].read_bytes() == malformed


def test_two_store_instances_reject_a_stale_snapshot_instead_of_losing_an_update(
    tmp_path,
):
    path = tmp_path / "state.json"
    first = ResilientJSONStateStore(path, validator=_versioned_state)
    stale = ResilientJSONStateStore(path, validator=_versioned_state)

    assert first.load(default_factory=lambda: {"version": 0}) == {"version": 0}
    assert stale.load(default_factory=lambda: {"version": 0}) == {"version": 0}

    first.save({"version": 1})
    with pytest.raises(StateRecoveryRequiredError, match="changed since it was loaded"):
        stale.save({"version": 2})

    assert json.loads(path.read_text(encoding="utf-8")) == {"version": 1}
    assert stale.health["reason"] == "stale_snapshot_conflict"
    assert stale.health["write_blocked"] is True

    assert stale.load(default_factory=lambda: {"version": 0}) == {"version": 1}
    stale.save({"version": 2})
    assert json.loads(path.read_text(encoding="utf-8")) == {"version": 2}


def _journal_payload(tx_id: str, tx_type: str = "audit"):
    return {
        "tx_id": tx_id,
        "tx_type": tx_type,
        "status": "initialized",
        "metadata": {},
        "started_at": "2026-01-01T00:00:00+00:00",
        "ended_at": "",
        "preflight": [],
        "steps": [],
        "rollbacks": [],
        "step_attempts_total": 0,
        "rollback_attempts_total": 0,
        "final_verification": None,
    }


@pytest.mark.parametrize(
    "payload",
    [
        b"{malformed-transaction-evidence",
        json.dumps(_journal_payload("different-transaction")).encode("utf-8"),
        json.dumps({**_journal_payload("tx_corrupt"), "steps": {}}).encode("utf-8"),
    ],
)
def test_transaction_invalid_journal_is_quarantined_without_overwrite(tmp_path, payload):
    journal = tmp_path / "tx_corrupt.json"
    journal.write_bytes(payload)

    with pytest.raises(TransactionRecoveryError, match="requires recovery") as exc_info:
        ExecutionTransaction("tx_corrupt", "audit", journal_dir=tmp_path)

    assert str(tmp_path) not in str(exc_info.value)
    assert journal.read_bytes() == payload
    quarantines = list(tmp_path.glob("tx_corrupt.json.corrupt.*"))
    assert len(quarantines) == 1
    assert quarantines[0].read_bytes() == payload
    assert not (tmp_path / "tx_corrupt.json.bak").exists()


def test_transaction_restores_last_known_good_and_marks_nonterminal_restart_indeterminate(tmp_path):
    ExecutionTransaction("tx_recover", "audit", journal_dir=tmp_path)
    journal = tmp_path / "tx_recover.json"
    corrupt = b"{interrupted-current-journal"
    journal.write_bytes(corrupt)

    recovered = ExecutionTransaction("tx_recover", "audit", journal_dir=tmp_path)

    assert recovered.state["status"] == "indeterminate"
    assert recovered.state["recovery"]["previous_status"] == "initialized"
    assert json.loads(journal.read_text(encoding="utf-8"))["status"] == "indeterminate"
    quarantines = list(tmp_path.glob("tx_recover.json.corrupt.*"))
    assert len(quarantines) == 1 and quarantines[0].read_bytes() == corrupt
    health = recovered.journal_health()
    assert health["last_recovery"]["recovered_from_backup"] is True


@pytest.mark.parametrize(
    ("failure", "persisted_status"),
    [
        (asyncio.CancelledError("cancel requested"), "cancelled"),
        (KeyboardInterrupt("runtime interrupted"), "indeterminate"),
    ],
)
def test_transaction_control_flow_interruptions_are_durable_and_propagated(
    tmp_path, failure, persisted_status
):
    tx = ExecutionTransaction("tx_interrupt", "audit", journal_dir=tmp_path)

    def interrupt():
        raise failure

    with pytest.raises(type(failure), match=str(failure)):
        tx.run_step("interruptible", interrupt)

    persisted = json.loads((tmp_path / "tx_interrupt.json").read_text(encoding="utf-8"))
    assert persisted["status"] == persisted_status
    assert persisted["steps"][-1]["status"] == persisted_status
    assert persisted["interruption_metadata"]["type"] == type(failure).__name__
    assert str(failure) not in (tmp_path / "tx_interrupt.json").read_text(encoding="utf-8")
    assert ExecutionTransaction("tx_interrupt", "audit", journal_dir=tmp_path).state["status"] == persisted_status


def test_transaction_atomic_write_failure_preserves_last_committed_journal(
    tmp_path, monkeypatch
):
    tx = ExecutionTransaction("tx_atomic", "audit", journal_dir=tmp_path)
    journal = tmp_path / "tx_atomic.json"
    prior = journal.read_bytes()

    def fail_replace(*_args):
        raise OSError("injected replace failure")

    monkeypatch.setattr(resilient_json_state.os, "replace", fail_replace)

    with pytest.raises(TransactionRecoveryError, match="persistence failed"):
        tx.preflight({})

    assert journal.read_bytes() == prior
    assert list(tmp_path.glob(".tx_atomic.json.*.tmp")) == []


def test_transaction_completion_journal_failure_never_reinvokes_handler(
    tmp_path, monkeypatch
):
    tx = ExecutionTransaction("tx_no_duplicate", "audit", journal_dir=tmp_path)
    tx.preflight({})
    original_atomic_write = tx._journal_store._atomic_write
    failed_once = False

    def fail_one_primary_commit(target, encoded):
        nonlocal failed_once
        if target == tx.journal_path and not failed_once:
            failed_once = True
            raise OSError("injected completion commit failure")
        return original_atomic_write(target, encoded)

    monkeypatch.setattr(tx._journal_store, "_atomic_write", fail_one_primary_commit)
    calls = []

    with pytest.raises(TransactionRecoveryError, match="completed but its journal transition"):
        tx.run_step(
            "external_side_effect",
            lambda: calls.append("called") or {"ok": True},
            retry_policy=RetryPolicy.for_kind("transient_io"),
        )

    assert calls == ["called"]
    assert tx.state["status"] == "indeterminate"
    with pytest.raises(TransactionRecoveryError, match="indeterminate transaction"):
        tx.run_step("external_side_effect", lambda: calls.append("called-again"))
    assert calls == ["called"]

def test_reopened_indeterminate_transaction_rejects_all_forward_execution(tmp_path):
    original = ExecutionTransaction("tx_reopened", "audit", journal_dir=tmp_path)
    original.preflight({})
    reopened = ExecutionTransaction("tx_reopened", "audit", journal_dir=tmp_path)
    calls = []

    with pytest.raises(TransactionRecoveryError, match="indeterminate transaction"):
        reopened.preflight({"must_not_run": lambda: calls.append("preflight")})
    with pytest.raises(TransactionRecoveryError, match="indeterminate transaction"):
        reopened.run_step("must_not_run", lambda: calls.append("step"))
    with pytest.raises(TransactionRecoveryError, match="indeterminate transaction"):
        reopened.finalize({"opaque": True})

    assert calls == []
    assert reopened.state["status"] == "indeterminate"


def test_transaction_journal_retains_only_diagnostic_metadata(tmp_path):
    markers = {
        "detail": "opaque-preflight-detail-6492d835",
        "output": "opaque-step-output-c05a97ce",
        "rollback": "opaque-rollback-result-4a4ff177",
        "failure": "opaque-handler-failure-ee954863",
        "top_error": "opaque-top-error-4b5ab5b6",
    }
    tx = ExecutionTransaction("tx_metadata_only", "audit", journal_dir=tmp_path)
    tx.preflight({"safe_check": lambda: {"ok": True, "note": markers["detail"]}})
    output = tx.run_step(
        "external",
        lambda: markers["output"],
        rollback=lambda _value: markers["rollback"],
    )
    assert tx.run_step("external", lambda: pytest.fail("idempotent handler reran")) == output
    tx.rollback()
    try:
        raise RuntimeError(markers["top_error"])
    except RuntimeError as exc:
        tx.fail(exc)

    failed = ExecutionTransaction("tx_metadata_failure", "audit", journal_dir=tmp_path)

    def fail_handler():
        raise RuntimeError(markers["failure"])

    with pytest.raises(TransactionStepError):
        failed.run_step("failure", fail_handler)

    for journal in (
        tmp_path / "tx_metadata_only.json",
        tmp_path / "tx_metadata_only.json.bak",
        tmp_path / "tx_metadata_failure.json",
        tmp_path / "tx_metadata_failure.json.bak",
    ):
        journal_text = journal.read_text(encoding="utf-8")
        assert not any(marker in journal_text for marker in markers.values())
        assert "traceback" not in journal_text.lower()

    persisted = json.loads((tmp_path / "tx_metadata_only.json").read_text(encoding="utf-8"))
    assert "detail" not in persisted["preflight"][0]
    assert persisted["preflight"][0]["detail_metadata"]["type"] == "dict"
    assert "output" not in persisted["steps"][0]
    assert persisted["steps"][0]["output_metadata"]["type"] == "str"
    assert "result" not in persisted["rollbacks"][0]
    assert persisted["rollbacks"][0]["result_metadata"]["type"] == "str"
    assert "error" not in persisted
    assert persisted["error_metadata"]["type"] == "RuntimeError"


def test_legacy_raw_transaction_journal_is_sanitized_in_place(tmp_path):
    marker = "opaque-legacy-journal-content-d2806f91"
    payload = _journal_payload("tx_legacy")
    payload.update(
        {
            "status": "completed",
            "ended_at": "2026-01-01T00:00:01+00:00",
            "preflight": [{"name": "legacy", "ok": True, "detail": marker}],
            "steps": [{"name": "legacy", "status": "completed", "output": marker}],
            "rollbacks": [{"step": "legacy", "status": "rolled_back", "result": marker}],
            "error": {"type": "RuntimeError", "message": marker, "traceback": marker},
        }
    )
    journal = tmp_path / "tx_legacy.json"
    journal.write_text(json.dumps(payload), encoding="utf-8")

    recovered = ExecutionTransaction("tx_legacy", "audit", journal_dir=tmp_path)

    for path in (journal, tmp_path / "tx_legacy.json.bak"):
        text = path.read_text(encoding="utf-8")
        assert marker not in text
        assert "traceback" not in text.lower()
    assert "output_metadata" in recovered.state["steps"][0]
    with pytest.raises(TransactionRecoveryError, match="output is not retained"):
        recovered.run_step("legacy", lambda: pytest.fail("legacy handler reran"))


@pytest.mark.asyncio
async def test_consciousness_internal_failures_log_only_safe_metadata(
    monkeypatch, caplog
):
    marker = "opaque-consciousness-exception-a4099c93"

    class BrokenCore:
        async def think(self, *_args, **_kwargs):
            raise RuntimeError(marker)

    class BrokenClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, *_args, **_kwargs):
            raise RuntimeError(marker)

    monkeypatch.setattr(consciousness_integration, "_get_core", lambda: BrokenCore())
    monkeypatch.setattr(consciousness_integration, "_get_bus", lambda: None)
    monkeypatch.setattr(
        consciousness_integration.httpx,
        "AsyncClient",
        lambda **_kwargs: BrokenClient(),
    )
    with caplog.at_level(logging.DEBUG, logger=consciousness_integration.logger.name):
        async with consciousness_integration.conscious_action("safe-level", "safe-action"):
            pass
        assert await consciousness_integration.chain_to("safe-level", "safe-endpoint") is None

    assert marker not in caplog.text
    assert "failure_type=RuntimeError" in caplog.text
    assert "exc_info=True" not in inspect.getsource(consciousness_integration)


@pytest.fixture
def isolated_sentinel(tmp_path, monkeypatch):
    path = tmp_path / "sentinel-watchers.json"
    monkeypatch.setattr(sentinel, "STATE_FILE", path)
    monkeypatch.setattr(sentinel, "_watcher_store_instance", None)
    monkeypatch.setattr(sentinel, "_watcher_store_path", None)
    monkeypatch.setenv(
        "CORTEX_SENTINEL_PERSISTENT_TARGETS",
        "https://example.test/health,https://example.test/new",
    )
    sentinel._watchers.clear()
    yield path
    sentinel._watchers.clear()


def _watcher(target="https://example.test/health"):
    return {
        "name": "example",
        "type": "endpoint",
        "target": target,
        "timeout_s": 2.5,
        "added_at": "2026-01-01T00:00:00+00:00",
    }


def test_sentinel_recovers_backup_and_surfaces_degraded_state(isolated_sentinel):
    path = isolated_sentinel
    assert sentinel._load_watchers() is True
    sentinel._watchers["watch_1"] = _watcher()
    sentinel._save_watchers()
    corrupt = b"{corrupt-watcher-state"
    path.write_bytes(corrupt)
    sentinel._watchers.clear()

    assert sentinel._load_watchers() is True
    assert sentinel._watchers == {"watch_1": _watcher()}
    health = sentinel.watcher_state_health()
    assert health["status"] == "degraded"
    assert health["recovered_from_backup"] is True
    status = asyncio.run(sentinel.sentinel_status())
    assert status["status"] == "degraded"
    quarantines = list(path.parent.glob(f"{path.name}.corrupt.*"))
    assert len(quarantines) == 1 and quarantines[0].read_bytes() == corrupt


def test_sentinel_unrecoverable_corruption_fails_closed_without_rewrite(isolated_sentinel):
    path = isolated_sentinel
    corrupt = b"{corrupt-without-backup"
    path.write_bytes(corrupt)
    sentinel._watchers["stale"] = _watcher("https://stale.invalid")

    assert sentinel._load_watchers() is False
    assert sentinel._watchers == {}
    assert path.read_bytes() == corrupt
    assert sentinel.watcher_state_health()["status"] == "degraded"
    assert asyncio.run(sentinel.sentinel_status())["status"] == "degraded"


def test_sentinel_failed_commit_rolls_back_in_memory_and_surfaces_503(
    isolated_sentinel, monkeypatch
):
    path = isolated_sentinel
    assert sentinel._load_watchers() is True
    prior = dict(sentinel._watchers)

    async def allow_destination(*_args, **_kwargs):
        return None

    monkeypatch.setattr(sentinel, "validate_destination", allow_destination)
    monkeypatch.setattr(
        sentinel, "assert_action_authorized", lambda *_args, **_kwargs: None
    )

    monkeypatch.setattr(
        resilient_json_state.os,
        "replace",
        lambda *_args: (_ for _ in ()).throw(OSError("injected replace failure")),
    )

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            sentinel.add_watcher(
                sentinel.WatchRequest(
                    name="new",
                    watch_type="endpoint",
                    target="https://example.test/new",
                ),
                object(),
            )
        )

    assert getattr(exc_info.value, "status_code", None) == 503
    assert sentinel._watchers == prior
    assert not path.exists()
    assert sentinel.watcher_state_health()["status"] == "degraded"


def test_awareness_recovers_last_known_good_and_reports_degraded(tmp_path, monkeypatch):
    path = tmp_path / "working-memory.json"
    monkeypatch.setattr(awareness, "WORKING_MEMORY_PATH", path)
    original = awareness.WorkingMemory()
    original.set_focus("retain this focus", {"source": "test"})
    assert original._save() is True
    corrupt = b"{corrupt-working-memory"
    path.write_bytes(corrupt)

    recovered = awareness.WorkingMemory()

    assert recovered.get_focus()["description"] == "[REDACTED]"
    assert recovered.get_focus()["description_sha256"] == hashlib.sha256(
        json.dumps("retain this focus", separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    assert recovered.persistence_health()["status"] == "degraded"
    monkeypatch.setattr(awareness, "_memory", recovered)
    monkeypatch.setattr(awareness, "_loop_running", False)
    status = asyncio.run(awareness.awareness_status())
    assert status["status"] == "degraded"
    assert status["persistence"]["recovered_from_backup"] is True
    quarantines = list(path.parent.glob(f"{path.name}.corrupt.*"))
    assert len(quarantines) == 1 and quarantines[0].read_bytes() == corrupt


def test_awareness_unrecoverable_corruption_never_overwrites_evidence(tmp_path, monkeypatch):
    path = tmp_path / "working-memory.json"
    corrupt = b"{corrupt-without-working-memory-backup"
    path.write_bytes(corrupt)
    monkeypatch.setattr(awareness, "WORKING_MEMORY_PATH", path)

    working_memory = awareness.WorkingMemory()

    assert working_memory.persistence_health()["status"] == "degraded"
    assert working_memory._save() is False
    assert path.read_bytes() == corrupt
    quarantines = list(path.parent.glob(f"{path.name}.corrupt.*"))
    assert len(quarantines) == 1 and quarantines[0].read_bytes() == corrupt


@pytest.mark.asyncio
async def test_awareness_http_mutation_is_redacted_and_durable_before_success(
    tmp_path, monkeypatch
):
    path = tmp_path / "working-memory.json"
    monkeypatch.setattr(awareness, "WORKING_MEMORY_PATH", path)
    working_memory = awareness.WorkingMemory()
    monkeypatch.setattr(awareness, "_memory", working_memory)
    opaque = "opaque-clinical-note-1234567890"

    response = await awareness.register_uncertainty(
        awareness.UncertaintyRequest(
            description=opaque,
            level="test",
            confidence=0.4,
        )
    )

    assert response["success"] is True
    persisted = path.read_text(encoding="utf-8")
    assert opaque not in persisted
    assert hashlib.sha256(json.dumps(opaque).encode("utf-8")).hexdigest() in persisted
    recovered = awareness.WorkingMemory()
    assert recovered.get_active_uncertainties()[0]["description"] == "[REDACTED]"


@pytest.mark.asyncio
async def test_awareness_acknowledges_durable_primary_when_backup_copy_degrades(
    tmp_path, monkeypatch
):
    path = tmp_path / "working-memory.json"
    monkeypatch.setattr(awareness, "WORKING_MEMORY_PATH", path)
    working_memory = awareness.WorkingMemory()
    monkeypatch.setattr(awareness, "_memory", working_memory)
    original_atomic_write = working_memory._state_store._atomic_write

    def fail_backup(target, encoded):
        if target == working_memory._state_store.backup_path:
            raise OSError("opaque-backup-failure-detail")
        return original_atomic_write(target, encoded)

    monkeypatch.setattr(working_memory._state_store, "_atomic_write", fail_backup)
    response = await awareness.register_uncertainty(
        awareness.UncertaintyRequest(
            description="opaque-durable-primary-note-1234567890",
            level="test",
            confidence=0.4,
        )
    )

    assert response["success"] is True
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored["uncertainties"][-1]["description"] == "[REDACTED]"
    assert working_memory.persistence_health()["reason"].startswith(
        "backup_write_failed"
    )


@pytest.mark.asyncio
async def test_awareness_http_mutation_rolls_back_and_returns_503_on_commit_failure(
    tmp_path, monkeypatch
):
    path = tmp_path / "working-memory.json"
    monkeypatch.setattr(awareness, "WORKING_MEMORY_PATH", path)
    working_memory = awareness.WorkingMemory()
    monkeypatch.setattr(awareness, "_memory", working_memory)
    prior = working_memory.get_state()
    monkeypatch.setattr(
        working_memory._state_store,
        "_atomic_write",
        lambda *_args: (_ for _ in ()).throw(OSError("injected commit failure")),
    )

    with pytest.raises(Exception) as unavailable:
        await awareness.make_prediction(
            awareness.PredictionRequest(
                prediction="must-not-be-acknowledged",
                confidence=0.6,
                basis="test",
            )
        )

    assert getattr(unavailable.value, "status_code", None) == 503
    assert working_memory.get_state() == prior
    assert not path.exists()


def test_maintenance_queue_recovers_last_known_good_and_reports_evidence(tmp_path):
    path = tmp_path / "maintenance-queue.json"
    store = MaintenanceQueueStore(path)
    store.enqueue(
        MaintenanceQueueItem(
            item_id="keep",
            objective="retain this work",
            source_text="recovery regression",
        )
    )
    corrupt = b"{corrupt-maintenance-queue"
    path.write_bytes(corrupt)

    recovered = MaintenanceQueueStore(path)
    assert [item.item_id for item in recovered.list()] == ["keep"]
    assert path.read_bytes() != corrupt
    quarantines = list(path.parent.glob(f"{path.name}.corrupt.*"))
    assert len(quarantines) == 1 and quarantines[0].read_bytes() == corrupt
    health = recovered.persistence_health()
    assert health["status"] == "degraded"
    assert health["recovered_from_backup"] is True
    assert health["write_blocked"] is False


def test_maintenance_queue_unrecoverable_corruption_blocks_mutation_without_overwrite(tmp_path):
    path = tmp_path / "maintenance-queue.json"
    corrupt = b"{corrupt-without-maintenance-backup"
    path.write_bytes(corrupt)
    store = MaintenanceQueueStore(path)

    with pytest.raises(ValueError, match="requires recovery"):
        store.enqueue(
            MaintenanceQueueItem(
                item_id="must-not-appear",
                objective="do not erase evidence",
                source_text="recovery regression",
            )
        )

    assert path.read_bytes() == corrupt
    quarantines = list(path.parent.glob(f"{path.name}.corrupt.*"))
    assert len(quarantines) == 1 and quarantines[0].read_bytes() == corrupt
    health = store.persistence_health()
    assert health["status"] == "degraded"
    assert health["write_blocked"] is True
