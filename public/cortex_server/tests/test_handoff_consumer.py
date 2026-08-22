from __future__ import annotations

import json
import threading

import pytest

from cortex_server.runtime import handoff_consumer


BOOT_A = "11111111-1111-4111-8111-111111111111"
BOOT_B = "22222222-2222-4222-8222-222222222222"
BRAIN_A = "cortex-brain-startup-revision:" + "a" * 32
BRAIN_B = "cortex-brain-startup-revision:" + "b" * 32


def test_consumer_readiness_requires_a_fresh_authenticated_poll(monkeypatch):
    clock = {"now": 1000.0}
    monkeypatch.setattr(handoff_consumer.time, "time", lambda: clock["now"])
    monkeypatch.setenv("CORTEX_HANDOFF_READY_MAX_AGE_SECONDS", "10")
    monkeypatch.setenv("CORTEX_ENV", "production")
    with handoff_consumer._POLL_STATUS_LOCK:
        handoff_consumer._POLL_STATUS.update(
            {
                "last_success_epoch": None,
                "last_success_at": None,
                "last_error": "authenticated poll has not succeeded",
                "awaiting_evidence_count": 0,
                "capability_verified": False,
                "cortex_brain_startup_revision_id": None,
                "recipient": None,
            }
        )

    assert handoff_consumer._consumer_readiness()["ready"] is False

    handoff_consumer._record_poll_success(
        cortex_brain_startup_revision_id=BRAIN_A,
        recipient="release-verifier",
        capability_verified=True,
    )
    assert handoff_consumer._consumer_readiness()["ready"] is True

    clock["now"] += 4
    handoff_consumer._record_poll_error(PermissionError("bad recipient credential"))
    failed = handoff_consumer._consumer_readiness()
    assert failed["ready"] is False
    assert failed["capability_verified"] is False
    assert failed["cortex_brain_startup_revision_id"] is None

    clock["now"] += 7
    stale = handoff_consumer._consumer_readiness()
    assert stale["ready"] is False
    assert "PermissionError" in stale["last_error"]


def test_evidence_waiting_does_not_fail_authenticated_control_plane_readiness(monkeypatch):
    clock = {"now": 2000.0}
    monkeypatch.setattr(handoff_consumer.time, "time", lambda: clock["now"])
    monkeypatch.setenv("CORTEX_HANDOFF_READY_MAX_AGE_SECONDS", "10")
    with handoff_consumer._POLL_STATUS_LOCK:
        handoff_consumer._POLL_STATUS.update(
            {
                "last_success_epoch": None,
                "last_success_at": None,
                "last_error": "authenticated poll has not succeeded",
                "awaiting_evidence_count": 0,
            }
        )

    monkeypatch.setattr(
        handoff_consumer,
        "_post_json",
        lambda *_args, **_kwargs: {
            "success": True,
            "recipient": "release-verifier",
            "cortex_brain_startup_revision_id": BRAIN_A,
            "messages": [{"message_id": "handoff-pending"}],
        },
    )
    monkeypatch.setattr(
        handoff_consumer,
        "_process_message",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            handoff_consumer._EvidencePending("evidence is not ready")
        ),
    )

    handoff_consumer._poll_once("http://cortex", "release-verifier", "s" * 32)

    readiness = handoff_consumer._consumer_readiness()
    assert readiness["ready"] is True
    assert readiness["last_error"] is None
    assert readiness["awaiting_evidence_count"] == 1


