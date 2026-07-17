from __future__ import annotations

import asyncio
import json
import multiprocessing
from pathlib import Path
from types import SimpleNamespace

import pytest

import cortex_server.modules.reasoning_approvals as approvals
import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.modules.reasoning_store as reasoning_store
from cortex_server.modules.memory_scope import AuthenticatedMemoryPrincipal
from cortex_server.routers import nexus, orchestrator


def _reasoning_reservation_worker(start, results, db_path: str) -> None:
    orchestrator.DEFAULT_DB_PATH = Path(db_path)
    orchestrator.MAX_REASONING_PRINCIPAL_RESERVATIONS = 1
    start.wait()
    try:
        reservation = orchestrator._reserve_reasoning_plan(
            principal_hash="d" * 64,
            workflow={
                "workflow_id": f"wf-{multiprocessing.current_process().pid}",
                "metadata": {},
                "steps": [],
            },
            approval_count=0,
        )
        results.put(("accepted", reservation))
    except orchestrator.ReasoningPlanQuotaError as exc:
        results.put(("rejected", str(exc)))


def _principal(*, session: str = "session-a") -> AuthenticatedMemoryPrincipal:
    return AuthenticatedMemoryPrincipal(
        credential_id="dynamic-session-credential",
        tenant_id="tenant-a",
        workspace_id="workspace-a",
        agent_id="agent-a",
        user_id="user-a",
        channel_id="channel-a",
        session_id=session,
    )


def _runtime_graph():
    return orchestrator.ReasoningPlanGraph(
        name="quota-plan",
        metadata={"owner": "caller", "session_key": "caller-session"},
        nodes=[
            {
                "node_id": "one",
                "title": "One",
                "endpoint": "/oracle/chat",
                "payload": {"prompt": "bounded"},
            }
        ],
    )


