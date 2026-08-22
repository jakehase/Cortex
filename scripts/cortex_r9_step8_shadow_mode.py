#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.shadow_mode_runner import run_shadow_mode

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step8"
DATASET_PATH = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step1" / "baseline_telemetry_dataset_latest.jsonl"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    if not DATASET_PATH.exists():
        raise SystemExit("missing baseline dataset; run cortex_r9_step1_baseline_telemetry.py first")
    rows = [json.loads(line) for line in DATASET_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    payload = {
        "generated_at": now_iso(),
        "shadow": run_shadow_mode(rows),
        "dataset_path": str(DATASET_PATH.relative_to(ROOT)),
    }
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    (ARTIFACT_DIR / "shadow_probe_latest.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
