from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from cortex_server.runtime.handoff_contract import HandoffContract
from cortex_server.runtime.process_event import ProcessEvent
from cortex_server.runtime.process_snapshot import ProcessSnapshot
from cortex_server.runtime.shared_process_state import SharedProcessState



def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"



def _view_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:16]}"



def _dedupe_strs(values: Iterable[str]) -> List[str]:
    rows: List[str] = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        rows.append(text)
    return rows



def revision_guard(*, expected_revision_id: str, observed_revision_id: str, source: str = "handoff") -> Dict[str, Any]:
    expected = str(expected_revision_id or "").strip()
    observed = str(observed_revision_id or "").strip()
    if not expected or not observed:
        raise ValueError("revision guard requires non-empty expected and observed revision ids")
    stale = expected != observed
    return {
        "source": str(source or "handoff").strip() or "handoff",
        "expected_revision_id": expected,
        "observed_revision_id": observed,
        "stale_revision": stale,
        "accepted": not stale,
        "operator_summary": (
            f"stale revision detected from {source}: expected {expected}, observed {observed}"
            if stale
            else f"revision accepted from {source}: {observed}"
        ),
    }


class WorkingContextView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    view_id: str = Field(default_factory=lambda: _view_id("working_ctx"))
    process_id: str
    revision_id: str
    agent_id: Optional[str] = None
    generated_at: str = Field(default_factory=_now_iso)
    source_snapshot_id: Optional[str] = None
    source_state_id: Optional[str] = None
    source_handoff_id: Optional[str] = None
    lifecycle_state: str
    goals: List[str] = Field(default_factory=list)
    active_plan_node_ids: List[str] = Field(default_factory=list)
    open_decisions: List[Dict[str, Any]] = Field(default_factory=list)
    runtime_constraints: Dict[str, Any] = Field(default_factory=dict)
    session_state: Dict[str, Any] = Field(default_factory=dict)
    world_state: Dict[str, Any] = Field(default_factory=dict)
    belief_refs: List[str] = Field(default_factory=list)
    artifact_refs: List[str] = Field(default_factory=list)
    open_questions: List[str] = Field(default_factory=list)
    ownership_scope: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)
    recent_event_ids: List[str] = Field(default_factory=list)
    omitted_event_count: int = 0
    explicit_omissions: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("process_id", "revision_id", "lifecycle_state")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value


class HandoffContextView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    view_id: str = Field(default_factory=lambda: _view_id("handoff_ctx"))
    handoff_id: str
    process_id: str
    from_agent: str
    to_agent: str
    source_revision: str
    current_revision: str
    generated_at: str = Field(default_factory=_now_iso)
    objective: str
    scope: str
    assumptions: List[str] = Field(default_factory=list)
    evidence_ref_ids: List[str] = Field(default_factory=list)
    artifact_ref_ids: List[str] = Field(default_factory=list)
    open_questions: List[str] = Field(default_factory=list)
    expected_output: str
    lifecycle_state: Optional[str] = None
    active_plan_node_ids: List[str] = Field(default_factory=list)
    runtime_constraints: Dict[str, Any] = Field(default_factory=dict)
    session_state: Dict[str, Any] = Field(default_factory=dict)
    world_state: Dict[str, Any] = Field(default_factory=dict)
    belief_refs: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("handoff_id", "process_id", "from_agent", "to_agent", "source_revision", "current_revision", "objective", "scope", "expected_output")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value



