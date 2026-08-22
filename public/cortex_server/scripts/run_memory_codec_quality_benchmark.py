#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import sys
import tempfile
import time
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass, asdict
from pathlib import Path
from statistics import mean
from typing import Any, Dict, Iterable, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from cortex_server.modules import codec_policy  # noqa: E402
from cortex_server.modules import cortex_codec as codec_module  # noqa: E402
from cortex_server.modules.cortex_codec import build_codec_state, compress_codec_for_prompt  # noqa: E402


JsonDict = Dict[str, Any]


DEFAULT_MATRIX: List[JsonDict] = [
    {"name": "cfg_legacy_roomy", "max_items_per_bucket": 8, "packet_chars": 420},
    {"name": "cfg_roomy_6", "max_items_per_bucket": 6, "packet_chars": 420},
    {"name": "cfg_compact_6", "max_items_per_bucket": 6, "packet_chars": 320},
    {"name": "cfg_compact_4", "max_items_per_bucket": 4, "packet_chars": 320},
    {"name": "cfg_tight_4", "max_items_per_bucket": 4, "packet_chars": 220},
    {"name": "cfg_tight_3", "max_items_per_bucket": 3, "packet_chars": 220},
    {"name": "cfg_roomy_3", "max_items_per_bucket": 3, "packet_chars": 420},
    {"name": "cfg_balanced_mid", "max_items_per_bucket": 5, "packet_chars": 280},
]


@dataclass
class RunConfig:
    name: str
    max_items_per_bucket: int = 8
    packet_chars: int = 320
    codec_globals: Optional[Dict[str, Any]] = None

    @classmethod
    def from_payload(cls, payload: JsonDict) -> "RunConfig":
        return cls(
            name=str(payload.get("name") or "unnamed_config"),
            max_items_per_bucket=max(1, int(payload.get("max_items_per_bucket", 8) or 8)),
            packet_chars=max(120, int(payload.get("packet_chars", 320) or 320)),
            codec_globals=dict(payload.get("codec_globals") or {}) if isinstance(payload.get("codec_globals"), dict) else {},
        )


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _packet_sections(packet: str) -> List[str]:
    out: List[str] = []
    for line in str(packet or "").splitlines():
        if ":" not in line:
            continue
        out.append(line.split(":", 1)[0].strip())
    return out


def _policy_state_path() -> Path:
    return REPO_ROOT / "artifacts" / "memory_codec_quality" / "tmp_codec_policy_state.json"


@contextmanager
def isolated_policy_state() -> Iterable[Path]:
    original_path = getattr(codec_policy, "_STATE_PATH", None)
    with tempfile.TemporaryDirectory(prefix="codec_policy_eval_") as td:
        path = Path(td) / "codec_policy_state.json"
        codec_policy._STATE_PATH = path
        try:
            if path.exists():
                path.unlink()
        except Exception:
            pass
        codec_policy._SESSION_LAST_TURN.clear()
        yield path
        codec_policy._SESSION_LAST_TURN.clear()
        if original_path is not None:
            codec_policy._STATE_PATH = original_path


@contextmanager
def override_codec_globals(overrides: Dict[str, Any]) -> Iterable[None]:
    saved: Dict[str, Any] = {}
    try:
        for key, value in (overrides or {}).items():
            if hasattr(codec_module, key):
                saved[key] = getattr(codec_module, key)
                setattr(codec_module, key, value)
        yield
    finally:
        for key, value in saved.items():
            setattr(codec_module, key, value)


@contextmanager
def isolated_codec_state() -> Iterable[None]:
    saved_state = copy.deepcopy(codec_module._SESSION_CODEC_STATE)
    saved_persist = copy.deepcopy(codec_module._SESSION_CODEC_PERSIST)
    try:
        codec_module._SESSION_CODEC_STATE.clear()
        codec_module._SESSION_CODEC_PERSIST.clear()
        yield
    finally:
        codec_module._SESSION_CODEC_STATE.clear()
        codec_module._SESSION_CODEC_STATE.update(saved_state)
        codec_module._SESSION_CODEC_PERSIST.clear()
        codec_module._SESSION_CODEC_PERSIST.update(saved_persist)


@contextmanager
def evaluation_context(config: RunConfig) -> Iterable[None]:
    with isolated_codec_state(), isolated_policy_state(), override_codec_globals(config.codec_globals or {}):
        yield


