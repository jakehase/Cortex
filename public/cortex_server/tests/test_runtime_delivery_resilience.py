import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from cortex_server.modules.route_health import RouteHealthMonitor
from cortex_server.runtime.delivery_resilience import DeliveryDeadLetterStore, resilient_delivery_attempt
import cortex_server.runtime.delivery_resilience as delivery_resilience
import cortex_server.runtime.handoff_consumer as handoff_consumer
import cortex_server.runtime.production_build_loop as production_build_loop
import cortex_server.runtime.runtime_delivery_quota as runtime_delivery_quota
from cortex_server.runtime.production_build_loop import ingest_production_release_artifact
from cortex_server.runtime.release_workflow import (
    ReleaseArtifactReceipt,
    ReleaseWorkflowState,
    ReleaseWorkflowStore,
    canonical_release_artifact_bytes,
    release_artifact_attestation_signature,
    verify_release_artifact_receipt,
)


VERIFIER_ID = "resilience-independent-verifier"
VERIFIER_SECRET = "resilience-verifier-secret-000000000001"
CONTROLLER_BOOT_ID = "11111111-1111-4111-8111-111111111111"
CONTROLLER_BRAIN_ID = "cortex-brain-startup-revision:" + "a" * 32


def _rotation_intent(
    *,
    phase: str,
    generation: int,
    expected_generation: int,
    activate: str,
    retire: str,
):
    return {
        "phase": phase,
        "generation": generation,
        "expected_generation": expected_generation,
        "activate_verifier_ids": [activate],
        "retire_verifier_ids": [retire],
    }


def _release_state(store: ReleaseWorkflowStore, process_id: str) -> ReleaseWorkflowState:
    state = ReleaseWorkflowState(
        process_id=process_id,
        candidate_ref=f"build:{process_id}",
        target_environment="production",
        revision_id="rev_1",
    )
    return store.save(state)


def _ingest(
    store: ReleaseWorkflowStore,
    process_id: str,
    *,
    artifact_id: str,
    payload,
    signature: str | None = None,
):
    state = store.load(process_id)
    assert state is not None
    created_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    encoded = canonical_release_artifact_bytes(payload)
    content_hash = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
    unsigned = {
        "artifact_id": artifact_id,
        "artifact_ref": content_hash,
        "content_hash": content_hash,
        "artifact_kind": "release_bundle",
        "target_stage": None,
        "candidate_ref": state.candidate_ref,
        "release_id": state.release_id,
        "revision_id": state.revision_id,
        "producer": "resilience-builder",
        "verifier": VERIFIER_ID,
        "validation_outcome": "passed",
        "claims": {},
        "created_at": created_at,
    }
    return ingest_production_release_artifact(
        release_store=store,
        process_id=process_id,
        artifact_id=artifact_id,
        payload=payload,
        artifact_kind="release_bundle",
        producer="resilience-builder",
        verifier=VERIFIER_ID,
        attestation_signature=signature
        if signature is not None
        else release_artifact_attestation_signature(unsigned, secret=VERIFIER_SECRET),
        created_at=created_at,
    )


def test_resilient_delivery_attempt_records_failures_and_breaker_state(tmp_path: Path):
    monitor = RouteHealthMonitor(
        state_path=tmp_path / "route_health.json",
        failure_threshold=1,
        cooldown_seconds=60,
        half_open_max_probes=1,
    )
    dlq = DeliveryDeadLetterStore(tmp_path / "delivery_dlq.jsonl")

    failed = resilient_delivery_attempt(
        "discord",
        lambda: (_ for _ in ()).throw(RuntimeError("boom")),
        process_id="proc_123",
        event_kind="session.failed",
        payload={"x": 1},
        route_health=monitor,
        dlq_store=dlq,
    )
    blocked = resilient_delivery_attempt(
        "discord",
        lambda: {"ok": True},
        process_id="proc_123",
        event_kind="session.finished",
        payload={"x": 2},
        route_health=monitor,
        dlq_store=dlq,
    )

    assert failed["success"] is False
    assert failed["queued"] is True
    assert blocked["success"] is False
    assert blocked["reason"] in {"breaker_open", "half_open_probe_limit"}
    assert len(dlq.list()) == 2


