"""
HUD Middleware - Automated Level Activation Display

Automatically appends activation/contract metadata to successful JSON responses.
Never injects metadata into non-success responses (4xx/5xx).
"""
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse
from typing import Dict, List, Any, Optional
from collections import deque
from datetime import datetime
import time
import json
import os
import hashlib
import re
import pathlib

# Track activated levels per request
_request_levels: Dict[str, List[Dict[str, Any]]] = {}
_recent_activations: deque = deque(maxlen=50000)
_recent_traces: deque = deque(maxlen=20000)

# Minimal route-to-level map used only when a router doesn't explicitly track levels.
_ROUTE_LEVEL_HINTS: Dict[str, Dict[str, Any]] = {
    "nexus": {"level": 24, "name": "nexus"},
    "conductor": {"level": 36, "name": "conductor"},
    "orchestrator": {"level": 36, "name": "conductor"},
    "oracle": {"level": 5, "name": "oracle"},
    "librarian": {"level": 7, "name": "librarian"},
    "knowledge": {"level": 22, "name": "mnemosyne"},
    "l22": {"level": 22, "name": "mnemosyne"},
    "muse": {"level": 29, "name": "muse"},
    "dreamer": {"level": 13, "name": "dreamer"},
    "synthesist": {"level": 32, "name": "synthesist"},
    "architect": {"level": 9, "name": "architect"},
    "meta_conductor": {"level": 36, "name": "conductor"},
    "council": {"level": 15, "name": "council"},
    "hud_display": {"level": 36, "name": "conductor"},
    "autonomy": {"level": 36, "name": "conductor"},
}

CONTRACT_IDENTITY_PHRASE = "Cortex-first orchestration active"
RESPONSE_SHAPE_VERSION = "cortex.v1"