def _contains_all(haystack: str, needles: List[str]) -> Tuple[bool, List[str]]:
    missing = [needle for needle in needles if needle not in haystack]
    return (not missing), missing


def _contains_none(haystack: str, needles: List[str]) -> Tuple[bool, List[str]]:
    present = [needle for needle in needles if needle in haystack]
    return (not present), present


def _bucket_items(state: JsonDict, bucket: str) -> List[str]:
    if bucket == "preferences":
        return list((((state.get("identity_state") or {}).get("preferences")) or []))
    if bucket == "active_projects":
        return list((((state.get("project_state") or {}).get("active_projects")) or []))
    if bucket == "active_goals":
        return list((((state.get("project_state") or {}).get("active_goals")) or []))
    if bucket == "open_loops":
        return list((((state.get("project_state") or {}).get("open_loops")) or []))
    if bucket == "durable_facts":
        return list((((state.get("world_state") or {}).get("durable_facts")) or []))
    if bucket == "patterns":
        return list((((state.get("failure_state") or {}).get("patterns")) or []))
    if bucket == "lessons":
        return list((((state.get("failure_state") or {}).get("lessons")) or []))
    return []


def _bucket_meta(state: JsonDict, bucket: str, text: str) -> JsonDict:
    utility = ((state.get("utility_state") or {}).get("bucket_scores") or {}).get(bucket) or {}
    return dict(utility.get(str(text or "").lower()) or {}) if isinstance(utility, dict) else {}


def _promoted_texts(state: JsonDict, bucket: str) -> List[str]:
    rows = (((state.get("promotion_state") or {}).get("promoted") or {}).get(bucket) or [])
    return [str(row.get("text") or "") for row in rows if isinstance(row, dict)]


def _apply_mutation(state: JsonDict, mutation: JsonDict) -> JsonDict:
    if not isinstance(mutation, dict):
        return state
    out = copy.deepcopy(state)
    action = str(mutation.get("action") or "")
    if action == "age_entries":
        bucket = str(mutation.get("bucket") or "")
        when = str(mutation.get("last_seen_at") or "")
        texts = [str(item) for item in (mutation.get("texts") or []) if str(item).strip()]
        utility = (((out.get("utility_state") or {}).get("bucket_scores") or {}).get(bucket) or {})
        if isinstance(utility, dict):
            for text in texts:
                row = utility.get(text.lower())
                if isinstance(row, dict):
                    row["last_seen_at"] = when
                    codec_module._annotate_utility_entry(row, reference_at=out.get("generated_at") or "")
            if isinstance(out.get("utility_state"), dict):
                out["utility_state"]["summary"] = codec_module._utility_summary((out.get("utility_state") or {}).get("bucket_scores") or {})
            out["promotion_state"] = codec_module._build_promotion_state(out)
            out["schema_state"] = codec_module._export_schema_state(out)
    return out


def _execute_steps(case: JsonDict, config: RunConfig) -> JsonDict:
    state: JsonDict = {}
    steps = case.get("steps") if isinstance(case.get("steps"), list) and case.get("steps") else [{"events": case.get("events") or []}]
    for step in steps:
        if not isinstance(step, dict):
            continue
        for mutation in (step.get("before") or []):
            state = _apply_mutation(state, mutation)
        events = [event for event in (step.get("events") or []) if isinstance(event, dict)]
        state = build_codec_state(events, previous_state=state, max_items_per_bucket=config.max_items_per_bucket)
        for mutation in (step.get("after") or []):
            state = _apply_mutation(state, mutation)
    return state


def _execute_policy(case: JsonDict) -> JsonDict:
    training = case.get("policy_training") or []
    for item in training:
        if not isinstance(item, dict):
            continue
        op = str(item.get("op") or "evaluation")
        if op == "evaluation":
            codec_policy.observe_codec_evaluation(
                query=str(item.get("query") or ""),
                winner=str(item.get("winner") or ""),
                judge_method=str(item.get("judge_method") or "heuristic"),
                judge_confidence=float(item.get("judge_confidence", 0.7) or 0.7),
                session_key=str(item.get("session_key") or "") or None,
            )
        elif op == "outcome":
            codec_policy.observe_codec_outcome(
                query=str(item.get("query") or ""),
                policy_label=str(item.get("policy_label") or ""),
                execution_success=bool(item.get("execution_success", True)),
                user_correction=bool(item.get("user_correction", False)),
                recovery_needed=bool(item.get("recovery_needed", False)),
                validator_pass=bool(item.get("validator_pass", True)),
                session_key=str(item.get("session_key") or "") or None,
                note=str(item.get("note") or ""),
            )
    query = str(case.get("policy_query") or case.get("query") or "")
    return codec_policy.get_codec_policy_for_query(query) if query else {}


