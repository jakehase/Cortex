import json
import asyncio

import pytest

import cortex_server.modules.reasoning_approvals as approvals
import cortex_server.modules.reasoning_beliefs as beliefs
import cortex_server.modules.reasoning_scheduler as scheduler
import cortex_server.routers.orchestrator as orchestrator
from cortex_server.modules.reasoning_planner import ReasoningPlanGraph
from cortex_server.modules.reasoning_safety import evaluate_step_permission
from cortex_server.modules.verification_contracts import evaluate_contracts



def test_belief_store_supersedes_stale_values(tmp_path, monkeypatch):
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    first = beliefs.upsert_belief(
        subject="repo",
        predicate="targeted_tests_passed",
        value=87,
        task_id="task_demo",
        source_type="pytest",
        note="first run",
    )
    second = beliefs.upsert_belief(
        subject="repo",
        predicate="targeted_tests_passed",
        value=92,
        task_id="task_demo",
        source_type="pytest",
        note="newer run",
    )

    all_beliefs = beliefs.list_beliefs(subject="repo", predicate="targeted_tests_passed", limit=10)
    assert second["value"] == 92
    assert any(row["status"] == "superseded" and row["value"] == 87 for row in all_beliefs)
    assert any(row["status"] == "active" and row["value"] == 92 for row in all_beliefs)



