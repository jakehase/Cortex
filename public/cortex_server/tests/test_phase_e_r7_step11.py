from services.homeostasis.operator_dashboard import build_dashboard_model, render_dashboard_html, run_operator_control_runbook


def test_r7_step11_dashboard_builds_expected_sections_and_controls():
    model = build_dashboard_model()
    assert model["headline"]["rollout_mode"] in {"full", "hold"}
    assert "arbitration_traces" in model["sections"]
    assert "alert_noise" in model["sections"]
    assert model["controls"]["freeze_policy"]["supported"] is True
    assert model["controls"]["rollback_to_baseline"]["supported"] is True
    assert model["controls"]["resume_governor"]["supported"] is True


def test_r7_step11_runbook_and_html_render_succeed():
    model = build_dashboard_model()
    drill = run_operator_control_runbook(model)
    html = render_dashboard_html(model)
    assert drill["success"] is True
    assert "R7 Operator Dashboard" in html
    assert "Arbitration traces" in html
    assert "Resume governor" in html
