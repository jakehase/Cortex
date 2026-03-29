#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.routing.novelty_packager import build_claim_map, build_reproducibility_pack, render_novelty_brief

ARTIFACT_DIR = ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain" / "step12"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    claim_map = build_claim_map(artifact_root=ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain")
    reproducibility_pack = build_reproducibility_pack(artifact_root=ROOT / "artifacts" / "cortex_roadmap" / "r9_adaptive_routing_brain")
    brief = render_novelty_brief(claim_map, reproducibility_pack)

    claim_map_path = ARTIFACT_DIR / "claim_map_latest.json"
    repro_path = ARTIFACT_DIR / "reproducibility_pack_latest.json"
    brief_path = ARTIFACT_DIR / "novelty_brief_latest.md"
    probe_path = ARTIFACT_DIR / "novelty_probe_latest.json"

    claim_map_path.write_text(json.dumps(claim_map, indent=2) + "\n", encoding="utf-8")
    repro_path.write_text(json.dumps(reproducibility_pack, indent=2) + "\n", encoding="utf-8")
    brief_path.write_text(brief, encoding="utf-8")

    payload = {
        "generated_at": now_iso(),
        "claim_map_path": str(claim_map_path.relative_to(ROOT)),
        "reproducibility_pack_path": str(repro_path.relative_to(ROOT)),
        "novelty_brief_path": str(brief_path.relative_to(ROOT)),
        "summary": claim_map.get("summary", {}),
        "gate_pass": bool(claim_map.get("summary", {}).get("supported", 0) >= 4 and claim_map.get("summary", {}).get("not_supported", 0) >= 1),
    }
    probe_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
