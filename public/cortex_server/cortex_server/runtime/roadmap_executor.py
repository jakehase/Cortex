from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.agent_mailbox import AgentMailbox
from cortex_server.runtime.agent_supervisor import AgentLease, AgentSupervisor
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore
from cortex_server.runtime.production_build_loop import repair_production_dependability
from cortex_server.runtime.release_workflow import ReleaseWorkflowState, ReleaseWorkflowStore
from cortex_server.runtime.shared_process_state import OpenDecision, SharedProcessState, SharedProcessStateStore


JsonDict = Dict[str, Any]
BUILTIN_BLOCKER_PREFIXES = ("BLOCKER:", "HUMAN:")


def _now(now: Optional[datetime] = None) -> datetime:
    return now or datetime.now(timezone.utc)



def _now_iso(now: Optional[datetime] = None) -> str:
    return _now(now).isoformat(timespec="milliseconds").replace("+00:00", "Z")



def _objective_id() -> str:
    return f"objective_{uuid4().hex[:16]}"



def _execution_id() -> str:
    return f"roadmap_{uuid4().hex[:16]}"



def _report_id() -> str:
    return f"roadmap_report_{uuid4().hex[:16]}"



def _dedupe_rows(rows: Sequence[str]) -> List[str]:
    out: List[str] = []
    for row in rows or []:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text)
    return out



def _task_scope(task_id: str) -> str:
    return f"roadmap_task:{task_id}"



def _message_status_key(message: Optional[str]) -> Optional[str]:
    text = str(message or "").strip()
    return text or None


class RoadmapSuccessCriterion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criterion_id: str
    summary: str
    kind: str
    required: bool = True
    stage: Optional[str] = None
    artifact_id: Optional[str] = None
    world_state_key: Optional[str] = None
    expected_value: Optional[Any] = None
    allowed_values: List[str] = Field(default_factory=list)
    task_id: Optional[str] = None
    phase_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("criterion_id", "summary", "kind")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("allowed_values")
    @classmethod
    def _validate_allowed_values(cls, values: List[str]) -> List[str]:
        cleaned = [str(value or "").strip() for value in (values or [])]
        if any(not value for value in cleaned):
            raise ValueError("allowed_values must not contain empty values")
        return cleaned


class RoadmapTaskDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    phase_id: str
    title: str
    work_type: str
    summary: Optional[str] = None
    depends_on: List[str] = Field(default_factory=list)
    owner_hint: Optional[str] = None
    success_criteria: List[str] = Field(default_factory=list)
    quality_gates: List[RoadmapSuccessCriterion] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("task_id", "phase_id", "title", "work_type")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("depends_on", "success_criteria")
    @classmethod
    def _validate_rows(cls, values: List[str]) -> List[str]:
        cleaned = [str(value or "").strip() for value in (values or [])]
        if any(not value for value in cleaned):
            raise ValueError("list values must not contain empty rows")
        return cleaned


class RoadmapPhaseDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phase_id: str
    title: str
    summary: Optional[str] = None
    depends_on: List[str] = Field(default_factory=list)
    required_task_ids: List[str] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list)
    quality_gates: List[RoadmapSuccessCriterion] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("phase_id", "title")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("depends_on", "required_task_ids", "success_criteria")
    @classmethod
    def _validate_rows(cls, values: List[str]) -> List[str]:
        cleaned = [str(value or "").strip() for value in (values or [])]
        if any(not value for value in cleaned):
            raise ValueError("list values must not contain empty rows")
        return cleaned


class RoadmapBlockerRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blocker_id: str
    summary: str
    source: str
    requires_human: bool = True
    terminal: bool = True
    owner: Optional[str] = None
    question_prefix: Optional[str] = None
    metadata_key: Optional[str] = None
    metadata_value: Optional[str] = None
    decision_title: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("blocker_id", "summary", "source")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text


class RoadmapReportingPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report_every_iterations: int = 1
    report_on_phase_change: bool = True
    report_on_task_change: bool = True
    report_on_recovery: bool = True
    report_on_blocker_change: bool = True
    report_on_status_change: bool = True
    report_on_worker_dispatch: bool = True

    @field_validator("report_every_iterations")
    @classmethod
    def _validate_positive(cls, value: int) -> int:
        number = int(value or 0)
        if number <= 0:
            raise ValueError("report_every_iterations must be positive")
        return number


class RoadmapObjectiveContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    objective_id: str = Field(default_factory=_objective_id)
    process_id: str
    objective: str
    success_criteria: List[RoadmapSuccessCriterion] = Field(default_factory=list)
    phases: List[RoadmapPhaseDefinition] = Field(default_factory=list)
    tasks: List[RoadmapTaskDefinition] = Field(default_factory=list)
    blocker_rules: List[RoadmapBlockerRule] = Field(default_factory=list)
    dependability_profile: str | JsonDict = "24h"
    controller_scope: str = "roadmap_executor"
    controller_lease_seconds: int = 180
    worker_lease_seconds: int = 180
    reporting_policy: RoadmapReportingPolicy = Field(default_factory=RoadmapReportingPolicy)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("objective_id", "process_id", "objective", "controller_scope")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("controller_lease_seconds", "worker_lease_seconds")
    @classmethod
    def _validate_positive(cls, value: int) -> int:
        number = int(value or 0)
        if number <= 0:
            raise ValueError("lease seconds must be positive")
        return number

    @field_validator("tasks")
    @classmethod
    def _validate_tasks(cls, values: List[RoadmapTaskDefinition], info) -> List[RoadmapTaskDefinition]:
        task_ids = [row.task_id for row in values or []]
        if len(task_ids) != len(set(task_ids)):
            raise ValueError("task ids must be unique")
        return values

    @field_validator("phases")
    @classmethod
    def _validate_phases(cls, values: List[RoadmapPhaseDefinition]) -> List[RoadmapPhaseDefinition]:
        phase_ids = [row.phase_id for row in values or []]
        if len(phase_ids) != len(set(phase_ids)):
            raise ValueError("phase ids must be unique")
        return values


