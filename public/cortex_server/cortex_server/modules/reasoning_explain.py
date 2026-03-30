from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from cortex_server.modules.reasoning_failures import (
    FAILURE_POLICY_CONTRACTS,
    FAILURE_POST_VERIFICATION,
    FAILURE_PRE_VERIFICATION,
)
from cortex_server.modules.reasoning_explain_epistemics import (
    belief_evidence_summary,
    contradiction_graph_summary,
    decision_causality_summary,
    epistemic_core_summary,
    epistemic_risk_summary,
)


GetBeliefFn = Callable[[str], Optional[Dict[str, Any]]]
ExplainBeliefFn = Callable[[str], Optional[Dict[str, Any]]]



def belief_id_delta(captured_ids: List[str], current_ids: List[str]) -> Dict[str, Any]:
    captured = [str(x) for x in (captured_ids or []) if str(x).strip()]
    current = [str(x) for x in (current_ids or []) if str(x).strip()]
    captured_set = set(captured)
    current_set = set(current)
    return {
        "captured_ids": captured,
        "current_ids": current,
        "added_ids": sorted(current_set - captured_set),
        "removed_ids": sorted(captured_set - current_set),
        "unchanged_ids": sorted(captured_set & current_set),
        "changed": captured_set != current_set,
    }



def belief_summary_text(belief: Dict[str, Any]) -> str:
    subject = str(belief.get("subject") or "?")
    predicate = str(belief.get("predicate") or "?")
    value = belief.get("value")
    status = str(belief.get("status") or "unknown")
    conf = belief.get("decayed_confidence", belief.get("confidence"))
    fresh = belief.get("decayed_freshness", belief.get("freshness"))
    return f"{subject}:{predicate}={value} [{status}; conf={conf}; fresh={fresh}]"



def summarize_belief_ids(belief_ids: List[str], *, get_belief_fn: GetBeliefFn, limit: int = 3) -> List[str]:
    out: List[str] = []
    for belief_id in [str(x) for x in (belief_ids or []) if str(x).strip()][: max(0, int(limit))]:
        belief = get_belief_fn(belief_id)
        if belief:
            out.append(belief_summary_text(belief))
    return out



def impact_attribution_from_beliefs(*, belief_ids: List[str], produced_belief_ids: List[str], success: Optional[bool], error: Optional[str], get_belief_fn: GetBeliefFn) -> Dict[str, Any]:
    scored: List[tuple[float, Dict[str, Any]]] = []
    for belief_id in [str(x) for x in (belief_ids or []) if str(x).strip()]:
        belief = get_belief_fn(belief_id)
        if not belief:
            continue
        score = float(belief.get("decayed_confidence", 0.0) or 0.0) + float(belief.get("decayed_freshness", 0.0) or 0.0)
        status = str(belief.get("status") or "")
        if success is False and status in {"stale", "contradicted"}:
            score += 2.0
        if success is True and status == "active":
            score += 1.0
        if produced_belief_ids and belief_id in produced_belief_ids:
            score += 0.5
        scored.append((score, belief))
    scored.sort(key=lambda item: item[0], reverse=True)
    top = [belief for _, belief in scored[:3]]
    return {
        "top_belief_ids": [str(row.get("claim_id") or "") for row in top if str(row.get("claim_id") or "").strip()],
        "top_belief_summaries": [belief_summary_text(row) for row in top],
        "success": success,
        "error": error,
    }



def step_operator_summary(*, title: Optional[str], belief_count: int, changed: bool, produced_belief_ids: List[str], impact: Dict[str, Any]) -> str:
    prefix = str(title or "step")
    impact_bits = impact.get("top_belief_summaries") or []
    pieces = [f"{prefix}: {belief_count} linked beliefs"]
    if changed:
        pieces.append("belief context drifted after execution")
    if produced_belief_ids:
        pieces.append(f"produced {len(produced_belief_ids)} beliefs")
    if impact_bits:
        pieces.append(f"top influence: {impact_bits[0]}")
    return "; ".join(pieces)



def epistemic_drift_summary(step_influences: List[Dict[str, Any]]) -> Dict[str, Any]:
    changed = [row for row in (step_influences or []) if bool(((row.get("belief_delta") or {}).get("changed")))]
    return {
        "step_count": len(step_influences or []),
        "changed_step_count": len(changed),
        "changed_nodes": [str(row.get("node_id") or "") for row in changed if str(row.get("node_id") or "").strip()],
        "produced_belief_total": sum(len(row.get("produced_belief_ids") or []) for row in (step_influences or [])),
    }



