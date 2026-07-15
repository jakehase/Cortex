import math
import os

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

# Importing the knowledge router constructs its persistence client. Keep that
# collection-time state in the writable test sandbox.
os.environ["CORTEX_CHROMA_DIR"] = "/tmp/cortex-graph-bounds-chroma"
os.environ["LIBRARIAN_FALLBACK_LOG_PATH"] = "/tmp/cortex-graph-bounds-chroma/fallback.jsonl"

from cortex_server.routers import knowledge


def _node_payload(**overrides):
    payload = {"type": "Function", "name": "bounded-node", "metadata": {}}
    payload.update(overrides)
    return payload


def _edge_payload(**overrides):
    payload = {
        "type": "CALLS",
        "source_id": "source",
        "target_id": "target",
        "metadata": {},
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize(
    ("model", "payload", "field", "limit"),
    [
        (knowledge.BoundedGraphNodeCreateRequest, _node_payload(), "id", knowledge.MAX_GRAPH_STRING_LENGTH),
        (knowledge.BoundedGraphNodeCreateRequest, _node_payload(), "type", knowledge.MAX_GRAPH_TYPE_LENGTH),
        (knowledge.BoundedGraphNodeCreateRequest, _node_payload(), "name", knowledge.MAX_GRAPH_STRING_LENGTH),
        (knowledge.BoundedGraphNodeCreateRequest, _node_payload(), "uri", knowledge.MAX_GRAPH_STRING_LENGTH),
        (knowledge.BoundedGraphNodeCreateRequest, _node_payload(), "language", knowledge.MAX_GRAPH_LANGUAGE_LENGTH),
        (knowledge.BoundedGraphEdgeCreateRequest, _edge_payload(), "id", knowledge.MAX_GRAPH_STRING_LENGTH),
        (knowledge.BoundedGraphEdgeCreateRequest, _edge_payload(), "type", knowledge.MAX_GRAPH_TYPE_LENGTH),
        (knowledge.BoundedGraphEdgeCreateRequest, _edge_payload(), "source_id", knowledge.MAX_GRAPH_STRING_LENGTH),
        (knowledge.BoundedGraphEdgeCreateRequest, _edge_payload(), "target_id", knowledge.MAX_GRAPH_STRING_LENGTH),
        (knowledge.BoundedGraphEdgeCreateRequest, _edge_payload(), "context", knowledge.MAX_GRAPH_STRING_LENGTH),
    ],
)
def test_graph_create_models_bound_every_top_level_string(model, payload, field, limit):
    with pytest.raises(ValidationError):
        model(**{**payload, field: "x" * (limit + 1)})


@pytest.mark.parametrize("model,payload", [
    (knowledge.BoundedGraphNodeCreateRequest, _node_payload()),
    (knowledge.BoundedGraphEdgeCreateRequest, _edge_payload()),
])
def test_graph_create_models_reject_malformed_or_oversized_metadata(model, payload):
    too_deep = current = {}
    for _ in range(knowledge.MAX_GRAPH_METADATA_DEPTH + 1):
        child = {}
        current["child"] = child
        current = child

    invalid_metadata = [
        too_deep,
        {"items": list(range(knowledge.MAX_GRAPH_METADATA_NODES))},
        {"x" * (knowledge.MAX_GRAPH_METADATA_KEY + 1): True},
        {"value": "x" * (knowledge.MAX_GRAPH_METADATA_STRING + 1)},
        {str(index): "x" * knowledge.MAX_GRAPH_METADATA_STRING for index in range(5)},
        {"value": math.inf},
        {"value": ("tuples", "are", "not", "json-input")},
    ]

    for metadata in invalid_metadata:
        with pytest.raises(ValidationError):
            model(**{**payload, "metadata": metadata})


def test_graph_create_models_accept_bounded_compatible_payloads():
    node = knowledge.BoundedGraphNodeCreateRequest(**_node_payload(
        id="node-id",
        uri="file:///tmp/example.py",
        language="python",
        metadata={"tags": ["one", "two"], "score": 1.0, "active": True},
    ))
    edge = knowledge.BoundedGraphEdgeCreateRequest(**_edge_payload(
        id="edge-id",
        weight=0.5,
        context="call site",
        metadata={"line": 42, "optional": None},
    ))

    assert node.name == "bounded-node"
    assert edge.source_id == "source"


def test_graph_create_endpoints_are_bound_to_hardened_models():
    routes = {(route.path, tuple(sorted(route.methods))): route for route in knowledge.router.routes}
    node_route = routes[("/nodes", ("POST",))]
    edge_route = routes[("/edges", ("POST",))]

    assert node_route.dependant.body_params[0].field_info.annotation is knowledge.BoundedGraphNodeCreateRequest
    assert edge_route.dependant.body_params[0].field_info.annotation is knowledge.BoundedGraphEdgeCreateRequest


@pytest.mark.asyncio
async def test_graph_create_endpoints_reject_oversized_input_before_persistence(monkeypatch):
    async def unexpected_write(_request):
        pytest.fail("invalid request reached persistence")

    monkeypatch.setattr(knowledge.service, "create_node", unexpected_write)
    monkeypatch.setattr(knowledge.service, "create_edge", unexpected_write)
    app = FastAPI()
    app.include_router(knowledge.router, prefix="/knowledge")
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        node_response = await client.post(
            "/knowledge/nodes",
            json=_node_payload(name="x" * (knowledge.MAX_GRAPH_STRING_LENGTH + 1)),
        )
        edge_response = await client.post(
            "/knowledge/edges",
            json=_edge_payload(metadata={
                "value": "x" * (knowledge.MAX_GRAPH_METADATA_STRING + 1),
            }),
        )

    assert node_response.status_code == 422
    assert edge_response.status_code == 422


@pytest.mark.asyncio
async def test_graph_create_endpoints_forward_compatible_bounded_requests(monkeypatch):
    observed = []

    async def record_write(request, *, tenant_id, storage_workspace_id):
        observed.append((request, tenant_id, storage_workspace_id))
        return {"id": request.id}

    monkeypatch.setattr(knowledge.service, "create_node", record_write)
    monkeypatch.setattr(knowledge.service, "create_edge", record_write)
    node = knowledge.BoundedGraphNodeCreateRequest(**_node_payload(id="node-id"))
    edge = knowledge.BoundedGraphEdgeCreateRequest(**_edge_payload(id="edge-id"))

    assert await knowledge.create_node(node) == {
        "success": True, "data": {"id": "node-id"}, "error": None,
    }
    assert await knowledge.create_edge(edge) == {
        "success": True, "data": {"id": "edge-id"}, "error": None,
    }
    assert observed == [
        (node, "cortex-local", "default"),
        (edge, "cortex-local", "default"),
    ]
