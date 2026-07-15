import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import cortex_server.modules.reasoning_approvals as approvals
import cortex_server.modules.reasoning_beliefs as beliefs
import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph


@pytest.fixture(autouse=True)
def _isolate_runtime_delivery_root(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")



def _graph() -> ReasoningPlanGraph:
    return ReasoningPlanGraph(
        name="runtime_orchestrator_plan",
        metadata={"owner": "cortex", "session_key": "session:orchestrator", "archetype": "coding"},
        nodes=[
            {
                "node_id": "fetch",
                "title": "Fetch",
                "endpoint": "/users/get",
                "method": "POST",
                "payload": {"id": 1},
            },
            {
                "node_id": "summarize",
                "title": "Summarize",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "depends_on": ["fetch"],
                "payload": {"prompt": "Summarize {{fetch.response.name}}"},
            },
        ],
    )


def test_runtime_plan_binds_authenticated_principal_server_side(monkeypatch):
    captured = {}
    graph = _graph()
    graph.metadata.update(
        {
            "tenant_id": "forged-tenant",
            "storage_workspace_id": "forged-workspace",
            "user_id": "mallory",
            "agent_id": "mallory-agent",
            "owner": "mallory",
            "principal": {"tenant_id": "forged-principal"},
        }
    )
    request = orchestrator.RuntimePlanRequest(graph=graph)
    principal = SimpleNamespace(
        role="principal",
        credential_id="readers",
        tenant_id="tenant-a",
        workspace_id="workspace-a",
        storage_workspace_id="principal-workspace-a",
        agent_id="agent-alice",
        user_id="alice",
        channel_id="api",
        session_id="alice-session",
    )

    monkeypatch.setattr(orchestrator, "_store_workflow_from_plan", lambda value: {"metadata": value.metadata})
    monkeypatch.setattr(orchestrator, "_runtime_delivery_stores", lambda: {})

    def schedule(value, **_kwargs):
        captured["request"] = value
        return {"success": True, "process": {}}

    monkeypatch.setattr(orchestrator.runtime_service, "schedule_runtime_plan", schedule)
    result = asyncio.run(
        orchestrator.schedule_plan_runtime(
            request,
            SimpleNamespace(state=SimpleNamespace(cortex_principal=principal)),
        )
    )

    assert result["success"] is True
    metadata = captured["request"].graph.metadata
    assert metadata["tenant_id"] == "tenant-a"
    assert metadata["workspace_id"] == "workspace-a"
    assert metadata["storage_workspace_id"] == "principal-workspace-a"
    assert metadata["user_id"] == "alice"
    assert metadata["agent_id"] == "agent-alice"
    assert metadata["owner"] == "alice"
    assert metadata["principal"]["tenant_id"] == "tenant-a"
    assert captured["request"].options.owner == "alice"
    assert captured["request"].options.session_key == "alice-session"



def test_orchestrator_runtime_executes_due_nodes(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    monkeypatch.setattr(orchestrator, "upsert_belief", beliefs.upsert_belief)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        node_id = step.get("node_id")
        if node_id == "fetch":
            return {
                "step": step_index,
                "node_id": node_id,
                "title": step.get("title"),
                "endpoint": step.get("endpoint"),
                "method": step.get("method"),
                "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
                "status_code": 200,
                "response": {"name": "Jake"},
                "elapsed_ms": 5.0,
                "success": True,
            }
        return {
            "step": step_index,
            "node_id": node_id,
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"text": "Summary for Jake"},
            "elapsed_ms": 4.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    process_id = scheduled["process"]["process_id"]

    first_tick = asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    assert first_tick["success"] is True
    assert first_tick["executed_count"] == 2
    assert [item["node_id"] for item in first_tick["executed"]] == ["fetch", "summarize"]

    process_view = asyncio.run(orchestrator.get_runtime_process_view(process_id))
    assert process_view["process"]["status"] == "completed"
    assert process_view["process"]["nodes"]["fetch"]["status"] == "completed"
    assert process_view["process"]["nodes"]["summarize"]["status"] == "completed"
    assert len(process_view["beliefs"]) >= 2


def test_orchestrator_plan_execute_halt_cancels_remaining(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 500,
            "response": {"ok": False},
            "elapsed_ms": 2.0,
            "success": False,
            "error": "boom",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="halt_plan",
        metadata={"owner": "cortex", "session_key": "session:halt", "archetype": "coding"},
        nodes=[
            {
                "node_id": "danger",
                "title": "Danger",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "fail"},
                "failure_mode": "halt",
            },
            {
                "node_id": "cleanup",
                "title": "Cleanup",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "depends_on": ["danger"],
                "payload": {"prompt": "should not run"},
            },
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))
    steps = result["execution"]["steps"]
    assert result["execution"]["status"] == "partial_failure"
    assert steps[0]["node_id"] == "danger"
    assert steps[0]["success"] is False
    assert steps[1]["node_id"] == "cleanup"
    assert steps[1]["cancelled"] is True


def test_workflow_persists_via_store(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="persisted_plan",
        metadata={"owner": "cortex", "session_key": "session:persist", "archetype": "coding"},
        nodes=[
            {
                "node_id": "step1",
                "title": "Step1",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "ok"},
            }
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))
    workflow_id = result["workflow_id"]
    orchestrator.workflows.clear()
    loaded = asyncio.run(orchestrator.get_workflow(workflow_id))

    assert loaded["workflow"]["workflow_id"] == workflow_id
    assert loaded["workflow"]["executions"][0]["status"] == "success"


def test_workflow_execution_and_rerun_reload_from_sqlite_store(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True, "node": step.get("node_id")},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="reloadable_plan",
        metadata={"owner": "cortex", "session_key": "session:reload", "archetype": "coding"},
        nodes=[
            {
                "node_id": "step1",
                "title": "Step1",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "ok"},
            }
        ],
    )

    created = asyncio.run(orchestrator.create_and_run_plan(graph))
    workflow_id = created["workflow_id"]
    execution_id = created["execution"]["execution_id"]

    orchestrator.workflows.clear()
    listed = asyncio.run(orchestrator.list_workflows())
    fetched_execution = asyncio.run(orchestrator.get_execution(execution_id))
    rerun = asyncio.run(orchestrator.rerun_workflow(workflow_id))

    assert any(row["workflow_id"] == workflow_id for row in listed["workflows"])
    assert fetched_execution["execution"]["execution_id"] == execution_id
    assert rerun["execution"]["status"] == "success"
    assert rerun["execution"]["execution_id"] != execution_id


