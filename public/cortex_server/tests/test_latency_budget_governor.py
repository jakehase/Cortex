from cortex_server.modules.latency_budget_governor import LatencyBudgetGovernor, classify_task_archetype


def test_classify_task_archetype():
    assert classify_task_archetype("Implement bug fix and add unit tests") == "coding"
    assert classify_task_archetype("Provide answer with sources and citations") == "citation_required"


def test_prefetch_runs_parallel(tmp_path):
    gov = LatencyBudgetGovernor(artifact_dir=tmp_path)
    out = gov.speculative_prefetch(
        "What is 2+2?",
        enabled=True,
        retrieve_fn=lambda: [{"snippet": "doc"}],
        context_fn=lambda: {"resolved": True},
    )
    assert out["enabled"] is True
    assert out["used_parallel"] is True
    assert "retrieval" in out["results"]
    assert "context" in out["results"]
