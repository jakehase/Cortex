"""L14 Chronos repair: real safe jobs with receipts, honest status, held pipeline."""

import asyncio
from datetime import datetime

import pytest
from fastapi import HTTPException

from cortex_server.modules import chronos as chronos_module
from cortex_server.modules.level_adapters import chronos as chronos_adapter
from cortex_server.routers import night_shift


async def _ok_job(_chronos):
    return {"checked": 3}


async def _broken_job(_chronos):
    raise RuntimeError("boom")


@pytest.fixture
def chronos(tmp_path, monkeypatch):
    monkeypatch.delenv("CORTEX_CHRONOS_RUNS_DB", raising=False)
    monkeypatch.delenv("CORTEX_CHRONOS_DISABLED_JOBS", raising=False)
    instance = chronos_module.Chronos(changelog_path=str(tmp_path / "chronos" / "changelog.txt"))
    monkeypatch.setattr(night_shift, "_get_chronos", lambda: instance)
    monkeypatch.setattr(chronos_module, "get_chronos", lambda: instance)
    return instance


@pytest.fixture
def fake_jobs(monkeypatch):
    jobs = {
        "ok_job": {"run": _ok_job, "description": "test"},
        "broken_job": {"run": _broken_job, "description": "test"},
    }
    monkeypatch.setattr(chronos_module, "SAFE_JOBS", jobs)
    return jobs


def test_safe_job_run_persists_receipts_and_sets_last_run_date(chronos, fake_jobs):
    receipts = asyncio.run(chronos.run_safe_jobs(["ok_job", "broken_job"], trigger="manual"))
    by_job = {r["job"]: r for r in receipts}
    assert by_job["ok_job"]["status"] == "succeeded" and by_job["ok_job"]["output_digest"]
    assert by_job["broken_job"]["status"] == "failed" and by_job["broken_job"]["error_type"] == "RuntimeError"
    assert all(r["receipt_persisted"] for r in receipts)
    stored = chronos.recent_runs(10)
    assert {r["job"] for r in stored} == {"ok_job", "broken_job"}
    assert chronos.last_run_date == datetime.now().strftime("%Y-%m-%d")


def test_last_run_date_is_not_set_when_nothing_succeeded(chronos, fake_jobs):
    asyncio.run(chronos.run_safe_jobs(["broken_job"]))
    assert chronos.last_run_date is None
    assert chronos.schedule_view()["last_run_date"] is None


def test_status_lists_only_runnable_jobs_and_holds_legacy_pipeline(chronos, fake_jobs):
    status = asyncio.run(night_shift.night_shift_status())
    assert set(status["capabilities"]) == {"ok_job", "broken_job"}
    for legacy in ("nightly_evolution_cycle", "dream_gap_detection", "geneticist_dna_evolution"):
        assert legacy not in status["capabilities"]
    assert status["held_pipelines"][0]["name"] == "nightly_evolution_pipeline"
    assert status["last_run_date"] is None


def test_default_registry_contains_real_safe_jobs():
    assert set(chronos_module.SAFE_JOBS) >= {
        "health_snapshot", "sentinel_snapshot", "performance_snapshot", "changelog_rotate", "receipt_compaction",
    }


def test_changelog_rotation_and_receipt_compaction_jobs_are_real(chronos, monkeypatch):
    chronos.changelog_path.parent.mkdir(parents=True, exist_ok=True)
    chronos.changelog_path.write_bytes(b"x" * 16)
    monkeypatch.setattr(chronos_module, "CHANGELOG_ROTATE_BYTES", 8)
    out = asyncio.run(chronos_module._job_changelog_rotate(chronos))
    assert out["rotated"] is True
    assert chronos.changelog_path.with_name("changelog.txt.1").exists()
    chronos._record_run({"run_id": "old", "job": "x", "trigger": "manual", "started_at": "2000-01-01T00:00:00+00:00",
                         "ended_at": "2000-01-01T00:00:01+00:00", "status": "succeeded"})
    compaction = asyncio.run(chronos_module._job_receipt_compaction(chronos))
    assert compaction["deleted_receipts"] == 1


def test_dry_run_without_job_reports_pipeline_held(chronos, monkeypatch):
    monkeypatch.setattr(night_shift, "assert_action_authorized", lambda *_a, **_k: None)
    response = asyncio.run(night_shift.trigger_night_shift(night_shift.TriggerRequest(dry_run=True), object()))
    assert response.triggered is False
    assert response.would_execute is False
    assert response.reason == "pipeline_held"
    assert "would execute but" not in response.message


def test_trigger_safe_job_runs_and_unknown_job_is_rejected(chronos, fake_jobs, monkeypatch):
    monkeypatch.setattr(night_shift, "assert_action_authorized", lambda *_a, **_k: None)
    dry = asyncio.run(night_shift.trigger_night_shift(night_shift.TriggerRequest(dry_run=True, job="ok_job"), object()))
    assert dry.would_execute is True and dry.runs is None
    assert chronos.recent_runs(5) == []
    ran = asyncio.run(night_shift.trigger_night_shift(night_shift.TriggerRequest(job="ok_job"), object()))
    assert ran.triggered is True and ran.runs[0]["status"] == "succeeded"
    with pytest.raises(HTTPException) as unknown:
        asyncio.run(night_shift.trigger_night_shift(night_shift.TriggerRequest(job="materialize_skill"), object()))
    assert unknown.value.status_code == 400


def test_legacy_pipeline_non_dry_still_503(chronos, monkeypatch):
    monkeypatch.setattr(night_shift, "assert_action_authorized", lambda *_a, **_k: None)
    with pytest.raises(HTTPException) as held:
        asyncio.run(night_shift.trigger_night_shift(night_shift.TriggerRequest(dry_run=False), object()))
    assert held.value.status_code == 503


def test_trigger_request_rejects_non_boolean_dry_run():
    with pytest.raises(Exception):
        night_shift.TriggerRequest(dry_run="yes")


def test_next_fire_time_is_strictly_in_the_future(monkeypatch):
    monkeypatch.setenv("CORTEX_CHRONOS_RUN_AT", "03:00")
    before = datetime(2026, 10, 10, 2, 59, 30)
    after = datetime(2026, 10, 10, 3, 0, 30)
    assert chronos_module.next_fire_time(before) == datetime(2026, 10, 10, 3, 0)
    assert chronos_module.next_fire_time(after) == datetime(2026, 10, 11, 3, 0)


def test_chronos_adapter_is_read_only_view(chronos, fake_jobs):
    out = asyncio.run(chronos_adapter.run("when does maintenance run?", {}))
    assert out["operation"] == "chronos.schedule_view"
    assert out["origin"] == "deterministic"
    assert len(out["summary"]) <= 1500
    assert "nightly_evolution_pipeline" in out["data"]["held_pipelines"]
    assert chronos.recent_runs(5) == []
