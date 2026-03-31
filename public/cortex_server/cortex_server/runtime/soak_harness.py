from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from cortex_server.runtime.agent_mailbox import AgentMailbox
from cortex_server.runtime.agent_supervisor import AgentSupervisor
from cortex_server.runtime.dependability import build_unattended_profile, load_dependability_report
from cortex_server.runtime.process_journal import ProcessJournal
from cortex_server.runtime.process_replay import replay_from_journal
from cortex_server.runtime.process_resume import load_runtime_resume_state
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore
from cortex_server.runtime.shared_process_state import SharedProcessState, SharedProcessStateStore, SharedStateConflictError


JsonDict = Dict[str, Any]
SleepFn = Callable[[float], None]
ClockFn = Callable[[], datetime]

SOAK_PROFILES: Dict[str, Dict[str, Any]] = {
    "2h": {
        "profile": "2h",
        "intended_duration_hours": 2,
        "elapsed_waits": [0.01, 0.02, 0.05],
        "segments": ["wait_resume", "restart_recovery", "rollback_recovery", "shared_state_conflict", "dead_letter_recovery"],
    },
    "4h": {
        "profile": "4h",
        "intended_duration_hours": 4,
        "elapsed_waits": [0.01, 0.02, 0.05, 0.1],
        "segments": ["wait_resume", "restart_recovery", "rollback_recovery", "duplicate_claims", "shared_state_conflict", "shared_state_rollback", "dead_letter_recovery"],
    },
    "8h": {
        "profile": "8h",
        "intended_duration_hours": 8,
        "elapsed_waits": [0.01, 0.02, 0.05, 0.1, 0.2],
        "segments": ["wait_resume", "restart_recovery", "rollback_recovery", "duplicate_claims", "shared_state_conflict", "shared_state_rollback", "stale_revision", "dead_letter_recovery"],
    },
}



def _utc_now() -> datetime:
    return datetime.now(timezone.utc)



def _model_dump_compat(model: Any) -> JsonDict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    if hasattr(model, "dict"):
        return model.dict()
    return dict(model or {})



def _dedupe_rows(rows: List[str]) -> List[str]:
    out: List[str] = []
    for row in rows or []:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text)
    return out



def build_soak_profile(profile: str) -> JsonDict:
    key = str(profile or "").strip().lower()
    if key not in SOAK_PROFILES:
        raise KeyError(f"unknown soak profile: {profile}")
    return dict(SOAK_PROFILES[key])



def compile_audit_playback(report: JsonDict) -> JsonDict:
    scenarios = [dict(row) for row in (report.get("scenarios") or []) if isinstance(row, dict)]
    bool_failure_keys = [
        "resumed_without_loss",
        "recovered_from_tail",
        "rollback_restored",
        "stale_detected",
        "duplicate_claim_blocked",
        "conflict_detected",
        "recovery_succeeded",
    ]
    failed = [
        row
        for row in scenarios
        if any(row.get(key) is False for key in bool_failure_keys)
        or (row.get("scenario") == "stale_revision" and row.get("accepted_count") not in (None, 0))
    ]
    return {
        "scenario_count": len(scenarios),
        "failed_count": len(failed),
        "timeline": [
            {
                "order": idx,
                "scenario": row.get("scenario"),
                "process_id": row.get("process_id"),
                "operator_summary": row.get("operator_summary"),
            }
            for idx, row in enumerate(scenarios, start=1)
        ],
        "operator_summary": f"audit playback: {len(scenarios)} scenarios, {len(failed)} flagged failures",
    }



def detect_stale_revision(expected_revision_id: str, observed_revision_id: Optional[str], *, source: str = "runtime") -> JsonDict:
    expected = str(expected_revision_id or "").strip()
    observed = str(observed_revision_id or "").strip() or None
    if not expected:
        raise ValueError("expected_revision_id must be non-empty")
    stale = observed is not None and observed != expected
    accepted = observed is None or observed == expected
    return {
        "expected_revision_id": expected,
        "observed_revision_id": observed,
        "source": str(source or "runtime").strip() or "runtime",
        "stale_revision": stale,
        "accepted": accepted,
        "operator_summary": (
            f"stale revision detected from {source}: expected {expected}, observed {observed}"
            if stale
            else f"revision accepted from {source}: {observed or expected}"
        ),
    }


