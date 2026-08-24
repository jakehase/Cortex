import sys
import types

import cortex_server.modules.cortex_codec as codec_module
from cortex_server.modules.cortex_codec import (
    apply_codec_outcome_feedback,
    build_codec_state,
    compress_codec_for_prompt,
    get_codec_packet_for_session,
    get_codec_state,
    update_codec_state_for_session,
)


def test_build_codec_state_extracts_preferences_projects_and_open_loops():
    state = build_codec_state(
        [
            {
                "text": "Jake prefers replies to begin with [Cortex] so it's clearly me.",
                "tags": ["identity", "preference"],
                "metadata": {"project": "Cortex"},
            },
            {
                "text": "Let's build the Cortex Codec and design a state compression layer.",
                "tags": ["research", "codex"],
                "metadata": {"project": "Cortex Codec"},
            },
            {
                "text": "What remains is outcome-weighted memory compression and open-loop tracking?",
                "tags": ["planning"],
            },
            {
                "text": "Important decision: store preferences and failure patterns as durable state.",
                "tags": ["decision"],
            },
        ]
    )

    assert state["version"].startswith("cortex.codec")
    assert any("[Cortex]" in item for item in state["identity_state"]["preferences"])
    assert any("Cortex Codec" in item for item in state["project_state"]["active_projects"])
    assert any("What remains" in item for item in state["project_state"]["open_loops"])
    assert any("Important decision" in item for item in state["world_state"]["durable_facts"])
    assert state["utility_state"]["summary"]["retention_priority"] > 0
    assert any(item["bucket"] == "preferences" for item in state["utility_state"]["summary"]["top_items"])
    assert "Projects:" in state["summary"]


def test_codec_recognizes_begin_replies_with_as_preference_and_not_project_noise():
    state = build_codec_state(
        [
            {
                "text": "Begin replies with [Memoria].",
                "tags": ["preference"],
            }
        ]
    )

    assert state["identity_state"]["preferences"] == ["Begin replies with [Memoria]."]
    assert not state["project_state"]["active_projects"]


def test_codec_preference_revision_supersedes_prior_preference():
    first = build_codec_state([
        {"text": "Start replies with [Cortex].", "tags": ["preference"]},
    ])
    second = build_codec_state(
        [{"text": "Start replies with [Neural] instead.", "tags": ["preference"]}],
        previous_state=first,
    )

    assert second["identity_state"]["preferences"] == ["Start replies with [Neural] instead."]
    assert second["identity_state"]["preference_revision_count"] >= 1
    assert second["identity_state"]["preference_revisions"][-1]["superseded_text"] == "Start replies with [Cortex]."


def test_codec_preference_revision_supports_call_me_alias_changes():
    first = build_codec_state([
        {"text": "Call me Jake.", "tags": ["preference"]},
    ])
    second = build_codec_state(
        [{"text": "Call me J instead.", "tags": ["preference"]}],
        previous_state=first,
    )

    assert second["identity_state"]["preferences"] == ["Call me J instead."]
    assert second["identity_state"]["preference_revision_count"] >= 1


def test_codec_project_extraction_filters_generic_tag_and_sentence_noise():
    state = build_codec_state(
        [
            {
                "text": "Thanks for checking.",
                "tags": ["note"],
                "metadata": {"project": "Memory Supervisor"},
            },
            {
                "text": "We should land the Nexus Router migration.",
                "tags": ["planning"],
            },
        ]
    )

    assert "Memory Supervisor" in state["project_state"]["active_projects"]
    assert "Nexus Router" in state["project_state"]["active_projects"]
    assert "note" not in state["project_state"]["active_projects"]
    assert "Thanks" not in state["project_state"]["active_projects"]
    assert "planning" not in state["project_state"]["active_projects"]
    assert "We" not in state["project_state"]["active_projects"]


def test_codec_completion_checkpoint_is_a_durable_fact_without_project_noise():
    completion = (
        "Good progress—the mechanical foundation is complete and saved. "
        "Commit: 5a6a85817. 37 files changed; remote worktree is clean. "
        "Focused tests: 32/32 passed. Validation, replay, freeze, report, schema parsing, "
        "and safety scans passed. Not pushed or deployed; no PMHNP production changes. "
        "Honest capability status remains implemented, unqualified: there are still no live "
        "verified exemplars, promoted real-world lessons, or held-out assessments. Next phase: "
        "build the verified design corpus, promote evidence-backed lessons, then run blinded "
        "baseline-versus-treatment assessments."
    )

    state = build_codec_state([
        {
            "text": completion,
            "tags": ["openclaw", "evidence-backed", "held-out"],
            "metadata": {"project": "PMHNP"},
        }
    ])

    assert state["project_state"]["active_projects"] == []
    assert completion in state["world_state"]["durable_facts"]
    assert any(row["text"] == completion for row in state["promotion_state"]["promoted"]["durable_facts"])
    assert state["outcome_state"]["success_count"] == 1


