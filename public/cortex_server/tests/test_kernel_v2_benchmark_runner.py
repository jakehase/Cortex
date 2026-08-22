from cortex_server.benchmarks.kernel_v2_benchmark import run_suite
from pathlib import Path


def test_kernel_v2_benchmark_runner_smoke(tmp_path, configured_memory_principal):
    auth = configured_memory_principal(session_id="bench-memory-alpha")
    corpus_path = Path(__file__).resolve().parents[1] / "benchmarks" / "cortex_kernel_v2_corpus_2026-04-01.json"
    results = run_suite(
        str(corpus_path),
        iterations=1,
        case_ids=[
            "oracle_micro_fact_fast",
            "oracle_memory_seed",
            "oracle_memory_followup",
            "command_center_state",
        ],
        memory_scope_headers=auth.headers,
    )

    assert results["summary"]["total_runs"] == 4
    assert results["schema_version"] == "cortex.kernel_v2.benchmark_results.v2"
    assert len(results["cases"]) == 4
    trace = results["summary"]["trace_metrics"]
    assert trace["count"] == 3
    assert trace["planned_deep_rate"] >= 0.0
    assert "environment" in results
    assert "runtime_pressure" in results
    assert "by_runtime" in results["summary"]
    assert "drift" in results["summary"]
    assert {row["case_id"] for row in results["cases"]} == {
        "oracle_micro_fact_fast",
        "oracle_memory_seed",
        "oracle_memory_followup",
        "command_center_state",
    }
