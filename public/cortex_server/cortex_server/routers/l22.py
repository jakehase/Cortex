"""L22 compatibility router.

Provides stable endpoints expected by OpenClaw config:
- POST /l22/store
- POST /l22/search
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import uuid
from cortex_server.routers.librarian import collection

router = APIRouter()


class L22StoreRequest(BaseModel):
    type: Optional[str] = "memory"
    content: str
    tags: Optional[List[str]] = None
    metadata: Optional[dict] = None


class L22SearchRequest(BaseModel):
    query: str
    n_results: int = 5


@router.post("/store")
async def l22_store(request: L22StoreRequest):
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    memory_id = str(uuid.uuid4())
    metadata = request.metadata or {}
    metadata.setdefault("type", request.type or "memory")
    if request.tags:
        metadata.setdefault("tags", request.tags)

    collection.add(ids=[memory_id], documents=[request.content], metadatas=[metadata])
    return {"id": memory_id, "status": "stored"}


@router.post("/search")
async def l22_search(request: L22SearchRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    results = collection.query(query_texts=[request.query], n_results=request.n_results)
    memories = []
    if results.get("ids") and results["ids"][0]:
        for i, memory_id in enumerate(results["ids"][0]):
            memories.append(
                {
                    "id": memory_id,
                    "text": results["documents"][0][i],
                    "distance": results["distances"][0][i] if results.get("distances") else 0.0,
                    "metadata": results["metadatas"][0][i] if results.get("metadatas") else None,
                }
            )

    return {"query": request.query, "results": memories}
