from __future__ import annotations

import copy
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from cortex_server.runtime.agent_mailbox import AgentMailbox, AgentMessage
from cortex_server.runtime.agent_supervisor import AgentLease, AgentSupervisor
from cortex_server.runtime.process_event import ProcessEvent
from cortex_server.runtime.process_journal import ProcessJournal
from cortex_server.runtime.process_replay import replay_events, replay_from_journal
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
    return copy.deepcopy(UNATTENDED_PROFILES[key])


def unattended_profile_digest(profile: str) -> str:
    """Return the immutable server-policy digest bound into release evidence."""

    encoded = json.dumps(
        build_unattended_profile(profile),
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _campaign_evidence_status(
    *,
    process_id: str,
    profile_id: str,
    profile_digest: str,
    profile_spec: JsonDict,
    campaign_evidence: Optional[JsonDict],
    evidence_binding: Optional[JsonDict],
    now: datetime,
) -> JsonDict:
    campaign = dict(campaign_evidence or {})
    expected_binding = {
        str(key): str(value or "").strip()
        for key, value in dict(evidence_binding or {}).items()
        if str(value or "").strip()
    }
    required_cycles = int(profile_spec.get("campaign_cycles", 0) or 0)
    required_duration_seconds = float(profile_spec.get("intended_duration_hours", 0) or 0) * 3600.0
    receipts = list(campaign.get("cycle_receipts") or []) if isinstance(campaign.get("cycle_receipts"), list) else []

    timestamps_valid = True
    try:
        started_at = _parse_ts(str(campaign.get("started_at") or ""))
        observation_end = _parse_ts(str(campaign.get("observation_end_at") or ""))
        if started_at is None or observation_end is None:
            timestamps_valid = False
        elif started_at.tzinfo is None or observation_end.tzinfo is None:
            timestamps_valid = False
        elif started_at > observation_end or observation_end > now:
            timestamps_valid = False
    except (TypeError, ValueError):
        started_at = None
        observation_end = None
        timestamps_valid = False

    policy_binding_ok = bool(
        campaign
        and str(campaign.get("schema_version") or "") == "cortex.production-dependability-campaign.v1"
        and bool(str(campaign.get("campaign_id") or "").strip())
        and str(campaign.get("observation_status") or "") == "healthy"
        and str(campaign.get("process_id") or "") == process_id
        and str(campaign.get("policy_id") or "") == profile_id
        and str(campaign.get("policy_digest") or "") == profile_digest
    )
    campaign_binding_ok = policy_binding_ok and all(
        str(campaign.get(key) or "") == expected
        for key, expected in expected_binding.items()
    )

    receipt_ids: List[str] = []
    receipt_timestamps: List[datetime] = []
    receipts_valid = timestamps_valid and campaign_binding_ok and len(receipts) <= required_cycles
    for index, raw_receipt in enumerate(receipts, start=1):
        if not isinstance(raw_receipt, dict):
            receipts_valid = False
            continue
        receipt_id = str(raw_receipt.get("receipt_id") or "").strip()
        try:
            observed_at = _parse_ts(str(raw_receipt.get("observed_at") or ""))
        except (TypeError, ValueError):
            observed_at = None
        receipt_binding_ok = all(
            str(raw_receipt.get(key) or "") == expected
            for key, expected in expected_binding.items()
        )
        if (
            not receipt_id
            or not str(raw_receipt.get("snapshot_id") or "").strip()
            or type(raw_receipt.get("cycle_number")) is not int
            or raw_receipt.get("cycle_number") != index
            or observed_at is None
            or observed_at.tzinfo is None
            or started_at is None
            or observation_end is None
            or observed_at > observation_end
            or not receipt_binding_ok
            or str(raw_receipt.get("process_id") or "") != process_id
            or str(raw_receipt.get("policy_id") or "") != profile_id
            or str(raw_receipt.get("policy_digest") or "") != profile_digest
        ):
            receipts_valid = False
            continue
        if required_cycles > 0:
            scheduled_start = started_at + timedelta(seconds=required_duration_seconds * index / required_cycles)
            scheduled_end = (
                started_at + timedelta(seconds=required_duration_seconds * (index + 1) / required_cycles)
                if index < required_cycles
                else None
            )
            if observed_at < scheduled_start or (scheduled_end is not None and observed_at >= scheduled_end):
                receipts_valid = False
        receipt_ids.append(receipt_id)
        receipt_timestamps.append(observed_at)

    if len(receipt_ids) != len(set(receipt_ids)):
        receipts_valid = False
    timestamp_text = [row.isoformat() for row in receipt_timestamps]
    if len(timestamp_text) != len(set(timestamp_text)) or receipt_timestamps != sorted(receipt_timestamps):
        receipts_valid = False

    elapsed_seconds = (
        max(0.0, (observation_end - started_at).total_seconds())
        if timestamps_valid and started_at is not None and observation_end is not None
        else 0.0
    )
    elapsed_duration_ok = timestamps_valid and elapsed_seconds >= required_duration_seconds
    campaign_cycles_ok = bool(
        receipts_valid
        and required_cycles > 0
        and len(receipts) >= required_cycles
    )
    return {
        "campaign_id": str(campaign.get("campaign_id") or "") or None,
        "policy_id": profile_id,
        "policy_digest": profile_digest,
        "required_duration_seconds": required_duration_seconds,
        "elapsed_duration_seconds": round(elapsed_seconds, 3),
        "required_cycle_count": required_cycles,
        "completed_cycle_count": len(receipts) if receipts_valid else 0,
        "started_at": campaign.get("started_at"),
        "observation_end_at": campaign.get("observation_end_at"),
        "checks": {
            "policy_binding_ok": policy_binding_ok,
            "campaign_binding_ok": campaign_binding_ok,
            "campaign_timestamps_ok": timestamps_valid and receipts_valid,
            "elapsed_duration_ok": elapsed_duration_ok,
            "campaign_cycles_ok": campaign_cycles_ok,
        },
    }



def compile_dependability_report(
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    recent_events: Optional[List[ProcessEvent]] = None,
    mailbox_messages: Optional[List[AgentMessage]] = None,
    leases: Optional[List[AgentLease]] = None,
    revision_history: Optional[List[SharedStateRevisionRecord]] = None,
    profile: str | JsonDict = "24h",
    campaign_evidence: Optional[JsonDict] = None,
    evidence_binding: Optional[JsonDict] = None,
    replayed_state: Optional[JsonDict] = None,
    now: Optional[datetime] = None,
) -> JsonDict:
    if snapshot.process_id != shared_state.process_id:
        raise ValueError("snapshot and shared_state must refer to same process")

    profile_spec = build_unattended_profile(profile) if isinstance(profile, str) else copy.deepcopy(dict(profile or {}))
    profile_id = str(profile_spec.get("profile") or "").strip()
    if not profile_id:
        raise ValueError("dependability profile must declare a profile identifier")
    profile_digest = (
        unattended_profile_digest(profile)
        if isinstance(profile, str)
        else f"sha256:{hashlib.sha256(json.dumps(profile_spec, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()}"
    )
    current = now or _utc_now()
    process_id = snapshot.process_id
    events = [row for row in (recent_events or []) if row.process_id == process_id]
    messages = [row for row in (mailbox_messages or []) if row.process_id == process_id]
    process_leases = [row for row in (leases or []) if row.process_id == process_id]
    revisions = [row for row in (revision_history or []) if row.process_id == process_id]
    replay_state = dict(replayed_state) if replayed_state is not None else replay_events(process_id, events)

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
    snapshot_event_gap = max(
        0,
        int(replay_state.get("event_count", 0) or 0) - int(snapshot.event_count or 0),
    )
    synthetic_revision_actions = {
        "refresh_shared_state_revision",
        "reconcile_shared_state_parity",
    }
    observed_work_revisions = [
        row
        for row in revisions
        if str((row.provenance or {}).get("action") or "").strip()
        not in synthetic_revision_actions
        and not bool((row.state.get("metadata") or {}).get("production_dependability_repaired"))
    ]
    revision_history_count = len(observed_work_revisions)
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

    campaign_status = _campaign_evidence_status(
        process_id=process_id,
        profile_id=profile_id,
        profile_digest=profile_digest,
        profile_spec=profile_spec,
        campaign_evidence=campaign_evidence,
        evidence_binding=evidence_binding,
        now=current,
    )
    campaign_enforced = isinstance(profile, str) or campaign_evidence is not None
    campaign_status["enforced"] = campaign_enforced
    campaign_checks = (
        dict(campaign_status["checks"])
        if campaign_enforced
        else {name: True for name in campaign_status["checks"]}
    )
    campaign_status["checks"] = campaign_checks
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
        **campaign_checks,
    }
    success = all(checks.values())
    failing_checks = [name for name, value in checks.items() if not value]

    return {
        "process_id": process_id,
        "profile": profile_spec,
        "policy_id": profile_id,
        "policy_digest": profile_digest,
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
            "total_history_count": len(revisions),
            "excluded_synthetic_count": len(revisions) - revision_history_count,
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
        "campaign": campaign_status,
        "operator_summary": (
            f"dependability {'ok' if success else 'failed'} for {process_id}: "
            f"agents={len(unique_agents)}, handoffs={handoff_count}, dead_letters={len(dead_letters)}, "
            f"stale_leases={len(stale_leases)}, checkpoint_age={round(checkpoint_age_seconds, 3)}s, "
            f"elapsed={round(float(campaign_status['elapsed_duration_seconds']), 3)}s, "
            f"cycles={campaign_status['completed_cycle_count']}/{campaign_status['required_cycle_count']}"
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
        elif check == "revision_history_ok":
            _add(check, "observe_revision_history", "wait for genuine process revisions produced by completed work; repair must not synthesize revision-count progress")
        elif check in {"revision_head_ok", "replay_matches_shared_state"}:
            _add(check, "review_shared_state_parity", "repair the underlying replay/shared-state mismatch without manufacturing campaign progress")
        elif check in {"multi_agent_coverage_ok", "handoff_coverage_ok"}:
            _add(check, "expand_campaign_coverage", "increase agent participation and handoff count before considering the run unattended-ready")
        elif check == "inflight_age_ok":
            _add(check, "drain_inflight_messages", "re-deliver or acknowledge stuck inflight mailbox entries before they age out")
        elif check == "completed_or_waiting_ok":
            _add(check, "restore_safe_lifecycle_state", "move the process back to a resumable waiting/running/completed lifecycle state")
        elif check in {"policy_binding_ok", "campaign_binding_ok", "campaign_timestamps_ok"}:
            _add(check, "restart_dependability_campaign", "start a new server-owned campaign bound to the active release candidate and revision")
        elif check in {"elapsed_duration_ok", "campaign_cycles_ok"}:
            _add(check, "observe_dependability_campaign", "continue genuine server-timestamped observation cycles; repair cannot synthesize temporal evidence")
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
    campaign_evidence: Optional[JsonDict] = None,
    evidence_binding: Optional[JsonDict] = None,
    now: Optional[datetime] = None,
) -> JsonDict:
    snapshot = snapshot_store.load(process_id)
    shared_state = shared_state_store.load(process_id)
    if snapshot is None or shared_state is None:
        raise ValueError("snapshot and shared process state are required to load dependability report")
    events = journal.load(process_id=process_id) if journal else []
    replayed_state = replay_from_journal(journal, process_id) if journal else None
    messages = mailbox.list(process_id=process_id) if mailbox else []
    leases = supervisor.list(process_id=process_id) if supervisor else []
    history = shared_state_store.history(process_id)
    return compile_dependability_report(
        snapshot=snapshot,
        shared_state=shared_state,
        recent_events=events,
        replayed_state=replayed_state,
        mailbox_messages=messages,
        leases=leases,
        revision_history=history,
        profile=profile,
        campaign_evidence=campaign_evidence,
        evidence_binding=evidence_binding,
        now=now,
    )


__all__ = [
    "UNATTENDED_PROFILES",
    "build_unattended_profile",
    "compile_dependability_repair_plan",
    "compile_dependability_report",
    "load_dependability_report",
    "unattended_profile_digest",
]