def _check_case(case: JsonDict, state: JsonDict, packet: str, policy: JsonDict, elapsed_ms: float, config: RunConfig) -> JsonDict:
    rubric = case.get("rubric") if isinstance(case.get("rubric"), dict) else {}
    failures: List[JsonDict] = []

    def fail(kind: str, detail: Any, cluster: Optional[str] = None) -> None:
        failures.append({
            "kind": kind,
            "detail": detail,
            "cluster": cluster or kind,
        })

    ok, missing = _contains_all(packet, [str(v) for v in (rubric.get("packet_contains") or [])])
    if not ok:
        fail("packet_missing", missing, cluster=f"{case.get('category')}::packet_missing")
    ok, present = _contains_none(packet, [str(v) for v in (rubric.get("packet_absent") or [])])
    if not ok:
        fail("packet_unexpected", present, cluster=f"{case.get('category')}::packet_unexpected")

    for bucket in (rubric.get("state_contains") or {}):
        needles = [str(v) for v in ((rubric.get("state_contains") or {}).get(bucket) or [])]
        items = _bucket_items(state, bucket)
        missing_items = [needle for needle in needles if needle not in items]
        if missing_items:
            fail("state_missing", {"bucket": bucket, "missing": missing_items}, cluster=f"{case.get('category')}::{bucket}::missing")

    for bucket in (rubric.get("state_absent") or {}):
        needles = [str(v) for v in ((rubric.get("state_absent") or {}).get(bucket) or [])]
        items = _bucket_items(state, bucket)
        present_items = [needle for needle in needles if needle in items]
        if present_items:
            fail("state_unexpected", {"bucket": bucket, "present": present_items}, cluster=f"{case.get('category')}::{bucket}::unexpected")

    for bucket in (rubric.get("promoted_contains") or {}):
        needles = [str(v) for v in ((rubric.get("promoted_contains") or {}).get(bucket) or [])]
        promoted = _promoted_texts(state, bucket)
        missing_promoted = [needle for needle in needles if needle not in promoted]
        if missing_promoted:
            fail("promotion_missing", {"bucket": bucket, "missing": missing_promoted}, cluster=f"{case.get('category')}::{bucket}::promotion_missing")

    for row in (rubric.get("freshness") or []):
        if not isinstance(row, dict):
            continue
        bucket = str(row.get("bucket") or "")
        text = str(row.get("text") or "")
        expected = str(row.get("equals") or "")
        meta = _bucket_meta(state, bucket, text)
        observed = str(meta.get("freshness") or "")
        if observed != expected:
            fail("freshness_mismatch", {"bucket": bucket, "text": text, "expected": expected, "observed": observed}, cluster=f"{case.get('category')}::{bucket}::freshness")

    if "policy_action" in rubric:
        observed = str(policy.get("action") or "")
        expected = str(rubric.get("policy_action") or "")
        if observed != expected:
            fail("policy_action", {"expected": expected, "observed": observed}, cluster=f"{case.get('category')}::policy_action")
    if "policy_should_inject" in rubric:
        observed = bool(policy.get("should_inject"))
        expected = bool(rubric.get("policy_should_inject"))
        if observed != expected:
            fail("policy_should_inject", {"expected": expected, "observed": observed}, cluster=f"{case.get('category')}::policy_should_inject")

    packet_chars = len(packet)
    max_packet = int(rubric.get("packet_chars_max", config.packet_chars) or config.packet_chars)
    if packet_chars > max_packet:
        fail("packet_budget", {"observed": packet_chars, "max": max_packet}, cluster=f"{case.get('category')}::packet_budget")

    raw_chars = int(((state.get("compression") or {}).get("raw_characters") or 0) or 0)
    ratio = round(raw_chars / max(1, packet_chars), 3) if packet_chars else 0.0
    if "ratio_min" in rubric and ratio < float(rubric.get("ratio_min") or 0.0):
        fail("compression_ratio", {"observed": ratio, "min": float(rubric.get("ratio_min") or 0.0)}, cluster=f"{case.get('category')}::compression_ratio")

    memory_sections = _packet_sections(packet)
    failure_modes = [str(item) for item in (case.get("expected_failure_modes") or [])]
    false_memory = any(str(f.get("kind") or "") in {"packet_unexpected", "state_unexpected"} for f in failures) or "false_memory" in failure_modes
    stale_failure = any(str(f.get("kind") or "") == "freshness_mismatch" for f in failures) or "stale_memory" in failure_modes
    omission = any(str(f.get("kind") or "") in {"packet_missing", "state_missing", "promotion_missing"} for f in failures)
    category = str(case.get("category") or "uncategorized")
    continuity_success = (not failures) if category not in {"false_memory_trap"} else (len(failures) == 0)

    codec_expected = category in {"codec_helpful", "codec_harmful"}
    codec_used = bool(packet.strip()) and ("policy_action" not in rubric or bool(policy.get("should_inject", True)))
    codec_overuse = category == "codec_harmful" and codec_used
    codec_underuse = category == "codec_helpful" and not codec_used

    return {
        "id": str(case.get("id") or ""),
        "title": str(case.get("title") or ""),
        "category": category,
        "surface": str(case.get("surface") or "codec_state"),
        "passed": len(failures) == 0,
        "quality_label": "pass" if not failures else ("soft_fail" if len(failures) == 1 else "fail"),
        "failures": failures,
        "failure_count": len(failures),
        "memory_sources_used": memory_sections,
        "packet_chars": packet_chars,
        "raw_state_chars": raw_chars,
        "compression_ratio": ratio,
        "latency_ms": round(elapsed_ms, 3),
        "continuity_success": continuity_success,
        "false_memory_indicator": bool(false_memory),
        "stale_memory_indicator": bool(stale_failure),
        "omission_indicator": bool(omission),
        "codec_used": bool(codec_used),
        "codec_overuse_indicator": bool(codec_overuse),
        "codec_underuse_indicator": bool(codec_underuse),
        "policy": policy,
        "packet": packet,
        "summary": str(state.get("summary") or ""),
        "state_excerpt": {
            "preferences": _bucket_items(state, "preferences")[:4],
            "active_projects": _bucket_items(state, "active_projects")[:4],
            "active_goals": _bucket_items(state, "active_goals")[:4],
            "open_loops": _bucket_items(state, "open_loops")[:4],
            "durable_facts": _bucket_items(state, "durable_facts")[:4],
            "patterns": _bucket_items(state, "patterns")[:4],
            "lessons": _bucket_items(state, "lessons")[:4],
        },
        "promotion_summary": ((state.get("promotion_state") or {}).get("summary") or {}),
    }


