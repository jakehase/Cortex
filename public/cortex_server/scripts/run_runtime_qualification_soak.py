#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
import time
import uuid
from collections import Counter
from pathlib import Path
from statistics import mean
from typing import Any, Dict, List

JsonDict = Dict[str, Any]


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def pct_delta(first: float, last: float) -> float:
    if not first:
        return round(last - first, 3)
    return round(((last - first) / first) * 100.0, 3)


def avg(values: List[float]) -> float:
    return round(float(mean(values)), 3) if values else 0.0


def load_json(path: Path) -> JsonDict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object in {path}")
    return payload


def validate_round(result: JsonDict) -> None:
    """Reject empty or fabricated benchmark output before it enters a soak."""
    summary = result.get("summary")
    cases = result.get("cases")
    if not isinstance(summary, dict) or not isinstance(cases, list) or not cases:
        raise ValueError("benchmark report requires a summary and non-empty cases")
    total_runs = summary.get("total_runs")
    if not isinstance(total_runs, int) or isinstance(total_runs, bool) or total_runs <= 0:
        raise ValueError("benchmark report total_runs must be a positive integer")
    if total_runs < len(cases):
        raise ValueError("benchmark report total_runs is smaller than its case count")


def atomic_write(path: Path, content: str) -> None:
    """Replace a report only after its complete contents reach stable storage."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def summarize_round(result: JsonDict, *, round_index: int, started_at: float, finished_at: float) -> JsonDict:
    summary = result.get("summary") or {}
    trace = summary.get("trace_metrics") or {}
    operator = summary.get("operator_metrics") or {}
    by_runtime = summary.get("by_runtime") or {}
    failures = [row for row in (result.get("cases") or []) if not row.get("passed")]
    return {
        "round": round_index,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_at)),
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(finished_at)),
        "wall_seconds": round(finished_at - started_at, 3),
        "total_runs": int(summary.get("total_runs") or 0),
        "failed_runs": int(summary.get("failed_runs") or 0),
        "failure_rate": float(summary.get("failure_rate") or 0.0),
        "trace_latency_p50_ms": float(((trace.get("latency_ms") or {}).get("p50")) or 0.0),
        "trace_latency_p95_ms": float(((trace.get("latency_ms") or {}).get("p95")) or 0.0),
        "operator_latency_p95_ms": float(((operator.get("latency_ms") or {}).get("p95")) or 0.0),
        "trace_drift_delta_ms": float(((summary.get("drift") or {}).get("overall_delta_ms")) or 0.0),
        "runtime_pressure": result.get("runtime_pressure") or {},
        "failing_case_ids": sorted({str(row.get("case_id") or "") for row in failures if row.get("case_id")}),
        "by_runtime": {
            str(runtime): {
                "count": int((row or {}).get("count") or 0),
                "failure_rate": float((row or {}).get("failure_rate") or 0.0),
                "trace_p95_ms": float((((row or {}).get("trace_metrics") or {}).get("latency_ms") or {}).get("p95") or 0.0),
                "operator_p95_ms": float((((row or {}).get("operator_metrics") or {}).get("latency_ms") or {}).get("p95") or {}).get("p95") if False else float((((row or {}).get("operator_metrics") or {}).get("latency_ms") or {}).get("p95") or 0.0),
            }
            for runtime, row in by_runtime.items()
        },
    }


def aggregate_soak(rounds: List[JsonDict], *, config_id: str, duration_seconds: int, corpus: str, iterations_per_round: int) -> JsonDict:
    fail_counter: Counter[str] = Counter()
    for row in rounds:
        fail_counter.update(row.get("failing_case_ids") or [])
    trace_p95 = [float(row.get("trace_latency_p95_ms") or 0.0) for row in rounds]
    operator_p95 = [float(row.get("operator_latency_p95_ms") or 0.0) for row in rounds]
    drift_values = [float(row.get("trace_drift_delta_ms") or 0.0) for row in rounds]
    runtime_names = sorted({name for row in rounds for name in (row.get("by_runtime") or {}).keys()})
    by_runtime: JsonDict = {}
    for runtime in runtime_names:
        runtime_trace = [float(((row.get("by_runtime") or {}).get(runtime) or {}).get("trace_p95_ms") or 0.0) for row in rounds]
        runtime_failure = [float(((row.get("by_runtime") or {}).get(runtime) or {}).get("failure_rate") or 0.0) for row in rounds]
        by_runtime[runtime] = {
            "rounds": len(runtime_trace),
            "trace_p95_ms": {
                "avg": avg(runtime_trace),
                "first": runtime_trace[0] if runtime_trace else 0.0,
                "last": runtime_trace[-1] if runtime_trace else 0.0,
                "delta_pct": pct_delta(runtime_trace[0], runtime_trace[-1]) if runtime_trace else 0.0,
            },
            "failure_rate": {
                "avg": avg(runtime_failure),
                "first": runtime_failure[0] if runtime_failure else 0.0,
                "last": runtime_failure[-1] if runtime_failure else 0.0,
            },
        }
    return {
        "schema_version": "cortex.runtime.qualification.soak.v1",
        "config_id": config_id,
        "corpus": corpus,
        "duration_seconds": duration_seconds,
        "iterations_per_round": iterations_per_round,
        "started_at": rounds[0]["started_at"] if rounds else None,
        "finished_at": rounds[-1]["finished_at"] if rounds else None,
        "round_count": len(rounds),
        "rounds": rounds,
        "summary": {
            "avg_trace_p95_ms": avg(trace_p95),
            "avg_operator_p95_ms": avg(operator_p95),
            "avg_trace_drift_delta_ms": avg(drift_values),
            "first_trace_p95_ms": trace_p95[0] if trace_p95 else 0.0,
            "last_trace_p95_ms": trace_p95[-1] if trace_p95 else 0.0,
            "trace_p95_delta_pct": pct_delta(trace_p95[0], trace_p95[-1]) if trace_p95 else 0.0,
            "first_operator_p95_ms": operator_p95[0] if operator_p95 else 0.0,
            "last_operator_p95_ms": operator_p95[-1] if operator_p95 else 0.0,
            "operator_p95_delta_pct": pct_delta(operator_p95[0], operator_p95[-1]) if operator_p95 else 0.0,
            "peak_trace_p95_ms": max(trace_p95) if trace_p95 else 0.0,
            "peak_operator_p95_ms": max(operator_p95) if operator_p95 else 0.0,
            "failure_case_counts": fail_counter.most_common(),
            "by_runtime": by_runtime,
        },
    }


def render_markdown(report: JsonDict) -> str:
    summary = report.get("summary") or {}
    lines = [
        f"# Runtime Qualification Soak — {report.get('config_id')}",
        "",
        f"- Started: {report.get('started_at')}",
        f"- Finished: {report.get('finished_at')}",
        f"- Duration seconds: {report.get('duration_seconds')}",
        f"- Corpus: `{report.get('corpus')}`",
        f"- Iterations per round: {report.get('iterations_per_round')}",
        f"- Round count: {report.get('round_count')}",
        f"- Avg trace p95 ms: {summary.get('avg_trace_p95_ms')}",
        f"- Avg operator p95 ms: {summary.get('avg_operator_p95_ms')}",
        f"- Avg trace drift delta ms: {summary.get('avg_trace_drift_delta_ms')}",
        f"- Trace p95 delta pct: {summary.get('trace_p95_delta_pct')}",
        f"- Operator p95 delta pct: {summary.get('operator_p95_delta_pct')}",
        "",
        "## Failure case counts",
        "",
    ]
    failure_case_counts = summary.get("failure_case_counts") or []
    if not failure_case_counts:
        lines.append("- none")
    else:
        for case_id, count in failure_case_counts:
            lines.append(f"- {case_id}: {count}")
    lines += ["", "## By runtime", ""]
    for runtime, row in sorted((summary.get("by_runtime") or {}).items()):
        trace = row.get("trace_p95_ms") or {}
        failure = row.get("failure_rate") or {}
        lines.append(
            f"- {runtime}: trace_p95 avg={trace.get('avg')} first={trace.get('first')} last={trace.get('last')} delta_pct={trace.get('delta_pct')} | failure avg={failure.get('avg')}"
        )
    lines += ["", "## Round summaries", ""]
    for row in report.get("rounds") or []:
        lines.append(
            f"- round {row.get('round')}: wall_s={row.get('wall_seconds')} failure_rate={row.get('failure_rate')} trace_p95_ms={row.get('trace_latency_p95_ms')} operator_p95_ms={row.get('operator_latency_p95_ms')} failures={','.join(row.get('failing_case_ids') or []) or 'none'}"
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a long-horizon runtime qualification soak.")
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--output-prefix", required=True, help="Writes <prefix>.json and <prefix>.md")
    parser.add_argument("--duration-seconds", type=int, default=1800)
    parser.add_argument("--iterations-per-round", type=int, default=3)
    parser.add_argument("--config-id", default="unknown")
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--stage", default=None)
    args = parser.parse_args()

    output_prefix = Path(args.output_prefix)
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    rounds: List[JsonDict] = []
    started = time.time()
    monotonic_started = time.monotonic()
    requested_duration = max(1, int(args.duration_seconds))
    deadline = monotonic_started + requested_duration
    round_index = 0

    while True:
        round_index += 1
        round_started = time.time()
        with tempfile.TemporaryDirectory(prefix="cortex-qual-soak-") as tmp_dir:
            tmp_json = Path(tmp_dir) / "round.json"
            cmd = [
                "python3",
                "-m",
                "cortex_server.benchmarks.kernel_v2_benchmark",
                "--corpus",
                args.corpus,
                "--iterations",
                str(max(1, int(args.iterations_per_round))),
                "--output",
                str(tmp_json),
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, check=True, env=os.environ.copy())
            result = load_json(tmp_json)
            validate_round(result)
            finished = time.time()
            row = summarize_round(result, round_index=round_index, started_at=round_started, finished_at=finished)
            row["command"] = cmd
            row["stdout_tail"] = (proc.stdout or "")[-4000:]
            row["stderr_tail"] = (proc.stderr or "")[-4000:]
            rounds.append(row)
        if time.monotonic() >= deadline:
            break

    report = aggregate_soak(
        rounds,
        config_id=args.config_id,
        duration_seconds=max(1, int(args.duration_seconds)),
        corpus=args.corpus,
        iterations_per_round=max(1, int(args.iterations_per_round)),
    )
    report["run_id"] = args.run_id or uuid.uuid4().hex
    report["stage"] = args.stage
    report["date"] = os.getenv("CORTEX_RUNTIME_QUALIFICATION_DATE")
    report["requested_duration_seconds"] = requested_duration
    report["duration_seconds"] = round(max(0.0, time.monotonic() - monotonic_started), 3)
    report["successful_exit"] = True
    atomic_write(output_prefix.with_suffix(".json"), json.dumps(report, indent=2) + "\n")
    atomic_write(output_prefix.with_suffix(".md"), render_markdown(report))
    print(json.dumps(report.get("summary") or {}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
