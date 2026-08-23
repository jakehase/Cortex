import sys
import time
import types
from concurrent.futures import ThreadPoolExecutor

import cortex_server.modules.cortex_codec as codec_module
from cortex_server.modules.cortex_codec import (
    apply_codec_outcome_feedback_for_session,
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


def test_session_codec_store_is_isolated_by_memory_scope(monkeypatch):
    session_key = "shared-scoped-codec-session"
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)

    update_codec_state_for_session(
        session_key,
        [{"text": "Start replies with [TenantA].", "tags": ["preference"]}],
        tenant_id="tenant-a",
        workspace_id="workspace-a",
    )
    update_codec_state_for_session(
        session_key,
        [{"text": "Start replies with [TenantB].", "tags": ["preference"]}],
        tenant_id="tenant-b",
        workspace_id="workspace-b",
    )

    tenant_a = get_codec_packet_for_session(
        session_key,
        max_chars=500,
        tenant_id="tenant-a",
        workspace_id="workspace-a",
    )
    tenant_b = get_codec_packet_for_session(
        session_key,
        max_chars=500,
        tenant_id="tenant-b",
        workspace_id="workspace-b",
    )
    default_scope = get_codec_packet_for_session(session_key, max_chars=500)

    assert "TenantA" in tenant_a["packet"]
    assert "TenantB" not in tenant_a["packet"]
    assert "TenantB" in tenant_b["packet"]
    assert "TenantA" not in tenant_b["packet"]
    assert tenant_a["storage_session_key"] != tenant_b["storage_session_key"]
    assert default_scope["available"] is False


def test_same_session_codec_updates_are_serialized_and_versioned(monkeypatch):
    session_key = "codec-concurrent-session"
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    with codec_module._SESSION_CODEC_LOCK:
        codec_module._SESSION_CODEC_STATE.pop(session_key, None)
        codec_module._SESSION_CODEC_PERSIST.pop(session_key, None)
        codec_module._SESSION_CODEC_ACCESS.pop(session_key, None)

    initial = update_codec_state_for_session(
        session_key,
        [{"text": "Remember this stable Codec session.", "tags": ["preference"]}],
    )
    original_apply = codec_module.apply_codec_outcome_feedback

    def delayed_apply(*args, **kwargs):
        time.sleep(0.01)
        return original_apply(*args, **kwargs)

    monkeypatch.setattr(codec_module, "apply_codec_outcome_feedback", delayed_apply)
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(
            lambda index: apply_codec_outcome_feedback_for_session(
                session_key,
                {"status": "success", "text": f"Concurrent outcome {index} passed."},
            ),
            range(8),
        ))

    final_state = get_codec_state(session_key)

    assert final_state["outcome_state"]["success_count"] == 8
    assert final_state["state_revision"] == initial["state_revision"] + 8
    assert sorted(result["state_revision"] for result in results) == list(range(2, 10))


def test_codec_session_cache_is_capacity_and_ttl_bounded(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(codec_module, "CODEC_SESSION_CACHE_MAX", 2)
    monkeypatch.setattr(codec_module, "CODEC_SESSION_TTL_SECONDS", 10)
    monkeypatch.setattr(codec_module.time, "monotonic", lambda: clock[0])
    with codec_module._SESSION_CODEC_LOCK:
        codec_module._SESSION_CODEC_STATE.clear()
        codec_module._SESSION_CODEC_PERSIST.clear()
        codec_module._SESSION_CODEC_ACCESS.clear()
        codec_module._SESSION_CODEC_EVICTIONS.update({"ttl": 0, "capacity": 0})

    for index in range(3):
        clock[0] = float(index)
        update_codec_state_for_session(
            f"codec-cache-{index}",
            [{"text": f"Prefer bounded cache entry {index}.", "tags": ["preference"]}],
        )

    with codec_module._SESSION_CODEC_LOCK:
        assert len(codec_module._SESSION_CODEC_STATE) == 2
        assert "codec-cache-0" not in codec_module._SESSION_CODEC_STATE
    assert codec_module._codec_cache_retention_snapshot()["evictions"]["capacity"] == 1

    clock[0] = 20.0
    retention = codec_module._codec_cache_retention_snapshot()

    assert retention["active_sessions"] == 0
    assert retention["evictions"]["ttl"] == 2


def test_codec_hashes_oversized_session_keys_before_storage(monkeypatch):
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", False)
    monkeypatch.setattr(codec_module, "CODEC_SESSION_KEY_MAX_CHARS", 64)
    oversized = "tenant-controlled-" + ("x" * 500)

    state = update_codec_state_for_session(
        oversized,
        [{"text": "Prefer normalized session storage.", "tags": ["preference"]}],
    )
    packet = get_codec_packet_for_session(oversized)

    assert state["state_revision"] == 1
    assert packet["available"] is True
    assert packet["storage_session_key"].startswith("sha256:")
    assert len(packet["storage_session_key"]) == 71
    assert oversized not in codec_module._SESSION_CODEC_STATE




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
    monkeypatch.setattr(codec_module, "_prune_codec_sessions_in_l22", lambda **k: {"status": "noop", "deleted": 0, "kept_sessions": 1})

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
    session_key = "codec-retention-test"

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            assert where == {"codec_session_key": session_key}
            return {
                "ids": ["id1", "id2", "id3", "id4", "id5", "id6"],
                "documents": ["{}"] * 6,
                "metadatas": [
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-new", "codec_generated_at": "2026-03-25T06:00:00Z"},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-new", "codec_generated_at": "2026-03-25T05:00:00Z"},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-a", "codec_generated_at": "2026-03-25T04:00:00Z"},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-b", "codec_generated_at": "2026-03-25T03:00:00Z"},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-c", "codec_generated_at": "2026-03-25T02:00:00Z"},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-d", "codec_generated_at": "2026-03-25T01:00:00Z"},
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

    result = codec_module._prune_codec_snapshots_in_l22(session_key, keep_fingerprint="fp-new")

    assert result["status"] == "pruned"
    assert result["deleted"] == 2
    assert set(deleted) == {"id2", "id6"}


