"""Canonical Cortex Level Registry (single source of truth).

Used by kernel/meta-conductor (and any other router) to avoid drift between
level numbers, names, and canonical status endpoints.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List

LEVEL_REGISTRY_VERSION = "cortex.level-registry.v1"


def _truthy(v: str) -> bool:
    return str(v or "").strip().lower() in {"1", "true", "yes", "on"}


def _safe_mode_enabled() -> bool:
    return _truthy(os.getenv("CORTEX_SAFE_MODE", "true"))


def get_level_registry() -> List[Dict[str, Any]]:
    """Return canonical level registry for L1..L38."""
    l9_status = "/meta_conductor/status" if _safe_mode_enabled() else "/architect/status"

    levels: List[Dict[str, Any]] = [
        {"level": 1, "name": "Kernel", "canonical_status": "/kernel/status", "aliases": ["/kernel/levels"]},
        {"level": 2, "name": "Ghost (Browser)", "canonical_status": "/browser/status", "aliases": []},
        {"level": 3, "name": "Parser", "canonical_status": "/parsers/status", "aliases": []},
        {"level": 4, "name": "Lab", "canonical_status": "/lab/status", "aliases": []},
        {"level": 5, "name": "Oracle", "canonical_status": "/oracle/status", "aliases": []},
        {"level": 6, "name": "Bard", "canonical_status": "/bard/status", "aliases": []},
        {"level": 7, "name": "Librarian", "canonical_status": "/librarian/status", "aliases": []},
        {"level": 8, "name": "Cron", "canonical_status": "/cron/status", "aliases": []},
        {"level": 9, "name": "Architect", "canonical_status": l9_status, "aliases": ["/architect/status"]},
        {"level": 10, "name": "Listener", "canonical_status": "/listener/status", "aliases": []},
        {"level": 11, "name": "Catalyst", "canonical_status": "/catalyst/status", "aliases": []},
        {"level": 12, "name": "Hive/Darwin", "canonical_status": "/hive/status", "aliases": ["/darwin/status"]},
        {"level": 13, "name": "Dreamer", "canonical_status": "/dreamer/status", "aliases": []},
        {"level": 14, "name": "Chronos (Night Shift)", "canonical_status": "/night_shift/status", "aliases": ["/chronos/status"]},
        {"level": 15, "name": "Council", "canonical_status": "/council/status", "aliases": []},
        {"level": 16, "name": "Academy", "canonical_status": "/academy/status", "aliases": []},
        {"level": 17, "name": "Exoskeleton", "canonical_status": "/tools/status", "aliases": []},
        {"level": 18, "name": "Diplomat", "canonical_status": "/diplomat/status", "aliases": []},
        {"level": 19, "name": "Geneticist", "canonical_status": "/geneticist/status", "aliases": []},
        {"level": 20, "name": "Simulator", "canonical_status": "/simulator/status", "aliases": []},
        {"level": 21, "name": "Sentinel", "canonical_status": "/sentinel/status", "aliases": ["/sentinel/scheduler/status"]},
        {"level": 22, "name": "Mnemosyne", "canonical_status": "/knowledge/status", "aliases": []},
        {"level": 23, "name": "Cartographer", "canonical_status": "/mirror/status", "aliases": []},
        {"level": 24, "name": "Nexus", "canonical_status": "/nexus/status", "aliases": ["/nexus/context", "/nexus/full"]},
        {"level": 25, "name": "Bridge", "canonical_status": "/bridge/status", "aliases": []},
        {"level": 26, "name": "Orchestrator", "canonical_status": "/conductor/status", "aliases": ["/orchestrator/status"]},
        {"level": 27, "name": "Forge", "canonical_status": "/forge/status", "aliases": []},
        {"level": 28, "name": "Polyglot", "canonical_status": "/polyglot/status", "aliases": []},
        {"level": 29, "name": "Muse", "canonical_status": "/muse/status", "aliases": []},
        {"level": 30, "name": "Seer", "canonical_status": "/seer/status", "aliases": []},
        {"level": 31, "name": "Mediator", "canonical_status": "/mediator/status", "aliases": []},
        {"level": 32, "name": "Synthesist", "canonical_status": "/synthesist_api/status", "aliases": []},
        {"level": 33, "name": "Ethicist", "canonical_status": "/ethicist/status", "aliases": []},
        {"level": 34, "name": "Validator", "canonical_status": "/validator/status", "aliases": []},
        {"level": 35, "name": "Singularity", "canonical_status": "/singularity/status", "aliases": []},
        {"level": 36, "name": "Conductor (Meta)", "canonical_status": "/meta_conductor/status", "aliases": ["/conductor/status", "/orchestrator/status"]},
        {"level": 37, "name": "Awareness", "canonical_status": "/awareness/status", "aliases": []},
        {"level": 38, "name": "Augmenter", "canonical_status": "/augmenter/status", "aliases": []},
    ]
    return levels


def get_level_entry(level: int) -> Dict[str, Any] | None:
    for row in get_level_registry():
        if int(row.get("level", -1)) == int(level):
            return row
    return None
