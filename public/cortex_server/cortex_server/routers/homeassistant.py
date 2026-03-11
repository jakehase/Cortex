"""Home Assistant router for Cortex.

Provides authenticated proxy endpoints to Home Assistant REST API,
voice-pipeline helper endpoints (HA Assist -> Cortex Bard),
and a policy/audit layer for staged autonomy rollouts.
"""

from __future__ import annotations

import base64
import json
import os
import re
import ssl
import time
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from cortex_server.routers.bard import SpeakRequest as BardSpeakRequest
from cortex_server.routers.bard import bard_status as bard_status_endpoint
from cortex_server.routers.bard import text_to_speech as bard_text_to_speech

router = APIRouter(tags=["HomeAssistant"])


# ---------------------------------------------------------------------------
# Paths / defaults
# ---------------------------------------------------------------------------

HA_CFG_PATHS = [Path("/app/config/homeassistant.json"), Path("/root/.openclaw/homeassistant.json")]
POLICY_CFG_PATHS = [Path("/app/config/homeassistant_policy.json"), Path("/root/.openclaw/homeassistant_policy.json")]
VOICE_CFG_PATHS = [Path("/app/config/homeassistant_voice_pipeline.json"), Path("/root/.openclaw/homeassistant_voice_pipeline.json")]

AUDIT_LOG_PATH = Path(os.getenv("HA_AUDIT_LOG_PATH", "/app/config/state/homeassistant_action_audit.jsonl"))
VOICE_MEDIA_DIR = Path(os.getenv("HA_VOICE_MEDIA_DIR", "/app/outputs/voice"))

HA_IDEMP_TTL_SEC = int(os.getenv("HA_IDEMP_TTL_SEC", "120"))
_HA_IDEMP_CACHE: Dict[str, Dict[str, Any]] = {}
_HA_IDEMP_LOCK = Lock()


DEFAULT_POLICY: Dict[str, Any] = {
    "active_profile": "balanced",
    "mode": "autonomous-safe",  # shadow|confirm|autonomous-safe|autonomous-extended
    "kill_switch": False,
    "quiet_hours": {"start": "22:00", "end": "06:30"},
    "profiles": {
        "safe": {
            "mode": "confirm",
            "allow_domains": ["light", "switch", "scene", "script", "input_boolean", "media_player"],
            "confirm_domains": ["lock", "alarm_control_panel", "cover", "vacuum"],
            "blocked_domains": ["update"],
        },
        "balanced": {
            "mode": "autonomous-safe",
            "allow_domains": ["light", "switch", "scene", "script", "input_boolean", "media_player", "fan", "climate"],
            "confirm_domains": ["lock", "alarm_control_panel", "cover", "vacuum", "garage_door"],
            "blocked_domains": ["update"],
        },
        "aggressive": {
            "mode": "autonomous-extended",
            "allow_domains": [
                "light",
                "switch",
                "scene",
                "script",
                "input_boolean",
                "media_player",
                "fan",
                "climate",
                "cover",
            ],
            "confirm_domains": ["lock", "alarm_control_panel", "garage_door"],
            "blocked_domains": ["update"],
        },
    },
    "high_risk_pairs": [
        "lock.unlock",
        "lock.open",
        "alarm_control_panel.alarm_disarm",
        "cover.open_cover",
        "cover.open",
        "cover.set_cover_position",
    ],
    "service_blocklist": [],
    "require_confirm_when_uncertain": True,
}

DEFAULT_VOICE_CFG: Dict[str, Any] = {
    "assist_proxy_endpoint": "/homeassistant/voice/assist_tts",
    "direct_bard_endpoint": "/bard/speak",
    "shadow_default": False,
    "confirm_required_for_ha_writes": True,
    "play_voice_on_media_player": True,
    "default_target_media_player": "media_player.living_room",
    "routing": {
        "lock_target_media_player": True
    },
    "speech": {
        "concise_mode": True,
        "max_sentences": 2,
        "max_chars": 220,
        "append_ellipsis": True
    },
    "esp32": {
        "satellite_entity": "assist_satellite.esp32_s3_box_3_f39bec_assist_satellite",
        "assistant_select_entities": [
            "select.esp32_s3_box_3_f39bec_assistant",
            "select.esp32_s3_box_3_f39bec_assistant_2",
        ],
        "assistant_option": "Gladys",
        "output_audio_externally_switch": "switch.esp32_s3_box_3_output_audio_externally",
        "mute_responses_switch": "switch.esp32_s3_box_3_mute_responses",
        "mic_mute_switch": "switch.esp32_s3_box_3_f39bec_mute",
        "device_media_player": "media_player.esp32_s3_box_3_media_player",
    },
    "sonos": {
        "media_player": "media_player.living_room",
        "duck_automation": "automation.voice_assistant_duck_music_on_wake_word",
        "restore_automation": "automation.voice_assistant_restore_music_after_response",
    },
}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class ServiceCallRequest(BaseModel):
    entity_id: Optional[str] = None
    data: Dict[str, Any] = Field(default_factory=dict)
    shadow: bool = Field(False, description="If true, request is dry-run and no HA write is attempted")
    confirm: bool = Field(False, description="Required for risky actions depending on policy mode")
    idempotency_key: Optional[str] = Field(None, description="Optional idempotency key for dedupe")


