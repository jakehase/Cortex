"""L26 Orchestrator repair: in-process step authority, truthful results, planner, adapter."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import cortex_server.modules.reasoning_beliefs as beliefs
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.modules import orchestrator_auth, orchestrator_planner
from cortex_server.modules import reasoning_runtime_execution as runtime_execution
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import orchestrator as orchestrator_adapter
from cortex_server.modules.memory_scope import memory_scope_signature
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph
from cortex_server.modules.reasoning_safety import evaluate_step_permission

SEAL_SECRET = "orchestrator-seal-secret-0000000000000000001"
SCOPE = {
    "tenant_id": "tenant-a",
    "workspace_id": "workspace-a",
    "agent_id": "agent-a",
    "user_id": "alice",
    "channel_id": "api",
    "session_id": "alice-session",
}


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "beliefs.db")
    orchestrator.workflows.clear()


def _principal_request():
    principal = SimpleNamespace(role="principal", credential_id="alice-cred", storage_workspace_id="ws-storage", **SCOPE)
    return SimpleNamespace(state=SimpleNamespace(cortex_principal=principal))


def _admin_request():
    return SimpleNamespace(state=SimpleNamespace(cortex_principal=SimpleNamespace(role="admin", credential_id="cortex-admin")))


# ── credential headers are never accepted or persisted ─────────────────────


def test_credential_headers_detected_including_compensation():
    steps = [
        {"node_id": "a", "headers": {"X-Cortex-Admin-Token": "SECRET"}},
        {"node_id": "b", "headers": {"Accept": "application/json"},
         "metadata": {"compensation": {"endpoint": "/x", "headers": {"Authorization": "Bearer t"}}}},
    ]
    found = orchestrator_auth.find_credential_headers(steps)
    assert found == ["a:x-cortex-admin-token", "b:compensate:1:authorization"]
    assert orchestrator_auth.strip_credential_headers({"Accept": "a", "x-cortex-write-token": "w"}) == {"Accept": "a"}


def test_workflow_with_credential_headers_is_rejected_before_storage():
    request = orchestrator.CreateWorkflowRequest(
        name="leaky",
        steps=[{"endpoint": "/oracle/status", "method": "GET", "headers": {"x-cortex-admin-token": "SECRET"}}],
    )
    with pytest.raises(HTTPException) as caught:
        asyncio.run(orchestrator.create_and_run_workflow(request))
    assert caught.value.status_code == 400
    assert dict(orchestrator.workflows) == {}


# ── sealed creator authority ───────────────────────────────────────────────


def test_bound_authority_is_sealed_and_forgery_is_stripped(monkeypatch):
    monkeypatch.setenv("CORTEX_ACTION_DELEGATION_SECRET", SEAL_SECRET)
    forged = {"_execution_authority": {"kind": "admin", "seal": "0" * 64}, "owner": "mallory"}
    metadata = orchestrator_auth.bind_execution_authority(forged, _principal_request())
    authority = orchestrator_auth.verified_authority(metadata)
    assert authority["kind"] == "principal"
    assert authority["scope"]["user_id"] == "alice"

    tampered = json.loads(json.dumps(metadata))
    tampered["_execution_authority"]["scope"]["user_id"] = "bob"
    assert orchestrator_auth.verified_authority(tampered) is None
    assert orchestrator_auth.execution_headers(tampered) == ({}, "unbound")

    # A caller with no authenticated principal cannot smuggle authority in.
    assert "_execution_authority" not in orchestrator_auth.bind_execution_authority(forged, None)


def test_principal_credentials_are_derived_at_send_time(monkeypatch):
    monkeypatch.setenv("CORTEX_ACTION_DELEGATION_SECRET", SEAL_SECRET)
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "write-token-value")
    monkeypatch.setenv(
        "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        json.dumps({"alice-cred": {"secret": "alice-secret", "allowed_scopes": [SCOPE]}}),
    )
    metadata = orchestrator_auth.bind_execution_authority({}, _principal_request())
    headers, label = orchestrator_auth.execution_headers(metadata)

    assert label == "principal"
    assert headers["x-cortex-write-token"] == "write-token-value"
    assert headers["x-cortex-scope-signature"] == memory_scope_signature(
        **SCOPE, credential_id="alice-cred", secret="alice-secret"
    )
    stored = json.dumps(metadata)
    assert "alice-secret" not in stored and "write-token-value" not in stored


def test_admin_authority_and_missing_secret(monkeypatch):
    monkeypatch.setenv("CORTEX_ADMIN_TOKEN", "admin-token-value")
    monkeypatch.delenv("CORTEX_ACTION_DELEGATION_SECRET", raising=False)
    unsealed = orchestrator_auth.bind_execution_authority({}, _admin_request())
    assert unsealed["_execution_authority"]["seal"] == ""
    assert orchestrator_auth.execution_headers(unsealed) == ({}, "unbound")

    monkeypatch.setenv("CORTEX_ACTION_DELEGATION_SECRET", SEAL_SECRET)
    sealed = orchestrator_auth.bind_execution_authority({}, _admin_request())
    headers, label = orchestrator_auth.execution_headers(sealed)
    assert label == "admin"
    assert headers["x-cortex-admin-token"] == "admin-token-value"
    assert "admin-token-value" not in json.dumps(sealed)


def test_step_send_strips_stored_credentials_and_injects_fresh_ones():
    sent = {}

    class Response:
        status_code = 200
        text = ""

        @staticmethod
        def json():
            return {"status": "online"}

    class CapturingClient:
        async def get(self, url, params=None, headers=None, timeout=None):
            sent.update(url=url, headers=dict(headers or {}))
            return Response()

        async def post(self, *args, **kwargs):
            raise AssertionError("unexpected POST")

    legacy_step = {
        "node_id": "status",
        "endpoint": "/oracle/status",
        "method": "GET",
        "payload": {},
        "headers": {"x-cortex-admin-token": "LEAKED-STORED-TOKEN", "Accept": "application/json"},
    }
    result = asyncio.run(
        runtime_execution.execute_single_step(
            CapturingClient(),
            legacy_step,
            step_index=1,
            results_by_node={},
            workflow_metadata={},
            base_url="http://cortex.invalid",
            max_step_response_chars=1000,
            step_timeout_max_s=5.0,
            redact_headers_fn=lambda headers: {k: "[REDACTED]" for k in headers},
            validate_endpoint_fn=lambda endpoint: None,
            payload_size_ok_fn=lambda payload: True,
            step_belief_context_fn=lambda step, metadata: {},
            execution_headers_fn=lambda metadata: ({"x-cortex-admin-token": "FRESH"}, "admin"),
        )
    )
    assert result["success"] is True
    assert result["execution_authority"] == "admin"
    assert sent["headers"] == {"Accept": "application/json", "x-cortex-admin-token": "FRESH"}
    assert "FRESH" not in json.dumps(result)


# ── safety allowlist ───────────────────────────────────────────────────────


def test_nonexistent_users_get_and_recursive_steps_are_not_allowed():
    users = evaluate_step_permission({"endpoint": "/users/get", "method": "POST"})
    assert users["allow"] is False and users["reason"] == "unknown_action"
    recursive = evaluate_step_permission({"endpoint": "/orchestrator/runtime/tick", "method": "POST"})
    assert recursive["allow"] is False and recursive["reason"] == "recursive_orchestrator_action"
    assert evaluate_step_permission({"endpoint": "/conductor/workflow", "method": "POST"})["allow"] is False


# ── truthful top-level results ─────────────────────────────────────────────


def _graph():
    return ReasoningPlanGraph(
        name="truth",
        metadata={"owner": "cortex", "session_key": "session:truth", "archetype": "coding"},
        nodes=[
            {"node_id": "one", "title": "One", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "x"}},
            {"node_id": "two", "title": "Two", "endpoint": "/oracle/chat", "method": "POST", "payload": {"prompt": "y"},
             "depends_on": ["one"], "failure_mode": "continue"},
        ],
    )


def _fake_step(success_by_node):
    async def fake_execute_single_step(client, step, *, step_index, results_by_node, workflow_metadata=None):
        ok = success_by_node[step["node_id"]]
        return {
            "step": step_index, "node_id": step["node_id"], "title": step.get("title"),
            "endpoint": step.get("endpoint"), "method": step.get("method"),
            "request": {"payload": step.get("payload"), "headers": {}, "timeout_s": 1},
            "status_code": 200 if ok else 403, "response": {}, "elapsed_ms": 1.0, "success": ok,
            **({} if ok else {"error": "http_403"}),
        }

    return fake_execute_single_step


def test_failed_steps_make_top_level_success_false(monkeypatch):
    monkeypatch.setattr(orchestrator, "_execute_single_step", _fake_step({"one": False, "two": False}))
    result = asyncio.run(orchestrator.create_and_run_plan(_graph()))
    assert result["execution"]["status"] == "partial_failure"
    assert result["success"] is False
    assert result["status"] == "failed"


def test_all_steps_succeeding_reports_success(monkeypatch):
    monkeypatch.setattr(orchestrator, "_execute_single_step", _fake_step({"one": True, "two": True}))
    result = asyncio.run(orchestrator.create_and_run_plan(_graph()))
    assert result["success"] is True
    assert result["status"] == "succeeded"

    rerun = asyncio.run(orchestrator.rerun_workflow(result["workflow_id"]))
    assert rerun["success"] is True


def test_status_is_derived_and_not_always_on(monkeypatch):
    monkeypatch.setattr(orchestrator, "_execute_single_step", _fake_step({"one": True, "two": False}))
    asyncio.run(orchestrator.create_and_run_plan(_graph()))
    status = asyncio.run(orchestrator.conductor_status())["data"]
    assert status["always_on"] is False
    assert status["workflows_stored"] == 1
    assert status["executions_recorded"] == 1
    assert status["executions_succeeded"] == 0
    assert "manual" in status["runtime_driver"]["advanced_by"] or status["runtime_driver"]["driver_registered"]


# ── planner (proposal only) ────────────────────────────────────────────────


def _proposal(**overrides):
    data = {
        "name": "biscuit vet plan",
        "goal_restatement": "find vet notes and summarise",
        "steps": [
            {"node_id": "recall", "title": "Recall vet notes", "action": "memory_search",
             "inputs": {"query": "Biscuit vet"}, "depends_on": []},
            {"node_id": "summary", "title": "Summarise", "action": "oracle_answer",
             "inputs": {"prompt": "Summarise: {{recall.response}}"}, "depends_on": ["recall"]},
        ],
        "out_of_scope": ["booking the appointment"],
    }
    data.update(overrides)
    return data


def test_planner_maps_safe_step_types_and_executes_nothing():
    async def model_ok(**kwargs):
        assert kwargs["schema"] is orchestrator_planner.PlanProposal
        return {"status": "ok", "data": _proposal(), "model": "gpt-5.6-sol", "receipt_id": "rcpt-plan"}

    result = asyncio.run(
        orchestrator_planner.propose_plan("Find Biscuit's vet notes and book a visit", principal_scope_key="principal:x", model_fn=model_ok)
    )
    assert result["success"] is True
    assert result["status"] == "proposed"
    assert result["executed"] is False
    assert result["requires_confirmation"] is True
    assert result["receipt_id"] == "rcpt-plan"
    nodes = result["plan_graph"]["nodes"]
    assert [n["endpoint"] for n in nodes] == ["/librarian/search", "/oracle/chat"]
    assert all(not n.get("headers") for n in nodes)
    assert result["validation"]["execution_order"] == ["recall", "summary"]
    assert result["out_of_scope"] == ["booking the appointment"]
    ReasoningPlanGraph(**result["plan_graph"])  # valid input for /plan/execute


def test_planner_rejects_malformed_graphs():
    with pytest.raises(orchestrator_planner.PlanBuildError):
        orchestrator_planner.build_graph_payload(
            _proposal(steps=[{"node_id": "a", "title": "A", "action": "oracle_answer",
                              "inputs": {"prompt": "{{b.response}}"}, "depends_on": []}]),
            goal="g",
        )
    with pytest.raises(orchestrator_planner.PlanBuildError):
        orchestrator_planner.build_graph_payload(
            _proposal(steps=[{"node_id": "a", "title": "A", "action": "memory_search",
                              "inputs": {"query": "x", "endpoint": "/bridge/relay"}, "depends_on": []}]),
            goal="g",
        )
    with pytest.raises(orchestrator_planner.PlanBuildError):
        orchestrator_planner.build_graph_payload(
            _proposal(steps=[{"node_id": "a", "title": "A", "action": "shell_exec", "inputs": {}, "depends_on": []}]),
            goal="g",
        )


def test_planner_model_unavailable_returns_no_plan():
    async def model_down(**_kwargs):
        return {"status": "busy"}

    result = asyncio.run(orchestrator_planner.propose_plan("goal", principal_scope_key="principal:x", model_fn=model_down))
    assert result["success"] is False
    assert result["origin"] == "model_unavailable"
    assert "plan_graph" not in result
    assert result["executed"] is False


# ── adapter contract ───────────────────────────────────────────────────────


def test_orchestrator_adapter_contract_and_plan_only(monkeypatch):
    assert orchestrator_adapter.LEVEL == 26 and orchestrator_adapter.NAME == "orchestrator"
    assert orchestrator_adapter.SAFE_AUTORUN is True and orchestrator_adapter.NEEDS_MODEL is True
    with pytest.raises(ExecutionBlocked):
        asyncio.run(orchestrator_adapter.run("goal", {}))

    async def model_ok(**_kwargs):
        return {"status": "ok", "data": _proposal(), "model": "m", "receipt_id": "r"}

    async def must_not_execute(*_args, **_kwargs):
        raise AssertionError("the adapter must never execute a workflow")

    monkeypatch.setattr("cortex_server.modules.level_model.level_model_json", model_ok)
    monkeypatch.setattr(orchestrator, "_execute_workflow", must_not_execute)
    out = asyncio.run(orchestrator_adapter.run("Find Biscuit's vet notes", {"principal_scope_key": "principal:x"}))
    assert out["operation"] == "orchestrator.plan"
    assert out["origin"] == "model"
    assert out["data"]["executed"] is False
    assert "PROPOSED workflow (not executed)" in out["summary"]
    json.dumps(out)


def test_orchestrator_adapter_model_unavailable(monkeypatch):
    async def model_down(**_kwargs):
        return {"status": "model_unavailable"}

    monkeypatch.setattr("cortex_server.modules.level_model.level_model_json", model_down)
    with pytest.raises(ExecutionBlocked):
        asyncio.run(orchestrator_adapter.run("goal", {"principal_scope_key": "principal:x"}))
