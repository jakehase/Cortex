from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Sequence
from uuid import uuid4

from pydantic import BaseModel, Field


TaskStatus = Literal[
    "pending",
    "ready",
    "running",
    "blocked",
    "waiting",
    "completed",
    "failed",
    "cancelled",
]
BeliefKind = Literal["observed", "inferred", "recalled", "declared", "derived"]
OutcomeStatus = Literal["success", "partial", "failure", "cancelled"]
PolicyDomain = Literal["routing", "memory", "backend", "verification", "safety", "planner", "scheduler"]
ArtifactKind = Literal["text", "json", "file", "journal", "report", "trace", "plan", "evidence"]
DependencyKind = Literal["blocks", "relates_to", "depends_on", "supersedes"]



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



def _normalize_ts(value: Any, *, default: Optional[str] = None) -> str:
    if isinstance(value, str) and value.strip():
        return value
    return default or _now_iso()



def _kernel_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"



def model_dump_compat(model: BaseModel) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


class Provenance(BaseModel):
    source_type: str = "system"
    source_ref: Optional[str] = None
    observed_at: Optional[str] = None
    recorded_at: str = Field(default_factory=_now_iso)
    note: Optional[str] = None


class VerificationSpec(BaseModel):
    method: str
    required: bool = True
    success_signal: Optional[str] = None
    verifier: Optional[str] = None
    evidence_required: List[str] = Field(default_factory=list)


class DependencyRef(BaseModel):
    task_id: str
    kind: DependencyKind = "depends_on"
    note: Optional[str] = None


class ArtifactRef(BaseModel):
    artifact_id: str = Field(default_factory=lambda: _kernel_id("artifact"))
    kind: ArtifactKind = "json"
    label: str = "artifact"
    uri: str
    mime_type: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    produced_by_task_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PolicyDecision(BaseModel):
    decision_id: str = Field(default_factory=lambda: _kernel_id("policy"))
    domain: PolicyDomain
    chosen: str
    rationale: str = ""
    confidence: float = 0.0
    task_id: Optional[str] = None
    alternatives: List[str] = Field(default_factory=list)
    inputs: Dict[str, Any] = Field(default_factory=dict)
    metrics: Dict[str, Any] = Field(default_factory=dict)
    made_at: str = Field(default_factory=_now_iso)


class BeliefClaim(BaseModel):
    claim_id: str = Field(default_factory=lambda: _kernel_id("claim"))
    subject: str
    predicate: str
    value: Any
    confidence: float = 0.5
    freshness: float = 0.5
    status: Literal["active", "stale", "superseded", "contradicted"] = "active"
    kind: BeliefKind = "inferred"
    task_id: Optional[str] = None
    provenance: List[Provenance] = Field(default_factory=list)
    supersedes: List[str] = Field(default_factory=list)
    contradicts: List[str] = Field(default_factory=list)
    last_verified_at: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Subtask(BaseModel):
    task_id: str = Field(default_factory=lambda: _kernel_id("subtask"))
    title: str
    status: TaskStatus = "pending"
    description: str = ""
    order: int = 0
    owner: Optional[str] = None
    depends_on: List[str] = Field(default_factory=list)
    verification: List[VerificationSpec] = Field(default_factory=list)
    artifacts: List[ArtifactRef] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ExecutionRecord(BaseModel):
    tx_id: str
    tx_type: str
    status: str
    journal_path: Optional[str] = None
    step_attempts_total: int = 0
    rollback_attempts_total: int = 0
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class OutcomeRecord(BaseModel):
    outcome_id: str = Field(default_factory=lambda: _kernel_id("outcome"))
    task_id: str
    status: OutcomeStatus
    summary: str = ""
    reward: Optional[float] = None
    user_correction: bool = False
    recovery_needed: bool = False
    validator_pass: Optional[bool] = None
    produced_artifacts: List[str] = Field(default_factory=list)
    evidence: List[str] = Field(default_factory=list)
    execution_ref: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ReasoningTask(BaseModel):
    task_id: str = Field(default_factory=lambda: _kernel_id("task"))
    title: str
    description: str = ""
    status: TaskStatus = "pending"
    priority: int = 50
    owner: Optional[str] = None
    session_key: Optional[str] = None
    archetype: Optional[str] = None
    deadline_at: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)
    dependencies: List[DependencyRef] = Field(default_factory=list)
    subtasks: List[Subtask] = Field(default_factory=list)
    beliefs: List[str] = Field(default_factory=list)
    artifacts: List[ArtifactRef] = Field(default_factory=list)
    verification: List[VerificationSpec] = Field(default_factory=list)
    execution: List[ExecutionRecord] = Field(default_factory=list)
    outcomes: List[str] = Field(default_factory=list)
    policy_decisions: List[str] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ReasoningEnvelope(BaseModel):
    version: str = "cortex.reasoning.kernel.v1"
    tasks: List[ReasoningTask] = Field(default_factory=list)
    beliefs: List[BeliefClaim] = Field(default_factory=list)
    artifacts: List[ArtifactRef] = Field(default_factory=list)
    outcomes: List[OutcomeRecord] = Field(default_factory=list)
    policy_decisions: List[PolicyDecision] = Field(default_factory=list)
    generated_at: str = Field(default_factory=_now_iso)


