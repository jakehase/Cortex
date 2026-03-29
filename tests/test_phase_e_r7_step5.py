from services.homeostasis.dynamic_budget_allocator import allocate_dynamic_budget, run_budget_allocator_simulation
from services.homeostasis.state_signal_model import build_state_signal_snapshot


def test_r7_step5_allocator_emits_budgets_and_reserve_pools():
    state_snapshot = build_state_signal_snapshot()
    plan = allocate_dynamic_budget(
        intent="research",
        risk_tier="high",
        state_snapshot=state_snapshot,
        observed_load={"token_pressure": 0.5, "depth_pressure": 0.4, "latency_pressure": 0.45},
    )
    assert plan["budgets"]["tokens"] > 0
    assert plan["budgets"]["depth"] >= 1
    assert plan["budgets"]["latency_ms"] > 0
    assert set(plan["reserve_pools"].keys()) == {"incident", "recovery"}


def test_r7_step5_simulation_meets_overrun_gate():
    state_snapshot = build_state_signal_snapshot()
    result = run_budget_allocator_simulation(state_snapshot=state_snapshot)
    assert result["turn_count"] == 100
    assert result["overrun_events"] <= 2
    assert result["gate_pass"] is True
