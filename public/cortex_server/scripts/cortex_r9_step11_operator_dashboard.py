#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.operator_dashboard import build_dashboard_model, render_dashboard_html, run_operator_control_runbook

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step11"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    model = build_dashboard_model(artifact_root=ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain")
    drill = run_operator_control_runbook(model)
    html = render_dashboard_html(model)
    html_path = ARTIFACT_DIR / "dashboard_live_local.html"
    probe_path = ARTIFACT_DIR / "dashboard_probe_latest.json"
    html_path.write_text(html, encoding="utf-8")
    payload = {
        "generated_at": now_iso(),
        "dashboard_path": str(html_path.relative_to(ROOT)),
        "headline": model.get("headline", {}),
        "controls": model.get("controls", {}),
        "runbook_drill": drill,
        "gate_pass": bool(drill.get("success")),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
