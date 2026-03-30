#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.homeostasis.full_rollout_autotuner import tune_homeostasis_policy, validate_autotune_result

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r7_value_homeostasis" / "step10"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    result = tune_homeostasis_policy(r7_root=ROOT / "artifacts" / "cortex_roadmap" / "r7_value_homeostasis")
    validation = validate_autotune_result(result)
    result_path = ARTIFACT_DIR / "full_rollout_autotune_latest.json"
    probe_path = ARTIFACT_DIR / "full_rollout_autotune_probe_latest.json"
    result_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    payload = {
        "generated_at": now_iso(),
        "result_path": str(result_path.relative_to(ROOT)),
        "validation": validation,
        "rollout_mode": result.get("rollout_mode"),
        "gate_pass": bool(validation.get("valid")),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
