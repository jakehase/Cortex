from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


DEFAULT_STATE_PATH = Path(os.getenv("ROUTE_HEALTH_STATE_PATH", "/opt/clawdbot/state/route_health.json"))
DEFAULT_BREAKER_THRESHOLD = 3
DEFAULT_BREAKER_COOLDOWN_SECONDS = 60.0
DEFAULT_HALF_OPEN_MAX_PROBES = 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RouteHealthMonitor:
    """Shared dependency health + breaker state for Cortex routes.

    Keeps policy out of routers so route health is consistent across the app.
    """

    def __init__(
        self,
        *,
        state_path: Optional[Path] = None,
        failure_threshold: int = DEFAULT_BREAKER_THRESHOLD,
        cooldown_seconds: float = DEFAULT_BREAKER_COOLDOWN_SECONDS,
        half_open_max_probes: int = DEFAULT_HALF_OPEN_MAX_PROBES,
    ) -> None:
        self.state_path = state_path or DEFAULT_STATE_PATH
        self.failure_threshold = max(1, int(failure_threshold))
        self.cooldown_seconds = max(1.0, float(cooldown_seconds))
        self.half_open_max_probes = max(1, int(half_open_max_probes))
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state = self._load_state()

    def _load_state(self) -> Dict[str, Any]:
        if self.state_path.exists():
            try:
                data = json.loads(self.state_path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    data.setdefault("version", "route_health.v1")
                    data.setdefault("dependencies", {})
                    return data
            except Exception:
                pass
        return {"version": "route_health.v1", "dependencies": {}}

    def _persist(self) -> None:
        self.state_path.write_text(json.dumps(self.state, ensure_ascii=False, indent=2), encoding="utf-8")

    def _row(self, dependency: str) -> Dict[str, Any]:
        deps = self.state.setdefault("dependencies", {})
        row = deps.setdefault(
            str(dependency),
            {
                "state": "closed",
                "successes": 0,
                "failures": 0,
                "consecutive_failures": 0,
                "consecutive_successes": 0,
                "half_open_probes": 0,
                "breaker_open_until": 0.0,
                "last_error": None,
                "last_failure_at": None,
                "last_success_at": None,
                "last_latency_ms": None,
                "latency_ema_ms": 0.0,
                "updated_at": _now_iso(),
            },
        )
        return row

    def _refresh_state(self, dependency: str) -> Dict[str, Any]:
        row = self._row(dependency)
        now = time.time()
        if row.get("state") == "open" and float(row.get("breaker_open_until", 0.0)) <= now:
            row["state"] = "half_open"
            row["half_open_probes"] = 0
            row["updated_at"] = _now_iso()
            self._persist()
        return row

    def allow(self, dependency: str) -> Dict[str, Any]:
        row = self._refresh_state(dependency)
        now = time.time()
        if row.get("state") == "open":
            remaining = max(0.0, float(row.get("breaker_open_until", 0.0)) - now)
            return {
                "allowed": False,
                "state": "open",
                "reason": "breaker_open",
                "seconds_remaining": int(remaining),
            }
        if row.get("state") == "half_open":
            probes = int(row.get("half_open_probes", 0))
            if probes >= self.half_open_max_probes:
                remaining = max(0.0, float(row.get("breaker_open_until", 0.0)) - now)
                return {
                    "allowed": False,
                    "state": "half_open",
                    "reason": "half_open_probe_limit",
                    "seconds_remaining": int(remaining),
                }
            row["half_open_probes"] = probes + 1
            row["updated_at"] = _now_iso()
            self._persist()
            return {"allowed": True, "state": "half_open", "reason": "probe"}
        return {"allowed": True, "state": str(row.get("state", "closed")), "reason": "healthy"}

    def record_success(self, dependency: str, *, latency_ms: Optional[float] = None) -> Dict[str, Any]:
        row = self._refresh_state(dependency)
        row["successes"] = int(row.get("successes", 0)) + 1
        row["consecutive_successes"] = int(row.get("consecutive_successes", 0)) + 1
        row["consecutive_failures"] = 0
        row["last_error"] = None
        row["last_success_at"] = _now_iso()
        if latency_ms is not None:
            row["last_latency_ms"] = round(float(latency_ms), 2)
            prev = float(row.get("latency_ema_ms", 0.0) or 0.0)
            row["latency_ema_ms"] = round((0.7 * prev) + (0.3 * float(latency_ms)) if prev else float(latency_ms), 2)
        if row.get("state") in {"open", "half_open"}:
            row["state"] = "closed"
            row["half_open_probes"] = 0
            row["breaker_open_until"] = 0.0
        row["updated_at"] = _now_iso()
        self._persist()
        return self.snapshot(dependency)

    def record_failure(self, dependency: str, *, error: str = "", latency_ms: Optional[float] = None) -> Dict[str, Any]:
        row = self._refresh_state(dependency)
        row["failures"] = int(row.get("failures", 0)) + 1
        row["consecutive_failures"] = int(row.get("consecutive_failures", 0)) + 1
        row["consecutive_successes"] = 0
        row["last_error"] = str(error or "failure")[:240]
        row["last_failure_at"] = _now_iso()
        if latency_ms is not None:
            row["last_latency_ms"] = round(float(latency_ms), 2)
            prev = float(row.get("latency_ema_ms", 0.0) or 0.0)
            row["latency_ema_ms"] = round((0.7 * prev) + (0.3 * float(latency_ms)) if prev else float(latency_ms), 2)
        if int(row.get("consecutive_failures", 0)) >= self.failure_threshold:
            row["state"] = "open"
            row["breaker_open_until"] = time.time() + self.cooldown_seconds
            row["half_open_probes"] = 0
        row["updated_at"] = _now_iso()
        self._persist()
        return self.snapshot(dependency)

    def snapshot(self, dependency: Optional[str] = None) -> Dict[str, Any]:
        if dependency is not None:
            row = dict(self._refresh_state(dependency))
            now = time.time()
            row["seconds_remaining"] = max(0, int(float(row.get("breaker_open_until", 0.0)) - now))
            row["healthy"] = row.get("state") == "closed"
            return row
        deps = {}
        for dep in list((self.state.get("dependencies") or {}).keys()):
            deps[dep] = self.snapshot(dep)
        return {"version": self.state.get("version", "route_health.v1"), "dependencies": deps}


ROUTE_HEALTH = RouteHealthMonitor()
