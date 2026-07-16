from __future__ import annotations

import json
import fcntl
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.agent_mailbox import AgentMailbox
from cortex_server.runtime.agent_supervisor import AgentLease, AgentSupervisor
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore
from cortex_server.runtime.dependability import load_dependability_report
from cortex_server.runtime.production_build_loop import _atomic_write_json, repair_production_dependability
from cortex_server.runtime.durable_files import durable_mkdir
from cortex_server.runtime.runtime_delivery_quota import (
    MAX_HISTORY_BYTES,
    MAX_HISTORY_RECORDS,
    MAX_REPORT_BYTES,
    MAX_REPORT_RECORDS,
    append_bounded_jsonl,
    assert_process_count,
    assert_runtime_delivery_capacity,
    bounded_jsonl_payload,
    encoded_json,
    read_recoverable_jsonl,
    runtime_delivery_quota_transaction,
)
from cortex_server.runtime.release_workflow import ReleaseWorkflowState, ReleaseWorkflowStore
from cortex_server.runtime.shared_process_state import OpenDecision, SharedProcessState, SharedProcessStateStore


JsonDict = Dict[str, Any]
BUILTIN_BLOCKER_PREFIXES = ("BLOCKER:", "HUMAN:")


def _now(now: Optional[datetime] = None) -> datetime:
    return now or datetime.now(timezone.utc)



def _now_iso(now: Optional[datetime] = None) -> str:
    return _now(now).isoformat(timespec="milliseconds").replace("+00:00", "Z")



def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None



def _iso_after_seconds(seconds: int | float, *, now: Optional[datetime] = None) -> str:
    return _now_iso(_now(now) + timedelta(seconds=max(0.0, float(seconds or 0.0))))



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


def _int_budget(value: Any, *, default: int = 0) -> int:
    try:
        return max(0, int(value or 0))
    except Exception:
        return default


def _policy_dump(model: Any) -> Dict[str, Any]:
    if model is None:
        return {}
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def _blocker_requires_human(blocker: Optional[Dict[str, Any]]) -> bool:
    return bool((blocker or {}).get("requires_human"))


def _has_human_blockers(blockers: Sequence[Dict[str, Any]]) -> bool:
    return any(_blocker_requires_human(row) for row in blockers)


