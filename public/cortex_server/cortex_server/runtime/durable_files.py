from __future__ import annotations

import os
from pathlib import Path


_DIRECTORY_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
_DIRECTORY_FLAGS |= getattr(os, "O_CLOEXEC", 0)


def durable_mkdir(path: str | Path, *, mode: int = 0o700) -> None:
    """Create a directory chain and durably commit every new parent link."""

    absolute = os.path.abspath(os.fspath(path))
    directory_fd = os.open(os.path.sep, _DIRECTORY_FLAGS)
    try:
        for component in (part for part in absolute.split(os.path.sep) if part):
            try:
                child_fd = os.open(component, _DIRECTORY_FLAGS, dir_fd=directory_fd)
            except FileNotFoundError:
                try:
                    os.mkdir(component, mode=mode, dir_fd=directory_fd)
                except FileExistsError:
                    # Another writer linked the directory after our lookup. Its
                    # link still needs to be committed before either writer can
                    # safely acknowledge content below it.
                    pass
                os.fsync(directory_fd)
                child_fd = os.open(component, _DIRECTORY_FLAGS, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = child_fd
    finally:
        os.close(directory_fd)


def fsync_directory(path: str | Path) -> None:
    directory_fd = os.open(path, _DIRECTORY_FLAGS)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


__all__ = ["durable_mkdir", "fsync_directory"]