def execution_trace(process: Dict[str, Any]) -> List[Dict[str, Any]]:
    workflow_steps = ((process.get("workflow") or {}).get("steps") or []) if isinstance(process.get("workflow"), dict) else []
    nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}
    results = process.get("results_by_node") if isinstance(process.get("results_by_node"), dict) else {}
    trace: List[Dict[str, Any]] = []
    for idx, step in enumerate(workflow_steps, start=1):
        node_id = str((step or {}).get("node_id") or f"step_{idx}")
        node = nodes.get(node_id) if isinstance(nodes.get(node_id), dict) else {}
        result = results.get(node_id) if isinstance(results.get(node_id), dict) else {}
        trace.append(
            {
                "order": idx,
                "node_id": node_id,
                "title": (step or {}).get("title"),
                "status": node.get("status") or result.get("status"),
                "attempts": int((result.get("attempts") if result else node.get("attempts", 0)) or 0),
                "elapsed_ms": result.get("elapsed_ms"),
                "success": result.get("success"),
                "error": result.get("error") or node.get("last_error"),
                "error_code": result.get("error_code") or node.get("last_error_code"),
                "produced_belief_count": int(result.get("produced_belief_count", 0) or 0),
                "homeostasis_mode": ((result.get("homeostasis") or {}).get("mode") if isinstance(result.get("homeostasis"), dict) else None),
                "homeostasis_prefer_chain": ((result.get("homeostasis") or {}).get("prefer_chain") if isinstance(result.get("homeostasis"), dict) else None),
                "routing_selected_chain": ((result.get("routing") or {}).get("selected_chain") if isinstance(result.get("routing"), dict) else None),
                "routing_override_reason": ((result.get("routing") or {}).get("override_reason") if isinstance(result.get("routing"), dict) else None),
                "world_state_entity_count": ((result.get("world_state") or {}).get("entity_count") if isinstance(result.get("world_state"), dict) else None),
                "modulation_tempo": ((result.get("modulation") or {}).get("tempo") if isinstance(result.get("modulation"), dict) else None),
                "workspace_selected": ((result.get("workspace") or {}).get("selected") if isinstance(result.get("workspace"), dict) else None),
                "truth_guard_action": ((result.get("truth_engine") or {}).get("guard_action") if isinstance(result.get("truth_engine"), dict) else None),
                "plasticity_alert": ((result.get("plasticity") or {}).get("alert") if isinstance(result.get("plasticity"), dict) else None),
                "embodiment_risk": ((result.get("embodiment") or {}).get("risk") if isinstance(result.get("embodiment"), dict) else None),
                "runtime_step_timeout_seconds": (((result.get("homeostasis") or {}).get("runtime_controls") or {}).get("step_timeout_seconds") if isinstance((result.get("homeostasis") or {}).get("runtime_controls"), dict) else (((result.get("routing") or {}).get("runtime_controls") or {}).get("step_timeout_seconds") if isinstance((result.get("routing") or {}).get("runtime_controls"), dict) else (((result.get("embodiment") or {}).get("runtime_controls") or {}).get("step_timeout_seconds") if isinstance((result.get("embodiment") or {}).get("runtime_controls"), dict) else None))),
            }
        )
    return trace



