"""
Muse Router - Inspiration and artistic guidance.
Level 29: The Muse provides creative direction.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
from datetime import datetime
import random

router = APIRouter()

inspirations: List[Dict[str, Any]] = []


class InspirationRequest(BaseModel):
    domain: str = "general"  # writing, visual, music, design, code
    mood: Optional[str] = None
    constraints: Optional[Dict[str, Any]] = {}


class AestheticRequest(BaseModel):
    project_type: str
    style_preferences: List[str] = []


@router.get("/status")
async def muse_status():
    """Get Muse status - Level 29 artistic guidance."""
    return {
        "success": True,
        "data": {
            "level": 29,
            "name": "The Muse",
            "role": "Inspiration & Artistic Guidance",
            "status": "active",
            "domains": ["writing", "visual", "music", "design", "code", "general"],
            "inspirations_generated": len(inspirations),
            "timestamp": datetime.now().isoformat()
        }
    }


@router.post("/inspire")
async def get_inspiration(request: InspirationRequest):
    """Get creative inspiration for domain."""
    inspiration_id = f"insp_{len(inspirations)}"
    
    inspiration_templates = {
        "writing": [
            "Write from the perspective of an inanimate object",
            "Tell a story using only dialogue",
            "Begin with the ending and work backwards",
            "Combine two unrelated genres"
        ],
        "visual": [
            "Use only complementary colors",
            "Create something using only geometric shapes",
            "Work with extreme contrast",
            "Focus on negative space"
        ],
        "music": [
            "Use only three notes",
            "Create a rhythm without percussion",
            "Write a melody that tells a story",
            "Experiment with unusual time signatures"
        ],
        "design": [
            "Design for accessibility first",
            "Use the golden ratio throughout",
            "Create with mobile constraints",
            "Design without any text"
        ],
        "code": [
            "Solve it recursively",
            "Use a functional approach",
            "Optimize for readability over performance",
            "Write it as a state machine"
        ],
        "general": [
            "Combine two seemingly unrelated ideas",
            "Remove the most obvious solution",
            "Add an unexpected constraint",
            "Approach from the opposite direction"
        ]
    }
    
    prompts = inspiration_templates.get(request.domain, inspiration_templates["general"])
    prompt = random.choice(prompts)
    
    result = {
        "inspiration_id": inspiration_id,
        "domain": request.domain,
        "mood": request.mood or "creative",
        "prompt": prompt,
        "suggestions": [
            "Set a timer for 25 minutes and create without editing",
            "Gather 5 reference examples before starting",
            "Write down 10 bad ideas first to clear your mind",
            "Change your environment before beginning"
        ],
        "constraints": request.constraints,
        "timestamp": datetime.now().isoformat()
    }
    
    inspirations.append(result)
    
    return {
        "success": True,
        "inspiration": result
    }


@router.post("/aesthetic")
async def aesthetic_guidance(request: AestheticRequest):
    """Provide aesthetic guidance for project."""
    style_guide = {
        "minimalist": {
            "principles": ["Less is more", "Whitespace is active", "Form follows function"],
            "colors": ["Monochrome", "Muted tones", "High contrast"],
            "typography": ["Sans-serif", "Ample line height", "Hierarchy through size"]
        },
        "vibrant": {
            "principles": ["Bold statements", "Energy and movement", "Emotional impact"],
            "colors": ["Saturated primaries", "Neon accents", "Gradient transitions"],
            "typography": ["Display fonts", "Varied weights", "Experimental layouts"]
        },
        "elegant": {
            "principles": ["Refined details", "Timeless appeal", "Sophisticated restraint"],
            "colors": ["Deep jewel tones", "Metallic accents", "Soft neutrals"],
            "typography": ["Serif fonts", "Classic proportions", "Delicate details"]
        },
        "modern": {
            "principles": ["Clean lines", "Functional beauty", "Contemporary relevance"],
            "colors": ["Pure whites", "Bold blacks", "Strategic color pops"],
            "typography": ["Geometric sans", "Consistent spacing", "Clear hierarchy"]
        }
    }
    
    # Select style based on preferences or default
    selected_style = "modern"
    if request.style_preferences:
        for style in request.style_preferences:
            if style.lower() in style_guide:
                selected_style = style.lower()
                break
    
    return {
        "success": True,
        "project_type": request.project_type,
        "style": selected_style,
        "guidance": style_guide[selected_style],
        "recommendations": [
            "Create a mood board before starting",
            "Define 3-5 core elements and stick to them",
            "Get feedback at 25%, 50%, and 75% completion",
            "Document your design decisions"
        ]
    }


@router.get("/prompts")
async def get_creative_prompts(domain: Optional[str] = None):
    """Get creative prompts."""
    all_prompts = {
        "writing": ["Write about a world where color doesn't exist", "Describe a sound using only visual metaphors"],
        "visual": ["Create using only circles and lines", "Depict time without clocks or calendars"],
        "music": ["Compose a piece that gets progressively quieter", "Create a rhythm from nature sounds"],
        "design": ["Design for someone with opposite preferences", "Create using only one shape"]
    }
    
    if domain and domain in all_prompts:
        prompts = all_prompts[domain]
    else:
        prompts = [p for sublist in all_prompts.values() for p in sublist]
    
    return {
        "success": True,
        "domain": domain or "all",
        "prompts": prompts
    }