def test_referent_state_summarizes_maximum_queries_and_lru_bounds_rotated_sessions(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(nexus, "_REFERENT_STATE_PATH", tmp_path / "referents.json")
    monkeypatch.setattr(nexus, "_REFERENT_STATE_MAX_PRINCIPAL_OBJECTS", 2)
    nexus._CONTEXT_STATES.clear()
    principal_hash = nexus._referent_principal_quota_key(_principal())
    paths = []

    for index in range(3):
        continuity_key = f"principal:{index:064x}"
        reservation = nexus._reserve_referent_state(continuity_key, principal_hash)
        nexus._refresh_context(
            "q" * 1_048_576,
            "a" * 1_048_576,
            continuity_key=continuity_key,
            quota_principal_key=principal_hash,
            reservation=reservation,
        )
        paths.append(nexus._referent_state_path(continuity_key))

    retained = sorted(nexus._referent_state_root().glob("[0-9a-f]*.json"))
    assert len(retained) == 2
    assert not paths[0].exists()
    for path in retained:
        encoded = path.read_bytes()
        state = json.loads(encoded)
        assert len(encoded) <= nexus._REFERENT_STATE_MAX_OBJECT_BYTES
        assert len(state["recent_turns"][0]["query"]) == nexus._REFERENT_TURN_QUERY_MAX_CHARS
        assert len(state["recent_turns"][0]["answer"]) == nexus._REFERENT_TURN_ANSWER_MAX_CHARS
        assert state["quota_principal_hash"] == principal_hash

    unicode_text = "🧠" * 100_000
    unicode_state = {
        "updated_at": nexus._now_iso(),
        "last_fix_plan": "🧠" * 10_000,
        "last_codeword": "bounded",
        "recent_turns": [
            {"query": unicode_text, "answer": unicode_text, "ts": nexus._now_iso()}
            for _ in range(nexus._RECENT_TURNS_MAX)
        ],
    }
    unicode_encoded = json.dumps(
        nexus._context_for_disk("unicode", unicode_state),
        ensure_ascii=False,
    ).encode("utf-8")
    assert len(unicode_encoded) <= nexus._REFERENT_STATE_MAX_OBJECT_BYTES


def test_referent_aggregate_admission_rejects_without_creating_state_or_reservation(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(nexus, "_REFERENT_STATE_PATH", tmp_path / "referents.json")
    monkeypatch.setattr(nexus, "_REFERENT_STATE_MAX_OBJECTS", 1)
    nexus._CONTEXT_STATES.clear()
    first = "principal:" + ("1" * 64)
    second = "principal:" + ("2" * 64)
    first_reservation = nexus._reserve_referent_state(first, "a" * 64)
    nexus._refresh_context(
        "Use codeword bounded-one",
        continuity_key=first,
        quota_principal_key="a" * 64,
        reservation=first_reservation,
    )

    with pytest.raises(nexus.ReferentStateQuotaError, match="aggregate object quota"):
        nexus._reserve_referent_state(second, "b" * 64)

    assert not nexus._referent_state_path(second).exists()
    reservation_root = nexus._referent_reservation_root(nexus._referent_state_root())
    assert not list(reservation_root.glob("[0-9a-f]*.json"))


def test_nexus_quota_failure_precedes_transaction_journal_and_adaptive_cache(
    tmp_path, monkeypatch
):
    principal = _principal()
    monkeypatch.setattr(
        nexus,
        "_authenticated_nexus_principal",
        lambda *_args, **_kwargs: (principal, principal.session_id),
    )
    monkeypatch.setattr(nexus, "_codec_session_key", lambda _request: principal.session_id)
    monkeypatch.setattr(
        nexus,
        "_reserve_referent_state",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            nexus.ReferentStateQuotaError("simulated full referent store")
        ),
    )
    monkeypatch.setattr(
        nexus,
        "ExecutionTransaction",
        lambda **_kwargs: (_ for _ in ()).throw(
            AssertionError("transaction journal must not precede quota admission")
        ),
    )
    monkeypatch.setattr(
        nexus,
        "_adaptive_policies_for_scope",
        lambda _scope: (_ for _ in ()).throw(
            AssertionError("adaptive cache must not precede quota admission")
        ),
    )
    request = SimpleNamespace(
        state=SimpleNamespace(request_id="quota-rejection"),
        headers={},
        client=SimpleNamespace(host="127.0.0.1"),
    )

    with pytest.raises(nexus.HTTPException) as rejected:
        asyncio.run(
            nexus.orchestrate_query(
                query="bounded request",
                request=request,
                payload=None,
            )
        )

    assert rejected.value.status_code == 429
    assert not (tmp_path / "transaction-journal").exists()


def test_reasoning_quota_rejects_before_workflow_process_or_cache_side_effect(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "reasoning.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    calls = []
    monkeypatch.setattr(
        orchestrator,
        "_reserve_reasoning_plan",
        lambda **_kwargs: (_ for _ in ()).throw(
            orchestrator.ReasoningPlanQuotaError("simulated full reasoning store")
        ),
    )
    monkeypatch.setattr(
        orchestrator,
        "_build_workflow_from_plan",
        lambda *_args, **_kwargs: calls.append("compile"),
    )
    monkeypatch.setattr(
        orchestrator,
        "_persist_workflow",
        lambda _workflow: calls.append("workflow"),
    )
    monkeypatch.setattr(
        orchestrator.runtime_service,
        "schedule_runtime_plan",
        lambda *_args, **_kwargs: calls.append("process"),
    )
    principal = SimpleNamespace(
        role="principal",
        credential_id="dynamic-session-credential",
        tenant_id="tenant-a",
        workspace_id="workspace-a",
        storage_workspace_id="storage-a",
        agent_id="agent-a",
        user_id="user-a",
        channel_id="channel-a",
        session_id="session-a",
    )
    http_request = SimpleNamespace(state=SimpleNamespace(cortex_principal=principal))

    with pytest.raises(orchestrator.HTTPException) as rejected:
        asyncio.run(
            orchestrator.schedule_plan_runtime(
                orchestrator.RuntimePlanRequest(graph=_runtime_graph()),
                http_request,
            )
        )

    assert rejected.value.status_code == 429
    assert calls == []
    assert orchestrator.workflows == {}
    assert not db_path.exists()


def test_reasoning_reservations_are_per_principal_atomic_and_cache_is_bounded(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "reasoning.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "MAX_REASONING_PRINCIPAL_RESERVATIONS", 1)
    workflow = {"workflow_id": "wf-one", "metadata": {}, "steps": []}
    first = orchestrator._reserve_reasoning_plan(
        principal_hash="a" * 64,
        workflow=workflow,
        approval_count=0,
    )
    try:
        with pytest.raises(orchestrator.ReasoningPlanQuotaError, match="principal reservation"):
            orchestrator._reserve_reasoning_plan(
                principal_hash="a" * 64,
                workflow={**workflow, "workflow_id": "wf-two"},
                approval_count=0,
            )
    finally:
        orchestrator._release_reasoning_plan_reservation(first)

    monkeypatch.setattr(orchestrator, "MAX_REASONING_WORKFLOW_CACHE_ENTRIES", 2)
    cache = orchestrator._BoundedWorkflowCache()
    cache["one"] = {"workflow_id": "one"}
    cache["two"] = {"workflow_id": "two"}
    cache["three"] = {"workflow_id": "three"}
    assert list(cache) == ["two", "three"]


def test_reasoning_quota_reconciles_durable_workflow_process_event_rows(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "reasoning.db"
    principal_hash = "c" * 64
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "MAX_REASONING_PRINCIPAL_WORKFLOWS", 1)
    reasoning_store.upsert_doc(
        "workflows",
        "wf-existing",
        {
            "workflow_id": "wf-existing",
            "metadata": {"_reasoning_quota_principal_hash": principal_hash},
        },
        db_path=db_path,
    )
    reasoning_store.upsert_doc(
        "reasoning_processes",
        "proc-existing",
        {
            "process_id": "proc-existing",
            "workflow": {
                "metadata": {"_reasoning_quota_principal_hash": principal_hash}
            },
        },
        db_path=db_path,
    )
    reasoning_store.append_event(
        "reasoning_process_events",
        "proc-existing",
        "event-existing",
        {"kind": "process_created"},
        db_path=db_path,
    )

    usage = orchestrator._reasoning_db_usage(db_path, principal_hash)
    assert usage["principal_workflows"] == 1
    assert usage["principal_processes"] == 1
    assert usage["principal_events"] == 1
    assert usage["principal_bytes"] > 0
    with pytest.raises(orchestrator.ReasoningPlanQuotaError, match="principal workflow quota"):
        orchestrator._reserve_reasoning_plan(
            principal_hash=principal_hash,
            workflow={"workflow_id": "wf-rejected", "metadata": {}, "steps": []},
            approval_count=0,
        )


def test_reasoning_reservation_admission_is_atomic_across_processes(
    tmp_path, monkeypatch
):
    try:
        context = multiprocessing.get_context("fork")
    except ValueError:
        pytest.skip("cross-process quota regression requires fork support")
    db_path = tmp_path / "reasoning.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "MAX_REASONING_PRINCIPAL_RESERVATIONS", 1)
    start = context.Event()
    results = context.Queue()
    workers = [
        context.Process(
            target=_reasoning_reservation_worker,
            args=(start, results, str(db_path)),
        )
        for _ in range(2)
    ]
    for worker in workers:
        worker.start()
    start.set()
    for worker in workers:
        worker.join(timeout=10)
        assert worker.exitcode == 0
    outcomes = [results.get(timeout=2) for _ in workers]
    assert sorted(row[0] for row in outcomes) == ["accepted", "rejected"]
    accepted = next(row[1] for row in outcomes if row[0] == "accepted")
    orchestrator._release_reasoning_plan_reservation(accepted)
