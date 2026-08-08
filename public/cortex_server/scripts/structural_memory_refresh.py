#!/usr/bin/env python3
"""Rebuild a structural graph from source and emit an immutable mirror bundle.

This command always creates a new SQLite database from source. It has no option to
copy a production graph/database, user data, or runtime state into the bundle.
"""
from __future__ import annotations

import argparse
import asyncio
import fnmatch
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import index_codebase_memory as indexer  # noqa: E402
import query_codebase_memory as query  # noqa: E402

SOURCE_SUFFIXES = {
    ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".go", ".rs",
    ".java", ".kt", ".kts", ".c", ".h", ".cc", ".cpp", ".hpp", ".rb",
    ".php", ".sh", ".sql", ".vue", ".svelte",
}
DEFAULT_EXCLUDES = tuple(indexer.DEFAULT_EXCLUDES) + (".venv/**", "venv/**", "__pycache__/**", "*.pyc")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _excluded(relative: str, patterns: Iterable[str]) -> bool:
    normalized = relative.replace(os.sep, "/")
    return any(fnmatch.fnmatch(normalized, pattern) or fnmatch.fnmatch(Path(normalized).name, pattern) for pattern in patterns)


def source_manifest(root: Path, excludes: Iterable[str] = DEFAULT_EXCLUDES) -> dict[str, Any]:
    root = root.resolve()
    records: list[dict[str, Any]] = []
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        rel = path.relative_to(root).as_posix()
        if _excluded(rel, excludes) or path.suffix.lower() not in SOURCE_SUFFIXES:
            continue
        file_digest = sha256_file(path)
        record = {"path": rel, "sha256": file_digest, "bytes": path.stat().st_size}
        records.append(record)
        digest.update(f"{file_digest}  {rel}\n".encode("utf-8"))
    return {"algorithm": "sha256", "digest": digest.hexdigest(), "fileCount": len(records), "files": records}


def graph_stats(db: Path) -> dict[str, int]:
    conn = query.connect_ro(db)
    try:
        stats = query.stats(conn)
        return {"nodeCount": int(stats["nodeCount"]), "edgeCount": int(stats["edgeCount"])}
    finally:
        conn.close()


def immutable_write_json(path: Path, payload: dict[str, Any]) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o444)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
    except Exception:
        path.unlink(missing_ok=True)
        raise


def make_manifest(bundle: Path, source_root: Path, source: dict[str, Any], known: list[str], negative: list[str], index_result: dict[str, Any]) -> dict[str, Any]:
    artifacts = {}
    for name in ("structural-graph.sqlite", "source-manifest.json", "index-result.json", "query-gate.json", "query_codebase_memory.py"):
        path = bundle / name
        artifacts[name] = {"path": name, "sha256": sha256_file(path), "bytes": path.stat().st_size}
    return {
        "schema": "cortex.structural-mirror-manifest.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceRoot": str(source_root.resolve()),
        "sourceManifest": {"algorithm": source["algorithm"], "digest": source["digest"], "fileCount": source["fileCount"]},
        "sourceRebuilt": True,
        "productionDatabaseCopied": False,
        "graph": graph_stats(bundle / "structural-graph.sqlite"),
        "controls": {"requiredQueries": known, "forbiddenQueries": negative},
        "indexSummary": {key: index_result.get(key) for key in ("files_seen", "files_skipped", "files_parsed", "nodes_added", "edges_added")},
        "artifacts": artifacts,
        "publicationState": "candidate_not_published",
        "readOnlyRequiredAtMirror": True,
    }


async def refresh(args: argparse.Namespace) -> dict[str, Any]:
    source_root = Path(args.source).resolve()
    bundle = Path(args.output_dir).resolve()
    if not source_root.is_dir():
        raise SystemExit(f"source directory not found: {source_root}")
    if bundle.exists():
        raise SystemExit(f"output directory already exists (refusing overwrite): {bundle}")
    bundle.mkdir(parents=True, mode=0o755)
    db = bundle / "structural-graph.sqlite"
    source_artifact = bundle / "source-manifest.json"
    index_artifact = bundle / "index-result.json"
    query_gate_artifact = bundle / "query-gate.json"
    helper = bundle / "query_codebase_memory.py"
    try:
        source = source_manifest(source_root, args.exclude)
        if source["fileCount"] == 0:
            raise RuntimeError("source manifest contains no indexable source files")
        source_artifact.write_text(json.dumps(source, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        index_args = SimpleNamespace(
            repo=str(source_root), db=str(db), artifact=str(index_artifact), clear=True,
            no_recursive=False, exclude=list(args.exclude),
        )
        index_result = await indexer.run(index_args)
        shutil.copyfile(SCRIPTS / "query_codebase_memory.py", helper)
        conn = query.connect_ro(db)
        try:
            gate = query.query_gate(conn, args.require_query, args.forbid_query)
            gate["graph"] = query.stats(conn)
        finally:
            conn.close()
        query_gate_artifact.write_text(json.dumps(gate, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if not gate["ok"]:
            raise RuntimeError("known-symbol/negative-query gate failed")
        manifest = make_manifest(bundle, source_root, source, args.require_query, args.forbid_query, index_result)
        immutable_write_json(bundle / "manifest.json", manifest)
        for path in bundle.iterdir():
            if path.is_file():
                path.chmod(0o444)
        bundle.chmod(0o555)
        return manifest
    except Exception:
        # Preserve failed bundle as evidence, but never label it immutable/publishable.
        failure = bundle / "refresh-failure.json"
        try:
            failure.write_text(json.dumps({"ok": False, "error": sys.exc_info()[0].__name__}, indent=2) + "\n")
        except Exception:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--require-query", action="append", required=True)
    parser.add_argument("--forbid-query", action="append", required=True)
    parser.add_argument("--exclude", action="append", default=list(DEFAULT_EXCLUDES))
    args = parser.parse_args()
    result = asyncio.run(refresh(args))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
