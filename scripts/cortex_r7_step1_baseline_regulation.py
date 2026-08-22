#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.homeostasis.baseline_regulation import build_baseline_regulation_snapshot, validate_baseline_regulation_snapshot

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r7_value_homeostasis" / "step1"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    snapshot = build_baseline_regulation_snapshot(
        r9_root=ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain",
        r7_root=ROOT / "artifacts" / "cortex_roadmap" / "r7_value_homeostasis",
    )
    validation = validate_baseline_regulation_snapshot(snapshot)
    snapshot_path = ARTIFACT_DIR / "baseline_regulation_snapshot_latest.json"
    probe_path = ARTIFACT_DIR / "baseline_regulation_probe_latest.json"
    snapshot_path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    payload = {
        "generated_at": now_iso(),
        "snapshot_path": str(snapshot_path.relative_to(ROOT)),
        "validation": validation,
        "gate_pass": bool(validation.get("valid")),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
