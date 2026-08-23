from __future__ import annotations

import asyncio
import importlib
import json
import sqlite3
from pathlib import Path
from typing import Iterable

import pytest


HTTP_OPERATION_KEYS = {
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
    "trace",
}


@pytest.fixture
def main_module(monkeypatch, tmp_path):
    """Load app construction only after every ambient path is isolated."""
    monkeypatch.setenv("CORTEX_ENV", "development")
    monkeypatch.setenv("CORTEX_SAFE_MODE", "true")
    monkeypatch.setenv("CORTEX_WRITE_TOKEN", "focused-readiness-token-000000000000")
    monkeypatch.setenv("CORTEX_FAIL_CLOSED_MEMORY_ENDPOINTS", "false")
    monkeypatch.setenv("CORTEX_DB_PATH", str(tmp_path / "cortex.db"))
    monkeypatch.setenv(
        "CORTEX_EVENT_LEDGER_PATH", str(tmp_path / "event-ledger.jsonl")
    )
    monkeypatch.setenv("CORTEX_ARTIFACT_ROOT", str(tmp_path / "artifacts"))
    monkeypatch.setenv(
        "ORCHESTRATOR_RUNTIME_DELIVERY_ROOT", str(tmp_path / "runtime-delivery")
    )
    monkeypatch.setenv("CORTEX_CHROMA_DIR", str(tmp_path / "chroma"))
    monkeypatch.setenv("HA_AUDIT_LOG_PATH", str(tmp_path / "ha-audit.jsonl"))
    monkeypatch.setenv("HA_VOICE_MEDIA_DIR", str(tmp_path / "voice"))
    return importlib.import_module("cortex_server.main")


def _patch_readiness_dependencies(main, monkeypatch, tmp_path: Path) -> None:
    database = tmp_path / "readiness.sqlite3"
    with sqlite3.connect(database):
        pass

    monkeypatch.setattr(
        main,
        "_knowledge_volume_identity_check",
        lambda *, production: {
            "ok": True,
            "required": production,
            "path": str(database),
            "marker": None,
            "mountIdConfigured": False,
            "error": None,
        },
    )

    from cortex_server.middleware import event_ledger_middleware
    from cortex_server.routers import librarian
    from cortex_server.runtime import production_build_loop

    monkeypatch.setattr(
        event_ledger_middleware,
        "probe_event_ledger_durability",
        lambda: {"ok": True, "status": "healthy"},
    )
    monkeypatch.setattr(
        librarian,
        "probe_memory_backend_readiness",
        lambda: {"ok": True, "status": "healthy"},
    )
    monkeypatch.setattr(
        production_build_loop,
        "probe_runtime_delivery_readiness",
        lambda _root: {"ready": True, "status": "ready", "checks": {}},
    )

    async def reachable(**_kwargs):
        return {
            "ok": True,
            "status": "reachable",
            "target": "http://127.0.0.1:8000/_internal/reachability",
        }

    monkeypatch.setattr(main, "probe_internal_reachability", reachable)


def _readiness_app(
    main,
    monkeypatch,
    tmp_path: Path,
    *,
    l22_methods: Iterable[str],
    knowledge_methods: Iterable[str],
    duplicate_l22_post: bool = False,
):
    _patch_readiness_dependencies(main, monkeypatch, tmp_path)

    def load_test_routes(app, *, safe_mode=True):
        del safe_mode

        async def store():
            return {"success": True}

        async def search():
            return {"results": []}

        app.add_api_route("/l22/store", store, methods=list(l22_methods))
        app.add_api_route(
            "/knowledge/search", search, methods=list(knowledge_methods)
        )
        if duplicate_l22_post:
            app.add_api_route("/l22/store", store, methods=["POST"])

        report = {
            "loaded": ["knowledge", "l22"],
            "safeModeSkipped": [],
            "disabled": [],
            "failed": [],
            "missingRouter": [],
        }
        app.state.router_load_report = report
        return report

    monkeypatch.setattr(main, "load_dynamic_routers", load_test_routes)
    app = main.create_app()
    # These tests exercise structural readiness without starting lifecycle
    # services. Removing their initial "not started" overlay makes the route
    # inventory the deciding readiness signal.
    app.state.lifecycle_checks = {}
    return app


def _ready_response(app):
    endpoint = next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", None) == "/ready"
    )
    return asyncio.run(endpoint())


def _raw_readiness_payload(app) -> dict:
    """Read internal diagnostics without weakening the redacted public contract."""
    return asyncio.run(app.state.async_readiness_payload())


def _response_payload(response) -> dict:
    return json.loads(response.body)


def test_readiness_accepts_each_required_post_route_exactly_once(
    main_module, monkeypatch, tmp_path
):
    app = _readiness_app(
        main_module,
        monkeypatch,
        tmp_path,
        l22_methods=["POST"],
        knowledge_methods=["POST"],
    )

    response = _ready_response(app)
    payload = _response_payload(response)
    raw_payload = _raw_readiness_payload(app)

    assert response.status_code == 200
    assert payload["checks"]["requiredRoutes"]["ok"] is True
    assert "missing" not in payload["checks"]["requiredRoutes"]
    assert "collisions" not in payload["checks"]["routeCollisions"]
    assert raw_payload["checks"]["requiredRoutes"]["missing"] == []
    assert raw_payload["checks"]["routeCollisions"] == {
        "ok": True,
        "collisions": [],
    }


