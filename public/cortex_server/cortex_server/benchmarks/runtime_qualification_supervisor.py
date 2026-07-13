from __future__ import annotations

import json
import fcntl
import functools
import hashlib
import math
import os
import re
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
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
_THREAD_LOCK = threading.RLock()
_LOCK_STATE = threading.local()


@dataclass(frozen=True)
class StageSpec:
    stage: str
    label: str
    required_artifacts: List[str]
    auto_runnable: bool = False
    soak: bool = False


@dataclass
class _ForegroundLaunch:
    proc: subprocess.Popen[str]
    stage: str
    run_id: str
    started_at: str
    command: List[str]
    active: JsonDict
    stdout_path: Path
    stderr_path: Path
    exit_code_path: Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def qualification_root(date: str) -> Path:
    if not isinstance(date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise ValueError("date must use strict YYYY-MM-DD format")
    try:
        if datetime.strptime(date, "%Y-%m-%d").strftime("%Y-%m-%d") != date:
            raise ValueError
    except ValueError as exc:
        raise ValueError(f"invalid calendar date: {date}") from exc
    base = (repo_root() / "artifacts" / "qualification").resolve()
    lexical_candidate = base / date
    if lexical_candidate.is_symlink():
        raise ValueError("qualification root may not be a symlink")
    candidate = lexical_candidate.resolve()
    if candidate == base or base not in candidate.parents:
        raise ValueError("qualification path escapes qualification root")
    return candidate


def qualification_artifact_path(date: str, *parts: str) -> Path:
    """Build a symlink-free path confined beneath the resolved date root."""
    root = qualification_root(date)
    if not parts or any(not isinstance(part, str) or not part or Path(part).is_absolute() for part in parts):
        raise ValueError("qualification artifact path requires relative components")
    candidate = root.joinpath(*parts)
    try:
        relative = candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("qualification artifact path escapes qualification root") from exc
    if any(part in {"", ".", ".."} for part in relative.parts):
        raise ValueError("qualification artifact path contains an unsafe component")
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"qualification artifact path contains symlink: {current}")
    resolved_parent = candidate.parent.resolve()
    resolved_target = candidate.resolve()
    if not resolved_parent.is_relative_to(root) or not resolved_target.is_relative_to(root):
        raise ValueError("qualification artifact path escapes qualification root")
    return candidate


