from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Literal, Optional, Sequence, Tuple

from pydantic import BaseModel, Field

from cortex_server.runtime.agent_work_dsl import AgentWorkPermissions, AgentWorkSurface, CortexAgentWorkHandoff
from cortex_server.modules.reasoning_kernel import (
    ReasoningTask,
    Subtask,
    VerificationSpec,
    model_dump_compat,
)


PlanFailureMode = Literal["halt", "continue", "retry", "compensate"]


class PlanNode(BaseModel):
    node_id: str
    title: str
    endpoint: str
    method: str = "POST"
    payload: Dict[str, Any] = Field(default_factory=dict)
    headers: Dict[str, str] = Field(default_factory=dict)
    timeout_seconds: Optional[float] = None
    depends_on: List[str] = Field(default_factory=list)
    preconditions: List[str] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list)
    contracts: List[Dict[str, Any]] = Field(default_factory=list)
    failure_mode: PlanFailureMode = "halt"
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ReasoningPlanGraph(BaseModel):
    version: str = "cortex.reasoning.plan.v1"
    name: str
    goal: str = ""
    description: str = ""
    nodes: List[PlanNode]
    metadata: Dict[str, Any] = Field(default_factory=dict)
    success_criteria: List[str] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)


class PlanGraphSummary(BaseModel):
    name: str
    node_count: int
    edge_count: int
    root_nodes: List[str] = Field(default_factory=list)
    leaf_nodes: List[str] = Field(default_factory=list)
    execution_order: List[str] = Field(default_factory=list)


class PlanGraphError(ValueError):
    pass


_TEMPLATE_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_\-]+)(?:\.([^{}]+?))?\s*\}\}")



def _node_map(graph: ReasoningPlanGraph) -> Dict[str, PlanNode]:
    nodes: Dict[str, PlanNode] = {}
    for node in graph.nodes:
        if node.node_id in nodes:
            raise PlanGraphError(f"duplicate node_id: {node.node_id}")
        nodes[node.node_id] = node
    return nodes



def _walk_path(value: Any, path: str) -> Any:
    current = value
    if not path:
        return current
    for raw_segment in [seg for seg in path.split(".") if seg != ""]:
        if isinstance(current, dict):
            if raw_segment not in current:
                raise PlanGraphError(f"template path not found: {path}")
            current = current[raw_segment]
        elif isinstance(current, (list, tuple)):
            try:
                idx = int(raw_segment)
            except Exception as exc:  # noqa: BLE001
                raise PlanGraphError(f"template list index invalid: {path}") from exc
            if idx < 0 or idx >= len(current):
                raise PlanGraphError(f"template list index out of range: {path}")
            current = current[idx]
        else:
            raise PlanGraphError(f"template path not traversable: {path}")
    return current



def validate_plan_graph(graph: ReasoningPlanGraph) -> Dict[str, Any]:
    if not graph.nodes:
        raise PlanGraphError("plan graph must include at least one node")
    nodes = _node_map(graph)
    for node in graph.nodes:
        if not str(node.endpoint or "").startswith("/"):
            raise PlanGraphError(f"node {node.node_id} endpoint must start with '/'")
        if node.node_id in set(node.depends_on):
            raise PlanGraphError(f"node {node.node_id} cannot depend on itself")
        for dep in node.depends_on:
            if dep not in nodes:
                raise PlanGraphError(f"node {node.node_id} depends on unknown node {dep}")
    order = plan_execution_order(graph)
    roots = sorted([node.node_id for node in graph.nodes if not node.depends_on])
    deps = {dep for node in graph.nodes for dep in node.depends_on}
    leaves = sorted([node.node_id for node in graph.nodes if node.node_id not in deps])
    edge_count = sum(len(node.depends_on) for node in graph.nodes)
    return model_dump_compat(
        PlanGraphSummary(
            name=graph.name,
            node_count=len(graph.nodes),
            edge_count=edge_count,
            root_nodes=roots,
            leaf_nodes=leaves,
            execution_order=order,
        )
    )



