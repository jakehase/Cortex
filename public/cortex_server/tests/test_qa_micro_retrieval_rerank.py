from cortex_server.modules.qa_micro_retrieval import retrieve_top3


def test_retrieve_top3_returns_ranked_items():
    rows = retrieve_top3(
        "api latency rollback",
        max_items=3,
        timeout_ms=500,
        candidates=[
            {
                "source": "docs",
                "snippet": "The API rollback procedure restores the prior release when latency breaches the service threshold.",
                "freshness": 0.8,
                "provenance": "https://docs.example/runbooks/api-rollback",
            },
            {
                "source": "curated_memory",
                "snippet": "Rollback verification checks error rate, health probes, and request latency after deployment.",
                "freshness": 0.9,
                "memory_id": "memory-123",
            },
        ],
    )
    assert 1 <= len(rows) <= 3
    assert all("score" in r and r["grounded"] is True and r["provenance"] for r in rows)
    scores = [float(r.get("score", 0.0)) for r in rows]
    assert scores == sorted(scores, reverse=True)
