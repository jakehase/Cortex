import cortex_server.routers.librarian as librarian
import pytest


@pytest.fixture(autouse=True)
def _isolate_local_file_memory(monkeypatch, tmp_path):
    empty_root = tmp_path / "empty-local-memory"
    empty_root.mkdir()
    monkeypatch.setenv(librarian._LOCAL_FILE_MEMORY_ROOTS_ENV, str(empty_root))


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


def test_robust_search_exact_lexical_requires_actual_contains(monkeypatch):
    query = "unique proof marker ABC-123"

    def _raise_query(*args, **kwargs):
        raise AssertionError("semantic query should not run when exact contains succeeds")

    def _fake_get(*args, **kwargs):
        return {
            "ids": ["exact-1", "broad-1"],
            "documents": [
                "Release packet includes unique proof marker ABC-123 for recall.",
                "Release packet mentions proof markers generally but not the exact one.",
            ],
            "metadatas": [{"source": "docs"}, {"source": "docs"}],
        }

    monkeypatch.setattr(librarian.collection, "query", _raise_query)
    monkeypatch.setattr(librarian.collection, "get", _fake_get)

    out = librarian.robust_search(query, n_results=2, allow_fallback=True)
    assert out["search_mode"] == "exact_lexical"
    assert len(out["results"]) == 1
    assert out["results"][0]["id"] == "exact-1"
    assert out["results"][0]["metadata"]["exact_recall_override"] is True


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


def test_robust_search_uses_local_file_memory_when_chroma_misses_client_context(monkeypatch, tmp_path):
    memory_root = tmp_path / "memory"
    memory_root.mkdir()
    ledger = memory_root / "pmhnp-billing.md"
    ledger.write_text(
        "## Morgan / Harbor context-access lesson — synthetic fixture\n"
        "- Morgan explicitly said Credentialing Solutions had not instructed her to bill under individual NPI 1.\n"
        "- Claims should use Harbor Behavioral Health PLLC organization NPI 2 + PLLC EIN as billing provider, "
        "with Morgan's individual NPI 1 as rendering provider.\n",
        encoding="utf-8",
    )

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

    monkeypatch.setenv(librarian._LOCAL_FILE_MEMORY_ROOTS_ENV, str(memory_root))
    monkeypatch.setattr(librarian.collection, "query", _fake_query)
    monkeypatch.setattr(librarian.collection, "get", lambda *args, **kwargs: {"ids": [], "documents": [], "metadatas": []})
    monkeypatch.setattr(librarian, "_read_fallback_rows", lambda limit=200: [])

    out = librarian.robust_search("Morgan SimplePractice NPI billing provider correspondence", n_results=2, allow_fallback=True)
    assert out["results"]
    assert "organization NPI 2" in out["results"][0]["text"]
    assert out["results"][0]["metadata"]["source"] == "local_file_memory"
    assert out["results"][0]["metadata"]["recall_mode"] == "local_file_lexical_fallback"


def test_local_file_memory_ranks_later_correction_above_stale_negative(monkeypatch, tmp_path):
    memory_root = tmp_path / "memory"
    memory_root.mkdir()
    ledger = memory_root / "morgan-ledger.md"
    ledger.write_text(
        "## 2026-06-18 old local-search answer\n"
        "- No found correspondence explicitly states the BCBS billing NPI, Type 1 vs Type 2 choice, or TIN/EIN details.\n"
        "## 2026-06-18 correction\n"
        "- Correction: Jake surfaced prior Morgan correspondence from June 1 that directly answers BCBS/SimplePractice NPI setup.\n"
        "- Operational conclusion: This correspondence directly supports using Harbor Behavioral Health PLLC organization NPI 2 and PLLC EIN as billing provider, with Morgan individual NPI 1 as rendering provider.\n",
        encoding="utf-8",
    )

    monkeypatch.setenv(librarian._LOCAL_FILE_MEMORY_ROOTS_ENV, str(memory_root))
    monkeypatch.setattr(librarian.collection, "query", lambda *args, **kwargs: {"ids": [[]], "documents": [[]], "distances": [[]], "metadatas": [[]]})
    monkeypatch.setattr(librarian.collection, "get", lambda *args, **kwargs: {"ids": [], "documents": [], "metadatas": []})
    monkeypatch.setattr(librarian, "_read_fallback_rows", lambda limit=200: [])

    out = librarian.robust_search("Morgan correspondence SimplePractice NPI billing provider", n_results=3, allow_fallback=True)
    assert out["results"]
    assert "directly supports" in out["results"][0]["text"] or "organization NPI 2" in out["results"][0]["text"]
    assert "No found correspondence" not in out["results"][0]["text"]
    stale_rows = [row for row in out["results"] if "No found correspondence" in row["text"]]
    assert all((row.get("metadata") or {}).get("stale_negative_memory") is True for row in stale_rows)