def test_delivery_dead_letters_are_bounded_and_torn_tail_recoverable(tmp_path, monkeypatch):
    monkeypatch.setattr(delivery_resilience, "MAX_DELIVERY_DEAD_LETTERS", 2)
    store = DeliveryDeadLetterStore(tmp_path / "delivery_dlq.jsonl")
    for sequence in range(4):
        store.append(
            {
                "dependency": "runtime_session_event_ingest",
                "process_id": "proc_bounded_dlq",
                "error": f"failure-{sequence}",
                "payload": {"sequence": sequence},
            }
        )
    with store.path.open("ab") as handle:
        handle.write(b'{"entry_id":')

    assert [entry.payload["sequence"] for entry in store.list()] == [2, 3]
    store.append(
        {
            "dependency": "runtime_session_event_ingest",
            "process_id": "proc_bounded_dlq",
            "error": "failure-4",
            "payload": {"sequence": 4},
        }
    )
    assert [entry.payload["sequence"] for entry in store.list()] == [3, 4]


def test_invalid_and_oversized_artifacts_have_zero_durable_side_effects(tmp_path, monkeypatch):
    store = ReleaseWorkflowStore(tmp_path / "release")
    process_id = "proc_rejected_ingest"
    _release_state(store, process_id)
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({VERIFIER_ID: VERIFIER_SECRET}),
    )
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_MAX_BYTES", "16")
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_RELEASE_QUOTA_BYTES", "32")
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_STORE_QUOTA_BYTES", "64")
    before_state = store.load(process_id).model_dump()
    before_history = [row.model_dump() for row in store.history(process_id)]

    for index in range(8):
        with pytest.raises(PermissionError, match="attestation signature is invalid"):
            _ingest(
                store,
                process_id,
                artifact_id=f"artifact:invalid:{index}",
                payload=f"invalid-{index}",
                signature="0" * 64,
            )

    with pytest.raises(ValueError, match="exceeds maximum size"):
        _ingest(
            store,
            process_id,
            artifact_id="artifact:oversized",
            payload="x" * 17,
            signature="0" * 64,
        )

    assert store.load(process_id).model_dump() == before_state
    assert [row.model_dump() for row in store.history(process_id)] == before_history
    assert not list(store.artifact_store().path.glob("*/*.artifact"))
    assert not store.artifact_store().path.exists()


def test_artifact_publication_enforces_release_and_store_quotas_and_prunes_orphans(
    tmp_path,
    monkeypatch,
):
    store = ReleaseWorkflowStore(tmp_path / "release")
    first_process = "proc_release_quota"
    second_process = "proc_store_quota"
    _release_state(store, first_process)
    _release_state(store, second_process)
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({VERIFIER_ID: VERIFIER_SECRET}),
    )
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_MAX_BYTES", "24")
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_RELEASE_QUOTA_BYTES", "24")
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_STORE_QUOTA_BYTES", "36")
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_ORPHAN_GRACE_SECONDS", "0")

    _ingest(
        store,
        first_process,
        artifact_id="artifact:first-sixteen",
        payload="a" * 16,
    )
    with pytest.raises(ValueError, match="release artifact quota exceeded"):
        _ingest(
            store,
            first_process,
            artifact_id="artifact:release-over-quota",
            payload="b" * 9,
        )

    artifact_store = store.artifact_store()
    orphan_payload = b"orphan-ten"
    orphan_digest = hashlib.sha256(orphan_payload).hexdigest()
    orphan_target = artifact_store.path / orphan_digest[:2] / f"{orphan_digest}.artifact"
    orphan_target.parent.mkdir(parents=True, exist_ok=True)
    orphan_target.write_bytes(orphan_payload)
    abandoned_temp = orphan_target.with_name(f".{orphan_target.name}.abandoned.tmp")
    abandoned_temp.write_bytes(b"partial")

    _ingest(
        store,
        second_process,
        artifact_id="artifact:second-twenty",
        payload="c" * 20,
    )

    assert not orphan_target.exists()
    assert not abandoned_temp.exists()
    assert artifact_store.storage_usage_bytes() == 36
    with pytest.raises(ValueError, match="release artifact store quota exceeded"):
        _ingest(
            store,
            second_process,
            artifact_id="artifact:store-over-quota",
            payload="d",
        )
    assert artifact_store.storage_usage_bytes() == 36
    assert len(list(artifact_store.path.glob("*/*.artifact"))) == 2


