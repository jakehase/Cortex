from cortex_server.modules.qa_micro_retrieval import retrieve_top3


def test_retrieval_cache_consistency():
    q = "cache me"
    candidates = [{
        "source": "docs",
        "snippet": "Cache entries are invalidated after their freshness window expires and then loaded from the canonical store.",
        "freshness": 0.8,
        "document_id": "cache-policy-v1",
    }]
    a = retrieve_top3(q, max_items=3, timeout_ms=300, candidates=candidates)
    b = retrieve_top3(q, max_items=3, timeout_ms=300, candidates=candidates)
    assert len(a) <= 3
    assert a == b
    assert all("source" in x and "snippet" in x and x["grounded"] is True for x in a)