def test_local_file_memory_staleness_is_generic_not_morgan_specific(monkeypatch, tmp_path):
    memory_root = tmp_path / "memory"
    memory_root.mkdir()
    ledger = memory_root / "platform-sync.md"
    ledger.write_text(
        "## 2026-06-10 old answer\n"
        "- Could not find any evidence that the Nexus webhook bridge was implemented or verified.\n"
        "## 2026-06-11 current fact\n"
        "- Current canonical status: Nexus webhook bridge implemented, synced, and live verification tests passed.\n",
        encoding="utf-8",
    )

    monkeypatch.setenv(librarian._LOCAL_FILE_MEMORY_ROOTS_ENV, str(memory_root))
    monkeypatch.setattr(librarian.collection, "query", lambda *args, **kwargs: {"ids": [[]], "documents": [[]], "distances": [[]], "metadatas": [[]]})
    monkeypatch.setattr(librarian.collection, "get", lambda *args, **kwargs: {"ids": [], "documents": [], "metadatas": []})
    monkeypatch.setattr(librarian, "_read_fallback_rows", lambda limit=200: [])

    out = librarian.robust_search("Nexus webhook bridge implemented verified", n_results=3, allow_fallback=True)
    assert out["results"]
    assert "implemented, synced" in out["results"][0]["text"]
    assert all("Could not find" not in row["text"] for row in out["results"])


def test_canonical_registry_direct_read_outranks_stale_semantic_recommendation(monkeypatch, tmp_path):
    memory_root = tmp_path / "memory"
    projects = memory_root / "projects"
    projects.mkdir(parents=True)
    canonical = projects / "agent-work-v1.md"
    canonical.write_text(
        "# Agent Work\n\n## Already proven\nReal product dogfood is already proven. Do not recommend a first dogfood run.\n\n"
        "## Next\nCapture only semantic_auto workforce selection during the next useful product job.\n",
        encoding="utf-8",
    )
    index = projects / "INDEX.md"
    index.write_text("| Project / aliases | Canonical project state | Related |\n|---|---|---|\n| Agent Work, semantic workforce | `memory/projects/agent-work-v1.md` | old |\n", encoding="utf-8")

    monkeypatch.setattr(librarian, "_CANONICAL_PROJECT_INDEX", index)
    monkeypatch.setattr(librarian.collection, "query", lambda *a, **k: {
        "ids": [["stale-1"]], "documents": [["Agent Work should run its first real product dogfood campaign next."]],
        "distances": [[0.01]], "metadatas": [[{"source": "semantic_history", "memory_status": "active"}]],
    })
    monkeypatch.setattr(librarian.collection, "get", lambda *a, **k: {"ids": [], "documents": [], "metadatas": []})

    out = librarian.robust_search("What should Agent Work do next?", n_results=3)
    assert out["results"]
    assert out["results"][0]["metadata"]["source"] == "canonical_project_file"
    assert out["results"][0]["metadata"]["authority_rank"] == 90
    assert "semantic_auto" in " ".join(row["text"] for row in out["results"])


def test_superseded_records_hidden_by_default_but_available_to_history_queries():
    rows = [
        {"id": "old", "text": "Agent Work needs its first dogfood run.", "distance": 0.01, "metadata": {"memory_status": "superseded"}},
        {"id": "new", "text": "Agent Work dogfood is already proven.", "distance": 0.2, "metadata": {"memory_status": "active", "correction_memory": True}},
    ]
    current = librarian._merge_ranked_rows("What is current for Agent Work dogfood?", rows, [], 5)
    assert [row["id"] for row in current] == ["new"]
    historical = librarian._merge_ranked_rows("Show historical superseded Agent Work dogfood memory", rows, [], 5)
    assert {row["id"] for row in historical} == {"old", "new"}


