"""Governed semantic-memory lifecycle primitives.

This module is intentionally stdlib-only and fail-closed.  It centralizes the
parts of memory that must be deterministic across the Librarian, L22, the
owner-file indexer, and the OpenClaw bridge:

* temporal truth and freshness,
* typed pre-retrieval filters,
* privacy admission and hash-only quarantine,
* stable source/chunk/fact identity,
* contradiction/supersession edges,
* review-gated promotion,
* deletion fences/receipts, and
* recall evaluation metrics.

Raw rejected payloads are never written to the governance database.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
from typing import Any, Iterable, Mapping, MutableMapping, Optional, Sequence
import uuid

from cortex_server.modules.sensitive_data_redaction import (
    REDACTION_MARKER,
    is_sensitive_field,
    redact_sensitive_text,
)


_SCHEMA_VERSION = 1
_MAX_FILTER_VALUES = 128
_MAX_FILTER_BYTES = 16_384
_MAX_METADATA_BYTES = 256 * 1024
_MAX_QUARANTINE_ROWS = 65_536
_MAX_PROMOTION_ROWS = 65_536
_MAX_OUTBOX_ROWS = 65_536
_MAX_DELETION_RECEIPTS = 65_536
_MAX_FACTS_PER_CLAIM = 1024
_ALLOWED_TIME_PRECISION = frozenset(
    {"unknown", "year", "month", "day", "hour", "minute", "second", "millisecond"}
)
_ALLOWED_CLASSIFICATIONS = frozenset({"public", "private", "sensitive", "restricted"})
_ALLOWED_EDGE_TYPES = frozenset({"supersedes", "contradicts"})
_ALLOWED_PROMOTION_STATUS = frozenset(
    {"blocked", "pending_review", "approved", "rejected", "promoted"}
)
_OPERATIONAL_TYPES = frozenset(
    {
        "project_state",
        "completion_state",
        "runtime_state",
        "service_status",
        "credentialing_status",
        "claim_status",
    }
)
_MIN_TEMPORAL_EPOCH = -62_135_596_800
_MAX_TEMPORAL_EPOCH = 253_402_300_799
_SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/ -]{0,255}$")
_HIGH_RISK_MEMORY_RE = re.compile(
    r"(?:\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|"
    r"password|passwd|authorization|patient[_-]?(?:name|id|email|phone)|"
    r"medical[_-]?record[_-]?number|mrn|diagnosis|date[_-]?of[_-]?birth|dob)\b\s*[:=]"
    r"|\bsk-[A-Za-z0-9_-]{12,}\b|\bgh[pousr]_[A-Za-z0-9]{16,}\b|"
    r"\bAKIA[A-Z0-9]{16}\b|\b\d{3}-\d{2}-\d{4}\b|"
    r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}\.[A-Za-z0-9._-]{8,}\b)",
    re.IGNORECASE,
)
_GOVERNANCE_LOCK = threading.RLock()


class MemoryGovernanceError(RuntimeError):
    """Governance state is malformed, unavailable, or inconsistent."""


class MemoryAdmissionRejected(MemoryGovernanceError):
    """A payload was quarantined before raw persistence."""

    def __init__(self, decision: "AdmissionDecision") -> None:
        super().__init__("memory payload was quarantined by admission policy")
        self.decision = decision


class MemoryFilterError(MemoryGovernanceError):
    """A typed filter is malformed or unsupported."""


class MemoryDeletionError(MemoryGovernanceError):
    """A principal deletion could not converge across required stores."""


class MemoryPromotionError(MemoryGovernanceError):
    """A promotion transition is invalid or not authorized."""


def _utc_now(now: Optional[datetime] = None) -> datetime:
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None:
        raise MemoryGovernanceError("timestamps must be timezone-aware")
    return value.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    # Deletion fences compare against millisecond client spool creation times;
    # second-level truncation can misclassify a pre-fence write created earlier
    # in the same second as post-deletion data.
    return _utc_now(value).isoformat(timespec="microseconds").replace("+00:00", "Z")


def parse_timestamp(value: Any, *, field_name: str, required: bool = False) -> Optional[datetime]:
    if value in (None, ""):
        if required:
            raise MemoryGovernanceError(f"{field_name} is required")
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            parsed = datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError) as exc:
            raise MemoryGovernanceError(
                f"{field_name} must be a finite timestamp"
            ) from exc
    elif isinstance(value, str):
        raw = value.strip()
        if not raw:
            if required:
                raise MemoryGovernanceError(f"{field_name} is required")
            return None
        try:
            parsed = datetime.fromisoformat(raw[:-1] + "+00:00" if raw.endswith("Z") else raw)
        except ValueError as exc:
            raise MemoryGovernanceError(f"{field_name} must be an ISO-8601 timestamp") from exc
    else:
        raise MemoryGovernanceError(f"{field_name} must be an ISO-8601 timestamp")
    if parsed.tzinfo is None:
        raise MemoryGovernanceError(f"{field_name} must include a timezone")
    return parsed.astimezone(timezone.utc)


def canonical_json(value: Any) -> str:
    try:
        rendered = json.dumps(
            value,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise MemoryGovernanceError("value must be finite JSON") from exc
    if len(rendered.encode("utf-8")) > _MAX_METADATA_BYTES:
        raise MemoryGovernanceError("value exceeds the governance byte limit")
    return rendered


def sha256_text(value: str) -> str:
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def canonical_value_hash(value: Any) -> str:
    """Hash a JSON value without copying large memory text into metadata JSON."""

    if isinstance(value, str):
        return sha256_text("cortex.memory.value.string.v1\0" + value)
    return sha256_text("cortex.memory.value.json.v1\0" + canonical_json(value))


def stable_source_id(principal_key: str, source_path: str) -> str:
    principal = str(principal_key or "").strip()
    path = str(source_path or "").strip()
    if not principal or not path:
        raise MemoryGovernanceError("stable source identity requires principal and path")
    digest = sha256_text("cortex.memory.source.v1\0" + principal + "\0" + path)
    return "src_" + digest[:48]


def stable_chunk_id(source_id: str, text: str, duplicate_index: int = 0) -> str:
    source = str(source_id or "").strip()
    if (
        not source
        or not isinstance(duplicate_index, int)
        or isinstance(duplicate_index, bool)
        or duplicate_index < 0
    ):
        raise MemoryGovernanceError("stable chunk identity is incomplete")
    content_hash = sha256_text(str(text))
    digest = sha256_text(
        "cortex.memory.chunk.v1\0" + source + "\0" + content_hash + "\0" + str(duplicate_index)
    )
    return "chk_" + digest[:48]


def stable_fact_key(source_id: str, chunk_id: str) -> str:
    source = str(source_id or "").strip()
    chunk = str(chunk_id or "").strip()
    if not source or not chunk:
        raise MemoryGovernanceError("stable fact identity is incomplete")
    return f"owner-file:{source}:{chunk}"


def tag_filter_field(tag: str) -> str:
    normalized = str(tag or "").strip().casefold()
    if not normalized:
        raise MemoryFilterError("tags may not be empty")
    return "tag_" + sha256_text(normalized)[:24]


def _normalize_tag_values(value: Any) -> list[str]:
    if value is None:
        return []
    values = value if isinstance(value, list) else [value]
    normalized: list[str] = []
    for item in values:
        token = str(item or "").strip()
        if not token:
            continue
        if len(token.encode("utf-8")) > 256:
            raise MemoryGovernanceError("memory tag exceeds byte limit")
        if token not in normalized:
            normalized.append(token)
    if len(normalized) > _MAX_FILTER_VALUES:
        raise MemoryGovernanceError("memory tag count exceeds limit")
    return normalized


def normalize_temporal_metadata(
    metadata: Optional[Mapping[str, Any]], *, now: Optional[datetime] = None
) -> dict[str, Any]:
    """Normalize temporal fields without inventing an event time.

    ``observed_at`` is always known for a new write.  ``valid_from`` remains
    absent for a generic fact unless supplied by the caller.  Operational state
    is valid from observation and receives a bounded default staleness window.
    """

    current = _utc_now(now)
    result = dict(metadata or {})
    observed = parse_timestamp(
        result.get("observed_at") or result.get("observedAt") or result.get("timestamp"),
        field_name="observed_at",
    ) or current
    known = parse_timestamp(
        result.get("known_at") or result.get("as_known_at") or result.get("knownAt"),
        field_name="known_at",
    ) or observed
    valid_from = parse_timestamp(
        result.get("valid_from") or result.get("validFrom"),
        field_name="valid_from",
    )
    valid_until = parse_timestamp(
        result.get("valid_until") or result.get("validUntil"),
        field_name="valid_until",
    )
    last_verified = parse_timestamp(
        result.get("last_verified_at") or result.get("lastVerifiedAt"),
        field_name="last_verified_at",
    )
    stale_after = parse_timestamp(
        result.get("stale_after") or result.get("staleAfter"),
        field_name="stale_after",
    )

    memory_type = str(
        result.get("memory_type") or result.get("type") or result.get("kind") or "memory"
    ).strip().casefold()
    if valid_from is None and memory_type in _OPERATIONAL_TYPES:
        valid_from = observed
    ttl_value = result.get("freshness_ttl_seconds")
    if ttl_value not in (None, ""):
        try:
            ttl_seconds = int(ttl_value)
        except (TypeError, ValueError) as exc:
            raise MemoryGovernanceError("freshness_ttl_seconds must be an integer") from exc
        if ttl_seconds < 60 or ttl_seconds > 10 * 365 * 24 * 60 * 60:
            raise MemoryGovernanceError("freshness_ttl_seconds is outside the allowed range")
        stale_after = observed + timedelta(seconds=ttl_seconds)
    elif stale_after is None and memory_type in _OPERATIONAL_TYPES:
        try:
            ttl_seconds = int(
                os.getenv("CORTEX_MEMORY_OPERATIONAL_TTL_SECONDS", "2592000")
            )
        except ValueError as exc:
            raise MemoryGovernanceError(
                "CORTEX_MEMORY_OPERATIONAL_TTL_SECONDS must be an integer"
            ) from exc
        ttl_seconds = max(3600, min(ttl_seconds, 365 * 24 * 60 * 60))
        stale_after = observed + timedelta(seconds=ttl_seconds)

    independently_verified = result.get("independently_verified") is True
    if independently_verified and last_verified is None:
        last_verified = observed
    if valid_from is not None and valid_until is not None and valid_until < valid_from:
        raise MemoryGovernanceError("valid_until may not be earlier than valid_from")
    if last_verified is not None and last_verified > current + timedelta(minutes=5):
        raise MemoryGovernanceError("last_verified_at may not be in the future")
    if stale_after is not None and stale_after < observed:
        raise MemoryGovernanceError("stale_after may not be earlier than observed_at")
    if known < observed - timedelta(days=36500):
        raise MemoryGovernanceError("known_at is implausibly earlier than observed_at")

    precision = str(result.get("time_precision") or "second").strip().casefold()
    if precision not in _ALLOWED_TIME_PRECISION:
        raise MemoryGovernanceError("time_precision is unsupported")

    result["observed_at"] = _iso(observed)
    result["known_at"] = _iso(known)
    result["observed_at_epoch"] = int(observed.timestamp())
    result["known_at_epoch"] = int(known.timestamp())
    result["temporal_index_version"] = 1
    result["time_precision"] = precision
    if valid_from is not None:
        result["valid_from"] = _iso(valid_from)
        result["valid_from_epoch"] = int(valid_from.timestamp())
    else:
        result.pop("valid_from", None)
        result["valid_from_epoch"] = _MIN_TEMPORAL_EPOCH
    if valid_until is not None:
        result["valid_until"] = _iso(valid_until)
        result["valid_until_epoch"] = int(valid_until.timestamp())
    else:
        result.pop("valid_until", None)
        result["valid_until_epoch"] = _MAX_TEMPORAL_EPOCH
    if last_verified is not None:
        result["last_verified_at"] = _iso(last_verified)
        result["last_verified_at_epoch"] = int(last_verified.timestamp())
    else:
        result.pop("last_verified_at", None)
        result["last_verified_at_epoch"] = _MIN_TEMPORAL_EPOCH
    if stale_after is not None:
        result["stale_after"] = _iso(stale_after)
        result["stale_after_epoch"] = int(stale_after.timestamp())
    else:
        result.pop("stale_after", None)
        result["stale_after_epoch"] = _MAX_TEMPORAL_EPOCH

    if valid_from is None and valid_until is None:
        result["valid_time_state"] = "unknown"
        result["valid_time_known"] = False
    elif valid_from is None:
        result["valid_time_state"] = "unknown_start"
        result["valid_time_known"] = False
    elif valid_until is None:
        result["valid_time_state"] = "open_ended"
        result["valid_time_known"] = True
    else:
        result["valid_time_state"] = "bounded"
        result["valid_time_known"] = True
    if stale_after is not None and current > stale_after:
        result["freshness_state"] = "stale"
    elif last_verified is not None:
        result["freshness_state"] = "fresh"
        result["freshness_known"] = True
    else:
        result["freshness_state"] = "unknown"
        result["freshness_known"] = False
    if stale_after is not None and current > stale_after:
        result["freshness_known"] = True
    return result


@dataclass(frozen=True)
class TemporalDecision:
    visible: bool
    freshness_state: str
    valid_time_state: str
    reason: str


def temporal_visibility(
    metadata: Optional[Mapping[str, Any]],
    *,
    as_of: Optional[Any] = None,
    as_known_at: Optional[Any] = None,
    include_stale: bool = False,
    include_unknown_time: bool = True,
    now: Optional[datetime] = None,
) -> TemporalDecision:
    current = _utc_now(now)
    effective_at = parse_timestamp(as_of, field_name="as_of") or current
    known_at = parse_timestamp(as_known_at, field_name="as_known_at") or current
    meta = dict(metadata or {})
    if not any(
        key in meta
        for key in (
            "observed_at",
            "known_at",
            "valid_from",
            "valid_until",
            "last_verified_at",
            "stale_after",
            "valid_time_state",
        )
    ):
        return TemporalDecision(
            visible=include_unknown_time,
            freshness_state="legacy_unknown",
            valid_time_state="unknown",
            reason="legacy_record_has_no_temporal_metadata",
        )
    try:
        observed = parse_timestamp(meta.get("observed_at"), field_name="observed_at")
        first_known = parse_timestamp(meta.get("known_at"), field_name="known_at") or observed
        valid_from = parse_timestamp(meta.get("valid_from"), field_name="valid_from")
        valid_until = parse_timestamp(meta.get("valid_until"), field_name="valid_until")
        stale_after = parse_timestamp(meta.get("stale_after"), field_name="stale_after")
        last_verified = parse_timestamp(
            meta.get("last_verified_at"), field_name="last_verified_at"
        )
    except MemoryGovernanceError:
        return TemporalDecision(False, "invalid", "invalid", "malformed_temporal_metadata")
    if first_known is not None and first_known > known_at:
        return TemporalDecision(False, "not_yet_known", "known_later", "not_known_at_requested_time")
    if valid_from is not None and effective_at < valid_from:
        return TemporalDecision(False, "not_yet_valid", "future", "not_valid_at_requested_time")
    if valid_until is not None and effective_at > valid_until:
        return TemporalDecision(False, "expired", "historical", "validity_window_ended")
    valid_state = (
        "bounded" if valid_from is not None and valid_until is not None
        else "open_ended" if valid_from is not None
        else "unknown"
    )
    if valid_state == "unknown" and not include_unknown_time:
        return TemporalDecision(False, "unknown", valid_state, "unknown_valid_time_excluded")
    freshness_reference = max(effective_at, known_at)
    if stale_after is not None and freshness_reference > stale_after:
        return TemporalDecision(
            include_stale,
            "stale",
            valid_state,
            "stale_record_included" if include_stale else "stale_record_excluded",
        )
    freshness = "fresh" if last_verified is not None else "unknown"
    return TemporalDecision(True, freshness, valid_state, "visible")


def refresh_temporal_verification(
    metadata: Mapping[str, Any],
    *,
    verified_at: Any = None,
) -> dict[str, Any]:
    """Apply one coherent verification and freshness checkpoint.

    Verification advances ``last_verified_at`` and, when the record has a TTL
    contract, ``stale_after``. Merely changing the display state to ``fresh``
    while retaining an expired boundary would make pre/post-ranking truth
    disagree.
    """

    current = parse_timestamp(
        verified_at if verified_at is not None else _utc_now(),
        field_name="verified_at",
    )
    if current is None:  # pragma: no cover - guarded by the supplied default
        raise MemoryGovernanceError("verified_at is required")
    result = dict(metadata)
    memory_type = str(
        result.get("memory_type") or result.get("type") or result.get("kind") or "memory"
    ).strip().casefold()
    ttl_value = result.get("freshness_ttl_seconds")
    if ttl_value not in (None, ""):
        try:
            ttl_seconds = int(ttl_value)
        except (TypeError, ValueError) as exc:
            raise MemoryGovernanceError(
                "freshness_ttl_seconds must be an integer"
            ) from exc
        if ttl_seconds < 60 or ttl_seconds > 10 * 365 * 24 * 60 * 60:
            raise MemoryGovernanceError(
                "freshness_ttl_seconds is outside the allowed range"
            )
    elif memory_type in _OPERATIONAL_TYPES:
        try:
            ttl_seconds = int(
                os.getenv("CORTEX_MEMORY_OPERATIONAL_TTL_SECONDS", "2592000")
            )
        except ValueError as exc:
            raise MemoryGovernanceError(
                "CORTEX_MEMORY_OPERATIONAL_TTL_SECONDS must be an integer"
            ) from exc
        ttl_seconds = max(3600, min(ttl_seconds, 365 * 24 * 60 * 60))
    else:
        previous_stale = parse_timestamp(
            result.get("stale_after"), field_name="stale_after"
        )
        previous_observed = parse_timestamp(
            result.get("observed_at"), field_name="observed_at"
        )
        if previous_stale is not None and previous_observed is not None:
            ttl_seconds = max(60, int((previous_stale - previous_observed).total_seconds()))
        else:
            # Durable/owner records are not silently assigned an operational
            # TTL when their source contract never declared one.
            ttl_seconds = 0
    result.update(
        {
            "last_verified_at": _iso(current),
            "last_verified_at_epoch": int(current.timestamp()),
            "freshness_state": "fresh",
            "freshness_known": True,
            "temporal_index_version": 1,
        }
    )
    if ttl_seconds:
        stale_after = current + timedelta(seconds=ttl_seconds)
        result["stale_after"] = _iso(stale_after)
        result["stale_after_epoch"] = int(stale_after.timestamp())
    else:
        result.pop("stale_after", None)
        result["stale_after_epoch"] = _MAX_TEMPORAL_EPOCH
    return result


def _bounded_filter_values(field_name: str, values: Any) -> tuple[str, ...]:
    if values in (None, ""):
        return ()
    raw_values = values if isinstance(values, (list, tuple, set)) else [values]
    if len(raw_values) > _MAX_FILTER_VALUES:
        raise MemoryFilterError(f"{field_name} has too many values")
    normalized: list[str] = []
    for raw in raw_values:
        value = str(raw or "").strip()
        if not value or len(value.encode("utf-8")) > 256 or not _SAFE_TOKEN_RE.fullmatch(value):
            raise MemoryFilterError(f"{field_name} contains an invalid value")
        if value not in normalized:
            normalized.append(value)
    if sum(len(item.encode("utf-8")) for item in normalized) > _MAX_FILTER_BYTES:
        raise MemoryFilterError(f"{field_name} exceeds its byte limit")
    return tuple(normalized)


@dataclass(frozen=True)
class MemorySearchFilters:
    source_ids: tuple[str, ...] = ()
    source_paths: tuple[str, ...] = ()
    memory_types: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()
    fact_keys: tuple[str, ...] = ()
    claim_keys: tuple[str, ...] = ()
    projects: tuple[str, ...] = ()
    classifications: tuple[str, ...] = ()
    statuses: tuple[str, ...] = ()
    as_of: Optional[str] = None
    as_known_at: Optional[str] = None
    include_stale: bool = False
    include_unknown_time: bool = True
    include_conflicts: bool = False

    @classmethod
    def from_mapping(cls, value: Optional[Mapping[str, Any]]) -> "MemorySearchFilters":
        raw = dict(value or {})
        allowed = {
            "source_ids",
            "source_paths",
            "memory_types",
            "tags",
            "fact_keys",
            "claim_keys",
            "projects",
            "classifications",
            "statuses",
            "as_of",
            "as_known_at",
            "include_stale",
            "include_unknown_time",
            "include_conflicts",
        }
        unknown = sorted(set(raw) - allowed)
        if unknown:
            raise MemoryFilterError("unsupported memory filter fields: " + ", ".join(unknown))
        classifications = _bounded_filter_values(
            "classifications", raw.get("classifications")
        )
        if any(item not in _ALLOWED_CLASSIFICATIONS for item in classifications):
            raise MemoryFilterError("unsupported memory classification filter")
        statuses = _bounded_filter_values("statuses", raw.get("statuses"))
        allowed_statuses = {"active", "superseded", "tombstoned", "historical", "conflicted"}
        if any(item not in allowed_statuses for item in statuses):
            raise MemoryFilterError("unsupported memory status filter")
        as_of_dt = parse_timestamp(raw.get("as_of"), field_name="as_of")
        known_dt = parse_timestamp(raw.get("as_known_at"), field_name="as_known_at")
        return cls(
            source_ids=_bounded_filter_values("source_ids", raw.get("source_ids")),
            source_paths=_bounded_filter_values("source_paths", raw.get("source_paths")),
            memory_types=_bounded_filter_values("memory_types", raw.get("memory_types")),
            tags=_bounded_filter_values("tags", raw.get("tags")),
            fact_keys=_bounded_filter_values("fact_keys", raw.get("fact_keys")),
            claim_keys=_bounded_filter_values("claim_keys", raw.get("claim_keys")),
            projects=_bounded_filter_values("projects", raw.get("projects")),
            classifications=classifications,
            statuses=statuses,
            as_of=_iso(as_of_dt) if as_of_dt else None,
            as_known_at=_iso(known_dt) if known_dt else None,
            include_stale=raw.get("include_stale") is True,
            include_unknown_time=raw.get("include_unknown_time") is not False,
            include_conflicts=raw.get("include_conflicts") is True,
        )

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def normalize_filterable_metadata(
    metadata: Optional[Mapping[str, Any]],
    *,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    result = normalize_temporal_metadata(metadata, now=now)
    tags = _normalize_tag_values(result.get("tags"))
    if tags:
        result["tags"] = tags
        for tag in tags:
            result[tag_filter_field(tag)] = True
    if "type" in result and "memory_type" not in result:
        result["memory_type"] = str(result["type"])
    if "memory_type" in result and "type" not in result:
        result["type"] = str(result["memory_type"])
    for field_name in (
        "source_id",
        "chunk_id",
        "source_revision",
        "fact_key",
        "claim_key",
        "project",
        "source_classification",
    ):
        if field_name in result:
            value = str(result[field_name] or "").strip()
            if not value:
                result.pop(field_name, None)
            elif len(value.encode("utf-8")) > 1024:
                raise MemoryGovernanceError(f"{field_name} exceeds byte limit")
            else:
                result[field_name] = value
    return result


def compile_chroma_where(
    principal_where: Optional[Mapping[str, Any]], filters: Optional[MemorySearchFilters]
) -> Optional[dict[str, Any]]:
    clauses: list[dict[str, Any]] = []
    if principal_where:
        principal_clause = dict(principal_where)
        if set(principal_clause) == {"$and"} and isinstance(
            principal_clause.get("$and"), list
        ):
            clauses.extend(dict(item) for item in principal_clause["$and"])
        else:
            clauses.append(principal_clause)
    if filters is None:
        return dict(principal_where) if principal_where else None

    def add_values(field_name: str, values: Sequence[str]) -> None:
        if not values:
            return
        clauses.append(
            {field_name: values[0]}
            if len(values) == 1
            else {field_name: {"$in": list(values)}}
        )

    add_values("source_id", filters.source_ids)
    add_values("path", filters.source_paths)
    add_values("memory_type", filters.memory_types)
    add_values("fact_key", filters.fact_keys)
    add_values("claim_key", filters.claim_keys)
    add_values("project", filters.projects)
    add_values("privacy_classification", filters.classifications)
    status_prefilter = list(filters.statuses)
    if "conflicted" in status_prefilter:
        # Fact conflict state lives in the governance graph; the underlying
        # active projections intentionally remain active so a winner can be
        # changed without mutating every vector row.
        status_prefilter = [value for value in status_prefilter if value != "conflicted"]
        status_prefilter.append("active")
    add_values("memory_status", tuple(dict.fromkeys(status_prefilter)))
    for tag in filters.tags:
        clauses.append({tag_filter_field(tag): True})
    as_of = parse_timestamp(filters.as_of, field_name="as_of")
    as_known_at = parse_timestamp(filters.as_known_at, field_name="as_known_at")
    # Chroma has no portable ``field is absent`` predicate.  A temporal
    # predicate combined with include_unknown_time=True would therefore erase
    # legacy records before ranking instead of including them.  Compile the
    # complete temporal contract only for strict queries; permissive queries
    # are still fail-closed rechecked by ``row_matches_filters`` after fetch.
    if not filters.include_unknown_time:
        current = _utc_now()
        effective_at = as_of or current
        freshness_at = as_known_at or as_of or current
        clauses.extend(
            [
                {"temporal_index_version": 1},
                {"valid_time_known": True},
                {"valid_from_epoch": {"$lte": int(effective_at.timestamp())}},
                {"valid_until_epoch": {"$gte": int(effective_at.timestamp())}},
            ]
        )
        if as_known_at is not None:
            clauses.append(
                {"known_at_epoch": {"$lte": int(as_known_at.timestamp())}}
            )
        if not filters.include_stale:
            clauses.append(
                {"stale_after_epoch": {"$gte": int(freshness_at.timestamp())}}
            )
    if not clauses:
        return None
    if len(clauses) == 1:
        return clauses[0]
    return {"$and": clauses}


def row_matches_filters(
    metadata: Optional[Mapping[str, Any]],
    filters: Optional[MemorySearchFilters],
    *,
    check_status: bool = True,
) -> bool:
    if filters is None:
        return True
    meta = dict(metadata or {})
    comparisons = (
        (filters.source_ids, str(meta.get("source_id") or "")),
        (filters.source_paths, str(meta.get("path") or "")),
        (filters.memory_types, str(meta.get("memory_type") or meta.get("type") or "")),
        (filters.fact_keys, str(meta.get("fact_key") or "")),
        (filters.claim_keys, str(meta.get("claim_key") or "")),
        (filters.projects, str(meta.get("project") or "")),
        (filters.classifications, str(meta.get("privacy_classification") or "private")),
        (
            filters.statuses if check_status else (),
            str(meta.get("memory_status") or "active"),
        ),
    )
    if any(values and current not in values for values, current in comparisons):
        return False
    tags = set(_normalize_tag_values(meta.get("tags")))
    if filters.tags and not set(filters.tags).issubset(tags):
        return False
    temporal = temporal_visibility(
        meta,
        as_of=filters.as_of,
        as_known_at=filters.as_known_at,
        include_stale=filters.include_stale,
        include_unknown_time=filters.include_unknown_time,
    )
    return temporal.visible


@dataclass(frozen=True)
class AdmissionDecision:
    allowed: bool
    action: str
    classification: str
    payload_hash: str
    metadata_hash: str
    reasons: tuple[str, ...] = ()

    def public_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "action": self.action,
            "classification": self.classification,
            "payload_hash": self.payload_hash,
            "metadata_hash": self.metadata_hash,
            "reasons": list(self.reasons),
        }


def classify_memory_admission(
    content: str,
    metadata: Optional[Mapping[str, Any]],
    *,
    allow_sensitive: bool = False,
    baa_authorized: bool = False,
    encryption_at_rest: bool = False,
) -> AdmissionDecision:
    text = str(content or "")
    meta = dict(metadata or {})
    payload_hash = sha256_text(text)
    metadata_hash = sha256_text(canonical_json(meta))
    reasons: list[str] = []

    explicit = str(
        meta.get("privacy_classification")
        or meta.get("classification")
        or meta.get("source_classification")
        or "private"
    ).strip().casefold()
    aliases = {
        "owner_non_phi": "private",
        "internal": "private",
        "phi": "restricted",
        "secret": "restricted",
        "confidential": "sensitive",
    }
    classification = aliases.get(explicit, explicit)
    if classification not in _ALLOWED_CLASSIFICATIONS:
        classification = "private"
        reasons.append("unknown_classification_downgraded_to_private")

    redacted_text = redact_sensitive_text(text)
    if REDACTION_MARKER in redacted_text or redacted_text != text:
        if explicit == "owner_non_phi" and not _HIGH_RISK_MEMORY_RE.search(text):
            classification = "private"
            reasons.append("scanner_detected_owner_private_identifier")
        else:
            classification = "restricted"
            reasons.append("shared_sensitive_data_scanner_detected_content")
    serialized_metadata = canonical_json(meta)
    redacted_metadata = redact_sensitive_text(serialized_metadata)
    if REDACTION_MARKER in redacted_metadata or redacted_metadata != serialized_metadata:
        if explicit == "owner_non_phi" and not _HIGH_RISK_MEMORY_RE.search(
            serialized_metadata
        ):
            classification = "private"
            reasons.append("scanner_detected_owner_private_metadata")
        else:
            classification = "restricted"
            reasons.append("shared_sensitive_data_scanner_detected_metadata")
    sensitive_fields = sorted(
        str(key) for key in meta if is_sensitive_field(str(key)) and meta.get(key) not in (None, "")
    )
    if sensitive_fields:
        classification = "restricted"
        reasons.append("sensitive_metadata_fields:" + ",".join(sensitive_fields[:16]))
    if meta.get("contains_phi") is True or meta.get("containsPhi") is True:
        classification = "restricted"
        reasons.append("payload_declares_phi")
    if meta.get("contains_secret") is True or meta.get("containsSecret") is True:
        classification = "restricted"
        reasons.append("payload_declares_secret")

    sensitive_allowed = bool(allow_sensitive and baa_authorized and encryption_at_rest)
    if classification in {"sensitive", "restricted"} and not sensitive_allowed:
        return AdmissionDecision(
            allowed=False,
            action="quarantine_hash_only",
            classification=classification,
            payload_hash=payload_hash,
            metadata_hash=metadata_hash,
            reasons=tuple(reasons or ["sensitive_payload_requires_explicit_authorized_route"]),
        )
    return AdmissionDecision(
        allowed=True,
        action="allow",
        classification=classification,
        payload_hash=payload_hash,
        metadata_hash=metadata_hash,
        reasons=tuple(reasons),
    )


def governance_db_path() -> Path:
    configured = str(os.getenv("CORTEX_MEMORY_GOVERNANCE_DB", "")).strip()
    if configured:
        return Path(configured)
    chroma = Path(os.getenv("CORTEX_CHROMA_DIR", "/var/lib/cortex/chroma"))
    return chroma / "memory_governance.sqlite3"


@dataclass(frozen=True)
class FactProjection:
    memory_id: str
    fact_key: str
    claim_key: str
    value_hash: str
    active_winner_id: str
    edge_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class DeletionFence:
    deletion_id: str
    principal_key: str
    deletion_epoch: str


class MemoryGovernanceStore:
    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = Path(path or governance_db_path())

    def _connect(self) -> sqlite3.Connection:
        parent_existed = self.path.parent.exists()
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not parent_existed:
            try:
                os.chmod(self.path.parent, 0o700)
            except OSError:
                pass
        if self.path.is_symlink() or (
            self.path.exists() and not self.path.is_file()
        ):
            raise MemoryGovernanceError(
                "memory governance database must be a regular file"
            )
        connection = sqlite3.connect(str(self.path), timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA busy_timeout=30000")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS governance_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS quarantine (
                quarantine_id TEXT PRIMARY KEY,
                principal_key TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                metadata_hash TEXT NOT NULL,
                classification TEXT NOT NULL,
                reasons_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(principal_key, payload_hash, metadata_hash)
            );
            CREATE TABLE IF NOT EXISTS facts (
                memory_id TEXT PRIMARY KEY,
                principal_key TEXT NOT NULL,
                fact_key TEXT NOT NULL,
                claim_key TEXT NOT NULL,
                source_id TEXT NOT NULL DEFAULT '',
                value_hash TEXT NOT NULL,
                subject_hash TEXT NOT NULL DEFAULT '',
                predicate TEXT NOT NULL DEFAULT '',
                scope_hash TEXT NOT NULL DEFAULT '',
                confidence REAL NOT NULL DEFAULT 0.5,
                authority INTEGER NOT NULL DEFAULT 0,
                provenance_hash TEXT NOT NULL DEFAULT '',
                observed_at TEXT NOT NULL,
                last_verified_at TEXT,
                valid_from TEXT,
                valid_until TEXT,
                stale_after TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_facts_principal_claim
                ON facts(principal_key, claim_key, status);
            CREATE INDEX IF NOT EXISTS idx_facts_principal_fact
                ON facts(principal_key, fact_key, status);
            CREATE TABLE IF NOT EXISTS fact_edges (
                edge_id TEXT PRIMARY KEY,
                principal_key TEXT NOT NULL,
                from_memory_id TEXT NOT NULL,
                to_memory_id TEXT NOT NULL,
                edge_type TEXT NOT NULL,
                claim_key TEXT NOT NULL,
                reason TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(principal_key, from_memory_id, to_memory_id, edge_type)
            );
            CREATE INDEX IF NOT EXISTS idx_fact_edges_principal_claim
                ON fact_edges(principal_key, claim_key, edge_type);
            CREATE TABLE IF NOT EXISTS promotion_queue (
                memory_id TEXT PRIMARY KEY,
                principal_key TEXT NOT NULL,
                status TEXT NOT NULL,
                candidate_fact INTEGER NOT NULL,
                evidence_count INTEGER NOT NULL,
                required_evidence_count INTEGER NOT NULL,
                score REAL NOT NULL,
                privacy_classification TEXT NOT NULL,
                reasons_json TEXT NOT NULL,
                reviewer TEXT,
                reviewed_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_promotion_principal_status
                ON promotion_queue(principal_key, status, updated_at);
            CREATE TABLE IF NOT EXISTS deletion_fences (
                principal_key TEXT PRIMARY KEY,
                deletion_id TEXT NOT NULL,
                deletion_epoch TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS deletion_receipts (
                deletion_id TEXT PRIMARY KEY,
                principal_digest TEXT NOT NULL,
                deletion_epoch TEXT NOT NULL,
                counts_json TEXT NOT NULL,
                completed INTEGER NOT NULL,
                completed_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS write_outbox (
                operation_id TEXT PRIMARY KEY,
                principal_key TEXT NOT NULL,
                payload_hash TEXT NOT NULL,
                state TEXT NOT NULL,
                receipt_id TEXT,
                observed_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(principal_key, payload_hash, operation_id)
            );
            CREATE INDEX IF NOT EXISTS idx_write_outbox_principal_state
                ON write_outbox(principal_key, state, updated_at);
            """
        )
        connection.execute(
            "INSERT INTO governance_state(key, value) VALUES ('schema_version', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(_SCHEMA_VERSION),),
        )
        connection.commit()
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass
        return connection

    def quarantine(
        self,
        principal_key: str,
        decision: AdmissionDecision,
        *,
        observed_at: Any = None,
    ) -> str:
        principal = str(principal_key or "").strip()
        if not principal or decision.allowed:
            raise MemoryGovernanceError("quarantine requires a rejected principal payload")
        quarantine_id = "q_" + sha256_text(
            "\0".join((principal, decision.payload_hash, decision.metadata_hash))
        )[:48]
        observed = parse_timestamp(
            observed_at if observed_at is not None else _utc_now(),
            field_name="observed_at",
            required=True,
        )
        assert observed is not None
        now = _iso(_utc_now())
        with _GOVERNANCE_LOCK:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                fence = connection.execute(
                    "SELECT deletion_epoch FROM deletion_fences WHERE principal_key = ?",
                    (principal,),
                ).fetchone()
                if fence is not None:
                    deletion_epoch = parse_timestamp(
                        fence["deletion_epoch"],
                        field_name="deletion_epoch",
                        required=True,
                    )
                    assert deletion_epoch is not None
                    if observed <= deletion_epoch:
                        raise MemoryDeletionError(
                            "rejected write predates the principal deletion fence"
                        )
                existing = connection.execute(
                    "SELECT quarantine_id FROM quarantine WHERE principal_key = ? "
                    "AND payload_hash = ? AND metadata_hash = ?",
                    (principal, decision.payload_hash, decision.metadata_hash),
                ).fetchone()
                if existing is None:
                    rows = int(
                        connection.execute("SELECT COUNT(*) FROM quarantine").fetchone()[0]
                    )
                    if rows >= _MAX_QUARANTINE_ROWS:
                        raise MemoryGovernanceError("quarantine row bound reached")
                connection.execute(
                    "INSERT INTO quarantine(quarantine_id, principal_key, payload_hash, "
                    "metadata_hash, classification, reasons_json, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(principal_key, payload_hash, "
                    "metadata_hash) DO NOTHING",
                    (
                        quarantine_id,
                        principal,
                        decision.payload_hash,
                        decision.metadata_hash,
                        decision.classification,
                        canonical_json(list(decision.reasons)),
                        now,
                    ),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()
        return quarantine_id

    def admit(
        self,
        principal_key: str,
        content: str,
        metadata: Optional[Mapping[str, Any]],
        observed_at: Any = None,
        **policy: Any,
    ) -> AdmissionDecision:
        decision = classify_memory_admission(content, metadata, **policy)
        if not decision.allowed:
            self.quarantine(
                principal_key,
                decision,
                observed_at=observed_at,
            )
        return decision

    @staticmethod
    def _claim_key(metadata: Mapping[str, Any]) -> str:
        explicit = str(metadata.get("claim_key") or "").strip()
        if explicit:
            return explicit
        subject = str(metadata.get("subject") or "").strip()
        predicate = str(metadata.get("predicate") or "").strip()
        scope = metadata.get("fact_scope") or metadata.get("scope") or ""
        if not subject or not predicate:
            return ""
        return "claim_" + sha256_text(
            "cortex.memory.claim.v1\0" + subject + "\0" + predicate + "\0" + canonical_json(scope)
        )[:48]

    @staticmethod
    def _fact_key(metadata: Mapping[str, Any], claim_key: str, value_hash: str) -> str:
        explicit = str(metadata.get("fact_key") or "").strip()
        if explicit:
            return explicit
        if not claim_key:
            return ""
        source_id = str(metadata.get("source_id") or metadata.get("source") or "unknown")
        return "fact_" + sha256_text(
            "cortex.memory.fact.v1\0" + claim_key + "\0" + value_hash + "\0" + source_id
        )[:48]

    @staticmethod
    def _rank(row: Mapping[str, Any]) -> tuple[Any, ...]:
        verified = str(row.get("last_verified_at") or "")
        stale_after = parse_timestamp(
            row.get("stale_after"), field_name="stale_after"
        )
        if verified and (stale_after is None or stale_after >= _utc_now()):
            freshness_rank = 2
        elif verified:
            freshness_rank = 0
        else:
            freshness_rank = 1
        return (
            int(row.get("authority") or 0),
            freshness_rank,
            float(row.get("confidence") or 0.0),
            verified,
            str(row.get("observed_at") or ""),
            str(row.get("memory_id") or ""),
        )

    def record_fact(
        self,
        *,
        principal_key: str,
        memory_id: str,
        content: str,
        metadata: Mapping[str, Any],
    ) -> Optional[FactProjection]:
        principal = str(principal_key or "").strip()
        memory = str(memory_id or "").strip()
        if not principal or not memory:
            raise MemoryGovernanceError("fact projection requires principal and memory ID")
        normalized = normalize_filterable_metadata(metadata)
        value = normalized.get("fact_value", content)
        value_hash = canonical_value_hash(value)
        claim_key = self._claim_key(normalized)
        fact_key = self._fact_key(normalized, claim_key, value_hash)
        if not claim_key and not fact_key:
            return None
        if not claim_key:
            claim_key = "claim_" + sha256_text("fact-key\0" + fact_key)[:48]
        if not fact_key:
            fact_key = "fact_" + sha256_text("claim-value\0" + claim_key + "\0" + value_hash)[:48]

        try:
            confidence = max(0.0, min(1.0, float(normalized.get("confidence", 0.5))))
        except (TypeError, ValueError):
            confidence = 0.5
        try:
            authority = max(0, min(100, int(normalized.get("authority_rank", 0))))
        except (TypeError, ValueError):
            authority = 0
        now = _iso(_utc_now())
        edge_ids: list[str] = []
        explicit_supersedes = {
            str(item)
            for item in (
                normalized.get("supersedes_ids")
                if isinstance(normalized.get("supersedes_ids"), list)
                else [normalized.get("supersedes_id")]
            )
            if item
        }
        explicit_contradicts = {
            str(item)
            for item in (
                normalized.get("contradicts_ids")
                if isinstance(normalized.get("contradicts_ids"), list)
                else [normalized.get("contradicts_id")]
            )
            if item
        }

        with _GOVERNANCE_LOCK:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                existing_memory = connection.execute(
                    "SELECT principal_key FROM facts WHERE memory_id = ?", (memory,)
                ).fetchone()
                if existing_memory is not None and str(
                    existing_memory["principal_key"]
                ) != principal:
                    raise MemoryGovernanceError(
                        "fact memory identity belongs to another principal"
                    )
                prior = connection.execute(
                    "SELECT * FROM facts WHERE principal_key = ? AND claim_key = ? "
                    "AND memory_id != ? AND status IN ('active', 'conflicted') LIMIT ?",
                    (principal, claim_key, memory, _MAX_FACTS_PER_CLAIM + 1),
                ).fetchall()
                if len(prior) > _MAX_FACTS_PER_CLAIM:
                    raise MemoryGovernanceError(
                        "fact claim exceeds its bounded evidence set"
                    )
                connection.execute(
                    "INSERT INTO facts(memory_id, principal_key, fact_key, claim_key, source_id, "
                    "value_hash, subject_hash, predicate, scope_hash, confidence, authority, "
                    "provenance_hash, observed_at, last_verified_at, valid_from, valid_until, "
                    "stale_after, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
                    "?, ?, ?, ?, ?, 'active', ?) ON CONFLICT(memory_id) DO UPDATE SET "
                    "fact_key=excluded.fact_key, claim_key=excluded.claim_key, "
                    "source_id=excluded.source_id, value_hash=excluded.value_hash, "
                    "subject_hash=excluded.subject_hash, predicate=excluded.predicate, "
                    "scope_hash=excluded.scope_hash, provenance_hash=excluded.provenance_hash, "
                    "confidence=excluded.confidence, authority=excluded.authority, "
                    "observed_at=excluded.observed_at, last_verified_at=excluded.last_verified_at, "
                    "valid_from=excluded.valid_from, valid_until=excluded.valid_until, "
                    "stale_after=excluded.stale_after, status='active'",
                    (
                        memory,
                        principal,
                        fact_key,
                        claim_key,
                        str(normalized.get("source_id") or ""),
                        value_hash,
                        sha256_text(str(normalized.get("subject") or "")) if normalized.get("subject") else "",
                        str(normalized.get("predicate") or "")[:256],
                        sha256_text(canonical_json(normalized.get("fact_scope") or normalized.get("scope") or "")),
                        confidence,
                        authority,
                        sha256_text(canonical_json(normalized.get("provenance") or normalized.get("source") or "")),
                        str(normalized.get("observed_at") or now),
                        normalized.get("last_verified_at"),
                        normalized.get("valid_from"),
                        normalized.get("valid_until"),
                        normalized.get("stale_after"),
                        now,
                    ),
                )
                for row in prior:
                    previous = dict(row)
                    edge_type: Optional[str] = None
                    reason = ""
                    if previous["memory_id"] in explicit_supersedes or previous["fact_key"] == fact_key:
                        edge_type = "supersedes"
                        reason = "explicit_or_same_fact_revision"
                        connection.execute(
                            "UPDATE facts SET status = 'superseded' WHERE memory_id = ?",
                            (previous["memory_id"],),
                        )
                    elif previous["memory_id"] in explicit_contradicts or previous["value_hash"] != value_hash:
                        edge_type = "contradicts"
                        reason = "same_claim_different_value"
                    if edge_type is None:
                        continue
                    edge_id = "edge_" + sha256_text(
                        "\0".join((principal, memory, previous["memory_id"], edge_type))
                    )[:48]
                    connection.execute(
                        "INSERT INTO fact_edges(edge_id, principal_key, from_memory_id, "
                        "to_memory_id, edge_type, claim_key, reason, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(principal_key, "
                        "from_memory_id, to_memory_id, edge_type) DO NOTHING",
                        (
                            edge_id,
                            principal,
                            memory,
                            previous["memory_id"],
                            edge_type,
                            claim_key,
                            reason,
                            now,
                        ),
                    )
                    edge_ids.append(edge_id)

                candidates = [
                    dict(row)
                    for row in connection.execute(
                        "SELECT * FROM facts WHERE principal_key = ? AND claim_key = ? "
                        "AND status IN ('active', 'conflicted') LIMIT ?",
                        (principal, claim_key, _MAX_FACTS_PER_CLAIM + 1),
                    ).fetchall()
                ]
                if len(candidates) > _MAX_FACTS_PER_CLAIM:
                    raise MemoryGovernanceError(
                        "fact claim exceeds its bounded evidence set"
                    )
                winner = max(candidates, key=self._rank) if candidates else {
                    "memory_id": memory,
                    "value_hash": value_hash,
                }
                winner_id = str(winner["memory_id"])
                winning_value_hash = str(winner.get("value_hash") or value_hash)
                for candidate in candidates:
                    connection.execute(
                        "UPDATE facts SET status = ? WHERE memory_id = ?",
                        (
                            "active"
                            if str(candidate.get("value_hash") or "") == winning_value_hash
                            else "conflicted",
                            candidate["memory_id"],
                        ),
                    )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()
        return FactProjection(memory, fact_key, claim_key, value_hash, winner_id, tuple(edge_ids))

    def conflict_projection(
        self, *, principal_key: str, memory_ids: Sequence[str]
    ) -> dict[str, dict[str, Any]]:
        ids = [str(item) for item in memory_ids if str(item)]
        if not ids:
            return {}
        placeholders = ",".join("?" for _item in ids)
        connection = self._connect()
        try:
            rows = connection.execute(
                f"SELECT * FROM facts WHERE principal_key = ? AND memory_id IN ({placeholders})",
                [principal_key, *ids],
            ).fetchall()
            output: dict[str, dict[str, Any]] = {}
            claim_winners: dict[str, tuple[str, str]] = {}
            for row in rows:
                fact = dict(row)
                edges = [
                    dict(edge)
                    for edge in connection.execute(
                        "SELECT edge_id, from_memory_id, to_memory_id, edge_type, reason, "
                        "created_at FROM fact_edges WHERE principal_key = ? AND claim_key = ? "
                        "ORDER BY created_at, edge_id",
                        (principal_key, fact["claim_key"]),
                    ).fetchall()
                ]
                claim_key = str(fact["claim_key"])
                if claim_key not in claim_winners:
                    candidates = [
                        dict(candidate)
                        for candidate in connection.execute(
                            "SELECT * FROM facts WHERE principal_key = ? AND claim_key = ? "
                            "AND status IN ('active', 'conflicted') LIMIT ?",
                            (principal_key, claim_key, _MAX_FACTS_PER_CLAIM + 1),
                        ).fetchall()
                    ]
                    if len(candidates) > _MAX_FACTS_PER_CLAIM:
                        raise MemoryGovernanceError(
                            "fact claim exceeds its bounded evidence set"
                        )
                    winner = max(candidates, key=self._rank) if candidates else fact
                    claim_winners[claim_key] = (
                        str(winner["memory_id"]),
                        str(winner["value_hash"]),
                    )
                winner_id, winning_value_hash = claim_winners[claim_key]
                effective_status = (
                    "active"
                    if str(fact.get("value_hash") or "") == winning_value_hash
                    else "conflicted"
                )
                output[fact["memory_id"]] = {
                    "fact_key": fact["fact_key"],
                    "claim_key": fact["claim_key"],
                    "fact_status": effective_status,
                    "active_winner_id": winner_id,
                    "edges": edges,
                }
            return output
        finally:
            connection.close()

    def enqueue_promotion(
        self,
        *,
        principal_key: str,
        memory_id: str,
        metadata: Mapping[str, Any],
        classification: str,
    ) -> dict[str, Any]:
        candidate = bool(
            metadata.get("candidate_fact") is True
            or str(metadata.get("quality") or "").casefold() in {"candidate", "candidate_fact"}
            or str(metadata.get("source") or "").casefold() == "durable-candidates"
        )
        if not candidate:
            return {"queued": False, "status": "not_candidate"}
        try:
            required = max(2, min(20, int(metadata.get("required_evidence_count", 2))))
            score = max(0.0, min(1.0, float(metadata.get("confidence", 0.5))))
        except (TypeError, ValueError) as exc:
            raise MemoryPromotionError("promotion evidence fields are malformed") from exc
        connection = self._connect()
        try:
            fact = connection.execute(
                "SELECT claim_key, value_hash, status FROM facts "
                "WHERE principal_key = ? AND memory_id = ?",
                (principal_key, memory_id),
            ).fetchone()
            if fact is None:
                evidence_count = 1
                candidate_fact_status = "active"
            else:
                evidence_count = int(
                    connection.execute(
                        "SELECT COUNT(DISTINCT CASE WHEN source_id != '' THEN source_id "
                        "ELSE provenance_hash END) FROM facts WHERE principal_key = ? "
                        "AND claim_key = ? AND value_hash = ? AND status = 'active'",
                        (
                            principal_key,
                            str(fact["claim_key"]),
                            str(fact["value_hash"]),
                        ),
                    ).fetchone()[0]
                )
                candidate_fact_status = str(fact["status"])
        finally:
            connection.close()
        reasons: list[str] = []
        if classification in {"sensitive", "restricted"}:
            reasons.append("privacy_classification_blocks_promotion")
        if evidence_count < required:
            reasons.append("independent_evidence_threshold_not_met")
        if candidate_fact_status != "active":
            reasons.append("unresolved_higher_authority_contradiction")
        temporal = temporal_visibility(metadata, include_stale=False, include_unknown_time=True)
        if not temporal.visible or temporal.freshness_state in {"stale", "invalid", "expired"}:
            reasons.append("temporal_evidence_not_current")
        status = "blocked" if reasons else "pending_review"
        persisted_status = status
        now = _iso(_utc_now())
        with _GOVERNANCE_LOCK:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE")
                existing = connection.execute(
                    "SELECT principal_key FROM promotion_queue WHERE memory_id = ?",
                    (memory_id,),
                ).fetchone()
                if existing is not None and str(existing["principal_key"]) != principal_key:
                    raise MemoryPromotionError(
                        "promotion memory identity belongs to another principal"
                    )
                if existing is None:
                    count = int(
                        connection.execute("SELECT COUNT(*) FROM promotion_queue").fetchone()[0]
                    )
                    if count >= _MAX_PROMOTION_ROWS:
                        raise MemoryPromotionError("promotion queue row bound reached")
                connection.execute(
                    "INSERT INTO promotion_queue(memory_id, principal_key, status, candidate_fact, "
                    "evidence_count, required_evidence_count, score, privacy_classification, "
                    "reasons_json, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(memory_id) DO UPDATE SET status=CASE "
                    "WHEN promotion_queue.status IN ('approved', 'rejected', 'promoted') "
                    "THEN promotion_queue.status ELSE excluded.status END, "
                    "evidence_count=excluded.evidence_count, "
                    "required_evidence_count=excluded.required_evidence_count, score=excluded.score, "
                    "privacy_classification=excluded.privacy_classification, "
                    "reasons_json=excluded.reasons_json, updated_at=excluded.updated_at",
                    (
                        memory_id,
                        principal_key,
                        status,
                        evidence_count,
                        required,
                        score,
                        classification,
                        canonical_json(reasons),
                        now,
                        now,
                    ),
                )
                persisted = connection.execute(
                    "SELECT status FROM promotion_queue WHERE memory_id = ? "
                    "AND principal_key = ?",
                    (memory_id, principal_key),
                ).fetchone()
                if persisted is None:
                    raise MemoryPromotionError("promotion queue write was not durable")
                persisted_status = str(persisted["status"])
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()
        return {"queued": True, "status": persisted_status, "reasons": reasons}

    def review_promotion(
        self,
        *,
        principal_key: str,
        memory_id: str,
        approved: bool,
        reviewer: str,
    ) -> dict[str, Any]:
        normalized_reviewer = str(reviewer or "").strip()
        if not normalized_reviewer or len(normalized_reviewer.encode("utf-8")) > 128:
            raise MemoryPromotionError("reviewer identity is required")
        now = _iso(_utc_now())
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM promotion_queue WHERE memory_id = ? AND principal_key = ?",
                (memory_id, principal_key),
            ).fetchone()
            if row is None:
                raise MemoryPromotionError("promotion candidate was not found")
            current_status = str(row["status"])
            target_status = "approved" if approved else "rejected"
            if current_status == target_status or (
                approved and current_status == "promoted"
            ):
                connection.commit()
                return {
                    "memory_id": memory_id,
                    "status": current_status,
                    "reviewed_at": str(row["reviewed_at"] or row["updated_at"]),
                    "idempotent_replay": True,
                }
            if current_status not in {"pending_review", "blocked"}:
                raise MemoryPromotionError(
                    "promotion review decision conflicts with durable state"
                )
            if current_status == "blocked" and approved:
                raise MemoryPromotionError("blocked candidate may not be approved")
            connection.execute(
                "UPDATE promotion_queue SET status = ?, reviewer = ?, reviewed_at = ?, "
                "updated_at = ? WHERE memory_id = ? AND principal_key = ?",
                (target_status, normalized_reviewer, now, now, memory_id, principal_key),
            )
            connection.commit()
            return {
                "memory_id": memory_id,
                "status": target_status,
                "reviewed_at": now,
                "idempotent_replay": False,
            }
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def list_promotions(
        self, *, principal_key: str, status: Optional[str] = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        if status is not None and status not in _ALLOWED_PROMOTION_STATUS:
            raise MemoryPromotionError("unsupported promotion status")
        bounded = max(1, min(int(limit), 500))
        connection = self._connect()
        try:
            if status:
                rows = connection.execute(
                    "SELECT * FROM promotion_queue WHERE principal_key = ? AND status = ? "
                    "ORDER BY updated_at DESC LIMIT ?",
                    (principal_key, status, bounded),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM promotion_queue WHERE principal_key = ? "
                    "ORDER BY updated_at DESC LIMIT ?",
                    (principal_key, bounded),
                ).fetchall()
            output = []
            for row in rows:
                item = dict(row)
                item.pop("principal_key", None)
                item["reasons"] = json.loads(item.pop("reasons_json"))
                item["candidate_fact"] = bool(item["candidate_fact"])
                output.append(item)
            return output
        finally:
            connection.close()

    def mark_promoted(self, *, principal_key: str, memory_id: str) -> None:
        now = _iso(_utc_now())
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT status FROM promotion_queue WHERE principal_key = ? AND memory_id = ?",
                (principal_key, memory_id),
            ).fetchone()
            if row is not None and str(row["status"]) == "promoted":
                connection.commit()
                return
            if row is None or str(row["status"]) != "approved":
                raise MemoryPromotionError("candidate requires explicit approval before promotion")
            connection.execute(
                "UPDATE promotion_queue SET status = 'promoted', updated_at = ? "
                "WHERE principal_key = ? AND memory_id = ?",
                (now, principal_key, memory_id),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def create_deletion_fence(self, principal_key: str) -> DeletionFence:
        principal = str(principal_key or "").strip()
        if not principal:
            raise MemoryDeletionError("principal deletion requires a principal key")
        now = _iso(_utc_now())
        deletion_id = "del_" + uuid.uuid4().hex
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "INSERT INTO deletion_fences(principal_key, deletion_id, deletion_epoch, created_at) "
                "VALUES (?, ?, ?, ?) ON CONFLICT(principal_key) DO UPDATE SET "
                "deletion_id=excluded.deletion_id, deletion_epoch=excluded.deletion_epoch, "
                "created_at=excluded.created_at",
                (principal, deletion_id, now, now),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return DeletionFence(deletion_id, principal, now)

    def replay_allowed(self, principal_key: str, observed_at: Any) -> bool:
        observed = parse_timestamp(observed_at, field_name="observed_at", required=True)
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT deletion_epoch FROM deletion_fences WHERE principal_key = ?",
                (principal_key,),
            ).fetchone()
            if row is None:
                return True
            epoch = parse_timestamp(row["deletion_epoch"], field_name="deletion_epoch", required=True)
            assert observed is not None and epoch is not None
            return observed > epoch
        finally:
            connection.close()

    def deletion_epoch(self, principal_key: str) -> Optional[str]:
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT deletion_epoch FROM deletion_fences WHERE principal_key = ?",
                (principal_key,),
            ).fetchone()
            return str(row["deletion_epoch"]) if row else None
        finally:
            connection.close()

    def purge_principal(
        self, fence: DeletionFence, *, surface_counts: Mapping[str, int]
    ) -> dict[str, Any]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            counts: dict[str, int] = {str(key): int(value) for key, value in surface_counts.items()}
            for table, field_name in (
                ("fact_edges", "principal_key"),
                ("facts", "principal_key"),
                ("promotion_queue", "principal_key"),
                ("quarantine", "principal_key"),
                ("write_outbox", "principal_key"),
            ):
                cursor = connection.execute(
                    f"DELETE FROM {table} WHERE {field_name} = ?", (fence.principal_key,)
                )
                counts[f"governance_{table}"] = int(cursor.rowcount or 0)
            now = _iso(_utc_now())
            receipt_count = int(
                connection.execute("SELECT COUNT(*) FROM deletion_receipts").fetchone()[0]
            )
            if receipt_count >= _MAX_DELETION_RECEIPTS:
                connection.execute(
                    "DELETE FROM deletion_receipts WHERE deletion_id IN ("
                    "SELECT deletion_id FROM deletion_receipts "
                    "ORDER BY completed_at ASC, deletion_id ASC LIMIT ?)",
                    (receipt_count - _MAX_DELETION_RECEIPTS + 1,),
                )
            connection.execute(
                "INSERT INTO deletion_receipts(deletion_id, principal_digest, deletion_epoch, "
                "counts_json, completed, completed_at) VALUES (?, ?, ?, ?, 1, ?)",
                (
                    fence.deletion_id,
                    sha256_text(fence.principal_key),
                    fence.deletion_epoch,
                    canonical_json(counts),
                    now,
                ),
            )
            connection.commit()
            return {
                "deletion_id": fence.deletion_id,
                "deletion_epoch": fence.deletion_epoch,
                "completed": True,
                "counts": counts,
                "principal_digest": sha256_text(fence.principal_key),
            }
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def stage_outbox(
        self,
        *,
        principal_key: str,
        operation_id: str,
        payload_hash: str,
        observed_at: Any,
        receipt_id: Optional[str] = None,
    ) -> dict[str, Any]:
        principal = str(principal_key or "").strip()
        operation = str(operation_id or "").strip()
        if not principal or not operation or len(operation.encode("utf-8")) > 512:
            raise MemoryGovernanceError("outbox principal/operation identity is invalid")
        observed = parse_timestamp(observed_at, field_name="observed_at", required=True)
        assert observed is not None
        if not re.fullmatch(r"[0-9a-f]{64}", str(payload_hash or "")):
            raise MemoryGovernanceError("outbox payload hash is invalid")
        now = _iso(_utc_now())
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            fence = connection.execute(
                "SELECT deletion_epoch FROM deletion_fences WHERE principal_key = ?",
                (principal,),
            ).fetchone()
            if fence is not None:
                deletion_epoch = parse_timestamp(
                    fence["deletion_epoch"], field_name="deletion_epoch", required=True
                )
                assert deletion_epoch is not None
                if observed <= deletion_epoch:
                    raise MemoryDeletionError(
                        "write predates the principal deletion fence"
                    )
            prior = connection.execute(
                "SELECT * FROM write_outbox WHERE operation_id = ?", (operation,)
            ).fetchone()
            if prior is not None and (
                str(prior["principal_key"]) != principal
                or str(prior["payload_hash"]) != payload_hash
            ):
                raise MemoryGovernanceError("outbox operation identity conflicts with durable state")
            prior_receipt = str(prior["receipt_id"] or "") if prior is not None else ""
            supplied_receipt = str(receipt_id or "").strip()
            if prior_receipt and supplied_receipt and prior_receipt != supplied_receipt:
                raise MemoryGovernanceError(
                    "outbox receipt identity conflicts with durable state"
                )
            if prior is None:
                count = int(
                    connection.execute("SELECT COUNT(*) FROM write_outbox").fetchone()[0]
                )
                if count >= _MAX_OUTBOX_ROWS:
                    connection.execute(
                        "DELETE FROM write_outbox WHERE operation_id IN ("
                        "SELECT operation_id FROM write_outbox WHERE state = 'committed' "
                        "ORDER BY updated_at ASC, operation_id ASC LIMIT ?)",
                        (count - _MAX_OUTBOX_ROWS + 1,),
                    )
                    count = int(
                        connection.execute("SELECT COUNT(*) FROM write_outbox").fetchone()[0]
                    )
                    if count >= _MAX_OUTBOX_ROWS:
                        raise MemoryGovernanceError("write outbox row bound reached")
            connection.execute(
                "INSERT INTO write_outbox(operation_id, principal_key, payload_hash, state, "
                "receipt_id, observed_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?) "
                "ON CONFLICT(operation_id) DO UPDATE SET receipt_id=COALESCE(write_outbox.receipt_id, "
                "excluded.receipt_id), updated_at=excluded.updated_at",
                (operation, principal, payload_hash, supplied_receipt or None, _iso(observed), now),
            )
            connection.commit()
            return {
                "operation_id": operation,
                "payload_hash": payload_hash,
                "state": str(prior["state"]) if prior else "pending",
            }
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def commit_outbox(
        self, *, principal_key: str, operation_id: str, payload_hash: str, receipt_id: str
    ) -> dict[str, Any]:
        now = _iso(_utc_now())
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM write_outbox WHERE operation_id = ?", (operation_id,)
            ).fetchone()
            if row is None:
                raise MemoryGovernanceError("outbox operation is missing")
            if str(row["principal_key"]) != principal_key or str(row["payload_hash"]) != payload_hash:
                raise MemoryGovernanceError("outbox commit identity conflicts with durable state")
            prior_receipt = str(row["receipt_id"] or "")
            if prior_receipt and prior_receipt != receipt_id:
                raise MemoryGovernanceError("outbox receipt identity conflicts with durable state")
            connection.execute(
                "UPDATE write_outbox SET state = 'committed', receipt_id = ?, updated_at = ? "
                "WHERE operation_id = ?",
                (receipt_id, now, operation_id),
            )
            connection.commit()
            return {
                "operation_id": operation_id,
                "payload_hash": payload_hash,
                "receipt_id": receipt_id,
                "state": "committed",
            }
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


