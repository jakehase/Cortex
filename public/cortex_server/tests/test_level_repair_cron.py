"""L8 Cron repair: in-process safe tasks, honest heuristics, NL proposals, adapter."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from cortex_server import scheduler
from cortex_server.modules import cron_tasks
from cortex_server.modules.action_capabilities import mint_deferred_action_capability
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import cron as cron_adapter
from cortex_server.routers import cron


DELEGATION_SECRET = "positive-delegation-secret-000000000000000001"


def _isolate_ledgers(monkeypatch, tmp_path):
    monkeypatch.setattr(scheduler, "_TRIGGER_LEDGER_PATH", tmp_path / "trigger.jsonl")
    monkeypatch.setattr(scheduler, "_NOTARY_LEDGER_PATH", tmp_path / "notary.jsonl")
    monkeypatch.setattr(scheduler, "_NOVELTY_STATS_PATH", tmp_path / "novelty.json")
    monkeypatch.setattr(scheduler, "_ensure_state_dir", lambda: tmp_path)

    def no_celery(*_args, **_kwargs):
        raise AssertionError("in-process tasks must never be sent to Celery")

    monkeypatch.setattr(scheduler.celery_app, "send_task", no_celery)


def _fake_preview(cron_expr, tz, count):
    return [f"2026-10-1{i}T09:30:00+00:00" for i in range(count)]


# ── deterministic parsing ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("remind me to stretch every weekday at 9:30am", "30 9 * * mon-fri"),
        ("every 15 minutes run a health report", "*/15 * * * *"),
        ("remind me to call mom every sunday at 6pm", "0 18 * * sun"),
        ("daily at noon remind me to drink water", "0 12 * * *"),
        ("remind me to pay rent on the 1st of every month at 9", "0 9 1 * *"),
    ],
)
def test_exact_phrasings_parse_to_cron_with_day_names(text, expected):
    assert cron_tasks.parse_schedule_phrase(text)["cron"] == expected


@pytest.mark.parametrize(
    "text",
    [
        "remind me tomorrow at 9",  # one-off, not a recurrence
        "every day remind me to log hours",  # time missing
        "every day at 9am and 5pm remind me",  # two times: ambiguous, never guessed
        "every 90 minutes remind me",  # not expressible as */N minutes
    ],
)
def test_inexact_phrasings_are_not_guessed(text):
    assert cron_tasks.parse_schedule_phrase(text)["cron"] is None


def test_reminder_args_are_validated():
    with pytest.raises(cron_tasks.CronTaskArgsError):
        cron_tasks.validate_in_process_args("cortex.reminder", [])
    with pytest.raises(cron_tasks.CronTaskArgsError):
        cron_tasks.validate_in_process_args("cortex.reminder", ["x" * 501])
    with pytest.raises(cron_tasks.CronTaskArgsError):
        cron_tasks.validate_in_process_args("cortex.health_report", ["unexpected"])
    assert cron_tasks.validate_in_process_args("cortex.reminder", ["  take   meds "]) == ["take meds"]


# ── proposals (never schedule) ─────────────────────────────────────────────


def test_deterministic_proposal_does_not_call_model():
    async def model_must_not_run(**_kwargs):
        raise AssertionError("exact phrasing must not need the model")

    result = asyncio.run(
        cron_tasks.propose_schedule(
            "remind me to stretch every weekday at 9:30am",
            principal_scope_key="principal:abc",
            preview_fn=_fake_preview,
            validate_timezone_fn=scheduler.validate_timezone_name,
            model_fn=model_must_not_run,
        )
    )
    assert result["success"] is True
    assert result["status"] == "proposed"
    assert result["origin"] == "deterministic"
    assert result["scheduled"] is False
    assert result["requires_confirmation"] is True
    assert result["proposal"]["task"] == "cortex.reminder"
    assert result["proposal"]["args"] == ["stretch"]
    assert result["proposal"]["cron"] == "30 9 * * mon-fri"
    assert len(result["proposal"]["next_fire_times"]) == 5


def test_model_backed_proposal_carries_receipt():
    calls = []

    async def model_ok(**kwargs):
        calls.append(kwargs)
        assert kwargs["schema"] is cron_tasks.CronProposalModel
        assert kwargs["principal_scope_key"] == "principal:abc"
        return {
            "status": "ok",
            "data": {
                "schedulable": True,
                "cron": "0 7 * * mon",
                "timezone": None,
                "task": "cortex.reminder",
                "reminder_text": "water the plants",
                "one_off": False,
                "reason": "",
            },
            "model": "gpt-5.6-sol",
            "receipt_id": "rcpt-1",
        }

    result = asyncio.run(
        cron_tasks.propose_schedule(
            "Each Monday morning around seven I want a nudge about the plants",
            principal_scope_key="principal:abc",
            preview_fn=_fake_preview,
            validate_timezone_fn=scheduler.validate_timezone_name,
            model_fn=model_ok,
        )
    )
    assert len(calls) == 1
    assert result["status"] == "proposed"
    assert result["origin"] == "model"
    assert result["receipt_id"] == "rcpt-1"
    assert result["proposal"]["args"] == ["water the plants"]
    assert result["scheduled"] is False


def test_model_unavailable_proposal_is_honest_and_empty():
    async def model_down(**_kwargs):
        return {"status": "model_unavailable", "error": "503"}

    result = asyncio.run(
        cron_tasks.propose_schedule(
            "nudge me about the plants sometimes",
            principal_scope_key="principal:abc",
            preview_fn=_fake_preview,
            validate_timezone_fn=scheduler.validate_timezone_name,
            model_fn=model_down,
        )
    )
    assert result["success"] is False
    assert result["origin"] == "model_unavailable"
    assert "proposal" not in result
    assert result["scheduled"] is False


def test_one_off_request_is_not_schedulable():
    async def model_one_off(**_kwargs):
        return {
            "status": "ok",
            "data": {"schedulable": False, "one_off": True, "reason": "single future time"},
            "model": "m",
            "receipt_id": "r",
        }

    result = asyncio.run(
        cron_tasks.propose_schedule(
            "remind me tomorrow at 9",
            principal_scope_key="principal:abc",
            model_fn=model_one_off,
        )
    )
    assert result["status"] == "not_schedulable"
    assert result["one_off"] is True
    assert "proposal" not in result


def test_propose_route_rejects_unknown_timezone():
    request = SimpleNamespace(state=SimpleNamespace())
    with pytest.raises(HTTPException) as caught:
        asyncio.run(cron.cron_propose(cron.CronProposeRequest(text="every hour health check", timezone="Mars/Olympus"), request))
    assert caught.value.status_code == 400


def test_propose_route_adds_bounded_run_budget():
    request = SimpleNamespace(state=SimpleNamespace())
    result = asyncio.run(
        cron.cron_propose(cron.CronProposeRequest(text="every day at 8am health report", use_model=False), request)
    )
    assert result["status"] == "proposed"
    body = result["schedule_with"]["body"]
    assert body["task"] == "cortex.health_report"
    assert body["timezone"] == "UTC"
    assert 28 <= body["max_runs"] <= 31
    assert result["scheduled"] is False


# ── in-process execution behind the same authority rules ──────────────────


@pytest.mark.asyncio
async def test_manual_in_process_reminder_runs_without_celery(monkeypatch, tmp_path, action_authorization_factory):
    _isolate_ledgers(monkeypatch, tmp_path)
    receipt = await action_authorization_factory()

    run_id = scheduler.trigger_celery_task(
        "cortex.reminder", args=["stretch"], source="manual_api", action_authorization=receipt,
    )

    assert run_id.startswith("inproc-")
    outcome = scheduler.get_in_process_result(run_id)
    assert outcome["status"] == "completed"
    assert outcome["outcome"]["result"]["external_message_sent"] is False
    reminders = cron_tasks.read_log_tail(tmp_path / cron_tasks.REMINDER_LOG_FILENAME)
    assert reminders[-1]["text"] == "stretch"
    event = json.loads((tmp_path / "trigger.jsonl").read_text().splitlines()[-1])
    assert event["status"] == "triggered"
    assert event["dispatch"] == "in_process"
    assert event["outcome"] == "succeeded"


@pytest.mark.asyncio
async def test_in_process_task_requires_authorization(monkeypatch, tmp_path):
    _isolate_ledgers(monkeypatch, tmp_path)
    with pytest.raises(HTTPException) as caught:
        scheduler.trigger_celery_task("cortex.reminder", args=["stretch"], source="manual_api")
    assert caught.value.status_code == 403
    assert not (tmp_path / cron_tasks.REMINDER_LOG_FILENAME).exists()


@pytest.mark.asyncio
async def test_scheduled_in_process_run_consumes_deferred_capability_once(
    monkeypatch, tmp_path, action_authorization_factory
):
    _isolate_ledgers(monkeypatch, tmp_path)
    parent = await action_authorization_factory()
    capability = mint_deferred_action_capability(
        parent, task="cortex.reminder", args=["stretch"], secret=DELEGATION_SECRET,
        ttl_seconds=300, max_runs=1,
    )
    policy = {"action_capability": capability, "voi_enabled": False}

    first = scheduler.trigger_celery_task(
        "cortex.reminder", args=["stretch"], source="scheduled", job_id="job-r", policy_override=policy,
    )
    replay = scheduler.trigger_celery_task(
        "cortex.reminder", args=["stretch"], source="scheduled", job_id="job-r", policy_override=policy,
    )

    assert first and first.startswith("inproc-")
    assert replay is None
    statuses = [json.loads(line)["status"] for line in (tmp_path / "trigger.jsonl").read_text().splitlines()]
    assert statuses == ["triggered", "held_action_authorization"]
    assert len(cron_tasks.read_log_tail(tmp_path / cron_tasks.REMINDER_LOG_FILENAME)) == 1


@pytest.mark.asyncio
async def test_trigger_route_reports_real_in_process_outcome(monkeypatch, tmp_path, action_authorization_factory):
    _isolate_ledgers(monkeypatch, tmp_path)
    receipt = await action_authorization_factory()

    response = await cron.trigger_webhook(
        cron.WebhookTriggerRequest(task="cortex.health_report", args=[]),
        authorization=receipt,
    )

    assert response.dispatch == "in_process"
    assert response.status == "completed"
    assert response.result["result"]["recorded"] is True
    reports = cron_tasks.read_log_tail(tmp_path / cron_tasks.REPORT_LOG_FILENAME)
    assert reports[-1]["basis"] == "measured"


@pytest.mark.asyncio
async def test_trigger_route_rejects_malformed_in_process_args(monkeypatch, tmp_path, action_authorization_factory):
    _isolate_ledgers(monkeypatch, tmp_path)
    receipt = await action_authorization_factory()
    with pytest.raises(HTTPException) as caught:
        await cron.trigger_webhook(cron.WebhookTriggerRequest(task="cortex.reminder", args=[]), authorization=receipt)
    assert caught.value.status_code == 422


# ── honest heuristics ──────────────────────────────────────────────────────


def test_cadence_twin_labels_heuristics_and_measures_run_counts(monkeypatch, tmp_path):
    _isolate_ledgers(monkeypatch, tmp_path)
    sim = scheduler.simulate_cadence_twin("0 * * * *")
    primary = next(row for row in sim["scenarios"] if row["is_primary"])
    assert primary["runs_24h"] in (23, 24, 25)
    assert "quality_forecast" not in primary and "risk_forecast" not in primary
    assert "quality_heuristic" in primary
    assert sim["label"].startswith("HEURISTIC")
    assert sim["forecast_basis"]["risk"] == "caller_supplied_prior"
    assert sim["measured_fields"] == ["runs_24h", "runs_7d"]


def test_cadence_twin_uses_observed_error_rate_when_history_exists(monkeypatch, tmp_path):
    _isolate_ledgers(monkeypatch, tmp_path)
    digest = scheduler._sha256_hex("job-h")
    rows = [{"ts": scheduler._utc_now_iso(), "status": status, "job_id_sha256": digest, "latency_ms": 10}
            for status in ["triggered"] * 3 + ["error"] * 2]
    (tmp_path / "trigger.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    sim = scheduler.simulate_cadence_twin("0 * * * *", risk_score=0.0, job_id="job-h")
    assert sim["forecast_basis"]["risk"] == "observed_error_rate"
    assert sim["inputs"]["risk_used"] == 0.4
    assert sim["observed_history"]["runs"] == 5


def test_voi_gate_is_labelled_caller_priors():
    assert scheduler.evaluate_voi_gate({"voi_enabled": True})["basis"] == "caller_supplied_priors"


def test_timezone_validation():
    assert scheduler.validate_timezone_name("America/Chicago") == "America/Chicago"
    with pytest.raises(ValueError):
        scheduler.validate_timezone_name("../etc/passwd")
    with pytest.raises(ValueError):
        scheduler.validate_timezone_name("Not/AZone")


# ── adapter contract ───────────────────────────────────────────────────────


def test_cron_adapter_contract_attributes():
    assert cron_adapter.LEVEL == 8
    assert cron_adapter.NAME == "cron"
    assert cron_adapter.SAFE_AUTORUN is True
    assert cron_adapter.DEFAULT_DEADLINE_S > 0


def test_cron_adapter_proposes_without_scheduling(monkeypatch):
    def must_not_schedule(*_args, **_kwargs):
        raise AssertionError("the adapter must never schedule")

    monkeypatch.setattr(scheduler, "add_cron_job", must_not_schedule)
    result = asyncio.run(cron_adapter.run("remind me to stretch every weekday at 9:30am", {}))
    assert result["operation"] == "cron.propose"
    assert result["origin"] == "deterministic"
    assert result["data"]["scheduled"] is False
    assert result["data"]["requires_confirmation"] is True
    assert "PROPOSAL ONLY" in result["summary"]
    json.dumps(result)


def test_cron_adapter_blocks_on_empty_and_model_unavailable(monkeypatch):
    with pytest.raises(ExecutionBlocked):
        asyncio.run(cron_adapter.run("   ", {}))

    async def model_down(**_kwargs):
        return {"status": "timeout"}

    monkeypatch.setattr("cortex_server.modules.level_model.level_model_json", model_down)
    with pytest.raises(ExecutionBlocked):
        asyncio.run(cron_adapter.run("nudge me about plants now and then", {"principal_scope_key": "principal:x"}))