class EventFireRequest(BaseModel):
    data: Dict[str, Any] = Field(default_factory=dict)


class HAVoiceRequest(BaseModel):
    text: str = Field(..., description="Text to synthesize for HA Assist")
    backend: Optional[str] = Field(None, description="Optional Bard backend override")
    voice: Optional[str] = Field(None, description="Optional voice id")

    shadow: bool = Field(False, description="If true, do not perform HA write side-effects")
    confirm: bool = Field(False, description="Required for risky HA write actions")

    target_domain: Optional[str] = Field(None, description="Optional HA domain for confirmed post-action")
    target_service: Optional[str] = Field(None, description="Optional HA service for confirmed post-action")
    target_data: Dict[str, Any] = Field(default_factory=dict, description="Optional HA service payload")

    play_on_media_player: Optional[bool] = Field(None, description="If true, play Bard output on media player")
    target_media_player: Optional[str] = Field(None, description="Media player target for outgoing speech")

    mute_esp32_before_play: bool = Field(True, description="Ensure ESP32 response output is muted before external playback")
    idempotency_key: Optional[str] = Field(None, description="Optional idempotency key for dedupe")


class PolicyUpdateRequest(BaseModel):
    active_profile: Optional[str] = None
    mode: Optional[str] = None
    kill_switch: Optional[bool] = None
    quiet_hours: Optional[Dict[str, str]] = None
    profiles: Optional[Dict[str, Any]] = None
    high_risk_pairs: Optional[List[str]] = None
    service_blocklist: Optional[List[str]] = None
    require_confirm_when_uncertain: Optional[bool] = None


class ESP32VoiceActivateRequest(BaseModel):
    sonos_media_player: Optional[str] = None
    assistant_option: Optional[str] = None


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------


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


def _load_json_cfg(paths: List[Path], default: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    for p in paths:
        try:
            if p.exists():
                data = json.loads(p.read_text())
                if isinstance(data, dict):
                    if default is None:
                        return data
                    merged = json.loads(json.dumps(default))
                    merged.update(data)
                    return merged
        except Exception:
            continue
    return json.loads(json.dumps(default or {}))


def _save_json_cfg(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True))


def _load_file_cfg() -> Dict[str, Any]:
    return _load_json_cfg(HA_CFG_PATHS, {})


def _ha_cfg() -> Dict[str, Any]:
    file_cfg = _load_file_cfg()

    url = (
        os.getenv("HOME_ASSISTANT_URL")
        or os.getenv("HASS_URL")
        or file_cfg.get("url")
        or file_cfg.get("base_url")
        or ""
    )
    token = (
        os.getenv("HOME_ASSISTANT_TOKEN")
        or os.getenv("HASS_TOKEN")
        or file_cfg.get("token")
        or file_cfg.get("access_token")
        or ""
    )
    verify_ssl = _parse_bool(
        os.getenv("HOME_ASSISTANT_VERIFY_SSL", os.getenv("HASS_VERIFY_SSL", file_cfg.get("verify_ssl", True))),
        default=True,
    )

    return {
        "url": str(url).rstrip("/"),
        "token": str(token).strip(),
        "verify_ssl": verify_ssl,
        "configured": bool(url and token),
    }


def _load_policy_cfg() -> Dict[str, Any]:
    cfg = _load_json_cfg(POLICY_CFG_PATHS, DEFAULT_POLICY)
    active_profile = cfg.get("active_profile", "balanced")
    profile = (cfg.get("profiles", {}) or {}).get(active_profile, {})

    # profile mode can override if mode absent
    if not cfg.get("mode"):
        cfg["mode"] = profile.get("mode", "confirm")
    return cfg


def _save_policy_cfg(cfg: Dict[str, Any]) -> None:
    _save_json_cfg(POLICY_CFG_PATHS[0], cfg)


