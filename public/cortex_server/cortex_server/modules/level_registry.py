"""Canonical Cortex level identity registry.

Every level consumer derives its number, display name, route prefix, status
target, category, and always-on policy from this immutable registry.  Aliases
are compatibility routes only; no alias may be another level's canonical
target.
"""
from __future__ import annotations

from typing import Any, Dict, List


LEVEL_REGISTRY_VERSION = "cortex.level-registry.v2"

_ALWAYS_ON = frozenset({5, 17, 18, 20, 21, 22, 23, 24, 25, 27, 32, 33, 34, 35, 36})

# Routing semantics live beside identity so Oracle, Nexus, HUD, and topology
# consumers cannot silently drift onto different level definitions.
_PURPOSES: Dict[int, str] = {
    1: "System metrics, hardware state, core process health, and kernel control",
    2: "Web search, URL browsing, scraping, and current external information",
    3: "Document, source-code, and structured-content parsing",
    4: "Sandboxed code execution, calculations, and algorithm experiments",
    5: "Deep reasoning, analysis, explanation, and general knowledge",
    6: "Text-to-speech, voice synthesis, and audio generation",
    7: "Vector memory search, semantic retrieval, and durable recall",
    8: "Cron scheduling, periodic tasks, and timed execution",
    9: "System design, module creation, and infrastructure blueprints",
    10: "Audio transcription, input analysis, and intent recognition",
    11: "Performance profiling, bottleneck analysis, and optimization",
    12: "Distributed task execution, swarm processing, and evolution coordination",
    13: "Gap analysis, creative scenarios, and improvement discovery",
    14: "Night-shift scheduling, maintenance cycles, and temporal coordination",
    15: "Multi-perspective deliberation, critique, and risk assessment",
    16: "Learning, teaching, study material, and pattern extraction",
    17: "External tools, containers, version control, and media utilities",
    18: "External messaging, HTTP communication, and negotiation",
    19: "Code evolution, mutation, refactoring, and solution selection",
    20: "Scenario simulation, counterfactual analysis, and outcome prediction",
    21: "Security scanning, system health monitoring, and self-healing",
    22: "Knowledge graphs, structured memory, and entity relationships",
    23: "System mapping, level discovery, and topology visualization",
    24: "Query orchestration and semantic level selection",
    25: "External AI federation and cross-system relay",
    26: "Multi-step workflows, pipelines, and process orchestration",
    27: "Module generation, router scaffolding, and reviewed code creation",
    28: "Translation, language detection, and multilingual processing",
    29: "Creative writing, brainstorming, ideation, and inspiration",
    30: "Prediction, forecasting, trends, and future scenarios",
    31: "Conflict resolution, mediation, and compromise",
    32: "Cross-level synthesis, pattern discovery, and meta-analysis",
    33: "Ethical evaluation, privacy, fairness, and safety review",
    34: "Data validation, schema checking, and verification",
    35: "Self-improvement analysis and automated code review",
    36: "Meta-orchestration, system coordination, and aggregate health",
    37: "Self-awareness, internal state, curiosity, and initiative",
    38: "Intent augmentation, response repair, and control-surface guidance",
}


def _category(level: int) -> str:
    if level <= 10:
        return "Foundation"
    if level <= 19:
        return "Intelligence"
    if level <= 27:
        return "Metacognition"
    if level <= 30:
        return "Singularity"
    return "Apex"


def _row(
    level: int,
    name: str,
    slug: str,
    route_prefix: str,
    canonical_status: str,
    *,
    aliases: tuple[str, ...] = (),
) -> Dict[str, Any]:
    return {
        "level": level,
        "name": name,
        "slug": slug,
        "route_prefix": route_prefix,
        "canonical_status": canonical_status,
        "aliases": list(aliases),
        "category": _category(level),
        "layer": _category(level),
        "purpose": _PURPOSES[level],
        "always_on": level in _ALWAYS_ON,
        "registry_version": LEVEL_REGISTRY_VERSION,
    }