def test_permanent_message_failure_does_not_refresh_readiness(monkeypatch):
    clock = {"now": 3000.0}
    monkeypatch.setattr(handoff_consumer.time, "time", lambda: clock["now"])
    monkeypatch.setenv("CORTEX_HANDOFF_READY_MAX_AGE_SECONDS", "10")
    with handoff_consumer._POLL_STATUS_LOCK:
        handoff_consumer._POLL_STATUS.update(
            {
                "last_success_epoch": 2980.0,
                "last_success_at": "previous",
                "last_error": None,
                "awaiting_evidence_count": 0,
            }
        )

    monkeypatch.setattr(
        handoff_consumer,
        "_post_json",
        lambda *_args, **_kwargs: {
            "success": True,
            "recipient": "release-verifier",
            "cortex_brain_startup_revision_id": BRAIN_A,
            "messages": [{"message_id": "handoff-broken"}],
        },
    )
    monkeypatch.setattr(
        handoff_consumer,
        "_process_message",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("invalid artifact")),
    )

    with pytest.raises(RuntimeError, match="invalid artifact"):
        handoff_consumer._poll_once("http://cortex", "release-verifier", "s" * 32)

    assert handoff_consumer._consumer_readiness()["ready"] is False
    with handoff_consumer._POLL_STATUS_LOCK:
        assert handoff_consumer._POLL_STATUS["last_success_epoch"] == 2980.0


def test_verifier_generates_revision_bound_signed_evidence_from_real_window(monkeypatch):
    monkeypatch.setattr(handoff_consumer, "_current_boot_id", lambda: BOOT_A)
    monkeypatch.setenv("CORTEX_RELEASE_VERIFIER_ID", "compose-release-verifier")
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET",
        "verifier-attestation-secret-material-00000001",
    )
    submissions = []
    monkeypatch.setattr(
        handoff_consumer,
        "_post_json",
        lambda base_url, path, payload: submissions.append((base_url, path, payload))
        or {"receipt": {"artifact_id": payload["artifact_id"]}},
    )
    release = {
        "process_id": "proc-controller-verifier",
        "release_id": "release-controller-verifier",
        "revision_id": "revision-controller-verifier",
        "candidate_ref": "build:controller-verifier",
        "target_stage": "canary_verified",
        "artifact_receipts": [
            {"artifact_kind": "release_bundle", "content_hash": "sha256:" + "a" * 64}
        ],
    }
    window = {
        "boot_id": BOOT_A,
        "first_epoch": 1000.0,
        "last_epoch": 1900.0,
        "first_monotonic": 100.0,
        "last_monotonic": 1000.0,
        "total": 1000,
        "succeeded": 1000,
    }

    receipt = handoff_consumer._submit_verifier_evidence("http://cortex", release, window)
    assert receipt["artifact_id"] == submissions[0][2]["artifact_id"]
    assert submissions[0][1].endswith("/artifacts/proc-controller-verifier")
    evidence = submissions[0][2]
    assert evidence["target_stage"] == "canary_verified"
    assert "revision-controller-verifier" in evidence["artifact_id"]
    assert evidence["claims"]["deployment_id"] == "release-controller-verifier"
    assert evidence["claims"]["cohort_id"] == (
        "canary_verified:revision-controller-verifier"
    )
    assert evidence["validation_outcome"] == "passed"
    assert evidence["claims"]["observation_window_seconds"] == 900
    assert evidence["claims"]["traffic_volume"] == 1000
    assert len(evidence["attestation_signature"]) == 64

    changed_window = {
        **window,
        "first_epoch": 2000.0,
        "last_epoch": 2900.0,
        "first_monotonic": 1100.0,
        "last_monotonic": 2000.0,
        "succeeded": 999,
    }
    handoff_consumer._submit_verifier_evidence("http://cortex", release, changed_window)
    assert submissions[1][2]["artifact_id"] != evidence["artifact_id"]


def test_production_verifier_sends_only_dedicated_artifact_transport_token(monkeypatch):
    captured = []
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN", "artifact-" + "a" * 32)
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "global-write-token-must-not-leak")

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps({"receipt": {"artifact_id": "evidence"}}).encode()

    def capture(request, timeout):
        captured.append((request, timeout))
        return Response()

    monkeypatch.setattr(handoff_consumer, "urlopen", capture)
    handoff_consumer._post_json(
        "http://cortex",
        "/orchestrator/runtime/delivery/artifacts/proc",
        {"artifact_id": "evidence"},
    )

    request, timeout = captured[0]
    assert timeout == 15
    assert request.get_header("X-cortex-release-artifact-token") == "artifact-" + "a" * 32
    assert request.get_header("X-cortex-write-token") is None


