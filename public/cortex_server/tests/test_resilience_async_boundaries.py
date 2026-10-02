import asyncio
import json
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from cortex_server import scheduler as cron_scheduler
from cortex_server.modules import async_offload
from cortex_server.routers import cron, hive, oracle, queue


@pytest.mark.asyncio
async def test_blocking_offload_is_responsive_bounded_and_retains_late_completion(
    monkeypatch,
):
    release = threading.Event()
    entered = threading.Event()
    rejected_call_ran = threading.Event()
    before = async_offload.blocking_operation_status()
    assert before["active"] == 0
    monkeypatch.setattr(async_offload, "_MAX_INFLIGHT_BLOCKING", 1)

    def blocked_provider():
        entered.set()
        release.wait(timeout=2)
        return "late-result"

    def must_not_run():
        rejected_call_ran.set()

    call = asyncio.create_task(
        async_offload.run_blocking(
            "test.slow-provider",
            blocked_provider,
            timeout_seconds=0.05,
        )
    )
    try:
        # A timer must run while the synchronous provider occupies a worker.
        await asyncio.wait_for(asyncio.sleep(0.01), timeout=0.03)
        for _ in range(20):
            if entered.is_set():
                break
            await asyncio.sleep(0.005)
        assert entered.is_set()

        with pytest.raises(async_offload.BlockingCallDeadlineExceeded):
            await call

        retained = async_offload.blocking_operation_status()
        assert retained["active"] == 1
        assert retained["operations"] == ["test.slow-provider"]
        assert retained["detached"] == 1
        assert retained["detached_operations"] == ["test.slow-provider"]
        assert retained["timed_out_total"] == before["timed_out_total"] + 1

        with pytest.raises(async_offload.BlockingCallCapacityExceeded):
            await async_offload.run_blocking(
                "test.must-not-dispatch",
                must_not_run,
                timeout_seconds=1,
            )
        assert not rejected_call_ran.is_set()
        assert (
            async_offload.blocking_operation_status()["rejected_total"]
            == before["rejected_total"] + 1
        )
    finally:
        release.set()
        if not call.done():
            await call

    for _ in range(100):
        if async_offload.blocking_operation_status()["active"] == 0:
            break
        await asyncio.sleep(0.01)
    assert async_offload.blocking_operation_status()["active"] == 0
    assert async_offload.blocking_operation_status()["detached"] == 0


@pytest.mark.asyncio
async def test_cron_celery_submission_does_not_block_the_event_loop(
    monkeypatch, action_authorization_factory
):
    entered = threading.Event()

    def slow_submission(task_name, **kwargs):
        entered.set()
        time.sleep(0.06)
        return kwargs["submission_id"]

    monkeypatch.setattr(cron, "trigger_celery_task", slow_submission)
    request = cron.WebhookTriggerRequest(task="cortex_tasks.add", args=[1, 2])
    authorization = await action_authorization_factory()

    submission = asyncio.create_task(
        cron.trigger_webhook(request, authorization=authorization)
    )
    await asyncio.wait_for(asyncio.sleep(0.01), timeout=0.03)
    assert entered.is_set()
    assert not submission.done()
    result = await submission

    assert result.status == "triggered"
    assert result.task_id


@pytest.mark.asyncio
async def test_cancelled_caller_leaves_blocking_side_effect_tracked(monkeypatch):
    release = threading.Event()
    entered = threading.Event()
    monkeypatch.setattr(async_offload, "_MAX_INFLIGHT_BLOCKING", 1)

    def blocked_side_effect():
        entered.set()
        release.wait(timeout=2)

    caller = asyncio.create_task(
        async_offload.run_blocking(
            "test.cancelled-side-effect",
            blocked_side_effect,
            timeout_seconds=1,
        )
    )
    try:
        for _ in range(20):
            if entered.is_set():
                break
            await asyncio.sleep(0.005)
        assert entered.is_set()
        caller.cancel()
        with pytest.raises(asyncio.CancelledError):
            await caller

        status = async_offload.blocking_operation_status()
        assert status["active"] == 1
        assert status["detached_operations"] == ["test.cancelled-side-effect"]
    finally:
        release.set()

    for _ in range(100):
        if async_offload.blocking_operation_status()["active"] == 0:
            break
        await asyncio.sleep(0.01)
    assert async_offload.blocking_operation_status()["active"] == 0