_LEVELS: tuple[Dict[str, Any], ...] = (
    _row(1, "Kernel", "kernel", "/kernel", "/kernel/status", aliases=("/kernel/levels",)),
    _row(2, "Ghost (Browser)", "ghost", "/browser", "/browser/status"),
    _row(3, "Parser", "parser", "/parsers", "/parsers/status"),
    _row(4, "Lab", "lab", "/lab", "/lab/status"),
    _row(5, "Oracle", "oracle", "/oracle", "/oracle/status"),
    _row(6, "Bard", "bard", "/bard", "/bard/status"),
    _row(7, "Librarian", "librarian", "/librarian", "/librarian/status"),
    _row(8, "Cron", "cron", "/cron", "/cron/status"),
    _row(9, "Architect", "architect", "/architect", "/architect/status"),
    _row(10, "Listener", "listener", "/listener", "/listener/status"),
    _row(11, "Catalyst", "catalyst", "/catalyst", "/catalyst/status"),
    _row(12, "Hive/Darwin", "hive", "/hive", "/hive/status", aliases=("/darwin/status",)),
    _row(13, "Dreamer", "dreamer", "/dreamer", "/dreamer/status"),
    _row(14, "Chronos (Night Shift)", "chronos", "/night_shift", "/night_shift/status", aliases=("/chronos/status",)),
    _row(15, "Council", "council", "/council", "/council/status"),
    _row(16, "Academy", "academy", "/academy", "/academy/status"),
    _row(17, "Exoskeleton", "exoskeleton", "/tools", "/tools/status"),
    _row(18, "Diplomat", "diplomat", "/diplomat", "/diplomat/status"),
    _row(19, "Geneticist", "geneticist", "/geneticist", "/geneticist/status"),
    _row(20, "Simulator", "simulator", "/simulator", "/simulator/status"),
    _row(21, "Sentinel", "sentinel", "/sentinel", "/sentinel/status", aliases=("/sentinel/scheduler/status",)),
    _row(22, "Mnemosyne", "mnemosyne", "/knowledge", "/knowledge/status"),
    _row(23, "Cartographer", "cartographer", "/mirror", "/mirror/status"),
    _row(24, "Nexus", "nexus", "/nexus", "/nexus/status", aliases=("/nexus/context", "/nexus/full")),
    _row(25, "Bridge", "bridge", "/bridge", "/bridge/status"),
    _row(26, "Orchestrator", "orchestrator", "/orchestrator", "/orchestrator/status", aliases=("/conductor/status",)),
    _row(27, "Forge", "forge", "/forge", "/forge/status"),
    _row(28, "Polyglot", "polyglot", "/polyglot", "/polyglot/status"),
    _row(29, "Muse", "muse", "/muse", "/muse/status"),
    _row(30, "Seer", "seer", "/seer", "/seer/status"),
    _row(31, "Mediator", "mediator", "/mediator", "/mediator/status"),
    _row(32, "Synthesist", "synthesist", "/synthesist_api", "/synthesist_api/status"),
    _row(33, "Ethicist", "ethicist", "/ethicist", "/ethicist/status"),
    _row(34, "Validator", "validator", "/validator", "/validator/status"),
    _row(35, "Singularity", "singularity", "/singularity", "/singularity/status"),
    _row(36, "Conductor (Meta)", "meta_conductor", "/meta_conductor", "/meta_conductor/status"),
    _row(37, "Awareness", "awareness", "/awareness", "/awareness/status"),
    _row(38, "Augmenter", "augmenter", "/augmenter", "/augmenter/status"),
)


def _validate_registry() -> None:
    levels = [int(row["level"]) for row in _LEVELS]
    if levels != list(range(1, 39)):
        raise RuntimeError("level registry must contain L1 through L38 exactly once")
    canonical = [str(row["canonical_status"]) for row in _LEVELS]
    if len(canonical) != len(set(canonical)):
        raise RuntimeError("canonical level status targets must be unique")
    canonical_set = set(canonical)
    all_aliases: list[str] = []
    for row in _LEVELS:
        if canonical_set.intersection(row["aliases"]):
            raise RuntimeError(
                f"level {row['level']} alias collides with a canonical status target"
            )
        all_aliases.extend(str(alias) for alias in row["aliases"])
        if not str(row["purpose"]).strip():
            raise RuntimeError(f"level {row['level']} must declare a routing purpose")
    if len(all_aliases) != len(set(all_aliases)):
        raise RuntimeError("level status aliases must be unique")


_validate_registry()


def get_level_registry() -> List[Dict[str, Any]]:
    """Return defensive copies of the canonical L1..L38 registry."""
    return [{**row, "aliases": list(row["aliases"])} for row in _LEVELS]


def get_level_entry(level: int) -> Dict[str, Any] | None:
    try:
        row = _LEVELS[int(level) - 1]
    except (IndexError, TypeError, ValueError):
        return None
    if int(row["level"]) != int(level):
        return None
    return {**row, "aliases": list(row["aliases"])}


def get_route_level_hints() -> Dict[str, Dict[str, Any]]:
    """Map registered route roots to canonical HUD identity hints."""
    hints: Dict[str, Dict[str, Any]] = {}
    for row in _LEVELS:
        roots = {str(row["route_prefix"]).strip("/").split("/")[0]}
        roots.update(
            str(path).strip("/").split("/")[0]
            for path in row["aliases"]
        )
        for root in roots - {""}:
            hints[root] = {
                "level": int(row["level"]),
                "name": str(row["name"]),
                "registry_version": LEVEL_REGISTRY_VERSION,
            }
    # L22 compatibility router is a second API surface of Mnemosyne.
    hints["l22"] = {
        "level": 22,
        "name": "Mnemosyne",
        "registry_version": LEVEL_REGISTRY_VERSION,
    }
    return hints
