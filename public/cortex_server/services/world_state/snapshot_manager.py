from __future__ import annotations

import json
import os
import tempfile
from copy import deepcopy
from contextlib import ExitStack, contextmanager
import fcntl
from pathlib import Path
from typing import Any, Dict, Iterator

JsonDict = Dict[str, Any]


def _validate_snapshot(snapshot: Any) -> JsonDict:
    if not isinstance(snapshot, dict):
        raise ValueError('snapshot must be an object')
    if snapshot.get('version') != 'world_state.v1':
        raise ValueError('unsupported world-state snapshot version')
    if not isinstance(snapshot.get('entities'), dict):
        raise ValueError('snapshot entities must be an object')
    for entity_id, entity in snapshot['entities'].items():
        if not isinstance(entity_id, str) or not isinstance(entity, dict):
            raise ValueError('snapshot entities must map string ids to objects')
        if 'state' in entity and not isinstance(entity['state'], dict):
            raise ValueError('entity state must be an object')
        if 'provenance' in entity and not isinstance(entity['provenance'], list):
            raise ValueError('entity provenance must be an array')
    try:
        # Reject NaN/infinity and values which cannot survive a JSON round trip.
        json.dumps(snapshot, allow_nan=False)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError('snapshot must contain valid JSON values') from exc
    return snapshot


@contextmanager
def _path_lock(path: Path) -> Iterator[None]:
    lock_path = path.with_name(path.name + '.lock')
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a+b') as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _atomic_write(target: Path, snapshot: JsonDict) -> None:
    payload = (json.dumps(snapshot, indent=2) + '\n').encode('utf-8')
    fd, temporary = tempfile.mkstemp(prefix=f'.{target.name}.', suffix='.tmp', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        directory_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def save_snapshot(path: str | Path, snapshot: JsonDict) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with _path_lock(target):
        # Validate and detach under the lock so caller mutation cannot produce a
        # payload different from the object that was checked.
        stable_snapshot = deepcopy(snapshot)
        _validate_snapshot(stable_snapshot)
        _atomic_write(target, stable_snapshot)
    return target


def load_snapshot(path: str | Path) -> JsonDict:
    target = Path(path)
    with _path_lock(target):
        if not target.exists():
            return {'version': 'world_state.v1', 'entities': {}}
        try:
            snapshot = json.loads(target.read_text(encoding='utf-8'), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f'invalid snapshot: {target}') from exc
        return _validate_snapshot(snapshot)


def rollback_snapshot(current_path: str | Path, rollback_path: str | Path) -> JsonDict:
    current = Path(current_path)
    source = Path(rollback_path)
    current.parent.mkdir(parents=True, exist_ok=True)
    # Lock in stable order so reciprocal operations cannot deadlock.
    paths = sorted({current.absolute(), source.absolute()}, key=str)
    with ExitStack() as stack:
        for path in paths:
            stack.enter_context(_path_lock(path))
        if not source.exists():
            raise FileNotFoundError(f'rollback snapshot does not exist: {source}')
        try:
            snapshot = _validate_snapshot(json.loads(
                source.read_text(encoding='utf-8'),
                parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)),
            ))
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
            raise ValueError(f'invalid rollback snapshot: {source}') from exc
        _atomic_write(current, snapshot)
        return snapshot
