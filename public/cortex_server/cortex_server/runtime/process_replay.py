from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from cortex_server.runtime.process_event import ProcessEvent
from cortex_server.runtime.process_journal import ProcessJournal
from cortex_server.runtime.process_snapshot import ProcessSnapshot


JsonDict = Dict[str, Any]



def default_process_state(process_id: str) -> JsonDict:
    return {
        "process_id": process_id,
        "lifecycle_state": "created",
        "event_count": 0,
        "last_event_id": None,
        "active_steps": [],
        "waiting_steps": [],
        "completed_steps": [],
        "failed_steps": [],
        "assigned_agents": {},
        "runtime_policy": {},
        "session_state": {},
        "world_state": {},
        "belief_refs": [],
        "artifact_refs": [],
        "metadata": {},
    }



def state_from_snapshot(snapshot: ProcessSnapshot) -> JsonDict:
    return {
        "process_id": snapshot.process_id,
        "lifecycle_state": snapshot.lifecycle_state,
        "event_count": snapshot.event_count,
        "last_event_id": snapshot.last_event_id,
        "active_steps": list(snapshot.active_steps),
        "waiting_steps": list(snapshot.waiting_steps),
        "completed_steps": list(snapshot.completed_steps),
        "failed_steps": list(snapshot.failed_steps),
        "assigned_agents": dict(snapshot.assigned_agents),
        "runtime_policy": dict(snapshot.runtime_policy),
        "session_state": dict(snapshot.session_state),
        "world_state": dict(snapshot.world_state),
        "belief_refs": list(snapshot.belief_refs),
        "artifact_refs": list(snapshot.artifact_refs),
        "metadata": dict(snapshot.metadata),
    }



def _dedupe_append(values: List[str], value: str) -> None:
    value = str(value or "").strip()
    if value and value not in values:
        values.append(value)



def _remove(values: List[str], value: str) -> None:
    value = str(value or "").strip()
    if value in values:
        values.remove(value)



def _restore_list(values: Any) -> List[str]:
    rows: List[str] = []
    for value in values or []:
        text = str(value or "").strip()
        if text and text not in rows:
            rows.append(text)
    return rows



def _restore_map(values: Any) -> JsonDict:
    return dict(values or {}) if isinstance(values, dict) else {}