def test_codec_retention_prefers_high_utility_snapshot_over_newer_low_value_snapshot(monkeypatch):
    deleted = []
    session_key = "codec-retention-utility-test"

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            assert where == {"codec_session_key": session_key}
            return {
                "ids": ["id1", "id2", "id3", "id4", "id5"],
                "documents": ["{}"] * 5,
                "metadatas": [
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-new", "codec_generated_at": "2026-03-25T06:00:00Z", "codec_retention_priority": 0.9},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-utility", "codec_generated_at": "2026-03-25T01:00:00Z", "codec_retention_priority": 7.4},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-mid-a", "codec_generated_at": "2026-03-25T05:00:00Z", "codec_retention_priority": 2.2},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-mid-b", "codec_generated_at": "2026-03-25T04:00:00Z", "codec_retention_priority": 2.0},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-low", "codec_generated_at": "2026-03-25T03:00:00Z", "codec_retention_priority": 1.1},
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

    result = codec_module._prune_codec_snapshots_in_l22(session_key)

    assert result["status"] == "pruned"
    assert "fp-utility" in result["kept_fingerprints"]
    assert result["overflow_kept"] == 0
    assert set(deleted) == {"id1", "id5"}


def test_codec_retention_policy_can_keep_high_priority_overflow(monkeypatch):
    deleted = []
    session_key = "codec-retention-overflow-test"

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            assert where == {"codec_session_key": session_key}
            return {
                "ids": ["id1", "id2", "id3", "id4", "id5"],
                "documents": ["{}"] * 5,
                "metadatas": [
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-top-a", "codec_generated_at": "2026-03-25T06:00:00Z", "codec_retention_priority": 8.4},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-top-b", "codec_generated_at": "2026-03-25T05:00:00Z", "codec_retention_priority": 7.9},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-important", "codec_generated_at": "2026-03-25T01:00:00Z", "codec_retention_priority": 7.2},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-c", "codec_generated_at": "2026-03-25T04:00:00Z", "codec_retention_priority": 0.9},
                    {"type": "codec_state", "codec_session_key": session_key, "codec_fingerprint": "fp-d", "codec_generated_at": "2026-03-25T03:00:00Z", "codec_retention_priority": 0.8},
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

    result = codec_module._prune_codec_snapshots_in_l22(session_key)

    assert result["status"] == "pruned"
    assert result["kept"] == 3
    assert result["overflow_kept"] == 1
    assert "fp-important" in result["kept_fingerprints"]
    assert result["policy"]["min_priority_to_preserve"] == 7.0
    assert set(deleted) == {"id4", "id5"}


