from __future__ import annotations

import json
import threading

import pytest

from cortex_server.runtime import handoff_consumer


def test_consumer_readiness_requires_a_fresh_authenticated_poll(monkeypatch):
    clock = {"now": 1000.0}
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

    assert handoff_consumer._consumer_readiness()["ready"] is False

    handoff_consumer._record_poll_success()
    assert handoff_consumer._consumer_readiness()["ready"] is True

    clock["now"] += 4
    handoff_consumer._record_poll_error(PermissionError("bad recipient credential"))
    assert handoff_consumer._consumer_readiness()["ready"] is True

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
        lambda *_args, **_kwargs: {"messages": [{"message_id": "handoff-pending"}]},
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
        lambda *_args, **_kwargs: {"messages": [{"message_id": "handoff-broken"}]},
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
        "first_epoch": 1000.0,
        "last_epoch": 1900.0,
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

    changed_window = {**window, "first_epoch": 2000.0, "last_epoch": 2900.0, "succeeded": 999}
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
    monkeypatch.setattr(
        handoff_consumer,
        "_record_measurement_burst",
        lambda *_args, **_kwargs: {
            "first_epoch": 1000.0,
            "last_epoch": 1900.0,
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
            }
        )
    assert handoff_consumer._consumer_readiness()["ready"] is False
    with handoff_consumer._POLL_STATUS_LOCK:
        handoff_consumer._POLL_STATUS["capability_verified"] = True
    assert handoff_consumer._consumer_readiness()["ready"] is True