def apply_event(state: JsonDict, event: ProcessEvent) -> JsonDict:
    state = dict(state or {})
    payload = dict(event.payload or {})
    kind = event.kind
    state["process_id"] = event.process_id
    state["event_count"] = int(state.get("event_count", 0) or 0) + 1
    state["last_event_id"] = event.event_id

    if kind == "process_created":
        state["lifecycle_state"] = "created"
        state["metadata"] = {**dict(state.get("metadata") or {}), **payload}
    elif kind == "process_planned":
        state["lifecycle_state"] = "planned"
    elif kind == "process_started":
        state["lifecycle_state"] = "running"
    elif kind == "process_waiting":
        state["lifecycle_state"] = "waiting"
        _dedupe_append(state.setdefault("waiting_steps", []), payload.get("node_id") or payload.get("step_id") or "")
    elif kind == "process_resumed":
        state["lifecycle_state"] = "running"
        _remove(state.setdefault("waiting_steps", []), payload.get("node_id") or payload.get("step_id") or "")
    elif kind == "process_blocked":
        state["lifecycle_state"] = "blocked"
    elif kind == "process_failed":
        state["lifecycle_state"] = "failed"
    elif kind == "process_completed":
        state["lifecycle_state"] = "completed"
    elif kind == "process_cancelled":
        state["lifecycle_state"] = "cancelled"
    elif kind in {"process_rolled_back", "release_rolled_back"}:
        restore = payload.get("restore_state") if isinstance(payload.get("restore_state"), dict) else {}
        if restore:
            state["lifecycle_state"] = str(restore.get("lifecycle_state") or payload.get("lifecycle_state") or "rolled_back")
            state["active_steps"] = _restore_list(restore.get("active_steps"))
            state["waiting_steps"] = _restore_list(restore.get("waiting_steps"))
            state["completed_steps"] = _restore_list(restore.get("completed_steps"))
            state["failed_steps"] = _restore_list(restore.get("failed_steps"))
            state["assigned_agents"] = _restore_map(restore.get("assigned_agents"))
            state["runtime_policy"] = _restore_map(restore.get("runtime_policy"))
            state["session_state"] = _restore_map(restore.get("session_state"))
            state["world_state"] = _restore_map(restore.get("world_state"))
            state["belief_refs"] = _restore_list(restore.get("belief_refs"))
            state["artifact_refs"] = _restore_list(restore.get("artifact_refs"))
            restore_metadata = _restore_map(restore.get("metadata"))
            state["metadata"] = {
                **restore_metadata,
                "rollback_event_id": event.event_id,
                "rolled_back_from_event_id": payload.get("rolled_back_from_event_id"),
                "rolled_back_to_event_id": payload.get("rolled_back_to_event_id"),
                "rollback_reason": payload.get("reason"),
            }
        else:
            state["lifecycle_state"] = "rolled_back"
            state["metadata"] = {
                **dict(state.get("metadata") or {}),
                "rollback_event_id": event.event_id,
                "rolled_back_from_event_id": payload.get("rolled_back_from_event_id"),
                "rolled_back_to_event_id": payload.get("rolled_back_to_event_id"),
                "rollback_reason": payload.get("reason"),
            }
    elif kind == "step_started":
        state["lifecycle_state"] = "running"
        node_id = payload.get("node_id") or payload.get("step_id") or ""
        _dedupe_append(state.setdefault("active_steps", []), node_id)
        _remove(state.setdefault("waiting_steps", []), node_id)
    elif kind == "step_completed":
        node_id = payload.get("node_id") or payload.get("step_id") or ""
        _remove(state.setdefault("active_steps", []), node_id)
        _dedupe_append(state.setdefault("completed_steps", []), node_id)
    elif kind == "step_failed":
        node_id = payload.get("node_id") or payload.get("step_id") or ""
        _remove(state.setdefault("active_steps", []), node_id)
        _dedupe_append(state.setdefault("failed_steps", []), node_id)
    elif kind == "agent_assigned":
        node_id = str(payload.get("node_id") or payload.get("step_id") or payload.get("scope") or "").strip()
        agent_id = str(payload.get("agent_id") or payload.get("agent") or event.actor or "").strip()
        if node_id and agent_id:
            state.setdefault("assigned_agents", {})[node_id] = agent_id
    elif kind == "world_state_updated":
        state["world_state"] = {**dict(state.get("world_state") or {}), **dict(payload.get("world_state") or payload)}
    elif kind == "belief_written":
        _dedupe_append(state.setdefault("belief_refs", []), payload.get("claim_id") or payload.get("belief_id") or "")
    elif kind == "artifact_written":
        _dedupe_append(state.setdefault("artifact_refs", []), payload.get("artifact_id") or payload.get("path") or "")
    elif kind == "policy_patch_applied":
        state["runtime_policy"] = {**dict(state.get("runtime_policy") or {}), **dict(payload.get("metadata_overrides") or {})}
    elif kind == "operator_override":
        state["runtime_policy"] = {**dict(state.get("runtime_policy") or {}), **dict(payload.get("runtime_policy") or payload.get("metadata_overrides") or {})}
    elif kind.startswith("session."):
        session_state = dict(state.get("session_state") or {})
        session_state["last_event_kind"] = kind
        session_state["last_event_id"] = event.event_id
        summary = str(payload.get("summary") or payload.get("operator_summary") or payload.get("reason") or "").strip()
        if summary:
            session_state["last_summary"] = summary
        session_state["tool"] = str(payload.get("tool") or session_state.get("tool") or "").strip() or session_state.get("tool")
        session_state["session_id"] = str(payload.get("session_id") or session_state.get("session_id") or "").strip() or session_state.get("session_id")
        session_state["session_name"] = str(payload.get("session_name") or session_state.get("session_name") or "").strip() or session_state.get("session_name")
        mapping = {
            "session.started": "running",
            "session.finished": "finished",
            "session.failed": "failed",
            "session.blocked": "blocked",
            "session.retry-needed": "retry-needed",
            "session.handoff-needed": "handoff-needed",
            "session.stale": "stale",
            "session.pr-created": "pr-created",
            "session.test-started": "testing",
            "session.test-finished": "running",
            "session.test-failed": "test-failed",
        }
        session_state["status"] = mapping.get(kind, session_state.get("status") or state.get("lifecycle_state"))
        if kind == "session.retry-needed":
            session_state["retry_count"] = int(session_state.get("retry_count", 0) or 0) + 1
        if kind in {"session.blocked", "session.retry-needed", "session.handoff-needed", "session.stale", "session.test-failed"} and summary:
            questions = [str(row).strip() for row in (session_state.get("open_questions") or []) if str(row).strip()]
            if summary not in questions:
                questions.append(summary)
            session_state["open_questions"] = questions
        if kind.startswith("session.test-"):
            session_state["test_status"] = kind.split("session.", 1)[-1]
        state["session_state"] = session_state

    return state



def replay_events(process_id: str, events: Iterable[ProcessEvent], *, snapshot: Optional[ProcessSnapshot] = None) -> JsonDict:
    state = state_from_snapshot(snapshot) if snapshot else default_process_state(process_id)
    started = snapshot is None
    for event in events:
        if event.process_id != process_id:
            continue
        if not started:
            if event.event_id == snapshot.last_event_id:
                started = True
            continue
        state = apply_event(state, event)
    return state



def replay_from_journal(journal: ProcessJournal, process_id: str, *, snapshot: Optional[ProcessSnapshot] = None) -> JsonDict:
    events = journal.load(process_id=process_id)
    return replay_events(process_id, events, snapshot=snapshot)


__all__ = [
    "apply_event",
    "default_process_state",
    "replay_events",
    "replay_from_journal",
    "state_from_snapshot",
]