def test_strict_policy_requires_contracts_when_enabled(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        raise AssertionError("should not hit patched step executor")

    # keep raw executor; no monkeypatch to _execute_single_step needed because policy block occurs before network call

    graph = ReasoningPlanGraph(
        name="strict_policy_plan",
        metadata={
            "owner": "cortex",
            "session_key": "session:strict",
            "archetype": "coding",
            "verification_mode": "strict",
            "strict_requires_contracts": True,
        },
        nodes=[
            {
                "node_id": "step1",
                "title": "Step1",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "ok"},
            }
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))
    step = result["execution"]["steps"][0]

    assert result["execution"]["status"] == "partial_failure"
    assert step["success"] is False
    assert step["error"] == "policy_requires_contracts"
    assert step["policy"]["verification_mode"] == "strict"


def test_policy_can_disable_same_tick_drain(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    monkeypatch.setattr(orchestrator, "upsert_belief", beliefs.upsert_belief)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        node_id = step.get("node_id")
        if node_id == "fetch":
            return {
                "step": step_index,
                "node_id": node_id,
                "title": step.get("title"),
                "endpoint": step.get("endpoint"),
                "method": step.get("method"),
                "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
                "status_code": 200,
                "response": {"name": "Jake"},
                "elapsed_ms": 5.0,
                "success": True,
            }
        return {
            "step": step_index,
            "node_id": node_id,
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"text": "Summary for Jake"},
            "elapsed_ms": 4.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="no_drain_plan",
        metadata={
            "owner": "cortex",
            "session_key": "session:no-drain",
            "archetype": "coding",
            "same_tick_drain": False,
        },
        nodes=_graph().model_dump()["nodes"],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    process_id = scheduled["process"]["process_id"]

    first_tick = asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    second_tick = asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    process_view = asyncio.run(orchestrator.get_runtime_process_view(process_id))

    assert first_tick["executed_count"] == 1
    assert first_tick["executed"][0]["node_id"] == "fetch"
    assert second_tick["executed_count"] == 1
    assert second_tick["executed"][0]["node_id"] == "summarize"
    assert process_view["process"]["status"] == "completed"


def test_policy_parallelism_controls_batching(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    call_log = []

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        call_log.append((step.get("node_id"), len(results_by_node)))
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="parallel_policy_plan",
        metadata={
            "owner": "cortex",
            "session_key": "session:parallel",
            "archetype": "coding",
            "execution_mode": "parallel",
            "max_parallelism": 2,
        },
        nodes=[
            {"node_id": "a", "title": "A", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "a"}},
            {"node_id": "b", "title": "B", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "b"}},
            {"node_id": "c", "title": "C", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "c"}},
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))

    assert result["execution"]["status"] == "success"
    # first two nodes should run in the same policy batch, so both see no prior results
    assert call_log[0][1] == 0
    assert call_log[1][1] == 0
    # third node should see earlier results once first batch is committed
    assert call_log[2][1] >= 2


def test_orchestrator_retry_failure_mode_succeeds_on_second_attempt(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    calls = {"count": 0}

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        calls["count"] += 1
        if calls["count"] == 1:
            return {
                "step": step_index,
                "node_id": step.get("node_id"),
                "title": step.get("title"),
                "endpoint": step.get("endpoint"),
                "method": step.get("method"),
                "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
                "status_code": 500,
                "response": {"ok": False},
                "elapsed_ms": 1.0,
                "success": False,
                "error": "boom",
            }
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="retry_success_plan",
        metadata={"owner": "cortex", "session_key": "session:retry-success", "archetype": "coding"},
        nodes=[
            {
                "node_id": "step1",
                "title": "Step1",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "failure_mode": "retry",
                "metadata": {"max_attempts": 2, "retry_backoff_seconds": 0},
                "payload": {"prompt": "ok"},
            }
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))
    step = result["execution"]["steps"][0]

    assert result["execution"]["status"] == "success"
    assert step["success"] is True
    assert step["retry_count"] == 1
    assert step["attempts"] == 2


def test_orchestrator_timeout_retry_can_be_disabled(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    calls = {"count": 0}

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        calls["count"] += 1
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "timeout:simulated",
            "error_type": "timeout",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="timeout_retry_disabled",
        metadata={"owner": "cortex", "session_key": "session:timeout", "archetype": "coding", "retry_on_timeout": False},
        nodes=[
            {
                "node_id": "step1",
                "title": "Step1",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "failure_mode": "retry",
                "metadata": {"max_attempts": 3, "retry_backoff_seconds": 0},
                "payload": {"prompt": "ok"},
            }
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))
    step = result["execution"]["steps"][0]

    assert result["execution"]["status"] == "partial_failure"
    assert step["success"] is False
    assert step["attempts"] == 1
    assert calls["count"] == 1


def test_orchestrator_workflow_deadline_cancels_remaining_steps(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    deadline_state = {"first_complete": False}

    def fake_deadline_exceeded(deadline_at):
        return bool(deadline_state["first_complete"])

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        await asyncio.sleep(0)
        if step.get("node_id") == "first":
            deadline_state["first_complete"] = True
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 20.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)
    monkeypatch.setattr(orchestrator.runtime_execution, "deadline_exceeded", fake_deadline_exceeded)

    graph = ReasoningPlanGraph(
        name="deadline_execute_plan",
        metadata={"owner": "cortex", "session_key": "session:deadline-exec", "archetype": "coding", "workflow_deadline_seconds": 60.0},
        nodes=[
            {"node_id": "first", "title": "First", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "1"}},
            {"node_id": "second", "title": "Second", "endpoint": "/oracle/chat", "method": "POST", "depends_on": ["first"], "payload": {"prompt": "2"}},
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))
    steps = result["execution"]["steps"]

    assert result["execution"]["status"] == "partial_failure"
    assert steps[0]["success"] is True
    assert steps[1]["cancelled"] is True
    assert steps[1]["error"] == "workflow_deadline_exceeded"


def test_orchestrator_compensation_hook_runs_on_failure(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    calls = []

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        calls.append(step.get("node_id"))
        if str(step.get("node_id")).startswith("main"):
            return {
                "step": step_index,
                "node_id": step.get("node_id"),
                "title": step.get("title"),
                "endpoint": step.get("endpoint"),
                "method": step.get("method"),
                "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
                "status_code": 500,
                "response": {"ok": False},
                "elapsed_ms": 1.0,
                "success": False,
                "error": "boom",
            }
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="compensate_plan",
        metadata={"owner": "cortex", "session_key": "session:compensate", "archetype": "coding"},
        nodes=[
            {
                "node_id": "main",
                "title": "Main",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "failure_mode": "compensate",
                "payload": {"prompt": "run"},
                "metadata": {
                    "compensation": {
                        "node_id": "undo",
                        "title": "Undo",
                        "endpoint": "/oracle/chat",
                        "method": "POST",
                        "payload": {"prompt": "undo"}
                    }
                },
            },
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))
    step = result["execution"]["steps"][0]

    assert result["execution"]["status"] == "partial_failure"
    assert step["success"] is False
    assert step["compensation"]["triggered"] is True
    assert step["compensation"]["success"] is True
    assert step["compensation"]["results"][0]["success"] is True


