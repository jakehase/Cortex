from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from cortex_server.runtime.agent_mailbox import AgentMailbox, AgentMessage
from cortex_server.runtime.agent_supervisor import AgentLease, AgentSupervisor
from cortex_server.runtime.process_event import ProcessEvent
from cortex_server.runtime.process_journal import ProcessJournal
from cortex_server.runtime.process_replay import replay_events
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore
from cortex_server.runtime.shared_process_state import SharedProcessState, SharedProcessStateStore, SharedStateRevisionRecord


JsonDict = Dict[str, Any]


UNATTENDED_PROFILES: Dict[str, Dict[str, Any]] = {
    "24h": {
        "profile": "24h",
        "intended_duration_hours": 24,
        "campaign_cycles": 6,
        "min_agent_count": 3,
        "min_handoff_count": 5,
        "max_checkpoint_age_seconds": 900,
        "max_snapshot_event_gap": 3,
        "max_dead_letters": 0,
        "max_stale_leases": 0,
        "max_inflight_age_seconds": 120,
        "max_lease_heartbeat_lag_seconds": 90,
        "required_revision_history": 6,
        "watchdog": {
            "lease_seconds": 180,
            "heartbeat_grace_seconds": 90,
        },
        "checkpoint": {
            "snapshot_every_events": 4,
            "must_checkpoint_on_handoff": True,
        },
    },
    "72h": {
        "profile": "72h",
        "intended_duration_hours": 72,
        "campaign_cycles": 12,
        "min_agent_count": 4,
        "min_handoff_count": 11,
        "max_checkpoint_age_seconds": 900,
        "max_snapshot_event_gap": 3,
        "max_dead_letters": 0,
        "max_stale_leases": 0,
        "max_inflight_age_seconds": 120,
        "max_lease_heartbeat_lag_seconds": 90,
        "required_revision_history": 12,
        "watchdog": {
            "lease_seconds": 180,
            "heartbeat_grace_seconds": 90,
        },
        "checkpoint": {
            "snapshot_every_events": 4,
            "must_checkpoint_on_handoff": True,
        },
    },
    "168h": {
        "profile": "168h",
        "intended_duration_hours": 168,
        "campaign_cycles": 20,
        "min_agent_count": 4,
        "min_handoff_count": 19,
        "max_checkpoint_age_seconds": 900,
        "max_snapshot_event_gap": 3,
        "max_dead_letters": 0,
        "max_stale_leases": 0,
        "max_inflight_age_seconds": 120,
        "max_lease_heartbeat_lag_seconds": 90,
        "required_revision_history": 20,
        "watchdog": {
            "lease_seconds": 180,
            "heartbeat_grace_seconds": 90,
        },
        "checkpoint": {
            "snapshot_every_events": 4,
            "must_checkpoint_on_handoff": True,
        },
    },
}



def _utc_now() -> datetime:
    return datetime.now(timezone.utc)



def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00"))



def _age_seconds(ts: Optional[str], *, now: Optional[datetime] = None) -> Optional[float]:
    dt = _parse_ts(ts)
    if dt is None:
        return None
    current = now or _utc_now()
    return max(0.0, (current - dt).total_seconds())



def _dedupe_strs(rows: List[str]) -> List[str]:
    out: List[str] = []
    for row in rows or []:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text)
    return out



def build_unattended_profile(profile: str) -> JsonDict:
    key = str(profile or "").strip().lower()
    if key not in UNATTENDED_PROFILES:
        raise KeyError(f"unknown unattended profile: {profile}")
    return dict(UNATTENDED_PROFILES[key])



