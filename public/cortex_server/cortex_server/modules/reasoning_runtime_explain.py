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
    rows: List[Dict[str, Any]] = []
    for event in events or []:
        kind = str((event or {}).get("kind") or "")
        if not isinstance(event, dict) or kind not in {"policy_patch_applied", "policy_patch_rolled_back"}:
            continue
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        applied_settings = [dict(row) for row in (payload.get("applied_settings") or []) if isinstance(row, dict)]
        metadata_overrides = dict(payload.get("metadata_overrides") or {})
        if not metadata_overrides:
            metadata_overrides = {str(row.get("setting") or ""): row.get("after") for row in applied_settings if str(row.get("setting") or "").strip()}
        rows.append(
            {
                "event_id": event.get("event_id"),
                "revision_id": payload.get("revision_id"),
                "recommendation_version": payload.get("recommendation_version"),
                "kind": kind,
                "ts": event.get("ts"),
                "applied_count": int(payload.get("applied_count", len(applied_settings)) or 0),
                "settings": [str(x) for x in (payload.get("settings") or []) if str(x).strip()],
                "requested_settings": [str(x) for x in (payload.get("requested_settings") or []) if str(x).strip()],
                "applied_settings": applied_settings,
                "metadata_overrides": metadata_overrides,
                "previous_values": dict(payload.get("previous_values") or {}),
                "operator_overrides": dict(payload.get("operator_overrides") or {}),
                "audit": dict(payload.get("audit") or {}),
                "allow_confirmation_required": bool(payload.get("allow_confirmation_required", False)),
                "allow_intervening_revisions": bool(payload.get("allow_intervening_revisions", False)),
                "intervening_revisions": [dict(row) for row in (payload.get("intervening_revisions") or []) if isinstance(row, dict)],
                "rolled_back_from_revision_id": payload.get("rolled_back_from_revision_id"),
            }
        )
    return {"count": len(rows), "entries": rows}





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
    step_influences: List[Dict[str, Any]] = []
    for idx, raw_step in enumerate(workflow.get("steps") or [], start=1):
        step = dict(raw_step or {})
        node_id = str(step.get("node_id") or f"step_{idx}")
        title = step.get("title") or node_id
        step_metadata = step.get("metadata") if isinstance(step.get("metadata"), dict) else {}
        filters = {
            "subjects": [str(x) for x in (step_metadata.get("belief_subjects") or []) if str(x).strip()],
            "predicates": [str(x) for x in (step_metadata.get("belief_predicates") or []) if str(x).strip()],
            "query": step_metadata.get("belief_query"),
        }
        result = results_by_node.get(node_id) if isinstance(results_by_node.get(node_id), dict) else {}
        captured_context = result.get("belief_context") if isinstance(result.get("belief_context"), dict) else None
        captured_ids = [str(x) for x in ((captured_context or {}).get("selected_ids") or []) if str(x).strip()]
        current_selected = select_influential_beliefs_fn(
            task_id=task_id,
            subjects=filters["subjects"] or None,
            predicates=filters["predicates"] or None,
            query=filters["query"],
            limit=8,
        )
        current_ids = [str(row.get("claim_id") or "") for row in current_selected if str(row.get("claim_id") or "").strip()]
        effective_ids = captured_ids if captured_context else current_ids
        belief_delta = explain.belief_id_delta(captured_ids if captured_context else current_ids, current_ids)
        produced_belief_ids = [str(x) for x in (result.get("produced_belief_ids") or []) if str(x).strip()]
        impact_attribution = explain.impact_attribution_from_beliefs(
            belief_ids=effective_ids,
            produced_belief_ids=produced_belief_ids,
            success=result.get("success"),
            error=result.get("error"),
            get_belief_fn=get_belief_fn,
        )
        belief_summary_texts = explain.summarize_belief_ids(effective_ids, get_belief_fn=get_belief_fn, limit=3)
        step_influences.append(
            {
                "order": idx,
                "node_id": node_id,
                "title": title,
                "filters": filters,
                "captured_at_execution": bool(captured_context),
                "captured_belief_ids": captured_ids,
                "current_belief_ids": current_ids,
                "belief_ids": effective_ids,
                "belief_count": len(effective_ids),
                "belief_summary_texts": belief_summary_texts,
                "belief_explanations": [explained_row for explained_row in (explain_belief_fn(belief_id) for belief_id in effective_ids[:5]) if explained_row],
                "belief_delta": belief_delta,
                "produced_belief_ids": produced_belief_ids,
                "impact_attribution": impact_attribution,
                "operator_summary": explain.step_operator_summary(
                    title=title,
                    belief_count=len(effective_ids),
                    changed=bool(belief_delta.get("changed")),
                    produced_belief_ids=produced_belief_ids,
                    impact=impact_attribution,
                ),
            }
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