def test_failed_receipt_persistence_removes_newly_published_orphan(tmp_path, monkeypatch):
    store = ReleaseWorkflowStore(tmp_path / "release")
    process_id = "proc_failed_receipt_save"
    _release_state(store, process_id)
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({VERIFIER_ID: VERIFIER_SECRET}),
    )

    def fail_save(*_args, **_kwargs):
        raise OSError("release state unavailable")

    monkeypatch.setattr(store, "save", fail_save)
    with pytest.raises(OSError, match="release state unavailable"):
        _ingest(
            store,
            process_id,
            artifact_id="artifact:must-not-orphan",
            payload="bounded-valid-payload",
        )

    assert not list(store.artifact_store().path.glob("*/*.artifact"))


def test_pending_release_save_keeps_new_artifact_reachable_until_restart_recovery(
    tmp_path,
    monkeypatch,
):
    store = ReleaseWorkflowStore(tmp_path / "release")
    process_id = "proc_pending_artifact_save"
    _release_state(store, process_id)
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({VERIFIER_ID: VERIFIER_SECRET}),
    )
    real_publish = store._publish_stage
    injected = {"raised": False}

    def fail_after_intent_and_history(stage, target):
        if target == store._target(process_id) and not injected["raised"]:
            injected["raised"] = True
            raise OSError("injected state publication failure")
        return real_publish(stage, target)

    monkeypatch.setattr(store, "_publish_stage", fail_after_intent_and_history)
    with pytest.raises(OSError, match="injected state publication failure"):
        _ingest(
            store,
            process_id,
            artifact_id="artifact:pending-save",
            payload="recoverable-published-artifact",
        )

    artifact_targets = list(store.artifact_store().path.glob("*/*.artifact"))
    assert len(artifact_targets) == 1
    artifact_ref = f"sha256:{artifact_targets[0].stem}"
    assert artifact_ref in store.referenced_artifact_refs()
    assert store.artifact_store().prune_orphans(
        store.referenced_artifact_refs(),
        grace_seconds=0,
    ) == []
    assert artifact_targets[0].exists()
    assert store._save_intent_target(process_id).exists()
    assert store._save_stage_target(process_id).exists()

    restarted = ReleaseWorkflowStore(tmp_path / "release")
    recovered = restarted.load(process_id)
    assert recovered is not None
    assert recovered.metadata["release_artifacts"][-1]["artifact_ref"] == artifact_ref
    assert restarted.artifact_store().resolve(artifact_ref) == canonical_release_artifact_bytes(
        "recoverable-published-artifact"
    )
    assert not restarted._save_intent_target(process_id).exists()
    assert not restarted._save_stage_target(process_id).exists()


def test_reference_scan_uncertainty_retains_pending_release_artifact(tmp_path, monkeypatch):
    store = ReleaseWorkflowStore(tmp_path / "release")
    process_id = "proc_uncertain_artifact_scan"
    _release_state(store, process_id)
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({VERIFIER_ID: VERIFIER_SECRET}),
    )
    real_publish = store._publish_stage
    injected = {"raised": False}

    def fail_after_save_intent(stage, target):
        if target == store._target(process_id) and not injected["raised"]:
            injected["raised"] = True
            raise OSError("injected state publication failure")
        return real_publish(stage, target)

    monkeypatch.setattr(store, "_publish_stage", fail_after_save_intent)
    real_reference_scan = store.referenced_artifact_refs
    scan_calls = {"count": 0}

    def fail_cleanup_reference_scan():
        scan_calls["count"] += 1
        if scan_calls["count"] >= 2:
            raise OSError("reference scan unavailable")
        return real_reference_scan()

    monkeypatch.setattr(store, "referenced_artifact_refs", fail_cleanup_reference_scan)

    with pytest.raises(OSError, match="injected state publication failure"):
        _ingest(
            store,
            process_id,
            artifact_id="artifact:uncertain-reference-scan",
            payload="recoverable-artifact-under-scan-fault",
        )

    artifact_targets = list(store.artifact_store().path.glob("*/*.artifact"))
    assert len(artifact_targets) == 1
    assert store._save_intent_target(process_id).exists()
    assert store._save_stage_target(process_id).exists()


