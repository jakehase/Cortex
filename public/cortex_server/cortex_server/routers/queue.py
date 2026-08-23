"""Bounded, non-blocking API surface for the Cortex Celery queue."""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from functools import partial
from pathlib import Path
from typing import Annotated, Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Response
from pydantic import BaseModel, Field, field_validator

from cortex_server.modules import queue_admission
from cortex_server.worker import app as celery_app
from cortex_server.modules.async_offload import (
    BlockingCallDeadlineExceeded,
    run_blocking,
)


router = APIRouter()

MAX_QUEUE_ARGUMENTS = 32
MAX_QUEUE_ARGUMENT_BYTES = 64 * 1024
MAX_QUEUE_ARGUMENT_DEPTH = 8
MAX_QUEUE_ARGUMENT_NODES = 2048
MAX_QUEUE_CAPACITY = 10_000
MAX_IDEMPOTENCY_RECORDS = 4096
MAX_RECONCILE_BATCH = 32
_IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_TERMINAL_STATES = set(queue_admission.TERMINAL_STATES)

DEFAULT_ADMISSION_DB_PATH = Path(
    os.getenv(
        "CORTEX_QUEUE_ADMISSION_DB_PATH",
        "/opt/clawdbot/state/queue_admission.sqlite3",
    )
)
_CALL_SLOT_LOCK = threading.Lock()
_CALL_SLOTS: Dict[str, threading.BoundedSemaphore] = {}
_CALL_EXECUTOR = ThreadPoolExecutor(
    max_workers=64,
    thread_name_prefix="cortex-queue-io",
)


class QueueDependencyUnavailable(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class ScheduleRequest(BaseModel):
    task: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_.:-]+$")
    args: List[Any] = Field(default_factory=list, max_length=MAX_QUEUE_ARGUMENTS)
    idempotency_key: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
    )

    @field_validator("args")
    @classmethod
    def _bounded_args(cls, value: List[Any]) -> List[Any]:
        _validate_argument_tree(value)
        try:
            encoded = json.dumps(
                value,
                allow_nan=False,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise ValueError("args must be finite, JSON-serializable values") from exc
        if len(encoded) > MAX_QUEUE_ARGUMENT_BYTES:
            raise ValueError(
                f"args exceed the {MAX_QUEUE_ARGUMENT_BYTES}-byte queue limit"
            )
        return value


class TaskResponse(BaseModel):
    task_id: str
    status: str
    idempotent_replay: bool = False


class TaskStatus(BaseModel):
    task_id: str
    status: str
    result: Any | None
    state: str


class CancelRequest(BaseModel):
    reason: str = Field(default="cancelled_by_request", min_length=1, max_length=256)


class CancellationResponse(BaseModel):
    task_id: str
    accepted: bool
    status: str
    terminate: bool = False
    reason: str
    idempotent_replay: bool = False


class QueueInspection(BaseModel):
    available: bool
    active_jobs: Optional[int] = None
    source: str = "celery.inspect"
    error_code: Optional[str] = None


class QueueStatusResponse(BaseModel):
    success: bool
    status: str
    active_jobs: Optional[int]
    pending_admissions: int
    capacity: int
    available_capacity: int
    source: str
    error_code: Optional[str] = None


def _validate_argument_tree(value: Any) -> None:
    nodes = 0

    def visit(item: Any, depth: int) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > MAX_QUEUE_ARGUMENT_NODES:
            raise ValueError("args exceed the bounded value count")
        if depth > MAX_QUEUE_ARGUMENT_DEPTH:
            raise ValueError("args exceed the bounded nesting depth")
        if item is None or isinstance(item, (bool, int, str)):
            return
        if isinstance(item, float):
            if not math.isfinite(item):
                raise ValueError("args must contain only finite numbers")
            return
        if isinstance(item, list):
            for child in item:
                visit(child, depth + 1)
            return
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str):
                    raise ValueError("args object keys must be strings")
                visit(child, depth + 1)
            return
        raise ValueError("args must contain only JSON-compatible values")

    visit(value, 0)


def _bounded_env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(parsed, maximum))


def _bounded_env_float(
    name: str, default: float, *, minimum: float, maximum: float
) -> float:
    try:
        parsed = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    if not math.isfinite(parsed):
        return default
    return max(minimum, min(parsed, maximum))


def _queue_capacity() -> int:
    return _bounded_env_int(
        "CORTEX_QUEUE_MAX_PENDING", 128, minimum=1, maximum=MAX_QUEUE_CAPACITY
    )


