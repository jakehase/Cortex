from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.events import EVENT_JOB_ERROR, EVENT_SCHEDULER_SHUTDOWN
from cortex_server.worker import app as celery_app
from pathlib import Path
import json
import logging
import requests

logger = logging.getLogger(__name__)

# Initialize scheduler
scheduler = AsyncIOScheduler()

# Durable scheduler state
STATE_DIR = Path("/opt/clawdbot/state")
JOBS_FILE = STATE_DIR / "scheduler_jobs.json"
SENTINEL_JOB_ID = "sentinel_autoscan"


def _load_job_state() -> dict:
    if not JOBS_FILE.exists():
        return {}
    try:
        return json.loads(JOBS_FILE.read_text())
    except Exception as exc:
        logger.warning(f"Failed to load scheduler state: {exc}")
        return {}


def _save_job_state(state: dict) -> None:
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        JOBS_FILE.write_text(json.dumps(state, indent=2, sort_keys=True))
    except Exception as exc:
        logger.error(f"Failed to persist scheduler state: {exc}")


def trigger_celery_task(task_name: str, args: list = None, kwargs: dict = None):
    """Send task to Celery and return async_result id."""
    if args is None:
        args = []
    if kwargs is None:
        kwargs = {}
    async_result = celery_app.send_task(task_name, args=args, kwargs=kwargs)
    return async_result.id


def add_cron_job(job_name: str, task: str, cron: str, args: list = None):
    """
    Add a cron job to trigger a Celery task.
    cron format: minute hour day month day_of_week
    """
    if args is None:
        args = []

    parts = cron.strip().split()
    if len(parts) != 5:
        raise ValueError("Cron expression must have 5 parts: minute hour day month day_of_week")

    minute, hour, day, month, day_of_week = parts

    job = scheduler.add_job(
        trigger_celery_task,
        trigger="cron",
        id=job_name,
        args=[task, args, {}],
        minute=minute,
        hour=hour,
        day=day,
        month=month,
        day_of_week=day_of_week,
        replace_existing=True,
    )

    # Persist durable config for reboot recovery
    state = _load_job_state()
    state[job_name] = {
        "type": "celery_cron",
        "task": task,
        "cron": cron,
        "args": args,
    }
    _save_job_state(state)

    return job.id


def _sentinel_autoscan_job():
    """Dead-man self-check for Sentinel; keeps monitoring active without manual API calls."""
    base = "http://127.0.0.1:8000"
    try:
        monitor = requests.get(f"{base}/sentinel/monitor", timeout=4)
        if monitor.status_code != 200:
            logger.warning(f"sentinel monitor non-200: {monitor.status_code}")
        # Trigger lightweight quick scan each cycle to keep security loop alive
        scan = requests.post(
            f"{base}/sentinel/scan",
            json={"target": "localhost", "scan_type": "quick"},
            timeout=8,
        )
        if scan.status_code != 200:
            logger.warning(f"sentinel autoscan non-200: {scan.status_code}")
    except Exception as exc:
        logger.error(f"sentinel autoscan failed: {exc}")


def ensure_sentinel_autoscan(interval_minutes: int = 5) -> None:
    """Ensure Sentinel has an autonomous periodic self-check job."""
    if scheduler.get_job(SENTINEL_JOB_ID) is None:
        scheduler.add_job(
            _sentinel_autoscan_job,
            trigger="interval",
            id=SENTINEL_JOB_ID,
            minutes=interval_minutes,
            replace_existing=True,
        )



def restore_jobs():
    """Restore durable cron jobs after process restart."""
    state = _load_job_state()
    for job_name, cfg in state.items():
        if cfg.get("type") != "celery_cron":
            continue
        try:
            add_cron_job(
                job_name=job_name,
                task=cfg.get("task", ""),
                cron=cfg.get("cron", "* * * * *"),
                args=cfg.get("args") or [],
            )
        except Exception as exc:
            logger.error(f"Failed to restore job {job_name}: {exc}")


def _scheduler_event_listener(event):
    if event.code == EVENT_JOB_ERROR:
        logger.error(f"Scheduler job error detected: {event}")
    elif event.code == EVENT_SCHEDULER_SHUTDOWN:
        logger.warning("Scheduler shutdown detected")


def start_scheduler():
    """Start the scheduler in background (non-blocking for FastAPI)."""
    if scheduler.running:
        return
    try:
        scheduler.add_listener(_scheduler_event_listener, EVENT_JOB_ERROR | EVENT_SCHEDULER_SHUTDOWN)
        scheduler.start()
    except Exception as exc:
        logger.exception(f"Scheduler failed to start: {exc}")
        raise


def get_scheduled_jobs():
    """Return list of scheduled jobs."""
    return scheduler.get_jobs()


def remove_job(job_id: str):
    """Remove a scheduled job by id."""
    scheduler.remove_job(job_id)

    # Keep durable state in sync
    state = _load_job_state()
    if job_id in state:
        state.pop(job_id, None)
        _save_job_state(state)
