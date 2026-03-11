from cortex_server.modules.qa_micro_retrieval import retrieve_top3


def test_retrieve_top3_returns_ranked_items():
    rows = retrieve_top3("api latency rollback", max_items=3, timeout_ms=500)
    assert 1 <= len(rows) <= 3
    assert all("score" in r for r in rows)
    scores = [float(r.get("score", 0.0)) for r in rows]
    assert scores == sorted(scores, reverse=True)
