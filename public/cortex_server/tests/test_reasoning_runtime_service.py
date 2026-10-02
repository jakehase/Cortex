import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from cortex_server.modules import reasoning_runtime_service as runtime_service



def test_runtime_process_action_and_belief_helpers_wrap_success_and_404s():
    ok = runtime_service.runtime_process_action(
        "proc_1",
        action_fn=lambda process_id, **kwargs: {"process_id": process_id, **kwargs},
        error_cls=RuntimeError,
        reason="because",
    )
    assert ok == {"success": True, "process": {"process_id": "proc_1", "reason": "because"}}

    with pytest.raises(HTTPException) as exc:
        runtime_service.runtime_process_action(
            "proc_2",
            action_fn=lambda process_id, **kwargs: (_ for _ in ()).throw(RuntimeError("missing")),
            error_cls=RuntimeError,
        )
    assert exc.value.status_code == 404

    conflicts = runtime_service.runtime_belief_conflicts(
        subject="repo",
        predicate="status",
        limit=5,
        belief_conflicts_fn=lambda **kwargs: [{"subject": kwargs["subject"], "predicate": kwargs["predicate"]}],
    )
    assert conflicts["count"] == 1

    detail = runtime_service.runtime_belief_detail("claim_1", explain_belief_fn=lambda claim_id: {"claim_id": claim_id})
    lineage = runtime_service.runtime_belief_lineage("claim_1", trace_belief_lineage_fn=lambda claim_id: {"claim_id": claim_id, "edges": []})
    assert detail["claim_id"] == "claim_1"
    assert lineage["claim_id"] == "claim_1"



def test_maybe_sentinel_gate_and_build_workflow_request_record():
    blocked = asyncio.run(
        runtime_service.maybe_sentinel_gate(
            metadata={"requires_preflight": True},
            workflow_id="wf_1",
            sentinel_preflight_fn=lambda: _async_result({
                "success": True,
                "scan": {
                    "issues_found": 2,
                    "watchers_checked": 2,
                    "results": [
                        {"ok": False, "status_code": 503},
                        {"ok": False, "status_code": 503},
                    ],
                },
            }),
        )
    )
    assert blocked["error"] == "sentinel_gate_failed"
    assert blocked["workflow_id"] == "wf_1"

    allowed = asyncio.run(
        runtime_service.maybe_sentinel_gate(
            metadata={"requires_preflight": True},
            workflow_id="wf_2",
            sentinel_preflight_fn=lambda: _async_result({
                "success": True,
                "scan": {
                    "issues_found": 0,
                    "watchers_checked": 1,
                    "results": [{"ok": True, "status_code": 200}],
                },
            }),
        )
    )
    assert allowed is None

    record = runtime_service.build_workflow_request_record(
        name="demo",
        steps=[SimpleNamespace(node_id="a"), SimpleNamespace(node_id="b")],
        metadata={"x": 1},
        model_dump_compat_fn=lambda step: {"node_id": step.node_id},
        build_workflow_record_fn=lambda **kwargs: kwargs,
    )
    assert [row["node_id"] for row in record["steps"]] == ["a", "b"]
    assert record["metadata"] == {"x": 1}



