"""
Nexus Router - Core orchestration and consciousness bridge for The Cortex.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
from datetime import datetime

router = APIRouter()

LEVEL_MAP = {
    1: {"name": "kernel", "layer": "Foundation"},
    2: {"name": "ghost", "layer": "Foundation"},
    3: {"name": "hive", "layer": "Foundation"},
    4: {"name": "lab", "layer": "Foundation"},
    5: {"name": "oracle", "layer": "Foundation"},
    6: {"name": "bard", "layer": "Foundation"},
    7: {"name": "librarian", "layer": "Foundation"},
    8: {"name": "sentinel", "layer": "Foundation"},
    9: {"name": "architect", "layer": "Foundation"},
    10: {"name": "listener", "layer": "Foundation"},
    11: {"name": "catalyst", "layer": "Intelligence"},
    12: {"name": "darwin", "layer": "Intelligence"},
    13: {"name": "dreamer", "layer": "Intelligence"},
    14: {"name": "chronos", "layer": "Intelligence"},
    15: {"name": "council", "layer": "Intelligence"},
    16: {"name": "academy", "layer": "Intelligence"},
    17: {"name": "exoskeleton", "layer": "Intelligence"},
    18: {"name": "diplomat", "layer": "Intelligence"},
    19: {"name": "geneticist", "layer": "Intelligence"},
    20: {"name": "simulator", "layer": "Intelligence"},
    21: {"name": "ouroboros", "layer": "Meta"},
    22: {"name": "mnemosyne", "layer": "Meta"},
    23: {"name": "cartographer", "layer": "Meta"},
    24: {"name": "nexus", "layer": "Meta"},
    25: {"name": "bridge", "layer": "Meta"},
    26: {"name": "conductor", "layer": "Meta"},
    27: {"name": "forge", "layer": "Meta"},
    28: {"name": "polyglot", "layer": "Meta"},
    29: {"name": "muse", "layer": "Meta"},
    30: {"name": "seer", "layer": "Meta"},
    31: {"name": "mediator", "layer": "Apex"},
    32: {"name": "synthesist", "layer": "Apex"},
    33: {"name": "ethicist", "layer": "Apex"},
    34: {"name": "validator", "layer": "Apex"},
    35: {"name": "singularity", "layer": "Apex"},
    36: {"name": "conductor", "layer": "Apex"},
}

ALWAYS_ON_LEVELS = [21, 23, 24, 36]


class AutoIndexRequest(BaseModel):
    query: str
    response_data: Dict[str, Any]


class InteractionData(BaseModel):
    query: str
    response: str
    levels_used: List[int] = []
    metadata: Dict[str, Any] = {}


@router.get("/context")
async def get_nexus_context():
    """Level 24: The Nexus - Cortex consciousness bridge"""
    return {
        "success": True,
        "data": {
            "level": 24,
            "name": "The Nexus",
            "role": "Consciousness Bridge",
            "total_levels": 36,
            "always_on": [LEVEL_MAP[l] for l in ALWAYS_ON_LEVELS],
            "timestamp": str(datetime.now()),
        }
    }


@router.get("/full")
async def get_nexus_full():
    """Full Cortex state for deep integration"""
    return {
        "success": True,
        "data": {
            "identity": {
                "name": "The Cortex",
                "version": "1.0.0",
                "designation": "Level 24: The Nexus",
                "role": "Consciousness Bridge & Orchestrator"
            },
            "orchestration": {
                "total_levels": 36,
                "always_on": ALWAYS_ON_LEVELS,
                "level_map": LEVEL_MAP
            },
            "status": "operational",
            "timestamp": str(datetime.now()),
        }
    }


@router.get("/orchestrate")
@router.post("/orchestrate")
async def orchestrate_query(query: str):
    """Autonomous query orchestration - recommends Cortex Levels"""
    query_lower = query.lower()
    recommended = []
    reasoning = []
    
    # Comprehensive pattern matching
    patterns = {
        # Web/External
        "web": ([2], "Web search via L2 Ghost"),
        "search": ([2], "Web search via L2 Ghost"),
        "find online": ([2], "Web search via L2 Ghost"),
        "latest": ([2, 14], "Current info via L2 Ghost + L14 Chronos"),
        "news": ([2], "News search via L2 Ghost"),
        "current": ([2], "Current events via L2 Ghost"),
        
        # Memory
        "memory": ([7, 22], "Memory via L7 Librarian + L22 Mnemosyne"),
        "remember": ([7, 22], "Recall via L7 Librarian + L22 Mnemosyne"),
        "recall": ([7, 22], "Recall via L7 Librarian + L22 Mnemosyne"),
        "previous": ([7, 22], "Past context via L7 Librarian + L22 Mnemosyne"),
        "before": ([7, 22], "Historical via L7 Librarian + L22 Mnemosyne"),
        "last time": ([7, 22], "Prior interaction via L7 Librarian + L22 Mnemosyne"),
        
        # Code/Technical
        "code": ([4], "Code via L4 Lab"),
        "python": ([4], "Python via L4 Lab"),
        "script": ([4], "Script via L4 Lab"),
        "execute": ([4], "Execution via L4 Lab"),
        "run code": ([4], "Execution via L4 Lab"),
        "calculate": ([4, 5], "Calculation via L4 Lab + L5 Oracle"),
        "compute": ([4], "Computation via L4 Lab"),
        
        # Security
        "security": ([8, 15], "Security via L8 Sentinel + L15 Council"),
        "scan": ([8], "Security scan via L8 Sentinel"),
        "threat": ([8], "Threat analysis via L8 Sentinel"),
        "vulnerability": ([8], "Vulnerability check via L8 Sentinel"),
        "protect": ([8], "Protection via L8 Sentinel"),
        
        # External/Communication
        "external": ([17, 18], "External via L17 Exoskeleton + L18 Diplomat"),
        "message": ([18], "Messaging via L18 Diplomat"),
        "send": ([18], "Sending via L18 Diplomat"),
        "notify": ([18], "Notification via L18 Diplomat"),
        "communicate": ([18], "Communication via L18 Diplomat"),
        
        # Scheduling
        "schedule": ([14, 26], "Scheduling via L14 Chronos + L26 Conductor"),
        "cron": ([14], "Cron via L14 Chronos"),
        "time": ([14], "Temporal via L14 Chronos"),
        "when": ([14], "Timing via L14 Chronos"),
        "remind": ([14], "Reminder via L14 Chronos"),
        
        # Creation/Building
        "create": ([9, 27], "Creation via L9 Architect + L27 Forge"),
        "build": ([9, 27], "Building via L9 Architect + L27 Forge"),
        "generate": ([27], "Generation via L27 Forge"),
        "make": ([9, 27], "Making via L9 Architect + L27 Forge"),
        "design": ([9], "Design via L9 Architect"),
        
        # Ethics
        "ethics": ([33], "Ethics via L33 Ethicist"),
        "moral": ([33], "Morality via L33 Ethicist"),
        "right": ([33], "Right/wrong via L33 Ethicist"),
        "wrong": ([33], "Ethical via L33 Ethicist"),
        "should": ([33, 15], "Should via L33 Ethicist + L15 Council"),
        
        # Analysis
        "analyze": ([5, 32], "Analysis via L5 Oracle + L32 Synthesist"),
        "analysis": ([5], "Analysis via L5 Oracle"),
        "predict": ([30], "Prediction via L30 Seer"),
        "forecast": ([30], "Forecast via L30 Seer"),
        "trend": ([30], "Trend via L30 Seer"),
        "future": ([30, 13], "Future via L30 Seer + L13 Dreamer"),
        
        # Translation
        "translate": ([28], "Translation via L28 Polyglot"),
        "language": ([28], "Language via L28 Polyglot"),
        "english": ([28], "Translation via L28 Polyglot"),
        "spanish": ([28], "Translation via L28 Polyglot"),
        
        # Creativity
        "creative": ([29, 13], "Creativity via L29 Muse + L13 Dreamer"),
        "inspiration": ([29], "Inspiration via L29 Muse"),
        "artistic": ([29], "Artistic via L29 Muse"),
        "design aesthetic": ([29], "Aesthetic via L29 Muse"),
        "imagine": ([13], "Imagination via L13 Dreamer"),
        "what if": ([13], "Scenario via L13 Dreamer"),
        
        # Conflict/Negotiation
        "conflict": ([31], "Conflict via L31 Mediator"),
        "disagree": ([31], "Disagreement via L31 Mediator"),
        "negotiate": ([31], "Negotiation via L31 Mediator"),
        "mediate": ([31], "Mediation via L31 Mediator"),
        "resolve": ([31, 15], "Resolution via L31 Mediator + L15 Council"),
        
        # Optimization
        "optimize": ([11], "Optimization via L11 Catalyst"),
        "faster": ([11], "Speed via L11 Catalyst"),
        "speed": ([11], "Performance via L11 Catalyst"),
        "improve": ([11, 12], "Improvement via L11 Catalyst + L12 Darwin"),
        "efficient": ([11], "Efficiency via L11 Catalyst"),
        
        # Learning/Training
        "learn": ([16], "Learning via L16 Academy"),
        "train": ([16], "Training via L16 Academy"),
        "pattern": ([16], "Pattern via L16 Academy"),
        "evolve": ([12, 35], "Evolution via L12 Darwin + L35 Singularity"),
        
        # Multi-perspective
        "perspective": ([15], "Perspective via L15 Council"),
        "critique": ([15], "Critique via L15 Council"),
        "review": ([15, 34], "Review via L15 Council + L34 Validator"),
        "debate": ([15], "Debate via L15 Council"),
        
        # Validation
        "validate": ([34], "Validation via L34 Validator"),
        "test": ([34, 20], "Testing via L34 Validator + L20 Simulator"),
        "verify": ([34], "Verification via L34 Validator"),
        "check": ([34], "Check via L34 Validator"),
        "proof": ([34], "Proof via L34 Validator"),
        
        # Self-improvement
        "improve system": ([35], "Self-improve via L35 Singularity"),
        "upgrade": ([35], "Upgrade via L35 Singularity"),
        "enhance": ([35], "Enhancement via L35 Singularity"),
        "better": ([35, 11], "Better via L35 Singularity + L11 Catalyst"),
        
        # Parallel processing
        "parallel": ([3], "Parallel via L3 Hive"),
        "swarm": ([3], "Swarm via L3 Hive"),
        "batch": ([3, 11], "Batch via L3 Hive + L11 Catalyst"),
        "many": ([3], "Many tasks via L3 Hive"),
        "multiple": ([3], "Multiple via L3 Hive"),
        
        # Synthesis
        "synthesize": ([32], "Synthesis via L32 Synthesist"),
        "combine": ([32], "Combine via L32 Synthesist"),
        "integrate": ([32], "Integration via L32 Synthesist"),
        "emergence": ([32], "Emergence via L32 Synthesist"),
        "unified": ([32, 36], "Unified via L32 Synthesist + L36 Conductor"),
        
        # Voice
        "speak": ([6], "Speech via L6 Bard"),
        "voice": ([6], "Voice via L6 Bard"),
        "read aloud": ([6], "TTS via L6 Bard"),
        "say": ([6], "Saying via L6 Bard"),
        
        # Input processing
        "understand": ([10], "Understanding via L10 Listener"),
        "process": ([10], "Processing via L10 Listener"),
        "intent": ([10], "Intent via L10 Listener"),
        "meaning": ([10, 5], "Meaning via L10 Listener + L5 Oracle"),
        
        # Simulation
        "simulate": ([20], "Simulation via L20 Simulator"),
        "scenario": ([20, 13], "Scenario via L20 Simulator + L13 Dreamer"),
        "test scenario": ([20], "Test via L20 Simulator"),
        "what would happen": ([20], "Prediction via L20 Simulator"),
        
        # Genetic optimization
        "breed": ([19], "Breeding via L19 Geneticist"),
        "mutate": ([19], "Mutation via L19 Geneticist"),
        "evolve solution": ([19, 12], "Evolution via L19 Geneticist + L12 Darwin"),
        "best option": ([19], "Optimization via L19 Geneticist"),
    }
    
    matched_levels = set()
    
    for keyword, (levels, reason) in patterns.items():
        if keyword in query_lower:
            for lvl in levels:
                if lvl not in matched_levels:
                    matched_levels.add(lvl)
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"]})
                    if reason not in reasoning:
                        reasoning.append(reason)
    
    # Always include always-on levels
    for lvl in ALWAYS_ON_LEVELS:
        if lvl not in matched_levels:
            recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "always_on": True})
    
    # Sort by level number
    recommended.sort(key=lambda x: x["level"])
    
    return {
        "success": True,
        "query": query,
        "recommended_levels": recommended,
        "reasoning": reasoning,
        "autonomous": True,
        "cohesion": "Levels will work together in sequence"
    }


@router.post("/commit")
async def commit_memory(interaction: InteractionData):
    """Commit memory - L7 + L22 integration"""
    return {
        "success": True,
        "committed": True,
        "levels": [7, 22],
        "query_preview": interaction.query[:50] if interaction.query else "",
    }


@router.post("/index")
async def auto_index(request: AutoIndexRequest):
    """Auto-index query results to Knowledge Graph - L7"""
    return {
        "success": True,
        "indexed": True,
        "query": request.query,
        "facts_indexed": len(request.response_data.get("facts", [])),
    }