def plan_execution_order(graph: ReasoningPlanGraph) -> List[str]:
    nodes = _node_map(graph)
    indegree: Dict[str, int] = {node_id: 0 for node_id in nodes}
    outgoing: Dict[str, List[str]] = {node_id: [] for node_id in nodes}
    for node in graph.nodes:
        for dep in node.depends_on:
            indegree[node.node_id] += 1
            outgoing.setdefault(dep, []).append(node.node_id)

    ready = sorted([node_id for node_id, degree in indegree.items() if degree == 0])
    order: List[str] = []
    while ready:
        node_id = ready.pop(0)
        order.append(node_id)
        for nxt in sorted(outgoing.get(node_id, [])):
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                ready.append(nxt)
                ready.sort()

    if len(order) != len(nodes):
        cycle_nodes = sorted([node_id for node_id, degree in indegree.items() if degree > 0])
        raise PlanGraphError(f"plan graph contains cycle involving: {', '.join(cycle_nodes)}")
    return order



def _verification_specs(node: PlanNode) -> List[VerificationSpec]:
    specs: List[VerificationSpec] = []
    for item in node.preconditions:
        specs.append(VerificationSpec(method="precondition", required=True, success_signal=item, verifier="planner"))
    for item in node.success_criteria:
        specs.append(VerificationSpec(method="success_criteria", required=True, success_signal=item, verifier="planner"))
    return specs


def _contract_from_precondition(item: str) -> Dict[str, Any]:
    raw = str(item or "").strip()
    if raw.startswith("dependency_success:"):
        return {"kind": "dependency_success", "stage": "pre", "target_node": raw.split(":", 1)[1].strip()}
    return {"kind": "dependency_success", "stage": "pre", "target_node": raw}


def _contract_from_success_criteria(item: str) -> Dict[str, Any]:
    raw = str(item or "").strip()
    if raw.startswith("response_status:"):
        parts = [int(x.strip()) for x in raw.split(":", 1)[1].split(",") if x.strip()]
        return {"kind": "response_status", "stage": "post", "status_codes": parts or [200]}
    if raw.startswith("response_path_equals:"):
        expr = raw.split(":", 1)[1]
        path, _, expected = expr.partition("=")
        expected_value: Any = expected
        lowered = expected.strip().lower()
        if lowered in {"true", "false"}:
            expected_value = lowered == "true"
        else:
            try:
                expected_value = int(expected.strip())
            except Exception:
                pass
        return {"kind": "response_path_equals", "stage": "post", "path": path.strip(), "expected": expected_value}
    if raw.startswith("response_path_exists:"):
        return {"kind": "response_path_exists", "stage": "post", "path": raw.split(":", 1)[1].strip()}
    if raw.startswith("approval_required"):
        _, _, scope = raw.partition(":")
        return {"kind": "approval_required", "stage": "pre", "approval_scope": scope.strip() or "workflow"}
    return {"kind": "response_path_exists", "stage": "post", "path": raw}


def _compiled_contracts(node: PlanNode) -> List[Dict[str, Any]]:
    contracts: List[Dict[str, Any]] = []
    contracts.extend(dict(item) for item in (node.contracts or []))
    contracts.extend(_contract_from_precondition(item) for item in (node.preconditions or []))
    contracts.extend(_contract_from_success_criteria(item) for item in (node.success_criteria or []))
    return contracts


def _metadata_list(metadata: Dict[str, Any], *keys: str) -> List[str]:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item or "").strip()]
        if isinstance(value, str) and value.strip():
            return [item.strip() for item in re.split(r",|\n", value) if item.strip()]
    return []


def _payload_list(payload: Dict[str, Any], *keys: str) -> List[str]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item or "").strip()]
        if isinstance(value, str) and value.strip():
            return [item.strip() for item in re.split(r",|\n", value) if item.strip()]
    return []


