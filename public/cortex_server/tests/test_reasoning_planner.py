import pytest

from cortex_server.modules.reasoning_kernel import model_dump_compat
from cortex_server.modules.reasoning_planner import (
    PlanGraphError,
    ReasoningPlanGraph,
    compile_plan_to_reasoning_task,
    compile_plan_to_workflow,
    dependency_failures,
    plan_execution_order,
    render_plan_templates,
    validate_plan_graph,
)



def _sample_graph() -> ReasoningPlanGraph:
    return ReasoningPlanGraph(
        name="user_lookup_plan",
        goal="Lookup a user and then summarize the result",
        description="Dependency-aware planner graph",
        metadata={"owner": "cortex", "session_key": "session:planner", "archetype": "coding"},
        success_criteria=["summary is produced"],
        constraints=["stay in local API"],
        nodes=[
            {
                "node_id": "fetch_user",
                "title": "Fetch user",
                "endpoint": "/users/get",
                "method": "POST",
                "payload": {"user_id": 7},
                "success_criteria": ["HTTP 200"],
            },
            {
                "node_id": "summarize",
                "title": "Summarize user",
                "endpoint": "/oracle/chat",
                "method": "POST",
                "depends_on": ["fetch_user"],
                "payload": {"prompt": "Summarize {{fetch_user.response.name}}"},
                "preconditions": ["fetch_user succeeded"],
                "success_criteria": ["contains user name"],
            },
        ],
    )



def test_validate_plan_graph_and_compile_to_workflow_orders_dependencies():
    graph = _sample_graph()
    summary = validate_plan_graph(graph)
    workflow = compile_plan_to_workflow(graph)

    assert summary["execution_order"] == ["fetch_user", "summarize"]
    assert summary["root_nodes"] == ["fetch_user"]
    assert summary["leaf_nodes"] == ["summarize"]
    assert workflow["steps"][0]["node_id"] == "fetch_user"
    assert workflow["steps"][1]["depends_on"] == ["fetch_user"]
    assert workflow["metadata"]["plan_graph"]["edge_count"] == 1



def test_plan_execution_order_rejects_cycles():
    graph = ReasoningPlanGraph(
        name="cycle",
        nodes=[
            {"node_id": "a", "title": "A", "endpoint": "/a", "depends_on": ["b"]},
            {"node_id": "b", "title": "B", "endpoint": "/b", "depends_on": ["a"]},
        ],
    )
    with pytest.raises(PlanGraphError):
        plan_execution_order(graph)



def test_compile_plan_to_reasoning_task_projects_dependencies_and_verification():
    graph = _sample_graph()
    task = compile_plan_to_reasoning_task(graph, task_id="task_plan_demo")
    data = model_dump_compat(task)

    assert data["task_id"] == "task_plan_demo"
    assert data["status"] == "ready"
    assert data["subtasks"][0]["status"] == "ready"
    assert data["subtasks"][1]["status"] == "blocked"
    assert data["subtasks"][1]["depends_on"] == ["fetch_user"]
    assert data["subtasks"][1]["verification"][0]["method"] == "precondition"
    assert data["subtasks"][1]["verification"][1]["method"] == "success_criteria"
    assert data["metadata"]["plan_summary"]["execution_order"] == ["fetch_user", "summarize"]



def test_render_plan_templates_and_dependency_failures_use_prior_node_results():
    results_by_node = {
        "fetch_user": {
            "success": True,
            "status_code": 200,
            "response": {"name": "Jake", "tags": ["admin", "owner"]},
        },
        "failed_dep": {
            "success": False,
            "status_code": 500,
            "response": {"error": "boom"},
        },
    }

    payload = {
        "prompt": "Summarize {{fetch_user.response.name}}",
        "user": "{{fetch_user.response}}",
        "first_tag": "{{fetch_user.response.tags.0}}",
    }
    rendered = render_plan_templates(payload, results_by_node)

    assert rendered["prompt"] == "Summarize Jake"
    assert rendered["user"] == {"name": "Jake", "tags": ["admin", "owner"]}
    assert rendered["first_tag"] == "admin"

    blocked = dependency_failures({"depends_on": ["fetch_user", "failed_dep", "missing_dep"]}, results_by_node)
    assert blocked == ["failed_dep", "missing_dep"]
