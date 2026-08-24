#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--backup-receipt", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    database = Path(args.database).resolve(strict=True)
    receipt_path = Path(args.backup_receipt).resolve(strict=True)
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if receipt.get("outcome") != "green" or receipt.get("sqliteIntegrityCheck") != "ok":
        raise SystemExit("graph backup receipt is not green")
    if Path(receipt.get("sourcePath", "")).resolve() != database:
        raise SystemExit("graph backup receipt does not bind the target database")
    if receipt.get("remoteDigestMatch") is not True:
        raise SystemExit("off-host graph backup has not been verified")

    release_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(release_root / "public/cortex_server"))
    from cortex_server.knowledge.graph import Node, NodeType, SQLiteStorage

    before_hash = sha256(database)
    before_size = database.stat().st_size
    started = time.monotonic()
    storage = SQLiteStorage(str(database))
    status = storage.quota_status()
    if status.get("status") != "green" or status.get("ledgerComplete") is not True:
        raise SystemExit("graph quota migration did not produce a complete green ledger")
    if status["global"]["rowUsagePercent"] >= 70:
        raise SystemExit("graph row headroom is below the q9 30 percent minimum")
    if status["global"]["byteUsagePercent"] >= 70:
        raise SystemExit("graph byte headroom is below the q9 30 percent minimum")

    probe = Node(
        id="q9-offline-migration-probe",
        type=NodeType.DOCUMENT,
        name="q9 offline migration probe",
        tenant_id="openclaw-local",
        storage_workspace_id="principal-q9-offline-migration-probe",
        metadata={"canary": True},
    )
    storage.insert_node(probe)
    if storage.get_node(probe.id) is None:
        raise SystemExit("graph migration write/read probe failed")
    if storage.delete_node(probe.id) is not True:
        raise SystemExit("graph migration cleanup failed")
    final_status = storage.quota_status()
    connection = storage._get_conn()
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if integrity != "ok":
        raise SystemExit("graph database integrity check failed after migration")
    connection.close()
    storage._local.conn = None

    result = {
        "schemaVersion": "cortex.q9.graph-quota-migration.v1",
        "outcome": "green",
        "database": str(database),
        "databaseSha256Before": before_hash,
        "databaseBytesBefore": before_size,
        "databaseSha256After": sha256(database),
        "databaseBytesAfter": database.stat().st_size,
        "migrationSeconds": round(time.monotonic() - started, 3),
        "ledgerVersion": final_status["ledgerVersion"],
        "ledgerComplete": final_status["ledgerComplete"],
        "sourceRows": final_status["sourceRows"],
        "legacyUnscoped": final_status["legacyUnscoped"],
        "global": final_status["global"],
        "principalWriteReadDeleteProbe": "green",
        "quotaLimitsChanged": False,
        "sourceRowsDeleted": False,
        "sqliteIntegrityCheck": integrity,
        "backupReceiptSha256": sha256(receipt_path),
        "truthBoundary": "The migration only constructs and validates the quota ledger. It does not raise limits, delete source rows, or reassign legacy ownership.",
        "completedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o644)
    os.replace(temporary, output)
    print(json.dumps({
        "outcome": "green",
        "sourceRows": result["sourceRows"],
        "globalRowUsagePercent": result["global"]["rowUsagePercent"],
        "globalByteUsagePercent": result["global"]["byteUsagePercent"],
        "migrationSeconds": result["migrationSeconds"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