def compile_plan_to_agent_work_handoff(
    graph: ReasoningPlanGraph,
    *,
    repo_path: str,
    goal_id: Optional[str] = None,
    run_id: Optional[str] = None,
    owner: Optional[str] = None,
    session: Optional[Dict[str, Any]] = None,
    fidelity: Optional[str] = None,
    requested_agent_count: Optional[int] = None,
    permissions: Optional[Dict[str, Any]] = None,
    route_levels: Optional[Sequence[str]] = None,
    memory_citations: Optional[Sequence[str]] = None,
) -> CortexAgentWorkHandoff:
    """Compile a Cortex reasoning plan into an Agent Work handoff.

    Plan nodes are intentionally required to declare concrete product files and
    verifier commands in metadata/payload. This keeps Cortex responsible for
    intent and provenance without guessing executable implementation surfaces.
    """
    summary = validate_plan_graph(graph)
    nodes = _node_map(graph)
    node_to_surface_id = {
        node_id: str((nodes[node_id].metadata or {}).get("surface_id") or node_id)
        for node_id in summary["execution_order"]
    }
    surfaces: List[AgentWorkSurface] = []
    for node_id in summary["execution_order"]:
        node = nodes[node_id]
        metadata = dict(node.metadata or {})
        payload = dict(node.payload or {})
        files = _metadata_list(metadata, "files", "productFiles", "product_files", "paths") or _payload_list(payload, "files", "productFiles", "product_files", "paths")
        verify = _metadata_list(metadata, "verify", "verifiers", "verification", "verifierCommands", "verifier_commands") or _payload_list(payload, "verify", "verifiers", "verification", "verifierCommands", "verifier_commands")
        if not files:
            raise PlanGraphError(f"node {node.node_id} cannot become Agent Work surface without files/productFiles metadata")
        if not verify:
            raise PlanGraphError(f"node {node.node_id} cannot become Agent Work surface without verify/verifiers metadata")
        surfaces.append(
            AgentWorkSurface(
                id=node_to_surface_id[node_id],
                label=node.title,
                goal=str(metadata.get("goal") or node.title),
                files=files,
                verify=verify,
                deps=[node_to_surface_id.get(dep, dep) for dep in node.depends_on],
                lane=str(metadata.get("lane") or "cortex_agent_work"),
                domain=str(metadata.get("domain") or node_to_surface_id[node_id]),
                metadata={
                    **metadata,
                    "planNodeId": node.node_id,
                    "endpoint": node.endpoint,
                    "method": node.method.upper(),
                    "contracts": list(_compiled_contracts(node)),
                },
            )
        )

    graph_metadata = dict(graph.metadata or {})
    permission_payload = permissions or graph_metadata.get("permissions") or {}
    session_payload = dict(session or {}) if session is not None else ({"session_key": graph_metadata.get("session_key")} if graph_metadata.get("session_key") else {})
    return CortexAgentWorkHandoff(
        goalId=goal_id or str(graph_metadata.get("goal_id") or graph.name),
        objective=graph.goal or graph.description or graph.name,
        repoPath=repo_path,
        benchmarkId=graph_metadata.get("benchmarkId") or graph_metadata.get("benchmark_id"),
        benchmarkTier=graph_metadata.get("benchmarkTier") or graph_metadata.get("benchmark_tier") or "execution_smoke",
        runId=run_id or graph_metadata.get("run_id"),
        artifactRoot=graph_metadata.get("artifactRoot") or graph_metadata.get("artifact_root"),
        scoreboardPath=graph_metadata.get("scoreboardPath") or graph_metadata.get("scoreboard_path"),
        fidelity=fidelity or graph_metadata.get("fidelity") or "production_slice",
        requestedAgentCount=int(requested_agent_count or graph_metadata.get("requestedAgentCount") or graph_metadata.get("requested_agent_count") or max(1, len(surfaces))),
        executionBoundary=graph_metadata.get("executionBoundary") or graph_metadata.get("execution_boundary") or "control_plane_allowed",
        stopCondition=graph_metadata.get("stopCondition") or graph_metadata.get("stop_condition") or "supervisor_green_or_blocker_report",
        owner=owner or graph_metadata.get("owner"),
        session=session_payload,
        permissions=AgentWorkPermissions(**permission_payload),
        doneWhen=list(graph.success_criteria or graph_metadata.get("doneWhen") or graph_metadata.get("done_when") or []),
        routeLevels=list(route_levels or graph_metadata.get("routeLevels") or graph_metadata.get("route_levels") or []),
        memoryCitations=list(memory_citations or graph_metadata.get("memoryCitations") or graph_metadata.get("memory_citations") or []),
        surfaces=surfaces,
        metadata={
            "sourcePlanGraph": summary,
            "constraints": list(graph.constraints),
            "description": graph.description,
        },
    )



