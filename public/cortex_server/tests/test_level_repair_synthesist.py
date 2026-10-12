"""L32 Synthesist repair: model-backed turn synthesis, honest bounded telemetry."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from cortex_server.modules import level_model
from cortex_server.modules import synthesist as synth_core
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import synthesist as synth_adapter
from cortex_server.routers import synthesist_api


def _run(coro):
    return asyncio.run(coro)


def _request():
    return SimpleNamespace(state=SimpleNamespace(), headers={})


def _ok(data):
    return {"status": "ok", "ok": True, "level": 32, "name": "synthesist", "elapsed_ms": 5,
            "origin": "model", "data": data, "model": "gpt-5.6-sol", "receipt_id": "rcpt-l32",
            "provider_invoked": True, "attempts": 1}


def _unavailable(status="model_unavailable"):
    return {"status": status, "ok": False, "level": 32, "name": "synthesist", "elapsed_ms": 5,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL,
            "error": "provider down"}


RESULTS = [
    {"level": 7, "name": "librarian", "summary": "Payer X overturns 60% of CO-50 appeals.", "receipt_id": "r1"},
    {"level": 30, "name": "seer", "summary": "Outlook for this appeal is bearish.", "receipt_id": "r2"},
]
SYNTHESIS = {
    "answer_synthesis": "Appeal is worth filing: the payer historically overturns most CO-50 denials, "
                        "although the forecast for this specific case is weaker.",
    "agreements": [
        {"claim": "An appeal is possible", "supporting_levels": ["librarian", "seer"]},
        {"claim": "Invented consensus", "supporting_levels": ["oracle", "r999"]},
    ],
    "conflicts": [
        {"claim_a": "Most appeals succeed", "level_a": "librarian",
         "claim_b": "This appeal likely fails", "level_b": "L30", "resolution": "Check the denial reason."},
        {"claim_a": "x", "level_a": "librarian", "claim_b": "y", "level_b": "nonexistent"},
    ],
    "gaps": ["The specific denial letter was not provided."],
    "confidence": "medium",
    "confidence_reason": "Historical data and forecast disagree.",
}


def _install(monkeypatch, results):
    calls = []
    seq = iter(results)

    async def fake(**kwargs):
        calls.append(kwargs)
        return next(seq)

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


def test_turn_synthesis_happy_path_validates_citations(monkeypatch):
    calls = _install(monkeypatch, [_ok(SYNTHESIS)])
    req = synthesist_api.SynthesizeTurnRequest(message="Should I appeal this denial?", level_results=RESULTS)
    out = _run(synthesist_api.synthesize_turn(req, _request()))

    assert out["success"] is True and out["origin"] == "model" and out["receipt_id"] == "rcpt-l32"
    assert out["answer_synthesis"].startswith("Appeal is worth filing")
    assert out["agreements"] == [{"claim": "An appeal is possible", "supporting_levels": ["librarian", "seer"]}]
    assert len(out["conflicts"]) == 1 and out["conflicts"][0]["level_b"] == "seer"
    assert set(out["cited_receipts"]) <= {"r1", "r2"} and "r999" not in json.dumps(out)
    assert out["invalid_citations_dropped"] >= 3
    assert out["confidence"] == "medium"
    assert calls[0]["schema"] is synth_core.TurnSynthesis
    assert calls[0]["principal_scope_key"] == "admin:level.synthesist"
    assert "Payer X overturns" in calls[0]["prompt"] and "<message>" in calls[0]["prompt"]


def test_turn_synthesis_needs_two_results_and_makes_no_call(monkeypatch):
    calls = _install(monkeypatch, [])
    out = _run(synth_core.synthesize_turn("q", RESULTS[:1], principal_scope_key="p:1"))
    assert out["success"] is False and out["status"] == "not_applicable"
    assert calls == []


def test_turn_synthesis_model_unavailable_returns_only_labelled_digest(monkeypatch):
    _install(monkeypatch, [_unavailable()])
    out = _run(synth_core.synthesize_turn("Should I appeal?", RESULTS, principal_scope_key="p:1"))
    assert out["success"] is False and out["origin"] == "model_unavailable"
    assert "answer_synthesis" not in out
    assert out["fallback"]["kind"] == "digest"
    assert [i["summary"] for i in out["fallback"]["items"]] == [r["summary"] for r in RESULTS]


def test_turn_request_bounds():
    with pytest.raises(ValidationError):
        synthesist_api.SynthesizeTurnRequest(message="q", level_results=RESULTS * 7)
    with pytest.raises(ValidationError):
        synthesist_api.SynthesizeTurnRequest(message="", level_results=RESULTS)
    with pytest.raises(ValidationError):
        synthesist_api.LevelResultIn(level=99, name="x", summary="y")


def test_telemetry_is_literal_counts_without_confidence_or_raw_data(tmp_path):
    synth = synth_core.Synthesist(state_dir=tmp_path)
    for level in ["oracle", "council", "seer", "muse", "librarian"]:
        synth.ingest_from_level(level, {"text": "zebra quantum lasagna", "secret_note": "patient John Doe"})
    result = synth.synthesize()

    text = json.dumps(result).lower()
    for claim in ("emergent", "cognition", "consciousness", "faculties", "high - topic"):
        assert claim not in text
    assert all(i.get("confidence") is None for i in result["insights"])
    assert result["levels_contributing"] == 5 and result["mode"] == "heuristic_telemetry"
    records = list(tmp_path.glob("syn_*.json"))
    assert len(records) == 1
    assert "john" not in records[0].read_text().lower()
    assert all("data" not in row for rows in synth._level_knowledge["system"].values() for row in rows)

    status = synth.status()
    assert status["levels_integrated"] == 5 and status["registry_levels_total"] == 38
    assert status["telemetry_store"] == "in_memory_keywords_since_boot"


def test_synthesis_records_are_unique_and_retention_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setattr(synth_core, "SYNTHESIS_FILES_KEEP", 3)
    synth = synth_core.Synthesist(state_dir=tmp_path)
    ids = {synth.synthesize()["synthesis_id"] for _ in range(6)}
    assert len(ids) == 6
    assert len(list(tmp_path.glob("syn_*.json"))) <= 3


def test_status_after_restart_reports_zero_reporting_levels(tmp_path):
    status = synth_core.Synthesist(state_dir=tmp_path).status()
    assert status["levels_integrated"] == 0 and status["reporting_levels"] == []


def test_important_insights_get_is_idempotent(tmp_path, monkeypatch):
    synth = synth_core.Synthesist(state_dir=tmp_path)
    synth._append_jsonl(synth.insights_path, [
        {"type": "model_view", "insight": "a", "confidence": 0.9, "timestamp": "t1"},
        {"type": "telemetry_observation", "insight": "b", "confidence": None, "timestamp": "t2"},
    ])
    monkeypatch.setattr(synthesist_api, "_get_synthesist", lambda: synth)
    first = _run(synthesist_api.get_important_insights(limit=10, min_confidence=0.8))
    second = _run(synthesist_api.get_important_insights(limit=10, min_confidence=0.8))
    assert first["insights"] == second["insights"] and first["count"] == 1


def test_router_status_is_not_a_full_mode_claim(tmp_path, monkeypatch):
    monkeypatch.setattr(synthesist_api, "_get_synthesist", lambda: synth_core.Synthesist(state_dir=tmp_path))
    status = _run(synthesist_api.synthesist_status())
    assert status["mode"] != "full"
    assert status["levels_integrated"] == 0


def test_adapter_combines_level_results(monkeypatch):
    _install(monkeypatch, [_ok(SYNTHESIS)])
    ctx = {"principal_scope_key": "p:1",
           "level_results": RESULTS + [{"level": 32, "name": "synthesist", "summary": "self"}]}
    out = _run(synth_adapter.run("Should I appeal this denial?", ctx))
    assert out["operation"] == "synthesist.turn" and out["origin"] == "model"
    assert out["data"]["levels_supplied"] == 2
    assert 0 < len(out["summary"]) <= 1500 and out["receipt_id"] == "rcpt-l32"


def test_adapter_not_applicable_and_unavailable(monkeypatch):
    calls = _install(monkeypatch, [_unavailable()])
    with pytest.raises(ExecutionBlocked) as exc:
        _run(synth_adapter.run("q", {"principal_scope_key": "p:1", "level_results": RESULTS[:1]}))
    assert exc.value.reason == "not_applicable" and calls == []
    with pytest.raises(ExecutionBlocked) as exc:
        _run(synth_adapter.run("q", {"principal_scope_key": "p:1", "level_results": RESULTS}))
    assert exc.value.reason == "model_unavailable"
