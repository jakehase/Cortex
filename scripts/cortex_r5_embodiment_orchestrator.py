#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.embodiment.episode_orchestrator import run_orchestrated_episode


def main() -> int:
    result = run_orchestrated_episode(profile_name="contract_baseline_v2", seed=7)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
