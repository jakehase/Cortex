"""Per-level execution adapters for the Cortex ExecutionEngine.

Each module in this package implements exactly one level and exposes:

    LEVEL: int               # 1..38
    NAME: str                # registry slug, e.g. "council"
    NEEDS_MODEL: bool        # True when run() makes a model call
    SAFE_AUTORUN: bool       # True only if run() has no side effects outside Cortex state
    DEFAULT_DEADLINE_S: float

    async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]

``run`` receives the user's current message and a context mapping with:
    principal_scope_key   per-principal key for level_model calls (required for model levels)
    memory_principal_key, tenant_id, workspace_id, channel_id   (may be empty)
    conversation          short excerpt of recent turns (may be empty)
    oracle_brief          the Oracle consult brief for this turn (may be empty)
    needs                 list of NEEDS CHECK keys answered yes

It must return a JSON-serialisable dict:
    {"operation": "<slug>.<op>",
     "origin": "model" | "deterministic",
     "summary": "<= 1500 chars: what the main assistant should know from this level",
     "data": {...bounded detail...},
     ...optional model/receipt_id/elapsed_ms}

Rules:
* Never fabricate. If the model is unavailable or output is invalid, raise
  ExecutionBlocked("model_unavailable") (or a more specific reason) — do not
  return canned text.
* Never perform external side effects (messages, writes to user files, code
  execution outside the sandbox, scheduling) from run(); those need approval
  and are not auto-run.
* Keep run() under DEFAULT_DEADLINE_S; the engine also enforces a deadline.
"""

from __future__ import annotations

import importlib
import pkgutil
from typing import Any, Dict

_REQUIRED = ("LEVEL", "NAME", "NEEDS_MODEL", "SAFE_AUTORUN", "DEFAULT_DEADLINE_S", "run")


def discover(*, errors: Dict[str, str] | None = None) -> Dict[str, Any]:
    """Import every adapter module and return {name: module} for valid ones.

    With errors supplied, a module that fails to import or violates the
    contract is recorded there (module -> error type) and skipped instead of
    aborting discovery; without it, the first problem raises.
    """

    found: Dict[str, Any] = {}
    for info in pkgutil.iter_modules(__path__):  # type: ignore[name-defined]
        if info.name.startswith("_"):
            continue
        try:
            module = importlib.import_module(f"{__name__}.{info.name}")
            if not all(hasattr(module, attr) for attr in _REQUIRED):
                raise RuntimeError(f"level adapter {info.name} is missing required attributes")
            level = int(module.LEVEL)
            if not 1 <= level <= 38:
                raise RuntimeError(f"level adapter {info.name} has invalid LEVEL {level}")
            name = str(module.NAME)
            if name in found:
                raise RuntimeError(f"duplicate level adapter for {name}")
        except Exception as exc:
            if errors is None:
                raise
            errors[info.name] = type(exc).__name__
            continue
        found[name] = module
    return found