def test_codec_does_not_treat_negated_completion_as_a_success_checkpoint():
    state = build_codec_state([
        {"text": "The work is not yet complete; no focused tests passed and the worktree is not clean."}
    ])

    assert state["world_state"]["durable_facts"] == []
    assert state["outcome_state"]["success_count"] == 0


def test_codec_recognizes_learning_os_and_website_design_projects():
    state = build_codec_state([
        {"text": "The Learning OS website-design pilot is complete and focused tests passed."}
    ])

    assert state["project_state"]["active_projects"] == ["Learning OS", "Website Design"]
    assert "Focused" not in state["project_state"]["active_projects"]


def test_apply_codec_outcome_feedback_promotes_observed_lessons():
    state = build_codec_state([
        {"text": "Build a verifier loop for research answers.", "metadata": {"project": "Verifier"}}
    ])

    updated = apply_codec_outcome_feedback(
        state,
        {"status": "success", "text": "Verifier loop worked and reduced obvious mistakes."},
    )
    failed = apply_codec_outcome_feedback(
        updated,
        {"status": "failure", "text": "Context packing regressed when prompts exceeded budget."},
    )

    assert updated["outcome_state"]["success_count"] == state["outcome_state"]["success_count"] + 1
    assert any("reduced obvious mistakes" in item for item in updated["failure_state"]["lessons"])
    assert failed["outcome_state"]["failure_count"] == updated["outcome_state"]["failure_count"] + 1
    assert any("exceeded budget" in item for item in failed["failure_state"]["patterns"])


def test_compress_codec_for_prompt_respects_budget():
    state = build_codec_state(
        [
            {"text": "Prefer short replies with strong opinions.", "tags": ["preference"]},
            {"text": "Build a compact state packet for frontier-model prompting.", "metadata": {"project": "Codec"}},
            {"text": "Need to benchmark compression quality versus transcript replay."},
        ]
    )

    packet = compress_codec_for_prompt(state, max_chars=120)

    assert len(packet) <= 120
    assert "Prefs:" in packet or "Projects:" in packet