def compile_dependability_report(
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    recent_events: Optional[List[ProcessEvent]] = None,
    mailbox_messages: Optional[List[AgentMessage]] = None,
    leases: Optional[List[AgentLease]] = None,
    revision_history: Optional[List[SharedStateRevisionRecord]] = None,
    profile: str | JsonDict = "24h",
    now: Optional[datetime] = None,
) -> JsonDict:
    if snapshot.process_id != shared_state.process_id:
        raise ValueError("snapshot and shared_state must refer to same process")

    profile_spec = build_unattended_profile(profile) if isinstance(profile, str) else dict(profile or {})
    current = now or _utc_now()
    process_id = snapshot.process_id
    events = [row for row in (recent_events or []) if row.process_id == process_id]
    messages = [row for row in (mailbox_messages or []) if row.process_id == process_id]
    process_leases = [row for row in (leases or []) if row.process_id == process_id]
    revisions = [row for row in (revision_history or []) if row.process_id == process_id]
    replay_state = replay_events(process_id, events)

    unique_agents = _dedupe_strs(
        list(snapshot.assigned_agents.values())
        + list(shared_state.agent_ownership.values())
        + [row.agent_id for row in process_leases]
        + [row.from_agent for row in messages]
        + [row.to_agent for row in messages]
    )
    handoff_count = sum(1 for row in messages if row.kind == "handoff")
    acked_count = sum(1 for row in messages if row.delivery_status == "acked")
    inflight_messages = [row for row in messages if row.delivery_status == "inflight"]
    dead_letters = [row for row in messages if row.delivery_status == "dead_letter"]
    stale_leases = [row for row in process_leases if row.status == "stale"]
    active_leases = [row for row in process_leases if row.status == "active"]

    checkpoint_age_seconds = _age_seconds(snapshot.ts, now=current) or 0.0
    max_inflight_age_seconds = max((_age_seconds(row.last_attempt_at or row.created_at, now=current) or 0.0) for row in inflight_messages) if inflight_messages else 0.0
    max_lease_heartbeat_lag_seconds = max((_age_seconds(row.heartbeat_at, now=current) or 0.0) for row in active_leases) if active_leases else 0.0
    snapshot_event_gap = max(0, len(events) - int(snapshot.event_count or 0))
    revision_history_count = len(revisions)
    revision_head_matches = revisions[-1].revision_id == shared_state.revision_id if revisions else True

    replay_matches_snapshot = (
        replay_state.get("lifecycle_state") == snapshot.lifecycle_state
        and replay_state.get("waiting_steps") == list(snapshot.waiting_steps)
        and replay_state.get("active_steps") == list(snapshot.active_steps)
        and replay_state.get("completed_steps") == list(snapshot.completed_steps)
        and replay_state.get("failed_steps") == list(snapshot.failed_steps)
        and replay_state.get("assigned_agents") == dict(snapshot.assigned_agents)
    )
    replay_matches_shared_state = (
        replay_state.get("process_id") == shared_state.process_id
        and set(shared_state.active_plan_node_ids).issubset(set(snapshot.active_steps) | set(snapshot.waiting_steps) | set(snapshot.completed_steps) | set(snapshot.failed_steps))
        and set(shared_state.belief_refs).issubset(set(snapshot.belief_refs) | set(replay_state.get("belief_refs") or []))
    )

    checks = {
        "multi_agent_coverage_ok": len(unique_agents) >= int(profile_spec.get("min_agent_count", 1) or 1),
        "handoff_coverage_ok": handoff_count >= int(profile_spec.get("min_handoff_count", 0) or 0),
        "checkpoint_freshness_ok": checkpoint_age_seconds <= float(profile_spec.get("max_checkpoint_age_seconds", 900) or 900),
        "snapshot_event_gap_ok": snapshot_event_gap <= int(profile_spec.get("max_snapshot_event_gap", 0) or 0),
        "dead_letter_budget_ok": len(dead_letters) <= int(profile_spec.get("max_dead_letters", 0) or 0),
        "stale_lease_budget_ok": len(stale_leases) <= int(profile_spec.get("max_stale_leases", 0) or 0),
        "inflight_age_ok": max_inflight_age_seconds <= float(profile_spec.get("max_inflight_age_seconds", 0) or 0),
        "lease_heartbeat_ok": max_lease_heartbeat_lag_seconds <= float(profile_spec.get("max_lease_heartbeat_lag_seconds", 0) or 0),
        "revision_history_ok": revision_history_count >= int(profile_spec.get("required_revision_history", 0) or 0),
        "revision_head_ok": revision_head_matches,
        "replay_matches_snapshot": replay_matches_snapshot,
        "replay_matches_shared_state": replay_matches_shared_state,
        "acked_handoffs_ok": acked_count >= handoff_count,
        "completed_or_waiting_ok": snapshot.lifecycle_state in {"completed", "waiting", "running"},
    }
    success = all(checks.values())
    failing_checks = [name for name, value in checks.items() if not value]

    return {
        "process_id": process_id,
        "profile": profile_spec,
        "success": success,
        "checks": checks,
        "failing_checks": failing_checks,
        "snapshot": {
            "snapshot_id": snapshot.snapshot_id,
            "lifecycle_state": snapshot.lifecycle_state,
            "event_count": snapshot.event_count,
            "checkpoint_age_seconds": round(checkpoint_age_seconds, 3),
            "checkpoint_count": int((snapshot.metadata or {}).get("checkpoint_count", 0) or 0),
        },
        "mailbox": {
            "message_count": len(messages),
            "handoff_count": handoff_count,
            "acked_count": acked_count,
            "queued_count": sum(1 for row in messages if row.delivery_status == "queued"),
            "inflight_count": len(inflight_messages),
            "dead_letter_count": len(dead_letters),
            "max_inflight_age_seconds": round(max_inflight_age_seconds, 3),
            "recovered_count": sum(int((row.metadata or {}).get("recovery_count", 0) or 0) for row in messages),
        },
        "leases": {
            "lease_count": len(process_leases),
            "active_count": len(active_leases),
            "stale_count": len(stale_leases),
            "released_count": sum(1 for row in process_leases if row.status == "released"),
            "max_heartbeat_lag_seconds": round(max_lease_heartbeat_lag_seconds, 3),
        },
        "revisions": {
            "current_revision_id": shared_state.revision_id,
            "history_count": revision_history_count,
            "head_matches": revision_head_matches,
            "last_actor": revisions[-1].actor if revisions else None,
        },
        "coverage": {
            "unique_agents": unique_agents,
            "unique_agent_count": len(unique_agents),
            "active_plan_node_ids": list(shared_state.active_plan_node_ids),
            "open_questions": list(shared_state.open_questions),
            "snapshot_event_gap": snapshot_event_gap,
        },
        "parity": {
            "replay_matches_snapshot": replay_matches_snapshot,
            "replay_matches_shared_state": replay_matches_shared_state,
            "replay_lifecycle_state": replay_state.get("lifecycle_state"),
            "snapshot_lifecycle_state": snapshot.lifecycle_state,
        },
        "operator_summary": (
            f"dependability {'ok' if success else 'failed'} for {process_id}: "
            f"agents={len(unique_agents)}, handoffs={handoff_count}, dead_letters={len(dead_letters)}, "
            f"stale_leases={len(stale_leases)}, checkpoint_age={round(checkpoint_age_seconds, 3)}s"
        ),
    }



