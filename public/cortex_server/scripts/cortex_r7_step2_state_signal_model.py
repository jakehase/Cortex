#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.homeostasis.artifact_paths import display_path, resolve_r7_root, resolve_r9_root
from services.homeostasis.state_signal_model import build_state_signal_snapshot, validate_state_signal_snapshot

R7_ROOT = resolve_r7_root()
R9_ROOT = resolve_r9_root()
ARTIFACT_DIR = R7_ROOT / "step2"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    snapshot = build_state_signal_snapshot(
        r7_root=R7_ROOT,
        r9_root=R9_ROOT,
    )
    validation = validate_state_signal_snapshot(snapshot)
    snapshot_path = ARTIFACT_DIR / "state_signal_snapshot_latest.json"
    probe_path = ARTIFACT_DIR / "state_signal_probe_latest.json"
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
