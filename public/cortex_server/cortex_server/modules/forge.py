"""Level 27: The Forge — legacy in-process helper (no ungated writes).

The original class created directories under ``/app`` on construction and its
``generate_module`` wrote ``.py`` files into ``modules/generated`` with no
approval gate (``autonomous_scan`` even auto-generated "high priority" modules).
``propose_enhancement`` returned canned benefit claims ("Reduce API calls by
60%") that were never measured.

Code creation now happens only through the router's reviewed flow
(``POST /forge/propose`` → Council → approve → ``/forge/commit``, each behind an
action capability and execution grant).  This class keeps the read-only pieces:

* ``detect_gaps`` — keyword matching of desired capabilities against module
  names (labelled ``keyword_match``; used by Singularity);
* ``list_generated`` / ``status`` — read existing records, create nothing.

``generate_module`` / ``generate_from_gap`` raise :class:`ForgeWriteForbidden`.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

GAP_METHOD = "keyword_match"


class ForgeWriteForbidden(PermissionError):
    """Module generation must go through the approval-gated /forge/propose flow."""


class Forge:
    """Read-only legacy Forge helper."""

    def __init__(self):
        self.level = 27
        self.name = "Forge"
        self.forge_path = Path('/app/cortex_server/forge')
        self.generated_path = Path('/app/cortex_server/modules/generated')
        self.patterns = {"method_templates": {name: None for name in (
            "data_processor", "analyzer", "transformer", "monitor", "connector")}}

    def status(self) -> Dict[str, Any]:
        return {
            "level": self.level,
            "name": self.name,
            "mode": "read_only_legacy_helper",
            "generated_modules": self._count_generated(),
            "generation": "disabled here; use POST /forge/propose (approval-gated)",
        }

    def _count_generated(self) -> int:
        try:
            return len(list(self.generated_path.glob('*.py'))) if self.generated_path.is_dir() else 0
        except OSError:
            return 0

    def detect_gaps(self, current_modules: List[str], desired_capabilities: List[str]) -> List[dict]:
        """Keyword-match desired capabilities against module names (heuristic)."""
        capability_keywords = {
            "web_scraping": ["scrap", "crawl", "extract"],
            "data_analysis": ["analy", "process", "compute"],
            "communication": ["send", "notify", "message", "email"],
            "storage": ["store", "save", "persist", "archive"],
            "ml_inference": ["predict", "classify", "model", "ml"],
            "visualization": ["chart", "graph", "visual", "plot"],
            "security": ["encrypt", "auth", "secure", "protect"],
            "integration": ["connect", "api", "webhook", "sync"],
        }
        gaps = []
        for capability in desired_capabilities:
            keywords = capability_keywords.get(capability, [capability])
            exists = any(any(kw in str(module).lower() for kw in keywords) for module in current_modules)
            if not exists:
                gaps.append({
                    "capability": capability,
                    "priority": "high" if capability in ["security", "storage"] else "medium",
                    "suggested_module": f"{capability}_engine",
                    "pattern_match": self._match_pattern(capability),
                    "method": GAP_METHOD,
                })
        return gaps

    def _match_pattern(self, capability: str) -> str:
        pattern_map = {
            "web_scraping": "data_processor",
            "data_analysis": "analyzer",
            "communication": "connector",
            "storage": "data_processor",
            "ml_inference": "analyzer",
            "visualization": "transformer",
            "security": "monitor",
            "integration": "connector",
        }
        return pattern_map.get(capability, "data_processor")

    def autonomous_scan(self, current_modules: List[str] | None = None,
                        desired_capabilities: List[str] | None = None) -> Dict[str, Any]:
        """Report gaps only. Never generates or writes modules."""
        gaps = self.detect_gaps(list(current_modules or []), list(desired_capabilities or []))
        return {
            "scan_time": datetime.now().isoformat(),
            "gaps_found": len(gaps),
            "gaps": gaps,
            "auto_generated": [],
            "note": "Automatic generation is disabled; propose code via POST /forge/propose.",
        }

    def generate_module(self, spec: dict) -> dict:
        raise ForgeWriteForbidden(
            "Forge.generate_module no longer writes files; use the approval-gated POST /forge/propose flow"
        )

    def generate_from_gap(self, gap: dict) -> dict:
        raise ForgeWriteForbidden(
            "Forge.generate_from_gap no longer writes files; use the approval-gated POST /forge/propose flow"
        )

    def list_generated(self) -> List[dict]:
        modules: List[dict] = []
        records_file = self.forge_path / 'generated_modules.jsonl'
        try:
            if records_file.is_file():
                with open(records_file, 'r') as f:
                    for line in f:
                        if line.strip():
                            try:
                                modules.append(json.loads(line))
                            except ValueError:
                                continue
        except OSError:
            pass
        return modules

    def propose_enhancement(self, target_module: str) -> dict:
        """No canned proposals: enhancement ideas must come from a reviewed source."""
        return {
            "target_module": target_module,
            "proposals": [],
            "note": "Canned enhancement claims were removed; use POST /forge/review or /architect/design.",
            "timestamp": datetime.now().isoformat(),
        }


_forge = None


def get_forge():
    """Get or create singleton instance (no filesystem side effects)."""
    global _forge
    if _forge is None:
        _forge = Forge()
    return _forge
