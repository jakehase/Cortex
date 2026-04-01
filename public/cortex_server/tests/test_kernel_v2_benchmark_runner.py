from cortex_server.benchmarks.kernel_v2_benchmark import run_suite


def test_kernel_v2_benchmark_runner_smoke(tmp_path):
    results = run_suite(
        "/root/clawd/public/cortex_server/benchmarks/cortex_kernel_v2_corpus_2026-04-01.json",
        iterations=1,
        case_ids=[
            "oracle_micro_fact_fast",
            "oracle_memory_seed",
            "oracle_memory_followup",
            "command_center_state",
        ],
    )

    assert results["summary"]["total_runs"] == 4
    assert len(results["cases"]) == 4
    trace = results["summary"]["trace_metrics"]
    assert trace["count"] == 3
    assert trace["planned_deep_rate"] >= 0.0
    assert {row["case_id"] for row in results["cases"]} == {
        "oracle_micro_fact_fast",
        "oracle_memory_seed",
        "oracle_memory_followup",
        "command_center_state",
    }
