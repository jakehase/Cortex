from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from cortex_server.benchmarks import mailchimp_program1_harness as harness

JsonDict = Dict[str, Any]

STAGE_ORDER = [
    "roadmap",
    "phase_1_audience_foundation",
    "phase_2_campaign_execution",
    "phase_3_reporting_automation",
    "gap_strategy",
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


def docs_root() -> Path:
    return repo_root() / "docs"


def program_root(date: str) -> Path:
    return repo_root() / "artifacts" / "mailchimp_clone" / "program_1"


def state_path(date: str) -> Path:
    return program_root(date) / "program_state.json"


def completion_summary_path(date: str) -> Path:
    return program_root(date) / "completion_summary.json"


def notification_state_path(date: str) -> Path:
    return program_root(date) / "notification_state.json"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _json_load(path: Path) -> JsonDict:
    return json.loads(path.read_text(encoding="utf-8"))


def _json_dump(path: Path, payload: JsonDict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _stage_specs(date: str) -> Dict[str, StageSpec]:
    return {
        "roadmap": StageSpec(
            "roadmap",
            "Program 1 supervised roadmap",
            [str(docs_root() / f"MAILCHIMP_PARITY_PROGRAM_1_SUPERVISED_ROADMAP_{date}.md")],
        ),
        "phase_1_audience_foundation": StageSpec(
            "phase_1_audience_foundation",
            "Phase 1 audience foundation evidence",
            [
                str(harness.evidence_bundle_path(date, "phase_1_audience_foundation")),
                str(harness.phase_summary_path(date, "phase_1_audience_foundation")),
            ],
        ),
        "phase_2_campaign_execution": StageSpec(
            "phase_2_campaign_execution",
            "Phase 2 campaign execution evidence",
            [
                str(harness.evidence_bundle_path(date, "phase_2_campaign_execution")),
                str(harness.phase_summary_path(date, "phase_2_campaign_execution")),
            ],
        ),
        "phase_3_reporting_automation": StageSpec(
            "phase_3_reporting_automation",
            "Phase 3 reporting and automation evidence",
            [
                str(harness.evidence_bundle_path(date, "phase_3_reporting_automation")),
                str(harness.phase_summary_path(date, "phase_3_reporting_automation")),
            ],
        ),
        "gap_strategy": StageSpec(
            "gap_strategy",
            "Prioritized gaps and plan-gate strategy",
            [str(harness.prioritized_gap_list_path(date)), str(harness.plan_gate_strategy_path(date))],
        ),
        "validation": StageSpec(
            "validation",
            "Program 1 validation summary",
            [
                str(harness.validation_summary_path(date)),
                str(harness.harness_report_path(date, "phase_1_audience_foundation")),
                str(harness.harness_report_path(date, "phase_2_campaign_execution")),
                str(harness.harness_report_path(date, "phase_3_reporting_automation")),
            ],
        ),
        "final_report": StageSpec(
            "final_report",
            "Program 1 final report",
            [str(docs_root() / f"MAILCHIMP_PARITY_PROGRAM_1_FINAL_REPORT_{date}.md")],
        ),
    }


def build_initial_state(date: str) -> JsonDict:
    specs = _stage_specs(date)
    return {
        "schema_version": "cortex.mailchimp.program1.supervisor.v1",
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


def verify_stage(date: str, stage: str) -> JsonDict:
    specs = _stage_specs(date)
    spec = specs[stage]
    if stage in harness.PHASE_ORDER:
        result = harness.verify_phase_evidence(date, stage)
        return {
            "stage": stage,
            "label": spec.label,
            "complete": bool(result.get("complete")),
            "missing_artifacts": list(result.get("missing_artifacts") or []),
            "details": result.get("details") or {},
        }
    if stage == "gap_strategy":
        result = harness.verify_gap_strategy(date)
        return {
            "stage": stage,
            "label": spec.label,
            "complete": bool(result.get("complete")),
            "missing_artifacts": list(result.get("missing_artifacts") or []),
            "details": result.get("details") or {},
        }
    if stage == "validation":
        missing = [path for path in spec.required_artifacts if not _artifact_exists(path)]
        if missing:
            return {
                "stage": stage,
                "label": spec.label,
                "complete": False,
                "missing_artifacts": missing,
                "details": {"all_complete": False},
            }
        payload = _json_load(harness.validation_summary_path(date))
        return {
            "stage": stage,
            "label": spec.label,
            "complete": bool(payload.get("all_complete")),
            "missing_artifacts": [] if payload.get("all_complete") else [str(harness.validation_summary_path(date)) + " (all_complete=false)"],
            "details": {
                "all_complete": bool(payload.get("all_complete")),
                "phase_report_count": len(payload.get("phase_reports") or []),
            },
        }
    missing = [path for path in spec.required_artifacts if not _artifact_exists(path)]
    return {
        "stage": stage,
        "label": spec.label,
        "complete": not missing,
        "missing_artifacts": missing,
        "details": {},
    }


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


def build_completion_summary(date: str, *, state: Optional[JsonDict] = None, persist: bool = True) -> JsonDict:
    state = state or reconcile_state(date)
    summary = {
        "schema_version": "cortex.mailchimp.program1.completion.v1",
        "date": date,
        "generated_at": now_iso(),
        "all_complete": bool(state.get("all_complete")),
        "artifacts_root": str(program_root(date)),
        "stage_checklist": [
            {
                "stage": stage,
                "label": ((state.get("stages") or {}).get(stage) or {}).get("label"),
                "completed": bool(((state.get("stages") or {}).get(stage) or {}).get("completed")),
            }
            for stage in STAGE_ORDER
        ],
        "summary": {
            phase_id: (((state.get("stages") or {}).get(phase_id) or {}).get("details") or {}).get("actual_case_count")
            for phase_id in harness.PHASE_ORDER
        },
        "message_lines": [
            f"Mailchimp Parity Program 1 {'complete' if state.get('all_complete') else 'incomplete'} for {date}.",
            f"Stages complete: {sum(1 for s in STAGE_ORDER if ((state.get('stages') or {}).get(s) or {}).get('completed'))}/{len(STAGE_ORDER)}.",
            f"Phase 1 cases: {(((state.get('stages') or {}).get('phase_1_audience_foundation') or {}).get('details') or {}).get('actual_case_count')}.",
            f"Phase 2 cases: {(((state.get('stages') or {}).get('phase_2_campaign_execution') or {}).get('details') or {}).get('actual_case_count')}.",
            f"Phase 3 cases: {(((state.get('stages') or {}).get('phase_3_reporting_automation') or {}).get('details') or {}).get('actual_case_count')}.",
        ],
        "final_report_path": str(docs_root() / f"MAILCHIMP_PARITY_PROGRAM_1_FINAL_REPORT_{date}.md"),
    }
    if persist:
        _json_dump(completion_summary_path(date), summary)
    return summary


def notification_state(date: str, *, persist_default: bool = True) -> JsonDict:
    path = notification_state_path(date)
    if path.exists():
        return _json_load(path)
    payload = {
        "schema_version": "cortex.mailchimp.program1.notification.v1",
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