@dataclass(frozen=True)
class RecallEvaluation:
    total_cases: int
    answer_recall_at_k: float
    source_recall_at_k: float
    leakage_rate: float
    stale_answer_error_rate: float
    contradiction_winner_accuracy: float
    failures: tuple[dict[str, Any], ...] = field(default_factory=tuple)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def evaluate_recall(
    cases: Sequence[Mapping[str, Any]],
    actual_results: Mapping[str, Sequence[Mapping[str, Any]]],
) -> RecallEvaluation:
    if not cases:
        raise MemoryGovernanceError("recall evaluation requires at least one case")
    answered = 0
    source_hits = 0
    leaks = 0
    stale_errors = 0
    contradiction_total = 0
    contradiction_correct = 0
    failures: list[dict[str, Any]] = []
    for case in cases:
        case_id = str(case.get("id") or "").strip()
        if not case_id:
            raise MemoryGovernanceError("recall case is missing an id")
        rows = list(actual_results.get(case_id) or [])
        expected_ids = {str(item) for item in case.get("expected_ids") or []}
        expected_sources = {str(item) for item in case.get("expected_source_ids") or []}
        expected_paths = {str(item) for item in case.get("expected_source_paths") or []}
        expected_fact_keys = {str(item) for item in case.get("expected_fact_keys") or []}
        forbidden_sources = {str(item) for item in case.get("forbidden_source_ids") or []}
        forbidden_paths = {str(item) for item in case.get("forbidden_source_paths") or []}
        forbidden_projects = {str(item) for item in case.get("forbidden_projects") or []}
        expected_winner = str(case.get("expected_winner_id") or "")
        expected_winner_fact = str(case.get("expected_winner_fact_key") or "")
        row_ids = [str(row.get("id") or "") for row in rows]
        row_sources = {
            str((row.get("metadata") or {}).get("source_id") or "") for row in rows
        }
        row_paths = {
            str((row.get("metadata") or {}).get("path") or "") for row in rows
        }
        row_fact_keys = {
            str((row.get("metadata") or {}).get("fact_key") or "") for row in rows
        }
        row_projects = {
            str((row.get("metadata") or {}).get("project") or "") for row in rows
        }
        if expected_ids:
            answer_ok = bool(expected_ids.intersection(row_ids))
        elif expected_fact_keys:
            answer_ok = bool(expected_fact_keys.intersection(row_fact_keys))
        elif expected_paths:
            answer_ok = bool(expected_paths.intersection(row_paths))
        else:
            answer_ok = bool(rows)
        source_ok = (
            bool(expected_sources.intersection(row_sources)) if expected_sources
            else bool(expected_paths.intersection(row_paths)) if expected_paths
            else answer_ok
        )
        leak = bool(
            forbidden_sources.intersection(row_sources)
            or forbidden_paths.intersection(row_paths)
            or forbidden_projects.intersection(row_projects)
        )
        stale = any(
            str((row.get("metadata") or {}).get("freshness_state") or "") == "stale"
            and row.get("selected_answer") is True
            for row in rows
        )
        if answer_ok:
            answered += 1
        if source_ok:
            source_hits += 1
        if leak:
            leaks += 1
        if stale:
            stale_errors += 1
        conflict_ok: Optional[bool] = None
        if expected_winner or expected_winner_fact:
            contradiction_total += 1
            selected = next((row for row in rows if row.get("selected_answer") is True), None)
            selected_id = str((selected or {}).get("id") or (row_ids[0] if row_ids else ""))
            selected_fact_key = str(
                ((selected or {}).get("metadata") or {}).get("fact_key") or ""
            )
            conflict_ok = (
                selected_id == expected_winner
                if expected_winner
                else selected_fact_key == expected_winner_fact
            )
            if conflict_ok:
                contradiction_correct += 1
        if not answer_ok or not source_ok or leak or stale or conflict_ok is False:
            failures.append(
                {
                    "id": case_id,
                    "answer_recalled": answer_ok,
                    "source_recalled": source_ok,
                    "leakage": leak,
                    "stale_answer_error": stale,
                    "contradiction_winner_correct": conflict_ok,
                }
            )
    total = len(cases)
    return RecallEvaluation(
        total_cases=total,
        answer_recall_at_k=round(answered / total, 6),
        source_recall_at_k=round(source_hits / total, 6),
        leakage_rate=round(leaks / total, 6),
        stale_answer_error_rate=round(stale_errors / total, 6),
        contradiction_winner_accuracy=(
            round(contradiction_correct / contradiction_total, 6)
            if contradiction_total
            else 1.0
        ),
        failures=tuple(failures),
    )


__all__ = [
    "AdmissionDecision",
    "DeletionFence",
    "FactProjection",
    "MemoryAdmissionRejected",
    "MemoryDeletionError",
    "MemoryFilterError",
    "MemoryGovernanceError",
    "MemoryGovernanceStore",
    "MemoryPromotionError",
    "MemorySearchFilters",
    "RecallEvaluation",
    "TemporalDecision",
    "canonical_json",
    "canonical_value_hash",
    "classify_memory_admission",
    "compile_chroma_where",
    "evaluate_recall",
    "governance_db_path",
    "normalize_filterable_metadata",
    "normalize_temporal_metadata",
    "parse_timestamp",
    "refresh_temporal_verification",
    "row_matches_filters",
    "sha256_text",
    "stable_chunk_id",
    "stable_fact_key",
    "stable_source_id",
    "tag_filter_field",
    "temporal_visibility",
]