@pytest.mark.asyncio
async def test_cron_capacity_exhaustion_reports_not_dispatched(
    monkeypatch, action_authorization_factory
):
    async def reject(*args, **kwargs):
        raise async_offload.BlockingCallCapacityExceeded("celery.trigger_task", 1)

    monkeypatch.setattr(cron, "run_blocking", reject)
    request = cron.WebhookTriggerRequest(task="cortex_tasks.add", args=[1, 2])
    authorization = await action_authorization_factory()

    with pytest.raises(HTTPException) as caught:
        await cron.trigger_webhook(request, authorization=authorization)

    assert caught.value.status_code == 503
    assert caught.value.detail["submission"] == "not_dispatched"
    assert caught.value.detail["task_id"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("failure", "status_code", "submission"),
    [
        (
            async_offload.BlockingCallCapacityExceeded("celery.send_swarm", 1),
            503,
            "not_dispatched",
        ),
        (
            async_offload.BlockingCallDeadlineExceeded("celery.send_swarm", 0.05),
            504,
            "tracked_pending_completion",
        ),
    ],
)
async def test_hive_submission_reports_dispatch_truth(
    monkeypatch, failure, status_code, submission
):
    async def fail_submission(*_args, **_kwargs):
        raise failure

    monkeypatch.setattr(hive, "run_blocking", fail_submission)

    with pytest.raises(HTTPException) as caught:
        await hive.swarm_orchestrate(hive.SwarmRequest(goal="bounded swarm"))

    assert caught.value.status_code == status_code
    assert caught.value.detail["submission"] == submission
    assert caught.value.detail["task_id"]


@pytest.mark.asyncio
async def test_hive_admitted_submission_forwards_action_authorization(monkeypatch):
    captured = {}
    authorization = object()

    async def admitted(request, authorization=None, idempotency_key=None):
        captured["request"] = request
        captured["authorization"] = authorization
        return queue.TaskResponse(task_id="task-hive", status="scheduled")

    monkeypatch.setattr(hive, "schedule_task", admitted)

    response = await hive.swarm_orchestrate(
        hive.AdmittedSwarmRequest(
            goal="bounded admitted swarm",
            idempotency_key="hive-integration-1",
        ),
        authorization=authorization,
    )

    assert response.task_id == "task-hive"
    assert captured["authorization"] is authorization
    assert captured["request"].task == "cortex_tasks.process_swarm"
    assert captured["request"].idempotency_key == "hive-integration-1"


@pytest.mark.asyncio
async def test_hive_dependency_failure_is_unavailable_not_active(monkeypatch):
    class OfflineClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url):
            raise RuntimeError("dependency unavailable")

    async def failed_celery(*_args, **_kwargs):
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr(hive.httpx, "AsyncClient", lambda **_kwargs: OfflineClient())
    monkeypatch.setattr(hive, "run_blocking", failed_celery)

    result = await hive.hive_status()

    assert result["success"] is False
    assert result["status"] == "unavailable"
    assert result["all_online"] is False
    assert result["level"] == 12


@pytest.mark.asyncio
async def test_queue_dependency_failure_is_never_reported_online(monkeypatch):
    async def failed_probe(*_args, **_kwargs):
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr(queue, "run_blocking", failed_probe)
    result = await queue.get_queue_status()

    assert result["success"] is False
    assert result["status"] == "degraded"
    assert result["source"] == "error_fallback"


