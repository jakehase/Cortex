"""
Bard Router - Text-to-Speech backend adapter (L6).

Supports:
- Piper (Wyoming) backend
- Microsoft VibeVoice backend via local HTTP service

Compatibility preserved for:
- /bard/status
- /bard/speak
- /bard/voices

Honesty rules enforced here:
- A backend is "reachable" only after a protocol handshake (Wyoming
  ``describe`` -> ``info``; VibeVoice ``/health``), never on a bare TCP connect.
- Voices are listed only when a reachable backend reports them.
- A requested ``voice`` is honoured (sent to the backend) or rejected with 400
  ``unknown_voice``; it is never silently replaced by a default voice.
- Synthesis failures return ``success: false`` with a short error code.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import struct
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# Piper TTS connection settings (env-overridable; defaults keep the existing
# deployment topology).
PIPER_HOST = os.getenv("CORTEX_BARD_PIPER_HOST", "piper-tts")
PIPER_PORT = int(os.getenv("CORTEX_BARD_PIPER_PORT", "10200") or 10200)
PIPER_FALLBACK_HOST = os.getenv("CORTEX_BARD_PIPER_FALLBACK_HOST", "10.0.0.52")
PIPER_TIMEOUT = 30.0
PIPER_CONNECT_TIMEOUT = 3.0
SYNTH_DEADLINE_SECONDS = float(os.getenv("CORTEX_BARD_SYNTH_DEADLINE_S", "60") or 60)
MAX_EVENT_BYTES = 2 * 1024 * 1024
MAX_AUDIO_BYTES = 50 * 1024 * 1024
MAX_TEXT_CHARS = 5000
PROBE_CACHE_SECONDS = 30.0

# VibeVoice service settings
VIBEVOICE_DEFAULT_URL = "http://10.0.0.52:10300"
BARD_CFG_PATHS = [Path("/app/config/bard_backend.json"), Path("/root/.openclaw/bard_backend.json")]
VALID_BACKENDS = {"auto", "piper", "vibevoice"}

_probe_cache: Dict[str, Dict[str, Any]] = {}


class SpeakRequest(BaseModel):
    text: str = Field(..., description="Text to synthesize into speech")
    voice: Optional[str] = Field(
        None,
        description="Voice id reported by /bard/voices; omitted means the backend default voice",
    )
    backend: Optional[str] = Field(None, description="Backend override: auto|piper|vibevoice")
    allow_fallback: bool = Field(True, description="Allow fallback to another backend when the preferred one fails")


class SpeakResponse(BaseModel):
    success: bool
    audio_base64: Optional[str] = None
    format: Optional[str] = None
    sample_rate: Optional[int] = None
    channels: Optional[int] = None
    duration_seconds: Optional[float] = None
    text_length: int = 0
    original_text_length: Optional[int] = None
    truncated: bool = False
    backend: Optional[str] = None
    voice_requested: Optional[str] = None
    voice_used: Optional[str] = None
    voice_source: Optional[str] = None
    audio_sha256: Optional[str] = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    attempts: List[Dict[str, Any]] = Field(default_factory=list)


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


def _error_code(exc: BaseException) -> str:
    if isinstance(exc, asyncio.TimeoutError):
        return "timeout"
    if isinstance(exc, (ConnectionError, OSError)) and not isinstance(exc, RuntimeError):
        return "unreachable"
    text = str(exc)
    if text.startswith("HTTP 5"):
        return "http_5xx"
    if text.startswith("HTTP 4"):
        return "http_4xx"
    if text.startswith("connection failed"):
        return "unreachable"
    for code in ("payload_too_large", "no_audio", "disabled", "unknown_voice", "invalid_response"):
        if code in text:
            return code
    return "synthesis_failed"


def _http_json(method: str, url: str, body: Optional[Dict[str, Any]] = None, timeout: float = 30.0) -> Dict[str, Any]:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    req = Request(url=url, method=method.upper(), data=payload, headers={"Content-Type": "application/json"})

    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read(MAX_AUDIO_BYTES + 1)
            if len(raw) > MAX_AUDIO_BYTES:
                raise RuntimeError("payload_too_large")
            text = raw.decode("utf-8", errors="replace")
            data = json.loads(text) if text else {}
            if not isinstance(data, dict):
                raise RuntimeError("invalid_response")
            return data
    except HTTPError as e:
        raise RuntimeError(f"HTTP {getattr(e, 'code', 'error')}")
    except URLError as e:
        raise RuntimeError(f"connection failed: {type(getattr(e, 'reason', e)).__name__}")
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"invalid_response: {type(e).__name__}")


async def _wyoming_connect() -> tuple:
    errors = []
    for host in [PIPER_HOST, PIPER_FALLBACK_HOST]:
        if not host:
            continue
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, PIPER_PORT), timeout=PIPER_CONNECT_TIMEOUT
            )
            return reader, writer
        except Exception as e:
            errors.append(f"{host}:{PIPER_PORT}:{type(e).__name__}")
    raise ConnectionError(f"Cannot connect to Piper TTS ({'; '.join(errors) or 'no host configured'})")


async def _read_wyoming_event(reader: asyncio.StreamReader, timeout: float) -> Optional[Dict[str, Any]]:
    """Read one Wyoming event (header line + optional data + payload), bounded."""

    line = await asyncio.wait_for(reader.readline(), timeout=timeout)
    if not line:
        return None
    if len(line) > MAX_EVENT_BYTES:
        raise RuntimeError("payload_too_large")
    try:
        event = json.loads(line)
    except ValueError as exc:
        raise RuntimeError("invalid_response") from exc
    if not isinstance(event, dict):
        raise RuntimeError("invalid_response")
    data_length = event.get("data_length") or 0
    payload_length = event.get("payload_length") or 0
    if not isinstance(data_length, int) or not isinstance(payload_length, int) or data_length < 0 or payload_length < 0:
        raise RuntimeError("invalid_response")
    if data_length > MAX_EVENT_BYTES or payload_length > MAX_EVENT_BYTES:
        raise RuntimeError("payload_too_large")
    data: Dict[str, Any] = dict(event.get("data") or {}) if isinstance(event.get("data"), dict) else {}
    if data_length:
        raw = await asyncio.wait_for(reader.readexactly(data_length), timeout=timeout)
        try:
            parsed = json.loads(raw)
        except ValueError as exc:
            raise RuntimeError("invalid_response") from exc
        if isinstance(parsed, dict):
            data.update(parsed)
    payload = b""
    if payload_length:
        payload = await asyncio.wait_for(reader.readexactly(payload_length), timeout=timeout)
    return {"type": str(event.get("type") or ""), "data": data, "payload": payload}


def _voices_from_info(info: Dict[str, Any]) -> List[Dict[str, Any]]:
    voices: List[Dict[str, Any]] = []
    for program in info.get("tts") or ():
        if not isinstance(program, dict):
            continue
        for voice in program.get("voices") or ():
            if not isinstance(voice, dict) or not voice.get("name"):
                continue
            if voice.get("installed") is False:
                continue
            languages = voice.get("languages") if isinstance(voice.get("languages"), list) else []
            voices.append(
                {
                    "id": str(voice["name"]),
                    "name": str(voice.get("description") or voice["name"]),
                    "language": str(languages[0]) if languages else None,
                    "provider": "piper",
                    "version": voice.get("version"),
                }
            )
    return voices


async def _wyoming_describe() -> Dict[str, Any]:
    reader, writer = await _wyoming_connect()
    try:
        writer.write((json.dumps({"type": "describe", "data_length": 0, "payload_length": 0}) + "\n").encode())
        await writer.drain()
        for _ in range(16):
            event = await _read_wyoming_event(reader, timeout=5.0)
            if event is None:
                break
            if event["type"] == "info":
                info = event["data"]
                programs = [p for p in info.get("tts") or () if isinstance(p, dict)]
                return {
                    "reachable": True,
                    "handshake": "describe",
                    "programs": [
                        {"name": p.get("name"), "version": p.get("version")} for p in programs[:4]
                    ],
                    "voices": _voices_from_info(info),
                }
        raise RuntimeError("invalid_response: no info event")
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


async def _wyoming_check(*, use_cache: bool = True) -> Dict[str, Any]:
    cached = _probe_cache.get("piper")
    if use_cache and cached and time.monotonic() - cached["at"] <= PROBE_CACHE_SECONDS:
        return dict(cached["value"])
    try:
        value = await asyncio.wait_for(_wyoming_describe(), timeout=10.0)
    except Exception as e:
        value = {"reachable": False, "error_code": _error_code(e)}
    value["checked_at"] = datetime.utcnow().isoformat() + "Z"
    _probe_cache["piper"] = {"at": time.monotonic(), "value": dict(value)}
    return value


async def _wyoming_synthesize(text: str, voice: Optional[str] = None) -> tuple[bytes, Dict[str, Any]]:
    reader, writer = await _wyoming_connect()
    try:
        synth: Dict[str, Any] = {"text": text}
        if voice:
            synth["voice"] = {"name": voice}
        synth_data = json.dumps(synth).encode("utf-8")
        header = json.dumps({"type": "synthesize", "data_length": len(synth_data), "payload_length": 0})
        writer.write((header + "\n").encode())
        writer.write(synth_data)
        await writer.drain()

        audio_info = {"rate": None, "width": None, "channels": None}
        audio_chunks: List[bytes] = []
        total = 0
        stopped = False
        for _ in range(20000):
            event = await _read_wyoming_event(reader, timeout=PIPER_TIMEOUT)
            if event is None:
                break
            etype = event["type"]
            if etype in {"audio-start", "audio-chunk"}:
                for key in ("rate", "width", "channels"):
                    value = event["data"].get(key)
                    if isinstance(value, int) and value > 0 and audio_info[key] is None:
                        audio_info[key] = value
            if event["payload"]:
                total += len(event["payload"])
                if total > MAX_AUDIO_BYTES:
                    raise RuntimeError("payload_too_large")
                audio_chunks.append(event["payload"])
            if etype == "error":
                raise RuntimeError("synthesis_failed")
            if etype == "audio-stop":
                stopped = True
                break
        if not stopped and not audio_chunks:
            raise RuntimeError("no_audio")
        resolved = {
            "rate": audio_info["rate"] or 22050,
            "width": audio_info["width"] or 2,
            "channels": audio_info["channels"] or 1,
            "format_reported": all(audio_info[key] is not None for key in audio_info),
        }
        return b"".join(audio_chunks), resolved
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


async def _vibevoice_health(cfg: Dict[str, Any], *, use_cache: bool = True) -> Dict[str, Any]:
    if not cfg.get("vibevoice_enabled", True):
        return {"reachable": False, "enabled": False, "reason": "disabled"}
    base = cfg.get("vibevoice_url", VIBEVOICE_DEFAULT_URL)
    if not base:
        return {"reachable": False, "enabled": True, "reason": "missing_url"}
    cached = _probe_cache.get("vibevoice")
    if use_cache and cached and cached.get("url") == base and time.monotonic() - cached["at"] <= PROBE_CACHE_SECONDS:
        return dict(cached["value"])
    try:
        data = await asyncio.to_thread(_http_json, "GET", f"{base}/health", None, 5.0)
        reachable = data.get("success") is not False and str(data.get("status", "ok")).lower() not in {
            "error", "down", "unavailable", "degraded",
        }
        value: Dict[str, Any] = {"reachable": reachable, "enabled": True, "handshake": "health"}
        if not reachable:
            value["error_code"] = "unhealthy"
    except Exception as e:
        value = {"reachable": False, "enabled": True, "error_code": _error_code(e)}
    value["checked_at"] = datetime.utcnow().isoformat() + "Z"
    _probe_cache["vibevoice"] = {"at": time.monotonic(), "url": base, "value": dict(value)}
    return value


async def _vibevoice_voices(cfg: Dict[str, Any]) -> Dict[str, Any]:
    base = cfg.get("vibevoice_url", VIBEVOICE_DEFAULT_URL)
    return await asyncio.to_thread(_http_json, "GET", f"{base}/voices", None, 10.0)


async def _vibevoice_voice_ids(cfg: Dict[str, Any]) -> Optional[List[str]]:
    try:
        payload = await _vibevoice_voices(cfg)
    except Exception:
        return None
    ids: List[str] = []
    for voice in payload.get("voices") or () if isinstance(payload, dict) else ():
        if isinstance(voice, dict) and (voice.get("id") or voice.get("name")):
            ids.append(str(voice.get("id") or voice.get("name")))
        elif isinstance(voice, str):
            ids.append(voice)
    return ids


async def _vibevoice_synthesize(cfg: Dict[str, Any], text: str, voice: Optional[str]) -> Dict[str, Any]:
    base = cfg.get("vibevoice_url", VIBEVOICE_DEFAULT_URL)
    payload: Dict[str, Any] = {"text": text}
    if voice:
        payload["voice"] = voice
    return await asyncio.to_thread(_http_json, "POST", f"{base}/synthesize", payload, SYNTH_DEADLINE_SECONDS)


async def _synthesize_with_piper(text: str, voice: Optional[str] = None) -> Dict[str, Any]:
    pcm_data, audio_info = await _wyoming_synthesize(text, voice)
    if not pcm_data:
        raise RuntimeError("no_audio")

    rate = audio_info["rate"]
    width = audio_info["width"]
    channels = audio_info["channels"]
    wav_data = _pcm_to_wav(pcm_data, rate, width, channels)
    duration = len(pcm_data) / (rate * width * channels)
    return {
        "backend": "piper",
        "audio_base64": base64.b64encode(wav_data).decode("ascii"),
        "audio_sha256": hashlib.sha256(wav_data).hexdigest(),
        "format": "wav",
        "sample_rate": rate,
        "channels": channels,
        "duration_seconds": round(duration, 2),
        "voice_used": voice,
        "voice_source": "requested" if voice else "backend_default",
    }


async def _synthesize_with_vibevoice(cfg: Dict[str, Any], text: str, voice: Optional[str]) -> Dict[str, Any]:
    resp = await _vibevoice_synthesize(cfg, text, voice)
    if not resp.get("success"):
        raise RuntimeError("synthesis_failed")
    audio_b64 = resp.get("audio_base64")
    if not audio_b64 or not isinstance(audio_b64, str):
        raise RuntimeError("no_audio")
    try:
        decoded = base64.b64decode(audio_b64, validate=True)
    except Exception as exc:
        raise RuntimeError("invalid_response") from exc
    reported_voice = resp.get("voice") if isinstance(resp.get("voice"), str) else None
    if voice and reported_voice and reported_voice != voice:
        raise RuntimeError("unknown_voice: backend substituted a different voice")
    return {
        "backend": "vibevoice",
        "audio_base64": audio_b64,
        "audio_sha256": hashlib.sha256(decoded).hexdigest(),
        "format": resp.get("format", "wav"),
        "sample_rate": int(resp.get("sample_rate") or 24000),
        "channels": int(resp.get("channels") or 1),
        "duration_seconds": resp.get("duration_seconds"),
        "voice_used": voice or reported_voice,
        "voice_source": "requested" if voice else ("backend_reported" if reported_voice else "backend_default"),
    }


def _validated_backend(value: Optional[str], cfg: Dict[str, Any]) -> str:
    chosen = (value or cfg.get("default_backend") or "auto").strip().lower()
    if chosen not in VALID_BACKENDS:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported backend '{chosen[:32]}' (supported: auto, piper, vibevoice)",
        )
    return chosen


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


async def _probe_backends(cfg: Dict[str, Any]) -> tuple[Dict[str, Any], Dict[str, Any]]:
    async def piper() -> Dict[str, Any]:
        if not cfg.get("piper_enabled", True):
            return {"reachable": False, "enabled": False, "reason": "disabled"}
        return await _wyoming_check()

    piper_info, vibe_info = await asyncio.gather(piper(), _vibevoice_health(cfg))
    return piper_info, vibe_info


@router.get("/status")
async def bard_status() -> Dict[str, Any]:
    cfg = _load_bard_cfg()
    piper_info, vibe_info = await _probe_backends(cfg)

    selected = cfg.get("default_backend", "auto")
    if selected == "auto":
        effective = "vibevoice" if vibe_info.get("reachable") else ("piper" if piper_info.get("reachable") else None)
    else:
        effective = selected

    effective_info = {"piper": piper_info, "vibevoice": vibe_info}.get(effective or "", {})
    if effective_info.get("reachable"):
        status = "active"
    elif piper_info.get("reachable") or vibe_info.get("reachable"):
        status = "degraded"
    else:
        status = "down"

    piper_voices = [v["id"] for v in piper_info.get("voices", []) if isinstance(v, dict)]
    return {
        "success": status in {"active", "degraded"},
        "data": {
            "level": 6,
            "name": "The Bard",
            "role": "Text-to-Speech",
            "status": status,
            "status_basis": "protocol_handshake (wyoming describe / vibevoice health), cached up to 30s",
            "selected_backend": selected,
            "effective_backend": effective,
            "backends": {
                "vibevoice": vibe_info,
                "piper": {k: v for k, v in piper_info.items() if k != "voices"} | {"voices_detected": piper_voices},
            },
            "protocol": {"vibevoice": "HTTP", "piper": "Wyoming"},
            "timestamp": datetime.now().isoformat(),
        },
    }


async def _supported_voice(backend: str, voice: str, cfg: Dict[str, Any]) -> Optional[bool]:
    """True/False when the backend reported its voices, None when it could not."""

    if backend == "piper":
        info = await _wyoming_check()
        if not info.get("reachable"):
            return None
        return voice in {v["id"] for v in info.get("voices", []) if isinstance(v, dict)}
    ids = await _vibevoice_voice_ids(cfg)
    if ids is None:
        return None
    return voice in ids


@router.post("/speak", response_model=SpeakResponse)
async def text_to_speech(request: SpeakRequest) -> SpeakResponse:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    voice = (request.voice or "").strip() or None
    if voice is not None and len(voice) > 128:
        raise HTTPException(status_code=400, detail="voice id is too long")

    original_length = len(request.text)
    text = request.text[:MAX_TEXT_CHARS]
    cfg = _load_bard_cfg()
    requested_backend = _validated_backend(request.backend, cfg)

    preferred = await _choose_backend(requested_backend, cfg)
    try_order = [preferred]
    if request.allow_fallback:
        for b in ["vibevoice", "piper"]:
            if b not in try_order:
                try_order.append(b)

    attempts: List[Dict[str, Any]] = []
    voice_rejections = 0
    voice_checks = 0
    last_code: Optional[str] = None
    for backend in try_order:
        if backend == "vibevoice" and not cfg.get("vibevoice_enabled", True):
            attempts.append({"backend": backend, "error_code": "disabled"})
            continue
        if backend == "piper" and not cfg.get("piper_enabled", True):
            attempts.append({"backend": backend, "error_code": "disabled"})
            continue
        if voice is not None:
            supported = await _supported_voice(backend, voice, cfg)
            if supported is False:
                voice_checks += 1
                voice_rejections += 1
                attempts.append({"backend": backend, "error_code": "unknown_voice"})
                continue
            if supported is True:
                voice_checks += 1
        try:
            if backend == "vibevoice":
                out = await asyncio.wait_for(
                    _synthesize_with_vibevoice(cfg, text, voice), timeout=SYNTH_DEADLINE_SECONDS
                )
            else:
                out = await asyncio.wait_for(
                    _synthesize_with_piper(text, voice), timeout=SYNTH_DEADLINE_SECONDS
                )
            attempts.append({"backend": backend, "ok": True})
            return SpeakResponse(
                success=True,
                audio_base64=out["audio_base64"],
                format=out.get("format", "wav"),
                sample_rate=out.get("sample_rate"),
                channels=out.get("channels"),
                duration_seconds=out.get("duration_seconds"),
                text_length=len(text),
                original_text_length=original_length,
                truncated=original_length > len(text),
                backend=backend,
                voice_requested=voice,
                voice_used=out.get("voice_used"),
                voice_source=out.get("voice_source"),
                audio_sha256=out.get("audio_sha256"),
                attempts=attempts,
            )
        except Exception as e:
            last_code = _error_code(e)
            attempts.append({"backend": backend, "error_code": last_code})

    if voice is not None and voice_checks and voice_rejections == voice_checks and last_code is None:
        raise HTTPException(
            status_code=400,
            detail={"error": "unknown_voice", "voice": voice, "hint": "see GET /bard/voices"},
        )
    code = last_code or ("unknown_voice" if voice_rejections else "no_backend_available")
    return SpeakResponse(
        success=False,
        text_length=len(text),
        original_text_length=original_length,
        truncated=original_length > len(text),
        backend=preferred,
        voice_requested=voice,
        error=f"{attempts[-1]['backend'] if attempts else preferred}: {code}",
        error_code=code,
        attempts=attempts,
    )


@router.get("/voices")
async def list_voices() -> Dict[str, Any]:
    cfg = _load_bard_cfg()
    piper_info, vibe_info = await _probe_backends(cfg)
    voices: List[Dict[str, Any]] = [dict(v) for v in piper_info.get("voices", []) if isinstance(v, dict)]

    vibevoice_listed = False
    if vibe_info.get("reachable"):
        try:
            vv = await _vibevoice_voices(cfg)
            for v in vv.get("voices", []) if isinstance(vv, dict) else []:
                if isinstance(v, dict):
                    row = dict(v)
                    row.setdefault("provider", "vibevoice")
                    voices.append(row)
                    vibevoice_listed = True
                elif isinstance(v, str):
                    voices.append({"id": v, "name": v, "provider": "vibevoice"})
                    vibevoice_listed = True
        except Exception:
            vibevoice_listed = False

    return {
        "success": bool(voices),
        "voices": voices,
        "source": "reported_by_reachable_backends",
        "selected_backend": cfg.get("default_backend", "auto"),
        "piper_reachable": bool(piper_info.get("reachable")),
        "vibevoice_reachable": bool(vibe_info.get("reachable")),
        "vibevoice_voices_listed": vibevoice_listed,
        "backends": {
            "piper": {k: v for k, v in piper_info.items() if k != "voices"},
            "vibevoice": vibe_info,
        },
    }
