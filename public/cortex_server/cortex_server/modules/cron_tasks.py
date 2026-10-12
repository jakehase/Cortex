"""In-process scheduled task types for L8 Cron, plus schedule proposals.

Why in-process: the production deployment runs Redis but no Celery worker
process, so a Celery ``send_task`` only proves the broker accepted a message,
not that anything ran.  The task types here run inside the API process on the
APScheduler loop, behind the same deferred action capability that the
scheduler consumes at fire time.  They are deliberately narrow:

* ``cortex.reminder``       append a reminder record to the Cortex reminder
                            log (no external message is sent);
* ``cortex.health_report``  read-only snapshot of measured scheduler and host
                            health, appended to the Cortex report log.

The module also turns natural language ("remind me to stretch every weekday at
9:30") into a *proposal* for ``POST /cron/schedule``.  It never schedules.
Deterministic parsing handles exact phrasings; anything else goes to the
shared level model with a strict schema.  Without the model, the proposal is
reported as incomplete instead of guessed.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Mapping, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field

REMINDER_TASK = "cortex.reminder"
HEALTH_REPORT_TASK = "cortex.health_report"
REMINDER_LOG_FILENAME = "l8_cron_reminders.jsonl"
REPORT_LOG_FILENAME = "l8_cron_reports.jsonl"
MAX_REMINDER_CHARS = 500
_MAX_LOG_READ_BYTES = 2 * 1024 * 1024
_LOG_LOCK = threading.Lock()


class CronTaskArgsError(ValueError):
    """Arguments do not match the in-process task's contract."""


