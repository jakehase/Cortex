import asyncio
from types import SimpleNamespace

from cortex_server.modules import reasoning_runtime_workflows as runtime_workflows



def test_persist_load_and_list_workflows_refresh_cache_from_store(tmp_path):
    cache = {}
    stored = {}

    def upsert_doc(collection, doc_id, row):
        stored[(collection, doc_id)] = dict(row)

    workflow = {"workflow_id": "wf_1", "name": "demo", "steps": [], "executions": []}
    persisted = runtime_workflows.persist_workflow(
        workflow,
        workflows_cache=cache,
        db_path=tmp_path / "db.sqlite",
        store_upsert_doc_fn=upsert_doc,
    )

    assert persisted["workflow_id"] == "wf_1"
    assert cache["wf_1"]["name"] == "demo"
    assert stored[("workflows", "wf_1")]["name"] == "demo"

    loaded = runtime_workflows.load_workflow(
        "wf_1",
        workflows_cache=cache,
        db_path=tmp_path / "db.sqlite",
        store_get_doc_fn=lambda collection, doc_id: stored[(collection, doc_id)],
    )
    assert loaded == workflow
    assert loaded is not cache["wf_1"]

    rows = runtime_workflows.list_workflows(
        workflows_cache=cache,
        db_path=tmp_path / "db.sqlite",
        store_list_docs_fn=lambda collection: [
            {"workflow_id": "wf_store", "name": "from-store", "steps": [1], "executions": [2]}
        ],
    )
    assert rows[0]["workflow_id"] == "wf_store"
    assert "wf_1" not in cache
    assert cache["wf_store"]["name"] == "from-store"



def test_build_workflow_from_plan_injects_policy_and_kernel_task_metadata():
    graph = SimpleNamespace(
        name="plan_name",
        goal="ship it",
        description="demo",
        metadata={"owner": "jake", "session_key": "session:test", "archetype": "coding"},
    )

    workflow = runtime_workflows.build_workflow_from_plan(
        graph,
        compile_plan_to_workflow_fn=lambda g: {
            "name": g.name,
            "steps": [{"node_id": "step1"}],
            "metadata": {"plan_graph": {"node_count": 1}},
        },
        compile_plan_to_reasoning_task_fn=lambda g, **kwargs: {
            "task_id": kwargs["task_id"],
            "metadata": {},
        },
        model_dump_compat_fn=lambda value: dict(value),
        build_workflow_policy_fn=lambda **kwargs: {
            "decisions": [{"domain": "routing", "chosen": "sequential"}],
            "belief_influence_ids": ["belief-1"],
            "settings": {"execution_mode": "sequential"},
        },
    )

    assert workflow["workflow_id"].startswith("wf_")
    assert workflow["metadata"]["task_id"] == workflow["kernel_task"]["task_id"]
    assert workflow["metadata"]["policy"]["settings"]["execution_mode"] == "sequential"
    assert workflow["kernel_task"]["metadata"]["policy"]["settings"]["execution_mode"] == "sequential"
    assert workflow["kernel_task"]["policy_decisions"][0]["domain"] == "routing"
    assert workflow["kernel_task"]["belief_influence_ids"] == ["belief-1"]
    assert workflow["plan_graph"]["node_count"] == 1



def test_refresh_workflow_policy_updates_metadata_and_kernel_task_policy_bundle():
    workflow = {
        "workflow_id": "wf_1",
        "name": "demo",
        "steps": [{"node_id": "step1"}],
        "metadata": {"goal": "ship", "description": "demo", "step_timeout_seconds": 30},
        "kernel_task": {"task_id": "task_1", "metadata": {}},
    }

    refreshed = runtime_workflows.refresh_workflow_policy(
        workflow,
        build_workflow_policy_fn=lambda **kwargs: {
            "decisions": [{"domain": "scheduler", "chosen": "managed_runtime"}],
            "belief_influence_ids": ["belief-2"],
            "settings": {"step_timeout_seconds": kwargs["metadata"].get("step_timeout_seconds")},
        },
    )

    assert refreshed["metadata"]["policy"]["settings"]["step_timeout_seconds"] == 30
    assert refreshed["kernel_task"]["metadata"]["policy"]["settings"]["step_timeout_seconds"] == 30
    assert refreshed["kernel_task"]["policy_decisions"][0]["domain"] == "scheduler"
    assert refreshed["kernel_task"]["belief_influence_ids"] == ["belief-2"]



