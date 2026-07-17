import hashlib
import json
import multiprocessing
import os
from pathlib import Path

import pytest

from cortex_server.runtime import runtime_delivery_quota


def _hold_runtime_delivery_reservation(
    root: str,
    ready,
    release,
    reserved_bytes: int,
) -> None:
    try:
        with runtime_delivery_quota.runtime_delivery_capacity_reservation(
            Path(root),
            reserved_bytes=reserved_bytes,
        ):
            ready.send(("ready", os.getpid()))
            if not release.wait(20):
                raise RuntimeError("reservation test release timed out")
    except BaseException as exc:
        try:
            ready.send(("error", repr(exc)))
        finally:
            ready.close()
        raise
    ready.close()


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


def test_live_cross_process_reservation_survives_lease_and_wall_clock_jumps(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(runtime_delivery_quota, "MAX_RUNTIME_DELIVERY_VOLUME_BYTES", 1000)
    monkeypatch.setattr(runtime_delivery_quota, "RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES", 100)
    root = tmp_path / "runtime_delivery"
    root.mkdir()
    (root / "existing.bin").write_bytes(b"x" * 300)
    context = multiprocessing.get_context("fork")
    receiver, sender = context.Pipe(duplex=False)
    release = context.Event()
    process = context.Process(
        target=_hold_runtime_delivery_reservation,
        args=(str(root), sender, release, 500),
    )
    process.start()
    sender.close()

    try:
        assert receiver.poll(10), "reservation worker did not publish readiness"
        status, detail = receiver.recv()
        assert status == "ready", detail
        reservation_paths = list(
            (root / ".runtime-delivery-reservations").glob("*.json")
        )
        assert len(reservation_paths) == 1
        target = reservation_paths[0]
        original = json.loads(target.read_text(encoding="utf-8"))
        assert original["version"] == "cortex.runtime-delivery-reservation.v2"
        assert original["pid"] == detail == process.pid
        assert original["process_start_ticks"]
        assert original["boot_id"]
        assert process.is_alive()

        class JumpingClock:
            wall = float(original["created_at"])
            monotonic_value = float(original["heartbeat_monotonic"])

            def time(self):
                return self.wall

            def monotonic(self):
                return self.monotonic_value

        clock = JumpingClock()
        # Keep the child on its real clock, but move the competing process past
        # two complete leases while wall time jumps both forward and backward.
        monkeypatch.setattr(runtime_delivery_quota, "time", clock)
        for wall_jump in (86_400.0, -86_400.0):
            assert process.is_alive()
            before = json.loads(target.read_text(encoding="utf-8"))
            clock.wall = float(original["created_at"]) + wall_jump
            clock.monotonic_value = (
                float(before["heartbeat_monotonic"])
                + runtime_delivery_quota.RUNTIME_DELIVERY_RESERVATION_TIMEOUT_SECONDS
                + 1
            )
            with pytest.raises(
                runtime_delivery_quota.RuntimeDeliveryQuotaError,
                match="recovery reserve",
            ):
                with runtime_delivery_quota.runtime_delivery_capacity_reservation(
                    root,
                    reserved_bytes=200,
                ):
                    pass
            renewed = json.loads(target.read_text(encoding="utf-8"))
            assert renewed["heartbeat_monotonic"] == clock.monotonic_value
            assert (
                renewed["lease_expires_monotonic"]
                - renewed["heartbeat_monotonic"]
                == runtime_delivery_quota.RUNTIME_DELIVERY_RESERVATION_TIMEOUT_SECONDS
            )
            assert renewed["pid"] == process.pid
            assert runtime_delivery_quota.runtime_delivery_capacity(root)["reservedBytes"] == 500
    finally:
        release.set()
        process.join(10)
        if process.is_alive():
            process.terminate()
            process.join(5)
        receiver.close()

    assert process.exitcode == 0
    assert not list((root / ".runtime-delivery-reservations").glob("*.json"))


@pytest.mark.parametrize("gone_reason", ["owner_death", "start_identity_mismatch"])
def test_expired_reservation_reclaims_only_proven_owner_loss(
    tmp_path,
    monkeypatch,
    gone_reason,
):
    monkeypatch.setattr(runtime_delivery_quota, "MAX_RUNTIME_DELIVERY_VOLUME_BYTES", 1000)
    monkeypatch.setattr(runtime_delivery_quota, "RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES", 100)
    root = tmp_path / "runtime_delivery"
    root.mkdir()
    (root / "existing.bin").write_bytes(b"x" * 850)
    identity = runtime_delivery_quota._current_process_identity()
    reservation_root = root / ".runtime-delivery-reservations"
    reservation_root.mkdir()
    target = reservation_root / ("a" * 32 + ".json")
    gone = {
        "version": "cortex.runtime-delivery-reservation.v2",
        **identity,
        "created_at": 0.0,
        "heartbeat_monotonic": 0.0,
        "lease_expires_monotonic": float(
            runtime_delivery_quota.RUNTIME_DELIVERY_RESERVATION_TIMEOUT_SECONDS
        ),
        "reserved_bytes": 100,
    }
    if gone_reason == "owner_death":
        gone["pid"] = 2_147_483_647
    else:
        gone["process_start_ticks"] = str(int(identity["process_start_ticks"]) + 1)
    target.write_text(json.dumps(gone), encoding="utf-8")
    monkeypatch.setattr(
        runtime_delivery_quota,
        "_monotonic",
        lambda: runtime_delivery_quota.RUNTIME_DELIVERY_RESERVATION_TIMEOUT_SECONDS + 1,
    )

    with runtime_delivery_quota.runtime_delivery_quota_transaction(root):
        runtime_delivery_quota.assert_runtime_delivery_volume_capacity(
            root,
            additional_bytes=50,
        )

    assert not target.exists()


def test_expired_reservation_stays_charged_when_owner_probe_is_inconclusive(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(runtime_delivery_quota, "MAX_RUNTIME_DELIVERY_VOLUME_BYTES", 1000)
    monkeypatch.setattr(runtime_delivery_quota, "RUNTIME_DELIVERY_RECOVERY_RESERVE_BYTES", 100)
    root = tmp_path / "runtime_delivery"
    root.mkdir()
    (root / "existing.bin").write_bytes(b"x" * 850)
    identity = runtime_delivery_quota._current_process_identity()
    reservation_root = root / ".runtime-delivery-reservations"
    reservation_root.mkdir()
    target = reservation_root / ("b" * 32 + ".json")
    reservation = {
        "version": "cortex.runtime-delivery-reservation.v2",
        **identity,
        "created_at": 0.0,
        "heartbeat_monotonic": 0.0,
        "lease_expires_monotonic": float(
            runtime_delivery_quota.RUNTIME_DELIVERY_RESERVATION_TIMEOUT_SECONDS
        ),
        "reserved_bytes": 100,
    }
    target.write_text(json.dumps(reservation), encoding="utf-8")
    monkeypatch.setattr(
        runtime_delivery_quota,
        "_monotonic",
        lambda: runtime_delivery_quota.RUNTIME_DELIVERY_RESERVATION_TIMEOUT_SECONDS + 1,
    )

    def deny_process_identity(_pid):
        raise PermissionError("procfs denied")

    monkeypatch.setattr(
        runtime_delivery_quota,
        "_process_start_ticks",
        deny_process_identity,
    )

    with pytest.raises(
        runtime_delivery_quota.RuntimeDeliveryQuotaError,
        match="recovery reserve",
    ):
        with runtime_delivery_quota.runtime_delivery_quota_transaction(root):
            runtime_delivery_quota.assert_runtime_delivery_volume_capacity(
                root,
                additional_bytes=50,
            )

    assert target.exists()
    assert runtime_delivery_quota.runtime_delivery_capacity(root)["reservedBytes"] == 100