@dataclass(frozen=True)
class InProcessCronTask:
    name: str
    description: str
    effect: str  # "cortex_state_append" | "read_only"
    args_contract: str
    validate: Callable[[List[Any]], List[Any]]
    run: Callable[[List[Any], Mapping[str, Any]], Dict[str, Any]]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digest(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def _append_log(path: Path, row: Dict[str, Any]) -> None:
    line = json.dumps(row, ensure_ascii=False, sort_keys=True, default=str)
    with _LOG_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
            handle.flush()
            os.fsync(handle.fileno())


def read_log_tail(path: Path, *, limit: int = 50) -> List[Dict[str, Any]]:
    """Return the newest ``limit`` JSON rows from a bounded tail of ``path``."""

    cap = max(1, min(int(limit), 500))
    if not path.exists():
        return []
    size = path.stat().st_size
    with path.open("rb") as handle:
        if size > _MAX_LOG_READ_BYTES:
            handle.seek(size - _MAX_LOG_READ_BYTES)
            handle.readline()  # drop the partial first line
        data = handle.read().decode("utf-8", errors="ignore")
    rows: List[Dict[str, Any]] = []
    for line in data.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows[-cap:]


# ── cortex.reminder ─────────────────────────────────────────────────────────


def _validate_reminder_args(args: List[Any]) -> List[Any]:
    if not isinstance(args, list) or len(args) != 1 or not isinstance(args[0], str):
        raise CronTaskArgsError(f"{REMINDER_TASK} takes exactly one argument: the reminder text")
    text = " ".join(args[0].split())
    if not text:
        raise CronTaskArgsError("reminder text must not be empty")
    if len(text) > MAX_REMINDER_CHARS:
        raise CronTaskArgsError(f"reminder text must be at most {MAX_REMINDER_CHARS} characters")
    return [text]


def _run_reminder(args: List[Any], context: Mapping[str, Any]) -> Dict[str, Any]:
    text = _validate_reminder_args(list(args))[0]
    state_dir = Path(str(context["state_dir"]))
    reminder_id = f"rem_{uuid.uuid4().hex[:16]}"
    row = {
        "reminder_id": reminder_id,
        "ts": _utc_now_iso(),
        "job_id": context.get("job_id"),
        "run_id": context.get("run_id"),
        "source": context.get("source"),
        "owner_principal_sha256": _digest(str(context.get("owner_principal_id") or "")),
        "text": text,
        "delivery": "recorded_in_cortex_reminder_log",
    }
    _append_log(state_dir / REMINDER_LOG_FILENAME, row)
    return {
        "reminder_id": reminder_id,
        "recorded": True,
        "delivery": "recorded_in_cortex_reminder_log",
        "external_message_sent": False,
        "text_chars": len(text),
    }


# ── cortex.health_report ────────────────────────────────────────────────────


def _validate_health_args(args: List[Any]) -> List[Any]:
    if args not in ([], None):
        raise CronTaskArgsError(f"{HEALTH_REPORT_TASK} takes no arguments")
    return []


def _host_snapshot(state_dir: Path) -> Dict[str, Any]:
    snapshot: Dict[str, Any] = {"source": "unavailable"}
    try:
        import psutil  # type: ignore

        vm = psutil.virtual_memory()
        disk = psutil.disk_usage(str(state_dir))
        snapshot = {
            "source": "psutil",
            "cpu_percent": psutil.cpu_percent(interval=0.2),
            "memory_percent": vm.percent,
            "memory_available_bytes": int(vm.available),
            "state_disk_percent": disk.percent,
            "state_disk_free_bytes": int(disk.free),
        }
    except Exception as exc:  # psutil missing or /proc masked
        snapshot["error"] = type(exc).__name__
    try:
        snapshot["load_average"] = [round(v, 3) for v in os.getloadavg()]
    except (AttributeError, OSError):
        pass
    return snapshot


def _run_health_report(args: List[Any], context: Mapping[str, Any]) -> Dict[str, Any]:
    _validate_health_args(list(args))
    state_dir = Path(str(context["state_dir"]))
    collectors = context.get("collectors") or {}
    report: Dict[str, Any] = {
        "report_id": f"rpt_{uuid.uuid4().hex[:16]}",
        "ts": _utc_now_iso(),
        "job_id": context.get("job_id"),
        "run_id": context.get("run_id"),
        "basis": "measured",
        "host": _host_snapshot(state_dir),
    }
    for key, collector in dict(collectors).items():
        try:
            report[str(key)] = collector()
        except Exception as exc:
            report[str(key)] = {"error": type(exc).__name__}
    _append_log(state_dir / REPORT_LOG_FILENAME, report)
    host = report.get("host") or {}
    return {
        "report_id": report["report_id"],
        "recorded": True,
        "host_source": host.get("source"),
        "memory_percent": host.get("memory_percent"),
        "cpu_percent": host.get("cpu_percent"),
    }


IN_PROCESS_TASKS: Dict[str, InProcessCronTask] = {
    REMINDER_TASK: InProcessCronTask(
        name=REMINDER_TASK,
        description="Record a reminder in the Cortex reminder log (GET /cron/reminders). No external message is sent.",
        effect="cortex_state_append",
        args_contract='["<reminder text, 1-500 chars>"]',
        validate=_validate_reminder_args,
        run=_run_reminder,
    ),
    HEALTH_REPORT_TASK: InProcessCronTask(
        name=HEALTH_REPORT_TASK,
        description="Read-only measured health snapshot (host + scheduler) appended to the Cortex report log (GET /cron/reports).",
        effect="read_only",
        args_contract="[]",
        validate=_validate_health_args,
        run=_run_health_report,
    ),
}


def is_in_process_task(task_name: Any) -> bool:
    return str(task_name or "") in IN_PROCESS_TASKS


def validate_in_process_args(task_name: str, args: Any) -> List[Any]:
    spec = IN_PROCESS_TASKS.get(str(task_name or ""))
    if spec is None:
        raise CronTaskArgsError(f"unknown in-process task: {task_name}")
    return spec.validate(list(args or []) if isinstance(args, list) else args)


def in_process_task_catalog() -> List[Dict[str, Any]]:
    return [
        {
            "task": spec.name,
            "description": spec.description,
            "effect": spec.effect,
            "args": spec.args_contract,
            "dispatch": "in_process",
        }
        for spec in IN_PROCESS_TASKS.values()
    ]


def run_in_process_task(task_name: str, args: List[Any], context: Mapping[str, Any]) -> Dict[str, Any]:
    spec = IN_PROCESS_TASKS[str(task_name)]
    started = time.monotonic()
    result = spec.run(list(args), context)
    return {
        "task": spec.name,
        "effect": spec.effect,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "result": result,
    }


# ── Natural language → schedule proposal ───────────────────────────────────

_DAY_NAMES = {
    "monday": "mon", "mon": "mon",
    "tuesday": "tue", "tue": "tue", "tues": "tue",
    "wednesday": "wed", "wed": "wed",
    "thursday": "thu", "thu": "thu", "thur": "thu", "thurs": "thu",
    "friday": "fri", "fri": "fri",
    "saturday": "sat", "sat": "sat",
    "sunday": "sun", "sun": "sun",
}
_DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
_DAY_WORD_RE = "|".join(sorted(_DAY_NAMES, key=len, reverse=True))
_CLOCK_PATTERNS = (
    re.compile(r"\bat\s+(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<ampm>[ap]\.?m\.?)?(?![\w:])"),
    re.compile(r"(?<![:\d])\b(?P<hour>\d{1,2}):(?P<minute>\d{2})\s*(?P<ampm>[ap]\.?m\.?)?(?![\w:])"),
    re.compile(r"(?<![:\d])\b(?P<hour>\d{1,2})\s*(?P<ampm>[ap]\.?m\.?)(?!\w)"),
)


def _parse_clock(groups: Mapping[str, Optional[str]]) -> Optional[Tuple[int, int, bool]]:
    """Return (hour, minute, assumed_24h) or None when out of range."""

    hour = int(groups.get("hour") or 0)
    minute = int(groups.get("minute") or 0)
    ampm = (groups.get("ampm") or "").replace(".", "").lower()
    if minute > 59:
        return None
    if ampm:
        if not 1 <= hour <= 12:
            return None
        if ampm == "am":
            hour = 0 if hour == 12 else hour
        else:
            hour = 12 if hour == 12 else hour + 12
        return hour, minute, False
    if hour > 23:
        return None
    return hour, minute, hour <= 12


def _find_clock(text: str) -> Tuple[Optional[Tuple[int, int, bool]], bool]:
    """Return ((hour, minute, assumed_24h) | None, ambiguous).

    Every clock-like token in the text is considered; more than one distinct
    time (or an out-of-range one) is ambiguous rather than silently picked.
    """

    lowered = text.lower()
    clocks = set()
    if re.search(r"\bnoon\b", lowered):
        clocks.add((12, 0, False))
    if re.search(r"\bmidnight\b", lowered):
        clocks.add((0, 0, False))
    for pattern in _CLOCK_PATTERNS:
        for match in pattern.finditer(lowered):
            clocks.add(_parse_clock(match.groupdict()))
    if not clocks:
        return None, False
    if None in clocks:
        return None, True
    # "at 9" (24h assumption) and "9am" can describe the same minute.
    distinct = {(h, m) for h, m, _assumed in clocks}
    if len(distinct) > 1:
        return None, True
    explicit = [c for c in clocks if not c[2]]
    return (explicit[0] if explicit else next(iter(clocks))), False


_CLASSIC_DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def normalize_classic_cron(cron_expr: str) -> str:
    """Rewrite a numeric day-of-week field using classic cron semantics.

    Classic cron numbers weekdays Sunday=0 (or 7); APScheduler numbers them
    Monday=0.  Passing "0 9 * * 1-5" straight to APScheduler would fire
    Tuesday-Saturday, so numeric weekday fields are expanded to names here.
    Raises ValueError for malformed numeric fields.
    """

    parts = str(cron_expr or "").split()
    if len(parts) != 5:
        return str(cron_expr or "")
    dow = parts[4]
    if not re.search(r"\d", dow):
        return " ".join(parts)
    days: set = set()
    for item in dow.split(","):
        step = 1
        if "/" in item:
            item, raw_step = item.split("/", 1)
            if not raw_step.isdigit() or int(raw_step) < 1:
                raise ValueError("invalid day_of_week step")
            step = int(raw_step)
        if item == "*":
            lo, hi = 0, 6
        elif "-" in item:
            raw_lo, raw_hi = item.split("-", 1)
            if not (raw_lo.isdigit() and raw_hi.isdigit()):
                raise ValueError("mixed names and numbers in day_of_week are not supported")
            lo, hi = int(raw_lo), int(raw_hi)
        elif item.isdigit():
            lo = hi = int(item)
        else:
            raise ValueError("mixed names and numbers in day_of_week are not supported")
        if not (0 <= lo <= 7 and 0 <= hi <= 7 and lo <= hi):
            raise ValueError("day_of_week out of range")
        days.update(range(lo, hi + 1, step))
    names = sorted({_CLASSIC_DOW[d] for d in days}, key=_DAY_ORDER.index)
    parts[4] = ",".join(names)
    return " ".join(parts)


def parse_schedule_phrase(text: str) -> Dict[str, Any]:
    """Deterministically map exact recurring phrasings to a 5-field cron.

    Returns {"cron": str|None, "matched": str|None, "reason": str}.
    Day-of-week values use names (mon-fri) because APScheduler numbers
    weekdays from Monday=0, unlike classic cron.
    """

    lowered = " ".join(str(text or "").lower().split())
    if not lowered:
        return {"cron": None, "matched": None, "reason": "empty"}

    m = re.search(r"\bevery\s+(?P<n>\d{1,2})\s+minutes?\b", lowered)
    if m:
        n = int(m.group("n"))
        if 1 <= n <= 59:
            return {"cron": f"*/{n} * * * *" if n > 1 else "* * * * *", "matched": m.group(0), "reason": "interval_minutes"}
        return {"cron": None, "matched": m.group(0), "reason": "minute_interval_out_of_range"}
    m = re.search(r"\bevery\s+minute\b", lowered)
    if m:
        return {"cron": "* * * * *", "matched": m.group(0), "reason": "every_minute"}
    m = re.search(r"\bevery\s+(?P<n>\d{1,2})\s+hours?\b", lowered)
    if m:
        n = int(m.group("n"))
        if 1 <= n <= 23:
            return {"cron": f"0 */{n} * * *" if n > 1 else "0 * * * *", "matched": m.group(0), "reason": "interval_hours"}
        return {"cron": None, "matched": m.group(0), "reason": "hour_interval_out_of_range"}
    m = re.search(r"\b(every\s+hour|hourly)\b", lowered)
    if m:
        return {"cron": "0 * * * *", "matched": m.group(0), "reason": "hourly"}

    clock, ambiguous = _find_clock(lowered)
    if ambiguous:
        return {"cron": None, "matched": None, "reason": "multiple_or_invalid_times"}

    day_field: Optional[str] = None
    dom_field = "*"
    matched: Optional[str] = None
    m = re.search(
        r"\b(?:every\s+month|monthly)\s+on\s+the\s+(?P<dom>\d{1,2})(?:st|nd|rd|th)?\b"
        r"|\bon\s+the\s+(?P<dom2>\d{1,2})(?:st|nd|rd|th)?\s+of\s+every\s+month\b",
        lowered,
    )
    if m:
        dom = int(m.group("dom") or m.group("dom2"))
        if not 1 <= dom <= 31:
            return {"cron": None, "matched": m.group(0), "reason": "day_of_month_out_of_range"}
        day_field, dom_field, matched = "*", str(dom), m.group(0)

    if day_field is None:
        m = re.search(r"\b(every\s+weekday|on\s+weekdays|weekdays)\b", lowered)
        if m:
            day_field, matched = "mon-fri", m.group(0)
    if day_field is None:
        m = re.search(r"\b(every\s+weekend|on\s+weekends|weekends)\b", lowered)
        if m:
            day_field, matched = "sat,sun", m.group(0)
    if day_field is None:
        m = re.search(
            r"\bevery\s+(?P<days>(?:(?:" + _DAY_WORD_RE + r")s?\b(?:\s*,\s*|\s+and\s+|\s+)?)+)",
            lowered,
        )
        if m:
            found = re.findall(r"(" + _DAY_WORD_RE + r")s?\b", m.group("days"))
            days = sorted({_DAY_NAMES[d] for d in found}, key=_DAY_ORDER.index)
            if days:
                day_field, matched = ",".join(days), m.group(0).strip()
    if day_field is None:
        m = re.search(r"\b(every\s+day|daily|each\s+day|every\s+night|nightly)\b", lowered)
        if m:
            day_field, matched = "*", m.group(0)
    if day_field is None:
        return {"cron": None, "matched": None, "reason": "no_exact_recurrence"}
    if clock is None:
        return {"cron": None, "matched": matched, "reason": "time_of_day_missing"}
    hour, minute, assumed_24h = clock
    return {
        "cron": f"{minute} {hour} {dom_field} * {day_field}",
        "matched": matched,
        "reason": "exact_recurrence",
        "assumed_24h_clock": assumed_24h,
    }


def infer_task(text: str) -> Dict[str, Any]:
    """Deterministically recognise the two in-process task intents."""

    raw = " ".join(str(text or "").split())
    lowered = raw.lower()
    if re.search(r"\b(health|status)\s+(report|check|snapshot)\b|\bsystem\s+health\b", lowered):
        return {"task": HEALTH_REPORT_TASK, "args": []}
    m = re.search(r"\bremind(?:\s+me)?(?:\s+to|\s+that|\s+about)?\s+(?P<body>.+)", raw, flags=re.IGNORECASE)
    if m is None:
        m = re.search(r"\breminder\s+(?:to|about|for)\s+(?P<body>.+)", raw, flags=re.IGNORECASE)
    if m:
        body = m.group("body")
        # Remove the schedule phrase so the reminder text is just the action.
        body = re.split(
            r"\s+(?:every|each|daily|hourly|nightly|weekdays|weekends|on\s+weekdays|on\s+weekends"
            r"|on\s+the\s+\d{1,2}(?:st|nd|rd|th)?|at\s+\d{1,2}(?::\d{2})?|at\s+noon|at\s+midnight"
            r"|tomorrow|tonight|today)\b",
            " " + body,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0]
        body = body.strip(" ,.;:-")
        if body and body.lower() not in {"me", "to", "about"}:
            return {"task": REMINDER_TASK, "args": [body[:MAX_REMINDER_CHARS]]}
    return {"task": None, "args": []}


class CronProposalModel(BaseModel):
    """Strict model output for a schedule proposal."""

    model_config = ConfigDict(extra="forbid")

    schedulable: bool = Field(description="False when the request is not a recurring schedule Cortex can run")
    cron: Optional[str] = Field(default=None, max_length=120)
    timezone: Optional[str] = Field(default=None, max_length=64)
    task: Optional[Literal["cortex.reminder", "cortex.health_report"]] = None
    reminder_text: Optional[str] = Field(default=None, max_length=MAX_REMINDER_CHARS)
    one_off: bool = Field(default=False, description="True if the user asked for a single future time, not a recurrence")
    reason: str = Field(default="", max_length=400)


CRON_PROPOSAL_SYSTEM = (
    "You are the scheduling parser for Cortex level 8 (Cron). Convert the user's request into a recurring "
    "schedule proposal. Cortex can only run two scheduled task types: 'cortex.reminder' (records a reminder "
    "note in Cortex; it does NOT send messages) and 'cortex.health_report' (read-only system health snapshot). "
    "Return ONLY a JSON object with keys: schedulable (bool), cron (5-field 'minute hour day month day_of_week' "
    "string or null), timezone (IANA name or null), task ('cortex.reminder' | 'cortex.health_report' | null), "
    "reminder_text (string or null, the action to remember, without the schedule words), one_off (bool), "
    "reason (short string). Rules: use day-of-week NAMES (mon,tue,wed,thu,fri,sat,sun or ranges like mon-fri), "
    "never numbers. If the user wants something done once rather than repeatedly, set one_off=true and "
    "schedulable=false. If the requested action is neither a reminder nor a health report (for example sending "
    "a message, running code, or buying something), set schedulable=false and explain in reason. Use the "
    "timezone only if the user states one or it is given in the context; otherwise null. Do not invent times "
    "the user did not state: if the time of day is missing for a daily/weekly schedule, set schedulable=false."
)


async def propose_schedule(
    text: str,
    *,
    timezone_name: Optional[str] = None,
    principal_scope_key: str = "",
    use_model: bool = True,
    preview_fn: Optional[Callable[[str, str, int], List[str]]] = None,
    validate_timezone_fn: Optional[Callable[[str], str]] = None,
    model_fn: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    """Return a schedule PROPOSAL for ``POST /cron/schedule``; never schedules."""

    started = time.monotonic()
    request_text = " ".join(str(text or "").split())
    if not request_text:
        return {"success": False, "operation": "cron.propose", "status": "empty_request", "scheduled": False}
    if len(request_text) > 2000:
        request_text = request_text[:2000]

    tz_name = (timezone_name or "UTC").strip() or "UTC"
    if validate_timezone_fn is not None:
        tz_name = validate_timezone_fn(tz_name)

    parsed = parse_schedule_phrase(request_text)
    task = infer_task(request_text)
    origin = "deterministic"
    model_meta: Dict[str, Any] = {}
    cron_expr = parsed.get("cron")
    task_name = task.get("task")
    args = list(task.get("args") or [])
    notes: List[str] = []
    if parsed.get("assumed_24h_clock"):
        notes.append("time_without_am_pm_read_as_24h_clock")

    if not (cron_expr and task_name):
        if not use_model or not principal_scope_key:
            return {
                "success": False,
                "operation": "cron.propose",
                "status": "incomplete",
                "origin": "deterministic",
                "scheduled": False,
                "parsed": {"cron": cron_expr, "task": task_name, "args": args, "reason": parsed.get("reason")},
                "missing": [k for k, v in (("cron", cron_expr), ("task", task_name)) if not v],
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }
        if model_fn is None:
            from cortex_server.modules.level_model import level_model_json as model_fn  # type: ignore[no-redef]
        prompt = (
            f"User request: {request_text}\n"
            f"Default timezone if the user states none: {tz_name}\n"
            f"Deterministic pre-parse (may be partial): cron={cron_expr!r}, task={task_name!r}."
        )
        result = await model_fn(
            level=8,
            name="cron",
            system=CRON_PROPOSAL_SYSTEM,
            prompt=prompt,
            principal_scope_key=principal_scope_key,
            schema=CronProposalModel,
            deadline_s=45.0,
        )
        if not isinstance(result, dict) or result.get("status") != "ok":
            from cortex_server.modules.level_model import unavailable_payload

            body = unavailable_payload(result if isinstance(result, dict) else {}, operation="cron.propose")
            body.update({
                "scheduled": False,
                "parsed": {"cron": cron_expr, "task": task_name, "args": args, "reason": parsed.get("reason")},
            })
            return body
        data = result.get("data") or {}
        origin = "model"
        model_meta = {
            "model": result.get("model"),
            "receipt_id": result.get("receipt_id"),
        }
        if not data.get("schedulable") or data.get("one_off"):
            return {
                "success": True,
                "operation": "cron.propose",
                "status": "not_schedulable",
                "origin": origin,
                "scheduled": False,
                "one_off": bool(data.get("one_off")),
                "reason": str(data.get("reason") or "")[:400],
                "supported_tasks": in_process_task_catalog(),
                **model_meta,
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }
        cron_expr = cron_expr or str(data.get("cron") or "").strip() or None
        if cron_expr and origin == "model":
            try:
                normalized = normalize_classic_cron(cron_expr)
            except ValueError as exc:
                return {
                    "success": False, "operation": "cron.propose", "status": "invalid_cron", "origin": origin,
                    "error": str(exc), "scheduled": False, **model_meta,
                }
            if normalized != cron_expr:
                notes.append("numeric_day_of_week_converted_from_classic_cron")
                cron_expr = normalized
        task_name = task_name or data.get("task")
        if task_name == REMINDER_TASK and not args:
            args = [str(data.get("reminder_text") or "").strip()]
        if data.get("timezone") and not timezone_name:
            try:
                tz_name = validate_timezone_fn(str(data["timezone"])) if validate_timezone_fn else str(data["timezone"])
            except ValueError:
                notes.append("model_timezone_rejected")

    if not cron_expr or not task_name:
        return {
            "success": False,
            "operation": "cron.propose",
            "status": "incomplete",
            "origin": origin,
            "scheduled": False,
            "parsed": {"cron": cron_expr, "task": task_name, "args": args},
            **model_meta,
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        }
    try:
        args = validate_in_process_args(str(task_name), args)
    except CronTaskArgsError as exc:
        return {
            "success": False,
            "operation": "cron.propose",
            "status": "invalid_task_args",
            "origin": origin,
            "error": str(exc),
            "scheduled": False,
            **model_meta,
        }
    next_fire_times: List[str] = []
    if preview_fn is not None:
        try:
            next_fire_times = preview_fn(cron_expr, tz_name, 5)
        except ValueError as exc:
            return {
                "success": False,
                "operation": "cron.propose",
                "status": "invalid_cron",
                "origin": origin,
                "error": str(exc)[:200],
                "scheduled": False,
                "parsed": {"cron": cron_expr, "task": task_name},
                **model_meta,
            }
    slug_source = args[0] if args else cron_expr
    slug = re.sub(r"[^a-z0-9]+", "-", str(slug_source).lower()).strip("-")[:40] or "job"
    job_name = f"{'reminder' if task_name == REMINDER_TASK else 'health-report'}-{slug}"[:64]
    return {
        "success": True,
        "operation": "cron.propose",
        "status": "proposed",
        "origin": origin,
        "scheduled": False,
        "requires_confirmation": True,
        "proposal": {
            "job_name": job_name,
            "cron": cron_expr,
            "timezone": tz_name,
            "task": task_name,
            "args": args,
            "next_fire_times": next_fire_times,
        },
        "schedule_with": {
            "method": "POST",
            "path": "/cron/schedule",
            "body": {"job_name": job_name, "cron": cron_expr, "timezone": tz_name, "task": task_name, "args": args},
            "requires": "explicit user confirmation and a single-use action capability",
        },
        "notes": notes,
        **model_meta,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }


__all__ = [
    "CRON_PROPOSAL_SYSTEM",
    "CronProposalModel",
    "CronTaskArgsError",
    "HEALTH_REPORT_TASK",
    "IN_PROCESS_TASKS",
    "REMINDER_LOG_FILENAME",
    "REMINDER_TASK",
    "REPORT_LOG_FILENAME",
    "in_process_task_catalog",
    "infer_task",
    "is_in_process_task",
    "normalize_classic_cron",
    "parse_schedule_phrase",
    "propose_schedule",
    "read_log_tail",
    "run_in_process_task",
    "validate_in_process_args",
]
