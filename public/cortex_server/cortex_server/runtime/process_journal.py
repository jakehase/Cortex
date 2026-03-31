from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from cortex_server.runtime.process_event import ProcessEvent


JsonDict = Dict[str, Any]



def _model_validate_compat(data: JsonDict) -> ProcessEvent:
    if hasattr(ProcessEvent, "model_validate"):
        return ProcessEvent.model_validate(data)
    return ProcessEvent.parse_obj(data)



def _model_dump_compat(model: ProcessEvent) -> JsonDict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _coerce_event(event: Optional[ProcessEvent | JsonDict] = None, **kwargs: Any) -> ProcessEvent:
    if isinstance(event, ProcessEvent):
        if kwargs:
            raise TypeError("cannot pass both event and keyword fields")
        return event
    if event is None:
        return ProcessEvent(**kwargs)
    if isinstance(event, dict):
        if kwargs:
            raise TypeError("cannot pass both event mapping and keyword fields")
        return _model_validate_compat(event)
    raise TypeError("event must be ProcessEvent, mapping, or None")


class ProcessJournal:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def append(self, event: Optional[ProcessEvent | JsonDict] = None, **kwargs: Any) -> ProcessEvent:
        record = _coerce_event(event, **kwargs)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(_model_dump_compat(record), sort_keys=True) + "\n")
        return record

    def append_many(self, events: Iterable[ProcessEvent | JsonDict]) -> List[ProcessEvent]:
        rows = [_coerce_event(event) for event in events]
        if not rows:
            return []
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(_model_dump_compat(row), sort_keys=True) + "\n")
        return rows

    def load(self, *, process_id: Optional[str] = None, kinds: Optional[Sequence[str]] = None) -> List[ProcessEvent]:
        rows: List[ProcessEvent] = []
        if not self.path.exists():
            return rows
        allowed_kinds = {str(kind).strip() for kind in (kinds or []) if str(kind).strip()}
        with self.path.open("r", encoding="utf-8") as handle:
            for line in handle:
                text = line.strip()
                if not text:
                    continue
                record = _model_validate_compat(json.loads(text))
                if process_id and record.process_id != process_id:
                    continue
                if allowed_kinds and record.kind not in allowed_kinds:
                    continue
                rows.append(record)
        return rows

    def latest(self, *, process_id: Optional[str] = None) -> Optional[ProcessEvent]:
        rows = self.load(process_id=process_id)
        return rows[-1] if rows else None


__all__ = ["ProcessJournal"]