def test_apply_execution_result_and_record_runtime_beliefs_cover_status_http_and_error():
    workflow = {
        "workflow_id": "wf_demo",
        "name": "demo",
        "steps": [],
        "executions": [
            {"execution_id": "exec_old", "status": "old", "completed_at": "t0"},
        ],
    }
    runtime_workflows.apply_execution_result(
        workflow,
        {"execution_id": "exec_new", "status": "success", "completed_at": "t1"},
        max_executions=1,
    )

    assert [row["execution_id"] for row in workflow["executions"]] == ["exec_new"]
    assert workflow["last_status"] == "success"
    assert workflow["last_run"] == "t1"

    calls = []

    def upsert_belief(**kwargs):
        calls.append(kwargs)
        return {"claim_id": f"claim-{len(calls)}"}

    produced = runtime_workflows.record_runtime_beliefs(
        process_id="proc_1",
        task_id="task_1",
        node_id="node_1",
        step_result={"success": False, "status_code": 503, "error": "boom"},
        upsert_belief_fn=upsert_belief,
    )

    assert [row["claim_id"] for row in produced] == ["claim-1", "claim-2", "claim-3"]
    assert calls[0]["predicate"] == "status"
    assert calls[0]["value"] == "failed"
    assert calls[1]["predicate"] == "http_status"
    assert calls[1]["value"] == 503
    assert calls[2]["predicate"] == "error"
    assert calls[2]["conflict_mode"] == "contradict"



def test_execute_runtime_batch_executes_one_ready_node_and_backfills_belief_context():
    process = {
        "task_id": "task_demo",
        "workflow": {
            "metadata": {"policy": {"settings": {"same_tick_drain": False, "enforce_policy": True}}},
            "steps": [{"node_id": "step1", "title": "Step 1", "endpoint": "/oracle/chat"}],
        },
        "results_by_node": {},
    }
    mark_calls = []
    record_calls = []
    tick_calls = []

    def scheduler_tick(now_iso=None, limit=0):
        tick_calls.append((now_iso, limit))
        if len(tick_calls) <= 2:
            return {"runnable": [{"process_id": "proc_1", "node_id": "step1"}]}
        return {"runnable": [], "tick_id": len(tick_calls)}

    async def execute_step_with_retry(client, step, *, step_index, results_by_node, workflow_metadata=None, deadline_at=None):
        assert step_index == 1
        assert results_by_node == {}
        assert workflow_metadata["policy"]["settings"]["same_tick_drain"] is False
        return {
            "node_id": step["node_id"],
            "success": True,
            "status_code": 200,
            "response": {"ok": True},
        }

    def step_belief_context(step, workflow_metadata=None):
        return {"task_id": "task_demo", "selected_ids": ["belief-1"], "filters": {"query": "x"}}

    def record_runtime_beliefs(**kwargs):
        return [{"claim_id": "claim-1"}]

    result = asyncio.run(
        runtime_workflows.execute_runtime_batch(
            limit=5,
            now_iso="2026-03-28T09:00:00Z",
            scheduler_tick_fn=scheduler_tick,
            get_runtime_process_fn=lambda process_id: dict(process),
            mark_node_running_fn=lambda process_id, node_id: mark_calls.append((process_id, node_id)),
            execute_step_with_retry_fn=execute_step_with_retry,
            step_index_for_node_fn=lambda workflow, node_id: 1,
            step_belief_context_fn=step_belief_context,
            record_runtime_beliefs_fn=record_runtime_beliefs,
            record_node_result_fn=lambda process_id, node_id, step_result: record_calls.append((process_id, node_id, dict(step_result))) or process,
            workflow_policy_settings_fn=lambda metadata: metadata.get("policy", {}).get("settings", {}),
            scheduler_error_cls=RuntimeError,
        )
    )

    assert result["executed_count"] == 1
    assert mark_calls == [("proc_1", "step1")]
    assert record_calls[0][0:2] == ("proc_1", "step1")
    assert record_calls[0][2]["belief_context"]["selected_ids"] == ["belief-1"]
    assert record_calls[0][2]["produced_belief_ids"] == ["claim-1"]
    assert result["executed"][0]["result"]["produced_belief_count"] == 1
