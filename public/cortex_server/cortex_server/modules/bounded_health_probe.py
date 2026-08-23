"""Bounded execution helpers for synchronous health-probe dependencies.

Health routes must remain responsive when a filesystem or database dependency is
slow.  A timeout alone is insufficient because cancelling an asyncio wrapper does
not stop the underlying synchronous call.  ``SingleFlightHealthProbe`` therefore
keeps at most one real worker in flight per probe and retains that reservation
until the worker itself exits.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import Future, ThreadPoolExecutor
import threading
from typing import Any, Callable, Dict


_HEALTH_EXECUTOR = ThreadPoolExecutor(
    max_workers=3,
    thread_name_prefix="cortex-health-probe",
)


class HealthProbeBusy(RuntimeError):
    """Another principal currently owns this probe's single worker slot."""


class HealthProbeTimedOut(TimeoutError):
    """The caller deadline expired while the bounded worker remains in flight."""


class SingleFlightHealthProbe:
    """Run one synchronous probe at a time and coalesce same-key callers."""

    def __init__(self, name: str) -> None:
        self.name = name
        # A future may finish before ``add_done_callback`` returns; CPython then
        # invokes the callback inline while this state guard is still held.
        self._state_lock = threading.RLock()
        self._future: Future | None = None
        self._key: str | None = None

    def _clear_completed(self, completed: Future) -> None:
        with self._state_lock:
            if self._future is completed:
                self._future = None
                self._key = None

    def _future_for(self, key: str, function: Callable[[], Any]) -> Future:
        with self._state_lock:
            current = self._future
            if current is not None and current.done():
                self._future = None
                self._key = None
                current = None
            if current is not None:
                if self._key != key:
                    raise HealthProbeBusy(f"{self.name} probe is already running")
                return current

            future = _HEALTH_EXECUTOR.submit(function)
            self._future = future
            self._key = key
            future.add_done_callback(self._clear_completed)
            return future

    async def run(
        self,
        *,
        key: str,
        function: Callable[[], Any],
        timeout_seconds: float,
    ) -> Any:
        future = self._future_for(key, function)
        timeout = max(0.01, float(timeout_seconds))
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout

        # Do not bind the concurrent future to the caller's event loop.  A
        # timed-out synchronous probe remains in flight after that loop may
        # close (for example between isolated request/test loops), and a later
        # caller must still be able to observe its completion safely.
        while not future.done():
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise HealthProbeTimedOut(
                    f"{self.name} probe exceeded {timeout:.3f}s"
                )
            await asyncio.sleep(min(0.005, remaining))

        return future.result()


def bounded_principal_metadata_probe(
    collection: Any,
    *,
    where: Dict[str, Any],
    principal_key: str,
    max_rows: int,
) -> Dict[str, Any]:
    """Prove scoped storage reachability without loading an unbounded namespace."""

    bounded_rows = max(1, min(int(max_rows), 10_000))
    try:
        data = collection.get(
            where=where,
            include=["metadatas"],
            limit=bounded_rows + 1,
        )
    except Exception as exc:
        return {
            "available": False,
            "count": None,
            "countIsLowerBound": False,
            "scanLimit": bounded_rows,
            "error": f"{type(exc).__name__}:{exc}",
        }

    metadatas = data.get("metadatas") or []
    matching = sum(
        1
        for metadata in metadatas[: bounded_rows + 1]
        if isinstance(metadata, dict)
        and str(metadata.get("memory_principal_key") or "") == principal_key
    )
    truncated = matching > bounded_rows or len(metadatas) > bounded_rows
    return {
        "available": True,
        "count": min(matching, bounded_rows),
        "countIsLowerBound": truncated,
        "scanLimit": bounded_rows,
    }
