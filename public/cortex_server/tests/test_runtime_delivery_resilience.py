import hashlib
import json
from pathlib import Path

import pytest

from cortex_server.modules.route_health import RouteHealthMonitor
from cortex_server.runtime.delivery_resilience import DeliveryDeadLetterStore, resilient_delivery_attempt
import cortex_server.runtime.production_build_loop as production_build_loop
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
CREATED_AT = "2026-07-16T05:00:00.000Z"


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
        "created_at": CREATED_AT,
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
        created_at=CREATED_AT,
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
    )
    restarted_trust, restarted_check = production_build_loop._durable_release_verifier_credentials(
        delivery_root,
        {new_verifier: new_secret},
    )

    assert initial_check["trustedVerifierCount"] == 1
    assert rotated_check["trustedVerifierCount"] == 2
    assert restarted_check["activeVerifierIds"] == [new_verifier]
    assert restarted_check["historicalVerifierIds"] == [VERIFIER_ID]
    assert (delivery_root / production_build_loop.RELEASE_VERIFIER_TRUST_FILE).stat().st_mode & 0o077 == 0
    assert initial_trust[VERIFIER_ID] == VERIFIER_SECRET
    assert rotated_trust[new_verifier] == new_secret
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