def test_session_codec_store_shares_state_and_packet(monkeypatch):
    session_key = "test-session-codec"
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    update_codec_state_for_session(
        session_key,
        [
            {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
            {"text": "Build the Cortex Codec integration into Nexus and OpenClaw.", "metadata": {"project": "Cortex Codec"}},
        ],
    )

    packet = get_codec_packet_for_session(session_key, max_chars=180)

    assert packet["available"] is True
    assert "[Cortex]" in packet["packet"] or "Projects:" in packet["packet"]
    assert packet["summary"]




def test_codec_persists_to_l22_when_state_changes(monkeypatch):
    class _Recorder:
        def __init__(self):
            self.calls = []

        def __call__(self, **kwargs):
            self.calls.append(kwargs)
            return {"id": "codec-mem-1", "status": "stored", "metadata": kwargs.get("metadata", {})}

    recorder = _Recorder()
    fake_l22 = types.ModuleType("cortex_server.routers.l22")
    fake_l22.store_memory_record = recorder
    fake_l22.list_structured_memory_records = lambda **kwargs: []
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", fake_l22)
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    monkeypatch.setattr(codec_module, "_load_codec_state_from_l22", lambda session_key: {})

    session_key = "codec-durable-write-test"
    state = update_codec_state_for_session(
        session_key,
        [{"text": "Remember this preference: start replies with [Cortex].", "tags": ["preference"]}],
    )

    assert state["durable_write"]["status"] == "stored"
    assert len(recorder.calls) == 1
    assert recorder.calls[0]["memory_type"] == "codec_state"
    assert recorder.calls[0]["metadata"]["codec_session_key"] == session_key
    assert recorder.calls[0]["metadata"]["codec_retention_priority"] > 0
    assert recorder.calls[0]["metadata"]["codec_utility_item_count"] >= 1


def test_codec_persistence_excludes_derived_rollups(monkeypatch):
    calls = []
    fake_l22 = types.ModuleType("cortex_server.routers.l22")
    fake_l22.store_memory_record = lambda **kwargs: calls.append(kwargs) or {"id": "bounded-1", "status": "stored", "metadata": kwargs.get("metadata", {})}
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", fake_l22)
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    monkeypatch.setattr(codec_module, "_prune_codec_snapshots_in_l22", lambda *a, **k: {"status": "noop"})

    state = build_codec_state([{"text": "Remember this stable preference: begin replies with [Cortex].", "tags": ["preference"]}])
    state["rollup_state"] = {"payload": "x" * 1_250_000}
    state["promotion_state"] = {"derived": True}
    state["schema_state"] = {"derived": True}
    state["memory_facts"] = [{"derived": True}]

    result = codec_module._persist_codec_state_to_l22("codec-bounded-persistence-test", state)
    stored = codec_module.json.loads(calls[0]["content"])

    assert result["status"] == "stored"
    assert len(calls[0]["content"]) < 50_000
    assert not ({"rollup_state", "promotion_state", "schema_state", "memory_facts"} & stored.keys())
    assert stored["summary"] == state["summary"]


def test_codec_in_memory_cache_is_bounded(monkeypatch):
    monkeypatch.setattr(codec_module, "CODEC_IN_MEMORY_MAX_SESSIONS", 2)
    keys = ["codec-cache-bound-a", "codec-cache-bound-b", "codec-cache-bound-c"]
    for key in keys:
        codec_module._SESSION_CODEC_STATE.pop(key, None)
        codec_module._SESSION_CODEC_PERSIST.pop(key, None)
    try:
        for key in keys:
            codec_module._cache_codec_state(key, {"summary": key})
        assert keys[0] not in codec_module._SESSION_CODEC_STATE
        assert keys[1] in codec_module._SESSION_CODEC_STATE
        assert keys[2] in codec_module._SESSION_CODEC_STATE
    finally:
        for key in keys:
            codec_module._SESSION_CODEC_STATE.pop(key, None)
            codec_module._SESSION_CODEC_PERSIST.pop(key, None)


def test_codec_compaction_bounds_untrusted_source_and_recomputes_projections(monkeypatch):
    oversized = {
        "version": codec_module.CODEC_VERSION,
        "schema_version": codec_module.CODEC_SCHEMA_VERSION,
        "generated_at": "2026-07-22T20:00:00+00:00",
        "summary": "s" * 100_000,
        "source_event_count": "not-an-integer",
        "identity_state": {
            "preferences": [f"preference-{index}-" + ("x" * 5000) for index in range(100)],
            "preference_revision_count": "malformed",
        },
        "project_state": {},
        "world_state": {},
        "failure_state": {},
        "outcome_state": {"success_count": "broken"},
        "utility_state": {},
        "rollup_state": {"amplification": "x" * 1_000_000},
        "unknown_generated_projection": {"amplification": "x" * 1_000_000},
    }

    compact = codec_module._compact_codec_state(oversized)
    encoded = codec_module.json.dumps(compact, sort_keys=True)

    assert len(encoded) < 100_000
    assert len(compact["summary"]) <= codec_module.CODEC_STATE_SUMMARY_MAX_CHARS
    assert len(compact["identity_state"]["preferences"]) <= 8
    assert compact["source_event_count"] == 0
    assert compact["outcome_state"]["success_count"] == 0
    assert "rollup_state" not in compact
    assert "unknown_generated_projection" not in compact

    session_key = "codec-derived-read-test"
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    codec_module._cache_codec_state(session_key, compact)
    projected = get_codec_state(session_key)
    assert "schema_state" in projected
    assert "promotion_state" in projected
    assert "memory_facts" in projected
    assert "schema_state" not in codec_module._SESSION_CODEC_STATE[session_key]


def test_codec_repeated_updates_converge_to_bounded_source_state(monkeypatch):
    session_key = "codec-repeat-bounded-test"
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    codec_module._SESSION_CODEC_STATE.pop(session_key, None)
    for index in range(250):
        state = update_codec_state_for_session(
            session_key,
            [{"text": f"Remember stable bounded fact {index}: " + ("x" * 5000), "tags": ["fact"]}],
        )
        state["rollup_state"] = {"derived": "y" * 50_000}
        codec_module._cache_codec_state(session_key, state)

    cached = codec_module._SESSION_CODEC_STATE[session_key]
    assert len(codec_module.json.dumps(cached, sort_keys=True)) < 100_000
    assert len(cached["world_state"]["durable_facts"]) <= 8
    assert not (codec_module._CODEC_DERIVED_STATE_KEYS & cached.keys())


def test_codec_can_hydrate_latest_state_from_l22(monkeypatch):
    fake_state = build_codec_state(
        [{"text": "Jake prefers replies to begin with [Cortex].", "metadata": {"project": "Cortex Codec"}}]
    )

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            return {
                "ids": ["mem-hydrated"],
                "documents": [codec_module.json.dumps(fake_state, ensure_ascii=False)],
                "metadatas": [{
                    "type": "codec_state",
                    "codec_session_key": "codec-hydrate-test",
                    "codec_generated_at": fake_state["generated_at"],
                    "codec_fingerprint": "fp-hydrated",
                    "codec_store_id": "mem-hydrated",
                }],
            }

    fake_librarian = types.ModuleType("cortex_server.routers.librarian")
    fake_librarian.collection = _FakeCollection()
    monkeypatch.setitem(sys.modules, "cortex_server.routers.librarian", fake_librarian)
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", types.ModuleType("cortex_server.routers.l22"))
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    codec_module._SESSION_CODEC_STATE.pop("codec-hydrate-test", None)
    codec_module._SESSION_CODEC_PERSIST.pop("codec-hydrate-test", None)

    state = get_codec_state("codec-hydrate-test")
    packet = get_codec_packet_for_session("codec-hydrate-test", max_chars=180)

    assert state["summary"]
    assert packet["available"] is True
    assert packet["durable"]["loaded_from_l22"] is True
    assert packet["durable"]["fingerprint"] == "fp-hydrated"


def test_codec_dedupe_ignores_generated_at_only_changes(monkeypatch):
    class _Recorder:
        def __init__(self):
            self.calls = []

        def __call__(self, **kwargs):
            self.calls.append(kwargs)
            return {"id": f"codec-mem-{len(self.calls)}", "status": "stored", "metadata": kwargs.get("metadata", {})}

    recorder = _Recorder()
    fake_l22 = types.ModuleType("cortex_server.routers.l22")
    fake_l22.store_memory_record = recorder
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", fake_l22)
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    monkeypatch.setattr(codec_module, "_prune_codec_snapshots_in_l22", lambda *a, **k: {"status": "noop", "deleted": 0, "kept": 1})

    state = build_codec_state([{"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]}])
    first = codec_module._persist_codec_state_to_l22("codec-dedupe-test", state)
    state2 = dict(state)
    state2["generated_at"] = "2099-01-01T00:00:00+00:00"
    second = codec_module._persist_codec_state_to_l22("codec-dedupe-test", state2)

    assert first["status"] == "stored"
    assert second["status"] == "unchanged"
    assert len(recorder.calls) == 1


def test_codec_retention_prunes_duplicate_and_old_snapshots(monkeypatch):
    deleted = []

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            return {
                "ids": ["id1", "id2", "id3", "id4", "id5", "id6"],
                "documents": ["{}"] * 6,
                "metadatas": [
                    {"type": "codec_state", "codec_fingerprint": "fp-new", "codec_generated_at": "2026-03-25T06:00:00Z"},
                    {"type": "codec_state", "codec_fingerprint": "fp-new", "codec_generated_at": "2026-03-25T05:00:00Z"},
                    {"type": "codec_state", "codec_fingerprint": "fp-a", "codec_generated_at": "2026-03-25T04:00:00Z"},
                    {"type": "codec_state", "codec_fingerprint": "fp-b", "codec_generated_at": "2026-03-25T03:00:00Z"},
                    {"type": "codec_state", "codec_fingerprint": "fp-c", "codec_generated_at": "2026-03-25T02:00:00Z"},
                    {"type": "codec_state", "codec_fingerprint": "fp-d", "codec_generated_at": "2026-03-25T01:00:00Z"},
                ],
            }

        def delete(self, ids=None):
            deleted.extend(ids or [])

    fake_librarian = types.ModuleType("cortex_server.routers.librarian")
    fake_librarian.collection = _FakeCollection()
    monkeypatch.setitem(sys.modules, "cortex_server.routers.librarian", fake_librarian)
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", types.ModuleType("cortex_server.routers.l22"))
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    monkeypatch.setattr(codec_module, "CODEC_RETENTION_MAX_SNAPSHOTS", 4)

    result = codec_module._prune_codec_snapshots_in_l22("codec-retention-test", keep_fingerprint="fp-new")

    assert result["status"] == "pruned"
    assert result["deleted"] == 2
    assert set(deleted) == {"id2", "id6"}


def test_codec_retention_prefers_high_utility_snapshot_over_newer_low_value_snapshot(monkeypatch):
    deleted = []

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            return {
                "ids": ["id1", "id2", "id3", "id4", "id5"],
                "documents": ["{}"] * 5,
                "metadatas": [
                    {"type": "codec_state", "codec_fingerprint": "fp-new", "codec_generated_at": "2026-03-25T06:00:00Z", "codec_retention_priority": 0.9},
                    {"type": "codec_state", "codec_fingerprint": "fp-utility", "codec_generated_at": "2026-03-25T01:00:00Z", "codec_retention_priority": 7.4},
                    {"type": "codec_state", "codec_fingerprint": "fp-mid-a", "codec_generated_at": "2026-03-25T05:00:00Z", "codec_retention_priority": 2.2},
                    {"type": "codec_state", "codec_fingerprint": "fp-mid-b", "codec_generated_at": "2026-03-25T04:00:00Z", "codec_retention_priority": 2.0},
                    {"type": "codec_state", "codec_fingerprint": "fp-low", "codec_generated_at": "2026-03-25T03:00:00Z", "codec_retention_priority": 1.1},
                ],
            }

        def delete(self, ids=None):
            deleted.extend(ids or [])

    fake_librarian = types.ModuleType("cortex_server.routers.librarian")
    fake_librarian.collection = _FakeCollection()
    monkeypatch.setitem(sys.modules, "cortex_server.routers.librarian", fake_librarian)
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", types.ModuleType("cortex_server.routers.l22"))
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    monkeypatch.setattr(codec_module, "CODEC_RETENTION_MAX_SNAPSHOTS", 3)
    monkeypatch.setattr(codec_module, "CODEC_RETENTION_MIN_PRIORITY", 10.0)
    monkeypatch.setattr(codec_module, "CODEC_RETENTION_MAX_PRIORITY_OVERFLOW", 0)

    result = codec_module._prune_codec_snapshots_in_l22("codec-retention-utility-test")

    assert result["status"] == "pruned"
    assert "fp-utility" in result["kept_fingerprints"]
    assert result["overflow_kept"] == 0
    assert set(deleted) == {"id1", "id5"}


def test_codec_retention_policy_can_keep_high_priority_overflow(monkeypatch):
    deleted = []

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            return {
                "ids": ["id1", "id2", "id3", "id4", "id5"],
                "documents": ["{}"] * 5,
                "metadatas": [
                    {"type": "codec_state", "codec_fingerprint": "fp-top-a", "codec_generated_at": "2026-03-25T06:00:00Z", "codec_retention_priority": 8.4},
                    {"type": "codec_state", "codec_fingerprint": "fp-top-b", "codec_generated_at": "2026-03-25T05:00:00Z", "codec_retention_priority": 7.9},
                    {"type": "codec_state", "codec_fingerprint": "fp-important", "codec_generated_at": "2026-03-25T01:00:00Z", "codec_retention_priority": 7.2},
                    {"type": "codec_state", "codec_fingerprint": "fp-c", "codec_generated_at": "2026-03-25T04:00:00Z", "codec_retention_priority": 0.9},
                    {"type": "codec_state", "codec_fingerprint": "fp-d", "codec_generated_at": "2026-03-25T03:00:00Z", "codec_retention_priority": 0.8},
                ],
            }

        def delete(self, ids=None):
            deleted.extend(ids or [])

    fake_librarian = types.ModuleType("cortex_server.routers.librarian")
    fake_librarian.collection = _FakeCollection()
    monkeypatch.setitem(sys.modules, "cortex_server.routers.librarian", fake_librarian)
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", types.ModuleType("cortex_server.routers.l22"))
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    monkeypatch.setattr(codec_module, "CODEC_RETENTION_MAX_SNAPSHOTS", 2)
    monkeypatch.setattr(codec_module, "CODEC_RETENTION_MIN_PRIORITY", 7.0)
    monkeypatch.setattr(codec_module, "CODEC_RETENTION_MAX_PRIORITY_OVERFLOW", 1)

    result = codec_module._prune_codec_snapshots_in_l22("codec-retention-overflow-test")

    assert result["status"] == "pruned"
    assert result["kept"] == 3
    assert result["overflow_kept"] == 1
    assert "fp-important" in result["kept_fingerprints"]
    assert result["policy"]["min_priority_to_preserve"] == 7.0
    assert set(deleted) == {"id4", "id5"}


def test_codec_fact_revision_supersedes_prior_fact():
    previous = build_codec_state([
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]}
    ])

    updated = build_codec_state(
        [{"text": "Important decision: default lane is not fast anymore.", "tags": ["decision"]}],
        previous_state=previous,
    )

    assert any("not fast" in item for item in updated["world_state"]["durable_facts"])
    assert not any(item == "Important decision: default lane is fast." for item in updated["world_state"]["durable_facts"])
    assert updated["world_state"]["fact_revision_count"] >= 1
    assert updated["world_state"]["fact_revisions"][-1]["superseded_text"] == "Important decision: default lane is fast."


def test_codec_lesson_revision_supersedes_prior_lesson():
    previous = build_codec_state([])
    previous["failure_state"] = {
        "patterns": [],
        "lessons": ["Use transcript replay for debugging."],
        "lesson_revisions": [],
        "lesson_revision_count": 0,
    }

    updated = build_codec_state(
        [{"text": "Correction: do not use transcript replay for debugging because it failed."}],
        previous_state=previous,
    )

    assert any("do not use transcript replay for debugging" in item.lower() for item in updated["failure_state"]["lessons"])
    assert not any(item == "Use transcript replay for debugging." for item in updated["failure_state"]["lessons"])
    assert updated["failure_state"]["lesson_revision_count"] >= 1
    assert updated["failure_state"]["lesson_revisions"][-1]["replacement_text"] == "Correction: do not use transcript replay for debugging because it failed."


def test_build_codec_state_emits_schema_v1_contract():
    state = build_codec_state([
        {"text": "Jake prefers replies to begin with [Cortex].", "tags": ["preference"]},
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]},
    ])

    assert state["version"] == "cortex.codec.v1"
    assert state["schema_version"] == "cortex.codec.schema.v1"
    assert state["schema_state"]["identity"]["preferences"]["count"] >= 1
    assert state["schema_state"]["world"]["durable_facts"]["count"] >= 1
    assert state["migration"]["compat_mode"] is False


