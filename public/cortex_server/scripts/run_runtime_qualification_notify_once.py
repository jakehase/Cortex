#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from cortex_server.benchmarks import runtime_qualification_supervisor as supervisor


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Wait for runtime qualification completion and print a human-readable completion summary.")
    parser.add_argument("--date", default="2026-04-01")
    parser.add_argument("--timeout-seconds", type=int, default=0)
    parser.add_argument("--interval-seconds", type=int, default=30)
    parser.add_argument("--mark-notified", action="store_true")
    args = parser.parse_args(argv)

    payload = supervisor.wait_for_completion(
        args.date,
        timeout_seconds=max(0, int(args.timeout_seconds or 0)),
        interval_seconds=max(1, int(args.interval_seconds or 30)),
        mark_complete_notification=bool(args.mark_notified),
    )
    if not payload.get("all_complete"):
        print(f"Qualification for {args.date} is not complete yet.")
        return 3

    summary = payload.get("completion_summary") or {}
    compact = summary.get("summary") or {}
    soak = compact.get("soak") or {}
    baseline = compact.get("baseline") or {}
    final = compact.get("final") or {}
    validation = compact.get("validation") or {}
    lines = [
        f"Runtime qualification complete for {args.date}.",
        f"Stages complete: {sum(1 for row in (summary.get('stage_checklist') or []) if row.get('completed'))}/{len(summary.get('stage_checklist') or [])}.",
        f"Winner config: {compact.get('winner') or 'unknown'}.",
        f"Failure rate: {baseline.get('failure_rate')} -> {final.get('failure_rate')}.",
        f"Trace p95: {baseline.get('trace_p95_ms')} ms -> {final.get('trace_p95_ms')} ms.",
        f"Soak avg trace p95: {soak.get('avg_trace_p95_ms')} ms across {soak.get('run_count')} run(s).",
        f"Validation returncode: {validation.get('returncode')}.",
        f"Final report: {summary.get('final_report_path')}",
    ]
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
