"""Measured model-lane health for model-backed deliberation levels.

Council, Simulator, Mediator and Ethicist used to report ``status: "active"``
unconditionally. This tracker records the real outcome of each model call made
through ``modules.level_model`` so status endpoints can report what actually
happened: ``active`` only after a recent verified model success, ``degraded``
when the most recent calls failed (or the breaker is open), ``idle`` when the
level is mounted but has not completed a verified model call recently.

State is per-process and in-memory by design (it describes this worker's
recent calls); the snapshot says so.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Deque, Dict, Optional, Tuple


class LevelCallHealth:
    def __init__(
        self,
        name: str,
        *,
        window: int = 20,
        fresh_s: float = 900.0,
        breaker_threshold: int = 5,
        breaker_cooldown_s: float = 45.0,
    ) -> None:
        self.name = str(name)
        self.fresh_s = float(fresh_s)
        self.breaker_threshold = max(1, int(breaker_threshold))
        self.breaker_cooldown_s = max(1.0, float(breaker_cooldown_s))
        self._lock = threading.Lock()
        self._recent: Deque[Tuple[float, bool, str]] = deque(maxlen=max(1, int(window)))
        self._successes = 0
        self._failures = 0
        self._consecutive_failures = 0
        self._breaker_open_until = 0.0
        self._last_success_at: Optional[float] = None
        self._last_failure_at: Optional[float] = None
        self._last_failure_status: Optional[str] = None

    def record(self, ok: bool, status: str = "") -> None:
        now = time.time()
        with self._lock:
            self._recent.append((now, bool(ok), str(status or ("ok" if ok else "failed"))[:60]))
            if ok:
                self._successes += 1
                self._consecutive_failures = 0
                self._last_success_at = now
            else:
                self._failures += 1
                self._consecutive_failures += 1
                self._last_failure_at = now
                self._last_failure_status = str(status or "failed")[:60]
                if self._consecutive_failures >= self.breaker_threshold:
                    self._breaker_open_until = now + self.breaker_cooldown_s

    def record_result(self, result: Dict[str, Any]) -> None:
        """Record a ``level_model`` result dict (``ok``/``status``)."""

        self.record(bool(result.get("ok")), str(result.get("status") or ""))

    def breaker_open(self) -> bool:
        with self._lock:
            return time.time() < self._breaker_open_until

    def breaker_seconds_remaining(self) -> int:
        with self._lock:
            return max(0, int(self._breaker_open_until - time.time()))

    def snapshot(self) -> Dict[str, Any]:
        now = time.time()
        with self._lock:
            recent = list(self._recent)
            last_ok = self._last_success_at
            last_fail = self._last_failure_at
            breaker_open = now < self._breaker_open_until
            successes, failures = self._successes, self._failures
            consecutive = self._consecutive_failures
            last_fail_status = self._last_failure_status
        last_outcome_ok = recent[-1][1] if recent else None
        fresh_success = last_ok is not None and (now - last_ok) <= self.fresh_s
        if breaker_open or last_outcome_ok is False:
            status = "degraded"
        elif fresh_success:
            status = "active"
        else:
            status = "idle"
        rate = (sum(1 for _t, ok, _s in recent if ok) / len(recent)) if recent else None
        return {
            "status": status,
            "model_verified_recently": bool(fresh_success),
            "last_success_at": last_ok,
            "last_failure_at": last_fail,
            "last_failure_status": last_fail_status,
            "model_successes": successes,
            "model_failures": failures,
            "consecutive_failures": consecutive,
            "success_rate_recent": (round(rate, 3) if rate is not None else None),
            "recent_window": len(recent),
            "breaker_open": breaker_open,
            "breaker_seconds_remaining": max(0, int(self._breaker_open_until - now)) if breaker_open else 0,
            "freshness_window_s": self.fresh_s,
            "scope": "this_worker_process",
        }