def test_runtime_cancel_route_updates_process(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    process_id = scheduled["process"]["process_id"]
    cancelled = asyncio.run(orchestrator.cancel_runtime_process_route(process_id, reason="operator_stop"))

    assert cancelled["process"]["status"] == "cancelled"
    assert cancelled["process"]["nodes"]["fetch"]["status"] == "cancelled"


def test_orchestrator_retry_respects_status_code_filter(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    calls = {"count": 0}

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        calls["count"] += 1
        if calls["count"] == 1:
            return {
                "step": step_index,
                "node_id": step.get("node_id"),
                "title": step.get("title"),
                "endpoint": step.get("endpoint"),
                "method": step.get("method"),
                "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
                "status_code": 500,
                "response": {"ok": False},
                "elapsed_ms": 1.0,
                "success": False,
                "error": "boom",
            }
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="retry_status_match",
        metadata={"owner": "cortex", "session_key": "session:retry-status-match", "archetype": "coding", "retry_on_status_codes": [500]},
        nodes=[
            {
                "node_id": "step1",
                "title": "Step1",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "failure_mode": "retry",
                "metadata": {"max_attempts": 2, "retry_backoff_seconds": 0},
                "payload": {"prompt": "ok"},
            }
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))
    step = result["execution"]["steps"][0]

    assert result["execution"]["status"] == "success"
    assert step["attempts"] == 2
    assert step["retry_count"] == 1


def test_orchestrator_retry_respects_error_type_filter(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()
    calls = {"count": 0}

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        calls["count"] += 1
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 500,
            "response": {"ok": False},
            "elapsed_ms": 1.0,
            "success": False,
            "error": "boom",
            "error_type": "http_error",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="retry_error_type_mismatch",
        metadata={"owner": "cortex", "session_key": "session:retry-error-type", "archetype": "coding", "retry_on_error_types": ["timeout"]},
        nodes=[
            {
                "node_id": "step1",
                "title": "Step1",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "failure_mode": "retry",
                "metadata": {"max_attempts": 3, "retry_backoff_seconds": 0},
                "payload": {"prompt": "ok"},
            }
        ],
    )

    result = asyncio.run(orchestrator.create_and_run_plan(graph))
    step = result["execution"]["steps"][0]

    assert result["execution"]["status"] == "partial_failure"
    assert step["attempts"] == 1
    assert calls["count"] == 1


def test_runtime_belief_explain_route_exposes_evidence_chain(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)
    monkeypatch.setattr(orchestrator, "list_beliefs", beliefs.list_beliefs)
    monkeypatch.setattr(orchestrator, "search_beliefs", beliefs.search_beliefs)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    orchestrator.workflows.clear()

    claim = beliefs.upsert_belief(
        subject="process:demo:node:fetch",
        predicate="status",
        value="completed",
        task_id="task_demo",
        source_type="runtime_execution",
        source_ref="fetch",
        note="node execution result",
    )

    explained = asyncio.run(orchestrator.get_runtime_belief(claim["claim_id"]))

    assert explained["success"] is True
    assert explained["belief"]["claim_id"] == claim["claim_id"]
    assert explained["evidence_chain"][0]["source_ref"] == "fetch"
    assert explained["evidence_bundle"]["source_types"]["runtime_execution"] == 1
    assert explained["lineage_graph"]["nodes"]
    assert explained["contradiction_cluster"]["operator_summary"]
    assert explained["epistemic_risk"]["operator_summary"]
    assert explained["contradiction_summary"]["operator_summary"]


def test_runtime_tick_links_produced_beliefs_to_step_result(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "upsert_belief", beliefs.upsert_belief)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)
    monkeypatch.setattr(orchestrator, "list_beliefs", beliefs.list_beliefs)
    monkeypatch.setattr(orchestrator, "search_beliefs", beliefs.search_beliefs)
    monkeypatch.setattr(orchestrator, "summarize_beliefs", beliefs.summarize_beliefs)
    monkeypatch.setattr(orchestrator, "belief_conflicts", beliefs.belief_conflicts)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="belief_link_plan",
        metadata={"owner": "cortex", "session_key": "session:belief-link", "archetype": "coding"},
        nodes=[
            {"node_id": "fetch", "title": "Fetch", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ping"}},
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    process_id = scheduled["process"]["process_id"]
    tick = asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    explained = asyncio.run(orchestrator.explain_runtime_process(process_id))

    result = tick["executed"][0]["result"]
    assert result["produced_belief_count"] >= 2
    assert len(result["produced_belief_ids"]) == result["produced_belief_count"]
    assert explained["belief_summary"]["count"] >= 2


def test_runtime_belief_conflicts_route_returns_conflicts(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "belief_conflicts", beliefs.belief_conflicts)

    beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id="task_conflicts", source_type="pytest")
    beliefs.upsert_belief(subject="repo", predicate="status", value="red", task_id="task_conflicts", source_type="pytest", conflict_mode="contradict")

    result = asyncio.run(orchestrator.get_runtime_belief_conflicts(subject="repo", predicate="status", limit=10))

    assert result["success"] is True
    assert result["count"] >= 1


def test_runtime_belief_lineage_route_returns_chain(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "trace_belief_lineage", beliefs.trace_belief_lineage)

    first = beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id="task_lineage_route", source_type="pytest")
    second = beliefs.upsert_belief(subject="repo", predicate="status", value="red", task_id="task_lineage_route", source_type="pytest", conflict_mode="contradict")

    result = asyncio.run(orchestrator.get_runtime_belief_lineage(second["claim_id"]))

    assert result["success"] is True
    assert result["belief"]["claim_id"] == second["claim_id"]
    assert any(row["claim_id"] == first["claim_id"] for row in result["contradicts_chain"] + result["supersedes_chain"])