def _load_voice_cfg() -> Dict[str, Any]:
    return _load_json_cfg(VOICE_CFG_PATHS, DEFAULT_VOICE_CFG)


def _public_base_url() -> str:
    return os.getenv("CORTEX_PUBLIC_BASE_URL", "http://10.0.0.52:8888").rstrip("/")


def _voice_target_media_player(req_target: Optional[str], voice_cfg: Dict[str, Any]) -> Optional[str]:
    routing = (voice_cfg.get("routing") or {}) if isinstance(voice_cfg, dict) else {}
    default_target = voice_cfg.get("default_target_media_player") if isinstance(voice_cfg, dict) else None
    lock_target = _parse_bool(routing.get("lock_target_media_player", True), default=True)
    if lock_target and default_target:
        return str(default_target)
    return req_target or default_target


def _voice_shorten_text(text: str, voice_cfg: Dict[str, Any]) -> Dict[str, Any]:
    speech = (voice_cfg.get("speech") or {}) if isinstance(voice_cfg, dict) else {}
    concise_mode = _parse_bool(speech.get("concise_mode", True), default=True)

    raw = " ".join((text or "").strip().split())
    if not concise_mode:
        return {
            "text": raw,
            "trimmed": False,
            "concise_mode": False,
            "original_chars": len(raw),
            "final_chars": len(raw),
        }

    try:
        max_sentences = max(1, int(speech.get("max_sentences", 2)))
    except Exception:
        max_sentences = 2
    try:
        max_chars = max(40, int(speech.get("max_chars", 220)))
    except Exception:
        max_chars = 220
    append_ellipsis = _parse_bool(speech.get("append_ellipsis", True), default=True)

    sentence_parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", raw) if p and p.strip()]
    sentence_trimmed = False
    if sentence_parts:
        text_out = " ".join(sentence_parts[:max_sentences]).strip()
        sentence_trimmed = len(sentence_parts) > max_sentences
    else:
        text_out = raw

    char_trimmed = False
    if len(text_out) > max_chars:
        text_out = text_out[:max_chars].rstrip(" ,;:-")
        char_trimmed = True

    if (sentence_trimmed or char_trimmed) and append_ellipsis and text_out and not text_out.endswith((".", "!", "?", "…")):
        text_out = f"{text_out}…"

    return {
        "text": text_out,
        "trimmed": bool(text_out != raw),
        "concise_mode": True,
        "max_sentences": max_sentences,
        "max_chars": max_chars,
        "original_chars": len(raw),
        "final_chars": len(text_out),
    }


# ---------------------------------------------------------------------------
# Policy / risk helpers
# ---------------------------------------------------------------------------


def _service_pair(domain: str, service: str) -> str:
    return f"{domain}.{service}".lower()


def _profile_sets(policy: Dict[str, Any]) -> Dict[str, set]:
    profiles = policy.get("profiles", {}) or {}
    p = profiles.get(policy.get("active_profile", "balanced"), {})
    return {
        "allow": set((p.get("allow_domains") or [])),
        "confirm": set((p.get("confirm_domains") or [])),
        "blocked": set((p.get("blocked_domains") or [])),
    }


def _classify_action(
    *,
    domain: str,
    service: str,
    shadow: bool,
    confirm: bool,
    policy: Dict[str, Any],
) -> Dict[str, Any]:
    mode = str(policy.get("mode", "confirm") or "confirm").lower()
    pair = _service_pair(domain, service)

    sets = _profile_sets(policy)
    blocked_pairs = {x.lower() for x in (policy.get("service_blocklist") or [])}
    high_risk_pairs = {x.lower() for x in (policy.get("high_risk_pairs") or [])}

    if policy.get("kill_switch"):
        return {"allow": False, "reason": "kill_switch_enabled", "risk": "blocked", "mode": mode, "pair": pair}

    if shadow:
        return {"allow": False, "reason": "shadow_mode", "risk": "shadow", "mode": mode, "pair": pair}

    if domain in sets["blocked"] or pair in blocked_pairs:
        return {"allow": False, "reason": "blocked_by_policy", "risk": "blocked", "mode": mode, "pair": pair}

    unknown_domain = domain not in sets["allow"] and domain not in sets["confirm"]
    if unknown_domain and policy.get("require_confirm_when_uncertain", True) and not confirm:
        return {
            "allow": False,
            "reason": "unknown_domain_requires_confirm",
            "risk": "uncertain",
            "mode": mode,
            "pair": pair,
        }

    risk = "low"
    if domain in sets["confirm"] or pair in high_risk_pairs:
        risk = "high"
    elif unknown_domain:
        risk = "medium"

    if mode == "shadow":
        return {"allow": False, "reason": "mode_shadow", "risk": risk, "mode": mode, "pair": pair}

    if mode == "confirm" and not confirm:
        return {"allow": False, "reason": "mode_confirm_requires_confirmation", "risk": risk, "mode": mode, "pair": pair}

    if mode == "autonomous-safe" and risk in {"high", "medium"} and not confirm:
        return {"allow": False, "reason": "autonomous_safe_requires_confirm_for_non_low_risk", "risk": risk, "mode": mode, "pair": pair}

    if risk == "high" and not confirm:
        return {"allow": False, "reason": "high_risk_requires_confirm", "risk": risk, "mode": mode, "pair": pair}

    return {"allow": True, "reason": "allowed", "risk": risk, "mode": mode, "pair": pair}


