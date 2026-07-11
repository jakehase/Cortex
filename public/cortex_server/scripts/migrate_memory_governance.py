#!/usr/bin/env python3
"""One-time/idempotent migration to Cortex memory governance metadata.

Adds lifecycle/authority/schema fields to legacy semantic records and tombstones
known contradicted records while retaining them for explicit historical recall.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from cortex_server.routers.librarian import collection, _authority_rank, _memory_status

SCHEMA = "cortex.memory.governance.v1"
KNOWN_SUPERSEDED = {
    "50b44251-b2c8-4179-8a71-7046c25cfefb": {
        "reason": "PMHNP Tier 2 was verification-only orchestration; empty modifiedFiles and hasRealFiles=false do not prove product-code work.",
        "superseded_by": "72ea1c3d-a581-436d-b0ac-f07fad566400",
    },
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--artifact", default="")
    args = parser.parse_args()

    data = collection.get(include=["metadatas"])
    ids = data.get("ids") or []
    metas = data.get("metadatas") or []
    updates = []
    changed_ids = []
    lifecycle = {}
    for index, memory_id in enumerate(ids):
        original = dict(metas[index] if index < len(metas) and metas[index] else {})
        metadata = dict(original)
        metadata.setdefault("memory_status", "active")
        metadata.setdefault("authority_rank", _authority_rank(metadata))
        metadata.setdefault("memory_schema_version", SCHEMA)
        metadata.setdefault("recorded_at", str(metadata.get("timestamp") or metadata.get("createdAt") or "legacy_unknown"))
        rule = KNOWN_SUPERSEDED.get(str(memory_id))
        if rule:
            metadata.update({
                "memory_status": "superseded",
                "superseded": True,
                "superseded_at": now(),
                "supersession_reason": rule["reason"],
                "superseded_by": rule["superseded_by"],
            })
        status = _memory_status(metadata)
        lifecycle[status] = lifecycle.get(status, 0) + 1
        updates.append(metadata)
        if metadata != original:
            changed_ids.append(str(memory_id))

    if args.apply and ids:
        # Chroma accepts batched metadata-only updates without re-embedding.
        batch = 100
        for start in range(0, len(ids), batch):
            collection.update(ids=ids[start:start + batch], metadatas=updates[start:start + batch])

    artifact = {
        "schemaVersion": "cortex.memory.governance.migration.v1",
        "generatedAt": now(),
        "applied": bool(args.apply),
        "totalRecords": len(ids),
        "changedRecords": len(changed_ids),
        "lifecycleAfter": lifecycle,
        "knownSuperseded": [memory_id for memory_id in KNOWN_SUPERSEDED if memory_id in set(ids)],
        "changedIds": changed_ids,
    }
    target = Path(args.artifact) if args.artifact else Path("/root/clawd/artifacts/memory-audit/memory-governance-migration.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(artifact, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
