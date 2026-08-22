from pathlib import Path

from cortex_server.modules.execution_transaction import ExecutionTransaction
from cortex_server.modules.reasoning_kernel import (
    build_belief_claim,
    build_policy_decision,
    build_reasoning_task_from_transaction,
    model_dump_compat,
    task_status_from_transaction_status,
)



def test_task_status_from_transaction_status_maps_common_states():
    assert task_status_from_transaction_status("initialized") == "pending"
    assert task_status_from_transaction_status("running") == "running"
    assert task_status_from_transaction_status("completed") == "completed"
    assert task_status_from_transaction_status("verification_failed") == "failed"



def test_build_reasoning_task_from_transaction_projects_steps_and_journal(tmp_path: Path):
    tx = {
        "tx_id": "tx_demo",
        "tx_type": "nexus_orchestration",
        "status": "completed",
        "journal_path": str(tmp_path / "tx_demo.json"),
        "started_at": "2026-03-27T00:00:00+00:00",
        "ended_at": "2026-03-27T00:00:05+00:00",
        "metadata": {
            "title": "Resolve user task",
            "description": "Run the orchestration flow",
            "owner": "cortex",
            "session_key": "session:abc",
            "archetype": "coding",
            "success_criteria": ["validator passes"],
            "constraints": ["respect approvals"],
        },
        "steps": [
            {
                "name": "retrieve_context",
                "status": "completed",
                "attempts": 1,
                "latency_ms": 12,
                "retry_policy": "no_retry",
                "rollback_available": False,
                "verified": True,
            },
            {
                "name": "validate_answer",
                "status": "failed",
                "attempts": 2,
                "latency_ms": 44,
                "retry_policy": "validation_retry",
                "rollback_available": False,
                "verified": False,
                "error": "validator rejected draft",
            },
        ],
    }

    task = build_reasoning_task_from_transaction(tx)
    data = model_dump_compat(task)

    assert data["task_id"] == "task_tx_demo"
    assert data["title"] == "Resolve user task"
    assert data["status"] == "completed"
    assert data["session_key"] == "session:abc"
    assert data["archetype"] == "coding"
    assert data["success_criteria"] == ["validator passes"]
    assert data["constraints"] == ["respect approvals"]
    assert len(data["subtasks"]) == 2
    assert data["subtasks"][0]["task_id"] == "task_tx_demo:retrieve_context"
    assert data["subtasks"][0]["status"] == "completed"
    assert data["subtasks"][1]["status"] == "failed"
    assert data["artifacts"][0]["kind"] == "journal"
    assert data["execution"][0]["tx_id"] == "tx_demo"



def test_execution_transaction_exports_reasoning_task_and_outcome(tmp_path: Path):
    tx = ExecutionTransaction("tx_live", "tool_run", metadata={"title": "Run tool"}, journal_dir=tmp_path)
    tx.preflight({"ok": lambda: {"ok": True}})
    tx.run_step("step_one", lambda: {"ok": True}, verify=lambda out: bool(out.get("ok")))
    tx.finalize({"done": True}, verify=lambda payload: bool(payload.get("done")))

    task = tx.to_reasoning_task(owner="cortex", session_key="session:live", archetype="coding")
    outcome = tx.to_reasoning_outcome(summary="Tool run completed", validator_pass=True)

    assert task["task_id"] == "task_tx_live"
    assert task["status"] == "completed"
    assert task["execution"][0]["tx_type"] == "tool_run"
    assert task["subtasks"][0]["title"] == "step_one"
    assert outcome["task_id"] == "task_tx_live"
    assert outcome["status"] == "success"
    assert outcome["validator_pass"] is True
    assert outcome["execution_ref"] == "tx_live"



def test_build_policy_and_belief_objects_capture_provenance():
    decision = build_policy_decision(
        domain="routing",
        chosen="alive_orchestrated",
        rationale="high complexity and validation need",
        confidence=0.82,
        task_id="task_123",
        alternatives=["fastlane"],
        inputs={"complexity": 0.9},
    )
    claim = build_belief_claim(
        subject="repo",
        predicate="targeted_tests_passed",
        value=75,
        confidence=0.98,
        freshness=0.95,
        kind="observed",
        task_id="task_123",
        source_type="pytest",
        source_ref="tests/test_reasoning_kernel.py",
        note="live test run",
    )

    decision_data = model_dump_compat(decision)
    claim_data = model_dump_compat(claim)

    assert decision_data["domain"] == "routing"
    assert decision_data["chosen"] == "alive_orchestrated"
    assert decision_data["task_id"] == "task_123"
    assert claim_data["subject"] == "repo"
    assert claim_data["predicate"] == "targeted_tests_passed"
    assert claim_data["value"] == 75
    assert claim_data["provenance"][0]["source_type"] == "pytest"
