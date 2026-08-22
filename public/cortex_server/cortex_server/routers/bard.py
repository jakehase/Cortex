"""
Bard Router - Text-to-Speech backend adapter.

Supports:
- Piper (Wyoming) backend (existing)
- Microsoft VibeVoice backend via local HTTP service

Compatibility preserved for:
- /bard/status
- /bard/speak
- /bard/voices
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import struct
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# Piper TTS connection settings
PIPER_HOST = "piper-tts"
PIPER_PORT = 10200
PIPER_FALLBACK_HOST = "10.0.0.52"
PIPER_TIMEOUT = 30.0

# VibeVoice service settings
VIBEVOICE_DEFAULT_URL = "http://10.0.0.52:10300"
BARD_CFG_PATHS = [Path("/app/config/bard_backend.json"), Path("/root/.openclaw/bard_backend.json")]
VALID_BACKENDS = {"auto", "piper", "vibevoice"}


class SpeakRequest(BaseModel):
    text: str = Field(..., description="Text to synthesize into speech")
    voice: Optional[str] = Field("en_US-lessac-medium", description="Voice to use")
    backend: Optional[str] = Field(None, description="Backend override: auto|piper|vibevoice")
    allow_fallback: bool = Field(True, description="Allow fallback to Piper when preferred backend fails")


class SpeakResponse(BaseModel):
    success: bool
    audio_base64: Optional[str] = None
    format: Optional[str] = None
    sample_rate: Optional[int] = None
    channels: Optional[int] = None
    duration_seconds: Optional[float] = None
    text_length: int = 0
    backend: Optional[str] = None
    error: Optional[str] = None


def _parse_bool(v: Any, default: bool = True) -> bool:
    if isinstance(v, bool):
        return v
    if v is None:
        return default
    s = str(v).strip().lower()
    if s in {"1", "true", "yes", "on"}:
        return True
    if s in {"0", "false", "no", "off"}:
        return False
    return default


def _load_bard_cfg() -> Dict[str, Any]:
    file_cfg: Dict[str, Any] = {}
    for p in BARD_CFG_PATHS:
        try:
            if p.exists():
                d = json.loads(p.read_text())
                if isinstance(d, dict):
                    file_cfg = d
                    break
        except Exception:
            continue

    default_backend = (os.getenv("BARD_BACKEND") or str(file_cfg.get("default_backend", "auto"))).strip().lower()
    if default_backend not in VALID_BACKENDS:
        default_backend = "auto"

    vibevoice_url = (os.getenv("VIBEVOICE_URL") or str(file_cfg.get("vibevoice_url", VIBEVOICE_DEFAULT_URL))).strip().rstrip("/")
    vibevoice_enabled = _parse_bool(os.getenv("VIBEVOICE_ENABLED", file_cfg.get("vibevoice_enabled", True)), default=True)
    piper_enabled = _parse_bool(os.getenv("PIPER_ENABLED", file_cfg.get("piper_enabled", True)), default=True)

    return {
        "default_backend": default_backend,
        "vibevoice_url": vibevoice_url,
        "vibevoice_enabled": vibevoice_enabled,
        "piper_enabled": piper_enabled,
    }


def _http_json(method: str, url: str, body: Optional[Dict[str, Any]] = None, timeout: float = 30.0) -> Dict[str, Any]:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    req = Request(url=url, method=method.upper(), data=payload, headers={"Content-Type": "application/json"})

    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        txt = ""
        try:
            txt = e.read().decode("utf-8", errors="replace")
        except Exception:
            txt = str(e)
        raise RuntimeError(f"HTTP {getattr(e, 'code', 'error')}: {txt[:300]}")
    except URLError as e:
        raise RuntimeError(f"connection failed: {e}")
    except Exception as e:
        raise RuntimeError(str(e))


async def _wyoming_connect() -> tuple:
    errors = []
    for host in [PIPER_HOST, PIPER_FALLBACK_HOST]:
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(host, PIPER_PORT), timeout=5.0)
            return reader, writer
        except Exception as e:
            errors.append(f"{host}:{PIPER_PORT} - {str(e)}")
    raise ConnectionError(f"Cannot connect to Piper TTS: {'; '.join(errors)}")


async def _wyoming_check() -> Dict[str, Any]:
    try:
        _, writer = await _wyoming_connect()
        writer.close()
        await writer.wait_closed()
        return {"reachable": True, "version": "piper-tts", "voices_detected": ["en_US-lessac-medium"]}
    except Exception as e:
        return {"reachable": False, "error": str(e)}


async def _wyoming_synthesize(text: str) -> tuple[bytes, Dict[str, Any]]:
    reader, writer = await _wyoming_connect()
    try:
        synth_data = json.dumps({"text": text}).encode("utf-8")
        header = json.dumps({"type": "synthesize", "data_length": len(synth_data), "payload_length": 0})
        writer.write((header + "\n").encode())
        writer.write(synth_data)
        await writer.drain()

        audio_info = {"rate": 22050, "width": 2, "channels": 1}
        audio_chunks = []
        for _ in range(5000):
            line = await asyncio.wait_for(reader.readline(), timeout=PIPER_TIMEOUT)
            if not line:
                break
            event = json.loads(line)
            etype = event.get("type", "")
            data_length = event.get("data_length", 0)
            payload_length = event.get("payload_length", 0)

            if data_length > 0:
                data = await reader.readexactly(data_length)
                if etype == "audio-start":
                    parsed = json.loads(data)
                    audio_info["rate"] = parsed.get("rate", 22050)
                    audio_info["width"] = parsed.get("width", 2)
                    audio_info["channels"] = parsed.get("channels", 1)

            if payload_length > 0:
                audio_chunks.append(await reader.readexactly(payload_length))
            if etype == "audio-stop":
                break

        return b"".join(audio_chunks), audio_info
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


def _pcm_to_wav(pcm_data: bytes, rate: int, width: int, channels: int) -> bytes:
    buf = io.BytesIO()
    data_size = len(pcm_data)
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))
    buf.write(struct.pack("<H", 1))
    buf.write(struct.pack("<H", channels))
    buf.write(struct.pack("<I", rate))
    buf.write(struct.pack("<I", rate * channels * width))
    buf.write(struct.pack("<H", channels * width))
    buf.write(struct.pack("<H", width * 8))
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm_data)
    return buf.getvalue()


async def _vibevoice_health(cfg: Dict[str, Any]) -> Dict[str, Any]:
    if not cfg.get("vibevoice_enabled", True):
        return {"reachable": False, "enabled": False, "reason": "disabled"}
    base = cfg.get("vibevoice_url", VIBEVOICE_DEFAULT_URL)
    if not base:
        return {"reachable": False, "enabled": True, "reason": "missing_url"}
    try:
        data = await asyncio.to_thread(_http_json, "GET", f"{base}/health", None, 8.0)
        return {"reachable": bool(data.get("success", True)), "enabled": True, "url": base, "service": data}
    except Exception as e:
        return {"reachable": False, "enabled": True, "url": base, "error": str(e)}


async def _vibevoice_voices(cfg: Dict[str, Any]) -> Dict[str, Any]:
    base = cfg.get("vibevoice_url", VIBEVOICE_DEFAULT_URL)
    return await asyncio.to_thread(_http_json, "GET", f"{base}/voices", None, 10.0)


async def _vibevoice_synthesize(cfg: Dict[str, Any], text: str, voice: Optional[str]) -> Dict[str, Any]:
    base = cfg.get("vibevoice_url", VIBEVOICE_DEFAULT_URL)
    payload: Dict[str, Any] = {"text": text}
    if voice:
        payload["voice"] = voice
    return await asyncio.to_thread(_http_json, "POST", f"{base}/synthesize", payload, 120.0)


async def _synthesize_with_piper(text: str) -> Dict[str, Any]:
    pcm_data, audio_info = await _wyoming_synthesize(text)
    if not pcm_data:
        raise RuntimeError("TTS returned no audio data")

    rate = audio_info["rate"]
    width = audio_info["width"]
    channels = audio_info["channels"]
    wav_data = _pcm_to_wav(pcm_data, rate, width, channels)
    duration = len(pcm_data) / (rate * width * channels)
    return {
        "backend": "piper",
        "audio_base64": base64.b64encode(wav_data).decode("ascii"),
        "format": "wav",
        "sample_rate": rate,
        "channels": channels,
        "duration_seconds": round(duration, 2),
    }


async def _synthesize_with_vibevoice(cfg: Dict[str, Any], text: str, voice: Optional[str]) -> Dict[str, Any]:
    resp = await _vibevoice_synthesize(cfg, text, voice)
    if not resp.get("success"):
        raise RuntimeError(resp.get("error") or "VibeVoice synthesis failed")
    audio_b64 = resp.get("audio_base64")
    if not audio_b64:
        raise RuntimeError("VibeVoice returned no audio")
    return {
        "backend": "vibevoice",
        "audio_base64": audio_b64,
        "format": resp.get("format", "wav"),
        "sample_rate": int(resp.get("sample_rate") or 24000),
        "channels": int(resp.get("channels") or 1),
        "duration_seconds": resp.get("duration_seconds"),
    }


async def _choose_backend(request_backend: Optional[str], cfg: Dict[str, Any]) -> str:
    chosen = (request_backend or cfg.get("default_backend") or "auto").strip().lower()
    if chosen not in VALID_BACKENDS:
        chosen = "auto"
    if chosen != "auto":
        return chosen
    vibe = await _vibevoice_health(cfg)
    if vibe.get("reachable"):
        return "vibevoice"
    return "piper"


@router.get("/status")
async def bard_status() -> Dict[str, Any]:
    cfg = _load_bard_cfg()
    piper_info = await _wyoming_check()
    vibe_info = await _vibevoice_health(cfg)

    selected = cfg.get("default_backend", "auto")
    effective = await _choose_backend(None, cfg)

    if effective == "vibevoice" and vibe_info.get("reachable"):
        status = "active"
    elif piper_info.get("reachable"):
        status = "active"
    elif vibe_info.get("reachable"):
        status = "degraded"
    else:
        status = "down"

    return {
        "success": True,
        "data": {
            "level": 6,
            "name": "The Bard",
            "role": "Text-to-Speech",
            "status": status,
            "selected_backend": selected,
            "effective_backend": effective,
            "backends": {"vibevoice": vibe_info, "piper": piper_info},
            "protocol": {"vibevoice": "HTTP", "piper": "Wyoming"},
            "timestamp": datetime.now().isoformat(),
        },
    }


@router.post("/speak", response_model=SpeakResponse)
async def text_to_speech(request: SpeakRequest) -> SpeakResponse:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    text = request.text[:5000]
    cfg = _load_bard_cfg()

    preferred = await _choose_backend(request.backend, cfg)
    try_order = [preferred]
    if request.allow_fallback:
        for b in ["vibevoice", "piper"]:
            if b not in try_order:
                try_order.append(b)

    last_error: Optional[str] = None
    for backend in try_order:
        try:
            if backend == "vibevoice":
                if not cfg.get("vibevoice_enabled", True):
                    raise RuntimeError("VibeVoice backend disabled")
                out = await _synthesize_with_vibevoice(cfg, text, request.voice)
            elif backend == "piper":
                if not cfg.get("piper_enabled", True):
                    raise RuntimeError("Piper backend disabled")
                out = await _synthesize_with_piper(text)
            else:
                raise RuntimeError(f"Unsupported backend: {backend}")

            return SpeakResponse(
                success=True,
                audio_base64=out["audio_base64"],
                format=out.get("format", "wav"),
                sample_rate=out.get("sample_rate"),
                channels=out.get("channels"),
                duration_seconds=out.get("duration_seconds"),
                text_length=len(text),
                backend=backend,
            )
        except asyncio.TimeoutError:
            last_error = f"{backend}: synthesis timed out"
        except Exception as e:
            last_error = f"{backend}: {e}"

    return SpeakResponse(success=False, text_length=len(text), backend=preferred, error=last_error or "TTS synthesis failed")


@router.get("/voices")
async def list_voices() -> Dict[str, Any]:
    cfg = _load_bard_cfg()
    voices = []

    piper_info = await _wyoming_check()
    vibe_info = await _vibevoice_health(cfg)

    voices.append(
        {
            "id": "en_US-lessac-medium",
            "name": "Lessac (US English)",
            "language": "en_US",
            "quality": "medium",
            "provider": "piper",
            "description": "Clear American English voice, good for general TTS",
        }
    )

    if vibe_info.get("reachable"):
        try:
            vv = await _vibevoice_voices(cfg)
            for v in vv.get("voices", []) if isinstance(vv, dict) else []:
                if isinstance(v, dict):
                    v.setdefault("provider", "vibevoice")
                    voices.append(v)
        except Exception:
            pass

    return {
        "success": True,
        "voices": voices,
        "selected_backend": cfg.get("default_backend", "auto"),
        "piper_reachable": piper_info.get("reachable", False),
        "vibevoice_reachable": vibe_info.get("reachable", False),
        "backends": {"piper": piper_info, "vibevoice": vibe_info},
    }
