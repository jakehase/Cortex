from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


SignalSeverity = Literal["low", "medium", "high", "critical"]
SignalScope = Literal["task", "workflow", "runtime", "operator", "system"]
ConstraintAction = Literal["allow", "prefer", "require", "limit", "clarify", "block", "pause", "rollback"]
DecisionOutcome = Literal["applied", "overridden", "observed"]
ExplainOutcome = Literal["match", "mismatch", "observed", "unclear"]



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



def _contract_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"



def model_dump_compat(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


class EvidenceRef(BaseModel):
    ref_id: str = Field(default_factory=lambda: _contract_id("evidence"))
    kind: str = "observation"
    source: Optional[str] = None
    uri: Optional[str] = None
    summary: Optional[str] = None
    confidence: Optional[float] = None


class EpistemicContext(BaseModel):
    context_id: str = Field(default_factory=lambda: _contract_id("epistemic"))
    source: str
    entity_ids: List[str] = Field(default_factory=list)
    claim_ids: List[str] = Field(default_factory=list)
    confidence: float = 0.0
    uncertainty: float = 0.0
    freshness: float = 0.0
    contradiction_count: int = 0
    provenance_strength: float = 0.0
    summary: Optional[str] = None
    evidence_refs: List[EvidenceRef] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class GovernanceSignal(BaseModel):
    signal_id: str = Field(default_factory=lambda: _contract_id("signal"))
    source: str
    kind: str
    severity: SignalSeverity = "low"
    scope: SignalScope = "workflow"
    blocking: bool = False
    recommendation: ConstraintAction = "allow"
    target: Optional[str] = None
    rationale: str = ""
    confidence: float = 0.0
    evidence_refs: List[EvidenceRef] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class RuntimeConstraintSet(BaseModel):
    constraint_set_id: str = Field(default_factory=lambda: _contract_id("constraints"))
    execution_mode: Optional[Literal["sequential", "parallel"]] = None
    max_parallelism: Optional[int] = None
    verification_mode: Optional[Literal["basic", "strict"]] = None
    same_tick_drain: Optional[bool] = None
    step_timeout_seconds: Optional[float] = None
    retry_max_attempts: Optional[int] = None
    retry_on_timeout: Optional[bool] = None
    human_review_required: Optional[bool] = None
    escalation_recommended: Optional[bool] = None
    rollback_bias: Optional[Literal["none", "soft", "strong"]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ConstraintDecision(BaseModel):
    decision_id: str = Field(default_factory=lambda: _contract_id("constraint_decision"))
    field: str
    chosen_value: Any = None
    previous_value: Any = None
    decided_by: str
    rationale: str = ""
    overridden_signals: List[str] = Field(default_factory=list)
    outcome: DecisionOutcome = "applied"
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ExplainAtom(BaseModel):
    explain_id: str = Field(default_factory=lambda: _contract_id("explain"))
    subsystem: str
    title: str
    expected_effect: Optional[str] = None
    observed_effect: Optional[str] = None
    outcome: ExplainOutcome = "observed"
    mismatch_reason: Optional[str] = None
    evidence_refs: List[EvidenceRef] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SubsystemActivation(BaseModel):
    activation_id: str = Field(default_factory=lambda: _contract_id("activation"))
    subsystem: str
    active: bool = True
    summary: Optional[str] = None
    epistemic_contexts: List[EpistemicContext] = Field(default_factory=list)
    governance_signals: List[GovernanceSignal] = Field(default_factory=list)
    runtime_constraints: List[RuntimeConstraintSet] = Field(default_factory=list)
    explain_atoms: List[ExplainAtom] = Field(default_factory=list)
    activated_at: str = Field(default_factory=_now_iso)
    metadata: Dict[str, Any] = Field(default_factory=dict)


__all__ = [
    "ConstraintAction",
    "ConstraintDecision",
    "DecisionOutcome",
    "EpistemicContext",
    "EvidenceRef",
    "ExplainAtom",
    "ExplainOutcome",
    "GovernanceSignal",
    "RuntimeConstraintSet",
    "SignalScope",
    "SignalSeverity",
    "SubsystemActivation",
    "model_dump_compat",
]
