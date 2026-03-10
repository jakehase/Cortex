"""Test plugin to verify dynamic loader works."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/hello")
async def plugin_hello():
    return {"message": "Hello from dynamic plugin!", "plugin": "plugin_test"}


@router.get("/status")
async def plugin_status():
    return {"status": "active", "loaded": True}
