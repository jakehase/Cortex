from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
from threading import Event

import pytest

from cortex_server.modules.private_retrieval_shadow import (
    ShadowConfig,
    classify_private_retrieval_query,
    private_retrieval_shadow_status,
    run_private_retrieval_shadow_probe,
    submit_private_retrieval_shadow,
    wait_for_private_retrieval_shadow_idle,
)


def _config(**overrides) -> ShadowConfig:
    values = {
        "enabled": True,
        "kill_switch": False,
        "max_records": 10,
        "max_pending": 4,
        "rate_limit": 30,
        "rate_window_seconds": 60,
        "result_count": 4,
        "pack_items": 2,
        "pack_tokens": 64,
    }
    values.update(overrides)
    return ShadowConfig(**values)


def test_shadow_is_default_on_but_observe_only(monkeypatch):
    monkeypatch.delenv("CORTEX_PRIVATE_RETRIEVAL_SHADOW_ENABLED", raising=False)
    monkeypatch.delenv("CORTEX_PRIVATE_RETRIEVAL_SHADOW_KILL_SWITCH", raising=False)
    config = ShadowConfig.from_env()
    assert config.enabled is True
    assert config.kill_switch is False


@pytest.mark.parametrize(
    ("query", "eligible", "reason"),
    [
        ("What did we decide about the rollout gate?", True, "selective_private_fact_lookup"),
        ("What reply prefix do I prefer?", True, "selective_private_fact_lookup"),
        ("What is the current server setting?", True, "selective_private_fact_lookup"),
        ("Write a rollout summary from memory", False, "action_or_generation_request"),
        ("Could you draft our rollout note?", False, "action_or_generation_request"),
        ("What is my API key?", False, "sensitive_lookup_blocked"),
        ("What credential did we use?", False, "sensitive_lookup_blocked"),
        ("What is the weather right now?", False, "external_volatile_lookup"),
        ("Explain retrieval augmented generation", False, "not_fact_lookup"),
        ("What is retrieval augmented generation?", False, "no_private_anchor"),
    ],
)
def test_classifier_is_selective_and_blocks_sensitive_lookups(query, eligible, reason):
    decision = classify_private_retrieval_query(query)
    assert decision["eligible"] is eligible
    assert decision["reason"] == reason


def test_probe_is_bounded_and_persists_no_private_content(tmp_path: Path):
    captured = {}
    raw_query = "What did we decide about codename Blue Orchard?"

    def retriever(query, **kwargs):
        captured.update(query=query, **kwargs)
        return {
            "search_mode": "PRIVATE_MODE_BLUE_ORCHARD",
            "results": [
                {
                    "text": "PRIVATE_SNIPPET_BLUE_ORCHARD " * 80,
                    "score": 0.92,
                    "metadata": {"source": "canonical", "private_id": "LEAKY_SOURCE_ID"},
                },
                {"text": "SECOND_PRIVATE_SNIPPET", "score": 0.81, "metadata": {"source": "memory"}},
                {"text": "NOISY_PRIVATE_SNIPPET", "score": 0.99, "metadata": {"codec_state_noise": True}},
                {"text": "FOURTH_PRIVATE_SNIPPET", "score": 0.75},
                {"text": "FIFTH_MUST_BE_TRUNCATED", "score": 0.70},
            ],
        }

    state_path = tmp_path / "principal-a" / "private-retrieval-shadow.json"
    record = run_private_retrieval_shadow_probe(
        observation_id="a" * 32,
        query=raw_query,
        state_path=state_path,
        retriever=retriever,
        tenant_id="tenant-a",
        workspace_id="workspace-a",
        config=_config(),
    )

    assert captured == {
        "query": raw_query,
        "n_results": 4,
        "allow_fallback": True,
        "tenant_id": "tenant-a",
        "workspace_id": "workspace-a",
    }
    assert record["answerInfluence"] is False
    assert record["candidateCount"] == 4
    assert record["packCount"] == 1
    assert record["retrievalMode"] == "other"
    assert record["packEstimateTokens"] == 64
    assert record["qualityCompared"] is False
    persisted = state_path.read_text(encoding="utf-8")
    for forbidden in (raw_query, "PRIVATE_SNIPPET", "Blue Orchard", "LEAKY_SOURCE_ID", "PRIVATE_MODE_BLUE_ORCHARD"):
        assert forbidden not in persisted
    assert os.stat(state_path).st_mode & 0o777 == 0o600
    assert os.stat(state_path.parent).st_mode & 0o777 == 0o700
    assert os.stat(state_path.with_name(f"{state_path.name}.lock")).st_mode & 0o777 == 0o600


