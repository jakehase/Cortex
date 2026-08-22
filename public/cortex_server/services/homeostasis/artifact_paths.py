from __future__ import annotations

import os
from pathlib import Path


DEFAULT_R7_RELATIVE_ROOT = Path("artifacts/cortex_roadmap/r7_value_homeostasis")
DEFAULT_R9_RELATIVE_ROOT = Path("artifacts/cortex_roadmap/r9_adaptive_routing_brain")
_ARTIFACT_ROOT_ENV = "CORTEX_ARTIFACT_ROOT"
_R7_ARTIFACT_ROOT_ENV = "CORTEX_R7_ARTIFACT_ROOT"
_R9_ARTIFACT_ROOT_ENV = "CORTEX_R9_ARTIFACT_ROOT"


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _env_path(name: str) -> Path | None:
    value = str(os.getenv(name, "") or "").strip()
    return Path(value).expanduser() if value else None


def resolve_r7_root() -> Path:
    configured = _env_path(_R7_ARTIFACT_ROOT_ENV)
    if configured is not None:
        return configured
    base = _env_path(_ARTIFACT_ROOT_ENV)
    if base is not None:
        return base / DEFAULT_R7_RELATIVE_ROOT.name
    return project_root() / DEFAULT_R7_RELATIVE_ROOT


def resolve_r9_root() -> Path:
    configured = _env_path(_R9_ARTIFACT_ROOT_ENV)
    if configured is not None:
        return configured
    base = _env_path(_ARTIFACT_ROOT_ENV)
    if base is not None:
        return base / DEFAULT_R9_RELATIVE_ROOT.name
    return project_root() / DEFAULT_R9_RELATIVE_ROOT


def display_path(path: Path | str) -> str:
    target = Path(path)
    root = project_root().resolve()
    try:
        return str(target.resolve().relative_to(root))
    except Exception:
        return str(target)


__all__ = [
    "DEFAULT_R7_RELATIVE_ROOT",
    "DEFAULT_R9_RELATIVE_ROOT",
    "display_path",
    "project_root",
    "resolve_r7_root",
    "resolve_r9_root",
]
