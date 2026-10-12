"""ExecutionEngine adapter for L19 Geneticist: for a Python code block in the
message, generate two model candidates toward the user's objective, measure each
deterministically, and return the selected diff. Inline code only; never applies."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters._safe_level_common import (
    blocked_from_status,
    clip,
    code_blocks,
    require_query,
    require_scope,
    strip_code_blocks,
)

LEVEL = 19
NAME = "geneticist"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # proposals only (in memory); writing needs /geneticist/apply approval
DEFAULT_DEADLINE_S = 120.0
_MAX_CODE = 20_000
_MAX_DIFF_LINES = 200


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.routers import geneticist as geneticist_router

    text = require_query(query)
    blocks = [b for b in code_blocks(text) if b["language"] in {"python", ""}]
    if not blocks:
        raise ExecutionBlocked("no_python_code_block_in_message")
    code = blocks[0]["code"]
    if len(code) > _MAX_CODE:
        raise ExecutionBlocked("code_block_too_large")
    tests = blocks[1]["code"] if len(blocks) > 1 and "assert" in blocks[1]["code"] else None
    objective = clip(strip_code_blocks(text), 500) or "Improve this code without changing its behaviour."
    scope = require_scope(context)
    out = await geneticist_router.propose_candidates_core(
        code=code,
        objective=objective,
        strategy="mutate",
        candidates=2,
        principal_scope_key=scope,
        owner="adapter:" + scope,
        tests=tests,
        store=False,
    )
    if not out.get("success"):
        if out.get("error") == "no_viable_candidate":
            raise ExecutionBlocked("no_viable_candidate")
        if out.get("error") == "model_breaker_open":
            raise ExecutionBlocked("model_unavailable:breaker_open")
        raise blocked_from_status(out.get("status"))
    selected = out["selected"]
    fitness = selected["fitness"]
    diff_lines = str(selected.get("diff") or "").splitlines()
    alternatives = [
        {"id": c["id"], "score": c["fitness"]["score"], "viable": c["fitness"]["viable"],
         "not_viable_reasons": c["fitness"]["not_viable_reasons"]}
        for c in out["candidates"] if c["id"] != out["selected_id"]
    ]
    summary = (
        f"Geneticist selected {out['selected_id']} ({selected['mutation_type']}): {clip(selected['description'], 400)} "
        f"Measured: compiles={fitness['compiles']}, lint={fitness['lint']['count']}, "
        f"complexity Δ={fitness['complexity_delta']}, diff={fitness['diff']['diff_lines']} lines, "
        f"tests={fitness['tests'].get('status')}, score={fitness['score']}. "
        f"Alternatives: {', '.join(str(a['id']) + '=' + str(a['score']) for a in alternatives) or 'none'}. "
        "Proposal only — nothing was written."
    )
    return {
        "operation": "geneticist.propose",
        "origin": "model",
        "summary": clip(summary, 1500),
        "data": {
            "selected": {
                "id": out["selected_id"],
                "mutation_type": selected["mutation_type"],
                "description": clip(selected["description"], 600),
                "diff": "\n".join(diff_lines[:_MAX_DIFF_LINES]),
                "diff_truncated": len(diff_lines) > _MAX_DIFF_LINES,
                "fitness": {k: fitness[k] for k in ("compiles", "score", "complexity_delta", "viable")}
                | {"lint_issues": fitness["lint"]["count"], "diff_lines": fitness["diff"]["diff_lines"],
                   "tests": fitness["tests"].get("status")},
            },
            "alternatives": alternatives,
            "selection_rule": out["selection_rule"],
            "applied": False,
        },
        "model": selected.get("model"),
        "receipt_id": selected.get("receipt_id"),
    }
