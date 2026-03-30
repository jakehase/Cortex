from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

JsonDict = Dict[str, Any]


def save_snapshot(path: str | Path, snapshot: JsonDict) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(snapshot, indent=2) + '\n', encoding='utf-8')
    return target


def load_snapshot(path: str | Path) -> JsonDict:
    target = Path(path)
    if not target.exists():
        return {'version': 'world_state.v1', 'entities': {}}
    return json.loads(target.read_text(encoding='utf-8'))


def rollback_snapshot(current_path: str | Path, rollback_path: str | Path) -> JsonDict:
    snapshot = load_snapshot(rollback_path)
    save_snapshot(current_path, snapshot)
    return snapshot
