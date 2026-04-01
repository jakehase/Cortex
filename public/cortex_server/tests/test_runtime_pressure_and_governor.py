from cortex_server.modules import runtime_pressure
from cortex_server.modules.latency_budget_governor import LatencyBudgetGovernor


def setup_function():
    runtime_pressure.reset_state()



def test_runtime_pressure_marks_affinity_risk_when_threads_are_implicit(monkeypatch):
    monkeypatch.setattr(runtime_pressure, "_cpu_allowed_list", lambda: "4-8,10,14")

    runtime_pressure.record_onnx_session_init(
        source="test",
        explicit_threads=False,
        intra_op_threads=None,
        inter_op_threads=None,
        providers=["CPUExecutionProvider"],
    )

    snapshot = runtime_pressure.pressure_snapshot()
    assert snapshot["status"]["degraded"] is True
    assert snapshot["status"]["reason"] == "onnx_affinity_risk_without_explicit_threads"
    assert snapshot["counters"]["warning_count"] >= 1



def test_latency_governor_serializes_prefetch_when_runtime_pressure_is_degraded(monkeypatch, tmp_path):
    monkeypatch.setenv("CORTEX_LATENCY_GOVERNOR_PREFETCH_MODE", "auto")
    monkeypatch.setattr(
        runtime_pressure,
        "pressure_snapshot",
        lambda: {"status": {"level": "degraded", "degraded": True, "reason": "warning_spike"}},
    )
    monkeypatch.setattr(runtime_pressure, "runtime_configuration", lambda: {"benchmark_mode": False})

    order = []

    def retrieval():
        order.append("retrieval")
        return [{"id": "r1"}]

    def context():
        order.append("context")
        return {"summary": "ctx"}

    governor = LatencyBudgetGovernor(artifact_dir=tmp_path)
    result = governor.speculative_prefetch(
        "benchmark query",
        enabled=True,
        retrieve_fn=retrieval,
        context_fn=context,
    )

    assert result["used_parallel"] is False
    assert result["serialized_due_to_runtime_pressure"] is True
    assert order == ["retrieval", "context"]
    assert result["runtime_pressure"]["degraded"] is True
