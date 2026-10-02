from __future__ import annotations

import hashlib
import json
from pathlib import Path


WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
AIOS_BUNDLE = (
    WORKSPACE_ROOT / "ai-os" / "artifacts" / "language-adoption-20260711T211822Z"
)
LEARNING_ROOT = WORKSPACE_ROOT / "cortex-learning-os"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_agg_f050_aios_bundle_manifest_replays_from_workspace_root() -> None:
    manifest = AIOS_BUNDLE / "bundle-manifest.sha256"
    checked = 0

    for line in manifest.read_text(encoding="utf-8").splitlines():
        expected, relative = line.split(maxsplit=1)
        relative_path = Path(relative.strip())
        assert not relative_path.is_absolute()
        assert ".." not in relative_path.parts

        artifact = WORKSPACE_ROOT / relative_path
        assert artifact.is_file(), relative
        assert _sha256(artifact) == expected, relative
        checked += 1

    assert checked == 35


def test_agg_f050_learning_receipt_and_service_guard_are_self_contained() -> None:
    latest = json.loads(
        (LEARNING_ROOT / "artifacts" / "latest-qualified-run.json").read_text(
            encoding="utf-8"
        )
    )
    artifact_root = LEARNING_ROOT / latest["artifactRoot"]
    manifest = artifact_root / "artifact_manifest.json"
    assert manifest.is_file()
    assert _sha256(manifest) == latest["manifestSha256"]

    receipt = json.loads(manifest.read_text(encoding="utf-8"))
    checked = 0
    for entry in receipt["files"]:
        relative_path = Path(entry["path"])
        assert not relative_path.is_absolute()
        assert ".." not in relative_path.parts
        artifact = artifact_root / relative_path
        assert artifact.is_file(), entry["path"]
        assert _sha256(artifact) == entry["sha256"], entry["path"]
        checked += 1
    assert checked == 36

    guard = WORKSPACE_ROOT / "deploy" / "systemd" / "cortex-memory-guard.conf"
    guard_text = guard.read_text(encoding="utf-8")
    for setting in (
        "MemoryHigh=2G",
        "MemoryMax=3G",
        "MemorySwapMax=512M",
        "OOMPolicy=stop",
    ):
        assert setting in guard_text