def test_verification_contracts_and_safety_gate_work(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    pre = evaluate_contracts(
        [{"kind": "dependency_success", "stage": "pre", "target_node": "fetch"}],
        stage="pre",
        results_by_node={"fetch": {"success": True}},
    )
    post = evaluate_contracts(
        [{"kind": "response_path_equals", "stage": "post", "path": "name", "expected": "Jake"}],
        stage="post",
        response={"status_code": 200, "response": {"name": "Jake"}},
    )
    blocked = evaluate_step_permission(
        {"endpoint": "/homeassistant/service", "method": "POST", "metadata": {"approval_required": True}},
        workflow_metadata={},
    )
    grant = approvals.create_approval_grant(
        granted_by="Jake",
        scope="workflow",
        workflow_id="wf_demo",
        node_ids=["lights"],
        endpoint_prefixes=["/homeassistant/service"],
        methods=["POST"],
        risk_levels=["high"],
        metadata={"role": "approver"},
    )
    approved = evaluate_step_permission(
        {"endpoint": "/homeassistant/service", "method": "POST", "node_id": "lights", "metadata": {}},
        workflow_metadata={"workflow_id": "wf_demo", "approval_grant_ids": [grant["grant_id"]]},
    )
    approval_contract = evaluate_contracts(
        [{"kind": "approval_required", "stage": "pre", "approval_scope": "workflow"}],
        stage="pre",
        step={"endpoint": "/homeassistant/service", "method": "POST", "node_id": "lights", "metadata": {}},
        workflow_metadata={"workflow_id": "wf_demo", "approval_grant_ids": [grant["grant_id"]]},
        user_id="Jake",
        role="approver",
    )

    assert pre["ok"] is True
    assert post["ok"] is True
    assert blocked["allow"] is False
    assert blocked["reason"] == "approval_required"
    assert approved["allow"] is True
    assert approved["approval_grant_id"] == grant["grant_id"]
    assert approval_contract["ok"] is True


def test_approval_contract_rejects_forgeable_legacy_caller_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    result = evaluate_contracts(
        [{"kind": "approval_required", "stage": "pre", "approval_scope": "workflow"}],
        stage="pre",
        step={"endpoint": "/homeassistant/service", "method": "POST", "node_id": "lights"},
        workflow_metadata={"workflow_id": "wf_demo"},
        user_id="Jake",
        role="approver",
        approved=True,
    )

    assert result["ok"] is False
    assert result["results"][0]["passed"] is False
    assert result["results"][0]["observed"]["approval_grant_id"] is None


@pytest.mark.parametrize(
    ("scope", "grant_bindings"),
    [
        ("workflow", {"workflow_id": "wf_demo"}),
        ("endpoint", {"endpoint_prefixes": ["/homeassistant/service"]}),
        ("risk_class", {"risk_levels": ["high"]}),
    ],
)
def test_approval_contract_accepts_authoritative_grant_without_node_or_caller_bindings(
    tmp_path, monkeypatch, scope, grant_bindings
):
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    grant = approvals.create_approval_grant(
        granted_by="grant-issuer-not-caller",
        scope=scope,
        methods=["POST"],
        **grant_bindings,
    )

    result = evaluate_contracts(
        [{"kind": "approval_required", "stage": "pre", "approval_scope": scope}],
        stage="pre",
        step={"endpoint": "/homeassistant/service", "method": "POST", "metadata": {}},
        workflow_metadata={"workflow_id": "wf_demo", "approval_grant_ids": [grant["grant_id"]]},
    )

    assert result["ok"] is True
    assert result["results"][0]["observed"]["approval_grant_id"] == grant["grant_id"]


def test_approval_contract_enforces_explicit_role_binding(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    grant = approvals.create_approval_grant(
        scope="workflow",
        workflow_id="wf_demo",
        metadata={"role": "approver"},
    )
    contract = [{"kind": "approval_required", "stage": "pre", "approval_scope": "workflow"}]
    context = {
        "stage": "pre",
        "step": {"endpoint": "/safe", "method": "POST"},
        "workflow_metadata": {"workflow_id": "wf_demo", "approval_grant_ids": [grant["grant_id"]]},
    }

    assert evaluate_contracts(contract, role="approver", **context)["ok"] is True
    assert evaluate_contracts(contract, role="operator", **context)["ok"] is False
    assert evaluate_contracts(contract, **context)["ok"] is False



def test_recurring_process_pause_resume_and_explain(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    monkeypatch.setattr(orchestrator, "RUNTIME_DELIVERY_ROOT", tmp_path / "runtime_delivery")
    monkeypatch.setattr(scheduler, "DEFAULT_STATE_PATH", tmp_path / "reasoning_scheduler.json")
    monkeypatch.setattr(scheduler, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    monkeypatch.setattr(orchestrator, "upsert_belief", beliefs.upsert_belief)
    monkeypatch.setattr(orchestrator, "beliefs_for_task", beliefs.beliefs_for_task)
    monkeypatch.setattr(orchestrator, "list_beliefs", beliefs.list_beliefs)
    monkeypatch.setattr(orchestrator, "search_beliefs", beliefs.search_beliefs)

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
        name="watch_plan",
        metadata={"owner": "cortex", "session_key": "session:watch", "archetype": "coding"},
        nodes=[
            {
                "node_id": "poll",
                "title": "Poll",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "payload": {"prompt": "ping"},
                "contracts": [{"kind": "response_status", "stage": "post", "status_codes": [200]}],
            }
        ],
    )

    scheduled = asyncio.run(
        orchestrator.schedule_plan_runtime(
            orchestrator.RuntimePlanRequest(
                graph=graph,
                options=orchestrator.RuntimeScheduleOptions(cadence_seconds=1),
            )
        )
    )
    process_id = scheduled["process"]["process_id"]

    first_tick = asyncio.run(orchestrator.tick_runtime(orchestrator.RuntimeTickRequest(limit=10, execute=True)))
    assert first_tick["executed_count"] == 1

    process_view = asyncio.run(orchestrator.get_runtime_process_view(process_id))
    assert process_view["process"]["recurrence"]["next_run_at"] is not None

    paused = asyncio.run(orchestrator.pause_runtime_process_route(process_id))
    assert paused["process"]["status"] == "paused"

    resumed = asyncio.run(orchestrator.resume_runtime_process_route(process_id))
    assert resumed["process"]["enabled"] is True

    explained = asyncio.run(orchestrator.explain_runtime_process(process_id))
    assert explained["policy"]["long_running"] is True
    assert isinstance(explained["beliefs"], list)


def test_beliefs_and_approvals_reload_from_sqlite_store(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", db_path)

    belief = beliefs.upsert_belief(
        subject="repo",
        predicate="status",
        value="green",
        task_id="task_reload",
        source_type="pytest",
    )
    grant = approvals.create_approval_grant(
        granted_by="Jake",
        scope="workflow",
        workflow_id="wf_reload",
        endpoint_prefixes=["/homeassistant/service"],
        methods=["POST"],
        risk_levels=["high"],
    )

    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "missing_beliefs.json")
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "missing_approvals.json")

    reloaded_beliefs = beliefs.list_beliefs(subject="repo", predicate="status", limit=10)
    reloaded_grants = approvals.list_approval_grants()

    assert any(row["claim_id"] == belief["claim_id"] for row in reloaded_beliefs)
    assert any(row["grant_id"] == grant["grant_id"] for row in reloaded_grants)


def test_legacy_json_fallback_is_opt_in_for_beliefs_and_approvals(tmp_path, monkeypatch):
    db_path = tmp_path / "reasoning_runtime.db"
    beliefs_json = tmp_path / "reasoning_beliefs.json"
    approvals_json = tmp_path / "reasoning_approvals.json"

    beliefs_json.write_text(json.dumps({
        "beliefs": [
            {
                "claim_id": "claim_legacy",
                "subject": "repo",
                "predicate": "status",
                "value": "legacy",
                "status": "active",
            }
        ]
    }), encoding="utf-8")
    approvals_json.write_text(json.dumps({
        "grants": [
            {
                "grant_id": "grant_legacy",
                "workflow_id": "wf_legacy",
                "scope": "workflow",
                "endpoint_prefixes": ["/legacy"],
                "methods": ["POST"],
                "risk_levels": ["high"],
            }
        ]
    }), encoding="utf-8")

    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", beliefs_json)
    monkeypatch.setattr(beliefs, "ENABLE_LEGACY_JSON_FALLBACK", False)
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", db_path)
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", approvals_json)
    monkeypatch.setattr(approvals, "ENABLE_LEGACY_JSON_FALLBACK", False)

    assert beliefs.list_beliefs(limit=10) == []
    assert approvals.list_approval_grants() == []

    monkeypatch.setattr(beliefs, "ENABLE_LEGACY_JSON_FALLBACK", True)
    monkeypatch.setattr(approvals, "ENABLE_LEGACY_JSON_FALLBACK", True)

    loaded_beliefs = beliefs.list_beliefs(limit=10)
    loaded_grants = approvals.list_approval_grants()

    assert any(row["claim_id"] == "claim_legacy" for row in loaded_beliefs)
    assert any(row["grant_id"] == "grant_legacy" for row in loaded_grants)

    monkeypatch.setattr(beliefs, "ENABLE_LEGACY_JSON_FALLBACK", False)
    monkeypatch.setattr(approvals, "ENABLE_LEGACY_JSON_FALLBACK", False)

    assert any(row["claim_id"] == "claim_legacy" for row in beliefs.list_beliefs(limit=10))
    assert any(row["grant_id"] == "grant_legacy" for row in approvals.list_approval_grants())


def test_belief_store_marks_expired_claims_stale(tmp_path, monkeypatch):
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    beliefs.upsert_belief(
        subject="service",
        predicate="health",
        value="green",
        task_id="task_stale",
        source_type="probe",
        observed_at="2026-01-01T00:00:00+00:00",
        metadata={"ttl_seconds": 1},
    )

    rows = beliefs.list_beliefs(subject="service", predicate="health", limit=10)
    assert rows[0]["status"] == "stale"
    assert rows[0]["is_fresh"] is False


def test_belief_explain_shows_conflicts_and_evidence(tmp_path, monkeypatch):
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    old_claim = beliefs.upsert_belief(
        subject="repo",
        predicate="status",
        value="green",
        task_id="task_repo",
        source_type="pytest",
        note="old observation",
    )
    new_claim = beliefs.upsert_belief(
        subject="repo",
        predicate="status",
        value="red",
        task_id="task_repo",
        source_type="runtime_execution",
        source_ref="fetch",
        note="new observation",
        conflict_mode="contradict",
    )

    explained = beliefs.explain_belief(new_claim["claim_id"])

    assert explained is not None
    assert explained["belief"]["claim_id"] == new_claim["claim_id"]
    assert explained["belief"]["status"] == "active"
    assert explained["evidence_chain"][0]["note"] == "new observation"
    assert explained["evidence_bundle"]["evidence_count"] == 1
    assert explained["evidence_bundle"]["source_types"]["runtime_execution"] == 1
    assert explained["evidence_bundle"]["weighted_confidence"] > 0
    assert explained["contradiction_summary"]["conflict_count"] >= 1
    assert explained["contradiction_cluster"]["ambiguity_score"] > 0
    assert explained["epistemic_risk"]["risk_score"] > 0
    assert explained["lineage_graph"]["nodes"]
    assert any(row["claim_id"] == old_claim["claim_id"] for row in explained["conflicts"])


def test_belief_summary_and_conflict_query_surface(tmp_path, monkeypatch):
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id="task_summary", source_type="pytest")
    beliefs.upsert_belief(subject="repo", predicate="status", value="red", task_id="task_summary", source_type="pytest", conflict_mode="contradict")
    beliefs.upsert_belief(subject="repo", predicate="health", value="ok", task_id="task_summary", source_type="probe", observed_at="2026-01-01T00:00:00+00:00", metadata={"ttl_seconds": 1})

    summary = beliefs.summarize_beliefs(task_id="task_summary")
    conflicts = beliefs.belief_conflicts(subject="repo", predicate="status", limit=10)

    assert summary["count"] >= 3
    assert summary["conflict_count"] >= 1
    assert summary["stale_count"] >= 1
    assert any(row["predicate"] == "status" for row in conflicts)


def test_belief_decay_scores_drop_with_age(tmp_path, monkeypatch):
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    claim = beliefs.upsert_belief(
        subject="sensor",
        predicate="temperature",
        value=72,
        task_id="task_decay",
        source_type="probe",
        observed_at="2026-01-01T00:00:00+00:00",
        freshness=0.9,
        confidence=0.8,
        metadata={"ttl_seconds": 100, "confidence_half_life_seconds": 1000},
    )
    rows = beliefs.list_beliefs(subject="sensor", predicate="temperature", limit=10)

    assert rows[0]["claim_id"] == claim["claim_id"]
    assert rows[0]["decayed_freshness"] < 0.9
    assert rows[0]["decayed_confidence"] < 0.8


def test_belief_lineage_traces_supersession_and_contradiction(tmp_path, monkeypatch):
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    first = beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id="task_lineage", source_type="pytest")
    second = beliefs.upsert_belief(subject="repo", predicate="status", value="yellow", task_id="task_lineage", source_type="pytest")
    third = beliefs.upsert_belief(subject="repo", predicate="status", value="red", task_id="task_lineage", source_type="pytest", conflict_mode="contradict")

    lineage = beliefs.trace_belief_lineage(third["claim_id"])
    cluster = beliefs.contradiction_cluster(third["claim_id"])
    risk = beliefs.belief_epistemic_risk(third["claim_id"])

    assert lineage is not None
    assert lineage["belief"]["claim_id"] == third["claim_id"]
    assert any(row["claim_id"] == second["claim_id"] for row in lineage["contradicts_chain"] + lineage["supersedes_chain"])
    assert any(row["claim_id"] == third["claim_id"] for row in lineage["descendants"] + [lineage["belief"]])
    assert lineage["graph"]["nodes"]
    assert lineage["graph"]["edges"]
    assert lineage["summary"]["contradiction_edge_count"] >= 1
    assert cluster["value_count"] >= 2
    assert cluster["ambiguity_score"] > 0
    assert risk["risk_score"] > 0
    assert risk["risk_level"] in {"low", "medium", "high"}


