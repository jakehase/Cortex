"""Explicit temporal memory contract (``cortex.memory.temporal.v1``).

Opt-in per write: a librarian/L22 write carries a ``temporal`` object, which
is strictly validated here and flattened into scalar metadata keys *before*
the governed-write preparation (privacy admission, legacy temporal
normalisation, fact identity) runs on the result. Writes without a
``temporal`` object, and every row already stored, keep their existing
meaning; nothing here re-validates stored rows.

Stored keys (all native scalars so they survive the Chroma metadata
envelope): ``temporal_schema_version``, ``temporal_kind``,
``temporal_precision``, ``temporal_timezone``, ``event_id``, ``event_type``,
``occurred_at``, ``occurred_on``, ``observed_at``, ``valid_from`` (same
meaning as the legacy key), ``valid_to`` (exclusive end), ``ingested_at``
(system-owned), ``source_authority``, ``uncertainty``,
``source_lineage_json``/``source_lineage_count`` and ``supersedes_json``.

Admission of temporal-v1 rows lives in
:mod:`cortex_server.runtime.memory_governance` (``temporal_v1_admission``).
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from typing import Annotated, Any, Callable, Dict, List, Literal, Mapping, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from cortex_server.runtime.memory_governance import (
    MemoryFilterError,
    MemoryGovernanceError,
    MemorySearchFilters,
    TEMPORAL_MEMORY_SCHEMA_VERSION,
    is_temporal_v1_metadata,
    parse_timestamp,
)


__all__ = [
    "TEMPORAL_MEMORY_SCHEMA_VERSION",
    "MAX_SOURCE_LINEAGE_REFS",
    "SourceLineageRef",
    "TemporalMemoryContract",
    "apply_temporal_memory_contract",
    "merge_top_level_temporal_filters",
    "normalize_source_lineage",
    "normalize_temporal_contract_metadata",
    "normalize_temporal_instant",
    "prepare_temporal_write_metadata",
    "present_memory_row",
    "present_memory_search_result",
    "source_lineage_view",
    "stamp_temporal_ingestion",
    "temporal_presentation",
    "temporal_search_echo",
]


MAX_SOURCE_LINEAGE_REFS = 16
MAX_SOURCE_LINEAGE_FIELD_BYTES = 1024
MAX_TEMPORAL_SUPERSESSION_RECORDS = 500
MAX_TEMPORAL_RECORD_ID_BYTES = 256
TemporalRecordId = Annotated[
    str, Field(min_length=1, max_length=MAX_TEMPORAL_RECORD_ID_BYTES)
]
_RFC3339_INSTANT = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$"
)
_TIMESTAMP_FIELDS = ("occurred_at", "observed_at", "valid_from", "valid_to", "ingested_at")
# Keys whose presence marks a row as temporal-v1; only this module sets it.
_SYSTEM_OWNED_KEYS = ("temporal_schema_version", "ingested_at")
_CONTRACT_KEY_MAP = {
    "kind": "temporal_kind",
    "timezone": "temporal_timezone",
    "precision": "temporal_precision",
}


def _utc_text(value: datetime) -> str:
    return (
        value.astimezone(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _normalize_rfc3339_timestamp(value: Any, *, field: str) -> Optional[str]:
    """Strict, offset-aware RFC3339 instant -> canonical UTC millisecond text."""

    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ValueError(
            f"{field} requires an offset-aware timestamp; use occurred_on for a date-only value"
        )
    if not _RFC3339_INSTANT.fullmatch(text):
        raise ValueError(f"{field} must be an offset-aware RFC3339 instant")
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError as exc:
        raise ValueError(f"{field} must be RFC3339") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include an explicit UTC offset")
    try:
        return _utc_text(parsed)
    except (OverflowError, ValueError) as exc:
        raise ValueError(f"{field} is outside the supported range") from exc


def _normalize_iso_date(value: Any, *, field: str) -> Optional[str]:
    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip()
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"{field} must be an ISO calendar date (YYYY-MM-DD)") from exc
    return parsed.strftime("%Y-%m-%d")


def _bounded_lineage_text(value: Any, *, field: str, required: bool = False) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        if required:
            raise ValueError(f"{field} is required")
        return None
    if len(text.encode("utf-8")) > MAX_SOURCE_LINEAGE_FIELD_BYTES:
        raise ValueError(f"{field} exceeds its byte bound")
    return text


def _instant(text: str) -> datetime:
    return datetime.fromisoformat(str(text).replace("Z", "+00:00"))


class SourceLineageRef(BaseModel):
    source_id: str = Field(..., min_length=1, max_length=1024)
    source_type: Optional[str] = Field(None, max_length=128)
    memory_id: Optional[TemporalRecordId] = None
    event_id: Optional[str] = Field(None, max_length=1024)
    evidence_id: Optional[str] = Field(None, max_length=1024)
    version_id: Optional[str] = Field(None, max_length=1024)
    locator: Optional[str] = Field(None, max_length=1024)
    content_sha256: Optional[str] = Field(None, max_length=64)
    occurred_at: Optional[str] = Field(None, max_length=64)
    observed_at: Optional[str] = Field(None, max_length=64)
    source_authority: Optional[int] = Field(None, ge=0, le=100)
    uncertainty: Optional[float] = Field(None, ge=0.0, le=1.0)
    source_available: Optional[bool] = None
    missing_reason: Optional[str] = Field(None, max_length=240)

    @field_validator("occurred_at", "observed_at")
    @classmethod
    def _lineage_timestamp(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_rfc3339_timestamp(value, field="lineage timestamp")

    @field_validator("content_sha256")
    @classmethod
    def _lineage_hash(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = str(value).strip().lower()
        if not re.fullmatch(r"[0-9a-f]{64}", normalized):
            raise ValueError("content_sha256 must be a lowercase SHA-256 digest")
        return normalized


class TemporalMemoryContract(BaseModel):
    kind: Literal["event", "state", "fact"] = "fact"
    event_id: Optional[str] = Field(None, max_length=1024)
    event_type: Optional[str] = Field(None, max_length=128)
    occurred_at: Optional[str] = Field(None, max_length=64)
    occurred_on: Optional[str] = Field(None, max_length=10)
    observed_at: Optional[str] = Field(None, max_length=64)
    valid_from: Optional[str] = Field(None, max_length=64)
    valid_to: Optional[str] = Field(None, max_length=64)
    timezone: Optional[str] = Field(None, max_length=128)
    precision: Literal["instant", "date", "unknown"] = "unknown"
    source_authority: Optional[int] = Field(None, ge=0, le=100)
    uncertainty: Optional[float] = Field(None, ge=0.0, le=1.0)
    source_lineage: List[SourceLineageRef] = Field(
        default_factory=list, max_length=MAX_SOURCE_LINEAGE_REFS
    )
    supersedes: List[TemporalRecordId] = Field(
        default_factory=list, max_length=MAX_TEMPORAL_SUPERSESSION_RECORDS
    )

    @field_validator("occurred_at", "observed_at", "valid_from", "valid_to")
    @classmethod
    def _temporal_timestamp(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_rfc3339_timestamp(value, field="temporal timestamp")

    @field_validator("occurred_on")
    @classmethod
    def _temporal_date(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_iso_date(value, field="occurred_on")

    @model_validator(mode="after")
    def _validate_temporal_contract(self):
        if self.occurred_at and self.occurred_on:
            raise ValueError("occurred_at and occurred_on are mutually exclusive")
        if self.occurred_on and self.precision != "date":
            raise ValueError("date-only occurrence requires explicit date precision")
        if self.occurred_at and self.precision != "instant":
            raise ValueError("instant occurrence requires explicit instant precision")
        if self.valid_from and self.valid_to:
            if _instant(self.valid_from) >= _instant(self.valid_to):
                raise ValueError("valid_from must be earlier than valid_to")
        normalized = [str(value).strip() for value in self.supersedes]
        if len(normalized) != len(set(normalized)):
            raise ValueError("supersedes must not contain duplicate record IDs")
        return self


def _normalize_source_lineage(value: Any) -> List[Dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("source lineage JSON is malformed") from exc
    if not isinstance(value, list):
        raise ValueError("source lineage must be a list")
    if len(value) > MAX_SOURCE_LINEAGE_REFS:
        raise ValueError("source lineage exceeds its record bound")
    normalized: List[Dict[str, Any]] = []
    seen = set()
    for raw in value:
        row = raw.model_dump(exclude_none=True) if isinstance(raw, BaseModel) else raw
        if not isinstance(row, dict):
            raise ValueError("each source lineage reference must be an object")
        parsed = SourceLineageRef.model_validate(row).model_dump(exclude_none=True)
        key = (
            parsed.get("source_id"), parsed.get("memory_id"), parsed.get("event_id"),
            parsed.get("evidence_id"), parsed.get("version_id"),
        )
        if key in seen:
            continue
        seen.add(key)
        normalized.append(parsed)
    return normalized


def normalize_temporal_instant(value: Any, *, field: str) -> Optional[str]:
    """Public strict RFC3339 normaliser (canonical UTC millisecond text)."""

    return _normalize_rfc3339_timestamp(value, field=field)


def normalize_source_lineage(value: Any) -> List[Dict[str, Any]]:
    """Public bounded (<= 16 refs) source-lineage normaliser."""

    return _normalize_source_lineage(value)


def _normalize_record_id_list(value: Any, *, field: str) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{field} JSON is malformed") from exc
    if not isinstance(value, list) or len(value) > MAX_TEMPORAL_SUPERSESSION_RECORDS:
        raise ValueError(f"{field} must be a bounded list")
    out: List[str] = []
    for item in value:
        text = str(item or "").strip()
        if not text or len(text.encode("utf-8")) > MAX_TEMPORAL_RECORD_ID_BYTES:
            raise ValueError(f"{field} contains an invalid record ID")
        if text not in out:
            out.append(text)
    return out


def normalize_temporal_contract_metadata(
    metadata: Mapping[str, Any], *, require_explicit_precision: bool = False
) -> Dict[str, Any]:
    """Strictly normalise the temporal keys of a *new* contract write."""

    normalized = dict(metadata or {})
    for field in _TIMESTAMP_FIELDS:
        if field in normalized and normalized.get(field) not in (None, ""):
            normalized[field] = _normalize_rfc3339_timestamp(normalized[field], field=field)
    if normalized.get("occurred_on") not in (None, ""):
        normalized["occurred_on"] = _normalize_iso_date(normalized["occurred_on"], field="occurred_on")
    if normalized.get("occurred_at") and normalized.get("occurred_on"):
        raise ValueError("occurred_at and occurred_on are mutually exclusive")
    precision = str(normalized.get("temporal_precision") or "unknown").strip()
    if precision not in {"instant", "date", "unknown"}:
        raise ValueError("temporal_precision must be instant, date, or unknown")
    if require_explicit_precision and normalized.get("occurred_on") and precision != "date":
        raise ValueError("date-only occurrence requires explicit date precision")
    if require_explicit_precision and normalized.get("occurred_at") and precision != "instant":
        raise ValueError("instant occurrence requires explicit instant precision")
    if normalized.get("valid_from") and normalized.get("valid_to"):
        if _instant(normalized["valid_from"]) >= _instant(normalized["valid_to"]):
            raise ValueError("valid_from must be earlier than valid_to")

    if "source_lineage" in normalized or "source_lineage_json" in normalized:
        lineage = _normalize_source_lineage(
            normalized.pop("source_lineage", normalized.get("source_lineage_json"))
        )
        normalized["source_lineage_json"] = json.dumps(
            lineage, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        normalized["source_lineage_count"] = len(lineage)
    if "supersedes" in normalized or "supersedes_json" in normalized:
        supersedes = _normalize_record_id_list(
            normalized.pop("supersedes", normalized.get("supersedes_json")), field="supersedes"
        )
        normalized["supersedes_json"] = json.dumps(supersedes, separators=(",", ":"))

    kind = str(normalized.get("temporal_kind") or "").strip()
    if kind and kind not in {"event", "state", "fact"}:
        raise ValueError("temporal_kind must be event, state, or fact")
    if normalized.get("source_authority") is not None:
        authority = normalized["source_authority"]
        if isinstance(authority, bool) or not isinstance(authority, int) or not 0 <= authority <= 100:
            raise ValueError("source_authority must be an integer from 0 to 100")
    if normalized.get("uncertainty") is not None:
        uncertainty = normalized["uncertainty"]
        if (
            isinstance(uncertainty, bool)
            or not isinstance(uncertainty, (int, float))
            or not 0.0 <= float(uncertainty) <= 1.0
        ):
            raise ValueError("uncertainty must be between 0 and 1")
        normalized["uncertainty"] = float(uncertainty)
    if normalized.get("temporal_timezone") is not None:
        timezone_value = _bounded_lineage_text(
            normalized.get("temporal_timezone"), field="temporal_timezone"
        )
        if timezone_value and len(timezone_value) > 128:
            raise ValueError("temporal_timezone exceeds its character bound")
        if timezone_value is None:
            normalized.pop("temporal_timezone", None)
        else:
            normalized["temporal_timezone"] = timezone_value

    temporal_keys = {
        "temporal_kind", "event_id", "event_type", "occurred_at", "occurred_on",
        "observed_at", "valid_from", "valid_to", "temporal_timezone",
        "temporal_precision", "source_authority", "uncertainty",
        "source_lineage_json", "supersedes_json",
    }
    if any(key in normalized and normalized.get(key) not in (None, "", "[]") for key in temporal_keys):
        normalized["temporal_schema_version"] = TEMPORAL_MEMORY_SCHEMA_VERSION
    return normalized


def stamp_temporal_ingestion(
    metadata: Any, *, ingested_at: Any = None
) -> Any:
    """Attach the system-owned ingestion instant to a new temporal-v1 write.

    Non-v1 metadata is returned unchanged (same object). An already stamped
    v1 record keeps its stamp (idempotent replays). When the caller declared
    no observation time, the observation is the ingestion instant (the value
    the governed write would otherwise auto-fill a few microseconds later).
    """

    if not is_temporal_v1_metadata(metadata):
        return metadata
    stamped = dict(metadata)
    if stamped.get("ingested_at") in (None, ""):
        when: Optional[datetime] = None
        if ingested_at not in (None, ""):
            try:
                when = parse_timestamp(ingested_at, field_name="ingested_at")
            except MemoryGovernanceError as exc:
                raise ValueError("ingestion instant is malformed") from exc
        stamped["ingested_at"] = _utc_text(when or datetime.now(timezone.utc))
    if all(
        stamped.get(key) in (None, "") for key in ("observed_at", "observedAt", "timestamp")
    ):
        stamped["observed_at"] = stamped["ingested_at"]
    return stamped


def _same_contract_value(target: str, existing: Any, value: Any) -> bool:
    if existing == value:
        return True
    if target in _TIMESTAMP_FIELDS:
        try:
            return _normalize_rfc3339_timestamp(existing, field=target) == value
        except ValueError:
            return False
    return False


def apply_temporal_memory_contract(
    metadata: Optional[Mapping[str, Any]],
    temporal: Any,
    *,
    stamp: bool = True,
) -> Dict[str, Any]:
    """Merge an explicit temporal contract into new-write metadata.

    Raises ``ValueError`` (HTTP 422 at the routes) for system-owned keys,
    contradictory metadata, or contract rule violations.
    """

    if isinstance(temporal, Mapping):
        temporal = TemporalMemoryContract.model_validate(dict(temporal))
    if not isinstance(temporal, TemporalMemoryContract):
        raise ValueError("temporal must be a temporal memory contract object")
    merged = dict(metadata or {})
    for key in _SYSTEM_OWNED_KEYS:
        if merged.get(key) not in (None, ""):
            raise ValueError(f"{key} is system-owned and cannot be supplied")
    for key in ("valid_until", "validUntil"):
        if merged.get(key) not in (None, ""):
            raise ValueError(
                "temporal-contract writes use temporal.valid_to (exclusive end); "
                "valid_until cannot be combined with a temporal contract"
            )
    payload = temporal.model_dump(exclude_none=True)
    for key, value in payload.items():
        target = _CONTRACT_KEY_MAP.get(key, key)
        if target in merged and merged[target] not in (None, "", []) and not _same_contract_value(
            target, merged[target], value
        ):
            raise ValueError(f"temporal contract conflicts with metadata field {target}")
        merged[target] = value
    normalized = normalize_temporal_contract_metadata(merged, require_explicit_precision=True)
    if not is_temporal_v1_metadata(normalized):  # pragma: no cover - kind always set
        normalized["temporal_schema_version"] = TEMPORAL_MEMORY_SCHEMA_VERSION
    return stamp_temporal_ingestion(normalized) if stamp else normalized


def prepare_temporal_write_metadata(
    metadata: Optional[Mapping[str, Any]],
    temporal: Any,
    *,
    stamp: bool = True,
) -> Any:
    """Route helper: v1 only for an explicit ``temporal`` object.

    Without a contract the caller's metadata object is returned untouched (the
    legacy write path is unchanged); only the reserved v1 schema marker is
    refused so a row can never claim the v1 contract without validation.
    """

    if temporal is None:
        if isinstance(metadata, Mapping) and metadata.get("temporal_schema_version") not in (None, ""):
            raise ValueError(
                "temporal_schema_version is system-owned; send an explicit temporal object"
            )
        return metadata
    return apply_temporal_memory_contract(metadata, temporal, stamp=stamp)


# ---------------------------------------------------------------------------
# Search request handling
# ---------------------------------------------------------------------------

_TOP_LEVEL_FILTER_NAMES = {
    "as_of": "as_of",
    "as_known_at": "as_known_at",
    "include_unknown_time": "include_temporally_unknown",
}


def _same_filter_value(key: str, left: Any, right: Any) -> bool:
    if key == "include_unknown_time":
        return bool(left) == bool(right)
    try:
        return parse_timestamp(left, field_name=key) == parse_timestamp(right, field_name=key)
    except (MemoryGovernanceError, OverflowError, ValueError) as exc:
        raise MemoryFilterError(str(exc)) from exc


def merge_top_level_temporal_filters(
    filters: Any,
    parse: Callable[[Any], Optional[MemorySearchFilters]],
    *,
    as_of: Optional[str] = None,
    as_known_at: Optional[str] = None,
    include_temporally_unknown: Optional[bool] = None,
) -> Optional[MemorySearchFilters]:
    """Map top-level temporal search fields onto the typed filters.

    With no top-level field set this is exactly ``parse(filters)``. A field
    given both top-level and inside ``filters`` with different values raises
    :class:`MemoryFilterError` (HTTP 422).
    """

    top: Dict[str, Any] = {}
    if as_of not in (None, ""):
        top["as_of"] = as_of
    if as_known_at not in (None, ""):
        top["as_known_at"] = as_known_at
    if include_temporally_unknown is not None:
        top["include_unknown_time"] = bool(include_temporally_unknown)
    if not top:
        return parse(filters)
    if filters is None:
        raw: Dict[str, Any] = {}
        explicit: set = set()
    elif isinstance(filters, MemorySearchFilters):
        raw = filters.as_dict()
        explicit = {key for key in ("as_of", "as_known_at") if raw.get(key)}
        if raw.get("include_unknown_time") is False:
            explicit.add("include_unknown_time")
    elif isinstance(filters, BaseModel):
        raw = filters.model_dump(exclude_none=True)
        explicit = set(filters.model_fields_set)
    elif isinstance(filters, Mapping):
        raw = dict(filters)
        explicit = set(raw)
    else:
        raise MemoryFilterError("memory filters must be an object")
    for key, value in top.items():
        if key in explicit and raw.get(key) is not None and not _same_filter_value(key, raw[key], value):
            raise MemoryFilterError(
                f"top-level {_TOP_LEVEL_FILTER_NAMES[key]} conflicts with filters.{key}"
            )
        raw[key] = value
    return parse(raw)


# ---------------------------------------------------------------------------
# Result presentation
# ---------------------------------------------------------------------------


def _decoded_list(metadata: Mapping[str, Any], field: str) -> Optional[List[Any]]:
    raw = metadata.get(field)
    if raw in (None, ""):
        return []
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return None
    return list(value) if isinstance(value, list) else None


MemoryIdResolver = Callable[[List[str]], Any]


def _lineage_memory_id(ref: Mapping[str, Any]) -> str:
    text = str(ref.get("memory_id") or "").strip()
    if not text or len(text.encode("utf-8")) > MAX_TEMPORAL_RECORD_ID_BYTES:
        return ""
    return text


def source_lineage_view(
    metadata: Optional[Mapping[str, Any]],
    *,
    resolve_memory_ids: Optional[MemoryIdResolver] = None,
) -> List[Dict[str, Any]]:
    """Source lineage view; referenced content is never fetched or returned.

    Without a resolver every reference is reported as ``declared``. With a
    resolver (one bounded, read-only, principal-scoped existence lookup of at
    most 16 IDs per row) a reference naming a ``memory_id`` is reported as
    ``verified`` or ``missing_or_out_of_scope``; references without a
    ``memory_id`` stay ``declared``. A failed lookup keeps ``declared``.
    """

    meta = metadata if isinstance(metadata, Mapping) else {}
    refs = _decoded_list(meta, "source_lineage_json")
    if refs is None:
        return [{"source_available": None, "source_availability": "malformed_reference"}]
    bounded = refs[:MAX_SOURCE_LINEAGE_REFS]
    verified: Optional[set] = None
    if resolve_memory_ids is not None:
        memory_ids = list(dict.fromkeys(
            _lineage_memory_id(ref) for ref in bounded if isinstance(ref, dict)
        ))
        memory_ids = [value for value in memory_ids if value][:MAX_SOURCE_LINEAGE_REFS]
        if memory_ids:
            try:
                verified = {str(value) for value in (resolve_memory_ids(memory_ids) or ())}
            except Exception:
                verified = None
    out: List[Dict[str, Any]] = []
    for ref in bounded:
        if not isinstance(ref, dict):
            out.append({"source_available": None, "source_availability": "malformed_reference"})
            continue
        presented = dict(ref)
        memory_id = _lineage_memory_id(ref)
        if memory_id and verified is not None:
            available = memory_id in verified
            presented["source_available"] = available
            presented["source_availability"] = (
                "verified" if available else "missing_or_out_of_scope"
            )
        else:
            presented.setdefault("source_available", None)
            presented["source_availability"] = "declared"
        out.append(presented)
    return out


def temporal_presentation(metadata: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    meta = metadata if isinstance(metadata, Mapping) else {}
    v1 = is_temporal_v1_metadata(meta)

    def v1_only(key: str) -> Any:
        return meta.get(key) if v1 else None

    time_known = bool(
        v1 and (meta.get("valid_from") or meta.get("occurred_at") or meta.get("occurred_on"))
    )
    supersedes = _decoded_list(meta, "supersedes_json") if v1 else []
    block: Dict[str, Any] = {
        "schema_version": TEMPORAL_MEMORY_SCHEMA_VERSION if v1 else None,
        "time_known": time_known,
        "kind": v1_only("temporal_kind"),
        "precision": v1_only("temporal_precision"),
        "timezone": v1_only("temporal_timezone"),
        "event_id": v1_only("event_id"),
        "event_type": v1_only("event_type"),
        "valid_from": meta.get("valid_from"),
        "valid_to": v1_only("valid_to"),
        "valid_until": meta.get("valid_until"),
        "occurred_at": v1_only("occurred_at"),
        "occurred_on": v1_only("occurred_on"),
        "observed_at": meta.get("observed_at"),
        "ingested_at": v1_only("ingested_at"),
        "source_authority": v1_only("source_authority"),
        "uncertainty": v1_only("uncertainty"),
        "supersedes": [str(item) for item in (supersedes or [])],
        "admission": meta.get("temporal_admission"),
        "query_match": meta.get("temporal_query_match"),
    }
    if not v1:
        block["reason"] = "legacy_or_unspecified"
    elif not time_known:
        block["reason"] = "temporal_contract_without_time"
    else:
        block["reason"] = None
    return block


def present_memory_row(
    row: Mapping[str, Any],
    *,
    resolve_memory_ids: Optional[MemoryIdResolver] = None,
) -> Dict[str, Any]:
    """Add ``temporal`` and ``source_lineage`` without touching other fields."""

    presented = dict(row)
    metadata = presented.get("metadata")
    presented["temporal"] = temporal_presentation(metadata)
    presented["source_lineage"] = source_lineage_view(
        metadata, resolve_memory_ids=resolve_memory_ids
    )
    return presented


def present_memory_search_result(
    result: Any,
    filters: Any = None,
    *,
    resolve_memory_ids: Optional[MemoryIdResolver] = None,
) -> Any:
    if not isinstance(result, dict):
        return result
    presented = dict(result)
    rows = presented.get("results")
    if isinstance(rows, list):
        presented["results"] = [
            present_memory_row(row, resolve_memory_ids=resolve_memory_ids)
            if isinstance(row, Mapping)
            else row
            for row in rows
        ]
    as_of = getattr(filters, "as_of", None) if filters is not None else None
    as_known_at = getattr(filters, "as_known_at", None) if filters is not None else None
    if as_of or as_known_at:
        presented["as_of"] = as_of
        presented["as_known_at"] = as_known_at
        presented["temporal_contract_version"] = TEMPORAL_MEMORY_SCHEMA_VERSION
    return presented


def temporal_search_echo(result: Any) -> Dict[str, Any]:
    """Response keys echoed only when a temporal filter was used."""

    if not isinstance(result, Mapping) or not result.get("temporal_contract_version"):
        return {}
    return {
        key: result.get(key)
        for key in ("as_of", "as_known_at", "temporal_contract_version")
    }
