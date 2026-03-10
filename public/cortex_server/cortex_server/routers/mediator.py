"""
Mediator Router - Conflict resolution and arbitration.
Level 31: The Mediator finds common ground.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
from datetime import datetime

router = APIRouter()

mediations: List[Dict[str, Any]] = []


class ConflictRequest(BaseModel):
    parties: List[str]
    issue: str
    positions: Optional[Dict[str, str]] = {}
    interests: Optional[Dict[str, List[str]]] = {}


class ResolutionRequest(BaseModel):
    mediation_id: str
    proposed_resolution: str


@router.get("/status")
async def mediator_status():
    """Get Mediator status - Level 31 conflict resolution."""
    return {
        "success": True,
        "data": {
            "level": 31,
            "name": "The Mediator",
            "role": "Conflict Resolution & Arbitration",
            "status": "active",
            "mediations_conducted": len(mediations),
            "success_rate": 0.75,
            "approaches": ["negotiation", "facilitation", "arbitration"],
            "timestamp": datetime.now().isoformat()
        }
    }


@router.post("/mediate")
async def mediate_conflict(request: ConflictRequest):
    """Mediate conflict between parties."""
    mediation_id = f"med_{len(mediations)}"
    
    # Analyze positions and interests
    common_ground = []
    trade_offs = []
    sticking_points = []
    
    # Find common interests
    all_interests = []
    for party_interests in request.interests.values():
        all_interests.extend(party_interests)
    
    common = set(all_interests)
    for interests in request.interests.values():
        common = common.intersection(set(interests))
    common_ground = list(common)
    
    # Generate options
    options = [
        {
            "name": "Compromise",
            "description": "Each party gives up something to reach agreement",
            "benefits": ["Fair outcome", "Maintains relationships", "Quick resolution"],
            "drawbacks": ["No one gets everything", "May feel like losing"]
        },
        {
            "name": "Integration",
            "description": "Combine elements from all positions into new solution",
            "benefits": ["Creative solution", "Addresses all interests", "Win-win potential"],
            "drawbacks": ["Takes longer", "Requires flexibility", "Complex implementation"]
        },
        {
            "name": "Deferral",
            "description": "Set aside issue and focus on areas of agreement",
            "benefits": ["Reduces tension", "Builds trust first", "Prevents escalation"],
            "drawbacks": ["Issue remains unresolved", "May resurface later"]
        }
    ]
    
    result = {
        "mediation_id": mediation_id,
        "parties": request.parties,
        "issue": request.issue,
        "analysis": {
            "common_ground": common_ground or ["Shared desire for resolution", "Mutual benefit potential"],
            "trade_offs": trade_offs,
            "sticking_points": sticking_points or ["Differing priorities", "Communication gaps"]
        },
        "options": options,
        "recommendations": [
            "Focus on interests, not positions",
            "Generate multiple options before deciding",
            "Use objective criteria for decisions",
            "Maintain respectful communication"
        ],
        "next_steps": [
            "Schedule joint discussion session",
            "Identify objective criteria",
            "Develop BATNA (Best Alternative) for each party",
            "Set timeline for resolution"
        ],
        "status": "in_progress",
        "timestamp": datetime.now().isoformat()
    }
    
    mediations.append(result)
    
    return {
        "success": True,
        "mediation": result
    }


@router.post("/resolve")
async def propose_resolution(request: ResolutionRequest):
    """Propose resolution to mediation."""
    mediation = next((m for m in mediations if m["mediation_id"] == request.mediation_id), None)
    
    if not mediation:
        raise HTTPException(status_code=404, detail="Mediation not found")
    
    mediation["proposed_resolution"] = request.proposed_resolution
    mediation["status"] = "resolution_proposed"
    mediation["resolution_timestamp"] = datetime.now().isoformat()
    
    return {
        "success": True,
        "mediation_id": request.mediation_id,
        "resolution": request.proposed_resolution,
        "status": "awaiting_acceptance",
        "parties_must": [
            "Review proposal carefully",
            "Consult with stakeholders",
            "Respond within agreed timeframe",
            "Suggest modifications if needed"
        ]
    }


@router.get("/mediations")
async def list_mediations():
    """List all mediations."""
    return {
        "success": True,
        "mediations": mediations,
        "count": len(mediations)
    }


@router.get("/principles")
async def get_principles():
    """Get conflict resolution principles."""
    return {
        "success": True,
        "principles": [
            {
                "name": "Separate People from Problem",
                "description": "Focus on the issue, not personalities",
                "application": "Use 'I' statements, avoid blame"
            },
            {
                "name": "Focus on Interests, Not Positions",
                "description": "Understand why parties want what they want",
                "application": "Ask 'why' behind each position"
            },
            {
                "name": "Generate Options for Mutual Gain",
                "description": "Look for creative solutions that benefit all",
                "application": "Brainstorm without judging"
            },
            {
                "name": "Use Objective Criteria",
                "description": "Base decisions on fair standards",
                "application": "Reference market rates, legal precedent, expert opinion"
            }
        ]
    }


@router.post("/negotiate")
async def negotiation_tips(scenario: str):
    """Get negotiation tips for scenario."""
    return {
        "success": True,
        "scenario": scenario,
        "preparation": [
            "Research the other party's interests and constraints",
            "Determine your BATNA (Best Alternative)",
            "Identify your reservation point",
            "Prepare multiple proposals"
        ],
        "tactics": [
            "Anchor high (but reasonably)",
            "Use silence strategically",
            "Make small concessions gradually",
            "Label emotions when they arise"
        ],
        "pitfalls": [
            "Avoid positional bargaining",
            "Don't negotiate against yourself",
            "Don't accept first offer too quickly",
            "Don't ignore relationship maintenance"
        ]
    }
