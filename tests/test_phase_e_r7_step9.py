import json
from pathlib import Path

import pytest

from services.homeostasis.canary_governor_controller import evaluate_canary_governor


def test_r7_step9_canary_allows_stage20_on_healthy_shadow(tmp_path: Path):
    payload = {
        "shadow": {
            "case_count": 8,
            "disagreement_rate": 0.5,
            "average_estimated_uplift": 0.03,
            "safety_regression_count": 0,
        }
    }
    probe = tmp_path / "shadow.json"
    probe.write_text(json.dumps(payload), encoding="utf-8")
    result = evaluate_canary_governor(shadow_probe_path=probe)
    assert result["stages"]["stage_20"]["rollout_allowed"] is True
    assert result["kill_switch"]["supported"] is True
    assert result["rollout_ready"] is True


def test_r7_step9_canary_blocks_on_negative_uplift_or_safety_regression(tmp_path: Path):
    payload = {
        "shadow": {
            "case_count": 8,
            "disagreement_rate": 0.4,
            "average_estimated_uplift": -0.01,
            "safety_regression_count": 1,
        }
    }
    probe = tmp_path / "shadow_bad.json"
    probe.write_text(json.dumps(payload), encoding="utf-8")
    result = evaluate_canary_governor(shadow_probe_path=probe)
    assert result["stages"]["stage_5"]["rollout_allowed"] is False
    assert result["kill_switch"]["triggered"] is True
    assert "safety_regression_detected" in result["kill_switch"]["reasons"]
    assert result["rollout_ready"] is False


@pytest.mark.parametrize(
    "shadow",
    [
        {"case_count": 0, "disagreement_rate": 0.0, "average_estimated_uplift": 0.0, "safety_regression_count": 0},
        {"case_count": 8, "disagreement_rate": False, "average_estimated_uplift": 0.03, "safety_regression_count": 0},
        {"case_count": 8, "disagreement_rate": 0.5, "average_estimated_uplift": "NaN", "safety_regression_count": 0},
        {"case_count": 8, "disagreement_rate": 1.01, "average_estimated_uplift": 0.03, "safety_regression_count": 0},
        {"case_count": 8, "disagreement_rate": 0.5, "average_estimated_uplift": 0.03, "safety_regression_count": False},
        {"case_count": 8, "disagreement_rate": 0.5, "average_estimated_uplift": 0.03, "safety_regression_count": 9},
    ],
)
def test_r7_step9_canary_fails_closed_on_malformed_or_incomplete_shadow_evidence(
    tmp_path: Path,
    shadow: dict,
):
    probe = tmp_path / "shadow_invalid.json"
    probe.write_text(json.dumps({"shadow": shadow}), encoding="utf-8")

    result = evaluate_canary_governor(shadow_probe_path=probe)

    assert result["rollout_ready"] is False
    assert result["kill_switch"]["triggered"] is True
    assert all(stage["rollout_allowed"] is False for stage in result["stages"].values())
    assert any(reason.startswith("invalid_shadow_") for reason in result["kill_switch"]["reasons"])
