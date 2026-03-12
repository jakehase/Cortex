import cortex_server.routers.librarian as librarian


def test_robust_search_falls_back_to_lexical(monkeypatch):
    def _raise_query(*args, **kwargs):
        raise RuntimeError("embedding backend unavailable")

    def _fake_get(*args, **kwargs):
        return {
            "ids": ["m1", "m2"],
            "documents": ["deploy rollback checklist", "incident status and outage runbook"],
            "metadatas": [{"source": "docs"}, {"source": "recent_memory"}],
        }

    monkeypatch.setattr(librarian.collection, "query", _raise_query)
    monkeypatch.setattr(librarian.collection, "get", _fake_get)

    out = librarian.robust_search("outage rollback status", n_results=2, allow_fallback=True)
    assert out["search_mode"] == "lexical_fallback"
    assert out["degraded"] is True
    assert len(out["results"]) >= 1
    assert any("recall_mode" in (row.get("metadata") or {}) for row in out["results"])
