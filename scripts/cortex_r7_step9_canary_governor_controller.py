#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.homeostasis.canary_governor_controller import evaluate_canary_governor

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r7_value_homeostasis" / "step9"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    canary = evaluate_canary_governor(shadow_probe_path=ROOT / "artifacts" / "cortex_roadmap" / "r7_value_homeostasis" / "step8" / "shadow_governor_probe_latest.json")
    probe_path = ARTIFACT_DIR / "canary_governor_probe_latest.json"
    payload = {
        "generated_at": now_iso(),
        "canary": canary,
        "gate_pass": bool(canary.get("rollout_ready")),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
