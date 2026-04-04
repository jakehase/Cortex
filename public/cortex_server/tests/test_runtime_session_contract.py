from cortex_server.runtime import normalize_session_event


def test_normalize_session_event_maps_raw_events_to_canonical_contract():
    event = normalize_session_event(
        "proc_123",
        "question.requested",
        tool="codex",
        session_id="sess_1",
        session_name="issue-42",
        summary="need human approval",
        payload={"repo_name": "demo"},
    )

    assert event.kind == "session.blocked"
    assert event.payload["raw_event"] == "question.requested"
    assert event.payload["contract_event"] == "session.blocked"
    assert event.operator_summary.startswith("codex:issue-42 blocked")


def test_normalize_session_event_keeps_session_prefixed_events_and_custom_fallback():
    heartbeat = normalize_session_event("proc_123", "session.heartbeat", session_id="sess_1")
    custom = normalize_session_event("proc_123", "weird.vendor.event", session_id="sess_1")

    assert heartbeat.kind == "session.heartbeat"
    assert custom.kind == "session.custom"
