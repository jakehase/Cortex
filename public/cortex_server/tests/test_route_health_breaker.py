import time
from pathlib import Path

from cortex_server.modules.route_health import RouteHealthMonitor


def test_route_health_breaker_opens_and_recovers(tmp_path: Path):
    monitor = RouteHealthMonitor(
        state_path=tmp_path / "route_health.json",
        failure_threshold=2,
        cooldown_seconds=1,
        half_open_max_probes=1,
    )

    assert monitor.allow("oracle")["allowed"] is True
    monitor.record_failure("oracle", error="boom-1")
    assert monitor.allow("oracle")["allowed"] is True

    monitor.record_failure("oracle", error="boom-2")
    gate = monitor.allow("oracle")
    assert gate["allowed"] is False
    assert gate["state"] == "open"

    row = monitor._row("oracle")
    row["breaker_open_until"] = time.time() - 1
    monitor._persist()

    probe = monitor.allow("oracle")
    assert probe["allowed"] is True
    assert probe["state"] == "half_open"

    monitor.record_success("oracle", latency_ms=120)
    snap = monitor.snapshot("oracle")
    assert snap["state"] == "closed"
    assert snap["healthy"] is True
    assert snap["last_latency_ms"] == 120.0