def test_process_explain_includes_step_belief_influences(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "select_influential_beliefs", beliefs.select_influential_beliefs)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)
    monkeypatch.setattr(orchestrator, "summarize_beliefs", beliefs.summarize_beliefs)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    orchestrator.workflows.clear()

    graph = ReasoningPlanGraph(
        name="belief_influence_plan",
        metadata={"owner": "cortex", "session_key": "session:belief-influence", "archetype": "coding"},
        nodes=[
            {
                "node_id": "fetch",
                "title": "Fetch",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "ping"},
                "metadata": {"belief_subjects": ["repo"], "belief_predicates": ["status"]},
            },
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    process_id = scheduled["process"]["process_id"]
    task_id = scheduled["process"]["task_id"]

    beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id=task_id, source_type="pytest")
    beliefs.upsert_belief(subject="svc", predicate="latency", value=10, task_id=task_id, source_type="probe")

    explained = asyncio.run(orchestrator.explain_runtime_process(process_id))
    influence = explained["step_belief_influences"][0]

    assert influence["node_id"] == "fetch"
    assert influence["belief_count"] >= 1
    assert influence["filters"]["subjects"] == ["repo"]
    assert influence["filters"]["predicates"] == ["status"]


def test_runtime_process_persists_captured_belief_context_snapshot(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "upsert_belief", beliefs.upsert_belief)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)
    monkeypatch.setattr(orchestrator, "select_influential_beliefs", beliefs.select_influential_beliefs)
    monkeypatch.setattr(orchestrator, "summarize_beliefs", beliefs.summarize_beliefs)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="captured_belief_context_plan",
        metadata={"owner": "cortex", "session_key": "session:captured-belief", "archetype": "coding"},
        nodes=[
            {
                "node_id": "fetch",
                "title": "Fetch",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "ping"},
                "metadata": {"belief_subjects": ["repo"], "belief_predicates": ["status"]},
            },
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    process_id = scheduled["process"]["process_id"]
    task_id = scheduled["process"]["task_id"]
    beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id=task_id, source_type="pytest")

    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    explained = asyncio.run(orchestrator.explain_runtime_process(process_id))
    influence = explained["step_belief_influences"][0]
    process_view = asyncio.run(orchestrator.get_runtime_process_view(process_id))

    assert influence["captured_at_execution"] is True
    assert influence["belief_count"] >= 1
    assert influence["produced_belief_ids"]
    assert process_view["process"]["results_by_node"]["fetch"]["belief_context"]["selected_count"] >= 1


def test_workflow_policy_carries_belief_influence_ids(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "select_influential_beliefs", beliefs.select_influential_beliefs)
    orchestrator.workflows.clear()

    claim = beliefs.upsert_belief(subject="repo", predicate="status", value="green", source_type="pytest")

    graph = ReasoningPlanGraph(
        name="repo status workflow",
        metadata={"owner": "cortex", "session_key": "session:policy-beliefs", "archetype": "coding", "policy_belief_subjects": ["repo"], "policy_belief_predicates": ["status"]},
        nodes=[
            {"node_id": "step1", "title": "Step1", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ok"}},
        ],
    )

    created = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    workflow = asyncio.run(orchestrator.get_workflow(created["workflow_id"]))["workflow"]
    policy = workflow["metadata"]["policy"]

    assert claim["claim_id"] in policy["belief_influence_ids"]
    assert policy["belief_influences"]
    assert all(claim["claim_id"] in (decision.get("inputs") or {}).get("belief_ids", []) for decision in policy["decisions"])


def test_process_explain_reports_belief_context_delta(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "upsert_belief", beliefs.upsert_belief)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)
    monkeypatch.setattr(orchestrator, "select_influential_beliefs", beliefs.select_influential_beliefs)
    monkeypatch.setattr(orchestrator, "summarize_beliefs", beliefs.summarize_beliefs)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="belief_delta_plan",
        metadata={"owner": "cortex", "session_key": "session:belief-delta", "archetype": "coding"},
        nodes=[
            {
                "node_id": "fetch",
                "title": "Fetch",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "ping"},
                "metadata": {"belief_subjects": ["repo"], "belief_predicates": ["status"]},
            },
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    process_id = scheduled["process"]["process_id"]
    task_id = scheduled["process"]["task_id"]
    first = beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id=task_id, source_type="pytest")

    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    beliefs.upsert_belief(subject="repo", predicate="status", value="red", task_id=task_id, source_type="pytest", conflict_mode="contradict")
    explained = asyncio.run(orchestrator.explain_runtime_process(process_id))
    influence = explained["step_belief_influences"][0]

    assert influence["captured_at_execution"] is True
    assert first["claim_id"] in influence["belief_delta"]["captured_ids"]
    assert influence["belief_delta"]["changed"] is True
    assert influence["belief_delta"]["added_ids"] or influence["belief_delta"]["removed_ids"]
    assert explained["epistemic_drift_summary"]["changed_step_count"] >= 1


