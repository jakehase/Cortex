"""
WebSocket Router - Real-time communication endpoints.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio
import json

router = APIRouter()


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
    from cortex_server.tools.docker_wrapper import Docker
    
    await websocket.accept()
    docker = Docker()
    
    try:
        async for line in docker.containers.logs(container_id, follow=True, tail=100):
            await websocket.send_text(line)
            # Small delay to prevent overwhelming the client
            await asyncio.sleep(0.01)
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })
        await websocket.close()


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