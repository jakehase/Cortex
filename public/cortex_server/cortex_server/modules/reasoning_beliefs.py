from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from cortex_server.modules.reasoning_kernel import BeliefClaim, Provenance, model_dump_compat
from cortex_server.modules.reasoning_store import list_docs, replace_namespace_docs


_LOCK = threading.RLock()
DEFAULT_STATE_PATH = Path(os.getenv("REASONING_BELIEFS_STATE_PATH", "/opt/clawdbot/state/reasoning_beliefs.json"))
DEFAULT_DB_PATH = Path(os.getenv("REASONING_STORE_DB_PATH", "/opt/clawdbot/state/reasoning_runtime.db"))
ENABLE_LEGACY_JSON_FALLBACK = str(os.getenv("REASONING_BELIEFS_ENABLE_LEGACY_JSON_FALLBACK", "0")).strip().lower() in {"1", "true", "yes", "on"}
_NAMESPACE = "beliefs"

SOURCE_TYPE_WEIGHTS = {
    "runtime_execution": 1.0,
    "probe": 0.95,
    "sensor": 0.95,
    "verification": 0.9,
    "test": 0.85,
    "pytest": 0.85,
    "human": 0.8,
    "operator": 0.8,
    "memory": 0.65,
    "system": 0.6,
}



def _now() -> datetime:
    return datetime.now(timezone.utc)



def _now_iso() -> str:
    return _now().isoformat()



def _state_path() -> Path:
    return Path(str(DEFAULT_STATE_PATH))



def _db_path() -> Path:
    return Path(str(DEFAULT_DB_PATH))



def _default_state() -> Dict[str, Any]:
    return {
        "version": "cortex.reasoning.beliefs.v1",
        "updated_at": _now_iso(),
        "beliefs": [],
    }



def _legacy_state() -> Optional[Dict[str, Any]]:
    path = _state_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("version", "cortex.reasoning.beliefs.v1")
            data.setdefault("updated_at", _now_iso())
            data.setdefault("beliefs", [])
            return data
    except Exception:
        return None
    return None



def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None



def _age_seconds(row: Dict[str, Any], *, now: Optional[datetime] = None) -> Optional[float]:
    now_dt = now or _now()
    anchor = _parse_dt(row.get("last_verified_at")) or _parse_dt((row.get("metadata") or {}).get("observed_at")) or _parse_dt(row.get("created_at"))
    if not anchor:
        return None
    return max(0.0, (now_dt - anchor).total_seconds())



def _decay_ratio(*, age_seconds: Optional[float], half_life_seconds: Optional[float] = None, ttl_seconds: Optional[float] = None) -> float:
    if age_seconds is None:
        return 1.0
    if half_life_seconds is not None and half_life_seconds > 0:
        try:
            return max(0.0, min(1.0, 0.5 ** (age_seconds / half_life_seconds)))
        except Exception:
            return 1.0
    if ttl_seconds is not None and ttl_seconds > 0:
        return max(0.0, min(1.0, 1.0 - (age_seconds / ttl_seconds)))
    return 1.0



def _decayed_scores(row: Dict[str, Any], *, now: Optional[datetime] = None) -> Dict[str, float]:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    age = _age_seconds(row, now=now)
    ttl_raw = metadata.get("ttl_seconds", metadata.get("max_age_seconds"))
    freshness_half_life_raw = metadata.get("freshness_half_life_seconds")
    confidence_half_life_raw = metadata.get("confidence_half_life_seconds", freshness_half_life_raw)
    try:
        ttl_seconds = float(ttl_raw) if ttl_raw is not None else None
    except Exception:
        ttl_seconds = None
    try:
        freshness_half_life = float(freshness_half_life_raw) if freshness_half_life_raw is not None else None
    except Exception:
        freshness_half_life = None
    try:
        confidence_half_life = float(confidence_half_life_raw) if confidence_half_life_raw is not None else None
    except Exception:
        confidence_half_life = None

    raw_freshness = float(row.get("freshness", 0.5) or 0.0)
    raw_confidence = float(row.get("confidence", 0.5) or 0.0)
    freshness_decay = _decay_ratio(age_seconds=age, half_life_seconds=freshness_half_life, ttl_seconds=ttl_seconds)
    confidence_decay = _decay_ratio(age_seconds=age, half_life_seconds=confidence_half_life)
    return {
        "decayed_freshness": round(max(0.0, min(1.0, raw_freshness * freshness_decay)), 4),
        "decayed_confidence": round(max(0.0, min(1.0, raw_confidence * confidence_decay)), 4),
    }



