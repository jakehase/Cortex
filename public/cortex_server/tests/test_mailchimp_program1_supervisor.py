from __future__ import annotations

import json
from pathlib import Path

from cortex_server.benchmarks import mailchimp_program1_harness as harness
from cortex_server.benchmarks import mailchimp_program1_supervisor as supervisor


PHASE_CATEGORIES = [
    "signup_onboarding",
    "audience_creation",
    "contact_import_update",
    "segmentation_behavior",
    "campaign_creation_editing",
    "template_editor_interactions",
    "send_schedule_flows",
    "reporting_screens",
    "automation_journey_flows",
]


def _patch_repo(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(harness, "repo_root", lambda: tmp_path)
    monkeypatch.setattr(supervisor, "repo_root", lambda: tmp_path)


def _write(path: Path, payload: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload, encoding="utf-8")


def _write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _seed_program0_corpus(tmp_path: Path, date: str = "2026-04-01"):
    cases = []
    idx = 1
    for category in PHASE_CATEGORIES:
        for n in range(12):
            cases.append(
                {
                    "case_id": f"MC-P0-{idx:03d}",
                    "category": category,
                    "product_surface": category.replace("_", " "),
                    "scenario_description": f"Scenario {n + 1} for {category}",
                    "parity_mode": "workflow",
                    "parity_priority": "P0",
                    "expected_visible_behavior": "Preserve visible Mailchimp-style state transitions.",
                    "expected_failure_modes": "Show a legible blocker if the action cannot complete.",
                    "required_setup": "Seeded test workspace.",
                }
            )
            idx += 1
    _write_json(tmp_path / "benchmarks" / f"mailchimp_parity_corpus_seed_{date}.json", {"case_count": len(cases), "cases": cases})


def _write_docs(tmp_path: Path, date: str = "2026-04-02"):
    _write(tmp_path / "docs" / f"MAILCHIMP_PARITY_PROGRAM_1_SUPERVISED_ROADMAP_{date}.md", "roadmap")
    _write(tmp_path / "docs" / f"MAILCHIMP_PARITY_PROGRAM_1_FINAL_REPORT_{date}.md", "final report")


def test_materialize_seed_artifacts_writes_expected_phase_counts(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    _seed_program0_corpus(tmp_path)

    payload = harness.materialize_seed_artifacts(program_date="2026-04-02", corpus_date="2026-04-01")

    assert payload["validation"]["all_complete"] is True
    reports = {row["phase_id"]: row for row in payload["validation"]["phase_reports"]}
    assert reports["phase_1_audience_foundation"]["details"]["actual_case_count"] == 48
    assert reports["phase_2_campaign_execution"]["details"]["actual_case_count"] == 36
    assert reports["phase_3_reporting_automation"]["details"]["actual_case_count"] == 24
    assert harness.evidence_bundle_path("2026-04-02", "phase_1_audience_foundation").exists()
    assert harness.validation_summary_path("2026-04-02").exists()


def test_verify_phase_evidence_detects_missing_case(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    _seed_program0_corpus(tmp_path)
    harness.materialize_seed_artifacts(program_date="2026-04-02", corpus_date="2026-04-01")

    path = harness.evidence_bundle_path("2026-04-02", "phase_1_audience_foundation")
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["case_links"] = payload["case_links"][:-1]
    path.write_text(json.dumps(payload), encoding="utf-8")

    report = harness.verify_phase_evidence("2026-04-02", "phase_1_audience_foundation", corpus_date="2026-04-01")

    assert report["complete"] is False
    assert len(report["details"]["missing_case_ids"]) == 1
    assert report["details"]["actual_case_count"] == 47


def test_program1_supervisor_completion_summary_and_notification(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    _seed_program0_corpus(tmp_path)
    harness.materialize_seed_artifacts(program_date="2026-04-02", corpus_date="2026-04-01")
    _write_docs(tmp_path)

    state = supervisor.reconcile_state("2026-04-02")
    assert state["all_complete"] is True

    summary = supervisor.build_completion_summary("2026-04-02")
    assert summary["all_complete"] is True
    assert summary["summary"]["phase_1_audience_foundation"] == 48
    assert summary["summary"]["phase_2_campaign_execution"] == 36
    assert summary["summary"]["phase_3_reporting_automation"] == 24

    notification = supervisor.notification_state("2026-04-02")
    assert notification["notified"] is False
    marked = supervisor.mark_notified("2026-04-02", note="delivered")
    assert marked["notified"] is True
    assert marked["notify_count"] == 1


def test_wait_for_completion_marks_notification(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    _seed_program0_corpus(tmp_path)
    harness.materialize_seed_artifacts(program_date="2026-04-02", corpus_date="2026-04-01")
    _write_docs(tmp_path)

    payload = supervisor.wait_for_completion("2026-04-02", timeout_seconds=1, interval_seconds=1, mark_complete_notification=True)

    assert payload["all_complete"] is True
    assert payload["completion_summary"]["all_complete"] is True
    assert payload["notification"]["notified"] is True