@pytest.mark.asyncio
async def test_oracle_status_offloads_http_probes_without_starting_provider_cli(
    monkeypatch,
):
    calls = []

    def forbidden_run(*_args, **_kwargs):
        raise AssertionError("readiness must not start OpenClaw")

    class Response:
        status_code = 200
        text = "ok"

        def raise_for_status(self):
            return None

        def json(self):
            return {"models": [{"name": "bounded-model"}]}

    def slow_get(url, **kwargs):
        calls.append(url)
        time.sleep(0.06)
        return Response()

    monkeypatch.setattr(oracle.subprocess, "run", forbidden_run)
    monkeypatch.setattr(oracle.requests, "get", slow_get)
    monkeypatch.setattr(oracle.shutil, "which", lambda _value: "/opt/bin/openclaw")
    monkeypatch.setattr(oracle.os, "access", lambda *_args: True)
    monkeypatch.setattr(oracle, "OLLAMA_ENABLED", True)
    monkeypatch.setattr(
        oracle,
        "load_config",
        lambda: {"runtime": {"base_model": "test-model"}},
    )
    monkeypatch.setattr(
        oracle.cortex_kernel_v2,
        "performance_snapshot",
        lambda **kwargs: {},
    )

    probe = asyncio.create_task(oracle.oracle_status())
    await asyncio.wait_for(asyncio.sleep(0.01), timeout=0.03)
    assert not probe.done()
    result = await probe

    assert result["openclaw_ok"] is False
    assert result["openclaw_ready"] is True
    assert result["openclaw_provider_verified"] is False
    assert result["bridge_ok"] is True
    assert result["models"] == ["bounded-model"]
    assert len(calls) == 2
    assert result["openclaw_executable"]["check"] == "path_lookup_only"
    assert result["openclaw_executable"]["providerCallMade"] is False


@pytest.mark.asyncio
async def test_oracle_path_only_readiness_never_claims_backend_health(monkeypatch):
    monkeypatch.setattr(oracle.shutil, "which", lambda _value: "/opt/bin/openclaw")
    monkeypatch.setattr(oracle.os, "access", lambda *_args: True)
    monkeypatch.setattr(oracle, "OLLAMA_ENABLED", False)
    monkeypatch.setattr(
        oracle,
        "load_config",
        lambda: {"runtime": {"base_model": "configured-model"}},
    )
    monkeypatch.setattr(
        oracle,
        "_probe_bridge_status",
        lambda: {"ok": False, "error": "bridge unavailable"},
    )
    monkeypatch.setattr(
        oracle.cortex_kernel_v2,
        "performance_snapshot",
        lambda **kwargs: {},
    )

    result = await oracle.oracle_status()

    assert result["status"] == "degraded"
    assert result["openclaw_ready"] is True
    assert result["openclaw_ok"] is False
    assert result["openclaw_provider_verified"] is False


class _FakeScheduler:
    def __init__(self, **kwargs):
        self.running = False
        self.jobs = {}

    def add_job(
        self,
        function,
        *,
        trigger,
        id,
        name,
        args,
        kwargs,
        **schedule,
    ):
        job = SimpleNamespace(
            id=id,
            name=name,
            function=function,
            trigger=trigger,
            args=args,
            kwargs=kwargs,
            next_run_time=None,
            schedule=schedule,
        )
        self.jobs[id] = job
        return job

    def get_jobs(self):
        return list(self.jobs.values())

    def remove_job(self, job_id):
        self.jobs.pop(job_id)

    def start(self):
        self.running = True


def test_scheduler_rejects_non_json_args_before_mutation(monkeypatch, tmp_path):
    fake_scheduler = _FakeScheduler()
    policy_path = tmp_path / "job-policies.json"
    monkeypatch.setattr(cron_scheduler, "scheduler", fake_scheduler)
    monkeypatch.setattr(cron_scheduler, "_JOB_POLICY_PATH", policy_path)

    with pytest.raises(ValueError, match="strict JSON"):
        cron_scheduler.add_cron_job(
            "invalid-args",
            "cortex_tasks.add",
            "*/5 * * * *",
            args=[object()],
        )

    assert fake_scheduler.jobs == {}
    assert not policy_path.exists()