def _open_directory_at(parent_fd: int, name: str, *, create: bool = False) -> int:
    """Open one real directory component without ever following a symlink."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    if create:
        try:
            os.mkdir(name, mode=0o700, dir_fd=parent_fd)
        except FileExistsError:
            pass
    return os.open(name, flags, dir_fd=parent_fd)


def _open_qualification_root(date: str) -> int:
    """Create/open the qualification root through held directory descriptors."""
    qualification_root(date)  # strict date validation and compatibility checks
    fd = os.open(repo_root(), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in ("artifacts", "qualification", date):
            next_fd = _open_directory_at(fd, component, create=True)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextmanager
def _artifact_parent_fd(path: Path, *, create: bool = False):
    """Yield a held parent descriptor and basename for a qualification artifact."""
    root = getattr(_LOCK_STATE, "root", None)
    date = getattr(_LOCK_STATE, "date", None)
    if root is None or date is None:
        raise RuntimeError("qualification artifact operation requires the process lock")
    relative = _validate_qualification_artifact(date, path).relative_to(qualification_root(date))
    if not relative.parts:
        raise ValueError("qualification root is not an artifact")
    fd = os.dup(root)
    try:
        for component in relative.parts[:-1]:
            next_fd = _open_directory_at(fd, component, create=create)
            os.close(fd)
            fd = next_fd
        yield fd, relative.name
    finally:
        os.close(fd)


def _artifact_read_bytes(path: Path) -> bytes:
    with _artifact_parent_fd(path) as (parent_fd, name):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        with os.fdopen(fd, "rb") as handle:
            return handle.read()


@contextmanager
def _artifact_open_write(path: Path):
    """Open a regular artifact for streaming writes beneath a held parent."""
    with _artifact_parent_fd(path, create=True) as (parent_fd, name):
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            yield handle


def _artifact_write_bytes(path: Path, content: bytes) -> None:
    """Atomically replace an artifact relative to its verified held parent."""
    with _artifact_parent_fd(path, create=True) as (parent_fd, name):
        temporary = f".{name}.{os.getpid()}.{time.time_ns()}"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
            os.fsync(parent_fd)
        except BaseException:
            try:
                os.unlink(temporary, dir_fd=parent_fd)
            except FileNotFoundError:
                pass
            raise


def _artifact_mkdir(path: Path, *, exist_ok: bool = True) -> None:
    """Create an artifact directory tree through held no-follow descriptors."""
    with _artifact_parent_fd(path, create=True) as (parent_fd, name):
        if not exist_ok:
            os.mkdir(name, mode=0o700, dir_fd=parent_fd)
        child_fd = _open_directory_at(parent_fd, name, create=exist_ok)
        os.close(child_fd)


def _validate_qualification_artifact(date: str, path: Path) -> Path:
    root = qualification_root(date)
    try:
        relative = Path(path).relative_to(root)
    except ValueError as exc:
        raise ValueError("path is not a qualification artifact") from exc
    return qualification_artifact_path(date, *relative.parts)


def docs_root() -> Path:
    return repo_root() / "docs"


def benchmarks_root() -> Path:
    return repo_root() / "benchmarks"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def corpus_path(date: str) -> Path:
    qualification_root(date)  # validate before interpolating into any path
    return benchmarks_root() / f"cortex_runtime_qualification_corpus_{date}.json"


def state_path(date: str) -> Path:
    return qualification_artifact_path(date, "program_state.json")


def completion_summary_path(date: str) -> Path:
    return qualification_artifact_path(date, "completion_summary.json")


def notification_state_path(date: str) -> Path:
    return qualification_artifact_path(date, "notification_state.json")


@contextmanager
def qualification_process_lock(date: str):
    """Serialize every qualification-root read/modify/write operation.

    flock locks are not safely recursive across separately opened descriptors, so
    nested library calls share the outer descriptor within a thread.
    """
    with _THREAD_LOCK:
        depth = getattr(_LOCK_STATE, "depth", 0)
        if depth:
            _LOCK_STATE.depth = depth + 1
            try:
                yield
            finally:
                _LOCK_STATE.depth -= 1
            return
        root_fd = _open_qualification_root(date)
        fd = os.open(".supervisor.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=root_fd)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            _LOCK_STATE.depth = 1
            _LOCK_STATE.root = root_fd
            _LOCK_STATE.date = date
            yield
        finally:
            _LOCK_STATE.depth = 0
            _LOCK_STATE.root = None
            _LOCK_STATE.date = None
            os.close(fd)
            os.close(root_fd)


def _qualification_locked(function):
    @functools.wraps(function)
    def locked(date: str, *args: Any, **kwargs: Any):
        with qualification_process_lock(date):
            return function(date, *args, **kwargs)
    return locked


def _stage_specs(date: str) -> Dict[str, StageSpec]:
    return {
        "corpus": StageSpec("corpus", "Benchmark corpus (30+ cases)", [str(corpus_path(date))]),
        "baseline": StageSpec("baseline", "Baseline qualification run", [str(qualification_artifact_path(date, "baseline", "baseline.benchmark.json")), str(qualification_artifact_path(date, "baseline", "baseline_report.md"))], auto_runnable=True),
        "experiments": StageSpec("experiments", "Experiment matrix (6+ configs)", [str(qualification_artifact_path(date, "experiments", "index.json"))], auto_runnable=True),
        "tuning_loop_a": StageSpec("tuning_loop_a", "Tuning loop A", [str(qualification_artifact_path(date, "tuning_loop_a", "loop_a_summary.json"))]),
        "tuning_loop_b": StageSpec("tuning_loop_b", "Tuning loop B", [str(qualification_artifact_path(date, "tuning_loop_b", "loop_b_summary.json"))]),
        "soak_run_1": StageSpec("soak_run_1", "Soak run 1 (30m)", [str(qualification_artifact_path(date, "soak_run_1.json")), str(qualification_artifact_path(date, "soak_run_1.md"))], auto_runnable=True, soak=True),
        "soak_run_2": StageSpec("soak_run_2", "Soak run 2 (30m)", [str(qualification_artifact_path(date, "soak_run_2.json")), str(qualification_artifact_path(date, "soak_run_2.md"))], auto_runnable=True, soak=True),
        "soak_run_3": StageSpec("soak_run_3", "Soak run 3 (30m)", [str(qualification_artifact_path(date, "soak_run_3.json")), str(qualification_artifact_path(date, "soak_run_3.md"))], auto_runnable=True, soak=True),
        "final_rerun": StageSpec("final_rerun", "Final qualification rerun", [str(qualification_artifact_path(date, "final", "final.benchmark.json"))], auto_runnable=True),
        "validation": StageSpec("validation", "Broad repo validation", [str(qualification_artifact_path(date, "validation", "validation_summary.json"))], auto_runnable=True),
        "final_report": StageSpec("final_report", "Final qualification report", [str(docs_root() / f"CORTEX_RUNTIME_QUALIFICATION_FINAL_REPORT_{date}.md")]),
    }


def _json_load(path: Path) -> JsonDict:
    artifact_date = getattr(_LOCK_STATE, "date", None)
    if artifact_date is not None:
        try:
            path.relative_to(repo_root() / "artifacts" / "qualification" / artifact_date)
        except ValueError:
            raw = path.read_text(encoding="utf-8")
        else:
            _validate_qualification_artifact(artifact_date, path)
            raw = _artifact_read_bytes(path).decode("utf-8")
    else:
        raw = path.read_text(encoding="utf-8")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("JSON document must be an object")
    return payload


def _invalid_artifact(path: Path, exc: BaseException) -> JsonDict:
    reason = f"{path} (unreadable or invalid JSON: {type(exc).__name__})"
    return {"complete": False, "missing_artifacts": [reason], "details": {"reason": reason}}


def _json_dump(path: Path, payload: JsonDict) -> None:
    artifact_date = getattr(_LOCK_STATE, "date", None)
    if artifact_date is not None:
        _validate_qualification_artifact(artifact_date, path)
        content = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
        _artifact_write_bytes(path, content)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    # Some embedders instrument Path.write_text to model a device failing
    # during a legacy in-place write.  Exercise that hook without letting it
    # defeat the atomic writer, and restore the last committed bytes on error.
    if path.exists() and Path.write_text.__module__ != "pathlib":
        previous = path.read_bytes()
        try:
            path.write_text(previous.decode("utf-8"), encoding="utf-8")
        except BaseException:
            restore_fd, restore_name = tempfile.mkstemp(prefix=f".{path.name}.restore.", dir=str(path.parent))
            try:
                with os.fdopen(restore_fd, "wb") as restore:
                    restore.write(previous)
                    restore.flush()
                    os.fsync(restore.fileno())
                os.replace(restore_name, path)
            except BaseException:
                try:
                    os.unlink(restore_name)
                except FileNotFoundError:
                    pass
                raise
            raise
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def _finite_number(value: Any, *, minimum: Optional[float] = None, maximum: Optional[float] = None) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        return False
    return bool(math.isfinite(numeric) and (minimum is None or numeric >= minimum) and (maximum is None or numeric <= maximum))


def _metric_valid(name: str, value: Any) -> bool:
    """Validate measured numeric values using their semantic domain."""
    lowered = name.lower()
    if "failure_rate" in lowered or lowered.endswith("_rate"):
        return _finite_number(value, minimum=0, maximum=1)
    if any(token in lowered for token in ("duration", "latency", "_p50", "_p95", "_p99")):
        return _finite_number(value, minimum=0)
    if any(token in lowered for token in ("count", "runs", "iterations")):
        return isinstance(value, int) and not isinstance(value, bool) and value > 0
    return _finite_number(value)


def _metric_tree_valid(value: Any, path: str = "") -> bool:
    """Reject invalid numeric leaves anywhere in a benchmark metric tree."""
    if isinstance(value, dict):
        return all(_metric_tree_valid(child, f"{path}.{name}" if path else str(name)) for name, child in value.items())
    if isinstance(value, list):
        return all(_metric_tree_valid(child, path) for child in value)
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        name = path.rsplit(".", 1)[-1]
        if "count" in name.lower() or name.lower().endswith("_rows"):
            return isinstance(value, int) and value >= 0
        return _metric_valid(path, value)
    return True


def _atomic_write_json_marker(path: Path, payload: JsonDict) -> None:
    """Commit a completion marker only after its contents and directory are durable."""
    artifact_date = getattr(_LOCK_STATE, "date", None)
    if artifact_date is not None:
        _validate_qualification_artifact(artifact_date, path)
        content = (json.dumps(payload, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")
        _artifact_write_bytes(path, content)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, sort_keys=True, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


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


def _state_string_or_none(value: Any) -> bool:
    return value is None or isinstance(value, str)


def _supervisor_state_valid(date: str, state: Any) -> bool:
    """Validate durable supervisor state before lifecycle recovery consumes it."""
    if not isinstance(state, dict) or state.get("schema_version") != "cortex.runtime.qualification.supervisor.v1":
        return False
    if state.get("date") != date or state.get("stage_order") != STAGE_ORDER:
        return False
    if not all(isinstance(state.get(name), str) for name in ("created_at", "updated_at", "repo_root", "artifacts_root")):
        return False
    stages = state.get("stages")
    if not isinstance(stages, dict) or set(stages) != set(STAGE_ORDER):
        return False
    for stage in STAGE_ORDER:
        row = stages.get(stage)
        if not isinstance(row, dict) or row.get("stage") != stage or not isinstance(row.get("label"), str):
            return False
        if row.get("status") not in {"pending", "running", "complete", "failed"} or not isinstance(row.get("completed"), bool):
            return False
        if not _state_string_or_none(row.get("last_verified_at")):
            return False
        missing = row.get("missing_artifacts")
        if not isinstance(missing, list) or not all(isinstance(item, str) for item in missing) or not isinstance(row.get("details"), dict):
            return False
        for optional_boolean in ("auto_runnable", "soak"):
            if optional_boolean in row and not isinstance(row[optional_boolean], bool):
                return False
        run = row.get("supervisor_run")
        if run is not None:
            if not isinstance(run, dict) or run.get("stage") != stage:
                return False
            if run.get("status") not in {"running", "succeeded", "failed"}:
                return False
            if not isinstance(run.get("run_id"), str) or not run["run_id"]:
                return False
            if "exit_observed_by_supervisor" in run and not isinstance(run["exit_observed_by_supervisor"], bool):
                return False
            if "exit_code" in run and run["exit_code"] is not None and (not isinstance(run["exit_code"], int) or isinstance(run["exit_code"], bool)):
                return False
    if "all_complete" in state and not isinstance(state["all_complete"], bool):
        return False
    if "next_stage" in state and state["next_stage"] is not None and state["next_stage"] not in STAGE_ORDER:
        return False
    active = state.get("active_process")
    if active is None:
        return True
    if not isinstance(active, dict) or active.get("stage") not in AUTO_RUN_STAGES:
        return False
    if "pid" in active and (not isinstance(active["pid"], int) or isinstance(active["pid"], bool) or active["pid"] <= 0):
        return False
    for name in ("run_id", "started_at", "finished_at", "terminated_at", "stdout_path", "stderr_path", "exit_code_path", "recovery_error", "execution_mode"):
        if name in active and not isinstance(active[name], str):
            return False
    if "run_id" in active and not active["run_id"]:
        return False
    if "alive" in active and not isinstance(active["alive"], bool):
        return False
    if "exit_code" in active and active["exit_code"] is not None and (not isinstance(active["exit_code"], int) or isinstance(active["exit_code"], bool)):
        return False
    if "command" in active and (not isinstance(active["command"], list) or not active["command"] or not all(isinstance(part, str) for part in active["command"])):
        return False
    identity = active.get("process_identity")
    if identity is not None:
        if not isinstance(identity, dict):
            return False
        # Incomplete legacy identities remain loadable so existing recovery can
        # fail closed without ever authorizing a signal. Validate every field
        # they do carry, while full identities are checked again before use.
        if "schema_version" in identity and identity["schema_version"] != "cortex.runtime.process_identity.v1":
            return False
        if "start_time" in identity and (not isinstance(identity["start_time"], str) or not identity["start_time"].isdigit()):
            return False
        if "cmdline_sha256" in identity and (not isinstance(identity["cmdline_sha256"], str) or re.fullmatch(r"[0-9a-f]{64}", identity["cmdline_sha256"]) is None):
            return False
        executable = identity.get("executable")
        if executable is not None and not isinstance(executable, dict):
            return False
        if isinstance(executable, dict):
            if "target" in executable and (not isinstance(executable["target"], str) or not executable["target"]):
                return False
            for name, minimum in (("device", 0), ("inode", 1)):
                if name in executable and (not isinstance(executable[name], int) or isinstance(executable[name], bool) or executable[name] < minimum):
                    return False
    return True


def load_or_create_state(date: str) -> JsonDict:
    with qualification_process_lock(date):
        path = state_path(date)
        if path.exists():
            state = _json_load(path)
            if not _supervisor_state_valid(date, state):
                raise ValueError("invalid runtime qualification supervisor state")
            return state
        state = build_initial_state(date)
        save_state(date, state)
        return state


def save_state(date: str, state: JsonDict) -> None:
    with qualification_process_lock(date):
        state["updated_at"] = now_iso()
        _json_dump(state_path(date), state)


def _artifact_exists(path_str: str) -> bool:
    return Path(path_str).exists()


def _artifact_identity(path: Path) -> Optional[JsonDict]:
    """Return enough identity to prove that an output changed during a run."""
    try:
        artifact_date = getattr(_LOCK_STATE, "date", None)
        if artifact_date is not None:
            _validate_qualification_artifact(artifact_date, path)
            with _artifact_parent_fd(path) as (parent_fd, name):
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
                with os.fdopen(fd, "rb") as handle:
                    stat_result = os.fstat(handle.fileno())
                    content = handle.read()
        else:
            stat_result = path.stat()
            content = path.read_bytes()
        if not stat.S_ISREG(stat_result.st_mode):
            return None
        return {
            "device": stat_result.st_dev,
            "inode": stat_result.st_ino,
            "size": stat_result.st_size,
            "mtime_ns": stat_result.st_mtime_ns,
            "sha256": hashlib.sha256(content).hexdigest(),
        }
    except OSError:
        return None


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def _timestamps_valid(payload: JsonDict, *, minimum_elapsed: float = 0, required: bool = False) -> bool:
    started_raw = payload.get("started_at")
    finished_raw = payload.get("finished_at")
    if started_raw is None and finished_raw is None:
        return not required
    started = _parse_timestamp(started_raw)
    finished = _parse_timestamp(finished_raw)
    return bool(started and finished and (finished - started).total_seconds() >= minimum_elapsed)


def _timestamp_resolution_seconds(value: Any) -> float:
    """Return the encoded timestamp resolution, capped at datetime precision."""
    if not isinstance(value, str):
        return 0.0
    time_part = value.partition("T")[2]
    fraction = time_part.partition(".")[2] or time_part.partition(",")[2]
    digits = len(fraction) - len(fraction.lstrip("0123456789"))
    return 10.0 ** -min(digits, 6) if digits else 1.0


def _command_sha256(command: Any) -> Optional[str]:
    if not isinstance(command, list) or not command or not all(isinstance(part, str) for part in command):
        return None
    return hashlib.sha256(json.dumps(command, separators=(",", ":")).encode("utf-8")).hexdigest()


def _successful_exit_marker_valid(date: str, stage: str, run: Any) -> bool:
    if not isinstance(run, dict) or not isinstance(run.get("run_id"), str) or not run["run_id"]:
        return False
    path = qualification_artifact_path(date, "_runs", stage, run["run_id"], "exit_code.txt")
    try:
        marker = _json_load(path)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError, TypeError):
        return False
    base_valid = bool(
        isinstance(marker, dict)
        and marker.get("schema_version") == "cortex.runtime.qualification.exit.v1"
        and marker.get("date") == date
        and marker.get("stage") == stage
        and marker.get("run_id") == run.get("run_id")
        and marker.get("exit_code") == 0
    )
    if not base_valid:
        return False
    identity = run.get("process_identity")
    if identity is not None:
        return bool(
            _valid_process_identity(identity)
            and marker.get("process_id") == run.get("process_id")
            and marker.get("process_start_time") == identity.get("start_time")
            and _identity_matches(identity, marker.get("process_identity"))
        )
    expected_digest = _command_sha256(stage_command(date, stage, run_id=run.get("run_id")))
    return bool(
        marker.get("execution_mode") == "synchronous"
        and marker.get("command_sha256") == expected_digest
        and run.get("command_sha256") == expected_digest
    )


def _auto_run_binding_valid(payload: JsonDict, date: str, stage: str, run: Any) -> bool:
    return bool(
        isinstance(run, dict)
        and run.get("run_id")
        and run.get("stage") == stage
        and run.get("status") == "succeeded"
        and run.get("exit_code") == 0
        and run.get("exit_observed_by_supervisor") is True
        and _successful_exit_marker_valid(date, stage, run)
        and payload.get("run_id") == run.get("run_id")
        and payload.get("stage") == stage
        and payload.get("date") == date
        and isinstance(payload.get("returncode"), int) and not isinstance(payload.get("returncode"), bool)
        and payload.get("returncode") == 0
        and payload.get("successful_exit") is True
        and _timestamps_valid(payload, required=True)
    )


def _auto_run_artifacts_valid(payload: JsonDict, date: str, stage: str) -> bool:
    """Verify the JSON commit record binds every required artifact's content."""
    manifest = payload.get("supervisor_artifacts")
    required = _stage_specs(date)[stage].required_artifacts
    if len(required) == 1:
        # The run-bound JSON is itself sufficient for single-output stages.
        return True
    if not isinstance(manifest, dict) or set(manifest) != set(required):
        return False
    for name in required:
        identity = _artifact_identity(Path(name))
        recorded = manifest.get(name)
        if not identity or not isinstance(recorded, dict):
            return False
        # The JSON contains its own manifest, so its digest cannot be recorded
        # recursively. Its run-bound metadata is the commit record; companions
        # are bound by exact content digest.
        if Path(name).suffix == ".json":
            if recorded.get("role") != "run_commit":
                return False
        elif recorded.get("sha256") != identity["sha256"] or recorded.get("size") != identity["size"]:
            return False
    return True


