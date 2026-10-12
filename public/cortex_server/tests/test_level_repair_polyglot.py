"""L28 Polyglot repair: model translation/detection, no 'English 0.1' for Spanish."""

import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules import level_model
from cortex_server.modules import polyglot as polyglot_core
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import polyglot as polyglot_adapter
from cortex_server.routers import polyglot


def _run(coro):
    return asyncio.run(coro)


def _ok(data):
    return {"status": "ok", "ok": True, "origin": "model", "data": data, "model": "gpt-5.6-sol (test)",
            "receipt_id": "rcpt-poly", "provider_invoked": True, "attempts": 1, "elapsed_ms": 5}


def _fail(status="model_unavailable"):
    return {"status": status, "ok": False, "origin": "model_unavailable", "elapsed_ms": 5}


def _patch(monkeypatch, result):
    async def fake(**kwargs):
        fake.calls.append(kwargs)
        return result
    fake.calls = []
    monkeypatch.setattr(level_model, "level_model_json", fake)
    return fake


def test_detect_spanish_via_model(monkeypatch):
    fake = _patch(monkeypatch, _ok({"language": "es", "language_name": "Spanish", "confidence": "high",
                                    "script": "Latin", "alternatives": []}))
    result = _run(polyglot.detect_language(polyglot.DetectRequest(text="Hola, ¿cómo estás?")))
    assert result.success is True
    assert result.language_code == "es" and result.detected_language == "Spanish"
    assert result.confidence_label == "high" and result.reliable is True
    assert result.origin == "model" and result.receipt_id == "rcpt-poly"
    assert fake.calls[0]["schema"] is polyglot_core.DetectionEnvelope


def test_detect_spanish_model_down_never_reports_english(monkeypatch):
    _patch(monkeypatch, _fail())
    result = _run(polyglot.detect_language(polyglot.DetectRequest(text="Hola, ¿cómo estás?")))
    assert result.success is False
    assert result.detected_language is None and result.language_code is None
    assert result.confidence is None
    assert result.fallback["candidates"] == []
    assert "English" not in result.model_dump_json()


def test_detect_script_fallback_is_labelled_and_unsuccessful(monkeypatch):
    _patch(monkeypatch, _fail("timeout"))
    result = _run(polyglot.detect_language(polyglot.DetectRequest(text="こんにちは")))
    assert result.success is False
    assert result.origin == "heuristic_fallback"
    assert result.fallback["kind"] == "script_heuristic"
    assert result.fallback["candidates"] == ["ja"]
    assert result.fallback["reliable"] is False and result.fallback["confidence"] == "low"
    assert "HEURISTIC" in result.fallback["label"]


def test_translate_happy_path(monkeypatch):
    fake = _patch(monkeypatch, _ok({"status": "translated", "translation": "Bonjour, comment allez-vous ?",
                                    "source_language": "en", "source_language_name": "English",
                                    "target_language": "fr", "target_language_name": "French", "notes": None}))
    result = _run(polyglot.translate_text(polyglot.TranslateRequest(text="Good morning, how are you?", target_language="fr")))
    assert result.success is True
    assert "Bonjour" in result.translated_text
    assert result.target_language == "fr" and result.source_language == "en"
    assert result.receipt_id == "rcpt-poly"
    assert "<text>\nGood morning, how are you?\n</text>" in fake.calls[0]["prompt"]


def test_translate_model_down_never_echoes_source(monkeypatch):
    _patch(monkeypatch, _fail())
    result = _run(polyglot.translate_text(polyglot.TranslateRequest(text="Good morning", target_language="fr")))
    assert result.success is False
    assert result.translated_text is None
    assert result.origin == "model_unavailable" and result.error == "model_unavailable"


def test_translate_unsupported_target_reported_by_model(monkeypatch):
    _patch(monkeypatch, _ok({"status": "unsupported_target", "translation": None, "source_language": "en",
                             "source_language_name": "English"}))
    result = _run(polyglot.translate_text(polyglot.TranslateRequest(text="hello", target_language="Elvish")))
    assert result.success is False and result.translated_text is None
    assert result.error == "unsupported_target_language"


