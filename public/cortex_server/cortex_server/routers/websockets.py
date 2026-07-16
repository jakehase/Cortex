"""
WebSocket Router - Real-time communication endpoints.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio
import inspect
import json
import re

from cortex_server.middleware.write_authorization import token_matches

router = APIRouter()

_CONTAINER_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


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


async def _close_log_stream(logs) -> None:
    """Close either an async or synchronous Docker log stream."""
    if logs is None:
        return
    close = getattr(logs, "aclose", None) or getattr(logs, "close", None)
    if close is None:
        return
    result = close()
    if inspect.isawaitable(result):
        await result


@router.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket):
    """WebSocket for progress updates on long-running tasks."""
    await websocket.accept()
    try:
        while True:
            # Wait for client messages (task subscriptions)
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                action = msg.get("action")
                
                if action == "subscribe":
                    task_id = msg.get("task_id")
                    await websocket.send_json({
                        "type": "subscribed",
                        "task_id": task_id,
                    })
                
                elif action == "ping":
                    await websocket.send_json({"type": "pong"})
                    
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON"
                })
                
    except WebSocketDisconnect:
        pass


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

    from cortex_server.tools.docker_wrapper import Docker

    await websocket.accept()
    logs = None
    try:
        docker = Docker()
        logs = docker.containers.logs(container_id, follow=True, tail=100)
        async for line in logs:
            await websocket.send_text(line)
            # Small delay to prevent overwhelming the client
            await asyncio.sleep(0.01)
            
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.send_json({
                "type": "error",
                "message": "log stream unavailable"
            })
            await websocket.close(code=1011, reason="log stream unavailable")
        except (WebSocketDisconnect, RuntimeError):
            pass
    finally:
        await _close_log_stream(logs)


@router.websocket("/ws/health")
async def ws_health(websocket: WebSocket):
    """Health check WebSocket."""
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
