from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from cortex_server.modules.reasoning_failures import (
    FAILURE_POLICY_CONTRACTS,
    FAILURE_POST_VERIFICATION,
    FAILURE_PRE_VERIFICATION,
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
                "runtime_step_timeout_seconds": (((result.get("homeostasis") or {}).get("runtime_controls") or {}).get("step_timeout_seconds") if isinstance((result.get("homeostasis") or {}).get("runtime_controls"), dict) else (((result.get("routing") or {}).get("runtime_controls") or {}).get("step_timeout_seconds") if isinstance((result.get("routing") or {}).get("runtime_controls"), dict) else None)),
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



def belief_evidence_summary(belief_explanations: List[Dict[str, Any]]) -> Dict[str, Any]:
    explanations = [dict(row) for row in (belief_explanations or []) if isinstance(row, dict)]
    source_types: Dict[str, int] = {}
    weighted_confidences: List[float] = []
    weighted_freshnesses: List[float] = []
    top_rows: List[tuple[float, str]] = []
    evidence_count = 0
    for row in explanations:
        belief = row.get("belief") if isinstance(row.get("belief"), dict) else {}
        bundle = row.get("evidence_bundle") if isinstance(row.get("evidence_bundle"), dict) else {}
        evidence_count += int(bundle.get("evidence_count", 0) or 0)
        for src, count in dict(bundle.get("source_types") or {}).items():
            source_types[str(src)] = source_types.get(str(src), 0) + int(count or 0)
        wc = float(bundle.get("weighted_confidence", belief.get("decayed_confidence", belief.get("confidence", 0.0)) or 0.0) or 0.0)
        wf = float(bundle.get("weighted_freshness", belief.get("decayed_freshness", belief.get("freshness", 0.0)) or 0.0) or 0.0)
        weighted_confidences.append(wc)
        weighted_freshnesses.append(wf)
        claim_id = str(belief.get("claim_id") or "")
        if claim_id:
            top_rows.append((wc + wf, claim_id))
    top_rows.sort(reverse=True)
    return {
        "belief_count": len(explanations),
        "evidence_count": evidence_count,
        "source_types": source_types,
        "avg_weighted_confidence": round(sum(weighted_confidences) / len(weighted_confidences), 4) if weighted_confidences else 0.0,
        "avg_weighted_freshness": round(sum(weighted_freshnesses) / len(weighted_freshnesses), 4) if weighted_freshnesses else 0.0,
        "top_belief_ids": [claim_id for _, claim_id in top_rows[:5]],
        "operator_summary": f"{len(explanations)} beliefs, {evidence_count} evidence items, sources={sorted(source_types)}",
    }



def contradiction_graph_summary(belief_explanations: List[Dict[str, Any]]) -> Dict[str, Any]:
    explanations = [dict(row) for row in (belief_explanations or []) if isinstance(row, dict)]
    node_ids: set[str] = set()
    edge_keys: set[tuple[str, str, str]] = set()
    conflict_count = 0
    ambiguity_scores: List[float] = []
    cluster_keys: set[tuple[str, str]] = set()
    for row in explanations:
        belief = row.get("belief") if isinstance(row.get("belief"), dict) else {}
        claim_id = str(belief.get("claim_id") or "")
        if claim_id:
            node_ids.add(claim_id)
        graph = row.get("lineage_graph") if isinstance(row.get("lineage_graph"), dict) else {}
        for node in list(graph.get("nodes") or []):
            if isinstance(node, dict) and str(node.get("claim_id") or ""):
                node_ids.add(str(node.get("claim_id") or ""))
        for edge in list(graph.get("edges") or []):
            if not isinstance(edge, dict):
                continue
            edge_keys.add((str(edge.get("from") or ""), str(edge.get("to") or ""), str(edge.get("kind") or "")))
        contradiction_summary = row.get("contradiction_summary") if isinstance(row.get("contradiction_summary"), dict) else {}
        conflict_count += int(contradiction_summary.get("conflict_count", 0) or 0)
        cluster = row.get("contradiction_cluster") if isinstance(row.get("contradiction_cluster"), dict) else {}
        subj = str(cluster.get("subject") or belief.get("subject") or "")
        pred = str(cluster.get("predicate") or belief.get("predicate") or "")
        if subj and pred:
            cluster_keys.add((subj, pred))
        ambiguity_scores.append(float(cluster.get("ambiguity_score", contradiction_summary.get("ambiguity_score", 0.0)) or 0.0))
    contradiction_edges = [edge for edge in edge_keys if edge[2] == "contradicts"]
    supersession_edges = [edge for edge in edge_keys if edge[2] == "supersedes"]
    avg_ambiguity = round(sum(ambiguity_scores) / len(ambiguity_scores), 4) if ambiguity_scores else 0.0
    return {
        "node_count": len(node_ids),
        "edge_count": len(edge_keys),
        "cluster_count": len(cluster_keys),
        "contradiction_edge_count": len(contradiction_edges),
        "supersession_edge_count": len(supersession_edges),
        "conflict_count": conflict_count,
        "avg_ambiguity_score": avg_ambiguity,
        "operator_summary": f"graph: {len(node_ids)} beliefs, {len(contradiction_edges)} contradiction edges, {len(supersession_edges)} supersession edges, ambiguity={avg_ambiguity}",
    }



def decision_causality_summary(decision_explanations: List[Dict[str, Any]]) -> Dict[str, Any]:
    rows = [dict(row) for row in (decision_explanations or []) if isinstance(row, dict)]
    top_rows: List[tuple[float, str, str]] = []
    domain_count: Dict[str, int] = {}
    for row in rows:
        domain = str(row.get("domain") or "")
        if domain:
            domain_count[domain] = domain_count.get(domain, 0) + 1
        causality = row.get("decision_causality") if isinstance(row.get("decision_causality"), dict) else {}
        for item in list(causality.get("rows") or []):
            if not isinstance(item, dict):
                continue
            claim_id = str(item.get("claim_id") or "")
            if claim_id:
                top_rows.append((float(item.get("causal_score", 0.0) or 0.0), claim_id, domain))
    top_rows.sort(reverse=True)
    avg_score = round(sum(score for score, _, _ in top_rows) / len(top_rows), 4) if top_rows else 0.0
    return {
        "decision_count": len(rows),
        "domains": domain_count,
        "top_belief_ids": [claim_id for _, claim_id, _ in top_rows[:5]],
        "top_links": [{"claim_id": claim_id, "domain": domain, "causal_score": round(score, 4)} for score, claim_id, domain in top_rows[:5]],
        "avg_causal_score": avg_score,
        "operator_summary": f"{len(rows)} decision explanations; top causal links={min(5, len(top_rows))}; avg_score={avg_score}",
    }



def epistemic_risk_summary(belief_explanations: List[Dict[str, Any]]) -> Dict[str, Any]:
    explanations = [dict(row) for row in (belief_explanations or []) if isinstance(row, dict)]
    risk_rows: List[tuple[float, str, str]] = []
    level_counts: Dict[str, int] = {}
    for row in explanations:
        belief = row.get("belief") if isinstance(row.get("belief"), dict) else {}
        risk = row.get("epistemic_risk") if isinstance(row.get("epistemic_risk"), dict) else {}
        claim_id = str(belief.get("claim_id") or "")
        level = str(risk.get("risk_level") or "low")
        level_counts[level] = level_counts.get(level, 0) + 1
        if claim_id:
            risk_rows.append((float(risk.get("risk_score", 0.0) or 0.0), claim_id, level))
    risk_rows.sort(reverse=True)
    avg_risk = round(sum(score for score, _, _ in risk_rows) / len(risk_rows), 4) if risk_rows else 0.0
    return {
        "belief_count": len(explanations),
        "avg_risk_score": avg_risk,
        "levels": level_counts,
        "top_risky_belief_ids": [claim_id for score, claim_id, _ in risk_rows[:5] if score > 0],
        "top_risky_links": [{"claim_id": claim_id, "risk_level": level, "risk_score": round(score, 4)} for score, claim_id, level in risk_rows[:5] if score > 0],
        "operator_summary": f"epistemic risk: avg={avg_risk}; levels={level_counts}",
    }



def epistemic_core_summary(*, belief_explanations: List[Dict[str, Any]], decision_explanations: List[Dict[str, Any]]) -> Dict[str, Any]:
    evidence = belief_evidence_summary(belief_explanations)
    contradiction = contradiction_graph_summary(belief_explanations)
    causality = decision_causality_summary(decision_explanations)
    risk = epistemic_risk_summary(belief_explanations)
    return {
        "evidence": evidence,
        "contradiction_graph": contradiction,
        "decision_causality": causality,
        "epistemic_risk": risk,
        "operator_summary": f"epistemic core: evidence={evidence.get('evidence_count', 0)}, conflicts={contradiction.get('conflict_count', 0)}, causal_links={len(causality.get('top_links', []))}, avg_risk={risk.get('avg_risk_score', 0.0)}",
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