def test_canonical_version_identifier_beats_generic_current_heading(monkeypatch, tmp_path):
    projects = tmp_path / "memory" / "projects"
    projects.mkdir(parents=True)
    (projects / "INDEX.md").write_text("| Project | Canonical | Related |\n|---|---|---|\n| Synthetic Labor OS, SLOS | `memory/projects/slos.md` | |\n", encoding="utf-8")
    (projects / "slos.md").write_text(
        "# SLOS\n\n## Current checkpoint — v20\nCurrent release is v20.\n\n"
        "## Previous checkpoint — v19 adapter/prior-art gate\nV19 duplicated existing capabilities and was corrected to adapter_wrapper_only.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(librarian, "_CANONICAL_PROJECT_INDEX", projects / "INDEX.md")
    rows = librarian._canonical_project_search_rows("What is current SLOS v19 status?", 2)
    assert rows[0]["metadata"]["section"].startswith("Previous checkpoint — v19")


def test_canonical_registry_matches_distinctive_acronym_alias(monkeypatch, tmp_path):
    projects = tmp_path / "memory" / "projects"
    projects.mkdir(parents=True)
    (projects / "INDEX.md").write_text("| Project | Canonical | Related |\n|---|---|---|\n| PMHNP Tier 2 benchmark | `memory/projects/pmhnp.md` | |\n", encoding="utf-8")
    (projects / "pmhnp.md").write_text("# PMHNP\n\n## Corrections\nTier 2 was verification only, not product code generation.\n", encoding="utf-8")
    monkeypatch.setattr(librarian, "_CANONICAL_PROJECT_INDEX", projects / "INDEX.md")
    rows = librarian._canonical_project_search_rows("PMHNP Tier 2 product code generation", 2)
    assert rows and rows[0]["metadata"]["section"] == "Corrections"


def test_negative_evidence_queries_can_still_return_missing_rows(monkeypatch, tmp_path):
    memory_root = tmp_path / "memory"
    memory_root.mkdir()
    ledger = memory_root / "platform-gaps.md"
    ledger.write_text(
        "## 2026-06-10 gap note\n"
        "- Could not find any evidence that the Nexus webhook bridge was implemented or verified.\n"
        "## 2026-06-11 current fact\n"
        "- Current canonical status: Nexus webhook bridge implemented, synced, and live verification tests passed.\n",
        encoding="utf-8",
    )

    monkeypatch.setenv(librarian._LOCAL_FILE_MEMORY_ROOTS_ENV, str(memory_root))
    monkeypatch.setattr(librarian.collection, "query", lambda *args, **kwargs: {"ids": [[]], "documents": [[]], "distances": [[]], "metadatas": [[]]})
    monkeypatch.setattr(librarian.collection, "get", lambda *args, **kwargs: {"ids": [], "documents": [], "metadatas": []})
    monkeypatch.setattr(librarian, "_read_fallback_rows", lambda limit=200: [])

    out = librarian.robust_search("what was missing for Nexus webhook bridge", n_results=3, allow_fallback=True)
    assert out["results"]
    assert any("Could not find" in row["text"] for row in out["results"])


def test_memory_system_meta_notes_do_not_crowd_domain_facts(monkeypatch, tmp_path):
    memory_root = tmp_path / "memory"
    memory_root.mkdir()
    ledger = memory_root / "morgan-memory.md"
    ledger.write_text(
        "## Memory recall fix\n"
        "- Live verification: `memory_search(\"Morgan correspondence SimplePractice NPI billing provider\")` now returns correction rows first. Regression coverage added in test_librarian_recall_fallback.py.\n"
        "## Morgan domain fact\n"
        "- BCBS SimplePractice enrollment/NPI truth corrected: use Harbor Behavioral Health PLLC organization NPI 2 and PLLC EIN as billing provider, with Morgan individual NPI 1 as rendering provider.\n",
        encoding="utf-8",
    )

    monkeypatch.setenv(librarian._LOCAL_FILE_MEMORY_ROOTS_ENV, str(memory_root))
    monkeypatch.setattr(librarian.collection, "query", lambda *args, **kwargs: {"ids": [[]], "documents": [[]], "distances": [[]], "metadatas": [[]]})
    monkeypatch.setattr(librarian.collection, "get", lambda *args, **kwargs: {"ids": [], "documents": [], "metadatas": []})
    monkeypatch.setattr(librarian, "_read_fallback_rows", lambda limit=200: [])

    out = librarian.robust_search("Morgan correspondence SimplePractice NPI billing provider", n_results=3, allow_fallback=True)
    assert out["results"]
    assert "organization NPI 2" in out["results"][0]["text"]
    assert all("memory_search" not in row["text"] for row in out["results"])