_TX_TO_TASK_STATUS = {
    "initialized": "pending",
    "preflight": "ready",
    "preflight_failed": "failed",
    "running": "running",
    "completed": "completed",
    "failed": "failed",
    "verification_failed": "failed",
}



def task_status_from_transaction_status(status: str) -> TaskStatus:
    return _TX_TO_TASK_STATUS.get(str(status or "").strip().lower(), "pending")  # type: ignore[return-value]



def _artifact_for_journal(journal_path: Optional[str], *, task_id: str) -> List[ArtifactRef]:
    if not journal_path:
        return []
    return [
        ArtifactRef(
            kind="journal",
            label="execution_journal",
            uri=str(journal_path),
            mime_type="application/json",
            produced_by_task_id=task_id,
        )
    ]



def build_execution_record(tx: Dict[str, Any]) -> ExecutionRecord:
    return ExecutionRecord(
        tx_id=str(tx.get("tx_id") or _kernel_id("tx")),
        tx_type=str(tx.get("tx_type") or "unknown"),
        status=str(tx.get("status") or "initialized"),
        journal_path=tx.get("journal_path") or tx.get("journal") or tx.get("journal_file"),
        step_attempts_total=int(tx.get("step_attempts_total", 0) or 0),
        rollback_attempts_total=int(tx.get("rollback_attempts_total", 0) or 0),
        started_at=tx.get("started_at"),
        ended_at=tx.get("ended_at"),
        metadata=dict(tx.get("metadata") or {}),
    )



def build_reasoning_task_from_transaction(
    tx: Dict[str, Any],
    *,
    title: Optional[str] = None,
    description: str = "",
    owner: Optional[str] = None,
    session_key: Optional[str] = None,
    archetype: Optional[str] = None,
    success_criteria: Optional[Sequence[str]] = None,
    constraints: Optional[Sequence[str]] = None,
) -> ReasoningTask:
    metadata = dict(tx.get("metadata") or {})
    tx_id = str(tx.get("tx_id") or _kernel_id("tx"))
    task_id = str(metadata.get("reasoning_task_id") or f"task_{tx_id}")
    subtasks: List[Subtask] = []
    for idx, step in enumerate(tx.get("steps", []) or [], start=1):
        step_name = str((step or {}).get("name") or f"step_{idx}")
        verification: List[VerificationSpec] = []
        if (step or {}).get("verified") is not None:
            verification.append(
                VerificationSpec(
                    method="step_verification",
                    required=True,
                    success_signal=f"verified={bool((step or {}).get('verified'))}",
                    verifier="execution_transaction",
                )
            )
        subtasks.append(
            Subtask(
                task_id=f"{task_id}:{step_name}",
                title=step_name,
                description=str((step or {}).get("error") or ""),
                order=idx,
                status=task_status_from_transaction_status(str((step or {}).get("status") or "pending")),
                owner=owner,
                verification=verification,
                metadata={
                    "attempts": int((step or {}).get("attempts", 0) or 0),
                    "latency_ms": int((step or {}).get("latency_ms", 0) or 0),
                    "retry_policy": (step or {}).get("retry_policy"),
                    "rollback_available": bool((step or {}).get("rollback_available")),
                },
            )
        )

    execution = build_execution_record(tx)
    task = ReasoningTask(
        task_id=task_id,
        title=title or str(metadata.get("title") or tx.get("tx_type") or tx_id),
        description=description or str(metadata.get("description") or ""),
        status=task_status_from_transaction_status(str(tx.get("status") or "initialized")),
        owner=owner or metadata.get("owner"),
        session_key=session_key or metadata.get("session_key"),
        archetype=archetype or metadata.get("archetype"),
        created_at=_normalize_ts(tx.get("started_at"), default=_now_iso()),
        updated_at=_normalize_ts(tx.get("ended_at") or tx.get("updated_at") or tx.get("started_at"), default=_now_iso()),
        subtasks=subtasks,
        artifacts=_artifact_for_journal(execution.journal_path, task_id=task_id),
        execution=[execution],
        success_criteria=list(success_criteria or metadata.get("success_criteria") or []),
        constraints=list(constraints or metadata.get("constraints") or []),
        metadata=metadata,
    )
    return task



