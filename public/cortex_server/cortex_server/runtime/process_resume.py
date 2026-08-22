from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from cortex_server.runtime.agent_mailbox import AgentMailbox, AgentMessage
from cortex_server.runtime.agent_supervisor import AgentLease, AgentSupervisor
from cortex_server.runtime.handoff_contract import HandoffContract
from cortex_server.runtime.process_event import ProcessEvent
from cortex_server.runtime.process_journal import ProcessJournal
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore
from cortex_server.runtime.shared_process_state import SharedProcessState, SharedProcessStateStore


class RuntimeResumeState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: str
    revision_id: str
    lifecycle_state: str
    source_snapshot_id: str
    source_state_id: str
    source_handoff_id: Optional[str] = None
    last_event_id: Optional[str] = None
    event_count: int = 0
    active_steps: List[str] = Field(default_factory=list)
    waiting_steps: List[str] = Field(default_factory=list)
    completed_steps: List[str] = Field(default_factory=list)
    failed_steps: List[str] = Field(default_factory=list)
    assigned_agents: Dict[str, str] = Field(default_factory=dict)
    active_leases: List[Dict[str, Any]] = Field(default_factory=list)
    queued_messages: int = 0
    inflight_messages: int = 0
    dead_letter_messages: int = 0
    session_state: Dict[str, Any] = Field(default_factory=dict)
    world_state: Dict[str, Any] = Field(default_factory=dict)
    runtime_constraints: Dict[str, Any] = Field(default_factory=dict)
    belief_refs: List[str] = Field(default_factory=list)
    artifact_refs: List[str] = Field(default_factory=list)
    open_questions: List[str] = Field(default_factory=list)
    handoff_objective: Optional[str] = None
    explicit_omissions: List[str] = Field(default_factory=list)



def _dedupe(rows: List[str]) -> List[str]:
    seen = set()
    out: List[str] = []
    for row in rows:
        text = str(row or "").strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out



def compile_runtime_resume_state(
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    recent_events: Optional[List[ProcessEvent]] = None,
    mailbox_messages: Optional[List[AgentMessage]] = None,
    leases: Optional[List[AgentLease]] = None,
    handoff: Optional[HandoffContract] = None,
) -> RuntimeResumeState:
    if snapshot.process_id != shared_state.process_id:
        raise ValueError("snapshot and shared_state must refer to same process")
    if handoff and handoff.process_id != snapshot.process_id:
        raise ValueError("handoff process_id must match snapshot/shared_state")

    messages = [row for row in (mailbox_messages or []) if row.process_id == snapshot.process_id]
    active_leases = [row for row in (leases or []) if row.process_id == snapshot.process_id and row.status == "active"]
    event_count = max(int(snapshot.event_count or 0), len([row for row in (recent_events or []) if row.process_id == snapshot.process_id]))

    return RuntimeResumeState(
        process_id=snapshot.process_id,
        revision_id=shared_state.revision_id,
        lifecycle_state=snapshot.lifecycle_state,
        source_snapshot_id=snapshot.snapshot_id,
        source_state_id=shared_state.state_id,
        source_handoff_id=handoff.handoff_id if handoff else None,
        last_event_id=snapshot.last_event_id,
        event_count=event_count,
        active_steps=list(snapshot.active_steps),
        waiting_steps=list(snapshot.waiting_steps),
        completed_steps=list(snapshot.completed_steps),
        failed_steps=list(snapshot.failed_steps),
        assigned_agents={**dict(snapshot.assigned_agents), **dict(shared_state.agent_ownership)},
        active_leases=[row.model_dump() if hasattr(row, "model_dump") else row.dict() for row in active_leases],
        queued_messages=sum(1 for row in messages if row.delivery_status == "queued"),
        inflight_messages=sum(1 for row in messages if row.delivery_status == "inflight"),
        dead_letter_messages=sum(1 for row in messages if row.delivery_status == "dead_letter"),
        session_state=dict(snapshot.session_state or {}),
        world_state={**dict(snapshot.world_state), **dict(shared_state.world_state)},
        runtime_constraints={**dict(snapshot.runtime_policy), **dict(shared_state.runtime_constraints)},
        belief_refs=_dedupe(list(snapshot.belief_refs) + list(shared_state.belief_refs)),
        artifact_refs=_dedupe(list(snapshot.artifact_refs) + ([row.artifact_id for row in (handoff.relevant_artifacts if handoff else [])])),
        open_questions=_dedupe(list(shared_state.open_questions) + (list(handoff.open_questions) if handoff else [])),
        handoff_objective=handoff.objective if handoff else None,
        explicit_omissions=[] if handoff else ["no handoff packet attached"],
    )



def load_runtime_resume_state(
    *,
    process_id: str,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    journal: Optional[ProcessJournal] = None,
    mailbox: Optional[AgentMailbox] = None,
    supervisor: Optional[AgentSupervisor] = None,
    handoff: Optional[HandoffContract] = None,
) -> RuntimeResumeState:
    snapshot = snapshot_store.load(process_id)
    shared_state = shared_state_store.load(process_id)
    if snapshot is None or shared_state is None:
        raise ValueError("snapshot and shared process state are required to load runtime resume state")
    recent_events = journal.load(process_id=process_id) if journal else []
    messages = mailbox.list(process_id=process_id) if mailbox else []
    leases = supervisor.list(process_id=process_id) if supervisor else []
    return compile_runtime_resume_state(
        snapshot=snapshot,
        shared_state=shared_state,
        recent_events=recent_events,
        mailbox_messages=messages,
        leases=leases,
        handoff=handoff,
    )


__all__ = ["RuntimeResumeState", "compile_runtime_resume_state", "load_runtime_resume_state"]
