"""Canonical health vocabulary and aggregation rules for Cortex surfaces.

The values in this module describe different facts and must not be collapsed:

* ``restricted_by_design`` and ``disabled_by_design`` are policy states.
* ``stale_evidence`` says that availability evidence is old, not that the
  dependency is unavailable.
* ``untested`` says that no usable evidence exists yet.
* only ``degraded`` and ``failed`` are failure states.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping


STATUS_VOCABULARY_VERSION = "cortex.health-status.v1"

OPERATIONAL = "operational"
RESTRICTED_BY_DESIGN = "restricted_by_design"
DISABLED_BY_DESIGN = "disabled_by_design"
STALE_EVIDENCE = "stale_evidence"
DEGRADED = "degraded"
UNTESTED = "untested"
FAILED = "failed"

STATUS_VOCABULARY = (
    OPERATIONAL,
    RESTRICTED_BY_DESIGN,
    DISABLED_BY_DESIGN,
    STALE_EVIDENCE,
    DEGRADED,
    UNTESTED,
    FAILED,
)
FAILURE_STATUSES = frozenset({DEGRADED, FAILED})
USABLE_STATUSES = frozenset({OPERATIONAL, RESTRICTED_BY_DESIGN, STALE_EVIDENCE})

_LEGACY_STATUS_MAP = {
    "active": OPERATIONAL,
    "completed": OPERATIONAL,
    "healthy": OPERATIONAL,
    "ok": OPERATIONAL,
    "online": OPERATIONAL,
    "ready": OPERATIONAL,
    "restricted": RESTRICTED_BY_DESIGN,
    "disabled": DISABLED_BY_DESIGN,
    "disabled_by_policy": DISABLED_BY_DESIGN,
    "off": DISABLED_BY_DESIGN,
    "stale": STALE_EVIDENCE,
    "measuring": UNTESTED,
    "no_map": UNTESTED,
    "not_checked": UNTESTED,
    "pending": UNTESTED,
    "starting": UNTESTED,
    "unknown": UNTESTED,
    "unconfigured": UNTESTED,
    "down": FAILED,
    "error": FAILED,
    "inactive": FAILED,
    "not_ready": FAILED,
    "offline": FAILED,
    "stopped": FAILED,
    "unavailable": FAILED,
    "unhealthy": FAILED,
}


def normalize_status(value: Any, *, default: str = UNTESTED) -> str:
    """Return one canonical status, translating bounded legacy producers."""

    normalized = str(value or "").strip().lower().replace("-", "_")
    if normalized in STATUS_VOCABULARY:
        return normalized
    return _LEGACY_STATUS_MAP.get(normalized, default)


def is_failure(value: Any) -> bool:
    return normalize_status(value) in FAILURE_STATUSES


def is_usable(value: Any) -> bool:
    return normalize_status(value) in USABLE_STATUSES


def aggregate_status(values: Iterable[Any]) -> str:
    """Aggregate statuses without treating policy or freshness as failure.

    Disabled and untested members remain visible in component/count fields but
    do not lower an otherwise evidenced aggregate. A stale member makes the
    aggregate stale only when there is no genuine failure.
    """

    statuses = [normalize_status(value) for value in values]
    if not statuses:
        return UNTESTED
    if FAILED in statuses:
        return FAILED
    if DEGRADED in statuses:
        return DEGRADED
    if STALE_EVIDENCE in statuses:
        return STALE_EVIDENCE
    if RESTRICTED_BY_DESIGN in statuses:
        return RESTRICTED_BY_DESIGN
    if OPERATIONAL in statuses:
        return OPERATIONAL
    if UNTESTED in statuses:
        return UNTESTED
    return DISABLED_BY_DESIGN


def aggregate_checks(checks: Mapping[str, Mapping[str, Any]]) -> str:
    """Aggregate required readiness checks; optional checks never gate health."""

    statuses = []
    for check in checks.values():
        if check.get("required", True) is False:
            continue
        raw_status = str(check.get("status") or "").strip().lower().replace("-", "_")
        if check.get("ok") is False:
            # A required check explicitly reporting ``ok=false`` is a real
            # readiness failure. Policy/freshness producers must report those
            # canonical non-failure states with ``ok=true``.
            statuses.append(raw_status if raw_status in FAILURE_STATUSES else FAILED)
        else:
            statuses.append(raw_status if raw_status in STATUS_VOCABULARY else OPERATIONAL)
    return aggregate_status(statuses)


def vocabulary_payload() -> dict[str, Any]:
    return {
        "version": STATUS_VOCABULARY_VERSION,
        "values": list(STATUS_VOCABULARY),
        "failure_values": sorted(FAILURE_STATUSES),
    }
