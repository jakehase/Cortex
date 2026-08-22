from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

JsonDict = Dict[str, Any]

STAGE_ORDER = [
    "corpus",
    "baseline",
    "experiments",
    "triage_queue",
    "tuning_loop_a",
    "tuning_loop_b",
    "durability_run_1",
    "foreground_window_1",
    "durability_run_2",
    "foreground_window_2",
    "durability_run_3",
    "foreground_window_3",
    "final_rerun",
    "validation",
    "final_report",
]

DURABILITY_STAGES = {"durability_run_1", "durability_run_2", "durability_run_3"}
FOREGROUND_STAGES = {"foreground_window_1", "foreground_window_2", "foreground_window_3"}


@dataclass(frozen=True)
class StageSpec:
    stage: str
    label: str
    required_artifacts: List[str]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def program_root(date: str) -> Path:
    return repo_root() / "artifacts" / "memory_codec_quality" / date


def docs_root() -> Path:
    return repo_root() / "docs"


def benchmarks_root() -> Path:
    return repo_root() / "benchmarks"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def corpus_path(date: str) -> Path:
    return benchmarks_root() / f"cortex_memory_codec_quality_corpus_{date}.json"


def state_path(date: str) -> Path:
    return program_root(date) / "program_state.json"


def completion_summary_path(date: str) -> Path:
    return program_root(date) / "completion_summary.json"


def notification_state_path(date: str) -> Path:
    return program_root(date) / "notification_state.json"


def _stage_specs(date: str) -> Dict[str, StageSpec]:
    root = program_root(date)
    return {
        "corpus": StageSpec("corpus", "Memory/codec corpus (40+ cases)", [str(corpus_path(date))]),
        "baseline": StageSpec("baseline", "Baseline quality run", [str(root / "baseline" / "baseline.memory_codec.json"), str(root / "baseline" / "baseline_report.md")]),
        "experiments": StageSpec("experiments", "Experiment matrix (8+ configs)", [str(root / "experiments" / "index.json")]),
        "triage_queue": StageSpec("triage_queue", "Failure cluster triage queue (20+ clusters)", [str(root / "triage" / "failure_clusters.json"), str(root / "triage" / "failure_clusters.md")]),
        "tuning_loop_a": StageSpec("tuning_loop_a", "Tuning loop A", [str(root / "tuning_loop_a" / "loop_a_summary.json")]),
        "tuning_loop_b": StageSpec("tuning_loop_b", "Tuning loop B", [str(root / "tuning_loop_b" / "loop_b_summary.json")]),
        "durability_run_1": StageSpec("durability_run_1", "Memory durability run 1 (30m)", [str(root / "durability_run_1.json"), str(root / "durability_run_1.md")]),
        "foreground_window_1": StageSpec("foreground_window_1", "Foreground work during durability window 1", [str(root / "foreground_window_1_summary.md")]),
        "durability_run_2": StageSpec("durability_run_2", "Memory durability run 2 (30m)", [str(root / "durability_run_2.json"), str(root / "durability_run_2.md")]),
        "foreground_window_2": StageSpec("foreground_window_2", "Foreground work during durability window 2", [str(root / "foreground_window_2_summary.md")]),
        "durability_run_3": StageSpec("durability_run_3", "Memory durability run 3 (30m)", [str(root / "durability_run_3.json"), str(root / "durability_run_3.md")]),
        "foreground_window_3": StageSpec("foreground_window_3", "Foreground work during durability window 3", [str(root / "foreground_window_3_summary.md")]),
        "final_rerun": StageSpec("final_rerun", "Final rerun", [str(root / "final" / "final.memory_codec.json")]),
        "validation": StageSpec("validation", "Broad validation", [str(root / "validation" / "validation_summary.json")]),
        "final_report": StageSpec("final_report", "Final memory/codec quality report", [str(docs_root() / f"CORTEX_MEMORY_CODEC_QUALITY_FINAL_REPORT_{date}.md")]),
    }


def _json_load(path: Path) -> JsonDict:
    return json.loads(path.read_text(encoding="utf-8"))