def test_codec_migrates_legacy_v0_state_to_schema_v1(monkeypatch):
    legacy_state = {
        "version": "cortex.codec.v0",
        "generated_at": "2026-03-25T00:00:00Z",
        "identity_state": {"preferences": ["Start replies with [Cortex]."]},
        "project_state": {"active_projects": ["Cortex Codec"], "active_goals": [], "open_loops": []},
        "world_state": {"durable_facts": ["Important decision: store durable state."]},
        "failure_state": {"patterns": [], "lessons": ["Use transcript replay sparingly."]},
        "outcome_state": {"success_count": 2, "failure_count": 1, "neutral_count": 0},
        "utility_state": {"bucket_scores": {}, "summary": {"item_count": 0, "total_score": 0.0, "retention_priority": 0.0, "top_items": []}},
    }

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            return {
                "ids": ["mem-legacy"],
                "documents": [codec_module.json.dumps(legacy_state, ensure_ascii=False)],
                "metadatas": [{
                    "type": "codec_state",
                    "codec_session_key": "codec-legacy-migrate-test",
                    "codec_generated_at": legacy_state["generated_at"],
                    "codec_fingerprint": "fp-legacy",
                    "codec_store_id": "mem-legacy",
                }],
            }

    fake_librarian = types.ModuleType("cortex_server.routers.librarian")
    fake_librarian.collection = _FakeCollection()
    monkeypatch.setitem(sys.modules, "cortex_server.routers.librarian", fake_librarian)
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", types.ModuleType("cortex_server.routers.l22"))
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    codec_module._SESSION_CODEC_STATE.pop("codec-legacy-migrate-test", None)
    codec_module._SESSION_CODEC_PERSIST.pop("codec-legacy-migrate-test", None)

    state = get_codec_state("codec-legacy-migrate-test")

    assert state["version"] == "cortex.codec.v1"
    assert state["schema_version"] == "cortex.codec.schema.v1"
    assert state["schema_state"]["projects"]["active_projects"]["items"] == ["Cortex Codec"]
    assert state["schema_state"]["failure"]["lessons"]["items"] == ["Use transcript replay sparingly."]
    assert "promotion" in state["schema_state"]
    assert state["migration"]["compat_mode"] is True
    assert state["migration"]["source_version"] == "cortex.codec.v0"