def test_bound_measurement_probe_sends_fresh_controller_signature(monkeypatch):
    secret = "measurement-controller-secret-material-0000001"
    monkeypatch.setenv("CORTEX_HANDOFF_RECIPIENT", "release-verifier")
    monkeypatch.setenv("CORTEX_HANDOFF_RECIPIENT_SECRET", secret)
    captured = []

    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _size=-1):
            return b"{}"

    def capture(request, timeout):
        captured.append((request, timeout))
        return Response()

    monkeypatch.setattr(handoff_consumer, "urlopen", capture)
    binding = {
        "process_id": "proc-probe",
        "release_id": "release-probe",
        "revision_id": "revision-probe",
        "target_stage": "canary_verified",
    }
    url = handoff_consumer._bound_measurement_url(
        "http://cortex/release-observation",
        binding,
        binding["target_stage"],
    )

    assert handoff_consumer._probe_measurement(url) is True
    request, timeout = captured[0]
    assert timeout == 5
    controller = request.get_header("X-cortex-release-controller")
    nonce = request.get_header("X-cortex-release-observation-nonce")
    requested_at = request.get_header("X-cortex-release-observation-at")
    signature = request.get_header("X-cortex-release-observation-signature")
    assert controller == "release-verifier"
    assert nonce.startswith("obs_")
    assert signature == handoff_consumer.runtime_delivery_release_observation_signature(
        controller=controller,
        nonce=nonce,
        requested_at=requested_at,
        secret=secret,
        **binding,
    )


def test_health_listener_bounds_slow_connections_before_thread_creation(monkeypatch):
    release = threading.Event()
    both_entered = threading.Event()
    threads = []

    class ObservedServer(handoff_consumer._BoundedHealthServer):
        active = 0
        peak = 0
        rejected = 0
        observation_lock = threading.Lock()

        def process_request_thread(self, request, client_address):
            with self.observation_lock:
                self.active += 1
                self.peak = max(self.peak, self.active)
                if self.peak == 2:
                    both_entered.set()
            try:
                release.wait(timeout=1)
            finally:
                with self.observation_lock:
                    self.active -= 1
                self._connection_slots.release()

        def shutdown_request(self, request):
            self.rejected += 1

    def start_thread(server, request, client_address):
        thread = threading.Thread(
            target=server.process_request_thread,
            args=(request, client_address),
        )
        threads.append(thread)
        thread.start()

    monkeypatch.setattr(
        handoff_consumer.ThreadingHTTPServer,
        "process_request",
        start_thread,
    )
    server = ObservedServer.__new__(ObservedServer)
    server._connection_slots = threading.BoundedSemaphore(2)
    server._socket_timeout_seconds = 0.5

    for index in range(16):
        server.process_request(object(), ("client", index))
    assert both_entered.wait(timeout=1)
    assert server.peak == 2
    assert len(threads) == 2
    assert server.rejected == 14

    class FakeSocket:
        timeout = None

        def settimeout(self, value):
            self.timeout = value

    accepted = FakeSocket()
    monkeypatch.setattr(
        handoff_consumer.ThreadingHTTPServer,
        "get_request",
        lambda _server: (accepted, ("client", 1)),
    )
    assert server.get_request()[0] is accepted
    assert accepted.timeout == 0.5

    release.set()
    for thread in threads:
        thread.join(timeout=1)


def test_manager_invokes_signed_idempotent_rollback_after_full_failure_window(monkeypatch, tmp_path):
    requests = []
    monkeypatch.setattr(handoff_consumer, "_current_boot_id", lambda: BOOT_A)
    monkeypatch.setattr(
        handoff_consumer,
        "_record_measurement_burst",
        lambda *_args, **_kwargs: {
            "boot_id": BOOT_A,
            "first_epoch": 1000.0,
            "last_epoch": 1900.0,
            "first_monotonic": 100.0,
            "last_monotonic": 1000.0,
            "total": 1000,
            "succeeded": 970,
        },
    )
    monkeypatch.setattr(
        handoff_consumer,
        "_post_json",
        lambda base_url, path, payload: requests.append((base_url, path, payload)) or {"applied": True},
    )
    release = {
        "process_id": "proc-controller-manager",
        "release_id": "release-controller-manager",
        "revision_id": "revision-controller-manager",
    }
    secret = "manager-recipient-secret-material-000000001"
    store = handoff_consumer._ObservationStore(tmp_path / "controller-state")

    handoff_consumer._monitor_managed_release(
        "http://cortex",
        secret,
        store,
        release,
        "http://cortex/release-observation",
    )
    assert requests[0][1] == (
        "/orchestrator/runtime/delivery/handoffs/manager-rollback/proc-controller-manager"
    )
    payload = requests[0][2]
    assert payload["reason"] == "post_promotion_health_policy_failure"
    assert payload["idempotency_key"].startswith(
        "health:release-controller-manager:revision-controller-manager:"
    )
    assert len(payload["manager_signature"]) == 64