def test_scheduler_rejects_corrupt_policy_store_before_live_mutation(
    monkeypatch, tmp_path
):
    fake_scheduler = _FakeScheduler()
    policy_path = tmp_path / "job-policies.json"
    policy_path.write_text("{not-json", encoding="utf-8")
    monkeypatch.setattr(cron_scheduler, "scheduler", fake_scheduler)
    monkeypatch.setattr(cron_scheduler, "_JOB_POLICY_PATH", policy_path)

    with pytest.raises(RuntimeError, match="invalid persisted scheduler policy store"):
        cron_scheduler.add_cron_job(
            "must-not-dispatch",
            "cortex_tasks.add",
            "*/5 * * * *",
            args=[1],
        )

    assert fake_scheduler.jobs == {}
    assert policy_path.read_text(encoding="utf-8") == "{not-json"


def test_scheduler_persistence_failure_never_mutates_live_jobs(monkeypatch, tmp_path):
    fake_scheduler = _FakeScheduler()
    existing = fake_scheduler.add_job(
        lambda: None,
        trigger="cron",
        id="durable-job",
        name="durable-job",
        args=["cortex_tasks.add", [1], {}],
        kwargs={},
        minute="0",
        hour="*",
        day="*",
        month="*",
        day_of_week="*",
    )
    monkeypatch.setattr(cron_scheduler, "scheduler", fake_scheduler)
    monkeypatch.setattr(cron_scheduler, "_JOB_POLICY_PATH", tmp_path / "policies.json")

    def fail_write(_data):
        raise OSError("durable volume unavailable")

    monkeypatch.setattr(cron_scheduler, "_save_job_policies", fail_write)

    with pytest.raises(OSError, match="durable volume unavailable"):
        cron_scheduler.add_cron_job(
            "durable-job",
            "cortex_tasks.add",
            "*/5 * * * *",
            args=[2],
        )

    assert fake_scheduler.jobs == {"durable-job": existing}
    assert existing.args == ["cortex_tasks.add", [1], {}]


def test_scheduler_delete_persistence_failure_never_removes_live_job(
    monkeypatch, tmp_path
):
    fake_scheduler = _FakeScheduler()
    existing = fake_scheduler.add_job(
        lambda: None,
        trigger="cron",
        id="durable-job",
        name="durable-job",
        args=["cortex_tasks.add", [1], {}],
        kwargs={},
        minute="0",
        hour="*",
        day="*",
        month="*",
        day_of_week="*",
    )
    monkeypatch.setattr(cron_scheduler, "scheduler", fake_scheduler)
    monkeypatch.setattr(cron_scheduler, "_JOB_POLICY_PATH", tmp_path / "policies.json")
    monkeypatch.setattr(
        cron_scheduler,
        "_load_job_policies",
        lambda: {"durable-job": {"spec_version": 1}},
    )

    def fail_write(_data):
        raise OSError("durable volume unavailable")

    monkeypatch.setattr(cron_scheduler, "_save_job_policies", fail_write)

    with pytest.raises(OSError, match="durable volume unavailable"):
        cron_scheduler.remove_job("durable-job")

    assert fake_scheduler.jobs == {"durable-job": existing}