def _retry_after_seconds() -> int:
    return _bounded_env_int(
        "CORTEX_QUEUE_RETRY_AFTER_SECONDS", 5, minimum=1, maximum=3600
    )


def _celery_call_timeout_seconds() -> float:
    return _bounded_env_float(
        "CORTEX_QUEUE_CALL_TIMEOUT_SECONDS", 2.0, minimum=0.1, maximum=10.0
    )


def _admission_call_timeout_seconds() -> float:
    return _bounded_env_float(
        "CORTEX_QUEUE_ADMISSION_TIMEOUT_SECONDS", 2.0, minimum=0.1, maximum=5.0
    )


def _celery_call_concurrency() -> int:
    return _bounded_env_int(
        "CORTEX_QUEUE_CALL_CONCURRENCY", 8, minimum=1, maximum=64
    )


def _reconcile_batch_size() -> int:
    return _bounded_env_int(
        "CORTEX_QUEUE_RECONCILE_BATCH", 8, minimum=1, maximum=MAX_RECONCILE_BATCH
    )


def _call_slot(operation: str) -> threading.BoundedSemaphore:
    with _CALL_SLOT_LOCK:
        slot = _CALL_SLOTS.get(operation)
        if slot is None:
            slot = threading.BoundedSemaphore(_celery_call_concurrency())
            _CALL_SLOTS[operation] = slot
        return slot


async def _await_call_future(
    operation: str, future: Future, *, timeout_seconds: float
) -> Any:
    """Await a synchronous dependency without relying on AnyIO loop affinity.

    A timed-out worker remains charged against its semaphore until the real
    call exits.  Polling a concurrent future also keeps this boundary stable
    across isolated event loops used by command-line callers and tests.
    """

    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    while not future.done():
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise QueueDependencyUnavailable(f"{operation}_timeout")
        await asyncio.sleep(min(0.005, remaining))
    return future.result()


def _submit_bounded_call(
    operation: str,
    function: Callable[..., Any],
    *args: Any,
    slot_name: str = "celery_dependency",
    **kwargs: Any,
) -> Future:
    slot = _call_slot(slot_name)
    if not slot.acquire(blocking=False):
        raise QueueDependencyUnavailable(f"{operation}_saturated")
    call = partial(function, *args, **kwargs)
    try:
        future = _CALL_EXECUTOR.submit(call)
    except Exception:
        slot.release()
        raise
    future.add_done_callback(lambda _completed: slot.release())
    return future


async def _run_celery_call(
    operation: str, function: Callable[..., Any], *args: Any, **kwargs: Any
) -> Any:
    try:
        future = _submit_bounded_call(
            operation,
            function,
            *args,
            slot_name="celery_dependency",
            **kwargs,
        )
        return await _await_call_future(
            operation,
            future,
            timeout_seconds=_celery_call_timeout_seconds(),
        )
    except QueueDependencyUnavailable:
        raise
    except Exception as exc:
        raise QueueDependencyUnavailable(f"{operation}_unavailable") from exc


async def _run_admission_call(
    operation: str, function: Callable[..., Any], *args: Any, **kwargs: Any
) -> Any:
    try:
        future = _submit_bounded_call(
            operation,
            function,
            *args,
            slot_name="admission_store",
            **kwargs,
        )
        return await _await_call_future(
            operation,
            future,
            timeout_seconds=_admission_call_timeout_seconds(),
        )
    except (queue_admission.QueueCapacityUnavailable, HTTPException):
        raise
    except queue_admission.QueueAdmissionStoreError as exc:
        raise QueueDependencyUnavailable(f"{operation}_unavailable") from exc
    except Exception as exc:
        raise QueueDependencyUnavailable(f"{operation}_failed") from exc


def _inspect_queue_sync() -> QueueInspection:
    try:
        inspector = celery_app.control.inspect(timeout=1.0)
        if inspector is None:
            return QueueInspection(
                available=False, error_code="queue_inspector_unavailable"
            )
        active_tasks = inspector.active()
        if active_tasks is None or active_tasks == {}:
            return QueueInspection(
                available=False, error_code="queue_workers_unavailable"
            )
        if not isinstance(active_tasks, dict):
            return QueueInspection(
                available=False, error_code="queue_inspection_malformed"
            )
        total_jobs = 0
        for tasks in active_tasks.values():
            if tasks is None:
                continue
            if not isinstance(tasks, list):
                return QueueInspection(
                    available=False, error_code="queue_inspection_malformed"
                )
            total_jobs += len(tasks)
        return QueueInspection(available=True, active_jobs=total_jobs)
    except Exception:
        return QueueInspection(
            available=False, error_code="queue_inspection_failed"
        )