def test_codec_durable_session_quota_prunes_oldest_sessions(monkeypatch):
    rows = [
        {"id": "id-new", "metadata": {"codec_session_key": "session-new"}, "generated_at": "2026-07-15T03:00:00Z"},
        {"id": "id-middle", "metadata": {"codec_session_key": "session-middle"}, "generated_at": "2026-07-15T02:00:00Z"},
        {"id": "id-old", "metadata": {"codec_session_key": "session-old"}, "generated_at": "2026-07-15T01:00:00Z"},
    ]
    deleted = []
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_MAX_SESSIONS", 2)
    monkeypatch.setattr(codec_module, "_fetch_global_codec_rows_from_l22", lambda **kwargs: rows if not deleted else rows[:2])
    monkeypatch.setattr(codec_module, "_delete_codec_rows_from_l22", lambda ids: deleted.extend(ids) or len(ids))

    result = codec_module._prune_codec_sessions_in_l22(protected_session_key="session-new")

    assert result["status"] == "pruned"
    assert result["session_limit"] == 2
    assert deleted == ["id-old"]


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
    # Keep the historical node id for campaign reconciliation, but model the
    # supported contract: repeated evidence can roll up only within one
    # authenticated principal-session.
    session_key = "principal:codec-rollup-session-a"
    first_state = build_codec_state([
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]},
    ])
    latest_state = build_codec_state(
        [{"text": "Important decision: default lane is fast.", "tags": ["decision"]}],
        previous_state=first_state,
    )
    first_state["generated_at"] = "2026-08-22T01:00:00Z"
    latest_state["generated_at"] = "2026-08-22T02:00:00Z"
    seen_where = []

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            seen_where.append(where)
            assert where == {"codec_session_key": session_key}
            return {
                "ids": ["a2", "a1"],
                "documents": [
                    codec_module.json.dumps(latest_state, ensure_ascii=False),
                    codec_module.json.dumps(first_state, ensure_ascii=False),
                ],
                "metadatas": [
                    {
                        "type": "codec_state",
                        "codec_session_key": session_key,
                        "codec_generated_at": latest_state["generated_at"],
                        "codec_fingerprint": "fp-a2",
                    },
                    {
                        "type": "codec_state",
                        "codec_session_key": session_key,
                        "codec_generated_at": first_state["generated_at"],
                        "codec_fingerprint": "fp-a1",
                    },
                ],
            }

    fake_librarian = types.ModuleType("cortex_server.routers.librarian")
    fake_librarian.collection = _FakeCollection()
    monkeypatch.setitem(sys.modules, "cortex_server.routers.librarian", fake_librarian)
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", types.ModuleType("cortex_server.routers.l22"))
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    codec_module._SESSION_CODEC_STATE.pop(session_key, None)
    codec_module._SESSION_CODEC_PERSIST.pop(session_key, None)

    state = get_codec_state(session_key)
    key = "important decision: default lane is fast."
    meta = state["utility_state"]["bucket_scores"]["durable_facts"][key]
    promoted = state["promotion_state"]["promoted"]["durable_facts"][0]

    assert seen_where == [{"codec_session_key": session_key}] * 2
    assert meta["global_session_count"] == 1
    assert meta["cross_session_count"] == 0
    assert meta["global_evidence_count"] == 2
    assert state["rollup_state"]["summary"]["source_snapshot_count"] == 2
    assert state["rollup_state"]["summary"]["matched_item_count"] >= 1
    assert promoted["cross_session_count"] == 0
    assert "cross_session_support" not in promoted["promotion_reason"]


def test_codec_rollup_alias_matches_near_equivalent_fact_across_sessions(monkeypatch):
    # The fake deliberately ignores its lookup filter and returns another
    # principal's near-equivalent fact. Codec must still discard that row.
    session_key = "principal:codec-alias-session-a"
    foreign_session_key = "principal:codec-alias-session-b"
    state_a = build_codec_state([
        {"text": "Important decision: default lane is fast.", "tags": ["decision"]},
    ])
    state_b = build_codec_state([
        {"text": "Note: the default lane is fast.", "tags": ["decision"]},
    ])
    state_a["generated_at"] = "2026-08-22T02:00:00Z"
    state_b["generated_at"] = "2026-08-22T01:00:00Z"
    seen_where = []

    class _FakeCollection:
        def get(self, where=None, limit=None, include=None):
            seen_where.append(where)
            assert where == {"codec_session_key": session_key}
            return {
                "ids": ["a1", "b1"],
                "documents": [
                    codec_module.json.dumps(state_a, ensure_ascii=False),
                    codec_module.json.dumps(state_b, ensure_ascii=False),
                ],
                "metadatas": [
                    {
                        "type": "codec_state",
                        "codec_session_key": session_key,
                        "codec_generated_at": state_a["generated_at"],
                        "codec_fingerprint": "fp-a",
                    },
                    {
                        "type": "codec_state",
                        "codec_session_key": foreign_session_key,
                        "codec_generated_at": state_b["generated_at"],
                        "codec_fingerprint": "fp-b",
                    },
                ],
            }

    fake_librarian = types.ModuleType("cortex_server.routers.librarian")
    fake_librarian.collection = _FakeCollection()
    monkeypatch.setitem(sys.modules, "cortex_server.routers.librarian", fake_librarian)
    monkeypatch.setitem(sys.modules, "cortex_server.routers.l22", types.ModuleType("cortex_server.routers.l22"))
    monkeypatch.setattr(codec_module, "CODEC_DURABLE_ENABLED", True)
    codec_module._SESSION_CODEC_STATE.pop(session_key, None)
    codec_module._SESSION_CODEC_PERSIST.pop(session_key, None)

    state = get_codec_state(session_key)
    key = "important decision: default lane is fast."
    meta = state["utility_state"]["bucket_scores"]["durable_facts"][key]

    assert seen_where == [{"codec_session_key": session_key}] * 2
    assert meta["global_session_count"] == 1
    assert meta["cross_session_count"] == 0
    assert meta["rollup_match_type"] == "exact"
    assert state["rollup_state"]["summary"]["source_session_count"] == 1
    assert state["rollup_state"]["summary"]["alias_matched_item_count"] == 0
    assert "Note: the default lane is fast." not in meta.get("rollup_alias_members", [])


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
