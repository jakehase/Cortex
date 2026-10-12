"""L26 model-backed planner: goal -> PROPOSED workflow DAG (never executed here).

The model chooses only from a small catalog of safe, existing step types
(memory search, knowledge search, council deliberation, ethics evaluation,
oracle answer).  It never writes endpoints, headers or methods itself; the
catalog maps each step type to the real route and builds a bounded payload.
The result is validated with the same ``validate_plan_graph`` the executor uses
and every node is checked with ``evaluate_step_permission``; a plan containing
anything that would need approval is rejected rather than trimmed silently.
Requests that need external or mutating actions are listed as out of scope.
"""

from __future__ import annotations

import re
import time
from typing import Any, Awaitable, Callable, Dict, List, Literal, Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field

MAX_PLAN_NODES = 8
_NODE_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_TEMPLATE_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_\-]+)(?:\.[^{}]+?)?\s*\}\}")

StepAction = Literal["memory_search", "knowledge_search", "council_deliberate", "ethics_evaluate", "oracle_answer"]

SAFE_STEP_CATALOG: Dict[str, Dict[str, Any]] = {
    "memory_search": {
        "method": "POST",
        "endpoint": "/librarian/search",
        "description": "Search the requesting user's own saved Cortex memory.",
        "inputs": {"query": (True, 500)},
        "fixed": {"n_results": 5},
    },
    "knowledge_search": {
        "method": "POST",
        "endpoint": "/knowledge/search",
        "description": "Search the Cortex knowledge graph for entities and relations.",
        "inputs": {"query": (True, 500)},
        "fixed": {"n_results": 5},
    },
    "council_deliberate": {
        "method": "POST",
        "endpoint": "/council/deliberate",
        "description": "Five-perspective model deliberation on a proposal or decision.",
        "inputs": {"topic": (True, 2000), "context": (False, 4000)},
        "fixed": {},
    },
    "ethics_evaluate": {
        "method": "POST",
        "endpoint": "/ethicist/evaluate",
        "description": "Model-backed ethical/risk evaluation of a proposed action.",
        "inputs": {"action": (True, 4000), "context": (False, 6000)},
        "fixed": {"severity": "medium"},
    },
    "oracle_answer": {
        "method": "POST",
        "endpoint": "/oracle/chat",
        "description": "General model answer, e.g. summarising earlier step results into a final response.",
        "inputs": {"prompt": (True, 4000)},
        "fixed": {},
    },
}


class PlannedStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str = Field(min_length=1, max_length=32)
    title: str = Field(min_length=1, max_length=120)
    action: StepAction
    inputs: Dict[str, str] = Field(default_factory=dict)
    depends_on: List[str] = Field(default_factory=list, max_length=MAX_PLAN_NODES - 1)


class PlanProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    goal_restatement: str = Field(default="", max_length=300)
    steps: List[PlannedStep] = Field(min_length=1, max_length=MAX_PLAN_NODES)
    out_of_scope: List[str] = Field(default_factory=list, max_length=6)


def _catalog_text() -> str:
    lines = []
    for action, spec in SAFE_STEP_CATALOG.items():
        fields = ", ".join(f"{name}{'' if required else ' (optional)'}" for name, (required, _cap) in spec["inputs"].items())
        lines.append(f"- {action}: {spec['description']} inputs: {fields}")
    return "\n".join(lines)


PLANNER_SYSTEM = (
    "You are the planner of Cortex level 26 (Orchestrator). Turn the user's goal into a small workflow DAG that "
    "Cortex can run with ONLY these step types:\n" + _catalog_text() + "\n"
    "Rules: at most 8 steps; node_id is lowercase snake_case; depends_on lists earlier node_ids whose results a "
    "step needs; to pass an earlier result into a text input, embed the template {{<node_id>.response}} inside the "
    "string and list that node in depends_on. Prefer the fewest steps that actually answer the goal. Never "
    "represent sending messages, purchases, scheduling, file or code changes, device control or web browsing as a "
    "step: list those parts of the goal in out_of_scope instead. Return ONLY JSON: {\"name\": \"...\", "
    "\"goal_restatement\": \"...\", \"steps\": [{\"node_id\": \"...\", \"title\": \"...\", \"action\": \"...\", "
    "\"inputs\": {\"...\": \"...\"}, \"depends_on\": []}], \"out_of_scope\": [\"...\"]}."
)


class PlanBuildError(ValueError):
    pass


