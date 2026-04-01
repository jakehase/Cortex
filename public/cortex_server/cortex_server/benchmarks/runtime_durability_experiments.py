from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional

JsonDict = Dict[str, Any]

DEFAULT_MATRIX = [
    {
        "id": "baseline_default_delegate",
        "description": "Reproduce pre-fix behavior: Chroma default embedding delegate (fresh ONNX session per embed call).",
        "env": {
            "CORTEX_LIBRARIAN_EMBEDDING_MODE": "default",
            "CORTEX_LIBRARIAN_ONNX_EXPLICIT_THREADS": "false",
            "CORTEX_RUNTIME_BENCHMARK_MODE": "false",
        },
    },
    {
        "id": "persistent_no_explicit_threads",
        "description": "Persistent ONNX embedding instance, but allow ONNX Runtime implicit thread behavior.",
        "env": {
            "CORTEX_LIBRARIAN_EMBEDDING_MODE": "persistent",
            "CORTEX_LIBRARIAN_ONNX_EXPLICIT_THREADS": "false",
            "CORTEX_RUNTIME_BENCHMARK_MODE": "false",
        },
    },
    {
        "id": "persistent_1x1",
        "description": "Persistent ONNX embedding with conservative single-thread session config.",
        "env": {
            "CORTEX_LIBRARIAN_EMBEDDING_MODE": "persistent",
            "CORTEX_LIBRARIAN_ONNX_EXPLICIT_THREADS": "true",
            "CORTEX_LIBRARIAN_ONNX_INTRA_OP_THREADS": "1",
            "CORTEX_LIBRARIAN_ONNX_INTER_OP_THREADS": "1",
            "CORTEX_LIBRARIAN_ONNX_ALLOW_SPINNING": "false",
            "CORTEX_RUNTIME_BENCHMARK_MODE": "false",
        },
    },
    {
        "id": "persistent_2x1",
        "description": "Persistent ONNX embedding with bounded low-thread session config.",
        "env": {
            "CORTEX_LIBRARIAN_EMBEDDING_MODE": "persistent",
            "CORTEX_LIBRARIAN_ONNX_EXPLICIT_THREADS": "true",
            "CORTEX_LIBRARIAN_ONNX_INTRA_OP_THREADS": "2",
            "CORTEX_LIBRARIAN_ONNX_INTER_OP_THREADS": "1",
            "CORTEX_LIBRARIAN_ONNX_ALLOW_SPINNING": "false",
            "CORTEX_RUNTIME_BENCHMARK_MODE": "false",
        },
    },
    {
        "id": "persistent_2x1_benchmark_mode",
        "description": "Persistent ONNX embedding with bounded threads and benchmark-mode conservative pressure handling.",
        "env": {
            "CORTEX_LIBRARIAN_EMBEDDING_MODE": "persistent",
            "CORTEX_LIBRARIAN_ONNX_EXPLICIT_THREADS": "true",
            "CORTEX_LIBRARIAN_ONNX_INTRA_OP_THREADS": "2",
            "CORTEX_LIBRARIAN_ONNX_INTER_OP_THREADS": "1",
            "CORTEX_LIBRARIAN_ONNX_ALLOW_SPINNING": "false",
            "CORTEX_RUNTIME_BENCHMARK_MODE": "true",
            "CORTEX_LATENCY_GOVERNOR_PREFETCH_MODE": "auto",
        },
    },
    {
        "id": "persistent_2x1_benchmark_mode_serial_prefetch",
        "description": "Persistent ONNX embedding with bounded threads, benchmark mode, and forced serial prefetch.",
        "env": {
            "CORTEX_LIBRARIAN_EMBEDDING_MODE": "persistent",
            "CORTEX_LIBRARIAN_ONNX_EXPLICIT_THREADS": "true",
            "CORTEX_LIBRARIAN_ONNX_INTRA_OP_THREADS": "2",
            "CORTEX_LIBRARIAN_ONNX_INTER_OP_THREADS": "1",
            "CORTEX_LIBRARIAN_ONNX_ALLOW_SPINNING": "false",
            "CORTEX_RUNTIME_BENCHMARK_MODE": "true",
            "CORTEX_LATENCY_GOVERNOR_PREFETCH_MODE": "serial",
        },
    },
    {
        "id": "persistent_2x2",
        "description": "Persistent ONNX embedding with slightly wider explicit thread counts.",
        "env": {
            "CORTEX_LIBRARIAN_EMBEDDING_MODE": "persistent",
            "CORTEX_LIBRARIAN_ONNX_EXPLICIT_THREADS": "true",
            "CORTEX_LIBRARIAN_ONNX_INTRA_OP_THREADS": "2",
            "CORTEX_LIBRARIAN_ONNX_INTER_OP_THREADS": "2",
            "CORTEX_LIBRARIAN_ONNX_ALLOW_SPINNING": "false",
            "CORTEX_RUNTIME_BENCHMARK_MODE": "false",
        },
    },
]


