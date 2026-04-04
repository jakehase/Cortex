from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional


JsonDict = Dict[str, Any]

SESSION_HARD_BLOCKER_STATUSES = {"blocked", "handoff-needed", "stale", "test-failed", "failed"}
SESSION_SOFT_BLOCKER_STATUSES = {"retry-needed"}
SESSION_BLOCKER_STATUSES = SESSION_HARD_BLOCKER_STATUSES | SESSION_SOFT_BLOCKER_STATUSES
SESSION_FOLLOW_UP_BLOCKER_KINDS = {"blocker", "retry", "stale", "handoff", "test_failure", "failure"}


def merge_unique_text(*groups: Iterable[Any]) -> List[str]:
    out: List[str] = []
    for group in groups:
        for value in group or []:
            text = str(value or "").strip()
            if text and text not in out:
                out.append(text)
    return out


def _session_identity(process: Optional[JsonDict]) -> JsonDict:
    process = process or {}
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    process_id = str(process.get("process_id") or "").strip()
    session_id = str(metadata.get("runtime_session_id") or process.get("session_key") or process_id).strip() or process_id or None
    session_name = str(workflow.get("name") or session_id or process_id or "").strip() or None
    tool = str(metadata.get("runtime_tool") or "cortex-runtime").strip() or "cortex-runtime"
    return {"session_id": session_id, "session_name": session_name, "tool": tool}


def derive_session_plane(
    *,
    process: Optional[JsonDict] = None,
    session_rows: Optional[List[JsonDict]] = None,
    watcher_rows: Optional[List[JsonDict]] = None,
    snapshot_state: Optional[JsonDict] = None,
    shared_state: Optional[JsonDict] = None,
    queue_session_plane: Optional[JsonDict] = None,
) -> Optional[JsonDict]:
    process = process or {}
    snapshot_state = dict(snapshot_state or {})
    shared_state = dict(shared_state or {})
    queue_session_plane = dict(queue_session_plane or {})
    session_rows = [dict(row or {}) for row in (session_rows or [])]
    watcher_rows = [dict(row or {}) for row in (watcher_rows or [])]
    projection = dict(process.get("session_projection") or {}) if isinstance(process.get("session_projection"), dict) else {}
    identity = _session_identity(process)
    primary_row = dict(session_rows[0]) if session_rows else {}

    authority_source = (
        str(queue_session_plane.get("authority_source") or "").strip()
        or ("session_registry" if primary_row else "")
        or ("snapshot" if snapshot_state else "")
        or ("process_projection" if projection else "")
        or "process"
    )
    status = (
        str(queue_session_plane.get("status") or "").strip()
        or str(primary_row.get("status") or "").strip()
        or str(snapshot_state.get("status") or "").strip()
        or str(projection.get("status") or "").strip()
        or str(process.get("status") or "").strip()
        or "unknown"
    )
    session_count = int(
        queue_session_plane.get("session_count")
        or len(queue_session_plane.get("sessions") or [])
        or len(session_rows)
        or (1 if (snapshot_state or projection or process) else 0)
    )
    watcher_count = int(
        queue_session_plane.get("watcher_count")
        or snapshot_state.get("watcher_count")
        or len(watcher_rows)
        or 0
    )
    retry_count = int(
        queue_session_plane.get("retry_count")
        or primary_row.get("retry_count")
        or snapshot_state.get("retry_count")
        or projection.get("retry_count")
        or 0
    )
    open_questions = merge_unique_text(
        queue_session_plane.get("open_questions") if isinstance(queue_session_plane.get("open_questions"), list) else [],
        primary_row.get("open_questions") if isinstance(primary_row.get("open_questions"), list) else [],
        snapshot_state.get("open_questions") if isinstance(snapshot_state.get("open_questions"), list) else [],
        projection.get("open_questions") if isinstance(projection.get("open_questions"), list) else [],
        shared_state.get("open_questions") if isinstance(shared_state.get("open_questions"), list) else [],
    )
    operator_summary = (
        str(queue_session_plane.get("operator_summary") or "").strip()
        or str(primary_row.get("metadata", {}).get("last_operator_summary") if isinstance(primary_row.get("metadata"), dict) else "").strip()
        or str(snapshot_state.get("last_summary") or "").strip()
        or str(projection.get("last_summary") or "").strip()
        or (open_questions[0] if open_questions else None)
    )

    if not any([queue_session_plane, primary_row, snapshot_state, projection, process]):
        return None

    return {
        "authority": "derived",
        "authority_source": authority_source,
        "status": status,
        "session_id": str(queue_session_plane.get("session_id") or primary_row.get("session_id") or snapshot_state.get("session_id") or projection.get("session_id") or identity.get("session_id") or "").strip() or None,
        "session_name": str(queue_session_plane.get("session_name") or primary_row.get("session_name") or snapshot_state.get("session_name") or projection.get("session_name") or identity.get("session_name") or "").strip() or None,
        "tool": str(queue_session_plane.get("tool") or primary_row.get("tool") or snapshot_state.get("tool") or projection.get("tool") or identity.get("tool") or "").strip() or None,
        "retry_count": retry_count,
        "watcher_count": watcher_count,
        "session_count": session_count,
        "open_questions": open_questions,
        "last_event_kind": str(queue_session_plane.get("last_event_kind") or snapshot_state.get("last_event_kind") or projection.get("last_event_kind") or "").strip() or None,
        "operator_summary": operator_summary,
        "watcher_ids": list(primary_row.get("watcher_ids") or queue_session_plane.get("watcher_ids") or []),
        "sessions": list(queue_session_plane.get("sessions") or session_rows),
        "watchers": list(queue_session_plane.get("watchers") or watcher_rows),
    }