def test_codec_promotion_state_marks_durable_fact_as_promoted():
    state = build_codec_state([
        {"text": "Important decision: store preferences as durable state.", "tags": ["decision"]},
    ])

    promoted = state["promotion_state"]["promoted"]["durable_facts"]
    assert any("store preferences as durable state" in item["text"].lower() for item in promoted)
    assert state["promotion_state"]["summary"]["promoted_count"] >= 1


def test_codec_outcome_feedback_promotes_successful_lesson():
    state = build_codec_state([])
    updated = apply_codec_outcome_feedback(
        state,
        {"status": "success", "text": "Verifier loop worked and reduced obvious mistakes."},
    )

    promoted = updated["promotion_state"]["promoted"]["lessons"]
    assert any("reduced obvious mistakes" in item["text"].lower() for item in promoted)
    assert updated["schema_state"]["promotion"]["summary"]["promoted_count"] >= 1


def test_codec_accumulates_evidence_across_turns_for_same_fact():
    first = build_codec_state([
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]},
    ])
    second = build_codec_state(
        [{"text": "Important decision: default lane is fast.", "tags": ["decision"]}],
        previous_state=first,
    )

    meta = second["utility_state"]["bucket_scores"]["durable_facts"]["important decision: default lane is fast.".lower()]
    assert meta["evidence_count"] >= 2
    assert meta["observation_count"] == 1


