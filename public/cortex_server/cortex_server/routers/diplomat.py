"""
Level 18: The Diplomat — Communication Hub

Sends messages to arbitrary HTTP endpoints, tracks delivery stats,
supports broadcast to multiple targets, and keeps a message log.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
from datetime import datetime
from collections import deque
from urllib.parse import urlparse
import asyncio
import time
import httpx

router = APIRouter()

# ── Guardrails / limits ─────────────────────────────────────────────────────
_ALLOWED_METHODS = {"GET", "POST"}
_MAX_MESSAGE_LEN = 20_000
_MAX_TARGETS = 50
_MIN_TIMEOUT = 1
_MAX_TIMEOUT = 120
_MAX_HEADERS = 50

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


async def _deliver(
    client: httpx.AsyncClient,
    target: str,
    message: str,
    method: str,
    headers: Optional[Dict[str, str]],
    timeout: int,
) -> Dict[str, Any]:
    """Send one message and return structured result."""
    t0 = time.monotonic()
    try:
        if method == "GET":
            resp = await client.get(
                target,
                params={"message": message},
                headers=headers or {},
                timeout=float(timeout),
            )
        else:
            resp = await client.post(
                target,
                json={"message": message},
                headers=headers or {},
                timeout=float(timeout),
            )

        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        success = 200 <= resp.status_code < 400

        try:
            body = resp.json()
        except Exception:
            body = (resp.text or "")[:500]

        result = {
            "target": target,
            "method": method,
            "status_code": resp.status_code,
            "success": success,
            "latency_ms": latency_ms,
            "response": body,
            "timestamp": datetime.now().isoformat(),
            "error_code": None if success else "upstream_http_error",
        }

    except httpx.TimeoutException as exc:
        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        result = {
            "target": target,
            "method": method,
            "status_code": None,
            "success": False,
            "latency_ms": latency_ms,
            "error": str(exc)[:300],
            "timestamp": datetime.now().isoformat(),
            "error_code": "timeout",
        }
    except httpx.RequestError as exc:
        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        result = {
            "target": target,
            "method": method,
            "status_code": None,
            "success": False,
            "latency_ms": latency_ms,
            "error": str(exc)[:300],
            "timestamp": datetime.now().isoformat(),
            "error_code": "request_error",
        }
    except Exception as exc:
        latency_ms = round((time.monotonic() - t0) * 1000, 1)
        result = {
            "target": target,
            "method": method,
            "status_code": None,
            "success": False,
            "latency_ms": latency_ms,
            "error": str(exc)[:300],
            "timestamp": datetime.now().isoformat(),
            "error_code": "internal_error",
        }

    _stats["messages_sent"] += 1
    _stats["total_latency_ms"] += latency_ms
    if result["success"]:
        _stats["successful"] += 1
    else:
        _stats["failed"] += 1
        _stats["last_error"] = result.get("error") or result.get("error_code")

    _message_log.append(result)
    return result


# ── Routes ──────────────────────────────────────────────────────────────────

@router.post("/send")
async def diplomat_send(request: SendRequest):
    """Send a message to a single target via HTTP."""
    payload = _validate_send_contract(request)

    async with httpx.AsyncClient() as client:
        result = await _deliver(
            client,
            payload["target"],
            payload["message"],
            payload["method"],
            payload["headers"],
            payload["timeout"],
        )

    return {
        "success": result["success"],
        "level": 18,
        "name": "The Diplomat",
        "delivery": result,
    }


@router.post("/broadcast")
async def diplomat_broadcast(request: BroadcastRequest):
    """Send a message to multiple targets simultaneously."""
    payload = _validate_broadcast_contract(request)

    async with httpx.AsyncClient() as client:
        tasks = [
            _deliver(
                client,
                target,
                payload["message"],
                payload["method"],
                payload["headers"],
                payload["timeout"],
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


@router.get("/status")
async def diplomat_status():
    """L18 Diplomat status with delivery statistics."""
    sent = _stats["messages_sent"]
    success_rate = round((_stats["successful"] / sent) * 100, 1) if sent > 0 else 0.0
    avg_latency = round(_stats["total_latency_ms"] / sent, 1) if sent > 0 else 0.0

    failed_recent = sum(1 for m in list(_message_log)[-20:] if not m.get("success"))
    health = "active"
    if failed_recent >= 10:
        health = "degraded"

    return {
        "success": True,
        "data": {
            "level": 18,
            "name": "The Diplomat",
            "status": health,
            "messages_sent": sent,
            "successful": _stats["successful"],
            "failed": _stats["failed"],
            "success_rate": success_rate,
            "avg_latency_ms": avg_latency,
            "rejected_contracts": _stats["rejected_contracts"],
            "recent_failed_last_20": failed_recent,
            "last_error": _stats["last_error"],
            "protocols_supported": ["http", "https"],
            "capabilities": ["send", "broadcast", "delivery_log", "contract_validation"],
            "timestamp": datetime.now().isoformat(),
        },
        "error": None,
    }