def _conversation_metadata(metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    source = dict(metadata or {})
    owner = str(source.get("conversation_owner") or source.get("owner") or "").strip() or None
    session_key = str(source.get("conversation_session_key") or source.get("session_key") or "").strip() or None
    channel = str(source.get("conversation_channel") or source.get("channel") or "").strip() or None
    conversation_id = str(source.get("conversation_id") or source.get("thread_id") or source.get("chat_id") or "").strip() or None
    return {
        "owner": owner,
        "session_key": session_key,
        "channel": channel,
        "conversation_id": conversation_id,
    }


def _roadmap_conversation_ownership(
    *,
    contract: "RoadmapObjectiveContract",
    previous_state: Optional["RoadmapExecutionState"],
    review_plan: Dict[str, Any],
    report_record: Optional["RoadmapExecutionReport"],
    now_iso: str,
) -> Dict[str, Any]:
    previous = dict(previous_state.conversation_ownership or {}) if previous_state is not None else {}
    conversation = {
        **previous,
        **_conversation_metadata(contract.metadata),
    }
    owed_follow_up = dict(review_plan.get("owed_follow_up") or {})
    conversation.update(
        {
            "owned": bool(conversation.get("owner") or conversation.get("session_key") or conversation.get("conversation_id")),
            "owes_follow_up": bool(owed_follow_up.get("owed")),
            "follow_up_kind": owed_follow_up.get("kind"),
            "follow_up_reason": owed_follow_up.get("reason"),
            "next_follow_up_at": owed_follow_up.get("due_at"),
            "last_user_visible_update_at": report_record.recorded_at if report_record is not None else previous.get("last_user_visible_update_at"),
            "updated_at": now_iso,
        }
    )
    return conversation


def _roadmap_follow_through(
    *,
    previous_state: Optional["RoadmapExecutionState"],
    status: str,
    next_action: Dict[str, Any],
    continuation: Dict[str, Any],
    review_plan: Dict[str, Any],
    report_reasons: Sequence[str],
    report_record: Optional["RoadmapExecutionReport"],
    watchdog_context: Optional[Dict[str, Any]],
    now_iso: str,
) -> Dict[str, Any]:
    previous = dict(previous_state.follow_through or {}) if previous_state is not None else {}
    owed_follow_up = dict(review_plan.get("owed_follow_up") or {})
    last_user_visible_update_intent = dict(previous.get("last_user_visible_update_intent") or {})
    if report_record is not None:
        last_user_visible_update_intent = {
            "kind": report_record.kind,
            "status": report_record.status,
            "summary": report_record.summary,
            "reasons": list((report_record.metadata or {}).get("reasons") or []),
            "recorded_at": report_record.recorded_at,
        }

    pending_update_intent = dict(previous.get("pending_update_intent") or {})
    if owed_follow_up.get("owed"):
        pending_update_intent = {
            "kind": owed_follow_up.get("kind") or "status",
            "reason": owed_follow_up.get("reason") or continuation.get("reason") or next_action.get("kind") or status,
            "due_at": owed_follow_up.get("due_at"),
            "status": status,
            "watchdog_decision": (watchdog_context or {}).get("decision"),
        }
    elif report_record is not None or status == "completed":
        pending_update_intent = {}

    return {
        **previous,
        "live_objective": status != "completed",
        "continuation": dict(continuation or {}),
        "next_action": dict(next_action or {}),
        "last_user_visible_update_intent": last_user_visible_update_intent,
        "pending_update_intent": pending_update_intent,
        "last_user_visible_update_at": report_record.recorded_at if report_record is not None else previous.get("last_user_visible_update_at"),
        "next_required_update_at": owed_follow_up.get("due_at"),
        "next_required_review_at": review_plan.get("next_review_at"),
        "review_due": bool(review_plan.get("review_due")),
        "report_due": bool(review_plan.get("report_due")),
        "resume_on_next_tick": bool(status != "completed" and continuation.get("mode") in {"continue_now", "await_external_progress"}),
        "report_reasons": _dedupe_rows(list(report_reasons or [])),
        "watchdog": dict(watchdog_context or {}),
        "updated_at": now_iso,
    }


HUMAN_BLOCKER_HINTS: Dict[str, str] = {
    "approve": "ambiguity",
    "approval": "ambiguity",
    "decision": "ambiguity",
    "choose": "ambiguity",
    "clarify": "ambiguity",
    "confirm": "ambiguity",
    "unclear": "ambiguity",
    "ambigu": "ambiguity",
    "access": "access",
    "credential": "access",
    "secret": "access",
    "token": "access",
    "permission": "access",
    "auth": "access",
    "login": "access",
    "safety": "safety",
    "unsafe": "safety",
    "risk": "safety",
    "legal": "safety",
    "policy": "safety",
    "compliance": "safety",
}
HUMAN_BLOCKER_CLASSES = {"ambiguity", "access", "safety", "release_hold", "human_decision"}


def _classify_blocker_need(*, source: str, summary: str, requires_human: bool, metadata: Optional[Dict[str, Any]] = None) -> Tuple[bool, Optional[str]]:
    text = str(summary or "").strip().lower()
    source_key = str(source or "").strip().lower()
    meta = dict(metadata or {})
    category = str(
        meta.get("blocker_class")
        or meta.get("classification")
        or meta.get("category")
        or meta.get("kind")
        or ""
    ).strip().lower()
    if source_key == "release_hold":
        return True, "release_hold"
    if source_key == "open_decision":
        return True, category or "human_decision"
    if category in HUMAN_BLOCKER_CLASSES:
        return True, category
    for hint, blocker_class in HUMAN_BLOCKER_HINTS.items():
        if hint in text:
            return True, blocker_class
    return bool(requires_human), (category or "human_decision") if requires_human else None


def _question_requires_human(question: str) -> Tuple[bool, Optional[str]]:
    text = str(question or "").strip()
    upper = text.upper()
    if upper.startswith("HUMAN:"):
        return True, "human_decision"
    if not upper.startswith("BLOCKER:"):
        return False, None
    trimmed = text.split(":", 1)[1] if ":" in text else text
    return _classify_blocker_need(source="open_question", summary=trimmed, requires_human=False)


def _true_blocker_payload(
    payload: Dict[str, Any],
    *,
    source: Optional[str] = None,
    summary: Optional[str] = None,
    default_requires_human: bool = False,
) -> Optional[JsonDict]:
    blocker = dict(payload or {})
    blocker_source = str(source or blocker.get("source") or "task_blocker").strip() or "task_blocker"
    blocker_summary = str(summary or blocker.get("summary") or "").strip()
    if not blocker_summary:
        return None
    requires_human, blocker_class = _classify_blocker_need(
        source=blocker_source,
        summary=blocker_summary,
        requires_human=bool(blocker.get("requires_human", default_requires_human)),
        metadata=blocker.get("metadata") if isinstance(blocker.get("metadata"), dict) else None,
    )
    if not requires_human:
        return None
    blocker["source"] = blocker_source
    blocker["summary"] = blocker_summary
    blocker["requires_human"] = True
    blocker["terminal"] = bool(blocker.get("terminal", True))
    blocker["blocker_class"] = blocker_class or blocker.get("blocker_class") or "human_decision"
    return blocker


def _active_task_ids_for_phase(contract: "RoadmapObjectiveContract", state: "RoadmapExecutionState", phase_id: Optional[str]) -> List[str]:
    if not phase_id:
        return []
    return [
        row.task_id
        for row in state.task_states
        if row.phase_id == phase_id and row.status in {"pending", "in_progress", "blocked"}
    ]


def _ready_task_ids_for_phase(contract: "RoadmapObjectiveContract", state: "RoadmapExecutionState", phase_id: Optional[str]) -> List[str]:
    if not phase_id:
        return []
    task_state_map = _task_status_map(state)
    ready: List[str] = []
    for task in _tasks_for_phase(contract, phase_id):
        task_state = task_state_map.get(task.task_id)
        if task_state is None or task_state.status in {"completed", "in_progress", "blocked"}:
            continue
        if _task_dependencies_satisfied(task, task_state_map):
            ready.append(task.task_id)
    return ready


def _roadmap_validation_decision(
    contract: "RoadmapObjectiveContract",
    *,
    budget: "RoadmapPassBudget",
    previous_state: Optional["RoadmapExecutionState"],
    state: "RoadmapExecutionState",
    task_completion_count: int,
    phase_transition_count: int,
    release_stage_changed: bool,
) -> Dict[str, Any]:
    reasons: List[str] = []
    scope = "focused"
    if budget.validation_mode == "broad":
        scope = "broad"
        reasons.append("forced_broad_mode")
    elif budget.broaden_validation_on_completion_candidate and state.active_phase_id is None:
        scope = "broad"
        reasons.append("completion_checkpoint")
    elif budget.broaden_validation_on_phase_change and phase_transition_count > 0:
        scope = "broad"
        reasons.append("phase_promotion_checkpoint")
    elif budget.broaden_validation_on_release_change and release_stage_changed:
        scope = "broad"
        reasons.append("release_promotion_checkpoint")
    elif task_completion_count > 0 and state.active_phase_id is None:
        scope = "broad"
        reasons.append("final_task_completion_checkpoint")
    else:
        reasons.append("bounded_pass_focused_validation")
    if previous_state is not None and previous_state.status in {"blocked", "completed"}:
        reasons.append(f"previous_status={previous_state.status}")
    return {
        "scope": scope,
        "reasons": _dedupe_rows(reasons),
        "promotion_checkpoint": scope == "broad",
        "task_completion_count": task_completion_count,
        "phase_transition_count": phase_transition_count,
        "release_stage_changed": bool(release_stage_changed),
        "default_scope": budget.validation_mode,
    }


def _roadmap_validation_scope(
    contract: "RoadmapObjectiveContract",
    *,
    budget: "RoadmapPassBudget",
    previous_state: Optional["RoadmapExecutionState"],
    state: "RoadmapExecutionState",
    blockers: Sequence[Dict[str, Any]],
    task_completion_count: int,
    phase_transition_count: int,
    release_stage_changed: bool,
) -> str:
    del blockers
    return str(
        _roadmap_validation_decision(
            contract,
            budget=budget,
            previous_state=previous_state,
            state=state,
            task_completion_count=task_completion_count,
            phase_transition_count=phase_transition_count,
            release_stage_changed=release_stage_changed,
        ).get("scope")
        or "focused"
    )


def _roadmap_immediately_completable_task_ids(
    contract: "RoadmapObjectiveContract",
    *,
    state: "RoadmapExecutionState",
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    dependability_report: Optional[JsonDict],
    release_state: Optional[ReleaseWorkflowState],
) -> List[str]:
    phase_state_map = _phase_status_map(state)
    task_state_map = _task_status_map(state)
    completed_task_ids = {row.task_id for row in state.task_states if row.status == "completed"}
    completed_phase_ids = {row.phase_id for row in state.phase_states if row.status == "completed"}
    immediate: List[str] = []
    for phase in contract.phases:
        if not _phase_dependencies_satisfied(phase, phase_state_map):
            continue
        for task in _tasks_for_phase(contract, phase.phase_id):
            task_state = task_state_map.get(task.task_id)
            if task_state is None or task_state.status == "completed":
                continue
            if not _task_dependencies_satisfied(task, task_state_map):
                continue
            task_eval = evaluate_roadmap_task(
                task,
                snapshot=snapshot,
                shared_state=shared_state,
                dependability_report=dependability_report,
                release_state=release_state,
                completed_task_ids=completed_task_ids,
                completed_phase_ids=completed_phase_ids,
            )
            if task_eval.get("all_required_satisfied"):
                immediate.append(task.task_id)
    return _dedupe_rows(immediate)



def _roadmap_next_action(
    contract: "RoadmapObjectiveContract",
    *,
    state: "RoadmapExecutionState",
    blockers: Sequence[Dict[str, Any]],
    completion: Dict[str, Any],
    budget: "RoadmapPassBudget",
    pass_index: int,
    budget_exhausted: bool,
    immediate_completable_task_ids: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    if bool(completion.get("all_required_satisfied")) and not blockers:
        return {
            "kind": "completed",
            "status": "completed",
            "summary": f"Roadmap objective complete for {contract.process_id}",
            "objective": contract.objective,
            "pass_index": pass_index,
            "budget": budget.model_dump() if hasattr(budget, "model_dump") else budget.dict(),
        }
    if blockers:
        if _has_human_blockers(blockers):
            return {
                "kind": "needs_human_decision",
                "status": "blocked",
                "summary": str(blockers[0].get("summary") or "Human decision required"),
                "blockers": [dict(row) for row in blockers],
                "pass_index": pass_index,
                "budget": budget.model_dump() if hasattr(budget, "model_dump") else budget.dict(),
            }
        return {
            "kind": "await_non_human_recovery",
            "status": "active",
            "summary": str(blockers[0].get("summary") or "Roadmap awaiting non-human recovery"),
            "blockers": [dict(row) for row in blockers],
            "pass_index": pass_index,
            "budget": budget.model_dump() if hasattr(budget, "model_dump") else budget.dict(),
        }

    ready_task_ids = _ready_task_ids_for_phase(contract, state, state.active_phase_id)
    in_progress_task_ids = [row.task_id for row in state.task_states if row.phase_id == state.active_phase_id and row.status == "in_progress"]
    active_task_ids = _active_task_ids_for_phase(contract, state, state.active_phase_id)
    immediate_task_ids = [str(task_id) for task_id in (immediate_completable_task_ids or []) if str(task_id).strip()]
    if immediate_task_ids:
        return {
            "kind": "complete_task",
            "status": "active",
            "phase_id": state.active_phase_id,
            "task_ids": immediate_task_ids,
            "summary": f"Continue immediately to record completed roadmap tasks: {', '.join(immediate_task_ids)}",
            "pass_index": pass_index,
            "budget_exhausted": bool(budget_exhausted),
            "budget": budget.model_dump() if hasattr(budget, "model_dump") else budget.dict(),
        }
    if ready_task_ids:
        return {
            "kind": "dispatch_task",
            "status": "active",
            "phase_id": state.active_phase_id,
            "task_ids": list(ready_task_ids),
            "summary": f"Dispatch ready roadmap tasks for phase {state.active_phase_id}",
            "pass_index": pass_index,
            "budget_exhausted": bool(budget_exhausted),
            "budget": budget.model_dump() if hasattr(budget, "model_dump") else budget.dict(),
        }
    if in_progress_task_ids:
        return {
            "kind": "await_worker_progress",
            "status": "active",
            "phase_id": state.active_phase_id,
            "task_ids": list(in_progress_task_ids),
            "summary": f"Await worker progress for {', '.join(in_progress_task_ids)}",
            "pass_index": pass_index,
            "budget": budget.model_dump() if hasattr(budget, "model_dump") else budget.dict(),
        }
    if active_task_ids:
        return {
            "kind": "await_task_dependencies",
            "status": "active",
            "phase_id": state.active_phase_id,
            "task_ids": list(active_task_ids),
            "summary": f"Await roadmap dependency unlocks in phase {state.active_phase_id}",
            "pass_index": pass_index,
            "budget": budget.model_dump() if hasattr(budget, "model_dump") else budget.dict(),
        }
    if state.active_phase_id:
        return {
            "kind": "evaluate_phase",
            "status": "active",
            "phase_id": state.active_phase_id,
            "summary": f"Continue roadmap evaluation for phase {state.active_phase_id}",
            "pass_index": pass_index,
            "budget_exhausted": bool(budget_exhausted),
            "budget": budget.model_dump() if hasattr(budget, "model_dump") else budget.dict(),
        }
    return {
        "kind": "evaluate_completion",
        "status": "active",
        "summary": f"Run completion sweep for roadmap {contract.process_id}",
        "pass_index": pass_index,
        "budget_exhausted": bool(budget_exhausted),
        "budget": budget.model_dump() if hasattr(budget, "model_dump") else budget.dict(),
    }


def _roadmap_continuation(
    *,
    status: str,
    blockers: Sequence[Dict[str, Any]],
    next_action: Dict[str, Any],
) -> Dict[str, Any]:
    if status == "completed":
        return {"mode": "stop", "terminal": True, "reason": "completed", "status": status}
    if blockers:
        if _has_human_blockers(blockers):
            return {"mode": "stop", "terminal": True, "reason": "needs_human_decision", "status": status}
        return {"mode": "await_external_progress", "terminal": False, "reason": "non_human_blocker", "status": status}
    next_kind = str(next_action.get("kind") or "").strip()
    if next_kind in {"dispatch_task", "complete_task", "evaluate_phase", "evaluate_completion"}:
        return {"mode": "continue_now", "terminal": False, "reason": next_kind, "status": status}
    return {"mode": "await_external_progress", "terminal": False, "reason": next_kind or "await_external_progress", "status": status}


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
    live_review_seconds: int = 300
    abnormal_idle_grace_seconds: int = 180
    proactive_report_seconds: int = 900
    blocker_followup_seconds: int = 300

    @field_validator(
        "report_every_iterations",
        "live_review_seconds",
        "abnormal_idle_grace_seconds",
        "proactive_report_seconds",
        "blocker_followup_seconds",
    )
    @classmethod
    def _validate_positive(cls, value: int) -> int:
        number = int(value or 0)
        if number <= 0:
            raise ValueError("reporting policy values must be positive")
        return number


class RoadmapPassBudget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_auto_chain_passes: int = 4
    max_task_completions_per_pass: int = 1
    max_phase_transitions_per_pass: int = 1
    max_task_dispatches_per_pass: int = 1
    validation_mode: str = "focused"
    broaden_validation_on_phase_change: bool = True
    broaden_validation_on_release_change: bool = True
    broaden_validation_on_completion_candidate: bool = True

    @field_validator(
        "max_auto_chain_passes",
        "max_task_completions_per_pass",
        "max_phase_transitions_per_pass",
        "max_task_dispatches_per_pass",
    )
    @classmethod
    def _validate_positive_budget(cls, value: int) -> int:
        number = int(value or 0)
        if number <= 0:
            raise ValueError("budget values must be positive")
        if number > 32:
            raise ValueError("budget values must not exceed the immutable limit of 32")
        return number

    @field_validator("validation_mode")
    @classmethod
    def _validate_validation_mode(cls, value: str) -> str:
        text = str(value or "").strip().lower()
        if text not in {"focused", "broad"}:
            raise ValueError("validation_mode must be 'focused' or 'broad'")
        return text


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
    execution_budget: RoadmapPassBudget = Field(default_factory=RoadmapPassBudget)
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
    liveness: str = "live"
    terminal_state: Optional[str] = None
    iteration_count: int = 0
    checkpoint_count: int = 0
    recovery_count: int = 0
    persistence_revision: int = 0
    controller: Optional[RoadmapControllerOwner] = None
    active_phase_id: Optional[str] = None
    active_task_ids: List[str] = Field(default_factory=list)
    current_revision_id: Optional[str] = None
    current_snapshot_id: Optional[str] = None
    current_release_stage: Optional[str] = None
    latest_report_id: Optional[str] = None
    last_checkpoint_at: Optional[str] = None
    last_progress_at: Optional[str] = None
    last_report_at: Optional[str] = None
    next_review_at: Optional[str] = None
    last_watchdog_at: Optional[str] = None
    true_blockers: List[Dict[str, Any]] = Field(default_factory=list)
    completion: Dict[str, Any] = Field(default_factory=dict)
    next_action: Dict[str, Any] = Field(default_factory=dict)
    continuation: Dict[str, Any] = Field(default_factory=dict)
    last_pass: Dict[str, Any] = Field(default_factory=dict)
    last_progress: Dict[str, Any] = Field(default_factory=dict)
    last_report: Dict[str, Any] = Field(default_factory=dict)
    owed_follow_up: Dict[str, Any] = Field(default_factory=dict)
    reporting_cadence: Dict[str, Any] = Field(default_factory=dict)
    last_watchdog_decision: Dict[str, Any] = Field(default_factory=dict)
    conversation_ownership: Dict[str, Any] = Field(default_factory=dict)
    follow_through: Dict[str, Any] = Field(default_factory=dict)
    phase_states: List[RoadmapPhaseState] = Field(default_factory=list)
    task_states: List[RoadmapTaskState] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("execution_id", "objective_id", "process_id", "status", "liveness")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("iteration_count", "checkpoint_count", "recovery_count", "persistence_revision")
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

    def _lock_target(self, process_id: str) -> Path:
        return self._root() / "locks" / f"{process_id}.lock"

    @contextmanager
    def _locked(self, process_id: str, *, exclusive: bool):
        target = self._lock_target(process_id)
        durable_mkdir(target.parent)
        with target.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def save_contract(self, contract: RoadmapObjectiveContract | Dict[str, Any]) -> RoadmapObjectiveContract:
        record = _contract_validate(contract if isinstance(contract, dict) else _contract_dump(contract))
        with self._locked(record.process_id, exclusive=True):
            target = self._contract_target(record.process_id)
            current = None
            if target.exists():
                current = _contract_validate(json.loads(target.read_text(encoding="utf-8")))
            if current is not None and current.objective_id != record.objective_id:
                raise RuntimeError("roadmap objective contract identity conflict")
            payload = _contract_dump(record)
            encoded = encoded_json(payload, pretty=True)
            with runtime_delivery_quota_transaction(self._root().parent):
                assert_process_count(
                    self._root(),
                    record.process_id,
                    delivery_root=self._root().parent,
                )
                assert_runtime_delivery_capacity(
                    delivery_root=self._root().parent,
                    store_root=self._root(),
                    process_id=record.process_id,
                    object_bytes=len(encoded),
                    additional_bytes=len(encoded),
                    replacing=target,
                )
                _atomic_write_json(target, payload)
        return record

    def load_contract(self, process_id: str) -> Optional[RoadmapObjectiveContract]:
        with self._locked(process_id, exclusive=False):
            target = self._contract_target(process_id)
            if not target.exists():
                return None
            return _contract_validate(json.loads(target.read_text(encoding="utf-8")))

    def save_state(self, state: RoadmapExecutionState | Dict[str, Any]) -> RoadmapExecutionState:
        record = _state_validate(state if isinstance(state, dict) else _state_dump(state))
        with self._locked(record.process_id, exclusive=True):
            target = self._state_target(record.process_id)
            current = self._load_state_unlocked(record.process_id)
            if current is None:
                if record.persistence_revision != 0:
                    raise RuntimeError("roadmap execution persistence revision conflict")
                next_revision = 1
            else:
                if current.execution_id != record.execution_id or current.objective_id != record.objective_id:
                    raise RuntimeError("roadmap execution identity conflict")
                if record.persistence_revision != current.persistence_revision:
                    raise RuntimeError("roadmap execution persistence revision conflict")
                next_revision = current.persistence_revision + 1
            record = _state_validate({**_state_dump(record), "persistence_revision": next_revision})
            payload = _state_dump(record)
            history_row = {
                "ts": _now_iso(),
                "execution_id": record.execution_id,
                "objective_id": record.objective_id,
                "process_id": record.process_id,
                "persistence_revision": record.persistence_revision,
                "status": record.status,
                "iteration_count": record.iteration_count,
                "checkpoint_count": record.checkpoint_count,
                "recovery_count": record.recovery_count,
                "previous_status": current.status if current else None,
                "state": payload,
            }
            state_encoded = encoded_json(payload, pretty=True)
            history_encoded = encoded_json(history_row)
            history_target = self._history_target(record.process_id)
            with runtime_delivery_quota_transaction(self._root().parent):
                history_payload = bounded_jsonl_payload(
                    history_target,
                    history_row,
                    max_records=MAX_HISTORY_RECORDS,
                    max_bytes=MAX_HISTORY_BYTES,
                )
                assert_runtime_delivery_capacity(
                    delivery_root=self._root().parent,
                    store_root=self._root(),
                    process_id=record.process_id,
                    object_bytes=max(len(state_encoded), len(history_encoded)),
                    additional_bytes=len(state_encoded) + len(history_payload),
                    replacements=(
                        (target, len(state_encoded)),
                        (history_target, len(history_payload)),
                    ),
                )
                _atomic_write_json(target, payload)
                append_bounded_jsonl(
                    history_target,
                    history_row,
                    max_records=MAX_HISTORY_RECORDS,
                    max_bytes=MAX_HISTORY_BYTES,
                )
        return record

    def _load_state_unlocked(self, process_id: str) -> Optional[RoadmapExecutionState]:
        target = self._state_target(process_id)
        if target.exists():
            try:
                return _state_validate(json.loads(target.read_text(encoding="utf-8")))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValidationError, ValueError):
                pass
        for row in reversed(read_recoverable_jsonl(self._history_target(process_id))):
            state = row.get("state")
            if isinstance(state, dict):
                try:
                    return _state_validate(state)
                except (ValidationError, ValueError, TypeError):
                    continue
        return None

    def load_state(self, process_id: str) -> Optional[RoadmapExecutionState]:
        with self._locked(process_id, exclusive=False):
            return self._load_state_unlocked(process_id)

    def append_report(self, report: RoadmapExecutionReport | Dict[str, Any]) -> RoadmapExecutionReport:
        record = _report_validate(report if isinstance(report, dict) else _report_dump(report))
        with self._locked(record.process_id, exclusive=True):
            target = self._report_target(record.process_id)
            payload = _report_dump(record)
            encoded = encoded_json(payload)
            with runtime_delivery_quota_transaction(self._root().parent):
                report_payload = bounded_jsonl_payload(
                    target,
                    payload,
                    max_records=MAX_REPORT_RECORDS,
                    max_bytes=MAX_REPORT_BYTES,
                )
                assert_runtime_delivery_capacity(
                    delivery_root=self._root().parent,
                    store_root=self._root(),
                    process_id=record.process_id,
                    object_bytes=len(encoded),
                    additional_bytes=len(report_payload),
                    replacements=((target, len(report_payload)),),
                )
                append_bounded_jsonl(
                    target,
                    payload,
                    max_records=MAX_REPORT_RECORDS,
                    max_bytes=MAX_REPORT_BYTES,
                )
        return record

    def reports(self, process_id: str) -> List[RoadmapExecutionReport]:
        with self._locked(process_id, exclusive=False):
            return [
                _report_validate(row)
                for row in read_recoverable_jsonl(self._report_target(process_id))
            ]



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



def _roadmap_progress_snapshot(
    contract: "RoadmapObjectiveContract",
    *,
    state: "RoadmapExecutionState",
    blockers: Sequence[Dict[str, Any]],
    completion: Dict[str, Any],
    next_action: Optional[Dict[str, Any]] = None,
    continuation: Optional[Dict[str, Any]] = None,
    release_state: Optional[ReleaseWorkflowState] = None,
    actions_taken: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    task_counts: Dict[str, int] = {}
    for row in state.task_states:
        key = str(row.status or "pending")
        task_counts[key] = task_counts.get(key, 0) + 1

    phase_counts: Dict[str, int] = {}
    for row in state.phase_states:
        key = str(row.status or "pending")
        phase_counts[key] = phase_counts.get(key, 0) + 1

    completed_task_ids = [row.task_id for row in state.task_states if row.status == "completed"]
    blocked_task_ids = [row.task_id for row in state.task_states if row.status == "blocked"]
    in_progress_task_ids = [row.task_id for row in state.task_states if row.status == "in_progress"]
    completed_phase_ids = [row.phase_id for row in state.phase_states if row.status == "completed"]
    ready_task_ids = _ready_task_ids_for_phase(contract, state, state.active_phase_id)
    action_rows = [dict(row) for row in (actions_taken or []) if isinstance(row, dict)]

    return {
        "phase_total": len(contract.phases),
        "phase_completed": len(completed_phase_ids),
        "phase_status_counts": phase_counts,
        "completed_phase_ids": completed_phase_ids,
        "task_total": len(contract.tasks),
        "task_completed": len(completed_task_ids),
        "task_status_counts": task_counts,
        "completed_task_ids": completed_task_ids,
        "blocked_task_ids": blocked_task_ids,
        "in_progress_task_ids": in_progress_task_ids,
        "active_phase_id": state.active_phase_id,
        "active_task_ids": list(state.active_task_ids),
        "ready_task_ids": ready_task_ids,
        "next_task_ids": list((next_action or {}).get("task_ids") or []),
        "next_action_kind": (next_action or {}).get("kind"),
        "continuation_mode": (continuation or {}).get("mode"),
        "continuation_reason": (continuation or {}).get("reason"),
        "true_blocker_count": len(blockers),
        "human_blocker_count": sum(1 for row in blockers if bool(row.get("requires_human"))),
        "blocker_sources": _dedupe_rows([str(row.get("source") or "") for row in blockers]),
        "blocker_classes": _dedupe_rows([str(row.get("blocker_class") or "") for row in blockers]),
        "release_stage": release_state.current_stage if release_state is not None else state.current_release_stage,
        "completion_required_total": int(completion.get("required_total", 0) or 0),
        "completion_required_satisfied": int(completion.get("required_satisfied", 0) or 0),
        "completion_ready": bool(completion.get("all_required_satisfied")),
        "recent_action_types": _dedupe_rows([str(row.get("action") or "") for row in action_rows]),
        "recent_completed_task_ids": _dedupe_rows([str(row.get("task_id") or "") for row in action_rows if row.get("action") == "complete_task"]),
        "recent_completed_phase_ids": _dedupe_rows([str(row.get("phase_id") or "") for row in action_rows if row.get("action") == "complete_phase"]),
    }



def _roadmap_operator_summary(
    contract: "RoadmapObjectiveContract",
    *,
    state: "RoadmapExecutionState",
    status: str,
    blockers: Sequence[Dict[str, Any]],
    next_action: Dict[str, Any],
    validation_scope: str,
    progress: Dict[str, Any],
    chained_passes: Optional[int] = None,
    auto_chain_budget_exhausted: bool = False,
) -> str:
    phase_text = f"phases={progress.get('phase_completed', 0)}/{progress.get('phase_total', 0)}"
    task_text = f"tasks={progress.get('task_completed', 0)}/{progress.get('task_total', 0)}"
    active_tasks = ",".join(progress.get("active_task_ids") or []) or "n/a"
    next_kind = str(next_action.get("kind") or "n/a")
    if status == "completed":
        return f"roadmap objective completed for {contract.process_id}: {phase_text}, {task_text}, validation={validation_scope}"
    if status == "blocked":
        blocker_count = len(blockers)
        blocker_classes = ",".join(progress.get("blocker_classes") or []) or "true_blockers"
        return (
            f"roadmap objective blocked for {contract.process_id}: {phase_text}, {task_text}, "
            f"blockers={blocker_count}({blocker_classes}), next={next_kind}, validation={validation_scope}"
        )
    if auto_chain_budget_exhausted:
        passes_text = f", chained_passes={int(chained_passes or 0)}" if chained_passes is not None else ""
        return (
            f"roadmap objective active for {contract.process_id}: {phase_text}, {task_text}, "
            f"phase={state.active_phase_id or 'n/a'}, active={active_tasks}, next={next_kind}, "
            f"validation={validation_scope}{passes_text}, auto_pause=budget_exhausted"
        )
    return (
        f"roadmap objective active for {contract.process_id}: {phase_text}, {task_text}, "
        f"phase={state.active_phase_id or 'n/a'}, active={active_tasks}, next={next_kind}, validation={validation_scope}"
    )



def _roadmap_progress_record(
    *,
    contract: "RoadmapObjectiveContract",
    previous_state: Optional["RoadmapExecutionState"],
    state: "RoadmapExecutionState",
    status: str,
    actions_taken: Sequence[Dict[str, Any]],
    report_reasons: Sequence[str],
    blockers: Sequence[Dict[str, Any]],
    next_action: Dict[str, Any],
    now_iso: str,
) -> Tuple[Optional[str], Dict[str, Any]]:
    progress_actions = {
        "complete_task",
        "complete_phase",
        "dispatch_task_handoff",
        "assign_task_lease",
        "reassign_task_lease",
        "release_stale_task_lease",
        "requeue_task",
    }
    reasons: List[str] = []
    if previous_state is None:
        reasons.append("objective_started")
    if any(str((row or {}).get("action") or "") in progress_actions for row in actions_taken if isinstance(row, dict)):
        reasons.append("actions")
    if previous_state is not None and previous_state.active_phase_id != state.active_phase_id:
        reasons.append("phase_change")
    if previous_state is not None and previous_state.status != status:
        reasons.append("status_change")
    if any(reason in {"recovery", "completed", "blocked", "human_blocker", "non_human_blocker", "worker_dispatch", "task_change", "phase_change", "status_change", "idle_recovery"} for reason in report_reasons):
        reasons.append("reportable_change")
    if not reasons:
        return previous_state.last_progress_at if previous_state is not None else None, dict(previous_state.last_progress or {}) if previous_state is not None else {}
    return now_iso, {
        "recorded_at": now_iso,
        "objective_id": contract.objective_id,
        "status": status,
        "reasons": _dedupe_rows(reasons),
        "summary": str(next_action.get("summary") or contract.objective),
        "active_phase_id": state.active_phase_id,
        "active_task_ids": list(state.active_task_ids),
        "blocker_count": len(blockers),
        "action_types": _dedupe_rows([str((row or {}).get("action") or "") for row in actions_taken if isinstance(row, dict)]),
    }



def _roadmap_review_plan(
    *,
    policy: RoadmapReportingPolicy,
    previous_state: Optional["RoadmapExecutionState"],
    status: str,
    blockers: Sequence[Dict[str, Any]],
    next_action: Dict[str, Any],
    continuation: Dict[str, Any],
    now: Optional[datetime],
    report_reasons: Sequence[str],
    watchdog_context: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    current_time = _now(now)
    now_iso = _now_iso(current_time)
    previous_next_review = _parse_dt(previous_state.next_review_at if previous_state is not None else None)
    previous_last_report = _parse_dt(previous_state.last_report_at if previous_state is not None else None)
    review_due = previous_next_review is not None and previous_next_review <= current_time
    next_kind = str(next_action.get("kind") or "")
    if status == "completed":
        return {
            "liveness": "terminal",
            "terminal_state": "completed",
            "next_review_at": None,
            "report_due": False,
            "review_due": review_due,
            "owed_follow_up": {"owed": False, "status": status, "reason": "completed", "due_at": None, "updated_at": now_iso},
            "reporting_cadence": {"classification": "terminal", "report_interval_seconds": 0, "review_interval_seconds": 0, "updated_at": now_iso},
        }
    human_blockers = _has_human_blockers(blockers)
    classification = "waiting_human" if human_blockers else "waiting_recovery" if blockers else "continue_now" if continuation.get("mode") == "continue_now" else "waiting_worker" if next_kind == "await_worker_progress" else "waiting_dependencies" if next_kind == "await_task_dependencies" else "active_review"
    review_seconds = 0 if classification == "continue_now" else int(policy.blocker_followup_seconds if human_blockers else policy.live_review_seconds)
    report_seconds = int(policy.blocker_followup_seconds if human_blockers else policy.proactive_report_seconds)
    next_review_at = now_iso if review_seconds <= 0 else _iso_after_seconds(review_seconds, now=current_time)
    report_due = False
    if review_due and previous_last_report is not None:
        report_due = (current_time - previous_last_report).total_seconds() >= report_seconds
    elif review_due and previous_last_report is None:
        report_due = True
    if watchdog_context and str(watchdog_context.get("decision") or "") in {"report_status", "report_blocker", "auto_resume"}:
        if previous_last_report is None:
            report_due = True
        elif (current_time - previous_last_report).total_seconds() >= max(30, report_seconds // 2):
            report_due = True
    if any(reason in {"idle_recovery", "blocked", "completed", "recovery", "non_human_blocker", "human_blocker"} for reason in report_reasons):
        report_due = True
    return {
        "liveness": "live",
        "terminal_state": None,
        "next_review_at": next_review_at,
        "report_due": report_due,
        "review_due": review_due,
        "owed_follow_up": {
            "owed": True,
            "status": status,
            "reason": str(continuation.get("reason") or next_kind or status),
            "kind": "blocker" if human_blockers else "status",
            "due_at": next_review_at,
            "updated_at": now_iso,
            "classification": classification,
        },
        "reporting_cadence": {
            "classification": classification,
            "review_interval_seconds": review_seconds,
            "report_interval_seconds": report_seconds,
            "review_due": review_due,
            "updated_at": now_iso,
        },
    }



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
    del snapshot
    blockers: List[JsonDict] = []

    for hold in list(release_state.operator_holds) if release_state else []:
        blocker = _true_blocker_payload({"source": "release_hold", "summary": str(hold), "terminal": True}, default_requires_human=True)
        if blocker is not None:
            blockers.append(blocker)

    for decision in shared_state.open_decisions:
        if decision.status == "resolved":
            continue
        if _decision_requires_human(decision):
            blocker = _true_blocker_payload(
                {
                    "source": "open_decision",
                    "summary": decision.title,
                    "terminal": True,
                    "decision_id": decision.decision_id,
                    "metadata": dict(decision.metadata or {}),
                },
                default_requires_human=True,
            )
            if blocker is not None:
                blockers.append(blocker)

    for question in shared_state.open_questions:
        requires_human, blocker_class = _question_requires_human(str(question))
        if not requires_human:
            continue
        blockers.append(
            {
                "source": "open_question",
                "summary": str(question),
                "requires_human": True,
                "terminal": True,
                "blocker_class": blocker_class or "human_decision",
            }
        )

    for task in state.task_states:
        if task.status != "blocked":
            continue
        for blocker in task.blockers:
            payload = _true_blocker_payload(
                {
                    **dict(blocker),
                    "source": blocker.get("source") or "task_blocker",
                    "summary": blocker.get("summary") or f"task {task.task_id} blocked",
                    "task_id": task.task_id,
                    "phase_id": task.phase_id,
                },
                default_requires_human=False,
            )
            if payload is not None:
                blockers.append(payload)

    for rule in contract.blocker_rules:
        if rule.source == "release_hold":
            for hold in list(release_state.operator_holds) if release_state else []:
                payload = _true_blocker_payload(
                    {
                        "source": rule.source,
                        "summary": str(hold),
                        "terminal": bool(rule.terminal),
                        "rule_id": rule.blocker_id,
                        "metadata": dict(rule.metadata or {}),
                        "requires_human": bool(rule.requires_human),
                    },
                    default_requires_human=bool(rule.requires_human),
                )
                if payload is not None:
                    blockers.append(payload)
        elif rule.source == "open_question_prefix":
            prefix = str(rule.question_prefix or "").strip()
            if not prefix:
                continue
            for question in shared_state.open_questions:
                if str(question).startswith(prefix):
                    payload = _true_blocker_payload(
                        {
                            "source": rule.source,
                            "summary": str(question),
                            "terminal": bool(rule.terminal),
                            "rule_id": rule.blocker_id,
                            "metadata": dict(rule.metadata or {}),
                            "requires_human": bool(rule.requires_human),
                        },
                        default_requires_human=bool(rule.requires_human),
                    )
                    if payload is not None:
                        blockers.append(payload)
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
                payload = _true_blocker_payload(
                    {
                        "source": rule.source,
                        "summary": decision.title,
                        "terminal": bool(rule.terminal),
                        "decision_id": decision.decision_id,
                        "rule_id": rule.blocker_id,
                        "metadata": {**dict(rule.metadata or {}), **dict(decision.metadata or {})},
                        "requires_human": bool(rule.requires_human),
                    },
                    default_requires_human=bool(rule.requires_human),
                )
                if payload is not None:
                    blockers.append(payload)

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
    supervisor.reclaim_stale(process_id=contract.process_id)

    stale_scope_leases = [row for row in supervisor.list(process_id=contract.process_id, status="stale") if row.scope == scope]
    actions: List[JsonDict] = []

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
        lease_metadata = {
                "session_id": controller_session_id,
                "objective_id": contract.objective_id,
                "objective": contract.objective,
        }
        if stale_scope_leases:
            stale, lease = supervisor.takeover_stale(
                stale_scope_leases[0].lease_id,
                agent_id=controller_id,
                lease_seconds=contract.controller_lease_seconds,
                metadata=lease_metadata,
            )
            actions.append(
                {
                    "action": "fenced_controller_takeover",
                    "lease_id": lease.lease_id,
                    "generation": lease.generation,
                    "superseded_lease_id": stale.lease_id,
                }
            )
            recovery = True
        else:
            lease = supervisor.assign(
                process_id=contract.process_id,
                scope=scope,
                agent_id=controller_id,
                lease_seconds=contract.controller_lease_seconds,
                metadata=lease_metadata,
            )
            actions.append({"action": "claim_controller", "lease_id": lease.lease_id, "generation": lease.generation})
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
            liveness="live",
            terminal_state=None,
            phase_states=[RoadmapPhaseState(phase_id=phase.phase_id) for phase in contract.phases],
            task_states=[
                RoadmapTaskState(task_id=task.task_id, phase_id=task.phase_id, work_type=task.work_type)
                for task in contract.tasks
            ],
            next_action={},
            continuation={},
            last_pass={},
            last_progress={},
            last_report={},
            owed_follow_up={},
            reporting_cadence={},
            last_watchdog_decision={},
            conversation_ownership={},
            follow_through={},
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
        liveness=previous_state.liveness,
        terminal_state=previous_state.terminal_state,
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
        last_progress_at=previous_state.last_progress_at,
        last_report_at=previous_state.last_report_at,
        next_review_at=previous_state.next_review_at,
        last_watchdog_at=previous_state.last_watchdog_at,
        true_blockers=list(previous_state.true_blockers),
        completion=dict(previous_state.completion),
        next_action=dict(previous_state.next_action or {}),
        continuation=dict(previous_state.continuation or {}),
        last_pass=dict(previous_state.last_pass or {}),
        last_progress=dict(previous_state.last_progress or {}),
        last_report=dict(previous_state.last_report or {}),
        owed_follow_up=dict(previous_state.owed_follow_up or {}),
        reporting_cadence=dict(previous_state.reporting_cadence or {}),
        last_watchdog_decision=dict(previous_state.last_watchdog_decision or {}),
        conversation_ownership=dict(previous_state.conversation_ownership or {}),
        follow_through=dict(previous_state.follow_through or {}),
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



def _requeue_non_human_blocked_tasks(state: RoadmapExecutionState) -> List[JsonDict]:
    actions_taken: List[JsonDict] = []
    for task_state in state.task_states:
        if task_state.status != "blocked":
            continue
        human_blockers = [
            blocker
            for blocker in task_state.blockers
            if _true_blocker_payload(blocker, source=str(blocker.get("source") or "task_blocker"), default_requires_human=False) is not None
        ]
        if human_blockers:
            continue
        _set_task_state(task_state, status="pending", gate_results=task_state.gate_results)
        task_state.metadata = {
            **dict(task_state.metadata or {}),
            "last_requeue_reason": "non_human_blocker",
            "last_requeue_at": task_state.updated_at,
        }
        actions_taken.append({"action": "requeue_task", "task_id": task_state.task_id, "reason": "non_human_blocker"})
    return actions_taken



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
    budget: Optional[RoadmapPassBudget] = None,
    now: Optional[datetime] = None,
) -> JsonDict:
    supervisor.reclaim_stale(process_id=contract.process_id)

    phase_state_map = _phase_status_map(state)
    task_state_map = _task_status_map(state)
    actions_taken: List[JsonDict] = []
    recovery = False
    active_task_ids: List[str] = []
    dispatched_count = 0
    dispatch_limit = max(1, int((budget.max_task_dispatches_per_pass if budget is not None else 1) or 1))

    if not active_phase_id:
        return {"actions_taken": actions_taken, "recovery": recovery, "active_task_ids": active_task_ids, "dispatched_count": 0, "dispatch_budget_exhausted": False}

    ready_tasks = [task for task in _tasks_for_phase(contract, active_phase_id) if _task_dependencies_satisfied(task, task_state_map)]
    for task in ready_tasks:
        task_state = task_state_map[task.task_id]
        if task_state.status in {"pending", "blocked"} and dispatched_count >= dispatch_limit:
            continue
        if task_state.status == "completed":
            continue
        if task_state.status == "blocked":
            active_task_ids.append(task.task_id)
            continue
        agent_id = _select_task_agent(task, contract=contract, snapshot=snapshot, shared_state=shared_state, controller_id=controller_id)
        scope = str((task.metadata or {}).get("lease_scope") or _task_scope(task.task_id)).strip() or _task_scope(task.task_id)
        stale_leases = [row for row in supervisor.list(process_id=contract.process_id, status="stale") if row.scope == scope]
        active_leases = [row for row in supervisor.list(process_id=contract.process_id, status="active") if row.scope == scope]
        lease: Optional[AgentLease] = None
        if active_leases:
            lease = active_leases[0]
            if lease.agent_id == agent_id:
                lease = supervisor.heartbeat(lease.lease_id, lease_seconds=contract.worker_lease_seconds)
                actions_taken.append({"action": "heartbeat_task_lease", "lease_id": lease.lease_id, "task_id": task.task_id, "agent_id": agent_id})
            else:
                active_task_ids.append(task.task_id)
                actions_taken.append({"action": "task_lease_owner_held", "lease_id": lease.lease_id, "task_id": task.task_id, "owner": lease.agent_id, "requested_agent": agent_id})
                continue

        if lease is None:
            lease_metadata = {"objective_id": contract.objective_id, "task_id": task.task_id, "work_type": task.work_type}
            if stale_leases:
                active_task_ids.append(task.task_id)
                actions_taken.append(
                    {
                        "action": "task_requires_fenced_takeover",
                        "task_id": task.task_id,
                        "lease_ids": [row.lease_id for row in stale_leases],
                        "blocking": True,
                    }
                )
                continue
            lease = supervisor.assign(
                process_id=contract.process_id,
                scope=scope,
                agent_id=agent_id,
                lease_seconds=contract.worker_lease_seconds,
                metadata=lease_metadata,
            )
            task_state.attempt_count = int(task_state.attempt_count or 0) + 1
            actions_taken.append({"action": "assign_task_lease", "lease_id": lease.lease_id, "generation": lease.generation, "task_id": task.task_id, "agent_id": agent_id})
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
                "lease_id": lease.lease_id,
                "lease_generation": lease.generation,
            },
            metadata={
                "objective_id": contract.objective_id,
                "task_id": task.task_id,
                "phase_id": task.phase_id,
                "work_type": task.work_type,
                "lease_id": lease.lease_id,
                "lease_generation": lease.generation,
                "lease_scope": lease.scope,
            },
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
            acked = mailbox.acknowledge(handoff.message_id, actor=agent_id)
            message_status = acked.delivery_status
            actions_taken.append({"action": "ack_task_handoff", "message_id": acked.message_id, "task_id": task.task_id, "agent_id": agent_id})
        task_state.assigned_agent_id = agent_id
        task_state.lease_id = lease.lease_id
        task_state.last_handoff_message_id = handoff.message_id
        task_state.last_handoff_status = _message_status_key(message_status)
        _set_task_state(task_state, status="in_progress")
        dispatched_count += 1
        active_task_ids.append(task.task_id)

    active_task_ids = _dedupe_rows(active_task_ids + [task.task_id for task in state.task_states if task.status == "in_progress" and task.phase_id == active_phase_id])
    return {
        "actions_taken": actions_taken,
        "recovery": recovery,
        "active_task_ids": active_task_ids,
        "dispatched_count": dispatched_count,
        "dispatch_budget_exhausted": bool(ready_tasks) and dispatched_count >= dispatch_limit and len(ready_tasks) > dispatched_count,
    }



def _evaluate_and_advance(
    contract: RoadmapObjectiveContract,
    *,
    state: RoadmapExecutionState,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    dependability_report: Optional[JsonDict],
    release_state: Optional[ReleaseWorkflowState],
    budget: Optional[RoadmapPassBudget] = None,
) -> JsonDict:
    phase_state_map = _phase_status_map(state)
    task_state_map = _task_status_map(state)
    actions_taken: List[JsonDict] = []
    task_completion_limit = max(1, int((budget.max_task_completions_per_pass if budget is not None else 1) or 1))
    phase_transition_limit = max(1, int((budget.max_phase_transitions_per_pass if budget is not None else 1) or 1))
    task_completion_count = 0
    phase_transition_count = 0
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
                        if task_completion_count >= task_completion_limit:
                            continue
                        _set_task_state(task_state, status="completed", gate_results=task_eval.get("criteria"))
                        task_completion_count += 1
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
                    if phase_transition_count >= phase_transition_limit:
                        continue
                    _set_phase_state(phase_state, status="completed", gate_results=phase_eval.get("gate_results"))
                    phase_transition_count += 1
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

    return {
        "actions_taken": actions_taken,
        "active_phase_id": active_phase_id,
        "task_completion_count": task_completion_count,
        "phase_transition_count": phase_transition_count,
        "progress_budget_exhausted": task_completion_count >= task_completion_limit or phase_transition_count >= phase_transition_limit,
    }



def _reconcile_roadmap_execution_pass(
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
    pass_index: int = 1,
    watchdog_context: Optional[Dict[str, Any]] = None,
) -> JsonDict:
    roadmap_store.save_contract(contract)
    previous_state = roadmap_store.load_state(contract.process_id)
    state = _merge_state(contract, previous_state)
    budget = contract.execution_budget

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
    previous_release_stage = previous_state.current_release_stage if previous_state is not None else None
    requeue_actions = _requeue_non_human_blocked_tasks(state)

    progress = _evaluate_and_advance(
        contract,
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        dependability_report=dependability.get("after") or dependability.get("before") or {},
        release_state=release_state,
        budget=budget,
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
        budget=budget,
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
    release_stage_changed = previous_release_stage != (release_state.current_stage if release_state is not None else None)
    validation_decision = _roadmap_validation_decision(
        contract,
        budget=budget,
        previous_state=previous_state,
        state=state,
        task_completion_count=_int_budget(progress.get("task_completion_count")),
        phase_transition_count=_int_budget(progress.get("phase_transition_count")),
        release_stage_changed=release_stage_changed,
    )
    validation_scope = str(validation_decision.get("scope") or "focused")
    if validation_scope == "broad":
        completion = evaluate_roadmap_completion(
            contract,
            state=state,
            snapshot=snapshot,
            shared_state=shared_state,
            dependability_report=dependability.get("after") or dependability.get("before") or {},
            release_state=release_state,
        )
    else:
        completion = dict(previous_state.completion or {}) if previous_state is not None else {"all_required_satisfied": False, "criteria": []}
        completion.update(
            {
                "all_required_satisfied": False,
                "validation_scope": validation_scope,
                "validation_reasons": list(validation_decision.get("reasons") or []),
                "criteria": list(completion.get("criteria") or []),
            }
        )
    completion["validation_scope"] = validation_scope
    completion["validation_reasons"] = list(validation_decision.get("reasons") or [])

    human_blockers = _has_human_blockers(blockers)
    completed = bool(completion.get("all_required_satisfied")) and not blockers
    status = "completed" if completed else ("blocked" if human_blockers else "active")
    budget_exhausted = bool(progress.get("progress_budget_exhausted")) or bool(dispatch.get("dispatch_budget_exhausted"))

    next_iteration = int(state.iteration_count or 0) + 1
    all_actions = ownership_actions + list(dependability.get("actions_taken") or []) + list(requeue_actions) + list(progress.get("actions_taken") or []) + list(dispatch.get("actions_taken") or [])

    immediate_completable_task_ids = _roadmap_immediately_completable_task_ids(
        contract,
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        dependability_report=dependability.get("after") or dependability.get("before") or {},
        release_state=release_state,
    ) if status == "active" else []
    next_action = _roadmap_next_action(
        contract,
        state=state,
        blockers=blockers,
        completion=completion,
        budget=budget,
        pass_index=pass_index,
        budget_exhausted=budget_exhausted,
        immediate_completable_task_ids=immediate_completable_task_ids,
    )
    continuation = _roadmap_continuation(status=status, blockers=blockers, next_action=next_action)
    pass_objective = str(next_action.get("summary") or next_action.get("kind") or contract.objective)
    pass_budget = budget.model_dump() if hasattr(budget, "model_dump") else budget.dict()

    previous_phase = previous_state.active_phase_id if previous_state is not None else None
    previous_tasks = set(previous_state.active_task_ids) if previous_state is not None else set()
    current_tasks = set(state.active_task_ids)
    previous_blocker_keys = {_report_blocker_key(row) for row in (previous_state.true_blockers or [])} if previous_state is not None else set()
    current_blocker_keys = {_report_blocker_key(row) for row in blockers}
    task_changes = [row for row in all_actions if row.get("action") in {"complete_task", "reopen_task", "dispatch_task_handoff", "ack_task_handoff", "assign_task_lease", "reassign_task_lease"}]

    report_reasons: List[str] = []
    policy = contract.reporting_policy
    now_iso = _now_iso(now)
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
    if human_blockers:
        report_reasons.append("human_blocker")
    elif blockers:
        report_reasons.append("non_human_blocker")
    if status == "blocked":
        report_reasons.append("blocked")
    if watchdog_context and str(watchdog_context.get("decision") or "") == "auto_resume":
        report_reasons.append("idle_recovery")

    review_plan = _roadmap_review_plan(
        policy=policy,
        previous_state=previous_state,
        status=status,
        blockers=blockers,
        next_action=next_action,
        continuation=continuation,
        now=now,
        report_reasons=report_reasons,
        watchdog_context=watchdog_context,
    )
    if review_plan.get("report_due"):
        report_reasons.append("review_due")
    if watchdog_context and str(watchdog_context.get("decision") or "") == "report_blocker":
        report_reasons.append("blocker_followup_due")
    if watchdog_context and str(watchdog_context.get("decision") or "") == "report_status":
        report_reasons.append("status_followup_due")
    report_reasons = _dedupe_rows(report_reasons)
    last_progress_at, last_progress = _roadmap_progress_record(
        contract=contract,
        previous_state=previous_state,
        state=state,
        status=status,
        actions_taken=all_actions,
        report_reasons=report_reasons,
        blockers=blockers,
        next_action=next_action,
        now_iso=now_iso,
    )

    progress_snapshot = _roadmap_progress_snapshot(
        contract,
        state=state,
        blockers=blockers,
        completion=completion,
        next_action=next_action,
        continuation=continuation,
        release_state=release_state,
        actions_taken=all_actions,
    )
    execution_discipline = {
        "reporting_policy": _policy_dump(contract.reporting_policy),
        "blocker_policy": {
            "mode": "human_needed_only",
            "builtin_question_prefixes": list(BUILTIN_BLOCKER_PREFIXES),
            "human_needed_classes": sorted(HUMAN_BLOCKER_CLASSES),
            "true_blocker_count": len(blockers),
            "true_blocker_sources": _dedupe_rows([str(row.get("source") or "") for row in blockers]),
            "requeued_task_ids": [row.get("task_id") for row in requeue_actions if row.get("task_id")],
        },
        "validation_policy": {
            **validation_decision,
            "configured": _policy_dump(contract.execution_budget),
        },
        "continuation_policy": {
            "mode": continuation.get("mode"),
            "reason": continuation.get("reason"),
            "next_action_kind": next_action.get("kind"),
            "quality_gate": "promotion_or_completion_checkpoint" if validation_scope == "broad" else "bounded_pass_focused_validation",
        },
        "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
        "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
        "watchdog": dict(watchdog_context or {}),
        "progress": progress_snapshot,
        "latest_decisions": {
            "status": status,
            "summary_hint": str(next_action.get("summary") or pass_objective),
            "report_reasons": _dedupe_rows(report_reasons),
            "pass_index": pass_index,
            "pass_objective": pass_objective,
            "budget_exhausted": budget_exhausted,
            "active_phase_id": state.active_phase_id,
            "active_task_ids": list(state.active_task_ids),
            "task_completed": progress_snapshot.get("task_completed"),
            "task_total": progress_snapshot.get("task_total"),
            "phase_completed": progress_snapshot.get("phase_completed"),
            "phase_total": progress_snapshot.get("phase_total"),
        },
    }

    report_kind = "completed" if completed else ("blocked" if status == "blocked" else ("recovery" if any(reason in report_reasons for reason in {"recovery", "idle_recovery"}) else "checkpoint"))
    summary = _roadmap_operator_summary(
        contract,
        state=state,
        status=status,
        blockers=blockers,
        next_action=next_action,
        validation_scope=validation_scope,
        progress=progress_snapshot,
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
                    "pass_index": pass_index,
                    "pass_objective": pass_objective,
                    "pass_budget": pass_budget,
                    "validation_scope": validation_scope,
                    "validation_reasons": list(validation_decision.get("reasons") or []),
                    "continuation": dict(continuation),
                    "next_action": dict(next_action),
                    "progress": progress_snapshot,
                    "last_progress": dict(last_progress),
                    "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
                    "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
                    "conversation_ownership": _roadmap_conversation_ownership(
                        contract=contract,
                        previous_state=previous_state,
                        review_plan=review_plan,
                        report_record=None,
                        now_iso=now_iso,
                    ),
                    "follow_through": {
                        "continuation": dict(continuation),
                        "next_action": dict(next_action),
                        "next_required_update_at": (review_plan.get("owed_follow_up") or {}).get("due_at"),
                        "next_required_review_at": review_plan.get("next_review_at"),
                        "report_due": bool(review_plan.get("report_due")),
                        "review_due": bool(review_plan.get("review_due")),
                    },
                    "watchdog": dict(watchdog_context or {}),
                    "execution_discipline": execution_discipline,
                },
            )
        )

    last_report = (
        {
            "report_id": report_record.report_id,
            "recorded_at": report_record.recorded_at,
            "kind": report_record.kind,
            "status": report_record.status,
            "summary": report_record.summary,
            "reasons": list((report_record.metadata or {}).get("reasons") or []),
        }
        if report_record is not None
        else dict(previous_state.last_report or {}) if previous_state is not None else {}
    )
    conversation_ownership = _roadmap_conversation_ownership(
        contract=contract,
        previous_state=previous_state,
        review_plan=review_plan,
        report_record=report_record,
        now_iso=now_iso,
    )
    follow_through = _roadmap_follow_through(
        previous_state=previous_state,
        status=status,
        next_action=next_action,
        continuation=continuation,
        review_plan=review_plan,
        report_reasons=report_reasons,
        report_record=report_record,
        watchdog_context=watchdog_context,
        now_iso=now_iso,
    )
    updated_state = RoadmapExecutionState(
        execution_id=state.execution_id,
        objective_id=contract.objective_id,
        process_id=contract.process_id,
        status=status,
        liveness=str(review_plan.get("liveness") or ("terminal" if status == "completed" else "live")),
        terminal_state=review_plan.get("terminal_state"),
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
        last_progress_at=last_progress_at,
        last_report_at=report_record.recorded_at if report_record is not None else (previous_state.last_report_at if previous_state is not None else None),
        next_review_at=review_plan.get("next_review_at"),
        last_watchdog_at=now_iso if watchdog_context else (previous_state.last_watchdog_at if previous_state is not None else None),
        true_blockers=blockers,
        completion=completion,
        next_action=next_action,
        continuation=continuation,
        last_pass={
            "index": pass_index,
            "objective": pass_objective,
            "budget": pass_budget,
            "validation_scope": validation_scope,
            "validation_reasons": list(validation_decision.get("reasons") or []),
            "budget_exhausted": budget_exhausted,
            "task_completion_count": _int_budget(progress.get("task_completion_count")),
            "phase_transition_count": _int_budget(progress.get("phase_transition_count")),
            "task_dispatch_count": _int_budget(dispatch.get("dispatched_count")),
            "requeued_task_count": len(requeue_actions),
        },
        last_progress=last_progress,
        last_report=last_report,
        owed_follow_up=dict(review_plan.get("owed_follow_up") or {}),
        reporting_cadence=dict(review_plan.get("reporting_cadence") or {}),
        conversation_ownership=conversation_ownership,
        follow_through=follow_through,
        last_watchdog_decision={
            **(dict(previous_state.last_watchdog_decision or {}) if previous_state is not None else {}),
            **dict(watchdog_context or {}),
            **({"recorded_at": now_iso, "review_due": bool(review_plan.get("review_due")), "next_review_at": review_plan.get("next_review_at")} if watchdog_context else {}),
        },
        phase_states=list(state.phase_states),
        task_states=list(state.task_states),
        metadata={
            **dict(state.metadata or {}),
            "objective": contract.objective,
            "last_actions": all_actions,
            "last_report_reasons": _dedupe_rows(report_reasons),
            "last_dependability_success": bool((dependability.get("after") or dependability.get("before") or {}).get("success")) if dependability.get("before") is not None or dependability.get("after") is not None else None,
            "pass_budget": pass_budget,
            "pass_objective": pass_objective,
            "validation_scope": validation_scope,
            "continuation_mode": continuation.get("mode"),
            "progress_snapshot": progress_snapshot,
            "execution_discipline": execution_discipline,
            "reporting_policy": _policy_dump(contract.reporting_policy),
            "validation_policy": validation_decision,
            "blocker_policy": execution_discipline["blocker_policy"],
            "liveness": str(review_plan.get("liveness") or ("terminal" if status == "completed" else "live")),
            "terminal_state": review_plan.get("terminal_state"),
            "next_review_at": review_plan.get("next_review_at"),
            "last_progress": last_progress,
            "last_report": last_report,
            "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
            "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
            "conversation_ownership": conversation_ownership,
            "follow_through": follow_through,
            "watchdog": dict(watchdog_context or {}),
        },
    )
    updated_state = roadmap_store.save_state(updated_state)

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
        "next_action": next_action,
        "continuation": continuation,
    }


