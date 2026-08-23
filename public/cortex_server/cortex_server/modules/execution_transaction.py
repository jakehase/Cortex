from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Type

from cortex_server.runtime.resilient_json_state import (
    ResilientJSONStateError,
    ResilientJSONStateStore,
    StateCorruptionError,
)


DEFAULT_TRANSACTION_DIR = Path(os.getenv("EXECUTION_TRANSACTION_DIR", "/opt/clawdbot/state/transactions"))


class TransactionError(RuntimeError):
    pass


class TransactionPreflightError(TransactionError):
    pass


class TransactionStepError(TransactionError):
    pass


class TransactionVerificationError(TransactionError):
    pass


class TransactionRecoveryError(TransactionError):
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
    error: Optional[BaseException] = None
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
        initial_state = self._initial_state()
        self._journal_store = ResilientJSONStateStore(
            self.journal_path,
            validator=self._validate_journal,
            max_state_bytes=4_000_000,
        )
        try:
            loaded = self._journal_store.load(default_factory=lambda: dict(initial_state))
        except StateCorruptionError as exc:
            raise TransactionRecoveryError("transaction journal requires recovery") from exc

        self.state = dict(initial_state)
        self.state.update(loaded)
        self.state, journal_was_sanitized = self._sanitize_loaded_journal(self.state)
        self._rollback_stack: List[Tuple[str, Callable[[Any], Any], Any]] = []
        self._ephemeral_step_outputs: Dict[str, Any] = {}

        if self._journal_store.last_load_source == "missing":
            self._persist()
            return

        previous_status = str(self.state.get("status") or "")
        terminal = {
            "completed",
            "failed",
            "preflight_failed",
            "verification_failed",
            "cancelled",
            "indeterminate",
        }
        reopened_nonterminal = previous_status not in terminal
        if reopened_nonterminal:
            self.state["status"] = "indeterminate"
            self.state["ended_at"] = self._now_iso()
            self.state["recovery"] = {
                "reason": "nonterminal_transaction_reopened",
                "previous_status": previous_status,
                "recovered_at": self._now_iso(),
            }
        if reopened_nonterminal or journal_was_sanitized:
            self._persist()

    def _initial_state(self) -> Dict[str, Any]:
        return {
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

    def _validate_journal(self, payload: Any) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("transaction journal must be an object")
        if payload.get("tx_id") != self.tx_id:
            raise ValueError("transaction journal tx_id does not match")
        if payload.get("tx_type") != self.tx_type:
            raise ValueError("transaction journal tx_type does not match")
        allowed_statuses = {
            "initialized",
            "preflight",
            "preflight_failed",
            "running",
            "failed",
            "verification_failed",
            "completed",
            "cancelled",
            "indeterminate",
        }
        if payload.get("status") not in allowed_statuses:
            raise ValueError("transaction journal status is invalid")
        if not isinstance(payload.get("metadata"), dict):
            raise ValueError("transaction journal metadata must be an object")
        for field_name in ("preflight", "steps", "rollbacks"):
            rows = payload.get(field_name)
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError(f"transaction journal {field_name} must contain objects")
        for field_name in ("step_attempts_total", "rollback_attempts_total"):
            value = payload.get(field_name)
            if type(value) is not int or value < 0:
                raise ValueError(f"transaction journal {field_name} must be a non-negative integer")
        if not isinstance(payload.get("started_at"), str) or not payload.get("started_at"):
            raise ValueError("transaction journal started_at must be non-empty")
        if not isinstance(payload.get("ended_at"), str):
            raise ValueError("transaction journal ended_at must be a string")
        if payload.get("final_verification") is not None and not isinstance(
            payload.get("final_verification"), dict
        ):
            raise ValueError("transaction journal final_verification must be an object or null")
        if payload.get("error") is not None and not isinstance(payload.get("error"), dict):
            raise ValueError("transaction journal error must be an object")
        return dict(payload)

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _safe_type_name(value: Any) -> str:
        value_type = type(value)
        name = value_type.__name__
        if not name or len(name) > 64 or not all(ch.isalnum() or ch == "_" for ch in name):
            return "object"
        if value_type.__module__ != "builtins" and not isinstance(value, BaseException):
            return "object"
        return name

    @classmethod
    def _value_metadata(cls, value: Any) -> Dict[str, Any]:
        """Return bounded diagnostics without retaining the source value."""

        value_type = cls._safe_type_name(value)
        if isinstance(value, bytes):
            encoded = value
        else:
            try:
                encoded = json.dumps(
                    value,
                    ensure_ascii=False,
                    sort_keys=True,
                    allow_nan=False,
                    separators=(",", ":"),
                    default=lambda item: {"__type__": cls._safe_type_name(item)},
                ).encode("utf-8")
            except (TypeError, ValueError, OverflowError):
                encoded = f"type:{value_type}".encode("ascii")

        metadata: Dict[str, Any] = {
            "type": value_type,
            "sha256": hashlib.sha256(encoded).hexdigest(),
        }
        if isinstance(value, str):
            metadata["char_count"] = len(value)
        elif isinstance(value, bytes):
            metadata["byte_count"] = len(value)
        elif isinstance(value, (dict, list, tuple, set, frozenset)):
            metadata["item_count"] = len(value)
        return metadata

    @classmethod
    def _exception_metadata(cls, error: BaseException) -> Dict[str, Any]:
        try:
            message = str(error)
        except Exception:
            message = ""
        encoded = message.encode("utf-8", errors="replace")
        return {
            "type": cls._safe_type_name(error),
            "message_chars": len(message),
            "message_sha256": hashlib.sha256(encoded).hexdigest(),
        }

    @classmethod
    def _sanitize_loaded_journal(cls, payload: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
        """Migrate legacy raw diagnostic fields to metadata-only records."""

        sanitized = copy.deepcopy(payload)
        changed = False

        for row in sanitized.get("preflight", []):
            if "detail" in row:
                row["detail_metadata"] = cls._value_metadata(row.pop("detail"))
                changed = True
            if "traceback" in row:
                row.pop("traceback")
                changed = True

        for row in sanitized.get("steps", []):
            if "output" in row:
                row["output_metadata"] = cls._value_metadata(row.pop("output"))
                changed = True
            if row.get("error") is not None:
                row["error_metadata"] = cls._value_metadata(row.pop("error"))
                changed = True
            elif "error" in row:
                row.pop("error")
                changed = True
            if "traceback" in row:
                row.pop("traceback")
                changed = True

        for row in sanitized.get("rollbacks", []):
            if "result" in row:
                row["result_metadata"] = cls._value_metadata(row.pop("result"))
                changed = True
            if row.get("error") is not None:
                row["error_metadata"] = cls._value_metadata(row.pop("error"))
                changed = True
            elif "error" in row:
                row.pop("error")
                changed = True
            if "traceback" in row:
                row.pop("traceback")
                changed = True

        if "error" in sanitized:
            sanitized["error_metadata"] = cls._value_metadata(sanitized.pop("error"))
            changed = True
        if "interruption" in sanitized:
            sanitized["interruption_metadata"] = cls._value_metadata(
                sanitized.pop("interruption")
            )
            changed = True
        if "traceback" in sanitized:
            sanitized.pop("traceback")
            changed = True
        return sanitized, changed

    def _ensure_recoverable_state(self, operation: str) -> None:
        if self.state.get("status") == "indeterminate":
            raise TransactionRecoveryError(
                f"cannot {operation} an indeterminate transaction; explicit recovery is required"
            )

    def _persist(self) -> None:
        self.state, _changed = self._sanitize_loaded_journal(self.state)
        try:
            self._journal_store.save(self.state)
        except (ResilientJSONStateError, OSError, ValueError) as exc:
            raise TransactionRecoveryError("transaction journal persistence failed") from exc

    def journal_health(self) -> Dict[str, Any]:
        return self._journal_store.health

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
            "output_metadata": self._value_metadata(result.output),
            "retry_policy": result.retry_policy,
            "rollback_available": result.rollback_available,
            "verified": result.verified,
            "updated_at": self._now_iso(),
        }
        if result.error is not None:
            step["error_metadata"] = self._exception_metadata(result.error)
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
                "detail_metadata": self._value_metadata(detail),
                "ts": self._now_iso(),
            }
        )
        self._persist()

    def preflight(self, checks: Dict[str, Callable[[], Any]]) -> None:
        self._ensure_recoverable_state("run preflight for")
        self.state["status"] = "preflight"
        self._persist()
        for name, check in checks.items():
            try:
                detail = check()
                ok = bool(detail if not isinstance(detail, dict) else detail.get("ok", True))
            except Exception as exc:
                ok = False
                detail = {"error_metadata": self._exception_metadata(exc)}
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
        self._ensure_recoverable_state("run a step for")
        existing = self._step_record(name)
        if idempotent and existing and existing.get("status") == "completed":
            if name in self._ephemeral_step_outputs:
                return self._ephemeral_step_outputs[name]
            raise TransactionRecoveryError(
                f"completed step '{name}' cannot be replayed because its output is not retained"
            )

        policy = retry_policy or RetryPolicy.for_kind("no_retry")
        start = time.perf_counter()
        attempts = 0
        last_error: Optional[Exception] = None

        while attempts < max(1, int(policy.attempts)):
            attempts += 1
            self.state["step_attempts_total"] = int(self.state.get("step_attempts_total", 0)) + 1
            try:
                output = handler()
                verified = True if verify is None else bool(verify(output))
                if not verified:
                    raise TransactionVerificationError(f"verification failed for step {name}")
            except asyncio.CancelledError as exc:
                self._record_step(
                    StepResult(
                        name=name,
                        status="cancelled",
                        attempts=attempts,
                        latency_ms=int((time.perf_counter() - start) * 1000),
                        error=exc,
                        retry_policy=policy.kind,
                        rollback_available=rollback is not None,
                        verified=False,
                    )
                )
                self.state["status"] = "cancelled"
                self.state["ended_at"] = self._now_iso()
                self.state["interruption_metadata"] = {
                    **self._exception_metadata(exc),
                    "at": self._now_iso(),
                }
                self._persist()
                raise
            except (KeyboardInterrupt, SystemExit) as exc:
                self._record_step(
                    StepResult(
                        name=name,
                        status="indeterminate",
                        attempts=attempts,
                        latency_ms=int((time.perf_counter() - start) * 1000),
                        error=exc,
                        retry_policy=policy.kind,
                        rollback_available=rollback is not None,
                        verified=False,
                    )
                )
                self.state["status"] = "indeterminate"
                self.state["ended_at"] = self._now_iso()
                self.state["interruption_metadata"] = {
                    **self._exception_metadata(exc),
                    "at": self._now_iso(),
                }
                self._persist()
                raise
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                retryable = isinstance(exc, policy.retry_on) and attempts < max(1, int(policy.attempts))
                self._record_step(
                    StepResult(
                        name=name,
                        status="retrying" if retryable else "failed",
                        attempts=attempts,
                        latency_ms=int((time.perf_counter() - start) * 1000),
                        error=exc,
                        retry_policy=policy.kind,
                        rollback_available=rollback is not None,
                        verified=False,
                    )
                )
                if retryable and int(policy.backoff_ms) > 0:
                    time.sleep(int(policy.backoff_ms) / 1000.0)
                else:
                    break
            else:
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
                try:
                    self._record_step(result)
                except Exception as journal_error:
                    # The handler has already returned successfully. Its side
                    # effect is now indeterminate and must never be retried as
                    # though journal I/O were a handler failure.
                    self.state["status"] = "indeterminate"
                    self.state["ended_at"] = self._now_iso()
                    self.state["recovery"] = {
                        "reason": "step_completion_persistence_failed",
                        "step": name,
                        "failure_type": self._safe_type_name(journal_error),
                        "detected_at": self._now_iso(),
                    }
                    raise TransactionRecoveryError(
                        f"step '{name}' completed but its journal transition was not durable"
                    ) from journal_error
                self._ephemeral_step_outputs[name] = output
                return output

        self.state["status"] = "failed"
        self._persist()
        failure_type = self._safe_type_name(last_error) if last_error else "UnknownError"
        raise TransactionStepError(f"transaction step failed ({failure_type})")

    def rollback(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        while self._rollback_stack:
            name, fn, output = self._rollback_stack.pop()
            try:
                self.state["rollback_attempts_total"] = int(self.state.get("rollback_attempts_total", 0)) + 1
                rv = fn(output)
                row = {
                    "step": name,
                    "status": "rolled_back",
                    "result_metadata": self._value_metadata(rv),
                    "ts": self._now_iso(),
                }
            except Exception as exc:  # noqa: BLE001
                row = {
                    "step": name,
                    "status": "rollback_failed",
                    "error_metadata": self._exception_metadata(exc),
                    "ts": self._now_iso(),
                }
            out.append(row)
            self.state.setdefault("rollbacks", []).append(row)
            self._persist()
        return out

    def finalize(self, success_payload: Dict[str, Any], verify: Optional[Callable[[Dict[str, Any]], bool]] = None) -> Dict[str, Any]:
        self._ensure_recoverable_state("finalize")
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
        if self.state.get("status") != "indeterminate":
            self.state["status"] = "failed"
            self.state["ended_at"] = self._now_iso()
        self.state["error_metadata"] = self._exception_metadata(error)
        self._persist()
        return {
            "tx_id": self.tx_id,
            "tx_type": self.tx_type,
            "status": self.state.get("status"),
            "journal_path": str(self.journal_path),
            "error_metadata": dict(self.state["error_metadata"]),
        }

    def to_reasoning_task(
        self,
        *,
        title: Optional[str] = None,
        description: str = "",
        owner: Optional[str] = None,
        session_key: Optional[str] = None,
        archetype: Optional[str] = None,
        success_criteria: Optional[List[str]] = None,
        constraints: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        from cortex_server.modules.reasoning_kernel import build_reasoning_task_from_transaction, model_dump_compat

        payload = dict(self.state)
        payload.setdefault("tx_id", self.tx_id)
        payload.setdefault("tx_type", self.tx_type)
        payload.setdefault("journal_path", str(self.journal_path))
        task = build_reasoning_task_from_transaction(
            payload,
            title=title,
            description=description,
            owner=owner,
            session_key=session_key,
            archetype=archetype,
            success_criteria=success_criteria,
            constraints=constraints,
        )
        return model_dump_compat(task)

    def to_reasoning_outcome(
        self,
        *,
        task_id: Optional[str] = None,
        summary: str = "",
        reward: Optional[float] = None,
        validator_pass: Optional[bool] = None,
        user_correction: bool = False,
        recovery_needed: bool = False,
    ) -> Dict[str, Any]:
        from cortex_server.modules.reasoning_kernel import build_outcome_from_transaction, model_dump_compat

        payload = dict(self.state)
        payload.setdefault("tx_id", self.tx_id)
        payload.setdefault("tx_type", self.tx_type)
        payload.setdefault("journal_path", str(self.journal_path))
        outcome = build_outcome_from_transaction(
            payload,
            task_id=task_id,
            summary=summary,
            reward=reward,
            validator_pass=validator_pass,
            user_correction=user_correction,
            recovery_needed=recovery_needed,
        )
        return model_dump_compat(outcome)
