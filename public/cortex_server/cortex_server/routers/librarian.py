"""The Librarian - Vector Memory Plugin for The Cortex.

Provides semantic memory storage and retrieval using ChromaDB.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import chromadb
from chromadb.utils import embedding_functions
import uuid
import os

router = APIRouter()

# Initialize ChromaDB client with persistent storage
CHROMA_DIR = "/root/cortex_server/chroma_db"
os.makedirs(CHROMA_DIR, exist_ok=True)
client = chromadb.PersistentClient(path=CHROMA_DIR)

# Use default embedding function (all-MiniLM-L6-v2)
embed_fn = embedding_functions.DefaultEmbeddingFunction()

# Get or create collection
COLLECTION_NAME = "cortex_memory"
collection = client.get_or_create_collection(
    name=COLLECTION_NAME,
    embedding_function=embed_fn
)


class EmbedRequest(BaseModel):
    text: str
    metadata: Optional[dict] = None


class EmbedResponse(BaseModel):
    id: str
    status: str


class SearchRequest(BaseModel):
    query: str
    n_results: int = 3


class MemoryResult(BaseModel):
    id: str
    text: str
    distance: float
    metadata: Optional[dict]


class SearchResponse(BaseModel):
    query: str
    results: List[MemoryResult]


@router.post("/embed", response_model=EmbedResponse)
async def embed_memory(request: EmbedRequest):
    """Store text in vector memory with semantic embedding."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    memory_id = str(uuid.uuid4())
    metadata = request.metadata or {}
    
    collection.add(
        ids=[memory_id],
        documents=[request.text],
        metadatas=[metadata]
    )
    
    return EmbedResponse(id=memory_id, status="stored")


@router.post("/search", response_model=SearchResponse)
async def search_memory(request: SearchRequest):
    """Search vector memory for semantically similar content."""
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    
    results = collection.query(
        query_texts=[request.query],
        n_results=request.n_results
    )
    
    memories = []
    if results["ids"] and results["ids"][0]:
        for i, memory_id in enumerate(results["ids"][0]):
            memory = MemoryResult(
                id=memory_id,
                text=results["documents"][0][i],
                distance=results["distances"][0][i] if results["distances"] else 0.0,
                metadata=results["metadatas"][0][i] if results["metadatas"] else None
            )
            memories.append(memory)
    
    return SearchResponse(query=request.query, results=memories)


@router.get("/stats")
async def memory_stats():
    """Get statistics about the memory collection."""
    count = collection.count()
    return {"total_memories": count, "collection": COLLECTION_NAME}