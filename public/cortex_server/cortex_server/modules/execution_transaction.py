from __future__ import annotations

import json
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Type


DEFAULT_TRANSACTION_DIR = Path("/opt/clawdbot/state/transactions")


class TransactionError(RuntimeError):
    pass


class TransactionPreflightError(TransactionError):
    pass


class TransactionStepError(TransactionError):
    pass


class TransactionVerificationError(TransactionError):
    pass


@dataclass
class RetryPolicy:
    kind: str = "no_retry"
    attempts: int = 1
    backoff_ms: int = 0
    retry_on: Tuple[Type[BaseException], ...] = (Exception,)

    @classmethod
    def for_kind(cls, kind: str) -> "RetryPolicy":
        kind = str(kind or "no_retry")
        if kind == "transient_io":
            return cls(kind=kind, attempts=2, backoff_ms=80, retry_on=(Exception,))
        if kind == "validation_retry":
            return cls(kind=kind, attempts=2, backoff_ms=40, retry_on=(Exception,))
        return cls(kind="no_retry", attempts=1, backoff_ms=0, retry_on=(Exception,))


@dataclass
class StepResult:
    name: str
    status: str
    attempts: int
    latency_ms: int
    output: Any = None
    error: Optional[str] = None
    retry_policy: str = "no_retry"
    rollback_available: bool = False
    verified: Optional[bool] = None


