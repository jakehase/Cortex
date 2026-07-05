from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

SCHEMA_VERSION = "cortex.memory.prior_art_gate.v1"

_REUSE_ACTIONS = {"reuse_existing", "extend_existing", "adapter_wrapper_only"}
_NEW_ACTIONS = {"new_primitive", "new_capability", "independent_implementation"}
_STOPWORDS = {
    "the", "and", "for", "with", "from", "into", "onto", "that", "this", "then", "than",
    "before", "after", "build", "implement", "implementation", "feature", "system", "product",
    "all", "our", "your", "its", "one", "two", "new", "old", "existing", "using", "utilizing",
}
_ALIAS_TERMS = {
    "run ledger": ["execution transaction", "proof carrying claim ledger", "provenance chain", "release bundle"],
    "release packet": ["release bundle", "provenance chain", "evidence packet", "artifact bundle"],
    "artifact bundle": ["checksum manifest", "sha256", "artifact integrity", "returned artifacts"],
    "proof carrying": ["proof-carrying claim ledger", "claim integrity", "merge eligibility"],
    "prior art": ["existing capability", "capability matrix", "structural code graph"],
    "memory preflight": ["memory recall", "librarian", "mnemosyne", "structural memory"],
}


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _tokens(value: str) -> List[str]:
    return [
        token
        for token in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", value.lower())
        if token not in _STOPWORDS
    ]


def _ngrams(tokens: Sequence[str], size: int) -> Iterable[str]:
    for index in range(0, max(0, len(tokens) - size + 1)):
        yield " ".join(tokens[index:index + size])


def extract_prior_art_terms(
    *,
    objective: str = "",
    planned_capabilities: Optional[Sequence[str]] = None,
    planned_paths: Optional[Sequence[str]] = None,
    max_terms: int = 18,
) -> List[str]:
    """Extract search terms for a duplicate-capability/prior-art preflight.

    The terms intentionally favor capability nouns and path basenames over the
    full prompt. The gate is meant to catch "we already built this" before a new
    implementation starts, not to perform generic chat recall.
    """
    planned_capabilities = planned_capabilities or []
    planned_paths = planned_paths or []
    raw_terms: List[str] = []
    for item in planned_capabilities:
        cleaned = _clean(item).lower()
        if cleaned:
            raw_terms.append(cleaned)
    for path_value in planned_paths:
        path_text = _clean(path_value)
        if not path_text:
            continue
        name = Path(path_text).stem.replace("-", " ").replace("_", " ").lower()
        if name:
            raw_terms.append(name)
    objective_tokens = _tokens(objective)
    raw_terms.extend(_ngrams(objective_tokens, 3))
    raw_terms.extend(_ngrams(objective_tokens, 2))
    raw_terms.extend(objective_tokens)

    expanded: List[str] = []
    seen = set()
    for term in raw_terms:
        term = _clean(term).lower()
        if not term or term in _STOPWORDS or len(term) < 4:
            continue
        if term not in seen:
            seen.add(term)
            expanded.append(term)
        for alias_key, aliases in _ALIAS_TERMS.items():
            if alias_key in term or term in alias_key:
                for alias in aliases:
                    if alias not in seen:
                        seen.add(alias)
                        expanded.append(alias)
    return expanded[: max(1, int(max_terms))]


def _lexical_overlap(query_terms: Sequence[str], text: str) -> float:
    text_tokens = set(_tokens(text))
    if not query_terms or not text_tokens:
        return 0.0
    query_tokens = set()
    for term in query_terms:
        query_tokens.update(_tokens(term))
    if not query_tokens:
        return 0.0
    return len(query_tokens & text_tokens) / max(1, len(query_tokens))


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    return str(value)


def _source_quality(metadata: Dict[str, Any]) -> float:
    source = str(metadata.get("source") or metadata.get("recall_mode") or "").lower()
    quality = str(metadata.get("quality") or "").lower()
    tags = " ".join(str(tag).lower() for tag in (metadata.get("tags") or [])) if isinstance(metadata.get("tags"), list) else ""
    if "curated" in quality or "curated" in source or "project" in source:
        return 0.22
    if "local_file_memory" in source or "durable" in tags:
        return 0.18
    if "structural" in source or "code" in source:
        return 0.2
    return 0.08


def normalize_memory_prior_art_rows(rows: Sequence[Dict[str, Any]], terms: Sequence[str]) -> List[Dict[str, Any]]:
    matches: List[Dict[str, Any]] = []
    for row in rows or []:
        text = _clean(row.get("text") or row.get("snippet") or row.get("document") or "")
        metadata = dict(row.get("metadata") or {})
        if not text:
            continue
        metadata_score = metadata.get("hybrid_score") or metadata.get("relevance_score") or metadata.get("lexical_score") or row.get("score") or 0.0
        try:
            base = float(metadata_score or 0.0)
        except Exception:
            base = 0.0
        overlap = _lexical_overlap(terms, text)
        exact_terms = [term for term in terms if term and term in text.lower()]
        if not exact_terms and overlap < 0.12:
            continue
        exact_bonus = 0.22 if exact_terms else 0.0
        score = max(base, overlap) + exact_bonus + _source_quality(metadata)
        score = round(min(1.0, score), 4)
        if score < 0.16:
            continue
        matches.append({
            "source": "durable_memory",
            "id": row.get("id") or row.get("path") or row.get("citation"),
            "label": metadata.get("path") or metadata.get("relPath") or metadata.get("source") or row.get("path") or row.get("id"),
            "score": score,
            "text": text[:900],
            "metadata": _json_safe(metadata),
            "matchedTerms": exact_terms[:8],
        })
    return matches


