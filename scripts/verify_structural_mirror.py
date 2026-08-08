#!/usr/bin/env python3
"""Verify a manifest-bound, read-only Cortex structural-memory mirror."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def search_count(conn: sqlite3.Connection, term: str) -> int:
    return int(conn.execute("select count(*) from nodes where name like ? or uri like ?", (f"%{term}%", f"%{term}%")).fetchone()[0])


def verify(root: Path, manifest_path: Path, *, require_read_only: bool = True) -> dict[str, Any]:
    root = root.resolve()
    manifest_path = manifest_path.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    checks: list[dict[str, Any]] = []

    def check(name: str, passed: bool, observed: Any = None) -> None:
        checks.append({"name": name, "passed": bool(passed), "observed": observed})

    check("schema", manifest.get("schema") == "cortex.structural-mirror-manifest.v1", manifest.get("schema"))
    check("source_rebuilt", manifest.get("sourceRebuilt") is True, manifest.get("sourceRebuilt"))
    check("production_db_not_copied", manifest.get("productionDatabaseCopied") is False, manifest.get("productionDatabaseCopied"))
    check("manifest_under_mirror", manifest_path == root / manifest_path.name or root in manifest_path.parents, str(manifest_path))
    if require_read_only:
        check("mirror_root_read_only", (root.stat().st_mode & 0o222) == 0, oct(root.stat().st_mode & 0o777))

    resolved: dict[str, Path] = {}
    artifact_map = manifest.get("artifacts") if isinstance(manifest.get("artifacts"), dict) else {}
    required_artifacts = {
        "structural-graph.sqlite",
        "source-manifest.json",
        "index-result.json",
        "query-gate.json",
        "query_codebase_memory.py",
    }
    check("required_artifacts_declared", required_artifacts.issubset(artifact_map), sorted(artifact_map))
    for name, info in sorted(artifact_map.items()):
        rel = Path(str(info.get("path") or ""))
        path = (root / rel).resolve()
        within = path == root or root in path.parents
        check(f"artifact_{name}_within_root", within, str(rel))
        exists = within and path.is_file() and not path.is_symlink()
        check(f"artifact_{name}_exists", exists, str(rel))
        if not exists:
            continue
        resolved[name] = path
        check(f"artifact_{name}_digest", sha256_file(path) == info.get("sha256"), sha256_file(path))
        if require_read_only:
            check(f"artifact_{name}_read_only", (path.stat().st_mode & 0o222) == 0, oct(path.stat().st_mode & 0o777))

    source_manifest_path = resolved.get("source-manifest.json")
    if source_manifest_path:
        try:
            source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
            source_files = source_manifest.get("files") if isinstance(source_manifest.get("files"), list) else []
            aggregate = hashlib.sha256()
            valid_records = True
            seen_paths: set[str] = set()
            for item in source_files:
                rel = str(item.get("path") or "") if isinstance(item, dict) else ""
                digest = str(item.get("sha256") or "") if isinstance(item, dict) else ""
                safe_rel = bool(rel) and not Path(rel).is_absolute() and ".." not in Path(rel).parts and rel not in seen_paths
                valid_digest = len(digest) == 64 and all(ch in "0123456789abcdef" for ch in digest)
                valid_records = valid_records and safe_rel and valid_digest
                if safe_rel:
                    seen_paths.add(rel)
                if safe_rel and valid_digest:
                    aggregate.update(f"{digest}  {rel}\n".encode("utf-8"))
            check("source_manifest_records", valid_records and len(source_files) == source_manifest.get("fileCount"), {"records": len(source_files), "declared": source_manifest.get("fileCount")})
            check("source_manifest_digest", aggregate.hexdigest() == source_manifest.get("digest"), aggregate.hexdigest())
            declared_source = manifest.get("sourceManifest") if isinstance(manifest.get("sourceManifest"), dict) else {}
            check("source_manifest_bound", declared_source.get("digest") == source_manifest.get("digest") and declared_source.get("fileCount") == source_manifest.get("fileCount"), declared_source)
        except Exception as exc:
            check("source_manifest_parse", False, type(exc).__name__)

    db = resolved.get("structural-graph.sqlite")
    if db:
        try:
            conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            nodes = int(conn.execute("select count(*) from nodes").fetchone()[0])
            edges = int(conn.execute("select count(*) from edges").fetchone()[0])
            check("graph_nonempty", nodes > 0 and edges > 0, {"nodes": nodes, "edges": edges})
            controls = manifest.get("controls") or {}
            for term in controls.get("requiredQueries") or []:
                count = search_count(conn, str(term))
                check(f"required_query:{term}", count > 0, count)
            for term in controls.get("forbiddenQueries") or []:
                count = search_count(conn, str(term))
                check(f"forbidden_query:{term}", count == 0, count)
            conn.close()
        except Exception as exc:
            check("graph_read_only_open", False, type(exc).__name__)

    failed = [item for item in checks if not item["passed"]]
    return {
        "schema": "cortex.structural-mirror-verification.v1",
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "ok": not failed,
        "mirrorRoot": str(root),
        "manifestSha256": sha256_file(manifest_path),
        "readOnlyRequired": require_read_only,
        "checks": checks,
        "failedChecks": [item["name"] for item in failed],
        "publicationPerformed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mirror-root", required=True)
    parser.add_argument("--manifest", default="manifest.json")
    parser.add_argument("--allow-writable", action="store_true", help="test/staging only; production mirrors must omit this")
    parser.add_argument("--output")
    args = parser.parse_args()
    root = Path(args.mirror_root)
    manifest = Path(args.manifest)
    if not manifest.is_absolute():
        manifest = root / manifest
    try:
        result = verify(root, manifest, require_read_only=not args.allow_writable)
    except Exception as exc:
        result = {"schema": "cortex.structural-mirror-verification.v1", "ok": False, "error": type(exc).__name__, "publicationPerformed": False}
    text = json.dumps(result, indent=2, sort_keys=True)
    if args.output:
        out = Path(args.output); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(text + "\n")
    print(text)
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
