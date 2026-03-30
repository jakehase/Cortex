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
) -> Dict[str, Any]:
    workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
    metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    task_id = str(process.get("task_id") or metadata.get("task_id") or metadata.get("kernel_task_id") or "").strip() or None

    belief_rows = beliefs_for_task_fn(task_id, limit=200) if task_id else []
    summary = summarize_beliefs_fn(task_id=task_id) if task_id else summarize_beliefs_fn()
    belief_explanations: List[Dict[str, Any]] = []
    for row in belief_rows[:10]:
        claim_id = str(row.get("claim_id") or "")
        if not claim_id:
            continue
        explained_belief = explain_belief_fn(claim_id)
        if explained_belief:
            belief_explanations.append(explained_belief)

    results_by_node = process.get("results_by_node") if isinstance(process.get("results_by_node"), dict) else {}
    step_influences = explain_compiler.compile_step_belief_influences(
        workflow=workflow,
        results_by_node=results_by_node,
        task_id=task_id,
        explain_belief_fn=explain_belief_fn,
        get_belief_fn=get_belief_fn,
        select_influential_beliefs_fn=select_influential_beliefs_fn,
    )

    execution_trace_rows = explain.execution_trace(process)
    epistemic_timeline = explain.epistemic_timeline(step_influences, execution_trace_rows)
    drift_summary = explain.epistemic_drift_summary(step_influences)
    policy_evaluation = explain.policy_outcome_evaluation(
        policy=policy,
        process=process,
        execution_trace_rows=execution_trace_rows,
        step_influences=step_influences,
        belief_summary=summary,
    )
    policy_outcome_summary = explain.policy_outcome_summary(policy_evaluation)
    policy_decision_explanations = explain.policy_decision_explanations(policy, explain_belief_fn=explain_belief_fn, get_belief_fn=get_belief_fn)
    epistemic_sections = explain_compiler.compile_epistemic_summary_sections(
        belief_explanations=belief_explanations,
        decision_explanations=policy_decision_explanations,
    )
    policy_surface_sections = explain_compiler.compile_policy_surface_sections(
        policy,
        policy_outcome_evaluation=policy_evaluation,
    )
    observability_sections = explain_compiler.compile_observability_sections(
        process=process,
        policy=policy,
        execution_trace_rows=execution_trace_rows,
        policy_outcome_evaluation=policy_evaluation,
        epistemic_drift_summary=drift_summary,
        step_influences=step_influences,
        belief_summary=summary,
    )

    return {
        "success": True,
        "process_id": process_id,
        "process": process,
        "policy": policy,
        **policy_surface_sections,
        "policy_belief_influences": policy.get("belief_influences") if isinstance(policy, dict) else [],
        "policy_decision_explanations": policy_decision_explanations,
        "policy_outcome_evaluation": policy_evaluation,
        "policy_outcome_summary": policy_outcome_summary,
        "explain_atoms": policy_surface_sections.get("explain_atoms") or explain_compiler.compile_explain_atoms(policy, policy_outcome_evaluation=policy_evaluation),
        "beliefs": belief_rows,
        "belief_summary": summary,
        "belief_explanations": belief_explanations,
        **epistemic_sections,
        "step_belief_influences": step_influences,
        "execution_trace": execution_trace_rows,
        "epistemic_timeline": epistemic_timeline,
        "epistemic_drift_summary": drift_summary,
        **observability_sections,
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
) -> Dict[str, Any]:
    explained = assemble_runtime_process_explain(
        process_id=process_id,
        process=process,
        beliefs_for_task_fn=beliefs_for_task_fn,
        summarize_beliefs_fn=summarize_beliefs_fn,
        explain_belief_fn=explain_belief_fn,
        get_belief_fn=get_belief_fn,
        select_influential_beliefs_fn=select_influential_beliefs_fn,
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
