#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MonkeyPatch:
    def __init__(self) -> None:
        self._changes = []

    def setattr(self, target, name: str, value) -> None:
        self._changes.append((target, name, getattr(target, name)))
        setattr(target, name, value)

    def undo(self) -> None:
        for target, name, original in reversed(self._changes):
            setattr(target, name, original)


def main() -> int:
    release_tests = load_module(
        "q9_release_tooling_smoke",
        ROOT / "public" / "cortex_server" / "tests" / "test_q9_release_tooling.py",
    )
    with tempfile.TemporaryDirectory() as raw:
        release_tests.test_release_envelope_binds_exact_files_modes_and_absence_of_extras(Path(raw))
    release_tests.test_q9_runtime_surface_contract_has_no_live_secret_values()
    with tempfile.TemporaryDirectory() as raw:
        monkeypatch = MonkeyPatch()
        try:
            release_tests.test_release_supervisor_derives_a_terminal_blocker_from_matrix_and_missing_receipts(
                Path(raw), monkeypatch
            )
        finally:
            monkeypatch.undo()

    notifier_tests = load_module(
        "detached_job_notifier_smoke",
        ROOT / "tests" / "test_detached_job_notifier.py",
    )
    suite = unittest.defaultTestLoader.loadTestsFromModule(notifier_tests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