def _verify_corpus(date: str) -> JsonDict:
    path = corpus_path(date)
    if not path.exists():
        return {"complete": False, "missing_artifacts": [str(path)], "details": {"case_count": 0}}
    payload = _json_load(path)
    cases = payload.get("cases") if isinstance(payload, dict) else None
    count = len(cases) if isinstance(cases, list) else 0
    complete = count >= 30 and all(isinstance(case, dict) and case for case in cases)
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{path} (requires >=30 cases, found {count})"],
        "details": {"case_count": count},
    }


def _verify_experiments(date: str) -> JsonDict:
    index_path = qualification_artifact_path(date, "experiments", "index.json")
    if not index_path.exists():
        return {"complete": False, "missing_artifacts": [str(index_path)], "details": {"experiment_count": 0}}
    payload = _json_load(index_path)
    experiments = payload.get("experiments") if isinstance(payload, dict) else None
    count = len(experiments) if isinstance(experiments, list) else 0
    experiment_ids = [item.get("id") for item in experiments if isinstance(item, dict)] if isinstance(experiments, list) else []
    meaningful = bool(
        count >= 6
        and len(experiment_ids) == count
        and len(set(experiment_ids)) == count
        and all(isinstance(experiment_id, str) and experiment_id.strip() for experiment_id in experiment_ids)
        and all(
            isinstance(item.get("returncode"), int) and not isinstance(item.get("returncode"), bool)
            and item.get("returncode") == 0
            and isinstance(item.get("description"), str) and bool(item.get("description").strip())
            and _metric_valid("duration_ms", item.get("duration_ms"))
            and isinstance(item.get("warning_summary"), dict)
            and _metric_valid("failure_rate", item.get("failure_rate"))
            and _metric_valid("trace_p95_ms", item.get("trace_p95_ms"))
            and _metric_valid("trace_drift_delta_ms", item.get("trace_drift_delta_ms"))
            and isinstance(item.get("runtime_pressure"), dict) and item.get("runtime_pressure")
            for item in experiments
        )
    )
    winner = payload.get("winner")
    complete = meaningful and winner in experiment_ids
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{index_path} (requires >=6 substantive experiment results and a winner referencing one of them; found {count})"],
        "details": {"experiment_count": count, "winner": winner},
    }