def test_durable_verifier_trust_survives_add_drain_retire_restart_and_rejects_id_reuse(tmp_path, monkeypatch):
    delivery_root = tmp_path / "runtime_delivery"
    delivery_root.mkdir()
    store = ReleaseWorkflowStore(delivery_root / "release_workflow")
    process_id = "proc_verifier_rotation"
    _release_state(store, process_id)
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({VERIFIER_ID: VERIFIER_SECRET}),
    )
    _ingest(
        store,
        process_id,
        artifact_id="artifact:historical-verifier",
        payload="historically-verified-release",
    )
    state = store.load(process_id)
    historical_receipt = ReleaseArtifactReceipt.model_validate(state.metadata["release_artifacts"][0])

    initial_trust, initial_check = production_build_loop._durable_release_verifier_credentials(
        delivery_root,
        {VERIFIER_ID: VERIFIER_SECRET},
    )
    new_verifier = "resilience-independent-verifier-v2"
    new_secret = "resilience-verifier-secret-v2-00000000001"
    rotated_trust, rotated_check = production_build_loop._durable_release_verifier_credentials(
        delivery_root,
        {VERIFIER_ID: VERIFIER_SECRET, new_verifier: new_secret},
        rotation_intent=_rotation_intent(
            phase="overlap",
            generation=1,
            expected_generation=0,
            activate=new_verifier,
            retire=VERIFIER_ID,
        ),
    )
    restarted_trust, restarted_check = production_build_loop._durable_release_verifier_credentials(
        delivery_root,
        {new_verifier: new_secret},
        rotation_intent=_rotation_intent(
            phase="drained",
            generation=2,
            expected_generation=1,
            activate=new_verifier,
            retire=VERIFIER_ID,
        ),
    )

    assert initial_check["trustedVerifierCount"] == 1
    assert rotated_check["trustedVerifierCount"] == 2
    assert restarted_check["activeVerifierIds"] == [new_verifier]
    assert restarted_check["historicalVerifierIds"] == [VERIFIER_ID]
    assert (delivery_root / production_build_loop.RELEASE_VERIFIER_TRUST_FILE).stat().st_mode & 0o077 == 0
    assert initial_trust[VERIFIER_ID]["secret"] == VERIFIER_SECRET
    assert rotated_trust[new_verifier]["secret"] == new_secret
    verify_release_artifact_receipt(
        historical_receipt,
        artifact_store=store.artifact_store(),
        verifier_credentials=restarted_trust,
    )

    with pytest.raises(RuntimeError, match="cannot be reused with different key material"):
        production_build_loop._durable_release_verifier_credentials(
            delivery_root,
            {VERIFIER_ID: "different-resilience-secret-000000000001"},
        )


