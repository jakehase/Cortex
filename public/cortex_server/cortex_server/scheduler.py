from __future__ import annotations

import asyncio
import threading

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.events import EVENT_SCHEDULER_SHUTDOWN
from apscheduler.jobstores.base import JobLookupError
from apscheduler.triggers.cron import CronTrigger
from cortex_server.construction import (
    construction_config,
    read_only_construction,
    runtime_construction_active,
)

with read_only_construction(not runtime_construction_active()):
    from cortex_server.worker import (
        app as celery_app,
        task_consumes_delegated_action_capability,
    )
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    DELEGATED_ACTION_CAPABILITY_HEADER,
    assert_action_authorized,
    authorize_deferred_action,
    mint_worker_action_capability,
)

from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import hashlib
import json
import os
import tempfile
import uuid

# Initialize scheduler
scheduler = AsyncIOScheduler()
_scheduler_was_shutdown = False
_scheduler_loop = None
_scheduler_shutdown_pending = False
_scheduler_lock = threading.Lock()
_scheduler_rehydration_report: Dict[str, Any] = {
    "status": "not_started",
    "rehydrated": [],
    "error": None,
}
_JOB_SPEC_VERSION = 1
_MAX_JOB_POLICY_BYTES = 4 * 1024 * 1024

_configured_state_dir = construction_config("CORTEX_SCHEDULER_STATE_DIR")
_STATE_DIR = Path(_configured_state_dir or "/app/config/state")
_TRIGGER_LEDGER_FILENAME = "l8_cron_trigger_events.jsonl"
_NOTARY_LEDGER_FILENAME = "l8_cron_notary_packets.jsonl"
_JOB_POLICY_FILENAME = "l8_cron_job_policies.json"
_NOVELTY_STATS_FILENAME = "l8_cron_novelty_stats.json"
_TRIGGER_LEDGER_PATH = _STATE_DIR / _TRIGGER_LEDGER_FILENAME
_NOTARY_LEDGER_PATH = _STATE_DIR / _NOTARY_LEDGER_FILENAME
_JOB_POLICY_PATH = _STATE_DIR / _JOB_POLICY_FILENAME
_NOVELTY_STATS_PATH = _STATE_DIR / _NOVELTY_STATS_FILENAME
_MANAGED_STATE_DIRS = {_STATE_DIR}
_STATE_DIR_READY = False
_STATE_DIR_LOCK = threading.Lock()

_TRIGGER_LEDGER_LOCK = threading.Lock()
_NOTARY_LEDGER_LOCK = threading.Lock()
_POLICY_LOCK = threading.Lock()
_NOVELTY_LOCK = threading.Lock()


def _set_state_dir(path: Path) -> None:
    global _STATE_DIR, _TRIGGER_LEDGER_PATH, _NOTARY_LEDGER_PATH
    global _JOB_POLICY_PATH, _NOVELTY_STATS_PATH

    managed_dirs = set(_MANAGED_STATE_DIRS)
    rebind_trigger = (
        _TRIGGER_LEDGER_PATH.name == _TRIGGER_LEDGER_FILENAME
        and _TRIGGER_LEDGER_PATH.parent in managed_dirs
    )
    rebind_notary = (
        _NOTARY_LEDGER_PATH.name == _NOTARY_LEDGER_FILENAME
        and _NOTARY_LEDGER_PATH.parent in managed_dirs
    )
    rebind_policy = (
        _JOB_POLICY_PATH.name == _JOB_POLICY_FILENAME
        and _JOB_POLICY_PATH.parent in managed_dirs
    )
    rebind_novelty = (
        _NOVELTY_STATS_PATH.name == _NOVELTY_STATS_FILENAME
        and _NOVELTY_STATS_PATH.parent in managed_dirs
    )
    _STATE_DIR = path
    _MANAGED_STATE_DIRS.add(path)
    if rebind_trigger:
        _TRIGGER_LEDGER_PATH = path / _TRIGGER_LEDGER_FILENAME
    if rebind_notary:
        _NOTARY_LEDGER_PATH = path / _NOTARY_LEDGER_FILENAME
    if rebind_policy:
        _JOB_POLICY_PATH = path / _JOB_POLICY_FILENAME
    if rebind_novelty:
        _NOVELTY_STATS_PATH = path / _NOVELTY_STATS_FILENAME


def _activate_runtime_configuration() -> None:
    """Capture runtime configuration without creating persistent state."""

    global _configured_state_dir
    if _STATE_DIR_READY:
        return
    _configured_state_dir = os.getenv("CORTEX_SCHEDULER_STATE_DIR")
    _set_state_dir(Path(_configured_state_dir or "/app/config/state"))


def _ensure_state_dir() -> Path:
    """Resolve and create scheduler state only at an explicit runtime boundary."""

    global _STATE_DIR_READY
    if _STATE_DIR_READY:
        return _STATE_DIR
    with _STATE_DIR_LOCK:
        if _STATE_DIR_READY:
            return _STATE_DIR
        _activate_runtime_configuration()
        target = _STATE_DIR
        try:
            target.mkdir(parents=True, exist_ok=True)
        except OSError:
            if _configured_state_dir:
                raise
            target = Path(tempfile.gettempdir()) / "cortex-scheduler-state"
            target.mkdir(parents=True, exist_ok=True)
            _set_state_dir(target)
        _STATE_DIR_READY = True
        return _STATE_DIR


def _resolve_state_path(path: Path) -> Path:
    """Rebase module-managed paths while preserving explicit path overrides."""

    managed_filenames = {
        _TRIGGER_LEDGER_FILENAME,
        _NOTARY_LEDGER_FILENAME,
        _JOB_POLICY_FILENAME,
        _NOVELTY_STATS_FILENAME,
    }
    if path.name not in managed_filenames or path.parent not in _MANAGED_STATE_DIRS:
        return path
    return _ensure_state_dir() / path.name


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(value)))