def compile_plan_to_reasoning_task(
    graph: ReasoningPlanGraph,
    *,
    task_id: Optional[str] = None,
    owner: Optional[str] = None,
    session_key: Optional[str] = None,
    archetype: Optional[str] = None,
) -> ReasoningTask:
    summary = validate_plan_graph(graph)
    node_lookup = _node_map(graph)
    subtasks: List[Subtask] = []
    for order, node_id in enumerate(summary["execution_order"], start=1):
        node = node_lookup[node_id]
        subtasks.append(
            Subtask(
                task_id=f"{task_id or f'plan_{graph.name}'}:{node.node_id}",
                title=node.title,
                description=f"{node.method.upper()} {node.endpoint}",
                status="ready" if not node.depends_on else "blocked",
                order=order,
                owner=owner,
                depends_on=list(node.depends_on),
                verification=_verification_specs(node),
                metadata={
                    "node_id": node.node_id,
                    "endpoint": node.endpoint,
                    "method": node.method.upper(),
                    "failure_mode": node.failure_mode,
                    "payload": dict(node.payload),
                    "headers": dict(node.headers),
                    "timeout_seconds": node.timeout_seconds,
                    "contracts": list(_compiled_contracts(node)),
                    **dict(node.metadata or {}),
                },
            )
        )
    return ReasoningTask(
        task_id=task_id or f"task_plan_{graph.name}",
        title=graph.name,
        description=graph.description or graph.goal,
        status="ready",
        owner=owner or (graph.metadata or {}).get("owner"),
        session_key=session_key or (graph.metadata or {}).get("session_key"),
        archetype=archetype or (graph.metadata or {}).get("archetype"),
        subtasks=subtasks,
        success_criteria=list(graph.success_criteria),
        constraints=list(graph.constraints),
        metadata={
            **dict(graph.metadata or {}),
            "goal": graph.goal,
            "plan_summary": summary,
        },
    )



def compile_plan_to_workflow(graph: ReasoningPlanGraph) -> Dict[str, Any]:
    summary = validate_plan_graph(graph)
    nodes = _node_map(graph)
    ordered_steps: List[Dict[str, Any]] = []
    for node_id in summary["execution_order"]:
        node = nodes[node_id]
        ordered_steps.append(
            {
                "node_id": node.node_id,
                "title": node.title,
                "endpoint": node.endpoint,
                "method": node.method.upper(),
                "payload": dict(node.payload),
                "headers": dict(node.headers),
                "timeout_seconds": node.timeout_seconds,
                "depends_on": list(node.depends_on),
                "preconditions": list(node.preconditions),
                "success_criteria": list(node.success_criteria),
                "contracts": list(_compiled_contracts(node)),
                "failure_mode": node.failure_mode,
                "metadata": dict(node.metadata or {}),
            }
        )
    return {
        "name": graph.name,
        "steps": ordered_steps,
        "metadata": {
            **dict(graph.metadata or {}),
            "goal": graph.goal,
            "description": graph.description,
            "success_criteria": list(graph.success_criteria),
            "constraints": list(graph.constraints),
            "plan_graph": summary,
        },
    }



def _resolve_token(token: str, results_by_node: Dict[str, Dict[str, Any]]) -> Any:
    node_id, _, path = token.partition(".")
    if node_id not in results_by_node:
        raise PlanGraphError(f"template references unknown or unavailable node result: {node_id}")
    value = results_by_node[node_id]
    if path:
        value = _walk_path(value, path)
    return value



def render_plan_templates(value: Any, results_by_node: Dict[str, Dict[str, Any]]) -> Any:
    if isinstance(value, dict):
        return {str(k): render_plan_templates(v, results_by_node) for k, v in value.items()}
    if isinstance(value, list):
        return [render_plan_templates(v, results_by_node) for v in value]
    if isinstance(value, tuple):
        return tuple(render_plan_templates(v, results_by_node) for v in value)
    if not isinstance(value, str):
        return value

    matches = list(_TEMPLATE_RE.finditer(value))
    if not matches:
        return value

    if len(matches) == 1 and matches[0].span() == (0, len(value)):
        token = f"{matches[0].group(1)}"
        if matches[0].group(2):
            token = f"{token}.{matches[0].group(2)}"
        return _resolve_token(token, results_by_node)

    out = value
    for match in matches:
        token = f"{match.group(1)}"
        if match.group(2):
            token = f"{token}.{match.group(2)}"
        resolved = _resolve_token(token, results_by_node)
        out = out.replace(match.group(0), str(resolved))
    return out



def dependency_failures(step: Dict[str, Any], results_by_node: Dict[str, Dict[str, Any]]) -> List[str]:
    blocked: List[str] = []
    for dep in step.get("depends_on", []) or []:
        dep_result = results_by_node.get(str(dep))
        if not dep_result or not bool(dep_result.get("success")):
            blocked.append(str(dep))
    return blocked


__all__ = [
    "PlanGraphError",
    "PlanGraphSummary",
    "PlanNode",
    "ReasoningPlanGraph",
    "compile_plan_to_reasoning_task",
    "compile_plan_to_agent_work_handoff",
    "compile_plan_to_workflow",
    "dependency_failures",
    "plan_execution_order",
    "render_plan_templates",
    "validate_plan_graph",
]
