from __future__ import annotations

import json
from pathlib import Path

from cortex_server.benchmarks import mailchimp_parity_supervisor as supervisor


def _patch_repo(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(supervisor, "repo_root", lambda: tmp_path)


def _write(path: Path, payload: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload, encoding="utf-8")


def _write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _write_framework_files(tmp_path: Path):
    _write(tmp_path / "cortex_server" / "benchmarks" / "mailchimp_parity_supervisor.py", "# supervisor\n")
    _write(tmp_path / "scripts" / "run_mailchimp_parity_supervisor.py", "# cli\n")
    _write(tmp_path / "scripts" / "watch_mailchimp_parity_completion.py", "# watch\n")
    _write(tmp_path / "scripts" / "run_mailchimp_parity_notify_once.py", "# notify\n")


def test_surface_map_and_corpus_minimums(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"

    _write(tmp_path / "docs" / f"MAILCHIMP_PRODUCT_SURFACE_MAP_{date}.md", "surface doc")
    _write_json(tmp_path / "artifacts" / "mailchimp_clone" / "program_0" / "surface_map.json", {"surfaces": [{"id": str(i)} for i in range(19)]})
    surface = supervisor.verify_stage(date, "surface_map")
    assert surface["complete"] is False
    assert surface["details"]["surface_count"] == 19

    _write_json(tmp_path / "artifacts" / "mailchimp_clone" / "program_0" / "surface_map.json", {"surfaces": [{"id": str(i)} for i in range(20)]})
    surface = supervisor.verify_stage(date, "surface_map")
    assert surface["complete"] is True
    assert surface["details"]["surface_count"] == 20

    _write(tmp_path / "docs" / f"MAILCHIMP_PARITY_CORPUS_GUIDE_{date}.md", "corpus guide")
    _write_json(tmp_path / "benchmarks" / f"mailchimp_parity_corpus_seed_{date}.json", {"cases": [{"id": str(i)} for i in range(99)]})
    corpus = supervisor.verify_stage(date, "corpus_seed")
    assert corpus["complete"] is False
    assert corpus["details"]["case_count"] == 99

    _write_json(tmp_path / "benchmarks" / f"mailchimp_parity_corpus_seed_{date}.json", {"cases": [{"id": str(i)} for i in range(100)]})
    corpus = supervisor.verify_stage(date, "corpus_seed")
    assert corpus["complete"] is True
    assert corpus["details"]["case_count"] == 100


def test_teardown_minimum_and_stage_spec_visibility(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    teardown_dir = tmp_path / "artifacts" / "mailchimp_clone" / "program_0" / "teardown"
    teardown_dir.mkdir(parents=True, exist_ok=True)
    for idx in range(9):
        _write(teardown_dir / f"dossier_{idx}.md", "# dossier\n")
    result = supervisor.verify_stage(date, "teardown_pack")
    assert result["complete"] is False
    assert result["details"]["dossier_count"] == 9

    _write(teardown_dir / "dossier_9.md", "# dossier\n")
    result = supervisor.verify_stage(date, "teardown_pack")
    assert result["complete"] is True
    assert result["details"]["dossier_count"] == 10

    spec = supervisor.stage_spec_view(date)
    stages = {row["stage"]: row for row in spec["stages"]}
    assert "parity_charter" in stages
    assert "validation" in stages
    assert any(path.endswith("MAILCHIMP_PARITY_CHARTER_2026-04-01.md") for path in stages["parity_charter"]["required_artifacts"])


def test_completion_summary_and_notification_state(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    root = tmp_path / "artifacts" / "mailchimp_clone" / "program_0"
    docs = tmp_path / "docs"
    bench = tmp_path / "benchmarks"
    docs.mkdir(parents=True, exist_ok=True)
    bench.mkdir(parents=True, exist_ok=True)
    (root / "teardown").mkdir(parents=True, exist_ok=True)
    (root / "validation").mkdir(parents=True, exist_ok=True)

    _write_framework_files(tmp_path)
    _write(docs / f"MAILCHIMP_PARITY_CHARTER_{date}.md", "charter")
    _write(docs / f"MAILCHIMP_PRODUCT_SURFACE_MAP_{date}.md", "surface doc")
    _write_json(root / "surface_map.json", {"surfaces": [{"id": str(i)} for i in range(26)]})
    _write(docs / f"MAILCHIMP_PARITY_CORPUS_GUIDE_{date}.md", "guide")
    _write_json(bench / f"mailchimp_parity_corpus_seed_{date}.json", {"cases": [{"id": str(i)} for i in range(120)]})
    for idx in range(10):
        _write(root / "teardown" / f"dossier_{idx}.md", "# dossier\n")
    _write(docs / f"MAILCHIMP_PARITY_ARTIFACT_LAYOUT_{date}.md", "layout")
    _write_json(root / "validation" / "validation_summary.json", {"returncode": 0, "command": ["python3", "-m", "pytest"]})
    _write(docs / f"MAILCHIMP_PARITY_PROGRAM_0_FINAL_REPORT_{date}.md", "final report")

    state = supervisor.reconcile_state(date)
    assert state["all_complete"] is True

    summary = supervisor.build_completion_summary(date)
    assert summary["all_complete"] is True
    assert summary["summary"]["surface_count"] == 26
    assert summary["summary"]["case_count"] == 120
    assert summary["summary"]["dossier_count"] == 10
    assert (root / "completion_summary.json").exists()

    notification = supervisor.notification_state(date)
    assert notification["notified"] is False
    marked = supervisor.mark_notified(date, note="delivered")
    assert marked["notified"] is True
    assert marked["notify_count"] == 1


def test_wait_for_completion_marks_notification(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    root = tmp_path / "artifacts" / "mailchimp_clone" / "program_0"
    docs = tmp_path / "docs"
    bench = tmp_path / "benchmarks"
    docs.mkdir(parents=True, exist_ok=True)
    bench.mkdir(parents=True, exist_ok=True)
    (root / "teardown").mkdir(parents=True, exist_ok=True)
    (root / "validation").mkdir(parents=True, exist_ok=True)

    _write_framework_files(tmp_path)
    _write(docs / f"MAILCHIMP_PARITY_CHARTER_{date}.md", "charter")
    _write(docs / f"MAILCHIMP_PRODUCT_SURFACE_MAP_{date}.md", "surface doc")
    _write_json(root / "surface_map.json", {"surfaces": [{"id": str(i)} for i in range(20)]})
    _write(docs / f"MAILCHIMP_PARITY_CORPUS_GUIDE_{date}.md", "guide")
    _write_json(bench / f"mailchimp_parity_corpus_seed_{date}.json", {"cases": [{"id": str(i)} for i in range(100)]})
    for idx in range(10):
        _write(root / "teardown" / f"dossier_{idx}.md", "# dossier\n")
    _write(docs / f"MAILCHIMP_PARITY_ARTIFACT_LAYOUT_{date}.md", "layout")
    _write_json(root / "validation" / "validation_summary.json", {"returncode": 0})
    _write(docs / f"MAILCHIMP_PARITY_PROGRAM_0_FINAL_REPORT_{date}.md", "final report")

    payload = supervisor.wait_for_completion(date, timeout_seconds=1, interval_seconds=1, mark_complete_notification=True)
    assert payload["all_complete"] is True
    assert payload["completion_summary"]["all_complete"] is True
    assert payload["notification"]["notified"] is True
