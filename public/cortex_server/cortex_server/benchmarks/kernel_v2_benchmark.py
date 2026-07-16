from __future__ import annotations

import argparse
import json
import os
import re
import time
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Any, Dict, Iterable, List, Optional
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.middleware.hud_middleware import HUDMiddleware
from cortex_server.modules import cortex_kernel_v2
from cortex_server.modules import runtime_pressure
import cortex_server.routers.command_center as command_center
import cortex_server.routers.command_center_live as command_center_live
import cortex_server.routers.meta_conductor as meta_conductor
import cortex_server.routers.mission_control as mission_control
import cortex_server.routers.nexus as nexus
import cortex_server.routers.oracle as oracle


JsonDict = Dict[str, Any]


@dataclass
class CaseResult:
    case_id: str
    iteration: int
    runtime: str
    surface: str
    workload_class: str
    lane_tendency: str
    elapsed_ms: float
    latency_slo_ms: Optional[float]
    passed: bool
    failures: List[str]
    status_code: int
    kernel_event: Optional[JsonDict]
    response: JsonDict
    check_results: List[JsonDict]


class _AliveDisabled:
    def enabled(self):
        return False


class BenchmarkHarness:
    def __init__(self, corpus: JsonDict):
        self.corpus = corpus
        self.app = FastAPI()
        self.app.add_middleware(HUDMiddleware)
        self._install_routes()
        self.client = TestClient(self.app)
        self._patches = []

    def _install_routes(self) -> None:
        @self.app.get("/health")
        async def _health():
            return {"status": "healthy", "service": "benchmark-harness"}

        self.app.include_router(oracle.router, prefix="/oracle")
        self.app.include_router(nexus.router, prefix="/nexus")
        self.app.include_router(meta_conductor.router, prefix="/meta_conductor")
        self.app.include_router(mission_control.router, prefix="/mission_control")
        self.app.include_router(command_center.router, prefix="/command_center")
        self.app.include_router(command_center_live.router, prefix="/command_center_live")

    def __enter__(self):
        self._patches = [
            patch.object(oracle, "get_alive_mode", lambda loader: _AliveDisabled()),
            patch.object(oracle, "_strict_micro_fast_answer", self._fake_strict_micro_fast_answer),
            patch.object(oracle, "_semantic_guardrail_response", self._fake_semantic_guardrail_response),
            patch.object(oracle, "_best_effort_answer", self._fake_best_effort_answer),
            patch.object(nexus, "analyze_intent_with_oracle", lambda q, **_kwargs: {"confidence": 0.0, "levels": [], "reasoning": "benchmark-stub", "method": "benchmark_stub"}),
            patch.object(nexus, "gather_live_evidence", lambda *a, **k: {"required": False, "mode": "not_required", "evidence_count": 0, "degraded": False}),
            patch.object(nexus, "_architect_healthy", lambda *_args, **_kwargs: True),
            patch.object(meta_conductor, "_probe_level", self._fake_probe_level),
        ]
        for item in self._patches:
            item.start()
        self._set_env()
        runtime_pressure.reset_state()
        self._warmup()
        cortex_kernel_v2.reset_state()
        return self

    def __exit__(self, exc_type, exc, tb):
        for item in reversed(self._patches):
            item.stop()
        self.client.close()
        return False

    def _set_env(self) -> None:
        os.environ.setdefault("ORACLE_ROUTE_TO_AUGMENTER", "false")
        os.environ.setdefault("ORACLE_EMERGENCY_BYPASS", "false")
        os.environ.setdefault("ORACLE_KERNEL_V2_ENABLED", "true")
        os.environ.setdefault("ORACLE_KERNEL_V2_MODE", "active")
        os.environ.setdefault("NEXUS_KERNEL_V2_ENABLED", "true")
        os.environ.setdefault("NEXUS_KERNEL_V2_MODE", "active")
        os.environ.setdefault("CORTEX_KERNEL_V2_ENABLED", "true")
        os.environ.setdefault("CORTEX_KERNEL_V2_MODE", "active")
        os.environ.setdefault("OLLAMA_ENABLED", "false")

    def _warmup(self) -> None:
        warmups = [
            ("POST", "/oracle/chat", None, None, {"prompt": "What is the capital of Texas?", "priority": "normal"}),
            ("POST", "/nexus/orchestrate", None, {"x-session-id": "benchmark-warmup-nexus"}, {"query": "What is the capital of Texas?"}),
            ("POST", "/meta_conductor/orchestrate", None, None, {"query": "Implement the runtime compiler refactor and validate the production rollout through meta conductor.", "target_levels": [33, 34]}),
        ]
        for method, path, params, headers, payload in warmups:
            try:
                self.client.request(method, path, params=params, headers=headers, json=payload)
            except Exception:
                pass

    @staticmethod
    def _normalize(text: str) -> str:
        return " ".join((text or "").split()).strip().lower()

    @staticmethod
    def _extract_referent_value(normalized: str, *, kind: str) -> Optional[str]:
        kind = str(kind or "").strip().lower()
        if kind not in {"token", "code", "key"}:
            return None
        patterns = [
            rf"memory_{kind}\s*[=:]\s*([a-z0-9_\-]+)",
            rf"\b{kind}\s*[=:]\s*([a-z0-9_\-]+)\b",
            rf"\bremember\s+{kind}\s+([a-z0-9_\-]+)\b",
            rf"\b{kind}\s+is\s+([a-z0-9_\-]+)\b",
            rf"\bkeep\s+{kind}\s+([a-z0-9_\-]+)\b",
        ]
        for pattern in patterns:
            match = re.search(pattern, normalized, flags=re.IGNORECASE)
            if match:
                return str(match.group(1) or "").strip() or None
        return None

    def _fake_strict_micro_fast_answer(self, prompt: str):
        normalized = self._normalize(prompt)
        if "what is 2+2" in normalized and "reply number only" in normalized:
            return "4"
        return None

    def _fake_semantic_guardrail_response(self, prompt: str, session_key: Optional[str] = None):
        normalized = self._normalize(prompt)
        if "capital of texas" in normalized:
            return {"lane": "semantic_guardrail_factual", "response": "Austin."}
        return None

    def _fake_best_effort_answer(
        self,
        prompt: str,
        system: Optional[str] = None,
        priority: Optional[str] = None,
        depth_mode: Optional[str] = None,
        routing_priors: Optional[JsonDict] = None,
        adaptive_policies=None,
        backend_policy_override: Optional[JsonDict] = None,
        principal_scope_key: str = "benchmark-principal",
    ):
        normalized = self._normalize(prompt)
        tail = normalized[-320:]

        for kind in ("token", "code", "key"):
            remembered = self._extract_referent_value(normalized, kind=kind)
            if remembered and any(fragment in normalized for fragment in [f"what {kind} did i ask you to remember", f"what {kind} should you remember", f"which {kind} did i give you"]):
                return (remembered, "benchmark-model", f"{kind}_recall")
            if remembered and any(re.search(pattern, normalized, flags=re.IGNORECASE) for pattern in [rf"\bremember\s+{kind}\s+[a-z0-9_\-]+\b", rf"\bkeep\s+{kind}\s+[a-z0-9_\-]+\b", rf"\b{kind}\s+is\s+[a-z0-9_\-]+\b"]):
                return (f"I'll remember {remembered}.", "benchmark-model", f"{kind}_ack")

        if "runtime compiler rollout" in tail and "tradeoff" in tail:
            return ("Use a shared compiler with bounded context packing; keep rollout toggles visible and reversible.", "benchmark-model", "planning_depth")
        if "router refactor" in tail and "rollback" in tail:
            return ("Implement the refactor, add regression tests, and keep rollback verification in the loop.", "benchmark-model", "coding_depth")
        if "meta conductor" in tail and "rollout" in tail:
            return ("Delegate through Nexus, preserve meta runtime telemetry, and validate the rollout gates.", "benchmark-model", "meta_delegate")
        if "production incident" in tail and "rollback" in tail:
            return ("Treat this as a production-risk deep path: contain impact, inspect rollback safety, and validate operator signals.", "benchmark-model", "prod_incident")
        if "capital of texas" in tail:
            return ("Austin.", "benchmark-model", "fallback_fact")
        return (f"Benchmark stub response: {prompt[:120]}", "benchmark-model", "stub")

    async def _fake_probe_level(self, client, level: int, timeout_seconds: float):
        return {
            "level": level,
            "name": f"L{level}",
            "path": f"/levels/{level}",
            "success": True,
            "data": {"level": level, "status": "active"},
            "error": None,
            "latency_ms": 2.0,
            "reported_level": level,
            "identity_match": True,
        }

    def run_case(self, case: JsonDict, iteration: int) -> CaseResult:
        request = deepcopy(case.get("request") or {})
        method = str(request.get("method") or "GET").upper()
        path = str(request.get("path") or "").strip()
        params = deepcopy(request.get("params") or {})
        headers = deepcopy(request.get("headers") or {})
        payload = deepcopy(request.get("json") or None)
        before_events = cortex_kernel_v2.recent_events(limit=1)
        before_id = before_events[-1]["event_id"] if before_events else None

        started = time.perf_counter()
        response = self.client.request(method, path, params=params, headers=headers, json=payload)
        elapsed_ms = round((time.perf_counter() - started) * 1000.0, 3)

        try:
            body = response.json()
        except Exception:
            body = {"raw_text": response.text}

        kernel_event = None
        if case.get("measure_event"):
            events = cortex_kernel_v2.recent_events(limit=10)
            if events:
                if before_id is None:
                    kernel_event = events[-1]
                else:
                    for event in reversed(events):
                        if event.get("event_id") != before_id:
                            kernel_event = event
                            break
        snapshot = cortex_kernel_v2.performance_snapshot()
        context = {
            "status_code": response.status_code,
            "response": body,
            "kernel_event": kernel_event,
            "snapshot": snapshot,
        }
        check_results = [self._evaluate_check(check, context) for check in (case.get("checks") or [])]
        latency_slo_ms = case.get("latency_slo_ms")
        if latency_slo_ms is not None:
            check_results.append({
                "path": "elapsed_ms",
                "op": "le",
                "value": latency_slo_ms,
                "actual": elapsed_ms,
                "passed": elapsed_ms <= float(latency_slo_ms),
            })
        failures = [self._format_failure(item) for item in check_results if not item.get("passed")]
        return CaseResult(
            case_id=str(case.get("id")),
            iteration=iteration,
            runtime=str(case.get("runtime") or ""),
            surface=str(case.get("surface") or ""),
            workload_class=str(case.get("class") or ""),
            lane_tendency=str(case.get("lane_tendency") or ""),
            elapsed_ms=elapsed_ms,
            latency_slo_ms=float(latency_slo_ms) if latency_slo_ms is not None else None,
            passed=not failures,
            failures=failures,
            status_code=response.status_code,
            kernel_event=kernel_event,
            response=body if isinstance(body, dict) else {"value": body},
            check_results=check_results,
        )

    def _evaluate_check(self, check: JsonDict, context: JsonDict) -> JsonDict:
        path = str(check.get("path") or "").strip()
        op = str(check.get("op") or "eq").strip().lower()
        expected = check.get("value")
        actual = self._resolve_path(context, path)
        passed = False
        if op == "eq":
            passed = actual == expected
        elif op == "ge":
            passed = actual is not None and actual >= expected
        elif op == "contains":
            if isinstance(actual, list):
                passed = expected in actual
            else:
                passed = str(expected) in str(actual)
        elif op == "not_null":
            passed = actual is not None
        elif op == "truthy":
            passed = bool(actual)
        elif op == "le":
            passed = actual is not None and actual <= expected
        else:
            raise ValueError(f"Unsupported check operator: {op}")
        return {"path": path, "op": op, "value": expected, "actual": actual, "passed": bool(passed)}

    def _format_failure(self, result: JsonDict) -> str:
        return f"{result.get('path')} {result.get('op')} {result.get('value')} (actual={result.get('actual')})"

    def _resolve_path(self, context: JsonDict, path: str) -> Any:
        if path == "status_code":
            return context.get("status_code")
        parts = path.split(".")
        current: Any = context
        for part in parts:
            if isinstance(current, dict):
                current = current.get(part)
                continue
            if isinstance(current, list):
                try:
                    current = current[int(part)]
                    continue
                except Exception:
                    return None
            return None
        return current


