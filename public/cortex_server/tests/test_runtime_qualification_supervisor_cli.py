from __future__ import annotations

from contextlib import nullcontext
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import threading

import pytest

from cortex_server.benchmarks import runtime_qualification_supervisor as supervisor


DATE = "2026-04-01"
SCRIPT = Path(__file__).parents[1] / "scripts" / "run_runtime_qualification_supervisor.py"


def _load_cli():
    spec = importlib.util.spec_from_file_location("runtime_qualification_supervisor_cli", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _identity() -> dict:
    return {
        "schema_version": "cortex.runtime.process_identity.v1",
        "start_time": "777",
        "executable": {"target": "/usr/bin/python3", "device": 8, "inode": 99},
        "cmdline_sha256": "a" * 64,
    }


def _active(identity: dict, *, pid: int = 4242, run_id: str = "run-strong") -> dict:
    return {
        "stage": "baseline",
        "pid": pid,
        "run_id": run_id,
        "started_at": "2026-04-01T00:00:00Z",
        "command": ["caller-visible", "display-only"],
        "stdout_path": "/tmp/stdout",
        "stderr_path": "/tmp/stderr",
        "exit_code_path": "/tmp/exit-code",
        "process_identity": identity,
    }


def test_cli_keeps_descriptor_confined_writer_during_directory_swap(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    original_json_dump = supervisor._json_dump
    cli = _load_cli()
    assert supervisor._json_dump is original_json_dump

    monkeypatch.setattr(supervisor, "repo_root", lambda: tmp_path)
    date_root = tmp_path / "artifacts" / "qualification" / DATE
    target_dir = date_root / "baseline"
    target_dir.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    parked = date_root / "baseline-parked"
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
    with supervisor.qualification_process_lock(DATE):
        supervisor._json_dump(target_dir / "result.json", {"confined": True})

    assert swapped is True
    assert not (outside / "result.json").exists()
    assert json.loads((parked / "result.json").read_text(encoding="utf-8")) == {"confined": True}


def test_background_cli_preserves_supervisor_identity_and_fails_closed_on_mismatch(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cli = _load_cli()
    monkeypatch.setattr(supervisor, "repo_root", lambda: tmp_path)
    monkeypatch.setattr(cli, "_qualification_root", lambda _date: tmp_path)
    monkeypatch.setattr(cli, "_process_lock", lambda _date: nullcontext())

    identity = _identity()
    active = _active(identity)
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = active
    state["stages"]["baseline"]["status"] = "running"
    state["stages"]["baseline"]["supervisor_run"] = {
        "run_id": active["run_id"], "stage": "baseline", "status": "running",
        "started_at": active["started_at"], "exit_code": None,
        "exit_observed_by_supervisor": False,
    }
    supervisor.save_state(DATE, state)
    state_path = supervisor.state_path(DATE)
    original_bytes = state_path.read_bytes()

    result = {"launched": True, "background": True, "active_process": active}
    monkeypatch.setattr(supervisor, "launch_stage", lambda *_args, **_kwargs: result)

    assert cli.main(["--date", DATE, "run-stage", "--stage", "baseline", "--background"]) == 0
    assert json.loads(capsys.readouterr().out) == result
    assert state_path.read_bytes() == original_bytes

    # The unchanged strong identity is accepted by ordinary reconciliation.
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: dict(identity))
    reconciled = supervisor.reconcile_state(DATE)
    assert reconciled["active_process"]["process_identity"] == identity
    assert reconciled["active_process"]["alive"] is True

    # A launch response for a different owner fails without rewriting state.
    before_mismatch = state_path.read_bytes()
    mismatched = {"launched": True, "background": True, "active_process": _active(identity, pid=9999)}
    monkeypatch.setattr(supervisor, "launch_stage", lambda *_args, **_kwargs: mismatched)
    with pytest.raises(RuntimeError, match="does not match persisted active process"):
        cli.main(["--date", DATE, "run-stage", "--stage", "baseline", "--background"])
    assert state_path.read_bytes() == before_mismatch


def test_foreground_run_stage_does_not_block_concurrent_cli_status(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    cli = _load_cli()
    monkeypatch.setattr(supervisor, "repo_root", lambda: tmp_path)
    monkeypatch.setattr(cli, "_qualification_root", lambda _date: tmp_path)
    monkeypatch.setattr(cli, "_print", lambda _payload: None)
    launch_waiting = threading.Event()
    release_launch = threading.Event()
    status_completed = threading.Event()

    def foreground_launch(_date: str, _stage: str, *, background: bool = False) -> dict:
        assert background is False
        launch_waiting.set()
        assert release_launch.wait(timeout=5)
        return {"launched": True, "background": False, "returncode": 0, "stage": "baseline"}

    def status_summary(_date: str) -> dict:
        status_completed.set()
        return {"all_complete": False}

    monkeypatch.setattr(supervisor, "launch_stage", foreground_launch)
    monkeypatch.setattr(supervisor, "stage_status_summary", status_summary)

    with ThreadPoolExecutor(max_workers=2) as executor:
        foreground = executor.submit(
            cli.main, ["--date", DATE, "run-stage", "--stage", "baseline"]
        )
        assert launch_waiting.wait(timeout=5)
        status = executor.submit(cli.main, ["--date", DATE, "status"])
        status_was_concurrent = status_completed.wait(timeout=2)
        release_launch.set()
        assert foreground.result(timeout=5) == 0
        assert status.result(timeout=5) == 0

    assert status_was_concurrent is True