def test_verifier_activation_acceptance_and_retirement_share_monotonic_lifecycle(
    tmp_path,
    monkeypatch,
):
    delivery_root = tmp_path / "runtime_delivery"
    store = ReleaseWorkflowStore(delivery_root / "release_workflow")
    process_id = "proc_generation_ordered_verifier"
    _release_state(store, process_id)
    old_id = "ordered-verifier-old"
    old_secret = "ordered-verifier-old-secret-00000001"
    new_id = VERIFIER_ID
    new_secret = VERIFIER_SECRET
    production_build_loop._durable_release_verifier_credentials(
        delivery_root,
        {old_id: old_secret},
    )
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_CREDENTIALS",
        json.dumps({old_id: old_secret, new_id: new_secret}),
    )
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_ROTATION_INTENT",
        json.dumps(
            _rotation_intent(
                phase="overlap",
                generation=1,
                expected_generation=0,
                activate=new_id,
                retire=old_id,
            )
        ),
    )
    observed = []
    real_record = production_build_loop.record_release_artifact_receipt

    def assert_active_before_acceptance(*args, **kwargs):
        trust_payload = json.loads(
            (delivery_root / production_build_loop.RELEASE_VERIFIER_TRUST_FILE).read_text(
                encoding="utf-8"
            )
        )
        record = trust_payload["credentials"][new_id]
        observed.append(
            (
                record["activation_generation"],
                trust_payload["last_lifecycle_generation"],
            )
        )
        assert record["retirement_generation"] is None
        return real_record(*args, **kwargs)

    monkeypatch.setattr(
        production_build_loop,
        "record_release_artifact_receipt",
        assert_active_before_acceptance,
    )
    ingested = _ingest(
        store,
        process_id,
        artifact_id="artifact:generation-ordered",
        payload="generation-ordered-release",
    )
    receipt = ReleaseArtifactReceipt.model_validate(
        ingested["state"].metadata["release_artifacts"][0]
    )
    assert observed
    assert receipt.acceptance_generation == observed[0][1]
    assert observed[0][0] < receipt.acceptance_generation

    backwards = datetime.now(timezone.utc) - timedelta(days=7)
    monkeypatch.delenv("CORTEX_RELEASE_VERIFIER_ROTATION_INTENT")
    production_build_loop._durable_release_verifier_credentials(
        delivery_root,
        {new_id: new_secret},
        rotation_intent=_rotation_intent(
            phase="drained",
            generation=2,
            expected_generation=1,
            activate=new_id,
            retire=old_id,
        ),
    )
    next_id = "ordered-verifier-next"
    next_secret = "ordered-verifier-next-secret-0000001"
    production_build_loop._durable_release_verifier_credentials(
        delivery_root,
        {new_id: new_secret, next_id: next_secret},
        rotation_intent=_rotation_intent(
            phase="overlap",
            generation=3,
            expected_generation=2,
            activate=next_id,
            retire=new_id,
        ),
    )
    retired_trust, _ = production_build_loop._durable_release_verifier_credentials(
        delivery_root,
        {next_id: next_secret},
        now=backwards,
        rotation_intent=_rotation_intent(
            phase="drained",
            generation=4,
            expected_generation=3,
            activate=next_id,
            retire=new_id,
        ),
    )
    assert (
        retired_trust[new_id]["retirement_generation"]
        > receipt.acceptance_generation
    )
    verify_release_artifact_receipt(
        receipt,
        artifact_store=store.artifact_store(),
        verifier_credentials=retired_trust,
    )


def test_release_consumer_readiness_uses_monotonic_freshness_and_rejects_invalid_ages(
    monkeypatch,
):
    clocks = {"wall": 1000.0, "monotonic": 100.0}
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_HANDOFF_READY_MAX_AGE_SECONDS", "30")
    monkeypatch.setattr(handoff_consumer.time, "time", lambda: clocks["wall"])
    monkeypatch.setattr(
        handoff_consumer.time,
        "monotonic",
        lambda: clocks["monotonic"],
    )
    with handoff_consumer._POLL_STATUS_LOCK:
        handoff_consumer._POLL_STATUS.update(
            {
                "last_success_epoch": None,
                "last_success_monotonic": None,
                "last_success_at": None,
                "last_error": "authenticated poll has not succeeded",
                "capability_verified": False,
                "cortex_brain_startup_revision_id": None,
            }
        )

    handoff_consumer._record_poll_success(
        cortex_brain_startup_revision_id=CONTROLLER_BRAIN_ID,
        recipient="release-verifier",
        capability_verified=True,
    )
    clocks["wall"] = 100.0
    clocks["monotonic"] = 101.0
    corrected = handoff_consumer._consumer_readiness()
    assert corrected["ready"] is True
    assert corrected["last_success_age_seconds"] == 1.0

    clocks["monotonic"] = 99.0
    backwards = handoff_consumer._consumer_readiness()
    assert backwards["ready"] is False
    assert backwards["last_success_age_seconds"] is None
    assert backwards["freshness_error"] == "successful poll monotonic age is invalid"

    clocks["monotonic"] = float("nan")
    non_finite = handoff_consumer._consumer_readiness()
    assert non_finite["ready"] is False
    assert non_finite["last_success_age_seconds"] is None


