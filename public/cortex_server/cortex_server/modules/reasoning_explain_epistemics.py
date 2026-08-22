from __future__ import annotations

from typing import Any, Dict, List



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


__all__ = [
    "belief_evidence_summary",
    "contradiction_graph_summary",
    "decision_causality_summary",
    "epistemic_core_summary",
    "epistemic_risk_summary",
]
