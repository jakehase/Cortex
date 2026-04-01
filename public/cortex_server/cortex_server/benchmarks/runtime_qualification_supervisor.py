from __future__ import annotations

import json
import os
import re
import shlex
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

JsonDict = Dict[str, Any]

STAGE_ORDER = [
    "corpus",
    "baseline",
    "experiments",
    "tuning_loop_a",
    "tuning_loop_b",
    "soak_run_1",
    "soak_run_2",
    "soak_run_3",
    "final_rerun",
    "validation",
    "final_report",
]

AUTO_RUN_STAGES = {"baseline", "experiments", "soak_run_1", "soak_run_2", "soak_run_3", "final_rerun", "validation"}
SOAK_STAGES = {"soak_run_1", "soak_run_2", "soak_run_3"}
MANUAL_STAGES = {"corpus", "tuning_loop_a", "tuning_loop_b", "final_report"}


@dataclass(frozen=True)
class StageSpec:
    stage: str
    label: str
    required_artifacts: List[str]
    auto_runnable: bool = False
    soak: bool = False


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def qualification_root(date: str) -> Path:
    return repo_root() / "artifacts" / "qualification" / date


def docs_root() -> Path:
    return repo_root() / "docs"


def benchmarks_root() -> Path:
    return repo_root() / "benchmarks"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def corpus_path(date: str) -> Path:
    return benchmarks_root() / f"cortex_runtime_qualification_corpus_{date}.json"


def state_path(date: str) -> Path:
    return qualification_root(date) / "program_state.json"


def completion_summary_path(date: str) -> Path:
    return qualification_root(date) / "completion_summary.json"


def notification_state_path(date: str) -> Path:
    return qualification_root(date) / "notification_state.json"


def _stage_specs(date: str) -> Dict[str, StageSpec]:
    root = qualification_root(date)
    return {
        "corpus": StageSpec("corpus", "Benchmark corpus (30+ cases)", [str(corpus_path(date))]),
        "baseline": StageSpec("baseline", "Baseline qualification run", [str(root / "baseline" / "baseline.benchmark.json"), str(root / "baseline" / "baseline_report.md")], auto_runnable=True),
        "experiments": StageSpec("experiments", "Experiment matrix (6+ configs)", [str(root / "experiments" / "index.json")], auto_runnable=True),
        "tuning_loop_a": StageSpec("tuning_loop_a", "Tuning loop A", [str(root / "tuning_loop_a" / "loop_a_summary.json")]),
        "tuning_loop_b": StageSpec("tuning_loop_b", "Tuning loop B", [str(root / "tuning_loop_b" / "loop_b_summary.json")]),
        "soak_run_1": StageSpec("soak_run_1", "Soak run 1 (30m)", [str(root / "soak_run_1.json"), str(root / "soak_run_1.md")], auto_runnable=True, soak=True),
        "soak_run_2": StageSpec("soak_run_2", "Soak run 2 (30m)", [str(root / "soak_run_2.json"), str(root / "soak_run_2.md")], auto_runnable=True, soak=True),
        "soak_run_3": StageSpec("soak_run_3", "Soak run 3 (30m)", [str(root / "soak_run_3.json"), str(root / "soak_run_3.md")], auto_runnable=True, soak=True),
        "final_rerun": StageSpec("final_rerun", "Final qualification rerun", [str(root / "final" / "final.benchmark.json")], auto_runnable=True),
        "validation": StageSpec("validation", "Broad repo validation", [str(root / "validation" / "validation_summary.json")], auto_runnable=True),
        "final_report": StageSpec("final_report", "Final qualification report", [str(docs_root() / f"CORTEX_RUNTIME_QUALIFICATION_FINAL_REPORT_{date}.md")]),
    }


def _json_load(path: Path) -> JsonDict:
    return json.loads(path.read_text(encoding="utf-8"))