def test_any_bcp47_target_is_accepted_and_garbage_rejected():
    assert polyglot_core.normalize_target("nl") == ("nl", "Dutch")
    assert polyglot_core.normalize_target("pt-BR") == ("pt-BR", "pt-BR")
    assert polyglot_core.normalize_target("Vietnamese") == ("vi", "Vietnamese")
    with pytest.raises(ValueError):
        polyglot_core.normalize_target("<script>alert(1)</script>")


def test_translation_schema_requires_text_when_translated():
    with pytest.raises(Exception):
        polyglot_core.TranslationEnvelope.model_validate(
            {"status": "translated", "translation": "", "source_language": "en", "source_language_name": "English",
             "target_language": "fr"})


def test_batch_success_is_all_items(monkeypatch):
    _patch(monkeypatch, _ok({"status": "translated", "translation": "Hallo", "source_language": "en",
                             "source_language_name": "English", "target_language": "de"}))
    result = _run(polyglot.translate_batch(polyglot.TranslateBatchRequest(texts=["hello", "", "world"], target_language="de")))
    assert result.success is False
    assert result.succeeded == 2 and result.failed == 1
    assert result.results[1].method == "validation" and result.results[1].translated_text is None


def test_malformed_requests_are_rejected():
    app = FastAPI()
    app.include_router(polyglot.router, prefix="/polyglot")
    client = TestClient(app)
    assert client.post("/polyglot/translate", json={"text": "", "target_language": "fr"}).status_code == 422
    assert client.post("/polyglot/translate", json={"text": "x" * 5001, "target_language": "fr"}).status_code == 422
    assert client.post("/polyglot/translate", json={"text": "hi"}).status_code == 422
    assert client.post("/polyglot/translate", json={"text": "hi", "target_language": "<b>"}).status_code == 400
    assert client.post("/polyglot/translate/batch", json={"texts": ["a"] * 11, "target_language": "de"}).status_code == 422


def test_status_is_measured(monkeypatch):
    polyglot_core.OUTCOMES.reset()
    monkeypatch.setattr("cortex_server.routers.polyglot.model_lane_readiness",
                        lambda: {"executable_available": True, "check": "path_lookup_only"})
    _patch(monkeypatch, _fail())
    _run(polyglot.translate_text(polyglot.TranslateRequest(text="hi", target_language="fr")))
    status = _run(polyglot.polyglot_status())
    assert status["status"] == "degraded"
    assert status["model_error_count"] >= 1


def test_adapter_contract(monkeypatch):
    assert polyglot_adapter.LEVEL == 28 and polyglot_adapter.NAME == "polyglot"
    assert polyglot_adapter.NEEDS_MODEL is True and polyglot_adapter.SAFE_AUTORUN is True
    fake = _patch(monkeypatch, _ok({"message_language": "es", "message_language_name": "Spanish", "confidence": "high",
                                    "translation_requested": False}))
    out = _run(polyglot_adapter.run("Hola, ¿cómo estás?", {"principal_scope_key": "principal:abc"}))
    assert out["operation"] == "polyglot.detect" and out["origin"] == "model"
    assert out["data"]["message_language"] == "es" and out["receipt_id"] == "rcpt-poly"
    assert fake.calls[0]["schema"] is polyglot_core.AssistEnvelope
    json.dumps(out)

    _patch(monkeypatch, _fail())
    with pytest.raises(ExecutionBlocked) as exc:
        _run(polyglot_adapter.run("Hola", {"principal_scope_key": "principal:abc"}))
    assert exc.value.reason == "model_unavailable"
    with pytest.raises(ExecutionBlocked):
        _run(polyglot_adapter.run("Hola", {"principal_scope_key": "principal:abc", "target_language": "fr"}))
    with pytest.raises(ExecutionBlocked):
        _run(polyglot_adapter.run("Hola", {}))


def test_legacy_stub_class_no_longer_returns_templates():
    with pytest.raises(NotImplementedError):
        polyglot_core.Polyglot().translate("x")
