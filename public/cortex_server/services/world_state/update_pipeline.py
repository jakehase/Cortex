from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, Iterable

JsonDict = Dict[str, Any]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def deterministic_merge(existing: JsonDict | None, incoming: JsonDict) -> JsonDict:
    current = deepcopy(existing or {})
    merged = deepcopy(current)
    merged.setdefault('entity_id', incoming.get('entity_id'))
    merged.setdefault('kind', incoming.get('kind', current.get('kind', 'unknown')))
    merged_state = dict(current.get('state') or {})
    merged_state.update(dict(incoming.get('state') or {}))
    merged['state'] = merged_state
    current_conf = float(current.get('confidence', 0.0) or 0.0)
    incoming_conf = float(incoming.get('confidence', 0.0) or 0.0)
    merged['confidence'] = round(max(current_conf, incoming_conf), 4)
    provenance = list(current.get('provenance') or [])
    incoming_prov = list(incoming.get('provenance') or [])
    provenance.extend(incoming_prov)
    merged['provenance'] = provenance[-12:]
    merged['updated_at'] = incoming.get('updated_at') or _now_iso()
    return merged


def merge_event(world_state: JsonDict, event: JsonDict) -> JsonDict:
    entity_id = str(event.get('entity_id') or '').strip()
    if not entity_id:
        raise ValueError('event missing entity_id')
    entities = dict(world_state.get('entities') or {})
    entities[entity_id] = deterministic_merge(entities.get(entity_id), event)
    return {'version': 'world_state.v1', 'entities': entities}


def apply_events(events: Iterable[JsonDict], *, initial_state: JsonDict | None = None) -> JsonDict:
    state = deepcopy(initial_state or {'version': 'world_state.v1', 'entities': {}})
    for event in events:
        state = merge_event(state, dict(event))
    return state