def test_probe_failure_is_contained_and_content_free(tmp_path: Path):
    def broken_retriever(*_args, **_kwargs):
        raise RuntimeError("backend exploded with PRIVATE_FAILURE_BODY")

    state_path = tmp_path / "state.json"
    record = run_private_retrieval_shadow_probe(
        observation_id="b" * 32,
        query="What did we decide about the migration?",
        state_path=state_path,
        retriever=broken_retriever,
        tenant_id="tenant",
        workspace_id="workspace",
        config=_config(),
    )
    assert record["retrievalSucceeded"] is False
    assert record["errorCode"] == "RuntimeError"
    assert "PRIVATE_FAILURE_BODY" not in state_path.read_text(encoding="utf-8")


def test_records_are_capped_and_principal_paths_are_isolated(tmp_path: Path):
    def retriever(*_args, **_kwargs):
        return {"search_mode": "hybrid", "results": []}

    config = _config(max_records=2)
    path_a = tmp_path / "principal-a" / "state.json"
    path_b = tmp_path / "principal-b" / "state.json"
    for ordinal in range(3):
        run_private_retrieval_shadow_probe(
            observation_id=f"{ordinal:032x}",
            query="What did we decide about the migration?",
            state_path=path_a,
            retriever=retriever,
            tenant_id="tenant-a",
            workspace_id="workspace-a",
            config=config,
        )
    run_private_retrieval_shadow_probe(
        observation_id="f" * 32,
        query="What is our server setting?",
        state_path=path_b,
        retriever=retriever,
        tenant_id="tenant-b",
        workspace_id="workspace-b",
        config=config,
    )
    state_a = json.loads(path_a.read_text(encoding="utf-8"))
    state_b = json.loads(path_b.read_text(encoding="utf-8"))
    assert len(state_a["records"]) == 2
    assert state_a["counters"]["completed"] == 3
    assert len(state_b["records"]) == 1
    assert state_b["records"][0]["observationId"] == "f" * 32


def test_concurrent_writes_are_locked_atomic_and_capped(tmp_path: Path):
    state_path = tmp_path / "shared" / "state.json"

    def retriever(*_args, **_kwargs):
        return {"search_mode": "hybrid", "results": []}

    def write_one(ordinal: int):
        return run_private_retrieval_shadow_probe(
            observation_id=f"{ordinal:032x}",
            query="What did we decide about the rollout?",
            state_path=state_path,
            retriever=retriever,
            tenant_id="tenant",
            workspace_id="workspace",
            config=_config(max_records=10),
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(write_one, range(24)))
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["counters"]["completed"] == 24
    assert len(state["records"]) == 10
    assert len({row["observationId"] for row in state["records"]}) == 10


def test_submit_is_nonblocking_and_status_exposes_no_content(tmp_path: Path):
    state_path = tmp_path / "state.json"

    def retriever(*_args, **_kwargs):
        return {"search_mode": "hybrid", "results": [{"text": "PRIVATE_ASYNC_TEXT", "score": 0.9}]}

    marker = submit_private_retrieval_shadow(
        query="What did we decide about the rollout?",
        state_path=state_path,
        scope_key="scope-a",
        retriever=retriever,
        tenant_id="tenant",
        workspace_id="workspace",
        config=_config(),
    )
    assert marker["mode"] == "observe_only"
    assert marker["scheduled"] is True
    assert marker["answerInfluence"] is False
    assert marker["candidateContentExposed"] is False
    assert wait_for_private_retrieval_shadow_idle(3.0)
    status = private_retrieval_shadow_status(state_path)
    assert status["counters"]["completed"] == 1
    assert status["latest"]["observationId"] == marker["observationId"]
    assert "PRIVATE_ASYNC_TEXT" not in json.dumps(status)


