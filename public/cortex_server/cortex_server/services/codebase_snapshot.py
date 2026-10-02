"""Bounded provenance digest for structural-index parser candidates."""

from __future__ import annotations

import fnmatch
import hashlib
import os
from pathlib import Path
import stat
from typing import Iterable


SNAPSHOT_ALGORITHM = "sha256-path-content-v1"
SUPPORTED_EXTENSIONS = frozenset(
    {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".pdf"}
)
STANDARD_EXCLUDED_PARTS = frozenset(
    {
        ".git",
        "node_modules",
        "artifacts",
        "tmp",
        "dist",
        "coverage",
        "__pycache__",
        ".venv",
        "venv",
    }
)


def codebase_source_snapshot(
    root: Path,
    *,
    exclude_patterns: Iterable[str] = (),
    recursive: bool = True,
    max_files: int = 1000,
    max_visited_entries: int = 10_000,
    max_total_bytes: int = 50_000_000,
) -> dict[str, object]:
    """Hash every bounded file that can feed the structural parser.

    Git ignored/untracked files are deliberately included. Symlinked files are
    rejected because their lexical identity is not stable enough for a proof.
    """

    requested_root = Path(root).expanduser().absolute()
    if requested_root.is_symlink():
        raise RuntimeError("codebase snapshot root cannot be a symlink")
    source_root = requested_root.resolve(strict=True)
    if not source_root.is_dir():
        raise RuntimeError("codebase snapshot root must be a regular directory")
    patterns = tuple(str(value) for value in exclude_patterns)

    def excluded(candidate: Path) -> bool:
        relative = candidate.relative_to(source_root).as_posix()
        if STANDARD_EXCLUDED_PARTS.intersection(relative.split("/")):
            return True
        return any(fnmatch.fnmatch(relative, pattern) for pattern in patterns)

    discovered_files = 0
    visited = 0
    candidates: list[Path] = []
    directories = [(source_root, 0)]
    while directories:
        current, depth = directories.pop()
        try:
            with os.scandir(current) as scan:
                entries = sorted(scan, key=lambda entry: entry.name)
        except OSError as exc:
            raise RuntimeError(f"cannot enumerate codebase snapshot: {current}") from exc
        children = []
        for entry in entries:
            visited += 1
            if visited > max_visited_entries:
                raise RuntimeError("codebase snapshot exceeds the visited-entry limit")
            candidate = current / entry.name
            if entry.is_dir(follow_symlinks=False):
                if recursive and depth < 10 and not excluded(candidate):
                    children.append((candidate, depth + 1))
                continue
            if not entry.is_file(follow_symlinks=True):
                continue
            discovered_files += 1
            if discovered_files > max_files:
                raise RuntimeError("codebase snapshot exceeds the file-count limit")
            if excluded(candidate):
                continue
            if candidate.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            if entry.is_symlink():
                raise RuntimeError("codebase snapshot cannot include symlinked files")
            candidates.append(candidate)
        if recursive:
            directories.extend(reversed(children))

    digest = hashlib.sha256()
    total_bytes = 0
    for candidate in sorted(candidates, key=lambda path: path.relative_to(source_root).as_posix()):
        relative = candidate.relative_to(source_root).as_posix().encode("utf-8")
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(candidate, flags)
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode):
                raise RuntimeError("codebase snapshot candidate is not a regular file")
            total_bytes += int(before.st_size)
            if total_bytes > max_total_bytes:
                raise RuntimeError("codebase snapshot exceeds the byte limit")
            file_digest = hashlib.sha256()
            while True:
                chunk = os.read(descriptor, 1024 * 1024)
                if not chunk:
                    break
                file_digest.update(chunk)
            after = os.fstat(descriptor)
            if (
                before.st_dev,
                before.st_ino,
                before.st_size,
                before.st_mtime_ns,
            ) != (
                after.st_dev,
                after.st_ino,
                after.st_size,
                after.st_mtime_ns,
            ):
                raise RuntimeError("codebase snapshot candidate changed while hashing")
        finally:
            os.close(descriptor)
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        digest.update(int(before.st_size).to_bytes(8, "big"))
        digest.update(file_digest.digest())

    return {
        "algorithm": SNAPSHOT_ALGORITHM,
        "digest": digest.hexdigest(),
        "fileCount": len(candidates),
        "totalBytes": total_bytes,
    }


__all__ = ["SNAPSHOT_ALGORITHM", "codebase_source_snapshot"]
