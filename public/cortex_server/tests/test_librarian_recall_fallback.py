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


def test_robust_search_recovers_when_semantic_results_are_awareness_noise(monkeypatch):
    query = "Mailchimp canonical status supervisorStatus red matrixStatus partial"

    def _fake_query(*args, **kwargs):
        return {
            "ids": [["a1", "a2"]],
            "documents": [[
                "Asking Oracle for a semantic prediction...",
                "Oracle predicts: status may evolve soon.",
            ]],
            "distances": [[0.04, 0.06]],
            "metadatas": [[
                {"tags": ["auto_indexed", "semantic_prediction", "awareness", "L37"], "source": "awareness"},
                {"tags": ["auto_indexed", "semantic_prediction", "awareness", "L37"], "source": "awareness"},
            ]],
        }

    def _fake_get(*args, **kwargs):
        return {
            "ids": ["m1", "m2", "m3"],
            "documents": [
                "Mailchimp canonical status: supervisorStatus: red, matrixStatus: partial, parityStatus: partial, blocker: null. Remaining surfaces: C_data_model_and_persistence_parity.",
                "Asking Oracle for a semantic prediction...",
                "General note about another project",
            ],
            "metadatas": [
                {"source": "curated-project-facts", "quality": "curated", "project": "mailchimp", "tags": ["mailchimp", "curated"]},
                {"tags": ["semantic_prediction", "awareness", "L37"], "source": "awareness"},
                {"source": "recent_memory"},
            ],
        }

    monkeypatch.setattr(librarian.collection, "query", _fake_query)
    monkeypatch.setattr(librarian.collection, "get", _fake_get)

    out = librarian.robust_search(query, n_results=3, allow_fallback=True)
    assert out["search_mode"] == "semantic_hybrid"
    assert out["results"]
    assert "Mailchimp canonical status" in out["results"][0]["text"]
    assert not any("Asking Oracle for a semantic prediction" in row["text"] for row in out["results"])
    assert out["warning"] == "semantic_low_signal"


def test_robust_search_demotes_codec_state_blobs_for_preference_queries(monkeypatch):
    query = "What should replies begin with for Jake?"

    def _fake_query(*args, **kwargs):
        return {
            "ids": [["codec-1"]],
            "documents": [[
                '{"compression": {"compression_mode": "state_not_transcript"}, "identity_state": {"preferences": ["Jake prefers replies to begin with [Cortex]."]}}',
            ]],
            "distances": [[0.03]],
            "metadatas": [[
                {"type": "codec_state", "tags": ["cortex_codec", "codec_state", "durable_memory"], "source": "codec_state"},
            ]],
        }

    def _fake_get(*args, **kwargs):
        return {
            "ids": ["pref-1", "codec-1"],
            "documents": [
                "Jake prefers replies to begin with [Cortex] so it's clearly me.",
                '{"compression": {"compression_mode": "state_not_transcript"}, "identity_state": {"preferences": ["Jake prefers replies to begin with [Cortex]."]}}',
            ],
            "metadatas": [
                {"source": "curated-preferences-priorities", "quality": "curated", "tags": ["curated", "preference"]},
                {"type": "codec_state", "tags": ["cortex_codec", "codec_state", "durable_memory"], "source": "codec_state"},
            ],
        }

    monkeypatch.setattr(librarian.collection, "query", _fake_query)
    monkeypatch.setattr(librarian.collection, "get", _fake_get)

    out = librarian.robust_search(query, n_results=2, allow_fallback=True)
    assert out["results"]
    assert out["results"][0]["text"] == "Jake prefers replies to begin with [Cortex] so it's clearly me."
    assert not any((row.get("metadata") or {}).get("type") == "codec_state" for row in out["results"])
    assert out["warning"] == "semantic_low_signal"


def test_robust_search_extracts_human_readable_codec_preference_when_that_is_all_available(monkeypatch):
    query = "What should replies begin with for Jake?"

    def _fake_query(*args, **kwargs):
        return {
            "ids": [["codec-1"]],
            "documents": [[
                '{"compression": {"compression_mode": "state_not_transcript"}, "identity_state": {"preferences": ["Jake prefers replies to begin with [Cortex]."]}}',
            ]],
            "distances": [[0.03]],
            "metadatas": [[
                {"type": "codec_state", "tags": ["cortex_codec", "codec_state", "durable_memory"], "source": "codec_state"},
            ]],
        }

    monkeypatch.setattr(librarian.collection, "query", _fake_query)
    monkeypatch.setattr(librarian.collection, "get", lambda *args, **kwargs: {"ids": [], "documents": [], "metadatas": []})

    out = librarian.robust_search(query, n_results=1, allow_fallback=True)
    assert out["results"]
    assert out["results"][0]["text"] == "Jake prefers replies to begin with [Cortex]."
    assert out["results"][0]["metadata"]["codec_state_noise"] is True
    assert out["results"][0]["metadata"]["source_document_type"] == "codec_state"
