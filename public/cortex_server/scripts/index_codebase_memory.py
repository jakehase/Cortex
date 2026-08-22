#!/usr/bin/env python3
"""Index a repository into Cortex's structural code graph.

This is the practical Cortex-native equivalent of the codebase-memory "index this
project" flow. It runs offline so large repositories do not block the FastAPI
request loop, then Cortex serves the resulting graph through /knowledge/structural/*.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cortex_server.models.requests import ParseDirectoryRequest  # noqa: E402
from cortex_server.services.parser_service import ParserService  # noqa: E402

DEFAULT_EXCLUDES = [
    "node_modules/**",
    "artifacts/**",
    ".git/**",
    "tmp/**",
    "dist/**",
    "coverage/**",
    "**/*.min.js",
]


def clear_graph(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("DELETE FROM edges")
        conn.execute("DELETE FROM nodes")
        conn.commit()
    finally:
        conn.close()


async def run(args: argparse.Namespace) -> dict:
    repo = Path(args.repo).resolve()
    if not repo.exists() or not repo.is_dir():
        raise SystemExit(f"repo directory not found: {repo}")

    db_path = Path(args.db).resolve()
    os.environ["CORTEX_DB_PATH"] = str(db_path)

    if args.clear:
        clear_graph(db_path)

    service = ParserService()
    request = ParseDirectoryRequest(
        directory=str(repo),
        recursive=not args.no_recursive,
        exclude_patterns=args.exclude,
    )
    started = time.time()
    result = await service.parse_directory(request)
    result.update({
        "sourceRepo": str(repo),
        "dbPath": str(db_path),
        "elapsedSeconds": round(time.time() - started, 3),
        "mode": "offline_structural_code_memory_index",
    })

    if args.artifact:
        artifact = Path(args.artifact).resolve()
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text(json.dumps(result, indent=2), encoding="utf-8")
        result["artifactPath"] = str(artifact)

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", help="repository/codebase directory to index")
    parser.add_argument(
        "--db",
        default=str(ROOT / "cortex_graph.db"),
        help="Cortex structural graph SQLite DB path",
    )
    parser.add_argument("--artifact", help="optional JSON proof artifact path")
    parser.add_argument("--clear", action="store_true", help="clear existing graph before indexing")
    parser.add_argument("--no-recursive", action="store_true", help="only index top-level files")
    parser.add_argument(
        "--exclude",
        action="append",
        default=list(DEFAULT_EXCLUDES),
        help="exclude glob; can be repeated",
    )
    args = parser.parse_args()
    result = asyncio.run(run(args))
    summary = {
        key: result.get(key)
        for key in [
            "sourceRepo",
            "dbPath",
            "files_seen",
            "files_skipped",
            "files_parsed",
            "nodes_added",
            "edges_added",
            "elapsedSeconds",
            "artifactPath",
        ]
    }
    summary["graph"] = result.get("graph")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
