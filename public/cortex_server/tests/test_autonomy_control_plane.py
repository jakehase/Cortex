import importlib

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _client(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_AUTONOMY_STATE_PATH", str(tmp_path / "autonomy_state.json"))
    monkeypatch.setenv("CORTEX_DECISION_LOG_PATH", str(tmp_path / "decisions.jsonl"))
    monkeypatch.setenv("CORTEX_EVENT_LEDGER_PATH", str(tmp_path / "event_ledger.jsonl"))

    import cortex_server.middleware.event_ledger_middleware as event_ledger
    import cortex_server.middleware.hud_middleware as hud
    import cortex_server.routers.autonomy as autonomy

    importlib.reload(event_ledger)
    importlib.reload(autonomy)

    app = FastAPI()
    app.add_middleware(event_ledger.EventLedgerMiddleware)
    app.add_middleware(hud.HUDMiddleware)

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    app.include_router(autonomy.router, prefix="/autonomy")
    return TestClient(app)


def test_objectives_roundtrip(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)

    r = client.put(
        "/autonomy/objectives",
        json={
            "mission": "Build a cohesive autonomous brain.",
            "weekly_goals": ["reduce incidents", "reduce incidents", "stability first"],
            "constraints": ["human oversight", "reversible changes"],
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["objectives"]["mission"] == "Build a cohesive autonomous brain."
    assert body["objectives"]["weekly_goals"] == ["reduce incidents", "stability first"]

    g = client.get("/autonomy/objectives")
    assert g.status_code == 200
    assert g.json()["objectives"]["mission"] == "Build a cohesive autonomous brain."


def test_decision_reflection_and_adaptation(monkeypatch, tmp_path):
    client = _client(monkeypatch, tmp_path)

    # Generate a few events for the nervous system ledger.
    for _ in range(3):
        hr = client.get("/health")
        assert hr.status_code == 200

    d = client.post(
        "/autonomy/decision",
        json={
            "title": "Stability-first rollout",
            "decision": "Use staged deployment with rollback",
            "rationale": "Lower blast radius and preserve uptime",
            "tags": ["stability", "deploy"],
            "persist_to_l22": False,
        },
    )
    assert d.status_code == 200
    assert d.json()["success"] is True

    nightly = client.post("/autonomy/reflection/nightly", json={"window_hours": 1, "persist_to_l22": False})
    assert nightly.status_code == 200
    nightly_body = nightly.json()
    assert nightly_body["success"] is True
    assert "summary" in nightly_body["reflection"]

    weekly = client.post("/autonomy/adaptation/weekly", json={"window_days": 1, "persist_to_l22": False})
    assert weekly.status_code == 200
    weekly_body = weekly.json()
    assert weekly_body["success"] is True
    assert isinstance(weekly_body["adaptation"]["proposals"], list)
    assert len(weekly_body["adaptation"]["proposals"]) >= 1
