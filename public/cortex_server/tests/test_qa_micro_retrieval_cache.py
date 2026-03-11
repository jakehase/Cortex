from cortex_server.modules.qa_micro_retrieval import retrieve_top3


def test_retrieval_cache_consistency():
    q = "cache me"
    a = retrieve_top3(q, max_items=3, timeout_ms=300)
    b = retrieve_top3(q, max_items=3, timeout_ms=300)
    assert len(a) <= 3
    assert a == b
    assert all("source" in x and "snippet" in x for x in a)