@dataclass
class ExecutionTransaction:
    tx_id: str
    tx_type: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    journal_dir: Path = DEFAULT_TRANSACTION_DIR

    def __post_init__(self) -> None:
        self.journal_dir.mkdir(parents=True, exist_ok=True)
        self.journal_path = self.journal_dir / f"{self.tx_id}.json"
        self.state: Dict[str, Any] = {
            "tx_id": self.tx_id,
            "tx_type": self.tx_type,
            "status": "initialized",
            "metadata": dict(self.metadata),
            "started_at": self._now_iso(),
            "ended_at": "",
            "preflight": [],
            "steps": [],
            "rollbacks": [],
            "step_attempts_total": 0,
            "rollback_attempts_total": 0,
            "final_verification": None,
        }
        if self.journal_path.exists():
            try:
                existing = json.loads(self.journal_path.read_text(encoding="utf-8"))
                if isinstance(existing, dict) and existing.get("tx_id") == self.tx_id:
                    self.state.update(existing)
            except Exception:
                pass
        self._rollback_stack: List[Tuple[str, Callable[[Any], Any], Any]] = []
        self._persist()

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _safe(value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, dict):
            return {str(k): ExecutionTransaction._safe(v) for k, v in list(value.items())[:64]}
        if isinstance(value, (list, tuple)):
            return [ExecutionTransaction._safe(v) for v in list(value)[:64]]
        return repr(value)

    def _persist(self) -> None:
        self.journal_path.write_text(json.dumps(self.state, ensure_ascii=False, indent=2), encoding="utf-8")

    def _step_record(self, name: str) -> Optional[Dict[str, Any]]:
        for step in self.state.get("steps", []):
            if step.get("name") == name:
                return step
        return None

    def _record_step(self, result: StepResult) -> None:
        step = {
            "name": result.name,
            "status": result.status,
            "attempts": result.attempts,
            "latency_ms": result.latency_ms,
            "output": self._safe(result.output),
            "error": result.error,
            "retry_policy": result.retry_policy,
            "rollback_available": result.rollback_available,
            "verified": result.verified,
            "updated_at": self._now_iso(),
        }
        existing = self._step_record(result.name)
        if existing is None:
            self.state.setdefault("steps", []).append(step)
        else:
            existing.update(step)
        self._persist()

    def _record_preflight(self, name: str, ok: bool, detail: Any) -> None:
        self.state.setdefault("preflight", []).append(
            {
                "name": name,
                "ok": bool(ok),
                "detail": self._safe(detail),
                "ts": self._now_iso(),
            }
        )
        self._persist()

    def preflight(self, checks: Dict[str, Callable[[], Any]]) -> None:
        self.state["status"] = "preflight"
        self._persist()
        for name, check in checks.items():
            try:
                detail = check()
                ok = bool(detail if not isinstance(detail, dict) else detail.get("ok", True))
            except Exception as exc:
                ok = False
                detail = {"error": str(exc)}
            self._record_preflight(name, ok, detail)
            if not ok:
                self.state["status"] = "preflight_failed"
                self.state["ended_at"] = self._now_iso()
                self._persist()
                raise TransactionPreflightError(f"preflight failed: {name}")
        self.state["status"] = "running"
        self._persist()

    def run_step(
        self,
        name: str,
        handler: Callable[[], Any],
        *,
        retry_policy: Optional[RetryPolicy] = None,
        rollback: Optional[Callable[[Any], Any]] = None,
        verify: Optional[Callable[[Any], bool]] = None,
        idempotent: bool = True,
    ) -> Any:
        existing = self._step_record(name)
        if idempotent and existing and existing.get("status") == "completed":
            return existing.get("output")

        policy = retry_policy or RetryPolicy.for_kind("no_retry")
        start = time.perf_counter()
        attempts = 0
        last_error: Optional[BaseException] = None

        while attempts < max(1, int(policy.attempts)):
            attempts += 1
            self.state["step_attempts_total"] = int(self.state.get("step_attempts_total", 0)) + 1
            try:
                output = handler()
                verified = True if verify is None else bool(verify(output))
                if not verified:
                    raise TransactionVerificationError(f"verification failed for step {name}")
                if rollback is not None:
                    self._rollback_stack.append((name, rollback, output))
                result = StepResult(
                    name=name,
                    status="completed",
                    attempts=attempts,
                    latency_ms=int((time.perf_counter() - start) * 1000),
                    output=output,
                    retry_policy=policy.kind,
                    rollback_available=rollback is not None,
                    verified=verified,
                )
                self._record_step(result)
                return output
            except BaseException as exc:  # noqa: BLE001
                last_error = exc
                retryable = isinstance(exc, policy.retry_on) and attempts < max(1, int(policy.attempts))
                self._record_step(
                    StepResult(
                        name=name,
                        status="retrying" if retryable else "failed",
                        attempts=attempts,
                        latency_ms=int((time.perf_counter() - start) * 1000),
                        error=f"{type(exc).__name__}: {exc}",
                        retry_policy=policy.kind,
                        rollback_available=rollback is not None,
                        verified=False,
                    )
                )
                if retryable and int(policy.backoff_ms) > 0:
                    time.sleep(int(policy.backoff_ms) / 1000.0)
                else:
                    break

        self.state["status"] = "failed"
        self._persist()
        raise TransactionStepError(f"step failed: {name}: {last_error}")

    def rollback(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        while self._rollback_stack:
            name, fn, output = self._rollback_stack.pop()
            try:
                self.state["rollback_attempts_total"] = int(self.state.get("rollback_attempts_total", 0)) + 1
                rv = fn(output)
                row = {"step": name, "status": "rolled_back", "result": self._safe(rv), "ts": self._now_iso()}
            except Exception as exc:  # noqa: BLE001
                row = {"step": name, "status": "rollback_failed", "error": str(exc), "ts": self._now_iso()}
            out.append(row)
            self.state.setdefault("rollbacks", []).append(row)
            self._persist()
        return out

    def finalize(self, success_payload: Dict[str, Any], verify: Optional[Callable[[Dict[str, Any]], bool]] = None) -> Dict[str, Any]:
        verified = True if verify is None else bool(verify(success_payload))
        self.state["final_verification"] = {"verified": verified, "ts": self._now_iso()}
        if not verified:
            self.state["status"] = "verification_failed"
            self.state["ended_at"] = self._now_iso()
            self._persist()
            raise TransactionVerificationError("final verification failed")
        self.state["status"] = "completed"
        self.state["ended_at"] = self._now_iso()
        self._persist()
        return {
            "tx_id": self.tx_id,
            "tx_type": self.tx_type,
            "status": self.state.get("status"),
            "journal_path": str(self.journal_path),
            "step_attempts_total": int(self.state.get("step_attempts_total", 0)),
            "rollback_attempts_total": int(self.state.get("rollback_attempts_total", 0)),
            "steps": [
                {
                    "name": step.get("name"),
                    "status": step.get("status"),
                    "attempts": step.get("attempts"),
                    "retry_policy": step.get("retry_policy"),
                }
                for step in self.state.get("steps", [])
            ],
        }

    def fail(self, error: BaseException) -> Dict[str, Any]:
        self.state["status"] = "failed"
        self.state["ended_at"] = self._now_iso()
        self.state["error"] = {
            "type": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc(limit=5),
        }
        self._persist()
        return {
            "tx_id": self.tx_id,
            "tx_type": self.tx_type,
            "status": "failed",
            "journal_path": str(self.journal_path),
            "error": self.state["error"],
        }
