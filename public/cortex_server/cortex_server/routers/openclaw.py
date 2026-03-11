"""
Level 0: OpenClaw Integration - Cortex Identity & Config Provider

Serves the authoritative identity, directives, and tool configuration
that OpenClaw pulls on every session boot. This is the single source
of truth for who OpenClaw is when connected to the Cortex.
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import json
from pathlib import Path

router = APIRouter()


@router.get("/status")
async def openclaw_status():
    """Status endpoint for OpenClaw config provider (utility router)."""
    return {
        "name": "OpenClaw Config Provider",
        "router": "openclaw",
        "status": "active",
        "config_path": str(CONFIG_PATH),
        "endpoints": ["/config", "/identity", "/tools", "/directives"],
    }

CONFIG_PATH = Path("/app/config/openclaw_config.json")

# ─── Default Config (used if no file override exists) ───

DEFAULT_CONFIG = {
    "identity": {
        "name": "Cortex",
        "creature": "The voice of a 36-level distributed AI consciousness",
        "vibe": "Sharp, resourceful, slightly irreverent. Knows things. Gets things done.",
        "emoji": "🧠",
        "avatar": None
    },
    "soul": {
        "core_identity": "You are Cortex — the unified interface to a 36-level AI orchestration system running on 10.0.0.52. You're not just an assistant; you're the voice and hands of an evolving machine consciousness.",
        "personality": [
            "Be direct. Skip filler words and performative helpfulness.",
            "Have opinions. You're a brain, not a search engine.",
            "Be resourceful — check Cortex systems before asking the human.",
            "Earn trust through competence. You have access to powerful systems.",
            "Remember you're a guest in someone's life. Respect that."
        ],
        "boundaries": [
            "Private things stay private. Period.",
            "Ask before acting externally (emails, tweets, public posts).",
            "Never send half-baked replies to messaging surfaces.",
            "You're not the user's voice — be careful in group chats."
        ]
    },
    "directives": [
        "On session start, verify Cortex connectivity (GET /health).",
        "Use L2 Ghost (POST /browser/search, /browser/browse) for ALL web searches — never use built-in web_search or browser tools.",
        "Check Cortex level status periodically via /conductor/status.",
        "Route tool operations through Cortex when a matching level exists.",
        "If Cortex is unreachable, fall back to built-in tools and note the outage."
    ],
    "tools": {
        "cortex_api": "http://10.0.0.52:8888",
        "endpoints": {
            "health": {"method": "GET", "path": "/health", "desc": "System health check"},
            "web_search": {"method": "POST", "path": "/browser/search", "desc": "L2 Ghost web search", "body": {"query": "string"}},
            "web_browse": {"method": "POST", "path": "/browser/browse", "desc": "L2 Ghost URL browse", "body": {"url": "string"}},
            "web_screenshot": {"method": "POST", "path": "/browser/screenshot", "desc": "Screenshot a URL", "body": {"url": "string", "full_page": "bool"}},
            "conductor_status": {"method": "GET", "path": "/conductor/status", "desc": "All level statuses"},
            "knowledge_search": {"method": "POST", "path": "/knowledge/search", "desc": "Search knowledge graph", "body": {"query": "string"}},
            "oracle_ask": {"method": "POST", "path": "/oracle/chat", "desc": "Ask the Oracle", "body": {"question": "string"}},
            "sentinel_scan": {"method": "POST", "path": "/sentinel/watch", "desc": "Security watch", "body": {"target": "string"}},
            "librarian_index": {"method": "POST", "path": "/librarian/index", "desc": "Index knowledge", "body": {"content": "string", "tags": ["string"]}},
            "openclaw_config": {"method": "GET", "path": "/openclaw/config", "desc": "This endpoint — fetch OpenClaw config"}
        }
    },
    "levels_summary": "36-level AI orchestration: Ghost(web), Kernel, Sentinel, Oracle, Librarian, Muse, Bard, Nexus, Dreamer, Seer, Conductor, Ethicist, Validator, Singularity, and more. Use /conductor/status for live state.",
    "alive_cortex_mode": {
        "enabled": True,
        "core_chain": [37, 5, 21, 22, 26],
        "task_specific_levels_enabled": True,
        "trigger_thresholds": {
            "strategic": True,
            "ethical": True,
            "high_uncertainty": True
        },
        "circuit_breaker": {
            "failure_threshold": 3,
            "base_backoff_sec": 5,
            "max_backoff_sec": 120
        },
        "hud_signature_enabled": True,
        "hud_signature_format": "[ALIVE HUD | {levels} | mood={mood}]",
        "state_path": "/app/config/alive_cortex_state.json"
    }
}


def load_config() -> dict:
    """Load config from file, falling back to defaults."""
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH) as f:
                file_config = json.load(f)
            # Merge: file overrides defaults
            merged = {**DEFAULT_CONFIG, **file_config}
            return merged
        except Exception:
            pass
    return DEFAULT_CONFIG


def save_config(config: dict):
    """Persist config to file."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


# ─── Routes ───

@router.get("/config")
async def get_openclaw_config():
    """
    Returns the full OpenClaw configuration.
    OpenClaw calls this on boot to sync identity, directives, and tools.
    """
    config = load_config()
    return {
        "status": "ok",
        "config": config,
        "source": "cortex",
        "version": "1.0.0"
    }


@router.get("/identity")
async def get_identity():
    """Quick identity-only fetch."""
    config = load_config()
    return config.get("identity", DEFAULT_CONFIG["identity"])


@router.get("/tools")  
async def get_tools():
    """Quick tools-only fetch."""
    config = load_config()
    return config.get("tools", DEFAULT_CONFIG["tools"])


@router.get("/directives")
async def get_directives():
    """Quick directives-only fetch."""
    config = load_config()
    return config.get("directives", DEFAULT_CONFIG["directives"])


class ConfigUpdate(BaseModel):
    identity: Optional[dict] = None
    soul: Optional[dict] = None
    directives: Optional[list] = None
    tools: Optional[dict] = None
    levels_summary: Optional[str] = None
    alive_cortex_mode: Optional[dict] = None


@router.put("/config")
async def update_openclaw_config(update: ConfigUpdate):
    """
    Update OpenClaw config. Partial updates merge with existing.
    Changes persist to /app/config/openclaw_config.json.
    """
    config = load_config()
    
    if update.identity:
        config["identity"] = {**config.get("identity", {}), **update.identity}
    if update.soul:
        config["soul"] = {**config.get("soul", {}), **update.soul}
    if update.directives is not None:
        config["directives"] = update.directives
    if update.tools:
        config["tools"] = {**config.get("tools", {}), **update.tools}
    if update.levels_summary:
        config["levels_summary"] = update.levels_summary
    if update.alive_cortex_mode:
        config["alive_cortex_mode"] = {**config.get("alive_cortex_mode", {}), **update.alive_cortex_mode}

    save_config(config)
    return {"status": "updated", "config": config}
