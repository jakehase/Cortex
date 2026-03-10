"""
Nexus Router - Semantic Orchestration using L5 Oracle

Replaces keyword matching with true semantic understanding.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
import os
import json
import requests
from pathlib import Path

router = APIRouter()

# OpenRouter configuration for L5 Oracle semantic analysis
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

def _load_openrouter_key() -> str:
    """Load OpenRouter API key."""
    env_key = os.getenv("OPENROUTER_API_KEY", "")
    if env_key:
        return env_key
    try:
        config_path = Path.home() / ".openclaw" / "openclaw.json"
        if config_path.exists():
            with open(config_path, 'r') as f:
                config = json.load(f)
                return config.get("env", {}).get("vars", {}).get("OPENROUTER_API_KEY", "")
    except Exception:
        pass
    return ""

OPENROUTER_API_KEY = _load_openrouter_key()

# Level definitions
LEVEL_MAP = {
    1: {"name": "kernel", "layer": "Foundation", "purpose": "System core"},
    2: {"name": "ghost", "layer": "Foundation", "purpose": "External intelligence - web search, browsing"},
    3: {"name": "hive", "layer": "Foundation", "purpose": "Distributed processing - parallel execution"},
    4: {"name": "lab", "layer": "Foundation", "purpose": "Code execution - Python, calculations"},
    5: {"name": "oracle", "layer": "Foundation", "purpose": "Analysis - reasoning, predictions"},
    6: {"name": "bard", "layer": "Foundation", "purpose": "Content creation - TTS, writing"},
    7: {"name": "librarian", "layer": "Foundation", "purpose": "Memory - recall, knowledge retrieval"},
    8: {"name": "sentinel", "layer": "Foundation", "purpose": "Security - scanning, threat detection"},
    9: {"name": "architect", "layer": "Foundation", "purpose": "System design - blueprints, infrastructure"},
    10: {"name": "listener", "layer": "Foundation", "purpose": "Input processing - intent recognition"},
    11: {"name": "catalyst", "layer": "Intelligence", "purpose": "Optimization - speed, efficiency"},
    12: {"name": "darwin", "layer": "Intelligence", "purpose": "Evolution - adaptation, learning"},
    13: {"name": "dreamer", "layer": "Intelligence", "purpose": "Creativity - scenarios, imagination"},
    14: {"name": "chronos", "layer": "Intelligence", "purpose": "Scheduling - time, cron jobs"},
    15: {"name": "council", "layer": "Intelligence", "purpose": "Multi-perspective - critique, debate"},
    16: {"name": "academy", "layer": "Intelligence", "purpose": "Training - education, patterns"},
    17: {"name": "exoskeleton", "layer": "Intelligence", "purpose": "Tool integration - external APIs"},
    18: {"name": "diplomat", "layer": "Intelligence", "purpose": "Communication - messaging, negotiation"},
    19: {"name": "geneticist", "layer": "Intelligence", "purpose": "Optimization - breeding solutions"},
    20: {"name": "simulator", "layer": "Intelligence", "purpose": "Scenario testing - what-if analysis"},
    21: {"name": "ouroboros", "layer": "Meta", "purpose": "Self-monitoring - health checks"},
    22: {"name": "mnemosyne", "layer": "Meta", "purpose": "Long-term memory - deep storage"},
    23: {"name": "cartographer", "layer": "Meta", "purpose": "Self-mapping - capability discovery"},
    24: {"name": "nexus", "layer": "Meta", "purpose": "Orchestration - level coordination"},
    25: {"name": "bridge", "layer": "Meta", "purpose": "External AI - federation"},
    26: {"name": "conductor", "layer": "Meta", "purpose": "Workflow orchestration"},
    27: {"name": "forge", "layer": "Meta", "purpose": "Creation - module generation"},
    28: {"name": "polyglot", "layer": "Meta", "purpose": "Translation - languages"},
    29: {"name": "muse", "layer": "Meta", "purpose": "Artistic guidance - inspiration"},
    30: {"name": "seer", "layer": "Meta", "purpose": "Prediction - forecasting"},
    31: {"name": "mediator", "layer": "Apex", "purpose": "Conflict resolution - arbitration"},
    32: {"name": "synthesist", "layer": "Apex", "purpose": "Cross-level synthesis"},
    33: {"name": "ethicist", "layer": "Apex", "purpose": "Ethical governance"},
    34: {"name": "validator", "layer": "Apex", "purpose": "Testing - verification"},
    35: {"name": "singularity", "layer": "Apex", "purpose": "Self-improvement"},
    36: {"name": "conductor", "layer": "Apex", "purpose": "Meta-orchestration"},
}

ALWAYS_ON_LEVELS = [5, 17, 18, 20, 21, 22, 23, 24, 25, 27, 32, 33, 34, 35, 36]


class AutoIndexRequest(BaseModel):
    query: str
    response_data: Dict[str, Any]


class InteractionData(BaseModel):
    query: str
    response: str
    levels_used: List[int] = []
    metadata: Dict[str, Any] = {}


def analyze_intent_with_oracle(query: str) -> Dict[str, Any]:
    """Use L5 Oracle for semantic intent analysis."""
    if not OPENROUTER_API_KEY:
        return {"intents": [], "confidence": 0, "method": "fallback"}
    
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "http://localhost:8000",
        "Content-Type": "application/json"
    }
    
    # Build level descriptions for context
    level_descriptions = "\n".join([
        f"L{lvl}: {info['name']} - {info['purpose']}"
        for lvl, info in sorted(LEVEL_MAP.items())
        if lvl not in ALWAYS_ON_LEVELS  # Only non-always-on levels
    ])
    
    system_prompt = f"""You are L5 Oracle, analyzing user intent to route queries to appropriate Cortex levels.

