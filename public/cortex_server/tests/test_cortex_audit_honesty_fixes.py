from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules.level_registry import get_level_registry
from cortex_server.modules.nexus import Nexus
from cortex_server.routers import browser, openclaw, oracle


def _client(router, prefix: str = ""):
    app = FastAPI()
    app.include_router(router, prefix=prefix)
    return TestClient(app)


def test_openclaw_config_repairs_legacy_level_count_and_api_labels(tmp_path, monkeypatch):
    stale_config = tmp_path / "openclaw_config.json"
    stale_config.write_text(
        '{"identity":{"creature":"The voice of a 36-level distributed AI consciousness"},'
        '"soul":{"core_identity":"You are Cortex — the unified interface to a 36-level AI orchestration system running on 10.0.0.52."},'
        '"tools":{"cortex_api":"http://10.0.0.52:8888"},'
        '"levels_summary":"36-level AI orchestration"}',
        encoding="utf-8",
    )
    monkeypatch.setattr(openclaw, "CONFIG_PATH", stale_config)

    config = openclaw.load_config()
    assert config["registered_level_count"] == len(get_level_registry()) == 38
    assert "36-level" not in config["identity"]["creature"]
    assert "10.0.0.52" not in config["soul"]["core_identity"]
    assert config["tools"]["cortex_api"] == openclaw.CORTEX_API_URL


def test_ghost_status_reports_heuristic_capabilities_honestly():
    client = _client(browser.router, prefix="/browser")
    response = client.get("/browser/status")
    assert response.status_code == 200
    body = response.json()
    assert "heuristic_truth_arbitration" in body["capabilities"]
    assert "truth_arbitration" not in body["capabilities"]
    assert "not an independent fact verifier" in body["capability_details"]["heuristic_truth_arbitration"]
    assert "heuristic" in body["honesty"].lower()


def test_oracle_status_policy_matches_disabled_fallbacks(monkeypatch):
    monkeypatch.setattr(oracle, "ORACLE_FALLBACKS_ENABLED", False)
    monkeypatch.setattr(oracle.subprocess, "run", lambda *args, **kwargs: None)

    class RaisingRequests:
        def get(self, *args, **kwargs):
            raise RuntimeError("network disabled for test")

    monkeypatch.setattr(oracle, "requests", RaisingRequests())
    client = _client(oracle.router, prefix="/oracle")
    response = client.get("/oracle/status")
    assert response.status_code == 200
    body = response.json()
    assert body["high_priority_path"] == "openclaw_local"
    assert body["policy"] == "OpenClaw-local primary; fallbacks disabled"


def test_imported_nexus_helper_uses_canonical_registry_and_dynamic_scores():
    n = Nexus()
    out = n.orchestrate("search current docs and validate with tests")
    assert out["all_evaluated"] == len(get_level_registry()) == 38
    assert out["activated"] > 0
    assert any(item["level"] == 2 for item in out["recommended_stack"])
    state = n.get_full_state()
    assert state["registered_levels"] == 38