def _json_dump(path: Path, payload: JsonDict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def build_initial_state(date: str) -> JsonDict:
    return {
        "schema_version": "cortex.runtime.qualification.supervisor.v1",
        "date": date,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "repo_root": str(repo_root()),
        "artifacts_root": str(qualification_root(date)),
        "stage_order": list(STAGE_ORDER),
        "stages": {
            stage: {
                "stage": stage,
                "label": _stage_specs(date)[stage].label,
                "status": "pending",
                "completed": False,
                "last_verified_at": None,
                "missing_artifacts": [],
                "details": {},
            }
            for stage in STAGE_ORDER
        },
        "active_process": None,
    }


def load_or_create_state(date: str) -> JsonDict:
    path = state_path(date)
    if path.exists():
        return _json_load(path)
    state = build_initial_state(date)
    save_state(date, state)
    return state


def save_state(date: str, state: JsonDict) -> None:
    state["updated_at"] = now_iso()
    _json_dump(state_path(date), state)


def _artifact_exists(path_str: str) -> bool:
    return Path(path_str).exists()


def _verify_corpus(date: str) -> JsonDict:
    path = corpus_path(date)
    if not path.exists():
        return {"complete": False, "missing_artifacts": [str(path)], "details": {"case_count": 0}}
    payload = _json_load(path)
    cases = payload.get("cases") if isinstance(payload, dict) else payload
    count = len(cases or [])
    complete = count >= 30
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{path} (requires >=30 cases, found {count})"],
        "details": {"case_count": count},
    }


def _verify_experiments(date: str) -> JsonDict:
    root = qualification_root(date) / "experiments"
    index_path = root / "index.json"
    if not index_path.exists():
        return {"complete": False, "missing_artifacts": [str(index_path)], "details": {"experiment_count": 0}}
    payload = _json_load(index_path)
    experiments = payload.get("experiments") or []
    count = len(experiments)
    complete = count >= 6
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{index_path} (requires >=6 experiments, found {count})"],
        "details": {"experiment_count": count, "winner": payload.get("winner")},
    }


def _verify_soak(date: str, stage: str) -> JsonDict:
    root = qualification_root(date)
    json_path = root / f"{stage}.json"
    md_path = root / f"{stage}.md"
    missing = [str(path) for path in [json_path, md_path] if not path.exists()]
    if missing:
        return {"complete": False, "missing_artifacts": missing, "details": {}}
    payload = _json_load(json_path)
    duration = int(payload.get("duration_seconds") or 0)
    complete = duration >= 1800
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{json_path} (requires duration_seconds >= 1800, found {duration})"],
        "details": {"duration_seconds": duration, "round_count": int(payload.get("round_count") or 0)},
    }


def _verify_validation(date: str) -> JsonDict:
    path = qualification_root(date) / "validation" / "validation_summary.json"
    if not path.exists():
        return {"complete": False, "missing_artifacts": [str(path)], "details": {}}
    payload = _json_load(path)
    return {
        "complete": bool(payload.get("returncode") == 0),
        "missing_artifacts": [] if payload.get("returncode") == 0 else [f"{path} (returncode={payload.get('returncode')})"],
        "details": {"returncode": payload.get("returncode"), "command": payload.get("command")},
    }


def verify_stage(date: str, stage: str) -> JsonDict:
    specs = _stage_specs(date)
    if stage not in specs:
        raise KeyError(f"Unknown stage: {stage}")
    spec = specs[stage]
    if stage == "corpus":
        result = _verify_corpus(date)
    elif stage == "experiments":
        result = _verify_experiments(date)
    elif stage in SOAK_STAGES:
        result = _verify_soak(date, stage)
    elif stage == "validation":
        result = _verify_validation(date)
    else:
        missing = [path for path in spec.required_artifacts if not _artifact_exists(path)]
        result = {"complete": not missing, "missing_artifacts": missing, "details": {}}
    return {
        "stage": stage,
        "label": spec.label,
        "auto_runnable": spec.auto_runnable,
        "soak": spec.soak,
        **result,
    }


def reconcile_state(date: str, *, persist: bool = True) -> JsonDict:
    state = load_or_create_state(date)
    active = state.get("active_process") or None
    if active:
        active = reconcile_active_process(date, state=state)
    for stage in STAGE_ORDER:
        verification = verify_stage(date, stage)
        row = state["stages"].setdefault(stage, {})
        row.update(
            {
                "stage": stage,
                "label": verification.get("label"),
                "completed": bool(verification.get("complete")),
                "status": "complete" if verification.get("complete") else (row.get("status") if row.get("status") == "running" else "pending"),
                "missing_artifacts": list(verification.get("missing_artifacts") or []),
                "details": verification.get("details") or {},
                "last_verified_at": now_iso(),
                "auto_runnable": bool(verification.get("auto_runnable")),
                "soak": bool(verification.get("soak")),
            }
        )
    state["next_stage"] = next((stage for stage in STAGE_ORDER if not state["stages"][stage].get("completed")), None)
    state["all_complete"] = state["next_stage"] is None
    if persist:
        save_state(date, state)
        if state["all_complete"]:
            build_completion_summary(date, state=state, persist=True)
            notification_state(date, persist_default=True)
    return state