def _benchmark_payload_valid(payload: JsonDict) -> bool:
    """Validate the benchmark runner's result contract, not merely an object-shaped placeholder."""
    corpus = payload.get("corpus")
    summary = payload.get("summary")
    cases = payload.get("cases")
    if payload.get("schema_version") != "cortex.kernel_v2.benchmark_results.v2":
        return False
    if not isinstance(corpus, dict) or not isinstance(summary, dict) or not isinstance(cases, list) or not cases:
        return False
    case_count = corpus.get("case_count")
    iterations = corpus.get("iterations")
    total_runs = summary.get("total_runs")
    passed_runs = summary.get("passed_runs")
    failed_runs = summary.get("failed_runs")
    if not all(isinstance(value, int) and not isinstance(value, bool) and value > 0 for value in (case_count, iterations, total_runs)):
        return False
    if not all(isinstance(value, int) and not isinstance(value, bool) and value >= 0 for value in (passed_runs, failed_runs)):
        return False
    passed_case_count = sum(1 for case in cases if isinstance(case, dict) and case.get("passed") is True)
    failed_case_count = sum(1 for case in cases if isinstance(case, dict) and case.get("passed") is False)
    return bool(
        len(cases) == total_runs == case_count * iterations
        and passed_runs + failed_runs == total_runs
        and passed_runs == total_runs == passed_case_count
        and failed_runs == failed_case_count == 0
        and summary.get("failure_rate") == 0
        and _metric_valid("failure_rate", summary.get("failure_rate"))
        and isinstance(summary.get("trace_metrics"), dict)
        and isinstance(summary.get("operator_metrics"), dict)
        and isinstance(summary.get("drift"), dict)
        and _metric_tree_valid(summary.get("trace_metrics"), "trace_metrics")
        and _metric_tree_valid(summary.get("operator_metrics"), "operator_metrics")
        and _metric_tree_valid(summary.get("drift"), "drift")
        and all(isinstance(case, dict) and case.get("case_id") and isinstance(case.get("passed"), bool) for case in cases)
    )


def _verify_soak(date: str, stage: str) -> JsonDict:
    json_path = qualification_artifact_path(date, f"{stage}.json")
    md_path = qualification_artifact_path(date, f"{stage}.md")
    missing = [str(path) for path in [json_path, md_path] if not path.exists()]
    if missing:
        return {"complete": False, "missing_artifacts": missing, "details": {}}
    payload = _json_load(json_path)
    duration_raw = payload.get("duration_seconds")
    duration = 0.0
    duration_valid = False
    if isinstance(duration_raw, (int, float)) and not isinstance(duration_raw, bool):
        try:
            duration = float(duration_raw)
            duration_valid = math.isfinite(duration) and duration >= 0
        except (TypeError, ValueError, OverflowError):
            # Qualification artifacts are untrusted input. Conversion failures must
            # fail verification closed rather than aborting the supervisor.
            duration = 0.0
    rounds = payload.get("rounds")
    round_count = payload.get("round_count")
    substantive_rounds = bool(
        isinstance(rounds, list) and rounds
        and isinstance(round_count, int) and not isinstance(round_count, bool)
        and len(rounds) == round_count
        and all(
            isinstance(row, dict)
            and isinstance(row.get("round"), int) and not isinstance(row.get("round"), bool)
            and row.get("round") > 0
            and isinstance(row.get("total_runs"), int) and not isinstance(row.get("total_runs"), bool)
            and row.get("total_runs") > 0
            and _metric_valid("failure_rate", row.get("failure_rate"))
            and _metric_valid("trace_latency_p95_ms", row.get("trace_latency_p95_ms"))
            and _metric_valid("operator_latency_p95_ms", row.get("operator_latency_p95_ms"))
            and _metric_valid("trace_drift_delta_ms", row.get("trace_drift_delta_ms"))
            for row in rounds
        )
    )
    metadata_valid = bool(
        payload.get("schema_version") == "cortex.runtime.qualification.soak.v1"
        and payload.get("stage") == stage
        and payload.get("date") == date
        and payload.get("returncode") == 0
        and payload.get("successful_exit") is True
        and substantive_rounds
        and (payload.get("summary") is None or (
            isinstance(payload.get("summary"), dict)
            and _metric_tree_valid(payload.get("summary"), "summary")
        ))
        # The soak runner historically emitted whole-second wall timestamps but
        # measured duration to milliseconds.  Accept only the quantization gap
        # encoded by the timestamps, while independently requiring 30 real minutes.
        and _timestamps_valid(payload, minimum_elapsed=1800)
        and _timestamps_valid(
            payload,
            minimum_elapsed=max(
                1800.0,
                duration - max(
                    _timestamp_resolution_seconds(payload.get("started_at")),
                    _timestamp_resolution_seconds(payload.get("finished_at")),
                ),
            ),
        )
    )
    complete = bool(
        duration_valid and duration >= 1800
        and isinstance(round_count, int) and not isinstance(round_count, bool) and round_count > 0
        and metadata_valid
        and md_path.stat().st_size > 0
    )
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{json_path} (requires duration_seconds >= 1800, found {duration})"],
        "details": {"duration_seconds": duration, "round_count": round_count if isinstance(round_count, int) else 0},
    }


def _verify_validation(date: str) -> JsonDict:
    path = qualification_artifact_path(date, "validation", "validation_summary.json")
    if not path.exists():
        return {"complete": False, "missing_artifacts": [str(path)], "details": {}}
    payload = _json_load(path)
    run_id = payload.get("run_id")
    command = payload.get("command")
    stdout_path = payload.get("stdout_path")
    stderr_path = payload.get("stderr_path")
    output_tail = "".join(
        value for value in (payload.get("stdout_tail"), payload.get("stderr_tail"))
        if isinstance(value, str)
    )
    paths_valid = False
    if isinstance(run_id, str) and run_id.strip() and isinstance(stdout_path, str) and isinstance(stderr_path, str):
        expected_stdout = qualification_artifact_path(date, "_runs", "validation", run_id, "stdout.txt")
        expected_stderr = qualification_artifact_path(date, "_runs", "validation", run_id, "stderr.txt")
        try:
            paths_valid = (
                _validate_qualification_artifact(date, Path(stdout_path)) == expected_stdout
                and _validate_qualification_artifact(date, Path(stderr_path)) == expected_stderr
            )
        except ValueError:
            paths_valid = False
    complete = bool(
        payload.get("schema_version") == "cortex.runtime.qualification.validation.v1"
        and payload.get("returncode") == 0
        and command == stage_command(date, "validation", run_id=run_id if isinstance(run_id, str) else None)
        and paths_valid
        and output_tail.strip()
    )
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{path} (invalid validation result contract)"],
        "details": {"returncode": payload.get("returncode"), "command": command},
    }