def test_codec_semantic_revision_handles_use_for_context_switch():
    previous = build_codec_state([])
    previous["failure_state"] = {
        "patterns": [],
        "lessons": ["Use fast lane for research tasks."],
        "lesson_revisions": [],
        "lesson_revision_count": 0,
    }

    updated = build_codec_state(
        [{"text": "Actually use careful lane for research tasks because fast lane failed."}],
        previous_state=previous,
    )

    assert any("careful lane for research tasks" in item.lower() for item in updated["failure_state"]["lessons"])
    assert not any(item == "Use fast lane for research tasks." for item in updated["failure_state"]["lessons"])
    assert updated["failure_state"]["lesson_revision_count"] >= 1
    assert updated["failure_state"]["lesson_revisions"][-1]["superseded_text"] == "Use fast lane for research tasks."


def test_codec_marks_old_fact_as_stale_with_lower_confidence():
    first = build_codec_state([
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]},
    ])
    key = "important decision: default lane is fast."
    first_meta = first["utility_state"]["bucket_scores"]["durable_facts"][key]
    first["utility_state"]["bucket_scores"]["durable_facts"][key]["last_seen_at"] = "2026-01-01T00:00:00+00:00"

    second = build_codec_state([], previous_state=first)
    stale_meta = second["utility_state"]["bucket_scores"]["durable_facts"][key]

    assert stale_meta["freshness"] == "stale"
    assert stale_meta["age_hours"] > 168
    assert stale_meta["confidence"] < first_meta["confidence"]


def test_codec_stale_fact_drops_from_promoted_to_candidate():
    state = build_codec_state([
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]},
    ])
    key = "important decision: default lane is fast."
    state["utility_state"]["bucket_scores"]["durable_facts"][key]["last_seen_at"] = "2025-01-01T00:00:00+00:00"

    stale_state = build_codec_state([], previous_state=state)
    promoted = stale_state["promotion_state"]["promoted"].get("durable_facts", [])
    candidates = stale_state["promotion_state"]["candidates"]

    assert not any(item["text"] == "Important decision: default lane is fast." for item in promoted)
    assert any(item["text"] == "Important decision: default lane is fast." for item in candidates)