def _effective_status(row: Dict[str, Any], *, now: Optional[datetime] = None) -> str:
    explicit = str(row.get("status") or "active")
    if explicit in {"superseded", "contradicted"}:
        return explicit
    now_dt = now or _now()
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    expires_at = _parse_dt(metadata.get("expires_at"))
    if expires_at and expires_at <= now_dt:
        return "stale"
    ttl_raw = metadata.get("ttl_seconds", metadata.get("max_age_seconds"))
    try:
        ttl_seconds = float(ttl_raw) if ttl_raw is not None else None
    except Exception:
        ttl_seconds = None
    age = _age_seconds(row, now=now_dt)
    if ttl_seconds is not None and ttl_seconds >= 0 and age is not None and age > ttl_seconds:
        return "stale"
    return explicit or "active"



def _materialize_belief(row: Dict[str, Any], *, now: Optional[datetime] = None) -> Dict[str, Any]:
    out = dict(row)
    md = dict(out.get("metadata") or {})
    out["metadata"] = md
    age = _age_seconds(out, now=now)
    effective = _effective_status(out, now=now)
    decayed = _decayed_scores(out, now=now)
    out["status"] = effective
    out["age_seconds"] = age
    out["is_fresh"] = effective == "active"
    out["evidence_count"] = len(out.get("provenance") or [])
    out.update(decayed)
    return out



def load_state() -> Dict[str, Any]:
    with _LOCK:
        beliefs = [dict(row) for row in list_docs(_NAMESPACE, db_path=_db_path()) if isinstance(row, dict)]
        if beliefs:
            return {
                "version": "cortex.reasoning.beliefs.v1",
                "updated_at": _now_iso(),
                "beliefs": beliefs,
            }
        if not ENABLE_LEGACY_JSON_FALLBACK:
            return _default_state()
        legacy = _legacy_state()
        if legacy:
            save_state(legacy)
            return legacy
        return _default_state()



def save_state(state: Dict[str, Any]) -> Dict[str, Any]:
    beliefs = [dict(row) for row in (state.get("beliefs") or []) if isinstance(row, dict)]
    state["updated_at"] = _now_iso()
    with _LOCK:
        replace_namespace_docs(_NAMESPACE, beliefs, id_field="claim_id", db_path=_db_path())
    return state



