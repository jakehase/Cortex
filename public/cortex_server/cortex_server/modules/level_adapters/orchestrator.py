"""ExecutionEngine adapter for L26 Orchestrator: PLAN ONLY.

Turns the user's multi-step request into a validated, PROPOSED workflow DAG
built only from safe step types (memory search, knowledge search, council,
ethicist, oracle answer).  It executes nothing: running the plan requires the
user's confirmation and ``POST /orchestrator/plan/execute``.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules import orchestrator_planner
from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 26
NAME = "orchestrator"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # proposal only; no step is executed
DEFAULT_DEADLINE_S = 65.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    ctx = dict(context or {})
    scope = str(ctx.get("principal_scope_key") or "").strip()
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    if not str(query or "").strip():
        raise ExecutionBlocked("empty_query")
    extra = []
    if ctx.get("conversation"):
        extra.append(f"Recent conversation: {str(ctx['conversation'])[:1000]}")
    if ctx.get("oracle_brief"):
        extra.append(f"Oracle brief: {str(ctx['oracle_brief'])[:800]}")
    result = await orchestrator_planner.propose_plan(
        query,
        principal_scope_key=scope,
        context="\n".join(extra) or None,
        max_nodes=6,
    )
    status = str(result.get("status") or "")
    if result.get("origin") == "model_unavailable":
        raise ExecutionBlocked(status or "model_unavailable")
    if status != "proposed":
        raise ExecutionBlocked(status or "plan_rejected")
    graph = result["plan_graph"]
    nodes = graph.get("nodes") or []
    steps = [
        {
            "node_id": node["node_id"],
            "title": node["title"][:120],
            "step_type": (node.get("metadata") or {}).get("step_type"),
            "depends_on": node.get("depends_on") or [],
        }
        for node in nodes[: orchestrator_planner.MAX_PLAN_NODES]
    ]
    order = (result.get("validation") or {}).get("execution_order") or [s["node_id"] for s in steps]
    out_of_scope = result.get("out_of_scope") or []
    summary = (
        f"PROPOSED workflow (not executed), {len(steps)} step(s) in order {' -> '.join(order)}: "
        + "; ".join(f"{s['node_id']}={s['step_type']} ({s['title']})" for s in steps)
        + (". Out of scope (needs separate approval): " + "; ".join(out_of_scope) if out_of_scope else "")
        + ". Executing requires user confirmation."
    )
    return {
        "operation": "orchestrator.plan",
        "origin": "model",
        "summary": summary[:1500],
        "data": {
            "status": status,
            "executed": False,
            "requires_confirmation": True,
            "name": graph.get("name"),
            "steps": steps,
            "execution_order": order,
            "out_of_scope": out_of_scope,
            "plan_graph": graph,
        },
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
    }