def _json_dump(path: Path, payload: JsonDict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def build_initial_state(date: str) -> JsonDict:
    specs = _stage_specs(date)
    return {
        "schema_version": "cortex.memory_codec_quality.supervisor.v1",
        "date": date,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "repo_root": str(repo_root()),
        "artifacts_root": str(program_root(date)),
        "stage_order": list(STAGE_ORDER),
        "stages": {
            stage: {
                "stage": stage,
                "label": specs[stage].label,
                "status": "pending",
                "completed": False,
                "missing_artifacts": [],
                "details": {},
                "last_verified_at": None,
            }
            for stage in STAGE_ORDER
        },
    }


def load_or_create_state(date: str) -> JsonDict:
    path = state_path(date)
    if path.exists():
        return _json_load(path)
    state = build_initial_state(date)
    save_state(date, state)
    return state


def save_state(date: str, state: JsonDict) -> None:
    state["updated_at"] = now_iso()
    _json_dump(state_path(date), state)


def _artifact_exists(path_str: str) -> bool:
    return Path(path_str).exists()


def _verify_corpus(date: str) -> JsonDict:
    path = corpus_path(date)
    if not path.exists():
        return {"complete": False, "missing_artifacts": [str(path)], "details": {"case_count": 0}}
    payload = _json_load(path)
    cases = payload.get("cases") if isinstance(payload, dict) else payload
    count = len(cases or [])
    complete = count >= 40
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{path} (requires >=40 cases, found {count})"],
        "details": {"case_count": count},
    }


def _verify_experiments(date: str) -> JsonDict:
    path = program_root(date) / "experiments" / "index.json"
    if not path.exists():
        return {"complete": False, "missing_artifacts": [str(path)], "details": {"experiment_count": 0}}
    payload = _json_load(path)
    experiments = payload.get("experiments") or []
    count = len(experiments)
    complete = count >= 8
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{path} (requires >=8 experiments, found {count})"],
        "details": {"experiment_count": count, "winner": payload.get("winner")},
    }


def _verify_triage(date: str) -> JsonDict:
    path = program_root(date) / "triage" / "failure_clusters.json"
    md = program_root(date) / "triage" / "failure_clusters.md"
    missing = [str(p) for p in (path, md) if not p.exists()]
    if missing:
        return {"complete": False, "missing_artifacts": missing, "details": {"cluster_count": 0}}
    payload = _json_load(path)
    clusters = payload.get("clusters") if isinstance(payload, dict) else payload
    count = len(clusters or [])
    complete = count >= 20
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{path} (requires >=20 clusters, found {count})"],
        "details": {"cluster_count": count},
    }


def _verify_durability(date: str, stage: str) -> JsonDict:
    root = program_root(date)
    json_path = root / f"{stage}.json"
    md_path = root / f"{stage}.md"
    missing = [str(p) for p in (json_path, md_path) if not p.exists()]
    if missing:
        return {"complete": False, "missing_artifacts": missing, "details": {}}
    payload = _json_load(json_path)
    duration = int(payload.get("duration_seconds") or 0)
    complete = duration >= 1800
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else [f"{json_path} (requires duration_seconds >= 1800, found {duration})"],
        "details": {"duration_seconds": duration, "round_count": int(payload.get("round_count") or 0)},
    }


def verify_stage(date: str, stage: str) -> JsonDict:
    specs = _stage_specs(date)
    spec = specs[stage]
    if stage == "corpus":
        result = _verify_corpus(date)
    elif stage == "experiments":
        result = _verify_experiments(date)
    elif stage == "triage_queue":
        result = _verify_triage(date)
    elif stage in DURABILITY_STAGES:
        result = _verify_durability(date, stage)
    else:
        missing = [p for p in spec.required_artifacts if not _artifact_exists(p)]
        result = {"complete": not missing, "missing_artifacts": missing, "details": {}}
    return {"stage": stage, "label": spec.label, **result}


def reconcile_state(date: str, *, persist: bool = True) -> JsonDict:
    state = load_or_create_state(date)
    for stage in STAGE_ORDER:
        verification = verify_stage(date, stage)
        row = state["stages"].setdefault(stage, {})
        row.update(
            {
                "stage": stage,
                "label": verification.get("label"),
                "completed": bool(verification.get("complete")),
                "status": "complete" if verification.get("complete") else "pending",
                "missing_artifacts": list(verification.get("missing_artifacts") or []),
                "details": verification.get("details") or {},
                "last_verified_at": now_iso(),
            }
        )
    state["next_stage"] = next((stage for stage in STAGE_ORDER if not state["stages"][stage].get("completed")), None)
    state["all_complete"] = state["next_stage"] is None
    if persist:
        save_state(date, state)
        if state["all_complete"]:
            build_completion_summary(date, state=state, persist=True)
            notification_state(date, persist_default=True)
    return state


