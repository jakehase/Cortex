"""Chronos (L14): safe nightly maintenance with durable run receipts.

Two things live here:

* A registry of **safe maintenance jobs** that run in-process, make no
  network calls, send no messages and only write Chronos's own state (run
  receipts and its changelog). They run on a robust daily schedule
  (next-fire-time computation, one catch-up after a missed window) and can be
  triggered manually through the existing action-capability gate.
* The legacy autonomous "night shift" pipeline (dream -> council ->
  materialize -> diplomat -> geneticist), which stays **held fail closed**: it
  generated source, mutated persona state and sent messages after one coarse
  scheduler decision, so it is never run until every final sink consumes its
  own target- and payload-bound delegated capability.

``last_run_date`` is set only when at least one safe job actually completed,
and every run leaves a receipt in ``runs.sqlite3``.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sqlite3
import threading
import uuid
import weakref
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
)

HELD_PIPELINES = (
    {
        "name": "nightly_evolution_pipeline",
        "stages": ["dream", "council", "materialize", "diplomat", "geneticist"],
        "reason": "held: every final sink requires its own target- and payload-bound delegated capability",
    },
)
RECEIPT_RETENTION_DAYS = 90
CHANGELOG_ROTATE_BYTES = 5 * 1024 * 1024
CATCH_UP_DELAY_SECONDS = 30.0
JOB_TIMEOUT_SECONDS = 30.0


def _state_root() -> Path:
    configured = os.getenv("CORTEX_CHRONOS_STATE_DIR", "").strip()
    if configured:
        root = Path(configured).expanduser()
    elif os.getenv("CORTEX_ARTIFACT_ROOT", "").strip():
        root = Path(os.environ["CORTEX_ARTIFACT_ROOT"]).expanduser() / "chronos"
    elif os.getenv("XDG_STATE_HOME", "").strip():
        root = Path(os.environ["XDG_STATE_HOME"]).expanduser() / "cortex" / "chronos"
    else:
        root = Path.home() / ".local" / "state" / "cortex" / "chronos"
    if not root.is_absolute():
        raise ValueError("Chronos state directory must be absolute")
    return root


def _run_at() -> tuple[int, int]:
    raw = os.getenv("CORTEX_CHRONOS_RUN_AT", "03:00").strip()
    try:
        hour_text, minute_text = raw.split(":", 1)
        hour, minute = int(hour_text), int(minute_text)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return 3, 0


def next_fire_time(now: Optional[datetime] = None) -> datetime:
    """Next local fire time for the daily maintenance window."""

    current = now or datetime.now()
    hour, minute = _run_at()
    candidate = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= current:
        candidate += timedelta(days=1)
    return candidate


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Safe jobs: in-process, read-only or Chronos-state-only.
# ---------------------------------------------------------------------------


async def _job_health_snapshot(_chronos: "Chronos") -> Dict[str, Any]:
    from cortex_server.modules.kernel import get_kernel, kernel_level_status, summarise_metrics

    metrics = await asyncio.to_thread(get_kernel().metrics)
    levels = kernel_level_status()
    return {
        "host": summarise_metrics(metrics),
        "levels_measured": bool(levels.get("measured")),
        "level_counts": levels.get("counts"),
        "degraded_levels": levels.get("degraded_levels"),
        "unavailable_levels": levels.get("unavailable_levels"),
    }


async def _job_sentinel_snapshot(_chronos: "Chronos") -> Dict[str, Any]:
    from cortex_server.routers.sentinel import _sentinel_health_snapshot, watcher_state_health

    health = _sentinel_health_snapshot()
    persistence = watcher_state_health()
    return {
        "status": health.get("status"),
        "severity": health.get("severity"),
        "health_reason": health.get("health_reason"),
        "last_scan_age_seconds": health.get("last_scan_age_seconds"),
        "watcher_persistence": persistence.get("status"),
    }


async def _job_performance_snapshot(_chronos: "Chronos") -> Dict[str, Any]:
    from cortex_server.modules.catalyst import analyze

    analysis = await analyze(None)
    return {
        "samples": analysis.get("samples"),
        "event_loop_lag_ms": analysis.get("event_loop_lag_ms"),
        "bottleneck_rules": [row.get("rule") for row in analysis.get("bottlenecks") or ()],
    }


async def _job_changelog_rotate(chronos: "Chronos") -> Dict[str, Any]:
    path = chronos.changelog_path
    try:
        size = path.stat().st_size
    except FileNotFoundError:
        return {"rotated": False, "size_bytes": 0}
    if size <= CHANGELOG_ROTATE_BYTES:
        return {"rotated": False, "size_bytes": size}
    rotated = path.with_name(path.name + ".1")
    await asyncio.to_thread(os.replace, path, rotated)
    return {"rotated": True, "size_bytes": size}


async def _job_receipt_compaction(chronos: "Chronos") -> Dict[str, Any]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RECEIPT_RETENTION_DAYS)).isoformat()
    deleted = await asyncio.to_thread(chronos._delete_runs_before, cutoff)
    return {"deleted_receipts": deleted, "retention_days": RECEIPT_RETENTION_DAYS}


SAFE_JOBS: Dict[str, Dict[str, Any]] = {
    "health_snapshot": {
        "run": _job_health_snapshot,
        "description": "L1 host telemetry and measured level availability snapshot",
    },
    "sentinel_snapshot": {
        "run": _job_sentinel_snapshot,
        "description": "L21 watcher/scan health snapshot (no probes are sent)",
    },
    "performance_snapshot": {
        "run": _job_performance_snapshot,
        "description": "L11 measured bottleneck analysis snapshot",
    },
    "changelog_rotate": {
        "run": _job_changelog_rotate,
        "description": "Rotate Chronos's own digest changelog above 5 MiB",
    },
    "receipt_compaction": {
        "run": _job_receipt_compaction,
        "description": f"Delete Chronos run receipts older than {RECEIPT_RETENTION_DAYS} days",
    },
}


def enabled_jobs() -> List[str]:
    disabled = {
        item.strip()
        for item in os.getenv("CORTEX_CHRONOS_DISABLED_JOBS", "").split(",")
        if item.strip()
    }
    return [name for name in SAFE_JOBS if name not in disabled]


class Chronos:
    """Daily safe-maintenance scheduler; the legacy pipeline stays held."""

    def __init__(self, changelog_path: str | None = None):
        configured_changelog = changelog_path or os.getenv(
            "CORTEX_CHRONOS_CHANGELOG_PATH",
            str(_state_root() / "changelog.txt"),
        )
        self.changelog_path = Path(configured_changelog).expanduser()
        if not self.changelog_path.is_absolute():
            raise ValueError("Chronos changelog path must be absolute")
        configured_db = os.getenv("CORTEX_CHRONOS_RUNS_DB", "").strip()
        self.runs_db_path = (
            Path(configured_db).expanduser()
            if configured_db
            else self.changelog_path.parent / "runs.sqlite3"
        )
        if not self.runs_db_path.is_absolute():
            raise ValueError("Chronos runs database path must be absolute")
        self.running = False
        self.last_run_date: str | None = None
        self.last_scheduled_attempt_at: str | None = None
        self._db_lock = threading.Lock()
        self._job_lock: Optional[asyncio.Lock] = None

    # -- receipts -----------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        self.runs_db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(self.runs_db_path), timeout=5.0)
        connection.execute(
            "CREATE TABLE IF NOT EXISTS runs ("
            " run_id TEXT PRIMARY KEY, job TEXT NOT NULL, trigger TEXT NOT NULL,"
            " started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL,"
            " output_digest TEXT, summary TEXT, error_type TEXT)"
        )
        return connection

    def _record_run(self, receipt: Dict[str, Any]) -> None:
        with self._db_lock:
            connection = self._connect()
            try:
                with connection:
                    connection.execute(
                        "INSERT OR REPLACE INTO runs (run_id, job, trigger, started_at, ended_at, status,"
                        " output_digest, summary, error_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            receipt["run_id"],
                            receipt["job"],
                            receipt["trigger"],
                            receipt["started_at"],
                            receipt.get("ended_at"),
                            receipt["status"],
                            receipt.get("output_digest"),
                            json.dumps(receipt.get("summary"), default=str)[:4000]
                            if receipt.get("summary") is not None
                            else None,
                            receipt.get("error_type"),
                        ),
                    )
            finally:
                connection.close()

    def _delete_runs_before(self, cutoff_iso: str) -> int:
        with self._db_lock:
            connection = self._connect()
            try:
                with connection:
                    cursor = connection.execute("DELETE FROM runs WHERE started_at < ?", (cutoff_iso,))
                    return int(cursor.rowcount or 0)
            finally:
                connection.close()

    def recent_runs(self, limit: int = 20) -> List[Dict[str, Any]]:
        bounded = max(1, min(int(limit), 200))
        with self._db_lock:
            try:
                connection = self._connect()
            except (OSError, sqlite3.Error):
                return []
            try:
                rows = connection.execute(
                    "SELECT run_id, job, trigger, started_at, ended_at, status, output_digest, summary, error_type"
                    " FROM runs ORDER BY started_at DESC LIMIT ?",
                    (bounded,),
                ).fetchall()
            except sqlite3.Error:
                return []
            finally:
                connection.close()
        out: List[Dict[str, Any]] = []
        for row in rows:
            try:
                summary = json.loads(row[7]) if row[7] else None
            except ValueError:
                summary = None
            out.append(
                {
                    "run_id": row[0],
                    "job": row[1],
                    "trigger": row[2],
                    "started_at": row[3],
                    "ended_at": row[4],
                    "status": row[5],
                    "output_digest": row[6],
                    "summary": summary,
                    "error_type": row[8],
                }
            )
        return out

    def last_completed_run(self) -> Optional[Dict[str, Any]]:
        for run in self.recent_runs(200):
            if run["status"] == "succeeded":
                return run
        return None

    def _last_scheduled_success_date(self) -> Optional[str]:
        for run in self.recent_runs(200):
            if run["status"] == "succeeded" and run["trigger"] in {"schedule", "catch_up"}:
                try:
                    return datetime.fromisoformat(run["started_at"]).astimezone().strftime("%Y-%m-%d")
                except ValueError:
                    continue
        return None

    # -- execution ----------------------------------------------------------

    async def run_job(self, name: str, *, trigger: str = "manual") -> Dict[str, Any]:
        spec = SAFE_JOBS.get(name)
        if spec is None or name not in enabled_jobs():
            raise KeyError(name)
        started_at = _now_iso()
        receipt: Dict[str, Any] = {
            "run_id": uuid.uuid4().hex,
            "job": name,
            "trigger": trigger,
            "started_at": started_at,
            "status": "failed",
        }
        try:
            output = await asyncio.wait_for(spec["run"](self), timeout=JOB_TIMEOUT_SECONDS)
            encoded = json.dumps(output, sort_keys=True, default=str).encode("utf-8")
            receipt.update(
                status="succeeded",
                output_digest=hashlib.sha256(encoded).hexdigest(),
                summary=output,
            )
        except asyncio.TimeoutError:
            receipt.update(status="failed", error_type="timeout")
        except Exception as exc:
            receipt.update(status="failed", error_type=type(exc).__name__)
        receipt["ended_at"] = _now_iso()
        try:
            await asyncio.to_thread(self._record_run, receipt)
            receipt["receipt_persisted"] = True
        except (OSError, sqlite3.Error) as exc:
            receipt["receipt_persisted"] = False
            receipt["receipt_error"] = type(exc).__name__
        return receipt

    async def run_safe_jobs(self, jobs: Optional[List[str]] = None, *, trigger: str = "manual") -> List[Dict[str, Any]]:
        names = list(jobs) if jobs is not None else enabled_jobs()
        if self._job_lock is None:
            self._job_lock = asyncio.Lock()
        async with self._job_lock:
            receipts = [await self.run_job(name, trigger=trigger) for name in names]
        if any(r["status"] == "succeeded" for r in receipts):
            self.last_run_date = datetime.now().strftime("%Y-%m-%d")
        self._log(
            f"safe maintenance trigger={trigger} succeeded={sum(r['status'] == 'succeeded' for r in receipts)} "
            f"failed={sum(r['status'] != 'succeeded' for r in receipts)}"
        )
        return receipts

    def schedule_view(self) -> Dict[str, Any]:
        last = self.last_completed_run()
        return {
            "scheduler_running": self.running,
            "next_fire": next_fire_time().isoformat(),
            "run_at_local": "%02d:%02d" % _run_at(),
            "enabled_jobs": enabled_jobs(),
            "held_pipelines": [dict(p) for p in HELD_PIPELINES],
            "last_run_date": self.last_run_date
            or (last["started_at"][:10] if last else None),
            "last_completed_run": last,
            "recent_runs": self.recent_runs(5),
        }

    # -- scheduler ----------------------------------------------------------

    async def start_scheduler(self) -> None:
        """Run safe jobs daily at the configured local time (catch up once)."""
        if self.running:
            return
        self.running = True
        self._log("Chronos started")
        started = datetime.now()
        catch_up_at: Optional[datetime] = None
        today_fire = next_fire_time(started - timedelta(days=1))
        # The most recent window that has already opened; catch up once if no
        # scheduled/catch-up run succeeded for that window's date.
        if today_fire <= started and self._last_scheduled_success_date() != today_fire.strftime("%Y-%m-%d"):
            catch_up_at = started + timedelta(seconds=CATCH_UP_DELAY_SECONDS)
        fire_at = next_fire_time(started)
        try:
            while self.running:
                now = datetime.now()
                due: Optional[str] = None
                if catch_up_at is not None and now >= catch_up_at:
                    due, catch_up_at = "catch_up", None
                elif now >= fire_at:
                    due = "schedule"
                    fire_at = next_fire_time(now)
                if due is not None:
                    self.last_scheduled_attempt_at = _now_iso()
                    await self.run_safe_jobs(trigger=due)
                    authorization = self._scheduled_authorization(now.strftime("%Y-%m-%d"))
                    if authorization is None:
                        self._log("Night shift held without delegated capabilities")
                    else:
                        await self.run_night_shift(authorization=authorization)
                targets = [fire_at] + ([catch_up_at] if catch_up_at is not None else [])
                wait = min((target - datetime.now()).total_seconds() for target in targets)
                await asyncio.sleep(max(1.0, min(60.0, wait)))
        finally:
            self.running = False

    def _scheduled_authorization(
        self, current_date: str
    ) -> ActionAuthorization | None:
        """Never synthesize authority from scheduler time or local state."""
        del current_date
        return None

    async def run_night_shift(
        self,
        *,
        authorization: ActionAuthorization | None = None,
    ) -> None:
        """Reject the legacy multi-sink pipeline even with a coarse receipt."""
        assert_action_authorized(authorization)
        raise RuntimeError(
            "Chronos night shift is disabled until every final sink consumes "
            "a target- and payload-bound delegated capability"
        )

    def _log(self, message: str) -> None:
        """Persist and emit only an event digest and byte count."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        message_bytes = str(message or "").encode("utf-8", errors="replace")
        message_digest = hashlib.sha256(message_bytes).hexdigest()
        log_line = (
            f"[{timestamp}] event_sha256={message_digest} "
            f"event_bytes={len(message_bytes)}\n"
        )

        self.changelog_path.parent.mkdir(parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.changelog_path, flags, 0o600)
        with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
            handle.write(log_line)

        print(
            f"[CHRONOS] event_sha256={message_digest} "
            f"event_bytes={len(message_bytes)}"
        )

    def stop(self) -> None:
        """Stop the scheduler."""
        was_running = self.running
        self.running = False
        if was_running:
            self._log("Chronos stopped")


_chronos_instance: Chronos | None = None
_chronos_instances: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()
_chronos_lock = threading.Lock()


def get_chronos() -> Chronos:
    """Get or create the Chronos instance for the running event loop."""
    global _chronos_instance
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        if _chronos_instance is None:
            _chronos_instance = Chronos()
        return _chronos_instance
    with _chronos_lock:
        instance = _chronos_instances.get(loop)
        if instance is None:
            instance = Chronos()
            _chronos_instances[loop] = instance
        return instance

