from services.homeostasis.novelty_packager import build_claim_map, build_reproducibility_pack, render_novelty_brief


def test_r7_step12_claim_map_keeps_claim_discipline():
    claim_map = build_claim_map()
    summary = claim_map["summary"]
    assert summary["supported"] >= 4
    assert summary["not_supported"] >= 1
    assert any(claim["status"] == "not_supported" for claim in claim_map["claims"])


def test_r7_step12_repro_pack_and_brief_include_phase_e_endgame():
    claim_map = build_claim_map()
    repro = build_reproducibility_pack()
    brief = render_novelty_brief(claim_map, repro)
    assert "scripts/cortex_r7_step11_operator_dashboard.py" in repro["scripts"]
    assert "scripts/cortex_r7_step12_novelty_packaging.py" in repro["scripts"]
    assert "R7 Value/Homeostasis Governor — Novelty Brief" in brief
    assert "Do not overclaim" in brief