# ---------------------------------------------------------------------------
# Audit + idempotency
# ---------------------------------------------------------------------------


def _append_audit(event: Dict[str, Any]) -> None:
    try:
        AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with AUDIT_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _read_audit_tail(limit: int = 50) -> List[Dict[str, Any]]:
    if limit < 1:
        return []
    if not AUDIT_LOG_PATH.exists():
        return []

    lines = AUDIT_LOG_PATH.read_text(encoding="utf-8", errors="ignore").splitlines()
    out: List[Dict[str, Any]] = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def _idemp_get(key: Optional[str]) -> Optional[Dict[str, Any]]:
    if not key:
        return None
    now = time.time()
    with _HA_IDEMP_LOCK:
        stale = [k for k, v in _HA_IDEMP_CACHE.items() if (now - float(v.get("ts", 0))) > HA_IDEMP_TTL_SEC]
        for k in stale:
            _HA_IDEMP_CACHE.pop(k, None)
        item = _HA_IDEMP_CACHE.get(key)
        if not item:
            return None
        return item.get("result")


def _idemp_put(key: Optional[str], result: Dict[str, Any]) -> None:
    if not key:
        return
    with _HA_IDEMP_LOCK:
        _HA_IDEMP_CACHE[key] = {"ts": time.time(), "result": result}


# ---------------------------------------------------------------------------
# HA HTTP core
# ---------------------------------------------------------------------------


