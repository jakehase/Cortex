#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.homeostasis.artifact_paths import display_path, resolve_r7_root, resolve_r9_root
from services.homeostasis.baseline_regulation import build_baseline_regulation_snapshot, validate_baseline_regulation_snapshot

R7_ROOT = resolve_r7_root()
R9_ROOT = resolve_r9_root()
ARTIFACT_DIR = R7_ROOT / "step1"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    use_bootstrap_only = bool(str(os.getenv("CORTEX_ARTIFACT_ROOT", "") or "").strip())
    snapshot = build_baseline_regulation_snapshot(
        r9_root=R9_ROOT,
        r7_root=R7_ROOT,
        live_processes=[] if use_bootstrap_only else None,
        get_runtime_events_fn=(lambda process_id, limit=200: []) if use_bootstrap_only else None,
        window_hours=24.0 * 14.0,
        bucket_hours=24.0,
    )
    validation = validate_baseline_regulation_snapshot(snapshot)
    snapshot_path = ARTIFACT_DIR / "baseline_regulation_snapshot_latest.json"
    probe_path = ARTIFACT_DIR / "baseline_regulation_probe_latest.json"
    snapshot_path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    payload = {
        "generated_at": now_iso(),
        "snapshot_path": display_path(snapshot_path),
        "validation": validation,
        "gate_pass": bool(validation.get("valid")),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