def _safe_json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _opaque_identifier(field: str, value: Any) -> Dict[str, Any]:
    """Represent a caller-controlled identifier without retaining its value."""
    if value is None:
        return {
            field: None,
            f"{field}_sha256": None,
            f"{field}_bytes": 0,
        }
    encoded = str(value).encode("utf-8", errors="replace")
    return {
        field: "[REDACTED]",
        f"{field}_sha256": hashlib.sha256(encoded).hexdigest(),
        f"{field}_bytes": len(encoded),
    }


def _scheduler_source(value: Any) -> str:
    source = str(value or "").strip()
    return source if source in {"scheduled", "manual_api", "internal"} else "unknown"


def _parse_iso_ts(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _read_json(path: Path, default: Any) -> Any:
    path = _resolve_state_path(path)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, payload: Any) -> None:
    path = _resolve_state_path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        handle.write(_safe_json_dumps(payload))
        handle.flush()
        os.fsync(handle.fileno())
    tmp.replace(path)
    directory_fd = os.open(
        path.parent,
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
    )
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _append_jsonl(path: Path, lock: threading.Lock, event: Dict[str, Any]) -> None:
    path = _resolve_state_path(path)
    try:
        line = _safe_json_dumps(event)
    except Exception:
        line = _safe_json_dumps({"ts": _utc_now_iso(), "status": "error", "error": "event_serialize_failed"})

    with lock:
        with path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")


def _cron_parts(cron_expr: str) -> Tuple[str, str, str, str, str]:
    parts = (cron_expr or "").strip().split()
    if len(parts) != 5:
        raise ValueError("Cron expression must have 5 parts: minute hour day month day_of_week")
    return parts[0], parts[1], parts[2], parts[3], parts[4]


def _build_cron_trigger(cron_expr: str) -> CronTrigger:
    minute, hour, day, month, day_of_week = _cron_parts(cron_expr)
    return CronTrigger(
        minute=minute,
        hour=hour,
        day=day,
        month=month,
        day_of_week=day_of_week,
        timezone=timezone.utc,
    )