LEVEL_USAGE_EVENTS_ENABLED = os.getenv("CORTEX_LEVEL_USAGE_EVENTS_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
LEVEL_USAGE_EVENTS_PATH = pathlib.Path(
    os.getenv("CORTEX_LEVEL_USAGE_EVENTS_PATH", "/app/cortex_server/consciousness_core/level_usage_events.jsonl")
)

# Hard send-time gate (fail-closed): block non-control textual replies if
# this turn lacks activation metadata.
SEND_TIME_GATE_HARD = os.getenv("CORTEX_SEND_TIME_GATE_HARD", "true").lower() in {"1", "true", "yes", "on"}
SEND_TIME_GATE_REQUIRE_EXPLICIT = os.getenv("CORTEX_SEND_TIME_GATE_REQUIRE_EXPLICIT", "true").lower() in {"1", "true", "yes", "on"}
SEND_TIME_GATE_CONTROL_TOKENS = {"NO_REPLY", "HEARTBEAT_OK"}
ENHANCEMENT_GATE_HARD = os.getenv("CORTEX_ENHANCEMENT_GATE_HARD", "true").lower() in {"1", "true", "yes", "on"}
ENHANCEMENT_GATE_INJECT_MISSING = os.getenv("CORTEX_ENHANCEMENT_GATE_INJECT_MISSING", "true").lower() in {"1", "true", "yes", "on"}
EVERYDAY_FORMAT_HARD = os.getenv("CORTEX_EVERYDAY_FORMAT_HARD", "true").lower() in {"1", "true", "yes", "on"}
EVERYDAY_FORMAT_INJECT_MISSING = os.getenv("CORTEX_EVERYDAY_FORMAT_INJECT_MISSING", "true").lower() in {"1", "true", "yes", "on"}
ENHANCEMENT_PREFLIGHT_QUESTION = "Would there be any levels that would enhance this?"
ENHANCEMENT_MODE_REGEX = re.compile(r"(^|\n)\s*Enhancement pass:\s*(ON|OFF)\b", re.IGNORECASE)
CONFIDENCE_REGEX = re.compile(r"(^|\n)\s*Confidence:\s*(High|Medium|Low)\b", re.IGNORECASE)
UNCERTAINTY_REGEX = re.compile(r"(^|\n)\s*Main uncertainty:\s*.+", re.IGNORECASE)
PRIORITY_REGEX = re.compile(r"(^|\n)\s*Priority:\s*.+", re.IGNORECASE)
NEXT_STEP_REGEX = re.compile(r"(^|\n)\s*Next validation step:\s*.+", re.IGNORECASE)
RESPONSE_TEXT_KEYS = ("response", "text", "answer", "message")
ENHANCEMENT_GATE_PATH_PREFIXES = (
    "/oracle/chat",
    "/nexus/orchestrate",
    "/meta_conductor/orchestrate",
    "/augmenter/chat",
    "/council/review",
    "/mediator/mediate",
    "/synthesist_api/synthesize",
    "/ethicist/evaluate",
    "/singularity/analyze",
    "/singularity/improve",
)


def _enhancement_gate_applies(path: str, text_ref: Optional[Dict[str, Any]]) -> bool:
    p = (path or "").lower()
    if not any(p.startswith(prefix) for prefix in ENHANCEMENT_GATE_PATH_PREFIXES):
        return False
    if not text_ref:
        return False
    return bool(text_ref.get("text"))


def _extract_top_level_text(body: Dict[str, Any]) -> tuple[Optional[str], str]:
    for key in RESPONSE_TEXT_KEYS:
        value = body.get(key)
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed:
                return key, trimmed
    return None, ""


def _estimate_confidence(text: str) -> tuple[str, str, str]:
    lower = (text or "").lower()
    score = 0.72

    if any(w in lower for w in ("maybe", "might", "context-dependent", "uncertain", "not sure", "verify")):
        score -= 0.18
    if any(w in lower for w in ("confirmed", "verified", "200 ok", "pass", "implemented", "completed")):
        score += 0.1

    score = max(0.1, min(0.95, score))

    if score >= 0.8:
        band = "High"
        uncertainty = "Operational conditions can still change after deployment."
        next_step = "Monitor one full cycle to confirm behavior stays stable."
    elif score >= 0.6:
        band = "Medium"
        uncertainty = "Some details still depend on runtime conditions and recent state."
        next_step = "Run one targeted verification check against live endpoints."
    else:
        band = "Low"
        uncertainty = "Current evidence is incomplete and could shift with new data."
        next_step = "Collect an additional direct check before relying on this result."

    return band, uncertainty, next_step


def _has_everyday_format(text: str) -> bool:
    if not isinstance(text, str) or not text.strip():
        return False
    return bool(CONFIDENCE_REGEX.search(text) and UNCERTAINTY_REGEX.search(text) and PRIORITY_REGEX.search(text))


def _inject_everyday_format(text: str) -> tuple[str, bool, str]:
    if not isinstance(text, str):
        return text, False, ""
    if _has_everyday_format(text):
        return text, False, ""

    band, uncertainty, next_step = _estimate_confidence(text)
    additions = []
    if not CONFIDENCE_REGEX.search(text):
        additions.append(f"Confidence: {band}")
    if not UNCERTAINTY_REGEX.search(text):
        additions.append(f"Main uncertainty: {uncertainty}")
    if not PRIORITY_REGEX.search(text):
        additions.append("Priority: urgent & high-impact first, then high-impact non-urgent, then routine.")
    if band != "High" and not NEXT_STEP_REGEX.search(text):
        additions.append(f"Next validation step: {next_step}")

    if not additions:
        return text, False, band

    merged = (text.rstrip() + "\n\n" + "\n".join(additions)).strip()
    return merged, True, band


def _everyday_format_applies(path: str, text_ref: Optional[Dict[str, Any]]) -> bool:
    p = (path or "").lower()
    if not any(p.startswith(prefix) for prefix in ENHANCEMENT_GATE_PATH_PREFIXES):
        return False
    if not text_ref:
        return False
    txt = text_ref.get("text")
    return isinstance(txt, str) and bool(txt.strip())


def _find_primary_text_ref(node: Any, path: str = "$") -> Optional[Dict[str, Any]]:
    if isinstance(node, dict):
        for key in RESPONSE_TEXT_KEYS:
            value = node.get(key)
            if isinstance(value, str):
                trimmed = value.strip()
                if trimmed:
                    node[key] = trimmed
                    return {
                        "container": node,
                        "key": key,
                        "path": f"{path}.{key}",
                        "text": trimmed,
                    }
        for key, value in node.items():
            found = _find_primary_text_ref(value, f"{path}.{key}")
            if found:
                return found
    elif isinstance(node, list):
        for idx, item in enumerate(node):
            found = _find_primary_text_ref(item, f"{path}[{idx}]")
            if found:
                return found
    return None


def _set_text_ref(body: Dict[str, Any], ref: Optional[Dict[str, Any]], value: str) -> tuple[str, str]:
    if ref and isinstance(ref.get("container"), dict) and isinstance(ref.get("key"), str):
        ref["container"][ref["key"]] = value
        ref["text"] = value
        return str(ref["key"]), str(ref.get("path") or "$.response")
    body["response"] = value
    return "response", "$.response"


def _has_enhancement_preflight(text: str) -> bool:
    if not isinstance(text, str):
        return False
    has_question = ENHANCEMENT_PREFLIGHT_QUESTION in text
    has_mode = bool(ENHANCEMENT_MODE_REGEX.search(text))
    return bool(has_question and has_mode)


def _inject_enhancement_preflight(text: str) -> tuple[str, bool]:
    if not isinstance(text, str):
        return text, False
    has_question = ENHANCEMENT_PREFLIGHT_QUESTION in text
    has_mode = bool(ENHANCEMENT_MODE_REGEX.search(text))
    if has_question and has_mode:
        return text, False
    additions = []
    if not has_question:
        additions.append(ENHANCEMENT_PREFLIGHT_QUESTION)
    if not has_mode:
        additions.append("Enhancement pass: ON.")
    return "\n".join(additions + ["", text]).strip(), True


def _is_control_token_response(text: Any) -> bool:
    if not isinstance(text, str):
        return False
    return text.strip().upper() in SEND_TIME_GATE_CONTROL_TOKENS


def _is_internal_machine_call(request: Request) -> bool:
    """Detect service-to-service calls that should bypass user-facing text gates.

    Policy:
    - User-facing sessions should NOT bypass enhancement/everyday gates.
    - Internal service hops (augmenter/singularity/forge/etc) should bypass.
    - Explicit override header `x-cortex-user-facing: 1` forces user-facing mode.
    """
    try:
        h = request.headers
        path = (request.url.path or "").strip().lower()

        # Explicit opt-in to user-facing gate behavior.
        if (h.get("x-cortex-user-facing", "") or "").strip() == "1":
            return False

        # If request carries a normal chat/session id, treat as user-facing.
        xs = (h.get("x-session-id", "") or h.get("x-chat-id", "") or "").strip().lower()
        if xs and not (xs.startswith("singularity-") or xs.startswith("augmenter-") or xs == "singularity-internal" or xs.startswith("oracle-internal") or xs.startswith("internal-")):
            return False

        # Internal flags/routes.
        if path.startswith("/forge/"):
            return True
        if h.get("x-augmenter-bypass", "") == "1":
            return True
        xr = (h.get("x-router", "") or h.get("x-internal-router", "")).strip().lower()
        if xr in {"singularity", "augmenter", "oracle-internal", "internal"}:
            return True

        # Service-to-service orchestration endpoints default to internal only
        # when no user-facing session markers are present.
        machine_prefixes = (
            "/oracle/chat",
            "/nexus/orchestrate",
            "/augmenter/chat",
            "/meta_conductor/orchestrate",
        )
        if any(path.startswith(prefix) for prefix in machine_prefixes):
            return True
    except Exception:
        return False
    return False


def _build_activation_turn_id(path: str, response_text: str) -> str:
    seed = f"{time.time_ns()}|{path}|{response_text[:160]}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]


def _classify_level_usage_traffic(request: Request) -> str:
    """Best-effort split of durable level events into organic vs probe/validation."""
    try:
        h = request.headers
        explicit = (h.get("x-cortex-traffic-class", "") or "").strip().lower()
        if explicit in {"organic", "probe", "validation"}:
            return explicit

        path = (request.url.path or "").strip().lower()
        session_id = (h.get("x-session-id", "") or h.get("x-chat-id", "") or "").strip()
        user_facing = (h.get("x-cortex-user-facing", "") or "").strip() == "1"
        user_agent = (h.get("user-agent", "") or "").strip().lower()

        if session_id or user_facing:
            return "organic"
        if path.endswith("/status") or path.endswith("/health") or path.startswith("/hud_display/"):
            return "validation"
        if path in {"/nexus/orchestrate", "/oracle/chat", "/augmenter/chat", "/meta_conductor/orchestrate"} and user_agent.startswith("curl/"):
            return "probe"
    except Exception:
        return "organic"
    return "organic"


def _normalize_level_row(level_row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(level_row, dict):
        return None
    level = level_row.get("level")
    if not isinstance(level, int):
        return None
    name = str(level_row.get("name") or f"L{level}").strip() or f"L{level}"
    return {
        "level": int(level),
        "name": name,
        "always_on": bool(level_row.get("always_on", False)),
        **({"derived_from": level_row.get("derived_from")} if level_row.get("derived_from") else {}),
    }


def _merge_levels(primary: List[Dict[str, Any]], extra: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen = set()
    for row in list(primary or []) + list(extra or []):
        norm = _normalize_level_row(row)
        if not norm:
            continue
        level = int(norm["level"])
        if level in seen:
            continue
        seen.add(level)
        merged.append(norm)
    return sorted(merged, key=lambda x: int(x.get("level", 999)))


def _extract_activated_from_payload(payload: Any) -> List[Dict[str, Any]]:
    found: List[Dict[str, Any]] = []

    def walk(node: Any):
        if isinstance(node, dict):
            for key in ("_activated", "activated_levels"):
                acts = node.get(key)
                if isinstance(acts, list):
                    for item in acts:
                        if isinstance(item, dict) and isinstance(item.get("level"), int):
                            found.append({
                                "level": int(item["level"]),
                                "name": str(item.get("name") or f"L{item['level']}"),
                                "always_on": bool(item.get("always_on", False)),
                                **({"derived_from": item.get("derived_from")} if item.get("derived_from") else {}),
                            })
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for it in node:
                walk(it)

    walk(payload)
    return _merge_levels([], found)


def _emit_level_usage_event(request: Request, level_row: Dict[str, Any], request_id: str) -> None:
    """Persist normalized level usage events for longitudinal usage audits.

    This complements in-memory HUD activation history with a durable event stream.
    Never raises (best-effort telemetry only).
    """
    if not LEVEL_USAGE_EVENTS_ENABLED:
        return
    try:
        now_ts = time.time()
        now_iso = datetime.utcnow().isoformat() + "Z"
        h = request.headers
        event = {
            "timestamp": now_iso,
            "ts": now_ts,
            "level": level_row.get("level"),
            "name": level_row.get("name"),
            "always_on": bool(level_row.get("always_on", False)),
            "path": request.url.path,
            "method": getattr(request, "method", None),
            "request_id": str(request_id),
            "session_id": (h.get("x-session-id", "") or h.get("x-chat-id", "") or "").strip() or None,
            "traffic_class": _classify_level_usage_traffic(request),
            "lane": getattr(request.state, "lane", None),
            "source": "hud_middleware",
        }

        LEVEL_USAGE_EVENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LEVEL_USAGE_EVENTS_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception:
        return


class HUDMiddleware(BaseHTTPMiddleware):
    """Middleware to automatically add contract metadata to successful JSON responses."""

    async def dispatch(self, request: Request, call_next):
        request_id = str(id(request))
        _request_levels[request_id] = []

        request.state.hud_request_id = request_id
        request.state.activated_levels = []

        response = await call_next(request)

        # Never inject metadata on non-success responses.
        if getattr(response, "status_code", 500) >= 400:
            if hasattr(request.state, "activated_levels"):
                request.state.activated_levels = []
        else:
            explicit_levels = request.state.activated_levels if hasattr(request.state, "activated_levels") else []
            levels = self._ensure_levels_for_success_path(request, explicit_levels)
            response = await self._add_hud_to_response(request, response, levels)
            # Refresh with any nested activation metadata extracted from payload.
            levels = _merge_levels(levels, list(getattr(request.state, "activated_levels", []) or []))

            now_ts = time.time()
            now_iso = datetime.now().isoformat()
            path = request.url.path
            for lvl in levels:
                _recent_activations.append({
                    "level": lvl.get("level"),
                    "name": lvl.get("name"),
                    "always_on": bool(lvl.get("always_on", False)),
                    "path": path,
                    "ts": now_ts,
                    "timestamp": now_iso,
                })
                _emit_level_usage_event(request, lvl, request_id)
            if levels:
                _recent_traces.append({
                    "ts": now_ts,
                    "timestamp": now_iso,
                    "path": path,
                    "request_id": str(request_id),
                    "lane": getattr(request.state, "lane", None),
                    "activated": [{"level": l.get("level"), "name": l.get("name")} for l in levels],
                })

        if request_id in _request_levels:
            del _request_levels[request_id]

        return response

    def _ensure_levels_for_success_path(self, request: Request, levels: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if levels:
            return levels

        path = (request.url.path or "").strip("/")
        root = path.split("/")[0] if path else ""
        hint = _ROUTE_LEVEL_HINTS.get(root)
        if hint:
            return [{
                "level": hint["level"],
                "name": hint["name"],
                "derived_from": "route",
                "always_on": False,
            }]
        return []

    async def _add_hud_to_response(self, request: Request, response: Response, levels: List[Dict[str, Any]]) -> Response:
        content_type = (response.headers.get("content-type") or "").lower()
        if not content_type.startswith("application/json"):
            return response

        body_bytes = None
        try:
            body_bytes = getattr(response, "body", None)
            if body_bytes is None and hasattr(response, "body_iterator"):
                chunks = []
                async for chunk in response.body_iterator:
                    chunks.append(chunk)
                body_bytes = b"".join(chunks)
                if not body_bytes:
                    return response

            if body_bytes is None:
                return response

            body = json.loads(body_bytes.decode())
            if not isinstance(body, dict):
                # Preserve non-dict JSON payloads (lists/strings/numbers) after body_iterator consumption.
                headers = dict(response.headers)
                headers["content-length"] = str(len(body_bytes))
                return StarletteResponse(
                    content=body_bytes,
                    status_code=response.status_code,
                    headers=headers,
                    media_type="application/json",
                )

            # Deterministic response contract for parser reliability.
            body.setdefault("success", True)
            for key in RESPONSE_TEXT_KEYS:
                if isinstance(body.get(key), str):
                    body[key] = body[key].strip()
            body.setdefault("response_shape_version", RESPONSE_SHAPE_VERSION)

            # Merge explicit middleware levels with nested activation metadata from payload
            # so usage telemetry reflects actual orchestrated participation.
            payload_levels = _extract_activated_from_payload(body)
            levels = _merge_levels(levels, payload_levels)
            if hasattr(request.state, "activated_levels"):
                request.state.activated_levels = levels

            if levels:
                hud_parts = []
                for lvl in levels[:5]:
                    level_num = lvl.get("level", "?")
                    name = lvl.get("name", "Unknown").title()
                    hud_parts.append(f"🟢 L{level_num} ({name})")
                body.setdefault("hud", " | ".join(hud_parts))
                body["activated_levels"] = levels

            existing_contract = body.get("contract") if isinstance(body.get("contract"), dict) else {}
            has_explicit_activation = any(not bool(lvl.get("derived_from")) for lvl in levels)
            computed_source = "explicit" if has_explicit_activation else ("derived" if levels else "none")
            source = existing_contract.get("activation_metadata_source") or computed_source
            available = bool(existing_contract.get("activation_metadata_available", True))
            if available and source == "none":
                source = computed_source if computed_source != "none" else "derived"

            top_level_text_key, top_level_text = _extract_top_level_text(body)
            send_gate_reply = bool(top_level_text) and not _is_control_token_response(top_level_text)

            response_ref = _find_primary_text_ref(body)
            response_text_key = str(response_ref.get("key")) if response_ref else None
            response_text_path = str(response_ref.get("path")) if response_ref else None
            response_text = str(response_ref.get("text")) if response_ref else ""
            enhancement_reply_candidate = bool(response_text) and not _is_control_token_response(response_text)

            has_activation_metadata = has_explicit_activation if SEND_TIME_GATE_REQUIRE_EXPLICIT else bool(levels)
            internal_machine_call = _is_internal_machine_call(request)
            enhancement_gate_required = bool(
                (not internal_machine_call)
                and enhancement_reply_candidate
                and _enhancement_gate_applies(request.url.path, response_ref)
            )
            everyday_format_required = bool(
                (not internal_machine_call)
                and enhancement_reply_candidate
                and _everyday_format_applies(request.url.path, response_ref)
            )
            enhancement_preflight_ok = None
            enhancement_preflight_auto_injected = False
            everyday_format_ok = None
            everyday_format_auto_injected = False
            confidence_band = None

            # Even when internal-machine bypass is active, surface observed
            # everyday-format compliance in contract metadata for watchdogs.
            if _has_everyday_format(response_text):
                everyday_format_ok = True

            if SEND_TIME_GATE_HARD and send_gate_reply and not has_activation_metadata and not internal_machine_call:
                blocked = {
                    "success": False,
                    "error": "send_time_gate_blocked_missing_activation_metadata",
                    "contract": {
                        "identity_phrase": CONTRACT_IDENTITY_PHRASE,
                        "activation_metadata_available": False,
                        "activation_metadata_source": "none",
                        "contract_version": "cortex.contract.v1",
                        "send_time_gate": "hard",
                        "send_time_gate_require_explicit": bool(SEND_TIME_GATE_REQUIRE_EXPLICIT),
                    },
                    "response_shape_version": RESPONSE_SHAPE_VERSION,
                }
                blocked_body = json.dumps(blocked).encode()
                return StarletteResponse(content=blocked_body, status_code=503, media_type="application/json")

            if ENHANCEMENT_GATE_HARD and enhancement_gate_required:
                enhancement_preflight_ok = _has_enhancement_preflight(response_text)
                if not enhancement_preflight_ok:
                    if ENHANCEMENT_GATE_INJECT_MISSING:
                        response_text, enhancement_preflight_auto_injected = _inject_enhancement_preflight(response_text)
                        response_text_key, response_text_path = _set_text_ref(body, response_ref, response_text)
                        enhancement_preflight_ok = _has_enhancement_preflight(response_text)
                    else:
                        blocked = {
                            "success": False,
                            "error": "enhancement_gate_blocked_missing_preflight",
                            "required_question": ENHANCEMENT_PREFLIGHT_QUESTION,
                            "required_mode": "Enhancement pass: ON|OFF",
                            "contract": {
                                "identity_phrase": CONTRACT_IDENTITY_PHRASE,
                                "activation_metadata_available": bool(available),
                                "activation_metadata_source": source,
                                "contract_version": "cortex.contract.v1",
                                "send_time_gate": "hard" if SEND_TIME_GATE_HARD else "off",
                                "send_time_gate_require_explicit": bool(SEND_TIME_GATE_REQUIRE_EXPLICIT),
                                "enhancement_gate": "hard",
                                "enhancement_gate_inject_missing": bool(ENHANCEMENT_GATE_INJECT_MISSING),
                            },
                            "response_shape_version": RESPONSE_SHAPE_VERSION,
                        }
                        blocked_body = json.dumps(blocked).encode()
                        return StarletteResponse(content=blocked_body, status_code=503, media_type="application/json")

            if EVERYDAY_FORMAT_HARD and everyday_format_required:
                everyday_format_ok = _has_everyday_format(response_text)
                if not everyday_format_ok:
                    if EVERYDAY_FORMAT_INJECT_MISSING:
                        response_text, everyday_format_auto_injected, confidence_band = _inject_everyday_format(response_text)
                        response_text_key, response_text_path = _set_text_ref(body, response_ref, response_text)
                        everyday_format_ok = _has_everyday_format(response_text)
                    else:
                        blocked = {
                            "success": False,
                            "error": "everyday_format_blocked_missing_fields",
                            "required_fields": [
                                "Confidence: High|Medium|Low",
                                "Main uncertainty: ...",
                                "Priority: ...",
                            ],
                            "contract": {
                                "identity_phrase": CONTRACT_IDENTITY_PHRASE,
                                "activation_metadata_available": bool(available),
                                "activation_metadata_source": source,
                                "contract_version": "cortex.contract.v1",
                                "everyday_format_gate": "hard",
                                "everyday_format_inject_missing": bool(EVERYDAY_FORMAT_INJECT_MISSING),
                            },
                            "response_shape_version": RESPONSE_SHAPE_VERSION,
                        }
                        blocked_body = json.dumps(blocked).encode()
                        return StarletteResponse(content=blocked_body, status_code=503, media_type="application/json")
                if confidence_band is None:
                    confidence_band, _, _ = _estimate_confidence(response_text)

            contract = dict(existing_contract) if isinstance(existing_contract, dict) else {}
            contract.update({
                "identity_phrase": existing_contract.get("identity_phrase", CONTRACT_IDENTITY_PHRASE),
                "activation_metadata_available": available,
                "activation_metadata_source": source,
                "contract_version": existing_contract.get("contract_version", "cortex.contract.v1"),
                "send_time_gate": "hard" if SEND_TIME_GATE_HARD else "off",
                "send_time_gate_require_explicit": bool(SEND_TIME_GATE_REQUIRE_EXPLICIT),
                "enhancement_gate": "hard" if ENHANCEMENT_GATE_HARD else "off",
                "enhancement_gate_inject_missing": bool(ENHANCEMENT_GATE_INJECT_MISSING),
                "enhancement_preflight_required": enhancement_gate_required,
                "enhancement_preflight_ok": enhancement_preflight_ok,
                "enhancement_preflight_auto_injected": enhancement_preflight_auto_injected,
                "enhancement_preflight_field": response_text_key if enhancement_gate_required else None,
                "enhancement_preflight_path": response_text_path if enhancement_gate_required else None,
                "everyday_format_gate": "hard" if EVERYDAY_FORMAT_HARD else "off",
                "everyday_format_inject_missing": bool(EVERYDAY_FORMAT_INJECT_MISSING),
                "everyday_format_required": everyday_format_required,
                "everyday_format_ok": everyday_format_ok,
                "everyday_format_auto_injected": everyday_format_auto_injected,
                "confidence_band": confidence_band,
                "internal_machine_call_bypass": bool(internal_machine_call),
            })

            if (send_gate_reply or enhancement_reply_candidate) and has_activation_metadata:
                contract["activation_turn_id"] = _build_activation_turn_id(request.url.path, response_text or top_level_text)
                contract["activation_turn_ts"] = datetime.utcnow().isoformat() + "Z"
                contract["activation_turn_path"] = request.url.path

            body["contract"] = contract

            new_body = json.dumps(body).encode()
            headers = dict(response.headers)
            headers["content-length"] = str(len(new_body))
            return StarletteResponse(content=new_body, status_code=response.status_code, headers=headers, media_type="application/json")
        except Exception:
            # Preserve original response body on middleware parse/injection failures.
            if body_bytes is not None:
                try:
                    headers = dict(response.headers)
                    headers["content-length"] = str(len(body_bytes))
                    return StarletteResponse(
                        content=body_bytes,
                        status_code=response.status_code,
                        headers=headers,
                        media_type="application/json",
                    )
                except Exception:
                    pass
            return response


def track_level(request: Request, level: int, name: str, always_on: bool = False):
    """Track that a level was activated during this request."""
    if hasattr(request.state, "activated_levels"):
        existing = [l for l in request.state.activated_levels if l.get("level") == level]
        if not existing:
            request.state.activated_levels.append({
                "level": level,
                "name": name,
                "always_on": always_on,
            })


def get_activated_levels(request: Request) -> List[Dict[str, Any]]:
    """Get list of activated levels for this request."""
    return getattr(request.state, "activated_levels", [])


def get_recent_activations(seconds: int = 300) -> List[Dict[str, Any]]:
    cutoff = time.time() - seconds
    return [a for a in _recent_activations if a.get("ts", 0) >= cutoff]


def get_unique_recent_levels(seconds: int = 300) -> List[Dict[str, Any]]:
    cutoff = time.time() - seconds
    seen: Dict[int, Dict[str, Any]] = {}
    for a in reversed(list(_recent_activations)):
        lvl = a.get("level")
        if lvl is None:
            continue
        if a.get("ts", 0) >= cutoff and lvl not in seen:
            seen[lvl] = a
    return sorted(seen.values(), key=lambda x: x.get("level", 0))


def get_recent_traces(seconds: int = 300) -> List[Dict[str, Any]]:
    cutoff = time.time() - seconds
    return [t for t in _recent_traces if t.get("ts", 0) >= cutoff]