def stage_status_summary(date: str) -> JsonDict:
    state = reconcile_state(date)
    completion_path = completion_summary_path(date)
    return {
        "schema_version": state.get("schema_version"),
        "date": date,
        "artifacts_root": state.get("artifacts_root"),
        "all_complete": state.get("all_complete"),
        "next_stage": state.get("next_stage"),
        "completion_summary_path": str(completion_path) if completion_path.exists() else None,
        "stages": [state["stages"][stage] for stage in STAGE_ORDER],
    }


def build_completion_summary(date: str, *, state: Optional[JsonDict] = None, persist: bool = True) -> JsonDict:
    state = state or reconcile_state(date)
    root = program_root(date)
    experiments = _json_load(root / "experiments" / "index.json") if (root / "experiments" / "index.json").exists() else {}
    triage = _json_load(root / "triage" / "failure_clusters.json") if (root / "triage" / "failure_clusters.json").exists() else {}
    summary = {
        "schema_version": "cortex.memory_codec_quality.completion.v1",
        "date": date,
        "generated_at": now_iso(),
        "all_complete": bool(state.get("all_complete")),
        "artifacts_root": str(root),
        "stage_checklist": [
            {
                "stage": stage,
                "label": ((state.get("stages") or {}).get(stage) or {}).get("label"),
                "completed": bool(((state.get("stages") or {}).get(stage) or {}).get("completed")),
            }
            for stage in STAGE_ORDER
        ],
        "summary": {
            "case_count": (((state.get("stages") or {}).get("corpus") or {}).get("details") or {}).get("case_count"),
            "experiment_count": len(experiments.get("experiments") or []),
            "winner": experiments.get("winner"),
            "triage_cluster_count": len(triage.get("clusters") or []),
        },
        "message_lines": [
            f"Memory/codec quality program {'complete' if state.get('all_complete') else 'incomplete'} for {date}.",
            f"Stages complete: {sum(1 for stage in STAGE_ORDER if ((state.get('stages') or {}).get(stage) or {}).get('completed'))}/{len(STAGE_ORDER)}.",
            f"Corpus cases: {(((state.get('stages') or {}).get('corpus') or {}).get('details') or {}).get('case_count')}.",
            f"Experiment count: {len(experiments.get('experiments') or [])}; winner: {experiments.get('winner') or 'unknown'}.",
            f"Failure clusters: {len(triage.get('clusters') or [])}.",
        ],
        "final_report_path": str(docs_root() / f"CORTEX_MEMORY_CODEC_QUALITY_FINAL_REPORT_{date}.md"),
    }
    if persist:
        _json_dump(completion_summary_path(date), summary)
    return summary


def notification_state(date: str, *, persist_default: bool = True) -> JsonDict:
    path = notification_state_path(date)
    if path.exists():
        return _json_load(path)
    payload = {
        "schema_version": "cortex.memory_codec_quality.notification.v1",
        "date": date,
        "created_at": now_iso(),
        "notified": False,
        "notified_at": None,
        "notify_count": 0,
        "completion_summary_path": str(completion_summary_path(date)),
    }
    if persist_default:
        _json_dump(path, payload)
    return payload


def mark_notified(date: str, *, note: Optional[str] = None) -> JsonDict:
    payload = notification_state(date)
    payload["notified"] = True
    payload["notified_at"] = now_iso()
    payload["notify_count"] = int(payload.get("notify_count") or 0) + 1
    if note:
        payload["note"] = str(note)
    _json_dump(notification_state_path(date), payload)
    return payload


def wait_for_completion(date: str, *, timeout_seconds: int = 0, interval_seconds: int = 30, mark_complete_notification: bool = False) -> JsonDict:
    start = time.time()
    while True:
        state = reconcile_state(date)
        if state.get("all_complete"):
            summary = build_completion_summary(date, state=state, persist=True)
            notification = notification_state(date)
            if mark_complete_notification and not notification.get("notified"):
                notification = mark_notified(date, note="completion delivered via watcher")
            return {
                "all_complete": True,
                "timed_out": False,
                "state": stage_status_summary(date),
                "completion_summary": summary,
                "notification": notification,
            }
        if timeout_seconds and (time.time() - start) >= timeout_seconds:
            return {
                "all_complete": False,
                "timed_out": True,
                "state": stage_status_summary(date),
                "completion_summary": None,
                "notification": notification_state(date),
            }
        time.sleep(max(1, int(interval_seconds or 30)))


def stage_spec_view(date: str, stage: Optional[str] = None) -> JsonDict:
    specs = _stage_specs(date)
    stages = [stage] if stage else STAGE_ORDER
    return {
        "date": date,
        "stages": [
            {
                "stage": name,
                "label": specs[name].label,
                "required_artifacts": list(specs[name].required_artifacts),
            }
            for name in stages
        ],
    }