def run_corpus(corpus_path: Path, output_path: Path, config: RunConfig) -> JsonDict:
    payload = json.loads(corpus_path.read_text(encoding="utf-8"))
    cases = payload.get("cases") if isinstance(payload, dict) else payload
    rows: List[JsonDict] = []
    started = time.time()
    with evaluation_context(config):
        for case in cases or []:
            if not isinstance(case, dict):
                continue
            t0 = time.perf_counter()
            state = _execute_steps(case, config)
            packet = compress_codec_for_prompt(state, max_chars=config.packet_chars)
            policy = _execute_policy(case) if case.get("policy_training") else {}
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            rows.append(_check_case(case, state, packet, policy, elapsed_ms, config))
    aggregate = summarize_results(rows)
    out = {
        "schema_version": "cortex.memory_codec_quality.run.v1",
        "generated_at": _now_iso(),
        "corpus_path": str(corpus_path),
        "corpus_fingerprint": hashlib.sha256(corpus_path.read_bytes()).hexdigest()[:16],
        "config": asdict(config),
        "case_count": len(rows),
        "elapsed_seconds": round(time.time() - started, 3),
        "results": rows,
        "aggregate": aggregate,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


def summarize_results(rows: List[JsonDict]) -> JsonDict:
    total = len(rows)
    passed = sum(1 for row in rows if row.get("passed"))
    by_category: Dict[str, List[JsonDict]] = defaultdict(list)
    for row in rows:
        by_category[str(row.get("category") or "uncategorized")].append(row)

    def rate(filter_fn) -> float:
        subset = [row for row in rows if filter_fn(row)]
        if not subset:
            return 0.0
        return round(sum(1 for row in subset if row.get("passed")) / len(subset), 3)

    return {
        "overall_pass_rate": round(passed / max(1, total), 3),
        "false_memory_rate": round(sum(1 for row in rows if row.get("false_memory_indicator") and not row.get("passed")) / max(1, total), 3),
        "stale_memory_failure_rate": round(sum(1 for row in rows if row.get("stale_memory_indicator") and not row.get("passed")) / max(1, total), 3),
        "omission_rate": round(sum(1 for row in rows if row.get("omission_indicator") and not row.get("passed")) / max(1, total), 3),
        "preference_recall_accuracy": rate(lambda row: row.get("category") in {"preference_memory", "preference_override"}),
        "open_loop_continuity_accuracy": rate(lambda row: row.get("category") in {"open_loop_continuity", "cross_turn_followup", "long_sequence_durability"}),
        "codec_overuse_rate": round(sum(1 for row in rows if row.get("codec_overuse_indicator")) / max(1, total), 3),
        "codec_underuse_rate": round(sum(1 for row in rows if row.get("codec_underuse_indicator")) / max(1, total), 3),
        "latency_ms": {
            "avg": round(mean([float(row.get("latency_ms") or 0.0) for row in rows]) if rows else 0.0, 3),
            "p95_approx": round(sorted([float(row.get("latency_ms") or 0.0) for row in rows])[min(len(rows) - 1, max(0, int(len(rows) * 0.95) - 1))] if rows else 0.0, 3),
            "max": round(max([float(row.get("latency_ms") or 0.0) for row in rows] or [0.0]), 3),
        },
        "packet_chars": {
            "avg": round(mean([float(row.get("packet_chars") or 0.0) for row in rows]) if rows else 0.0, 3),
            "max": int(max([int(row.get("packet_chars") or 0) for row in rows] or [0])),
        },
        "compression_ratio": {
            "avg": round(mean([float(row.get("compression_ratio") or 0.0) for row in rows]) if rows else 0.0, 3),
            "max": round(max([float(row.get("compression_ratio") or 0.0) for row in rows] or [0.0]), 3),
        },
        "by_category": {
            category: {
                "count": len(items),
                "pass_rate": round(sum(1 for row in items if row.get("passed")) / max(1, len(items)), 3),
            }
            for category, items in sorted(by_category.items())
        },
    }


def _comparison_rows(run_paths: List[Path]) -> List[JsonDict]:
    rows = []
    for path in run_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        agg = payload.get("aggregate") or {}
        cfg = payload.get("config") or {}
        rows.append({
            "name": cfg.get("name") or path.stem,
            "path": str(path),
            "overall_pass_rate": float(agg.get("overall_pass_rate") or 0.0),
            "false_memory_rate": float(agg.get("false_memory_rate") or 0.0),
            "stale_memory_failure_rate": float(agg.get("stale_memory_failure_rate") or 0.0),
            "omission_rate": float(agg.get("omission_rate") or 0.0),
            "preference_recall_accuracy": float(agg.get("preference_recall_accuracy") or 0.0),
            "open_loop_continuity_accuracy": float(agg.get("open_loop_continuity_accuracy") or 0.0),
            "codec_overuse_rate": float(agg.get("codec_overuse_rate") or 0.0),
            "codec_underuse_rate": float(agg.get("codec_underuse_rate") or 0.0),
            "avg_latency_ms": float(((agg.get("latency_ms") or {}).get("avg") or 0.0)),
            "avg_packet_chars": float(((agg.get("packet_chars") or {}).get("avg") or 0.0)),
            "avg_compression_ratio": float(((agg.get("compression_ratio") or {}).get("avg") or 0.0)),
            "config": cfg,
        })
    return rows


def _winner_score(row: JsonDict) -> float:
    return round(
        (0.42 * float(row.get("overall_pass_rate") or 0.0))
        + (0.14 * float(row.get("preference_recall_accuracy") or 0.0))
        + (0.14 * float(row.get("open_loop_continuity_accuracy") or 0.0))
        + (0.10 * float(row.get("avg_compression_ratio") or 0.0) / 4.0)
        - (0.10 * float(row.get("false_memory_rate") or 0.0))
        - (0.04 * float(row.get("stale_memory_failure_rate") or 0.0))
        - (0.03 * float(row.get("codec_overuse_rate") or 0.0))
        - (0.03 * float(row.get("codec_underuse_rate") or 0.0))
        - (0.02 * min(1.0, float(row.get("avg_latency_ms") or 0.0) / 250.0)),
        3,
    )


def run_matrix(corpus_path: Path, output_dir: Path, configs: List[RunConfig]) -> JsonDict:
    output_dir.mkdir(parents=True, exist_ok=True)
    experiments: List[JsonDict] = []
    run_paths: List[Path] = []
    for config in configs:
        run_path = output_dir / f"{config.name}.memory_codec.json"
        run_corpus(corpus_path, run_path, config)
        run_paths.append(run_path)
    rows = _comparison_rows(run_paths)
    for row in rows:
        row["winner_score"] = _winner_score(row)
    rows.sort(key=lambda row: (float(row.get("winner_score") or 0.0), float(row.get("overall_pass_rate") or 0.0), -float(row.get("false_memory_rate") or 0.0)), reverse=True)
    winner = rows[0]["name"] if rows else None
    experiments = rows
    index = {
        "schema_version": "cortex.memory_codec_quality.experiments.v1",
        "generated_at": _now_iso(),
        "corpus_path": str(corpus_path),
        "experiments": experiments,
        "winner": winner,
    }
    (output_dir / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")
    return index


def build_triage(run_paths: List[Path], output_json: Path, output_md: Path) -> JsonDict:
    clusters: Dict[str, JsonDict] = {}
    for path in run_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        run_name = str(((payload.get("config") or {}).get("name") or path.stem))
        for row in (payload.get("results") or []):
            if row.get("passed"):
                continue
            for failure in (row.get("failures") or []):
                if not isinstance(failure, dict):
                    continue
                cluster_key = str(failure.get("cluster") or failure.get("kind") or "uncategorized")
                cluster = clusters.setdefault(cluster_key, {
                    "cluster_id": cluster_key,
                    "label": cluster_key.split("::")[0] if "::" in cluster_key else cluster_key,
                    "failure_kind": str(failure.get("kind") or ""),
                    "case_ids": [],
                    "runs": [],
                    "examples": [],
                    "count": 0,
                })
                cluster["count"] += 1
                if row.get("id") not in cluster["case_ids"]:
                    cluster["case_ids"].append(row.get("id"))
                if run_name not in cluster["runs"]:
                    cluster["runs"].append(run_name)
                if len(cluster["examples"]) < 3:
                    cluster["examples"].append({
                        "case_id": row.get("id"),
                        "run": run_name,
                        "detail": failure.get("detail"),
                    })
    ranked = sorted(clusters.values(), key=lambda row: (int(row.get("count") or 0), len(row.get("case_ids") or [])), reverse=True)
    payload = {
        "schema_version": "cortex.memory_codec_quality.triage.v1",
        "generated_at": _now_iso(),
        "cluster_count": len(ranked),
        "clusters": ranked,
    }
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    lines = [
        f"# Memory/Codec Failure Clusters\n",
        f"\n- generated_at: {_now_iso()}\n",
        f"- cluster_count: {len(ranked)}\n",
        "\n## Clusters\n",
    ]
    for cluster in ranked:
        lines.append(f"\n### {cluster['cluster_id']}\n")
        lines.append(f"- label: {cluster['label']}\n")
        lines.append(f"- failure_kind: {cluster['failure_kind']}\n")
        lines.append(f"- count: {cluster['count']}\n")
        lines.append(f"- runs: {', '.join(cluster['runs'])}\n")
        lines.append(f"- case_ids: {', '.join(cluster['case_ids'][:12])}\n")
        for example in cluster.get("examples") or []:
            lines.append(f"  - example: {example['run']} / {example['case_id']} / {json.dumps(example['detail'], ensure_ascii=False)}\n")
    output_md.write_text("".join(lines), encoding="utf-8")
    return payload


def write_report(run_path: Path, output_md: Path, *, title: str) -> None:
    payload = json.loads(run_path.read_text(encoding="utf-8"))
    agg = payload.get("aggregate") or {}
    results = payload.get("results") or []
    failing = [row for row in results if not row.get("passed")]
    lines = [
        f"# {title}\n\n",
        f"- generated_at: {_now_iso()}\n",
        f"- run_path: {run_path}\n",
        f"- config: {json.dumps(payload.get('config') or {}, ensure_ascii=False)}\n",
        f"- case_count: {payload.get('case_count')}\n",
        f"- overall_pass_rate: {agg.get('overall_pass_rate')}\n",
        f"- false_memory_rate: {agg.get('false_memory_rate')}\n",
        f"- stale_memory_failure_rate: {agg.get('stale_memory_failure_rate')}\n",
        f"- omission_rate: {agg.get('omission_rate')}\n",
        f"- preference_recall_accuracy: {agg.get('preference_recall_accuracy')}\n",
        f"- open_loop_continuity_accuracy: {agg.get('open_loop_continuity_accuracy')}\n",
        f"- codec_overuse_rate: {agg.get('codec_overuse_rate')}\n",
        f"- codec_underuse_rate: {agg.get('codec_underuse_rate')}\n",
        f"- latency_ms: {json.dumps(agg.get('latency_ms') or {}, ensure_ascii=False)}\n",
        "\n## Category summary\n",
    ]
    for category, row in sorted((agg.get("by_category") or {}).items()):
        lines.append(f"- {category}: pass_rate={row.get('pass_rate')} count={row.get('count')}\n")
    lines.append("\n## Failing cases\n")
    for row in failing[:20]:
        lines.append(f"\n### {row.get('id')} — {row.get('title')}\n")
        lines.append(f"- category: {row.get('category')}\n")
        lines.append(f"- failures: {json.dumps(row.get('failures') or [], ensure_ascii=False)}\n")
        lines.append(f"- packet: {row.get('packet')}\n")
        lines.append(f"- state_excerpt: {json.dumps(row.get('state_excerpt') or {}, ensure_ascii=False)}\n")
    output_md.parent.mkdir(parents=True, exist_ok=True)
    output_md.write_text("".join(lines), encoding="utf-8")


def parse_configs(args: argparse.Namespace) -> List[RunConfig]:
    if args.configs_json:
        payload = json.loads(Path(args.configs_json).read_text(encoding="utf-8"))
        rows = payload.get("configs") if isinstance(payload, dict) else payload
        return [RunConfig.from_payload(row) for row in (rows or []) if isinstance(row, dict)]
    return [RunConfig.from_payload(row) for row in DEFAULT_MATRIX]


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Cortex memory/codec benchmark corpus and supporting artifacts.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    run_p = sub.add_parser("run")
    run_p.add_argument("--corpus", required=True)
    run_p.add_argument("--output", required=True)
    run_p.add_argument("--config-name", default="ad_hoc")
    run_p.add_argument("--max-items-per-bucket", type=int, default=8)
    run_p.add_argument("--packet-chars", type=int, default=320)
    run_p.add_argument("--codec-globals-json")

    matrix_p = sub.add_parser("run-matrix")
    matrix_p.add_argument("--corpus", required=True)
    matrix_p.add_argument("--output-dir", required=True)
    matrix_p.add_argument("--configs-json")

    triage_p = sub.add_parser("triage")
    triage_p.add_argument("--runs", nargs="+", required=True)
    triage_p.add_argument("--output-json", required=True)
    triage_p.add_argument("--output-md", required=True)

    report_p = sub.add_parser("report")
    report_p.add_argument("--run", required=True)
    report_p.add_argument("--output", required=True)
    report_p.add_argument("--title", default="Memory/Codec Benchmark Report")

    args = parser.parse_args()
    if args.cmd == "run":
        overrides = json.loads(Path(args.codec_globals_json).read_text(encoding="utf-8")) if args.codec_globals_json else {}
        config = RunConfig(
            name=args.config_name,
            max_items_per_bucket=args.max_items_per_bucket,
            packet_chars=args.packet_chars,
            codec_globals=overrides,
        )
        out = run_corpus(Path(args.corpus), Path(args.output), config)
        print(json.dumps({"output": str(args.output), "aggregate": out.get("aggregate")}, indent=2, ensure_ascii=False))
        return 0
    if args.cmd == "run-matrix":
        index = run_matrix(Path(args.corpus), Path(args.output_dir), parse_configs(args))
        print(json.dumps({"output_dir": str(args.output_dir), "winner": index.get("winner"), "experiment_count": len(index.get("experiments") or [])}, indent=2, ensure_ascii=False))
        return 0
    if args.cmd == "triage":
        payload = build_triage([Path(item) for item in args.runs], Path(args.output_json), Path(args.output_md))
        print(json.dumps({"cluster_count": payload.get("cluster_count"), "output_json": args.output_json}, indent=2, ensure_ascii=False))
        return 0
    if args.cmd == "report":
        write_report(Path(args.run), Path(args.output), title=args.title)
        print(json.dumps({"output": args.output}, indent=2, ensure_ascii=False))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