class RoadmapControllerOwner(BaseModel):
    model_config = ConfigDict(extra="forbid")

    controller_id: str
    session_id: str
    lease_id: str
    claimed_at: str
    heartbeat_at: str

    @field_validator("controller_id", "session_id", "lease_id", "claimed_at", "heartbeat_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text


class RoadmapTaskState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    phase_id: str
    work_type: str
    status: str = "pending"
    attempt_count: int = 0
    assigned_agent_id: Optional[str] = None
    lease_id: Optional[str] = None
    last_handoff_message_id: Optional[str] = None
    last_handoff_status: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    updated_at: str = Field(default_factory=_now_iso)
    blockers: List[Dict[str, Any]] = Field(default_factory=list)
    gate_results: List[Dict[str, Any]] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("task_id", "phase_id", "work_type", "status", "updated_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("attempt_count")
    @classmethod
    def _validate_attempt_count(cls, value: int) -> int:
        number = int(value or 0)
        if number < 0:
            raise ValueError("attempt_count must be non-negative")
        return number


class RoadmapPhaseState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phase_id: str
    status: str = "pending"
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    updated_at: str = Field(default_factory=_now_iso)
    gate_results: List[Dict[str, Any]] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("phase_id", "status", "updated_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text


class RoadmapExecutionState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    execution_id: str = Field(default_factory=_execution_id)
    objective_id: str
    process_id: str
    status: str = "active"
    iteration_count: int = 0
    checkpoint_count: int = 0
    recovery_count: int = 0
    controller: Optional[RoadmapControllerOwner] = None
    active_phase_id: Optional[str] = None
    active_task_ids: List[str] = Field(default_factory=list)
    current_revision_id: Optional[str] = None
    current_snapshot_id: Optional[str] = None
    current_release_stage: Optional[str] = None
    latest_report_id: Optional[str] = None
    last_checkpoint_at: Optional[str] = None
    true_blockers: List[Dict[str, Any]] = Field(default_factory=list)
    completion: Dict[str, Any] = Field(default_factory=dict)
    phase_states: List[RoadmapPhaseState] = Field(default_factory=list)
    task_states: List[RoadmapTaskState] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("execution_id", "objective_id", "process_id", "status")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("iteration_count", "checkpoint_count", "recovery_count")
    @classmethod
    def _validate_non_negative(cls, value: int) -> int:
        number = int(value or 0)
        if number < 0:
            raise ValueError("counts must be non-negative")
        return number


class RoadmapExecutionReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report_id: str = Field(default_factory=_report_id)
    execution_id: str
    objective_id: str
    process_id: str
    iteration: int
    kind: str
    status: str
    summary: str
    recorded_at: str = Field(default_factory=_now_iso)
    controller_id: Optional[str] = None
    controller_session_id: Optional[str] = None
    active_phase_id: Optional[str] = None
    active_task_ids: List[str] = Field(default_factory=list)
    actions_taken: List[Dict[str, Any]] = Field(default_factory=list)
    blockers: List[Dict[str, Any]] = Field(default_factory=list)
    completion: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("report_id", "execution_id", "objective_id", "process_id", "kind", "status", "summary", "recorded_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("iteration")
    @classmethod
    def _validate_iteration(cls, value: int) -> int:
        number = int(value or 0)
        if number < 0:
            raise ValueError("iteration must be non-negative")
        return number


class RoadmapExecutionStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _root(self) -> Path:
        return self.path if not self.path.suffix else self.path.parent / self.path.stem

    def _contract_target(self, process_id: str) -> Path:
        return self._root() / "contracts" / f"{process_id}.json"

    def _state_target(self, process_id: str) -> Path:
        return self._root() / "state" / f"{process_id}.json"

    def _history_target(self, process_id: str) -> Path:
        return self._root() / "history" / f"{process_id}.jsonl"

    def _report_target(self, process_id: str) -> Path:
        return self._root() / "reports" / f"{process_id}.jsonl"

    def save_contract(self, contract: RoadmapObjectiveContract | Dict[str, Any]) -> RoadmapObjectiveContract:
        record = _contract_validate(contract if isinstance(contract, dict) else _contract_dump(contract))
        target = self._contract_target(record.process_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(_contract_dump(record), sort_keys=True, indent=2) + "\n", encoding="utf-8")
        return record

    def load_contract(self, process_id: str) -> Optional[RoadmapObjectiveContract]:
        target = self._contract_target(process_id)
        if not target.exists():
            return None
        return _contract_validate(json.loads(target.read_text(encoding="utf-8")))

    def save_state(self, state: RoadmapExecutionState | Dict[str, Any]) -> RoadmapExecutionState:
        record = _state_validate(state if isinstance(state, dict) else _state_dump(state))
        target = self._state_target(record.process_id)
        current = self.load_state(record.process_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(_state_dump(record), sort_keys=True, indent=2) + "\n", encoding="utf-8")
        history_row = {
            "ts": _now_iso(),
            "execution_id": record.execution_id,
            "objective_id": record.objective_id,
            "process_id": record.process_id,
            "status": record.status,
            "iteration_count": record.iteration_count,
            "checkpoint_count": record.checkpoint_count,
            "recovery_count": record.recovery_count,
            "previous_status": current.status if current else None,
            "state": _state_dump(record),
        }
        history_target = self._history_target(record.process_id)
        history_target.parent.mkdir(parents=True, exist_ok=True)
        with history_target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(history_row, sort_keys=True) + "\n")
        return record

    def load_state(self, process_id: str) -> Optional[RoadmapExecutionState]:
        target = self._state_target(process_id)
        if not target.exists():
            return None
        return _state_validate(json.loads(target.read_text(encoding="utf-8")))

    def append_report(self, report: RoadmapExecutionReport | Dict[str, Any]) -> RoadmapExecutionReport:
        record = _report_validate(report if isinstance(report, dict) else _report_dump(report))
        target = self._report_target(record.process_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(_report_dump(record), sort_keys=True) + "\n")
        return record

    def reports(self, process_id: str) -> List[RoadmapExecutionReport]:
        target = self._report_target(process_id)
        if not target.exists():
            return []
        rows: List[RoadmapExecutionReport] = []
        with target.open("r", encoding="utf-8") as handle:
            for line in handle:
                text = line.strip()
                if not text:
                    continue
                rows.append(_report_validate(json.loads(text)))
        return rows



def _contract_validate(data: Dict[str, Any]) -> RoadmapObjectiveContract:
    if hasattr(RoadmapObjectiveContract, "model_validate"):
        return RoadmapObjectiveContract.model_validate(data)
    return RoadmapObjectiveContract.parse_obj(data)



def _contract_dump(model: RoadmapObjectiveContract) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _state_validate(data: Dict[str, Any]) -> RoadmapExecutionState:
    if hasattr(RoadmapExecutionState, "model_validate"):
        return RoadmapExecutionState.model_validate(data)
    return RoadmapExecutionState.parse_obj(data)



def _state_dump(model: RoadmapExecutionState) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _report_validate(data: Dict[str, Any]) -> RoadmapExecutionReport:
    if hasattr(RoadmapExecutionReport, "model_validate"):
        return RoadmapExecutionReport.model_validate(data)
    return RoadmapExecutionReport.parse_obj(data)



def _report_dump(model: RoadmapExecutionReport) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _task_status_map(state: RoadmapExecutionState) -> Dict[str, RoadmapTaskState]:
    return {row.task_id: row for row in state.task_states}



def _phase_status_map(state: RoadmapExecutionState) -> Dict[str, RoadmapPhaseState]:
    return {row.phase_id: row for row in state.phase_states}



def _task_defs_by_id(contract: RoadmapObjectiveContract) -> Dict[str, RoadmapTaskDefinition]:
    return {row.task_id: row for row in contract.tasks}



def _phase_defs_by_id(contract: RoadmapObjectiveContract) -> Dict[str, RoadmapPhaseDefinition]:
    return {row.phase_id: row for row in contract.phases}



def _tasks_for_phase(contract: RoadmapObjectiveContract, phase_id: str) -> List[RoadmapTaskDefinition]:
    return [row for row in contract.tasks if row.phase_id == phase_id]



def _phase_task_ids(contract: RoadmapObjectiveContract, phase: RoadmapPhaseDefinition) -> List[str]:
    explicit = _dedupe_rows(list(phase.required_task_ids or []))
    if explicit:
        return explicit
    return [row.task_id for row in _tasks_for_phase(contract, phase.phase_id)]



def _task_completed_observation(task_id: str, *, snapshot: ProcessSnapshot, shared_state: SharedProcessState) -> bool:
    keys = [
        f"task.{task_id}.status",
        f"task:{task_id}:status",
        f"task_status.{task_id}",
    ]
    bool_keys = [
        f"task.{task_id}.complete",
        f"task:{task_id}:complete",
        f"task_complete.{task_id}",
    ]
    values = [{**dict(snapshot.world_state), **dict(shared_state.world_state)}.get(key) for key in keys]
    if task_id in set(snapshot.completed_steps):
        return True
    if any(str(value).strip().lower() == "completed" for value in values if value is not None):
        return True
    return any(bool({**dict(snapshot.world_state), **dict(shared_state.world_state)}.get(key)) for key in bool_keys)



def _release_stage_satisfied(criterion: RoadmapSuccessCriterion, release_state: Optional[ReleaseWorkflowState]) -> Tuple[bool, Any, str]:
    if release_state is None:
        return False, None, "release state missing"
    target_stage = str(criterion.stage or criterion.expected_value or "").strip()
    observed = str(release_state.current_stage or "").strip() or None
    comparison = str((criterion.metadata or {}).get("comparison") or "equals").strip() or "equals"
    stage_order = [str(row).strip() for row in ((criterion.metadata or {}).get("stage_order") or []) if str(row).strip()]
    satisfied = False
    if comparison == "equals" or not target_stage:
        satisfied = observed == target_stage
    elif comparison == "at_least" and stage_order and observed in stage_order and target_stage in stage_order:
        satisfied = stage_order.index(observed) >= stage_order.index(target_stage)
    else:
        satisfied = observed == target_stage
    return satisfied, observed, f"release stage {observed or 'missing'} vs {target_stage or 'unset'}"



def _evaluate_criteria(
    criteria: List[RoadmapSuccessCriterion],
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    dependability_report: Optional[JsonDict],
    release_state: Optional[ReleaseWorkflowState],
    completed_task_ids: Optional[set[str]] = None,
    completed_phase_ids: Optional[set[str]] = None,
    fallback_task_id: Optional[str] = None,
) -> JsonDict:
    completed_tasks = set(completed_task_ids or set())
    completed_phases = set(completed_phase_ids or set())
    rows: List[JsonDict] = []
    merged_world_state = {**dict(snapshot.world_state), **dict(shared_state.world_state)}

    active_criteria = list(criteria or [])
    if not active_criteria and fallback_task_id:
        active_criteria = [
            RoadmapSuccessCriterion(
                criterion_id=f"runtime-node:{fallback_task_id}",
                summary=f"Complete runtime node {fallback_task_id}",
                kind="runtime_node_completed",
                task_id=fallback_task_id,
            )
        ]

    for criterion in active_criteria:
        satisfied = False
        observed: Any = None
        detail: Optional[str] = None
        kind = criterion.kind
        if kind == "dependability":
            observed = bool((dependability_report or {}).get("success"))
            satisfied = bool(observed)
            detail = (dependability_report or {}).get("operator_summary")
        elif kind == "release_stage":
            satisfied, observed, detail = _release_stage_satisfied(criterion, release_state)
        elif kind == "artifact_present":
            artifact_id = str(criterion.artifact_id or criterion.expected_value or "").strip()
            artifacts = set(str(row).strip() for row in (snapshot.artifact_refs or []) if str(row).strip())
            observed = artifact_id if artifact_id in artifacts else None
            satisfied = bool(observed)
            detail = f"artifact {'present' if satisfied else 'missing'}: {artifact_id}"
        elif kind == "open_questions_clear":
            observed = list(shared_state.open_questions)
            satisfied = len(shared_state.open_questions) == 0
            detail = f"open questions={len(shared_state.open_questions)}"
        elif kind == "operator_holds_clear":
            holds = list(release_state.operator_holds) if release_state else []
            observed = holds
            satisfied = len(holds) == 0
            detail = f"operator holds={len(holds)}"
        elif kind == "world_state":
            key = str(criterion.world_state_key or "").strip()
            observed = merged_world_state.get(key) if key else None
            allowed = list(criterion.allowed_values or [])
            if allowed:
                satisfied = str(observed) in allowed
            else:
                satisfied = observed == criterion.expected_value
            detail = f"world state {key}={observed!r}"
        elif kind == "lifecycle_state":
            observed = snapshot.lifecycle_state
            allowed = list(criterion.allowed_values or [])
            if allowed:
                satisfied = snapshot.lifecycle_state in allowed
            else:
                expected = str(criterion.expected_value or criterion.stage or "").strip()
                satisfied = snapshot.lifecycle_state == expected
            detail = f"lifecycle={snapshot.lifecycle_state}"
        elif kind == "task_completed":
            target_task = str(criterion.task_id or criterion.expected_value or fallback_task_id or "").strip()
            observed = target_task
            satisfied = target_task in completed_tasks if target_task else False
            detail = f"task {target_task or 'unset'} {'completed' if satisfied else 'pending'}"
        elif kind == "phase_completed":
            target_phase = str(criterion.phase_id or criterion.expected_value or "").strip()
            observed = target_phase
            satisfied = target_phase in completed_phases if target_phase else False
            detail = f"phase {target_phase or 'unset'} {'completed' if satisfied else 'pending'}"
        elif kind == "runtime_node_completed":
            target_task = str(criterion.task_id or criterion.expected_value or fallback_task_id or "").strip()
            observed = target_task
            satisfied = _task_completed_observation(target_task, snapshot=snapshot, shared_state=shared_state) if target_task else False
            detail = f"runtime node {target_task or 'unset'} {'completed' if satisfied else 'pending'}"
        elif kind == "all_phases_complete":
            observed = sorted(completed_phases)
            satisfied = False
            detail = "all phases complete criterion handled by execution completion check"
        else:
            detail = f"unsupported criterion kind: {kind}"

        rows.append(
            {
                "criterion_id": criterion.criterion_id,
                "summary": criterion.summary,
                "kind": kind,
                "required": bool(criterion.required),
                "satisfied": bool(satisfied),
                "observed": observed,
                "detail": detail,
            }
        )

    required_rows = [row for row in rows if row.get("required")]
    satisfied_required = [row for row in required_rows if row.get("satisfied")]
    return {
        "criteria": rows,
        "required_total": len(required_rows),
        "required_satisfied": len(satisfied_required),
        "all_required_satisfied": len(required_rows) == len(satisfied_required),
    }



def evaluate_roadmap_task(
    task: RoadmapTaskDefinition,
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    dependability_report: Optional[JsonDict] = None,
    release_state: Optional[ReleaseWorkflowState] = None,
    completed_task_ids: Optional[set[str]] = None,
    completed_phase_ids: Optional[set[str]] = None,
) -> JsonDict:
    evaluation = _evaluate_criteria(
        list(task.quality_gates or []),
        snapshot=snapshot,
        shared_state=shared_state,
        dependability_report=dependability_report,
        release_state=release_state,
        completed_task_ids=completed_task_ids,
        completed_phase_ids=completed_phase_ids,
        fallback_task_id=task.task_id,
    )
    return {
        "task_id": task.task_id,
        "phase_id": task.phase_id,
        "title": task.title,
        "work_type": task.work_type,
        **evaluation,
        "operator_summary": (
            f"roadmap task {'complete' if evaluation['all_required_satisfied'] else 'pending'} for {task.task_id}: "
            f"{evaluation['required_satisfied']}/{evaluation['required_total']} required gates satisfied"
        ),
    }



def evaluate_roadmap_phase(
    contract: RoadmapObjectiveContract,
    phase: RoadmapPhaseDefinition,
    *,
    task_state_map: Dict[str, RoadmapTaskState],
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    dependability_report: Optional[JsonDict] = None,
    release_state: Optional[ReleaseWorkflowState] = None,
    completed_phase_ids: Optional[set[str]] = None,
) -> JsonDict:
    required_task_ids = _phase_task_ids(contract, phase)
    completed_tasks = {task_id for task_id in required_task_ids if (task_state_map.get(task_id) and task_state_map[task_id].status == "completed")}
    gate_eval = _evaluate_criteria(
        list(phase.quality_gates or []),
        snapshot=snapshot,
        shared_state=shared_state,
        dependability_report=dependability_report,
        release_state=release_state,
        completed_task_ids={task_id for task_id, task_state in task_state_map.items() if task_state.status == "completed"},
        completed_phase_ids=completed_phase_ids,
    )
    tasks_ready = len(required_task_ids) == len(completed_tasks)
    all_required_satisfied = tasks_ready and gate_eval["all_required_satisfied"]
    return {
        "phase_id": phase.phase_id,
        "required_task_ids": required_task_ids,
        "completed_required_task_ids": sorted(completed_tasks),
        "tasks_ready": tasks_ready,
        "gate_results": gate_eval["criteria"],
        "all_required_satisfied": all_required_satisfied,
        "operator_summary": (
            f"roadmap phase {'complete' if all_required_satisfied else 'pending'} for {phase.phase_id}: "
            f"tasks={len(completed_tasks)}/{len(required_task_ids)}, "
            f"gates={gate_eval['required_satisfied']}/{gate_eval['required_total']}"
        ),
    }



def evaluate_roadmap_completion(
    contract: RoadmapObjectiveContract,
    *,
    state: RoadmapExecutionState,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    dependability_report: Optional[JsonDict] = None,
    release_state: Optional[ReleaseWorkflowState] = None,
) -> JsonDict:
    completed_phase_ids = {row.phase_id for row in state.phase_states if row.status == "completed"}
    phase_total = len(contract.phases)
    phase_completed = len(completed_phase_ids)
    gate_eval = _evaluate_criteria(
        list(contract.success_criteria or []),
        snapshot=snapshot,
        shared_state=shared_state,
        dependability_report=dependability_report,
        release_state=release_state,
        completed_task_ids={row.task_id for row in state.task_states if row.status == "completed"},
        completed_phase_ids=completed_phase_ids,
    )
    all_phases_complete = phase_total == phase_completed
    criteria_rows: List[JsonDict] = []
    for row in gate_eval["criteria"]:
        if row.get("kind") == "all_phases_complete":
            criteria_rows.append(
                {
                    **dict(row),
                    "satisfied": all_phases_complete,
                    "observed": sorted(completed_phase_ids),
                    "detail": f"phases={phase_completed}/{phase_total}",
                }
            )
        else:
            criteria_rows.append(dict(row))
    required_rows = [row for row in criteria_rows if row.get("required")]
    required_satisfied = [row for row in required_rows if row.get("satisfied")]
    all_required_satisfied = all_phases_complete and len(required_rows) == len(required_satisfied)
    return {
        "process_id": contract.process_id,
        "objective_id": contract.objective_id,
        "objective": contract.objective,
        "phase_total": phase_total,
        "phase_completed": phase_completed,
        "all_phases_complete": all_phases_complete,
        "criteria": criteria_rows,
        "required_total": len(required_rows),
        "required_satisfied": len(required_satisfied),
        "all_required_satisfied": all_required_satisfied,
        "operator_summary": (
            f"roadmap objective {'ready' if all_required_satisfied else 'pending'} for {contract.process_id}: "
            f"phases={phase_completed}/{phase_total}, gates={len(required_satisfied)}/{len(required_rows)}"
        ),
    }



def _report_blocker_key(blocker: Dict[str, Any]) -> str:
    return f"{blocker.get('source')}|{blocker.get('summary')}"



def _decision_requires_human(decision: OpenDecision) -> bool:
    metadata = dict(decision.metadata or {})
    owner = str(decision.owner or "").strip().lower()
    return bool(metadata.get("requires_human") or metadata.get("blocking") or owner in {"human", "operator", "user"})



def detect_roadmap_true_blockers(
    contract: RoadmapObjectiveContract,
    *,
    state: RoadmapExecutionState,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    release_state: Optional[ReleaseWorkflowState] = None,
) -> List[JsonDict]:
    blockers: List[JsonDict] = []

    for hold in list(release_state.operator_holds) if release_state else []:
        blockers.append({"source": "release_hold", "summary": str(hold), "requires_human": True, "terminal": True})

    for decision in shared_state.open_decisions:
        if decision.status == "resolved":
            continue
        if _decision_requires_human(decision):
            blockers.append(
                {
                    "source": "open_decision",
                    "summary": decision.title,
                    "requires_human": True,
                    "terminal": True,
                    "decision_id": decision.decision_id,
                }
            )

    for question in shared_state.open_questions:
        if any(str(question).startswith(prefix) for prefix in BUILTIN_BLOCKER_PREFIXES):
            blockers.append({"source": "open_question", "summary": str(question), "requires_human": True, "terminal": True})

    for task in state.task_states:
        if task.status != "blocked":
            continue
        for blocker in task.blockers:
            blockers.append(
                {
                    "source": blocker.get("source") or "task_blocker",
                    "summary": blocker.get("summary") or f"task {task.task_id} blocked",
                    "requires_human": bool(blocker.get("requires_human", True)),
                    "terminal": bool(blocker.get("terminal", True)),
                    "task_id": task.task_id,
                    "phase_id": task.phase_id,
                }
            )

    for rule in contract.blocker_rules:
        if rule.source == "release_hold":
            for hold in list(release_state.operator_holds) if release_state else []:
                blockers.append(
                    {
                        "source": rule.source,
                        "summary": str(hold),
                        "requires_human": bool(rule.requires_human),
                        "terminal": bool(rule.terminal),
                        "rule_id": rule.blocker_id,
                    }
                )
        elif rule.source == "open_question_prefix":
            prefix = str(rule.question_prefix or "").strip()
            if not prefix:
                continue
            for question in shared_state.open_questions:
                if str(question).startswith(prefix):
                    blockers.append(
                        {
                            "source": rule.source,
                            "summary": str(question),
                            "requires_human": bool(rule.requires_human),
                            "terminal": bool(rule.terminal),
                            "rule_id": rule.blocker_id,
                        }
                    )
        elif rule.source == "open_decision":
            for decision in shared_state.open_decisions:
                if decision.status == "resolved":
                    continue
                if rule.owner and str(decision.owner or "").strip() != str(rule.owner or "").strip():
                    continue
                if rule.decision_title and str(decision.title or "").strip() != str(rule.decision_title or "").strip():
                    continue
                if rule.metadata_key:
                    observed = (decision.metadata or {}).get(rule.metadata_key)
                    if rule.metadata_value is not None and str(observed) != str(rule.metadata_value):
                        continue
                    if rule.metadata_value is None and not observed:
                        continue
                blockers.append(
                    {
                        "source": rule.source,
                        "summary": decision.title,
                        "requires_human": bool(rule.requires_human),
                        "terminal": bool(rule.terminal),
                        "decision_id": decision.decision_id,
                        "rule_id": rule.blocker_id,
                    }
                )

    deduped: List[JsonDict] = []
    seen = set()
    for blocker in blockers:
        key = _report_blocker_key(blocker)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(blocker)
    return deduped



def _claim_controller(
    contract: RoadmapObjectiveContract,
    *,
    previous_state: Optional[RoadmapExecutionState],
    supervisor: AgentSupervisor,
    controller_id: str,
    controller_session_id: str,
    now: Optional[datetime] = None,
) -> JsonDict:
    scope = f"{contract.controller_scope}:{contract.process_id}"
    current_time = _now(now)
    supervisor.reclaim_stale(now=current_time)

    stale_scope_leases = [row for row in supervisor.list(process_id=contract.process_id, status="stale") if row.scope == scope]
    actions: List[JsonDict] = []
    for row in stale_scope_leases:
        resolved = supervisor.resolve(row.lease_id, status="released", metadata={"resolution": "controller_takeover"})
        actions.append({"action": "release_stale_controller", "lease_id": resolved.lease_id})

    active_scope_leases = [row for row in supervisor.list(process_id=contract.process_id, status="active") if row.scope == scope]
    lease: Optional[AgentLease] = None
    recovery = False

    for row in active_scope_leases:
        session = str((row.metadata or {}).get("session_id") or "").strip()
        if row.agent_id == controller_id and session == controller_session_id:
            lease = supervisor.heartbeat(row.lease_id, lease_seconds=contract.controller_lease_seconds)
            actions.append({"action": "heartbeat_controller", "lease_id": lease.lease_id})
            break

    if lease is None and active_scope_leases:
        row = active_scope_leases[0]
        lease = row
        actions.append(
            {
                "action": "controller_already_owned",
                "lease_id": row.lease_id,
                "owner": row.agent_id,
                "session_id": (row.metadata or {}).get("session_id"),
            }
        )
    elif lease is None:
        lease = supervisor.assign(
            process_id=contract.process_id,
            scope=scope,
            agent_id=controller_id,
            lease_seconds=contract.controller_lease_seconds,
            metadata={
                "session_id": controller_session_id,
                "objective_id": contract.objective_id,
                "objective": contract.objective,
            },
        )
        actions.append({"action": "claim_controller", "lease_id": lease.lease_id})
        previous_session = str(previous_state.controller.session_id if previous_state and previous_state.controller else "").strip()
        if previous_session and previous_session != controller_session_id:
            recovery = True

    owner = RoadmapControllerOwner(
        controller_id=lease.agent_id,
        session_id=str((lease.metadata or {}).get("session_id") or controller_session_id),
        lease_id=lease.lease_id,
        claimed_at=lease.assigned_at,
        heartbeat_at=lease.heartbeat_at,
    )
    return {
        "owner": owner,
        "actions": actions,
        "recovery": recovery,
        "owned_by_current_session": owner.controller_id == controller_id and owner.session_id == controller_session_id,
    }



def _merge_state(contract: RoadmapObjectiveContract, previous_state: Optional[RoadmapExecutionState]) -> RoadmapExecutionState:
    if previous_state is None:
        return RoadmapExecutionState(
            objective_id=contract.objective_id,
            process_id=contract.process_id,
            phase_states=[RoadmapPhaseState(phase_id=phase.phase_id) for phase in contract.phases],
            task_states=[
                RoadmapTaskState(task_id=task.task_id, phase_id=task.phase_id, work_type=task.work_type)
                for task in contract.tasks
            ],
            metadata={"objective": contract.objective},
        )

    phase_map = _phase_status_map(previous_state)
    task_map = _task_status_map(previous_state)
    phase_states = [
        phase_map.get(phase.phase_id, RoadmapPhaseState(phase_id=phase.phase_id))
        for phase in contract.phases
    ]
    task_states = []
    for task in contract.tasks:
        existing = task_map.get(task.task_id)
        if existing is None:
            task_states.append(RoadmapTaskState(task_id=task.task_id, phase_id=task.phase_id, work_type=task.work_type))
        else:
            task_states.append(
                RoadmapTaskState(
                    task_id=task.task_id,
                    phase_id=task.phase_id,
                    work_type=task.work_type,
                    status=existing.status,
                    attempt_count=existing.attempt_count,
                    assigned_agent_id=existing.assigned_agent_id,
                    lease_id=existing.lease_id,
                    last_handoff_message_id=existing.last_handoff_message_id,
                    last_handoff_status=existing.last_handoff_status,
                    started_at=existing.started_at,
                    completed_at=existing.completed_at,
                    updated_at=existing.updated_at,
                    blockers=list(existing.blockers),
                    gate_results=list(existing.gate_results),
                    metadata=dict(existing.metadata),
                )
            )

    return RoadmapExecutionState(
        execution_id=previous_state.execution_id,
        objective_id=contract.objective_id,
        process_id=contract.process_id,
        status=previous_state.status,
        iteration_count=previous_state.iteration_count,
        checkpoint_count=previous_state.checkpoint_count,
        recovery_count=previous_state.recovery_count,
        controller=previous_state.controller,
        active_phase_id=previous_state.active_phase_id,
        active_task_ids=list(previous_state.active_task_ids),
        current_revision_id=previous_state.current_revision_id,
        current_snapshot_id=previous_state.current_snapshot_id,
        current_release_stage=previous_state.current_release_stage,
        latest_report_id=previous_state.latest_report_id,
        last_checkpoint_at=previous_state.last_checkpoint_at,
        true_blockers=list(previous_state.true_blockers),
        completion=dict(previous_state.completion),
        phase_states=phase_states,
        task_states=task_states,
        metadata={**dict(previous_state.metadata or {}), "objective": contract.objective},
    )



def _phase_dependencies_satisfied(phase: RoadmapPhaseDefinition, phase_state_map: Dict[str, RoadmapPhaseState]) -> bool:
    return all(phase_state_map.get(dep) is not None and phase_state_map[dep].status == "completed" for dep in phase.depends_on)



def _task_dependencies_satisfied(task: RoadmapTaskDefinition, task_state_map: Dict[str, RoadmapTaskState]) -> bool:
    return all(task_state_map.get(dep) is not None and task_state_map[dep].status == "completed" for dep in task.depends_on)



def _select_active_phase(contract: RoadmapObjectiveContract, phase_state_map: Dict[str, RoadmapPhaseState]) -> Optional[str]:
    for phase in contract.phases:
        state = phase_state_map.get(phase.phase_id)
        if state is None:
            continue
        if state.status == "completed":
            continue
        if _phase_dependencies_satisfied(phase, phase_state_map):
            return phase.phase_id
    return None



def _set_phase_state(phase_state: RoadmapPhaseState, *, status: str, gate_results: Optional[List[Dict[str, Any]]] = None) -> None:
    now_iso = _now_iso()
    previous_status = phase_state.status
    phase_state.status = status
    phase_state.updated_at = now_iso
    if gate_results is not None:
        phase_state.gate_results = list(gate_results)
    if status == "active" and phase_state.started_at is None:
        phase_state.started_at = now_iso
    if status == "completed" and phase_state.completed_at is None:
        phase_state.completed_at = now_iso
    if previous_status == "completed" and status != "completed":
        phase_state.completed_at = None
        phase_state.metadata = {**dict(phase_state.metadata), "regressed": True, "regressed_at": now_iso}



def _set_task_state(task_state: RoadmapTaskState, *, status: str, gate_results: Optional[List[Dict[str, Any]]] = None) -> None:
    now_iso = _now_iso()
    previous_status = task_state.status
    task_state.status = status
    task_state.updated_at = now_iso
    if gate_results is not None:
        task_state.gate_results = list(gate_results)
    if status == "in_progress" and task_state.started_at is None:
        task_state.started_at = now_iso
    if status == "completed" and task_state.completed_at is None:
        task_state.completed_at = now_iso
    if previous_status == "completed" and status != "completed":
        task_state.completed_at = None
        task_state.metadata = {**dict(task_state.metadata), "regressed": True, "regressed_at": now_iso}
    if status != "blocked":
        task_state.blockers = []



def _select_task_agent(
    task: RoadmapTaskDefinition,
    *,
    contract: RoadmapObjectiveContract,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    controller_id: str,
) -> str:
    work_type_map = (contract.metadata or {}).get("owner_by_work_type") if isinstance((contract.metadata or {}).get("owner_by_work_type"), dict) else {}
    owner = (
        str(task.owner_hint or "").strip()
        or str(shared_state.agent_ownership.get(task.task_id) or "").strip()
        or str(snapshot.assigned_agents.get(task.task_id) or "").strip()
        or str(work_type_map.get(task.work_type) or "").strip()
        or str((contract.metadata or {}).get("default_worker_id") or "").strip()
        or controller_id
    )
    return owner



def _dispatch_ready_tasks(
    contract: RoadmapObjectiveContract,
    *,
    state: RoadmapExecutionState,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    controller_id: str,
    active_phase_id: Optional[str],
    now: Optional[datetime] = None,
) -> JsonDict:
    current_time = _now(now)
    supervisor.reclaim_stale(now=current_time)

    phase_state_map = _phase_status_map(state)
    task_state_map = _task_status_map(state)
    actions_taken: List[JsonDict] = []
    recovery = False
    active_task_ids: List[str] = []

    if not active_phase_id:
        return {"actions_taken": actions_taken, "recovery": recovery, "active_task_ids": active_task_ids}

    ready_tasks = [task for task in _tasks_for_phase(contract, active_phase_id) if _task_dependencies_satisfied(task, task_state_map)]
    for task in ready_tasks:
        task_state = task_state_map[task.task_id]
        if task_state.status == "completed":
            continue
        if task_state.status == "blocked":
            active_task_ids.append(task.task_id)
            continue
        agent_id = _select_task_agent(task, contract=contract, snapshot=snapshot, shared_state=shared_state, controller_id=controller_id)
        scope = str((task.metadata or {}).get("lease_scope") or _task_scope(task.task_id)).strip() or _task_scope(task.task_id)
        stale_leases = [row for row in supervisor.list(process_id=contract.process_id, status="stale") if row.scope == scope]
        for row in stale_leases:
            supervisor.resolve(row.lease_id, status="released", metadata={"resolution": "roadmap_task_takeover", "task_id": task.task_id})
            actions_taken.append({"action": "release_stale_task_lease", "lease_id": row.lease_id, "task_id": task.task_id})
            recovery = True

        active_leases = [row for row in supervisor.list(process_id=contract.process_id, status="active") if row.scope == scope]
        lease: Optional[AgentLease] = None
        if active_leases:
            lease = active_leases[0]
            if lease.agent_id == agent_id:
                lease = supervisor.heartbeat(lease.lease_id, lease_seconds=contract.worker_lease_seconds)
                actions_taken.append({"action": "heartbeat_task_lease", "lease_id": lease.lease_id, "task_id": task.task_id, "agent_id": agent_id})
            else:
                supervisor.resolve(lease.lease_id, status="released", metadata={"resolution": "roadmap_task_reassigned", "task_id": task.task_id})
                recovery = True
                actions_taken.append({"action": "reassign_task_lease", "lease_id": lease.lease_id, "task_id": task.task_id, "from_agent": lease.agent_id, "to_agent": agent_id})
                lease = None

        if lease is None:
            lease = supervisor.assign(
                process_id=contract.process_id,
                scope=scope,
                agent_id=agent_id,
                lease_seconds=contract.worker_lease_seconds,
                metadata={"objective_id": contract.objective_id, "task_id": task.task_id, "work_type": task.work_type},
            )
            task_state.attempt_count = int(task_state.attempt_count or 0) + 1
            actions_taken.append({"action": "assign_task_lease", "lease_id": lease.lease_id, "task_id": task.task_id, "agent_id": agent_id})
            if task_state.started_at is not None:
                recovery = True

        handoff = mailbox.send(
            process_id=contract.process_id,
            from_agent=controller_id,
            to_agent=agent_id,
            kind="handoff",
            revision_id=shared_state.revision_id,
            dedupe_key=f"roadmap_task:{contract.process_id}:{contract.objective_id}:{task.task_id}:{shared_state.revision_id}",
            payload={
                "objective": contract.objective,
                "task_id": task.task_id,
                "phase_id": task.phase_id,
                "title": task.title,
                "summary": task.summary,
                "work_type": task.work_type,
                "success_criteria": list(task.success_criteria or []),
            },
            metadata={"objective_id": contract.objective_id, "task_id": task.task_id, "phase_id": task.phase_id, "work_type": task.work_type},
        )
        actions_taken.append({"action": "dispatch_task_handoff", "message_id": handoff.message_id, "task_id": task.task_id, "agent_id": agent_id})
        accepted = mailbox.receive(
            to_agent=agent_id,
            process_id=contract.process_id,
            include_inflight=True,
            expected_revision_id=shared_state.revision_id,
            reject_stale_revision=True,
        )
        accepted_ids = {row.message_id for row in accepted}
        message_status = handoff.delivery_status
        if handoff.message_id in accepted_ids:
            acked = mailbox.acknowledge(handoff.message_id)
            message_status = acked.delivery_status
            actions_taken.append({"action": "ack_task_handoff", "message_id": acked.message_id, "task_id": task.task_id, "agent_id": agent_id})
        task_state.assigned_agent_id = agent_id
        task_state.lease_id = lease.lease_id
        task_state.last_handoff_message_id = handoff.message_id
        task_state.last_handoff_status = _message_status_key(message_status)
        _set_task_state(task_state, status="in_progress")
        active_task_ids.append(task.task_id)

    active_task_ids = _dedupe_rows(active_task_ids + [task.task_id for task in state.task_states if task.status == "in_progress" and task.phase_id == active_phase_id])
    return {"actions_taken": actions_taken, "recovery": recovery, "active_task_ids": active_task_ids}



def _evaluate_and_advance(
    contract: RoadmapObjectiveContract,
    *,
    state: RoadmapExecutionState,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    dependability_report: Optional[JsonDict],
    release_state: Optional[ReleaseWorkflowState],
) -> JsonDict:
    phase_state_map = _phase_status_map(state)
    task_state_map = _task_status_map(state)
    actions_taken: List[JsonDict] = []
    changed = True

    while changed:
        changed = False
        for phase in contract.phases:
            phase_state = phase_state_map[phase.phase_id]
            phase_ready = _phase_dependencies_satisfied(phase, phase_state_map)
            if not phase_ready and phase_state.status == "completed":
                _set_phase_state(phase_state, status="pending")
                actions_taken.append({"action": "reopen_phase", "phase_id": phase.phase_id, "reason": "dependency_regressed"})
                changed = True

            for task in _tasks_for_phase(contract, phase.phase_id):
                task_state = task_state_map[task.task_id]
                task_ready = phase_ready and _task_dependencies_satisfied(task, task_state_map)
                if not task_ready:
                    if task_state.status == "completed":
                        _set_task_state(task_state, status="pending")
                        actions_taken.append({"action": "reopen_task", "task_id": task.task_id, "reason": "dependency_regressed"})
                        changed = True
                    elif task_state.status != "blocked":
                        _set_task_state(task_state, status="pending", gate_results=task_state.gate_results)
                    continue

                task_eval = evaluate_roadmap_task(
                    task,
                    snapshot=snapshot,
                    shared_state=shared_state,
                    dependability_report=dependability_report,
                    release_state=release_state,
                    completed_task_ids={row.task_id for row in state.task_states if row.status == "completed"},
                    completed_phase_ids={row.phase_id for row in state.phase_states if row.status == "completed"},
                )
                task_state.gate_results = list(task_eval.get("criteria") or [])
                if task_eval.get("all_required_satisfied"):
                    if task_state.status != "completed":
                        _set_task_state(task_state, status="completed", gate_results=task_eval.get("criteria"))
                        actions_taken.append({"action": "complete_task", "task_id": task.task_id, "work_type": task.work_type})
                        changed = True
                elif task_state.status == "completed":
                    _set_task_state(task_state, status="pending", gate_results=task_eval.get("criteria"))
                    actions_taken.append({"action": "reopen_task", "task_id": task.task_id, "reason": "quality_regressed"})
                    changed = True
                elif task_state.status not in {"blocked", "in_progress"}:
                    _set_task_state(task_state, status="pending", gate_results=task_eval.get("criteria"))

            phase_eval = evaluate_roadmap_phase(
                contract,
                phase,
                task_state_map=task_state_map,
                snapshot=snapshot,
                shared_state=shared_state,
                dependability_report=dependability_report,
                release_state=release_state,
                completed_phase_ids={row.phase_id for row in state.phase_states if row.status == "completed"},
            )
            if phase_eval.get("all_required_satisfied"):
                if phase_state.status != "completed":
                    _set_phase_state(phase_state, status="completed", gate_results=phase_eval.get("gate_results"))
                    actions_taken.append({"action": "complete_phase", "phase_id": phase.phase_id})
                    changed = True
            elif phase_state.status == "completed":
                _set_phase_state(phase_state, status="pending", gate_results=phase_eval.get("gate_results"))
                actions_taken.append({"action": "reopen_phase", "phase_id": phase.phase_id, "reason": "quality_regressed"})
                changed = True
            elif phase_state.status != "blocked":
                _set_phase_state(phase_state, status="pending", gate_results=phase_eval.get("gate_results"))

    active_phase_id = _select_active_phase(contract, phase_state_map)
    for phase in contract.phases:
        phase_state = phase_state_map[phase.phase_id]
        if phase_state.status == "completed":
            continue
        if phase.phase_id == active_phase_id:
            _set_phase_state(phase_state, status="active", gate_results=phase_state.gate_results)
        elif phase_state.status != "blocked":
            _set_phase_state(phase_state, status="pending", gate_results=phase_state.gate_results)

    return {"actions_taken": actions_taken, "active_phase_id": active_phase_id}



def reconcile_roadmap_execution(
    contract: RoadmapObjectiveContract,
    *,
    roadmap_store: RoadmapExecutionStore,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    release_store: Optional[ReleaseWorkflowStore],
    controller_id: str,
    controller_session_id: str,
    journal: Any = None,
    now: Optional[datetime] = None,
) -> JsonDict:
    roadmap_store.save_contract(contract)
    previous_state = roadmap_store.load_state(contract.process_id)
    state = _merge_state(contract, previous_state)

    ownership = _claim_controller(
        contract,
        previous_state=previous_state,
        supervisor=supervisor,
        controller_id=controller_id,
        controller_session_id=controller_session_id,
        now=now,
    )
    controller = ownership["owner"]
    ownership_actions = list(ownership.get("actions") or [])

    snapshot = snapshot_store.load(contract.process_id)
    shared_state = shared_state_store.load(contract.process_id)
    if snapshot is None or shared_state is None:
        raise ValueError("snapshot and shared state are required for roadmap execution")

    dependability = repair_production_dependability(
        contract,
        snapshot_store=snapshot_store,
        shared_state_store=shared_state_store,
        journal=journal,
        mailbox=mailbox,
        supervisor=supervisor,
        controller_id=controller_id,
        now=now,
    ) if journal is not None else {"before": None, "after": None, "actions_taken": [], "success": True}
    snapshot = snapshot_store.load(contract.process_id) or snapshot
    shared_state = shared_state_store.load(contract.process_id) or shared_state
    release_state = release_store.load(contract.process_id) if release_store is not None else None

    progress = _evaluate_and_advance(
        contract,
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        dependability_report=dependability.get("after") or dependability.get("before") or {},
        release_state=release_state,
    )
    state.active_phase_id = progress.get("active_phase_id")

    dispatch = _dispatch_ready_tasks(
        contract,
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        mailbox=mailbox,
        supervisor=supervisor,
        controller_id=controller_id,
        active_phase_id=state.active_phase_id,
        now=now,
    )
    state.active_task_ids = list(dispatch.get("active_task_ids") or [])

    blockers = detect_roadmap_true_blockers(
        contract,
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        release_state=release_state,
    )
    completion = evaluate_roadmap_completion(
        contract,
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        dependability_report=dependability.get("after") or dependability.get("before") or {},
        release_state=release_state,
    )
    completed = bool(completion.get("all_required_satisfied")) and not blockers
    status = "completed" if completed else ("blocked" if blockers else "active")

    next_iteration = int(state.iteration_count or 0) + 1
    all_actions = ownership_actions + list(dependability.get("actions_taken") or []) + list(progress.get("actions_taken") or []) + list(dispatch.get("actions_taken") or [])

    previous_phase = previous_state.active_phase_id if previous_state is not None else None
    previous_tasks = set(previous_state.active_task_ids) if previous_state is not None else set()
    current_tasks = set(state.active_task_ids)
    previous_blocker_keys = {_report_blocker_key(row) for row in (previous_state.true_blockers or [])} if previous_state is not None else set()
    current_blocker_keys = {_report_blocker_key(row) for row in blockers}
    task_changes = [row for row in all_actions if row.get("action") in {"complete_task", "reopen_task", "dispatch_task_handoff", "ack_task_handoff", "assign_task_lease", "reassign_task_lease"}]

    report_reasons: List[str] = []
    policy = contract.reporting_policy
    if previous_state is None:
        report_reasons.append("initial")
    if next_iteration % int(policy.report_every_iterations or 1) == 0:
        report_reasons.append("iteration_interval")
    if policy.report_on_phase_change and previous_phase != state.active_phase_id:
        report_reasons.append("phase_change")
    if policy.report_on_task_change and previous_tasks != current_tasks:
        report_reasons.append("task_change")
    if policy.report_on_recovery and (ownership.get("recovery") or dispatch.get("recovery")):
        report_reasons.append("recovery")
    if policy.report_on_worker_dispatch and any(row.get("action") == "dispatch_task_handoff" for row in all_actions):
        report_reasons.append("worker_dispatch")
    if policy.report_on_blocker_change and previous_blocker_keys != current_blocker_keys:
        report_reasons.append("blocker_change")
    if policy.report_on_status_change and previous_state is not None and previous_state.status != status:
        report_reasons.append("status_change")
    if completed:
        report_reasons.append("completed")
    if status == "blocked":
        report_reasons.append("blocked")

    report_kind = "completed" if completed else ("blocked" if status == "blocked" else ("recovery" if "recovery" in report_reasons else "checkpoint"))
    summary = (
        f"roadmap objective completed for {contract.process_id}"
        if completed
        else f"roadmap objective blocked for {contract.process_id}: {len(blockers)} true blockers"
        if status == "blocked"
        else f"roadmap objective active for {contract.process_id}: phase={state.active_phase_id or 'n/a'}, tasks={','.join(state.active_task_ids) or 'n/a'}"
    )

    report_record: Optional[RoadmapExecutionReport] = None
    if report_reasons:
        report_record = roadmap_store.append_report(
            RoadmapExecutionReport(
                execution_id=state.execution_id,
                objective_id=contract.objective_id,
                process_id=contract.process_id,
                iteration=next_iteration,
                kind=report_kind,
                status=status,
                summary=summary,
                controller_id=controller.controller_id,
                controller_session_id=controller.session_id,
                active_phase_id=state.active_phase_id,
                active_task_ids=list(state.active_task_ids),
                actions_taken=all_actions,
                blockers=blockers,
                completion=completion,
                metadata={
                    "reasons": _dedupe_rows(report_reasons),
                    "dependability_success": bool((dependability.get("after") or dependability.get("before") or {}).get("success")) if dependability.get("before") is not None or dependability.get("after") is not None else None,
                    "task_change_count": len(task_changes),
                },
            )
        )

    updated_state = RoadmapExecutionState(
        execution_id=state.execution_id,
        objective_id=contract.objective_id,
        process_id=contract.process_id,
        status=status,
        iteration_count=next_iteration,
        checkpoint_count=int(state.checkpoint_count or 0) + (1 if report_record is not None else 0),
        recovery_count=int(state.recovery_count or 0) + (1 if ownership.get("recovery") or dispatch.get("recovery") else 0),
        controller=controller,
        active_phase_id=state.active_phase_id,
        active_task_ids=list(state.active_task_ids),
        current_revision_id=shared_state.revision_id,
        current_snapshot_id=snapshot.snapshot_id,
        current_release_stage=release_state.current_stage if release_state is not None else None,
        latest_report_id=report_record.report_id if report_record is not None else state.latest_report_id,
        last_checkpoint_at=report_record.recorded_at if report_record is not None else state.last_checkpoint_at,
        true_blockers=blockers,
        completion=completion,
        phase_states=list(state.phase_states),
        task_states=list(state.task_states),
        metadata={
            **dict(state.metadata or {}),
            "objective": contract.objective,
            "last_actions": all_actions,
            "last_report_reasons": _dedupe_rows(report_reasons),
            "last_dependability_success": bool((dependability.get("after") or dependability.get("before") or {}).get("success")) if dependability.get("before") is not None or dependability.get("after") is not None else None,
        },
    )
    roadmap_store.save_state(updated_state)

    if status in {"blocked", "completed"}:
        supervisor.resolve(controller.lease_id, status="released", metadata={"resolution": status})

    return {
        "contract": _contract_dump(contract),
        "state": _state_dump(updated_state),
        "report": _report_dump(report_record) if report_record is not None else None,
        "dependability": dependability,
        "actions_taken": all_actions,
        "blockers": blockers,
        "completion": completion,
        "operator_summary": summary,
    }


__all__ = [
    "RoadmapBlockerRule",
    "RoadmapControllerOwner",
    "RoadmapExecutionReport",
    "RoadmapExecutionState",
    "RoadmapExecutionStore",
    "RoadmapObjectiveContract",
    "RoadmapPhaseDefinition",
    "RoadmapPhaseState",
    "RoadmapReportingPolicy",
    "RoadmapSuccessCriterion",
    "RoadmapTaskDefinition",
    "RoadmapTaskState",
    "detect_roadmap_true_blockers",
    "evaluate_roadmap_completion",
    "evaluate_roadmap_phase",
    "evaluate_roadmap_task",
    "reconcile_roadmap_execution",
    "ValidationError",
]
