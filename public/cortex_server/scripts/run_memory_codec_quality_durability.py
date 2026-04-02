#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any, Dict, List

from run_memory_codec_quality_benchmark import RunConfig, run_corpus


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def load_config(path: Path) -> RunConfig:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return RunConfig.from_payload(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run continuous memory/codec durability workload.")
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--config-json", required=True)
    parser.add_argument("--duration-seconds", type=int, default=1800)
    parser.add_argument("--round-output-dir", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--output-md", required=True)
    parser.add_argument("--pause-seconds", type=float, default=0.2)
    args = parser.parse_args()

    corpus_path = Path(args.corpus)
    config = load_config(Path(args.config_json))
    round_dir = Path(args.round_output_dir)
    round_dir.mkdir(parents=True, exist_ok=True)
    start = time.time()
    deadline = start + max(1, int(args.duration_seconds))
    rounds: List[Dict[str, Any]] = []
    round_count = 0

    while time.time() < deadline:
        round_count += 1
        round_path = round_dir / f"round_{round_count:04d}.json"
        result = run_corpus(corpus_path, round_path, config)
        rounds.append({
            "round": round_count,
            "recorded_at": _now_iso(),
            "run_path": str(round_path),
            "overall_pass_rate": float((result.get("aggregate") or {}).get("overall_pass_rate") or 0.0),
            "false_memory_rate": float((result.get("aggregate") or {}).get("false_memory_rate") or 0.0),
            "stale_memory_failure_rate": float((result.get("aggregate") or {}).get("stale_memory_failure_rate") or 0.0),
            "avg_packet_chars": float((((result.get("aggregate") or {}).get("packet_chars") or {}).get("avg") or 0.0)),
            "elapsed_seconds": float(result.get("elapsed_seconds") or 0.0),
        })
        if args.pause_seconds > 0:
            time.sleep(args.pause_seconds)

    finished = time.time()
    duration = int(round(finished - start))
    payload = {
        "schema_version": "cortex.memory_codec_quality.durability.v1",
        "generated_at": _now_iso(),
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start)),
        "completed_at": _now_iso(),
        "duration_seconds": duration,
        "round_count": round_count,
        "corpus_path": str(corpus_path),
        "config": {
            "name": config.name,
            "max_items_per_bucket": config.max_items_per_bucket,
            "packet_chars": config.packet_chars,
            "codec_globals": config.codec_globals or {},
        },
        "rounds": rounds[-50:],
        "summary": {
            "avg_pass_rate": round(sum(row["overall_pass_rate"] for row in rounds) / max(1, len(rounds)), 3),
            "avg_false_memory_rate": round(sum(row["false_memory_rate"] for row in rounds) / max(1, len(rounds)), 3),
            "avg_stale_memory_failure_rate": round(sum(row["stale_memory_failure_rate"] for row in rounds) / max(1, len(rounds)), 3),
            "avg_packet_chars": round(sum(row["avg_packet_chars"] for row in rounds) / max(1, len(rounds)), 3),
        },
    }
    out_json = Path(args.output_json)
    out_md = Path(args.output_md)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    lines = [
        "# Memory/Codec Durability Run\n\n",
        f"- generated_at: {payload['generated_at']}\n",
        f"- started_at: {payload['started_at']}\n",
        f"- completed_at: {payload['completed_at']}\n",
        f"- duration_seconds: {payload['duration_seconds']}\n",
        f"- round_count: {payload['round_count']}\n",
        f"- config: {json.dumps(payload['config'], ensure_ascii=False)}\n",
        f"- avg_pass_rate: {payload['summary']['avg_pass_rate']}\n",
        f"- avg_false_memory_rate: {payload['summary']['avg_false_memory_rate']}\n",
        f"- avg_stale_memory_failure_rate: {payload['summary']['avg_stale_memory_failure_rate']}\n",
        f"- avg_packet_chars: {payload['summary']['avg_packet_chars']}\n",
        "\n## Last rounds\n",
    ]
    for row in payload["rounds"][-10:]:
        lines.append(
            f"- round={row['round']} pass={row['overall_pass_rate']} false={row['false_memory_rate']} stale={row['stale_memory_failure_rate']} avg_packet_chars={row['avg_packet_chars']} elapsed_seconds={row['elapsed_seconds']}\n"
        )
    out_md.write_text("".join(lines), encoding="utf-8")
    print(json.dumps({"output_json": str(out_json), "duration_seconds": duration, "round_count": round_count}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
