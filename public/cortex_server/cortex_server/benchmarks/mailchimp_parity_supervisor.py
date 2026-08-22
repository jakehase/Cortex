from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

JsonDict = Dict[str, Any]

STAGE_ORDER = [
    "parity_charter",
    "surface_map",
    "corpus_seed",
    "teardown_pack",
    "supervisor_framework",
    "notifier_bridge",
    "artifact_layout",
    "validation",
    "final_report",
]


@dataclass(frozen=True)
class StageSpec:
    stage: str
    label: str
    required_artifacts: List[str]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def program_root(date: str) -> Path:
    return repo_root() / "artifacts" / "mailchimp_clone" / "program_0"


def docs_root() -> Path:
    return repo_root() / "docs"


def benchmarks_root() -> Path:
    return repo_root() / "benchmarks"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def state_path(date: str) -> Path:
    return program_root(date) / "program_state.json"


def completion_summary_path(date: str) -> Path:
    return program_root(date) / "completion_summary.json"


def notification_state_path(date: str) -> Path:
    return program_root(date) / "notification_state.json"


def corpus_path(date: str) -> Path:
    return benchmarks_root() / f"mailchimp_parity_corpus_seed_{date}.json"


def surface_map_path(date: str) -> Path:
    return program_root(date) / "surface_map.json"


def teardown_dir(date: str) -> Path:
    return program_root(date) / "teardown"


def _stage_specs(date: str) -> Dict[str, StageSpec]:
    return {
        "parity_charter": StageSpec("parity_charter", "Parity charter", [str(docs_root() / f"MAILCHIMP_PARITY_CHARTER_{date}.md")]),
        "surface_map": StageSpec("surface_map", "Product surface map (20+)", [str(docs_root() / f"MAILCHIMP_PRODUCT_SURFACE_MAP_{date}.md"), str(surface_map_path(date))]),
        "corpus_seed": StageSpec("corpus_seed", "Parity corpus seed (100+)", [str(corpus_path(date)), str(docs_root() / f"MAILCHIMP_PARITY_CORPUS_GUIDE_{date}.md")]),
        "teardown_pack": StageSpec("teardown_pack", "Teardown evidence pack (10+)", [str(teardown_dir(date))]),
        "supervisor_framework": StageSpec("supervisor_framework", "Mailchimp supervisor framework", [str(repo_root() / "cortex_server" / "benchmarks" / "mailchimp_parity_supervisor.py"), str(repo_root() / "scripts" / "run_mailchimp_parity_supervisor.py")]),
        "notifier_bridge": StageSpec("notifier_bridge", "Mailchimp notifier bridge", [str(repo_root() / "scripts" / "watch_mailchimp_parity_completion.py"), str(repo_root() / "scripts" / "run_mailchimp_parity_notify_once.py")]),
        "artifact_layout": StageSpec("artifact_layout", "Artifact layout doc", [str(docs_root() / f"MAILCHIMP_PARITY_ARTIFACT_LAYOUT_{date}.md")]),
        "validation": StageSpec("validation", "Program 0 validation", [str(program_root(date) / "validation" / "validation_summary.json")]),
        "final_report": StageSpec("final_report", "Program 0 final report", [str(docs_root() / f"MAILCHIMP_PARITY_PROGRAM_0_FINAL_REPORT_{date}.md")]),
    }


def _json_load(path: Path) -> JsonDict:
    return json.loads(path.read_text(encoding="utf-8"))


