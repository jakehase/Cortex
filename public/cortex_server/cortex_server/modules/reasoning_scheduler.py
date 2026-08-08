from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from uuid import uuid4

from cortex_server.modules.evidence_governance import normalize_runtime_event

from cortex_server.modules.reasoning_kernel import model_dump_compat
from cortex_server.modules.reasoning_failures import normalize_failure_code
from cortex_server.modules.reasoning_store import list_docs, list_events, replace_namespace_docs, replace_namespace_events


DEFAULT_STATE_PATH = Path(os.getenv("REASONING_SCHEDULER_STATE_PATH", "/opt/clawdbot/state/reasoning_scheduler.json"))
DEFAULT_DB_PATH = Path(os.getenv("REASONING_STORE_DB_PATH", "/opt/clawdbot/state/reasoning_runtime.db"))
ENABLE_LEGACY_JSON_FALLBACK = str(os.getenv("REASONING_SCHEDULER_ENABLE_LEGACY_JSON_FALLBACK", "0")).strip().lower() in {"1", "true", "yes", "on"}
_PROCESSES_NAMESPACE = "reasoning_processes"
_EVENTS_NAMESPACE = "reasoning_process_events"
_LOCK = threading.RLock()


class ReasoningSchedulerError(ValueError):
    pass



def _now() -> datetime:
    return datetime.now(timezone.utc)



def _now_iso() -> str:
    return _now().isoformat()



def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None



def _to_iso(value: Optional[datetime]) -> Optional[str]:
    return value.astimezone(timezone.utc).isoformat() if isinstance(value, datetime) else None



def _next_recurrence_at(*, cadence_seconds: int, from_time: Optional[datetime] = None) -> Optional[str]:
    cadence = max(0, int(cadence_seconds or 0))
    if cadence == 0:
        return None
    return _to_iso((from_time or _now()) + timedelta(seconds=cadence))



def _state_path() -> Path:
    return Path(str(DEFAULT_STATE_PATH))



def _db_path() -> Path:
    return Path(str(DEFAULT_DB_PATH))



def _default_state() -> Dict[str, Any]:
    return {
        "version": "cortex.reasoning.scheduler.v1",
        "updated_at": _now_iso(),
        "processes": {},
        "events": [],
    }



def load_state() -> Dict[str, Any]:
    path = _state_path()
    with _LOCK:
        processes = [dict(row) for row in list_docs(_PROCESSES_NAMESPACE, db_path=_db_path()) if isinstance(row, dict)]
        events = [dict(row) for row in list_events(_EVENTS_NAMESPACE, db_path=_db_path()) if isinstance(row, dict)]
        if processes or events:
            return {
                "version": "cortex.reasoning.scheduler.v1",
                "updated_at": _now_iso(),
                "processes": {str(row.get("process_id") or ""): row for row in processes if str(row.get("process_id") or "").strip()},
                "events": events,
            }
        if not ENABLE_LEGACY_JSON_FALLBACK:
            return _default_state()
        if not path.exists():
            return _default_state()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return _default_state()
            data.setdefault("version", "cortex.reasoning.scheduler.v1")
            data.setdefault("updated_at", _now_iso())
            data.setdefault("processes", {})
            data.setdefault("events", [])
            save_state(data)
            return data
        except Exception:
            return _default_state()



def save_state(state: Dict[str, Any]) -> Dict[str, Any]:
    state["updated_at"] = _now_iso()
    processes = [dict(row) for row in ((state.get("processes") or {}).values()) if isinstance(row, dict)]
    events = [dict(row) for row in (state.get("events") or []) if isinstance(row, dict)]
    with _LOCK:
        replace_namespace_docs(_PROCESSES_NAMESPACE, processes, id_field="process_id", db_path=_db_path())
        replace_namespace_events(_EVENTS_NAMESPACE, events, parent_field="process_id", id_field="event_id", db_path=_db_path())
    return state



def _append_event(state: Dict[str, Any], process_id: str, kind: str, payload: Dict[str, Any]) -> None:
    events = state.setdefault("events", [])
    process = ((state.get("processes") or {}).get(process_id)) if isinstance(state.get("processes"), dict) else None
    if isinstance(process, dict):
        projection = _ensure_session_projection(process)
        projection["last_event_kind"] = str(kind or "").strip() or projection.get("last_event_kind")
        projection["last_event_at"] = _now_iso()
        if str(kind or "").startswith("session."):
            projection["last_session_event"] = str(kind or "").strip()
            projection["status"] = _session_projection_status_for_event(process, kind=str(kind or ""), payload=payload)
            summary = str(payload.get("summary") or payload.get("operator_summary") or payload.get("reason") or "").strip()
            if summary:
                projection["last_summary"] = summary
            if str(kind or "") == "session.retry-needed":
                projection["retry_count"] = int(projection.get("retry_count", 0) or 0) + 1
            if str(kind or "") in {"session.blocked", "session.stale", "session.handoff-needed", "session.test-failed"}:
                questions = [str(row).strip() for row in (projection.get("open_questions") or []) if str(row).strip()]
                if summary and summary not in questions:
                    questions.append(summary)
                projection["open_questions"] = questions
            if str(kind or "").startswith("session.test-"):
                projection["test_status"] = str(kind or "").split("session.", 1)[-1]
    events.append(
        normalize_runtime_event(
            process_id=process_id,
            kind=kind,
            payload=payload,
            ts=_now_iso(),
            event_id=f"ev_{uuid4().hex[:10]}",
        )
    )
    if len(events) > 300:
        del events[:-300]