def build_graph_payload(proposal: Mapping[str, Any], *, goal: str) -> Dict[str, Any]:
    """Map a validated PlanProposal dict onto ReasoningPlanGraph fields. Raises PlanBuildError."""

    nodes: List[Dict[str, Any]] = []
    declared: List[str] = []
    for step in proposal.get("steps") or []:
        node_id = str(step.get("node_id") or "")
        if not _NODE_ID_RE.fullmatch(node_id):
            raise PlanBuildError(f"invalid node_id: {node_id!r}")
        if node_id in declared:
            raise PlanBuildError(f"duplicate node_id: {node_id}")
        spec = SAFE_STEP_CATALOG.get(str(step.get("action") or ""))
        if spec is None:
            raise PlanBuildError(f"unsupported step type: {step.get('action')!r}")
        inputs = dict(step.get("inputs") or {})
        unknown = sorted(set(inputs) - set(spec["inputs"]))
        if unknown:
            raise PlanBuildError(f"step {node_id} has unsupported inputs: {', '.join(unknown)}")
        payload: Dict[str, Any] = {}
        for name, (required, cap) in spec["inputs"].items():
            value = str(inputs.get(name) or "").strip()
            if required and not value:
                raise PlanBuildError(f"step {node_id} is missing required input {name!r}")
            if len(value) > cap:
                raise PlanBuildError(f"step {node_id} input {name!r} exceeds {cap} characters")
            if value:
                payload[name] = value
        depends_on = [str(d) for d in (step.get("depends_on") or [])]
        for dep in depends_on:
            if dep not in declared:
                raise PlanBuildError(f"step {node_id} depends on unknown or later node {dep!r}")
        for value in payload.values():
            for ref in _TEMPLATE_RE.findall(str(value)):
                if ref not in depends_on:
                    raise PlanBuildError(f"step {node_id} templates {ref!r} without depending on it")
        payload.update(spec["fixed"])
        nodes.append({
            "node_id": node_id,
            "title": str(step.get("title") or node_id)[:120],
            "endpoint": spec["endpoint"],
            "method": spec["method"],
            "payload": payload,
            "depends_on": depends_on,
            "failure_mode": "halt",
            "metadata": {"step_type": step.get("action"), "planned_by": "l26_planner"},
        })
        declared.append(node_id)
    if not nodes:
        raise PlanBuildError("plan has no steps")
    return {
        "name": re.sub(r"\s+", " ", str(proposal.get("name") or "planned_workflow"))[:80],
        "goal": goal[:2000],
        "description": str(proposal.get("goal_restatement") or "")[:300],
        "nodes": nodes,
        "metadata": {"planner": "l26_model_planner", "proposal_only": True},
    }


async def propose_plan(
    goal: str,
    *,
    principal_scope_key: str,
    context: Optional[str] = None,
    max_nodes: int = 6,
    model_fn: Optional[Callable[..., Awaitable[Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    """Return a validated PROPOSED plan graph; executes nothing."""

    from cortex_server.modules.level_model import unavailable_payload
    from cortex_server.modules.reasoning_planner import PlanGraphError, ReasoningPlanGraph, validate_plan_graph
    from cortex_server.modules.reasoning_safety import evaluate_step_permission

    started = time.monotonic()
    text = " ".join(str(goal or "").split())
    base = {"operation": "orchestrator.plan", "executed": False}
    if not text:
        return {**base, "success": False, "status": "empty_goal"}
    if len(text) > 4000:
        return {**base, "success": False, "status": "goal_too_long"}
    if not str(principal_scope_key or "").strip():
        return {**base, "success": False, "status": "missing_principal_scope"}
    limit = max(1, min(int(max_nodes or 6), MAX_PLAN_NODES))
    if model_fn is None:
        from cortex_server.modules.level_model import level_model_json as model_fn  # type: ignore[no-redef]
    prompt = (
        f"Goal: {text}\n"
        + (f"Context: {str(context)[:2000]}\n" if context else "")
        + f"Use at most {limit} steps."
    )
    result = await model_fn(
        level=26, name="orchestrator", system=PLANNER_SYSTEM, prompt=prompt,
        principal_scope_key=principal_scope_key, schema=PlanProposal, deadline_s=60.0,
    )
    if not isinstance(result, dict) or result.get("status") != "ok":
        return {**base, **unavailable_payload(result if isinstance(result, dict) else {}, operation="orchestrator.plan"),
                "executed": False}
    proposal = result.get("data") or {}
    meta = {"model": result.get("model"), "receipt_id": result.get("receipt_id"), "origin": "model"}
    if len(proposal.get("steps") or []) > limit:
        return {**base, **meta, "success": False, "status": "invalid_plan",
                "error": f"plan has more than {limit} steps"}
    try:
        graph_payload = build_graph_payload(proposal, goal=text)
        graph = ReasoningPlanGraph(**graph_payload)
        summary = validate_plan_graph(graph)
    except (PlanBuildError, PlanGraphError, ValueError) as exc:
        return {**base, **meta, "success": False, "status": "invalid_plan", "error": str(exc)[:300]}

    safety = []
    for node in graph_payload["nodes"]:
        decision = evaluate_step_permission(node, workflow_metadata={})
        safety.append({
            "node_id": node["node_id"],
            "allow": bool(decision.get("allow")),
            "risk": decision.get("risk"),
            "approval_required": bool(decision.get("approval_required")),
            "reason": decision.get("reason"),
        })
    unsafe = [row for row in safety if not row["allow"] or row["approval_required"]]
    if unsafe:
        return {**base, **meta, "success": False, "status": "unsafe_plan_rejected", "safety": safety}
    return {
        **base,
        **meta,
        "success": True,
        "status": "proposed",
        "requires_confirmation": True,
        "plan_graph": graph_payload,
        "validation": summary,
        "safety": safety,
        "out_of_scope": [str(x)[:200] for x in (proposal.get("out_of_scope") or [])][:6],
        "execute_with": {
            "method": "POST",
            "path": "/orchestrator/plan/execute",
            "note": "Run only after the user confirms; steps execute as the confirming principal.",
        },
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }


__all__ = [
    "MAX_PLAN_NODES",
    "PLANNER_SYSTEM",
    "PlanBuildError",
    "PlanProposal",
    "PlannedStep",
    "SAFE_STEP_CATALOG",
    "build_graph_payload",
    "propose_plan",
]
