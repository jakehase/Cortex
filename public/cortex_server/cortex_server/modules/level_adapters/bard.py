"""L6 Bard adapter: measured text-to-speech availability.

Synthesis produces audio that must be delivered by the channel (OpenClaw), so
the pre-answer adapter does not synthesise; it reports which TTS backends
completed a protocol handshake and which voices they actually reported, so the
assistant never promises a voice note or a voice that does not exist.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 6
NAME = "bard"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 12.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.routers import bard

    try:
        cfg = bard._load_bard_cfg()
        piper_info, vibe_info = await bard._probe_backends(cfg)
    except Exception as exc:
        raise ExecutionBlocked("bard_probe_failed") from exc

    voices = [v["id"] for v in piper_info.get("voices", []) if isinstance(v, dict)]
    piper_ok = bool(piper_info.get("reachable"))
    vibe_ok = bool(vibe_info.get("reachable"))
    if piper_ok or vibe_ok:
        available = [name for name, ok in (("piper", piper_ok), ("vibevoice", vibe_ok)) if ok]
        summary = (
            f"Text-to-speech is available via {', '.join(available)}. "
            f"Piper voices reported: {', '.join(voices[:10]) or 'none reported'}. "
            "Audio is synthesised by POST /bard/speak (admin/write authorised); this adapter did not synthesise audio."
        )
    else:
        summary = (
            "Text-to-speech is currently unavailable: no TTS backend completed a handshake "
            f"(piper={piper_info.get('error_code') or piper_info.get('reason') or 'unreachable'}, "
            f"vibevoice={vibe_info.get('error_code') or vibe_info.get('reason') or 'unreachable'}). "
            "Do not promise a voice note."
        )
    return {
        "operation": "bard.availability",
        "origin": "deterministic",
        "summary": summary[:1500],
        "data": {
            "piper": {"reachable": piper_ok, "voices": voices[:20], "error_code": piper_info.get("error_code")},
            "vibevoice": {"reachable": vibe_ok, "error_code": vibe_info.get("error_code"), "enabled": vibe_info.get("enabled")},
            "default_backend": cfg.get("default_backend"),
        },
    }