def _session_identity(process: Dict[str, Any]) -> Dict[str, Any]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    session_id = str(metadata.get("runtime_session_id") or process.get("session_key") or process.get("process_id") or "").strip() or str(process.get("process_id") or "")
    session_name = str(workflow.get("name") or session_id).strip() or session_id
    tool = str(metadata.get("runtime_tool") or "cortex-runtime").strip() or "cortex-runtime"
    return {"session_id": session_id, "session_name": session_name, "tool": tool}


def _ensure_session_projection(process: Dict[str, Any]) -> Dict[str, Any]:
    projection = process.get("session_projection") if isinstance(process.get("session_projection"), dict) else {}
    identity = _session_identity(process)
    projection.setdefault("session_id", identity["session_id"])
    projection.setdefault("session_name", identity["session_name"])
    projection.setdefault("tool", identity["tool"])
    projection.setdefault("status", str(process.get("status") or "scheduled"))
    projection.setdefault("retry_count", 0)
    projection.setdefault("open_questions", [])
    projection.setdefault("test_status", None)
    process["session_projection"] = projection
    return projection


def _session_projection_status_for_event(process: Dict[str, Any], *, kind: str, payload: Optional[Dict[str, Any]] = None) -> str:
    payload = dict(payload or {})
    mapping = {
        "session.started": "running",
        "session.finished": "finished",
        "session.failed": "failed",
        "session.blocked": "blocked",
        "session.retry-needed": "retry-needed",
        "session.handoff-needed": "handoff-needed",
        "session.stale": "stale",
        "session.pr-created": "pr-created",
    }
    if kind == "session.test-started":
        return "testing"
    if kind == "session.test-finished":
        return "running" if str(process.get("status") or "") not in {"completed", "failed"} else str(process.get("status") or "running")
    if kind == "session.test-failed":
        return "test-failed"
    return mapping.get(str(kind or "").strip(), str(process.get("status") or payload.get("status") or "scheduled"))


def _node_is_test(row: Dict[str, Any]) -> bool:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    if bool(metadata.get("is_test")) or str(metadata.get("step_kind") or "").strip().lower() == "test":
        return True
    title = str(row.get("title") or "").lower()
    return "test" in title or "pytest" in title