def list_beliefs(*, subject: Optional[str] = None, predicate: Optional[str] = None, task_id: Optional[str] = None, status: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    beliefs = load_state().get("beliefs") or []
    out: List[Dict[str, Any]] = []
    now_dt = _now()
    for row in beliefs:
        if not isinstance(row, dict):
            continue
        materialized = _materialize_belief(row, now=now_dt)
        if subject and str(materialized.get("subject") or "") != str(subject):
            continue
        if predicate and str(materialized.get("predicate") or "") != str(predicate):
            continue
        if task_id and str(materialized.get("task_id") or "") != str(task_id):
            continue
        if status and str(materialized.get("status") or "") != str(status):
            continue
        out.append(materialized)
    out.sort(key=lambda row: str(row.get("last_verified_at") or row.get("metadata", {}).get("updated_at") or row.get("claim_id") or ""), reverse=True)
    return out[: max(0, int(limit))]



def beliefs_for_task(task_id: str, *, limit: int = 100) -> List[Dict[str, Any]]:
    return list_beliefs(task_id=task_id, limit=limit)



def search_beliefs(query: str, *, limit: int = 50) -> List[Dict[str, Any]]:
    q = str(query or "").strip().lower()
    if not q:
        return list_beliefs(limit=limit)
    beliefs = load_state().get("beliefs") or []
    out: List[Dict[str, Any]] = []
    now_dt = _now()
    for row in beliefs:
        if not isinstance(row, dict):
            continue
        materialized = _materialize_belief(row, now=now_dt)
        hay = " ".join(
            [
                str(materialized.get("subject") or ""),
                str(materialized.get("predicate") or ""),
                str(materialized.get("value") or ""),
                str(materialized.get("task_id") or ""),
                str(materialized.get("metadata") or ""),
                str(materialized.get("provenance") or ""),
            ]
        ).lower()
        if q in hay:
            out.append(materialized)
    return out[: max(0, int(limit))]



def select_influential_beliefs(
    *,
    task_id: Optional[str] = None,
    subjects: Optional[List[str]] = None,
    predicates: Optional[List[str]] = None,
    query: Optional[str] = None,
    limit: int = 8,
) -> List[Dict[str, Any]]:
    subject_filters = {str(x) for x in (subjects or []) if str(x).strip()}
    predicate_filters = {str(x) for x in (predicates or []) if str(x).strip()}
    query_text = str(query or "").strip().lower()
    rows = list_beliefs(task_id=task_id, limit=2000)
    scored: List[tuple[float, Dict[str, Any]]] = []
    for row in rows:
        score = 0.0
        if str(row.get("status") or "") == "active":
            score += 4.0
        elif str(row.get("status") or "") == "stale":
            score += 1.5
        score += float(row.get("decayed_confidence", 0.0) or 0.0) * 2.0
        score += float(row.get("decayed_freshness", 0.0) or 0.0) * 2.0
        if subject_filters:
            if str(row.get("subject") or "") not in subject_filters:
                continue
            score += 2.5
        if predicate_filters:
            if str(row.get("predicate") or "") not in predicate_filters:
                continue
            score += 2.5
        if query_text:
            hay = " ".join([
                str(row.get("subject") or ""),
                str(row.get("predicate") or ""),
                str(row.get("value") or ""),
                str(row.get("metadata") or ""),
            ]).lower()
            if query_text not in hay:
                continue
            score += 1.5
        scored.append((score, row))
    scored.sort(key=lambda item: (-item[0], str(item[1].get("last_verified_at") or "")), reverse=False)
    return [row for _, row in scored[: max(0, int(limit))]]



def belief_conflicts(*, subject: Optional[str] = None, predicate: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    beliefs = list_beliefs(subject=subject, predicate=predicate, limit=max(limit, 500))
    out: List[Dict[str, Any]] = []
    for row in beliefs:
        contradictions = [str(x) for x in (row.get("contradicts") or []) if str(x).strip()]
        if contradictions or str(row.get("status") or "") == "contradicted":
            out.append(row)
    return out[: max(0, int(limit))]



def summarize_beliefs(*, task_id: Optional[str] = None, subject: Optional[str] = None, predicate: Optional[str] = None) -> Dict[str, Any]:
    rows = list_beliefs(task_id=task_id, subject=subject, predicate=predicate, limit=1000)
    by_status: Dict[str, int] = {}
    by_predicate: Dict[str, int] = {}
    for row in rows:
        status = str(row.get("status") or "unknown")
        by_status[status] = by_status.get(status, 0) + 1
        pred = str(row.get("predicate") or "unknown")
        by_predicate[pred] = by_predicate.get(pred, 0) + 1
    return {
        "count": len(rows),
        "by_status": by_status,
        "by_predicate": by_predicate,
        "fresh_count": sum(1 for row in rows if bool(row.get("is_fresh"))),
        "stale_count": sum(1 for row in rows if str(row.get("status") or "") == "stale"),
        "conflict_count": sum(1 for row in rows if str(row.get("status") or "") == "contradicted" or list(row.get("contradicts") or [])),
        "avg_decayed_freshness": round((sum(float(row.get("decayed_freshness", 0.0) or 0.0) for row in rows) / len(rows)), 4) if rows else 0.0,
        "avg_decayed_confidence": round((sum(float(row.get("decayed_confidence", 0.0) or 0.0) for row in rows) / len(rows)), 4) if rows else 0.0,
    }



def get_belief(claim_id: str) -> Optional[Dict[str, Any]]:
    for row in load_state().get("beliefs") or []:
        if isinstance(row, dict) and str(row.get("claim_id") or "") == str(claim_id):
            return _materialize_belief(row)
    return None



def source_weight(source_type: Optional[str]) -> float:
    key = str(source_type or "system").strip().lower()
    return float(SOURCE_TYPE_WEIGHTS.get(key, 0.5))



def evidence_bundle(claim_id: str) -> Optional[Dict[str, Any]]:
    belief = get_belief(claim_id)
    if not belief:
        return None
    provenance_rows = [dict(row) for row in (belief.get("provenance") or []) if isinstance(row, dict)]
    evidence_items: List[Dict[str, Any]] = []
    source_types: Dict[str, int] = {}
    weights: List[float] = []
    for idx, row in enumerate(provenance_rows, start=1):
        src = str(row.get("source_type") or "system").strip().lower() or "system"
        weight = source_weight(src)
        weights.append(weight)
        source_types[src] = source_types.get(src, 0) + 1
        evidence_items.append(
            {
                "index": idx,
                "source_type": src,
                "source_ref": row.get("source_ref"),
                "observed_at": row.get("observed_at"),
                "recorded_at": row.get("recorded_at"),
                "note": row.get("note"),
                "source_weight": round(weight, 4),
            }
        )
    avg_weight = (sum(weights) / len(weights)) if weights else source_weight("system")
    weighted_confidence = round(max(0.0, min(1.0, float(belief.get("decayed_confidence", belief.get("confidence", 0.0)) or 0.0) * avg_weight)), 4)
    weighted_freshness = round(max(0.0, min(1.0, float(belief.get("decayed_freshness", belief.get("freshness", 0.0)) or 0.0) * avg_weight)), 4)
    return {
        "claim_id": belief.get("claim_id"),
        "evidence_count": len(evidence_items),
        "source_types": source_types,
        "source_weight_avg": round(avg_weight, 4),
        "weighted_confidence": weighted_confidence,
        "weighted_freshness": weighted_freshness,
        "items": evidence_items,
        "operator_summary": f"{len(evidence_items)} evidence items; sources={sorted(source_types)}; weighted_conf={weighted_confidence}",
    }



def contradiction_cluster(claim_id: str) -> Optional[Dict[str, Any]]:
    belief = get_belief(claim_id)
    if not belief:
        return None
    subject = str(belief.get("subject") or "")
    predicate = str(belief.get("predicate") or "")
    rows = list_beliefs(subject=subject, predicate=predicate, limit=200)
    cluster_rows = [row for row in rows if str(row.get("claim_id") or "").strip()]
    values = [row.get("value") for row in cluster_rows]
    unique_values = []
    seen_values: set[str] = set()
    for value in values:
        marker = json.dumps(value, sort_keys=True, default=str)
        if marker in seen_values:
            continue
        seen_values.add(marker)
        unique_values.append(value)
    statuses: Dict[str, int] = {}
    active_ids: List[str] = []
    contradicted_ids: List[str] = []
    stale_ids: List[str] = []
    for row in cluster_rows:
        status = str(row.get("status") or "unknown")
        statuses[status] = statuses.get(status, 0) + 1
        row_id = str(row.get("claim_id") or "")
        if status == "active":
            active_ids.append(row_id)
        if status == "contradicted":
            contradicted_ids.append(row_id)
        if status == "stale":
            stale_ids.append(row_id)
    contradiction_links = sum(len([str(x) for x in (row.get("contradicts") or []) if str(x).strip()]) for row in cluster_rows)
    ambiguity_score = round(min(1.0, max(0.0, ((len(unique_values) - 1) * 0.25) + (contradiction_links * 0.1) + (len(active_ids) > 1) * 0.2)), 4)
    return {
        "subject": subject,
        "predicate": predicate,
        "belief_ids": [str(row.get("claim_id") or "") for row in cluster_rows],
        "value_count": len(unique_values),
        "values": unique_values,
        "status_counts": statuses,
        "active_ids": active_ids,
        "contradicted_ids": contradicted_ids,
        "stale_ids": stale_ids,
        "contradiction_link_count": contradiction_links,
        "ambiguity_score": ambiguity_score,
        "operator_summary": f"cluster {subject}:{predicate} has {len(unique_values)} values across {len(cluster_rows)} beliefs; ambiguity={ambiguity_score}",
    }



def belief_epistemic_risk(claim_id: str) -> Optional[Dict[str, Any]]:
    belief = get_belief(claim_id)
    if not belief:
        return None
    bundle = evidence_bundle(claim_id) or {}
    cluster = contradiction_cluster(claim_id) or {}
    status = str(belief.get("status") or "unknown")
    status_penalty = 0.0
    if status == "contradicted":
        status_penalty = 0.5
    elif status == "stale":
        status_penalty = 0.35
    evidence_penalty = max(0.0, 0.5 - float(bundle.get("weighted_confidence", 0.0) or 0.0))
    freshness_penalty = max(0.0, 0.5 - float(bundle.get("weighted_freshness", 0.0) or 0.0))
    ambiguity_penalty = float(cluster.get("ambiguity_score", 0.0) or 0.0)
    risk_score = round(min(1.0, status_penalty + evidence_penalty + freshness_penalty + ambiguity_penalty), 4)
    if risk_score >= 0.9:
        level = "high"
    elif risk_score >= 0.5:
        level = "medium"
    else:
        level = "low"
    return {
        "claim_id": belief.get("claim_id"),
        "risk_score": risk_score,
        "risk_level": level,
        "status": status,
        "ambiguity_score": round(ambiguity_penalty, 4),
        "weighted_confidence": float(bundle.get("weighted_confidence", 0.0) or 0.0),
        "weighted_freshness": float(bundle.get("weighted_freshness", 0.0) or 0.0),
        "operator_summary": f"epistemic risk={level} ({risk_score}); status={status}; ambiguity={round(ambiguity_penalty, 4)}",
    }



def trace_belief_lineage(claim_id: str, *, max_depth: int = 12) -> Optional[Dict[str, Any]]:
    target = get_belief(claim_id)
    if not target:
        return None
    all_beliefs = {str(row.get("claim_id") or ""): row for row in list_beliefs(limit=2000) if str(row.get("claim_id") or "").strip()}

    def _walk(ids: List[str], forward_fields: List[str]) -> List[Dict[str, Any]]:
        chain: List[Dict[str, Any]] = []
        seen: set[str] = set()
        frontier = [str(x) for x in ids if str(x).strip()]
        depth = 0
        while frontier and depth < max_depth:
            next_frontier: List[str] = []
            for item in frontier:
                if item in seen:
                    continue
                seen.add(item)
                row = all_beliefs.get(item)
                if not row:
                    continue
                chain.append(row)
                for field in forward_fields:
                    next_frontier.extend(str(x) for x in (row.get(field) or []) if str(x).strip())
            frontier = next_frontier
            depth += 1
        return chain

    supersedes_chain = _walk([str(x) for x in (target.get("supersedes") or [])], ["supersedes", "contradicts"])
    contradicts_chain = _walk([str(x) for x in (target.get("contradicts") or [])], ["supersedes", "contradicts"])
    descendants = []
    for row in all_beliefs.values():
        links = [str(x) for x in (row.get("supersedes") or [])] + [str(x) for x in (row.get("contradicts") or [])]
        if str(claim_id) in links:
            descendants.append(row)

    graph_nodes: Dict[str, Dict[str, Any]] = {}
    for row in [target] + supersedes_chain + contradicts_chain + descendants:
        row_id = str(row.get("claim_id") or "")
        if not row_id:
            continue
        graph_nodes[row_id] = {
            "claim_id": row_id,
            "subject": row.get("subject"),
            "predicate": row.get("predicate"),
            "status": row.get("status"),
            "kind": row.get("kind"),
        }
    graph_edges: List[Dict[str, Any]] = []
    for row_id, row in [(str(r.get("claim_id") or ""), r) for r in [target] + supersedes_chain + contradicts_chain + descendants if str(r.get("claim_id") or "").strip()]:
        for link in [str(x) for x in (row.get("supersedes") or []) if str(x).strip()]:
            if link in graph_nodes:
                graph_edges.append({"from": row_id, "to": link, "kind": "supersedes"})
        for link in [str(x) for x in (row.get("contradicts") or []) if str(x).strip()]:
            if link in graph_nodes:
                graph_edges.append({"from": row_id, "to": link, "kind": "contradicts"})
    contradiction_edges = [row for row in graph_edges if row.get("kind") == "contradicts"]
    supersession_edges = [row for row in graph_edges if row.get("kind") == "supersedes"]
    return {
        "belief": target,
        "supersedes_chain": supersedes_chain,
        "contradicts_chain": contradicts_chain,
        "descendants": descendants,
        "graph": {"nodes": list(graph_nodes.values()), "edges": graph_edges},
        "summary": {
            "node_count": len(graph_nodes),
            "edge_count": len(graph_edges),
            "contradiction_edge_count": len(contradiction_edges),
            "supersession_edge_count": len(supersession_edges),
            "operator_summary": f"lineage graph: {len(graph_nodes)} beliefs, {len(contradiction_edges)} contradiction edges, {len(supersession_edges)} supersession edges",
        },
    }



def explain_belief(claim_id: str) -> Optional[Dict[str, Any]]:
    target = get_belief(claim_id)
    if not target:
        return None
    beliefs = list_beliefs(limit=500)
    related: List[Dict[str, Any]] = []
    conflicts: List[Dict[str, Any]] = []
    for row in beliefs:
        if str(row.get("subject") or "") == str(target.get("subject") or "") and str(row.get("predicate") or "") == str(target.get("predicate") or ""):
            if str(row.get("claim_id") or "") != str(claim_id):
                related.append(row)
        if str(claim_id) in [str(x) for x in (row.get("contradicts") or [])] or str(row.get("claim_id") or "") in [str(x) for x in (target.get("contradicts") or [])]:
            conflicts.append(row)
    if not conflicts:
        target_links = {str(x) for x in (target.get("contradicts") or []) if str(x).strip()} | {str(x) for x in (target.get("supersedes") or []) if str(x).strip()}
        for row in related:
            rid = str(row.get("claim_id") or "")
            row_links = {str(x) for x in (row.get("contradicts") or []) if str(x).strip()} | {str(x) for x in (row.get("supersedes") or []) if str(x).strip()}
            if rid in target_links or str(claim_id) in row_links or row.get("status") in {"contradicted", "superseded"}:
                conflicts.append(row)
    lineage = trace_belief_lineage(claim_id) or {"belief": target, "supersedes_chain": [], "contradicts_chain": [], "descendants": [], "graph": {"nodes": [], "edges": []}, "summary": {}}
    bundle = evidence_bundle(claim_id) or {"items": [], "source_types": {}, "weighted_confidence": target.get("decayed_confidence", target.get("confidence")), "weighted_freshness": target.get("decayed_freshness", target.get("freshness")), "operator_summary": "no evidence bundle"}
    cluster = contradiction_cluster(claim_id) or {"belief_ids": [], "value_count": 0, "values": [], "status_counts": {}, "active_ids": [], "contradicted_ids": [], "stale_ids": [], "contradiction_link_count": 0, "ambiguity_score": 0.0, "operator_summary": "no contradiction cluster"}
    contradiction_summary = {
        "conflict_count": len(conflicts),
        "active_conflict_count": sum(1 for row in conflicts if str(row.get("status") or "") == "active"),
        "contradicted_ids": [str(row.get("claim_id") or "") for row in conflicts if str(row.get("claim_id") or "").strip()],
        "ambiguity_score": float(cluster.get("ambiguity_score", 0.0) or 0.0),
        "operator_summary": f"{len(conflicts)} conflicting/related beliefs; weighted_conf={bundle.get('weighted_confidence')}; ambiguity={cluster.get('ambiguity_score')}",
    }
    epistemic_risk = belief_epistemic_risk(claim_id) or {"risk_score": 0.0, "risk_level": "low", "operator_summary": "no epistemic risk"}
    return {
        "belief": target,
        "related": related,
        "conflicts": conflicts,
        "lineage": lineage,
        "lineage_graph": lineage.get("graph") or {"nodes": [], "edges": []},
        "lineage_summary": lineage.get("summary") or {},
        "contradiction_cluster": cluster,
        "contradiction_summary": contradiction_summary,
        "epistemic_risk": epistemic_risk,
        "evidence_chain": list(target.get("provenance") or []),
        "evidence_bundle": bundle,
    }



def upsert_belief(
    *,
    subject: str,
    predicate: str,
    value: Any,
    confidence: float = 0.6,
    freshness: float = 0.6,
    kind: str = "observed",
    task_id: Optional[str] = None,
    source_type: str = "system",
    source_ref: Optional[str] = None,
    observed_at: Optional[str] = None,
    note: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    conflict_mode: str = "supersede",
) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        beliefs = state.setdefault("beliefs", [])
        active_matches: List[Dict[str, Any]] = []
        for row in beliefs:
            if not isinstance(row, dict):
                continue
            effective_status = _effective_status(row)
            if str(row.get("subject") or "") == str(subject) and str(row.get("predicate") or "") == str(predicate) and effective_status in {"active", "stale"}:
                active_matches.append(row)

        prov = model_dump_compat(
            Provenance(
                source_type=source_type,
                source_ref=source_ref,
                observed_at=observed_at,
                note=note,
            )
        )

        for row in active_matches:
            if row.get("value") == value:
                row["status"] = "active"
                row["confidence"] = round(max(float(row.get("confidence", 0.0) or 0.0), float(confidence)), 3)
                row["freshness"] = round(max(float(row.get("freshness", 0.0) or 0.0), float(freshness)), 3)
                row.setdefault("provenance", []).append(prov)
                row["last_verified_at"] = observed_at or _now_iso()
                md = row.setdefault("metadata", {})
                if isinstance(metadata, dict):
                    md.update(metadata)
                save_state(state)
                return _materialize_belief(row)

        superseded_ids: List[str] = []
        contradicted_ids: List[str] = []
        for row in active_matches:
            row["status"] = "contradicted" if str(conflict_mode) == "contradict" else "superseded"
            if row["status"] == "contradicted":
                contradicted_ids.append(str(row.get("claim_id") or ""))
            else:
                superseded_ids.append(str(row.get("claim_id") or ""))

        claim = BeliefClaim(
            subject=subject,
            predicate=predicate,
            value=value,
            confidence=float(confidence),
            freshness=float(freshness),
            kind=kind,  # type: ignore[arg-type]
            task_id=task_id,
            provenance=[Provenance(source_type=source_type, source_ref=source_ref, observed_at=observed_at, note=note)],
            supersedes=[x for x in superseded_ids if x],
            contradicts=[x for x in contradicted_ids if x],
            last_verified_at=observed_at or _now_iso(),
            metadata=dict(metadata or {}),
        )
        row = model_dump_compat(claim)
        beliefs.append(row)
        if len(beliefs) > 2000:
            del beliefs[:-2000]
        save_state(state)
        return _materialize_belief(row)


__all__ = [
    "belief_conflicts",
    "belief_epistemic_risk",
    "beliefs_for_task",
    "contradiction_cluster",
    "evidence_bundle",
    "explain_belief",
    "get_belief",
    "list_beliefs",
    "load_state",
    "save_state",
    "search_beliefs",
    "select_influential_beliefs",
    "source_weight",
    "summarize_beliefs",
    "trace_belief_lineage",
    "upsert_belief",
]