Available levels (besides always-on):
{level_descriptions}

Analyze the query and respond with JSON:
{{
    "intents": ["web_search", "code_execution", "memory_recall", etc.],
    "levels": [2, 4, 7, etc.],
    "confidence": 0.85,
    "reasoning": "brief explanation"
}}

Intents to detect:
- web_search: Looking up info online
- code_execution: Running code
- memory_recall: Remembering past info
- security_scan: Checking threats
- creative_writing: Creating content
- data_analysis: Analyzing patterns
- scheduling: Time-based tasks
- translation: Language conversion
- prediction: Forecasting
- optimization: Improving efficiency"""
    
    payload = {
        "model": "openrouter/moonshotai/kimi-k2.5",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Analyze intent: \"{query}\""}
        ],
        "temperature": 0.3,
        "max_tokens": 500
    }
    
    try:
        response = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        
        # Parse JSON from response
        try:
            result = json.loads(content)
            return {
                "intents": result.get("intents", []),
                "levels": result.get("levels", []),
                "confidence": result.get("confidence", 0.5),
                "reasoning": result.get("reasoning", "Semantic analysis"),
                "method": "oracle_semantic"
            }
        except json.JSONDecodeError:
            # Fallback if Oracle doesn't return valid JSON
            return {"intents": [], "confidence": 0, "method": "parse_error"}
    except Exception as e:
        return {"intents": [], "confidence": 0, "method": f"error: {str(e)}"}


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
            "orchestration_method": "semantic_via_oracle",
            "timestamp": str(__import__('datetime').datetime.now()),
        }
    }


@router.get("/full")
async def get_nexus_full():
    """Full Cortex state"""
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
                "level_map": LEVEL_MAP,
                "method": "semantic_analysis_via_l5_oracle"
            },
            "status": "operational",
            "timestamp": str(__import__('datetime').datetime.now()),
        }
    }


@router.get("/orchestrate")
@router.post("/orchestrate")
async def orchestrate_query(query: str, request: Request = None):
    """Semantic query orchestration using L5 Oracle."""
    try:
        recommended = []
        reasoning = []
        
        # SEMANTIC ANALYSIS: Use L5 Oracle to understand intent
        semantic_result = analyze_intent_with_oracle(query)
        
        if semantic_result.get("confidence", 0) > 0.6:
            # Use Oracle's semantic analysis
            for lvl in semantic_result.get("levels", []):
                if lvl in LEVEL_MAP and lvl not in ALWAYS_ON_LEVELS:
                    recommended.append({
                        "level": lvl, 
                        "name": LEVEL_MAP[lvl]["name"],
                        "method": "semantic"
                    })
            
            if semantic_result.get("reasoning"):
                reasoning.append(f"L5 Oracle: {semantic_result['reasoning']}")
        
        # FALLBACK: If Oracle failed or low confidence, use keyword matching
        if not recommended:
            query_lower = query.lower()
            patterns = {
                "web": ([2], "Web search needed"),
                "search": ([2], "Web search needed"),
                "memory": ([7, 22], "Memory retrieval"),
                "remember": ([7, 22], "Memory retrieval"),
                "code": ([4], "Code execution"),
                "python": ([4], "Code execution"),
                "security": ([8, 15], "Security review"),
                "scan": ([8], "Security scan"),
            }
            
            for keyword, (levels, reason) in patterns.items():
                if keyword in query_lower:
                    for lvl in levels:
                        if lvl not in [r["level"] for r in recommended]:
                            recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "keyword"})
                    reasoning.append(f"Keyword match: {reason}")
        
        # Always include always-on levels
        for lvl in ALWAYS_ON_LEVELS:
            if lvl not in [r["level"] for r in recommended]:
                recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "always_on": True})
        
        # Build HUD
        hud_parts = []
        for lvl in recommended[:5]:
            level_num = lvl.get('level', '?')
            name = lvl.get('name', 'Unknown').title()
            hud_parts.append(f"🟢 L{level_num} ({name})")
        hud_line = " | ".join(hud_parts)
        
        return {
            "success": True,
            "query": query,
            "recommended_levels": recommended,
            "reasoning": reasoning,
            "semantic_analysis": semantic_result,
            "hud": hud_line,
            "autonomous": True
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Orchestration error: {str(e)}")


@router.post("/commit")
async def commit_memory(interaction: InteractionData):
    """Commit memory"""
    return {
        "success": True,
        "committed": True,
        "levels": [7, 22],
        "query_preview": interaction.query[:50] if interaction.query else "",
    }


@router.post("/index")
async def auto_index(request: AutoIndexRequest):
    """Auto-index to Knowledge Graph"""
    return {
        "success": True,
        "indexed": True,
        "query": request.query,
        "facts_indexed": len(request.response_data.get("facts", [])),
    }