def test_principal_rate_limit_applies_before_probes_complete(tmp_path: Path):
    release = Event()

    def retriever(*_args, **_kwargs):
        release.wait(3.0)
        return {"search_mode": "semantic", "available": True, "results": []}

    kwargs = {
        "query": "What did we decide about the rollout?",
        "state_path": tmp_path / "rate.json",
        "scope_key": "rate-scope",
        "retriever": retriever,
        "tenant_id": "tenant",
        "workspace_id": "workspace",
        "config": _config(rate_limit=2, max_pending=4),
    }
    try:
        first = submit_private_retrieval_shadow(**kwargs)
        second = submit_private_retrieval_shadow(**kwargs)
        limited = submit_private_retrieval_shadow(**kwargs)
        assert first["scheduled"] is True
        assert second["scheduled"] is True
        assert limited["scheduled"] is False
        assert limited["selectionReason"] == "principal_rate_limited"
    finally:
        release.set()
    assert wait_for_private_retrieval_shadow_idle(3.0)


def test_global_pending_capacity_fails_open(tmp_path: Path):
    release = Event()

    def retriever(*_args, **_kwargs):
        release.wait(3.0)
        return {"search_mode": "semantic", "available": True, "results": []}

    config = _config(max_pending=1)
    try:
        first = submit_private_retrieval_shadow(
            query="What did we decide about the rollout?",
            state_path=tmp_path / "first.json",
            scope_key="capacity-a",
            retriever=retriever,
            tenant_id="tenant",
            workspace_id="workspace",
            config=config,
        )
        limited = submit_private_retrieval_shadow(
            query="What is our current server setting?",
            state_path=tmp_path / "second.json",
            scope_key="capacity-b",
            retriever=retriever,
            tenant_id="tenant",
            workspace_id="workspace",
            config=config,
        )
        assert first["scheduled"] is True
        assert limited["scheduled"] is False
        assert limited["selectionReason"] == "global_capacity_limited"
    finally:
        release.set()
    assert wait_for_private_retrieval_shadow_idle(3.0)


def test_disabled_kill_switch_and_ineligible_submissions_do_not_call_retriever(tmp_path: Path):
    calls = []

    def retriever(*args, **kwargs):
        calls.append((args, kwargs))
        return {"search_mode": "hybrid", "results": []}

    disabled = submit_private_retrieval_shadow(
        query="What did we decide?",
        state_path=tmp_path / "disabled.json",
        scope_key="disabled",
        retriever=retriever,
        tenant_id="tenant",
        workspace_id="workspace",
        config=_config(enabled=False),
    )
    killed = submit_private_retrieval_shadow(
        query="What did we decide?",
        state_path=tmp_path / "killed.json",
        scope_key="killed",
        retriever=retriever,
        tenant_id="tenant",
        workspace_id="workspace",
        config=_config(kill_switch=True),
    )
    ineligible = submit_private_retrieval_shadow(
        query="Implement the feature",
        state_path=tmp_path / "ineligible.json",
        scope_key="ineligible",
        retriever=retriever,
        tenant_id="tenant",
        workspace_id="workspace",
        config=_config(),
    )
    assert disabled["scheduled"] is False
    assert disabled["selectionReason"] == "disabled"
    assert killed["scheduled"] is False
    assert killed["selectionReason"] == "kill_switch"
    assert ineligible["scheduled"] is False
    assert ineligible["eligible"] is False
    assert calls == []
