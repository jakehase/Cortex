"""Level 17: Exoskeleton — measured tool preflight (no hard-coded health).

The old class returned the literal strings ``"Docker integrity: 100%"`` and
``"Infrastructure solid"`` without inspecting anything.  It now reports only
what it can observe: which tool binaries are on PATH, which ``tools.*``
execution actions the operator enabled, and which configured roots exist.
Read-only git inspection lives in ``routers/tools.py`` and the ``exoskeleton``
execution adapter; container and media actions stay approval-gated there.
"""

from __future__ import annotations

import shutil
from typing import Any, Dict, Optional


def tool_preflight() -> Dict[str, Any]:
    from cortex_server.modules.execution_capabilities import execution_capability_status

    binaries = {name: shutil.which(name) is not None for name in ("git", "docker", "ffmpeg")}
    policy = execution_capability_status(required_action_prefixes=("tools.",))
    return {
        "binaries": binaries,
        "enabled_actions": list(policy.get("executableActions") or []),
        "refused_unisolated_actions": sorted(
            set(policy.get("allowedActions") or []) - set(policy.get("executableActions") or [])
        ),
        "allowed_roots": list(policy.get("allowedRoots") or []),
        "capability_token_configured": bool(policy.get("capabilityTokenConfigured")),
        "docker_inspected": False,
        "note": "Binary presence and policy only; container health is not inspected here.",
    }


class Exoskeleton:
    def __init__(self) -> None:
        self.level = 17
        self.name = "Exoskeleton"

    def reinforce(self) -> Dict[str, Any]:
        """Former 'Docker integrity: 100%' stub — now the measured preflight."""
        return tool_preflight()

    def status(self) -> Dict[str, Any]:
        return {"level": self.level, "name": self.name, **tool_preflight()}


_exoskeleton: Optional[Exoskeleton] = None


def get_exoskeleton() -> Exoskeleton:
    global _exoskeleton
    if _exoskeleton is None:
        _exoskeleton = Exoskeleton()
    return _exoskeleton
