import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from cortex_server.modules import reasoning_runtime_execution as runtime_execution
from cortex_server.modules import reasoning_scheduler as scheduler
from cortex_server.modules.reasoning_planner import PlanNode, ReasoningPlanGraph
from cortex_server.modules.reasoning_retry_policy import (
    MAX_CUMULATIVE_RETRY_BACKOFF_SECONDS,
    MAX_RETRY_ATTEMPTS,
    MAX_RETRY_BACKOFF_SECONDS,
    RetryPolicyError,
    retry_settings,
)
from cortex_server.routers.orchestrator import CreateWorkflowRequest, WorkflowStep


def _step(metadata=None):
    return {
        "node_id": "bounded-retry",
        "title": "Bounded retry",
        "endpoint": "/oracle/chat",
        "method": "POST",
        "payload": {"prompt": "bounded"},
        "failure_mode": "retry",
        "metadata": dict(metadata or {}),
    }


@pytest.mark.parametrize(
    "metadata",
    [
        {"max_attempts": 0},
        {"max_attempts": MAX_RETRY_ATTEMPTS + 1},
        {"max_attempts": 1_000_000_000},
        {"max_attempts": True},
        {"max_attempts": "2"},
        {"retry_backoff_seconds": -1},
        {"retry_backoff_seconds": MAX_RETRY_BACKOFF_SECONDS + 0.1},
        {"retry_backoff_seconds": 1_000_000_000},
        {"retry_backoff_seconds": float("inf")},
        {"retry_backoff_seconds": float("nan")},
        {"retry_on_timeout": "false"},
        {"retry_on_status_codes": [99]},
        {"retry_on_error_types": [1]},
    ],
)
def test_retry_metadata_rejects_malformed_and_out_of_range_values(metadata):
    with pytest.raises(RetryPolicyError):
        retry_settings(_step(metadata))


def test_retry_policy_rejects_excess_cumulative_backoff_and_accepts_boundary():
    with pytest.raises(RetryPolicyError, match="cumulative retry backoff"):
        retry_settings(
            _step(
                {
                    "max_attempts": MAX_RETRY_ATTEMPTS,
                    "retry_backoff_seconds": MAX_RETRY_BACKOFF_SECONDS,
                }
            )
        )

    bounded = retry_settings(
        _step(
            {
                "max_attempts": 6,
                "retry_backoff_seconds": MAX_RETRY_BACKOFF_SECONDS,
            }
        )
    )
    assert bounded["max_attempts"] == 6
    assert (
        bounded["cumulative_retry_backoff_seconds"]
        == MAX_CUMULATIVE_RETRY_BACKOFF_SECONDS
    )


def test_retry_bounds_apply_to_policy_defaults_and_scheduler_path():
    with pytest.raises(RetryPolicyError):
        retry_settings(
            _step(),
            {
                "retry_max_attempts": 1_000_000_000,
                "retry_backoff_seconds": 0,
            },
        )

    with pytest.raises(scheduler.ReasoningSchedulerError):
        scheduler._node_retry_settings(
            _step(),
            workflow={
                "metadata": {
                    "policy": {
                        "settings": {
                            "retry_max_attempts": 1_000_000_000,
                        }
                    }
                }
            },
        )


def test_persisted_workflow_models_reject_oversized_retry_metadata():
    with pytest.raises(ValidationError):
        PlanNode(**_step({"max_attempts": 1_000_000_000}))

    with pytest.raises(ValidationError):
        WorkflowStep(
            endpoint="/oracle/chat",
            metadata={"retry_backoff_seconds": 1_000_000_000},
        )

    with pytest.raises(ValidationError):
        ReasoningPlanGraph(
            name="invalid-policy",
            nodes=[_step()],
            metadata={
                "policy": {
                    "settings": {"retry_max_attempts": 1_000_000_000}
                }
            },
        )

    with pytest.raises(ValidationError):
        CreateWorkflowRequest(
            name="invalid-policy",
            steps=[WorkflowStep(endpoint="/oracle/chat")],
            metadata={
                "policy": {
                    "settings": {"retry_backoff_seconds": float("inf")}
                }
            },
        )


def test_each_retry_call_is_clamped_to_remaining_workflow_budget():
    observed = {}

    async def execute_single_step(
        client,
        step,
        *,
        step_index,
        results_by_node,
        workflow_metadata=None,
    ):
        observed["remaining"] = step["_remaining_workflow_budget_seconds"]
        observed["timeout"] = runtime_execution.effective_step_timeout(
            step,
            workflow_metadata,
            step_timeout_max_s=30,
        )
        return {
            "node_id": step["node_id"],
            "success": True,
            "status_code": 200,
            "response": {"ok": True},
        }

    result = asyncio.run(
        runtime_execution.execute_step_with_retry(
            object(),
            _step({"max_attempts": 2, "retry_backoff_seconds": 0}),
            step_index=1,
            results_by_node={},
            workflow_metadata={},
            deadline_at=datetime.now(timezone.utc) + timedelta(seconds=0.25),
            execute_single_step_fn=execute_single_step,
            step_belief_context_fn=lambda *_args: {},
            redact_headers_fn=lambda headers: headers,
        )
    )

    assert result["success"] is True
    assert 0 < observed["remaining"] <= 0.25
    assert observed["timeout"] <= observed["remaining"]


def test_retry_sleep_is_clamped_to_remaining_workflow_budget(monkeypatch):
    sleeps = []
    calls = []

    async def fake_sleep(delay):
        sleeps.append(delay)

    async def failing_step(
        client,
        step,
        *,
        step_index,
        results_by_node,
        workflow_metadata=None,
    ):
        calls.append(step)
        return {
            "node_id": step["node_id"],
            "success": False,
            "status_code": 503,
            "error": "dependency unavailable",
        }

    monkeypatch.setattr(runtime_execution.asyncio, "sleep", fake_sleep)
    result = asyncio.run(
        runtime_execution.execute_step_with_retry(
            object(),
            _step({"max_attempts": 2, "retry_backoff_seconds": 60}),
            step_index=1,
            results_by_node={},
            workflow_metadata={},
            deadline_at=datetime.now(timezone.utc) + timedelta(seconds=0.2),
            execute_single_step_fn=failing_step,
            step_belief_context_fn=lambda *_args: {},
            redact_headers_fn=lambda headers: headers,
        )
    )

    assert len(calls) == 1
    assert len(sleeps) == 1
    assert 0 < sleeps[0] <= 0.2
    assert result["error"] == "workflow_deadline_exceeded"
    assert result["cancelled"] is True


def test_scheduler_retry_timestamp_never_exceeds_process_deadline():
    deadline = datetime.now(timezone.utc) + timedelta(milliseconds=100)
    retry_at = scheduler._retry_wait_until(
        backoff_seconds=MAX_RETRY_BACKOFF_SECONDS,
        deadline_at=deadline,
    )

    assert retry_at is not None
    assert datetime.fromisoformat(retry_at) <= deadline