def _parse_warning_summary(stderr_text: str) -> JsonDict:
    lines = [line for line in (stderr_text or "").splitlines() if line.strip()]
    affinity_lines = [line for line in lines if "pthread_setaffinity_np failed" in line]
    error_codes = {}
    masks = {}
    for line in affinity_lines:
        code_match = re.search(r"error code: (\d+)", line)
        mask_match = re.search(r"mask: \{([^}]*)\}", line)
        if code_match:
            code = code_match.group(1)
            error_codes[code] = error_codes.get(code, 0) + 1
        if mask_match:
            mask = mask_match.group(1).strip()
            masks[mask] = masks.get(mask, 0) + 1
    return {
        "stderr_line_count": len(lines),
        "affinity_warning_count": len(affinity_lines),
        "error_codes": error_codes,
        "masks": masks,
        "sample": affinity_lines[:8],
    }



def _experiment_score(result: JsonDict) -> List[float]:
    warning_count = float(((result.get("warning_summary") or {}).get("affinity_warning_count")) or 0)
    failure_rate = float((((result.get("benchmark") or {}).get("summary") or {}).get("failure_rate")) or 0.0)
    trace_p95 = float((((((result.get("benchmark") or {}).get("summary") or {}).get("trace_metrics") or {}).get("latency_ms") or {}).get("p95")) or 0.0)
    drift = abs(float(((((result.get("benchmark") or {}).get("summary") or {}).get("drift") or {}).get("overall_delta_ms")) or 0.0))
    return [warning_count, failure_rate, trace_p95, drift]



def run_experiment(
    *,
    corpus: Path,
    output_dir: Path,
    experiment: JsonDict,
    iterations: int,
    case_ids: Optional[List[str]],
) -> JsonDict:
    output_path = output_dir / f"{experiment['id']}.benchmark.json"
    chroma_dir = output_dir / "chroma" / experiment["id"]
    if chroma_dir.exists():
        shutil.rmtree(chroma_dir)
    env = os.environ.copy()
    env.update({str(k): str(v) for k, v in dict(experiment.get("env") or {}).items()})
    env["CORTEX_CHROMA_DIR"] = str(chroma_dir)
    env.setdefault("PYTHONUNBUFFERED", "1")
    command = [
        sys.executable,
        "-m",
        "cortex_server.benchmarks.kernel_v2_benchmark",
        "--corpus",
        str(corpus),
        "--iterations",
        str(max(1, int(iterations))),
        "--output",
        str(output_path),
    ]
    for case_id in case_ids or []:
        command.extend(["--case-id", case_id])

    started = time.perf_counter()
    proc = subprocess.run(
        command,
        cwd=str(Path(__file__).resolve().parents[2]),
        env=env,
        capture_output=True,
        text=True,
    )
    duration_ms = round((time.perf_counter() - started) * 1000.0, 3)

    benchmark_payload: JsonDict = {}
    if output_path.exists():
        benchmark_payload = json.loads(output_path.read_text(encoding="utf-8"))

    result = {
        "experiment": {
            "id": experiment["id"],
            "description": experiment.get("description"),
            "env": dict(experiment.get("env") or {}),
            "chroma_dir": str(chroma_dir),
            "command": command,
        },
        "returncode": proc.returncode,
        "duration_ms": duration_ms,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "warning_summary": _parse_warning_summary(proc.stderr),
        "benchmark": benchmark_payload,
    }
    artifact_path = output_dir / f"{experiment['id']}.experiment.json"
    artifact_path.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    return result



def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run Cortex runtime durability experiment matrix.")
    parser.add_argument("--corpus", required=True, help="Benchmark corpus JSON path")
    parser.add_argument("--iterations", type=int, default=12, help="Iterations per experiment")
    parser.add_argument("--output-dir", required=True, help="Directory for experiment artifacts")
    parser.add_argument("--case-id", action="append", default=[], help="Optional benchmark case filter")
    args = parser.parse_args(argv)

    corpus = Path(args.corpus).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    results = [
        run_experiment(
            corpus=corpus,
            output_dir=output_dir,
            experiment=deepcopy(experiment),
            iterations=max(1, int(args.iterations)),
            case_ids=args.case_id or None,
        )
        for experiment in DEFAULT_MATRIX
    ]
    ranked = sorted(results, key=_experiment_score)
    summary = {
        "corpus": str(corpus),
        "iterations": max(1, int(args.iterations)),
        "experiments": [
            {
                "id": row["experiment"]["id"],
                "description": row["experiment"].get("description"),
                "returncode": row.get("returncode"),
                "duration_ms": row.get("duration_ms"),
                "warning_summary": row.get("warning_summary"),
                "failure_rate": ((((row.get("benchmark") or {}).get("summary") or {}).get("failure_rate")) if row.get("benchmark") else None),
                "trace_p95_ms": (((((row.get("benchmark") or {}).get("summary") or {}).get("trace_metrics") or {}).get("latency_ms") or {}).get("p95") if row.get("benchmark") else None),
                "trace_drift_delta_ms": ((((row.get("benchmark") or {}).get("summary") or {}).get("drift") or {}).get("overall_delta_ms") if row.get("benchmark") else None),
                "runtime_pressure": (row.get("benchmark") or {}).get("runtime_pressure"),
            }
            for row in ranked
        ],
        "winner": ranked[0]["experiment"]["id"] if ranked else None,
    }
    (output_dir / "index.json").write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
