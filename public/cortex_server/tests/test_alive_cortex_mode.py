import json
from pathlib import Path

from cortex_server.modules import alive_cortex


def test_classify_prompt_triggers_strategic_ethical_uncertain():
    c = alive_cortex.classify_prompt("Need strategy roadmap with privacy risk; not sure on tradeoffs")
    assert c["strategic"] is True
    assert c["ethical"] is True
    assert c["uncertain"] is True
    assert 15 in c["task_levels"]
    assert 33 in c["task_levels"]
    assert 34 in c["task_levels"]


def test_orchestration_enforces_core_levels_and_hud_exception(tmp_path, monkeypatch):
    monkeypatch.setattr(alive_cortex, "STATE_PATH", tmp_path / "alive.json")
    m = alive_cortex.AliveCortexMode(config_provider=lambda: {"alive_cortex_mode": {"enabled": True}})
    out = m.orchestrate(
        prompt="implement code patch",
        call_oracle=lambda p: "ok",
        call_council=lambda p: {"ok": True},
        call_ethicist=lambda p: {"ok": True},
        call_validator=lambda d: {"valid": True},
    )
    for lvl in [37, 5, 21, 22, 26]:
        assert lvl in out["active_levels"]

    assert m.should_hide_hud_signature("HEARTBEAT_OK") is True
    assert m.should_hide_hud_signature("no_reply") is True
    assert m.should_hide_hud_signature("normal prompt") is False


def test_state_persists(tmp_path, monkeypatch):
    state_file = tmp_path / "alive_state.json"
    monkeypatch.setattr(alive_cortex, "STATE_PATH", state_file)

    m = alive_cortex.AliveCortexMode(config_provider=lambda: {"alive_cortex_mode": {"enabled": True}})
    m.orchestrate(
        prompt="how does this work?",
        call_oracle=lambda p: "resp",
        call_council=lambda p: None,
        call_ethicist=lambda p: None,
        call_validator=lambda d: None,
    )
    assert state_file.exists()
    data = json.loads(state_file.read_text())
    assert data["prompt_count"] >= 1
    assert data["focus"].startswith("how does this work")