class RuntimeSoakHarness:
    def __init__(self, root: str | Path, *, sleep_fn: Optional[SleepFn] = None, clock_fn: Optional[ClockFn] = None):
        self.root = Path(root)
        self.sleep_fn = sleep_fn or time.sleep
        self.clock_fn = clock_fn or _utc_now
        self.snapshot_store = ProcessSnapshotStore(self.root / "snapshots")
        self.shared_state_store = SharedProcessStateStore(self.root / "shared_state")
        self.journal = ProcessJournal(self.root / "runtime" / "processes.jsonl")
        self.mailbox = AgentMailbox(self.root / "runtime" / "mailbox.json")
        self.supervisor = AgentSupervisor(self.root / "runtime" / "leases.json")

    def _seed_waiting_process(
        self,
        *,
        process_id: str,
        revision_id: str,
        node_id: str = "step1",
        agent_id: str = "planner",
    ) -> JsonDict:
        created = self.journal.append(process_id=process_id, kind="process_created", revision_id=revision_id, payload={"goal": "durable-runtime-soak"})
        started = self.journal.append(
            process_id=process_id,
            kind="process_started",
            revision_id=revision_id,
            causal_parent_ids=[created.event_id],
        )
        waiting = self.journal.append(
            process_id=process_id,
            kind="process_waiting",
            revision_id=revision_id,
            causal_parent_ids=[started.event_id],
            payload={"node_id": node_id},
        )
        snapshot = self.snapshot_store.save(
            ProcessSnapshot(
                process_id=process_id,
                last_event_id=waiting.event_id,
                event_count=3,
                lifecycle_state="waiting",
                waiting_steps=[node_id],
                assigned_agents={node_id: agent_id},
                runtime_policy={"execution_mode": "sequential", "resume_safe": True},
                world_state={"status": "waiting", "last_node": node_id},
                metadata={"soak_seed": True},
            )
        )
        shared_state = self.shared_state_store.save(
            SharedProcessState(
                process_id=process_id,
                revision_id=revision_id,
                goals=["prove durable runtime continuity"],
                active_plan_node_ids=[node_id],
                runtime_constraints={"execution_mode": "sequential", "resume_safe": True},
                world_state={"status": "waiting", "owner": agent_id},
                open_questions=["can this resume without prompt-local continuity?"],
                agent_ownership={node_id: agent_id},
                metadata={"scenario": "soak_harness"},
            ),
            actor="coordinator",
            provenance={"scenario": "seed_waiting_process"},
        )
        return {
            "snapshot": snapshot,
            "shared_state": shared_state,
            "created_event": created,
            "started_event": started,
            "waiting_event": waiting,
        }

    def run_pause_resume_scenario(
        self,
        *,
        process_id: str,
        revision_id: str = "rev_1",
        node_id: str = "step1",
        agent_id: str = "planner",
        wait_seconds: float = 0.0,
    ) -> JsonDict:
        seeded = self._seed_waiting_process(process_id=process_id, revision_id=revision_id, node_id=node_id, agent_id=agent_id)
        snapshot = seeded["snapshot"]
        shared_state = seeded["shared_state"]
        waiting_event = seeded["waiting_event"]

        lease = self.supervisor.assign(process_id=process_id, scope=node_id, agent_id=agent_id, lease_seconds=60)
        message = self.mailbox.send(
            process_id=process_id,
            from_agent="coordinator",
            to_agent=agent_id,
            kind="handoff",
            revision_id=revision_id,
            payload={"objective": f"resume {node_id}"},
        )
        before_resume = load_runtime_resume_state(
            process_id=process_id,
            snapshot_store=self.snapshot_store,
            shared_state_store=self.shared_state_store,
            journal=self.journal,
            mailbox=self.mailbox,
            supervisor=self.supervisor,
        )

        waited_seconds = float(wait_seconds or 0.0)
        if waited_seconds > 0:
            self.sleep_fn(waited_seconds)

        resumed = self.journal.append(
            process_id=process_id,
            kind="process_resumed",
            revision_id=revision_id,
            causal_parent_ids=[waiting_event.event_id],
            payload={"node_id": node_id},
        )
        self.snapshot_store.save(
            ProcessSnapshot(
                process_id=process_id,
                last_event_id=resumed.event_id,
                event_count=4,
                lifecycle_state="running",
                active_steps=[node_id],
                assigned_agents={node_id: agent_id},
                runtime_policy={"execution_mode": "sequential", "resume_safe": True},
                world_state={"status": "running", "last_node": node_id},
                metadata={"resumed_from_wait": True},
            )
        )
        self.shared_state_store.save(
            SharedProcessState(
                process_id=process_id,
                revision_id=revision_id,
                goals=list(shared_state.goals),
                active_plan_node_ids=[node_id],
                runtime_constraints=dict(shared_state.runtime_constraints),
                world_state={**dict(shared_state.world_state), "status": "running"},
                open_questions=list(shared_state.open_questions),
                agent_ownership=dict(shared_state.agent_ownership),
                metadata={**dict(shared_state.metadata), "resumed_from_wait": True},
            ),
            actor=agent_id,
            provenance={"scenario": "pause_resume"},
        )
        after_resume = load_runtime_resume_state(
            process_id=process_id,
            snapshot_store=self.snapshot_store,
            shared_state_store=self.shared_state_store,
            journal=self.journal,
            mailbox=self.mailbox,
            supervisor=self.supervisor,
        )
        replayed = replay_from_journal(self.journal, process_id, snapshot=snapshot)
        resumed_without_loss = (
            after_resume.lifecycle_state == "running"
            and node_id in after_resume.active_steps
            and after_resume.assigned_agents.get(node_id) == agent_id
            and replayed.get("lifecycle_state") == "running"
            and replayed.get("assigned_agents", {}).get(node_id) == agent_id
            and replayed.get("waiting_steps") == []
        )
        return {
            "scenario": "pause_resume",
            "process_id": process_id,
            "waited_seconds": waited_seconds,
            "lease_id": lease.lease_id,
            "message_id": message.message_id,
            "resume_state_before": _model_dump_compat(before_resume),
            "resume_state_after": _model_dump_compat(after_resume),
            "replayed_state": replayed,
            "resumed_without_loss": resumed_without_loss,
            "operator_summary": (
                f"pause/resume ok for {process_id}: waited {waited_seconds:.3f}s and resumed "
                f"with {after_resume.queued_messages} queued messages"
            ),
        }

    def run_restart_recovery_scenario(
        self,
        *,
        process_id: str,
        revision_id: str = "rev_1",
        node_id: str = "step1",
        agent_id: str = "planner",
    ) -> JsonDict:
        seeded = self._seed_waiting_process(process_id=process_id, revision_id=revision_id, node_id=node_id, agent_id=agent_id)
        snapshot = seeded["snapshot"]
        waiting_event = seeded["waiting_event"]
        resumed = self.journal.append(
            process_id=process_id,
            kind="process_resumed",
            revision_id=revision_id,
            causal_parent_ids=[waiting_event.event_id],
            payload={"node_id": node_id},
        )
        self.journal.append(
            process_id=process_id,
            kind="step_started",
            revision_id=revision_id,
            causal_parent_ids=[resumed.event_id],
            payload={"node_id": node_id},
            actor=agent_id,
        )
        self.journal.append(
            process_id=process_id,
            kind="world_state_updated",
            revision_id=revision_id,
            payload={"world_state": {"service": "degraded", "restart_recovered": True}},
        )
        self.journal.append(
            process_id=process_id,
            kind="belief_written",
            revision_id=revision_id,
            payload={"claim_id": "claim-restart-safe"},
        )

        restarted = RuntimeSoakHarness(self.root, sleep_fn=self.sleep_fn, clock_fn=self.clock_fn)
        replayed = replay_from_journal(restarted.journal, process_id, snapshot=snapshot)
        latest = restarted.journal.latest(process_id=process_id)
        recovered_from_tail = (
            replayed.get("lifecycle_state") == "running"
            and replayed.get("active_steps") == [node_id]
            and replayed.get("world_state", {}).get("restart_recovered") is True
            and "claim-restart-safe" in (replayed.get("belief_refs") or [])
            and replayed.get("last_event_id") == (latest.event_id if latest else None)
        )
        return {
            "scenario": "restart_recovery",
            "process_id": process_id,
            "replayed_state": replayed,
            "recovered_from_tail": recovered_from_tail,
            "latest_event_id": latest.event_id if latest else None,
            "operator_summary": f"restart recovery {'ok' if recovered_from_tail else 'failed'} for {process_id}",
        }

    def run_stale_agent_scenario(
        self,
        *,
        process_id: str,
        revision_id: str = "rev_1",
        node_id: str = "step1",
        agent_id: str = "planner",
        lease_seconds: int = 5,
        reclaim_after_seconds: int = 30,
    ) -> JsonDict:
        self._seed_waiting_process(process_id=process_id, revision_id=revision_id, node_id=node_id, agent_id=agent_id)
        lease = self.supervisor.assign(process_id=process_id, scope=node_id, agent_id=agent_id, lease_seconds=lease_seconds)
        reclaimed = self.supervisor.reclaim_stale(now=self.clock_fn() + timedelta(seconds=int(reclaim_after_seconds)))
        stale_detected = any(row.lease_id == lease.lease_id and row.status == "stale" for row in reclaimed)
        return {
            "scenario": "stale_agent",
            "process_id": process_id,
            "lease_id": lease.lease_id,
            "stale_detected": stale_detected,
            "reclaimed_count": len(reclaimed),
            "operator_summary": f"stale agent {'detected' if stale_detected else 'not detected'} for {process_id}",
        }

    def run_duplicate_claim_block_scenario(
        self,
        *,
        process_id: str,
        revision_id: str = "rev_1",
        node_id: str = "step1",
        first_agent_id: str = "planner",
        second_agent_id: str = "researcher",
    ) -> JsonDict:
        self._seed_waiting_process(process_id=process_id, revision_id=revision_id, node_id=node_id, agent_id=first_agent_id)
        first = self.supervisor.assign(process_id=process_id, scope=node_id, agent_id=first_agent_id, lease_seconds=60)
        second_same = self.supervisor.assign(process_id=process_id, scope=node_id, agent_id=first_agent_id, lease_seconds=60)
        duplicate_claim_blocked = False
        duplicate_claim_error = None
        try:
            self.supervisor.assign(process_id=process_id, scope=node_id, agent_id=second_agent_id, lease_seconds=60)
        except ValueError as exc:
            duplicate_claim_blocked = True
            duplicate_claim_error = str(exc)
        reclaimed = self.supervisor.reclaim_stale(now=self.clock_fn() + timedelta(seconds=120))
        replacement = self.supervisor.assign(process_id=process_id, scope=node_id, agent_id=second_agent_id, lease_seconds=60)
        return {
            "scenario": "duplicate_claim_block",
            "process_id": process_id,
            "initial_lease_id": first.lease_id,
            "same_agent_lease_id": second_same.lease_id,
            "duplicate_claim_blocked": duplicate_claim_blocked,
            "duplicate_claim_error": duplicate_claim_error,
            "reclaimed_count": len(reclaimed),
            "replacement_agent_id": replacement.agent_id,
            "replacement_lease_id": replacement.lease_id,
            "operator_summary": f"duplicate claim {'blocked' if duplicate_claim_blocked else 'not blocked'} for {process_id}",
        }

    def run_rollback_recovery_scenario(
        self,
        *,
        process_id: str,
        revision_id: str = "rev_1",
        node_id: str = "step1",
        agent_id: str = "planner",
    ) -> JsonDict:
        seeded = self._seed_waiting_process(process_id=process_id, revision_id=revision_id, node_id=node_id, agent_id=agent_id)
        waiting_event = seeded["waiting_event"]
        resumed = self.journal.append(
            process_id=process_id,
            kind="process_resumed",
            revision_id=revision_id,
            causal_parent_ids=[waiting_event.event_id],
            payload={"node_id": node_id},
        )
        started = self.journal.append(
            process_id=process_id,
            kind="step_started",
            revision_id=revision_id,
            causal_parent_ids=[resumed.event_id],
            payload={"node_id": node_id},
            actor=agent_id,
        )
        self.journal.append(
            process_id=process_id,
            kind="world_state_updated",
            revision_id=revision_id,
            causal_parent_ids=[started.event_id],
            payload={"world_state": {"service": "degraded", "bad_update": True}},
        )
        self.journal.append(
            process_id=process_id,
            kind="belief_written",
            revision_id=revision_id,
            causal_parent_ids=[started.event_id],
            payload={"claim_id": "claim-bad"},
        )
        rollback = self.journal.append(
            process_id=process_id,
            kind="process_rolled_back",
            revision_id=revision_id,
            payload={
                "reason": "restore pre-step waiting state",
                "rolled_back_to_event_id": waiting_event.event_id,
                "restore_state": {
                    "lifecycle_state": "waiting",
                    "active_steps": [],
                    "waiting_steps": [node_id],
                    "completed_steps": [],
                    "failed_steps": [],
                    "assigned_agents": {node_id: agent_id},
                    "runtime_policy": {"execution_mode": "sequential", "resume_safe": True},
                    "world_state": {"status": "waiting", "last_node": node_id},
                    "belief_refs": [],
                    "artifact_refs": [],
                    "metadata": {"rollback_target": waiting_event.event_id},
                },
            },
        )
        replayed = replay_from_journal(self.journal, process_id)
        rollback_restored = (
            replayed.get("lifecycle_state") == "waiting"
            and replayed.get("active_steps") == []
            and replayed.get("waiting_steps") == [node_id]
            and replayed.get("world_state", {}).get("bad_update") is None
            and "claim-bad" not in (replayed.get("belief_refs") or [])
            and replayed.get("metadata", {}).get("rolled_back_to_event_id") == waiting_event.event_id
            and replayed.get("last_event_id") == rollback.event_id
        )
        return {
            "scenario": "rollback_recovery",
            "process_id": process_id,
            "rollback_event_id": rollback.event_id,
            "replayed_state": replayed,
            "rollback_restored": rollback_restored,
            "operator_summary": f"rollback recovery {'ok' if rollback_restored else 'failed'} for {process_id}",
        }

    def run_shared_state_conflict_scenario(
        self,
        *,
        process_id: str,
        base_revision_id: str = "rev_1",
        expected_revision_id: str = "rev_1",
        conflicting_observed_revision_id: str = "rev_2",
        node_id: str = "step1",
        agent_id: str = "planner",
    ) -> JsonDict:
        self._seed_waiting_process(process_id=process_id, revision_id=base_revision_id, node_id=node_id, agent_id=agent_id)
        current = self.shared_state_store.load(process_id)
        if current is None:
            raise RuntimeError(f"shared state missing for {process_id}")
        self.shared_state_store.save(
            SharedProcessState(
                process_id=process_id,
                revision_id=conflicting_observed_revision_id,
                goals=list(current.goals),
                active_plan_node_ids=list(current.active_plan_node_ids),
                open_decisions=list(current.open_decisions),
                runtime_constraints=dict(current.runtime_constraints),
                world_state={**dict(current.world_state), "status": "running"},
                belief_refs=list(current.belief_refs),
                open_questions=list(current.open_questions),
                agent_ownership=dict(current.agent_ownership),
                operator_overrides=dict(current.operator_overrides),
                metadata={**dict(current.metadata), "writer": "other-agent"},
            ),
            expected_revision_id=base_revision_id,
            actor="other-agent",
            provenance={"scenario": "shared_state_conflict", "writer": "other-agent"},
        )
        conflict_detected = False
        conflict_message = None
        try:
            self.shared_state_store.save(
                SharedProcessState(
                    process_id=process_id,
                    revision_id=f"{expected_revision_id}_writer_attempt",
                    goals=list(current.goals),
                    active_plan_node_ids=list(current.active_plan_node_ids),
                    open_decisions=list(current.open_decisions),
                    runtime_constraints=dict(current.runtime_constraints),
                    world_state={**dict(current.world_state), "status": "writer-attempt"},
                    belief_refs=list(current.belief_refs),
                    open_questions=list(current.open_questions),
                    agent_ownership=dict(current.agent_ownership),
                    operator_overrides=dict(current.operator_overrides),
                    metadata={**dict(current.metadata), "writer": agent_id},
                ),
                expected_revision_id=expected_revision_id,
                actor=agent_id,
                provenance={"scenario": "shared_state_conflict", "writer": agent_id},
            )
        except SharedStateConflictError as exc:
            conflict_detected = True
            conflict_message = str(exc)
        conflict = self.shared_state_store.detect_conflict(process_id=process_id, expected_revision_id=expected_revision_id)
        return {
            "scenario": "shared_state_conflict",
            "process_id": process_id,
            "conflict_detected": conflict_detected,
            "conflict_message": conflict_message,
            **conflict,
        }

    def run_shared_state_rollback_scenario(
        self,
        *,
        process_id: str,
        base_revision_id: str = "rev_1",
        updated_revision_id: str = "rev_2",
        rollback_revision_id: str = "rev_3",
        node_id: str = "step1",
        agent_id: str = "planner",
    ) -> JsonDict:
        self._seed_waiting_process(process_id=process_id, revision_id=base_revision_id, node_id=node_id, agent_id=agent_id)
        current = self.shared_state_store.load(process_id)
        if current is None:
            raise RuntimeError(f"shared state missing for {process_id}")
        updated = self.shared_state_store.save(
            SharedProcessState(
                process_id=process_id,
                revision_id=updated_revision_id,
                goals=list(current.goals),
                active_plan_node_ids=list(current.active_plan_node_ids),
                open_decisions=list(current.open_decisions),
                runtime_constraints=dict(current.runtime_constraints),
                world_state={**dict(current.world_state), "status": "running", "bad_update": True},
                belief_refs=_dedupe_rows(list(current.belief_refs) + ["claim-bad-state"]),
                open_questions=list(current.open_questions),
                agent_ownership=dict(current.agent_ownership),
                operator_overrides=dict(current.operator_overrides),
                metadata={**dict(current.metadata), "update": "bad"},
            ),
            expected_revision_id=base_revision_id,
            actor=agent_id,
            provenance={"scenario": "shared_state_rollback", "phase": "update"},
        )
        rolled = self.shared_state_store.rollback(
            process_id=process_id,
            to_revision_id=base_revision_id,
            new_revision_id=rollback_revision_id,
            actor="operator",
            reason="restore stable shared state",
            provenance={"scenario": "shared_state_rollback", "phase": "rollback"},
        )
        rollback_restored = (
            rolled.revision_id == rollback_revision_id
            and rolled.world_state.get("bad_update") is None
            and "claim-bad-state" not in rolled.belief_refs
            and rolled.metadata.get("rollback_to_revision_id") == base_revision_id
            and rolled.metadata.get("rollback_from_revision_id") == updated.revision_id
        )
        return {
            "scenario": "shared_state_rollback",
            "process_id": process_id,
            "rolled_revision_id": rolled.revision_id,
            "rollback_restored": rollback_restored,
            "operator_summary": f"shared state rollback {'ok' if rollback_restored else 'failed'} for {process_id}",
        }

    def run_stale_revision_scenario(
        self,
        *,
        process_id: str,
        current_revision_id: str = "rev_2",
        stale_revision_id: str = "rev_1",
        node_id: str = "step1",
        agent_id: str = "planner",
    ) -> JsonDict:
        self._seed_waiting_process(process_id=process_id, revision_id=current_revision_id, node_id=node_id, agent_id=agent_id)
        message = self.mailbox.send(
            process_id=process_id,
            from_agent="coordinator",
            to_agent=agent_id,
            kind="handoff",
            revision_id=stale_revision_id,
            payload={"objective": "act on stale revision"},
        )
        accepted = self.mailbox.receive(
            to_agent=agent_id,
            process_id=process_id,
            expected_revision_id=current_revision_id,
            reject_stale_revision=True,
        )
        stored = self.mailbox.list(process_id=process_id, to_agent=agent_id)
        stored_message = next((row for row in stored if row.message_id == message.message_id), None)
        guard = detect_stale_revision(current_revision_id, message.revision_id, source="mailbox")
        if guard["stale_revision"]:
            self.journal.append(
                process_id=process_id,
                kind="stale_revision_detected",
                revision_id=current_revision_id,
                payload={
                    "expected_revision_id": current_revision_id,
                    "observed_revision_id": message.revision_id,
                    "message_id": message.message_id,
                },
            )
        return {
            "scenario": "stale_revision",
            "process_id": process_id,
            "message_id": message.message_id,
            "accepted_count": len(accepted),
            "delivery_status": stored_message.delivery_status if stored_message else None,
            "rejection_metadata": dict(stored_message.metadata or {}) if stored_message else {},
            **guard,
        }

    def run_elapsed_wait_profile(self, *, process_prefix: str = "soak", elapsed_waits: Optional[List[float]] = None) -> List[JsonDict]:
        wait_matrix = [0.0]
        for value in (elapsed_waits or []):
            seconds = float(value or 0.0)
            if seconds not in wait_matrix:
                wait_matrix.append(seconds)
        return [
            self.run_pause_resume_scenario(process_id=f"{process_prefix}_pause_resume_{idx}", wait_seconds=seconds)
            for idx, seconds in enumerate(wait_matrix, start=1)
        ]

    def _checkpoint_from_journal(
        self,
        *,
        process_id: str,
        metadata: Optional[Dict[str, Any]] = None,
        runtime_policy_overrides: Optional[Dict[str, Any]] = None,
        world_state_overrides: Optional[Dict[str, Any]] = None,
    ) -> ProcessSnapshot:
        previous = self.snapshot_store.load(process_id)
        replayed = replay_from_journal(self.journal, process_id)
        previous_metadata = dict(previous.metadata) if previous else {}
        checkpoint_count = int(previous_metadata.get("checkpoint_count", 0) or 0) + 1
        return self.snapshot_store.save(
            ProcessSnapshot(
                process_id=process_id,
                last_event_id=replayed.get("last_event_id"),
                event_count=int(replayed.get("event_count", 0) or 0),
                lifecycle_state=str(replayed.get("lifecycle_state") or "created"),
                active_steps=list(replayed.get("active_steps") or []),
                waiting_steps=list(replayed.get("waiting_steps") or []),
                completed_steps=list(replayed.get("completed_steps") or []),
                failed_steps=list(replayed.get("failed_steps") or []),
                assigned_agents=dict(replayed.get("assigned_agents") or {}),
                runtime_policy={
                    **dict(replayed.get("runtime_policy") or {}),
                    **dict(runtime_policy_overrides or {}),
                },
                world_state={
                    **dict(replayed.get("world_state") or {}),
                    **dict(world_state_overrides or {}),
                },
                belief_refs=list(replayed.get("belief_refs") or []),
                artifact_refs=list(replayed.get("artifact_refs") or []),
                metadata={
                    **previous_metadata,
                    "checkpoint_count": checkpoint_count,
                    **dict(metadata or {}),
                },
            )
        )

    def _campaign_shared_state(
        self,
        *,
        process_id: str,
        revision_id: str,
        expected_revision_id: Optional[str],
        active_node_ids: List[str],
        completed_node_ids: List[str],
        belief_refs: List[str],
        owner_map: Dict[str, str],
        world_state: Dict[str, Any],
        profile_spec: Dict[str, Any],
        cycle_index: int,
        actor: str,
        final: bool = False,
    ) -> SharedProcessState:
        goals = [
            "sustain unattended multi-agent continuity",
            "preserve handoff context across checkpoints",
            "recover safely from stalled or conflicting runtime state",
        ]
        open_questions = [] if final else ["can the next agent resume without prompt-local continuity?"]
        return self.shared_state_store.save(
            SharedProcessState(
                process_id=process_id,
                revision_id=revision_id,
                goals=goals,
                active_plan_node_ids=list(active_node_ids),
                runtime_constraints={
                    "execution_mode": "multi_agent",
                    "resume_safe": True,
                    "unattended_profile": profile_spec.get("profile"),
                    "lease_seconds": int((profile_spec.get("watchdog") or {}).get("lease_seconds", 180) or 180),
                    "checkpoint_every_events": int((profile_spec.get("checkpoint") or {}).get("snapshot_every_events", 4) or 4),
                },
                world_state=dict(world_state),
                belief_refs=_dedupe_rows(list(belief_refs)),
                open_questions=open_questions,
                agent_ownership=dict(owner_map),
                metadata={
                    "campaign": True,
                    "profile": profile_spec.get("profile"),
                    "cycle_index": cycle_index,
                    "completed_nodes": list(completed_node_ids),
                    "final": final,
                },
            ),
            expected_revision_id=expected_revision_id,
            actor=actor,
            provenance={
                "scenario": "unattended_campaign",
                "cycle_index": cycle_index,
                "profile": profile_spec.get("profile"),
                "final": final,
            },
        )

    def run_unattended_campaign(
        self,
        profile: str,
        *,
        process_prefix: Optional[str] = None,
        cycle_count: Optional[int] = None,
        agent_ids: Optional[List[str]] = None,
        node_ids: Optional[List[str]] = None,
    ) -> JsonDict:
        profile_spec = build_unattended_profile(profile)
        process_id = process_prefix or f"campaign_{profile_spec['profile']}"
        agents = _dedupe_rows(list(agent_ids or ["planner", "researcher", "critic", "implementer"]))
        nodes = _dedupe_rows(list(node_ids or ["plan", "research", "synthesize", "review"]))
        if len(agents) < 2:
            raise ValueError("unattended campaign requires at least two agents")
        if not nodes:
            raise ValueError("unattended campaign requires at least one node")
        total_cycles = max(int(cycle_count or profile_spec.get("campaign_cycles", len(nodes)) or len(nodes)), len(nodes), len(agents))
        initial_revision_id = "rev_1"
        first_node = nodes[0]
        first_agent = agents[0]
        self._seed_waiting_process(process_id=process_id, revision_id=initial_revision_id, node_id=first_node, agent_id=first_agent)

        current_revision_id = initial_revision_id
        previous_agent = "coordinator"
        completed_nodes: List[str] = []
        belief_refs: List[str] = []
        owner_map: Dict[str, str] = {}
        timeline: List[JsonDict] = []

        for idx in range(total_cycles):
            cycle_number = idx + 1
            node_id = nodes[idx % len(nodes)]
            agent_id = agents[idx % len(agents)]
            next_node = nodes[(idx + 1) % len(nodes)] if idx + 1 < total_cycles else None
            lease = self.supervisor.assign(
                process_id=process_id,
                scope=node_id,
                agent_id=agent_id,
                lease_seconds=int((profile_spec.get("watchdog") or {}).get("lease_seconds", 180) or 180),
                metadata={"campaign": True, "cycle": cycle_number, "profile": profile_spec.get("profile")},
            )
            handoff = self.mailbox.send(
                process_id=process_id,
                from_agent=previous_agent,
                to_agent=agent_id,
                kind="handoff",
                revision_id=current_revision_id,
                dedupe_key=f"campaign:{process_id}:{cycle_number}:{previous_agent}:{agent_id}",
                payload={
                    "objective": f"advance unattended campaign cycle {cycle_number}",
                    "node_id": node_id,
                    "profile": profile_spec.get("profile"),
                },
            )
            accepted = self.mailbox.receive(
                to_agent=agent_id,
                process_id=process_id,
                expected_revision_id=current_revision_id,
                reject_stale_revision=True,
            )
            if any(row.message_id == handoff.message_id for row in accepted):
                self.mailbox.acknowledge(handoff.message_id)

            resumed = self.journal.append(
                process_id=process_id,
                kind="process_resumed",
                revision_id=current_revision_id,
                actor=agent_id,
                payload={"node_id": node_id},
            )
            self.journal.append(
                process_id=process_id,
                kind="agent_assigned",
                revision_id=current_revision_id,
                actor=agent_id,
                causal_parent_ids=[resumed.event_id],
                payload={"node_id": node_id, "agent_id": agent_id, "scope": node_id},
            )
            started = self.journal.append(
                process_id=process_id,
                kind="step_started",
                revision_id=current_revision_id,
                actor=agent_id,
                payload={"node_id": node_id},
            )
            self.journal.append(
                process_id=process_id,
                kind="world_state_updated",
                revision_id=current_revision_id,
                actor=agent_id,
                causal_parent_ids=[started.event_id],
                payload={
                    "world_state": {
                        "status": "running",
                        "last_node": node_id,
                        "last_agent": agent_id,
                        "campaign_cycle": cycle_number,
                        "campaign_profile": profile_spec.get("profile"),
                    }
                },
            )
            claim_id = f"claim_{process_id}_{cycle_number}"
            artifact_id = f"artifact_{process_id}_{cycle_number}"
            self.journal.append(
                process_id=process_id,
                kind="belief_written",
                revision_id=current_revision_id,
                actor=agent_id,
                payload={"claim_id": claim_id},
            )
            self.journal.append(
                process_id=process_id,
                kind="artifact_written",
                revision_id=current_revision_id,
                actor=agent_id,
                payload={"artifact_id": artifact_id},
            )
            completed = self.journal.append(
                process_id=process_id,
                kind="step_completed",
                revision_id=current_revision_id,
                actor=agent_id,
                payload={"node_id": node_id},
            )
            belief_refs = _dedupe_rows(belief_refs + [claim_id])
            owner_map[node_id] = agent_id
            if node_id not in completed_nodes:
                completed_nodes.append(node_id)
            if next_node:
                self.journal.append(
                    process_id=process_id,
                    kind="process_waiting",
                    revision_id=current_revision_id,
                    actor=agent_id,
                    causal_parent_ids=[completed.event_id],
                    payload={"node_id": next_node},
                )
            else:
                self.journal.append(
                    process_id=process_id,
                    kind="process_completed",
                    revision_id=current_revision_id,
                    actor=agent_id,
                    causal_parent_ids=[completed.event_id],
                )
            snapshot = self._checkpoint_from_journal(
                process_id=process_id,
                metadata={
                    "campaign": True,
                    "campaign_cycle": cycle_number,
                    "campaign_profile": profile_spec.get("profile"),
                },
                runtime_policy_overrides={
                    "execution_mode": "multi_agent",
                    "resume_safe": True,
                    "campaign_profile": profile_spec.get("profile"),
                },
            )
            next_revision_id = f"rev_{cycle_number + 1}"
            final_cycle = cycle_number == total_cycles
            world_state = {
                **dict(snapshot.world_state),
                "campaign_cycle": cycle_number,
                "campaign_profile": profile_spec.get("profile"),
                "status": "completed" if final_cycle else "waiting",
            }
            shared_state = self._campaign_shared_state(
                process_id=process_id,
                revision_id=next_revision_id,
                expected_revision_id=current_revision_id,
                active_node_ids=[] if final_cycle else ([next_node] if next_node else []),
                completed_node_ids=completed_nodes,
                belief_refs=belief_refs,
                owner_map=owner_map,
                world_state=world_state,
                profile_spec=profile_spec,
                cycle_index=cycle_number,
                actor=agent_id,
                final=final_cycle,
            )
            self.supervisor.heartbeat(
                lease.lease_id,
                lease_seconds=int((profile_spec.get("watchdog") or {}).get("lease_seconds", 180) or 180),
            )
            self.supervisor.release(lease.lease_id)
            timeline.append(
                {
                    "cycle": cycle_number,
                    "node_id": node_id,
                    "agent_id": agent_id,
                    "lease_id": lease.lease_id,
                    "handoff_id": handoff.message_id,
                    "accepted": any(row.message_id == handoff.message_id for row in accepted),
                    "snapshot_id": snapshot.snapshot_id,
                    "revision_id": shared_state.revision_id,
                    "next_node_id": next_node,
                }
            )
            current_revision_id = next_revision_id
            previous_agent = agent_id

        dependability = load_dependability_report(
            process_id=process_id,
            snapshot_store=self.snapshot_store,
            shared_state_store=self.shared_state_store,
            journal=self.journal,
            mailbox=self.mailbox,
            supervisor=self.supervisor,
            profile=profile_spec,
            now=self.clock_fn(),
        )
        return {
            "scenario": "unattended_campaign",
            "process_id": process_id,
            "profile": profile_spec,
            "cycle_count": total_cycles,
            "agents": agents,
            "nodes": nodes,
            "timeline": timeline,
            "dependability": dependability,
            "success": bool(dependability.get("success")),
            "operator_summary": (
                f"unattended campaign {'ok' if dependability.get('success') else 'failed'} for {process_id}: "
                f"cycles={total_cycles}, agents={len(agents)}, profile={profile_spec.get('profile')}"
            ),
        }

    def run_dead_letter_recovery_scenario(
        self,
        *,
        process_id: str,
        current_revision_id: str = "rev_2",
        stale_revision_id: str = "rev_1",
        recovered_revision_id: Optional[str] = None,
        agent_id: str = "planner",
        node_id: str = "step1",
    ) -> JsonDict:
        self._seed_waiting_process(process_id=process_id, revision_id=current_revision_id, node_id=node_id, agent_id=agent_id)
        recovered_revision = str(recovered_revision_id or current_revision_id).strip() or current_revision_id
        message = self.mailbox.send(
            process_id=process_id,
            from_agent="coordinator",
            to_agent=agent_id,
            kind="handoff",
            revision_id=stale_revision_id,
            dedupe_key=f"recover:{process_id}:{agent_id}",
            payload={"objective": "recover stale delivery"},
        )
        first_receive = self.mailbox.receive(
            to_agent=agent_id,
            process_id=process_id,
            expected_revision_id=current_revision_id,
            reject_stale_revision=True,
        )
        recovered = self.mailbox.recover_dead_letter(
            message.message_id,
            revision_id=recovered_revision,
            recovery_reason="align_revision_and_requeue",
        )
        second_receive = self.mailbox.receive(
            to_agent=agent_id,
            process_id=process_id,
            expected_revision_id=current_revision_id,
            reject_stale_revision=True,
        )
        return {
            "scenario": "dead_letter_recovery",
            "process_id": process_id,
            "message_id": message.message_id,
            "first_receive_count": len(first_receive),
            "recovered_revision_id": recovered.revision_id,
            "recovery_count": int((recovered.metadata or {}).get("recovery_count", 0) or 0),
            "recovery_reason": (recovered.metadata or {}).get("recovery_reason"),
            "second_receive_count": len(second_receive),
            "recovery_succeeded": len(second_receive) == 1 and str(second_receive[0].revision_id or "") == current_revision_id,
            "operator_summary": f"dead-letter recovery {'ok' if len(second_receive) == 1 else 'failed'} for {process_id}",
        }

    def run_suite(self, *, process_prefix: str = "soak", wait_seconds: float = 0.0, elapsed_waits: Optional[List[float]] = None) -> JsonDict:
        wait_matrix = [float(wait_seconds or 0.0)]
        for value in (elapsed_waits or []):
            seconds = float(value or 0.0)
            if seconds not in wait_matrix:
                wait_matrix.append(seconds)
        pause_resume_runs = self.run_elapsed_wait_profile(process_prefix=process_prefix, elapsed_waits=wait_matrix)
        restart_recovery = self.run_restart_recovery_scenario(process_id=f"{process_prefix}_restart_recovery")
        rollback_recovery = self.run_rollback_recovery_scenario(process_id=f"{process_prefix}_rollback_recovery")
        stale_agent = self.run_stale_agent_scenario(process_id=f"{process_prefix}_stale_agent")
        duplicate_claim_block = self.run_duplicate_claim_block_scenario(process_id=f"{process_prefix}_duplicate_claim")
        shared_state_conflict = self.run_shared_state_conflict_scenario(process_id=f"{process_prefix}_shared_state_conflict")
        shared_state_rollback = self.run_shared_state_rollback_scenario(process_id=f"{process_prefix}_shared_state_rollback")
        stale_revision = self.run_stale_revision_scenario(process_id=f"{process_prefix}_stale_revision")
        dead_letter_recovery = self.run_dead_letter_recovery_scenario(process_id=f"{process_prefix}_dead_letter_recovery")
        scenarios = [
            *pause_resume_runs,
            restart_recovery,
            rollback_recovery,
            stale_agent,
            duplicate_claim_block,
            shared_state_conflict,
            shared_state_rollback,
            stale_revision,
            dead_letter_recovery,
        ]
        success = all(
            row.get("resumed_without_loss", True)
            and row.get("recovered_from_tail", True)
            and row.get("rollback_restored", True)
            and row.get("stale_detected", True)
            and row.get("duplicate_claim_blocked", True)
            and row.get("conflict_detected", True)
            and row.get("stale_revision", True)
            and (row.get("accepted_count", 0) == 0 if row.get("scenario") == "stale_revision" else True)
            and row.get("recovery_succeeded", True)
            for row in scenarios
        )
        report = {
            "success": success,
            "scenario_count": len(scenarios),
            "wait_matrix_seconds": wait_matrix,
            "scenarios": scenarios,
            "operator_summary": f"runtime soak harness {'passed' if success else 'failed'} with {len(scenarios)} scenarios",
        }
        report["audit_playback"] = compile_audit_playback(report)
        return report

    def run_profile(self, profile: str, *, process_prefix: Optional[str] = None) -> JsonDict:
        profile_spec = build_soak_profile(profile)
        prefix = process_prefix or f"soak_{profile_spec['profile']}"
        report = self.run_suite(process_prefix=prefix, elapsed_waits=list(profile_spec.get("elapsed_waits") or []))
        report["profile"] = profile_spec
        report["audit_playback"] = compile_audit_playback(report)
        return report


__all__ = [
    "RuntimeSoakHarness",
    "SOAK_PROFILES",
    "build_soak_profile",
    "compile_audit_playback",
    "detect_stale_revision",
]
