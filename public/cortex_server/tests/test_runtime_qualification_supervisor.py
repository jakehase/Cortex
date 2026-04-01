from __future__ import annotations

import json
from pathlib import Path

from cortex_server.benchmarks import runtime_qualification_supervisor as supervisor


def _patch_repo(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(supervisor, "repo_root", lambda: tmp_path)


def test_supervisor_verifies_corpus_and_experiments_and_sets_next_stage(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    corpus_path = tmp_path / "benchmarks" / "cortex_runtime_qualification_corpus_2026-04-01.json"
    corpus_path.parent.mkdir(parents=True, exist_ok=True)
    corpus_path.write_text(json.dumps({"cases": [{"id": f"case_{idx}"} for idx in range(32)]}), encoding="utf-8")

    exp_dir = tmp_path / "artifacts" / "qualification" / "2026-04-01" / "experiments"
    exp_dir.mkdir(parents=True, exist_ok=True)
    (exp_dir / "index.json").write_text(
        json.dumps({"experiments": [{"id": f"exp_{idx}"} for idx in range(6)], "winner": "exp_0"}),
        encoding="utf-8",
    )

    corpus = supervisor.verify_stage("2026-04-01", "corpus")
    experiments = supervisor.verify_stage("2026-04-01", "experiments")
    assert corpus["complete"] is True
    assert corpus["details"]["case_count"] == 32
    assert experiments["complete"] is True
    assert experiments["details"]["experiment_count"] == 6

    state = supervisor.reconcile_state("2026-04-01")
    assert state["stages"]["corpus"]["completed"] is True
    assert state["stages"]["experiments"]["completed"] is True
    assert state["next_stage"] == "baseline"
    assert state["all_complete"] is False


def test_supervisor_reconciles_completed_background_soak(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    date = "2026-04-01"
    root = tmp_path / "artifacts" / "qualification" / date
    run_dir = root / "_runs" / "soak_run_2"
    run_dir.mkdir(parents=True, exist_ok=True)
    exit_code_path = run_dir / "exit_code.txt"
    exit_code_path.write_text("0", encoding="utf-8")

    (root / "soak_run_2.json").write_text(json.dumps({"duration_seconds": 1800, "round_count": 5}), encoding="utf-8")
    (root / "soak_run_2.md").write_text("# soak\n", encoding="utf-8")

    state = supervisor.build_initial_state(date)
    state["active_process"] = {
        "stage": "soak_run_2",
        "pid": 999999,
        "started_at": "2026-04-01T00:00:00Z",
        "exit_code_path": str(exit_code_path),
    }
    supervisor.save_state(date, state)

    reconciled = supervisor.reconcile_state(date)
    assert reconciled["active_process"] is None
    assert reconciled["stages"]["soak_run_2"]["completed"] is True
    assert reconciled["stages"]["soak_run_2"]["status"] == "complete"


def test_supervisor_stage_spec_exposes_auto_runnable_commands(monkeypatch, tmp_path):
    _patch_repo(monkeypatch, tmp_path)
    payload = supervisor.stage_spec_view("2026-04-01")
    stages = {row["stage"]: row for row in payload["stages"]}
    assert stages["baseline"]["auto_runnable"] is True
    assert stages["baseline"]["command"][0].endswith("python") or stages["baseline"]["command"][0].endswith("python3")
    assert stages["soak_run_1"]["soak"] is True
    assert stages["final_report"]["auto_runnable"] is False
