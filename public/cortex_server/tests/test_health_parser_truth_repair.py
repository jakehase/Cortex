"""Focused smoke for HEALTH-1/2, PARSER-1, and source-side OPS-1."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from types import SimpleNamespace

import pymupdf
import pytest

from cortex_server import main
from cortex_server.modules import level_probe, sentinel_selfwatch
from cortex_server.modules.health_status import (
    DEGRADED,
    DISABLED_BY_DESIGN,
    FAILED,
    OPERATIONAL,
    RESTRICTED_BY_DESIGN,
    STALE_EVIDENCE,
    UNTESTED,
    aggregate_checks,
    aggregate_status,
)
from cortex_server.parsers.pdf_parser import PDFParser, PDFParserConfig
from cortex_server.routers import meta_conductor, mirror, oracle, parsers, sentinel
from cortex_server.services.parser_service import ParserService


def _request(*, service=None, routes=(), load_report=None):
    return SimpleNamespace(
        app=SimpleNamespace(
            routes=[SimpleNamespace(path=path, methods={method}) for method, path in routes],
            state=SimpleNamespace(
                parser_service=service,
                router_load_report=load_report or {},
            ),
        )
    )


def test_shared_aggregation_keeps_design_and_freshness_states_non_failing():
    assert aggregate_status([OPERATIONAL, DISABLED_BY_DESIGN, UNTESTED]) == OPERATIONAL
    assert aggregate_status([OPERATIONAL, RESTRICTED_BY_DESIGN]) == RESTRICTED_BY_DESIGN
    assert aggregate_status([OPERATIONAL, STALE_EVIDENCE]) == STALE_EVIDENCE
    assert aggregate_status([OPERATIONAL, DEGRADED]) == DEGRADED
    assert aggregate_status([OPERATIONAL, FAILED]) == FAILED
    assert aggregate_checks({"required": {"ok": False, "status": FAILED}}) == FAILED
    assert aggregate_checks({"required": {"ok": False, "status": OPERATIONAL}}) == FAILED


def test_public_readiness_preserves_canonical_failure_and_restriction_truth():
    base = {"service": "cortex", "checks": {}, "routerLoad": {}}
    failed = main._public_readiness_view({**base, "ready": False, "status": FAILED})
    restricted = main._public_readiness_view(
        {**base, "ready": True, "status": RESTRICTED_BY_DESIGN}
    )
    assert failed["status"] == FAILED and failed["ready"] is False
    assert restricted["status"] == RESTRICTED_BY_DESIGN and restricted["ready"] is True


def test_meta_aggregate_does_not_turn_safe_mode_or_stale_evidence_into_failure():
    snapshot = {
        "available": True,
        "levels": [
            {
                "level": 17,
                "name": "Exoskeleton",
                "status": RESTRICTED_BY_DESIGN,
                "mount": "safe_subset",
                "probe": {},
            },
            {
                "level": 23,
                "name": "Cartographer",
                "status": STALE_EVIDENCE,
                "mount": "full",
                "probe": {},
            },
            {
                "level": 25,
                "name": "Bridge",
                "status": DISABLED_BY_DESIGN,
                "mount": "skipped_safe_mode",
                "probe": {},
            },
        ],
    }
    aggregate = meta_conductor._aggregate(snapshot)
    assert aggregate["status"] == STALE_EVIDENCE
    assert aggregate["failed_levels"] == []
    assert aggregate["restricted_by_design_levels"] == [17]
    assert aggregate["disabled_by_design_levels"] == [25]

    with_failure = {
        **snapshot,
        "levels": [
            *snapshot["levels"],
            {
                "level": 36,
                "name": "Meta Conductor",
                "status": FAILED,
                "mount": "full",
                "probe": {},
            },
        ],
    }
    failed = meta_conductor._aggregate(with_failure)
    assert failed["status"] == FAILED and failed["failed_levels"] == [36]


def test_l23_and_sentinel_report_stale_evidence_without_failure(monkeypatch):
    stale_snapshot = {
        "available": True,
        "measured_at": "2026-10-11T00:00:00+00:00",
        "levels": [],
    }
    monkeypatch.setitem(level_probe._probe_cache, "snapshot", stale_snapshot)
    monkeypatch.setitem(
        level_probe._probe_cache,
        "measured_monotonic",
        time.monotonic() - mirror.MAP_STALE_AFTER_S - 1,
    )
    monkeypatch.setattr(level_probe, "schedule_probe_refresh", lambda *_args, **_kwargs: False)
    l23 = asyncio.run(mirror.mirror_status(_request()))
    assert l23["status"] == STALE_EVIDENCE
    assert l23["success"] is True and l23["error"] is None

    monkeypatch.setattr(
        sentinel_selfwatch,
        "summary",
        lambda: {
            "enabled": True,
            "running": True,
            "fresh": True,
            "status": STALE_EVIDENCE,
        },
    )
    monkeypatch.setattr(sentinel, "_scheduler_running", False)
    monkeypatch.setattr(sentinel, "_scheduler_task", None)
    monkeypatch.setattr(sentinel, "_startup_error", None)
    monkeypatch.setattr(sentinel, "_last_load_error", None)
    monkeypatch.setattr(sentinel, "_last_save_error", None)
    monkeypatch.setattr(sentinel, "_last_task_error", None)
    l21 = sentinel._sentinel_health_snapshot()
    assert l21["status"] == STALE_EVIDENCE and l21["success"] is True


def test_provider_freshness_is_separate_from_provider_availability(monkeypatch):
    monkeypatch.setattr(
        oracle,
        "_resolve_openclaw_model_identity",
        lambda: {"configured": True, "model": "openai/gpt-5", "source": "test"},
    )
    monkeypatch.setattr(
        oracle,
        "_openclaw_executable_readiness",
        lambda: {"available": True, "check": "path_lookup_only"},
    )
    monkeypatch.setattr(oracle, "_openclaw_provider_binding", lambda: "binding")
    monkeypatch.setattr(
        oracle,
        "_OPENCLAW_PROVIDER_EVIDENCE",
        {
            "binding": "binding",
            "observed_at": time.monotonic() - oracle._OPENCLAW_PROVIDER_EVIDENCE_TTL_S - 1,
            "verified": True,
            "reason": "provider_response",
        },
    )
    result = oracle._probe_openclaw_status()
    assert result["ready"] is True
    assert result["availabilityStatus"] == OPERATIONAL
    assert result["providerVerified"] is False
    assert result["providerEvidence"]["status"] == STALE_EVIDENCE


def test_pdf_uses_installed_supported_backend_and_status_is_honest():
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Cortex PDF parser smoke")
    raw = document.tobytes()
    document.close()

    parser = PDFParser(PDFParserConfig(page_timeout_seconds=5.0))
    result = parser.parse_bytes(raw, "smoke.pdf")
    assert parser.backend_name == "pymupdf"
    assert result.error is None
    assert "Cortex PDF parser smoke" in result.pages[0]["metadata"]["text"]

    service = ParserService(workspace_roots=())
    routes = (
        ("GET", "/parsers/status"),
        ("POST", "/parsers/parse"),
        ("POST", "/parsers/pdf"),
    )
    available = asyncio.run(parsers.status(_request(service=service, routes=routes)))
    assert available["status"] == OPERATIONAL
    assert available["backends"]["pdf"] == {
        "status": OPERATIONAL,
        "available": True,
        "backend": "pymupdf",
        "reason": None,
    }

    service.pdf_parser = None
    service.pdf_parser_error = "ImportError"
    unavailable = asyncio.run(parsers.status(_request(service=service, routes=routes)))
    assert unavailable["status"] == DEGRADED
    assert unavailable["success"] is False
    assert unavailable["backends"]["pdf"]["available"] is False
    assert {row["capability"]: row["reason"] for row in unavailable["unavailable"]}[
        "pdf_parse_persist"
    ] == "ImportError"


def test_launcher_treats_controlled_signals_as_success_but_preserves_child_failures():
    launcher = (
        Path(__file__).resolve().parents[1] / "scripts" / "start_cortex_service.sh"
    ).read_text(encoding="utf-8")
    assert "trap 'exit 0' TERM INT" in launcher
    assert 'exit "${status}"' in launcher
    assert "exit 130" not in launcher