def test_readiness_rejects_get_only_replacements_for_required_post_routes(
    main_module, monkeypatch, tmp_path
):
    app = _readiness_app(
        main_module,
        monkeypatch,
        tmp_path,
        l22_methods=["GET"],
        knowledge_methods=["GET"],
    )

    response = _ready_response(app)
    payload = _response_payload(response)
    raw_payload = _raw_readiness_payload(app)

    assert response.status_code == 503
    assert payload["checks"]["requiredRoutes"]["ok"] is False
    assert "missing" not in payload["checks"]["requiredRoutes"]
    assert "collisions" not in payload["checks"]["routeCollisions"]
    assert raw_payload["checks"]["requiredRoutes"] == {
        "ok": False,
        "required": [
            {"method": "POST", "path": "/knowledge/search"},
            {"method": "POST", "path": "/l22/store"},
        ],
        "missing": [
            {"method": "POST", "path": "/knowledge/search"},
            {"method": "POST", "path": "/l22/store"},
        ],
    }
    assert raw_payload["checks"]["routeCollisions"]["ok"] is True


def test_readiness_rejects_duplicate_exact_method_and_path_registration(
    main_module, monkeypatch, tmp_path
):
    app = _readiness_app(
        main_module,
        monkeypatch,
        tmp_path,
        l22_methods=["POST"],
        knowledge_methods=["POST"],
        duplicate_l22_post=True,
    )

    response = _ready_response(app)
    payload = _response_payload(response)
    raw_payload = _raw_readiness_payload(app)

    assert response.status_code == 503
    assert payload["checks"]["requiredRoutes"]["ok"] is False
    assert payload["checks"]["routeCollisions"]["ok"] is False
    assert "missing" not in payload["checks"]["requiredRoutes"]
    assert "collisions" not in payload["checks"]["routeCollisions"]
    assert raw_payload["checks"]["requiredRoutes"]["missing"] == [
        {"method": "POST", "path": "/l22/store"}
    ]
    assert raw_payload["checks"]["routeCollisions"] == {
        "ok": False,
        "collisions": [
            {"method": "POST", "path": "/l22/store", "count": 2}
        ],
    }


def _schema_operations(schema):
    for path, path_item in schema["paths"].items():
        for method, operation in path_item.items():
            if method.lower() in HTTP_OPERATION_KEYS:
                yield path, method.lower(), operation


def test_media_discovery_and_tags_have_exact_openapi_contracts(
    main_module, monkeypatch
):
    # Home Assistant is intentionally an unsafe-action capability. This schema
    # test opts out of safe mode explicitly so its affected routes cannot be
    # hidden from the assertions.
    monkeypatch.setenv("CORTEX_SAFE_MODE", "false")
    selected_modules = {
        "augmenter",
        "autonomy_governor",
        "command_center",
        "command_center_live",
        "ethicist",
        "geneticist",
        "homeassistant",
        "muse",
        "singularity",
        "validator",
    }
    selected_capabilities = tuple(
        capability
        for capability in main_module.ROUTER_CAPABILITIES
        if capability.module in selected_modules
    )
    assert {row.module for row in selected_capabilities} == selected_modules
    monkeypatch.setattr(main_module, "ROUTER_CAPABILITIES", selected_capabilities)

    app = main_module.create_app()
    assert "homeassistant" in app.state.router_load_report["loaded"]
    assert app.state.router_load_report["safeModeSkipped"] == []
    schema = app.openapi()

    expected_media = {
        "/command_center/three.min.js": "application/javascript",
        "/command_center/node_core.svg": "image/svg+xml",
        "/command_center/node_ring.svg": "image/svg+xml",
        "/command_center/node_arc.svg": "image/svg+xml",
        "/command_center_live/three.min.js": "application/javascript",
        "/command_center_live/node_core.svg": "image/svg+xml",
        "/command_center_live/node_ring.svg": "image/svg+xml",
        "/command_center_live/node_arc.svg": "image/svg+xml",
        "/homeassistant/voice/media/{name}": "audio/wav",
    }
    for path, media_type in expected_media.items():
        content = schema["paths"][path]["get"]["responses"]["200"]["content"]
        assert set(content) == {media_type}, path

    root_endpoint = next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", None) == "/"
    )
    discovery = asyncio.run(root_endpoint())
    assert discovery["endpoints"] == {
        "docs": "/docs",
        "health": "/health",
        "readiness": "/ready",
        "capabilities": "/capabilities",
    }
    registered_paths = {
        path
        for route in main_module._effective_routes(app.routes)
        if (path := getattr(route, "path", None)) is not None
    }
    assert set(discovery["endpoints"].values()) <= registered_paths
    assert {"/graph", "/parse", "/tools", "/ws"}.isdisjoint(
        discovery["endpoints"].values()
    )

    operations = list(_schema_operations(schema))
    assert operations
    assert all(len(operation.get("tags", [])) == 1 for _, _, operation in operations)
    used_tags = {operation["tags"][0] for _, _, operation in operations}
    registry_tags = [row["name"] for row in schema["tags"]]
    assert len(registry_tags) == len(set(registry_tags))
    assert set(registry_tags) == used_tags

    expected_tags = {
        "/": "Core",
        "/ready": "Core",
        "/health": "Core",
        "/capabilities": "Core",
        "/augmenter/status": "Augmenter",
        "/autonomy_governor/status": "Autonomy Governor",
        "/ethicist/status": "Ethicist",
        "/geneticist/status": "Geneticist",
        "/homeassistant/status": "HomeAssistant",
        "/muse/status": "Muse",
        "/singularity/status": "Singularity",
        "/validator/status": "Validator",
    }
    for path, tag in expected_tags.items():
        assert schema["paths"][path]["get"]["tags"] == [tag]

    singularity_responses = schema["paths"]["/singularity/analyze"]["post"][
        "responses"
    ]
    assert singularity_responses["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/SingularityAnalysisResponse"
    }
    assert singularity_responses["202"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/AcceptedJobResponse"
    }
    assert "403" in singularity_responses
    assert "504" in singularity_responses