def test_runtime_policy_explain_route_returns_decision_belief_links(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "select_influential_beliefs", beliefs.select_influential_beliefs)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    orchestrator.workflows.clear()

    claim = beliefs.upsert_belief(subject="repo", predicate="status", value="green", source_type="pytest")

    graph = ReasoningPlanGraph(
        name="repo status workflow",
        metadata={"owner": "cortex", "session_key": "session:policy-explain", "archetype": "coding", "policy_belief_subjects": ["repo"], "policy_belief_predicates": ["status"]},
        nodes=[
            {"node_id": "step1", "title": "Step1", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ok"}},
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    process_id = scheduled["process"]["process_id"]
    explained = asyncio.run(orchestrator.explain_runtime_policy(process_id))

    assert explained["success"] is True
    assert claim["claim_id"] in explained["policy"]["belief_influence_ids"]
    assert explained["decision_explanations"]
    assert all(claim["claim_id"] in row["belief_ids"] for row in explained["decision_explanations"])


def test_process_explain_includes_operator_summaries_and_impact_attribution(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "upsert_belief", beliefs.upsert_belief)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)
    monkeypatch.setattr(orchestrator, "select_influential_beliefs", beliefs.select_influential_beliefs)
    monkeypatch.setattr(orchestrator, "summarize_beliefs", beliefs.summarize_beliefs)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    monkeypatch.setattr(orchestrator, "get_belief", beliefs.get_belief)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 500,
            "response": {"ok": False},
            "elapsed_ms": 1.0,
            "success": False,
            "error": "boom",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="impact_plan",
        metadata={"owner": "cortex", "session_key": "session:impact", "archetype": "coding"},
        nodes=[
            {
                "node_id": "fetch",
                "title": "Fetch",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "ping"},
                "metadata": {"belief_subjects": ["repo"], "belief_predicates": ["status"]},
            },
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    process_id = scheduled["process"]["process_id"]
    task_id = scheduled["process"]["task_id"]
    claim = beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id=task_id, source_type="pytest")

    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    explained = asyncio.run(orchestrator.explain_runtime_process(process_id))
    influence = explained["step_belief_influences"][0]

    assert influence["operator_summary"]
    assert influence["belief_summary_texts"]
    assert claim["claim_id"] in influence["impact_attribution"]["top_belief_ids"]
    assert influence["impact_attribution"]["top_belief_summaries"]
    assert explained["belief_evidence_summary"]["belief_count"] >= 1
    assert explained["epistemic_core_summary"]["operator_summary"]


def test_runtime_policy_explain_includes_operator_summaries(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "select_influential_beliefs", beliefs.select_influential_beliefs)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    monkeypatch.setattr(orchestrator, "get_belief", beliefs.get_belief)
    orchestrator.workflows.clear()

    beliefs.upsert_belief(subject="repo", predicate="status", value="green", source_type="pytest")

    graph = ReasoningPlanGraph(
        name="policy summary workflow",
        metadata={"owner": "cortex", "session_key": "session:policy-summary", "archetype": "coding", "policy_belief_subjects": ["repo"], "policy_belief_predicates": ["status"]},
        nodes=[
            {"node_id": "step1", "title": "Step1", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ok"}},
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    explained = asyncio.run(orchestrator.explain_runtime_policy(scheduled["process"]["process_id"]))

    assert explained["decision_explanations"]
    assert all(row["operator_summary"] for row in explained["decision_explanations"])
    assert any(row["belief_summary_texts"] for row in explained["decision_explanations"])


def test_process_explain_includes_epistemic_timeline_and_execution_trace(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "upsert_belief", beliefs.upsert_belief)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)
    monkeypatch.setattr(orchestrator, "select_influential_beliefs", beliefs.select_influential_beliefs)
    monkeypatch.setattr(orchestrator, "summarize_beliefs", beliefs.summarize_beliefs)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    monkeypatch.setattr(orchestrator, "get_belief", beliefs.get_belief)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200,
            "response": {"ok": True},
            "elapsed_ms": 1.0,
            "success": True,
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="timeline_plan",
        metadata={"owner": "cortex", "session_key": "session:timeline", "archetype": "coding"},
        nodes=[
            {
                "node_id": "fetch",
                "title": "Fetch",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "ping"},
                "metadata": {"belief_subjects": ["repo"], "belief_predicates": ["status"]},
            },
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    task_id = scheduled["process"]["task_id"]
    beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id=task_id, source_type="pytest")
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    explained = asyncio.run(orchestrator.explain_runtime_process(scheduled["process"]["process_id"]))

    assert explained["execution_trace"]
    assert explained["epistemic_timeline"]
    assert explained["epistemic_timeline"][0]["node_id"] == "fetch"
    assert explained["epistemic_timeline"][0]["operator_summary"]


def test_policy_explain_includes_policy_outcome_evaluation(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "select_influential_beliefs", beliefs.select_influential_beliefs)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    monkeypatch.setattr(orchestrator, "get_belief", beliefs.get_belief)
    orchestrator.workflows.clear()

    beliefs.upsert_belief(subject="repo", predicate="status", value="green", source_type="pytest")

    graph = ReasoningPlanGraph(
        name="policy outcome workflow",
        metadata={"owner": "cortex", "session_key": "session:policy-outcome", "archetype": "coding", "policy_belief_subjects": ["repo"], "policy_belief_predicates": ["status"]},
        nodes=[
            {"node_id": "step1", "title": "Step1", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ok"}},
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    explained = asyncio.run(orchestrator.explain_runtime_policy(scheduled["process"]["process_id"]))

    assert explained["policy_outcome_evaluation"]
    assert all(row["operator_summary"] for row in explained["policy_outcome_evaluation"])
    assert explained["policy_outcome_summary"]["overall"]
    assert explained["epistemic_timeline"] is not None
    assert explained["belief_evidence_summary"]["operator_summary"]
    assert explained["epistemic_core_summary"]["operator_summary"]


def test_process_explain_includes_incident_report_and_postmortem(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "upsert_belief", beliefs.upsert_belief)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)
    monkeypatch.setattr(orchestrator, "select_influential_beliefs", beliefs.select_influential_beliefs)
    monkeypatch.setattr(orchestrator, "summarize_beliefs", beliefs.summarize_beliefs)
    monkeypatch.setattr(orchestrator, "explain_belief", beliefs.explain_belief)
    monkeypatch.setattr(orchestrator, "get_belief", beliefs.get_belief)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 500,
            "response": {"ok": False},
            "elapsed_ms": 1.0,
            "success": False,
            "error": "boom",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="incident_plan",
        metadata={"owner": "cortex", "session_key": "session:incident", "archetype": "coding"},
        nodes=[
            {"node_id": "fetch", "title": "Fetch", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ping"}, "failure_mode": "halt"},
            {"node_id": "after", "title": "After", "endpoint": "/oracle/chat", "method": "POST", "depends_on": ["fetch"], "payload": {"prompt": "later"}},
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    explained = asyncio.run(orchestrator.explain_runtime_process(scheduled["process"]["process_id"]))

    assert explained["incident_report"]["incident_count"] >= 1
    assert explained["incident_report"]["root_cause"] is not None
    assert explained["postmortem"]["summary"]
    assert explained["postmortem"]["recommendations"]


def test_runtime_postmortem_route_returns_postmortem_bundle(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    result = asyncio.run(orchestrator.get_runtime_postmortem(scheduled["process"]["process_id"]))

    assert result["success"] is True
    assert result["incident_report"] is not None
    assert result["postmortem"] is not None
    assert result["execution_trace"] is not None
    assert result["epistemic_risk_summary"]["operator_summary"]
    assert result["epistemic_core_summary"]["operator_summary"]


def test_policy_explain_includes_incident_report_and_postmortem(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    explained = asyncio.run(orchestrator.explain_runtime_policy(scheduled["process"]["process_id"]))

    assert explained["incident_report"] is not None
    assert explained["postmortem"] is not None


def test_postmortem_exposes_rerun_recommendations_and_policy_hooks(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "timeout:simulated",
            "error_type": "timeout",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="timeout_plan",
        metadata={"owner": "cortex", "session_key": "session:timeout-postmortem", "archetype": "coding"},
        nodes=[
            {"node_id": "fetch", "title": "Fetch", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ping"}},
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    result = asyncio.run(orchestrator.get_runtime_postmortem(scheduled["process"]["process_id"]))

    assert result["rerun_recommendations"]
    assert result["policy_adaptation_hooks"]
    assert any(row["action"] == "rerun_with_higher_timeout" for row in result["rerun_recommendations"])
    assert any(row["target"] == "scheduler" for row in result["policy_adaptation_hooks"])


def test_incident_trends_route_summarizes_process_history(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled_ok = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    asyncio.run(orchestrator.cancel_runtime_process_route(scheduled_ok["process"]["process_id"], reason="operator_stop"))

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 500,
            "response": {"ok": False},
            "elapsed_ms": 1.0,
            "success": False,
            "error": "boom",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)
    scheduled_fail = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=ReasoningPlanGraph(name="failing", metadata={"owner": "cortex", "session_key": "session:failing", "archetype": "coding"}, nodes=[{"node_id": "x", "title": "X", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "x"}}]))))
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))

    trends = asyncio.run(orchestrator.get_runtime_incident_trends())

    assert trends["success"] is True
    assert trends["trends"]["process_count"] >= 2
    assert trends["trends"]["by_status"]
    assert trends["trends"]["by_root_category"]


def test_policy_explain_exposes_hooks_and_rerun_recommendations(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    explained = asyncio.run(orchestrator.explain_runtime_policy(scheduled["process"]["process_id"]))

    assert explained["rerun_recommendations"] is not None
    assert explained["policy_adaptation_hooks"] is not None


def test_postmortem_exposes_policy_patch_preview_and_self_review(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "timeout:simulated",
            "error_type": "timeout",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="preview_plan",
        metadata={"owner": "cortex", "session_key": "session:preview", "archetype": "coding"},
        nodes=[
            {"node_id": "fetch", "title": "Fetch", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ping"}},
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    result = asyncio.run(orchestrator.get_runtime_postmortem(scheduled["process"]["process_id"]))

    assert result["policy_patch_preview"] is not None
    assert result["self_review"] is not None
    assert "score" in result["self_review"]
    assert result["policy_patch_preview"]["apply_target"] == "workflow.metadata"
    assert result["policy_patch_preview"]["metadata_overrides"]["step_timeout_seconds"] == 30.0
    assert result["policy_patch_preview"]["metadata_overrides"]["retry_max_attempts"] >= 2
    assert any(op["path"] == "/workflow/metadata/step_timeout_seconds" for op in result["policy_patch_preview"]["operations"])


def test_runtime_self_review_route_returns_bundle(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    result = asyncio.run(orchestrator.get_runtime_self_review(scheduled["process"]["process_id"]))

    assert result["success"] is True
    assert result["self_review"] is not None
    assert result["policy_patch_preview"] is not None
    assert result["epistemic_risk_summary"]["operator_summary"]
    assert result["epistemic_core_summary"]["operator_summary"]



def test_runtime_policy_apply_route_updates_process_and_workflow_metadata(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "timeout:simulated",
            "error_type": "timeout",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    graph = ReasoningPlanGraph(
        name="apply_patch_plan",
        metadata={"owner": "cortex", "session_key": "session:apply-patch", "archetype": "coding"},
        nodes=[
            {"node_id": "fetch", "title": "Fetch", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "ping"}},
        ],
    )

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=graph)))
    workflow_id = scheduled["workflow_id"]
    process_id = scheduled["process"]["process_id"]
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))

    applied = asyncio.run(orchestrator.apply_runtime_policy_patch(process_id))
    stored = asyncio.run(orchestrator.get_workflow(workflow_id))

    assert applied["success"] is True
    assert applied["applied"] is True
    assert applied["patch_application"]["updated_metadata"]["step_timeout_seconds"] == 30.0
    assert applied["patch_application"]["updated_metadata"]["retry_max_attempts"] >= 2
    assert applied["process"]["workflow"]["metadata"]["step_timeout_seconds"] == 30.0
    assert applied["process"]["workflow"]["metadata"]["policy"]["settings"]["step_timeout_seconds"] == 30.0
    assert stored["workflow"]["metadata"]["step_timeout_seconds"] == 30.0
    assert stored["workflow"]["metadata"]["policy"]["settings"]["step_timeout_seconds"] == 30.0



def test_runtime_policy_apply_route_supports_dry_run_and_selected_override(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "timeout:simulated",
            "error_type": "timeout",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=ReasoningPlanGraph(name="apply_patch_options", metadata={"owner": "cortex", "session_key": "session:apply-options", "archetype": "coding"}, nodes=[{"node_id": "x", "title": "X", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "x"}}]))))
    workflow_id = scheduled["workflow_id"]
    process_id = scheduled["process"]["process_id"]
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))

    dry_run = asyncio.run(orchestrator.apply_runtime_policy_patch(process_id, orchestrator.RuntimePolicyApplyRequest(dry_run=True, settings=["step_timeout_seconds"], metadata_overrides={"step_timeout_seconds": 45})))
    before_apply = asyncio.run(orchestrator.get_workflow(workflow_id))
    applied = asyncio.run(orchestrator.apply_runtime_policy_patch(process_id, orchestrator.RuntimePolicyApplyRequest(settings=["step_timeout_seconds"], metadata_overrides={"step_timeout_seconds": 45})))
    after_apply = asyncio.run(orchestrator.get_workflow(workflow_id))

    assert dry_run["dry_run"] is True
    assert dry_run["applied"] is False
    assert dry_run["patch_application"]["updated_metadata"]["step_timeout_seconds"] == 45
    assert "step_timeout_seconds" not in before_apply["workflow"]["metadata"]
    assert applied["applied"] is True
    assert applied["process"]["workflow"]["metadata"]["step_timeout_seconds"] == 45
    assert "retry_max_attempts" not in applied["patch_application"]["updated_metadata"]
    assert after_apply["workflow"]["metadata"]["step_timeout_seconds"] == 45



