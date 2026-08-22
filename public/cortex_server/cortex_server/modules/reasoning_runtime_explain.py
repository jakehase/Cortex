from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from cortex_server.modules import explain_compiler
from cortex_server.modules import reasoning_explain as explain
from cortex_server.modules import reasoning_observability as observability

BeliefsForTaskFn = Callable[[str], List[Dict[str, Any]]]
SummarizeBeliefsFn = Callable[..., Dict[str, Any]]
ExplainBeliefFn = Callable[[str], Optional[Dict[str, Any]]]
GetBeliefFn = Callable[[str], Optional[Dict[str, Any]]]
SelectInfluentialBeliefsFn = Callable[..., List[Dict[str, Any]]]
GetRuntimeEventsFn = Callable[..., List[Dict[str, Any]]]



def policy_patch_history(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    return explain_compiler.compile_policy_patch_history(events)



def assemble_runtime_process_explain(
    *,
    process_id: str,
    process: Dict[str, Any],
    beliefs_for_task_fn: BeliefsForTaskFn,
    summarize_beliefs_fn: SummarizeBeliefsFn,
    explain_belief_fn: ExplainBeliefFn,
    get_belief_fn: GetBeliefFn,
    select_influential_beliefs_fn: SelectInfluentialBeliefsFn,
    snapshot: Optional[Any] = None,
    shared_state: Optional[Any] = None,
    recent_events: Optional[List[Any]] = None,
    mailbox_messages: Optional[List[Any]] = None,
    leases: Optional[List[Any]] = None,
    handoff: Optional[Any] = None,
) -> Dict[str, Any]:
    return {
        "success": True,
        "process_id": process_id,
        **explain_compiler.compile_runtime_process_sections(
            process=process,
            beliefs_for_task_fn=beliefs_for_task_fn,
            summarize_beliefs_fn=summarize_beliefs_fn,
            explain_belief_fn=explain_belief_fn,
            get_belief_fn=get_belief_fn,
            select_influential_beliefs_fn=select_influential_beliefs_fn,
            snapshot=snapshot,
            shared_state=shared_state,
            recent_events=recent_events,
            mailbox_messages=mailbox_messages,
            leases=leases,
            handoff=handoff,
        ),
    }


def assemble_runtime_process_view(
    *,
    process_id: str,
    process: Dict[str, Any],
    events_limit: int,
    get_runtime_events_fn: GetRuntimeEventsFn,
    beliefs_for_task_fn: BeliefsForTaskFn,
    summarize_beliefs_fn: SummarizeBeliefsFn,
    explain_belief_fn: ExplainBeliefFn,
    get_belief_fn: GetBeliefFn,
    select_influential_beliefs_fn: SelectInfluentialBeliefsFn,
    snapshot: Optional[Any] = None,
    shared_state: Optional[Any] = None,
    recent_events: Optional[List[Any]] = None,
    mailbox_messages: Optional[List[Any]] = None,
    leases: Optional[List[Any]] = None,
    handoff: Optional[Any] = None,
) -> Dict[str, Any]:
    explained = assemble_runtime_process_explain(
        process_id=process_id,
        process=process,
        beliefs_for_task_fn=beliefs_for_task_fn,
        summarize_beliefs_fn=summarize_beliefs_fn,
        explain_belief_fn=explain_belief_fn,
        get_belief_fn=get_belief_fn,
        select_influential_beliefs_fn=select_influential_beliefs_fn,
        snapshot=snapshot,
        shared_state=shared_state,
        recent_events=recent_events,
        mailbox_messages=mailbox_messages,
        leases=leases,
        handoff=handoff,
    )
    explained["events"] = get_runtime_events_fn(process_id, limit=events_limit)
    explained["policy_patch_history"] = policy_patch_history(explained.get("events") or [])
    return explained


def default_policy_patch_preview() -> Dict[str, Any]:
    return explain_compiler.default_policy_patch_preview()



def default_policy_patch_history() -> Dict[str, Any]:
    return explain_compiler.default_policy_patch_history()



def default_self_review(*, fallback: bool = False) -> Dict[str, Any]:
    return explain_compiler.default_self_review(fallback=fallback)


def default_postmortem(process_id: str, *, fallback: bool = False) -> Dict[str, Any]:
    return explain_compiler.default_postmortem(process_id, fallback=fallback)


def default_incident_report() -> Dict[str, Any]:
    return explain_compiler.default_incident_report()


def assemble_runtime_policy_response(
    *,
    process_id: str,
    process: Dict[str, Any],
    explained: Dict[str, Any],
    explain_belief_fn: ExplainBeliefFn,
    get_belief_fn: GetBeliefFn,
) -> Dict[str, Any]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    policy_surface_sections = explain_compiler.compile_policy_surface_sections(
        policy,
        policy_outcome_evaluation=explained.get("policy_outcome_evaluation") if isinstance(explained.get("policy_outcome_evaluation"), list) else None,
    )
    response_sections = explain_compiler.compile_runtime_policy_response_sections(explained, process_id=process_id)
    return {
        "success": True,
        "process_id": process_id,
        "policy": policy,
        **policy_surface_sections,
        "belief_influences": explained.get("belief_influences") or policy_surface_sections.get("belief_influences") or [],
        "decision_explanations": explained.get("policy_decision_explanations") or explain.policy_decision_explanations(policy, explain_belief_fn=explain_belief_fn, get_belief_fn=get_belief_fn),
        "policy_outcome_evaluation": explained.get("policy_outcome_evaluation"),
        "control_plane_summary": explained.get("control_plane_summary") or policy_surface_sections.get("control_plane_summary"),
        "explain_atoms": explained.get("explain_atoms") or policy_surface_sections.get("explain_atoms") or explain_compiler.compile_explain_atoms(policy, policy_outcome_evaluation=explained.get("policy_outcome_evaluation") if isinstance(explained.get("policy_outcome_evaluation"), list) else None),
        "epistemic_timeline": explained.get("epistemic_timeline"),
        **response_sections,
    }


def assemble_runtime_self_review_response(*, process_id: str, explained: Optional[Dict[str, Any]] = None, fallback: bool = False) -> Dict[str, Any]:
    return {
        "success": True,
        "process_id": process_id,
        **explain_compiler.compile_runtime_shared_response_sections(explained, process_id=process_id, fallback=fallback),
    }


def assemble_runtime_postmortem_response(*, process_id: str, explained: Optional[Dict[str, Any]] = None, fallback: bool = False) -> Dict[str, Any]:
    return {
        "success": True,
        "process_id": process_id,
        **explain_compiler.compile_runtime_postmortem_response_sections(explained, process_id=process_id, fallback=fallback),
    }


__all__ = [
    "assemble_runtime_policy_response",
    "assemble_runtime_postmortem_response",
    "assemble_runtime_process_explain",
    "assemble_runtime_process_view",
    "assemble_runtime_self_review_response",
    "default_incident_report",
    "default_policy_patch_history",
    "default_policy_patch_preview",
    "default_postmortem",
    "default_self_review",
    "policy_patch_history",
]
