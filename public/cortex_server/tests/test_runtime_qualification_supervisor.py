from __future__ import annotations

import json
import os
from pathlib import Path

from cortex_server.benchmarks import runtime_qualification_supervisor as supervisor


def test_artifact_write_stays_in_held_directory_when_component_is_swapped(monkeypatch, tmp_path):
    """A checked directory replaced by a symlink cannot redirect the commit."""
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    root = tmp_path / "artifacts" / "qualification" / date
    target_dir = root / "baseline"
    target_dir.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    parked = root / "baseline-parked"
    real_replace = os.replace
    swapped = False

    def racing_replace(src, dst, *args, **kwargs):
        nonlocal swapped
        if kwargs.get("dst_dir_fd") is not None and dst == "result.json" and not swapped:
            target_dir.rename(parked)
            target_dir.symlink_to(outside, target_is_directory=True)
            swapped = True
        return real_replace(src, dst, *args, **kwargs)

    monkeypatch.setattr(supervisor.os, "replace", racing_replace)
    with supervisor.qualification_process_lock(date):
        supervisor._json_dump(target_dir / "result.json", {"confined": True})

    assert swapped is True
    assert not (outside / "result.json").exists()
    assert json.loads((parked / "result.json").read_text(encoding="utf-8")) == {"confined": True}