def test_belief_summary_reports_decay_averages(tmp_path, monkeypatch):
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    beliefs.upsert_belief(subject="svc", predicate="health", value="ok", task_id="task_summary2", source_type="probe", observed_at="2026-01-01T00:00:00+00:00", freshness=0.8, confidence=0.9, metadata={"ttl_seconds": 10, "confidence_half_life_seconds": 10})
    beliefs.upsert_belief(subject="svc", predicate="latency", value=10, task_id="task_summary2", source_type="probe", freshness=0.7, confidence=0.6)

    summary = beliefs.summarize_beliefs(task_id="task_summary2")

    assert 0.0 <= summary["avg_decayed_freshness"] <= 1.0
    assert 0.0 <= summary["avg_decayed_confidence"] <= 1.0


def test_evidence_bundle_weights_runtime_execution_higher_than_system(tmp_path, monkeypatch):
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    runtime_claim = beliefs.upsert_belief(subject="svc", predicate="health", value="ok", source_type="runtime_execution", confidence=0.9, freshness=0.8)
    system_claim = beliefs.upsert_belief(subject="svc", predicate="mode", value="auto", source_type="system", confidence=0.9, freshness=0.8)

    runtime_bundle = beliefs.evidence_bundle(runtime_claim["claim_id"])
    system_bundle = beliefs.evidence_bundle(system_claim["claim_id"])

    assert runtime_bundle["source_weight_avg"] > system_bundle["source_weight_avg"]
    assert runtime_bundle["weighted_confidence"] > system_bundle["weighted_confidence"]



def test_select_influential_beliefs_prefers_active_matching_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(beliefs, "DEFAULT_STATE_PATH", tmp_path / "reasoning_beliefs.json")
    monkeypatch.setattr(beliefs, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    beliefs.upsert_belief(subject="repo", predicate="status", value="green", task_id="task_influence", source_type="pytest")
    beliefs.upsert_belief(subject="repo", predicate="status", value="red", task_id="task_influence", source_type="pytest", conflict_mode="contradict")
    beliefs.upsert_belief(subject="svc", predicate="latency", value=10, task_id="task_influence", source_type="probe")

    selected = beliefs.select_influential_beliefs(task_id="task_influence", subjects=["repo"], predicates=["status"], limit=5)

    assert selected
    assert all(row["subject"] == "repo" for row in selected)
    assert all(row["predicate"] == "status" for row in selected)