def test_codec_global_rollup_enriches_matching_fact_across_sessions(monkeypatch):
    state_a = build_codec_state([
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]},
    ])
    state_b = build_codec_state([
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]},
    ])

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            where = where or {}
            if where.get("codec_session_key") == "codec-rollup-session-a":
                return {
                    "ids": ["a1"],
                    "documents": [codec_module.json.dumps(state_a, ensure_ascii=False)],
                    "metadatas": [{
                        "type": "codec_state",
                        "codec_session_key": "codec-rollup-session-a",
                        "codec_generated_at": state_a["generated_at"],
                        "codec_fingerprint": "fp-a",
                    }],
                }
            if where.get("type") == "codec_state":
                return {
                    "ids": ["a1", "b1"],
                    "documents": [
                        codec_module.json.dumps(state_a, ensure_ascii=False),
                        codec_module.json.dumps(state_b, ensure_ascii=False),
                    ],
                    "metadatas": [
                        {
                            "type": "codec_state",
                            "codec_session_key": "codec-rollup-session-a",
                            "codec_generated_at": state_a["generated_at"],
                            "codec_fingerprint": "fp-a",
                        },
                        {
                            "type": "codec_state",
                            "codec_session_key": "codec-rollup-session-b",
                            "codec_generated_at": state_b["generated_at"],
                            "codec_fingerprint": "fp-b",
                        },
                    ],
                }
            return {"ids": [], "documents": [], "metadatas": []}

    fake_librarian = types.ModuleType("cortex_server.routers.librarian")
    fake_librarian.collection = _FakeCollection()
    monkeypatch.setitem(sys.modules, "cortex_server.routers.librarian", fake_librarian)
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", types.ModuleType("cortex_server.routers.l22"))
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    codec_module._SESSION_CODEC_STATE.pop("codec-rollup-session-a", None)
    codec_module._SESSION_CODEC_PERSIST.pop("codec-rollup-session-a", None)

    state = get_codec_state("codec-rollup-session-a")
    key = "important decision: default lane is fast."
    meta = state["utility_state"]["bucket_scores"]["durable_facts"][key]
    promoted = state["promotion_state"]["promoted"]["durable_facts"][0]

    assert meta["global_session_count"] == 2
    assert meta["cross_session_count"] == 1
    assert state["rollup_state"]["summary"]["matched_item_count"] >= 1
    assert promoted["cross_session_count"] == 1
    assert "cross_session_support" in promoted["promotion_reason"]


def test_codec_rollup_alias_matches_near_equivalent_fact_across_sessions(monkeypatch):
    state_a = build_codec_state([
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]},
    ])
    state_b = build_codec_state([
        {"text": "Note: the default lane is fast.", "tags": ["decision"]},
    ])

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            where = where or {}
            if where.get("codec_session_key") == "codec-alias-session-a":
                return {
                    "ids": ["a1"],
                    "documents": [codec_module.json.dumps(state_a, ensure_ascii=False)],
                    "metadatas": [{
                        "type": "codec_state",
                        "codec_session_key": "codec-alias-session-a",
                        "codec_generated_at": state_a["generated_at"],
                        "codec_fingerprint": "fp-a",
                    }],
                }
            if where.get("type") == "codec_state":
                return {
                    "ids": ["a1", "b1"],
                    "documents": [
                        codec_module.json.dumps(state_a, ensure_ascii=False),
                        codec_module.json.dumps(state_b, ensure_ascii=False),
                    ],
                    "metadatas": [
                        {
                            "type": "codec_state",
                            "codec_session_key": "codec-alias-session-a",
                            "codec_generated_at": state_a["generated_at"],
                            "codec_fingerprint": "fp-a",
                        },
                        {
                            "type": "codec_state",
                            "codec_session_key": "codec-alias-session-b",
                            "codec_generated_at": state_b["generated_at"],
                            "codec_fingerprint": "fp-b",
                        },
                    ],
                }
            return {"ids": [], "documents": [], "metadatas": []}

    fake_librarian = types.ModuleType("cortex_server.routers.librarian")
    fake_librarian.collection = _FakeCollection()
    monkeypatch.setitem(sys.modules, "cortex_server.routers.librarian", fake_librarian)
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", types.ModuleType("cortex_server.routers.l22"))
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    codec_module._SESSION_CODEC_STATE.pop("codec-alias-session-a", None)
    codec_module._SESSION_CODEC_PERSIST.pop("codec-alias-session-a", None)

    state = get_codec_state("codec-alias-session-a")
    key = "important decision: default lane is fast."
    meta = state["utility_state"]["bucket_scores"]["durable_facts"][key]

    assert meta["global_session_count"] == 2
    assert meta["rollup_match_type"] == "alias"
    assert state["rollup_state"]["summary"]["alias_matched_item_count"] >= 1
    assert any("default lane is fast" in text.lower() for text in meta["rollup_alias_members"])


