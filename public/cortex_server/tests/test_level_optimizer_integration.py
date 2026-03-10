from fastapi import FastAPI
from fastapi.testclient import TestClient

import cortex_server.routers.nexus as nexus
from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.modules.level_optimizer import (
    ContextualBanditScheduler,
    TokenBudgetPlanner,
    BudgetItem,
    should_early_exit,
    run_counterfactual_replay,
)


def _client(monkeypatch):
    monkeypatch.setattr(
        nexus,
        "analyze_intent_with_oracle",
        lambda q: {"confidence": 0.0, "levels": [], "reasoning": "stub", "method": "stub"},
    )
    monkeypatch.setattr(
        nexus,
        "_load_level_optimizer_config",
        lambda: {
            "enabled": True,
            "bandit_enabled": True,
            "token_budget_enabled": True,
            "semantic_delta_enabled": True,
            "anytime_enabled": True,
            "max_context_tokens": 80,
            "early_exit_confidence": 0.84,
            "delta_reuse_similarity": 0.62,
        },
    )

    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(nexus.router, prefix="/nexus")
    return TestClient(app)


def test_bandit_scheduler_selects_valid_arm(tmp_path):
    sched = ContextualBanditScheduler(state_path=tmp_path / "bandit.json")
    choice = sched.select_arm("simple", "what is 2+2")
    assert choice["selected_arm"] in {"fastlane_minimal", "fastlane_memory", "deliberate_council", "creative_fractal"}
    sched.update(choice["context"], choice["selected_arm"], reward=0.8)
    assert (tmp_path / "bandit.json").exists()


def test_token_budget_knapsack():
    planner = TokenBudgetPlanner()
    items = [
        BudgetItem(item_id="a", cost=40, utility=1.2, payload={}),
        BudgetItem(item_id="b", cost=25, utility=1.1, payload={}),
        BudgetItem(item_id="c", cost=35, utility=1.5, payload={}),
    ]
    out = planner.allocate(60, items)
    assert out["used"] <= 60
    assert out["selected_ids"]


def test_anytime_gate():
    ok, reason = should_early_exit(0.9, [], False, False, threshold=0.84)
    assert ok is True
    assert reason == "confidence_gate"


def test_orchestrate_exposes_optimizer_slice(monkeypatch):
    client = _client(monkeypatch)
    r = client.get("/nexus/orchestrate", params={"query": "What is 2+2?"})
    assert r.status_code == 200
    body = r.json()
    assert "level_optimizer" in body
    assert body["level_optimizer"].get("enabled") is True
    assert "semantic_delta" in body
    assert "token_plan" in body


def test_counterfactual_replay_harness(tmp_path):
    ds = tmp_path / "replay.jsonl"
    ds.write_text(
        "\n".join(
            [
                '{"query":"What is 2+2?","quality":0.7,"tokens":300}',
                '{"query":"Brainstorm product names","quality":0.65,"tokens":450}',
                '{"query":"Design architecture tradeoff plan","complexity_hard":true,"quality":0.75,"tokens":650}',
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    out = run_counterfactual_replay(str(ds), limit=50)
    assert out["success"] is True
    assert out["rows"] == 3
    assert "delta" in out


def test_replay_endpoint(monkeypatch, tmp_path):
    client = _client(monkeypatch)
    ds = tmp_path / "replay_api.jsonl"
    ds.write_text('{"query":"What is 2+2?","quality":0.7,"tokens":300}\n', encoding="utf-8")

    r = client.post(
        "/nexus/policy/replay",
        json={"dataset_path": str(ds), "limit": 10, "exploration_seed": 41},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["replay"]["rows"] == 1
