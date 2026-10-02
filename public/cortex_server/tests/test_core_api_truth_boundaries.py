from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import APIRouter, FastAPI

import cortex_server.main as main
from cortex_server.capability_manifest import (
    CAPABILITY_BY_MODULE,
    ROUTER_CAPABILITIES,
    UNSAFE_ACTION_MODULES,
)
from cortex_server.middleware.request_timeout import RequestTimeoutMiddleware
from cortex_server.models.api_contracts import NexusOrchestrationResponse


EXPECTED_UNSAFE_ROUTERS = {
    "architect",
    "browser",
    "darwin",
    "diplomat",
    "evolution",
    "forge",
    "geneticist",
    "homeassistant",
    "lab",
    "openclaw",
    "parsers",
    "tools",
}

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_required_route_configuration_never_invents_a_method():
    assert main._parse_required_routes(
        "POST /custom/write", "/l22/store,/knowledge/search"
    ) == frozenset(
        {
            ("POST", "/custom/write"),
            ("POST", "/l22/store"),
            ("POST", "/knowledge/search"),
        }
    )

    with pytest.raises(RuntimeError, match="explicit method"):
        main._parse_required_routes("", "/unknown")
    with pytest.raises(RuntimeError, match="method must"):
        main._parse_required_routes("TRACE /custom", "")


def test_core_provider_and_queue_routes_remain_under_request_deadline(monkeypatch):
    monkeypatch.setattr(
        main,
        "load_dynamic_routers",
        lambda app, *, safe_mode=True: {
            "loaded": [],
            "safeModeSkipped": [],
            "disabled": [],
            "failed": [],
            "missingRouter": [],
        },
    )
    app = main.create_app()
    middleware = next(
        row for row in app.user_middleware if row.cls is RequestTimeoutMiddleware
    )

    assert middleware.kwargs["exclude_paths"] == [
        "/homeassistant/voice/assist_tts"
    ]
    assert {
        "/nexus/orchestrate",
        "/hive/swarm",
        "/cron/trigger",
        "/queue/schedule",
        "/oracle/status",
    }.isdisjoint(middleware.kwargs["exclude_paths"])


def test_safe_mode_manifest_explicitly_deny_loads_action_routers(monkeypatch):
    assert UNSAFE_ACTION_MODULES == EXPECTED_UNSAFE_ROUTERS
    assert all(row.safety_class in {"service", "unsafe_action", "test_only"} for row in ROUTER_CAPABILITIES)

    def fake_import(module_name):
        router = APIRouter()

        @router.get("/status")
        async def status():
            return {"status": "active"}

        return SimpleNamespace(router=router)

    monkeypatch.setattr(main.importlib, "import_module", fake_import)
    app = FastAPI()
    report = main.load_dynamic_routers(app, safe_mode=True)

    assert set(report["safeModeSkipped"]) == EXPECTED_UNSAFE_ROUTERS
    assert "inbox_test" not in report["loaded"]
    assert any(
        row["router"] == "inbox_test" and row["reason"] == "not_production"
        for row in report["disabled"]
    )
    assert not (set(report["loaded"]) & EXPECTED_UNSAFE_ROUTERS)


def test_manifest_reconciliation_rejects_an_undeclared_router(monkeypatch):
    without_knowledge = {
        name: capability
        for name, capability in CAPABILITY_BY_MODULE.items()
        if name != "knowledge"
    }
    monkeypatch.setattr(main, "CAPABILITY_BY_MODULE", without_knowledge)

    with pytest.raises(RuntimeError, match=r"undeclared=.*knowledge"):
        main.load_dynamic_routers(FastAPI(), safe_mode=True)


def test_capability_inventory_filters_framework_routes_and_separates_websockets(
    monkeypatch,
):
    def load_one_router(app, *, safe_mode=True):
        del safe_mode

        async def status():
            return {"status": "active"}

        app.add_api_route("/demo/status", status, methods=["GET"])
        report = {
            "loaded": ["demo"],
            "safeModeSkipped": [],
            "disabled": [],
            "failed": [],
            "missingRouter": [],
        }
        app.state.router_load_report = report
        return report

    monkeypatch.setattr(main, "load_dynamic_routers", load_one_router)
    app = main.create_app()
    endpoint = next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", None) == "/capabilities"
    )
    payload = asyncio.run(endpoint())

    paths = {row["path"] for row in payload["capabilities"]}
    assert {"/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"}.isdisjoint(paths)
    assert payload["websocketCapabilityCount"] == len(payload["websockets"])
    assert payload["websocketCapabilityCount"] == 2
    assert {row["path"] for row in payload["websockets"]} == {
        "/ws/logs/{container_id}",
        "/ws/progress",
    }
    assert payload["capabilityCount"] == (
        payload["httpCapabilityCount"] + payload["websocketCapabilityCount"]
    )


def test_shared_nexus_provider_fixture_satisfies_python_contract():
    fixture_path = (
        REPOSITORY_ROOT
        / "plugins"
        / "cortex-route-gate"
        / "nexus-orchestrate-response.fixture.json"
    )
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    if hasattr(NexusOrchestrationResponse, "model_validate"):
        parsed = NexusOrchestrationResponse.model_validate(payload)
    else:
        parsed = NexusOrchestrationResponse.parse_obj(payload)

    assert parsed.success is True
    assert parsed.recommended_levels[0].level == 24

    invalid = {**payload, "success": False}
    with pytest.raises(Exception):
        if hasattr(NexusOrchestrationResponse, "model_validate"):
            NexusOrchestrationResponse.model_validate(invalid)
        else:
            NexusOrchestrationResponse.parse_obj(invalid)


def test_openapi_status_contract_applies_only_to_canonical_status_routes(
    monkeypatch,
):
    def load_status_routes(app, *, safe_mode=True):
        del safe_mode

        async def status():
            return {"status": "active"}

        app.add_api_route("/kernel/status", status, methods=["GET"])
        app.add_api_route("/kernel/levels", status, methods=["GET"])
        report = {
            "loaded": ["kernel"],
            "safeModeSkipped": [],
            "disabled": [],
            "failed": [],
            "missingRouter": [],
        }
        app.state.router_load_report = report
        return report

    monkeypatch.setattr(main, "load_dynamic_routers", load_status_routes)
    schema = main.create_app().openapi()

    canonical_schema = schema["paths"]["/kernel/status"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]
    alias_schema = schema["paths"]["/kernel/levels"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"]
    assert canonical_schema == {"$ref": "#/components/schemas/LevelStatusResponse"}
    assert alias_schema != canonical_schema

    for path in ("/health", "/ready", "/capabilities"):
        responses = schema["paths"][path]["get"]["responses"]
        assert "504" in responses
        assert responses["504"]["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/ErrorResponse"
        }
