#!/usr/bin/env python3
from __future__ import annotations

import argparse
import filecmp
import glob
import hashlib
import json
from pathlib import Path
import shutil
import sys

EXCLUDED_DIRS = {
    ".git",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "node_modules",
    "artifacts",
    "backups",
    "benchmarks",
    "state",
    "logs",
    "chroma_db",
}

EXCLUDED_SUFFIXES = {
    ".env",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".crt",
    ".der",
    ".sqlite",
    ".sqlite3",
    ".db",
    ".log",
    ".pid",
    ".tar",
    ".gz",
    ".zip",
    ".jsonl",
}


def read_allowlist(path: Path) -> list[str]:
    items: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        items.append(line)
    return items


def is_excluded(rel: Path) -> bool:
    if any(part in EXCLUDED_DIRS for part in rel.parts):
        return True
    if rel.name.startswith(".env"):
        return True
    if rel.suffix.lower() in EXCLUDED_SUFFIXES:
        return True
    return False


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def collect_candidates(repo_root: Path, allowlist: list[str]) -> list[Path]:
    out: set[Path] = set()
    for pattern in allowlist:
        for hit in glob.glob(str(repo_root / pattern), recursive=True):
            p = Path(hit)
            if not p.is_file():
                continue
            rel = p.relative_to(repo_root)
            if is_excluded(rel):
                continue
            out.add(rel)
    return sorted(out)


def sync_export(repo_root: Path, export_root: Path, rel_files: list[Path], dry_run: bool) -> dict:
    copied: list[str] = []
    removed: list[str] = []

    expected = {str(p) for p in rel_files}

    # Copy/update
    for rel in rel_files:
        src = repo_root / rel
        dst = export_root / rel
        if not dst.exists() or not filecmp.cmp(src, dst, shallow=False):
            copied.append(str(rel))
            if not dry_run:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)

    # Remove stale
    if export_root.exists():
        for existing in sorted(export_root.rglob("*")):
            if not existing.is_file():
                continue
            rel = existing.relative_to(export_root)
            rels = str(rel)
            if rels == ".export-manifest.json":
                continue
            if rels not in expected:
                removed.append(rels)
                if not dry_run:
                    existing.unlink()

    # Cleanup empty dirs
    if not dry_run and export_root.exists():
        for d in sorted(export_root.rglob("*"), reverse=True):
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()

    max_mtime = 0.0
    tree_hash = hashlib.sha256()
    for rel in rel_files:
        src = repo_root / rel
        st = src.stat()
        max_mtime = max(max_mtime, st.st_mtime)
        tree_hash.update(str(rel).encode("utf-8"))
        tree_hash.update(b"\0")
        tree_hash.update(sha256(src).encode("utf-8"))
        tree_hash.update(b"\n")

    manifest = {
        "file_count": len(rel_files),
        "export_tree_sha256": tree_hash.hexdigest(),
        "files": [str(p) for p in rel_files],
    }
    manifest_path = export_root / ".export-manifest.json"
    if not dry_run:
        export_root.mkdir(parents=True, exist_ok=True)
        manifest_text = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
        previous = manifest_path.read_text(encoding="utf-8") if manifest_path.exists() else ""
        if previous != manifest_text:
            manifest_path.write_text(manifest_text, encoding="utf-8")

    return {
        "selected_count": len(rel_files),
        "copied_count": len(copied),
        "removed_count": len(removed),
        "copied": copied,
        "removed": removed,
        "max_source_mtime": max_mtime,
        "export_tree_sha256": tree_hash.hexdigest(),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", default="/opt/clawdbot")
    ap.add_argument("--allowlist", default="/opt/clawdbot/sync/export_allowlist.txt")
    ap.add_argument("--export-root", default="/opt/clawdbot/public")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    repo_root = Path(args.repo_root).resolve()
    allowlist = read_allowlist(Path(args.allowlist).resolve())
    export_root = Path(args.export_root).resolve()

    files = collect_candidates(repo_root, allowlist)
    result = sync_export(repo_root, export_root, files, args.dry_run)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