def load_corpus(path: str | Path) -> JsonDict:
    return json.loads(Path(path).read_text())


def _pct(values: List[float], frac: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, int(round((len(ordered) - 1) * frac))))
    return round(float(ordered[idx]), 3)


def _aggregate_trace_metrics(results: Iterable[CaseResult]) -> JsonDict:
    rows = [row for row in results if row.kernel_event]
    count = len(rows)
    if not count:
        return {
            "count": 0,
            "planned_fast_rate": 0.0,
            "planned_deep_rate": 0.0,
            "actual_fast_rate": 0.0,
            "actual_deep_rate": 0.0,
            "escalation_rate": 0.0,
            "codec_use_rate": 0.0,
            "failure_rate": 0.0,
            "latency_ms": {"p50": 0.0, "p95": 0.0},
            "compile_ms": {"p50": 0.0, "p95": 0.0},
            "context_chars": {"avg": 0.0, "p95": 0.0},
        }
    latency_values = [float(row.kernel_event.get("latency_ms") or 0.0) for row in rows]
    compile_values = [float(row.kernel_event.get("compile_ms") or 0.0) for row in rows]
    context_values = [float(((row.kernel_event.get("context_reuse") or {}).get("total_chars")) or 0.0) for row in rows]
    planned_fast = sum(1 for row in rows if row.kernel_event.get("planned_lane") == "fast")
    planned_deep = sum(1 for row in rows if row.kernel_event.get("planned_lane") == "deep")
    actual_fast = sum(1 for row in rows if row.kernel_event.get("actual_lane_family") == "fast")
    actual_deep = sum(1 for row in rows if row.kernel_event.get("actual_lane_family") == "deep")
    escalations = sum(1 for row in rows if row.kernel_event.get("escalated"))
    codec_uses = sum(1 for row in rows if int(((row.kernel_event.get("context_reuse") or {}).get("cold_hits")) or 0) > 0)
    failures = sum(1 for row in rows if not row.passed)
    return {
        "count": count,
        "planned_fast_rate": round(planned_fast / count, 3),
        "planned_deep_rate": round(planned_deep / count, 3),
        "actual_fast_rate": round(actual_fast / count, 3),
        "actual_deep_rate": round(actual_deep / count, 3),
        "escalation_rate": round(escalations / count, 3),
        "codec_use_rate": round(codec_uses / count, 3),
        "failure_rate": round(failures / count, 3),
        "latency_ms": {"p50": _pct(latency_values, 0.5), "p95": _pct(latency_values, 0.95)},
        "compile_ms": {"p50": _pct(compile_values, 0.5), "p95": _pct(compile_values, 0.95)},
        "context_chars": {"avg": round(mean(context_values), 3), "p95": _pct(context_values, 0.95)},
    }