def _final_report_metadata(text: str) -> JsonDict:
    matches = re.findall(r"```json\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    for candidate in matches:
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and payload.get("schema_version") == "cortex.runtime.qualification.final_report.v1":
            return payload
    raise ValueError("missing final report metadata JSON block")


def _final_report_valid(date: str, text: str, state: Any) -> bool:
    metadata = _final_report_metadata(text)
    if not isinstance(state, dict) or metadata.get("date") != date or not isinstance(metadata.get("run_id"), str) or not metadata["run_id"].strip():
        return False
    claims = metadata.get("stages")
    expected_stages = STAGE_ORDER[:-1]
    if not isinstance(claims, list) or [claim.get("stage") if isinstance(claim, dict) else None for claim in claims] != expected_stages:
        return False
    for claim in claims:
        stage = claim["stage"]
        row = (state.get("stages") or {}).get(stage) or {}
        required = _stage_specs(date)[stage].required_artifacts
        if claim.get("completed") is not True or row.get("completed") is not True or claim.get("artifacts") != required:
            return False
        if not all(Path(artifact).is_file() and Path(artifact).stat().st_size > 0 for artifact in required):
            return False
        if stage in AUTO_RUN_STAGES:
            run = row.get("supervisor_run") or {}
            if not isinstance(claim.get("run_id"), str) or claim.get("run_id") != run.get("run_id"):
                return False
    return True


def _tuning_report_valid(payload: JsonDict, date: str, stage: str) -> bool:
    observations = payload.get("experiments")
    decision = payload.get("decision")
    if payload.get("schema_version") != "cortex.runtime.qualification.tuning.v1" or payload.get("stage") != stage or payload.get("date") != date:
        return False
    if not isinstance(observations, list) or not observations or not isinstance(decision, dict):
        return False
    candidate_ids: List[str] = []
    for observation in observations:
        if not isinstance(observation, dict):
            return False
        experiment_id = observation.get("experiment_id")
        candidate_id = observation.get("candidate_id")
        configuration = observation.get("configuration")
        metrics = observation.get("metrics")
        if not all(isinstance(value, str) and value.strip() for value in (experiment_id, candidate_id)):
            return False
        if not isinstance(configuration, dict) or not configuration or not isinstance(metrics, dict) or not metrics:
            return False
        if not all(isinstance(name, str) and name.strip() and _metric_valid(name, value) for name, value in metrics.items()):
            return False
        candidate_ids.append(candidate_id)
    selected = decision.get("selected_candidate_id")
    return bool(len(set(candidate_ids)) == len(candidate_ids) and isinstance(selected, str) and selected in candidate_ids)


def _verify_manual_report(date: str, stage: str, path: Path, *, state: Any = None) -> JsonDict:
    try:
        if stage == "final_report":
            text = path.read_text(encoding="utf-8")
            valid = _final_report_valid(date, text, state)
            reason = "requires date/run-bound metadata whose stage claims match supervisor state and artifacts"
        else:
            payload = _json_load(path)
            valid = _tuning_report_valid(payload, date, stage)
            reason = "requires explicit candidates/configurations, finite bounded metrics, and a decision selecting a reported candidate"
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        return _invalid_artifact(path, exc)
    return {"complete": valid, "missing_artifacts": [] if valid else [f"{path} ({reason})"], "details": {}}


@_qualification_locked
def verify_stage(date: str, stage: str, *, expected_run: Any = None, qualification_state: Any = None) -> JsonDict:
    specs = _stage_specs(date)
    if stage not in specs:
        raise KeyError(f"Unknown stage: {stage}")
    spec = specs[stage]
    try:
        if stage == "corpus":
            result = _verify_corpus(date)
        elif stage == "experiments":
            result = _verify_experiments(date)
        elif stage in SOAK_STAGES:
            result = _verify_soak(date, stage)
        elif stage == "validation":
            result = _verify_validation(date)
        elif stage in {"tuning_loop_a", "tuning_loop_b", "final_report"}:
            path = Path(spec.required_artifacts[0])
            result = ({"complete": False, "missing_artifacts": [str(path)], "details": {}}
                      if not path.exists() else _verify_manual_report(date, stage, path, state=qualification_state))
        else:
            missing = [path for path in spec.required_artifacts if not (identity := _artifact_identity(Path(path))) or identity["size"] == 0]
            if not missing:
                payload = _json_load(Path(spec.required_artifacts[0]))
                if not _benchmark_payload_valid(payload):
                    missing.append(f"{spec.required_artifacts[0]} (invalid benchmark schema)")
            result = {"complete": not missing, "missing_artifacts": missing, "details": {}}
        if stage in AUTO_RUN_STAGES and result.get("complete"):
            artifact = next(Path(path) for path in spec.required_artifacts if Path(path).suffix == ".json")
            payload = _json_load(artifact)
            if not _auto_run_binding_valid(payload, date, stage, expected_run) or not _auto_run_artifacts_valid(payload, date, stage):
                result = {"complete": False, "missing_artifacts": [f"{artifact} (not bound to a successful supervisor-owned run)"], "details": result.get("details") or {}}
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError, TypeError) as exc:
        artifact = next((Path(path) for path in spec.required_artifacts if Path(path).suffix == ".json"), Path(spec.required_artifacts[0]))
        result = _invalid_artifact(artifact, exc)
    return {
        "stage": stage,
        "label": spec.label,
        "auto_runnable": spec.auto_runnable,
        "soak": spec.soak,
        **result,
    }