def stage_status_summary(date: str) -> JsonDict:
    state = reconcile_state(date)
    completion_path = completion_summary_path(date)
    return {
        "schema_version": state.get("schema_version"),
        "date": date,
        "artifacts_root": state.get("artifacts_root"),
        "all_complete": state.get("all_complete"),
        "next_stage": state.get("next_stage"),
        "active_process": state.get("active_process"),
        "completion_summary_path": str(completion_path) if completion_path.exists() else None,
        "stages": [state["stages"][stage] for stage in STAGE_ORDER],
    }


def _pick_metrics(path: Path) -> JsonDict:
    if not path.exists():
        return {}
    payload = _json_load(path)
    summary = payload.get("summary") or {}
    trace = summary.get("trace_metrics") or {}
    return {
        "failure_rate": summary.get("failure_rate"),
        "trace_p50_ms": ((trace.get("latency_ms") or {}).get("p50")),
        "trace_p95_ms": ((trace.get("latency_ms") or {}).get("p95")),
        "drift_delta_ms": ((summary.get("drift") or {}).get("overall_delta_ms")),
    }


def build_completion_summary(date: str, *, state: Optional[JsonDict] = None, persist: bool = True) -> JsonDict:
    state = state or reconcile_state(date)
    root = qualification_root(date)
    baseline = _pick_metrics(root / "baseline" / "baseline.benchmark.json")
    final = _pick_metrics(root / "final" / "final.benchmark.json")
    experiments = _json_load(root / "experiments" / "index.json") if (root / "experiments" / "index.json").exists() else {}
    soak = _json_load(root / "soak_summary.json") if (root / "soak_summary.json").exists() else {}
    validation = _json_load(root / "validation" / "validation_summary.json") if (root / "validation" / "validation_summary.json").exists() else {}
    case_count = ((state.get("stages") or {}).get("corpus") or {}).get("details", {}).get("case_count")
    summary = {
        "schema_version": "cortex.runtime.qualification.completion.v1",
        "date": date,
        "generated_at": now_iso(),
        "all_complete": bool(state.get("all_complete")),
        "artifacts_root": str(root),
        "stage_checklist": [
            {
                "stage": stage,
                "label": ((state.get("stages") or {}).get(stage) or {}).get("label"),
                "completed": bool(((state.get("stages") or {}).get(stage) or {}).get("completed")),
            }
            for stage in STAGE_ORDER
        ],
        "summary": {
            "case_count": case_count,
            "experiment_count": len(experiments.get("experiments") or []),
            "winner": experiments.get("winner"),
            "baseline": baseline,
            "final": final,
            "soak": {
                "run_count": soak.get("run_count"),
                "avg_trace_p95_ms": ((soak.get("aggregate") or {}).get("avg_trace_p95_ms")),
                "max_trace_p95_ms": ((soak.get("aggregate") or {}).get("max_trace_p95_ms")),
                "avg_trace_drift_delta_ms": ((soak.get("aggregate") or {}).get("avg_trace_drift_delta_ms")),
            },
            "validation": {
                "returncode": validation.get("returncode"),
                "command": validation.get("command"),
            },
        },
        "message_lines": [
            f"Runtime qualification {'complete' if state.get('all_complete') else 'incomplete'} for {date}.",
            f"Stages complete: {sum(1 for stage in STAGE_ORDER if ((state.get('stages') or {}).get(stage) or {}).get('completed'))}/{len(STAGE_ORDER)}.",
            f"Winner config: {experiments.get('winner') or 'unknown'}.",
            f"Baseline failure rate: {baseline.get('failure_rate')} → final: {final.get('failure_rate')}.",
            f"Soak runs: {soak.get('run_count') or 0}; avg trace p95: {((soak.get('aggregate') or {}).get('avg_trace_p95_ms'))} ms.",
            f"Validation returncode: {validation.get('returncode')}.",
        ],
        "final_report_path": str(docs_root() / f"CORTEX_RUNTIME_QUALIFICATION_FINAL_REPORT_{date}.md"),
    }
    if persist:
        _json_dump(completion_summary_path(date), summary)
    return summary


