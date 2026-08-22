import json

from services.homeostasis.novelty_packager import build_claim_map, build_reproducibility_pack, render_novelty_brief


def _write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _seed_supported_claim_artifacts(root):
    fixtures = {
        "step3/value_hierarchy_probe_latest.json": {"benchmark": {"gate_pass": True}},
        "step4/arbitration_probe_latest.json": {"benchmark": {"gate_pass": True}},
        "step5/budget_allocator_probe_latest.json": {"simulation": {"gate_pass": True, "overrun_events": 0}},
        "step6/adaptive_effort_probe_latest.json": {"benchmark": {"success_rate": 0.9}},
        "step7/safety_override_probe_latest.json": {"benchmark": {"gate_pass": True}},
        "step8/shadow_governor_probe_latest.json": {"shadow": {"gate_pass": True}},
        "step10/full_rollout_autotune_probe_latest.json": {"validation": {"valid": True}},
        "step11/dashboard_probe_latest.json": {"gate_pass": True},
    }
    for relative_path, payload in fixtures.items():
        _write_json(root / relative_path, payload)


def test_r7_step12_claim_map_keeps_claim_discipline(tmp_path):
    _seed_supported_claim_artifacts(tmp_path)
    claim_map = build_claim_map(artifact_root=tmp_path)
    summary = claim_map["summary"]
    assert summary["supported"] >= 4
    assert summary["not_supported"] >= 1
    assert any(claim["status"] == "not_supported" for claim in claim_map["claims"])


def test_r7_step12_repro_pack_and_brief_include_phase_e_endgame(tmp_path):
    claim_map = build_claim_map(artifact_root=tmp_path)
    repro = build_reproducibility_pack(artifact_root=tmp_path)
    brief = render_novelty_brief(claim_map, repro)
    assert "scripts/cortex_r7_step11_operator_dashboard.py" in repro["scripts"]
    assert "scripts/cortex_r7_step12_novelty_packaging.py" in repro["scripts"]
    assert "R7 Value/Homeostasis Governor — Novelty Brief" in brief
    assert "Do not overclaim" in brief
