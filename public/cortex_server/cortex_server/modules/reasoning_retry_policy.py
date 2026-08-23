from __future__ import annotations

import math
from numbers import Real
from typing import Any, Dict, Mapping, Optional


JsonDict = Dict[str, Any]

# These are product safety limits, not caller-tunable defaults.  A workflow may
# choose a smaller budget, but metadata must never expand these boundaries.
MAX_RETRY_ATTEMPTS = 8
MAX_RETRY_BACKOFF_SECONDS = 60.0
MAX_CUMULATIVE_RETRY_BACKOFF_SECONDS = 300.0
MAX_RETRY_FILTER_VALUES = 32


class RetryPolicyError(ValueError):
    """Retry metadata is malformed or exceeds a server-owned safety limit."""


def _configured_value(
    primary: Mapping[str, Any],
    names: tuple[str, ...],
    fallback: Mapping[str, Any],
    fallback_name: str,
    default: Any,
) -> Any:
    for name in names:
        if name in primary:
            return primary[name]
    if fallback_name in fallback:
        return fallback[fallback_name]
    return default


def _strict_attempts(value: Any, *, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise RetryPolicyError(f"{field} must be an integer")
    if value < 1 or value > MAX_RETRY_ATTEMPTS:
        raise RetryPolicyError(
            f"{field} must be between 1 and {MAX_RETRY_ATTEMPTS}"
        )
    return value


def _strict_backoff(value: Any, *, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise RetryPolicyError(f"{field} must be a finite number")
    normalized = float(value)
    if not math.isfinite(normalized):
        raise RetryPolicyError(f"{field} must be a finite number")
    if normalized < 0.0 or normalized > MAX_RETRY_BACKOFF_SECONDS:
        raise RetryPolicyError(
            f"{field} must be between 0 and {MAX_RETRY_BACKOFF_SECONDS:g}"
        )
    return normalized


def _strict_bool(value: Any, *, field: str) -> bool:
    if not isinstance(value, bool):
        raise RetryPolicyError(f"{field} must be a boolean")
    return value


def _status_filters(value: Any) -> list[int]:
    if value is None:
        return []
    if not isinstance(value, (list, tuple)):
        raise RetryPolicyError("retry_on_status_codes must be a list")
    if len(value) > MAX_RETRY_FILTER_VALUES:
        raise RetryPolicyError("retry_on_status_codes exceeds the bounded filter count")
    result: list[int] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int):
            raise RetryPolicyError("retry_on_status_codes entries must be integers")
        if item < 100 or item > 599:
            raise RetryPolicyError("retry_on_status_codes entries must be HTTP status codes")
        result.append(item)
    return result


def _error_filters(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, (list, tuple)):
        raise RetryPolicyError("retry_on_error_types must be a list")
    if len(value) > MAX_RETRY_FILTER_VALUES:
        raise RetryPolicyError("retry_on_error_types exceeds the bounded filter count")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise RetryPolicyError("retry_on_error_types entries must be strings")
        normalized = item.strip().lower()
        if not normalized or len(normalized) > 64:
            raise RetryPolicyError(
                "retry_on_error_types entries must contain 1 to 64 characters"
            )
        result.append(normalized)
    return result


def validate_retry_metadata(metadata: Optional[Mapping[str, Any]]) -> None:
    """Reject explicit retry fields before a workflow is persisted."""

    values = metadata if isinstance(metadata, Mapping) else {}
    attempts_value: Optional[int] = None
    if "max_attempts" in values:
        attempts_value = _strict_attempts(values["max_attempts"], field="max_attempts")
    elif "retry_max_attempts" in values:
        attempts_value = _strict_attempts(
            values["retry_max_attempts"], field="retry_max_attempts"
        )

    backoff_value: Optional[float] = None
    if "retry_backoff_seconds" in values:
        backoff_value = _strict_backoff(
            values["retry_backoff_seconds"], field="retry_backoff_seconds"
        )
    if "retry_on_timeout" in values:
        _strict_bool(values["retry_on_timeout"], field="retry_on_timeout")
    if "retry_on_status_codes" in values:
        _status_filters(values["retry_on_status_codes"])
    if "retry_on_error_types" in values:
        _error_filters(values["retry_on_error_types"])

    if attempts_value is not None and backoff_value is not None:
        _validate_cumulative_backoff(attempts_value, backoff_value)


def _validate_cumulative_backoff(max_attempts: int, backoff_seconds: float) -> float:
    cumulative = backoff_seconds * max(0, max_attempts - 1)
    if (
        not math.isfinite(cumulative)
        or cumulative > MAX_CUMULATIVE_RETRY_BACKOFF_SECONDS
    ):
        raise RetryPolicyError(
            "configured cumulative retry backoff exceeds "
            f"{MAX_CUMULATIVE_RETRY_BACKOFF_SECONDS:g} seconds"
        )
    return cumulative


def retry_settings(
    step: Mapping[str, Any], policy_settings: Optional[Mapping[str, Any]] = None
) -> JsonDict:
    """Return one strictly validated retry policy for every runtime path."""

    policy = policy_settings if isinstance(policy_settings, Mapping) else {}
    metadata_value = step.get("metadata")
    metadata = metadata_value if isinstance(metadata_value, Mapping) else {}
    validate_retry_metadata(metadata)

    failure_mode = str(step.get("failure_mode") or "continue")
    default_attempts = 2 if failure_mode == "retry" else 1
    attempts_raw = _configured_value(
        metadata,
        ("max_attempts", "retry_max_attempts"),
        policy,
        "retry_max_attempts",
        default_attempts,
    )
    backoff_raw = _configured_value(
        metadata,
        ("retry_backoff_seconds",),
        policy,
        "retry_backoff_seconds",
        0.0,
    )
    retry_timeout_raw = _configured_value(
        metadata,
        ("retry_on_timeout",),
        policy,
        "retry_on_timeout",
        True,
    )
    status_filters_raw = _configured_value(
        metadata,
        ("retry_on_status_codes",),
        policy,
        "retry_on_status_codes",
        [],
    )
    error_filters_raw = _configured_value(
        metadata,
        ("retry_on_error_types",),
        policy,
        "retry_on_error_types",
        [],
    )

    max_attempts = _strict_attempts(attempts_raw, field="retry_max_attempts")
    backoff_seconds = _strict_backoff(
        backoff_raw, field="retry_backoff_seconds"
    )
    cumulative_backoff = _validate_cumulative_backoff(
        max_attempts, backoff_seconds
    )

    return {
        "max_attempts": max_attempts,
        "retry_backoff_seconds": backoff_seconds,
        "retry_on_timeout": _strict_bool(
            retry_timeout_raw, field="retry_on_timeout"
        ),
        "retry_on_status_codes": _status_filters(status_filters_raw),
        "retry_on_error_types": _error_filters(error_filters_raw),
        "cumulative_retry_backoff_seconds": cumulative_backoff,
        "max_cumulative_retry_backoff_seconds": MAX_CUMULATIVE_RETRY_BACKOFF_SECONDS,
    }


__all__ = [
    "MAX_CUMULATIVE_RETRY_BACKOFF_SECONDS",
    "MAX_RETRY_ATTEMPTS",
    "MAX_RETRY_BACKOFF_SECONDS",
    "RetryPolicyError",
    "retry_settings",
    "validate_retry_metadata",
]