def notification_state(date: str, *, persist_default: bool = True) -> JsonDict:
    path = notification_state_path(date)
    if path.exists():
        return _json_load(path)
    payload = {
        "schema_version": "cortex.runtime.qualification.notification.v1",
        "date": date,
        "created_at": now_iso(),
        "notified": False,
        "notified_at": None,
        "notify_count": 0,
        "completion_summary_path": str(completion_summary_path(date)),
    }
    if persist_default:
        _json_dump(path, payload)
    return payload


def mark_notified(date: str, *, note: Optional[str] = None) -> JsonDict:
    payload = notification_state(date)
    payload["notified"] = True
    payload["notified_at"] = now_iso()
    payload["notify_count"] = int(payload.get("notify_count") or 0) + 1
    if note:
        payload["note"] = str(note)
    _json_dump(notification_state_path(date), payload)
    return payload


def wait_for_completion(date: str, *, timeout_seconds: int = 0, interval_seconds: int = 30, mark_complete_notification: bool = False) -> JsonDict:
    start = time.time()
    while True:
        state = reconcile_state(date)
        if state.get("all_complete"):
            summary = build_completion_summary(date, state=state, persist=True)
            notification = notification_state(date)
            if mark_complete_notification and not notification.get("notified"):
                notification = mark_notified(date, note="completion delivered via watcher")
            return {
                "all_complete": True,
                "timed_out": False,
                "state": stage_status_summary(date),
                "completion_summary": summary,
                "notification": notification,
            }
        if timeout_seconds and (time.time() - start) >= timeout_seconds:
            return {
                "all_complete": False,
                "timed_out": True,
                "state": stage_status_summary(date),
                "completion_summary": None,
                "notification": notification_state(date),
            }
        time.sleep(max(1, int(interval_seconds or 30)))


def _bash_wrapper(command: List[str], *, stdout_path: Path, stderr_path: Path, exit_code_path: Path) -> List[str]:
    quoted = " ".join(shlex.quote(str(part)) for part in command)
    script = (
        f"set -euo pipefail; "
        f"{quoted} > {shlex.quote(str(stdout_path))} 2> {shlex.quote(str(stderr_path))}; "
        f"code=$?; echo $code > {shlex.quote(str(exit_code_path))}; exit $code"
    )
    return ["bash", "-lc", script]


def stage_command(date: str, stage: str) -> List[str]:
    root = qualification_root(date)
    corpus = corpus_path(date)
    if stage == "baseline":
        return [
            sys.executable,
            "-m",
            "cortex_server.benchmarks.kernel_v2_benchmark",
            "--corpus",
            str(corpus),
            "--iterations",
            "5",
            "--output",
            str(root / "baseline" / "baseline.benchmark.json"),
        ]
    if stage == "experiments":
        return [
            sys.executable,
            "-m",
            "cortex_server.benchmarks.runtime_durability_experiments",
            "--corpus",
            str(corpus),
            "--iterations",
            "12",
            "--output-dir",
            str(root / "experiments"),
        ]
    if stage in SOAK_STAGES:
        return [
            sys.executable,
            str(repo_root() / "scripts" / "run_runtime_qualification_soak.py"),
            "--corpus",
            str(corpus),
            "--output-prefix",
            str(root / stage),
            "--duration-seconds",
            "1800",
            "--iterations-per-round",
            "3",
            "--config-id",
            os.getenv("CORTEX_RUNTIME_QUALIFICATION_CONFIG_ID", "persistent_2x1"),
        ]
    if stage == "final_rerun":
        return [
            sys.executable,
            "-m",
            "cortex_server.benchmarks.kernel_v2_benchmark",
            "--corpus",
            str(corpus),
            "--iterations",
            "10",
            "--output",
            str(root / "final" / "final.benchmark.json"),
        ]
    if stage == "validation":
        return [sys.executable, "-m", "pytest", "-q"]
    raise ValueError(f"Stage {stage} is not auto-runnable")


