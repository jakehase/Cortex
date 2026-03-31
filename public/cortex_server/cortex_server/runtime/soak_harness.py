from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from cortex_server.runtime.agent_mailbox import AgentMailbox
from cortex_server.runtime.agent_supervisor import AgentSupervisor
from cortex_server.runtime.process_journal import ProcessJournal
from cortex_server.runtime.process_replay import replay_from_journal
from cortex_server.runtime.process_resume import load_runtime_resume_state
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore
from cortex_server.runtime.shared_process_state import SharedProcessState, SharedProcessStateStore


JsonDict = Dict[str, Any]
SleepFn = Callable[[float], None]
ClockFn = Callable[[], datetime]



def _utc_now() -> datetime:
    return datetime.now(timezone.utc)



def _model_dump_compat(model: Any) -> JsonDict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    if hasattr(model, "dict"):
        return model.dict()
    return dict(model or {})



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
            )
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
            )
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

    def run_elapsed_wait_profile(self, *, process_prefix: str = "soak", elapsed_waits: Optional[list[float]] = None) -> list[JsonDict]:
        wait_matrix = [0.0]
        for value in (elapsed_waits or []):
            seconds = float(value or 0.0)
            if seconds not in wait_matrix:
                wait_matrix.append(seconds)
        return [
            self.run_pause_resume_scenario(process_id=f"{process_prefix}_pause_resume_{idx}", wait_seconds=seconds)
            for idx, seconds in enumerate(wait_matrix, start=1)
        ]

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

    def run_suite(self, *, process_prefix: str = "soak", wait_seconds: float = 0.0, elapsed_waits: Optional[list[float]] = None) -> JsonDict:
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
        stale_revision = self.run_stale_revision_scenario(process_id=f"{process_prefix}_stale_revision")
        dead_letter_recovery = self.run_dead_letter_recovery_scenario(process_id=f"{process_prefix}_dead_letter_recovery")
        scenarios = [*pause_resume_runs, restart_recovery, rollback_recovery, stale_agent, duplicate_claim_block, stale_revision, dead_letter_recovery]
        success = all(
            row.get("resumed_without_loss", True)
            and row.get("recovered_from_tail", True)
            and row.get("rollback_restored", True)
            and row.get("stale_detected", True)
            and row.get("duplicate_claim_blocked", True)
            and row.get("stale_revision", True)
            and (row.get("accepted_count", 0) == 0 if row.get("scenario") == "stale_revision" else True)
            and row.get("recovery_succeeded", True)
            for row in scenarios
        )
        return {
            "success": success,
            "scenario_count": len(scenarios),
            "wait_matrix_seconds": wait_matrix,
            "scenarios": scenarios,
            "operator_summary": f"runtime soak harness {'passed' if success else 'failed'} with {len(scenarios)} scenarios",
        }


__all__ = ["RuntimeSoakHarness", "detect_stale_revision"]