def _reconcile_roadmap_execution_locked(
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
    watchdog_context: Optional[Dict[str, Any]] = None,
) -> JsonDict:
    final_result: Optional[JsonDict] = None
    chained_passes = 0
    now_iso = _now_iso(now)
    max_passes = max(1, int(contract.execution_budget.max_auto_chain_passes or 1))

    for pass_index in range(1, max_passes + 1):
        chained_passes = pass_index
        final_result = _reconcile_roadmap_execution_pass(
            contract,
            roadmap_store=roadmap_store,
            snapshot_store=snapshot_store,
            shared_state_store=shared_state_store,
            mailbox=mailbox,
            supervisor=supervisor,
            release_store=release_store,
            controller_id=controller_id,
            controller_session_id=controller_session_id,
            journal=journal,
            now=now,
            pass_index=pass_index,
            watchdog_context=watchdog_context,
        )
        continuation = dict(final_result.get("continuation") or {})
        if continuation.get("mode") != "continue_now":
            break

    if final_result is None:
        raise ValueError("roadmap reconciliation produced no result")

    if chained_passes >= max_passes and dict(final_result.get("continuation") or {}).get("mode") == "continue_now":
        persisted_state = roadmap_store.load_state(contract.process_id)
        if persisted_state is not None:
            snapshot = snapshot_store.load(contract.process_id)
            shared_state = shared_state_store.load(contract.process_id)
            release_state = release_store.load(contract.process_id) if release_store is not None else None
            blockers = list(persisted_state.true_blockers or [])
            completion = dict(persisted_state.completion or {})

            if snapshot is not None and shared_state is not None:
                blockers = detect_roadmap_true_blockers(
                    contract,
                    state=persisted_state,
                    snapshot=snapshot,
                    shared_state=shared_state,
                    release_state=release_state,
                )
                dependability_report = load_dependability_report(
                    process_id=contract.process_id,
                    snapshot_store=snapshot_store,
                    shared_state_store=shared_state_store,
                    journal=journal,
                    mailbox=mailbox,
                    supervisor=supervisor,
                    profile=contract.dependability_profile,
                    now=now,
                )
                completion = evaluate_roadmap_completion(
                    contract,
                    state=persisted_state,
                    snapshot=snapshot,
                    shared_state=shared_state,
                    dependability_report=dependability_report,
                    release_state=release_state,
                )
                completion["validation_scope"] = "broad"
                completion["validation_reasons"] = _dedupe_rows(list(completion.get("validation_reasons") or []) + ["auto_chain_pause_checkpoint"])
            else:
                completion.setdefault("validation_scope", persisted_state.metadata.get("validation_scope") if isinstance(persisted_state.metadata, dict) else "focused")
                completion["validation_reasons"] = _dedupe_rows(list(completion.get("validation_reasons") or []) + ["auto_chain_pause_checkpoint"])

            status = "completed" if bool(completion.get("all_required_satisfied")) and not blockers else ("blocked" if _has_human_blockers(blockers) else "active")
            immediate_task_ids = (
                _roadmap_immediately_completable_task_ids(
                    contract,
                    state=persisted_state,
                    snapshot=snapshot,
                    shared_state=shared_state,
                    dependability_report=load_dependability_report(
                        process_id=contract.process_id,
                        snapshot_store=snapshot_store,
                        shared_state_store=shared_state_store,
                        journal=journal,
                        mailbox=mailbox,
                        supervisor=supervisor,
                        profile=contract.dependability_profile,
                        now=now,
                    ) if snapshot is not None and shared_state is not None else {},
                    release_state=release_state,
                )
                if status == "active" and snapshot is not None and shared_state is not None
                else []
            )
            next_action = _roadmap_next_action(
                contract,
                state=persisted_state,
                blockers=blockers,
                completion=completion,
                budget=contract.execution_budget,
                pass_index=chained_passes,
                budget_exhausted=True,
                immediate_completable_task_ids=immediate_task_ids,
            )
            continuation = _roadmap_continuation(status=status, blockers=blockers, next_action=next_action)
            if status == "active" and continuation.get("mode") == "continue_now":
                continuation["reason"] = "auto_chain_budget_exhausted"
            progress_snapshot = _roadmap_progress_snapshot(
                contract,
                state=persisted_state,
                blockers=blockers,
                completion=completion,
                next_action=next_action,
                continuation=continuation,
                release_state=release_state,
                actions_taken=list((persisted_state.metadata or {}).get("last_actions") or []),
            )
            report_reasons = ["auto_chain_budget_exhausted"]
            if status == "completed":
                report_reasons.append("completed")
            if persisted_state.status != status:
                report_reasons.append("status_change")
            review_plan = _roadmap_review_plan(
                policy=contract.reporting_policy,
                previous_state=persisted_state,
                status=status,
                blockers=blockers,
                next_action=next_action,
                continuation=continuation,
                now=now,
                report_reasons=report_reasons,
                watchdog_context=watchdog_context,
            )
            report_reasons = _dedupe_rows(report_reasons + (["review_due"] if review_plan.get("report_due") else []))
            validation_scope = str(completion.get("validation_scope") or "broad")
            validation_policy = {
                **dict((persisted_state.metadata or {}).get("validation_policy") or {}),
                "scope": validation_scope,
                "reasons": list(completion.get("validation_reasons") or []),
                "promotion_checkpoint": True,
                "completion_pause_checkpoint": True,
                "configured": _policy_dump(contract.execution_budget),
            }
            execution_discipline = {
                **dict((persisted_state.metadata or {}).get("execution_discipline") or {}),
                "validation_policy": validation_policy,
                "continuation_policy": {
                    "mode": continuation.get("mode"),
                    "reason": continuation.get("reason"),
                    "next_action_kind": next_action.get("kind"),
                    "quality_gate": "promotion_or_completion_checkpoint",
                },
                "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
                "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
                "watchdog": dict(watchdog_context or {}),
                "progress": progress_snapshot,
                "latest_decisions": {
                    **dict((dict((persisted_state.metadata or {}).get("execution_discipline") or {}).get("latest_decisions") or {})),
                    "status": status,
                    "summary_hint": str(next_action.get("summary") or contract.objective),
                    "report_reasons": _dedupe_rows(report_reasons),
                    "pass_index": chained_passes,
                    "pass_objective": str(next_action.get("summary") or next_action.get("kind") or contract.objective),
                    "budget_exhausted": True,
                    "chained_passes": chained_passes,
                    "active_phase_id": persisted_state.active_phase_id,
                    "active_task_ids": list(persisted_state.active_task_ids),
                    "task_completed": progress_snapshot.get("task_completed"),
                    "task_total": progress_snapshot.get("task_total"),
                    "phase_completed": progress_snapshot.get("phase_completed"),
                    "phase_total": progress_snapshot.get("phase_total"),
                },
            }
            summary = _roadmap_operator_summary(
                contract,
                state=persisted_state,
                status=status,
                blockers=blockers,
                next_action=next_action,
                validation_scope=validation_scope,
                progress=progress_snapshot,
                chained_passes=chained_passes,
                auto_chain_budget_exhausted=(status == "active"),
            )
            report_record = roadmap_store.append_report(
                RoadmapExecutionReport(
                    execution_id=persisted_state.execution_id,
                    objective_id=contract.objective_id,
                    process_id=contract.process_id,
                    iteration=int(persisted_state.iteration_count or 0),
                    kind="completed" if status == "completed" else "checkpoint",
                    status=status,
                    summary=summary,
                    controller_id=persisted_state.controller.controller_id if persisted_state.controller is not None else controller_id,
                    controller_session_id=persisted_state.controller.session_id if persisted_state.controller is not None else controller_session_id,
                    active_phase_id=persisted_state.active_phase_id,
                    active_task_ids=list(persisted_state.active_task_ids),
                    actions_taken=list((persisted_state.metadata or {}).get("last_actions") or []),
                    blockers=blockers,
                    completion=completion,
                    metadata={
                        "reasons": _dedupe_rows(report_reasons),
                        "pass_index": chained_passes,
                        "pass_objective": str(next_action.get("summary") or next_action.get("kind") or contract.objective),
                        "pass_budget": _policy_dump(contract.execution_budget),
                        "validation_scope": validation_scope,
                        "validation_reasons": list(completion.get("validation_reasons") or []),
                        "continuation": dict(continuation),
                        "next_action": dict(next_action),
                        "progress": progress_snapshot,
                        "last_progress": dict(persisted_state.last_progress or {}),
                        "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
                        "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
                        "conversation_ownership": _roadmap_conversation_ownership(
                            contract=contract,
                            previous_state=persisted_state,
                            review_plan=review_plan,
                            report_record=None,
                            now_iso=now_iso,
                        ),
                        "follow_through": {
                            "continuation": dict(continuation),
                            "next_action": dict(next_action),
                            "next_required_update_at": (review_plan.get("owed_follow_up") or {}).get("due_at"),
                            "next_required_review_at": review_plan.get("next_review_at"),
                            "report_due": bool(review_plan.get("report_due")),
                            "review_due": bool(review_plan.get("review_due")),
                        },
                        "watchdog": dict(watchdog_context or {}),
                        "execution_discipline": execution_discipline,
                    },
                )
            )
            conversation_ownership = _roadmap_conversation_ownership(
                contract=contract,
                previous_state=persisted_state,
                review_plan=review_plan,
                report_record=report_record,
                now_iso=now_iso,
            )
            follow_through = _roadmap_follow_through(
                previous_state=persisted_state,
                status=status,
                next_action=next_action,
                continuation=continuation,
                review_plan=review_plan,
                report_reasons=report_reasons,
                report_record=report_record,
                watchdog_context=watchdog_context,
                now_iso=now_iso,
            )
            persisted_state = RoadmapExecutionState(
                **{
                    **_state_dump(persisted_state),
                    "status": status,
                    "liveness": str(review_plan.get("liveness") or ("terminal" if status == "completed" else "live")),
                    "terminal_state": review_plan.get("terminal_state"),
                    "current_revision_id": shared_state.revision_id if shared_state is not None else persisted_state.current_revision_id,
                    "current_snapshot_id": snapshot.snapshot_id if snapshot is not None else persisted_state.current_snapshot_id,
                    "current_release_stage": release_state.current_stage if release_state is not None else persisted_state.current_release_stage,
                    "latest_report_id": report_record.report_id,
                    "last_checkpoint_at": report_record.recorded_at,
                    "last_report_at": report_record.recorded_at,
                    "next_review_at": review_plan.get("next_review_at"),
                    "last_watchdog_at": now_iso if watchdog_context else persisted_state.last_watchdog_at,
                    "checkpoint_count": int(persisted_state.checkpoint_count or 0) + 1,
                    "true_blockers": blockers,
                    "completion": completion,
                    "continuation": continuation,
                    "next_action": next_action,
                    "last_report": {
                        "report_id": report_record.report_id,
                        "recorded_at": report_record.recorded_at,
                        "kind": report_record.kind,
                        "status": report_record.status,
                        "summary": report_record.summary,
                        "reasons": list((report_record.metadata or {}).get("reasons") or []),
                    },
                    "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
                    "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
                    "conversation_ownership": conversation_ownership,
                    "follow_through": follow_through,
                    "last_watchdog_decision": {
                        **dict(persisted_state.last_watchdog_decision or {}),
                        **dict(watchdog_context or {}),
                        **({"recorded_at": now_iso, "review_due": bool(review_plan.get("review_due")), "next_review_at": review_plan.get("next_review_at")} if watchdog_context else {}),
                    },
                    "last_pass": {
                        **dict(persisted_state.last_pass or {}),
                        "auto_chain_budget_exhausted": True,
                        "chained_passes": chained_passes,
                        "validation_scope": validation_scope,
                        "validation_reasons": list(completion.get("validation_reasons") or []),
                        "budget_exhausted": True,
                    },
                    "metadata": {
                        **dict(persisted_state.metadata or {}),
                        "chained_passes": chained_passes,
                        "auto_chain_budget_exhausted": True,
                        "last_report_reasons": _dedupe_rows(report_reasons),
                        "validation_scope": validation_scope,
                        "continuation_mode": continuation.get("mode"),
                        "progress_snapshot": progress_snapshot,
                        "execution_discipline": execution_discipline,
                        "validation_policy": validation_policy,
                        "liveness": str(review_plan.get("liveness") or ("terminal" if status == "completed" else "live")),
                        "terminal_state": review_plan.get("terminal_state"),
                        "next_review_at": review_plan.get("next_review_at"),
                        "last_report": {
                            "report_id": report_record.report_id,
                            "recorded_at": report_record.recorded_at,
                            "kind": report_record.kind,
                            "status": report_record.status,
                            "summary": report_record.summary,
                            "reasons": list((report_record.metadata or {}).get("reasons") or []),
                        },
                        "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
                        "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
                        "conversation_ownership": conversation_ownership,
                        "follow_through": follow_through,
                        "watchdog": dict(watchdog_context or {}),
                    },
                }
            )
            persisted_state = roadmap_store.save_state(persisted_state)
            if status == "completed" and persisted_state.controller is not None:
                supervisor.resolve(persisted_state.controller.lease_id, status="released", metadata={"resolution": status})
            final_result["state"] = _state_dump(persisted_state)
            final_result["report"] = _report_dump(report_record)
            final_result["continuation"] = continuation
            final_result["next_action"] = next_action
            final_result["completion"] = completion
            final_result["blockers"] = blockers
            final_result["operator_summary"] = summary

    final_result["chained_passes"] = chained_passes
    final_state = dict(final_result.get("state") or {})
    final_state.setdefault("metadata", {})["chained_passes"] = chained_passes
    final_result["state"] = final_state
    return final_result


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
    watchdog_context: Optional[Dict[str, Any]] = None,
) -> JsonDict:
    kwargs = {
        "roadmap_store": roadmap_store,
        "snapshot_store": snapshot_store,
        "shared_state_store": shared_state_store,
        "mailbox": mailbox,
        "supervisor": supervisor,
        "release_store": release_store,
        "controller_id": controller_id,
        "controller_session_id": controller_session_id,
        "journal": journal,
        "now": now,
        "watchdog_context": watchdog_context,
    }
    if release_store is None:
        return _reconcile_roadmap_execution_locked(contract, **kwargs)
    with release_store.release_transaction(contract.process_id):
        release_store.assert_mutation_allowed(
            contract.process_id,
            operation="roadmap reconciliation",
        )
        return _reconcile_roadmap_execution_locked(contract, **kwargs)


__all__ = [
    "RoadmapBlockerRule",
    "RoadmapControllerOwner",
    "RoadmapExecutionReport",
    "RoadmapExecutionState",
    "RoadmapExecutionStore",
    "RoadmapObjectiveContract",
    "RoadmapPassBudget",
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
