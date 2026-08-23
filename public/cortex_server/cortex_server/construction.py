"""Context-local configuration for read-only application inventories."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import os
import threading
from typing import Iterator, Optional


_CONSTRUCTION_MODE: ContextVar[str] = ContextVar(
    "cortex_construction_mode",
    default="inactive",
)
_GETENV_PATCH_LOCK = threading.RLock()
_GETENV_PATCH_DEPTH = 0
_GETENV_PATCH_PREVIOUS = None
_GETENV_PATCH_WRAPPER = None


def read_only_construction_active() -> bool:
    return _CONSTRUCTION_MODE.get() == "read_only"


def runtime_construction_active() -> bool:
    """Return true only inside an explicit runtime application factory."""

    return _CONSTRUCTION_MODE.get() == "runtime"


def construction_config(name: str, default: Optional[str] = None) -> Optional[str]:
    """Read configuration unless building a deterministic schema inventory."""

    if runtime_construction_active():
        return os.getenv(name, default)
    return default


@contextmanager
def read_only_construction(enabled: bool = True) -> Iterator[None]:
    global _GETENV_PATCH_DEPTH, _GETENV_PATCH_PREVIOUS, _GETENV_PATCH_WRAPPER

    token = _CONSTRUCTION_MODE.set("read_only" if enabled else "runtime")
    if enabled:
        with _GETENV_PATCH_LOCK:
            if _GETENV_PATCH_DEPTH == 0:
                previous = os.getenv

                def construction_aware_getenv(
                    name: str, default: Optional[str] = None
                ) -> Optional[str]:
                    if read_only_construction_active():
                        return default
                    return previous(name, default)

                _GETENV_PATCH_PREVIOUS = previous
                _GETENV_PATCH_WRAPPER = construction_aware_getenv
                os.getenv = construction_aware_getenv
            _GETENV_PATCH_DEPTH += 1
    try:
        yield
    finally:
        if enabled:
            with _GETENV_PATCH_LOCK:
                _GETENV_PATCH_DEPTH -= 1
                if _GETENV_PATCH_DEPTH == 0:
                    if os.getenv is _GETENV_PATCH_WRAPPER:
                        os.getenv = _GETENV_PATCH_PREVIOUS
                    _GETENV_PATCH_PREVIOUS = None
                    _GETENV_PATCH_WRAPPER = None
        _CONSTRUCTION_MODE.reset(token)


__all__ = [
    "construction_config",
    "read_only_construction",
    "read_only_construction_active",
    "runtime_construction_active",
]