def compile_dependability_repair_plan(report: JsonDict) -> JsonDict:
    failing_checks = [str(name or "").strip() for name in (report.get("failing_checks") or []) if str(name or "").strip()]
    actions: List[JsonDict] = []

    def _add(check: str, action: str, detail: str) -> None:
        actions.append({"check": check, "action": action, "detail": detail})

    for check in failing_checks:
        if check in {"checkpoint_freshness_ok", "snapshot_event_gap_ok", "replay_matches_snapshot"}:
            _add(check, "checkpoint_from_journal", "rebuild the process snapshot from journal replay and refresh checkpoint metadata")
        elif check in {"dead_letter_budget_ok", "acked_handoffs_ok"}:
            _add(check, "recover_dead_letters", "realign dead-lettered handoffs to the current revision and acknowledge recovered deliveries")
        elif check in {"stale_lease_budget_ok", "lease_heartbeat_ok"}:
            _add(check, "resolve_stale_leases", "reclaim stale leases, then resolve or release them so scope ownership can continue safely")
        elif check in {"revision_history_ok", "revision_head_ok", "replay_matches_shared_state"}:
            _add(check, "refresh_shared_state_revision", "write a new shared-state revision anchored to the latest replayed checkpoint and preserve provenance")
        elif check in {"multi_agent_coverage_ok", "handoff_coverage_ok"}:
            _add(check, "expand_campaign_coverage", "increase agent participation and handoff count before considering the run unattended-ready")
        elif check == "inflight_age_ok":
            _add(check, "drain_inflight_messages", "re-deliver or acknowledge stuck inflight mailbox entries before they age out")
        elif check == "completed_or_waiting_ok":
            _add(check, "restore_safe_lifecycle_state", "move the process back to a resumable waiting/running/completed lifecycle state")
        else:
            _add(check, "manual_review", "inspect the failing dependability invariant and decide on a targeted operator repair")

    deduped: List[JsonDict] = []
    seen = set()
    for row in actions:
        key = (row["action"], row["detail"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return {
        "failing_checks": failing_checks,
        "actions": deduped,
        "operator_summary": (
            f"dependability repair plan: {len(failing_checks)} failing checks, {len(deduped)} recommended actions"
        ),
    }



def load_dependability_report(
    *,
    process_id: str,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    journal: Optional[ProcessJournal] = None,
    mailbox: Optional[AgentMailbox] = None,
    supervisor: Optional[AgentSupervisor] = None,
    profile: str | JsonDict = "24h",
    now: Optional[datetime] = None,
) -> JsonDict:
    snapshot = snapshot_store.load(process_id)
    shared_state = shared_state_store.load(process_id)
    if snapshot is None or shared_state is None:
        raise ValueError("snapshot and shared process state are required to load dependability report")
    events = journal.load(process_id=process_id) if journal else []
    messages = mailbox.list(process_id=process_id) if mailbox else []
    leases = supervisor.list(process_id=process_id) if supervisor else []
    history = shared_state_store.history(process_id)
    return compile_dependability_report(
        snapshot=snapshot,
        shared_state=shared_state,
        recent_events=events,
        mailbox_messages=messages,
        leases=leases,
        revision_history=history,
        profile=profile,
        now=now,
    )


__all__ = [
    "UNATTENDED_PROFILES",
    "build_unattended_profile",
    "compile_dependability_repair_plan",
    "compile_dependability_report",
    "load_dependability_report",
]