def _normalize_idempotency_key(value: Optional[str]) -> Optional[str]:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if not _IDEMPOTENCY_KEY_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=422, detail="invalid idempotency key")
    return normalized


def _request_digest(request: ScheduleRequest) -> str:
    encoded = json.dumps(
        {"task": request.task, "args": request.args},
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _reserve_admission(
    *, idempotency_key: str, request_digest: str
) -> tuple[Dict[str, Any], bool]:
    try:
        return queue_admission.reserve(
            DEFAULT_ADMISSION_DB_PATH,
            idempotency_key=idempotency_key,
            request_digest=request_digest,
            capacity=_queue_capacity(),
            max_records=MAX_IDEMPOTENCY_RECORDS,
        )
    except queue_admission.QueueIdempotencyConflict as exc:
        raise HTTPException(
            status_code=409,
            detail="idempotency key was already used for a different request",
        ) from exc


def _update_admission(
    idempotency_key: str, *, status: str, task_id: Optional[str] = None
) -> Dict[str, Any]:
    return queue_admission.update(
        DEFAULT_ADMISSION_DB_PATH,
        idempotency_key,
        status=status,
        task_id=task_id,
        max_records=MAX_IDEMPOTENCY_RECORDS,
    )


def _admission_for_task(task_id: str) -> Optional[Dict[str, Any]]:
    return queue_admission.get_by_task(DEFAULT_ADMISSION_DB_PATH, task_id)


def _mark_task_status(task_id: str, status: str) -> None:
    admission = _admission_for_task(task_id)
    if admission is not None:
        _update_admission(
            str(admission.get("idempotency_key") or ""),
            status=status,
            task_id=task_id,
        )


def _admission_counts() -> tuple[int, int, int]:
    return queue_admission.counts(
        DEFAULT_ADMISSION_DB_PATH, capacity=_queue_capacity()
    )


def _reset_admissions_for_tests() -> None:
    queue_admission.clear(DEFAULT_ADMISSION_DB_PATH)
    with _CALL_SLOT_LOCK:
        _CALL_SLOTS.clear()


def _task_status_sync(task_id: str) -> Dict[str, Any]:
    backend = celery_app.backend
    if backend is None:
        raise RuntimeError("Celery result backend is unavailable")
    meta = backend.get_task_meta(task_id)
    metadata = dict(meta) if isinstance(meta, dict) else {}
    state = str(metadata.get("status") or "PENDING").upper()
    return {"state": state, "result": metadata.get("result"), "meta": metadata}


def _public_status_for_state(state: str) -> str:
    return {
        "PENDING": "pending",
        "RECEIVED": "pending",
        "STARTED": "pending",
        "RETRY": "pending",
        "SUCCESS": "success",
        "FAILURE": "failure",
        "REVOKED": "cancelled",
    }.get(str(state or "").upper(), "pending")

async def _reconcile_terminal_admissions() -> int:
    """Release completed slots without requiring per-task client polling."""

    records = await _run_admission_call(
        "queue_admission_reconcile",
        queue_admission.list_reconcilable,
        DEFAULT_ADMISSION_DB_PATH,
        limit=_reconcile_batch_size(),
    )

    async def reconcile(record: Dict[str, Any]) -> bool:
        task_id = str(record.get("task_id") or "")
        if not task_id:
            return False
        try:
            observed = await _run_celery_call(
                "queue_backend_reconcile", _task_status_sync, task_id
            )
        except QueueDependencyUnavailable:
            return False
        status = _public_status_for_state(str(observed.get("state") or "PENDING"))
        if status not in _TERMINAL_STATES:
            return False
        await _run_admission_call(
            "queue_admission_update",
            _mark_task_status,
            task_id,
            status,
        )
        return True

    if not records:
        return 0
    outcomes = await asyncio.gather(*(reconcile(record) for record in records))
    return sum(1 for outcome in outcomes if outcome)


@router.post("/schedule", response_model=TaskResponse)
async def schedule_task(
    request: ScheduleRequest,
    idempotency_key: Annotated[
        Optional[str], Header(alias="Idempotency-Key")
    ] = None,
) -> TaskResponse:
    """Schedule one bounded task with capacity and idempotency admission."""

    if request.task not in celery_app.tasks:
        raise HTTPException(status_code=404, detail=f"Unknown task: {request.task}")

    body_key = _normalize_idempotency_key(request.idempotency_key)
    header_key = _normalize_idempotency_key(idempotency_key)
    if body_key and header_key and body_key != header_key:
        raise HTTPException(
            status_code=409,
            detail="body and header idempotency keys do not match",
        )
    resolved_key = body_key or header_key
    if resolved_key is None:
        raise HTTPException(status_code=422, detail="idempotency key is required")

    digest = _request_digest(request)

    async def reserve() -> tuple[Dict[str, Any], bool]:
        return await _run_admission_call(
            "queue_admission_reserve",
            _reserve_admission,
            idempotency_key=resolved_key,
            request_digest=digest,
        )

    try:
        admission, replay = await reserve()
    except queue_admission.QueueCapacityUnavailable as initial_capacity:
        # Finished jobs are reaped on pressure even if no client queried their
        # individual task status.  Admission is retried once, atomically.
        try:
            await _reconcile_terminal_admissions()
            admission, replay = await reserve()
        except queue_admission.QueueCapacityUnavailable as exc:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "queue_capacity_exhausted",
                    "capacity": exc.capacity,
                },
                headers={"Retry-After": str(_retry_after_seconds())},
            ) from exc
        except QueueDependencyUnavailable:
            # Reconciliation is opportunistic.  If it cannot prove a terminal
            # slot, preserve the original fail-closed capacity result.
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "queue_capacity_exhausted",
                    "capacity": initial_capacity.capacity,
                },
                headers={"Retry-After": str(_retry_after_seconds())},
            ) from initial_capacity
    except QueueDependencyUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code}) from exc

    if replay:
        replay_status = str(admission.get("status") or "")
        replay_task_id = str(admission.get("task_id") or "")
        if replay_task_id:
            return TaskResponse(
                task_id=replay_task_id,
                status=replay_status,
                idempotent_replay=True,
            )
        code = (
            "queue_dispatch_outcome_unknown"
            if replay_status == "dispatch_unknown"
            else "queue_dispatch_in_progress"
        )
        raise HTTPException(
            status_code=503 if replay_status == "dispatch_unknown" else 409,
            detail={"code": code},
            headers={"Retry-After": str(_retry_after_seconds())},
        )

    try:
        async_result = await _run_celery_call(
            "queue_dispatch", celery_app.send_task, request.task, args=request.args
        )
        task_id = str(getattr(async_result, "id", "") or "").strip()
        if not task_id:
            raise QueueDependencyUnavailable("queue_dispatch_missing_task_id")
    except QueueDependencyUnavailable as exc:
        # A timed-out/background publish may still complete.  Keep the
        # idempotency reservation and capacity charge so a retry cannot create
        # a duplicate task whose first outcome is unknown.
        try:
            await _run_admission_call(
                "queue_admission_update",
                _update_admission,
                resolved_key,
                status="dispatch_unknown",
            )
        except QueueDependencyUnavailable:
            pass
        raise HTTPException(
            status_code=503,
            detail={"code": exc.code},
            headers={"Retry-After": str(_retry_after_seconds())},
        ) from exc

    try:
        await _run_admission_call(
            "queue_admission_update",
            _update_admission,
            resolved_key,
            status="scheduled",
            task_id=task_id,
        )
    except QueueDependencyUnavailable as exc:
        # The publish succeeded but the durable outcome could not be recorded.
        # Never invite a retry that could dispatch the same request twice.
        raise HTTPException(
            status_code=503,
            detail={"code": "queue_dispatch_outcome_not_recorded"},
            headers={"Retry-After": str(_retry_after_seconds())},
        ) from exc
    return TaskResponse(task_id=task_id, status="scheduled")


