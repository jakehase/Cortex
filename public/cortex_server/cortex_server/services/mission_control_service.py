from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import uuid4

from fastapi import HTTPException

import cortex_server.routers.orchestrator as orchestrator
from cortex_server.modules import cortex_kernel_v2, runtime_pressure
from cortex_server.modules.cortex_codec import get_codec_packet_for_session
from cortex_server.modules.evidence_governance import capability_matrix
from cortex_server.modules.evidence_lineage import build_lineage_bundle
from cortex_server.modules.reasoning_scheduler import (
    get_process,
    list_processes,
    pause_process,
    process_events,
    record_process_event,
    resume_process,
    wake_process,
)
from cortex_server.runtime import derive_session_plane, session_plane_blocker_entry


JsonDict = Dict[str, Any]
TERMINAL_PROCESS_STATUSES = {"completed", "failed", "cancelled"}
LIVE_PROCESS_STATUSES = {"scheduled", "running", "waiting", "ready", "blocked", "rolled_back"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _model_dump(model: Any) -> JsonDict:
    if model is None:
        return {}
    if hasattr(model, "model_dump"):
        return model.model_dump()
    if hasattr(model, "dict"):
        return model.dict()
    return dict(model)


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None


def _sort_ts(value: Optional[str]) -> Tuple[int, str]:
    parsed = _parse_dt(value)
    if parsed is None:
        return (0, "")
    return (1, parsed.isoformat())


def _stores() -> Dict[str, Any]:
    return orchestrator._runtime_delivery_stores()


def _sync_queue(stores: Dict[str, Any]) -> Dict[str, Any]:
    return orchestrator._runtime_maintenance_queue_sync(stores=stores, now=None, allow_claim=False)


def _session_plane_view(
    *,
    process: Optional[JsonDict],
    queue_item: Optional[JsonDict],
    snapshot: Optional[JsonDict],
    shared_state: Optional[JsonDict],
) -> Optional[JsonDict]:
    queue_projection = ((queue_item or {}).get("projection") if isinstance((queue_item or {}).get("projection"), dict) else {}) or {}
    queue_session_plane = dict(queue_projection.get("session_plane") or {}) if isinstance(queue_projection.get("session_plane"), dict) else {}
    snapshot_session_state = dict((snapshot or {}).get("session_state") or {}) if isinstance((snapshot or {}).get("session_state"), dict) else {}
    watcher_rows = list(queue_session_plane.get("watchers") or []) if isinstance(queue_session_plane.get("watchers"), list) else []
    if not watcher_rows and isinstance(queue_session_plane.get("watcher_count"), int) and int(queue_session_plane.get("watcher_count") or 0) > 0:
        watcher_rows = [{} for _ in range(int(queue_session_plane.get("watcher_count") or 0))]
    return derive_session_plane(
        process=process,
        session_rows=list(queue_session_plane.get("sessions") or []),
        watcher_rows=watcher_rows,
        snapshot_state=snapshot_session_state,
        shared_state=shared_state,
        queue_session_plane=queue_session_plane,
    )


def _status_rank(status: Optional[str]) -> int:
    key = str(status or "").strip().lower()
    if key == "blocked":
        return 0
    if key == "paused":
        return 1
    if key == "active":
        return 2
    if key == "pending":
        return 3
    if key == "completed":
        return 4
    return 5


def _sort_objective_key(row: JsonDict) -> Tuple[int, Tuple[int, str], Tuple[int, str], Tuple[int, str], str]:
    follow_up = (row.get("follow_up") if isinstance(row.get("follow_up"), dict) else {}) or {}
    queue = (row.get("queue") if isinstance(row.get("queue"), dict) else {}) or {}
    return (
        _status_rank(row.get("status")),
        _sort_ts(follow_up.get("due_at")),
        _sort_ts(queue.get("created_at")),
        _sort_ts(row.get("updated_at")),
        str(row.get("objective_key") or ""),
    )


def _normalize_status(*, queue_item: Optional[JsonDict], roadmap_state: Optional[JsonDict], delivery_state: Optional[JsonDict], process: Optional[JsonDict]) -> str:
    process_status = str((process or {}).get("status") or "").strip().lower()
    queue_status = str((queue_item or {}).get("status") or "").strip().lower()
    roadmap_status = str((roadmap_state or {}).get("status") or "").strip().lower()
    delivery_status = str((delivery_state or {}).get("status") or "").strip().lower()
    runtime_statuses = {queue_status, roadmap_status, delivery_status}

    if "blocked" in runtime_statuses:
        return "blocked"
    if process_status == "paused":
        return "paused"
    if "active" in runtime_statuses:
        return "active"
    if "completed" in runtime_statuses:
        return "completed"
    if queue_status == "pending":
        return "pending"
    if process_status in {"scheduled", "running", "waiting", "ready", "blocked", "rolled_back"}:
        return "active"
    if process_status in TERMINAL_PROCESS_STATUSES:
        return "completed" if process_status == "completed" else process_status
    return queue_status or roadmap_status or delivery_status or process_status or "pending"


def _blocker_fingerprint(blocker: JsonDict) -> str:
    projection = {
        "source": blocker.get("source"),
        "summary": blocker.get("summary"),
        "task_id": blocker.get("task_id"),
        "phase_id": blocker.get("phase_id"),
        "decision_id": blocker.get("decision_id"),
        "rule_id": blocker.get("rule_id"),
        "blocker_class": blocker.get("blocker_class"),
        "requires_human": bool(blocker.get("requires_human")),
    }
    return json.dumps(projection, sort_keys=True, separators=(",", ":"))


def _acknowledged_blockers(shared_state: Optional[JsonDict]) -> JsonDict:
    operator_overrides = dict((shared_state or {}).get("operator_overrides") or {})
    mission_control = dict(operator_overrides.get("mission_control") or {})
    acknowledged = dict(mission_control.get("acknowledged_blockers") or {})
    return acknowledged if isinstance(acknowledged, dict) else {}


def _blocker_views(blockers: Sequence[JsonDict], *, shared_state: Optional[JsonDict]) -> List[JsonDict]:
    acknowledged = _acknowledged_blockers(shared_state)
    rows: List[JsonDict] = []
    seen = set()
    for raw in blockers or []:
        if not isinstance(raw, dict):
            continue
        fingerprint = _blocker_fingerprint(raw)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        ack = dict(acknowledged.get(fingerprint) or {})
        rows.append(
            {
                **dict(raw),
                "fingerprint": fingerprint,
                "acknowledged": bool(ack),
                "acknowledgement": ack or None,
            }
        )
    return rows


def _mailbox_summary(rows: Sequence[Any]) -> JsonDict:
    counts: Dict[str, int] = {}
    recent: List[JsonDict] = []
    for row in rows or []:
        payload = _model_dump(row)
        status = str(payload.get("delivery_status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
        recent.append(
            {
                "message_id": payload.get("message_id"),
                "kind": payload.get("kind"),
                "from_agent": payload.get("from_agent"),
                "to_agent": payload.get("to_agent"),
                "delivery_status": payload.get("delivery_status"),
                "created_at": payload.get("created_at"),
                "acked_at": payload.get("acked_at"),
                "dead_lettered_at": payload.get("dead_lettered_at"),
                "metadata": dict(payload.get("metadata") or {}),
            }
        )
    recent.sort(key=lambda row: _sort_ts(row.get("created_at")), reverse=True)
    return {
        "count": len(recent),
        "by_status": counts,
        "recent": recent[:8],
    }


def _lease_views(rows: Sequence[Any]) -> List[JsonDict]:
    now = _now()
    leases: List[JsonDict] = []
    for row in rows or []:
        payload = _model_dump(row)
        expires_at = _parse_dt(payload.get("expires_at"))
        leases.append(
            {
                **payload,
                "stale": bool(payload.get("status") == "active" and expires_at is not None and expires_at <= now),
            }
        )
    leases.sort(key=lambda row: _sort_ts(row.get("heartbeat_at")), reverse=True)
    return leases


def _active_worker(process: Optional[JsonDict], *, roadmap_state: Optional[JsonDict], delivery_state: Optional[JsonDict], leases: Sequence[JsonDict]) -> Tuple[Optional[JsonDict], List[JsonDict]]:
    roster: List[JsonDict] = []
    for lease in leases or []:
        roster.append(
            {
                "agent_id": lease.get("agent_id"),
                "scope": lease.get("scope"),
                "lease_id": lease.get("lease_id"),
                "status": lease.get("status"),
                "heartbeat_at": lease.get("heartbeat_at"),
                "expires_at": lease.get("expires_at"),
                "source": "lease",
            }
        )

    roadmap_controller = dict((roadmap_state or {}).get("controller") or {})
    if roadmap_controller:
        roster.append(
            {
                "agent_id": roadmap_controller.get("controller_id"),
                "scope": "roadmap_controller",
                "lease_id": roadmap_controller.get("lease_id"),
                "status": "active",
                "heartbeat_at": roadmap_controller.get("heartbeat_at"),
                "expires_at": None,
                "source": "roadmap_controller",
            }
        )
    delivery_controller = dict((delivery_state or {}).get("controller") or {})
    if delivery_controller:
        roster.append(
            {
                "agent_id": delivery_controller.get("controller_id"),
                "scope": "delivery_controller",
                "lease_id": delivery_controller.get("lease_id"),
                "status": "active",
                "heartbeat_at": delivery_controller.get("heartbeat_at"),
                "expires_at": None,
                "source": "delivery_controller",
            }
        )

    task_states = list((roadmap_state or {}).get("task_states") or [])
    for task in task_states:
        if not isinstance(task, dict):
            continue
        if not task.get("assigned_agent_id"):
            continue
        if str(task.get("status") or "") not in {"active", "blocked", "in_progress"}:
            continue
        roster.append(
            {
                "agent_id": task.get("assigned_agent_id"),
                "scope": f"roadmap_task:{task.get('task_id')}",
                "lease_id": task.get("lease_id"),
                "status": task.get("status"),
                "heartbeat_at": task.get("updated_at"),
                "expires_at": None,
                "source": "roadmap_task",
            }
        )

    if process and process.get("owner"):
        roster.append(
            {
                "agent_id": process.get("owner"),
                "scope": "process_owner",
                "lease_id": None,
                "status": process.get("status"),
                "heartbeat_at": process.get("updated_at"),
                "expires_at": None,
                "source": "process_owner",
            }
        )

    deduped: List[JsonDict] = []
    seen = set()
    for row in roster:
        key = (str(row.get("agent_id") or ""), str(row.get("scope") or ""), str(row.get("source") or ""))
        if key in seen or not key[0]:
            continue
        seen.add(key)
        deduped.append(row)
    deduped.sort(key=lambda row: _sort_ts(row.get("heartbeat_at")), reverse=True)
    return (deduped[0] if deduped else None), deduped


def _report_view(report: JsonDict, *, runtime_kind: str, objective_key: str, objective_title: str) -> JsonDict:
    return {
        "runtime_kind": runtime_kind,
        "objective_key": objective_key,
        "objective_title": objective_title,
        "report_id": report.get("report_id"),
        "process_id": report.get("process_id"),
        "iteration": report.get("iteration"),
        "kind": report.get("kind"),
        "status": report.get("status"),
        "summary": report.get("summary"),
        "recorded_at": report.get("recorded_at"),
        "active_phase_id": report.get("active_phase_id"),
        "stage": report.get("stage"),
        "actions_taken": list(report.get("actions_taken") or []),
        "blockers": list(report.get("blockers") or []),
        "metadata": dict(report.get("metadata") or {}),
    }


def _recent_reports(roadmap_reports: Sequence[Any], delivery_reports: Sequence[Any], *, objective_key: str, objective_title: str, limit: int = 8) -> List[JsonDict]:
    rows: List[JsonDict] = []
    for report in roadmap_reports or []:
        rows.append(_report_view(_model_dump(report), runtime_kind="roadmap", objective_key=objective_key, objective_title=objective_title))
    for report in delivery_reports or []:
        rows.append(_report_view(_model_dump(report), runtime_kind="delivery", objective_key=objective_key, objective_title=objective_title))
    rows.sort(key=lambda row: _sort_ts(row.get("recorded_at")), reverse=True)
    return rows[:limit]


def _follow_up_summary(rows: Sequence[Any]) -> JsonDict:
    payloads = [_model_dump(row) for row in rows or []]
    payloads.sort(key=lambda row: _sort_ts(row.get("created_at")), reverse=True)
    queued = [row for row in payloads if row.get("delivery_status") == "queued"]
    failed = [row for row in payloads if row.get("delivery_status") == "failed"]
    latest = payloads[0] if payloads else None
    due_candidates = [row.get("due_at") for row in payloads if row.get("due_at")]
    due_at = sorted(due_candidates, key=_sort_ts)[0] if due_candidates else None
    return {
        "count": len(payloads),
        "queued_count": len(queued),
        "failed_count": len(failed),
        "latest": latest,
        "due_at": due_at,
        "dispatches": payloads[:8],
    }


def _queue_summary(queue_item: Optional[JsonDict]) -> Optional[JsonDict]:
    if not queue_item:
        return None
    return {
        "item_id": queue_item.get("item_id"),
        "queue_name": queue_item.get("queue_name"),
        "status": queue_item.get("status"),
        "priority": queue_item.get("priority"),
        "item_kind": queue_item.get("item_kind"),
        "created_at": queue_item.get("created_at"),
        "claimed_at": queue_item.get("claimed_at"),
        "completed_at": queue_item.get("completed_at"),
        "blocked_at": queue_item.get("blocked_at"),
        "last_transition_at": queue_item.get("last_transition_at"),
        "source_message": dict(queue_item.get("source_message") or {}),
    }


def _available_actions(*, objective_key: str, process: Optional[JsonDict], queue_item: Optional[JsonDict], blockers: Sequence[JsonDict]) -> List[JsonDict]:
    actions: List[JsonDict] = []
    process_status = str((process or {}).get("status") or "").strip().lower()
    enabled = bool((process or {}).get("enabled")) if process is not None else False
    if process is not None and enabled and process_status not in TERMINAL_PROCESS_STATUSES | {"paused"}:
        actions.append({"action": "pause", "label": "Pause objective", "objective_key": objective_key})
    if process is not None and (process_status == "paused" or not enabled):
        actions.append({"action": "resume", "label": "Resume objective", "objective_key": objective_key})
    if process is not None and process_status not in TERMINAL_PROCESS_STATUSES:
        actions.append({"action": "wake", "label": "Wake objective", "objective_key": objective_key})
    if any(not bool(row.get("acknowledged")) for row in blockers or []):
        actions.append({"action": "acknowledge_blocker", "label": "Acknowledge blocker", "objective_key": objective_key})
    queue_status = str((queue_item or {}).get("status") or "").strip().lower()
    if queue_item is not None and queue_status in {"blocked", "completed"}:
        actions.append({"action": "requeue", "label": "Requeue maintenance item", "objective_key": objective_key})
    return actions


def _objective_view(*, process: Optional[JsonDict], queue_item: Optional[JsonDict], stores: Dict[str, Any], detail: bool) -> JsonDict:
    process_id = str((process or {}).get("process_id") or (queue_item or {}).get("process_id") or "").strip() or None
    queue_payload = dict(queue_item or {}) if queue_item else None

    roadmap_contract_model = stores["roadmap_store"].load_contract(process_id) if process_id else None
    roadmap_state_model = stores["roadmap_store"].load_state(process_id) if process_id else None
    roadmap_reports_model = stores["roadmap_store"].reports(process_id) if process_id else []
    delivery_contract_model = stores["loop_store"].load_contract(process_id) if process_id else None
    delivery_state_model = stores["loop_store"].load_state(process_id) if process_id else None
    delivery_reports_model = stores["loop_store"].reports(process_id) if process_id else []
    release_state_model = stores["release_store"].load(process_id) if process_id else None
    snapshot_model = stores["snapshot_store"].load(process_id) if process_id else None
    shared_state_model = stores["shared_state_store"].load(process_id) if process_id else None
    follow_up_rows = stores["follow_up_store"].list(process_id=process_id) if process_id else []
    mailbox_rows = stores["mailbox"].list(process_id=process_id) if process_id else []
    lease_rows = stores["supervisor"].list(process_id=process_id) if process_id else []

    roadmap_contract = _model_dump(roadmap_contract_model) if roadmap_contract_model is not None else None
    roadmap_state = _model_dump(roadmap_state_model) if roadmap_state_model is not None else None
    delivery_contract = _model_dump(delivery_contract_model) if delivery_contract_model is not None else None
    delivery_state = _model_dump(delivery_state_model) if delivery_state_model is not None else None
    release_state = _model_dump(release_state_model) if release_state_model is not None else None
    snapshot = _model_dump(snapshot_model) if snapshot_model is not None else None
    shared_state = _model_dump(shared_state_model) if shared_state_model is not None else None
    session_plane = _session_plane_view(process=process, queue_item=queue_payload, snapshot=snapshot, shared_state=shared_state)

    objective_title = (
        str((queue_payload or {}).get("objective") or "").strip()
        or str((roadmap_contract or {}).get("objective") or "").strip()
        or str((delivery_contract or {}).get("objective") or "").strip()
        or str(((process or {}).get("workflow") or {}).get("name") or "").strip()
        or process_id
        or str((queue_payload or {}).get("item_id") or "mission-control")
    )
    objective_key = str((queue_payload or {}).get("item_id") or process_id or "").strip() or f"objective_{uuid4().hex[:8]}"

    source_types: List[str] = []
    if queue_payload is not None:
        source_types.append("maintenance")
    if roadmap_contract is not None or roadmap_state is not None:
        source_types.append("roadmap")
    if delivery_contract is not None or delivery_state is not None or release_state is not None:
        source_types.append("delivery")
    if not source_types:
        source_types.append("runtime")

    blockers: List[JsonDict] = []
    blockers.extend(list((roadmap_state or {}).get("true_blockers") or []))
    blockers.extend(list((delivery_state or {}).get("true_blockers") or []))
    session_blocker = session_plane_blocker_entry(session_plane)
    if isinstance(session_blocker, dict):
        blockers.append(session_blocker)
    if queue_payload is not None and str(queue_payload.get("status") or "") == "blocked" and not blockers:
        blockers.append(
            {
                "source": "maintenance_queue",
                "summary": str((queue_payload.get("summary") or queue_payload.get("objective") or "maintenance item blocked")).strip() or "maintenance item blocked",
                "requires_human": True,
                "terminal": False,
            }
        )
    blocker_views = _blocker_views(blockers, shared_state=shared_state)

    follow_up = _follow_up_summary(follow_up_rows)
    mailbox = _mailbox_summary(mailbox_rows)
    leases = _lease_views(lease_rows)
    active_worker, worker_roster = _active_worker(process, roadmap_state=roadmap_state, delivery_state=delivery_state, leases=leases)

    roadmap_projection = (
        orchestrator._runtime_roadmap_projection(
            contract=roadmap_contract_model,
            state=roadmap_state,
            latest_report=_model_dump(roadmap_reports_model[-1]) if roadmap_reports_model else None,
            snapshot=snapshot_model,
            shared_state=shared_state_model,
        )
        if roadmap_contract_model is not None or roadmap_state is not None
        else None
    )
    delivery_projection = (
        orchestrator._runtime_delivery_projection(
            contract=delivery_contract_model,
            loop_state=delivery_state_model,
            release_state=release_state_model,
            snapshot=snapshot_model,
            shared_state=shared_state_model,
            latest_report=delivery_reports_model[-1] if delivery_reports_model else None,
        )
        if delivery_contract_model is not None or delivery_state_model is not None or release_state_model is not None
        else None
    )

    status = _normalize_status(queue_item=queue_payload, roadmap_state=roadmap_state, delivery_state=delivery_state, process=process)
    conversation = dict(
        (roadmap_state or {}).get("conversation_ownership")
        or (delivery_state or {}).get("conversation_ownership")
        or (((queue_payload or {}).get("projection") if isinstance((queue_payload or {}).get("projection"), dict) else {}) or {}).get("conversation_ownership")
        or {}
    )
    follow_through = dict((roadmap_state or {}).get("follow_through") or (delivery_state or {}).get("follow_through") or {})
    due_at = (
        follow_through.get("next_required_update_at")
        or (((roadmap_state or {}).get("owed_follow_up") if isinstance((roadmap_state or {}).get("owed_follow_up"), dict) else {}) or {}).get("due_at")
        or (((delivery_state or {}).get("owed_follow_up") if isinstance((delivery_state or {}).get("owed_follow_up"), dict) else {}) or {}).get("due_at")
        or follow_up.get("due_at")
    )

    next_action = dict((roadmap_state or {}).get("next_action") or (delivery_state or {}).get("next_action") or {})
    continuation = dict((roadmap_state or {}).get("continuation") or (delivery_state or {}).get("continuation") or {})
    current_phase = {
        "roadmap_phase_id": (roadmap_state or {}).get("active_phase_id"),
        "roadmap_task_ids": list((roadmap_state or {}).get("active_task_ids") or []),
        "delivery_stage": (delivery_state or {}).get("current_stage") or (release_state or {}).get("current_stage"),
    }
    liveness = (
        (roadmap_state or {}).get("liveness")
        or (delivery_state or {}).get("liveness")
        or (snapshot or {}).get("lifecycle_state")
        or ((process or {}).get("status") if process is not None else None)
    )

    reports = _recent_reports(
        roadmap_reports_model,
        delivery_reports_model,
        objective_key=objective_key,
        objective_title=objective_title,
        limit=10 if detail else 4,
    )

    objective = {
        "objective_key": objective_key,
        "objective_id": (roadmap_contract or {}).get("objective_id") or (delivery_contract or {}).get("contract_id") or (queue_payload or {}).get("item_id") or process_id,
        "process_id": process_id,
        "title": objective_title,
        "summary": str((queue_payload or {}).get("summary") or "").strip() or None,
        "status": status,
        "kind": source_types[0],
        "source_types": source_types,
        "created_at": (
            (queue_payload or {}).get("created_at")
            or (process or {}).get("created_at")
            or (roadmap_state or {}).get("last_checkpoint_at")
            or (delivery_state or {}).get("last_checkpoint_at")
        ),
        "updated_at": (
            (process or {}).get("updated_at")
            or (queue_payload or {}).get("last_transition_at")
            or (roadmap_state or {}).get("last_report_at")
            or (delivery_state or {}).get("last_report_at")
        ),
        "process": {
            "process_id": process_id,
            "workflow_name": (((process or {}).get("workflow") or {}).get("name") if process else None),
            "status": (process or {}).get("status") if process is not None else None,
            "enabled": (process or {}).get("enabled") if process is not None else None,
            "owner": (process or {}).get("owner") if process is not None else None,
            "session_key": (process or {}).get("session_key") if process is not None else None,
            "run_count": (process or {}).get("run_count") if process is not None else None,
            "last_tick_at": (process or {}).get("last_tick_at") if process is not None else None,
            "wake_requested_at": (process or {}).get("wake_requested_at") if process is not None else None,
            "active_nodes": list((snapshot or {}).get("active_steps") or []),
            "waiting_nodes": list((snapshot or {}).get("waiting_steps") or []),
            "completed_nodes": list((snapshot or {}).get("completed_steps") or []),
            "failed_nodes": list((snapshot or {}).get("failed_steps") or []),
        },
        "roadmap": roadmap_projection,
        "delivery": delivery_projection,
        "queue": _queue_summary(queue_payload),
        "release": {
            "release_id": (release_state or {}).get("release_id"),
            "current_stage": (release_state or {}).get("current_stage"),
            "status": (release_state or {}).get("status"),
            "operator_holds": list((release_state or {}).get("operator_holds") or []),
            "rollback_fenceposts": list((release_state or {}).get("rollback_fenceposts") or []),
        }
        if release_state is not None
        else None,
        "current_phase": current_phase,
        "session_plane": session_plane,
        "next_action": next_action,
        "continuation": continuation,
        "active_worker": active_worker,
        "worker_roster": worker_roster,
        "liveness": liveness,
        "conversation_ownership": conversation,
        "follow_through": follow_through,
        "follow_up": {
            "due_at": due_at,
            "latest": follow_up.get("latest"),
            "queued_count": follow_up.get("queued_count"),
            "failed_count": follow_up.get("failed_count"),
            "dispatch_count": follow_up.get("count"),
        },
        "blockers": blocker_views,
        "blocker_status": {
            "count": len(blocker_views),
            "human_required_count": sum(1 for row in blocker_views if row.get("requires_human")),
            "acknowledged_count": sum(1 for row in blocker_views if row.get("acknowledged")),
            "open_count": sum(1 for row in blocker_views if not row.get("acknowledged")),
        },
        "recent_reports": reports,
        "mailbox": mailbox,
        "snapshot": {
            "snapshot_id": (snapshot or {}).get("snapshot_id"),
            "lifecycle_state": (snapshot or {}).get("lifecycle_state"),
            "event_count": (snapshot or {}).get("event_count"),
            "world_state": dict((snapshot or {}).get("world_state") or {}),
        }
        if snapshot is not None
        else None,
        "shared_state": {
            "revision_id": (shared_state or {}).get("revision_id"),
            "open_questions": list((shared_state or {}).get("open_questions") or []),
            "open_decisions": list((shared_state or {}).get("open_decisions") or []),
            "operator_overrides": dict((shared_state or {}).get("operator_overrides") or {}),
            "world_state": dict((shared_state or {}).get("world_state") or {}),
        }
        if shared_state is not None
        else None,
        "available_actions": _available_actions(objective_key=objective_key, process=process, queue_item=queue_payload, blockers=blocker_views),
    }

    if not detail:
        return objective

    history_rows = []
    if process_id:
        for row in stores["shared_state_store"].history(process_id)[-12:]:
            history_rows.append(_model_dump(row))
    runtime_events = process_events(process_id, limit=40) if process_id else []

    return {
        "objective": objective,
        "queue_item": queue_payload,
        "process": process,
        "roadmap_detail": orchestrator._runtime_roadmap_status_payload(process_id, process=process, stores=stores) if process_id and process is not None and (roadmap_contract is not None or roadmap_state is not None) else None,
        "delivery_detail": orchestrator._runtime_delivery_status_payload(process_id, process=process, stores=stores) if process_id and process is not None and (delivery_contract is not None or delivery_state is not None or release_state is not None) else None,
        "follow_up_dispatches": [_model_dump(row) for row in follow_up_rows],
        "mailbox_messages": [_model_dump(row) for row in mailbox_rows[-12:]],
        "leases": leases,
        "runtime_events": runtime_events,
        "shared_state_history": history_rows,
    }


def _resolve_objective(objective_key: str, *, stores: Dict[str, Any]) -> Tuple[Optional[JsonDict], Optional[JsonDict]]:
    target = str(objective_key or "").strip()
    if not target:
        return None, None
    _sync_queue(stores)
    queue_items = [_model_dump(row) for row in stores["maintenance_queue_store"].list()]
    for item in queue_items:
        if item.get("item_id") == target:
            process = get_process(item.get("process_id")) if item.get("process_id") else None
            return item, process
    process = get_process(target)
    if process is not None:
        for item in queue_items:
            if item.get("process_id") == target:
                return item, process
        return None, process
    for item in queue_items:
        if item.get("process_id") == target:
            process = get_process(target)
            return item, process
    return None, None


def board() -> JsonDict:
    stores = _stores()
    _sync_queue(stores)
    kernel_summary = cortex_kernel_v2.mission_control_summary()
    queue_items = [_model_dump(row) for row in stores["maintenance_queue_store"].list()]
    queue_process_ids = {str(item.get("process_id") or "").strip() for item in queue_items if str(item.get("process_id") or "").strip()}
    records: List[JsonDict] = []

    for item in queue_items:
        process = get_process(item.get("process_id")) if item.get("process_id") else None
        records.append(_objective_view(process=process, queue_item=item, stores=stores, detail=False))

    for process in list_processes():
        process_id = str(process.get("process_id") or "").strip()
        if process_id in queue_process_ids:
            continue
        records.append(_objective_view(process=process, queue_item=None, stores=stores, detail=False))

    records.sort(key=_sort_objective_key)

    summary_status: Dict[str, int] = {}
    summary_kind: Dict[str, int] = {}
    summary_session_status: Dict[str, int] = {}
    blocker_count = 0
    acknowledged_blocker_count = 0
    follow_up_due_count = 0
    outbound_queued_count = 0
    outbound_failed_count = 0
    paused_count = 0
    session_watcher_count = 0
    session_open_question_count = 0
    for row in records:
        status = str(row.get("status") or "unknown")
        summary_status[status] = summary_status.get(status, 0) + 1
        for source in row.get("source_types") or []:
            summary_kind[source] = summary_kind.get(source, 0) + 1
        session_plane = dict(row.get("session_plane") or {})
        session_status = str(session_plane.get("status") or "none").strip() or "none"
        summary_session_status[session_status] = summary_session_status.get(session_status, 0) + 1
        session_watcher_count += int(session_plane.get("watcher_count") or 0)
        session_open_question_count += len(list(session_plane.get("open_questions") or []))
        blocker_status = dict(row.get("blocker_status") or {})
        blocker_count += int(blocker_status.get("count") or 0)
        acknowledged_blocker_count += int(blocker_status.get("acknowledged_count") or 0)
        follow_up = dict(row.get("follow_up") or {})
        if follow_up.get("due_at"):
            follow_up_due_count += 1
        outbound_queued_count += int(follow_up.get("queued_count") or 0)
        outbound_failed_count += int(follow_up.get("failed_count") or 0)
        if status == "paused":
            paused_count += 1

    queue_status = orchestrator._runtime_maintenance_queue_status_payload(stores=stores).get("queue") or {}
    recent_reports: List[JsonDict] = []
    for row in records:
        recent_reports.extend(list(row.get("recent_reports") or []))
    recent_reports.sort(key=lambda row: _sort_ts(row.get("recorded_at")), reverse=True)

    return {
        "success": True,
        "generated_at": _now_iso(),
        "summary": {
            "objective_count": len(records),
            "by_status": summary_status,
            "by_kind": summary_kind,
            "by_session_status": summary_session_status,
            "paused_count": paused_count,
            "blocker_count": blocker_count,
            "acknowledged_blocker_count": acknowledged_blocker_count,
            "follow_up_due_count": follow_up_due_count,
            "outbound_queued_count": outbound_queued_count,
            "outbound_failed_count": outbound_failed_count,
            "session_watcher_count": session_watcher_count,
            "session_open_question_count": session_open_question_count,
            "maintenance_queue": {
                "max_active_items": queue_status.get("max_active_items"),
                "counts": dict(queue_status.get("counts") or {}),
                "session_counts": dict(queue_status.get("session_counts") or {}),
            },
            **kernel_summary,
        },
        "queue": queue_status,
        "objectives": records,
        "recent_reports": recent_reports[:20],
        "kernel_v2": kernel_summary.get("kernel_v2"),
        "kernel_runtimes": ((kernel_summary.get("kernel_v2") or {}).get("runtimes") or {}),
        "kernel_surfaces": ((kernel_summary.get("kernel_v2") or {}).get("surfaces") or {}),
        "kernel_rollout": ((kernel_summary.get("kernel_v2") or {}).get("rollout") or {}),
    }


def _fast_status_payload() -> JsonDict:
    stores = _stores()
    _sync_queue(stores)
    kernel_summary = cortex_kernel_v2.mission_control_summary()
    queue_status = orchestrator._runtime_maintenance_queue_status_payload(stores=stores).get("queue") or {}
    summary_status = {str(k): int(v or 0) for k, v in dict(queue_status.get("counts") or {}).items()}
    objective_count = sum(summary_status.values())
    paused_count = int(summary_status.get("paused") or 0)
    session_counts = {str(k): int(v or 0) for k, v in dict(queue_status.get("session_counts") or {}).items()}
    return {
        "success": True,
        "generated_at": _now_iso(),
        "summary": {
            "objective_count": objective_count,
            "by_status": summary_status,
            "by_kind": {"runtime": objective_count},
            "by_session_status": session_counts,
            "paused_count": paused_count,
            "blocker_count": 0,
            "acknowledged_blocker_count": 0,
            "follow_up_due_count": 0,
            "outbound_queued_count": 0,
            "outbound_failed_count": 0,
            "session_watcher_count": 0,
            "session_open_question_count": 0,
            "maintenance_queue": {
                "max_active_items": queue_status.get("max_active_items"),
                "counts": dict(queue_status.get("counts") or {}),
                "session_counts": session_counts,
            },
            **kernel_summary,
        },
        "recent_reports": [],
        "queue": queue_status,
    }


def status() -> JsonDict:
    if runtime_pressure.configured_benchmark_mode():
        return _fast_status_payload()
    payload = board()
    return {
        "success": True,
        "generated_at": payload.get("generated_at"),
        "summary": payload.get("summary"),
        "recent_reports": payload.get("recent_reports"),
        "queue": payload.get("queue"),
    }


def objectives() -> JsonDict:
    payload = board()
    return {
        "success": True,
        "generated_at": payload.get("generated_at"),
        "summary": payload.get("summary"),
        "objectives": payload.get("objectives"),
    }


def queue() -> JsonDict:
    stores = _stores()
    _sync_queue(stores)
    queue_status = orchestrator._runtime_maintenance_queue_status_payload(stores=stores)
    objectives_payload = objectives()
    queue_items = {str(row.get("item_id") or ""): row for row in (queue_status.get("queue") or {}).get("items") or [] if isinstance(row, dict)}
    linked = [row for row in objectives_payload.get("objectives") or [] if ((row.get("queue") or {}).get("item_id") in queue_items)]
    return {
        "success": True,
        "generated_at": _now_iso(),
        "queue": queue_status.get("queue"),
        "linked_objectives": linked,
    }


def reports(limit: int = 25) -> JsonDict:
    payload = board()
    rows = list(payload.get("recent_reports") or [])
    rows.sort(key=lambda row: _sort_ts(row.get("recorded_at")), reverse=True)
    return {
        "success": True,
        "generated_at": payload.get("generated_at"),
        "reports": rows[: max(1, int(limit or 25))],
    }


def objective_detail(objective_key: str) -> JsonDict:
    stores = _stores()
    queue_item, process = _resolve_objective(objective_key, stores=stores)
    if queue_item is None and process is None:
        raise HTTPException(status_code=404, detail=f"Mission Control objective '{objective_key}' not found")
    detail = _objective_view(process=process, queue_item=queue_item, stores=stores, detail=True)
    kernel_summary = cortex_kernel_v2.mission_control_summary().get("kernel_v2") or {}
    return {
        "success": True,
        "kernel_v2": cortex_kernel_v2.performance_snapshot(),
        "kernel_runtimes": kernel_summary.get("runtimes") or {},
        "kernel_surfaces": kernel_summary.get("surfaces") or {},
        "kernel_rollout": kernel_summary.get("rollout") or {},
        **detail,
    }


def _compact_text(value: Any, *, limit: int = 220) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        text = value
    elif isinstance(value, (dict, list, tuple)):
        try:
            text = json.dumps(value, sort_keys=True)
        except Exception:
            text = str(value)
    else:
        text = str(value)
    text = " ".join(text.split())
    if not text:
        return None
    if len(text) <= limit:
        return text
    return text[: max(1, limit - 1)] + "…"


def _humanize_token(value: Optional[str]) -> str:
    text = str(value or "").strip()
    if not text:
        return "activity"
    return text.replace("_", " ").replace(".", " › ")


def _activity_timestamp(row: JsonDict) -> Optional[str]:
    for key in ("ts", "recorded_at", "updated_at", "heartbeat_at", "acked_at", "last_attempt_at", "created_at"):
        if row.get(key):
            return row.get(key)
    return None


def _timeline_entry(
    *,
    entry_id: str,
    ts: Optional[str],
    source: str,
    kind: str,
    label: str,
    summary: Optional[str] = None,
    agent_ids: Optional[Sequence[str]] = None,
    scope: Optional[str] = None,
    status: Optional[str] = None,
    raw: Optional[JsonDict] = None,
) -> JsonDict:
    agents = []
    seen = set()
    for row in agent_ids or []:
        agent_id = str(row or "").strip()
        if not agent_id or agent_id in seen:
            continue
        seen.add(agent_id)
        agents.append(agent_id)
    return {
        "entry_id": entry_id,
        "ts": ts,
        "source": source,
        "kind": kind,
        "label": label,
        "summary": summary,
        "agent_ids": agents,
        "scope": scope,
        "status": status,
        "raw": raw or {},
    }


def _summarize_runtime_event(row: JsonDict) -> Tuple[str, Optional[str], Optional[str], List[str]]:
    kind = str(row.get("kind") or "runtime_event").strip() or "runtime_event"
    payload = dict(row.get("payload") or {})
    node_id = str(payload.get("node_id") or "").strip() or None
    scope = node_id or str(payload.get("scope") or payload.get("file_path") or payload.get("repo_path") or "").strip() or None
    agent_ids = [payload.get("agent_id"), payload.get("from_agent"), payload.get("to_agent"), payload.get("actor")]
    if payload.get("tool"):
        scope = scope or f"tool:{payload.get('tool')}"

    label_map = {
        "node_running": f"Node running • {node_id or 'node'}",
        "node_completed": f"Node completed • {node_id or 'node'}",
        "node_failed": f"Node failed • {node_id or 'node'}",
        "node_retry_scheduled": f"Retry scheduled • {node_id or 'node'}",
        "process_paused": "Process paused",
        "process_resumed": "Process resumed",
        "process_wake": "Wake requested",
        "process_cancelled": "Process cancelled",
        "tool_call_started": f"Tool started • {payload.get('tool') or payload.get('tool_name') or 'tool'}",
        "tool_call_finished": f"Tool finished • {payload.get('tool') or payload.get('tool_name') or 'tool'}",
        "tool_call_stdout": f"Tool stdout • {payload.get('tool') or payload.get('tool_name') or 'tool'}",
        "tool_call_stderr": f"Tool stderr • {payload.get('tool') or payload.get('tool_name') or 'tool'}",
        "command_started": f"Command started • {payload.get('command_kind') or 'command'}",
        "command_finished": f"Command finished • {payload.get('command_kind') or 'command'}",
        "command_stdout": "Stdout chunk",
        "command_stderr": "Stderr chunk",
        "file_written": f"File written • {payload.get('file_path') or 'file'}",
        "file_deleted": f"File deleted • {payload.get('file_path') or 'file'}",
        "git_status_snapshot": "Git status snapshot",
        "git_diff_snapshot": "Git diff snapshot",
        "git_diff_cached_snapshot": "Git staged diff snapshot",
    }
    label = label_map.get(kind) or _humanize_token(kind).title()

    summary_parts = []
    if payload.get("tool"):
        summary_parts.append(f"tool={payload.get('tool')}")
    if payload.get("command_text"):
        summary_parts.append(_compact_text(payload.get("command_text"), limit=180))
    if payload.get("file_path"):
        summary_parts.append(f"file={payload.get('file_path')}")
    if payload.get("repo_path"):
        summary_parts.append(f"repo={payload.get('repo_path')}")
    if payload.get("status_code") is not None:
        summary_parts.append(f"status_code={payload.get('status_code')}")
    if payload.get("exit_code") is not None:
        summary_parts.append(f"exit_code={payload.get('exit_code')}")
    if payload.get("attempts") is not None:
        summary_parts.append(f"attempt={payload.get('attempts')}")
    if payload.get("reason"):
        summary_parts.append(f"reason={payload.get('reason')}")
    if payload.get("retry_at"):
        summary_parts.append(f"retry_at={payload.get('retry_at')}")
    if payload.get("objective_key"):
        summary_parts.append(f"objective={payload.get('objective_key')}")
    if payload.get("chunk"):
        summary_parts.append(_compact_text(payload.get("chunk"), limit=220) or "")
    if payload.get("stdout_preview"):
        summary_parts.append(f"stdout={_compact_text(payload.get('stdout_preview'), limit=220)}")
    if payload.get("stderr_preview"):
        summary_parts.append(f"stderr={_compact_text(payload.get('stderr_preview'), limit=220)}")
    if payload.get("status_preview"):
        summary_parts.append(f"status={_compact_text(payload.get('status_preview'), limit=220)}")
    if payload.get("stat_preview"):
        summary_parts.append(f"diff={_compact_text(payload.get('stat_preview'), limit=220)}")
    if payload.get("patch_preview"):
        summary_parts.append(f"patch={_compact_text(payload.get('patch_preview'), limit=220)}")
    summary = ", ".join(summary_parts) if summary_parts else _compact_text(payload)
    return label, summary, scope, [str(row) for row in agent_ids if str(row or "").strip()]


def _summarize_report_action(action: JsonDict) -> Tuple[str, Optional[str], Optional[str], List[str]]:
    action_name = str(action.get("action") or action.get("kind") or "report_action").strip() or "report_action"
    scope = str(action.get("task_id") or action.get("scope") or action.get("node_id") or "").strip() or None
    summary_bits = []
    for key in ("task_id", "scope", "lease_id", "node_id", "stage", "from_agent", "to_agent"):
        if action.get(key):
            summary_bits.append(f"{key}={action.get(key)}")
    summary = ", ".join(summary_bits) if summary_bits else _compact_text(action)
    return (
        _humanize_token(action_name).title(),
        summary,
        scope,
        [
            str(action.get("agent_id") or "").strip(),
            str(action.get("from_agent") or "").strip(),
            str(action.get("to_agent") or "").strip(),
        ],
    )


def _shared_state_change_summary(change_set: JsonDict) -> Optional[str]:
    summary_bits = []
    for key in ("world_state", "agent_ownership", "open_questions", "active_plan_node_ids", "operator_overrides"):
        section = dict(change_set.get(key) or {})
        count = int(section.get("count") or 0)
        if count:
            summary_bits.append(f"{key}={count}")
    return ", ".join(summary_bits) if summary_bits else None


def _build_activity_timeline(detail: JsonDict, *, limit: int) -> List[JsonDict]:
    objective = dict(detail.get("objective") or {})
    entries: List[JsonDict] = []

    if objective:
        current_phase = dict(objective.get("current_phase") or {})
        process_view = dict(objective.get("process") or {})
        entries.append(
            _timeline_entry(
                entry_id=f"objective:{objective.get('objective_key') or objective.get('process_id') or uuid4().hex[:8]}",
                ts=objective.get("updated_at") or process_view.get("last_tick_at") or objective.get("created_at"),
                source="objective_state",
                kind=str(objective.get("status") or "active"),
                label="Objective state",
                summary=_compact_text(
                    {
                        "status": objective.get("status"),
                        "session_status": ((objective.get("session_plane") or {}).get("status") if isinstance(objective.get("session_plane"), dict) else None),
                        "next_action": (objective.get("next_action") or {}).get("kind"),
                        "current_phase": current_phase.get("delivery_stage") or current_phase.get("roadmap_phase_id"),
                        "active_nodes": process_view.get("active_nodes"),
                        "waiting_nodes": process_view.get("waiting_nodes"),
                    }
                ),
                agent_ids=[((objective.get("active_worker") or {}).get("agent_id"))],
                scope=current_phase.get("delivery_stage") or current_phase.get("roadmap_phase_id"),
                status=objective.get("status"),
                raw={"objective": objective.get("objective_key"), "status": objective.get("status"), "process": process_view, "current_phase": current_phase},
            )
        )
        for worker in objective.get("worker_roster") or []:
            if not isinstance(worker, dict):
                continue
            entries.append(
                _timeline_entry(
                    entry_id=f"worker:{worker.get('agent_id') or 'agent'}:{worker.get('scope') or 'scope'}",
                    ts=worker.get("heartbeat_at") or objective.get("updated_at") or objective.get("created_at"),
                    source="worker_roster",
                    kind=str(worker.get("status") or "observed"),
                    label=f"Worker {str(worker.get('status') or 'observed')} • {worker.get('agent_id') or 'agent'}",
                    summary=_compact_text({"scope": worker.get("scope"), "source": worker.get("source"), "expires_at": worker.get("expires_at")}),
                    agent_ids=[worker.get("agent_id")],
                    scope=worker.get("scope"),
                    status=worker.get("status"),
                    raw=worker,
                )
            )

    for event in detail.get("runtime_events") or []:
        if not isinstance(event, dict):
            continue
        label, summary, scope, agents = _summarize_runtime_event(event)
        entries.append(
            _timeline_entry(
                entry_id=str(event.get("event_id") or f"runtime:{len(entries)}"),
                ts=event.get("ts"),
                source="runtime_event",
                kind=str(event.get("kind") or "runtime_event"),
                label=label,
                summary=summary,
                agent_ids=agents,
                scope=scope,
                raw=event,
            )
        )

    for report in objective.get("recent_reports") or []:
        if not isinstance(report, dict):
            continue
        runtime_kind = str(report.get("runtime_kind") or report.get("kind") or "report").strip() or "report"
        entries.append(
            _timeline_entry(
                entry_id=f"report:{report.get('report_id') or uuid4().hex[:8]}",
                ts=report.get("recorded_at"),
                source="report",
                kind=runtime_kind,
                label=f"{runtime_kind.title()} report",
                summary=_compact_text(report.get("summary") or report.get("status") or report.get("metadata")),
                agent_ids=[report.get("metadata", {}).get("controller_id") if isinstance(report.get("metadata"), dict) else None],
                scope=report.get("active_phase_id") or report.get("stage"),
                status=report.get("status"),
                raw=report,
            )
        )
        for index, action in enumerate(report.get("actions_taken") or []):
            if not isinstance(action, dict):
                continue
            label, summary, scope, agents = _summarize_report_action(action)
            entries.append(
                _timeline_entry(
                    entry_id=f"report:{report.get('report_id') or 'report'}:action:{index}",
                    ts=report.get("recorded_at"),
                    source="report_action",
                    kind=str(action.get("action") or action.get("kind") or "report_action"),
                    label=label,
                    summary=summary,
                    agent_ids=agents,
                    scope=scope,
                    raw={"report_id": report.get("report_id"), "runtime_kind": runtime_kind, "action": action},
                )
            )

    for row in detail.get("mailbox_messages") or []:
        if not isinstance(row, dict):
            continue
        status = str(row.get("delivery_status") or "queued").strip() or "queued"
        entries.append(
            _timeline_entry(
                entry_id=f"mailbox:{row.get('message_id') or uuid4().hex[:8]}",
                ts=row.get("acked_at") or row.get("last_attempt_at") or row.get("created_at"),
                source="mailbox",
                kind=str(row.get("kind") or "handoff"),
                label=f"Mailbox {status}",
                summary=_compact_text(
                    row.get("payload")
                    or {
                        "from_agent": row.get("from_agent"),
                        "to_agent": row.get("to_agent"),
                        "kind": row.get("kind"),
                        "delivery_status": row.get("delivery_status"),
                    }
                ),
                agent_ids=[row.get("from_agent"), row.get("to_agent")],
                scope=row.get("kind"),
                status=status,
                raw=row,
            )
        )

    for row in detail.get("leases") or []:
        if not isinstance(row, dict):
            continue
        entries.append(
            _timeline_entry(
                entry_id=f"lease:{row.get('lease_id') or uuid4().hex[:8]}",
                ts=row.get("heartbeat_at") or row.get("assigned_at") or row.get("expires_at"),
                source="lease",
                kind="lease",
                label=f"Lease {str(row.get('status') or 'active')}",
                summary=_compact_text({"scope": row.get("scope"), "heartbeat_at": row.get("heartbeat_at"), "expires_at": row.get("expires_at")}),
                agent_ids=[row.get("agent_id")],
                scope=row.get("scope"),
                status=row.get("status"),
                raw=row,
            )
        )

    for row in detail.get("shared_state_history") or []:
        if not isinstance(row, dict):
            continue
        entries.append(
            _timeline_entry(
                entry_id=f"shared_state:{row.get('revision_id') or uuid4().hex[:8]}",
                ts=row.get("recorded_at"),
                source="shared_state",
                kind="revision_saved",
                label=f"Shared state revision • {row.get('revision_id')}",
                summary=_shared_state_change_summary(dict(row.get("change_set") or {})) or _compact_text(row.get("provenance")),
                agent_ids=[row.get("actor")],
                scope=(row.get("provenance") or {}).get("action") if isinstance(row.get("provenance"), dict) else None,
                raw=row,
            )
        )

    roadmap_detail = dict(detail.get("roadmap_detail") or {})
    roadmap_state = dict(roadmap_detail.get("state") or {})
    roadmap_contract = dict(roadmap_detail.get("contract") or {})
    task_titles = {
        str(task.get("task_id") or "").strip(): str(task.get("title") or task.get("task_id") or "task").strip()
        for task in (roadmap_contract.get("tasks") or [])
        if isinstance(task, dict) and str(task.get("task_id") or "").strip()
    }
    for task in roadmap_state.get("task_states") or []:
        if not isinstance(task, dict):
            continue
        if not (task.get("assigned_agent_id") or task.get("status") in {"active", "blocked", "in_progress"}):
            continue
        task_id = str(task.get("task_id") or "task").strip() or "task"
        entries.append(
            _timeline_entry(
                entry_id=f"task:{task_id}",
                ts=task.get("updated_at") or roadmap_state.get("last_progress_at") or roadmap_state.get("last_report_at"),
                source="task_state",
                kind=str(task.get("status") or "task_state"),
                label=f"Task {str(task.get('status') or 'active')} • {task_titles.get(task_id, task_id)}",
                summary=_compact_text({
                    "task_id": task_id,
                    "assigned_agent_id": task.get("assigned_agent_id"),
                    "lease_id": task.get("lease_id"),
                    "status": task.get("status"),
                }),
                agent_ids=[task.get("assigned_agent_id")],
                scope=f"task:{task_id}",
                status=task.get("status"),
                raw=task,
            )
        )

    entries.sort(key=lambda row: _sort_ts(row.get("ts")), reverse=True)
    return entries[: max(1, int(limit or 120))]


def _build_agent_activity(detail: JsonDict, *, timeline: Sequence[JsonDict]) -> List[JsonDict]:
    objective = dict(detail.get("objective") or {})
    roadmap_detail = dict(detail.get("roadmap_detail") or {})
    roadmap_state = dict(roadmap_detail.get("state") or {})
    roadmap_contract = dict(roadmap_detail.get("contract") or {})
    shared_state = dict((roadmap_detail.get("shared_state") or ((detail.get("delivery_detail") or {}).get("shared_state")) or objective.get("shared_state") or {}) if isinstance((roadmap_detail.get("shared_state") or ((detail.get("delivery_detail") or {}).get("shared_state")) or objective.get("shared_state") or {}), dict) else {})

    task_titles = {
        str(task.get("task_id") or "").strip(): str(task.get("title") or task.get("task_id") or "task").strip()
        for task in (roadmap_contract.get("tasks") or [])
        if isinstance(task, dict) and str(task.get("task_id") or "").strip()
    }

    agents: Dict[str, JsonDict] = {}

    def ensure_agent(agent_id: Optional[str]) -> Optional[JsonDict]:
        key = str(agent_id or "").strip()
        if not key:
            return None
        if key not in agents:
            agents[key] = {
                "agent_id": key,
                "status": "observed",
                "current_scope": None,
                "current_activity": None,
                "last_seen_at": None,
                "owned_scopes": [],
                "active_tasks": [],
                "mailbox": {"sent": 0, "received": 0},
                "recent_evidence": [],
            }
        return agents[key]

    for worker in objective.get("worker_roster") or []:
        if not isinstance(worker, dict):
            continue
        agent = ensure_agent(worker.get("agent_id"))
        if agent is None:
            continue
        if worker.get("scope") and worker.get("scope") not in agent["owned_scopes"]:
            agent["owned_scopes"].append(worker.get("scope"))
        if worker.get("scope") and not agent.get("current_scope"):
            agent["current_scope"] = worker.get("scope")
        if worker.get("status"):
            agent["status"] = worker.get("status")
        last_seen = worker.get("heartbeat_at") or worker.get("expires_at")
        if _sort_ts(last_seen) > _sort_ts(agent.get("last_seen_at")):
            agent["last_seen_at"] = last_seen

    for scope, owner in dict(shared_state.get("agent_ownership") or {}).items():
        agent = ensure_agent(owner)
        if agent is None:
            continue
        if scope and scope not in agent["owned_scopes"]:
            agent["owned_scopes"].append(scope)
        if scope and not agent.get("current_scope"):
            agent["current_scope"] = scope

    for task in roadmap_state.get("task_states") or []:
        if not isinstance(task, dict):
            continue
        agent = ensure_agent(task.get("assigned_agent_id"))
        if agent is None:
            continue
        task_id = str(task.get("task_id") or "task").strip() or "task"
        task_view = {
            "task_id": task_id,
            "title": task_titles.get(task_id, task_id),
            "status": task.get("status"),
            "updated_at": task.get("updated_at"),
            "lease_id": task.get("lease_id"),
        }
        if task_view not in agent["active_tasks"]:
            agent["active_tasks"].append(task_view)
        if task.get("status") in {"active", "blocked", "in_progress"}:
            agent["status"] = str(task.get("status") or agent.get("status") or "observed")
            agent["current_activity"] = f"{task_titles.get(task_id, task_id)} ({task.get('status')})"
            if _sort_ts(task.get("updated_at")) > _sort_ts(agent.get("last_seen_at")):
                agent["last_seen_at"] = task.get("updated_at")

    for row in detail.get("mailbox_messages") or []:
        if not isinstance(row, dict):
            continue
        sender = ensure_agent(row.get("from_agent"))
        receiver = ensure_agent(row.get("to_agent"))
        if sender is not None:
            sender["mailbox"]["sent"] += 1
        if receiver is not None:
            receiver["mailbox"]["received"] += 1

    for entry in timeline:
        if not isinstance(entry, dict):
            continue
        for agent_id in entry.get("agent_ids") or []:
            agent = ensure_agent(agent_id)
            if agent is None:
                continue
            if _sort_ts(entry.get("ts")) > _sort_ts(agent.get("last_seen_at")):
                agent["last_seen_at"] = entry.get("ts")
            if entry.get("scope") and not agent.get("current_scope"):
                agent["current_scope"] = entry.get("scope")
            evidence = {
                "ts": entry.get("ts"),
                "label": entry.get("label"),
                "summary": entry.get("summary"),
                "source": entry.get("source"),
                "scope": entry.get("scope"),
                "status": entry.get("status"),
            }
            agent["recent_evidence"].append(evidence)
            if agent.get("current_activity") is None and entry.get("label"):
                agent["current_activity"] = entry.get("label")
            if entry.get("status") and agent.get("status") in {None, "observed", "active"}:
                agent["status"] = entry.get("status")

    rows = []
    for agent in agents.values():
        agent["recent_evidence"].sort(key=lambda row: _sort_ts(row.get("ts")), reverse=True)
        agent["recent_evidence"] = agent["recent_evidence"][:6]
        agent["active_tasks"].sort(key=lambda row: _sort_ts(row.get("updated_at")), reverse=True)
        if not agent.get("current_activity"):
            if agent.get("current_scope"):
                agent["current_activity"] = f"Holding {agent.get('current_scope')}"
            elif agent["recent_evidence"]:
                agent["current_activity"] = agent["recent_evidence"][0].get("label")
            else:
                agent["current_activity"] = "No recent evidence"
        rows.append(agent)

    rows.sort(key=lambda row: (_status_rank(row.get("status")), _sort_ts(row.get("last_seen_at"))), reverse=False)
    rows.sort(key=lambda row: _sort_ts(row.get("last_seen_at")), reverse=True)
    return rows


def _activity_streams(timeline: Sequence[JsonDict]) -> JsonDict:
    commands: List[JsonDict] = []
    outputs: List[JsonDict] = []
    files: List[JsonDict] = []
    git: List[JsonDict] = []
    tests: List[JsonDict] = []

    for entry in timeline:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("kind") or "").strip().lower()
        raw = dict(entry.get("raw") or {})
        payload = dict(raw.get("payload") or raw)
        item = {
            "ts": entry.get("ts"),
            "label": entry.get("label"),
            "summary": entry.get("summary"),
            "agent_ids": list(entry.get("agent_ids") or []),
            "scope": entry.get("scope"),
            "status": entry.get("status"),
            "raw": raw,
        }
        if kind in {"command_started", "command_finished", "tool_call_started", "tool_call_finished"}:
            commands.append(item)
        if kind in {"command_stdout", "command_stderr", "tool_call_stdout", "tool_call_stderr"}:
            item["stream"] = "stderr" if "stderr" in kind else "stdout"
            outputs.append(item)
        if kind in {"file_written", "file_deleted"}:
            files.append(item)
        if kind in {"git_status_snapshot", "git_diff_snapshot", "git_diff_cached_snapshot"}:
            git.append(item)
        if payload.get("command_kind") == "test" or payload.get("tool") in {"pytest", "test", "tests"} or (payload.get("command_text") and "pytest" in str(payload.get("command_text")).lower()):
            tests.append(item)

    return {
        "commands": commands[:20],
        "outputs": outputs[:30],
        "files": files[:20],
        "git": git[:20],
        "tests": tests[:20],
    }


def activity(objective_key: str, *, limit: int = 120) -> JsonDict:
    stores = _stores()
    queue_item, process = _resolve_objective(objective_key, stores=stores)
    if queue_item is None and process is None:
        raise HTTPException(status_code=404, detail=f"Mission Control objective '{objective_key}' not found")
    detail = _objective_view(process=process, queue_item=queue_item, stores=stores, detail=True)
    timeline = _build_activity_timeline(detail, limit=limit)
    agents = _build_agent_activity(detail, timeline=timeline)
    streams = _activity_streams(timeline)
    source_counts: Dict[str, int] = {}
    for row in timeline:
        source = str(row.get("source") or "unknown")
        source_counts[source] = source_counts.get(source, 0) + 1
    return {
        "success": True,
        "generated_at": _now_iso(),
        "objective": {
            "objective_key": (detail.get("objective") or {}).get("objective_key"),
            "process_id": (detail.get("objective") or {}).get("process_id"),
            "title": (detail.get("objective") or {}).get("title"),
            "status": (detail.get("objective") or {}).get("status"),
            "session_plane": (detail.get("objective") or {}).get("session_plane"),
            "current_phase": (detail.get("objective") or {}).get("current_phase"),
            "active_worker": (detail.get("objective") or {}).get("active_worker"),
        },
        "stats": {
            "agent_count": len(agents),
            "timeline_count": len(timeline),
            "sources": source_counts,
            "command_count": len(streams.get("commands") or []),
            "output_count": len(streams.get("outputs") or []),
            "file_count": len(streams.get("files") or []),
            "git_count": len(streams.get("git") or []),
            "test_count": len(streams.get("tests") or []),
        },
        "capability_matrix": capability_matrix(),
        "agents": agents,
        "streams": streams,
        "timeline": timeline,
    }


def lineage(objective_key: str, *, limit: int = 120) -> JsonDict:
    stores = _stores()
    queue_item, process = _resolve_objective(objective_key, stores=stores)
    if queue_item is None and process is None:
        raise HTTPException(status_code=404, detail=f"Mission Control objective '{objective_key}' not found")
    detail = _objective_view(process=process, queue_item=queue_item, stores=stores, detail=True)
    objective = dict(detail.get("objective") or {})
    session_key = str((((objective.get("conversation_ownership") or {}).get("session_key")) or ((objective.get("process") or {}).get("session_key")) or "").strip() or "")
    codec_packet = get_codec_packet_for_session(session_key, max_chars=800) if session_key else {"state": {}}
    bundle = build_lineage_bundle(
        process=(process or objective.get("process") or {}),
        events=process_events(str(objective.get("process_id") or ""), limit=limit) if objective.get("process_id") else [],
        objective_detail=detail,
        codec_state=(codec_packet.get("state") if isinstance(codec_packet, dict) else {}),
        session_key=session_key or None,
    )
    bundle["objective"] = {
        "objective_key": objective.get("objective_key"),
        "process_id": objective.get("process_id"),
        "title": objective.get("title"),
        "status": objective.get("status"),
        "session_key": session_key or None,
    }
    bundle["capability_matrix"] = capability_matrix()
    return bundle


def capabilities() -> JsonDict:
    return {"success": True, "generated_at": _now_iso(), "capability_matrix": capability_matrix()}


def _save_shared_state(shared_state: JsonDict, *, stores: Dict[str, Any], actor: str, provenance: JsonDict) -> JsonDict:
    process_id = str(shared_state.get("process_id") or "").strip()
    if not process_id:
        raise HTTPException(status_code=400, detail="shared state missing process_id")
    current = stores["shared_state_store"].load(process_id)
    if current is None:
        raise HTTPException(status_code=404, detail=f"shared state missing for process '{process_id}'")
    payload = dict(shared_state)
    payload["revision_id"] = f"{current.revision_id}.mc.{uuid4().hex[:8]}"
    saved = stores["shared_state_store"].save(
        payload,
        expected_revision_id=current.revision_id,
        actor=actor,
        provenance=provenance,
    )
    return _model_dump(saved)


def acknowledge_blocker(objective_key: str, *, blocker_fingerprint: str, actor: str = "cortex", note: Optional[str] = None) -> JsonDict:
    stores = _stores()
    queue_item, process = _resolve_objective(objective_key, stores=stores)
    process_id = str((process or {}).get("process_id") or (queue_item or {}).get("process_id") or "").strip()
    if not process_id:
        raise HTTPException(status_code=400, detail="objective has no live process to acknowledge blockers against")
    shared_state_model = stores["shared_state_store"].load(process_id)
    if shared_state_model is None:
        raise HTTPException(status_code=404, detail=f"shared state missing for process '{process_id}'")
    detail = _objective_view(process=process, queue_item=queue_item, stores=stores, detail=False)
    blockers = list(detail.get("blockers") or [])
    if not any(str(row.get("fingerprint") or "") == str(blocker_fingerprint or "") for row in blockers):
        raise HTTPException(status_code=404, detail=f"blocker '{blocker_fingerprint}' not found on objective '{objective_key}'")

    shared_state = _model_dump(shared_state_model)
    overrides = dict(shared_state.get("operator_overrides") or {})
    mission_control = dict(overrides.get("mission_control") or {})
    acknowledged = dict(mission_control.get("acknowledged_blockers") or {})
    acknowledged[str(blocker_fingerprint)] = {
        "actor": str(actor or "cortex").strip() or "cortex",
        "note": str(note or "").strip() or None,
        "acknowledged_at": _now_iso(),
        "objective_key": objective_key,
    }
    mission_control["acknowledged_blockers"] = acknowledged
    overrides["mission_control"] = mission_control
    shared_state["operator_overrides"] = overrides
    _save_shared_state(
        shared_state,
        stores=stores,
        actor="mission_control",
        provenance={"action": "acknowledge_blocker", "objective_key": objective_key, "actor": actor},
    )
    record_process_event(process_id, "mission_control_blocker_acknowledged", {"objective_key": objective_key, "blocker_fingerprint": blocker_fingerprint, "actor": actor})
    return objective_detail(objective_key)


def requeue_objective(objective_key: str, *, actor: str = "cortex", reason: Optional[str] = None) -> JsonDict:
    stores = _stores()
    queue_item, _ = _resolve_objective(objective_key, stores=stores)
    if queue_item is None:
        raise HTTPException(status_code=400, detail="only maintenance-backed objectives can be requeued")
    item_id = str(queue_item.get("item_id") or "").strip()
    if not item_id:
        raise HTTPException(status_code=400, detail="maintenance queue item missing item_id")
    resolved_status = str(queue_item.get("status") or "").strip().lower()
    if resolved_status not in {"blocked", "completed"}:
        raise HTTPException(
            status_code=400,
            detail=f"maintenance item '{item_id}' is not requeueable from status '{resolved_status or 'unknown'}'",
        )

    def quiesce_previous_process(old_process_id: Optional[str]) -> None:
        if not old_process_id:
            return
        old_process = get_process(old_process_id)
        if old_process is None:
            raise RuntimeError(f"cannot confirm prior process '{old_process_id}' is quiescent")
        status = str(old_process.get("status") or "").strip().lower()
        if status in TERMINAL_PROCESS_STATUSES:
            return
        if status != "paused" or bool(old_process.get("enabled", True)):
            pause_process(old_process_id)
        confirmed = get_process(old_process_id)
        if confirmed is None or str(confirmed.get("status") or "").strip().lower() != "paused" or bool(confirmed.get("enabled", True)):
            raise RuntimeError(f"cannot confirm prior process '{old_process_id}' is paused")

    try:
        _, old_process_id = stores["maintenance_queue_store"].requeue(
            item_id,
            actor=actor,
            reason=str(reason or "operator_requeue"),
            before_publish=quiesce_previous_process,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"maintenance item '{item_id}' no longer exists") from exc
    # The queue transition is published only after the old process has been
    # confirmed terminal or paused while this request owns the queue lock.
    old_process = get_process(old_process_id) if old_process_id else None
    if old_process_id and old_process is not None:
        record_process_event(
            old_process_id,
            "mission_control_requeued",
            {"objective_key": objective_key, "item_id": item_id, "actor": actor, "reason": str(reason or "operator_requeue")},
        )
    _sync_queue(stores)
    return objective_detail(item_id)


def process_action(objective_key: str, *, action: str, actor: str = "cortex", blocker_fingerprint: Optional[str] = None, note: Optional[str] = None) -> JsonDict:
    command = str(action or "").strip().lower()
    stores = _stores()
    queue_item, process = _resolve_objective(objective_key, stores=stores)
    process_id = str((process or {}).get("process_id") or (queue_item or {}).get("process_id") or "").strip() or None

    if command == "acknowledge_blocker":
        if not blocker_fingerprint:
            detail = _objective_view(process=process, queue_item=queue_item, stores=stores, detail=False)
            unacked = [row for row in detail.get("blockers") or [] if not row.get("acknowledged")]
            if len(unacked) != 1:
                raise HTTPException(status_code=400, detail="blocker_fingerprint required when objective has zero or multiple unacknowledged blockers")
            blocker_fingerprint = unacked[0].get("fingerprint")
        return acknowledge_blocker(objective_key, blocker_fingerprint=str(blocker_fingerprint), actor=actor, note=note)

    if command == "requeue":
        return requeue_objective(objective_key, actor=actor, reason=note)

    if not process_id:
        raise HTTPException(status_code=400, detail=f"objective '{objective_key}' has no live process for action '{command}'")

    if command == "pause":
        pause_process(process_id)
        return objective_detail(objective_key)
    if command == "resume":
        resume_process(process_id)
        return objective_detail(objective_key)
    if command == "wake":
        wake_process(process_id)
        return objective_detail(objective_key)

    raise HTTPException(status_code=400, detail=f"unsupported Mission Control action '{action}'")
