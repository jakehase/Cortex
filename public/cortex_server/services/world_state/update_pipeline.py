from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import math
from typing import Any, Dict, Iterable

JsonDict = Dict[str, Any]
EMPTY_WORLD_STATE = {'version': 'world_state.v1', 'entities': {}}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _optional_container(
    value: JsonDict, field: str, expected_type: type, default: Any
) -> Any:
    supplied = value.get(field)
    if supplied is None:
        return deepcopy(default)
    if not isinstance(supplied, expected_type):
        container = 'object' if expected_type is dict else 'array'
        raise ValueError(f'entity {field} must be an {container}')
    return deepcopy(supplied)


def _validate_world_state(world_state: Any) -> JsonDict:
    if not isinstance(world_state, dict):
        raise ValueError('world state must be an object')
    if world_state.get('version') != 'world_state.v1':
        raise ValueError('unsupported world-state version')
    if not isinstance(world_state.get('entities'), dict):
        raise ValueError('world state entities must be an object')
    for entity_id, entity in world_state['entities'].items():
        if not isinstance(entity_id, str) or not isinstance(entity, dict):
            raise ValueError('world state entities must map string ids to objects')
        if 'state' in entity and not isinstance(entity['state'], dict):
            raise ValueError('entity state must be an object')
        if 'provenance' in entity and not isinstance(entity['provenance'], list):
            raise ValueError('entity provenance must be an array')
    return world_state


def deterministic_merge(existing: JsonDict | None, incoming: JsonDict) -> JsonDict:
    if not isinstance(incoming, dict):
        raise ValueError('incoming event must be an object')
    current = {} if existing is None else deepcopy(existing)
    if not isinstance(current, dict):
        raise ValueError('existing entity must be an object')
    current_state = _optional_container(current, 'state', dict, {})
    incoming_state = _optional_container(incoming, 'state', dict, {})
    current_provenance = _optional_container(current, 'provenance', list, [])
    incoming_provenance = _optional_container(incoming, 'provenance', list, [])
    merged = deepcopy(current)
    merged.setdefault('entity_id', incoming.get('entity_id'))
    merged.setdefault('kind', incoming.get('kind', current.get('kind', 'unknown')))
    current_conf = _confidence(current.get('confidence', 0.0))
    incoming_conf = _confidence(incoming.get('confidence', 0.0))
    merged_state = dict(current_state)
    # A lower-confidence event is rejected as a unit.  This keeps values and
    # their provenance aligned instead of attributing retained values to it.
    accepted = not current or incoming_conf >= current_conf
    if accepted:
        merged_state.update(incoming_state)
    merged['state'] = merged_state
    merged['confidence'] = round(max(current_conf, incoming_conf), 4)
    provenance = list(current_provenance)
    if accepted:
        provenance.extend(incoming_provenance)
    merged['provenance'] = provenance[-12:]
    if accepted:
        merged['updated_at'] = incoming.get('updated_at') or _now_iso()
    return merged


def _confidence(value: Any) -> float:
    try:
        confidence = float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(confidence):
        return 0.0
    return min(1.0, max(0.0, confidence))


def merge_event(world_state: JsonDict, event: JsonDict) -> JsonDict:
    _validate_world_state(world_state)
    if not isinstance(event, dict):
        raise ValueError('incoming event must be an object')
    entity_id = str(event.get('entity_id') or '').strip()
    if not entity_id:
        raise ValueError('event missing entity_id')
    entities = deepcopy(world_state['entities'])
    entities[entity_id] = deterministic_merge(entities.get(entity_id), event)
    return {'version': 'world_state.v1', 'entities': entities}


def apply_events(events: Iterable[JsonDict], *, initial_state: JsonDict | None = None) -> JsonDict:
    state = deepcopy(EMPTY_WORLD_STATE if initial_state is None else initial_state)
    _validate_world_state(state)
    for event in events:
        state = merge_event(state, event)
    return state