def compile_working_context_view(
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    recent_events: Optional[List[ProcessEvent]] = None,
    agent_id: Optional[str] = None,
    handoff: Optional[HandoffContract] = None,
    max_recent_events: int = 20,
    explicit_omissions: Optional[List[str]] = None,
    reject_stale_revision: bool = False,
) -> WorkingContextView:
    if snapshot.process_id != shared_state.process_id:
        raise ValueError("snapshot and shared_state must refer to the same process_id")
    if handoff and handoff.process_id != snapshot.process_id:
        raise ValueError("handoff process_id must match snapshot/shared_state")
    events = [row for row in (recent_events or []) if row.process_id == snapshot.process_id]
    trimmed = events[-max_recent_events:] if max_recent_events > 0 else []
    omitted_event_count = max(0, len(events) - len(trimmed))
    omissions = list(explicit_omissions or [])
    if omitted_event_count:
        omissions.append(f"{omitted_event_count} older journal events omitted from working context view")
    assumptions = list(handoff.assumptions) if handoff else []
    ownership_scope = [scope for scope, owner in dict(shared_state.agent_ownership or {}).items() if agent_id and owner == agent_id]
    artifact_refs = list(snapshot.artifact_refs)
    if handoff:
        artifact_refs.extend([row.artifact_id for row in handoff.relevant_artifacts])
    belief_refs = list(snapshot.belief_refs) + list(shared_state.belief_refs)
    open_questions = list(shared_state.open_questions) + (list(handoff.open_questions) if handoff else [])
    revision_check = revision_guard(
        expected_revision_id=shared_state.revision_id,
        observed_revision_id=handoff.source_revision,
        source="handoff",
    ) if handoff else None
    if revision_check and revision_check["stale_revision"] and reject_stale_revision:
        raise ValueError(revision_check["operator_summary"])
    return WorkingContextView(
        process_id=snapshot.process_id,
        revision_id=shared_state.revision_id,
        agent_id=agent_id,
        source_snapshot_id=snapshot.snapshot_id,
        source_state_id=shared_state.state_id,
        source_handoff_id=handoff.handoff_id if handoff else None,
        lifecycle_state=snapshot.lifecycle_state,
        goals=list(shared_state.goals),
        active_plan_node_ids=list(shared_state.active_plan_node_ids or snapshot.active_steps),
        open_decisions=[row.model_dump() if hasattr(row, "model_dump") else row.dict() for row in shared_state.open_decisions],
        runtime_constraints=dict(shared_state.runtime_constraints or snapshot.runtime_policy),
        session_state=dict(snapshot.session_state or {}),
        world_state={**dict(snapshot.world_state or {}), **dict(shared_state.world_state or {})},
        belief_refs=_dedupe_strs(belief_refs),
        artifact_refs=_dedupe_strs(artifact_refs),
        open_questions=_dedupe_strs(open_questions),
        ownership_scope=ownership_scope,
        assumptions=_dedupe_strs(assumptions),
        recent_event_ids=[row.event_id for row in trimmed],
        omitted_event_count=omitted_event_count,
        explicit_omissions=_dedupe_strs(omissions),
        metadata={
            "event_tail_count": len(trimmed),
            "source_revision": handoff.source_revision if handoff else None,
            "revision_guard": revision_check,
            "stale_handoff_revision": bool(revision_check and revision_check.get("stale_revision")),
        },
    )



def compile_handoff_context_view(
    *,
    handoff: HandoffContract,
    shared_state: SharedProcessState,
    snapshot: Optional[ProcessSnapshot] = None,
    reject_stale_revision: bool = False,
) -> HandoffContextView:
    if handoff.process_id != shared_state.process_id:
        raise ValueError("handoff and shared_state must refer to the same process_id")
    if snapshot and snapshot.process_id != handoff.process_id:
        raise ValueError("snapshot process_id must match handoff/shared_state")
    revision_check = revision_guard(
        expected_revision_id=shared_state.revision_id,
        observed_revision_id=handoff.source_revision,
        source="handoff",
    )
    if revision_check["stale_revision"] and reject_stale_revision:
        raise ValueError(revision_check["operator_summary"])
    return HandoffContextView(
        handoff_id=handoff.handoff_id,
        process_id=handoff.process_id,
        from_agent=handoff.from_agent,
        to_agent=handoff.to_agent,
        source_revision=handoff.source_revision,
        current_revision=shared_state.revision_id,
        objective=handoff.objective,
        scope=handoff.scope,
        assumptions=list(handoff.assumptions),
        evidence_ref_ids=[row.ref_id for row in handoff.relevant_evidence],
        artifact_ref_ids=[row.artifact_id for row in handoff.relevant_artifacts],
        open_questions=_dedupe_strs(list(handoff.open_questions) + list(shared_state.open_questions)),
        expected_output=handoff.expected_output,
        lifecycle_state=snapshot.lifecycle_state if snapshot else None,
        active_plan_node_ids=list(shared_state.active_plan_node_ids or (snapshot.active_steps if snapshot else [])),
        runtime_constraints=dict(shared_state.runtime_constraints or (snapshot.runtime_policy if snapshot else {})),
        session_state=dict((snapshot.session_state if snapshot else {}) or {}),
        world_state={**dict(snapshot.world_state or {}), **dict(shared_state.world_state or {})} if snapshot else dict(shared_state.world_state or {}),
        belief_refs=_dedupe_strs(list(shared_state.belief_refs) + (list(snapshot.belief_refs) if snapshot else [])),
        metadata={
            "timeout_seconds": handoff.timeout_seconds,
            "lease_seconds": handoff.lease_seconds,
            "revision_guard": revision_check,
            "stale_handoff_revision": bool(revision_check.get("stale_revision")),
        },
    )


__all__ = [
    "HandoffContextView",
    "WorkingContextView",
    "compile_handoff_context_view",
    "compile_working_context_view",
    "revision_guard",
]
