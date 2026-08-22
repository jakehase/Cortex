from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

JsonDict = Dict[str, Any]

PROGRAM0_CORPUS_DATE = "2026-04-01"
DEFAULT_PROGRAM1_DATE = "2026-04-02"

PHASE_ORDER = [
    "phase_1_audience_foundation",
    "phase_2_campaign_execution",
    "phase_3_reporting_automation",
]

PHASE_SPECS: Dict[str, JsonDict] = {
    "phase_1_audience_foundation": {
        "label": "Phase 1 — Onboarding, audience foundation, and segmentation parity",
        "categories": [
            "signup_onboarding",
            "audience_creation",
            "contact_import_update",
            "segmentation_behavior",
        ],
        "surface_ids": [
            "signup_onboarding",
            "account_workspace_setup",
            "audience_overview",
            "contacts_table",
            "contact_profile",
            "tags_groups_interests",
            "segments",
        ],
        "surface_labels": [
            "Signup and onboarding wizard",
            "Account workspace setup",
            "Audience overview",
            "Contacts table",
            "Contact profile",
            "Tags, groups, and interests management",
            "Segments",
        ],
        "teardown_refs": [
            "artifacts/mailchimp_clone/program_0/teardown/01_audience_list_view.md",
            "artifacts/mailchimp_clone/program_0/teardown/02_contact_profile.md",
        ],
        "exit_criteria": [
            "All Program 0 corpus cases for onboarding, audience creation, contact import/update, and segmentation are linked into the evidence bundle.",
            "Audience/contact/segment surfaces have explicit visible-state notes covering empty state, validation, bulk action state, and plan-gated warnings.",
            "Phase captures multi-audience versus unified-CRM design tension without breaking visible Mailchimp semantics.",
        ],
        "gap_themes": [
            "resume_behavior",
            "multi_audience_model",
            "segment_rule_builder",
            "growth_card_plan_gates",
        ],
    },
    "phase_2_campaign_execution": {
        "label": "Phase 2 — Campaign creation, editing, and send/review parity",
        "categories": [
            "campaign_creation_editing",
            "template_editor_interactions",
            "send_schedule_flows",
        ],
        "surface_ids": [
            "campaign_index",
            "campaign_wizard",
            "email_builder",
            "template_library",
            "send_schedule_review",
        ],
        "surface_labels": [
            "Campaign index",
            "Campaign creation wizard",
            "Email builder",
            "Template library",
            "Send / schedule / review",
        ],
        "teardown_refs": [
            "artifacts/mailchimp_clone/program_0/teardown/03_campaign_wizard.md",
            "artifacts/mailchimp_clone/program_0/teardown/04_email_builder.md",
        ],
        "exit_criteria": [
            "All Program 0 corpus cases for campaign creation/editing, template editor interactions, and send/schedule flows are linked into the evidence bundle.",
            "Draft persistence, step-order fidelity, editor save/exit semantics, and preflight send blockers are captured as parity-critical seams.",
            "The phase includes explicit notes about autosave, builder-variant ambiguity, and test-send/schedule state transitions.",
        ],
        "gap_themes": [
            "autosave_semantics",
            "builder_variant_drift",
            "template_resume_behavior",
            "preflight_gate_copy",
        ],
    },
    "phase_3_reporting_automation": {
        "label": "Phase 3 — Reports, automations, and operational credibility parity",
        "categories": [
            "reporting_screens",
            "automation_journey_flows",
        ],
        "surface_ids": [
            "reports_overview",
            "report_detail",
            "automations_overview",
            "automation_journey_builder",
        ],
        "surface_labels": [
            "Reports overview",
            "Report detail",
            "Automations overview",
            "Customer journey / automation builder",
        ],
        "teardown_refs": [
            "artifacts/mailchimp_clone/program_0/teardown/05_report_overview.md",
            "artifacts/mailchimp_clone/program_0/teardown/06_automation_builder.md",
        ],
        "exit_criteria": [
            "All Program 0 corpus cases for reporting screens and automation journey flows are linked into the evidence bundle.",
            "Reporting artifacts preserve delayed-data semantics, hierarchy of metric cards, and drilldown/export expectations.",
            "Automation artifacts preserve visible publish/pause/resume and broken-journey validation expectations.",
        ],
        "gap_themes": [
            "report_freshness_labels",
            "chart_hierarchy",
            "journey_validation",
            "publish_pause_resume_contract",
        ],
    },
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def program_root(program_date: str = DEFAULT_PROGRAM1_DATE) -> Path:
    return repo_root() / "artifacts" / "mailchimp_clone" / "program_1"


def docs_root() -> Path:
    return repo_root() / "docs"


def benchmarks_root() -> Path:
    return repo_root() / "benchmarks"


def validation_dir(program_date: str = DEFAULT_PROGRAM1_DATE) -> Path:
    return program_root(program_date) / "validation"


def corpus_path(corpus_date: str = PROGRAM0_CORPUS_DATE) -> Path:
    return benchmarks_root() / f"mailchimp_parity_corpus_seed_{corpus_date}.json"


def evidence_bundle_path(program_date: str, phase_id: str) -> Path:
    return program_root(program_date) / phase_id / "evidence_bundle.json"


def phase_summary_path(program_date: str, phase_id: str) -> Path:
    return program_root(program_date) / phase_id / "phase_summary.md"


def prioritized_gap_list_path(program_date: str) -> Path:
    return program_root(program_date) / "prioritized_gap_list.json"


def plan_gate_strategy_path(program_date: str) -> Path:
    return program_root(program_date) / "plan_gate_strategy.json"


def validation_summary_path(program_date: str) -> Path:
    return validation_dir(program_date) / "validation_summary.json"


def harness_report_path(program_date: str, phase_id: str) -> Path:
    return validation_dir(program_date) / f"{phase_id}_harness.json"


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _json_load(path: Path) -> JsonDict:
    return json.loads(path.read_text(encoding="utf-8"))


def _json_dump(path: Path, payload: JsonDict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _phase_spec(phase_id: str) -> JsonDict:
    if phase_id not in PHASE_SPECS:
        raise KeyError(f"unknown_phase:{phase_id}")
    return PHASE_SPECS[phase_id]


def load_corpus_cases(corpus_date: str = PROGRAM0_CORPUS_DATE) -> List[JsonDict]:
    payload = _json_load(corpus_path(corpus_date))
    cases = payload.get("cases") if isinstance(payload, dict) else payload
    return [dict(row) for row in (cases or []) if isinstance(row, dict)]


def expected_case_rows(phase_id: str, *, corpus_date: str = PROGRAM0_CORPUS_DATE) -> List[JsonDict]:
    spec = _phase_spec(phase_id)
    categories = set(spec.get("categories") or [])
    return [row for row in load_corpus_cases(corpus_date) if str(row.get("category") or "") in categories]


def expected_case_ids(phase_id: str, *, corpus_date: str = PROGRAM0_CORPUS_DATE) -> List[str]:
    return [str(row.get("case_id") or "").strip() for row in expected_case_rows(phase_id, corpus_date=corpus_date) if str(row.get("case_id") or "").strip()]


def _phase_gap_entries(phase_id: str) -> List[JsonDict]:
    gap_map = {
        "phase_1_audience_foundation": [
            {
                "gap_id": "MC-P1-GAP-001",
                "surface_id": "signup_onboarding",
                "severity": "high",
                "theme": "resume_behavior",
                "summary": "Resumable onboarding state and dismissible plan-gate nudges need explicit clone behavior.",
                "source_case_ids": ["MC-P0-008", "MC-P0-009"],
            },
            {
                "gap_id": "MC-P1-GAP-002",
                "surface_id": "audience_overview",
                "severity": "high",
                "theme": "multi_audience_model",
                "summary": "The clone needs a visible multi-audience contract even if the underlying model becomes cleaner than Mailchimp’s legacy shape.",
                "source_case_ids": ["MC-P0-013", "MC-P0-018", "MC-P0-019"],
            },
            {
                "gap_id": "MC-P1-GAP-003",
                "surface_id": "segments",
                "severity": "medium",
                "theme": "segment_rule_builder",
                "summary": "Segment rule composition, preview counts, and disabled-save states need parity-focused acceptance checks.",
                "source_case_ids": ["MC-P0-037", "MC-P0-040", "MC-P0-045"],
            },
        ],
        "phase_2_campaign_execution": [
            {
                "gap_id": "MC-P1-GAP-004",
                "surface_id": "campaign_wizard",
                "severity": "high",
                "theme": "autosave_semantics",
                "summary": "Campaign wizard autosave, back/forward flow, and duplicate/resume semantics need explicit clone policy.",
                "source_case_ids": ["MC-P0-049", "MC-P0-055", "MC-P0-058"],
            },
            {
                "gap_id": "MC-P1-GAP-005",
                "surface_id": "email_builder",
                "severity": "high",
                "theme": "builder_variant_drift",
                "summary": "Builder-variant ambiguity and preview differences remain the main parity-risk seam for the editor.",
                "source_case_ids": ["MC-P0-061", "MC-P0-067", "MC-P0-070"],
            },
            {
                "gap_id": "MC-P1-GAP-006",
                "surface_id": "send_schedule_review",
                "severity": "medium",
                "theme": "preflight_gate_copy",
                "summary": "Preflight warnings, recipient estimates, and test-send states need user-visible copy and order parity.",
                "source_case_ids": ["MC-P0-073", "MC-P0-076", "MC-P0-083"],
            },
        ],
        "phase_3_reporting_automation": [
            {
                "gap_id": "MC-P1-GAP-007",
                "surface_id": "reports_overview",
                "severity": "high",
                "theme": "report_freshness_labels",
                "summary": "Delayed or integration-backed data must degrade with explicit freshness language rather than silent zeros.",
                "source_case_ids": ["MC-P0-085", "MC-P0-090", "MC-P0-094"],
            },
            {
                "gap_id": "MC-P1-GAP-008",
                "surface_id": "report_detail",
                "severity": "medium",
                "theme": "chart_hierarchy",
                "summary": "Metric grouping, activity drilldowns, and export affordances need parity-focused hierarchy checks.",
                "source_case_ids": ["MC-P0-086", "MC-P0-091", "MC-P0-096"],
            },
            {
                "gap_id": "MC-P1-GAP-009",
                "surface_id": "automation_journey_builder",
                "severity": "high",
                "theme": "publish_pause_resume_contract",
                "summary": "Automation journeys need explicit publish/pause/resume and broken-journey validation handling.",
                "source_case_ids": ["MC-P0-100", "MC-P0-107", "MC-P0-108"],
            },
        ],
    }
    return [dict(row) for row in gap_map.get(phase_id, [])]


def build_seed_evidence_bundle(phase_id: str, *, program_date: str = DEFAULT_PROGRAM1_DATE, corpus_date: str = PROGRAM0_CORPUS_DATE) -> JsonDict:
    spec = _phase_spec(phase_id)
    cases = expected_case_rows(phase_id, corpus_date=corpus_date)
    surface_rows = []
    for idx, (surface_id, label) in enumerate(zip(spec.get("surface_ids") or [], spec.get("surface_labels") or []), start=1):
        surface_rows.append(
            {
                "surface_id": surface_id,
                "label": label,
                "phase_priority": idx,
                "coverage_status": "seeded_from_program0",
                "parity_focus": [
                    "visible step order",
                    "validation timing",
                    "empty/error/recovery states",
                ],
            }
        )
    case_links = []
    for row in cases:
        case_links.append(
            {
                "case_id": row.get("case_id"),
                "category": row.get("category"),
                "product_surface": row.get("product_surface"),
                "scenario_description": row.get("scenario_description"),
                "parity_mode": row.get("parity_mode"),
                "parity_priority": row.get("parity_priority"),
                "expected_visible_behavior": row.get("expected_visible_behavior"),
                "expected_failure_modes": row.get("expected_failure_modes"),
                "required_setup": row.get("required_setup"),
                "evidence_status": "seeded_phase_scope",
                "planned_harness": phase_id,
                "source_refs": [
                    {
                        "kind": "program0_corpus_case",
                        "case_id": row.get("case_id"),
                        "corpus_date": corpus_date,
                        "path": str(corpus_path(corpus_date)),
                    }
                ],
            }
        )
    return {
        "schema_version": "cortex.mailchimp.program1.phase_evidence.v1",
        "generated_at": now_iso(),
        "program_date": program_date,
        "source_program0_corpus_date": corpus_date,
        "phase_id": phase_id,
        "label": spec.get("label"),
        "categories": list(spec.get("categories") or []),
        "surfaces": surface_rows,
        "expected_case_count": len(case_links),
        "case_links": case_links,
        "exit_criteria": list(spec.get("exit_criteria") or []),
        "gap_entries": _phase_gap_entries(phase_id),
        "teardown_refs": list(spec.get("teardown_refs") or []),
    }


def render_phase_summary_markdown(phase_id: str, *, program_date: str = DEFAULT_PROGRAM1_DATE, corpus_date: str = PROGRAM0_CORPUS_DATE) -> str:
    bundle = build_seed_evidence_bundle(phase_id, program_date=program_date, corpus_date=corpus_date)
    lines = [
        f"# {bundle['label']}",
        "",
        f"- Program: Mailchimp Parity Program 1 ({program_date})",
        f"- Grounded in Program 0 corpus date: {corpus_date}",
        f"- Expected case count: {bundle['expected_case_count']}",
        "",
        "## Surface scope",
    ]
    for row in bundle.get("surfaces") or []:
        lines.append(f"- `{row['surface_id']}` — {row['label']}")
    lines.extend([
        "",
        "## Category scope",
    ])
    for category in bundle.get("categories") or []:
        lines.append(f"- `{category}`")
    lines.extend([
        "",
        "## Exit criteria",
    ])
    for criterion in bundle.get("exit_criteria") or []:
        lines.append(f"- {criterion}")
    lines.extend([
        "",
        "## Program 0 teardown references",
    ])
    for ref in bundle.get("teardown_refs") or []:
        lines.append(f"- `{ref}`")
    lines.extend([
        "",
        "## Top gap themes",
    ])
    for row in bundle.get("gap_entries") or []:
        lines.append(f"- `{row['gap_id']}` — {row['summary']}")
    return "\n".join(lines) + "\n"


def build_prioritized_gap_list(*, program_date: str = DEFAULT_PROGRAM1_DATE) -> JsonDict:
    priorities: List[JsonDict] = []
    for phase_id in PHASE_ORDER:
        priorities.extend([{**row, "phase_id": phase_id} for row in _phase_gap_entries(phase_id)])
    priorities.append(
        {
            "gap_id": "MC-P1-GAP-010",
            "phase_id": "cross_phase",
            "surface_id": "billing_plans",
            "severity": "medium",
            "theme": "plan_gate_strategy",
            "summary": "Plan, role, and compliance gates must preserve Mailchimp-style visible blockers even when the clone uses a simpler internal policy engine.",
            "source_case_ids": ["MC-P0-009", "MC-P0-018", "MC-P0-117"],
        }
    )
    return {
        "schema_version": "cortex.mailchimp.program1.gap_list.v1",
        "generated_at": now_iso(),
        "program_date": program_date,
        "priorities": priorities,
    }


def build_plan_gate_strategy(*, program_date: str = DEFAULT_PROGRAM1_DATE) -> JsonDict:
    return {
        "schema_version": "cortex.mailchimp.program1.plan_gate_strategy.v1",
        "generated_at": now_iso(),
        "program_date": program_date,
        "principles": [
            "Preserve Mailchimp-visible blocker semantics even if the underlying billing or authorization model is simplified.",
            "Do not silently hide unavailable actions; prefer visible disabled states with explanatory copy or explicit upgrade/permission messaging.",
            "Treat compliance blockers, sender-auth blockers, and role blockers as distinct visible classes.",
        ],
        "gate_types": [
            {
                "gate_type": "plan_limit",
                "visible_contract": "Disabled CTA or modal warning with preserved draft state.",
                "applies_to": ["signup_onboarding", "audience_overview", "billing_plans", "reports_overview"],
            },
            {
                "gate_type": "role_permission",
                "visible_contract": "Read-only surface or explicit no-access state with team-settings escalation path.",
                "applies_to": ["campaign_wizard", "send_schedule_review", "team_roles_permissions"],
            },
            {
                "gate_type": "compliance_sender_auth",
                "visible_contract": "Inline blocking warning before send/publish with remediation path.",
                "applies_to": ["account_workspace_setup", "send_schedule_review", "settings_domains"],
            },
            {
                "gate_type": "integration_data_absent",
                "visible_contract": "Report or automation state degrades with explicit missing-data copy rather than silent zeros.",
                "applies_to": ["reports_overview", "report_detail", "automation_journey_builder"],
            },
        ],
        "role_matrix": [
            {"role": "owner_admin", "can_send": True, "can_manage_audience": True, "can_manage_billing": True},
            {"role": "marketer_editor", "can_send": True, "can_manage_audience": True, "can_manage_billing": False},
            {"role": "analyst_viewer", "can_send": False, "can_manage_audience": False, "can_manage_billing": False},
        ],
    }


def verify_phase_evidence(program_date: str, phase_id: str, *, corpus_date: str = PROGRAM0_CORPUS_DATE) -> JsonDict:
    spec = _phase_spec(phase_id)
    evidence_path = evidence_bundle_path(program_date, phase_id)
    summary_path = phase_summary_path(program_date, phase_id)
    missing_artifacts = [str(path) for path in (evidence_path, summary_path) if not path.exists()]
    if missing_artifacts:
        return {
            "phase_id": phase_id,
            "label": spec.get("label"),
            "complete": False,
            "missing_artifacts": missing_artifacts,
            "details": {
                "expected_case_count": len(expected_case_ids(phase_id, corpus_date=corpus_date)),
                "actual_case_count": 0,
            },
        }

    payload = _json_load(evidence_path)
    links = [dict(row) for row in (payload.get("case_links") or []) if isinstance(row, dict)]
    expected_rows = expected_case_rows(phase_id, corpus_date=corpus_date)
    expected_ids = {str(row.get("case_id") or "").strip() for row in expected_rows if str(row.get("case_id") or "").strip()}
    actual_ids = {str(row.get("case_id") or "").strip() for row in links if str(row.get("case_id") or "").strip()}
    missing_case_ids = sorted(expected_ids - actual_ids)
    unexpected_case_ids = sorted(actual_ids - expected_ids)
    expected_categories = set(spec.get("categories") or [])
    actual_categories = {str(row.get("category") or "").strip() for row in links if str(row.get("category") or "").strip()}
    missing_categories = sorted(expected_categories - actual_categories)
    surface_ids = {str(row.get("surface_id") or "").strip() for row in (payload.get("surfaces") or []) if isinstance(row, dict) and str(row.get("surface_id") or "").strip()}
    required_surfaces = set(spec.get("surface_ids") or [])
    missing_surfaces = sorted(required_surfaces - surface_ids)
    return {
        "phase_id": phase_id,
        "label": spec.get("label"),
        "complete": not (missing_case_ids or unexpected_case_ids or missing_categories or missing_surfaces),
        "missing_artifacts": [],
        "details": {
            "expected_case_count": len(expected_ids),
            "actual_case_count": len(actual_ids),
            "missing_case_ids": missing_case_ids,
            "unexpected_case_ids": unexpected_case_ids,
            "missing_categories": missing_categories,
            "missing_surfaces": missing_surfaces,
        },
    }


def verify_gap_strategy(program_date: str) -> JsonDict:
    missing_artifacts = [
        str(path)
        for path in (prioritized_gap_list_path(program_date), plan_gate_strategy_path(program_date))
        if not path.exists()
    ]
    if missing_artifacts:
        return {
            "complete": False,
            "missing_artifacts": missing_artifacts,
            "details": {"gap_count": 0, "gate_type_count": 0, "role_count": 0},
        }
    gaps = _json_load(prioritized_gap_list_path(program_date))
    strategy = _json_load(plan_gate_strategy_path(program_date))
    gap_count = len(gaps.get("priorities") or []) if isinstance(gaps, dict) else 0
    gate_type_count = len(strategy.get("gate_types") or []) if isinstance(strategy, dict) else 0
    role_count = len(strategy.get("role_matrix") or []) if isinstance(strategy, dict) else 0
    complete = gap_count >= 8 and gate_type_count >= 4 and role_count >= 3
    return {
        "complete": complete,
        "missing_artifacts": [] if complete else ["gap strategy artifacts do not meet minimum counts"],
        "details": {
            "gap_count": gap_count,
            "gate_type_count": gate_type_count,
            "role_count": role_count,
        },
    }


def build_validation_summary(program_date: str, *, corpus_date: str = PROGRAM0_CORPUS_DATE, persist: bool = True) -> JsonDict:
    phase_reports = [verify_phase_evidence(program_date, phase_id, corpus_date=corpus_date) for phase_id in PHASE_ORDER]
    gap_strategy = verify_gap_strategy(program_date)
    payload = {
        "schema_version": "cortex.mailchimp.program1.validation.v1",
        "generated_at": now_iso(),
        "program_date": program_date,
        "source_program0_corpus_date": corpus_date,
        "all_complete": all(row.get("complete") for row in phase_reports) and bool(gap_strategy.get("complete")),
        "phase_reports": phase_reports,
        "gap_strategy": gap_strategy,
    }
    if persist:
        validation_dir(program_date).mkdir(parents=True, exist_ok=True)
        for report in phase_reports:
            _json_dump(harness_report_path(program_date, report["phase_id"]), report)
        _json_dump(validation_summary_path(program_date), payload)
    return payload


def materialize_seed_artifacts(program_date: str = DEFAULT_PROGRAM1_DATE, *, corpus_date: str = PROGRAM0_CORPUS_DATE) -> JsonDict:
    root = program_root(program_date)
    root.mkdir(parents=True, exist_ok=True)
    phase_rows = []
    for phase_id in PHASE_ORDER:
        bundle = build_seed_evidence_bundle(phase_id, program_date=program_date, corpus_date=corpus_date)
        _json_dump(evidence_bundle_path(program_date, phase_id), bundle)
        phase_summary_path(program_date, phase_id).write_text(
            render_phase_summary_markdown(phase_id, program_date=program_date, corpus_date=corpus_date),
            encoding="utf-8",
        )
        phase_rows.append({
            "phase_id": phase_id,
            "label": bundle.get("label"),
            "expected_case_count": bundle.get("expected_case_count"),
            "artifact": str(evidence_bundle_path(program_date, phase_id)),
        })
    _json_dump(prioritized_gap_list_path(program_date), build_prioritized_gap_list(program_date=program_date))
    _json_dump(plan_gate_strategy_path(program_date), build_plan_gate_strategy(program_date=program_date))
    validation = build_validation_summary(program_date, corpus_date=corpus_date, persist=True)
    return {
        "program_date": program_date,
        "source_program0_corpus_date": corpus_date,
        "artifacts_root": str(root),
        "phases": phase_rows,
        "validation": validation,
    }