def _validated_job_args(args: Any, *, context: str) -> List[Any]:
    if not isinstance(args, list) or len(args) > 1024:
        raise ValueError(f"{context} has invalid args")
    try:
        encoded = json.dumps(
            args,
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{context} args must be strict JSON values") from exc
    if len(encoded) > 1_048_576:
        raise ValueError(f"{context} args are too large")
    # Persist and schedule the same canonical JSON value, so a restart cannot
    # silently change task inputs (for example, datetime -> string).
    return json.loads(encoded.decode("utf-8"))


def _estimate_runs_for_hours(cron_expr: str, window_hours: int = 24, cap: int = 50000) -> int:
    trigger = _build_cron_trigger(cron_expr)
    now = _utc_now()
    end = now + timedelta(hours=max(1, int(window_hours)))

    count = 0
    prev = None
    nxt = trigger.get_next_fire_time(prev, now)
    while nxt is not None and nxt <= end and count < cap:
        count += 1
        prev = nxt
        nxt = trigger.get_next_fire_time(prev, prev)

    return count


def _default_alt_crons(primary: str) -> List[str]:
    minute, hour, day, month, day_of_week = _cron_parts(primary)
    alternatives = [primary]

    if minute.startswith("*/"):
        try:
            base = max(1, int(minute[2:]))
            faster = max(1, base // 2)
            slower = min(60, base * 2)
            alternatives.extend([
                f"*/{faster} {hour} {day} {month} {day_of_week}",
                f"*/{slower} {hour} {day} {month} {day_of_week}",
            ])
        except Exception:
            pass
    else:
        alternatives.extend([
            f"*/15 {hour} {day} {month} {day_of_week}",
            f"0 {hour} {day} {month} {day_of_week}",
        ])

    # Add a conservative hourly fallback
    alternatives.append("0 * * * *")

    # Deduplicate while preserving order
    out: List[str] = []
    seen = set()
    for c in alternatives:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out


def simulate_cadence_twin(
    primary_cron: str,
    alternatives: Optional[List[str]] = None,
    value_score: float = 0.7,
    risk_score: float = 0.3,
    token_cost_est: int = 2000,
    estimated_runtime_s: float = 30.0,
) -> Dict[str, Any]:
    value = _clamp(value_score, 0.0, 1.0)
    risk = _clamp(risk_score, 0.0, 1.0)
    token_cost = max(0, int(token_cost_est))
    runtime_s = max(1.0, float(estimated_runtime_s))

    candidates = [c for c in (alternatives or _default_alt_crons(primary_cron)) if isinstance(c, str) and c.strip()]
    if primary_cron not in candidates:
        candidates.insert(0, primary_cron)

    scenarios: List[Dict[str, Any]] = []

    for cron_expr in candidates:
        try:
            runs_24h = _estimate_runs_for_hours(cron_expr, window_hours=24)
            runs_7d = _estimate_runs_for_hours(cron_expr, window_hours=24 * 7)
            runtime_hours_24h = round((runs_24h * runtime_s) / 3600.0, 3)
            token_24h = runs_24h * token_cost

            cadence_pressure = _clamp(runs_24h / 96.0, 0.0, 2.5)
            projected_risk = _clamp(risk + 0.28 * cadence_pressure, 0.0, 1.0)
            projected_quality = _clamp(value - 0.18 * projected_risk + 0.08 * min(1.0, runs_24h / 24.0), 0.0, 1.0)
            efficiency = _clamp(1.0 - (token_24h / 200000.0), 0.0, 1.0)

            composite = round((0.45 * projected_quality) + (0.35 * (1.0 - projected_risk)) + (0.20 * efficiency), 4)

            scenarios.append(
                {
                    "cron": cron_expr,
                    "runs_24h": runs_24h,
                    "runs_7d": runs_7d,
                    "runtime_hours_24h": runtime_hours_24h,
                    "token_est_24h": token_24h,
                    "quality_forecast": round(projected_quality, 4),
                    "risk_forecast": round(projected_risk, 4),
                    "efficiency_forecast": round(efficiency, 4),
                    "composite_score": composite,
                    "is_primary": cron_expr == primary_cron,
                }
            )
        except Exception as exc:
            scenarios.append(
                {
                    **_opaque_identifier("cron", cron_expr),
                    "error": type(exc).__name__,
                    "is_primary": cron_expr == primary_cron,
                }
            )

    scored = [s for s in scenarios if "composite_score" in s]
    scored.sort(key=lambda x: x["composite_score"], reverse=True)
    recommended = scored[0]["cron"] if scored else primary_cron

    return {
        "primary_cron": primary_cron,
        "recommended_cron": recommended,
        "scenarios": scenarios,
        "model": {
            "quality_weight": 0.45,
            "risk_weight": 0.35,
            "efficiency_weight": 0.20,
        },
    }


def _load_job_policies() -> Dict[str, Any]:
    policy_path = _resolve_state_path(_JOB_POLICY_PATH)
    if not policy_path.exists():
        return {}
    try:
        if policy_path.stat().st_size > _MAX_JOB_POLICY_BYTES:
            raise RuntimeError("persisted scheduler policy store exceeds size limit")
        data = json.loads(policy_path.read_text(encoding="utf-8"))
    except RuntimeError:
        raise
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid persisted scheduler policy store: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError("persisted scheduler policies must be a JSON object")
    return data


def _save_job_policies(data: Dict[str, Any]) -> None:
    _write_json(_JOB_POLICY_PATH, data)


def register_job_policy(job_id: str, policy: Dict[str, Any]) -> None:
    if not job_id:
        return
    with _POLICY_LOCK:
        all_policies = _load_job_policies()
        all_policies[job_id] = {
            **dict(policy or {}),
            "updated_at": _utc_now_iso(),
        }
        _save_job_policies(all_policies)


def list_job_policies() -> Dict[str, Any]:
    with _POLICY_LOCK:
        return _load_job_policies()


def get_job_policy(job_id: Optional[str]) -> Dict[str, Any]:
    if not job_id:
        return {}
    with _POLICY_LOCK:
        return dict(_load_job_policies().get(job_id) or {})


def remove_job_policy(job_id: str) -> None:
    if not job_id:
        return
    with _POLICY_LOCK:
        all_policies = _load_job_policies()
        if job_id in all_policies:
            all_policies.pop(job_id, None)
            _save_job_policies(all_policies)


def _load_novelty_stats() -> Dict[str, Any]:
    data = _read_json(_NOVELTY_STATS_PATH, default={})
    return data if isinstance(data, dict) else {}


def _save_novelty_stats(data: Dict[str, Any]) -> None:
    _write_json(_NOVELTY_STATS_PATH, data)


def _update_novelty_stats(job_id: str, mode: str, status: str) -> Dict[str, Any]:
    with _NOVELTY_LOCK:
        all_stats = _load_novelty_stats()
        bucket = all_stats.setdefault(job_id, {
            "explore_runs": 0,
            "explore_success": 0,
            "exploit_runs": 0,
            "exploit_success": 0,
            "last_mode": None,
            "last_status": None,
            "last_updated": None,
        })

        if mode == "explore":
            bucket["explore_runs"] += 1
            if status == "triggered":
                bucket["explore_success"] += 1
        elif mode == "exploit":
            bucket["exploit_runs"] += 1
            if status == "triggered":
                bucket["exploit_success"] += 1

        bucket["last_mode"] = mode
        bucket["last_status"] = status
        bucket["last_updated"] = _utc_now_iso()

        _save_novelty_stats(all_stats)
        return bucket


def get_novelty_budget_status() -> Dict[str, Any]:
    stats = _load_novelty_stats()
    policies = list_job_policies()

    enabled_jobs = []
    for job_id, policy in policies.items():
        if bool(policy.get("novelty_enabled")):
            row = {
                "job_id": job_id,
                "job_name": policy.get("job_name"),
                "novelty_budget_fraction": float(policy.get("novelty_budget_fraction", 0.12)),
                "promote_threshold": float(policy.get("novelty_promote_threshold", 0.06)),
            }
            row.update(stats.get(job_id, {}))
            enabled_jobs.append(row)

    return {
        "enabled_job_count": len(enabled_jobs),
        "jobs": enabled_jobs,
        "stats_version": "l8.novelty_budget.v1",
    }


def _decide_novelty_mode(job_id: str, policy: Dict[str, Any]) -> Dict[str, Any]:
    if not bool(policy.get("novelty_enabled")):
        return {
            "enabled": False,
            "mode": "disabled",
            "budget_fraction": 0.0,
            "sample": None,
        }

    fraction = _clamp(float(policy.get("novelty_budget_fraction", 0.12)), 0.02, 0.35)
    seed = f"{job_id}|{_utc_now().strftime('%Y-%m-%dT%H:%M')}"
    sample = int(_sha256_hex(seed)[:8], 16) / float(16 ** 8)
    mode = "explore" if sample < fraction else "exploit"

    return {
        "enabled": True,
        "mode": mode,
        "budget_fraction": round(fraction, 4),
        "sample": round(sample, 6),
    }


def evaluate_voi_gate(policy: Dict[str, Any]) -> Dict[str, Any]:
    if not bool(policy.get("voi_enabled", True)):
        return {
            "enabled": False,
            "allowed": True,
            "voi_score": None,
            "threshold": None,
            "reason": "voi_disabled",
        }

    value = _clamp(float(policy.get("value_score", 0.7)), 0.0, 1.0)
    urgency = _clamp(float(policy.get("urgency_score", 0.5)), 0.0, 1.0)
    risk = _clamp(float(policy.get("risk_score", 0.3)), 0.0, 1.0)
    cost = _clamp(float(policy.get("cost_score", 0.25)), 0.0, 1.0)
    threshold = _clamp(float(policy.get("voi_threshold", 0.35)), 0.0, 1.0)

    voi_score = round((0.48 * value) + (0.22 * urgency) - (0.18 * risk) - (0.12 * cost), 4)
    allowed = voi_score >= threshold

    return {
        "enabled": True,
        "allowed": allowed,
        "voi_score": voi_score,
        "threshold": threshold,
        "reason": "pass" if allowed else "below_threshold",
    }


def evaluate_verifier_escrow(
    task_name: str,
    task_args: List[Any],
    task_kwargs: Dict[str, Any],
    policy: Dict[str, Any],
) -> Dict[str, Any]:
    if not bool(policy.get("require_verifier", False)):
        return {
            "enabled": False,
            "allowed": True,
            "mode": "disabled",
            "checks": [],
            "reason": "verifier_disabled",
        }

    mode = str(policy.get("preflight_mode", "task_exists") or "task_exists").strip().lower()
    checks = []

    task_exists = task_name in celery_app.tasks
    checks.append({"check": "task_exists", "pass": task_exists})

    if mode == "payload_nonempty":
        nonempty = bool(task_args) or bool(task_kwargs)
        checks.append({"check": "payload_nonempty", "pass": nonempty})
    elif mode == "safe_payload":
        arg_max = max(1, int(policy.get("payload_arg_max", 8)))
        kwargs_max = max(1, int(policy.get("payload_kwarg_max", 8)))
        checks.append({"check": "args_under_limit", "pass": len(task_args) <= arg_max, "limit": arg_max})
        checks.append({"check": "kwargs_under_limit", "pass": len(task_kwargs) <= kwargs_max, "limit": kwargs_max})
    else:
        # default task_exists only
        pass

    allowed = all(c.get("pass") is True for c in checks)
    failed = [c.get("check") for c in checks if not c.get("pass")]

    return {
        "enabled": True,
        "allowed": allowed,
        "mode": mode,
        "checks": checks,
        "reason": "pass" if allowed else "failed:" + ",".join(failed),
    }


def build_topology_plan(policies: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    source = policies or list_job_policies()

    grouped: Dict[str, List[Tuple[str, Dict[str, Any]]]] = defaultdict(list)
    for job_id, policy in source.items():
        group = str(policy.get("dependency_group") or "default")
        grouped[group].append((job_id, policy))

    groups_out: List[Dict[str, Any]] = []
    for group, rows in grouped.items():
        dep_vals = [_clamp(float((p or {}).get("dependency_density", 0.3)), 0.0, 1.0) for _, p in rows]
        dis_vals = [_clamp(float((p or {}).get("disagreement_density", 0.2)), 0.0, 1.0) for _, p in rows]
        dep = sum(dep_vals) / max(1, len(dep_vals))
        dis = sum(dis_vals) / max(1, len(dis_vals))

        if dep >= 0.6:
            topology = "tree"
        elif dis >= 0.5 and dep <= 0.55:
            topology = "mesh"
        else:
            topology = "star"

        nodes = [job_id for job_id, _ in rows]
        edges: List[Dict[str, str]] = []

        if len(nodes) >= 2:
            if topology == "star":
                center = nodes[0]
                edges = [{"from": center, "to": n} for n in nodes[1:]]
            elif topology == "tree":
                for i in range(1, len(nodes)):
                    parent = nodes[(i - 1) // 2]
                    edges.append({"from": parent, "to": nodes[i]})
            else:  # mesh ring+skip links
                for i in range(len(nodes)):
                    edges.append({"from": nodes[i], "to": nodes[(i + 1) % len(nodes)]})
                    if len(nodes) > 3:
                        edges.append({"from": nodes[i], "to": nodes[(i + 2) % len(nodes)]})

        groups_out.append(
            {
                "group": group,
                "topology": topology,
                "dependency_density": round(dep, 4),
                "disagreement_density": round(dis, 4),
                "nodes": nodes,
                "edges": edges,
            }
        )

    return {
        "group_count": len(groups_out),
        "groups": groups_out,
        "topology_version": "l8.topology.v1",
    }


def _build_notary_packet(
    *,
    task: str,
    args: List[Any],
    kwargs: Dict[str, Any],
    source: str,
    job_id: Optional[str],
    job_name: Optional[str],
    status: str,
    latency_ms: int,
    task_id: Optional[str] = None,
    error: Optional[str] = None,
    voi: Optional[Dict[str, Any]] = None,
    escrow: Optional[Dict[str, Any]] = None,
    novelty: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    ts = _utc_now_iso()
    notary_input = {
        "task": task,
        "args": args,
        "kwargs": kwargs,
        "source": source,
        "job_id": job_id,
        "job_name": job_name,
        "status": status,
        "task_id": task_id,
    }
    input_hash = _sha256_hex(_safe_json_dumps(notary_input))

    packet = {
        "packet_id": f"notary-{uuid.uuid4().hex[:12]}",
        "ts": ts,
        "level": 8,
        **_opaque_identifier("task", task),
        "source": _scheduler_source(source),
        **_opaque_identifier("job_id", job_id),
        **_opaque_identifier("job_name", job_name),
        "status": status,
        **_opaque_identifier("task_id", task_id),
        **_opaque_identifier("error", error),
        "latency_ms": max(0, int(latency_ms)),
        "input_hash": input_hash,
        "evidence": [
            "cron_trigger_ledger",
            "cron_notary_ledger",
        ],
        "voi": voi,
        "escrow": escrow,
        "novelty": novelty,
        "notary_version": "l8.notary.v1",
    }

    signature_raw = _safe_json_dumps(
        {
            key: packet.get(key)
            for key in [
                "packet_id",
                "ts",
                "task_sha256",
                "source",
                "job_id_sha256",
                "status",
                "task_id_sha256",
                "input_hash",
                "latency_ms",
            ]
        }
    )
    packet["signature"] = _sha256_hex(signature_raw)
    return packet


def get_notary_packets(hours: int = 24, limit: int = 100) -> List[Dict[str, Any]]:
    ledger_path = _resolve_state_path(_NOTARY_LEDGER_PATH)
    if not ledger_path.exists():
        return []

    h = max(1, min(int(hours), 24 * 30))
    cap = max(1, min(int(limit), 1000))
    cutoff = _utc_now() - timedelta(hours=h)

    out: deque = deque(maxlen=cap)
    with ledger_path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            dt = _parse_iso_ts(row.get("ts"))
            if dt is None or dt < cutoff:
                continue
            out.append(row)

    return list(out)


def trigger_celery_task(
    task_name: str,
    args: list = None,
    kwargs: dict = None,
    source: str = "unknown",
    job_id: Optional[str] = None,
    job_name: Optional[str] = None,
    policy_override: Optional[Dict[str, Any]] = None,
    submission_id: Optional[str] = None,
    action_authorization: Optional[ActionAuthorization] = None,
):
    """Send task to Celery and return async_result id.

    Includes L8 novelty controls:
    - VOI trigger gate
    - Verifier escrow preflight
    - Novelty budget explore/exploit mode
    - Trigger event + notary packet persistence
    """
    if args is None:
        args = []
    if kwargs is None:
        kwargs = {}

    started = _utc_now()

    policy = dict(policy_override or {})
    if not policy and job_id:
        policy = get_job_policy(job_id)

    base_event = {
        "ts": _utc_now_iso(),
        **_opaque_identifier("task", task_name),
        "source": _scheduler_source(source),
        **_opaque_identifier("job_id", job_id),
        **_opaque_identifier("job_name", job_name),
        "args_count": len(args),
        "kwargs_count": len(kwargs),
    }

    apply_policy = bool(policy) and source in {"scheduled", "manual_api"}

    voi = evaluate_voi_gate(policy) if apply_policy else {
        "enabled": False,
        "allowed": True,
        "voi_score": None,
        "threshold": None,
        "reason": "policy_not_applied",
    }

    if apply_policy and not voi.get("allowed", True):
        latency_ms = int((_utc_now() - started).total_seconds() * 1000)
        event = {
            **base_event,
            "status": "skipped_voi",
            "voi": voi,
        }
        _append_jsonl(_TRIGGER_LEDGER_PATH, _TRIGGER_LEDGER_LOCK, event)
        packet = _build_notary_packet(
            task=task_name,
            args=args,
            kwargs=kwargs,
            source=source,
            job_id=job_id,
            job_name=job_name,
            status="skipped_voi",
            latency_ms=latency_ms,
            voi=voi,
        )
        _append_jsonl(_NOTARY_LEDGER_PATH, _NOTARY_LEDGER_LOCK, packet)
        return None

    escrow = evaluate_verifier_escrow(task_name, args, kwargs, policy) if apply_policy else {
        "enabled": False,
        "allowed": True,
        "mode": "disabled",
        "checks": [],
        "reason": "policy_not_applied",
    }

    if apply_policy and not escrow.get("allowed", True):
        latency_ms = int((_utc_now() - started).total_seconds() * 1000)
        event = {
            **base_event,
            "status": "held_escrow",
            "voi": voi,
            "escrow": escrow,
        }
        _append_jsonl(_TRIGGER_LEDGER_PATH, _TRIGGER_LEDGER_LOCK, event)
        packet = _build_notary_packet(
            task=task_name,
            args=args,
            kwargs=kwargs,
            source=source,
            job_id=job_id,
            job_name=job_name,
            status="held_escrow",
            latency_ms=latency_ms,
            voi=voi,
            escrow=escrow,
        )
        _append_jsonl(_NOTARY_LEDGER_PATH, _NOTARY_LEDGER_LOCK, packet)
        return None

    novelty = _decide_novelty_mode(job_id or "manual", policy) if apply_policy else {
        "enabled": False,
        "mode": "disabled",
        "budget_fraction": 0.0,
        "sample": None,
    }

    scheduled = source == "scheduled"
    sink_authorization: Optional[ActionAuthorization]
    if scheduled:
        sink_authorization = None
    else:
        # A caller-chosen source or policy object never creates authority.
        assert_action_authorized(action_authorization)
        sink_authorization = action_authorization

    worker_hold_reason = None
    if kwargs:
        worker_hold_reason = "worker_capability_does_not_bind_keyword_arguments"
    elif not task_consumes_delegated_action_capability(
        task_name,
        celery=celery_app,
    ):
        worker_hold_reason = "worker_does_not_consume_delegated_capability"
    if worker_hold_reason is not None:
        latency_ms = int((_utc_now() - started).total_seconds() * 1000)
        event = {
            **base_event,
            "status": "held_worker_action_authorization",
            "authorization_reason": worker_hold_reason,
            "latency_ms": latency_ms,
        }
        _append_jsonl(_TRIGGER_LEDGER_PATH, _TRIGGER_LEDGER_LOCK, event)
        packet = _build_notary_packet(
            task=task_name,
            args=args,
            kwargs=kwargs,
            source=source,
            job_id=job_id,
            job_name=job_name,
            status="held_worker_action_authorization",
            latency_ms=latency_ms,
            voi=voi,
            escrow=escrow,
            novelty=novelty,
        )
        _append_jsonl(_NOTARY_LEDGER_PATH, _NOTARY_LEDGER_LOCK, packet)
        return None

    if scheduled:
        delegated_action = policy.get("action_capability")
        sink_authorization = authorize_deferred_action(
            delegated_action if isinstance(delegated_action, dict) else {},
            task=task_name,
            args=args,
        )
        if sink_authorization is None:
            latency_ms = int((_utc_now() - started).total_seconds() * 1000)
            event = {
                **base_event,
                "status": "held_action_authorization",
                "authorization_reason": "delegated_capability_denied",
                "latency_ms": latency_ms,
            }
            _append_jsonl(_TRIGGER_LEDGER_PATH, _TRIGGER_LEDGER_LOCK, event)
            packet = _build_notary_packet(
                task=task_name,
                args=args,
                kwargs=kwargs,
                source=source,
                job_id=job_id,
                job_name=job_name,
                status="held_action_authorization",
                latency_ms=latency_ms,
            )
            _append_jsonl(_NOTARY_LEDGER_PATH, _NOTARY_LEDGER_LOCK, packet)
            return None

    try:
        worker_capability = mint_worker_action_capability(
            sink_authorization,  # type: ignore[arg-type]
            task=task_name,
            args=args,
        )
    except ValueError:
        if not scheduled:
            raise
        latency_ms = int((_utc_now() - started).total_seconds() * 1000)
        event = {
            **base_event,
            "status": "held_worker_action_authorization",
            "authorization_reason": "worker_capability_runtime_unavailable",
            "latency_ms": latency_ms,
        }
        _append_jsonl(_TRIGGER_LEDGER_PATH, _TRIGGER_LEDGER_LOCK, event)
        packet = _build_notary_packet(
            task=task_name,
            args=args,
            kwargs=kwargs,
            source=source,
            job_id=job_id,
            job_name=job_name,
            status="held_worker_action_authorization",
            latency_ms=latency_ms,
            voi=voi,
            escrow=escrow,
            novelty=novelty,
        )
        _append_jsonl(_NOTARY_LEDGER_PATH, _NOTARY_LEDGER_LOCK, packet)
        return None

    try:
        async_result = celery_app.send_task(
            task_name,
            args=args,
            kwargs=kwargs,
            headers={
                DELEGATED_ACTION_CAPABILITY_HEADER: worker_capability,
            },
            **({"task_id": submission_id} if submission_id else {}),
        )
        task_id = str(getattr(async_result, "id", "") or submission_id or "")
        if not task_id:
            raise RuntimeError("Celery submission returned no task identifier")
        latency_ms = int((_utc_now() - started).total_seconds() * 1000)
        event = {
            **base_event,
            "status": "triggered",
            **_opaque_identifier("task_id", task_id),
            "voi": voi,
            "escrow": escrow,
            "novelty": novelty,
            "latency_ms": latency_ms,
        }
        _append_jsonl(_TRIGGER_LEDGER_PATH, _TRIGGER_LEDGER_LOCK, event)

        if apply_policy and novelty.get("enabled") and job_id:
            _update_novelty_stats(job_id, novelty.get("mode", "exploit"), "triggered")

        packet = _build_notary_packet(
            task=task_name,
            args=args,
            kwargs=kwargs,
            source=source,
            job_id=job_id,
            job_name=job_name,
            status="triggered",
            latency_ms=latency_ms,
            task_id=task_id,
            voi=voi,
            escrow=escrow,
            novelty=novelty,
        )
        _append_jsonl(_NOTARY_LEDGER_PATH, _NOTARY_LEDGER_LOCK, packet)
        return task_id
    except Exception as exc:
        latency_ms = int((_utc_now() - started).total_seconds() * 1000)
        event = {
            **base_event,
            "status": "error",
            **_opaque_identifier("error", str(exc)),
            "voi": voi,
            "escrow": escrow,
            "novelty": novelty,
            "latency_ms": latency_ms,
        }
        _append_jsonl(_TRIGGER_LEDGER_PATH, _TRIGGER_LEDGER_LOCK, event)
        if apply_policy and novelty.get("enabled") and job_id:
            _update_novelty_stats(job_id, novelty.get("mode", "exploit"), "error")
        packet = _build_notary_packet(
            task=task_name,
            args=args,
            kwargs=kwargs,
            source=source,
            job_id=job_id,
            job_name=job_name,
            status="error",
            latency_ms=latency_ms,
            error=str(exc),
            voi=voi,
            escrow=escrow,
            novelty=novelty,
        )
        _append_jsonl(_NOTARY_LEDGER_PATH, _NOTARY_LEDGER_LOCK, packet)
        raise


def add_cron_job(job_name: str, task: str, cron: str, args: list = None, policy: Optional[Dict[str, Any]] = None):
    """
    Add a cron job to trigger a Celery task.
    cron format: minute hour day month day_of_week
    """
    if args is None:
        args = []
    if not isinstance(job_name, str) or not job_name or len(job_name) > 128:
        raise ValueError("job_name must contain 1 to 128 characters")
    if task not in celery_app.tasks:
        raise ValueError(f"Unknown task: {task}")
    args = _validated_job_args(args, context=f"cron job {job_name!r}")

    minute, hour, day, month, day_of_week = _cron_parts(cron)

    policy_row = dict(policy or {})
    policy_row["job_name"] = job_name
    policy_row["task"] = task
    policy_row["cron"] = cron
    policy_row["spec_version"] = _JOB_SPEC_VERSION
    policy_row["args"] = list(args)

    # Persist before touching the live scheduler. A failed durable write must
    # never leave a volatile job (or replacement) that restart recovery cannot
    # reproduce. If the scheduler rejects the already-persisted row, restore
    # the previous durable policy before surfacing the failure.
    with _POLICY_LOCK:
        all_policies = _load_job_policies()
        previous_policy = all_policies.get(job_name)
        all_policies[job_name] = {
            **policy_row,
            "updated_at": _utc_now_iso(),
        }
        _save_job_policies(all_policies)
        try:
            job = scheduler.add_job(
                trigger_celery_task,
                trigger="cron",
                id=job_name,
                name=job_name,
                args=[task, args, {}],
                kwargs={
                    "source": "scheduled",
                    "job_id": job_name,
                    "job_name": job_name,
                },
                minute=minute,
                hour=hour,
                day=day,
                month=month,
                day_of_week=day_of_week,
                replace_existing=True,
            )
        except BaseException:
            if previous_policy is None:
                all_policies.pop(job_name, None)
            else:
                all_policies[job_name] = previous_policy
            _save_job_policies(all_policies)
            raise

    return job.id


def _validated_rehydration_rows() -> List[Dict[str, Any]]:
    """Load and validate every persisted job before mutating the scheduler."""
    policy_path = _resolve_state_path(_JOB_POLICY_PATH)
    if not policy_path.exists():
        return []
    try:
        if policy_path.stat().st_size > _MAX_JOB_POLICY_BYTES:
            raise RuntimeError("persisted scheduler policy store exceeds size limit")
        raw = json.loads(policy_path.read_text(encoding="utf-8"))
    except RuntimeError:
        raise
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid persisted scheduler policy store: {exc}") from exc
    if not isinstance(raw, dict):
        raise RuntimeError("persisted scheduler policies must be a JSON object")

    validated: List[Dict[str, Any]] = []
    for job_id, policy in sorted(raw.items()):
        if not isinstance(job_id, str) or not job_id or len(job_id) > 128:
            raise RuntimeError("persisted scheduler job id is invalid")
        if not isinstance(policy, dict):
            raise RuntimeError(f"persisted scheduler policy {job_id!r} must be an object")
        job_name = policy.get("job_name")
        task = policy.get("task")
        cron = policy.get("cron")
        if "spec_version" not in policy:
            raise RuntimeError(
                f"persisted scheduler policy {job_id!r} is a legacy row missing spec_version"
            )
        if policy.get("spec_version") != _JOB_SPEC_VERSION:
            raise RuntimeError(
                f"persisted scheduler policy {job_id!r} has unsupported spec_version"
            )
        if "args" not in policy:
            raise RuntimeError(
                f"persisted scheduler policy {job_id!r} is missing explicit args"
            )
        args = policy["args"]
        if job_name != job_id:
            raise RuntimeError(
                f"persisted scheduler policy {job_id!r} has mismatched job_name"
            )
        if not isinstance(task, str) or task not in celery_app.tasks:
            raise RuntimeError(
                f"persisted scheduler policy {job_id!r} references an unknown task"
            )
        if not isinstance(cron, str):
            raise RuntimeError(f"persisted scheduler policy {job_id!r} has invalid cron")
        minute, hour, day, month, day_of_week = _cron_parts(cron)
        # CronTrigger performs semantic range/expression validation.
        _build_cron_trigger(cron)
        try:
            args = _validated_job_args(
                args,
                context=f"persisted scheduler policy {job_id!r}",
            )
        except ValueError as exc:
            raise RuntimeError(
                str(exc)
            ) from exc
        validated.append(
            {
                "job_id": job_id,
                "job_name": job_name,
                "task": task,
                "args": args,
                "minute": minute,
                "hour": hour,
                "day": day,
                "month": month,
                "day_of_week": day_of_week,
            }
        )
    return validated


def _rehydrate_scheduler_jobs() -> Dict[str, Any]:
    rows = _validated_rehydration_rows()
    for row in rows:
        scheduler.add_job(
            trigger_celery_task,
            trigger="cron",
            id=row["job_id"],
            name=row["job_name"],
            args=[row["task"], row["args"], {}],
            kwargs={
                "source": "scheduled",
                "job_id": row["job_id"],
                "job_name": row["job_name"],
            },
            minute=row["minute"],
            hour=row["hour"],
            day=row["day"],
            month=row["month"],
            day_of_week=row["day_of_week"],
            replace_existing=True,
        )
    return {
        "status": "ready",
        "rehydrated": [row["job_id"] for row in rows],
        "error": None,
    }


def _scheduler_rehydration_error(exc: BaseException) -> str:
    """Return bounded structural failure telemetry without persisted values."""

    message = str(exc)
    safe_reasons = (
        "policy store exceeds size limit",
        "invalid persisted scheduler policy store",
        "policies must be a JSON object",
        "job id is invalid",
        "policy row must be an object",
        "legacy row missing spec_version",
        "unsupported spec_version",
        "missing explicit args",
        "mismatched job_name",
        "references an unknown task",
        "invalid cron",
    )
    reason = next(
        (candidate for candidate in safe_reasons if candidate in message),
        "scheduler rehydration failed",
    )
    failure_type = type(exc).__name__
    if not failure_type.isidentifier():
        failure_type = "Exception"
    return f"{failure_type[:64]}: {reason}"


def start_scheduler():
    """Start the scheduler in background (non-blocking for FastAPI)."""
    global scheduler, _scheduler_was_shutdown, _scheduler_loop, _scheduler_rehydration_report
    _ensure_state_dir()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    with _scheduler_lock:
        if _scheduler_shutdown_pending:
            raise RuntimeError("scheduler shutdown is still in progress")
        if scheduler.running and _scheduler_loop is not loop:
            raise RuntimeError("scheduler is already owned by another event loop")
        if _scheduler_was_shutdown:
            scheduler = AsyncIOScheduler(**({"event_loop": loop} if loop is not None else {}))
            _scheduler_was_shutdown = False
        if not scheduler.running:
            try:
                _scheduler_rehydration_report = _rehydrate_scheduler_jobs()
                scheduler.start()
            except Exception as exc:
                _scheduler_rehydration_report = {
                    "status": "failed",
                    "rehydrated": [],
                    "error": _scheduler_rehydration_error(exc),
                }
                raise
        _scheduler_loop = loop


def get_scheduler_rehydration_status() -> Dict[str, Any]:
    """Expose restart recovery truth without leaking mutable internal state."""
    with _scheduler_lock:
        return {
            "status": _scheduler_rehydration_report.get("status", "not_started"),
            "rehydrated": list(_scheduler_rehydration_report.get("rehydrated") or []),
            "error": _scheduler_rehydration_report.get("error"),
            "scheduler_running": bool(scheduler.running),
            "job_spec_version": _JOB_SPEC_VERSION,
        }


async def stop_scheduler() -> None:
    """Stop APScheduler and wait for shutdown on its owning event loop."""
    global _scheduler_was_shutdown, _scheduler_loop, _scheduler_shutdown_pending
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    with _scheduler_lock:
        if scheduler.running and _scheduler_loop is not loop:
            raise RuntimeError("cannot stop scheduler owned by another event loop")
        if not scheduler.running:
            _scheduler_loop = None
            return
        _scheduler_shutdown_pending = True
        stopping_scheduler = scheduler
        shutdown_complete = loop.create_future()

        def mark_shutdown_complete(_event):
            if not shutdown_complete.done():
                shutdown_complete.set_result(None)

        stopping_scheduler.add_listener(mark_shutdown_complete, EVENT_SCHEDULER_SHUTDOWN)
        try:
            stopping_scheduler.shutdown(wait=True)
        except BaseException:
            stopping_scheduler.remove_listener(mark_shutdown_complete)
            _scheduler_shutdown_pending = False
            raise

    # AsyncIOScheduler.shutdown() queues its implementation with
    # call_soon_threadsafe(), even when invoked from the owning loop. The event
    # is dispatched only after executor and job-store shutdown has completed.
    cancelled = None
    try:
        await asyncio.shield(shutdown_complete)
    except asyncio.CancelledError as exc:
        cancelled = exc
        await asyncio.shield(shutdown_complete)
    finally:
        stopping_scheduler.remove_listener(mark_shutdown_complete)

    with _scheduler_lock:
        if stopping_scheduler.running:
            raise RuntimeError("scheduler shutdown did not complete")
        _scheduler_was_shutdown = True
        _scheduler_loop = None
        _scheduler_shutdown_pending = False

    if cancelled is not None:
        raise cancelled


def get_scheduled_jobs():
    """Return list of scheduled jobs."""
    return scheduler.get_jobs()


def remove_job(job_id: str) -> bool:
    """Remove a scheduled job by id. Returns False if missing."""
    # Delete the restart authority first. A failed durable write must leave the
    # live job untouched; otherwise it would silently reappear after restart.
    with _POLICY_LOCK:
        all_policies = _load_job_policies()
        previous_policy = all_policies.pop(job_id, None)
        if previous_policy is not None:
            _save_job_policies(all_policies)
        try:
            scheduler.remove_job(job_id)
            return True
        except JobLookupError:
            # A persisted-only row is still a real scheduled policy. Removing
            # it is a successful delete even if this process had not rehydrated
            # the corresponding live job.
            return previous_policy is not None
        except BaseException:
            if previous_policy is not None:
                all_policies[job_id] = previous_policy
                _save_job_policies(all_policies)
            raise


def get_trigger_events(hours: Optional[int] = 24, limit: int = 500) -> List[Dict[str, Any]]:
    ledger_path = _resolve_state_path(_TRIGGER_LEDGER_PATH)
    if not ledger_path.exists():
        return []

    cap = max(1, min(int(limit), 5000))
    q = deque(maxlen=cap)
    cutoff: Optional[datetime] = None
    if hours is not None:
        cutoff = _utc_now() - timedelta(hours=max(1, int(hours)))

    with ledger_path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except Exception:
                continue

            if cutoff is not None:
                dt = _parse_iso_ts(event.get("ts"))
                if dt is None or dt < cutoff:
                    continue

            q.append(event)

    return list(q)


def get_trigger_stats(hours: Optional[int] = 24) -> Dict[str, Any]:
    events = get_trigger_events(hours=hours, limit=5000)

    triggered = [e for e in events if e.get("status") == "triggered"]
    errors = [e for e in events if e.get("status") == "error"]
    skipped_voi = [e for e in events if e.get("status") == "skipped_voi"]
    held_escrow = [e for e in events if e.get("status") == "held_escrow"]

    source_counts = Counter((e.get("source") or "unknown") for e in triggered)
    task_counts = Counter((e.get("task_sha256") or "unknown") for e in triggered)

    last_trigger_at = None
    if triggered:
        triggered_sorted = sorted(triggered, key=lambda e: e.get("ts") or "")
        last_trigger_at = triggered_sorted[-1].get("ts")

    return {
        "window_hours": hours,
        "trigger_count": len(triggered),
        "error_count": len(errors),
        "skipped_voi_count": len(skipped_voi),
        "held_escrow_count": len(held_escrow),
        "by_source": dict(source_counts),
        "top_tasks": [
            {"task_sha256": task_digest, "count": count}
            for task_digest, count in task_counts.most_common(10)
        ],
        "last_trigger_at": last_trigger_at,
    }


def get_trigger_totals() -> Dict[str, Any]:
    ledger_path = _resolve_state_path(_TRIGGER_LEDGER_PATH)
    if not ledger_path.exists():
        return {
            "total_events": 0,
            "total_triggered": 0,
            "total_errors": 0,
            "total_skipped_voi": 0,
            "total_held_escrow": 0,
            "last_trigger_at": None,
        }

    total_events = 0
    total_triggered = 0
    total_errors = 0
    total_skipped_voi = 0
    total_held_escrow = 0
    last_trigger_at = None

    with ledger_path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except Exception:
                continue

            total_events += 1
            status = event.get("status")

            if status == "triggered":
                total_triggered += 1
                ts = event.get("ts")
                if isinstance(ts, str):
                    if last_trigger_at is None or ts > last_trigger_at:
                        last_trigger_at = ts
            elif status == "error":
                total_errors += 1
            elif status == "skipped_voi":
                total_skipped_voi += 1
            elif status == "held_escrow":
                total_held_escrow += 1

    return {
        "total_events": total_events,
        "total_triggered": total_triggered,
        "total_errors": total_errors,
        "total_skipped_voi": total_skipped_voi,
        "total_held_escrow": total_held_escrow,
        "last_trigger_at": last_trigger_at,
    }