def session_plane_is_blocking(session_plane: Optional[JsonDict]) -> bool:
    row = dict(session_plane or {})
    status = str(row.get("status") or "").strip()
    source = str(row.get("authority_source") or "").strip() or "unknown"
    open_questions = [str(value).strip() for value in (row.get("open_questions") or []) if str(value).strip()]
    retry_count = int(row.get("retry_count") or 0)
    if status in {"failed", "test-failed", "stale", "handoff-needed"}:
        return True
    if status == "blocked":
        return bool(open_questions) or source not in {"process", "process_projection"}
    if status == "retry-needed":
        return bool(open_questions) or retry_count > 1
    return False


def session_plane_blocker_entry(session_plane: Optional[JsonDict]) -> Optional[JsonDict]:
    row = dict(session_plane or {})
    if not session_plane_is_blocking(row):
        return None
    questions = [str(value).strip() for value in (row.get("open_questions") or []) if str(value).strip()]
    status = str(row.get("status") or "").strip() or "blocked"
    summary = str(row.get("operator_summary") or (questions[0] if questions else f"session plane {status}")).strip() or f"session plane {status}"
    return {
        "source": "session_plane",
        "summary": summary,
        "requires_human": bool(questions),
        "terminal": status in {"failed", "test-failed"},
    }


def resolve_session_follow_up_policy(
    *,
    workflow_metadata: Optional[JsonDict] = None,
    roadmap_reporting_policy: Optional[JsonDict] = None,
    production_checkpoint_policy: Optional[JsonDict] = None,
) -> JsonDict:
    metadata = dict(workflow_metadata or {})
    explicit = metadata.get("session_follow_up_policy") if isinstance(metadata.get("session_follow_up_policy"), dict) else None
    if explicit is not None:
        allowed = [str(value or "").strip() for value in (explicit.get("allowed_update_kinds") or []) if str(value or "").strip()]
        return {
            "enabled": bool(explicit.get("enabled", True)),
            "allowed_update_kinds": allowed,
            "auto_send_owned_whatsapp": bool(explicit.get("auto_send_owned_whatsapp", False)),
            "source": "session_follow_up_policy",
        }

    roadmap = dict(roadmap_reporting_policy or {})
    if roadmap:
        allowed: List[str] = []
        if bool(roadmap.get("report_on_blocker_change", False)):
            allowed.extend(sorted(SESSION_FOLLOW_UP_BLOCKER_KINDS))
        if bool(roadmap.get("report_on_phase_change", False)) or bool(roadmap.get("report_on_status_change", False)):
            allowed.append("pr")
        return {
            "enabled": bool(allowed),
            "allowed_update_kinds": sorted(set(allowed)),
            "auto_send_owned_whatsapp": False,
            "source": "roadmap_reporting_policy",
        }

    production = dict(production_checkpoint_policy or {})
    if production:
        allowed = []
        if bool(production.get("report_on_blocker_change", False)):
            allowed.extend(sorted(SESSION_FOLLOW_UP_BLOCKER_KINDS))
        if bool(production.get("report_on_stage_change", False)):
            allowed.append("pr")
        return {
            "enabled": bool(allowed),
            "allowed_update_kinds": sorted(set(allowed)),
            "auto_send_owned_whatsapp": False,
            "source": "production_checkpoint_policy",
        }

    return {
        "enabled": False,
        "allowed_update_kinds": [],
        "auto_send_owned_whatsapp": False,
        "source": "disabled",
    }


def session_follow_up_allowed(policy: Optional[JsonDict], *, update_kind: Optional[str]) -> bool:
    policy = dict(policy or {})
    if not bool(policy.get("enabled")):
        return False
    allowed = [str(value or "").strip() for value in (policy.get("allowed_update_kinds") or []) if str(value or "").strip()]
    if not allowed:
        return False
    return str(update_kind or "").strip() in set(allowed)


__all__ = [
    "SESSION_BLOCKER_STATUSES",
    "derive_session_plane",
    "merge_unique_text",
    "resolve_session_follow_up_policy",
    "session_follow_up_allowed",
    "session_plane_blocker_entry",
    "session_plane_is_blocking",
]