def test_finalize_promotes_only_run_private_output_over_concurrent_canonical_write(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    stage = "baseline"
    run_id = "owned-run"
    root = tmp_path / "artifacts" / "qualification" / date
    run_output = root / "_runs" / stage / run_id / "output"
    run_output.mkdir(parents=True)
    owned = _benchmark(stage)
    owned["summary"]["total_runs"] = 17
    (run_output / "baseline.benchmark.json").write_text(json.dumps(owned), encoding="utf-8")

    canonical = root / "baseline" / "baseline.benchmark.json"
    canonical.parent.mkdir(parents=True)
    stale_report = canonical.parent / "baseline_report.md"
    stale_report.write_text("stale report from another run", encoding="utf-8")
    forged = _benchmark(stage)
    forged["summary"]["total_runs"] = 999
    canonical.write_text(json.dumps(forged), encoding="utf-8")

    with supervisor.qualification_process_lock(date):
        supervisor._finalize_run_artifact(
            date, stage, run_id, "2026-04-01T00:00:00Z", 0,
            supervisor.stage_command(date, stage, run_id=run_id),
            root / "_runs" / stage / run_id / "stdout.txt",
            root / "_runs" / stage / run_id / "stderr.txt",
        )

    promoted = json.loads(canonical.read_text(encoding="utf-8"))
    assert promoted["summary"]["total_runs"] == 17
    assert promoted["run_id"] == run_id
    assert run_id in stale_report.read_text(encoding="utf-8")
    assert promoted["supervisor_artifacts"][str(stale_report)]["sha256"] == supervisor.hashlib.sha256(stale_report.read_bytes()).hexdigest()
    assert any(part.startswith(str(run_output)) for part in supervisor.stage_command(date, stage, run_id=run_id))


def test_soak_companion_changed_after_promotion_is_rejected(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date, stage, run_id = "2026-04-01", "soak_run_1", "owned-soak"
    root = tmp_path / "artifacts" / "qualification" / date
    output = root / "_runs" / stage / run_id / "output"
    output.mkdir(parents=True)
    (output / f"{stage}.json").write_text(json.dumps(_soak(stage, run_id=run_id)), encoding="utf-8")
    (output / f"{stage}.md").write_text("# current soak\n", encoding="utf-8")
    command = supervisor.stage_command(date, stage, run_id=run_id)
    marker = root / "_runs" / stage / run_id / "exit_code.txt"

    with supervisor.qualification_process_lock(date):
        supervisor._finalize_run_artifact(date, stage, run_id, "2026-04-01T00:00:00Z", 0, command,
                                          marker.parent / "stdout.txt", marker.parent / "stderr.txt")
        supervisor._atomic_write_json_marker(marker, {
            "schema_version": "cortex.runtime.qualification.exit.v1", "date": date, "stage": stage,
            "run_id": run_id, "exit_code": 0, "execution_mode": "synchronous",
            "command_sha256": supervisor._command_sha256(command),
        })
    run = _successful_run(stage, run_id)
    assert supervisor.verify_stage(date, stage, expected_run=run)["complete"] is True

    (root / f"{stage}.md").write_text("# stale replacement\n", encoding="utf-8")
    assert supervisor.verify_stage(date, stage, expected_run=run)["complete"] is False


def test_finalize_does_not_stamp_canonical_when_private_output_is_missing(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    stage = "final_rerun"
    run_id = "empty-run"
    root = tmp_path / "artifacts" / "qualification" / date
    (root / "_runs" / stage / run_id).mkdir(parents=True)
    canonical = root / "final" / "final.benchmark.json"
    canonical.parent.mkdir(parents=True)
    forged = _benchmark(stage)
    canonical.write_text(json.dumps(forged), encoding="utf-8")

    with supervisor.qualification_process_lock(date):
        supervisor._finalize_run_artifact(
            date, stage, run_id, "2026-04-01T00:00:00Z", 0,
            supervisor.stage_command(date, stage, run_id=run_id),
            root / "_runs" / stage / run_id / "stdout.txt",
            root / "_runs" / stage / run_id / "stderr.txt",
        )

    assert "run_id" not in json.loads(canonical.read_text(encoding="utf-8")) or json.loads(canonical.read_text(encoding="utf-8"))["run_id"] != run_id


def test_private_run_directory_must_be_created_exclusively(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    run_dir = tmp_path / "artifacts" / "qualification" / date / "_runs" / "baseline" / "guessed-run"
    run_dir.mkdir(parents=True)

    try:
        with supervisor.qualification_process_lock(date):
            supervisor._artifact_mkdir(run_dir, exist_ok=False)
    except FileExistsError:
        pass
    else:
        raise AssertionError("pre-positioned run directory was accepted")


def _patch_repo(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(supervisor, "repo_root", lambda: tmp_path)


def _identity(stage: str, *, run_id: str | None = None, soak: bool = False) -> dict:
    return {
        "run_id": run_id or f"fixture-{stage}",
        "stage": stage,
        "date": "2026-04-01",
        "started_at": "2026-04-01T00:00:00Z",
        "finished_at": "2026-04-01T00:30:00Z" if soak else "2026-04-01T00:00:01Z",
        "returncode": 0,
        "successful_exit": True,
    }


def _successful_run(stage: str, run_id: str | None = None) -> dict:
    bound_run_id = run_id or f"fixture-{stage}"
    return {
        "run_id": bound_run_id, "stage": stage, "status": "succeeded",
        "exit_code": 0, "exit_observed_by_supervisor": True,
        "command_sha256": supervisor._command_sha256(supervisor.stage_command("2026-04-01", stage, run_id=bound_run_id)),
    }


def _benchmark(stage: str, *, failure_rate: float = 0.0) -> dict:
    return {
        "schema_version": "cortex.kernel_v2.benchmark_results.v2",
        "corpus": {"case_count": 1, "iterations": 1},
        "summary": {"total_runs": 1, "passed_runs": 1, "failed_runs": 0, "failure_rate": failure_rate,
                    "trace_metrics": {}, "operator_metrics": {}, "drift": {}},
        "cases": [{"case_id": "case_0", "iteration": 1, "passed": True}],
        **_identity(stage),
    }


def _experiments(count: int = 6) -> list[dict]:
    return [{"id": f"exp_{idx}", "description": f"configuration {idx}", "returncode": 0, "duration_ms": 1.0, "warning_summary": {},
             "failure_rate": 0.0, "trace_p95_ms": 1.0, "trace_drift_delta_ms": 0.0,
             "runtime_pressure": {"mode": "test"}} for idx in range(count)]


def _soak(stage: str, *, run_id: str | None = None, count: int = 2) -> dict:
    return {
        "schema_version": "cortex.runtime.qualification.soak.v1",
        "duration_seconds": 1800,
        "round_count": count,
        "rounds": [
            {"round": idx + 1, "total_runs": 3, "failure_rate": 0.0,
             "trace_latency_p95_ms": 10.0, "operator_latency_p95_ms": 5.0,
             "trace_drift_delta_ms": 0.0}
            for idx in range(count)
        ],
        "summary": {"avg_trace_p95_ms": 10.0, "avg_trace_drift_delta_ms": 0.0},
        **_identity(stage, run_id=run_id, soak=True),
    }


def _tuning(stage: str, candidate: str = "candidate") -> dict:
    return {
        "schema_version": "cortex.runtime.qualification.tuning.v1", "stage": stage, "date": "2026-04-01",
        "experiments": [{
            "experiment_id": f"{stage}-experiment", "candidate_id": candidate,
            "configuration": {"mode": "test"}, "metrics": {"failure_rate": 0.1, "trace_p95_ms": 1.0},
        }],
        "decision": {"selected_candidate_id": candidate, "rationale": "lowest bounded failure rate"},
    }


def _validation(date: str = "2026-04-01", run_id: str = "fixture-validation") -> dict:
    run_dir = supervisor.qualification_root(date) / "_runs" / "validation" / run_id
    return {
        "schema_version": "cortex.runtime.qualification.validation.v1",
        "date": date,
        "stage": "validation",
        "run_id": run_id,
        "returncode": 0,
        "command": supervisor.stage_command(date, "validation", run_id=run_id),
        "stdout_path": str(run_dir / "stdout.txt"),
        "stderr_path": str(run_dir / "stderr.txt"),
        "stdout_tail": "995 passed",
        "stderr_tail": "",
        "started_at": "2026-04-01T00:00:00Z",
        "finished_at": "2026-04-01T00:00:01Z",
        "successful_exit": True,
    }


def _final_report(date: str) -> str:
    claims = []
    for stage in supervisor.STAGE_ORDER[:-1]:
        claim = {"stage": stage, "completed": True, "artifacts": supervisor._stage_specs(date)[stage].required_artifacts}
        if stage in supervisor.AUTO_RUN_STAGES:
            claim["run_id"] = f"fixture-{stage}"
        claims.append(claim)
    metadata = {"schema_version": "cortex.runtime.qualification.final_report.v1", "date": date, "run_id": "fixture-program-run", "stages": claims}
    return f"# Runtime Qualification {date}\n\n```json\n{json.dumps(metadata)}\n```\n"


def _persist_successful_runs(date: str) -> None:
    state = supervisor.build_initial_state(date)
    for stage in supervisor.AUTO_RUN_STAGES:
        run = _successful_run(stage)
        state["stages"][stage]["supervisor_run"] = run
        marker = supervisor.qualification_root(date) / "_runs" / stage / run["run_id"] / "exit_code.txt"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(json.dumps({
            "schema_version": "cortex.runtime.qualification.exit.v1",
            "date": date, "stage": stage, "run_id": run["run_id"], "exit_code": 0,
            "execution_mode": "synchronous", "command_sha256": run["command_sha256"],
        }), encoding="utf-8")
        required = [Path(name) for name in supervisor._stage_specs(date)[stage].required_artifacts]
        if len(required) > 1 and all(item.is_file() for item in required):
            payload = json.loads(required[0].read_text(encoding="utf-8"))
            payload["supervisor_artifacts"] = {
                str(required[0]): {"role": "run_commit"},
                **{
                    str(item): {"size": item.stat().st_size, "sha256": supervisor.hashlib.sha256(item.read_bytes()).hexdigest()}
                    for item in required[1:]
                },
            }
            required[0].write_text(json.dumps(payload), encoding="utf-8")
    supervisor.save_state(date, state)


def test_supervisor_verifies_corpus_and_experiments_and_sets_next_stage(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    corpus_path = tmp_path / "benchmarks" / "cortex_runtime_qualification_corpus_2026-04-01.json"
    corpus_path.parent.mkdir(parents=True, exist_ok=True)
    corpus_path.write_text(json.dumps({"cases": [{"id": f"case_{idx}"} for idx in range(32)]}), encoding="utf-8")

    exp_dir = tmp_path / "artifacts" / "qualification" / "2026-04-01" / "experiments"
    exp_dir.mkdir(parents=True, exist_ok=True)
    (exp_dir / "index.json").write_text(
        json.dumps({"experiments": _experiments(), "winner": "exp_0", **_identity("experiments")}),
        encoding="utf-8",
    )

    corpus = supervisor.verify_stage("2026-04-01", "corpus")
    _persist_successful_runs("2026-04-01")
    experiments = supervisor.verify_stage("2026-04-01", "experiments", expected_run=_successful_run("experiments"))
    assert corpus["complete"] is True
    assert corpus["details"]["case_count"] == 32
    assert experiments["complete"] is True
    assert experiments["details"]["experiment_count"] == 6

    state = supervisor.reconcile_state("2026-04-01")
    assert state["stages"]["corpus"]["completed"] is True
    assert state["stages"]["experiments"]["completed"] is True
    assert state["next_stage"] == "baseline"
    assert state["all_complete"] is False


def test_supervisor_reconciles_completed_background_soak(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    root = tmp_path / "artifacts" / "qualification" / date
    run_id = "fixture-soak-run-2"
    run_dir = root / "_runs" / "soak_run_2" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    exit_code_path = run_dir / "exit_code.txt"
    identity = {
        "schema_version": "cortex.runtime.process_identity.v1",
        "start_time": "123", "executable": {"target": "/usr/bin/python3", "device": 8, "inode": 99},
        "cmdline_sha256": "a" * 64,
    }
    exit_code_path.write_text(json.dumps({
        "schema_version": "cortex.runtime.qualification.exit.v1", "date": date,
        "stage": "soak_run_2", "run_id": run_id, "exit_code": 0,
        "process_id": 999999, "process_start_time": identity["start_time"],
        "process_identity": identity,
    }), encoding="utf-8")

    (root / "soak_run_2.md").write_text("# soak\n", encoding="utf-8")
    soak_payload = _soak("soak_run_2", run_id=run_id)
    soak_payload["supervisor_artifacts"] = {
        str(root / "soak_run_2.json"): {"role": "run_commit"},
        str(root / "soak_run_2.md"): {"size": 7, "sha256": supervisor.hashlib.sha256(b"# soak\n").hexdigest()},
    }
    (root / "soak_run_2.json").write_text(json.dumps(soak_payload), encoding="utf-8")

    state = supervisor.build_initial_state(date)
    state["active_process"] = {
        "stage": "soak_run_2",
        "run_id": run_id,
        "pid": 999999,
        "started_at": "2026-04-01T00:00:00Z",
        "exit_code_path": str(exit_code_path),
        "process_identity": identity,
    }
    supervisor.save_state(date, state)

    reconciled = supervisor.reconcile_state(date)
    assert reconciled["active_process"] is None
    assert reconciled["stages"]["soak_run_2"]["completed"] is True
    assert reconciled["stages"]["soak_run_2"]["status"] == "complete"


def test_supervisor_clears_dead_wrapper_without_exit_marker(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    run_id = "dead-wrapper"
    root = tmp_path / "artifacts" / "qualification" / date
    exit_path = root / "_runs" / "baseline" / run_id / "exit_code.txt"
    exit_path.parent.mkdir(parents=True)
    identity = {
        "schema_version": "cortex.runtime.process_identity.v1",
        "start_time": "123", "executable": {"target": "/usr/bin/python3", "device": 8, "inode": 99},
        "cmdline_sha256": "a" * 64,
    }
    state = supervisor.build_initial_state(date)
    state["active_process"] = {
        "stage": "baseline", "run_id": run_id, "pid": 999999,
        "started_at": "2026-04-01T00:00:00Z", "exit_code_path": str(exit_path),
        "process_identity": identity,
    }
    supervisor.save_state(date, state)
    monkeypatch.setattr(supervisor, "_process_identity", lambda pid: {})
    monkeypatch.setattr(supervisor, "_proc_pid_exists", lambda pid: False)

    assert supervisor.reconcile_active_process(date) is None
    reconciled = supervisor.load_or_create_state(date)
    assert reconciled["active_process"] is None
    run = reconciled["stages"]["baseline"]["supervisor_run"]
    assert run["status"] == "failed"
    assert run["reason"] == "process_dead_without_valid_exit_marker"


def test_supervisor_retains_wrapper_when_proc_identity_read_is_ambiguous(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    state = supervisor.build_initial_state(date)
    identity = {
        "schema_version": "cortex.runtime.process_identity.v1",
        "start_time": "123", "executable": {"target": "/usr/bin/python3", "device": 8, "inode": 99},
        "cmdline_sha256": "a" * 64,
    }
    state["active_process"] = {
        "stage": "baseline", "run_id": "ambiguous", "pid": 999998,
        "started_at": "2026-04-01T00:00:00Z",
        "exit_code_path": str(tmp_path / "artifacts" / "qualification" / date / "_runs" / "baseline" / "ambiguous" / "exit_code.txt"),
        "process_identity": identity,
    }
    supervisor.save_state(date, state)
    monkeypatch.setattr(supervisor, "_process_identity", lambda pid: {})
    monkeypatch.setattr(supervisor, "_proc_pid_exists", lambda pid: True)

    active = supervisor.reconcile_active_process(date)
    assert active is not None
    assert active["recovery_error"] == "process_identity_unavailable"


def test_supervisor_stage_spec_exposes_auto_runnable_commands(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    payload = supervisor.stage_spec_view("2026-04-01")
    stages = {row["stage"]: row for row in payload["stages"]}
    assert stages["baseline"]["auto_runnable"] is True
    assert stages["baseline"]["command"][0].endswith("python") or stages["baseline"]["command"][0].endswith("python3")
    assert stages["soak_run_1"]["soak"] is True
    assert stages["final_report"]["auto_runnable"] is False


def test_supervisor_builds_completion_summary_and_notification_state(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    root = tmp_path / "artifacts" / "qualification" / date
    (tmp_path / "benchmarks").mkdir(parents=True, exist_ok=True)
    (tmp_path / "docs").mkdir(parents=True, exist_ok=True)

    (tmp_path / "benchmarks" / f"cortex_runtime_qualification_corpus_{date}.json").write_text(
        json.dumps({"cases": [{"id": f"case_{idx}"} for idx in range(32)]}), encoding="utf-8"
    )
    (root / "baseline").mkdir(parents=True, exist_ok=True)
    (root / "baseline" / "baseline.benchmark.json").write_text(
        json.dumps(_benchmark("baseline")),
        encoding="utf-8",
    )
    (root / "baseline" / "baseline_report.md").write_text("baseline", encoding="utf-8")
    (root / "experiments").mkdir(parents=True, exist_ok=True)
    (root / "experiments" / "index.json").write_text(
        json.dumps({"winner": "exp_0", "experiments": _experiments(7), **_identity("experiments")}), encoding="utf-8"
    )
    for loop in ("tuning_loop_a", "tuning_loop_b"):
        (root / loop).mkdir(parents=True, exist_ok=True)
        (root / loop / f"{'loop_a' if loop.endswith('a') else 'loop_b'}_summary.json").write_text(
            json.dumps(_tuning(loop)), encoding="utf-8"
        )
    for idx in (1, 2, 3):
        (root / f"soak_run_{idx}.json").write_text(
            json.dumps(_soak(f"soak_run_{idx}")),
            encoding="utf-8",
        )
        (root / f"soak_run_{idx}.md").write_text("soak", encoding="utf-8")
    (root / "soak_summary.json").write_text(
        json.dumps({"run_count": 3, "aggregate": {"avg_trace_p95_ms": 252.0, "max_trace_p95_ms": 253.0, "avg_trace_drift_delta_ms": 7.0}}),
        encoding="utf-8",
    )
    (root / "final").mkdir(parents=True, exist_ok=True)
    (root / "final" / "final.benchmark.json").write_text(
        json.dumps(_benchmark("final_rerun")),
        encoding="utf-8",
    )
    (root / "validation").mkdir(parents=True, exist_ok=True)
    (root / "validation" / "validation_summary.json").write_text(
        json.dumps(_validation(date)), encoding="utf-8"
    )
    (tmp_path / "docs" / f"CORTEX_RUNTIME_QUALIFICATION_FINAL_REPORT_{date}.md").write_text(
        _final_report(date),
        encoding="utf-8",
    )

    _persist_successful_runs(date)

    state = supervisor.reconcile_state(date)
    assert state["all_complete"] is True

    summary = supervisor.build_completion_summary(date)
    assert summary["all_complete"] is True
    assert summary["summary"]["winner"] == "exp_0"
    assert (root / "completion_summary.json").exists()

    notification = supervisor.notification_state(date)
    assert notification["notified"] is False
    marked = supervisor.mark_notified(date, note="delivered")
    assert marked["notified"] is True
    assert marked["notify_count"] == 1


def test_supervisor_wait_for_completion_returns_summary(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    root = tmp_path / "artifacts" / "qualification" / date
    (tmp_path / "benchmarks").mkdir(parents=True, exist_ok=True)
    (tmp_path / "docs").mkdir(parents=True, exist_ok=True)
    (tmp_path / "benchmarks" / f"cortex_runtime_qualification_corpus_{date}.json").write_text(json.dumps({"cases": [{"id": f"case_{idx}"} for idx in range(30)]}), encoding="utf-8")
    (root / "baseline").mkdir(parents=True, exist_ok=True)
    (root / "baseline" / "baseline.benchmark.json").write_text(json.dumps(_benchmark("baseline")), encoding="utf-8")
    (root / "baseline" / "baseline_report.md").write_text("baseline", encoding="utf-8")
    (root / "experiments").mkdir(parents=True, exist_ok=True)
    (root / "experiments" / "index.json").write_text(json.dumps({"winner": "exp_0", "experiments": _experiments(), **_identity("experiments")}), encoding="utf-8")
    for loop in ("tuning_loop_a", "tuning_loop_b"):
        (root / loop).mkdir(parents=True, exist_ok=True)
        (root / loop / f"{'loop_a' if loop.endswith('a') else 'loop_b'}_summary.json").write_text(
            json.dumps(_tuning(loop, "cfg")), encoding="utf-8"
        )
    for idx in (1, 2, 3):
        (root / f"soak_run_{idx}.json").write_text(json.dumps(_soak(f"soak_run_{idx}")), encoding="utf-8")
        (root / f"soak_run_{idx}.md").write_text("soak", encoding="utf-8")
    (root / "final").mkdir(parents=True, exist_ok=True)
    (root / "final" / "final.benchmark.json").write_text(json.dumps(_benchmark("final_rerun")), encoding="utf-8")
    (root / "validation").mkdir(parents=True, exist_ok=True)
    (root / "validation" / "validation_summary.json").write_text(json.dumps(_validation(date)), encoding="utf-8")
    (tmp_path / "docs" / f"CORTEX_RUNTIME_QUALIFICATION_FINAL_REPORT_{date}.md").write_text(
        _final_report(date),
        encoding="utf-8",
    )

    _persist_successful_runs(date)

    payload = supervisor.wait_for_completion(date, timeout_seconds=1, interval_seconds=1, mark_complete_notification=True)
    assert payload["all_complete"] is True
    assert payload["completion_summary"]["all_complete"] is True
    assert payload["notification"]["notified"] is True
