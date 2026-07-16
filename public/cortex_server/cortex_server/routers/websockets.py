"""
WebSocket Router - Real-time communication endpoints.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio
import inspect
import json
import re
import threading
import time

from cortex_server.middleware.write_authorization import token_matches

router = APIRouter()

_CONTAINER_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_TASK_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$")
MAX_PROGRESS_MESSAGE_BYTES = 4096


class WebSocketAdmission:
    """Small fail-fast application admission independent of ASGI tasks."""

    def __init__(self, limit: int):
        if int(limit) <= 0:
            raise ValueError("WebSocket admission limit must be positive")
        self.limit = int(limit)
        self._active = 0
        self._lock = threading.Lock()

    def acquire(self) -> bool:
        with self._lock:
            if self._active >= self.limit:
                return False
            self._active += 1
            return True

    def release(self) -> None:
        with self._lock:
            self._active = max(0, self._active - 1)

    @property
    def active(self) -> int:
        with self._lock:
            return self._active


def _allowed_websocket_origin(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if not origin:
        return True
    return origin in websocket.app.state.websocket_security.allowed_origins


def _log_websocket_authorized(websocket: WebSocket) -> bool:
    config = websocket.app.state.websocket_security
    # Docker is an infrastructure-wide control plane. A generic write token,
    # loopback origin, or signed tenant identity is not container ownership.
    # Until an authoritative container-to-principal map exists this surface is
    # deliberately administrator-only.
    return token_matches(
        websocket.headers.get("x-cortex-admin-token", ""),
        config.admin_token,
    )


def _progress_websocket_authorized(websocket: WebSocket) -> bool:
    config = websocket.app.state.websocket_security
    supplied = websocket.headers.get(config.write_token_header, "")
    return bool(config.write_token) and token_matches(supplied, config.write_token)


async def _close_log_stream(logs) -> None:
    """Close either an async or synchronous Docker log stream."""
    if logs is None:
        return
    close = getattr(logs, "aclose", None) or getattr(logs, "close", None)
    if close is None:
        return
    if inspect.iscoroutinefunction(close):
        result = close()
    else:
        # Docker SDK close methods may be synchronous. Keep them outside the
        # event loop so the handler's cleanup timeout can restore admission.
        result = await asyncio.to_thread(close)
    if inspect.isawaitable(result):
        await result


@router.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket):
    """WebSocket for progress updates on long-running tasks."""
    if not _allowed_websocket_origin(websocket) or not _progress_websocket_authorized(websocket):
        await websocket.close(code=1008, reason="connection rejected")
        return
    admission = websocket.app.state.websocket_progress_admission
    if not admission.acquire():
        await websocket.close(code=1013, reason="connection capacity exhausted")
        return
    try:
        await websocket.accept()
        security = websocket.app.state.websocket_security
        idle_timeout = float(security.progress_idle_timeout_seconds)
        lifetime_deadline = time.monotonic() + float(security.progress_lifetime_seconds)
        while True:
            remaining = lifetime_deadline - time.monotonic()
            if remaining <= 0:
                await websocket.close(code=1000, reason="connection lifetime complete")
                return
            data = await asyncio.wait_for(
                websocket.receive_text(),
                timeout=min(idle_timeout, remaining),
            )
            if len(data.encode("utf-8")) > MAX_PROGRESS_MESSAGE_BYTES:
                await websocket.close(code=1009, reason="message too large")
                return
            try:
                msg = json.loads(data)
                if not isinstance(msg, dict) or set(msg) - {"action", "task_id"}:
                    raise ValueError("invalid message schema")
                action = msg.get("action")

                if action == "subscribe":
                    task_id = str(msg.get("task_id") or "")
                    if not _TASK_ID.fullmatch(task_id):
                        raise ValueError("invalid task_id")
                    await websocket.send_json({
                        "type": "subscribed",
                        "task_id": task_id,
                    })
                elif action == "ping":
                    if "task_id" in msg:
                        raise ValueError("invalid ping schema")
                    await websocket.send_json({"type": "pong"})
                else:
                    raise ValueError("unsupported action")
            except (json.JSONDecodeError, ValueError):
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid progress message"
                })
    except (asyncio.TimeoutError, WebSocketDisconnect):
        pass
    finally:
        admission.release()


@router.websocket("/ws/logs/{container_id}")
async def ws_logs(websocket: WebSocket, container_id: str):
    """WebSocket for streaming Docker container logs."""
    if (
        not _CONTAINER_ID.fullmatch(container_id)
        or not _allowed_websocket_origin(websocket)
        or not _log_websocket_authorized(websocket)
    ):
        await websocket.close(code=1008, reason="connection rejected")
        return

    admission = websocket.app.state.websocket_log_admission
    if not admission.acquire():
        await websocket.close(code=1013, reason="connection capacity exhausted")
        return
    security = websocket.app.state.websocket_security
    send_timeout = float(security.log_send_timeout_seconds)
    lifetime_deadline = time.monotonic() + float(security.log_lifetime_seconds)
    logs = None
    try:
        from cortex_server.tools.docker_wrapper import Docker

        await asyncio.wait_for(websocket.accept(), timeout=send_timeout)
        docker = Docker()
        logs = docker.containers.logs(container_id, follow=True, tail=100)
        iterator = logs.__aiter__()
        while True:
            remaining = lifetime_deadline - time.monotonic()
            if remaining <= 0:
                await asyncio.wait_for(
                    websocket.close(code=1000, reason="connection lifetime complete"),
                    timeout=send_timeout,
                )
                return
            try:
                line = await asyncio.wait_for(iterator.__anext__(), timeout=remaining)
            except StopAsyncIteration:
                return
            except asyncio.TimeoutError:
                await asyncio.wait_for(
                    websocket.close(code=1000, reason="connection lifetime complete"),
                    timeout=send_timeout,
                )
                return
            try:
                await asyncio.wait_for(
                    websocket.send_text(line),
                    timeout=min(send_timeout, max(0.001, lifetime_deadline - time.monotonic())),
                )
            except asyncio.TimeoutError:
                await asyncio.wait_for(
                    websocket.close(code=1013, reason="client backpressure timeout"),
                    timeout=send_timeout,
                )
                return
            # Small delay to prevent overwhelming the client
            await asyncio.sleep(0.01)
            
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await asyncio.wait_for(
                websocket.send_json({
                    "type": "error",
                    "message": "log stream unavailable"
                }),
                timeout=send_timeout,
            )
            await asyncio.wait_for(
                websocket.close(code=1011, reason="log stream unavailable"),
                timeout=send_timeout,
            )
        except (asyncio.TimeoutError, WebSocketDisconnect, RuntimeError):
            pass
    finally:
        try:
            await asyncio.wait_for(_close_log_stream(logs), timeout=send_timeout)
        except Exception:
            pass
        finally:
            admission.release()


@router.get("/ws/health")
async def websocket_transport_health():
    """Bodyless compatibility probe; health never consumes a WebSocket task."""
    return {"status": "ok", "transport": "websocket"}