def _ha_request(
    method: str,
    path: str,
    query: Optional[Dict[str, Any]] = None,
    body: Optional[Dict[str, Any]] = None,
    timeout: int = 8,
    retries: int = 1,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    cfg = _ha_cfg()
    if not cfg["configured"]:
        return {
            "success": False,
            "configured": False,
            "error": "Home Assistant not configured. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN (or /app/config/homeassistant.json).",
        }

    url = cfg["url"] + path
    if query:
        q = {k: v for k, v in query.items() if v is not None}
        if q:
            url += "?" + urlencode(q)

    payload = None
    headers = {
        "Authorization": f"Bearer {cfg['token']}",
        "Content-Type": "application/json",
    }
    if idempotency_key:
        headers["X-Idempotency-Key"] = idempotency_key
    if body is not None:
        payload = json.dumps(body).encode("utf-8")

    ctx = None
    if not cfg["verify_ssl"]:
        ctx = ssl._create_unverified_context()

    attempts = max(1, retries + 1)
    last_err: Optional[Dict[str, Any]] = None

    for attempt in range(attempts):
        req = Request(url=url, method=method.upper(), data=payload, headers=headers)
        try:
            with urlopen(req, timeout=timeout, context=ctx) as r:
                raw = r.read().decode("utf-8", errors="replace")
                ct = r.headers.get("Content-Type", "")
                data: Any = raw
                if "application/json" in ct:
                    try:
                        data = json.loads(raw)
                    except Exception:
                        data = {"raw": raw}
                return {
                    "success": True,
                    "configured": True,
                    "status": int(r.status),
                    "data": data,
                }
        except HTTPError as e:
            txt = ""
            try:
                txt = e.read().decode("utf-8", errors="replace")
            except Exception:
                txt = str(e)
            code = int(getattr(e, "code", 0) or 0)
            last_err = {
                "success": False,
                "configured": True,
                "status": code,
                "error": txt[:600],
            }
            # retry transient errors
            if code in {408, 429, 500, 502, 503, 504} and attempt < attempts - 1:
                time.sleep(0.25 * (attempt + 1))
                continue
            return last_err
        except URLError as e:
            last_err = {
                "success": False,
                "configured": True,
                "status": 0,
                "error": f"connection failed: {e}",
            }
            if attempt < attempts - 1:
                time.sleep(0.25 * (attempt + 1))
                continue
            return last_err
        except Exception as e:
            last_err = {
                "success": False,
                "configured": True,
                "status": 0,
                "error": str(e),
            }
            if attempt < attempts - 1:
                time.sleep(0.25 * (attempt + 1))
                continue
            return last_err

    return last_err or {"success": False, "configured": True, "status": 0, "error": "unknown request failure"}


# ---------------------------------------------------------------------------
# Basic HA endpoints
# ---------------------------------------------------------------------------


@router.get("/status")
async def ha_status() -> Dict[str, Any]:
    cfg = _ha_cfg()
    if not cfg["configured"]:
        return {"success": False, "configured": False, "state": "not_configured"}
    probe = _ha_request("GET", "/api/")
    probe["configured"] = True
    probe.setdefault("state", "configured")
    return probe


@router.get("/states")
async def ha_states(entity_id: Optional[str] = None) -> Dict[str, Any]:
    if entity_id:
        return _ha_request("GET", f"/api/states/{entity_id}")
    return _ha_request("GET", "/api/states")


@router.get("/states/{entity_id}")
async def ha_state(entity_id: str) -> Dict[str, Any]:
    return _ha_request("GET", f"/api/states/{entity_id}")


@router.get("/services")
async def ha_services() -> Dict[str, Any]:
    return _ha_request("GET", "/api/services")


@router.post("/services/{domain}/{service}")
async def ha_call_service(domain: str, service: str, req: ServiceCallRequest) -> Dict[str, Any]:
    body = dict(req.data or {})
    if req.entity_id and "entity_id" not in body:
        body["entity_id"] = req.entity_id

    policy = _load_policy_cfg()
    decision = _classify_action(domain=domain, service=service, shadow=req.shadow, confirm=req.confirm, policy=policy)

    if not decision["allow"]:
        result = {
            "success": False,
            "blocked": True,
            "policy": decision,
            "domain": domain,
            "service": service,
        }
        _append_audit(
            {
                "ts": datetime.utcnow().isoformat() + "Z",
                "kind": "service_call_blocked",
                "domain": domain,
                "service": service,
                "decision": decision,
            }
        )
        return result

    cached = _idemp_get(req.idempotency_key)
    if cached is not None:
        return {"success": True, "idempotent_replay": True, "result": cached, "policy": decision}

    call = _ha_request(
        "POST",
        f"/api/services/{domain}/{service}",
        body=body,
        retries=2,
        timeout=12,
        idempotency_key=req.idempotency_key,
    )
    _idemp_put(req.idempotency_key, call)

    _append_audit(
        {
            "ts": datetime.utcnow().isoformat() + "Z",
            "kind": "service_call",
            "domain": domain,
            "service": service,
            "decision": decision,
            "success": bool(call.get("success")),
            "status": call.get("status"),
        }
    )

    return {"success": bool(call.get("success")), "result": call, "policy": decision}


@router.post("/events/{event_type}")
async def ha_fire_event(event_type: str, req: EventFireRequest) -> Dict[str, Any]:
    return _ha_request("POST", f"/api/events/{event_type}", body=req.data or {}, retries=1)


# ---------------------------------------------------------------------------
# Policy + context + audit endpoints
# ---------------------------------------------------------------------------


@router.get("/policy")
async def ha_policy_get() -> Dict[str, Any]:
    return {"success": True, "policy": _load_policy_cfg()}


@router.post("/policy")
async def ha_policy_update(req: PolicyUpdateRequest) -> Dict[str, Any]:
    cfg = _load_policy_cfg()
    patch = req.dict(exclude_none=True)
    cfg.update(patch)
    _save_policy_cfg(cfg)
    return {"success": True, "policy": cfg}


@router.post("/policy/mode/{mode}")
async def ha_policy_set_mode(mode: str) -> Dict[str, Any]:
    m = mode.strip().lower()
    if m not in {"shadow", "confirm", "autonomous-safe", "autonomous-extended"}:
        raise HTTPException(status_code=400, detail="mode must be one of: shadow, confirm, autonomous-safe, autonomous-extended")
    cfg = _load_policy_cfg()
    cfg["mode"] = m
    _save_policy_cfg(cfg)
    return {"success": True, "policy": cfg}


@router.post("/policy/profile/{profile}")
async def ha_policy_set_profile(profile: str) -> Dict[str, Any]:
    p = profile.strip().lower()
    cfg = _load_policy_cfg()
    if p not in (cfg.get("profiles") or {}):
        raise HTTPException(status_code=400, detail=f"unknown profile: {p}")
    cfg["active_profile"] = p
    # respect profile mode on switch
    profile_mode = ((cfg.get("profiles") or {}).get(p) or {}).get("mode")
    if profile_mode:
        cfg["mode"] = profile_mode
    _save_policy_cfg(cfg)
    return {"success": True, "policy": cfg}


@router.post("/policy/kill_switch/{enabled}")
async def ha_policy_kill_switch(enabled: bool) -> Dict[str, Any]:
    cfg = _load_policy_cfg()
    cfg["kill_switch"] = bool(enabled)
    _save_policy_cfg(cfg)
    return {"success": True, "policy": cfg}


@router.get("/audit/recent")
async def ha_audit_recent(limit: int = Query(default=25, ge=1, le=500)) -> Dict[str, Any]:
    return {"success": True, "events": _read_audit_tail(limit)}


@router.get("/context/snapshot")
async def ha_context_snapshot() -> Dict[str, Any]:
    states_resp = _ha_request("GET", "/api/states", timeout=12)
    if not states_resp.get("success"):
        return {"success": False, "error": states_resp.get("error"), "status": states_resp.get("status")}

    states = states_resp.get("data")
    if not isinstance(states, list):
        return {"success": False, "error": "invalid states payload"}

    persons_home = []
    lights_on = 0
    media_playing = []
    locks_unlocked = []

    for item in states:
        if not isinstance(item, dict):
            continue
        eid = str(item.get("entity_id", ""))
        st = str(item.get("state", ""))

        if eid.startswith("person.") and st == "home":
            persons_home.append(eid)
        if eid.startswith("light.") and st == "on":
            lights_on += 1
        if eid.startswith("media_player.") and st in {"playing", "buffering"}:
            media_playing.append(eid)
        if eid.startswith("lock.") and st in {"unlocked", "open"}:
            locks_unlocked.append(eid)

    risk_state = "normal"
    if locks_unlocked:
        risk_state = "elevated"

    now = datetime.now()
    return {
        "success": True,
        "snapshot": {
            "generated_at": now.isoformat(),
            "presence": {"home_count": len(persons_home), "entities": persons_home[:20]},
            "environment": {"lights_on": lights_on, "media_playing": media_playing[:20]},
            "security": {"locks_unlocked": locks_unlocked[:20], "risk_state": risk_state},
            "mode": _load_policy_cfg().get("mode"),
        },
    }


# ---------------------------------------------------------------------------
# Voice pipeline endpoints
# ---------------------------------------------------------------------------


def _write_voice_artifact(audio_base64: str) -> Dict[str, str]:
    VOICE_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    filename = f"assist_{ts}.wav"
    fpath = VOICE_MEDIA_DIR / filename
    raw = base64.b64decode(audio_base64.encode("ascii"), validate=False)
    fpath.write_bytes(raw)
    media_url = f"{_public_base_url()}/homeassistant/voice/media/{filename}"
    return {"filename": filename, "path": str(fpath), "media_url": media_url}


@router.get("/voice/media/{name}")
async def ha_voice_media(name: str):
    safe_name = os.path.basename(name)
    path = (VOICE_MEDIA_DIR / safe_name).resolve()
    if not str(path).startswith(str(VOICE_MEDIA_DIR.resolve())):
        raise HTTPException(status_code=400, detail="invalid media path")
    if not path.exists():
        raise HTTPException(status_code=404, detail="media not found")
    return FileResponse(str(path), media_type="audio/wav", filename=safe_name)


@router.get("/voice/config")
async def ha_voice_config() -> Dict[str, Any]:
    public_base = _public_base_url()
    proxy_url = f"{public_base}/homeassistant/voice/assist_tts"
    direct_url = f"{public_base}/bard/speak"
    voice_cfg = _load_voice_cfg()
    policy = _load_policy_cfg()

    yaml_hint = f"""rest_command:
  cortex_assist_tts:
    url: {proxy_url}
    method: POST
    content_type: application/json
    payload: >
      {{\"text\": \"{{{{ text }}}}\", \"shadow\": false, \"play_on_media_player\": true}}
"""

    return {
        "success": True,
        "policy_mode": policy.get("mode"),
        "active_profile": policy.get("active_profile"),
        "endpoints": {
            "assist_proxy": "/homeassistant/voice/assist_tts",
            "direct_bard": "/bard/speak",
            "assist_proxy_url": proxy_url,
            "direct_bard_url": direct_url,
        },
        "voice_config": voice_cfg,
        "home_assistant_yaml_hint": yaml_hint,
        "notes": [
            "Full rollout active: autonomy policy + audit + media playback path enabled.",
            "For risky writes, confirmation is still enforced by policy.",
        ],
    }


@router.get("/voice/pipeline_status")
async def ha_voice_pipeline_status() -> Dict[str, Any]:
    ha = await ha_status()
    bard = await bard_status_endpoint()
    bard_data = (bard or {}).get("data", {}) if isinstance(bard, dict) else {}
    policy = _load_policy_cfg()

    return {
        "success": True,
        "ha": {
            "configured": bool(ha.get("configured")),
            "reachable": bool(ha.get("success")),
            "state": ha.get("state", "unknown"),
        },
        "bard": {
            "status": bard_data.get("status"),
            "selected_backend": bard_data.get("selected_backend"),
            "effective_backend": bard_data.get("effective_backend"),
            "backends": bard_data.get("backends", {}),
        },
        "policy": {
            "mode": policy.get("mode"),
            "active_profile": policy.get("active_profile"),
            "kill_switch": policy.get("kill_switch"),
        },
    }


@router.post("/voice/activate_esp32")
async def ha_voice_activate_esp32(req: ESP32VoiceActivateRequest) -> Dict[str, Any]:
    """Activate ESP32 mic path and route output to Sonos-preferred external playback settings."""
    voice_cfg = _load_voice_cfg()
    esp = (voice_cfg.get("esp32") or {})
    sonos_cfg = (voice_cfg.get("sonos") or {})

    assistant_option = req.assistant_option or esp.get("assistant_option", "Gladys")
    sonos_entity = req.sonos_media_player or sonos_cfg.get("media_player") or voice_cfg.get("default_target_media_player")

    results: Dict[str, Any] = {}

    # ESP32 mic active (mute switch OFF), external audio ON, local responses muted ON.
    results["mic_unmute"] = _ha_request(
        "POST",
        "/api/services/switch/turn_off",
        body={"entity_id": esp.get("mic_mute_switch")},
        retries=1,
    )
    results["external_audio_on"] = _ha_request(
        "POST",
        "/api/services/switch/turn_on",
        body={"entity_id": esp.get("output_audio_externally_switch")},
        retries=1,
    )
    results["mute_local_responses"] = _ha_request(
        "POST",
        "/api/services/switch/turn_on",
        body={"entity_id": esp.get("mute_responses_switch")},
        retries=1,
    )

    # Force ESP32 player muted to avoid overlap.
    device_mp = esp.get("device_media_player")
    if device_mp:
        results["esp32_media_mute"] = _ha_request(
            "POST",
            "/api/services/media_player/volume_mute",
            body={"entity_id": device_mp, "is_volume_muted": True},
            retries=1,
        )
        results["esp32_media_volume_zero"] = _ha_request(
            "POST",
            "/api/services/media_player/volume_set",
            body={"entity_id": device_mp, "volume_level": 0.0},
            retries=1,
        )

    # Select assistant pipeline option on ESP32 selectors.
    for i, sel in enumerate(esp.get("assistant_select_entities") or []):
        results[f"assistant_select_{i+1}"] = _ha_request(
            "POST",
            "/api/services/select/select_option",
            body={"entity_id": sel, "option": assistant_option},
            retries=1,
        )

    # Prepare Sonos output target (unmute + reasonable volume)
    if sonos_entity:
        results["sonos_unmute"] = _ha_request(
            "POST",
            "/api/services/media_player/volume_mute",
            body={"entity_id": sonos_entity, "is_volume_muted": False},
            retries=1,
        )

    _append_audit(
        {
            "ts": datetime.utcnow().isoformat() + "Z",
            "kind": "esp32_voice_activation",
            "assistant_option": assistant_option,
            "sonos_entity": sonos_entity,
            "results_ok": {k: bool((v or {}).get("success")) for k, v in results.items()},
        }
    )

    return {
        "success": True,
        "assistant_option": assistant_option,
        "sonos_media_player": sonos_entity,
        "results": results,
    }


@router.post("/voice/assist_tts")
async def ha_assist_tts(req: HAVoiceRequest) -> Dict[str, Any]:
    """HA Assist-compatible proxy to Bard TTS with policy gates, audit, and optional Sonos playback."""
    if not req.text.strip():
        return {"success": False, "error": "text is required"}

    voice_cfg = _load_voice_cfg()
    policy = _load_policy_cfg()

    play_on_media_player = (
        req.play_on_media_player
        if req.play_on_media_player is not None
        else bool(voice_cfg.get("play_voice_on_media_player", False))
    )
    target_media_player = _voice_target_media_player(req.target_media_player, voice_cfg)
    speech_plan = _voice_shorten_text(req.text, voice_cfg)
    speech_text = speech_plan.get("text") or req.text

    bard_resp = await bard_text_to_speech(
        BardSpeakRequest(
            text=speech_text,
            voice=req.voice,
            backend=req.backend,
            allow_fallback=True,
        )
    )

    out: Dict[str, Any] = {
        "success": bool(getattr(bard_resp, "success", False)),
        "shadow": req.shadow,
        "confirmed": req.confirm,
        "speech_plan": {
            "concise_mode": speech_plan.get("concise_mode"),
            "trimmed": speech_plan.get("trimmed"),
            "original_chars": speech_plan.get("original_chars"),
            "final_chars": speech_plan.get("final_chars"),
            "max_sentences": speech_plan.get("max_sentences"),
            "max_chars": speech_plan.get("max_chars"),
        },
        "target_media_player": target_media_player,
        "bard": {
            "backend": getattr(bard_resp, "backend", None),
            "format": getattr(bard_resp, "format", None),
            "sample_rate": getattr(bard_resp, "sample_rate", None),
            "channels": getattr(bard_resp, "channels", None),
            "duration_seconds": getattr(bard_resp, "duration_seconds", None),
            "error": getattr(bard_resp, "error", None),
            "audio_base64": getattr(bard_resp, "audio_base64", None),
        },
    }

    if not out["success"]:
        _append_audit(
            {
                "ts": datetime.utcnow().isoformat() + "Z",
                "kind": "voice_tts_failed",
                "backend": out["bard"].get("backend"),
                "error": out["bard"].get("error"),
            }
        )
        return out

    # Optional external playback on media player (e.g., Sonos)
    media_artifact: Optional[Dict[str, str]] = None
    if play_on_media_player and target_media_player:
        decision = _classify_action(
            domain="media_player",
            service="play_media",
            shadow=req.shadow,
            confirm=req.confirm,
            policy=policy,
        )
        out["media_policy"] = decision

        if decision["allow"]:
            # Ensure ESP32 local output remains muted to avoid overlap.
            if req.mute_esp32_before_play:
                esp = (voice_cfg.get("esp32") or {})
                mute_switch = esp.get("mute_responses_switch")
                if mute_switch:
                    out["esp32_mute_responses"] = _ha_request(
                        "POST",
                        "/api/services/switch/turn_on",
                        body={"entity_id": mute_switch},
                        retries=1,
                    )

            media_artifact = _write_voice_artifact(out["bard"]["audio_base64"])
            play_payload = {
                "entity_id": target_media_player,
                "media_content_id": media_artifact["media_url"],
                "media_content_type": "music",
                "announce": True,
            }
            out["media_play"] = _ha_request(
                "POST",
                "/api/services/media_player/play_media",
                body=play_payload,
                retries=2,
                timeout=15,
                idempotency_key=req.idempotency_key,
            )
            out["media_artifact"] = {
                "filename": media_artifact["filename"],
                "media_url": media_artifact["media_url"],
            }
        else:
            out["media_play"] = {"success": False, "blocked": True, "reason": decision.get("reason")}

    # Optional post-action service write, policy-gated.
    if req.target_domain and req.target_service:
        decision = _classify_action(
            domain=req.target_domain,
            service=req.target_service,
            shadow=req.shadow,
            confirm=req.confirm,
            policy=policy,
        )
        out["ha_write_policy"] = decision
        if decision["allow"]:
            out["ha_write"] = {
                "attempted": True,
                "domain": req.target_domain,
                "service": req.target_service,
                "result": _ha_request(
                    "POST",
                    f"/api/services/{req.target_domain}/{req.target_service}",
                    body=req.target_data or {},
                    retries=2,
                    timeout=12,
                    idempotency_key=req.idempotency_key,
                ),
            }
        else:
            out["ha_write"] = {
                "attempted": False,
                "blocked": True,
                "reason": decision.get("reason"),
            }
    else:
        out["ha_write"] = {
            "attempted": False,
            "reason": "no target_domain/target_service provided",
        }

    _append_audit(
        {
            "ts": datetime.utcnow().isoformat() + "Z",
            "kind": "voice_assist_tts",
            "success": bool(out.get("success")),
            "backend": out.get("bard", {}).get("backend"),
            "target_media_player": target_media_player,
            "played": bool((out.get("media_play") or {}).get("success")),
            "ha_write_attempted": bool((out.get("ha_write") or {}).get("attempted")),
            "ha_write_blocked": bool((out.get("ha_write") or {}).get("blocked")),
        }
    )

    return out
