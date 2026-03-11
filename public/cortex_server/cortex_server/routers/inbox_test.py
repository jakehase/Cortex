"""L93: Inbox Test - test"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/status")
async def inbox_test_status():
    return {"level": 93, "name": "Inbox Test", "status": "active"}
