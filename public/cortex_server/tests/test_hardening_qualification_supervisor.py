from __future__ import annotations

import json
import multiprocessing
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from cortex_server.benchmarks import runtime_qualification_supervisor as supervisor


DATE = "2026-04-01"


@pytest.fixture(autouse=True)
def isolated_repo(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.setattr(supervisor, "repo_root", lambda: tmp_path)
    return tmp_path


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def process_identity(*, start: str = "123", target: str = "/usr/bin/python3", device: int = 8,
                     inode: int = 99, cmdline_digest: str = "a" * 64) -> dict:
    return {
        "schema_version": "cortex.runtime.process_identity.v1",
        "start_time": start,
        "executable": {"target": target, "device": device, "inode": inode},
        "cmdline_sha256": cmdline_digest,
    }


def benchmark_payload(case_count: int = 2, iterations: int = 1) -> dict:
    total = case_count * iterations
    return {
        "schema_version": "cortex.kernel_v2.benchmark_results.v2",
        "corpus": {"case_count": case_count, "iterations": iterations},
        "summary": {
            "total_runs": total, "passed_runs": total, "failed_runs": 0, "failure_rate": 0.0,
            "trace_metrics": {}, "operator_metrics": {}, "drift": {},
        },
        "cases": [
            {"case_id": f"case-{index % case_count}", "iteration": index // case_count + 1, "passed": True}
            for index in range(total)
        ],
    }


def experiment_rows(count: int = 6) -> list[dict]:
    return [
        {
            "id": f"exp-{index}", "description": f"configuration {index}", "returncode": 0, "duration_ms": 1.0,
            "warning_summary": {}, "failure_rate": 0.0, "trace_p95_ms": 1.0,
            "trace_drift_delta_ms": 0.0, "runtime_pressure": {"mode": "test"},
        }
        for index in range(count)
    ]


def test_dates_are_strict_calendar_dates_before_any_path_is_constructed(tmp_path: Path) -> None:
    assert supervisor.qualification_root("2024-02-29") == tmp_path / "artifacts" / "qualification" / "2024-02-29"

    for hostile in ("../escape", "2026-02-29", "2026-2-03", "2026-01-01/../../escape", "", " 2026-01-01"):
        with pytest.raises((TypeError, ValueError)):
            supervisor.qualification_root(hostile)

    assert not (tmp_path / "artifacts" / "escape").exists()


def test_every_stage_artifact_path_is_confined_to_an_expected_root(tmp_path: Path) -> None:
    qualification = supervisor.qualification_root(DATE).resolve()
    allowed_external = {supervisor.corpus_path(DATE).resolve(), (tmp_path / "docs" / f"CORTEX_RUNTIME_QUALIFICATION_FINAL_REPORT_{DATE}.md").resolve()}

    for row in supervisor.stage_spec_view(DATE)["stages"]:
        for raw_path in row["required_artifacts"]:
            path = Path(raw_path).resolve()
            assert path in allowed_external or path.is_relative_to(qualification)


def test_qualification_artifacts_reject_symlinked_parent_before_read_or_write(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    root.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    write_json(outside / "index.json", {"experiments": experiment_rows(), "winner": "exp-0"})
    (root / "experiments").symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="symlink"):
        supervisor.verify_stage(DATE, "experiments")
    with pytest.raises(ValueError, match="symlink"):
        supervisor.stage_command(DATE, "experiments")

    assert json.loads((outside / "index.json").read_text(encoding="utf-8"))["winner"] == "exp-0"


def test_qualification_artifacts_reject_symlinked_leaf_and_run_log_component(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    root.mkdir(parents=True)
    outside_state = tmp_path / "outside-state.json"
    outside_state.write_text('{"sentinel": true}', encoding="utf-8")
    (root / "program_state.json").symlink_to(outside_state)

    with pytest.raises(ValueError, match="symlink"):
        supervisor.load_or_create_state(DATE)
    assert json.loads(outside_state.read_text(encoding="utf-8")) == {"sentinel": True}

    (root / "program_state.json").unlink()
    outside_runs = tmp_path / "outside-runs"
    outside_runs.mkdir()
    (root / "_runs").symlink_to(outside_runs, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        supervisor.qualification_artifact_path(DATE, "_runs", "baseline", "run-1", "stdout.txt")
    assert list(outside_runs.iterdir()) == []


@pytest.mark.parametrize(
    "mutate",
    [
        lambda state: state.update(schema_version="unknown"),
        lambda state: state.update(date="2026-04-02"),
        lambda state: state["stages"].pop("baseline"),
        lambda state: state["stages"]["baseline"].update(completed="false"),
        lambda state: state["stages"]["baseline"].update(status="complete-ish"),
        lambda state: state.update(active_process={"stage": "baseline", "pid": True}),
        lambda state: state.update(active_process={"stage": "baseline", "pid": 42, "process_identity": "forged"}),
    ],
)
def test_malformed_supervisor_state_is_rejected_without_rewrite(tmp_path: Path, mutate: object) -> None:
    state = supervisor.build_initial_state(DATE)
    mutate(state)  # type: ignore[operator]
    path = supervisor.state_path(DATE)
    write_json(path, state)
    original = path.read_bytes()

    with pytest.raises(ValueError, match="invalid runtime qualification supervisor state"):
        supervisor.load_or_create_state(DATE)

    assert path.read_bytes() == original


def test_invalid_active_process_never_enters_lifecycle_recovery(monkeypatch: pytest.MonkeyPatch) -> None:
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {"stage": "validation", "pid": [4242], "process_identity": {}}
    write_json(supervisor.state_path(DATE), state)
    observed: list[int] = []
    monkeypatch.setattr(supervisor, "_process_identity", lambda pid: observed.append(pid) or {})

    with pytest.raises(ValueError, match="invalid runtime qualification supervisor state"):
        supervisor.reconcile_active_process(DATE)

    assert observed == []


def test_concurrent_loaders_consistently_reject_truncated_state_without_rewrite() -> None:
    state = supervisor.build_initial_state(DATE)
    state["stages"] = {}
    path = supervisor.state_path(DATE)
    write_json(path, state)
    original = path.read_bytes()

    def load() -> str:
        try:
            supervisor.load_or_create_state(DATE)
        except ValueError as exc:
            return str(exc)
        return "accepted"

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: load(), range(32)))

    assert results == ["invalid runtime qualification supervisor state"] * 32
    assert path.read_bytes() == original


def test_malformed_or_empty_artifacts_fail_closed(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    write_json(supervisor.corpus_path(DATE), {"cases": "not-a-list"})
    write_json(root / "experiments" / "index.json", {"experiments": [{}, {}, {}, {}, {}, {}]})
    write_json(root / "baseline" / "baseline.benchmark.json", {})
    (root / "baseline" / "baseline_report.md").write_text("", encoding="utf-8")

    assert supervisor.verify_stage(DATE, "corpus")["complete"] is False
    assert supervisor.verify_stage(DATE, "experiments")["complete"] is False
    assert supervisor.verify_stage(DATE, "baseline")["complete"] is False


@pytest.mark.parametrize("round_count", [0, -1])
def test_soak_requires_substantive_rounds_and_honest_elapsed_duration(tmp_path: Path, round_count: int) -> None:
    root = supervisor.qualification_root(DATE)
    write_json(
        root / "soak_run_1.json",
        {
            "schema_version": "cortex.runtime.qualification.soak.v1",
            "stage": "soak_run_1",
            "date": DATE,
            "duration_seconds": 1800,
            "started_at": "2026-04-01T00:00:00Z",
            "finished_at": "2026-04-01T00:00:01Z",
            "round_count": round_count,
            "summary": {},
        },
    )
    (root / "soak_run_1.md").write_text("# claimed soak\n", encoding="utf-8")

    assert supervisor.verify_stage(DATE, "soak_run_1")["complete"] is False


def test_soak_rejects_placeholder_rounds_and_optionalized_identity(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    write_json(root / "soak_run_1.json", {
        "duration_seconds": 1800,
        "round_count": 1,
        "rounds": [{}],
        "started_at": "2026-04-01T00:00:00Z",
        "finished_at": "2026-04-01T00:30:00Z",
    })
    (root / "soak_run_1.md").write_text("# placeholder\n", encoding="utf-8")

    assert supervisor.verify_stage(DATE, "soak_run_1")["complete"] is False


def valid_soak_payload(duration_seconds: object) -> dict:
    return {
        "schema_version": "cortex.runtime.qualification.soak.v1",
        "run_id": "fixture-soak-run-1",
        "stage": "soak_run_1",
        "date": DATE,
        "duration_seconds": duration_seconds,
        "started_at": "2026-04-01T00:00:00Z",
        "finished_at": "2026-04-01T00:30:00Z",
        "returncode": 0,
        "successful_exit": True,
        "round_count": 1,
        "rounds": [{
            "round": 1,
            "total_runs": 1,
            "failure_rate": 0.0,
            "trace_latency_p95_ms": 1.0,
            "operator_latency_p95_ms": 1.0,
            "trace_drift_delta_ms": 0.0,
        }],
    }


@pytest.mark.parametrize(
    "duration_seconds",
    [
        True,
        False,
        None,
        "1800",
        [],
        {},
        -1,
        float("nan"),
        float("inf"),
        float("-inf"),
        10**4000,
    ],
)
def test_soak_duration_invalid_values_fail_closed(tmp_path: Path, duration_seconds: object) -> None:
    root = supervisor.qualification_root(DATE)
    write_json(root / "soak_run_1.json", valid_soak_payload(duration_seconds))
    (root / "soak_run_1.md").write_text("# soak\n", encoding="utf-8")

    result = supervisor.verify_stage(
        DATE,
        "soak_run_1",
        expected_run={
            "run_id": "fixture-soak-run-1",
            "stage": "soak_run_1",
            "status": "succeeded",
            "exit_code": 0,
            "exit_observed_by_supervisor": True,
        },
    )

    assert result["complete"] is False


@pytest.mark.parametrize("duration_seconds", [1800, 1800.0])
def test_soak_duration_accepts_compatible_json_numbers(tmp_path: Path, duration_seconds: object) -> None:
    root = supervisor.qualification_root(DATE)
    root.mkdir(parents=True, exist_ok=True)
    (root / "soak_run_1.md").write_text("# soak\n", encoding="utf-8")
    payload = valid_soak_payload(duration_seconds)
    payload["supervisor_artifacts"] = {
        str(root / "soak_run_1.json"): {"role": "run_commit"},
        str(root / "soak_run_1.md"): {"size": 7, "sha256": supervisor.hashlib.sha256(b"# soak\n").hexdigest()},
    }
    write_json(root / "soak_run_1.json", payload)

    command_digest = supervisor._command_sha256(supervisor.stage_command(DATE, "soak_run_1", run_id="fixture-soak-run-1"))
    write_json(root / "_runs" / "soak_run_1" / "fixture-soak-run-1" / "exit_code.txt", {
        "schema_version": "cortex.runtime.qualification.exit.v1", "date": DATE,
        "stage": "soak_run_1", "run_id": "fixture-soak-run-1", "exit_code": 0,
        "execution_mode": "synchronous", "command_sha256": command_digest,
    })
    result = supervisor.verify_stage(
        DATE,
        "soak_run_1",
        expected_run={
            "run_id": "fixture-soak-run-1",
            "stage": "soak_run_1",
            "status": "succeeded",
            "exit_code": 0,
            "exit_observed_by_supervisor": True,
            "command_sha256": command_digest,
        },
    )

    assert result["complete"] is True
    assert result["details"]["duration_seconds"] == 1800.0


@pytest.mark.parametrize(
    ("duration_seconds", "started_at", "finished_at", "expected"),
    [
        (1800.001, "2026-04-01T00:00:00Z", "2026-04-01T00:30:00Z", True),
        (1800.999, "2026-04-01T00:00:00Z", "2026-04-01T00:30:00Z", True),
        (1801.001, "2026-04-01T00:00:00Z", "2026-04-01T00:30:00Z", False),
        (1800.0, "2026-04-01T00:00:00Z", "2026-04-01T00:29:59Z", False),
        (1800.002, "2026-04-01T00:00:00.000Z", "2026-04-01T00:30:00.000Z", False),
        (1800.001, "2026-04-01T00:00:00.000Z", "2026-04-01T00:30:00.001Z", True),
    ],
)
def test_soak_duration_cross_check_respects_timestamp_precision(
    tmp_path: Path,
    duration_seconds: float,
    started_at: str,
    finished_at: str,
    expected: bool,
) -> None:
    root = supervisor.qualification_root(DATE)
    payload = valid_soak_payload(duration_seconds)
    payload.update({"started_at": started_at, "finished_at": finished_at})
    write_json(root / "soak_run_1.json", payload)
    (root / "soak_run_1.md").write_text("# soak\n", encoding="utf-8")

    assert supervisor._verify_soak(DATE, "soak_run_1")["complete"] is expected


def test_zero_exit_without_output_cannot_rebind_stale_artifact(monkeypatch: pytest.MonkeyPatch) -> None:
    root = supervisor.qualification_root(DATE)
    stale = benchmark_payload()
    stale.update({
        "run_id": "old-run", "stage": "baseline", "date": DATE,
        "started_at": "2026-04-01T00:00:00Z", "finished_at": "2026-04-01T00:00:01Z",
        "returncode": 0, "successful_exit": True,
    })
    write_json(root / "baseline" / "baseline.benchmark.json", stale)
    (root / "baseline" / "baseline_report.md").write_text("old report", encoding="utf-8")
    class FakeProcess:
        pid = 4321
        returncode = 0

        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def communicate(self) -> tuple[str, str]:
            return "", ""

    monkeypatch.setattr(supervisor.subprocess, "Popen", FakeProcess)
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: process_identity())

    result = supervisor.launch_stage(DATE, "baseline")
    state = supervisor.load_or_create_state(DATE)
    artifact = json.loads((root / "baseline" / "baseline.benchmark.json").read_text(encoding="utf-8"))

    assert result["returncode"] == 0
    assert artifact["run_id"] == "old-run"
    assert state["stages"]["baseline"]["completed"] is False
    assert "supervisor-owned run" in state["stages"]["baseline"]["missing_artifacts"][0]


def test_failed_rerun_cannot_be_overwritten_by_stale_success_artifacts(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    write_json(root / "baseline" / "baseline.benchmark.json", {"summary": {"failure_rate": 0.0}})
    (root / "baseline" / "baseline_report.md").write_text("# old successful run\n", encoding="utf-8")
    exit_path = root / "_runs" / "baseline" / "failed-rerun" / "exit_code.txt"
    exit_path.parent.mkdir(parents=True)
    identity = process_identity()
    exit_path.write_text(json.dumps({
        "schema_version": "cortex.runtime.qualification.exit.v1", "date": DATE,
        "stage": "baseline", "run_id": "failed-rerun", "exit_code": 1,
        "process_id": 12345, "process_start_time": identity["start_time"],
        "process_identity": identity,
    }), encoding="utf-8")
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {
        "stage": "baseline",
        "pid": 12345,
        "run_id": "failed-rerun",
        "started_at": "2026-04-01T01:00:00Z",
        "exit_code_path": str(exit_path),
        "process_identity": identity,
    }
    supervisor.save_state(DATE, state)

    reconciled = supervisor.reconcile_state(DATE)

    assert reconciled["stages"]["baseline"]["status"] == "failed"
    assert reconciled["stages"]["baseline"]["completed"] is False

    reconciled_again = supervisor.reconcile_state(DATE)
    assert reconciled_again["stages"]["baseline"]["status"] == "failed"
    assert reconciled_again["stages"]["baseline"]["completed"] is False


def test_fabricated_auto_run_success_is_not_qualification_truth(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    write_json(root / "experiments" / "index.json", {
        "experiments": experiment_rows(), "winner": "exp-0",
        "run_id": "attacker", "stage": "experiments", "date": DATE,
        "started_at": "2026-04-01T00:00:00Z", "finished_at": "2026-04-01T00:00:01Z",
        "returncode": 0, "successful_exit": True,
    })

    result = supervisor.verify_stage(DATE, "experiments")

    assert result["complete"] is False
    assert "supervisor-owned run" in result["missing_artifacts"][0]


def test_nonempty_benchmark_placeholder_and_inconsistent_counts_are_rejected(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    report = root / "baseline" / "baseline_report.md"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text("baseline", encoding="utf-8")
    write_json(root / "baseline" / "baseline.benchmark.json", {"summary": {}})
    assert supervisor.verify_stage(DATE, "baseline")["complete"] is False

    corrupt = benchmark_payload()
    corrupt["summary"]["total_runs"] = 99
    write_json(root / "final" / "final.benchmark.json", corrupt)
    assert supervisor.verify_stage(DATE, "final_rerun")["complete"] is False


@pytest.mark.parametrize(
    "payload",
    [
        {"experiments": [{"anything": True} for _ in range(6)], "winner": "anything"},
        {"experiments": experiment_rows(), "winner": "not-an-experiment"},
        {"experiments": [*experiment_rows(5), {"id": "exp-5"}], "winner": "exp-0"},
    ],
)
def test_experiments_reject_arbitrary_results_and_unbound_winner(tmp_path: Path, payload: dict) -> None:
    write_json(supervisor.qualification_root(DATE) / "experiments" / "index.json", payload)
    assert supervisor.verify_stage(DATE, "experiments")["complete"] is False


@pytest.mark.parametrize("returncode", [1, -9])
def test_experiments_reject_any_failed_execution(returncode: int) -> None:
    rows = experiment_rows()
    rows[0]["returncode"] = returncode
    write_json(supervisor.qualification_root(DATE) / "experiments" / "index.json", {"experiments": rows, "winner": "exp-0"})

    assert supervisor._verify_experiments(DATE)["complete"] is False


@pytest.mark.parametrize(
    "passed_runs,failed_runs,failure_rate,case_passes",
    [
        (0, 2, 1.0, [False, False]),
        (1, 1, 0.5, [True, False]),
        (2, 0, 0.0, [True, False]),
        (2, 0, 0.5, [True, True]),
    ],
)
def test_benchmark_requires_all_runs_to_pass_and_summary_to_match_cases(
    passed_runs: int, failed_runs: int, failure_rate: float, case_passes: list[bool]
) -> None:
    payload = benchmark_payload()
    payload["summary"].update(
        passed_runs=passed_runs,
        failed_runs=failed_runs,
        failure_rate=failure_rate,
    )
    for case, passed in zip(payload["cases"], case_passes):
        case["passed"] = passed

    assert supervisor._benchmark_payload_valid(payload) is False


def test_background_launch_cleans_up_child_when_active_state_cannot_persist(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[object] = []

    class FakeProcess:
        pid = 4321

        def __init__(self, *_args: object, **_kwargs: object) -> None:
            events.append("popen")

        def terminate(self) -> None:
            events.append("terminate")

        def wait(self, timeout: float | None = None) -> int:
            events.append(("wait", timeout))
            return 0

    real_save = supervisor.save_state

    def failing_save(date: str, state: dict) -> None:
        if state.get("active_process"):
            raise OSError("state device full")
        real_save(date, state)

    monkeypatch.setattr(supervisor.subprocess, "Popen", FakeProcess)
    monkeypatch.setattr(supervisor, "_process_identity", lambda pid, command=None: process_identity())
    monkeypatch.setattr(supervisor.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(supervisor.os, "killpg", lambda pid, sig: events.append(("killpg", pid, sig)))
    monkeypatch.setattr(supervisor, "save_state", failing_save)

    with pytest.raises(OSError, match="device full"):
        supervisor.launch_stage(DATE, "baseline", background=True)

    assert events == ["popen", ("killpg", 4321, supervisor.signal.SIGTERM), ("wait", 5)]


def test_background_launch_cleans_up_group_when_identity_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[object] = []

    class FakeProcess:
        pid = 4321

        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def wait(self, timeout: float | None = None) -> int:
            events.append(("wait", timeout))
            return 0

    monkeypatch.setattr(supervisor.subprocess, "Popen", FakeProcess)
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: {})
    monkeypatch.setattr(supervisor.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(supervisor.os, "killpg", lambda pid, sig: events.append(("killpg", pid, sig)))

    with pytest.raises(RuntimeError, match="identity unavailable"):
        supervisor.launch_stage(DATE, "baseline", background=True)

    assert events == [("killpg", 4321, supervisor.signal.SIGTERM), ("wait", 5)]


def test_synchronous_launch_persists_owned_process_before_waiting(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[object] = []
    identity = process_identity()

    class FakeProcess:
        pid = 4321
        returncode = 0

        def __init__(self, *_args: object, **kwargs: object) -> None:
            assert kwargs["start_new_session"] is True
            events.append("popen")

        def communicate(self) -> tuple[str, str]:
            durable = supervisor.load_or_create_state(DATE)["active_process"]
            events.append(("communicate", durable["pid"], durable["process_identity"]))
            return "output", ""

    monkeypatch.setattr(supervisor.subprocess, "Popen", FakeProcess)
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: identity)

    result = supervisor.launch_stage(DATE, "validation")

    assert result["returncode"] == 0
    assert events == ["popen", ("communicate", 4321, identity)]
    assert supervisor.load_or_create_state(DATE)["active_process"] is None


def test_synchronous_launch_releases_lock_while_workload_runs_and_can_be_terminated(monkeypatch: pytest.MonkeyPatch) -> None:
    communicating = threading.Event()
    terminated = threading.Event()
    identity = process_identity()

    class FakeProcess:
        pid = 4321
        returncode = -supervisor.signal.SIGTERM

        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def communicate(self) -> tuple[str, str]:
            communicating.set()
            assert terminated.wait(timeout=5)
            return "partial output", "terminated"

    def signal_group(pid: int, expected: dict, sig: int) -> bool:
        assert (pid, expected, sig) == (4321, identity, supervisor.signal.SIGTERM)
        terminated.set()
        return True

    monkeypatch.setattr(supervisor.subprocess, "Popen", FakeProcess)
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: identity)
    monkeypatch.setattr(supervisor, "_signal_process_group", signal_group)

    with ThreadPoolExecutor(max_workers=1) as executor:
        launched = executor.submit(supervisor.launch_stage, DATE, "validation")
        assert communicating.wait(timeout=5)
        termination = supervisor.terminate_active_process(DATE)
        result = launched.result(timeout=5)

    assert termination == {"terminated": True, "pid": 4321, "stage": "validation"}
    assert result["returncode"] == -supervisor.signal.SIGTERM
    state = supervisor.load_or_create_state(DATE)
    assert state["active_process"] is None
    assert state["stages"]["validation"]["supervisor_run"]["status"] == "failed"


def test_synchronous_exit_refuses_to_commit_over_replaced_process_ownership(monkeypatch: pytest.MonkeyPatch) -> None:
    identity = process_identity()

    class FakeProcess:
        pid = 4321
        returncode = 0

        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def communicate(self) -> tuple[str, str]:
            state = supervisor.load_or_create_state(DATE)
            state["active_process"]["run_id"] = "replacement-run"
            supervisor.save_state(DATE, state)
            return "untrusted for replacement", ""

    monkeypatch.setattr(supervisor.subprocess, "Popen", FakeProcess)
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: identity)

    with pytest.raises(RuntimeError, match="ownership changed"):
        supervisor.launch_stage(DATE, "validation")

    state = supervisor.load_or_create_state(DATE)
    assert state["active_process"]["run_id"] == "replacement-run"
    run_dir = supervisor.qualification_root(DATE) / "_runs" / "validation"
    assert not list(run_dir.rglob("stdout.txt"))


def test_synchronous_launch_reaps_child_when_active_state_cannot_persist(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[object] = []

    class FakeProcess:
        pid = 4321

        def __init__(self, *_args: object, **_kwargs: object) -> None:
            events.append("popen")

        def communicate(self) -> tuple[str, str]:
            events.append("communicate")
            return "", ""

        def wait(self, timeout: float | None = None) -> int:
            events.append(("wait", timeout))
            return 0

    def failing_save(_date: str, state: dict) -> None:
        if state.get("active_process"):
            raise OSError("state device full")

    monkeypatch.setattr(supervisor.subprocess, "Popen", FakeProcess)
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: process_identity())
    monkeypatch.setattr(supervisor.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(supervisor.os, "killpg", lambda pid, sig: events.append(("killpg", pid, sig)))
    monkeypatch.setattr(supervisor, "save_state", failing_save)

    with pytest.raises(OSError, match="device full"):
        supervisor.launch_stage(DATE, "validation")

    assert events == ["popen", ("killpg", 4321, supervisor.signal.SIGTERM), ("wait", 5)]


@pytest.mark.parametrize("contents", ["[1, 2]", "{broken", "\udcff"])
def test_corrupt_json_artifacts_are_incomplete_with_reason(tmp_path: Path, contents: str) -> None:
    path = supervisor.qualification_root(DATE) / "experiments" / "index.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(contents.encode("utf-8", errors="surrogatepass"))

    result = supervisor.verify_stage(DATE, "experiments")

    assert result["complete"] is False
    assert result["details"]["reason"]


def test_manual_reports_require_substantive_stage_specific_schema(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    write_json(root / "tuning_loop_a" / "loop_a_summary.json", {})
    report = tmp_path / "docs" / f"CORTEX_RUNTIME_QUALIFICATION_FINAL_REPORT_{DATE}.md"
    report.parent.mkdir(parents=True)
    report.write_text("report", encoding="utf-8")

    assert supervisor.verify_stage(DATE, "tuning_loop_a")["complete"] is False
    assert supervisor.verify_stage(DATE, "final_report")["complete"] is False


@pytest.mark.parametrize(
    "payload",
    [
        {"stage": "tuning_loop_a", "date": DATE, "experiments": [{"anything": "nonempty"}], "decision": {"selected_candidate_id": "x"}},
        {"schema_version": "cortex.runtime.qualification.tuning.v1", "stage": "tuning_loop_a", "date": DATE,
         "experiments": [{"experiment_id": "e", "candidate_id": "c", "configuration": {"mode": "x"}, "metrics": {"failure_rate": float("nan")}}],
         "decision": {"selected_candidate_id": "c"}},
        {"schema_version": "cortex.runtime.qualification.tuning.v1", "stage": "tuning_loop_a", "date": DATE,
         "experiments": [{"experiment_id": "e", "candidate_id": "c", "configuration": {"mode": "x"}, "metrics": {"failure_rate": 0.1}}],
         "decision": {"selected_candidate_id": "unreported"}},
    ],
)
def test_tuning_reports_reject_plausible_but_unverifiable_payloads(payload: dict) -> None:
    path = supervisor.qualification_root(DATE) / "tuning_loop_a" / "loop_a_summary.json"
    write_json(path, payload)
    assert supervisor.verify_stage(DATE, "tuning_loop_a")["complete"] is False


@pytest.mark.parametrize("bad_value", [True, float("nan"), float("inf"), -0.01, 1.01])
def test_experiment_failure_rates_are_finite_numbers_in_unit_interval(bad_value: object) -> None:
    rows = experiment_rows()
    rows[0]["failure_rate"] = bad_value
    write_json(supervisor.qualification_root(DATE) / "experiments" / "index.json", {"experiments": rows, "winner": "exp-0"})
    assert supervisor.verify_stage(DATE, "experiments")["complete"] is False


@pytest.mark.parametrize("field,bad_value", [("failure_rate", True), ("failure_rate", float("nan")), ("failure_rate", 1.1)])
def test_benchmark_metrics_reject_bool_nonfinite_and_out_of_domain(field: str, bad_value: object) -> None:
    root = supervisor.qualification_root(DATE)
    payload = benchmark_payload()
    payload["summary"][field] = bad_value
    write_json(root / "baseline" / "baseline.benchmark.json", payload)
    (root / "baseline" / "baseline_report.md").write_text("baseline", encoding="utf-8")
    assert supervisor.verify_stage(DATE, "baseline")["complete"] is False


@pytest.mark.parametrize("contents", ["", "0", "{broken", '{"schema_version":"cortex.runtime.qualification.exit.v1","date":"2026-04-01","stage":"validation","run_id":"other","exit_code":0}'])
def test_reconciliation_rejects_empty_torn_malformed_or_unbound_exit_marker(contents: str) -> None:
    root = supervisor.qualification_root(DATE)
    run_id = "expected-run"
    exit_path = root / "_runs" / "validation" / run_id / "exit_code.txt"
    exit_path.parent.mkdir(parents=True)
    exit_path.write_text(contents, encoding="utf-8")
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {"stage": "validation", "pid": 999999, "run_id": run_id,
                               "started_at": "2026-04-01T00:00:00Z", "exit_code_path": str(exit_path)}
    supervisor.save_state(DATE, state)
    reconciled = supervisor.reconcile_state(DATE)
    assert reconciled["stages"]["validation"]["completed"] is False
    assert reconciled["active_process"]["pid"] == 999999
    assert reconciled["active_process"]["recovery_error"] == "legacy_process_identity_blocker"
    assert "supervisor_run" not in reconciled["stages"]["validation"]


def test_live_child_with_corrupt_marker_remains_owned_and_records_recoverable_error(monkeypatch: pytest.MonkeyPatch) -> None:
    root = supervisor.qualification_root(DATE)
    run_id = "live-current-run"
    exit_path = root / "_runs" / "validation" / run_id / "exit_code.txt"
    exit_path.parent.mkdir(parents=True)
    exit_path.write_text("{torn", encoding="utf-8")
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {
        "stage": "validation", "pid": 4242, "run_id": run_id,
        "started_at": "2026-04-01T00:00:00Z", "command": ["worker"],
        "exit_code_path": str(exit_path),
        "process_identity": process_identity(),
    }
    supervisor.save_state(DATE, state)
    monkeypatch.setattr(supervisor, "_process_alive", lambda _pid: True)
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid, command=None: process_identity())

    active = supervisor.reconcile_active_process(DATE)
    recovered = supervisor.load_or_create_state(DATE)

    assert active is not None
    assert recovered["active_process"]["pid"] == 4242
    assert recovered["active_process"]["alive"] is True
    assert recovered["active_process"]["recovery_error"] == "invalid_exit_marker"
    assert recovered["stages"]["validation"]["status"] != "complete"


def test_torn_state_write_preserves_last_complete_json(monkeypatch: pytest.MonkeyPatch) -> None:
    state = supervisor.build_initial_state(DATE)
    supervisor.save_state(DATE, state)
    path = supervisor.state_path(DATE)
    original = json.loads(path.read_text(encoding="utf-8"))
    real_replace = os.replace

    def interrupted_replace(src: object, dst: object, *args: object, **kwargs: object) -> None:
        if dst == path.name and kwargs.get("dst_dir_fd") is not None:
            raise OSError("simulated interrupted atomic replacement")
        real_replace(src, dst, *args, **kwargs)

    monkeypatch.setattr(os, "replace", interrupted_replace)
    changed = dict(state)
    changed["next_stage"] = "baseline"
    try:
        supervisor.save_state(DATE, changed)
    except OSError:
        pass

    assert json.loads(path.read_text(encoding="utf-8")) == original


def test_concurrent_background_launchers_create_only_one_process(monkeypatch: pytest.MonkeyPatch) -> None:
    barrier = threading.Barrier(2)
    created: list[int] = []
    guard = threading.Lock()

    class FakeProcess:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            with guard:
                created.append(len(created) + 100)
                self.pid = created[-1]
            try:
                barrier.wait(timeout=0.5)
            except threading.BrokenBarrierError:
                pass

    monkeypatch.setattr(supervisor.subprocess, "Popen", FakeProcess)
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid, command=None: process_identity())

    def launch() -> object:
        try:
            return supervisor.launch_stage(DATE, "baseline", background=True)
        except RuntimeError as exc:
            return exc

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _n: launch(), range(2)))

    assert len(created) == 1
    assert sum(isinstance(result, dict) and result.get("launched") is True for result in results) == 1


def test_process_concurrent_launchers_create_only_one_process(monkeypatch: pytest.MonkeyPatch) -> None:
    context = multiprocessing.get_context("fork")
    created = context.Value("i", 0)
    results = context.Queue()

    class FakeProcess:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            with created.get_lock():
                created.value += 1
            self.pid = os.getpid()

    monkeypatch.setattr(supervisor.subprocess, "Popen", FakeProcess)

    def launch() -> None:
        try:
            result = supervisor.launch_stage(DATE, "baseline", background=True)
            results.put(bool(result.get("launched")))
        except RuntimeError:
            results.put(False)

    processes = [context.Process(target=launch) for _ in range(2)]
    for process in processes:
        process.start()
    for process in processes:
        process.join(timeout=5)
        assert process.exitcode == 0

    assert created.value == 1
    assert sorted(results.get(timeout=1) for _ in processes) == [False, True]


def test_background_validation_durably_completes_with_bound_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    command = [sys.executable, "-c", "print('lightweight validation')"]
    monkeypatch.setattr(supervisor, "stage_command", lambda _date, _stage, **_kwargs: command)

    launched = supervisor.launch_stage(DATE, "validation", background=True)
    active = launched["active_process"]
    exit_path = Path(active["exit_code_path"])
    deadline = time.monotonic() + 5
    while not exit_path.exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    marker = json.loads(exit_path.read_text(encoding="utf-8"))
    assert marker["exit_code"] == 0
    assert marker["run_id"] == active["run_id"]

    reconciled = supervisor.reconcile_state(DATE)
    summary = json.loads((supervisor.qualification_root(DATE) / "validation" / "validation_summary.json").read_text(encoding="utf-8"))
    assert reconciled["active_process"] is None
    assert reconciled["stages"]["validation"]["completed"] is True
    assert summary["run_id"] == active["run_id"]
    assert summary["stage"] == "validation"
    assert summary["date"] == DATE
    assert summary["started_at"] == active["started_at"]
    assert supervisor._parse_timestamp(summary["finished_at"]) >= supervisor._parse_timestamp(summary["started_at"])


def test_termination_stops_background_workload_descendants(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    marker = tmp_path / "orphan-marker"
    ready = tmp_path / "descendant-started"
    child_code = f"import time; time.sleep(0.6); open({str(marker)!r}, 'w').write('leaked')"
    command = [
        sys.executable, "-c",
        f"import subprocess, sys, time; subprocess.Popen([sys.executable, '-c', {child_code!r}]); open({str(ready)!r}, 'w').write('ready'); time.sleep(5)",
    ]
    monkeypatch.setattr(supervisor, "stage_command", lambda _date, _stage, **_kwargs: command)

    launched = supervisor.launch_stage(DATE, "validation", background=True)
    deadline = time.monotonic() + 5
    while not ready.exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert ready.exists()
    result = supervisor.terminate_active_process(DATE)
    time.sleep(0.7)

    assert result["terminated"] is True
    assert not marker.exists()


@pytest.mark.parametrize("pid", [0, -1])
def test_termination_refuses_non_positive_pids(monkeypatch: pytest.MonkeyPatch, pid: int) -> None:
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {"stage": "baseline", "pid": pid, "started_at": "2026-04-01T00:00:00Z"}
    supervisor.save_state(DATE, state)
    calls: list[tuple[int, int]] = []
    monkeypatch.setattr(supervisor.os, "kill", lambda candidate, sig: calls.append((candidate, sig)))

    with pytest.raises(ValueError, match="invalid runtime qualification supervisor state"):
        supervisor.terminate_active_process(DATE)

    assert calls == []


def test_termination_refuses_reused_pid_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {
        "stage": "baseline",
        "pid": 4242,
        "started_at": "2026-04-01T00:00:00Z",
        "process_identity": process_identity(start="100"),
    }
    supervisor.save_state(DATE, state)
    calls: list[tuple[int, int]] = []
    monkeypatch.setattr(supervisor.os, "kill", lambda candidate, sig: calls.append((candidate, sig)))

    result = supervisor.terminate_active_process(DATE)

    assert result["terminated"] is False
    assert calls == []


def test_termination_refuses_forged_live_pid_with_same_start_but_different_exe_and_cmdline(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = process_identity(start="777", target="/opt/qualification-worker", cmdline_digest="1" * 64)
    forged = process_identity(start="777", target="/usr/bin/unrelated", device=9, inode=100, cmdline_digest="2" * 64)
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {"stage": "baseline", "pid": 4242, "process_identity": expected}
    supervisor.save_state(DATE, state)
    calls: list[tuple[int, int]] = []
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: forged)
    monkeypatch.setattr(supervisor.os, "kill", lambda pid, sig: calls.append((pid, sig)))

    result = supervisor.terminate_active_process(DATE)

    assert result == {"terminated": False, "reason": "process_identity_mismatch"}
    assert calls == []


def test_termination_signals_verified_process_group(monkeypatch: pytest.MonkeyPatch) -> None:
    identity = process_identity(start="777", target="/opt/qualification-worker", cmdline_digest="1" * 64)
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {"stage": "baseline", "pid": 4242, "process_identity": identity}
    supervisor.save_state(DATE, state)
    calls: list[tuple[int, int]] = []
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: dict(identity))
    monkeypatch.setattr(supervisor.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(supervisor.os, "killpg", lambda pid, sig: calls.append((pid, sig)))

    result = supervisor.terminate_active_process(DATE)

    assert result["terminated"] is True
    assert calls == [(4242, supervisor.signal.SIGTERM)]


def test_termination_refuses_process_that_is_no_longer_group_leader(monkeypatch: pytest.MonkeyPatch) -> None:
    identity = process_identity(start="777")
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {"stage": "baseline", "pid": 4242, "process_identity": identity}
    supervisor.save_state(DATE, state)
    calls: list[tuple[int, int]] = []
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: dict(identity))
    monkeypatch.setattr(supervisor.os, "getpgid", lambda _pid: 4000)
    monkeypatch.setattr(supervisor.os, "killpg", lambda pid, sig: calls.append((pid, sig)))

    result = supervisor.terminate_active_process(DATE)

    assert result == {"terminated": False, "reason": "process_group_identity_mismatch"}
    assert calls == []


def test_termination_fails_closed_when_proc_identity_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {"stage": "baseline", "pid": 4242, "process_identity": process_identity()}
    supervisor.save_state(DATE, state)
    calls: list[tuple[int, int]] = []
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid: {})
    monkeypatch.setattr(supervisor.os, "kill", lambda pid, sig: calls.append((pid, sig)))

    result = supervisor.terminate_active_process(DATE)

    assert result == {"terminated": False, "reason": "process_identity_unavailable"}
    assert calls == []


def test_legacy_identity_is_a_non_terminable_blocker(monkeypatch: pytest.MonkeyPatch) -> None:
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {"stage": "baseline", "pid": 4242, "process_identity": {"start_time": "777"}}
    supervisor.save_state(DATE, state)
    calls: list[tuple[int, int]] = []
    monkeypatch.setattr(supervisor.os, "kill", lambda pid, sig: calls.append((pid, sig)))

    result = supervisor.terminate_active_process(DATE)

    assert result == {"terminated": False, "reason": "legacy_process_identity_blocker"}
    assert calls == []


def test_process_identity_uses_injected_proc_snapshot_not_caller_command() -> None:
    observed: list[int] = []
    identity = process_identity(cmdline_digest="f" * 64)

    result = supervisor._process_identity(1234, ["forged", "command"], proc_reader=lambda pid: observed.append(pid) or identity)

    assert result == identity
    assert observed == [1234]
    assert "command" not in result


def test_recovery_clears_reused_live_pid_without_signaling_it(monkeypatch: pytest.MonkeyPatch) -> None:
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {
        "stage": "baseline", "pid": 4242, "run_id": "abandoned-run",
        "started_at": "2026-04-01T00:00:00Z", "command": ["expected"],
        "exit_code_path": str(supervisor.qualification_root(DATE) / "_runs" / "baseline" / "abandoned-run" / "exit_code.txt"),
        "process_identity": process_identity(start="100"),
    }
    supervisor.save_state(DATE, state)
    monkeypatch.setattr(supervisor, "_process_alive", lambda _pid: True)
    monkeypatch.setattr(supervisor, "_process_identity", lambda _pid, command=None: process_identity(start="101"))
    calls: list[tuple[int, int]] = []
    monkeypatch.setattr(supervisor.os, "kill", lambda pid, sig: calls.append((pid, sig)))

    supervisor.reconcile_active_process(DATE)
    recovered = supervisor.load_or_create_state(DATE)

    assert recovered["active_process"] is None
    assert recovered["stages"]["baseline"]["status"] == "failed"
    assert recovered["stages"]["baseline"]["supervisor_run"]["reason"] == "process_identity_mismatch"
    assert calls == []


def test_valid_finished_run_recovers_only_with_matching_bound_artifact(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    run_id = "run-current"
    identity = process_identity()
    write_json(
        root / "validation" / "validation_summary.json",
        {
            "schema_version": "cortex.runtime.qualification.validation.v1",
            "date": DATE,
            "stage": "validation",
            "run_id": run_id,
            "returncode": 0,
            "command": supervisor.stage_command(DATE, "validation", run_id=run_id),
            "stdout_path": str(root / "_runs" / "validation" / run_id / "stdout.txt"),
            "stderr_path": str(root / "_runs" / "validation" / run_id / "stderr.txt"),
            "stdout_tail": "995 passed",
            "stderr_tail": "",
            "started_at": "2026-04-01T00:00:00Z",
            "finished_at": "2026-04-01T00:00:01Z",
            "successful_exit": True,
        },
    )
    exit_path = root / "_runs" / "validation" / run_id / "exit_code.txt"
    exit_path.parent.mkdir(parents=True)
    exit_path.write_text(json.dumps({
        "schema_version": "cortex.runtime.qualification.exit.v1", "date": DATE,
        "stage": "validation", "run_id": run_id, "exit_code": 0,
        "process_id": 99999, "process_start_time": identity["start_time"],
        "process_identity": identity,
    }), encoding="utf-8")
    state = supervisor.build_initial_state(DATE)
    state["active_process"] = {
        "stage": "validation",
        "pid": 99999,
        "run_id": run_id,
        "started_at": "2026-04-01T00:00:00Z",
        "exit_code_path": str(exit_path),
        "process_identity": identity,
    }
    supervisor.save_state(DATE, state)

    reconciled = supervisor.reconcile_state(DATE)

    assert reconciled["active_process"] is None
    assert reconciled["stages"]["validation"]["status"] == "complete"
    assert reconciled["stages"]["validation"]["completed"] is True


def test_reconcile_and_launch_share_the_same_process_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    entered = threading.Event()
    release = threading.Event()
    original_load = supervisor._json_load

    state = supervisor.build_initial_state(DATE)
    supervisor.save_state(DATE, state)

    def held_load(path: Path) -> dict:
        if path == supervisor.state_path(DATE) and not entered.is_set():
            entered.set()
            release.wait(timeout=2)
        return original_load(path)

    monkeypatch.setattr(supervisor, "_json_load", held_load)
    monkeypatch.setattr(supervisor.subprocess, "Popen", lambda *_args, **_kwargs: pytest.fail("launch crossed reconciliation lock"))

    with ThreadPoolExecutor(max_workers=2) as pool:
        reconciling = pool.submit(supervisor.reconcile_state, DATE)
        assert entered.wait(timeout=1)
        launching = pool.submit(supervisor.launch_stage, DATE, "baseline", background=True)
        time.sleep(0.05)
        assert not launching.done()
        release.set()
        reconciling.result(timeout=2)
        with pytest.raises(BaseException):
            launching.result(timeout=2)


def test_validation_rejects_zero_exit_without_supervisor_result_contract(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    write_json(
        root / 'validation' / 'validation_summary.json',
        {
            'schema_version': 'cortex.runtime.qualification.validation.v1',
            'date': DATE,
            'stage': 'validation',
            'run_id': 'forged-validation',
            'returncode': 0,
        },
    )

    verified = supervisor.verify_stage(DATE, 'validation')

    assert verified['complete'] is False
    assert 'invalid validation result contract' in verified['missing_artifacts'][0]


def test_fabricated_success_state_without_bound_exit_marker_is_rejected(tmp_path: Path) -> None:
    root = supervisor.qualification_root(DATE)
    write_json(root / "experiments" / "index.json", {
        "experiments": experiment_rows(), "winner": "exp-0",
        "run_id": "forged-run", "stage": "experiments", "date": DATE,
        "started_at": "2026-04-01T00:00:00Z", "finished_at": "2026-04-01T00:00:01Z",
        "returncode": 0, "successful_exit": True,
    })
    forged = {
        "run_id": "forged-run", "stage": "experiments", "status": "succeeded",
        "exit_code": 0, "exit_observed_by_supervisor": True,
        "command_sha256": supervisor._command_sha256(supervisor.stage_command(DATE, "experiments", run_id="forged-run")),
    }

    result = supervisor.verify_stage(DATE, "experiments", expected_run=forged)

    assert result["complete"] is False
    assert "supervisor-owned run" in result["missing_artifacts"][0]