def test_runtime_policy_apply_route_requires_explicit_opt_in_for_confirmation_required_settings(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=ReasoningPlanGraph(name="verification_guard", metadata={"owner": "cortex", "session_key": "session:verification-guard", "archetype": "coding", "verification_mode": "basic"}, nodes=[{"node_id": "x", "title": "X", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "x"}, "contracts": [{"kind": "response_path_exists", "stage": "post", "path": "ok"}]}]))))
    process_id = scheduled["process"]["process_id"]

    blocked = asyncio.run(orchestrator.apply_runtime_policy_patch(process_id, orchestrator.RuntimePolicyApplyRequest(settings=["verification_mode"], metadata_overrides={"verification_mode": "strict"})))
    allowed = asyncio.run(orchestrator.apply_runtime_policy_patch(process_id, orchestrator.RuntimePolicyApplyRequest(settings=["verification_mode"], metadata_overrides={"verification_mode": "strict"}, allow_confirmation_required=True)))

    assert blocked["applied"] is False
    assert any(row["setting"] == "verification_mode" and row["skipped"] == "confirmation_required" for row in blocked["policy_patch_preview"]["skipped"])
    assert allowed["applied"] is True
    assert allowed["process"]["workflow"]["metadata"]["verification_mode"] == "strict"
    assert allowed["request"]["allow_confirmation_required"] is True



