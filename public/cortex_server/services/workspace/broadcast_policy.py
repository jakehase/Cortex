from __future__ import annotations

from typing import Any, Dict, Iterable, List

JsonDict = Dict[str, Any]


def select_broadcast_payload(items: Iterable[JsonDict], *, salience_floor: float = 0.4, include_confidential: bool = False) -> List[JsonDict]:
    selected = []
    for row in items:
        item = dict(row)
        if float(item.get('salience', 0.0) or 0.0) < salience_floor:
            continue
        if bool(item.get('confidential')) and not include_confidential:
            continue
        selected.append(item)
    return selected
