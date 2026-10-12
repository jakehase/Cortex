"""ExecutionEngine adapter for L38 Augmenter: output-contract check and repair.

* Without ``context["draft_answer"]`` (pre-generation) it returns deterministic
  control-surface guidance: the output contract the user's message implies and
  any citations it requires.
* With a draft answer it validates the draft against that contract and checks
  citations against ``context["evidence_citations"]`` (the sources retrieved
  for this turn). On failure it makes at most one model repair through
  ``level_model`` and validates again. Nothing is appended to the answer.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Mapping

from cortex_server.modules import augmenter as core
from cortex_server.modules import level_model
from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 38
NAME = "augmenter"
NEEDS_MODEL = True  # only when a draft fails validation and is repaired
SAFE_AUTORUN = True  # deterministic checks plus at most one pure model call
DEFAULT_DEADLINE_S = 50.0
MAX_DRAFT_CHARS = 12_000

REPAIR_SYSTEM = (
    "You repair an assistant's draft answer so it satisfies a required output contract. Keep the draft's "
    "content and meaning; change only what the contract requires. Never invent citations: cite only "
    "sources listed as available evidence. Return ONLY the repaired answer text."
)


def _evidence(context: Mapping[str, Any]) -> List[str]:
    raw = context.get("evidence_citations") or []
    if not isinstance(raw, (list, tuple)):
        return []
    return [core.normalize_citation(c) for c in raw if str(c or "").strip()][:50]


def _assess(kind: str, text: str, query: str, required: List[str], evidence: List[str]) -> Dict[str, Any]:
    ok, why = core.validate(kind, text, query)
    _, missing, cited = core.citation_gap(required, text)
    unsupported = [c for c in cited if evidence and c not in evidence]
    if ok and missing:
        ok, why = False, "citation:missing_required"
    if ok and unsupported:
        ok, why = False, "citation:not_in_evidence"
    return {"ok": ok, "why": why, "missing_citations": missing, "unsupported_citations": unsupported}


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    if not core.augmenter_enabled():
        raise ExecutionBlocked("augmenter_disabled")
    ctx = context or {}
    if not str(query or "").strip():
        raise ExecutionBlocked("empty_query")
    kind = core.classify_kind(query)
    required = core.requested_citations(query)
    guidance = core.contract_guidance(kind, required)
    draft = str(ctx.get("draft_answer") or "")[:MAX_DRAFT_CHARS]

    if not draft.strip():
        return {
            "operation": "augmenter.contract",
            "origin": "deterministic",
            "summary": f"Output contract for this message: {guidance}"[:1500],
            "data": {"contract": kind, "required_citations": required,
                     "routing_risk": core.routing_risk(query, kind), "risk_basis": "routing_heuristic"},
        }

    evidence = _evidence(ctx)
    first = _assess(kind, draft, query, required, evidence)
    if first["ok"]:
        return {
            "operation": "augmenter.check",
            "origin": "deterministic",
            "summary": f"Draft answer satisfies its output contract ({kind}: {first['why']}).",
            "data": {"contract": kind, **first, "repaired": False,
                     "draft_sha256": hashlib.sha256(draft.encode("utf-8")).hexdigest()},
        }

    scope = str(ctx.get("principal_scope_key") or "").strip()
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    prompt = (
        f"User request:\n{query}\n\nRequired contract: {guidance}\n"
        f"Validation failure: {first['why']}\n"
        f"Available evidence citations: {', '.join(evidence) if evidence else 'none listed'}\n\n"
        f"Draft answer:\n{draft}"
    )
    result = await level_model.level_model_json(
        level=LEVEL, name=NAME, system=REPAIR_SYSTEM, prompt=prompt,
        principal_scope_key=scope, schema=None, deadline_s=DEFAULT_DEADLINE_S - 5,
    )
    if not result.get("ok"):
        raise ExecutionBlocked(str(result.get("status") or "model_unavailable"))
    repaired = str(result.get("text") or "")[:MAX_DRAFT_CHARS]
    second = _assess(kind, repaired, query, required, evidence)
    summary = (f"Draft failed its output contract ({first['why']}); repaired answer "
               + ("passes." if second["ok"] else f"still fails ({second['why']})."))
    return {
        "operation": "augmenter.repair",
        "origin": "model",
        "summary": summary[:1500],
        "data": {
            "contract": kind,
            "initial": first,
            "final": second,
            "ok": second["ok"],
            "repaired": True,
            "repaired_answer": repaired if second["ok"] else None,
            "repaired_answer_sha256": hashlib.sha256(repaired.encode("utf-8")).hexdigest(),
        },
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
    }