def test_runtime_policy_history_and_explain_surfaces_applied_patch_audit(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "timeout:simulated",
            "error_type": "timeout",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=ReasoningPlanGraph(name="policy_history", metadata={"owner": "cortex", "session_key": "session:policy-history", "archetype": "coding"}, nodes=[{"node_id": "x", "title": "X", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "x"}}]))))
    process_id = scheduled["process"]["process_id"]
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    applied = asyncio.run(orchestrator.apply_runtime_policy_patch(process_id, orchestrator.RuntimePolicyApplyRequest(settings=["step_timeout_seconds"], metadata_overrides={"step_timeout_seconds": 45})))

    history = asyncio.run(orchestrator.get_runtime_policy_history(process_id))
    explained = asyncio.run(orchestrator.explain_runtime_policy(process_id))
    process_view = asyncio.run(orchestrator.get_runtime_process_view(process_id))

    assert history["success"] is True
    assert history["policy_patch_history"]["count"] >= 1
    assert history["policy_patch_history"]["entries"][0]["settings"] == ["step_timeout_seconds"]
    assert history["policy_patch_history"]["entries"][0]["operator_overrides"]["step_timeout_seconds"] == 45
    assert history["policy_patch_history"]["entries"][0]["revision_id"] == applied["revision_id"]
    assert explained["policy_patch_history"]["count"] >= 1
    assert process_view["policy_patch_history"]["count"] >= 1



def test_runtime_policy_rollback_restores_prior_metadata(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "timeout:simulated",
            "error_type": "timeout",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=ReasoningPlanGraph(name="policy_rollback", metadata={"owner": "cortex", "session_key": "session:policy-rollback", "archetype": "coding"}, nodes=[{"node_id": "x", "title": "X", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "x"}}]))))
    workflow_id = scheduled["workflow_id"]
    process_id = scheduled["process"]["process_id"]
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    applied = asyncio.run(orchestrator.apply_runtime_policy_patch(process_id, orchestrator.RuntimePolicyApplyRequest(settings=["step_timeout_seconds"], metadata_overrides={"step_timeout_seconds": 45})))
    dry_run = asyncio.run(orchestrator.rollback_runtime_policy_patch(process_id, applied["revision_id"], orchestrator.RuntimePolicyRollbackRequest(dry_run=True)))
    rolled_back = asyncio.run(orchestrator.rollback_runtime_policy_patch(process_id, applied["revision_id"], orchestrator.RuntimePolicyRollbackRequest()))
    stored = asyncio.run(orchestrator.get_workflow(workflow_id))
    history = asyncio.run(orchestrator.get_runtime_policy_history(process_id))

    assert dry_run["dry_run"] is True
    assert dry_run["rolled_back"] is False
    assert dry_run["patch_application"]["updated_metadata"].get("step_timeout_seconds") is None
    assert rolled_back["rolled_back"] is True
    assert rolled_back["rolled_back_from_revision_id"] == applied["revision_id"]
    assert "step_timeout_seconds" not in rolled_back["process"]["workflow"]["metadata"]
    assert "step_timeout_seconds" not in stored["workflow"]["metadata"]
    assert history["policy_patch_history"]["count"] >= 2
    assert history["policy_patch_history"]["entries"][0]["kind"] == "policy_patch_applied"
    assert history["policy_patch_history"]["entries"][1]["kind"] == "policy_patch_rolled_back"



def test_runtime_policy_rollback_blocks_conflicting_intervening_revisions_by_default(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "timeout:simulated",
            "error_type": "timeout",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=ReasoningPlanGraph(name="policy_rollback_conflict", metadata={"owner": "cortex", "session_key": "session:policy-rollback-conflict", "archetype": "coding"}, nodes=[{"node_id": "x", "title": "X", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "x"}}]))))
    process_id = scheduled["process"]["process_id"]
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    rev1 = asyncio.run(orchestrator.apply_runtime_policy_patch(process_id, orchestrator.RuntimePolicyApplyRequest(settings=["step_timeout_seconds"], metadata_overrides={"step_timeout_seconds": 45})))
    rev2 = asyncio.run(orchestrator.apply_runtime_policy_patch(process_id, orchestrator.RuntimePolicyApplyRequest(settings=["step_timeout_seconds"], metadata_overrides={"step_timeout_seconds": 60})))

    blocked = asyncio.run(orchestrator.rollback_runtime_policy_patch(process_id, rev1["revision_id"], orchestrator.RuntimePolicyRollbackRequest()))
    allowed = asyncio.run(orchestrator.rollback_runtime_policy_patch(process_id, rev1["revision_id"], orchestrator.RuntimePolicyRollbackRequest(allow_intervening_revisions=True)))

    assert blocked["rolled_back"] is False
    assert blocked["blocked_reason"] == "intervening_revisions_conflict"
    assert blocked["intervening_revisions"][0]["revision_id"] == rev2["revision_id"]
    assert blocked["intervening_revisions"][0]["settings"] == ["step_timeout_seconds"]
    assert allowed["rolled_back"] is True
    assert allowed["allow_intervening_revisions"] is True
    assert "step_timeout_seconds" not in allowed["process"]["workflow"]["metadata"]