@router.get("/status/{task_id}", response_model=TaskStatus)
async def get_status(task_id: str) -> TaskStatus:
    """Get task status without running backend I/O on the event loop."""

    try:
        observed = await _run_celery_call(
            "queue_backend_status", _task_status_sync, task_id
        )
    except QueueDependencyUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code}) from exc

    state = str(observed.get("state") or "PENDING").upper()
    status = _public_status_for_state(state)
    meta = observed.get("meta") if isinstance(observed.get("meta"), dict) else {}
    try:
        admission = await _run_admission_call(
            "queue_admission_lookup", _admission_for_task, task_id
        )
    except QueueDependencyUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code}) from exc
    if not meta and state == "PENDING" and admission is None:
        raise HTTPException(status_code=404, detail=f"Unknown task id: {task_id}")
    if status in _TERMINAL_STATES:
        try:
            await _run_admission_call(
                "queue_admission_update", _mark_task_status, task_id, status
            )
        except QueueDependencyUnavailable as exc:
            raise HTTPException(status_code=503, detail={"code": exc.code}) from exc
    return TaskStatus(
        task_id=task_id,
        status=status,
        result=observed.get("result") if status != "pending" else None,
        state=state,
    )


@router.post("/cancel/{task_id}", response_model=CancellationResponse)
async def cancel_task(task_id: str, request: CancelRequest) -> CancellationResponse:
    """Request cooperative revocation; running workers are never terminated."""

    try:
        admission = await _run_admission_call(
            "queue_admission_lookup", _admission_for_task, task_id
        )
    except QueueDependencyUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code}) from exc
    if admission is None:
        raise HTTPException(status_code=404, detail=f"Unknown admitted task: {task_id}")
    current = str(admission.get("status") or "")
    if current in {"cancelled", "cancellation_requested"}:
        return CancellationResponse(
            task_id=task_id,
            accepted=True,
            status=current,
            reason=request.reason,
            idempotent_replay=True,
        )
    if current in {"success", "failure"}:
        raise HTTPException(
            status_code=409,
            detail=f"task is already terminal with status {current}",
        )

    try:
        await _run_celery_call(
            "queue_cancel",
            celery_app.control.revoke,
            task_id,
            terminate=False,
        )
    except QueueDependencyUnavailable as exc:
        raise HTTPException(status_code=503, detail={"code": exc.code}) from exc
    key = str(admission.get("idempotency_key") or "")
    try:
        await _run_admission_call(
            "queue_admission_update",
            _update_admission,
            key,
            status="cancellation_requested",
            task_id=task_id,
        )
    except QueueDependencyUnavailable as exc:
        # Revocation is cooperative and may already have been accepted.  The
        # durable record remains scheduled so retrying cancellation is safe.
        raise HTTPException(status_code=503, detail={"code": exc.code}) from exc
    return CancellationResponse(
        task_id=task_id,
        accepted=True,
        status="cancellation_requested",
        reason=request.reason,
    )