def _json_dump(path: Path, payload: JsonDict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def build_initial_state(date: str) -> JsonDict:
    specs = _stage_specs(date)
    return {
        "schema_version": "cortex.mailchimp.program0.supervisor.v1",
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
    complete = count >= 100
    return {"complete": complete, "missing_artifacts": [] if complete else [f"{path} (requires >=100 cases, found {count})"], "details": {"case_count": count}}


def _verify_surface_map(date: str) -> JsonDict:
    path = surface_map_path(date)
    doc = docs_root() / f"MAILCHIMP_PRODUCT_SURFACE_MAP_{date}.md"
    missing = [str(p) for p in (path, doc) if not p.exists()]
    if missing:
        return {"complete": False, "missing_artifacts": missing, "details": {"surface_count": 0}}
    payload = _json_load(path)
    surfaces = payload.get("surfaces") if isinstance(payload, dict) else payload
    count = len(surfaces or [])
    complete = count >= 20
    return {"complete": complete, "missing_artifacts": [] if complete else [f"{path} (requires >=20 surfaces, found {count})"], "details": {"surface_count": count}}


def _verify_teardown(date: str) -> JsonDict:
    path = teardown_dir(date)
    if not path.exists():
        return {"complete": False, "missing_artifacts": [str(path)], "details": {"dossier_count": 0}}
    count = len(list(path.glob('*.md')))
    complete = count >= 10
    return {"complete": complete, "missing_artifacts": [] if complete else [f"{path} (requires >=10 dossiers, found {count})"], "details": {"dossier_count": count}}


def verify_stage(date: str, stage: str) -> JsonDict:
    specs = _stage_specs(date)
    spec = specs[stage]
    if stage == "corpus_seed":
        result = _verify_corpus(date)
    elif stage == "surface_map":
        result = _verify_surface_map(date)
    elif stage == "teardown_pack":
        result = _verify_teardown(date)
    else:
        missing = [p for p in spec.required_artifacts if not _artifact_exists(p)]
        result = {"complete": not missing, "missing_artifacts": missing, "details": {}}
    return {"stage": stage, "label": spec.label, **result}


def build_completion_summary(date: str, *, state: Optional[JsonDict] = None, persist: bool = True) -> JsonDict:
    state = state or reconcile_state(date)
    summary = {
        "schema_version": "cortex.mailchimp.program0.completion.v1",
        "date": date,
        "generated_at": now_iso(),
        "all_complete": bool(state.get("all_complete")),
        "artifacts_root": str(program_root(date)),
        "stage_checklist": [
            {"stage": stage, "label": ((state.get("stages") or {}).get(stage) or {}).get("label"), "completed": bool(((state.get("stages") or {}).get(stage) or {}).get("completed"))}
            for stage in STAGE_ORDER
        ],
        "summary": {
            "surface_count": (((state.get("stages") or {}).get("surface_map") or {}).get("details") or {}).get("surface_count"),
            "case_count": (((state.get("stages") or {}).get("corpus_seed") or {}).get("details") or {}).get("case_count"),
            "dossier_count": (((state.get("stages") or {}).get("teardown_pack") or {}).get("details") or {}).get("dossier_count"),
        },
        "message_lines": [
            f"Mailchimp Parity Program 0 {'complete' if state.get('all_complete') else 'incomplete'} for {date}.",
            f"Stages complete: {sum(1 for s in STAGE_ORDER if ((state.get('stages') or {}).get(s) or {}).get('completed'))}/{len(STAGE_ORDER)}.",
            f"Surface count: {(((state.get('stages') or {}).get('surface_map') or {}).get('details') or {}).get('surface_count')}.",
            f"Corpus cases: {(((state.get('stages') or {}).get('corpus_seed') or {}).get('details') or {}).get('case_count')}.",
            f"Teardown dossiers: {(((state.get('stages') or {}).get('teardown_pack') or {}).get('details') or {}).get('dossier_count')}.",
        ],
        "final_report_path": str(docs_root() / f"MAILCHIMP_PARITY_PROGRAM_0_FINAL_REPORT_{date}.md"),
    }
    if persist:
        _json_dump(completion_summary_path(date), summary)
    return summary


def notification_state(date: str, *, persist_default: bool = True) -> JsonDict:
    path = notification_state_path(date)
    if path.exists():
        return _json_load(path)
    payload = {
        "schema_version": "cortex.mailchimp.program0.notification.v1",
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


def reconcile_state(date: str, *, persist: bool = True) -> JsonDict:
    state = load_or_create_state(date)
    for stage in STAGE_ORDER:
        verification = verify_stage(date, stage)
        row = state["stages"].setdefault(stage, {})
        row.update({
            "stage": stage,
            "label": verification.get("label"),
            "completed": bool(verification.get("complete")),
            "status": "complete" if verification.get("complete") else "pending",
            "missing_artifacts": list(verification.get("missing_artifacts") or []),
            "details": verification.get("details") or {},
            "last_verified_at": now_iso(),
        })
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
    cp = completion_summary_path(date)
    return {
        "schema_version": state.get("schema_version"),
        "date": date,
        "artifacts_root": state.get("artifacts_root"),
        "all_complete": state.get("all_complete"),
        "next_stage": state.get("next_stage"),
        "completion_summary_path": str(cp) if cp.exists() else None,
        "stages": [state["stages"][stage] for stage in STAGE_ORDER],
    }


def wait_for_completion(date: str, *, timeout_seconds: int = 0, interval_seconds: int = 30, mark_complete_notification: bool = False) -> JsonDict:
    start = time.time()
    while True:
        state = reconcile_state(date)
        if state.get("all_complete"):
            summary = build_completion_summary(date, state=state, persist=True)
            notification = notification_state(date)
            if mark_complete_notification and not notification.get("notified"):
                notification = mark_notified(date, note="completion delivered via watcher")
            return {"all_complete": True, "timed_out": False, "state": stage_status_summary(date), "completion_summary": summary, "notification": notification}
        if timeout_seconds and (time.time() - start) >= timeout_seconds:
            return {"all_complete": False, "timed_out": True, "state": stage_status_summary(date), "completion_summary": None, "notification": notification_state(date)}
        time.sleep(max(1, int(interval_seconds or 30)))


def stage_spec_view(date: str, stage: Optional[str] = None) -> JsonDict:
    specs = _stage_specs(date)
    stages = [stage] if stage else STAGE_ORDER
    return {"date": date, "stages": [{"stage": name, "label": specs[name].label, "required_artifacts": list(specs[name].required_artifacts)} for name in stages]}
