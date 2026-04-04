from pathlib import Path

from cortex_server.modules.route_health import RouteHealthMonitor
from cortex_server.runtime.delivery_resilience import DeliveryDeadLetterStore, resilient_delivery_attempt


def test_resilient_delivery_attempt_records_failures_and_breaker_state(tmp_path: Path):
    monitor = RouteHealthMonitor(
        state_path=tmp_path / "route_health.json",
        failure_threshold=1,
        cooldown_seconds=60,
        half_open_max_probes=1,
    )
    dlq = DeliveryDeadLetterStore(tmp_path / "delivery_dlq.jsonl")

    failed = resilient_delivery_attempt(
        "discord",
        lambda: (_ for _ in ()).throw(RuntimeError("boom")),
        process_id="proc_123",
        event_kind="session.failed",
        payload={"x": 1},
        route_health=monitor,
        dlq_store=dlq,
    )
    blocked = resilient_delivery_attempt(
        "discord",
        lambda: {"ok": True},
        process_id="proc_123",
        event_kind="session.finished",
        payload={"x": 2},
        route_health=monitor,
        dlq_store=dlq,
    )

    assert failed["success"] is False
    assert failed["queued"] is True
    assert blocked["success"] is False
    assert blocked["reason"] in {"breaker_open", "half_open_probe_limit"}
    assert len(dlq.list()) == 2
