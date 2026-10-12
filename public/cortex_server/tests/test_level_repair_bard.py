"""L6 Bard repair: handshake-based status, reported voices, voice honoured or rejected."""

import asyncio
import inspect
import json
import struct

import pytest
from fastapi import HTTPException

from cortex_server.modules import bard as bard_module
from cortex_server.modules.level_adapters import bard as bard_adapter
from cortex_server.routers import bard


VOICES = ["en_US-lessac-medium", "en_GB-alan-low"]


def _event(kind, data=None, payload=b""):
    body = json.dumps(data).encode() if data is not None else b""
    header = {"type": kind, "data_length": len(body), "payload_length": len(payload)}
    return (json.dumps(header) + "\n").encode() + body + payload


async def _start_fake_piper(behaviour="ok", seen=None):
    async def handle(reader, writer):
        try:
            if behaviour == "silent":
                await asyncio.sleep(0.05)
                writer.close()
                return
            line = await reader.readline()
            header = json.loads(line)
            data = json.loads(await reader.readexactly(header.get("data_length", 0))) if header.get("data_length") else {}
            if seen is not None:
                seen.append({"type": header["type"], "data": data})
            if header["type"] == "describe":
                info = {"tts": [{"name": "piper", "version": "1.2.0", "voices": [
                    {"name": name, "languages": [name[:5]], "installed": True} for name in VOICES]}]}
                writer.write(_event("info", info))
            elif header["type"] == "synthesize":
                if behaviour == "huge":
                    writer.write((json.dumps({"type": "audio-chunk", "payload_length": 2_000_000_000}) + "\n").encode())
                else:
                    writer.write(_event("audio-start", {"rate": 16000, "width": 2, "channels": 1}))
                    writer.write(_event("audio-chunk", {"rate": 16000, "width": 2, "channels": 1}, b"\x00\x00" * 16000))
                    writer.write(_event("audio-stop"))
            await writer.drain()
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1]


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    bard._probe_cache.clear()
    monkeypatch.setenv("VIBEVOICE_ENABLED", "0")
    monkeypatch.setenv("PIPER_ENABLED", "1")
    monkeypatch.delenv("BARD_BACKEND", raising=False)
    monkeypatch.setattr(bard, "BARD_CFG_PATHS", [])
    monkeypatch.setattr(bard, "PIPER_FALLBACK_HOST", "")
    yield
    bard._probe_cache.clear()


def _run_with_piper(monkeypatch, coro_factory, behaviour="ok", seen=None):
    async def scenario():
        server, port = await _start_fake_piper(behaviour, seen)
        monkeypatch.setattr(bard, "PIPER_HOST", "127.0.0.1")
        monkeypatch.setattr(bard, "PIPER_PORT", port)
        try:
            return await coro_factory()
        finally:
            server.close()
            await server.wait_closed()

    return asyncio.run(scenario())


def test_status_requires_protocol_handshake_and_reports_real_voices(monkeypatch):
    body = _run_with_piper(monkeypatch, bard.bard_status)
    piper = body["data"]["backends"]["piper"]
    assert body["data"]["status"] == "active"
    assert piper["handshake"] == "describe"
    assert piper["voices_detected"] == VOICES


def test_tcp_only_listener_is_not_reported_active(monkeypatch):
    body = _run_with_piper(monkeypatch, bard.bard_status, behaviour="silent")
    assert body["data"]["status"] == "down"
    assert body["success"] is False


def test_requested_voice_is_sent_and_reported(monkeypatch):
    seen = []

    async def speak():
        return await bard.text_to_speech(bard.SpeakRequest(text="Hello from Cortex.", voice="en_GB-alan-low", backend="piper"))

    response = _run_with_piper(monkeypatch, speak, seen=seen)
    assert response.success is True
    assert response.voice_used == "en_GB-alan-low" and response.voice_source == "requested"
    synth = [row for row in seen if row["type"] == "synthesize"][0]
    assert synth["data"]["voice"] == {"name": "en_GB-alan-low"}
    wav = __import__("base64").b64decode(response.audio_base64)
    assert wav[:4] == b"RIFF" and struct.unpack("<I", wav[24:28])[0] == response.sample_rate == 16000
    assert response.duration_seconds == pytest.approx(1.0, abs=0.05)


def test_unknown_voice_is_rejected_not_silently_replaced(monkeypatch):
    async def speak():
        return await bard.text_to_speech(bard.SpeakRequest(text="hi", voice="xx_XX-made-up", backend="piper"))

    with pytest.raises(HTTPException) as rejected:
        _run_with_piper(monkeypatch, speak)
    assert rejected.value.status_code == 400
    assert rejected.value.detail["error"] == "unknown_voice"


def test_long_text_is_flagged_truncated(monkeypatch):
    async def speak():
        return await bard.text_to_speech(bard.SpeakRequest(text="a " * 4000, backend="piper"))

    response = _run_with_piper(monkeypatch, speak)
    assert response.truncated is True and response.text_length == 5000 and response.original_text_length == 8000


def test_hostile_payload_length_fails_closed(monkeypatch):
    async def speak():
        return await bard.text_to_speech(bard.SpeakRequest(text="hi", backend="piper", allow_fallback=False))

    response = _run_with_piper(monkeypatch, speak, behaviour="huge")
    assert response.success is False
    assert response.error_code == "payload_too_large"


def test_invalid_backend_is_400():
    with pytest.raises(HTTPException) as rejected:
        asyncio.run(bard.text_to_speech(bard.SpeakRequest(text="hi", backend="espeak")))
    assert rejected.value.status_code == 400


def test_backends_down_returns_error_code_and_no_voices(monkeypatch):
    monkeypatch.setattr(bard, "PIPER_HOST", "127.0.0.1")
    monkeypatch.setattr(bard, "PIPER_PORT", 9)
    response = asyncio.run(bard.text_to_speech(bard.SpeakRequest(text="hi")))
    assert response.success is False
    assert response.error_code in {"unreachable", "synthesis_failed", "disabled"}
    voices = asyncio.run(bard.list_voices())
    assert voices["voices"] == []
    assert voices["piper_reachable"] is False


def test_module_stub_no_longer_fakes_speech():
    source = inspect.getsource(bard_module)
    assert "Speaking via Piper" not in source
    assert inspect.iscoroutinefunction(bard_module.Bard.speak)


def test_bard_adapter_reports_unavailability_honestly(monkeypatch):
    monkeypatch.setattr(bard, "PIPER_HOST", "127.0.0.1")
    monkeypatch.setattr(bard, "PIPER_PORT", 9)
    out = asyncio.run(bard_adapter.run("send me a voice note", {}))
    assert out["operation"] == "bard.availability"
    assert out["origin"] == "deterministic"
    assert "unavailable" in out["summary"] and "Do not promise a voice note" in out["summary"]
    assert out["data"]["piper"]["reachable"] is False


def test_bard_adapter_lists_reported_voices(monkeypatch):
    async def run():
        return await bard_adapter.run("can you speak?", {})

    out = _run_with_piper(monkeypatch, run)
    assert out["data"]["piper"]["voices"] == VOICES
    assert len(out["summary"]) <= 1500