@router.get(
    "/status",
    response_model=QueueStatusResponse,
    responses={503: {"model": QueueStatusResponse}},
)
async def get_queue_status(
    response: Response = None,
) -> QueueStatusResponse | Dict[str, Any]:
    """Return online only when a typed Celery worker inspection succeeds."""

    # Keep the pre-resilience programmatic contract used by local callers and
    # probes. FastAPI always injects ``Response`` for the HTTP route, while a
    # direct no-argument call retains the shared, observable offload boundary
    # and its stable degraded fallback.
    if response is None:
        try:
            inspection = await run_blocking(
                "celery.inspect_active",
                _inspect_queue_sync,
                timeout_seconds=1.5,
            )
            if not inspection.available:
                raise RuntimeError(
                    inspection.error_code or "queue inspection unavailable"
                )
            return {
                "success": True,
                "status": "online",
                "active_jobs": int(inspection.active_jobs or 0),
                "source": inspection.source,
            }
        except (asyncio.TimeoutError, BlockingCallDeadlineExceeded):
            return {
                "success": False,
                "status": "degraded",
                "active_jobs": 0,
                "source": "timeout_fallback",
            }
        except Exception:
            return {
                "success": False,
                "status": "degraded",
                "active_jobs": 0,
                "source": "error_fallback",
            }

    try:
        inspection = await _run_celery_call(
            "queue_inspection", _inspect_queue_sync
        )
    except QueueDependencyUnavailable as exc:
        inspection = QueueInspection(available=False, error_code=exc.code)
    try:
        if inspection.available:
            await _reconcile_terminal_admissions()
        pending, capacity, available = await _run_admission_call(
            "queue_admission_count", _admission_counts
        )
    except QueueDependencyUnavailable as exc:
        response.status_code = 503
        return QueueStatusResponse(
            success=False,
            status="unavailable",
            active_jobs=(
                int(inspection.active_jobs or 0) if inspection.available else None
            ),
            pending_admissions=0,
            capacity=_queue_capacity(),
            available_capacity=0,
            source="queue.admission",
            error_code=exc.code,
        )
    if not inspection.available:
        response.status_code = 503
        return QueueStatusResponse(
            success=False,
            status="unavailable",
            active_jobs=None,
            pending_admissions=pending,
            capacity=capacity,
            available_capacity=available,
            source=inspection.source,
            error_code=inspection.error_code or "queue_inspection_unavailable",
        )
    return QueueStatusResponse(
        success=True,
        status="online",
        active_jobs=int(inspection.active_jobs or 0),
        pending_admissions=pending,
        capacity=capacity,
        available_capacity=available,
        source=inspection.source,
    )
