"""L10 Listener repair: model-backed analysis, honest STT unavailability."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from cortex_server.modules import level_model
from cortex_server.modules import listener as listener_core
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import listener as listener_adapter
from cortex_server.routers import listener as listener_router


def _run(coro):
    return asyncio.run(coro)


def _request():
    return SimpleNamespace(state=SimpleNamespace(), headers={})


def _ok(data):
    return {"status": "ok", "ok": True, "level": 10, "name": "listener", "elapsed_ms": 5,
            "origin": "model", "data": data, "model": "gpt-5.6-sol", "receipt_id": "rcpt-l10",
            "provider_invoked": True, "attempts": 1}


def _unavailable(status="model_unavailable"):
    return {"status": status, "ok": False, "level": 10, "name": "listener", "elapsed_ms": 5,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL,
            "error": "provider down"}


ANALYSIS = {
    "intent": "reschedule",
    "intent_rationale": "Asks to move the 3pm meeting to Friday.",
    "sentiment": "neutral",
    "urgency": "high",
    "entities": [
        {"type": "person", "text": "Dr. Lee"},
        {"type": "time", "text": "3pm"},
        {"type": "date", "text": "Friday"},
        {"type": "person", "text": "Dr. Smith"},  # not in the input: must be dropped
    ],
    "key_points": ["Move the 3pm appointment with Dr. Lee to Friday"],
    "action_items": ["Reschedule the 3pm with Dr. Lee to Friday"],
    "summary": "The user urgently wants the 3pm appointment with Dr. Lee moved to Friday.",
    "language": "en",
}
TEXT = "Can you move my 3pm with Dr. Lee to Friday? It's urgent."


@pytest.fixture(autouse=True)
def _fresh_stats(monkeypatch):
    monkeypatch.setattr(listener_core, "_stats", {
        "since": "test", "analysis_requests": 0, "analysis_successes": 0, "analysis_failures": 0,
        "transcribe_requests": 0, "last_analysis_status": None, "last_analysis_at": None,
        "last_success_at": None,
    })


def _install(monkeypatch, results):
    calls = []
    seq = iter(results)

    async def fake(**kwargs):
        calls.append(kwargs)
        return next(seq)

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


def test_analyze_happy_path_is_model_backed_and_drops_unverified_entities(monkeypatch):
    calls = _install(monkeypatch, [_ok(ANALYSIS)])
    out = _run(listener_router.analyze_text(listener_router.AnalyzeRequest(text=TEXT), _request()))

    assert out["success"] is True
    assert out["origin"] == "model" and out["receipt_id"] == "rcpt-l10" and out["model"] == "gpt-5.6-sol"
    analysis = out["analysis"]
    assert analysis["intent"] == "reschedule" and analysis["urgency"] == "high"
    texts = [e["text"] for e in analysis["entities"]]
    assert "Dr. Lee" in texts and "Dr. Smith" not in texts
    assert out["entities_dropped_unverified"] == 1
    assert len(calls) == 1
    assert calls[0]["schema"] is listener_core.ListenerAnalysis
    assert calls[0]["principal_scope_key"] == "admin:level.listener"
    assert f"<input>\n{TEXT}\n</input>" in calls[0]["prompt"]

    status = _run(listener_router.listener_status())["data"]
    assert status["text_analysis"] is True and status["stt_available"] is False
    assert status["analysis_successes"] == 1


def test_analyze_model_unavailable_returns_no_fabricated_analysis(monkeypatch):
    _install(monkeypatch, [_unavailable()])
    out = _run(listener_router.analyze_text(listener_router.AnalyzeRequest(text=TEXT), _request()))

    assert out["success"] is False
    assert out["origin"] == "model_unavailable"
    assert "analysis" not in out and "sentiment" not in json.dumps(out)
    status = _run(listener_router.listener_status())["data"]
    assert status["text_analysis"] is False
    assert status["text_analysis_health"] == "degraded"
    assert status["capabilities"] == []


def test_analyze_blank_text_makes_no_model_call(monkeypatch):
    calls = _install(monkeypatch, [])
    out = _run(listener_router.analyze_text(listener_router.AnalyzeRequest(text="  \x00 "), _request()))
    assert out["success"] is False and out["error"] == "No text provided for analysis"
    assert calls == []


def test_analyze_truncates_oversized_text(monkeypatch):
    calls = _install(monkeypatch, [_ok({**ANALYSIS, "entities": []})])
    out = _run(listener_core.analyze_text("x " * 100_000, principal_scope_key="p:1"))
    assert out["success"] is True and out["truncated"] is True
    assert out["analyzed_chars"] == listener_core.MAX_TEXT_CHARS
    assert len(calls[0]["prompt"]) < listener_core.MAX_TEXT_CHARS + 200


def test_analyze_request_requires_text():
    with pytest.raises(ValidationError):
        listener_router.AnalyzeRequest(txt="hi")


def test_schema_rejects_out_of_taxonomy_intent():
    with pytest.raises(ValidationError):
        listener_core.ListenerAnalysis.model_validate({**ANALYSIS, "intent": "admin_override"})


def test_transcribe_is_an_honest_501_and_never_reads_paths():
    resp = _run(listener_router.transcribe_audio(
        listener_router.TranscribeRequest(audio_base64="UklGRiQAAABXQVZF", file_path="/etc/passwd")))
    assert resp.status_code == 501
    body = json.loads(resp.body)
    assert body["success"] is False and body["stt_available"] is False
    assert body["transcription"] is None
    assert "/etc/passwd" not in resp.body.decode()
    status = _run(listener_router.listener_status())["data"]
    assert status["transcribe_requests"] == 1
    assert not any("transcri" in c or "audio" in c for c in status["capabilities"])


def test_adapter_contract_happy_path(monkeypatch):
    _install(monkeypatch, [_ok(ANALYSIS)])
    out = _run(listener_adapter.run(TEXT, {"principal_scope_key": "p:abc"}))
    assert out["operation"] == "listener.analyze" and out["origin"] == "model"
    assert isinstance(out["summary"], str) and 0 < len(out["summary"]) <= 1500
    assert out["data"]["intent"] == "reschedule"
    assert out["receipt_id"] == "rcpt-l10"
    assert listener_adapter.NEEDS_MODEL is True and listener_adapter.SAFE_AUTORUN is True


def test_adapter_raises_execution_blocked_when_model_unavailable(monkeypatch):
    _install(monkeypatch, [_unavailable("timeout")])
    with pytest.raises(ExecutionBlocked) as exc:
        _run(listener_adapter.run(TEXT, {"principal_scope_key": "p:abc"}))
    assert exc.value.reason == "timeout"


def test_adapter_requires_principal_scope(monkeypatch):
    calls = _install(monkeypatch, [])
    with pytest.raises(ExecutionBlocked):
        _run(listener_adapter.run(TEXT, {}))
    assert calls == []