def test_incident_trends_route_supports_hour_filter(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    trends = asyncio.run(orchestrator.get_runtime_incident_trends(hours=1))

    assert trends["success"] is True
    assert trends["hours"] == 1
    assert trends["trends"]["process_count"] >= 1



def test_runtime_analytics_summary_route_returns_time_windowed_snapshot(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "timeout:simulated",
            "error_type": "timeout",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)

    asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=_graph())))
    asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=ReasoningPlanGraph(name="analytics_timeout", metadata={"owner": "cortex", "session_key": "session:analytics-timeout", "archetype": "coding"}, nodes=[{"node_id": "x", "title": "X", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "x"}}]))))
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))

    summary = asyncio.run(orchestrator.get_runtime_analytics_summary(hours=24, bucket_hours=12.0))
    report = asyncio.run(orchestrator.get_runtime_analytics_report(hours=24, bucket_hours=12.0, title="Daily runtime snapshot"))
    markdown = asyncio.run(orchestrator.get_runtime_analytics_report_markdown(hours=24, bucket_hours=12.0, title="Daily runtime snapshot"))

    assert summary["success"] is True
    assert summary["hours"] == 24
    assert summary["bucket_hours"] == 12.0
    assert summary["analytics"]["process_count"] >= 2
    assert summary["analytics"]["buckets"]
    assert "success_rate" in summary["analytics"]
    assert "timeout_process_count" in summary["analytics"]
    assert summary["analytics"]["root_category_dashboard"]
    assert summary["analytics"]["trend_summary"]["bucket_count"] >= 1
    assert "success_rate_direction" in summary["analytics"]["trend_summary"]
    assert summary["analytics"]["trend_summary"]["operator_summary"]
    assert summary["analytics"]["operator_summary"]
    assert report["success"] is True
    assert report["report"]["title"] == "Daily runtime snapshot"
    assert report["report"]["report_id"].startswith("analytics_")
    assert report["report"]["analytics"]["trend_summary"]["bucket_count"] >= 1
    assert report["report"]["highlights"]
    assert report["report"]["operator_summary"]



def test_runtime_analytics_compare_route_returns_current_vs_previous_window(monkeypatch):
    now = datetime.now(timezone.utc)

    monkeypatch.setattr(
        orchestrator,
        "list_runtime_processes",
        lambda: [
            {
                "process_id": "proc_current_success",
                "created_at": (now - timedelta(hours=2)).isoformat(),
                "status": "completed",
                "nodes": {},
            },
            {
                "process_id": "proc_current_timeout",
                "created_at": (now - timedelta(hours=1)).isoformat(),
                "status": "failed",
                "nodes": {
                    "step1": {
                        "status": "failed",
                        "last_error_code": "timeout",
                        "attempts": 2,
                        "max_attempts": 2,
                    }
                },
            },
            {
                "process_id": "proc_previous_success",
                "created_at": (now - timedelta(hours=26)).isoformat(),
                "status": "completed",
                "nodes": {},
            },
        ],
    )

    comparison = asyncio.run(orchestrator.get_runtime_analytics_compare(hours=24.0, bucket_hours=6.0))

    assert comparison["success"] is True
    assert comparison["comparison"]["current"]["process_count"] == 2
    assert comparison["comparison"]["previous"]["process_count"] == 1
    assert "success_rate_delta" in comparison["comparison"]["deltas"]
    assert comparison["comparison"]["directions"]["timeout_direction"] in {"improving", "worsening", "flat"}
    assert comparison["comparison"]["operator_summary"]



def test_runtime_analytics_correlation_route_returns_correlatable_ids(monkeypatch):
    now = datetime.now(timezone.utc)
    process_row = {
        "process_id": "proc_corr",
        "task_id": "task_corr",
        "created_at": now.isoformat(),
        "status": "failed",
        "workflow": {"metadata": {"workflow_id": "wf_corr"}},
        "nodes": {
            "step1": {
                "result": {"produced_belief_ids": ["claim_1", "claim_2"]}
            }
        },
    }

    monkeypatch.setattr(orchestrator, "list_runtime_processes", lambda: [process_row])
    monkeypatch.setattr(
        orchestrator,
        "get_runtime_events",
        lambda process_id, limit=200: [
            {"event_id": "evt_1", "kind": "policy_patch_applied", "payload": {"revision_id": "polrev_1", "recommendation_version": "polrec_1"}},
            {"event_id": "evt_2", "kind": "node_failed", "payload": {}},
        ],
    )
    monkeypatch.setattr(orchestrator, "get_runtime_process", lambda process_id: process_row if process_id == "proc_corr" else None)

    correlation = asyncio.run(orchestrator.get_runtime_analytics_correlation(hours=24))
    trace = asyncio.run(orchestrator.get_runtime_process_trace("proc_corr"))

    assert correlation["success"] is True
    assert correlation["correlation"]["process_count"] == 1
    assert correlation["correlation"]["top_revision_ids"][0]["revision_id"] == "polrev_1"
    assert correlation["correlation"]["top_recommendation_versions"][0]["recommendation_version"] == "polrec_1"
    assert correlation["correlation"]["top_belief_ids"][0]["claim_id"] in {"claim_1", "claim_2"}
    assert correlation["correlation"]["processes"][0]["task_id"] == "task_corr"
    assert correlation["correlation"]["operator_summary"]
    assert trace["success"] is True
    assert trace["trace"]["process_id"] == "proc_corr"
    assert trace["trace"]["event_ids"] == ["evt_1", "evt_2"]
    assert trace["trace"]["revision_ids"] == ["polrev_1"]
    assert trace["trace"]["recommendation_versions"] == ["polrec_1"]
    assert trace["trace"]["produced_belief_ids"] == ["claim_1", "claim_2"]
    assert trace["trace"]["operator_summary"]



def test_timeout_failure_persists_structured_error_code(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "timeout:simulated",
            "error_type": "timeout",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)
    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=ReasoningPlanGraph(name="timeout_code", metadata={"owner": "cortex", "session_key": "session:timeout-code", "archetype": "coding"}, nodes=[{"node_id": "x", "title": "X", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "x"}}]))))
    tick = asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    process_view = asyncio.run(orchestrator.get_runtime_process_view(scheduled["process"]["process_id"]))

    assert tick["executed"][0]["result"]["error_code"] == "timeout"
    assert process_view["process"]["results_by_node"]["x"]["error_code"] == "timeout"


def test_incident_report_prefers_structured_error_code(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", db_path)
    orchestrator.workflows.clear()

    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        return {
            "step": step_index,
            "node_id": step.get("node_id"),
            "title": step.get("title"),
            "endpoint": step.get("endpoint"),
            "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": None,
            "response": None,
            "elapsed_ms": 1.0,
            "success": False,
            "error": "something weird",
            "error_code": "approval_required",
        }

    monkeypatch.setattr(orchestrator, "_execute_single_step", fake_execute_single_step)
    scheduled = asyncio.run(orchestrator.schedule_plan_runtime(orchestrator.RuntimePlanRequest(graph=ReasoningPlanGraph(name="structured_incident", metadata={"owner": "cortex", "session_key": "session:structured-incident", "archetype": "coding"}, nodes=[{"node_id": "x", "title": "X", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "x"}}]))))
    asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    explained = asyncio.run(orchestrator.explain_runtime_process(scheduled["process"]["process_id"]))

    assert explained["incident_report"]["root_cause"]["category"] == "approval_blocked"
    assert explained["incident_report"]["root_cause"]["error_code"] == "approval_required"