def _aggregate_operator_metrics(results: Iterable[CaseResult]) -> JsonDict:
    rows = list(results)
    if not rows:
        return {"count": 0, "latency_ms": {"p50": 0.0, "p95": 0.0}, "failure_rate": 0.0}
    values = [row.elapsed_ms for row in rows]
    failures = sum(1 for row in rows if not row.passed)
    return {
        "count": len(rows),
        "latency_ms": {"p50": _pct(values, 0.5), "p95": _pct(values, 0.95)},
        "failure_rate": round(failures / len(rows), 3),
    }


def _aggregate_by_dimension(results: Iterable[CaseResult], *, key_name: str) -> JsonDict:
    grouped: Dict[str, List[CaseResult]] = {}
    for row in results:
        value = getattr(row, key_name, "") or "unknown"
        grouped.setdefault(str(value), []).append(row)
    summary: Dict[str, JsonDict] = {}
    for value, rows in grouped.items():
        trace_rows = [row for row in rows if row.kernel_event]
        operator_rows = [row for row in rows if not row.kernel_event]
        failures = sum(1 for row in rows if not row.passed)
        summary[value] = {
            "count": len(rows),
            "failure_rate": round(failures / len(rows), 3) if rows else 0.0,
            "trace_metrics": _aggregate_trace_metrics(trace_rows),
            "operator_metrics": _aggregate_operator_metrics(operator_rows),
        }
    return summary