def build_outcome_from_transaction(
    tx: Dict[str, Any],
    *,
    task_id: Optional[str] = None,
    summary: str = "",
    reward: Optional[float] = None,
    validator_pass: Optional[bool] = None,
    user_correction: bool = False,
    recovery_needed: bool = False,
) -> OutcomeRecord:
    tx_status = str(tx.get("status") or "").strip().lower()
    if tx_status == "completed":
        outcome_status: OutcomeStatus = "success"
    elif tx_status in {"cancelled", "canceled"}:
        outcome_status = "cancelled"
    elif tx_status in {"verification_failed", "failed", "preflight_failed"}:
        outcome_status = "failure"
    else:
        outcome_status = "partial"

    journal_path = tx.get("journal_path") or tx.get("journal") or tx.get("journal_file")
    evidence = [str(journal_path)] if journal_path else []
    return OutcomeRecord(
        task_id=task_id or str((tx.get("metadata") or {}).get("reasoning_task_id") or f"task_{str(tx.get('tx_id') or _kernel_id('tx'))}"),
        status=outcome_status,
        summary=summary or f"Execution transaction {str(tx.get('tx_id') or '')} ended with status={tx_status or 'unknown'}",
        reward=reward,
        user_correction=bool(user_correction),
        recovery_needed=bool(recovery_needed),
        validator_pass=validator_pass,
        execution_ref=str(tx.get("tx_id") or "") or None,
        evidence=evidence,
        metadata={
            "tx_type": tx.get("tx_type"),
            "step_attempts_total": int(tx.get("step_attempts_total", 0) or 0),
            "rollback_attempts_total": int(tx.get("rollback_attempts_total", 0) or 0),
        },
    )



def build_policy_decision(
    *,
    domain: PolicyDomain,
    chosen: str,
    rationale: str = "",
    confidence: float = 0.0,
    task_id: Optional[str] = None,
    alternatives: Optional[Sequence[str]] = None,
    inputs: Optional[Dict[str, Any]] = None,
    metrics: Optional[Dict[str, Any]] = None,
) -> PolicyDecision:
    return PolicyDecision(
        domain=domain,
        chosen=chosen,
        rationale=rationale,
        confidence=float(confidence or 0.0),
        task_id=task_id,
        alternatives=list(alternatives or []),
        inputs=dict(inputs or {}),
        metrics=dict(metrics or {}),
    )



def build_belief_claim(
    *,
    subject: str,
    predicate: str,
    value: Any,
    confidence: float = 0.5,
    freshness: float = 0.5,
    kind: BeliefKind = "inferred",
    task_id: Optional[str] = None,
    source_type: str = "system",
    source_ref: Optional[str] = None,
    observed_at: Optional[str] = None,
    note: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> BeliefClaim:
    return BeliefClaim(
        subject=subject,
        predicate=predicate,
        value=value,
        confidence=float(confidence),
        freshness=float(freshness),
        kind=kind,
        task_id=task_id,
        provenance=[
            Provenance(
                source_type=source_type,
                source_ref=source_ref,
                observed_at=observed_at,
                note=note,
            )
        ],
        metadata=dict(metadata or {}),
    )



def build_artifact_ref(path: str | Path, *, kind: ArtifactKind = "file", label: Optional[str] = None, task_id: Optional[str] = None, mime_type: Optional[str] = None, metadata: Optional[Dict[str, Any]] = None) -> ArtifactRef:
    p = Path(path)
    return ArtifactRef(
        kind=kind,
        label=label or p.name or "artifact",
        uri=str(p),
        mime_type=mime_type,
        produced_by_task_id=task_id,
        metadata=dict(metadata or {}),
    )


__all__ = [
    "ArtifactRef",
    "BeliefClaim",
    "DependencyRef",
    "ExecutionRecord",
    "OutcomeRecord",
    "PolicyDecision",
    "Provenance",
    "ReasoningEnvelope",
    "ReasoningTask",
    "Subtask",
    "VerificationSpec",
    "build_artifact_ref",
    "build_belief_claim",
    "build_execution_record",
    "build_outcome_from_transaction",
    "build_policy_decision",
    "build_reasoning_task_from_transaction",
    "model_dump_compat",
    "task_status_from_transaction_status",
]