def normalize_structural_prior_art_rows(rows: Sequence[Dict[str, Any]], terms: Sequence[str]) -> List[Dict[str, Any]]:
    matches: List[Dict[str, Any]] = []
    for row in rows or []:
        node = row.get("node") if isinstance(row.get("node"), dict) else row
        if not isinstance(node, dict):
            continue
        label = _clean(node.get("name") or node.get("id") or node.get("uri") or "")
        haystack = " ".join([label, _clean(node.get("uri") or ""), _clean(node.get("type") or ""), _clean(node.get("language") or "")]).lower()
        if not haystack:
            continue
        overlap = _lexical_overlap(terms, haystack)
        exact = any(term and term in haystack for term in terms)
        if not exact and overlap <= 0:
            continue
        score = round(min(1.0, 0.38 + overlap + (0.22 if exact else 0.0)), 4)
        matches.append({
            "source": "structural_code_graph",
            "id": node.get("id"),
            "label": label,
            "score": score,
            "node": _json_safe(node),
            "matchedTerms": [term for term in terms if term and term in haystack][:8],
        })
    return matches


def normalize_file_prior_art_rows(rows: Sequence[Dict[str, Any]], terms: Sequence[str]) -> List[Dict[str, Any]]:
    matches: List[Dict[str, Any]] = []
    for row in rows or []:
        path = _clean(row.get("path") or row.get("file") or row.get("label") or "")
        text = _clean(row.get("text") or row.get("snippet") or path)
        haystack = f"{path} {text}".lower()
        if not haystack:
            continue
        overlap = _lexical_overlap(terms, haystack)
        exact = any(term and term in haystack for term in terms)
        if not exact and overlap <= 0:
            continue
        matches.append({
            "source": "workspace_file",
            "id": path,
            "label": path,
            "score": round(min(1.0, 0.32 + overlap + (0.2 if exact else 0.0)), 4),
            "text": text[:600],
            "matchedTerms": [term for term in terms if term and term in haystack][:8],
        })
    return matches


def dedupe_prior_art_matches(matches: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_key: Dict[str, Dict[str, Any]] = {}
    for match in matches:
        key = f"{match.get('source')}:{match.get('id') or match.get('label')}"
        previous = by_key.get(key)
        if previous is None or float(match.get("score", 0.0)) > float(previous.get("score", 0.0)):
            by_key[key] = match
    return sorted(by_key.values(), key=lambda item: float(item.get("score", 0.0)), reverse=True)


def build_prior_art_gate(
    *,
    objective: str,
    planned_capabilities: Optional[Sequence[str]] = None,
    planned_paths: Optional[Sequence[str]] = None,
    proposed_action: str = "unspecified",
    memory_results: Optional[Sequence[Dict[str, Any]]] = None,
    structural_results: Optional[Sequence[Dict[str, Any]]] = None,
    file_results: Optional[Sequence[Dict[str, Any]]] = None,
    min_high_confidence: float = 0.58,
) -> Dict[str, Any]:
    terms = extract_prior_art_terms(
        objective=objective,
        planned_capabilities=planned_capabilities,
        planned_paths=planned_paths,
    )
    matches = dedupe_prior_art_matches([
        *normalize_memory_prior_art_rows(memory_results or [], terms),
        *normalize_structural_prior_art_rows(structural_results or [], terms),
        *normalize_file_prior_art_rows(file_results or [], terms),
    ])
    high_confidence = [match for match in matches if float(match.get("score", 0.0)) >= float(min_high_confidence)]
    action = _clean(proposed_action).lower().replace("-", "_") or "unspecified"
    has_prior_art = bool(high_confidence)
    failures: List[str] = []
    warnings: List[str] = []
    if has_prior_art and action in _NEW_ACTIONS | {"unspecified", ""}:
        failures.append("high_confidence_prior_art_requires_reuse_or_extension")
    elif has_prior_art and action in _REUSE_ACTIONS:
        warnings.append("prior_art_found_action_scoped_to_existing_capability")
    elif not has_prior_art and action in _REUSE_ACTIONS:
        warnings.append("reuse_action_declared_but_no_high_confidence_prior_art_found")

    if has_prior_art:
        if action == "reuse_existing":
            decision = "reuse_existing"
        elif action == "extend_existing":
            decision = "extend_existing"
        elif action == "adapter_wrapper_only":
            decision = "adapter_wrapper_only"
        else:
            decision = "extend_existing_or_adapter_required"
    else:
        decision = "new_primitive_justified" if action in _NEW_ACTIONS else "no_prior_art_found"

    ok = not failures
    return {
        "schemaVersion": SCHEMA_VERSION,
        "ok": ok,
        "status": "green_prior_art_gate" if ok else "blocked",
        "objective": _clean(objective),
        "plannedCapabilities": list(planned_capabilities or []),
        "plannedPaths": list(planned_paths or []),
        "proposedAction": action,
        "decision": decision,
        "requiredAction": decision if not ok else action if action in _REUSE_ACTIONS else decision,
        "terms": terms,
        "sourceCoverage": {
            "memoryResultCount": len(memory_results or []),
            "structuralResultCount": len(structural_results or []),
            "fileResultCount": len(file_results or []),
            "matchCount": len(matches),
            "highConfidenceMatchCount": len(high_confidence),
        },
        "highConfidencePriorArt": high_confidence,
        "priorArtMatches": matches[:20],
        "failures": failures,
        "warnings": warnings,
        "blocker": None if ok else {
            "blockerKind": "prior_art_gate_failed",
            "blocker": "High-confidence existing capability was found; plan must reuse, extend, or explicitly be an adapter before implementation.",
        },
        "truthBoundary": "Prior-art gate is a pre-implementation recall check across memory and structural evidence. It prevents duplicate architecture; it does not prove the recalled capability is currently correct without live validation.",
    }