def _avg(values: List[float]) -> float:
    return round(mean(values), 3) if values else 0.0


def _drift_summary(results: Iterable[CaseResult]) -> JsonDict:
    trace_rows = [row for row in results if row.kernel_event]
    if not trace_rows:
        return {"trace_rows": 0, "overall_delta_ms": 0.0, "by_runtime": {}, "top_case_drift": []}

    def _delta(rows: List[CaseResult]) -> float:
        ordered = sorted(rows, key=lambda row: (row.iteration, row.case_id))
        values = [float(row.kernel_event.get("latency_ms") or 0.0) for row in ordered if row.kernel_event]
        if len(values) <= 1:
            return 0.0
        midpoint = max(1, len(values) // 2)
        return round(_avg(values[midpoint:]) - _avg(values[:midpoint]), 3)

    by_runtime: Dict[str, JsonDict] = {}
    runtime_rows: Dict[str, List[CaseResult]] = {}
    case_rows: Dict[str, List[CaseResult]] = {}
    for row in trace_rows:
        runtime_rows.setdefault(row.runtime or "unknown", []).append(row)
        case_rows.setdefault(row.case_id, []).append(row)

    for runtime, rows in runtime_rows.items():
        by_runtime[runtime] = {
            "count": len(rows),
            "latency_delta_ms": _delta(rows),
        }

    top_case_drift = [
        {
            "case_id": case_id,
            "runtime": rows[0].runtime if rows else "",
            "count": len(rows),
            "latency_delta_ms": _delta(rows),
        }
        for case_id, rows in case_rows.items()
        if len(rows) > 1
    ]
    top_case_drift.sort(key=lambda row: abs(float(row.get("latency_delta_ms") or 0.0)), reverse=True)

    return {
        "trace_rows": len(trace_rows),
        "overall_delta_ms": _delta(trace_rows),
        "by_runtime": by_runtime,
        "top_case_drift": top_case_drift[:8],
    }


def run_suite(corpus_path: str | Path, *, iterations: int = 1, case_ids: Optional[Iterable[str]] = None) -> JsonDict:
    corpus = load_corpus(corpus_path)
    allowed = set(case_ids or [])
    cases = [case for case in (corpus.get("cases") or []) if not allowed or str(case.get("id")) in allowed]
    results: List[CaseResult] = []
    with BenchmarkHarness(corpus) as harness:
        for iteration in range(1, max(1, int(iterations)) + 1):
            cortex_kernel_v2.reset_state()
            for case in cases:
                results.append(harness.run_case(case, iteration))

    trace_results = [row for row in results if row.kernel_event]
    operator_results = [row for row in results if not row.kernel_event]
    overall_failures = sum(1 for row in results if not row.passed)
    return {
        "schema_version": "cortex.kernel_v2.benchmark_results.v2",
        "environment": runtime_pressure.benchmark_environment_metadata(),
        "runtime_pressure": runtime_pressure.pressure_snapshot(),
        "corpus": {
            "name": corpus.get("name"),
            "path": str(corpus_path),
            "case_count": len(cases),
            "iterations": max(1, int(iterations)),
        },
        "summary": {
            "total_runs": len(results),
            "passed_runs": len(results) - overall_failures,
            "failed_runs": overall_failures,
            "failure_rate": round(overall_failures / len(results), 3) if results else 0.0,
            "trace_metrics": _aggregate_trace_metrics(trace_results),
            "operator_metrics": _aggregate_operator_metrics(operator_results),
            "drift": _drift_summary(trace_results),
            "by_runtime": _aggregate_by_dimension(results, key_name="runtime"),
            "by_surface": _aggregate_by_dimension(results, key_name="surface"),
        },
        "cases": [
            {
                "case_id": row.case_id,
                "iteration": row.iteration,
                "runtime": row.runtime,
                "surface": row.surface,
                "class": row.workload_class,
                "lane_tendency": row.lane_tendency,
                "elapsed_ms": row.elapsed_ms,
                "latency_slo_ms": row.latency_slo_ms,
                "passed": row.passed,
                "failures": row.failures,
                "status_code": row.status_code,
                "kernel_event": row.kernel_event,
                "check_results": row.check_results,
            }
            for row in results
        ],
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run the Cortex Kernel V2 benchmark corpus.")
    parser.add_argument("--corpus", required=True, help="Path to corpus JSON file")
    parser.add_argument("--iterations", type=int, default=1, help="Number of iterations to run")
    parser.add_argument("--output", required=True, help="Path to write JSON benchmark results")
    parser.add_argument("--case-id", action="append", default=[], help="Optional case id filter (repeatable)")
    args = parser.parse_args(argv)

    results = run_suite(args.corpus, iterations=args.iterations, case_ids=args.case_id or None)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, indent=2, sort_keys=True))
    print(json.dumps(results.get("summary") or {}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
