#!/usr/bin/env python3
"""Rebuild an oversized L22 Codec ledger without discarding session continuity.

Keeps the newest source snapshot for every lookup key, removes projections that are
recomputed on read, updates fingerprints, atomically installs the compact ledger,
and retains the original database as a reversible quarantine artifact.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from typing import Any

sys.path.insert(0, "/root/clawd/public/cortex_server")
from cortex_server.modules.cortex_codec import (  # noqa: E402
    _compact_codec_state,
    _migrate_codec_state,
    _state_fingerprint,
)

DERIVED_KEYS = {"durable_write", "memory_facts", "promotion_state", "rollup_state", "schema_state"}
SCHEMA = """
CREATE TABLE structured_memory (
    id TEXT PRIMARY KEY,
    memory_type TEXT NOT NULL,
    lookup_key TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
)
"""
INDEX = "CREATE INDEX idx_structured_memory_type_key_created ON structured_memory(memory_type, lookup_key, created_at DESC)"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_view(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": state.get("version", "cortex.codec.v1"),
        "schema_version": state.get("schema_version", "cortex.codec.schema.v1"),
        "identity_state": state.get("identity_state", {}),
        "project_state": state.get("project_state", {}),
        "world_state": state.get("world_state", {}),
        "failure_state": state.get("failure_state", {}),
        "outcome_state": state.get("outcome_state", {}),
        "utility_state": state.get("utility_state", {}),
        "promotion_state": state.get("promotion_state", {}),
        "schema_state": state.get("schema_state", {}),
    }


def fingerprint(state: dict[str, Any]) -> str:
    raw = json.dumps(stable_view(state), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temp, path)


def service_is_inactive(service: str) -> bool:
    result = subprocess.run(["systemctl", "is-active", "--quiet", service], check=False)
    return result.returncode != 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="/app/cortex_server/chroma_db/l22_structured.sqlite3")
    parser.add_argument("--service", default="cortex.service")
    parser.add_argument("--artifact-dir", default="/root/clawd/artifacts/memory-audit/incident-20260722")
    parser.add_argument("--max-codec-bytes", type=int, default=524_288)
    args = parser.parse_args()

    source = Path(args.source)
    artifact_dir = Path(args.artifact_dir)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    state_path = artifact_dir / f"l22-compaction-{run_id}-state.json"
    manifest_path = artifact_dir / f"l22-compaction-{run_id}-manifest.json"
    temp_db = source.with_name(f"{source.name}.compact-{run_id}.tmp")
    quarantine = source.with_name(f"{source.name}.quarantine-{run_id}")

    state: dict[str, Any] = {
        "schema": "cortex.l22.compaction-state.v1",
        "run_id": run_id,
        "status": "starting",
        "source": str(source),
        "temp_db": str(temp_db),
        "quarantine": str(quarantine),
        "started_at": now_iso(),
        "processed": 0,
    }
    write_json(state_path, state)

    if not source.is_file():
        raise SystemExit(f"source database not found: {source}")
    if not service_is_inactive(args.service):
        raise SystemExit(f"refusing rebuild while {args.service} is active")
    if temp_db.exists() or quarantine.exists():
        raise SystemExit("refusing to overwrite an existing temp/quarantine database")

    source_stat = source.stat()
    source_uri = f"file:{source}?mode=ro"
    src = sqlite3.connect(source_uri, uri=True, timeout=30)
    src.row_factory = sqlite3.Row
    dst = sqlite3.connect(str(temp_db), timeout=30)
    dst.execute("PRAGMA journal_mode=DELETE")
    dst.execute("PRAGMA synchronous=FULL")
    dst.execute(SCHEMA)

    source_rows = int(src.execute("SELECT count(*) FROM structured_memory").fetchone()[0])
    source_sessions = int(src.execute("SELECT count(DISTINCT lookup_key) FROM structured_memory").fetchone()[0])
    latest_query = """
        SELECT s.id, s.memory_type, s.lookup_key, s.content, s.metadata_json, s.created_at
        FROM structured_memory AS s
        JOIN (
            SELECT lookup_key, MAX(rowid) AS latest_rowid
            FROM structured_memory
            GROUP BY lookup_key
        ) AS latest ON latest.latest_rowid = s.rowid
        ORDER BY s.rowid
    """

    compacted_bytes = 0
    invalid_json = 0
    derived_removed_rows = 0
    max_record_bytes = 0
    repaired_at = now_iso()
    try:
        for row in src.execute(latest_query):
            original_content = str(row["content"] or "")
            try:
                parsed = json.loads(original_content)
            except Exception:
                parsed = None
            if isinstance(parsed, dict):
                if any(key in parsed for key in DERIVED_KEYS):
                    derived_removed_rows += 1
                compact = _compact_codec_state(_migrate_codec_state(parsed))
                content = json.dumps(compact, ensure_ascii=False, sort_keys=True)
            else:
                invalid_json += 1
                compact = {}
                content = original_content

            content_bytes = len(content.encode("utf-8"))
            max_record_bytes = max(max_record_bytes, content_bytes)
            if row["memory_type"] == "codec_state" and content_bytes > args.max_codec_bytes:
                raise RuntimeError(f"compacted Codec record remains oversized: {row['id']} ({content_bytes} bytes)")

            try:
                metadata = json.loads(row["metadata_json"] or "{}")
            except Exception:
                metadata = {}
            if isinstance(compact, dict) and compact:
                metadata["codec_fingerprint"] = _state_fingerprint(compact)
            metadata["codec_compacted_at"] = repaired_at
            metadata["codec_compaction_version"] = "cortex.codec.compaction.v1"

            dst.execute(
                "INSERT INTO structured_memory(id,memory_type,lookup_key,content,metadata_json,created_at) VALUES (?,?,?,?,?,?)",
                (
                    row["id"], row["memory_type"], row["lookup_key"], content,
                    json.dumps(metadata, ensure_ascii=False, sort_keys=True), row["created_at"],
                ),
            )
            compacted_bytes += content_bytes
            state["processed"] += 1
            if state["processed"] % 100 == 0:
                dst.commit()
                state.update({"status": "rebuilding", "updated_at": now_iso(), "source_rows": source_rows, "source_sessions": source_sessions})
                write_json(state_path, state)
        dst.execute(INDEX)
        dst.commit()
        integrity = str(dst.execute("PRAGMA integrity_check").fetchone()[0])
        rebuilt_rows = int(dst.execute("SELECT count(*) FROM structured_memory").fetchone()[0])
        rebuilt_sessions = int(dst.execute("SELECT count(DISTINCT lookup_key) FROM structured_memory").fetchone()[0])
    except Exception:
        state.update({"status": "failed", "failed_at": now_iso()})
        write_json(state_path, state)
        raise
    finally:
        src.close()
        dst.close()

    if integrity != "ok" or rebuilt_rows != source_sessions or rebuilt_sessions != source_sessions:
        raise RuntimeError(
            f"verification failed integrity={integrity} rows={rebuilt_rows} sessions={rebuilt_sessions} expected={source_sessions}"
        )

    os.chmod(temp_db, source_stat.st_mode & 0o777)
    with open(temp_db, "rb") as handle:
        os.fsync(handle.fileno())

    # Cortex is stopped and WAL is empty; remove stale sidecars before atomic swap.
    for suffix in ("-shm", "-wal"):
        sidecar = Path(str(source) + suffix)
        if sidecar.exists():
            sidecar.unlink()

    os.replace(source, quarantine)
    try:
        os.replace(temp_db, source)
    except Exception:
        os.replace(quarantine, source)
        raise

    final_size = source.stat().st_size
    manifest = {
        "schema": "cortex.l22.compaction-manifest.v1",
        "run_id": run_id,
        "status": "completed",
        "completed_at": now_iso(),
        "source_before": {"path": str(quarantine), "bytes": source_stat.st_size, "rows": source_rows, "sessions": source_sessions},
        "rebuilt": {"path": str(source), "bytes": final_size, "rows": rebuilt_rows, "sessions": rebuilt_sessions},
        "preservation_policy": "newest_source_snapshot_per_lookup_key",
        "derived_keys_removed": sorted(DERIVED_KEYS),
        "derived_removed_rows": derived_removed_rows,
        "invalid_json_rows": invalid_json,
        "compacted_content_bytes": compacted_bytes,
        "max_compacted_record_bytes": max_record_bytes,
        "integrity_check": integrity,
        "reversible": True,
    }
    write_json(manifest_path, manifest)
    state.update({"status": "completed", "completed_at": manifest["completed_at"], "manifest": str(manifest_path), "processed": rebuilt_rows})
    write_json(state_path, state)
    print(json.dumps(manifest, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"l22 compaction failed: {exc}", file=sys.stderr)
        raise