@pytest.mark.asyncio
async def test_valid_restart_rehydrates_versioned_job_with_exact_args(
    monkeypatch, tmp_path
):
    policy_path = tmp_path / "job-policies.json"
    first_scheduler = _FakeScheduler()
    monkeypatch.setattr(cron_scheduler, "_JOB_POLICY_PATH", policy_path)
    monkeypatch.setattr(cron_scheduler, "scheduler", first_scheduler)
    monkeypatch.setattr(cron_scheduler, "_scheduler_was_shutdown", False)
    monkeypatch.setattr(cron_scheduler, "_scheduler_shutdown_pending", False)
    monkeypatch.setattr(cron_scheduler, "_scheduler_loop", None)
    monkeypatch.setattr(
        cron_scheduler,
        "_scheduler_rehydration_report",
        {"status": "not_started", "rehydrated": [], "error": None},
    )

    expected_args = [7, {"mode": "safe", "enabled": True}]
    cron_scheduler.add_cron_job(
        "durable-job",
        "cortex_tasks.add",
        "*/5 * * * *",
        args=expected_args,
        policy={"risk_score": 0.2},
    )
    persisted = json.loads(policy_path.read_text(encoding="utf-8"))
    assert persisted["durable-job"]["spec_version"] == 1
    assert persisted["durable-job"]["args"] == expected_args

    restarted_scheduler = _FakeScheduler()
    monkeypatch.setattr(cron_scheduler, "scheduler", restarted_scheduler)
    cron_scheduler.start_scheduler()

    restored = restarted_scheduler.jobs["durable-job"]
    assert restored.args == ["cortex_tasks.add", expected_args, {}]
    assert restored.kwargs == {
        "source": "scheduled",
        "job_id": "durable-job",
        "job_name": "durable-job",
    }
    assert cron_scheduler.get_scheduler_rehydration_status() == {
        "status": "ready",
        "rehydrated": ["durable-job"],
        "error": None,
        "scheduler_running": True,
        "job_spec_version": 1,
    }


@pytest.mark.parametrize(
    ("policy", "error_fragment"),
    [
        (
            {
                "job_name": "legacy-job",
                "task": "cortex_tasks.add",
                "cron": "*/5 * * * *",
                "args": [1, 2],
            },
            "legacy row missing spec_version",
        ),
        (
            {
                "spec_version": 1,
                "job_name": "legacy-job",
                "task": "cortex_tasks.add",
                "cron": "*/5 * * * *",
            },
            "missing explicit args",
        ),
        (
            {
                "spec_version": 99,
                "job_name": "legacy-job",
                "task": "cortex_tasks.add",
                "cron": "*/5 * * * *",
                "args": [],
            },
            "unsupported spec_version",
        ),
    ],
)
def test_malformed_or_legacy_scheduler_rows_fail_closed_and_are_reported(
    monkeypatch, tmp_path, policy, error_fragment
):
    policy_path = tmp_path / "job-policies.json"
    policy_path.write_text(
        json.dumps({"legacy-job": policy}),
        encoding="utf-8",
    )
    fake_scheduler = _FakeScheduler()
    monkeypatch.setattr(cron_scheduler, "_JOB_POLICY_PATH", policy_path)
    monkeypatch.setattr(cron_scheduler, "scheduler", fake_scheduler)
    monkeypatch.setattr(cron_scheduler, "_scheduler_was_shutdown", False)
    monkeypatch.setattr(cron_scheduler, "_scheduler_shutdown_pending", False)
    monkeypatch.setattr(cron_scheduler, "_scheduler_loop", None)
    monkeypatch.setattr(
        cron_scheduler,
        "_scheduler_rehydration_report",
        {"status": "not_started", "rehydrated": [], "error": None},
    )

    with pytest.raises(RuntimeError, match=error_fragment):
        cron_scheduler.start_scheduler()

    report = cron_scheduler.get_scheduler_rehydration_status()
    assert report["status"] == "failed"
    assert error_fragment in report["error"]
    assert report["scheduler_running"] is False
    assert fake_scheduler.jobs == {}


@pytest.mark.asyncio
async def test_cron_status_reports_scheduler_rehydration_failure(monkeypatch):
    failure = {
        "status": "failed",
        "rehydrated": [],
        "error": "RuntimeError: missing explicit args",
        "scheduler_running": False,
        "job_spec_version": 1,
    }
    monkeypatch.setattr(cron, "get_scheduler_rehydration_status", lambda: failure)
    monkeypatch.setattr(cron, "get_trigger_stats", lambda **kwargs: {})
    monkeypatch.setattr(cron, "get_trigger_totals", lambda: {})
    monkeypatch.setattr(cron, "list_job_policies", lambda: {})
    monkeypatch.setattr(cron, "get_scheduled_jobs", lambda: [])

    result = await cron.cron_status()

    assert result["success"] is False
    assert result["status"] == "degraded"
    assert result["scheduler_rehydration"] == failure
