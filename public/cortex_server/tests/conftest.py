from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def isolate_generated_homeostasis_artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("CORTEX_ARTIFACT_ROOT", str(tmp_path / "artifacts"))
