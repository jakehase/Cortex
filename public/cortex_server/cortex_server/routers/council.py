"""
Council Router - Multi-perspective analysis and critique.
Level 15: The Council plays devil's advocate.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
from datetime import datetime

router = APIRouter()

deliberations: List[Dict[str, Any]] = []


class DeliberationRequest(BaseModel):
    topic: str
    perspectives: List[str] = ["pro", "con", "neutral"]
    context: Optional[Dict[str, Any]] = {}


class CritiqueRequest(BaseModel):
    proposal: str
    aspects: List[str] = ["feasibility", "risk", "cost", "ethics"]


@router.get("/status")
async def council_status():
    """Get Council status - Level 15 multi-perspective analysis."""
    return {
        "success": True,
        "data": {
            "level": 15,
            "name": "The Council",
            "role": "Multi-Perspective Analysis",
            "status": "active",
            "members": ["analyst", "skeptic", "optimist", "pragmatist", "ethicist"],
            "deliberations_count": len(deliberations),
            "timestamp": datetime.now().isoformat()
        }
    }


@router.post("/deliberate")
async def deliberate(request: DeliberationRequest):
    """Deliberate on a topic from multiple perspectives."""
    delib_id = f"delib_{len(deliberations)}"
    
    perspectives_result = []
    
    for perspective in request.perspectives:
        if perspective == "pro":
            perspectives_result.append({
                "perspective": "pro",
                "viewpoint": "Supportive",
                "arguments": [
                    "Potential benefits outweigh risks",
                    "Aligns with long-term goals",
                    "Resource requirements are manageable"
                ],
                "confidence": 0.75
            })
        elif perspective == "con":
            perspectives_result.append({
                "perspective": "con",
                "viewpoint": "Critical",
                "arguments": [
                    "Implementation challenges may be underestimated",
                    "Alternative approaches may be more effective",
                    "Risk of unintended consequences"
                ],
                "confidence": 0.70
            })
        elif perspective == "neutral":
            perspectives_result.append({
                "perspective": "neutral",
                "viewpoint": "Objective",
                "arguments": [
                    "Requires more data for definitive assessment",
                    "Trade-offs need careful consideration",
                    "Timing and context are crucial factors"
                ],
                "confidence": 0.80
            })
    
    result = {
        "deliberation_id": delib_id,
        "topic": request.topic,
        "perspectives": perspectives_result,
        "consensus": "further_analysis_needed",
        "recommendations": [
            "Gather additional data before deciding",
            "Consult domain experts",
            "Develop contingency plans"
        ],
        "timestamp": datetime.now().isoformat()
    }
    
    deliberations.append(result)
    
    return {
        "success": True,
        "deliberation": result
    }


@router.post("/critique")
async def critique_proposal(request: CritiqueRequest):
    """Critique a proposal across multiple aspects."""
    critiques = []
    
    for aspect in request.aspects:
        if aspect == "feasibility":
            critiques.append({
                "aspect": "feasibility",
                "score": 0.7,
                "assessment": "Technically feasible with current resources",
                "concerns": ["May require specialized expertise", "Timeline could be optimistic"]
            })
        elif aspect == "risk":
            critiques.append({
                "aspect": "risk",
                "score": 0.6,
                "assessment": "Moderate risk level",
                "concerns": ["Dependency on external factors", "Implementation complexity"]
            })
        elif aspect == "cost":
            critiques.append({
                "aspect": "cost",
                "score": 0.75,
                "assessment": "Cost-effective approach",
                "concerns": ["Hidden costs may emerge", "Maintenance overhead"]
            })
        elif aspect == "ethics":
            critiques.append({
                "aspect": "ethics",
                "score": 0.85,
                "assessment": "Ethically sound",
                "concerns": ["Consider broader implications", "Ensure transparency"]
            })
    
    return {
        "success": True,
        "proposal": request.proposal[:100],
        "critiques": critiques,
        "overall_score": sum(c["score"] for c in critiques) / len(critiques) if critiques else 0,
        "verdict": "Proceed with caution" if critiques else "Insufficient data"
    }


@router.get("/perspectives")
async def get_perspectives():
    """Get available perspectives."""
    return {
        "success": True,
        "perspectives": [
            {"name": "pro", "description": "Supportive viewpoint", "focus": "Benefits and opportunities"},
            {"name": "con", "description": "Critical viewpoint", "focus": "Risks and challenges"},
            {"name": "neutral", "description": "Objective viewpoint", "focus": "Facts and data"},
            {"name": "optimist", "description": "Positive outlook", "focus": "Best case scenarios"},
            {"name": "pessimist", "description": "Cautious outlook", "focus": "Worst case scenarios"}
        ]
    }
