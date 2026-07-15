from __future__ import annotations

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
