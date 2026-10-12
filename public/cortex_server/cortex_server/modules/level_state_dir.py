"""Durable state directory resolution for repaired Cortex levels.

Levels must not write state into the release tree (``/app/...``) or into a
cwd-relative path. This resolves an absolute per-level directory, in order:

1. the level's explicit environment variable (must be absolute);
2. ``$CORTEX_ARTIFACT_ROOT/<slug>``;
3. ``/opt/clawdbot/state/<slug>`` when the durable state volume exists;
4. ``$XDG_STATE_HOME/cortex/<slug>`` or ``~/.local/state/cortex/<slug>``.

Nothing is created on import or resolution; callers create the directory
lazily on first write with :func:`ensure_level_state_dir`.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

_DURABLE_STATE_ROOT = Path("/opt/clawdbot/state")
_SLUG_RE = re.compile(r"[^a-z0-9_-]")


def level_state_dir(slug: str, env_var: str | None = None) -> Path:
    name = _SLUG_RE.sub("_", str(slug or "level").lower())[:48] or "level"
    if env_var:
        configured = os.getenv(env_var, "").strip()
        if configured:
            root = Path(configured).expanduser()
            if not root.is_absolute():
                raise ValueError(f"{env_var} must be an absolute path")
            return root
    artifact_root = os.getenv("CORTEX_ARTIFACT_ROOT", "").strip()
    if artifact_root:
        root = Path(artifact_root).expanduser() / name
    elif _DURABLE_STATE_ROOT.is_dir():
        root = _DURABLE_STATE_ROOT / name
    elif os.getenv("XDG_STATE_HOME", "").strip():
        root = Path(os.environ["XDG_STATE_HOME"]).expanduser() / "cortex" / name
    else:
        root = Path.home() / ".local" / "state" / "cortex" / name
    if not root.is_absolute():
        raise ValueError("level state directory must be absolute")
    return root


def ensure_level_state_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path
