"""Typed adapters for executing Nexus-selected Cortex levels.

The engine never treats selection as execution.  Read-only levels have concrete
in-process adapters; provider, network, media, or code-execution levels require
an adapter supplied by their already-authorized owning route.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional


Adapter = Callable[[str, Mapping[str, Any]], Any | Awaitable[Any]]


class ExecutionBlocked(RuntimeError):
    """A level was selected but its existing authorization/dependency is absent."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _level_key(value: Any) -> str:
    return str(value or "").strip().lower().replace(" ", "_").replace("-", "_")


def _receipt_id(level: int, name: str, query: str, started_at: str) -> str:
    encoded = json.dumps(
        [int(level), str(name), str(query), str(started_at)],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _bounded_result(value: Any) -> Any:
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, default=str)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("execution adapter returned a non-serializable result") from exc
    if len(encoded.encode("utf-8")) > 256_000:
        raise RuntimeError("execution adapter result exceeds the byte limit")
    return json.loads(encoded)


_SUMMARY_LIMIT = 1500
_SYNTHESIS_LEVEL = "synthesist"


class ExecutionEngine:
    """Execute selected levels only through explicit typed adapters.

    Adapters come from modules.level_adapters (one module per level) and may
    be overridden per instance. Only adapters that declare SAFE_AUTORUN are
    executed unless the caller explicitly opts out of that rule; every level gets
    its own deadline; Synthesist (when selected) runs last over the other
    levels' successful results.
    """

    def __init__(self, adapters: Optional[Mapping[str, Adapter]] = None, *, discover: bool = True):
        self.execution_log: List[Dict[str, Any]] = []
        self._adapters: Dict[str, Adapter] = {}
        self._meta: Dict[str, Dict[str, Any]] = {}
        self.discovery_errors: Dict[str, str] = {}
        if discover:
            from cortex_server.modules import level_adapters

            for name, module in level_adapters.discover(errors=self.discovery_errors).items():
                self._adapters[_level_key(name)] = module.run
                self._meta[_level_key(name)] = {
                    "level": int(module.LEVEL),
                    "needs_model": bool(module.NEEDS_MODEL),
                    "safe_autorun": bool(module.SAFE_AUTORUN),
                    "deadline_s": float(module.DEFAULT_DEADLINE_S),
                }
        for name, adapter in dict(adapters or {}).items():
            self.register_adapter(name, adapter)

    def register_adapter(self, level_name: str, adapter: Adapter, *, safe_autorun: bool = True,
                         deadline_s: Optional[float] = None) -> None:
        key = _level_key(level_name)
        if not key or not callable(adapter):
            raise ValueError("execution adapter requires a level name and callable")
        self._adapters[key] = adapter
        meta = dict(self._meta.get(key) or {})
        meta.setdefault("safe_autorun", bool(safe_autorun))
        if deadline_s is not None:
            meta["deadline_s"] = float(deadline_s)
        self._meta[key] = meta

    def catalog(self) -> List[Dict[str, Any]]:
        rows = []
        for name in sorted(self._adapters):
            meta = self._meta.get(name) or {}
            rows.append({"name": name, **{k: meta.get(k) for k in ("level", "needs_model", "safe_autorun", "deadline_s")}})
        return rows

    async def execute_stack(
        self,
        stack: List[dict],
        query: str,
        *,
        context: Optional[Mapping[str, Any]] = None,
        deadline_s: Optional[float] = None,
        autorun_only: bool = True,
    ) -> Dict[str, Any]:
        if not isinstance(stack, list) or len(stack) > 38:
            raise ValueError("execution stack must be a bounded list")
        if not isinstance(query, str) or not query.strip():
            raise ValueError("execution query is required")
        normalized_context = dict(context or {})
        started = time.monotonic()
        overall = float(deadline_s) if deadline_s else None

        def remaining(per_level: float) -> float:
            if overall is None:
                return per_level
            return max(0.5, min(per_level, overall - (time.monotonic() - started)))

        seen: set = set()
        first: List[Mapping[str, Any]] = []
        synthesis: List[Mapping[str, Any]] = []
        for entry in stack:
            if not isinstance(entry, Mapping):
                raise ValueError("level entry must be an object")
            key = _level_key(entry.get("name"))
            if key in seen:
                continue
            seen.add(key)
            (synthesis if key == _SYNTHESIS_LEVEL else first).append(entry)

        results = list(await asyncio.gather(
            *(self._execute_single_level(level, query, normalized_context, remaining, autorun_only) for level in first),
            return_exceptions=False,
        ))
        for entry in synthesis:
            level_results = [
                {"level": row["level"], "name": row["name"], "summary": (row.get("result") or {}).get("summary", ""),
                 "receipt_id": row["receiptId"]}
                for row in results
                if row["status"] == "succeeded" and isinstance(row.get("result"), dict)
            ]
            synth_context = dict(normalized_context, level_results=level_results)
            results.append(await self._execute_single_level(entry, query, synth_context, remaining, autorun_only))

        succeeded = sum(receipt["status"] == "succeeded" for receipt in results)
        blocked = sum(receipt["status"] == "blocked" for receipt in results)
        failed = sum(receipt["status"] == "failed" for receipt in results)
        by_name = {receipt["name"]: receipt for receipt in results}
        return {
            "schemaVersion": "cortex.execution-stack.v2",
            "querySha256": hashlib.sha256(query.encode("utf-8")).hexdigest(),
            "executedAt": _now(),
            "elapsedMs": int((time.monotonic() - started) * 1000),
            "levelsRequested": len(stack),
            "levelsExecuted": succeeded,
            "levelsBlocked": blocked,
            "levelsFailed": failed,
            "executionResults": by_name,
            "levels_executed": succeeded,
            "execution_results": by_name,
            "errors": [
                {"level": row["level"], "name": row["name"], "errorType": row.get("errorType")}
                for row in results
                if row["status"] == "failed"
            ],
        }

    async def _execute_single_level(
        self,
        level_info: Mapping[str, Any],
        query: str,
        context: Mapping[str, Any],
        remaining: Callable[[float], float] = lambda per_level: per_level,
        autorun_only: bool = True,
    ) -> Dict[str, Any]:
        if not isinstance(level_info, Mapping):
            raise ValueError("level entry must be an object")
        level = int(level_info.get("level"))
        name = _level_key(level_info.get("name"))
        if level < 1 or level > 38 or not name:
            raise ValueError("level entry has an invalid identity")
        started_at = _now()
        t0 = time.monotonic()
        receipt: Dict[str, Any] = {
            "schemaVersion": "cortex.level-execution-receipt.v1",
            "receiptId": _receipt_id(level, name, query, started_at),
            "level": level,
            "name": name,
            "startedAt": started_at,
            "status": "blocked",
        }
        adapter = self._adapters.get(name)
        meta = self._meta.get(name) or {}
        if adapter is None:
            receipt.update(endedAt=_now(), reason="authorized_adapter_unavailable", adapter="none")
            return self._log(receipt)
        if autorun_only and meta.get("safe_autorun") is False:
            receipt.update(endedAt=_now(), reason="approval_required", adapter="not_invoked")
            return self._log(receipt)

        receipt["adapter"] = f"{adapter.__module__}.{getattr(adapter, '__qualname__', adapter.__class__.__name__)}"
        budget = remaining(float(meta.get("deadline_s") or 30.0))
        try:
            output = adapter(query, context)
            if inspect.isawaitable(output):
                output = await asyncio.wait_for(output, timeout=budget)
            result = _bounded_result(output)
            if isinstance(result, dict) and isinstance(result.get("summary"), str):
                result["summary"] = result["summary"][:_SUMMARY_LIMIT]
            receipt.update(status="succeeded", endedAt=_now(), result=result)
        except ExecutionBlocked as exc:
            receipt.update(status="blocked", endedAt=_now(), reason=exc.reason)
        except asyncio.TimeoutError:
            receipt.update(status="failed", endedAt=_now(), errorType="DeadlineExceeded")
        except Exception as exc:
            receipt.update(status="failed", endedAt=_now(), errorType=type(exc).__name__)
        receipt["elapsedMs"] = int((time.monotonic() - t0) * 1000)
        return self._log(receipt)

    def _log(self, receipt: Dict[str, Any]) -> Dict[str, Any]:
        self.execution_log.append({k: v for k, v in receipt.items() if k != "result"})
        if len(self.execution_log) > 256:
            del self.execution_log[:-256]
        return receipt

    @staticmethod
    def _librarian_recall(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
        """Synchronous principal-scoped recall (kept for in-process callers)."""
        from cortex_server.routers.librarian import robust_search

        principal = str(context.get("memory_principal_key") or "").strip()
        if not principal:
            raise ExecutionBlocked("authenticated_memory_scope_required")
        result = robust_search(
            query,
            n_results=max(1, min(int(context.get("memory_limit") or 5), 20)),
            allow_fallback=True,
            tenant_id=str(context.get("tenant_id") or "cortex-local"),
            workspace_id=str(context.get("storage_workspace_id") or context.get("workspace_id") or "default"),
            memory_principal_key=principal,
        )
        return {"operation": "librarian.recall", "recall": result}


_execution_engine: Optional[ExecutionEngine] = None


def get_execution_engine() -> ExecutionEngine:
    global _execution_engine
    if _execution_engine is None:
        _execution_engine = ExecutionEngine()
    return _execution_engine