def test_execute_and_persist_workflow_and_finalize_async_paths():
    workflow = {"workflow_id": "wf_1", "name": "demo"}
    applied = []
    persisted = []

    async def execute_workflow_fn(row):
        return {"execution_id": "exec_1", "status": "success", "completed_at": "t1"}

    execution = asyncio.run(
        runtime_service.execute_and_persist_workflow(
            workflow,
            execute_workflow_fn=execute_workflow_fn,
            apply_execution_result_fn=lambda wf, ex, **kwargs: applied.append((wf, ex, kwargs)) or wf,
            persist_workflow_fn=lambda wf: persisted.append(dict(wf)) or wf,
            max_executions=3,
        )
    )
    assert execution["execution_id"] == "exec_1"
    assert applied[0][2]["max_executions"] == 3
    assert persisted[0]["workflow_id"] == "wf_1"

    blocked_applied = []
    blocked_persisted = []
    asyncio.run(
        runtime_service.finalize_async_workflow(
            {"workflow_id": "wf_blocked", "name": "blocked"},
            metadata={"requires_preflight": True},
            sentinel_preflight_fn=lambda: _async_result({
                "success": True,
                "scan": {
                    "issues_found": 1,
                    "watchers_checked": 1,
                    "results": [{"ok": False, "status_code": 503}],
                },
            }),
            execute_workflow_fn=execute_workflow_fn,
            apply_execution_result_fn=lambda wf, ex, **kwargs: blocked_applied.append(ex) or wf,
            build_blocked_execution_fn=lambda **kwargs: {"status": "blocked", "sentinel": kwargs["scan"]},
            build_error_execution_fn=lambda exc: {"status": "error", "error": str(exc)},
            persist_workflow_fn=lambda wf: blocked_persisted.append(dict(wf)) or wf,
            max_executions=2,
        )
    )
    assert blocked_applied[0]["status"] == "blocked"
    assert blocked_persisted

    error_applied = []
    error_persisted = []

    async def failing_execute(_workflow):
        raise ValueError("boom")

    asyncio.run(
        runtime_service.finalize_async_workflow(
            {"workflow_id": "wf_error", "name": "error"},
            metadata=None,
            sentinel_preflight_fn=lambda: _async_result({"success": True}),
            execute_workflow_fn=failing_execute,
            apply_execution_result_fn=lambda wf, ex, **kwargs: error_applied.append(ex) or wf,
            build_blocked_execution_fn=lambda **kwargs: {"status": "blocked"},
            build_error_execution_fn=lambda exc: {"status": "error", "error": str(exc)},
            persist_workflow_fn=lambda wf: error_persisted.append(dict(wf)) or wf,
            max_executions=2,
        )
    )
    assert error_applied[0]["status"] == "error"
    assert error_applied[0]["error"] == "boom"
    assert error_persisted



def test_workflow_lookup_and_rerun_helpers_cover_success_and_404():
    view = runtime_service.workflow_view_or_404(
        "wf_1",
        executions_limit=2,
        load_workflow_fn=lambda workflow_id: {"workflow_id": workflow_id, "name": "demo", "executions": [{"execution_id": "e1"}]},
        workflow_view_fn=lambda workflow, executions_limit: {"workflow_id": workflow["workflow_id"], "limit": executions_limit},
    )
    assert view["workflow"]["limit"] == 2

    lookup = runtime_service.execution_lookup_or_404(
        "exec_1",
        list_workflows_fn=lambda: [{"workflow_id": "wf_1", "executions": [{"execution_id": "exec_1", "status": "ok"}]}],
        find_execution_fn=lambda workflows, execution_id: ("wf_1", {"execution_id": execution_id, "status": "ok"}),
    )
    assert lookup["workflow_id"] == "wf_1"
    assert lookup["execution"]["execution_id"] == "exec_1"

    rerun = asyncio.run(
        runtime_service.rerun_workflow_or_404(
            "wf_1",
            load_workflow_fn=lambda workflow_id: {"workflow_id": workflow_id, "name": "demo"},
            execute_workflow_fn=lambda workflow: _async_result({"execution_id": "exec_2", "status": "success", "completed_at": "t2"}),
            apply_execution_result_fn=lambda workflow, execution, **kwargs: workflow.update({"last_execution": execution}) or workflow,
            persist_workflow_fn=lambda workflow: workflow,
            max_executions=4,
        )
    )
    assert rerun["execution"]["execution_id"] == "exec_2"
    assert rerun["name"] == "demo"

    with pytest.raises(HTTPException):
        runtime_service.workflow_view_or_404(
            "missing",
            executions_limit=1,
            load_workflow_fn=lambda workflow_id: None,
            workflow_view_fn=lambda workflow, executions_limit: workflow,
        )

    with pytest.raises(HTTPException):
        runtime_service.execution_lookup_or_404(
            "missing",
            list_workflows_fn=lambda: [],
            find_execution_fn=lambda workflows, execution_id: None,
        )

    with pytest.raises(HTTPException):
        asyncio.run(
            runtime_service.rerun_workflow_or_404(
                "missing",
                load_workflow_fn=lambda workflow_id: None,
                execute_workflow_fn=lambda workflow: _async_result({}),
                apply_execution_result_fn=lambda workflow, execution, **kwargs: workflow,
                persist_workflow_fn=lambda workflow: workflow,
                max_executions=1,
            )
        )


async def _async_result(value):
    return value