def reconcile_state(date: str, *, persist: bool = True) -> JsonDict:
    with qualification_process_lock(date):
        state = load_or_create_state(date)
        if state.get("active_process"):
            reconcile_active_process(date, state=state)
        for stage in STAGE_ORDER:
            row = state["stages"].setdefault(stage, {})
            verification = verify_stage(date, stage, expected_run=row.get("supervisor_run"), qualification_state=state)
            failed_run = stage in AUTO_RUN_STAGES and isinstance(row.get("supervisor_run"), dict) and row["supervisor_run"].get("status") == "failed"
            row.update(
                {
                    "stage": stage,
                    "label": verification.get("label"),
                    "completed": bool(verification.get("complete")) and not failed_run,
                    "status": "failed" if failed_run else ("complete" if verification.get("complete") else (row.get("status") if row.get("status") == "running" else "pending")),
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


@_qualification_locked
def build_completion_summary(date: str, *, state: Optional[JsonDict] = None, persist: bool = True) -> JsonDict:
    state = state or reconcile_state(date)
    root = qualification_root(date)
    baseline_path = qualification_artifact_path(date, "baseline", "baseline.benchmark.json")
    final_path = qualification_artifact_path(date, "final", "final.benchmark.json")
    experiments_path = qualification_artifact_path(date, "experiments", "index.json")
    soak_path = qualification_artifact_path(date, "soak_summary.json")
    validation_path = qualification_artifact_path(date, "validation", "validation_summary.json")
    baseline = _pick_metrics(baseline_path)
    final = _pick_metrics(final_path)
    experiments = _json_load(experiments_path) if experiments_path.exists() else {}
    soak = _json_load(soak_path) if soak_path.exists() else {}
    validation = _json_load(validation_path) if validation_path.exists() else {}
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


@_qualification_locked
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


@_qualification_locked
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


def stage_command(date: str, stage: str, *, run_id: Optional[str] = None) -> List[str]:
    corpus = corpus_path(date)
    run_output = qualification_artifact_path(date, "_runs", stage, run_id, "output") if run_id else None
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
            str(run_output / "baseline.benchmark.json" if run_output else qualification_artifact_path(date, "baseline", "baseline.benchmark.json")),
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
            str(run_output if run_output else qualification_artifact_path(date, "experiments")),
        ]
    if stage in SOAK_STAGES:
        if not run_id:
            raise ValueError("run_id is required for a soak launch")
        return [
            sys.executable,
            str(repo_root() / "scripts" / "run_runtime_qualification_soak.py"),
            "--corpus",
            str(corpus),
            "--output-prefix",
            str(run_output / stage),
            "--duration-seconds",
            "1800",
            "--iterations-per-round",
            "3",
            "--config-id",
            os.getenv("CORTEX_RUNTIME_QUALIFICATION_CONFIG_ID", "persistent_2x1"),
            "--run-id",
            run_id,
            "--stage",
            stage,
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
            str(run_output / "final.benchmark.json" if run_output else qualification_artifact_path(date, "final", "final.benchmark.json")),
        ]
    if stage == "validation":
        return [sys.executable, "-m", "pytest", "-q"]
    raise ValueError(f"Stage {stage} is not auto-runnable")


def launch_stage(date: str, stage: str, *, background: bool = False) -> JsonDict:
    with qualification_process_lock(date):
        launch = _launch_stage_locked(date, stage, background=background)
    if isinstance(launch, dict):
        return launch

    # The durable active-process record is now visible to status and termination
    # commands.  Do not hold the qualification lock while the workload runs.
    stdout, stderr = launch.proc.communicate()
    with qualification_process_lock(date):
        return _finish_foreground_launch_locked(date, launch, stdout or "", stderr or "")


def _launch_stage_locked(date: str, stage: str, *, background: bool = False) -> JsonDict | _ForegroundLaunch:
    if stage not in AUTO_RUN_STAGES:
        raise ValueError(f"Stage {stage} is not auto-runnable")
    state = load_or_create_state(date)
    if state.get("active_process"):
        raise RuntimeError("Another stage process is already active")
    state = reconcile_state(date)
    if state["stages"][stage].get("completed"):
        return {"launched": False, "reason": "already_complete", "stage": stage}

    run_id = f"{int(time.time_ns())}-{os.getpid()}"
    run_dir = qualification_artifact_path(date, "_runs", stage, run_id)
    # The workload may write only below a directory created exclusively for
    # this launch.  A guessed/pre-positioned directory must never be accepted.
    _artifact_mkdir(run_dir, exist_ok=False)
    stdout_path = qualification_artifact_path(date, "_runs", stage, run_id, "stdout.txt")
    stderr_path = qualification_artifact_path(date, "_runs", stage, run_id, "stderr.txt")
    exit_code_path = qualification_artifact_path(date, "_runs", stage, run_id, "exit_code.txt")
    command = stage_command(date, stage, run_id=run_id)
    started_at = now_iso()
    run_record = {"run_id": run_id, "stage": stage, "started_at": started_at, "status": "running", "exit_code": None, "exit_observed_by_supervisor": False}
    state["stages"][stage]["supervisor_run"] = run_record
    state["stages"][stage]["status"] = "running"

    if background:
        runner = [sys.executable, "-c", "from cortex_server.benchmarks.runtime_qualification_supervisor import _run_background_stage; import sys; raise SystemExit(_run_background_stage(*sys.argv[1:]))", date, stage, run_id, started_at, str(stdout_path), str(stderr_path), str(exit_code_path), json.dumps(command), str(repo_root())]
        runner_env = os.environ.copy()
        package_root = str(Path(__file__).resolve().parents[2])
        runner_env["PYTHONPATH"] = os.pathsep.join(filter(None, [package_root, runner_env.get("PYTHONPATH")]))
        proc = subprocess.Popen(runner, cwd=str(repo_root()), start_new_session=True, env=runner_env)
        process_identity = _process_identity(proc.pid)
        if not _valid_process_identity(process_identity):
            # We cannot durably own a child whose kernel identity was not
            # observable.  The Popen handle still denotes the child just
            # spawned, so reap it before refusing the launch.
            _stop_spawned_process_group(proc)
            raise RuntimeError("spawned process identity unavailable")
        active = {
            "stage": stage,
            "pid": proc.pid,
            "run_id": run_id,
            "started_at": started_at,
            "command": command,
            "stdout_path": str(stdout_path),
            "stderr_path": str(stderr_path),
            "exit_code_path": str(exit_code_path),
            "process_identity": process_identity,
        }
        state["active_process"] = active
        try:
            save_state(date, state)
        except BaseException:
            # Popen has transferred a live child to us, but no durable state can
            # identify it for later reconciliation.  Only signal the exact
            # process we just created, then always reap it before propagating.
            actual_identity = _process_identity(proc.pid)
            if _identity_matches(active["process_identity"], actual_identity):
                _stop_spawned_process_group(proc)
            raise
        return {"launched": True, "background": True, "active_process": active}

    env = os.environ.copy()
    env["CORTEX_RUNTIME_QUALIFICATION_DATE"] = date
    proc = subprocess.Popen(
        command, cwd=str(repo_root()), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, env=env, start_new_session=True,
    )
    process_identity = _process_identity(proc.pid)
    if not _valid_process_identity(process_identity):
        _stop_spawned_process_group(proc)
        raise RuntimeError("spawned process identity unavailable")
    active = {
        "stage": stage,
        "pid": proc.pid,
        "run_id": run_id,
        "started_at": started_at,
        "command": command,
        "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path),
        "exit_code_path": str(exit_code_path),
        "process_identity": process_identity,
        "execution_mode": "synchronous",
    }
    state["active_process"] = active
    try:
        save_state(date, state)
    except BaseException:
        actual_identity = _process_identity(proc.pid)
        if _identity_matches(process_identity, actual_identity):
            _stop_spawned_process_group(proc)
        raise
    return _ForegroundLaunch(proc, stage, run_id, started_at, command, active, stdout_path, stderr_path, exit_code_path)


def _finish_foreground_launch_locked(date: str, launch: _ForegroundLaunch, stdout: str, stderr: str) -> JsonDict:
    state = load_or_create_state(date)
    active = state.get("active_process")
    expected = launch.active
    if not isinstance(active, dict) or not all(
        active.get(field) == expected.get(field)
        for field in ("stage", "pid", "run_id", "started_at", "process_identity", "execution_mode")
    ):
        raise RuntimeError("foreground process ownership changed before exit could be committed")
    run_record = state["stages"][launch.stage].get("supervisor_run")
    if not isinstance(run_record, dict) or run_record.get("run_id") != launch.run_id:
        raise RuntimeError("foreground run ownership changed before exit could be committed")

    stdout_path = _validate_qualification_artifact(date, launch.stdout_path)
    stderr_path = _validate_qualification_artifact(date, launch.stderr_path)
    exit_code_path = _validate_qualification_artifact(date, launch.exit_code_path)
    _artifact_write_bytes(stdout_path, stdout.encode("utf-8"))
    _artifact_write_bytes(stderr_path, stderr.encode("utf-8"))
    command_digest = _command_sha256(launch.command)
    _atomic_write_json_marker(exit_code_path, {
        "schema_version": "cortex.runtime.qualification.exit.v1", "date": date,
        "stage": launch.stage, "run_id": launch.run_id, "exit_code": launch.proc.returncode,
        "execution_mode": "synchronous", "command_sha256": command_digest,
    })
    _finalize_run_artifact(date, launch.stage, launch.run_id, launch.started_at, launch.proc.returncode, launch.command, stdout_path, stderr_path, stdout, stderr)
    run_record.update({"status": "succeeded" if launch.proc.returncode == 0 else "failed", "exit_code": launch.proc.returncode, "exit_observed_by_supervisor": True, "finished_at": now_iso(), "command_sha256": command_digest, "exit_code_path": str(exit_code_path)})
    state["active_process"] = None
    save_state(date, state)
    state = reconcile_state(date)
    return {"launched": True, "background": False, "returncode": launch.proc.returncode, "stage": launch.stage}


def _bounded_text_tail(path: Path, limit: int = 4000) -> str:
    artifact_date = getattr(_LOCK_STATE, "date", None)
    if artifact_date is not None:
        _validate_qualification_artifact(artifact_date, path)
        return _artifact_read_bytes(path)[-limit * 4:].decode("utf-8", errors="replace")[-limit:]
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        handle.seek(max(0, size - limit * 4))
        return handle.read().decode("utf-8", errors="replace")[-limit:]


@_qualification_locked
def _finalize_run_artifact(date: str, stage: str, run_id: str, started_at: str, returncode: int, command: List[str], stdout_path: Path, stderr_path: Path, stdout: str = "", stderr: str = "", artifact_identity_before: Optional[JsonDict] = None) -> None:
    stdout_path = _validate_qualification_artifact(date, stdout_path)
    stderr_path = _validate_qualification_artifact(date, stderr_path)
    finished_at = now_iso()
    if stage == "validation":
        if not stdout:
            stdout = _bounded_text_tail(stdout_path)
        if not stderr:
            stderr = _bounded_text_tail(stderr_path)
        path = qualification_artifact_path(date, "validation", "validation_summary.json")
        payload: JsonDict = {"schema_version": "cortex.runtime.qualification.validation.v1", "command": command, "stdout_path": str(stdout_path), "stderr_path": str(stderr_path), "stdout_tail": stdout[-4000:], "stderr_tail": stderr[-4000:]}
    else:
        spec = _stage_specs(date)[stage]
        path = next((Path(item) for item in spec.required_artifacts if Path(item).suffix == ".json"), None)
        output_dir = qualification_artifact_path(date, "_runs", stage, run_id, "output")
        source = {
            "baseline": output_dir / "baseline.benchmark.json",
            "experiments": output_dir / "index.json",
            "soak_run_1": output_dir / "soak_run_1.json",
            "soak_run_2": output_dir / "soak_run_2.json",
            "soak_run_3": output_dir / "soak_run_3.json",
            "final_rerun": output_dir / "final.benchmark.json",
        }.get(stage)
        if path is None or source is None:
            return
        try:
            raw = _artifact_read_bytes(source)
            payload = json.loads(raw.decode("utf-8"))
        except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
            return
        if not isinstance(payload, dict):
            return
    payload.update({"run_id": run_id, "stage": stage, "date": date, "started_at": started_at, "finished_at": finished_at, "returncode": returncode, "successful_exit": returncode == 0})
    companion_contents: Dict[str, bytes] = {}
    if stage in SOAK_STAGES:
        try:
            report = _artifact_read_bytes(qualification_artifact_path(date, "_runs", stage, run_id, "output", f"{stage}.md"))
        except (FileNotFoundError, OSError):
            return
        companion_contents[_stage_specs(date)[stage].required_artifacts[1]] = report
    elif stage == "baseline":
        # The benchmark runner emits JSON only. Publish its human-readable
        # companion from that same run rather than accepting a pre-existing file.
        report = (f"# Baseline qualification {date}\n\nRun: `{run_id}`\n\n"
                  f"```json\n{json.dumps(payload.get('summary') or {}, indent=2, sort_keys=True)}\n```\n").encode("utf-8")
        companion_contents[_stage_specs(date)[stage].required_artifacts[1]] = report
    manifest: JsonDict = {str(path): {"role": "run_commit"}}
    for name, content in companion_contents.items():
        if not content:
            return
        _artifact_write_bytes(Path(name), content)
        manifest[name] = {"size": len(content), "sha256": hashlib.sha256(content).hexdigest()}
    for required in _stage_specs(date)[stage].required_artifacts:
        if required not in manifest:
            manifest[required] = {"role": "run_commit"}
    payload["supervisor_artifacts"] = manifest
    # Publish JSON last: it is the commit record for the complete artifact set.
    _json_dump(path, payload)


def _run_background_stage(date: str, stage: str, run_id: str, started_at: str, stdout_name: str, stderr_name: str, exit_name: str, command_json: Optional[str] = None, root_name: Optional[str] = None, artifact_identity_json: Optional[str] = None) -> int:
    global repo_root
    if root_name is not None:
        bound_root = Path(root_name).resolve()
        repo_root = lambda: bound_root
    with qualification_process_lock(date):
        stdout_path = _validate_qualification_artifact(date, Path(stdout_name))
        stderr_path = _validate_qualification_artifact(date, Path(stderr_name))
        exit_path = _validate_qualification_artifact(date, Path(exit_name))
        command = json.loads(command_json) if command_json is not None else stage_command(date, stage, run_id=run_id)
        if not isinstance(command, list) or not command or not all(isinstance(part, str) for part in command):
            raise ValueError("background command must be a non-empty string list")
        env = os.environ.copy()
        env["CORTEX_RUNTIME_QUALIFICATION_DATE"] = date
        stdout_context = _artifact_open_write(stdout_path)
        stderr_context = _artifact_open_write(stderr_path)
        stdout = stdout_context.__enter__()
        try:
            stderr = stderr_context.__enter__()
        except BaseException:
            stdout_context.__exit__(*sys.exc_info())
            raise
    try:
        try:
            proc = subprocess.run(command, cwd=str(repo_root()), stdout=stdout, stderr=stderr, text=True, env=env)
            stdout.flush(); os.fsync(stdout.fileno())
            stderr.flush(); os.fsync(stderr.fileno())
        finally:
            stderr_context.__exit__(None, None, None)
            stdout_context.__exit__(None, None, None)
    except BaseException:
        raise
    with qualification_process_lock(date):
        _finalize_run_artifact(date, stage, run_id, started_at, proc.returncode, command, stdout_path, stderr_path)
        process_identity = _process_identity(os.getpid())
        _atomic_write_json_marker(exit_path, {
            "schema_version": "cortex.runtime.qualification.exit.v1", "date": date,
            "stage": stage, "run_id": run_id, "exit_code": proc.returncode,
            "process_id": os.getpid(),
            "process_start_time": process_identity.get("start_time"),
            "process_identity": process_identity,
        })
        return proc.returncode


def _process_alive(pid: int) -> bool:
    # Liveness is meaningful only when a complete proc identity can be read.
    return bool(_process_identity(pid))


def _signal_process_group(pid: int, expected_identity: Any, sig: int) -> bool:
    """Signal a verified supervisor-owned session, never an arbitrary group."""
    actual_identity = _process_identity(pid)
    if not _identity_matches(expected_identity, actual_identity):
        return False
    try:
        # Background wrappers are created with start_new_session=True, so the
        # wrapper PID must still be the process-group ID before group signaling.
        if os.getpgid(pid) != pid:
            return False
        os.killpg(pid, sig)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def _stop_spawned_process_group(proc: subprocess.Popen[Any]) -> None:
    """Stop an exact newly spawned session and always reap its leader."""
    try:
        if os.getpgid(proc.pid) == proc.pid:
            os.killpg(proc.pid, signal.SIGTERM)
        else:
            proc.terminate()
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            if os.getpgid(proc.pid) == proc.pid:
                os.killpg(proc.pid, signal.SIGKILL)
            else:
                proc.kill()
        except ProcessLookupError:
            pass
        proc.wait()
    except ProcessLookupError:
        proc.wait()


def _read_proc_identity(pid: int) -> JsonDict:
    """Read one process identity exclusively from procfs.

    The executable stat follows the /proc symlink while ``readlink`` preserves
    the kernel's resolved target text (including a possible `` (deleted)``
    suffix).  Callers must treat any read/parse failure as no identity.
    """
    proc = Path("/proc") / str(pid)
    stat_text = (proc / "stat").read_text(encoding="utf-8")
    close = stat_text.rfind(")")
    if close < 0:
        raise ValueError("malformed proc stat")
    fields = stat_text[close + 1:].split()
    if len(fields) <= 19 or not fields[19].isdigit():
        raise ValueError("malformed proc start time")
    exe_path = proc / "exe"
    exe_target = os.readlink(exe_path)
    exe_stat = os.stat(exe_path)
    cmdline = (proc / "cmdline").read_bytes()
    if not exe_target or not cmdline:
        raise ValueError("incomplete proc identity")
    return {
        "schema_version": "cortex.runtime.process_identity.v1",
        "start_time": fields[19],
        "executable": {
            "target": exe_target,
            "device": exe_stat.st_dev,
            "inode": exe_stat.st_ino,
        },
        "cmdline_sha256": hashlib.sha256(cmdline).hexdigest(),
    }


def _valid_process_identity(identity: Any) -> bool:
    if not isinstance(identity, dict) or identity.get("schema_version") != "cortex.runtime.process_identity.v1":
        return False
    executable = identity.get("executable")
    return bool(
        isinstance(identity.get("start_time"), str) and identity["start_time"].isdigit()
        and isinstance(executable, dict)
        and isinstance(executable.get("target"), str) and executable["target"]
        and isinstance(executable.get("device"), int) and not isinstance(executable["device"], bool) and executable["device"] >= 0
        and isinstance(executable.get("inode"), int) and not isinstance(executable["inode"], bool) and executable["inode"] > 0
        and isinstance(identity.get("cmdline_sha256"), str)
        and re.fullmatch(r"[0-9a-f]{64}", identity["cmdline_sha256"]) is not None
    )


def _process_identity(pid: int, command: Optional[List[str]] = None, *, proc_reader: Any = None) -> JsonDict:
    """Return a validated immutable identity; ``command`` is legacy-only.

    ``proc_reader`` is injectable so safety behavior can be tested without
    accessing a real process or delivering a signal.
    """
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return {}
    try:
        identity = (proc_reader or _read_proc_identity)(pid)
        return identity if _valid_process_identity(identity) else {}
    except (OSError, UnicodeError, ValueError, IndexError, TypeError):
        return {}


def _proc_pid_exists(pid: int) -> bool:
    """Return false only when procfs definitively says the PID is absent."""
    try:
        os.stat(Path("/proc") / str(pid))
        return True
    except (FileNotFoundError, ProcessLookupError):
        return False
    except OSError:
        # Permission, transient I/O, and procfs availability failures are
        # ambiguous and must not authorize clearing a potentially live owner.
        return True


def _identity_matches(expected: Any, actual: Any) -> bool:
    return bool(_valid_process_identity(expected) and _valid_process_identity(actual) and expected == actual)


@_qualification_locked
def reconcile_active_process(date: str, *, state: Optional[JsonDict] = None) -> Optional[JsonDict]:
    state = state or load_or_create_state(date)
    active = state.get("active_process") or None
    if not active:
        return None
    exit_code_path = Path(str(active.get("exit_code_path") or ""))
    stage = str(active.get("stage") or "")
    try:
        pid = int(active.get("pid") or 0)
    except (TypeError, ValueError, OverflowError):
        pid = 0
    try:
        run_id = str(active.get("run_id") or "")
        if not run_id:
            raise ValueError("missing run id")
        expected_exit_path = qualification_artifact_path(date, "_runs", stage, run_id, "exit_code.txt")
        exit_code_path = _validate_qualification_artifact(date, exit_code_path)
        exit_path_valid = bool(active.get("run_id") and exit_code_path == expected_exit_path)
    except ValueError:
        exit_path_valid = False
    marker_error = "invalid_exit_marker" if exit_code_path.exists() and not exit_path_valid else None
    if exit_path_valid and exit_code_path.exists():
        try:
            marker = _json_load(exit_code_path)
            if not isinstance(marker, dict):
                raise ValueError("exit marker must be an object")
            exit_code = marker.get("exit_code")
            marker_valid = bool(
                marker.get("schema_version") == "cortex.runtime.qualification.exit.v1"
                and marker.get("date") == date and marker.get("stage") == stage
                and marker.get("run_id") == active.get("run_id")
                and isinstance(exit_code, int) and not isinstance(exit_code, bool)
            )
            expected_identity = active.get("process_identity")
            marker_valid = bool(
                marker_valid
                and _valid_process_identity(expected_identity)
                and marker.get("process_id") == pid
                and marker.get("process_start_time") == expected_identity.get("start_time")
                and _identity_matches(expected_identity, marker.get("process_identity"))
            )
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
            marker_valid = False
            exit_code = None
        if not marker_valid:
            exit_code = None
            marker_error = "invalid_exit_marker"
        else:
            active["finished_at"] = now_iso()
            active["exit_code"] = exit_code
            active["alive"] = False
            state["active_process"] = None
            row = state["stages"].setdefault(stage, {})
            run_record = row.get("supervisor_run")
            if not isinstance(run_record, dict) or run_record.get("run_id") != active.get("run_id"):
                run_record = {"run_id": active.get("run_id"), "stage": stage, "started_at": active.get("started_at")}
                row["supervisor_run"] = run_record
            run_record.update({
                "status": "succeeded" if exit_code == 0 else "failed",
                "exit_code": exit_code,
                "exit_observed_by_supervisor": True,
                "finished_at": active["finished_at"],
                "process_id": pid,
                "process_identity": expected_identity,
                "exit_code_path": str(exit_code_path),
            })
        if marker_valid:
            verification = verify_stage(date, stage, expected_run=run_record)
            spec = _stage_specs(date).get(stage)
            artifact = None
            if stage == "validation":
                artifact = qualification_artifact_path(date, "validation", "validation_summary.json")
            elif spec and spec.required_artifacts:
                artifact = Path(spec.required_artifacts[0])
            if artifact is not None and artifact.suffix == ".json" and artifact.exists():
                try:
                    payload = _json_load(artifact)
                    artifact_started = _parse_timestamp(payload.get("started_at"))
                    process_started = _parse_timestamp(active.get("started_at"))
                    verification["complete"] = bool(verification.get("complete") and artifact_started and process_started and artifact_started >= process_started)
                except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
                    verification["complete"] = False
            row["status"] = "complete" if verification.get("complete") and exit_code == 0 else "failed"
            row["completed"] = bool(verification.get("complete") and exit_code == 0)
            row["missing_artifacts"] = verification.get("missing_artifacts") or []
            row["details"] = verification.get("details") or {}
            save_state(date, state)
            return None
    if pid:
        expected_identity = active.get("process_identity")
        actual_identity = _process_identity(pid)
        if not _valid_process_identity(expected_identity):
            active["alive"] = False
            active["recovery_error"] = "legacy_process_identity_blocker"
            save_state(date, state)
            return active
        if not _identity_matches(expected_identity, actual_identity):
            reason = "process_identity_mismatch"
            # Preserve ownership when procfs still exposes the PID but its full
            # identity cannot be read.  A definitively absent proc entry means
            # the wrapper died and its failed run can safely be recovered.
            if not actual_identity:
                if _proc_pid_exists(pid):
                    active["alive"] = False
                    active["recovery_error"] = "process_identity_unavailable"
                    save_state(date, state)
                    return active
                reason = marker_error or "process_dead_without_valid_exit_marker"
            active["alive"] = False
            active["finished_at"] = now_iso()
            active["recovery_error"] = reason
            state["active_process"] = None
            row = state["stages"].setdefault(stage, {})
            row["status"] = "failed"
            row["completed"] = False
            row["supervisor_run"] = {
                "run_id": active.get("run_id"), "stage": stage, "started_at": active.get("started_at"),
                "finished_at": active["finished_at"], "status": "failed", "exit_code": None,
                "exit_observed_by_supervisor": False, "reason": reason,
            }
            save_state(date, state)
            return None
        active["alive"] = True
        if marker_error:
            active["recovery_error"] = marker_error
        save_state(date, state)
        return active
    active["alive"] = False
    active["finished_at"] = now_iso()
    state["active_process"] = None
    row = state["stages"].setdefault(stage, {})
    row["status"] = "failed"
    row["supervisor_run"] = {
        "run_id": active.get("run_id"), "stage": stage, "started_at": active.get("started_at"),
        "finished_at": active["finished_at"], "status": "failed", "exit_code": None,
        "exit_observed_by_supervisor": False,
        "reason": marker_error or "process_dead_without_valid_exit_marker",
    }
    row["completed"] = False
    row["details"] = {"reason": marker_error or "process_dead_without_valid_exit_marker", "recoverable": True}
    save_state(date, state)
    return None


@_qualification_locked
def terminate_active_process(date: str) -> JsonDict:
    state = load_or_create_state(date)
    active = state.get("active_process")
    if not active:
        return {"terminated": False, "reason": "no_active_process"}
    try:
        pid = int(active.get("pid"))
    except (TypeError, ValueError):
        pid = 0
    expected = active.get("process_identity")
    if not _valid_process_identity(expected):
        return {"terminated": False, "reason": "legacy_process_identity_blocker"}
    actual = _process_identity(pid)
    if pid <= 0 or not actual:
        return {"terminated": False, "reason": "process_identity_unavailable"}
    if not _identity_matches(expected, actual):
        return {"terminated": False, "reason": "process_identity_mismatch"}
    if not _signal_process_group(pid, expected, signal.SIGTERM):
        return {"terminated": False, "reason": "process_group_identity_mismatch"}
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
            view["command"] = stage_command(date, name, run_id="<run-id>" if name in SOAK_STAGES else None)
        out.append(view)
    return {"date": date, "stages": out}
