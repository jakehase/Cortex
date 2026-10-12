"""L11 Catalyst repair: measured profiling, deterministic bottlenecks, no fake optimization."""

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules import catalyst as catalyst_core
from cortex_server.modules import level_model, level_probe
from cortex_server.modules.level_adapters import catalyst as catalyst_adapter
from cortex_server.routers import catalyst as catalyst_router


def _rows(path, latencies, status=200):
    now = datetime.now(timezone.utc).isoformat()
    return [{"path": path, "method": "GET", "status": status, "latency_ms": value, "ts": now} for value in latencies]


@pytest.fixture
def ring(monkeypatch):
    rows = _rows("/health", [5.0] * 50) + _rows("/slow", [700.0 + i for i in range(20)]) + _rows(
        "/flaky", [10.0] * 20, status=500
    )
    monkeypatch.setattr(level_probe, "_recent_requests", lambda: list(rows))
    monkeypatch.setenv("CORTEX_CATALYST_P95_SLO_MS", "500")
    return rows


def _client():
    app = FastAPI()
    app.include_router(catalyst_router.router, prefix="/catalyst")

    @app.get("/health")
    async def health():
        return {"ok": True}

    return TestClient(app)


def test_profile_reports_measured_percentiles_from_the_ring(ring):
    stats = catalyst_core.profile_route("/health")
    assert stats["measured"] is True
    assert stats["count"] == 50
    assert stats["p95_ms"] >= stats["p50_ms"] > 0


def test_bottleneck_rules_rank_slow_and_erroring_routes(ring):
    analysis = asyncio.run(catalyst_core.analyze(None))
    rules = {(row["rule"], row.get("route")) for row in analysis["bottlenecks"]}
    assert ("p95_over_slo", "/slow") in rules
    assert ("server_error_rate", "/flaky") in rules
    assert analysis["optimization_applied"] is False


def test_profile_endpoint_rejects_caller_supplied_duration(ring):
    response = _client().post("/catalyst/profile?endpoint=/health&duration_ms=99999")
    assert response.status_code == 422


def test_profile_endpoint_unknown_route_is_404_not_optimized(ring):
    response = _client().post("/catalyst/profile", json={"route": "/does/not/exist"})
    assert response.status_code == 404
    assert "optimized" not in response.text


def test_profile_endpoint_measured_route(ring):
    body = _client().post("/catalyst/profile", json={"route": "/health"}).json()
    assert body["profiled"] is True and body["count"] == 50
    assert "optimized" not in body


@pytest.mark.parametrize("path", ["/catalyst/optimize_now", "/catalyst/toggle_auto_optimize"])
def test_optimization_endpoints_are_honest_501(path):
    response = _client().post(path)
    assert response.status_code == 501
    assert response.json()["detail"]["implemented"] is False


def test_status_capabilities_are_backed_by_real_checks(ring):
    body = _client().get("/catalyst/status").json()
    for fake in ("oracle_optimization", "psutil_metrics", "performance_alerting", "consciousness_integrated"):
        assert fake not in body["capabilities"]
        assert fake not in body
    assert "route_latency_profiling" in body["capabilities"]
    assert body["not_implemented"] == ["automatic_optimization"]
    assert body["observed_request_samples"] == len(ring)


def test_analyze_narration_uses_level_model_and_labels_it(ring, monkeypatch):
    async def fake_model(**kwargs):
        assert kwargs["level"] == 11 and kwargs["principal_scope_key"] != "internal-system"
        return {"ok": True, "status": "ok", "data": {"likely_causes": ["blocking I/O"], "next_steps": ["profile /slow"]},
                "model": "gpt-5.6-sol", "receipt_id": "rcpt-1"}

    monkeypatch.setattr(level_model, "level_model_json", fake_model)
    body = _client().post("/catalyst/analyze", json={"narrate": True}).json()
    assert body["narrative_source"] == "model"
    assert body["receipt_id"] == "rcpt-1"
    assert body["bottlenecks"]


def test_analyze_narration_model_unavailable_has_no_fabricated_text(ring, monkeypatch):
    async def unavailable(**_kwargs):
        return {"ok": False, "status": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL}

    monkeypatch.setattr(level_model, "level_model_json", unavailable)
    body = _client().post("/catalyst/analyze", json={"narrate": True}).json()
    assert body["narrative_source"] == "none"
    assert "narrative" not in body
    assert body["narrative_status"] == "model_unavailable"


def test_analyze_rejects_malformed_body(ring):
    response = _client().post("/catalyst/analyze", json={"focus": 7, "unexpected": True})
    assert response.status_code == 422


def test_catalyst_adapter_contract(ring):
    out = asyncio.run(catalyst_adapter.run("why is /slow so slow?", {}))
    assert out["operation"] == "catalyst.analyze"
    assert out["origin"] == "deterministic"
    assert len(out["summary"]) <= 1500
    assert out["data"]["focus_route"]["route"] == "/slow"
    assert any(row["rule"] == "p95_over_slo" for row in out["data"]["bottlenecks"])
    assert "Nothing was optimized" in out["summary"]
