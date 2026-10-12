"""
Level 18: The Diplomat — Communication Hub

* ``POST /diplomat/draft`` (safe): model-backed drafting of a message — and,
  on request, a negotiation position — for the USER to send themselves.  It
  performs no egress and sends nothing.
* ``POST /diplomat/send`` / ``/broadcast``: outbound HTTP delivery is HELD
  until a durable idempotency store exists.  The hold is checked before the
  action capability is consumed, so a refused send does not burn a nonce.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional, Dict, List, Any, Literal
from datetime import datetime
from collections import deque
from urllib.parse import urlparse
import asyncio
import hashlib
import time

from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
    require_action_capability,
)
from cortex_server.outbound_egress import (
    EgressError,
    EgressPolicy,
    EgressPolicyError,
    EgressResponseTooLarge,
    EgressUpstreamError,
    request as outbound_request,
)

from cortex_server.modules.level_route_status import capability_report

router = APIRouter()

# ── Guardrails / limits ─────────────────────────────────────────────────────
_ALLOWED_METHODS = {"GET", "POST"}
_MAX_MESSAGE_LEN = 20_000
_MAX_TARGETS = 50
_MIN_TIMEOUT = 1
_MAX_TIMEOUT = 120
_MAX_HEADERS = 50
_MAX_RESPONSE_BYTES = 64_000

# ── In-memory state ────────────────────────────────────────────────────────
_stats = {
    "messages_sent": 0,
    "successful": 0,
    "failed": 0,
    "total_latency_ms": 0.0,
    "rejected_contracts": 0,
    "last_error": None,
}

# Rolling log of the last 200 deliveries (return last 50 on request)
_message_log: deque = deque(maxlen=200)


# ── Models ─────────────────────────────────────────────────────────────────

class SendRequest(BaseModel):
    """Single-target message delivery."""
    message: str
    target: str                        # URL to send to
    method: str = "POST"               # GET or POST
    headers: Optional[Dict[str, str]] = None
    timeout: int = 30


class BroadcastRequest(BaseModel):
    """Multi-target broadcast."""
    message: str
    targets: List[str]                 # List of URLs
    method: str = "POST"
    headers: Optional[Dict[str, str]] = None
    timeout: int = 30


# ── Helpers ─────────────────────────────────────────────────────────────────

def _reject(detail: str) -> None:
    _stats["rejected_contracts"] += 1
    _stats["last_error"] = detail
    raise HTTPException(status_code=400, detail=detail)


def _validate_url(url: str, field_name: str = "target") -> str:
    if not isinstance(url, str) or not url.strip():
        _reject(f"{field_name} must be a non-empty URL string")
    url = url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        _reject(f"{field_name} must be a valid http(s) URL")
    if len(url) > 2048:
        _reject(f"{field_name} exceeds max length (2048)")
    return url


def _validate_headers(headers: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    if headers is None:
        return None
    if not isinstance(headers, dict):
        _reject("headers must be an object")
    if len(headers) > _MAX_HEADERS:
        _reject(f"headers count exceeds max ({_MAX_HEADERS})")
    clean: Dict[str, str] = {}
    for k, v in headers.items():
        if not isinstance(k, str) or not isinstance(v, str):
            _reject("headers keys and values must be strings")
        clean[k.strip()] = v
    return clean


def _normalize_method(method: str) -> str:
    m = (method or "POST").upper().strip()
    if m not in _ALLOWED_METHODS:
        _reject(f"method must be one of: {sorted(_ALLOWED_METHODS)}")
    return m


def _validate_timeout(timeout: int) -> int:
    if not isinstance(timeout, int):
        _reject("timeout must be an integer")
    if timeout < _MIN_TIMEOUT or timeout > _MAX_TIMEOUT:
        _reject(f"timeout must be between {_MIN_TIMEOUT} and {_MAX_TIMEOUT} seconds")
    return timeout


def _validate_message(message: str) -> str:
    if not isinstance(message, str) or not message.strip():
        _reject("message must be a non-empty string")
    if len(message) > _MAX_MESSAGE_LEN:
        _reject(f"message exceeds max length ({_MAX_MESSAGE_LEN})")
    return message


def _validate_send_contract(request: SendRequest) -> Dict[str, Any]:
    return {
        "message": _validate_message(request.message),
        "target": _validate_url(request.target, "target"),
        "method": _normalize_method(request.method),
        "headers": _validate_headers(request.headers),
        "timeout": _validate_timeout(request.timeout),
    }


def _validate_broadcast_contract(request: BroadcastRequest) -> Dict[str, Any]:
    message = _validate_message(request.message)
    method = _normalize_method(request.method)
    headers = _validate_headers(request.headers)
    timeout = _validate_timeout(request.timeout)

    if not isinstance(request.targets, list) or not request.targets:
        _reject("targets must be a non-empty list")
    if len(request.targets) > _MAX_TARGETS:
        _reject(f"targets exceeds max count ({_MAX_TARGETS})")

    targets = [_validate_url(t, "targets[]") for t in request.targets]
    return {
        "message": message,
        "targets": targets,
        "method": method,
        "headers": headers,
        "timeout": timeout,
    }


DELIVERY_HOLD_REASON = "Diplomat delivery requires durable operation idempotency"


def delivery_enabled() -> bool:
    """Outbound delivery is held until a durable idempotency store exists.

    The hardened egress path (``outbound_request`` with the diplomat egress
    allowlist, response cap and target redaction) is kept for that future sink;
    no code path reaches it today.
    """
    return False


async def _require_delivery_enabled() -> None:
    """Runs before the action-capability dependency so a held send never burns a nonce."""
    if not delivery_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "error": "diplomat_delivery_held",
                "message": DELIVERY_HOLD_REASON,
                "action_capability_consumed": False,
            },
        )


async def _deliver(
    target: str,
    message: str,
    method: str,
    headers: Optional[Dict[str, str]],
    timeout: int,
    authorization: ActionAuthorization,
) -> Dict[str, Any]:
    """Held fail-closed: never reaches the outbound broker."""
    raise HTTPException(status_code=503, detail=DELIVERY_HOLD_REASON)


# ── Routes ──────────────────────────────────────────────────────────────────

@router.post("/send", dependencies=[Depends(_require_delivery_enabled)])
async def diplomat_send(
    request: SendRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    """Send a message to a single target via HTTP."""
    payload = _validate_send_contract(request)

    result = await _deliver(
        payload["target"],
        payload["message"],
        payload["method"],
        payload["headers"],
        payload["timeout"],
        authorization,
    )

    return {
        "success": result["success"],
        "level": 18,
        "name": "The Diplomat",
        "delivery": result,
    }


@router.post("/broadcast", dependencies=[Depends(_require_delivery_enabled)])
async def diplomat_broadcast(
    request: BroadcastRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    """Send a message to multiple targets simultaneously."""
    payload = _validate_broadcast_contract(request)

    tasks = [
        _deliver(
            target,
            payload["message"],
            payload["method"],
            payload["headers"],
            payload["timeout"],
            authorization,
        )
        for target in payload["targets"]
    ]
    results = await asyncio.gather(*tasks)

    delivered = sum(1 for r in results if r["success"])
    total = len(payload["targets"])
    failed = total - delivered

    return {
        "success": failed == 0,
        "partial_success": delivered > 0 and failed > 0,
        "total_targets": total,
        "delivered": delivered,
        "failed": failed,
        "results": list(results),
    }


@router.get("/log")
async def diplomat_log():
    """Return the last 50 message deliveries."""
    recent = list(_message_log)[-50:]
    recent.reverse()  # newest first
    return {
        "success": True,
        "count": len(recent),
        "messages": recent,
    }


# ── Draft (model-backed, never sends) ───────────────────────────────────────

class DraftRequest(BaseModel):
    goal: str = Field(..., min_length=1, max_length=2000)
    counterparty: Optional[str] = Field(default=None, max_length=300)
    channel: Literal["email", "chat", "sms", "letter", "linkedin", "other"] = "email"
    tone: Optional[str] = Field(default=None, max_length=200)
    constraints: Optional[str] = Field(default=None, max_length=2000)
    thread: Optional[str] = Field(default=None, max_length=8000)
    negotiation: bool = False
    language: Optional[str] = Field(default=None, max_length=40)


class NegotiationPosition(BaseModel):
    anchor: str = Field(min_length=1, max_length=400)
    target: str = Field(min_length=1, max_length=400)
    walk_away: str = Field(min_length=1, max_length=400)
    concessions: List[str] = Field(default_factory=list, max_length=6)


class DraftOut(BaseModel):
    subject: Optional[str] = Field(default=None, max_length=200)
    draft_message: str = Field(min_length=1, max_length=6000)
    tone: str = Field(min_length=1, max_length=120)
    key_points: List[str] = Field(default_factory=list, max_length=8)
    negotiation_position: Optional[NegotiationPosition] = None
    risks: List[str] = Field(default_factory=list, max_length=6)
    alternatives: List[str] = Field(default_factory=list, max_length=3)
    follow_up: Optional[str] = Field(default=None, max_length=400)


DIPLOMAT_SYSTEM = (
    "You are L18 Diplomat, an expert communicator and negotiator drafting a message that the USER will review and "
    "send themselves. You never send anything. Write a message that achieves the user's goal with the stated "
    "counterparty on the stated channel: match the channel's conventions (subject line for email, brevity for chat/SMS), "
    "use the requested tone, respect every constraint, and stay truthful (no invented facts, figures, deadlines or "
    "commitments; use [placeholders] for anything the user must fill in). If a thread excerpt is given, reply in "
    "context. When negotiation is requested, give a realistic position: anchor, target, walk-away and ordered "
    "concessions. List the main risks of sending (tone, legal, relationship) and up to 3 short alternative openings. "
    "Return ONLY a JSON object with keys: subject, draft_message, tone, key_points[], negotiation_position "
    "({anchor, target, walk_away, concessions[]} or null), risks[], alternatives[], follow_up."
)


def build_draft_prompt(request: "DraftRequest") -> str:
    parts = [f"Goal: {request.goal.strip()}", f"Channel: {request.channel}"]
    if request.counterparty:
        parts.append(f"Counterparty: {request.counterparty.strip()}")
    if request.tone:
        parts.append(f"Requested tone: {request.tone.strip()}")
    if request.language:
        parts.append(f"Write in: {request.language.strip()}")
    if request.constraints:
        parts.append(f"Constraints: {request.constraints.strip()}")
    parts.append(f"Negotiation position requested: {'yes' if request.negotiation else 'no'}")
    if request.thread:
        parts.append(f"Thread excerpt (most recent last):\n{request.thread.strip()}")
    return "\n".join(parts)


_DRAFT_LANE: Dict[str, Any] = {"last_ok_at": None, "last_failure_at": None, "last_status": None, "drafts": 0}


async def create_draft(request: "DraftRequest", *, principal_scope_key: str) -> Dict[str, Any]:
    from cortex_server.modules import level_model

    result = await level_model.level_model_json(
        level=18,
        name="diplomat",
        system=DIPLOMAT_SYSTEM,
        prompt=build_draft_prompt(request),
        principal_scope_key=principal_scope_key,
        schema=DraftOut,
        deadline_s=60.0,
    )
    _DRAFT_LANE["last_status"] = result.get("status")
    if not result.get("ok"):
        _DRAFT_LANE["last_failure_at"] = time.time()
        payload = level_model.unavailable_payload(result, operation="diplomat.draft")
        payload.update(draft=None, sent=False)
        return payload
    _DRAFT_LANE["last_ok_at"] = time.time()
    _DRAFT_LANE["drafts"] += 1
    draft = result.get("data") or {}
    if not request.negotiation:
        draft["negotiation_position"] = None
    return {
        "success": True,
        "operation": "diplomat.draft",
        "origin": "model",
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
        "draft": draft,
        "sent": False,
        "requires_user_to_send": True,
        "note": "Draft only. Cortex did not send this message; review and send it yourself.",
    }


@router.post("/draft")
async def diplomat_draft(request: DraftRequest, http_request: Request = None):
    """Draft a message for the user to send themselves. Never sends; no egress."""
    from cortex_server.modules.level_model import scope_key_for_request

    result = await create_draft(request, principal_scope_key=scope_key_for_request(http_request, "diplomat"))
    return {"level": 18, "name": "The Diplomat", **result}


_STATUS_CAPABILITIES = {
    "draft": [("POST", "/draft")],
    "delivery_log": [("GET", "/log")],
    "send": [("POST", "/send")],
    "broadcast": [("POST", "/broadcast")],
}


@router.get("/status")
async def diplomat_status(request: Request = None):
    """L18 status derived from what is mounted and what delivery can actually do."""
    sent = _stats["messages_sent"]
    success_rate = round((_stats["successful"] / sent) * 100, 1) if sent > 0 else 0.0
    avg_latency = round(_stats["total_latency_ms"] / sent, 1) if sent > 0 else 0.0
    failed_recent = sum(1 for m in list(_message_log)[-20:] if not m.get("success"))
    held = {} if delivery_enabled() else {
        "send": "held: durable operation idempotency not configured",
        "broadcast": "held: durable operation idempotency not configured",
    }
    report = capability_report(request, "/diplomat", _STATUS_CAPABILITIES, extra_unavailable=held)
    if "draft" in report["capabilities"]:
        health = "draft_only" if held else "active"
    else:
        health = "held"
    return {
        "success": True,
        "data": {
            "level": 18,
            "name": "The Diplomat",
            "status": health,
            "capabilities": report["capabilities"],
            "unavailable": report["unavailable"],
            "mounted_routes": report["mounted_routes"],
            "delivery": {
                "enabled": delivery_enabled(),
                "reason": None if delivery_enabled() else DELIVERY_HOLD_REASON,
                "messages_sent": sent,
                "successful": _stats["successful"],
                "failed": _stats["failed"],
                "success_rate": success_rate,
                "avg_latency_ms": avg_latency,
                "recent_failed_last_20": failed_recent,
            },
            "draft_lane": dict(_DRAFT_LANE),
            "rejected_contracts": _stats["rejected_contracts"],
            "last_error": _stats["last_error"],
            "timestamp": datetime.now().isoformat(),
        },
        "error": None,
    }
