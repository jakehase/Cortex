import hashlib
from pathlib import Path

import pytest

from cortex_server.runtime import runtime_delivery_quota


def _write_sized(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.truncate(size)


def _admit(
    root: Path,
    store: Path,
    process_id: str,
    target: Path,
    size: int,
) -> None:
    with runtime_delivery_quota.runtime_delivery_quota_transaction(root):
        runtime_delivery_quota.assert_runtime_delivery_capacity(
            delivery_root=root,
            store_root=store,
            process_id=process_id,
            object_bytes=size,
            additional_bytes=size,
            replacing=target,
        )


def test_process_quota_counts_exact_canonical_paths_across_stores(tmp_path):
    root = tmp_path / "runtime_delivery"
    roadmap = root / "roadmap_executor"
    production = root / "production_build_loop"
    process_id = "victim"
    for store in (roadmap, production):
        _write_sized(store / "contracts" / f"{process_id}.json", 4 * 1024 * 1024)
        _write_sized(store / "state" / f"{process_id}.json", 4 * 1024 * 1024)
        _write_sized(store / "history" / f"{process_id}.jsonl", 32 * 1024 * 1024)
        _write_sized(store / "reports" / f"{process_id}.jsonl", 16 * 1024 * 1024)

    with pytest.raises(ValueError, match="runtime delivery process quota exceeded"):
        _admit(
            root,
            production,
            process_id,
            production / "contracts" / f"{process_id}.json",
            1024 * 1024,
        )


def test_process_quota_counts_hashed_rollback_result_namespace(tmp_path):
    root = tmp_path / "runtime_delivery"
    store = root / "release_workflow"
    process_id = "victim"
    process_digest = hashlib.sha256(process_id.encode("utf-8")).hexdigest()
    rollback_root = store / "rollback_results" / process_digest
    for index in range(16):
        _write_sized(rollback_root / f"{index:064x}.json", 4 * 1024 * 1024)

    with pytest.raises(ValueError, match="runtime delivery process quota exceeded"):
        _admit(
            root,
            rollback_root,
            process_id,
            rollback_root / f"{16:064x}.json",
            1024 * 1024,
        )


def test_process_quota_does_not_use_basename_prefix_or_substring_matching(tmp_path, monkeypatch):
    root = tmp_path / "runtime_delivery"
    store = root / "production_build_loop"
    process_id = "victim"
    monkeypatch.setattr(runtime_delivery_quota, "MAX_RUNTIME_DELIVERY_PROCESS_BYTES", 100)
    _write_sized(store / "reports" / "victim.backup.json", 100)

    _admit(root, store, process_id, store / "reports" / f"{process_id}.jsonl", 1)


def test_process_quota_projects_replacement_final_sizes_once(tmp_path, monkeypatch):
    root = tmp_path / "runtime_delivery"
    store = root / "production_build_loop"
    process_id = "victim"
    target = store / "reports" / f"{process_id}.jsonl"
    monkeypatch.setattr(runtime_delivery_quota, "MAX_RUNTIME_DELIVERY_PROCESS_BYTES", 100)
    _write_sized(target, 90)

    _admit(root, store, process_id, target, 80)
    with pytest.raises(ValueError, match="runtime delivery process quota exceeded"):
        _admit(root, store, process_id, target, 101)
