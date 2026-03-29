from services.homeostasis.state_signal_model import build_state_signal_snapshot, validate_state_signal_snapshot


EXPECTED_FIELDS = [
    "urgency",
    "risk_pressure",
    "fatigue",
    "timeout_pressure",
    "error_pressure",
    "budget_pressure",
    "escalation_debt",
]


def test_r7_step2_state_signal_snapshot_has_canonical_fields():
    snapshot = build_state_signal_snapshot()
    assert snapshot["phase"] == "phase_e_r7_step2"
    assert snapshot["state_vector_fields"] == EXPECTED_FIELDS
    for field in EXPECTED_FIELDS:
        assert field in snapshot["raw_state_vector"]
        assert field in snapshot["smoothed_state_vector"]
        assert 0.0 <= snapshot["smoothed_state_vector"][field] <= 1.0


def test_r7_step2_state_signal_snapshot_validates_cleanly():
    snapshot = build_state_signal_snapshot()
    validation = validate_state_signal_snapshot(snapshot)
    assert validation["valid"] is True
    assert validation["signal_complete"] is True
    assert validation["signal_stable"] is True