def test_production_controller_readiness_requires_live_measurement_capability(monkeypatch):
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_HANDOFF_READY_MAX_AGE_SECONDS", "30")
    with handoff_consumer._POLL_STATUS_LOCK:
        handoff_consumer._POLL_STATUS.update(
            {
                "last_success_epoch": handoff_consumer.time.time(),
                "last_success_at": "now",
                "last_error": None,
                "capability_verified": False,
                "cortex_brain_startup_revision_id": None,
                "recipient": "release-verifier",
            }
        )
    assert handoff_consumer._consumer_readiness()["ready"] is False
    with handoff_consumer._POLL_STATUS_LOCK:
        handoff_consumer._POLL_STATUS.update(
            {
                "capability_verified": True,
                "cortex_brain_startup_revision_id": BRAIN_A,
            }
        )
    assert handoff_consumer._consumer_readiness()["ready"] is True


def test_worker_reauthenticates_capability_for_exact_restarted_brain_instance(
    monkeypatch,
):
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv("CORTEX_RELEASE_MEASUREMENT_URL", "http://cortex/health")
    monkeypatch.setenv("CORTEX_RELEASE_VERIFIER_ID", "compose-release-verifier")
    monkeypatch.setenv(
        "CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET",
        "verifier-attestation-secret-material-00000001",
    )
    monkeypatch.setattr(handoff_consumer, "_probe_measurement", lambda _url: True)

    class EmptyObservationStore:
        def retain(self, _keys):
            return None

    monkeypatch.setattr(
        handoff_consumer,
        "_observation_store",
        lambda: EmptyObservationStore(),
    )
    server = {"poll": BRAIN_A, "capability": BRAIN_A}

    def respond(_base_url, path, payload):
        if path.endswith("/claim-next"):
            return {
                "success": True,
                "recipient": "release-verifier",
                "cortex_brain_startup_revision_id": server["poll"],
                "messages": [],
                "verification_releases": [],
            }
        if path.endswith("/verifier-capability"):
            return {
                "success": True,
                "capability": "revision-bound-artifact-attestation",
                "verifier": payload["verifier"],
                "cortex_brain_startup_revision_id": server["capability"],
            }
        raise AssertionError(path)

    monkeypatch.setattr(handoff_consumer, "_post_json", respond)
    with handoff_consumer._POLL_STATUS_LOCK:
        handoff_consumer._POLL_STATUS.update(
            {
                "last_success_epoch": None,
                "last_success_at": None,
                "last_error": "authenticated poll has not succeeded",
                "capability_verified": False,
                "cortex_brain_startup_revision_id": None,
                "recipient": None,
            }
        )

    handoff_consumer._poll_once(
        "http://cortex",
        "release-verifier",
        "verifier-recipient-secret-material-000000001",
    )
    assert handoff_consumer._consumer_readiness()["ready"] is True

    # A cortex-brain-only restart changes the discovery identity.  A retained
    # capability response from the prior instance cannot keep the worker ready.
    server["poll"] = BRAIN_B
    handoff_consumer._poll_once(
        "http://cortex",
        "release-verifier",
        "verifier-recipient-secret-material-000000001",
    )
    stale = handoff_consumer._consumer_readiness()
    assert stale["ready"] is False
    assert stale["capability_verified"] is False
    assert stale["cortex_brain_startup_revision_id"] == BRAIN_B

    server["capability"] = BRAIN_B
    handoff_consumer._poll_once(
        "http://cortex",
        "release-verifier",
        "verifier-recipient-secret-material-000000001",
    )
    rebound = handoff_consumer._consumer_readiness()
    assert rebound["ready"] is True
    assert rebound["cortex_brain_startup_revision_id"] == BRAIN_B


