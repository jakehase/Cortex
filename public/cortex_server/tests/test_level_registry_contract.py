from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.modules.level_registry import LEVEL_REGISTRY_VERSION, get_level_registry
from cortex_server.routers import kernel, meta_conductor, nexus


def test_level_registry_shape_and_core_entries():
    levels = get_level_registry()
    assert len(levels) == 38
    ids = [x["level"] for x in levels]
    assert ids == list(range(1, 39))

    by = {x["level"]: x for x in levels}
    assert by[1]["canonical_status"] == "/kernel/status"
    assert by[24]["canonical_status"] == "/nexus/status"
    assert by[9]["canonical_status"] in {"/meta_conductor/status", "/architect/status"}


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