def _session_event_payload(process: Dict[str, Any], *, summary: Optional[str] = None, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    identity = _session_identity(process)
    payload = {**identity}
    if summary:
        payload["summary"] = str(summary).strip()
    if extra:
        payload.update(dict(extra))
    return payload



def _workflow_steps_map(workflow: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    steps = workflow.get("steps") if isinstance(workflow.get("steps"), list) else []
    out: Dict[str, Dict[str, Any]] = {}
    for idx, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            continue
        node_id = str(step.get("node_id") or f"step_{idx}")
        if node_id in out:
            raise ReasoningSchedulerError(f"duplicate node_id in workflow: {node_id}")
        out[node_id] = dict(step)
    if not out:
        raise ReasoningSchedulerError("workflow must include steps")
    return out



def _policy_settings_from_workflow(workflow: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    workflow = workflow if isinstance(workflow, dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    settings = policy.get("settings") if isinstance(policy.get("settings"), dict) else {}
    return dict(settings)



def _node_retry_settings(step: Dict[str, Any], *, workflow: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    metadata = step.get("metadata") if isinstance(step.get("metadata"), dict) else {}
    policy_settings = _policy_settings_from_workflow(workflow)
    failure_mode = str(step.get("failure_mode") or "continue")
    default_attempts = int(policy_settings.get("retry_max_attempts", 1 if failure_mode != "retry" else 2) or 1)
    max_attempts = int(metadata.get("max_attempts", metadata.get("retry_max_attempts", default_attempts)) or default_attempts)
    backoff = float(metadata.get("retry_backoff_seconds", policy_settings.get("retry_backoff_seconds", 0.0)) or 0.0)
    retry_on_timeout = bool(metadata.get("retry_on_timeout", policy_settings.get("retry_on_timeout", True)))
    retry_on_status_codes = [int(x) for x in (metadata.get("retry_on_status_codes", policy_settings.get("retry_on_status_codes", [])) or []) if str(x).strip()]
    retry_on_error_types = [str(x).lower() for x in (metadata.get("retry_on_error_types", policy_settings.get("retry_on_error_types", [])) or []) if str(x).strip()]
    return {
        "max_attempts": max(1, max_attempts),
        "retry_backoff_seconds": max(0.0, backoff),
        "retry_on_timeout": retry_on_timeout,
        "retry_on_status_codes": retry_on_status_codes,
        "retry_on_error_types": retry_on_error_types,
    }



def _deadline_at_from_workflow(workflow: Optional[Dict[str, Any]]) -> Optional[str]:
    policy_settings = _policy_settings_from_workflow(workflow)
    workflow = workflow if isinstance(workflow, dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    seconds = policy_settings.get("workflow_deadline_seconds", metadata.get("workflow_deadline_seconds"))
    try:
        deadline_seconds = float(seconds) if seconds is not None else 0.0
    except Exception:
        deadline_seconds = 0.0
    if deadline_seconds <= 0:
        return None
    return _to_iso(_now() + timedelta(seconds=deadline_seconds))



def _cancel_open_nodes(process: Dict[str, Any], *, reason: str) -> None:
    for node_id, row in (process.get("nodes") or {}).items():
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or "pending")
        if status in {"completed", "failed", "cancelled"}:
            continue
        row["status"] = "cancelled"
        row["last_error"] = reason
        row["completed_at"] = row.get("completed_at") or _now_iso()
        row["updated_at"] = _now_iso()



def _result_matches_retry_policy(result: Dict[str, Any], row: Dict[str, Any]) -> bool:
    is_timeout = str(result.get("error_type") or "") == "timeout" or str(result.get("error") or "").startswith("timeout:")
    if is_timeout and not bool(row.get("retry_on_timeout", True)):
        return False

    status_filters = [int(x) for x in (row.get("retry_on_status_codes") or []) if str(x).strip()]
    error_filters = [str(x).lower() for x in (row.get("retry_on_error_types") or []) if str(x).strip()]

    if not status_filters and not error_filters:
        return True

    status_code = result.get("status_code")
    error_type = str(result.get("error_type") or ("timeout" if is_timeout else "")).lower().strip()

    status_ok = True if not status_filters else (status_code is not None and int(status_code) in status_filters)
    error_ok = True if not error_filters else (bool(error_type) and error_type in error_filters)
    return status_ok and error_ok



def _retry_wait_until(*, backoff_seconds: float) -> Optional[str]:
    if backoff_seconds <= 0:
        return _now_iso()
    return _to_iso(_now() + timedelta(seconds=backoff_seconds))



def _node_wait_until(step: Dict[str, Any], *, default_start_at: Optional[str] = None) -> Optional[str]:
    metadata = step.get("metadata") if isinstance(step.get("metadata"), dict) else {}
    if step.get("wait_until"):
        return str(step.get("wait_until"))
    if metadata.get("wait_until"):
        return str(metadata.get("wait_until"))
    if metadata.get("delay_seconds") is not None:
        try:
            delay = max(0, int(metadata.get("delay_seconds") or 0))
            return _to_iso(_now() + timedelta(seconds=delay))
        except Exception:
            pass
    return default_start_at



def _make_node_state(step: Dict[str, Any], *, default_start_at: Optional[str] = None, workflow: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    depends_on = [str(x) for x in (step.get("depends_on") or []) if str(x).strip()]
    retry_settings = _node_retry_settings(step, workflow=workflow)
    return {
        "node_id": str(step.get("node_id") or f"node_{uuid4().hex[:8]}"),
        "title": str(step.get("title") or step.get("node_id") or step.get("endpoint") or "node"),
        "status": "pending",
        "depends_on": depends_on,
        "blocked_by": list(depends_on),
        "wait_until": _node_wait_until(step, default_start_at=default_start_at),
        "attempts": 0,
        "last_error": None,
        "last_result": None,
        "started_at": None,
        "completed_at": None,
        "failure_mode": str(step.get("failure_mode") or "continue"),
        "max_attempts": int(retry_settings.get("max_attempts", 1) or 1),
        "retry_backoff_seconds": float(retry_settings.get("retry_backoff_seconds", 0.0) or 0.0),
        "retry_on_timeout": bool(retry_settings.get("retry_on_timeout", True)),
        "retry_on_status_codes": list(retry_settings.get("retry_on_status_codes", []) or []),
        "retry_on_error_types": list(retry_settings.get("retry_on_error_types", []) or []),
        "retry_at": None,
        "metadata": dict(step.get("metadata") or {}),
    }



def _reset_process_run(process: Dict[str, Any], *, start_at: Optional[str] = None) -> Dict[str, Any]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    steps_by_id = _workflow_steps_map(workflow)
    process["results_by_node"] = {}
    process["nodes"] = {node_id: _make_node_state(step, default_start_at=start_at, workflow=workflow) for node_id, step in steps_by_id.items()}
    process["status"] = "scheduled"
    process["completed_at"] = None
    process["wake_requested_at"] = None
    process["last_run_started_at"] = _now_iso()
    process["deadline_at"] = _deadline_at_from_workflow(workflow)
    process["run_count"] = int(process.get("run_count", 0) or 0) + 1
    return process



def _process_status(process: Dict[str, Any]) -> str:
    nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}
    if not nodes:
        return "empty"
    statuses = [str((row or {}).get("status") or "pending") for row in nodes.values()]
    if all(status == "completed" for status in statuses):
        return "completed"
    if all(status in {"completed", "cancelled"} for status in statuses):
        return "cancelled"
    if any(status == "running" for status in statuses):
        return "running"
    if any(status == "ready" for status in statuses):
        return "ready"
    if any(status == "waiting" for status in statuses):
        return "waiting"
    if any(status == "failed" for status in statuses):
        return "failed"
    if any(status == "blocked" for status in statuses):
        return "blocked"
    return "scheduled"



def _refresh_process(process: Dict[str, Any], *, now: Optional[datetime] = None) -> Dict[str, Any]:
    now_dt = now or _now()
    if not bool(process.get("enabled", True)):
        process["status"] = "paused"
        process["updated_at"] = _now_iso()
        return process

    deadline_at = _parse_dt(process.get("deadline_at"))
    if deadline_at and deadline_at <= now_dt and str(process.get("status") or "") not in {"completed", "failed", "cancelled"}:
        _cancel_open_nodes(process, reason="deadline_exceeded")
        process["status"] = "cancelled"
        process["completed_at"] = process.get("completed_at") or _now_iso()
        process["updated_at"] = _now_iso()
        return process

    recurrence = process.get("recurrence") if isinstance(process.get("recurrence"), dict) else {}
    cadence_seconds = max(0, int(recurrence.get("cadence_seconds", 0) or 0))
    next_run_at = _parse_dt(recurrence.get("next_run_at"))
    if cadence_seconds > 0 and str(process.get("status") or "") in {"completed", "failed"} and next_run_at and next_run_at <= now_dt:
        _reset_process_run(process, start_at=None)
        recurrence["next_run_at"] = _next_recurrence_at(cadence_seconds=cadence_seconds, from_time=now_dt)
        recurrence["last_reset_at"] = _to_iso(now_dt)

    nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}
    results_by_node = process.setdefault("results_by_node", {})
    wake_requested_at = _parse_dt(process.get("wake_requested_at"))
    for node_id, row in nodes.items():
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or "pending")
        if status in {"completed", "failed", "running", "cancelled"}:
            continue

        deps = [str(x) for x in (row.get("depends_on") or []) if str(x).strip()]
        dep_failures: List[str] = []
        unmet: List[str] = []
        for dep in deps:
            dep_result = results_by_node.get(dep)
            if dep_result is None:
                unmet.append(dep)
                continue
            if not bool(dep_result.get("success")):
                dep_failures.append(dep)
            elif str(dep_result.get("status") or "") != "completed":
                unmet.append(dep)

        if dep_failures:
            row["status"] = "blocked"
            row["blocked_by"] = dep_failures
            row["updated_at"] = _now_iso()
            continue

        retry_at = _parse_dt(row.get("retry_at"))
        wait_until = _parse_dt(row.get("wait_until"))
        effective_wait = None if wake_requested_at else (retry_at or wait_until)
        if unmet:
            row["status"] = "blocked"
            row["blocked_by"] = unmet
        elif effective_wait and effective_wait > now_dt:
            row["status"] = "waiting"
            row["blocked_by"] = []
        else:
            row["status"] = "ready"
            row["blocked_by"] = []
            if wake_requested_at:
                row["wait_until"] = None
                row["retry_at"] = None
        row["updated_at"] = _now_iso()

    process["status"] = _process_status(process)
    process["updated_at"] = _now_iso()
    if process["status"] in {"completed", "failed"}:
        first_terminal_refresh = not bool(process.get("completed_at"))
        if first_terminal_refresh:
            process["completed_at"] = _now_iso()
        recurrence = process.get("recurrence") if isinstance(process.get("recurrence"), dict) else {}
        cadence_seconds = max(0, int(recurrence.get("cadence_seconds", 0) or 0))
        if cadence_seconds > 0 and bool(process.get("enabled", True)) and (
            first_terminal_refresh or _parse_dt(recurrence.get("next_run_at")) is None
        ):
            recurrence["next_run_at"] = _next_recurrence_at(cadence_seconds=cadence_seconds, from_time=now_dt)
        if first_terminal_refresh and cadence_seconds > 0 and bool(process.get("enabled", True)):
            history = process.setdefault("run_history", [])
            history.append({
                "completed_at": process.get("completed_at"),
                "status": process["status"],
                "run_count": int(process.get("run_count", 0) or 0),
            })
            if len(history) > 50:
                del history[:-50]
    return process



def create_process_from_workflow(
    workflow: Dict[str, Any],
    *,
    process_id: Optional[str] = None,
    task_id: Optional[str] = None,
    start_at: Optional[str] = None,
    owner: Optional[str] = None,
    session_key: Optional[str] = None,
    cadence_seconds: Optional[int] = None,
    enabled: bool = True,
) -> Dict[str, Any]:
    with _LOCK:
        steps_by_id = _workflow_steps_map(workflow)
        for node_id, step in steps_by_id.items():
            for dep in step.get("depends_on") or []:
                if str(dep) not in steps_by_id:
                    raise ReasoningSchedulerError(f"node {node_id} depends on unknown node {dep}")
        pid = process_id or f"proc_{uuid4().hex[:12]}"
        cadence = int(cadence_seconds if cadence_seconds is not None else (((workflow.get("metadata") or {}).get("cadence_seconds")) or 0) or 0)
        process = {
            "process_id": pid,
            "task_id": task_id,
            "workflow": {"name": workflow.get("name"), "metadata": dict(workflow.get("metadata") or {}), "steps": list(steps_by_id.values())},
            "owner": owner or (workflow.get("metadata") or {}).get("owner"),
            "session_key": session_key or (workflow.get("metadata") or {}).get("session_key"),
            "status": "scheduled",
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "start_at": start_at,
            "wake_requested_at": None,
            "last_tick_at": None,
            "completed_at": None,
            "deadline_at": _deadline_at_from_workflow(workflow),
            "enabled": bool(enabled),
            "run_count": 0,
            "run_history": [],
            "recurrence": {
                "cadence_seconds": cadence,
                "next_run_at": start_at if cadence > 0 else None,
                "last_reset_at": None,
            },
            "results_by_node": {},
            "nodes": {node_id: _make_node_state(step, default_start_at=start_at, workflow=workflow) for node_id, step in steps_by_id.items()},
        }
        _ensure_session_projection(process)
        _refresh_process(process)
        state = load_state()
        state.setdefault("processes", {})[pid] = process
        _append_event(state, pid, "process_created", {"workflow_name": workflow.get("name"), "nodes": list(steps_by_id.keys())})
        _append_event(state, pid, "session.started", _session_event_payload(process, summary="runtime process created"))
        save_state(state)
        return process
def list_processes() -> List[Dict[str, Any]]:
    with _LOCK:
        state = load_state()
        processes = []
        for process in (state.get("processes") or {}).values():
            if isinstance(process, dict):
                processes.append(_refresh_process(dict(process)))
        processes.sort(key=lambda row: str(row.get("created_at") or ""))
        return processes
def get_process(process_id: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        state = load_state()
        process = (state.get("processes") or {}).get(process_id)
        if not isinstance(process, dict):
            return None
        process = _refresh_process(process)
        state["processes"][process_id] = process
        save_state(state)
        return process


def replace_process_workflow(process_id: str, workflow: Dict[str, Any], *, event_kind: str = "process_workflow_updated", event_payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        process = (state.get("processes") or {}).get(process_id)
        if not isinstance(process, dict):
            raise ReasoningSchedulerError(f"unknown process: {process_id}")
        steps_by_id = _workflow_steps_map(workflow)
        existing_nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}
        if existing_nodes and set(steps_by_id) != set(existing_nodes):
            raise ReasoningSchedulerError("workflow patch cannot change node set")

        process["workflow"] = {
            "name": workflow.get("name"),
            "metadata": dict(workflow.get("metadata") or {}),
            "steps": list(steps_by_id.values()),
        }
        process["owner"] = (workflow.get("metadata") or {}).get("owner", process.get("owner"))
        process["session_key"] = (workflow.get("metadata") or {}).get("session_key", process.get("session_key"))
        process["deadline_at"] = _deadline_at_from_workflow(workflow)

        nodes = process.setdefault("nodes", {})
        for node_id, step in steps_by_id.items():
            row = nodes.get(node_id)
            if not isinstance(row, dict):
                row = _make_node_state(step, default_start_at=process.get("start_at"), workflow=workflow)
                nodes[node_id] = row
            retry_settings = _node_retry_settings(step, workflow=workflow)
            row["title"] = str(step.get("title") or step.get("node_id") or step.get("endpoint") or row.get("title") or "node")
            row["failure_mode"] = str(step.get("failure_mode") or "continue")
            row["max_attempts"] = int(retry_settings.get("max_attempts", 1) or 1)
            row["retry_backoff_seconds"] = float(retry_settings.get("retry_backoff_seconds", 0.0) or 0.0)
            row["retry_on_timeout"] = bool(retry_settings.get("retry_on_timeout", True))
            row["retry_on_status_codes"] = list(retry_settings.get("retry_on_status_codes", []) or [])
            row["retry_on_error_types"] = list(retry_settings.get("retry_on_error_types", []) or [])
            row["metadata"] = dict(step.get("metadata") or {})
            row["updated_at"] = _now_iso()

        _refresh_process(process)
        process["updated_at"] = _now_iso()
        _append_event(state, process_id, event_kind, dict(event_payload or {}))
        save_state(state)
        return process


def _normalize_node_ids(rows: Optional[Sequence[str]]) -> List[str]:
    out: List[str] = []
    for row in rows or []:
        node_id = str(row or "").strip()
        if node_id and node_id not in out:
            out.append(node_id)
    return out



def _terminal_result_stub(*, success: bool, status: str, completed_at: str, attempts: int, error: Optional[str] = None) -> Dict[str, Any]:
    return {
        "success": success,
        "status": status,
        "status_code": None,
        "response": None,
        "error": error,
        "elapsed_ms": None,
        "completed_at": completed_at,
        "attempts": attempts,
        "error_code": normalize_failure_code(None, error=error, success=success),
        "belief_context": None,
        "produced_belief_ids": [],
        "produced_belief_count": 0,
    }



def sync_process_progress(
    process_id: str,
    *,
    lifecycle_state: Optional[str] = None,
    active_nodes: Optional[Sequence[str]] = None,
    waiting_nodes: Optional[Sequence[str]] = None,
    completed_nodes: Optional[Sequence[str]] = None,
    failed_nodes: Optional[Sequence[str]] = None,
    enabled: Optional[bool] = None,
    event_kind: str = "process_progress_synced",
    event_payload: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        process = (state.get("processes") or {}).get(process_id)
        if not isinstance(process, dict):
            raise ReasoningSchedulerError(f"unknown process: {process_id}")

        nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}
        normalized = {
            "active": _normalize_node_ids(active_nodes),
            "waiting": _normalize_node_ids(waiting_nodes),
            "completed": _normalize_node_ids(completed_nodes),
            "failed": _normalize_node_ids(failed_nodes),
        }
        known_nodes = set(nodes)
        for bucket, bucket_nodes in normalized.items():
            unknown = sorted(set(bucket_nodes) - known_nodes)
            if unknown:
                raise ReasoningSchedulerError(f"cannot sync unknown nodes for {bucket}: {', '.join(unknown)}")

        assignments: Dict[str, str] = {}
        for bucket in ("active", "waiting", "completed", "failed"):
            for node_id in normalized[bucket]:
                previous = assignments.get(node_id)
                if previous is not None:
                    raise ReasoningSchedulerError(f"node {node_id} cannot be synced as both {previous} and {bucket}")
                assignments[node_id] = bucket

        if enabled is not None:
            process["enabled"] = bool(enabled)

        results_by_node = process.setdefault("results_by_node", {})
        now_iso = _now_iso()
        for node_id, row in nodes.items():
            if not isinstance(row, dict):
                continue
            bucket = assignments.get(node_id)
            if bucket == "completed":
                completed_at = str(row.get("completed_at") or now_iso)
                row["status"] = "completed"
                row["started_at"] = row.get("started_at") or completed_at
                row["completed_at"] = completed_at
                row["retry_at"] = None
                row["wait_until"] = None
                row["blocked_by"] = []
                row["last_error"] = None
                if not isinstance(results_by_node.get(node_id), dict):
                    results_by_node[node_id] = _terminal_result_stub(
                        success=True,
                        status="completed",
                        completed_at=completed_at,
                        attempts=int(row.get("attempts", 0) or 0),
                    )
            elif bucket == "failed":
                completed_at = str(row.get("completed_at") or now_iso)
                error = str(row.get("last_error") or "synced_failed_state").strip() or "synced_failed_state"
                row["status"] = "failed"
                row["started_at"] = row.get("started_at") or completed_at
                row["completed_at"] = completed_at
                row["retry_at"] = None
                row["wait_until"] = None
                row["blocked_by"] = []
                row["last_error"] = error
                results_by_node[node_id] = _terminal_result_stub(
                    success=False,
                    status="failed",
                    completed_at=completed_at,
                    attempts=int(row.get("attempts", 0) or 0),
                    error=error,
                )
            elif bucket == "active":
                row["status"] = "running"
                row["started_at"] = row.get("started_at") or now_iso
                row["completed_at"] = None
                row["retry_at"] = None
                row["blocked_by"] = []
                row["last_error"] = None
                results_by_node.pop(node_id, None)
            elif bucket == "waiting":
                row["status"] = "waiting"
                row["started_at"] = None
                row["completed_at"] = None
                row["retry_at"] = None
                row["blocked_by"] = []
                row["last_error"] = None
                results_by_node.pop(node_id, None)
            else:
                row["status"] = "pending"
                row["started_at"] = None
                row["completed_at"] = None
                row["retry_at"] = None
                row["blocked_by"] = []
                row["last_error"] = None
                results_by_node.pop(node_id, None)
            row["updated_at"] = now_iso

        terminal_statuses = {"completed", "failed", "cancelled"}
        if all(str((row or {}).get("status") or "pending") in terminal_statuses for row in nodes.values() if isinstance(row, dict)):
            process["completed_at"] = process.get("completed_at") or now_iso
        else:
            process["completed_at"] = None
        if lifecycle_state in {"running", "waiting", "created", "blocked", "rolled_back"}:
            process["wake_requested_at"] = process.get("wake_requested_at") or now_iso
        elif lifecycle_state in {"completed", "failed", "cancelled"}:
            process["wake_requested_at"] = None

        _refresh_process(process)
        process["updated_at"] = _now_iso()
        payload = dict(event_payload or {})
        if lifecycle_state is not None:
            payload.setdefault("lifecycle_state", str(lifecycle_state))
        payload.setdefault("active_nodes", list(normalized["active"]))
        payload.setdefault("waiting_nodes", list(normalized["waiting"]))
        payload.setdefault("completed_nodes", list(normalized["completed"]))
        payload.setdefault("failed_nodes", list(normalized["failed"]))
        _append_event(state, process_id, event_kind, payload)
        save_state(state)
        return process


def scheduler_tick(*, now_iso: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        now_dt = _parse_dt(now_iso) or _now()
        runnable: List[Dict[str, Any]] = []
        processes = state.get("processes") if isinstance(state.get("processes"), dict) else {}
        for process_id, process in processes.items():
            if not isinstance(process, dict):
                continue
            refreshed = _refresh_process(process, now=now_dt)
            refreshed["last_tick_at"] = _to_iso(now_dt)
            processes[process_id] = refreshed
            for node_id, row in (refreshed.get("nodes") or {}).items():
                if str((row or {}).get("status") or "") == "ready":
                    runnable.append(
                        {
                            "process_id": process_id,
                            "task_id": refreshed.get("task_id"),
                            "workflow_name": (refreshed.get("workflow") or {}).get("name"),
                            "node_id": node_id,
                            "title": (row or {}).get("title"),
                        }
                    )
        runnable = runnable[: max(0, int(limit))]
        save_state(state)
        return {
            "scheduler": {"version": state.get("version"), "updated_at": state.get("updated_at")},
            "process_count": len(processes),
            "runnable_count": len(runnable),
            "runnable": runnable,
            "session_projection": {
                "active_sessions": sum(1 for row in processes.values() if isinstance(row, dict) and isinstance(row.get("session_projection"), dict)),
                "testing_sessions": sum(1 for row in processes.values() if isinstance(row, dict) and str(((row.get("session_projection") or {}).get("status") or "")) == "testing"),
                "blocked_sessions": sum(1 for row in processes.values() if isinstance(row, dict) and str(((row.get("session_projection") or {}).get("status") or "")) in {"blocked", "stale", "retry-needed", "handoff-needed", "test-failed"}),
            },
        }
def mark_node_running(process_id: str, node_id: str) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        process = (state.get("processes") or {}).get(process_id)
        if not isinstance(process, dict):
            raise ReasoningSchedulerError(f"unknown process: {process_id}")
        row = ((process.get("nodes") or {}).get(node_id))
        if not isinstance(row, dict):
            raise ReasoningSchedulerError(f"unknown node: {node_id}")
        row["status"] = "running"
        row["attempts"] = int(row.get("attempts", 0) or 0) + 1
        row["started_at"] = row.get("started_at") or _now_iso()
        row["updated_at"] = _now_iso()
        process["status"] = "running"
        process["updated_at"] = _now_iso()
        _append_event(state, process_id, "node_running", {"node_id": node_id, "attempts": row["attempts"]})
        if _node_is_test(row):
            _append_event(state, process_id, "session.test-started", _session_event_payload(process, summary=f"tests started: {row.get('title')}", extra={"node_id": node_id, "attempts": row["attempts"]}))
        save_state(state)
        return process
def record_node_result(process_id: str, node_id: str, result: Dict[str, Any]) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        process = (state.get("processes") or {}).get(process_id)
        if not isinstance(process, dict):
            raise ReasoningSchedulerError(f"unknown process: {process_id}")
        row = ((process.get("nodes") or {}).get(node_id))
        if not isinstance(row, dict):
            raise ReasoningSchedulerError(f"unknown node: {node_id}")

        success = bool(result.get("success"))
        attempts = int(row.get("attempts", 0) or 0)
        max_attempts = max(1, int(row.get("max_attempts", 1) or 1))
        retry_allowed = str(row.get("failure_mode") or "continue") == "retry" and attempts < max_attempts
        if retry_allowed and not _result_matches_retry_policy(result, row):
            retry_allowed = False

        row["last_error"] = result.get("error")
        row["last_error_code"] = normalize_failure_code(result.get("error_code"), error=result.get("error"), error_type=result.get("error_type"), success=result.get("success"))
        row["last_result"] = result
        row["updated_at"] = _now_iso()

        if success:
            row["status"] = "completed"
            row["completed_at"] = _now_iso()
            row["retry_at"] = None
            process.setdefault("results_by_node", {})[node_id] = {
                "success": True,
                "status": row["status"],
                "status_code": result.get("status_code"),
                "response": result.get("response"),
                "error": result.get("error"),
                "elapsed_ms": result.get("elapsed_ms"),
                "completed_at": row["completed_at"],
                "attempts": attempts,
                "error_code": row.get("last_error_code"),
                "belief_context": result.get("belief_context"),
                "produced_belief_ids": list(result.get("produced_belief_ids") or []),
                "produced_belief_count": int(result.get("produced_belief_count", 0) or 0),
            }
            process["wake_requested_at"] = None
            _refresh_process(process)
            _append_event(state, process_id, "node_completed", {"node_id": node_id, "status_code": result.get("status_code"), "attempts": attempts})
            if _node_is_test(row):
                _append_event(state, process_id, "session.test-finished", _session_event_payload(process, summary=f"tests finished: {row.get('title')}", extra={"node_id": node_id, "status_code": result.get("status_code")}))
            if str(process.get("status") or "") == "completed":
                _append_event(state, process_id, "session.finished", _session_event_payload(process, summary="runtime process completed"))
            save_state(state)
            return process

        if retry_allowed:
            backoff = float(row.get("retry_backoff_seconds", 0.0) or 0.0)
            row["status"] = "waiting"
            row["completed_at"] = None
            row["retry_at"] = _retry_wait_until(backoff_seconds=backoff)
            row["wait_until"] = row.get("retry_at")
            process["wake_requested_at"] = None
            process.setdefault("results_by_node", {}).pop(node_id, None)
            _refresh_process(process)
            _append_event(state, process_id, "node_retry_scheduled", {"node_id": node_id, "attempts": attempts, "max_attempts": max_attempts, "retry_at": row.get("retry_at")})
            _append_event(state, process_id, "session.retry-needed", _session_event_payload(process, summary=f"retry scheduled for {row.get('title')}", extra={"node_id": node_id, "retry_at": row.get("retry_at"), "attempts": attempts}))
            save_state(state)
            return process

        row["status"] = "failed"
        row["completed_at"] = _now_iso()
        row["retry_at"] = None
        process.setdefault("results_by_node", {})[node_id] = {
            "success": False,
            "status": row["status"],
            "status_code": result.get("status_code"),
            "response": result.get("response"),
            "error": result.get("error"),
            "elapsed_ms": result.get("elapsed_ms"),
            "completed_at": row["completed_at"],
            "attempts": attempts,
            "error_code": row.get("last_error_code"),
            "belief_context": result.get("belief_context"),
            "produced_belief_ids": list(result.get("produced_belief_ids") or []),
            "produced_belief_count": int(result.get("produced_belief_count", 0) or 0),
        }
        process["wake_requested_at"] = None

        if str(row.get("failure_mode") or "continue") == "halt":
            for other_id, other in (process.get("nodes") or {}).items():
                if other_id == node_id or not isinstance(other, dict):
                    continue
                if str(other.get("status") or "pending") in {"completed", "failed", "cancelled"}:
                    continue
                blocked = [node_id]
                depends_on = [str(x) for x in (other.get("depends_on") or []) if str(x).strip()]
                if depends_on:
                    blocked = depends_on if node_id in depends_on else [node_id]
                other["status"] = "blocked"
                other["blocked_by"] = blocked
                other["updated_at"] = _now_iso()
                other["last_error"] = f"halted_due_to_failure:{node_id}"
            process["status"] = "failed"
            process["completed_at"] = _now_iso()

        _refresh_process(process)
        _append_event(state, process_id, "node_failed", {"node_id": node_id, "status_code": result.get("status_code"), "attempts": attempts})
        if _node_is_test(row):
            _append_event(state, process_id, "session.test-failed", _session_event_payload(process, summary=f"tests failed: {row.get('title')}", extra={"node_id": node_id, "status_code": result.get("status_code"), "error": result.get("error")}))
        if str(process.get("status") or "") == "failed":
            _append_event(state, process_id, "session.failed", _session_event_payload(process, summary=f"runtime process failed at {row.get('title')}", extra={"node_id": node_id, "error": result.get("error")}))
        save_state(state)
        return process

def wake_process(process_id: str) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        process = (state.get("processes") or {}).get(process_id)
        if not isinstance(process, dict):
            raise ReasoningSchedulerError(f"unknown process: {process_id}")
        process["wake_requested_at"] = _now_iso()
        _refresh_process(process)
        _append_event(state, process_id, "process_wake", {})
        _append_event(state, process_id, "session.started", _session_event_payload(process, summary="runtime process woken"))
        save_state(state)
        return process
def cancel_process(process_id: str, *, reason: str = "cancelled_by_operator") -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        process = (state.get("processes") or {}).get(process_id)
        if not isinstance(process, dict):
            raise ReasoningSchedulerError(f"unknown process: {process_id}")
        _cancel_open_nodes(process, reason=reason)
        process["enabled"] = False
        process["status"] = "cancelled"
        process["completed_at"] = process.get("completed_at") or _now_iso()
        process["updated_at"] = _now_iso()
        _append_event(state, process_id, "process_cancelled", {"reason": reason})
        _append_event(state, process_id, "session.failed", _session_event_payload(process, summary=f"runtime process cancelled: {reason}", extra={"reason": reason}))
        save_state(state)
        return process

def pause_process(process_id: str) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        process = (state.get("processes") or {}).get(process_id)
        if not isinstance(process, dict):
            raise ReasoningSchedulerError(f"unknown process: {process_id}")
        process["enabled"] = False
        process["status"] = "paused"
        process["updated_at"] = _now_iso()
        _append_event(state, process_id, "process_paused", {})
        _append_event(state, process_id, "session.blocked", _session_event_payload(process, summary="runtime process paused"))
        save_state(state)
        return process
def resume_process(process_id: str) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        process = (state.get("processes") or {}).get(process_id)
        if not isinstance(process, dict):
            raise ReasoningSchedulerError(f"unknown process: {process_id}")
        process["enabled"] = True
        now_dt = _now()
        recurrence = process.get("recurrence") if isinstance(process.get("recurrence"), dict) else {}
        cadence_seconds = max(0, int(recurrence.get("cadence_seconds", 0) or 0))
        if cadence_seconds > 0 and _parse_dt(recurrence.get("next_run_at")) is None:
            recurrence["next_run_at"] = _next_recurrence_at(cadence_seconds=cadence_seconds, from_time=now_dt)
        _refresh_process(process, now=now_dt)
        _append_event(state, process_id, "process_resumed", {})
        _append_event(state, process_id, "session.started", _session_event_payload(process, summary="runtime process resumed"))
        save_state(state)
        return process

def record_process_event(process_id: str, kind: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        process = (state.get("processes") or {}).get(process_id)
        if not isinstance(process, dict):
            raise ReasoningSchedulerError(f"unknown process: {process_id}")
        process["updated_at"] = _now_iso()
        _append_event(state, process_id, kind, dict(payload or {}))
        save_state(state)
        return process

def process_events(process_id: str, *, limit: int = 50) -> List[Dict[str, Any]]:
    with _LOCK:
        state = load_state()
        events = [row for row in (state.get("events") or []) if isinstance(row, dict) and row.get("process_id") == process_id]
        return [normalize_runtime_event(row) for row in events[-max(0, int(limit)) :]]
def runtime_status() -> Dict[str, Any]:
    processes = list_processes()
    by_status: Dict[str, int] = {}
    for process in processes:
        status = str(process.get("status") or "unknown")
        by_status[status] = by_status.get(status, 0) + 1
    return {
        "version": "cortex.reasoning.scheduler.v1",
        "process_count": len(processes),
        "by_status": by_status,
        "processes": [
            {
                "process_id": row.get("process_id"),
                "task_id": row.get("task_id"),
                "name": ((row.get("workflow") or {}).get("name")),
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "completed_at": row.get("completed_at"),
                "enabled": row.get("enabled"),
                "run_count": row.get("run_count"),
                "next_run_at": (((row.get("recurrence") or {}).get("next_run_at"))),
                "session_projection": dict(row.get("session_projection") or {}),
            }
            for row in processes
        ],
    }


__all__ = [
    "ReasoningSchedulerError",
    "create_process_from_workflow",
    "get_process",
    "list_processes",
    "replace_process_workflow",
    "mark_node_running",
    "cancel_process",
    "pause_process",
    "process_events",
    "record_node_result",
    "resume_process",
    "runtime_status",
    "scheduler_tick",
    "wake_process",
]
