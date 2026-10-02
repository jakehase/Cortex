from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.modules import semantic_router
from cortex_server.modules.level_registry import LEVEL_REGISTRY_VERSION, get_level_registry
from cortex_server.modules.synthesist import Synthesist
from cortex_server.routers import hive, hud_display, kernel, meta_conductor, nexus, sentinel


def test_level_registry_shape_and_core_entries():
    levels = get_level_registry()
    assert len(levels) == 38
    ids = [x["level"] for x in levels]
    assert ids == list(range(1, 39))

    by = {x["level"]: x for x in levels}
    assert by[1]["canonical_status"] == "/kernel/status"
    assert by[24]["canonical_status"] == "/nexus/status"
    assert by[9]["canonical_status"] == "/architect/status"

    canonical = [row["canonical_status"] for row in levels]
    aliases = [alias for row in levels for alias in row["aliases"]]
    assert len(canonical) == len(set(canonical))
    assert len(aliases) == len(set(aliases))
    assert set(canonical).isdisjoint(aliases)
    assert all(row["purpose"].strip() for row in levels)


def test_kernel_status_and_levels_exposed():
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(kernel.router, prefix="/kernel")
    c = TestClient(app)

    r1 = c.get("/kernel/status")
    assert r1.status_code == 200
    b1 = r1.json()
    assert b1["level"] == 1
    assert b1["registry_version"] == LEVEL_REGISTRY_VERSION

    r2 = c.get("/kernel/levels")
    assert r2.status_code == 200
    b2 = r2.json()
    assert b2["registry_version"] == LEVEL_REGISTRY_VERSION
    assert len(b2["levels"]) == 38


def test_endpoint_map_uses_registry_source():
    app = FastAPI()
    app.add_middleware(HUDMiddleware)
    app.include_router(meta_conductor.router, prefix="/meta_conductor")
    app.include_router(nexus.router, prefix="/nexus")
    c = TestClient(app)

    r = c.get("/meta_conductor/endpoint_map")
    assert r.status_code == 200
    body = r.json()
    assert body["registry_version"] == LEVEL_REGISTRY_VERSION
    assert len(body["levels"]) == 38
    l24 = [x for x in body["levels"] if x["level"] == 24][0]
    assert l24["canonical_status"] == "/nexus/status"


def test_routing_and_hud_maps_derive_all_identity_from_registry():
    levels = get_level_registry()
    by_level = {int(row["level"]): row for row in levels}

    assert set(semantic_router.LEVEL_DESCRIPTIONS) == set(range(1, 39))
    for level, (name, purpose) in semantic_router.LEVEL_DESCRIPTIONS.items():
        assert name == by_level[level]["name"]
        assert purpose == by_level[level]["purpose"]

    assert hud_display.ALWAYS_ON_LEVELS == [
        level for level, row in by_level.items() if row["always_on"]
    ]
    assert len(nexus.LEVEL_MAP) == len(levels)
    assert nexus.ALWAYS_ON_LEVELS == hud_display.ALWAYS_ON_LEVELS


def test_corrected_hive_and_sentinel_payload_identity(monkeypatch):
    class Response:
        status_code = 200

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url):
            return Response()

    monkeypatch.setattr(hive.httpx, "AsyncClient", lambda **_kwargs: Client())

    async def celery_online(*_args, **_kwargs):
        return None

    monkeypatch.setattr(hive, "run_blocking", celery_online)
    import asyncio

    hive_status = asyncio.run(hive.hive_status())
    sentinel_status = asyncio.run(sentinel.sentinel_status())
    registry = {row["level"]: row for row in get_level_registry()}

    assert hive_status["level"] == 12
    assert hive_status["name"] == registry[12]["name"]
    assert hive_status["success"] is True
    assert hive_status["status"] == "active"
    assert sentinel_status["level"] == 21
    assert sentinel_status["name"] == registry[21]["name"]


def test_synthesist_status_derives_integrated_total_from_registry(tmp_path):
    synthesist = object.__new__(Synthesist)
    synthesist.level = 32
    synthesist.name = "Synthesist"
    synthesist.insights_path = tmp_path / "insights.jsonl"
    synthesist.patterns_path = tmp_path / "patterns.jsonl"

    status = synthesist.status()

    assert status["levels_integrated"] == len(get_level_registry()) == 38
    assert status["registry_version"] == LEVEL_REGISTRY_VERSION
    assert status["registry_source"] == "cortex_server.modules.level_registry"
