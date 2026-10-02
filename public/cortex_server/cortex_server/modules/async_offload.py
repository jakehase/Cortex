"""Bounded, observable offload for blocking provider and broker calls."""
from __future__ import annotations

import asyncio
import os
import threading
import time
from collections import Counter
from typing import Any, Callable


class BlockingCallDeadlineExceeded(TimeoutError):
    def __init__(self, operation: str, timeout_seconds: float):
        super().__init__(
            f"blocking operation {operation!r} exceeded {timeout_seconds:.3f}s deadline"
        )
        self.operation = operation
        self.timeout_seconds = timeout_seconds


class BlockingCallCapacityExceeded(BlockingCallDeadlineExceeded):
    """Raised before dispatch when retained blocking work is at capacity.

    It remains a deadline subtype so callers written before admission control
    still fail closed; callers can distinguish it to return HTTP 503.
    """

    def __init__(self, operation: str, limit: int):
        TimeoutError.__init__(
            self,
            f"blocking operation {operation!r} rejected: {limit} retained calls already active",
        )
        self.operation = operation
        self.timeout_seconds = 0.0
        self.limit = limit


def _configured_limit() -> int:
    raw = os.getenv("CORTEX_BLOCKING_MAX_INFLIGHT", "32").strip()
    try:
        value = int(raw)
    except ValueError:
        return 32
    return max(1, min(value, 256))


_MAX_INFLIGHT_BLOCKING = _configured_limit()
_INFLIGHT: set[asyncio.Task] = set()
_DETACHED: set[asyncio.Task] = set()
_INFLIGHT_LOCK = threading.Lock()
_COUNTERS: Counter[str] = Counter()
_ACTIVE_COUNT = 0


def _reserve(operation: str) -> None:
    global _ACTIVE_COUNT
    with _INFLIGHT_LOCK:
        if _ACTIVE_COUNT >= _MAX_INFLIGHT_BLOCKING:
            _COUNTERS["rejected"] += 1
            raise BlockingCallCapacityExceeded(operation, _MAX_INFLIGHT_BLOCKING)
        _ACTIVE_COUNT += 1
        _COUNTERS["admitted"] += 1


def _retain(task: asyncio.Task) -> None:
    with _INFLIGHT_LOCK:
        _INFLIGHT.add(task)

    def discard(done: asyncio.Task) -> None:
        global _ACTIVE_COUNT
        # Consume terminal exceptions so a caller deadline never turns a late
        # provider result into an unobserved-task warning.
        if not done.cancelled():
            try:
                done.exception()
            except BaseException:
                pass
        with _INFLIGHT_LOCK:
            _INFLIGHT.discard(done)
            _DETACHED.discard(done)
            _ACTIVE_COUNT -= 1
            _COUNTERS["completed"] += 1

    task.add_done_callback(discard)


async def run_blocking(
    operation: str,
    function: Callable[..., Any],
    *args: Any,
    timeout_seconds: float,
    **kwargs: Any,
) -> Any:
    """Run blocking work off-loop under a bounded, retained task."""
    timeout = max(0.001, float(timeout_seconds))
    # Admission happens before any worker is submitted. This prevents the
    # default executor's unbounded queue from accumulating work after callers
    # have already timed out.
    _reserve(operation)
    try:
        task = asyncio.create_task(
            asyncio.to_thread(function, *args, **kwargs),
            name=f"cortex-blocking:{operation}",
        )
    except BaseException:
        global _ACTIVE_COUNT
        with _INFLIGHT_LOCK:
            _ACTIVE_COUNT -= 1
        raise
    _retain(task)
    try:
        return await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
    except asyncio.TimeoutError as exc:
        with _INFLIGHT_LOCK:
            if not task.done():
                _DETACHED.add(task)
            _COUNTERS["timed_out"] += 1
        raise BlockingCallDeadlineExceeded(operation, timeout) from exc
    except asyncio.CancelledError:
        with _INFLIGHT_LOCK:
            if not task.done():
                _DETACHED.add(task)
            _COUNTERS["caller_cancelled"] += 1
        raise


def remaining_seconds(deadline_monotonic: float, *, ceiling: float) -> float:
    return max(0.001, min(float(ceiling), deadline_monotonic - time.monotonic()))


def inflight_blocking_operations() -> tuple[str, ...]:
    """Expose retained late completions for diagnostics and regression tests."""
    with _INFLIGHT_LOCK:
        return tuple(sorted(task.get_name() for task in _INFLIGHT if not task.done()))


def blocking_operation_status() -> dict[str, Any]:
    """Return bounded-admission and late-completion state for health surfaces."""
    with _INFLIGHT_LOCK:
        operations = sorted(
            task.get_name().removeprefix("cortex-blocking:")
            for task in _INFLIGHT
            if not task.done()
        )
        detached_operations = sorted(
            task.get_name().removeprefix("cortex-blocking:")
            for task in _DETACHED
            if not task.done()
        )
        return {
            "limit": _MAX_INFLIGHT_BLOCKING,
            "active": _ACTIVE_COUNT,
            "operations": operations,
            "detached": len(detached_operations),
            "detached_operations": detached_operations,
            "admitted_total": _COUNTERS["admitted"],
            "completed_total": _COUNTERS["completed"],
            "timed_out_total": _COUNTERS["timed_out"],
            "caller_cancelled_total": _COUNTERS["caller_cancelled"],
            "rejected_total": _COUNTERS["rejected"],
        }