def launch_stage(date: str, stage: str, *, background: bool = False) -> JsonDict:
    if stage not in AUTO_RUN_STAGES:
        raise ValueError(f"Stage {stage} is not auto-runnable")
    state = reconcile_state(date)
    if state.get("active_process"):
        raise RuntimeError("Another stage process is already active")
    if state["stages"][stage].get("completed"):
        return {"launched": False, "reason": "already_complete", "stage": stage}

    root = qualification_root(date)
    run_dir = root / "_runs" / stage
    run_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = run_dir / "stdout.txt"
    stderr_path = run_dir / "stderr.txt"
    exit_code_path = run_dir / "exit_code.txt"
    command = stage_command(date, stage)

    if background:
        wrapper = _bash_wrapper(command, stdout_path=stdout_path, stderr_path=stderr_path, exit_code_path=exit_code_path)
        proc = subprocess.Popen(wrapper, cwd=str(repo_root()), start_new_session=True)
        active = {
            "stage": stage,
            "pid": proc.pid,
            "started_at": now_iso(),
            "command": command,
            "stdout_path": str(stdout_path),
            "stderr_path": str(stderr_path),
            "exit_code_path": str(exit_code_path),
        }
        state["active_process"] = active
        state["stages"][stage]["status"] = "running"
        save_state(date, state)
        return {"launched": True, "background": True, "active_process": active}

    started = time.time()
    proc = subprocess.run(command, cwd=str(repo_root()), capture_output=True, text=True)
    stdout_path.write_text(proc.stdout or "", encoding="utf-8")
    stderr_path.write_text(proc.stderr or "", encoding="utf-8")
    exit_code_path.write_text(str(proc.returncode), encoding="utf-8")
    if stage == "validation":
        validation_path = qualification_root(date) / "validation" / "validation_summary.json"
        _json_dump(
            validation_path,
            {
                "schema_version": "cortex.runtime.qualification.validation.v1",
                "stage": stage,
                "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
                "finished_at": now_iso(),
                "returncode": proc.returncode,
                "command": command,
                "stdout_path": str(stdout_path),
                "stderr_path": str(stderr_path),
                "stdout_tail": (proc.stdout or "")[-4000:],
                "stderr_tail": (proc.stderr or "")[-4000:],
            },
        )
    state = reconcile_state(date)
    state["active_process"] = None
    save_state(date, state)
    return {"launched": True, "background": False, "returncode": proc.returncode, "stage": stage}


def _process_alive(pid: int) -> bool:
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def reconcile_active_process(date: str, *, state: Optional[JsonDict] = None) -> Optional[JsonDict]:
    state = state or load_or_create_state(date)
    active = state.get("active_process") or None
    if not active:
        return None
    exit_code_path = Path(str(active.get("exit_code_path") or ""))
    stage = str(active.get("stage") or "")
    pid = int(active.get("pid") or 0)
    if exit_code_path.exists():
        try:
            exit_code = int(exit_code_path.read_text(encoding="utf-8").strip())
        except Exception:
            exit_code = None
        active["finished_at"] = now_iso()
        active["exit_code"] = exit_code
        active["alive"] = False
        state["active_process"] = None
        row = state["stages"].setdefault(stage, {})
        verification = verify_stage(date, stage)
        row["status"] = "complete" if verification.get("complete") and exit_code == 0 else "failed"
        row["completed"] = bool(verification.get("complete") and exit_code == 0)
        row["missing_artifacts"] = verification.get("missing_artifacts") or []
        row["details"] = verification.get("details") or {}
        save_state(date, state)
        return None
    if pid and _process_alive(pid):
        active["alive"] = True
        save_state(date, state)
        return active
    active["alive"] = False
    active["finished_at"] = now_iso()
    state["active_process"] = None
    row = state["stages"].setdefault(stage, {})
    row["status"] = "failed"
    save_state(date, state)
    return None


def terminate_active_process(date: str) -> JsonDict:
    state = load_or_create_state(date)
    active = state.get("active_process")
    if not active:
        return {"terminated": False, "reason": "no_active_process"}
    pid = int(active.get("pid") or 0)
    os.kill(pid, signal.SIGTERM)
    active["terminated_at"] = now_iso()
    state["active_process"] = active
    save_state(date, state)
    return {"terminated": True, "pid": pid, "stage": active.get("stage")}


def stage_spec_view(date: str, stage: Optional[str] = None) -> JsonDict:
    specs = _stage_specs(date)
    stages = [stage] if stage else STAGE_ORDER
    out = []
    for name in stages:
        spec = specs[name]
        view = {
            "stage": name,
            "label": spec.label,
            "auto_runnable": spec.auto_runnable,
            "soak": spec.soak,
            "required_artifacts": list(spec.required_artifacts),
        }
        if spec.auto_runnable:
            view["command"] = stage_command(date, name)
        out.append(view)
    return {"date": date, "stages": out}