def test_codec_rollup_policy_knob_can_disable_alias_preference(monkeypatch):
    rollup_bucket = {
        "exact_scores": {
            "important decision: default lane is fast.": {
                "text": "Important decision: default lane is fast.",
                "global_session_count": 1,
                "global_evidence_count": 1,
            }
        },
        "alias_scores": {
            codec_module._rollup_alias_key("durable_facts", "Important decision: default lane is fast."): {
                "text": "Important decision: default lane is fast.",
                "global_session_count": 2,
                "global_evidence_count": 2,
                "member_texts": [
                    "Important decision: default lane is fast.",
                    "Note: the default lane is fast.",
                ],
            }
        },
    }
    item = {"text": "Important decision: default lane is fast."}

    monkeypatch.setattr(codec_module, "CODEC_ROLLUP_ALIAS_PREFER_SESSION_DELTA", 3)
    monkeypatch.setattr(codec_module, "CODEC_ROLLUP_ALIAS_PREFER_EVIDENCE_DELTA", 3)
    match = codec_module._find_rollup_match("durable_facts", item, rollup_bucket)

    assert match["match_type"] == "exact"


def test_codec_rollup_policy_knobs_are_exposed_in_debug(monkeypatch):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    monkeypatch.setattr(codec_module, "CODEC_ROLLUP_MATCH_MIN_OVERLAP", 0.91)
    monkeypatch.setattr(codec_module, "CODEC_ROLLUP_CONFIDENCE_BLEND", 0.55)

    codec_module._SESSION_CODEC_STATE["codec-rollup-policy-debug"] = build_codec_state([
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]},
    ])
    view = codec_module.get_codec_debug_view("codec-rollup-policy-debug")

    assert view["rollups"]["policy"]["match_min_overlap"] == 0.91
    assert view["rollups"]["policy"]["confidence_blend"] == 0.55


def test_codec_rollup_autotune_can_loosen_policy_from_positive_eval_history(monkeypatch, tmp_path):
    monkeypatch.setattr(codec_module, "_ROLLUP_AUTOTUNE_STATE_PATH", tmp_path / "rollup_policy.json")
    monkeypatch.setattr(codec_module, "_ROLLUP_AUTOTUNE_STATE", None)

    for _ in range(3):
        result = codec_module.observe_codec_rollup_eval_history(
            acceptance_gates={
                "summary": {"overall_pass": True},
                "judge_margin": 0.08,
                "codec_margin_vs_best_non_codec": 0.12,
            },
            winner="referents_plus_codec",
            session_key="rollup-positive",
        )

    policy = codec_module._codec_rollup_policy()

    assert result["autotune"]["action"] == "loosen_rollup"
    assert policy["match_min_overlap"] < policy["base"]["match_min_overlap"]
    assert policy["confidence_blend"] > policy["base"]["confidence_blend"]


def test_codec_rollup_autotune_can_tighten_policy_from_negative_eval_history(monkeypatch, tmp_path):
    monkeypatch.setattr(codec_module, "_ROLLUP_AUTOTUNE_STATE_PATH", tmp_path / "rollup_policy.json")
    monkeypatch.setattr(codec_module, "_ROLLUP_AUTOTUNE_STATE", None)

    for _ in range(3):
        result = codec_module.observe_codec_rollup_eval_history(
            acceptance_gates={
                "summary": {"overall_pass": False},
                "judge_margin": 0.01,
                "codec_margin_vs_best_non_codec": -0.14,
            },
            winner="query_only",
            session_key="rollup-negative",
        )

    policy = codec_module._codec_rollup_policy()

    assert result["autotune"]["action"] == "tighten_rollup"
    assert policy["match_min_overlap"] > policy["base"]["match_min_overlap"]
    assert policy["confidence_blend"] < policy["base"]["confidence_blend"]


def test_codec_rollup_autotune_can_use_archetype_specific_scope(monkeypatch, tmp_path):
    monkeypatch.setattr(codec_module, "_ROLLUP_AUTOTUNE_STATE_PATH", tmp_path / "rollup_policy.json")
    monkeypatch.setattr(codec_module, "_ROLLUP_AUTOTUNE_STATE", None)

    query = "Plan the architecture tradeoff for this change."
    for _ in range(3):
        result = codec_module.observe_codec_rollup_eval_history(
            acceptance_gates={
                "summary": {"overall_pass": True},
                "judge_margin": 0.09,
                "codec_margin_vs_best_non_codec": 0.13,
            },
            winner="referents_plus_codec",
            session_key="rollup-arch",
            query=query,
        )

    policy = codec_module._codec_rollup_policy(query=query)

    assert result["autotune"]["scope"] == "archetype"
    assert policy["autotune"]["scope"] == "archetype"
    assert policy["autotune"]["archetype"]
