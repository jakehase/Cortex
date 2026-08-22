from __future__ import annotations

from typing import Any, Dict, Iterable, List

JsonDict = Dict[str, Any]


def schedule_replay(samples: Iterable[JsonDict]) -> List[JsonDict]:
    rows = [dict(row) for row in samples]
    ranked = sorted(rows, key=lambda row: (bool(row.get('anchor')), float(row.get('priority', 0.0) or 0.0), float(row.get('recency', 0.0) or 0.0)), reverse=True)
    return ranked
