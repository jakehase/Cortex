from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path
from types import ModuleType
from typing import Optional


@lru_cache(maxsize=1)
def ensure_cortex_server_import_path() -> Path:
    root = Path(__file__).resolve().parents[2]
    cortex_root = root / "public" / "cortex_server"
    if cortex_root.exists():
        text = str(cortex_root)
        if text not in sys.path:
            sys.path.insert(0, text)
    return cortex_root


@lru_cache(maxsize=None)
def optional_import(module_name: str) -> Optional[ModuleType]:
    ensure_cortex_server_import_path()
    try:
        return __import__(module_name, fromlist=["*"])
    except Exception:
        return None