def epistemic_timeline(step_influences: List[Dict[str, Any]], execution_trace_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    trace_by_node = {str(row.get("node_id") or ""): row for row in (execution_trace_rows or []) if str(row.get("node_id") or "").strip()}
    timeline: List[Dict[str, Any]] = []
    for order, influence in enumerate(step_influences or [], start=1):
        node_id = str(influence.get("node_id") or "")
        trace = trace_by_node.get(node_id, {})
        delta = influence.get("belief_delta") if isinstance(influence.get("belief_delta"), dict) else {}
        timeline.append(
            {
                "order": int(trace.get("order") or order),
                "node_id": node_id,
                "title": influence.get("title"),
                "status": trace.get("status"),
                "success": trace.get("success"),
                "produced_belief_count": len(influence.get("produced_belief_ids") or []),
                "belief_count": int(influence.get("belief_count", 0) or 0),
                "drift_changed": bool(delta.get("changed")),
                "added_belief_ids": list(delta.get("added_ids") or []),
                "removed_belief_ids": list(delta.get("removed_ids") or []),
                "operator_summary": influence.get("operator_summary"),
            }
        )
    timeline.sort(key=lambda row: int(row.get("order") or 0))
    return timeline



def policy_outcome_evaluation(*, policy: Dict[str, Any], process: Dict[str, Any], execution_trace_rows: List[Dict[str, Any]], step_influences: List[Dict[str, Any]], belief_summary: Dict[str, Any]) -> List[Dict[str, Any]]:
    policy = policy if isinstance(policy, dict) else {}
    settings = policy.get("settings") if isinstance(policy.get("settings"), dict) else {}
    process_status = str(process.get("status") or "unknown")
    recurrence = process.get("recurrence") if isinstance(process.get("recurrence"), dict) else {}
    failures = [row for row in (execution_trace_rows or []) if row.get("success") is False]
    drift_changed = sum(1 for row in (step_influences or []) if bool(((row.get("belief_delta") or {}).get("changed"))))
    evaluations: List[Dict[str, Any]] = []
    for decision in list(policy.get("decisions") or []):
        if not isinstance(decision, dict):
            continue
        domain = str(decision.get("domain") or "")
        chosen = decision.get("chosen")
        outcome = "observed"
        expected: Dict[str, Any] = {}
        observed: Dict[str, Any] = {}
        comparison: Dict[str, Any] = {}
        if domain == "scheduler":
            expected = {
                "cadence_seconds": 0 if chosen == "immediate" else ">=0 managed runtime",
                "status_family": "runtime_managed",
            }
            observed = {
                "process_status": process_status,
                "step_count": len(execution_trace_rows or []),
                "chosen_execution_mode": settings.get("execution_mode"),
                "cadence_seconds": recurrence.get("cadence_seconds"),
            }
            if chosen == "immediate":
                outcome = "match" if int(recurrence.get("cadence_seconds", 0) or 0) == 0 else "mismatch"
            elif chosen == "managed_runtime":
                outcome = "match" if process_status in {"scheduled", "running", "completed", "failed", "cancelled", "paused"} else "unclear"
            comparison = {"cadence_match": outcome != "mismatch", "managed_runtime_visible": process_status in {"scheduled", "running", "completed", "failed", "cancelled", "paused"}}
        elif domain == "verification":
            strict = str(chosen or "") == "strict"
            verification_related_failures = sum(
                1
                for row in failures
                if str(row.get("error_code") or "") in {FAILURE_POLICY_CONTRACTS, FAILURE_PRE_VERIFICATION, FAILURE_POST_VERIFICATION}
            )
            observed_mode = str(settings.get("verification_mode") or "basic")
            expected = {"verification_mode": "strict" if strict else "basic"}
            observed = {"failure_count": verification_related_failures, "strict": strict, "verification_mode": observed_mode}
            outcome = "match" if observed_mode == expected["verification_mode"] else "mismatch"
            comparison = {"mode_match": observed_mode == expected["verification_mode"], "verification_failures": verification_related_failures}
        elif domain == "memory":
            expected = {"memory_posture": chosen}
            observed = {"belief_count": belief_summary.get("count", 0), "produced_belief_total": sum(int(row.get("produced_belief_count", 0) or 0) for row in (execution_trace_rows or [])), "drift_changed_steps": drift_changed}
            outcome = "match" if observed["belief_count"] >= 0 else "observed"
            comparison = {"belief_activity_present": observed["belief_count"] >= 0, "drift_changed_steps": drift_changed}
        elif domain == "routing":
            expected_mode = "parallel" if str(chosen or "") == "deliberate" else "sequential"
            observed = {
                "dependency_density": policy.get("dependency_density"),
                "parallelism": settings.get("max_parallelism"),
                "execution_mode": settings.get("execution_mode"),
                "homeostasis_prefer_chain": settings.get("homeostasis_prefer_chain"),
                "routing_selected_chain": settings.get("routing_selected_chain"),
                "routing_override_reason": settings.get("routing_override_reason"),
            }
            expected = {
                "execution_mode": expected_mode,
                "selected_chain": (decision.get("inputs") or {}).get("r9_selected_chain"),
            }
            observed_mode = str(settings.get("execution_mode") or "")
            observed_chain = settings.get("routing_selected_chain")
            if observed_mode:
                outcome = "match" if observed_mode == expected_mode else "mismatch"
            comparison = {
                "execution_mode_match": observed_mode == expected_mode if observed_mode else None,
                "selected_chain_match": observed_chain == expected.get("selected_chain") if expected.get("selected_chain") else None,
            }
        elif domain == "routing_r9":
            expected = {
                "selected_chain": chosen,
                "coarse_choice": (decision.get("inputs") or {}).get("coarse_choice"),
            }
            observed = {
                "selected_chain": settings.get("routing_selected_chain"),
                "default_chain": settings.get("routing_default_chain"),
                "allowed_chain_ids": settings.get("routing_allowed_chain_ids"),
                "utility": settings.get("routing_r9_utility"),
                "override_reason": settings.get("routing_override_reason"),
            }
            outcome = "match" if observed.get("selected_chain") == chosen else "mismatch"
            comparison = {
                "selected_chain_match": observed.get("selected_chain") == chosen,
                "coarse_choice_match": (decision.get("inputs") or {}).get("coarse_choice") == ("deliberate" if chosen in {"deliberate_council", "research_grounded"} else "fastlane"),
            }
        elif domain == "homeostasis":
            homeostasis = policy.get("homeostasis") if isinstance(policy.get("homeostasis"), dict) else {}
            effort = homeostasis.get("effort") if isinstance(homeostasis.get("effort"), dict) else {}
            guardrails = homeostasis.get("guardrails") if isinstance(homeostasis.get("guardrails"), dict) else {}
            expected = {
                "mode": chosen,
                "prefer_chain": (decision.get("inputs") or {}).get("prefer_chain"),
                "reasoning_depth": (decision.get("inputs") or {}).get("reasoning_depth"),
            }
            observed = {
                "mode": settings.get("homeostasis_mode") or homeostasis.get("mode"),
                "intent": settings.get("homeostasis_intent") or homeostasis.get("intent"),
                "risk_tier": settings.get("homeostasis_risk_tier") or homeostasis.get("risk_tier"),
                "prefer_chain": settings.get("homeostasis_prefer_chain") or guardrails.get("prefer_chain"),
                "reasoning_depth": settings.get("homeostasis_reasoning_depth") or effort.get("reasoning_depth"),
                "human_review_required": settings.get("homeostasis_human_review_required"),
                "escalation_recommended": settings.get("homeostasis_escalation_recommended"),
            }
            outcome = "match" if str(observed.get("mode") or "") == str(chosen or "") else "mismatch"
            comparison = {
                "mode_match": str(observed.get("mode") or "") == str(chosen or ""),
                "prefer_chain_match": expected.get("prefer_chain") == observed.get("prefer_chain"),
                "reasoning_depth_match": expected.get("reasoning_depth") == observed.get("reasoning_depth"),
            }
        elif domain == "world_state":
            expected = {
                "tracked": chosen,
                "entity_count": (decision.get("inputs") or {}).get("entity_count"),
            }
            observed = {
                "entity_count": settings.get("world_state_entity_count"),
                "avg_confidence": settings.get("world_state_avg_confidence"),
                "low_confidence_entities": settings.get("world_state_low_confidence_entities"),
                "verification_mode": settings.get("verification_mode"),
            }
            outcome = "match" if (chosen == "tracked" and int(observed.get("entity_count", 0) or 0) >= 1) or (chosen == "empty" and int(observed.get("entity_count", 0) or 0) == 0) else "mismatch"
            comparison = {
                "entity_count_match": int(observed.get("entity_count", 0) or 0) == int(expected.get("entity_count", 0) or 0),
                "tracked_match": outcome == "match",
            }
        elif domain == "modulation":
            expected = {
                "tempo": chosen,
                "reasoning_depth": (decision.get("inputs") or {}).get("reasoning_depth"),
            }
            observed = {
                "tempo": settings.get("modulation_tempo"),
                "reasoning_depth": settings.get("modulation_reasoning_depth"),
                "deep_reasoning_required": settings.get("modulation_deep_reasoning_required"),
                "step_timeout_seconds": settings.get("step_timeout_seconds"),
            }
            outcome = "match" if observed.get("tempo") == chosen else "mismatch"
            comparison = {
                "tempo_match": observed.get("tempo") == chosen,
                "reasoning_depth_match": observed.get("reasoning_depth") == expected.get("reasoning_depth"),
            }
        elif domain == "workspace":
            expected = {
                "selected": chosen,
                "broadcast_count": (decision.get("inputs") or {}).get("broadcast_count"),
            }
            observed = {
                "selected": settings.get("workspace_selected_specialist"),
                "broadcast_count": settings.get("workspace_broadcast_count"),
                "same_tick_drain": settings.get("same_tick_drain"),
            }
            outcome = "match" if observed.get("selected") == chosen else "mismatch"
            comparison = {
                "selected_match": observed.get("selected") == chosen,
                "broadcast_count_match": observed.get("broadcast_count") == expected.get("broadcast_count"),
            }
        elif domain == "truth_engine":
            expected = {
                "guard_action": chosen,
                "calibrated_confidence": (decision.get("inputs") or {}).get("calibrated_confidence"),
            }
            observed = {
                "guard_action": settings.get("truth_guard_action"),
                "calibrated_confidence": settings.get("truth_calibrated_confidence"),
                "contradiction_count": settings.get("truth_contradiction_count"),
                "verification_mode": settings.get("verification_mode"),
            }
            outcome = "match" if observed.get("guard_action") == chosen else "mismatch"
            comparison = {
                "guard_action_match": observed.get("guard_action") == chosen,
                "confidence_match": observed.get("calibrated_confidence") == expected.get("calibrated_confidence"),
            }
        elif domain == "plasticity":
            expected = {
                "state": chosen,
                "rollback_recommended": (decision.get("inputs") or {}).get("rollback_recommended"),
            }
            observed = {
                "alert": settings.get("plasticity_alert"),
                "rollback_recommended": settings.get("plasticity_rollback_recommended"),
                "reasons": settings.get("plasticity_reasons"),
            }
            observed_state = "alert" if bool(observed.get("alert")) else "stable"
            outcome = "match" if observed_state == chosen else "mismatch"
            comparison = {
                "state_match": observed_state == chosen,
                "rollback_match": observed.get("rollback_recommended") == expected.get("rollback_recommended"),
            }
        elif domain == "embodiment":
            expected = {
                "risk": chosen,
                "pause_noncritical_work": (decision.get("inputs") or {}).get("pause_noncritical_work"),
            }
            observed = {
                "risk": settings.get("embodiment_risk"),
                "pause_noncritical_work": settings.get("embodiment_pause_noncritical_work"),
                "execution_mode": settings.get("execution_mode"),
                "verification_mode": settings.get("verification_mode"),
            }
            outcome = "match" if observed.get("risk") == chosen else "mismatch"
            comparison = {
                "risk_match": observed.get("risk") == chosen,
                "pause_match": observed.get("pause_noncritical_work") == expected.get("pause_noncritical_work"),
            }
        evaluations.append({
            "domain": domain,
            "chosen": chosen,
            "rationale": decision.get("rationale"),
            "expected": expected,
            "observed": observed,
            "comparison": comparison,
            "outcome": outcome,
            "operator_summary": f"{domain}: chose {chosen}; expected {expected}; observed {observed}; outcome={outcome}",
        })
    return evaluations



def policy_outcome_summary(evaluations: List[Dict[str, Any]]) -> Dict[str, Any]:
    rows = [dict(row) for row in (evaluations or []) if isinstance(row, dict)]
    counts: Dict[str, int] = {}
    domains_by_outcome: Dict[str, List[str]] = {}
    for row in rows:
        outcome = str(row.get("outcome") or "observed")
        domain = str(row.get("domain") or "")
        counts[outcome] = counts.get(outcome, 0) + 1
        domains_by_outcome.setdefault(outcome, []).append(domain)
    mismatch_domains = domains_by_outcome.get("mismatch", [])
    unclear_domains = domains_by_outcome.get("unclear", [])
    if mismatch_domains:
        overall = "mismatch_present"
    elif unclear_domains:
        overall = "partially_unclear"
    elif counts.get("match"):
        overall = "mostly_match"
    else:
        overall = "observed_only"
    return {
        "overall": overall,
        "counts": counts,
        "domains_by_outcome": domains_by_outcome,
        "mismatch_domains": mismatch_domains,
        "unclear_domains": unclear_domains,
        "operator_summary": f"policy outcomes: overall={overall}; counts={counts}",
    }





def policy_decision_explanations(policy: Optional[Dict[str, Any]], *, explain_belief_fn: ExplainBeliefFn, get_belief_fn: GetBeliefFn) -> List[Dict[str, Any]]:
    policy = policy if isinstance(policy, dict) else {}
    decisions = list(policy.get("decisions") or [])
    out: List[Dict[str, Any]] = []
    for decision in decisions:
        if not isinstance(decision, dict):
            continue
        inputs = decision.get("inputs") if isinstance(decision.get("inputs"), dict) else {}
        belief_ids = [str(x) for x in (inputs.get("belief_ids") or []) if str(x).strip()]
        belief_explanations = []
        causality_rows: List[Dict[str, Any]] = []
        for belief_id in belief_ids[:5]:
            explained = explain_belief_fn(belief_id)
            if explained:
                belief_explanations.append(explained)
                belief = explained.get("belief") if isinstance(explained.get("belief"), dict) else {}
                evidence_bundle = explained.get("evidence_bundle") if isinstance(explained.get("evidence_bundle"), dict) else {}
                contradiction_summary = explained.get("contradiction_summary") if isinstance(explained.get("contradiction_summary"), dict) else {}
                weighted_confidence = float(evidence_bundle.get("weighted_confidence", belief.get("decayed_confidence", belief.get("confidence", 0.0)) or 0.0) or 0.0)
                weighted_freshness = float(evidence_bundle.get("weighted_freshness", belief.get("decayed_freshness", belief.get("freshness", 0.0)) or 0.0) or 0.0)
                conflict_penalty = min(0.5, 0.1 * int(contradiction_summary.get("conflict_count", 0) or 0))
                causal_score = round(max(0.0, weighted_confidence + weighted_freshness - conflict_penalty), 4)
                causality_rows.append(
                    {
                        "claim_id": belief.get("claim_id"),
                        "summary": belief_summary_text(belief),
                        "weighted_confidence": weighted_confidence,
                        "weighted_freshness": weighted_freshness,
                        "conflict_count": int(contradiction_summary.get("conflict_count", 0) or 0),
                        "source_weight_avg": float(evidence_bundle.get("source_weight_avg", 0.0) or 0.0),
                        "causal_score": causal_score,
                    }
                )
        causality_rows.sort(key=lambda row: float(row.get("causal_score", 0.0) or 0.0), reverse=True)
        belief_summary_texts = summarize_belief_ids(belief_ids, get_belief_fn=get_belief_fn, limit=3)
        top_summary = causality_rows[0]["summary"] if causality_rows else (belief_summary_texts[0] if belief_summary_texts else None)
        operator_summary = f"{decision.get('domain')}: chose {decision.get('chosen')} using {len(belief_ids)} beliefs"
        if top_summary:
            operator_summary += f"; top causal evidence: {top_summary}"
        out.append({
            "domain": decision.get("domain"),
            "chosen": decision.get("chosen"),
            "rationale": decision.get("rationale"),
            "confidence": decision.get("confidence"),
            "belief_ids": belief_ids,
            "belief_count": len(belief_ids),
            "belief_explanations": belief_explanations,
            "belief_summary_texts": belief_summary_texts,
            "decision_causality": {
                "rows": causality_rows,
                "top_belief_ids": [str(row.get("claim_id") or "") for row in causality_rows[:3] if str(row.get("claim_id") or "").strip()],
                "operator_summary": f"{len(causality_rows)} weighted causal links",
            },
            "operator_summary": operator_summary,
            "inputs": inputs,
        })
    return out


__all__ = [
    "belief_evidence_summary",
    "belief_id_delta",
    "belief_summary_text",
    "contradiction_graph_summary",
    "decision_causality_summary",
    "epistemic_core_summary",
    "epistemic_risk_summary",
    "epistemic_risk_summary",
    "epistemic_drift_summary",
    "epistemic_timeline",
    "execution_trace",
    "impact_attribution_from_beliefs",
    "policy_decision_explanations",
    "policy_outcome_evaluation",
    "policy_outcome_summary",
    "step_operator_summary",
    "summarize_belief_ids",
]