def test_observation_turnover_reconciles_before_record_and_recovers_readiness(
    tmp_path,
    monkeypatch,
):
    controller_root = tmp_path / "release-controller"
    seeded = handoff_consumer._ObservationStore(controller_root)
    seeded._save(
        {
            "version": "cortex.release-controller-observations.v1",
            "windows": {
                f"stale:{index}": {
                    "boot_id": CONTROLLER_BOOT_ID,
                    "first_epoch": 1.0,
                    "last_epoch": 1.0,
                    "first_monotonic": 1.0,
                    "last_monotonic": 1.0,
                    "total": 1,
                    "succeeded": 1,
                }
                for index in range(4096)
            },
        }
    )
    before = seeded.path.read_bytes()
    with pytest.raises(RuntimeError, match="observation state is invalid"):
        seeded._save(
            {
                "version": "cortex.release-controller-observations.v1",
                "windows": {str(index): {} for index in range(4097)},
            }
        )
    assert seeded.path.read_bytes() == before

    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_RELEASE_CONTROLLER_ROLE", "verifier")
    monkeypatch.setenv("CORTEX_RELEASE_CONTROLLER_STATE_DIR", str(controller_root))
    monkeypatch.setenv("CORTEX_RELEASE_MEASUREMENT_URL", "http://cortex/health")
    monkeypatch.setattr(handoff_consumer, "_current_boot_id", lambda: CONTROLLER_BOOT_ID)
    monkeypatch.setattr(handoff_consumer, "_probe_measurement", lambda _url: True)
    monkeypatch.setattr(
        handoff_consumer,
        "_verify_verifier_capability",
        lambda _base_url, _instance_id: True,
    )
    monkeypatch.setattr(
        handoff_consumer,
        "_submit_verifier_evidence",
        lambda _base_url, _release, _window: None,
    )
    monkeypatch.setattr(
        handoff_consumer,
        "_post_json",
        lambda *_args, **_kwargs: {
            "success": True,
            "recipient": "release-verifier",
            "cortex_brain_startup_revision_id": CONTROLLER_BRAIN_ID,
            "verification_releases": [
                {
                    "process_id": "proc-active",
                    "release_id": "release-active",
                    "revision_id": "revision-active",
                    "target_stage": "canary",
                }
            ],
            "messages": [],
        },
    )
    with handoff_consumer._POLL_STATUS_LOCK:
        handoff_consumer._POLL_STATUS.update(
            {
                "last_success_epoch": None,
                "last_success_monotonic": None,
                "last_success_at": None,
                "last_error": "authenticated poll has not succeeded",
                "capability_verified": False,
                "cortex_brain_startup_revision_id": None,
            }
        )

    handoff_consumer._poll_once(
        "http://cortex",
        "release-verifier",
        "recipient-secret-material-000000000001",
    )

    reopened = handoff_consumer._ObservationStore(controller_root)
    windows = reopened._load()["windows"]
    assert list(windows) == ["verifier:release-active:revision-active:canary"]
    assert windows["verifier:release-active:revision-active:canary"]["total"] == 4
    assert handoff_consumer._consumer_readiness()["ready"] is True


def test_capacity_reservation_cleanup_remains_permitted_during_pending_rollback(
    tmp_path,
    monkeypatch,
):
    delivery_root = tmp_path / "runtime_delivery"
    reservation = runtime_delivery_quota.runtime_delivery_capacity_reservation(
        delivery_root,
        reserved_bytes=32 * 1024 * 1024,
    )
    reservation.__enter__()
    targets = list(
        (delivery_root / ".runtime-delivery-reservations").glob("*.json")
    )
    assert len(targets) == 1

    monkeypatch.setattr(
        runtime_delivery_quota,
        "_validated_pending_startup_recovery_intents",
        lambda _root: [{"status": "recovery_required"}],
    )
    reservation.__exit__(None, None, None)

    assert not targets[0].exists()


def test_expired_same_process_orphan_is_reclaimed_instead_of_renewed(
    tmp_path,
    monkeypatch,
):
    delivery_root = tmp_path / "runtime_delivery"
    reservation_root = delivery_root / ".runtime-delivery-reservations"
    reservation_root.mkdir(parents=True)
    token = "a" * 32
    target = reservation_root / f"{token}.json"
    identity = runtime_delivery_quota._current_process_identity()
    target.write_bytes(
        runtime_delivery_quota.encoded_json(
            {
                "version": "cortex.runtime-delivery-reservation.v2",
                "token": token,
                **identity,
                "created_at": 1000.0,
                "heartbeat_monotonic": 1000.0,
                "lease_expires_monotonic": 1600.0,
                "reserved_bytes": 32 * 1024 * 1024,
            }
        )
    )
    monkeypatch.setattr(runtime_delivery_quota, "_monotonic", lambda: 2600.0)

    with runtime_delivery_quota.runtime_delivery_quota_transaction(delivery_root):
        charged = runtime_delivery_quota._active_reservation_bytes_unlocked(
            delivery_root,
            prune_stale=True,
        )

    assert charged == 0
    assert not target.exists()
