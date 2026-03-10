"""
Listener Router - Input processing and pattern recognition.
Level 10: The Listener understands what you need.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
from datetime import datetime
import re

router = APIRouter()


class ProcessRequest(BaseModel):
    input: str
    context: Optional[Dict[str, Any]] = {}


class IntentRecognition(BaseModel):
    intent: str
    confidence: float
    entities: List[Dict[str, Any]]


@router.get("/status")
async def listener_status():
    """Get Listener status - Level 10 input processing."""
    return {
        "success": True,
        "data": {
            "level": 10,
            "name": "The Listener",
            "role": "Input Processing",
            "status": "active",
            "patterns_loaded": 50,
            "languages": ["en"],
            "timestamp": datetime.now().isoformat()
        }
    }


@router.post("/process")
async def process_input(request: ProcessRequest):
    """Process and understand input."""
    input_lower = request.input.lower()
    
    # Intent detection
    intents = []
    
    if any(w in input_lower for w in ["search", "find", "look", "get"]):
        intents.append({"intent": "search", "confidence": 0.9})
    
    if any(w in input_lower for w in ["create", "make", "build", "generate"]):
        intents.append({"intent": "create", "confidence": 0.85})
    
    if any(w in input_lower for w in ["help", "assist", "support"]):
        intents.append({"intent": "help", "confidence": 0.8})
    
    if any(w in input_lower for w in ["analyze", "check", "review"]):
        intents.append({"intent": "analyze", "confidence": 0.88})
    
    # Entity extraction
    entities = []
    
    # Extract potential file paths
    file_pattern = r'[\w\-\.]+\.(py|js|json|txt|md|yml|yaml)'
    files = re.findall(file_pattern, request.input)
    for f in files:
        entities.append({"type": "file", "value": f})
    
    # Extract URLs
    url_pattern = r'https?://[^\s<>"{}|\\^`[\]]+'
    urls = re.findall(url_pattern, request.input)
    for u in urls:
        entities.append({"type": "url", "value": u})
    
    return {
        "success": True,
        "input": request.input[:100],
        "intents": intents or [{"intent": "general", "confidence": 0.5}],
        "entities": entities,
        "sentiment": "neutral",
        "urgency": "normal"
    }


@router.post("/intent")
async def recognize_intent(request: ProcessRequest) -> IntentRecognition:
    """Recognize intent from input."""
    input_lower = request.input.lower()
    
    intent_scores = {
        "query": 0.0,
        "command": 0.0,
        "question": 0.0,
        "statement": 0.0
    }
    
    # Question detection
    if "?" in request.input or any(w in input_lower for w in ["what", "how", "why", "when", "where"]):
        intent_scores["question"] = 0.9
    
    # Command detection
    if any(w in input_lower for w in ["do", "run", "execute", "start", "stop", "create", "delete"]):
        intent_scores["command"] = 0.85
    
    # Query detection
    if any(w in input_lower for w in ["search", "find", "get", "show", "list"]):
        intent_scores["query"] = 0.9
    
    # Default to statement
    if sum(intent_scores.values()) == 0:
        intent_scores["statement"] = 0.7
    
    # Get highest scoring intent
    top_intent = max(intent_scores, key=intent_scores.get)
    
    return IntentRecognition(
        intent=top_intent,
        confidence=intent_scores[top_intent],
        entities=[]
    )


@router.get("/patterns")
async def get_patterns():
    """Get recognized patterns."""
    return {
        "success": True,
        "patterns": [
            {"name": "question", "regex": r".*\\?.*"},
            {"name": "command", "regex": r"^(do|run|execute|create|delete)\\s"},
            {"name": "query", "regex": r"(search|find|get|show)\\s"},
            {"name": "url", "regex": r"https?://[^\\s]+"},
            {"name": "file", "regex": r"[\\w\\-]+\\.[a-zA-Z]{2,4}"}
        ]
    }