def test_controller_observation_store_fails_closed_on_missing_or_symlinked_state(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.delenv("CORTEX_RELEASE_CONTROLLER_REQUIRE_EXISTING_STATE", raising=False)
    missing = handoff_consumer._ObservationStore(tmp_path / "missing-controller")
    with pytest.raises(RuntimeError, match="observation state is missing"):
        missing.retain(set())
    monkeypatch.setenv(
        "CORTEX_RELEASE_CONTROLLER_STATE_DIR", str(tmp_path / "startup-controller")
    )
    with pytest.raises(RuntimeError, match="observation state is missing"):
        handoff_consumer._observation_store()

    external = tmp_path / "external-observations.json"
    external.write_text(
        '{"version":"cortex.release-controller-observations.v1","windows":{}}\n',
        encoding="utf-8",
    )
    linked = handoff_consumer._ObservationStore(tmp_path / "linked-controller")
    linked.path.symlink_to(external)
    with pytest.raises(RuntimeError, match="missing|regular non-symlink"):
        linked.retain(set())


def test_manager_restart_preserves_qualified_rollback_window(monkeypatch, tmp_path):
    key = "manager:release-preserved:revision-preserved"
    controller_root = tmp_path / "manager-controller"
    initial = handoff_consumer._ObservationStore(controller_root)
    initial._save(
        {
            "version": "cortex.release-controller-observations.v1",
            "windows": {
                key: {
                    "boot_id": BOOT_A,
                    "first_epoch": 1000.0,
                    "last_epoch": 1899.0,
                    "first_monotonic": 100.0,
                    "last_monotonic": 999.0,
                    "total": 999,
                    "succeeded": 0,
                }
            },
        }
    )
    monkeypatch.setenv("CORTEX_RELEASE_CONTROLLER_REQUIRE_EXISTING_STATE", "true")
    reopened = handoff_consumer._ObservationStore(controller_root)
    monkeypatch.setattr(handoff_consumer.time, "time", lambda: 1900.0)
    monkeypatch.setattr(handoff_consumer.time, "monotonic", lambda: 1000.0)
    monkeypatch.setattr(handoff_consumer, "_current_boot_id", lambda: BOOT_A)
    monkeypatch.setattr(handoff_consumer, "_probe_measurement", lambda _url: False)
    requests = []
    monkeypatch.setattr(
        handoff_consumer,
        "_post_json",
        lambda base_url, path, payload: requests.append((base_url, path, payload))
        or {"applied": True},
    )

    handoff_consumer._monitor_managed_release(
        "http://cortex",
        "manager-recipient-secret-material-000000001",
        reopened,
        {
            "process_id": "proc-preserved",
            "release_id": "release-preserved",
            "revision_id": "revision-preserved",
        },
        "http://cortex/release-observation",
    )

    assert len(requests) == 1
    assert requests[0][1].endswith("/manager-rollback/proc-preserved")
    assert key not in reopened.path.read_text(encoding="utf-8")


def test_observation_window_restarts_after_clock_step_or_reboot(monkeypatch, tmp_path):
    store = handoff_consumer._ObservationStore(tmp_path / "controller")
    first = store.record(
        "verifier:release:revision:canary",
        success=True,
        observed_at=1000.0,
        monotonic_at=100.0,
        boot_id=BOOT_A,
    )
    assert first["total"] == 1

    stepped = store.record(
        "verifier:release:revision:canary",
        success=True,
        observed_at=1900.0,
        monotonic_at=100.0,
        boot_id=BOOT_A,
    )
    assert stepped["total"] == 1
    assert stepped["first_epoch"] == stepped["last_epoch"] == 1900.0
    assert stepped["first_monotonic"] == stepped["last_monotonic"] == 100.0

    rebooted = store.record(
        "verifier:release:revision:canary",
        success=True,
        observed_at=1910.0,
        monotonic_at=2.0,
        boot_id=BOOT_B,
    )
    assert rebooted["total"] == 1
    assert rebooted["boot_id"] == BOOT_B
    monkeypatch.setattr(handoff_consumer, "_current_boot_id", lambda: BOOT_B)
    assert handoff_consumer._window_metrics(rebooted)[1] == 0


def test_wall_epoch_only_or_prior_boot_window_cannot_qualify(monkeypatch):
    monkeypatch.setattr(handoff_consumer, "_current_boot_id", lambda: BOOT_B)
    wall_only = {
        "first_epoch": 1000.0,
        "last_epoch": 1900.0,
        "total": 1000,
        "succeeded": 1000,
    }
    prior_boot = {
        **wall_only,
        "boot_id": BOOT_A,
        "first_monotonic": 100.0,
        "last_monotonic": 1000.0,
    }
    assert handoff_consumer._window_metrics(wall_only)[1] == 0
    assert handoff_consumer._window_metrics(prior_boot)[1] == 0


def test_manager_capability_challenge_uses_rollback_route_and_signature(monkeypatch):
    secret = "manager-recipient-secret-material-000000001"
    requests = []

    def respond(base_url, path, payload):
        requests.append((base_url, path, payload))
        expected = handoff_consumer.runtime_delivery_manager_rollback_signature(
            process_id=handoff_consumer.RUNTIME_DELIVERY_MANAGER_CAPABILITY_PROCESS_ID,
            release_id=payload["release_id"],
            revision_id=payload["revision_id"],
            idempotency_key=payload["idempotency_key"],
            reason=payload["reason"],
            request_id=payload["request_id"],
            requested_at=payload["requested_at"],
            secret=secret,
        )
        assert payload["manager_signature"] == expected
        return {
            "success": True,
            "capability": "signed-non-mutating-manager-rollback",
            "cortex_brain_startup_revision_id": BRAIN_A,
            "request_id": payload["request_id"],
        }

    monkeypatch.setattr(handoff_consumer, "_post_json", respond)

    assert handoff_consumer._verify_manager_capability(
        "http://cortex", secret, BRAIN_A
    ) is True
    assert "/manager-rollback/" in requests[0][1]
    assert requests[0][2]["reason"] == (
        handoff_consumer.RUNTIME_DELIVERY_MANAGER_CAPABILITY_REASON
    )


def test_manager_readiness_rejects_unavailable_rollback_capability(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_ENV", "production")
    monkeypatch.setenv(
        "CORTEX_RELEASE_MEASUREMENT_URL", "http://cortex/release-observation"
    )
    monkeypatch.setattr(
        handoff_consumer,
        "_observation_store",
        lambda: handoff_consumer._ObservationStore(tmp_path / "controller"),
    )
    monkeypatch.setattr(handoff_consumer, "_probe_measurement", lambda _url: True)
    requests = []

    def unavailable(_base_url, path, _payload):
        requests.append(path)
        if path.endswith("/claim-next"):
            return {
                "success": True,
                "recipient": "release-manager",
                "cortex_brain_startup_revision_id": BRAIN_A,
                "messages": [],
                "managed_releases": [],
            }
        if "/manager-rollback/" in path:
            raise RuntimeError("manager rollback endpoint returned 404")
        raise AssertionError(path)

    monkeypatch.setattr(handoff_consumer, "_post_json", unavailable)
    with handoff_consumer._POLL_STATUS_LOCK:
        handoff_consumer._POLL_STATUS.update(
            {
                "last_success_epoch": None,
                "last_success_at": None,
                "last_error": "authenticated poll has not succeeded",
                "capability_verified": False,
            }
        )

    with pytest.raises(RuntimeError, match="returned 404"):
        handoff_consumer._poll_once(
            "http://cortex",
            "release-manager",
            "manager-recipient-secret-material-000000001",
        )

    assert any("/manager-rollback/" in path for path in requests)
    assert handoff_consumer._consumer_readiness()["ready"] is False
