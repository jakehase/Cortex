from __future__ import annotations

from typing import Any, Dict, Iterable, List

JsonDict = Dict[str, Any]


def choose_specialist(candidates: Iterable[JsonDict]) -> JsonDict:
    rows: List[JsonDict] = [dict(row) for row in candidates]
    if not rows:
        return {'selected': None, 'trace': []}
    ranked = sorted(rows, key=lambda row: (float(row.get('priority', 0.0) or 0.0), float(row.get('confidence', 0.0) or 0.0), str(row.get('name') or '')), reverse=True)
    selected = ranked[0]
    trace = [
        {
            'name': row.get('name'),
            'priority': row.get('priority'),
            'confidence': row.get('confidence'),
            'selected': row is selected,
        }
        for row in ranked
    ]
    return {'selected': selected.get('name'), 'trace': trace}
