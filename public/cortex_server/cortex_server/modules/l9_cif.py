"""L9 design-review checklist coverage (deterministic, keyword presence only).

This module used to be the "Counterfactual Invariant Forge": it turned counts of
phrases such as "circuit breaker" into ``survival_score``/``reversibility``
numbers, bucketed canaries by SHA-256 and appended decision history under
``/opt/clawdbot/state``.  Those numbers were presented as architecture analysis
but measured only vocabulary.

What remains is honest and useful as a *checklist*: given a design text (for
example the model-generated blueprint from ``POST /architect/design``), report
which standard design-review concerns the text explicitly addresses and which
it never mentions.  Output is labelled ``keyword_presence``; it scores nothing,
writes nothing, and must not be read as a quality judgement.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

METHOD = "keyword_presence"

# concern -> phrases whose presence shows the text at least discusses it
CHECKLIST: Dict[str, List[str]] = {
    "failure_handling": ["failover", "retry", "retries", "circuit breaker", "fallback", "redundan", "replica", "high availability", "multi-az", "multi-region"],
    "data_durability": ["backup", "snapshot", "point-in-time", "pitr", "replication", "rpo", "restore", "durab"],
    "recovery_objectives": ["rto", "rpo", "recovery time", "recovery point", "disaster recovery"],
    "observability": ["monitor", "metric", "alert", "logging", "logs", "tracing", "dashboard", "slo", "sli"],
    "security": ["auth", "encrypt", "tls", "iam", "least privilege", "secret", "access control", "rbac"],
    "scalability": ["scale", "scaling", "shard", "partition", "load balanc", "autoscal", "throughput", "capacity"],
    "consistency": ["consisten", "transaction", "idempoten", "exactly-once", "at-least-once", "ordering", "conflict"],
    "rollback_and_migration": ["rollback", "roll back", "migration", "blue-green", "canary", "feature flag", "backward compat"],
    "cost": ["cost", "budget", "$", "pricing", "spend"],
    "testing": ["test", "staging", "chaos", "load test", "game day"],
}


def _flatten(value: Any, out: List[str], limit: int = 200_000) -> None:
    if sum(len(x) for x in out) > limit:
        return
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, Mapping):
        for item in value.values():
            _flatten(item, out, limit)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _flatten(item, out, limit)


def checklist_coverage(design: Any) -> Dict[str, Any]:
    """Which checklist concerns does the design text mention at all?"""

    parts: List[str] = []
    _flatten(design, parts)
    text = " ".join(parts).lower()
    covered: List[Dict[str, Any]] = []
    missing: List[str] = []
    for concern, phrases in CHECKLIST.items():
        hits = sorted({p for p in phrases if p in text})
        if hits:
            covered.append({"concern": concern, "matched_terms": hits[:6]})
        else:
            missing.append(concern)
    return {
        "method": METHOD,
        "covered": covered,
        "not_mentioned": missing,
        "note": "Keyword presence only: shows which review concerns the text discusses, not whether the design handles them well.",
    }


def run_l9_cif(query: str, constraints: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Backward-compatible entry point: checklist coverage of ``query``.

    No scores, no canary buckets, no persisted state.
    """

    payload: Dict[str, Any] = {"query": str(query or "")}
    if constraints:
        payload["constraints"] = constraints
    result = checklist_coverage(payload)
    result["success"] = True
    result["input_chars"] = len(str(query or ""))
    return result


def get_l9_cif_status() -> Dict[str, Any]:
    return {
        "success": True,
        "method": METHOD,
        "concerns": sorted(CHECKLIST),
        "persists_state": False,
        "scores": False,
    }

