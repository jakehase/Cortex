from __future__ import annotations

from datetime import datetime, timedelta, timezone

from services.homeostasis.baseline_regulation import build_baseline_regulation_snapshot, validate_baseline_regulation_snapshot


NOW = datetime.now(timezone.utc)



def _process(process_id: str, *, created_at: datetime, status: str, elapsed_ms: float, mode: str, depth: int, budget_class: str):
    return {
        "process_id": process_id,
        "created_at": created_at.isoformat(),
        "status": status,
        "workflow": {
            "metadata": {
                "policy": {
                    "settings": {
                        "execution_mode": "sequential" if mode == "protective" else "parallel",
                        "max_parallelism": 1 if mode == "protective" else 2,
                        "verification_mode": "strict" if mode == "protective" else "basic",
                        "same_tick_drain": mode != "protective",
                        "retry_max_attempts": 2 if mode == "protective" else 1,
                        "homeostasis_mode": mode,
                        "homeostasis_reasoning_depth": depth,
                        "homeostasis_tool_budget_class": budget_class,
                    },
                    "homeostasis": {
                        "enabled": True,
                        "mode": mode,
                        "intent": "coding" if mode == "protective" else "qa",
                        "risk_tier": "high" if mode == "protective" else "low",
                        "effort": {
                            "reasoning_depth": depth,
                            "tool_budget_class": budget_class,
                        },
                        "guardrails": {
                            "prefer_chain": "deliberate_council" if mode == "protective" else "fastlane_memory",
                        },
                    },
                }
            },
            "steps": [{"node_id": "step1", "title": "step1"}],
        },
        "nodes": {"step1": {"status": status, "attempts": 1, "max_attempts": 2}},
        "results_by_node": {
            "step1": {
                "success": status == "completed",
                "elapsed_ms": elapsed_ms,
                "attempts": 1,
                "produced_belief_count": 1,
                "homeostasis": {
                    "mode": mode,
                    "prefer_chain": "deliberate_council" if mode == "protective" else "fastlane_memory",
                    "runtime_controls": {"step_timeout_seconds": 12.0 if mode == "protective" else 4.0},
                },
            }
        },
    }



def test_r7_step1_prefers_live_rolling_window_when_runtime_processes_exist():
    processes = [
        _process("proc_live_1", created_at=NOW - timedelta(hours=2), status="completed", elapsed_ms=120.0, mode="protective", depth=4, budget_class="incident"),
        _process("proc_live_2", created_at=NOW - timedelta(hours=4), status="failed", elapsed_ms=260.0, mode="normal", depth=2, budget_class="standard"),
        _process("proc_live_3", created_at=NOW - timedelta(hours=8), status="completed", elapsed_ms=90.0, mode="conserve", depth=1, budget_class="lean"),
    ]
    events = {
        "proc_live_1": [
            {"kind": "policy_patch_applied", "ts": (NOW - timedelta(hours=1, minutes=50)).isoformat()},
            {"kind": "process_paused", "ts": (NOW - timedelta(hours=1, minutes=49)).isoformat()},
        ],
        "proc_live_2": [
            {"kind": "policy_patch_rolled_back", "ts": (NOW - timedelta(hours=3, minutes=40)).isoformat()},
        ],
        "proc_live_3": [
            {"kind": "process_resumed", "ts": (NOW - timedelta(hours=7, minutes=30)).isoformat()},
        ],
    }

    snapshot = build_baseline_regulation_snapshot(
        live_processes=processes,
        get_runtime_events_fn=lambda process_id, limit=200: list(events.get(process_id, [])),
        window_hours=24.0,
        bucket_hours=6.0,
    )
    validation = validate_baseline_regulation_snapshot(snapshot)

    assert snapshot["selected_source"] == "live_runtime_telemetry"
    assert snapshot["baseline_window"]["mode"] == "live_rolling_window"
    assert snapshot["baseline_window"]["process_count"] == 3
    assert snapshot["telemetry"]["quality"]["live_success_rate"] == 0.6667
    assert snapshot["telemetry"]["latency"]["mean_step_elapsed_ms"] == 156.6667
    assert snapshot["telemetry"]["cost"]["mean_reasoning_depth"] == 2.3333
    assert snapshot["telemetry"]["cost"]["tool_budget_classes"] == {"incident": 1, "standard": 1, "lean": 1}
    assert snapshot["telemetry"]["safety"]["operator_patch_count"] == 1
    assert snapshot["telemetry"]["safety"]["operator_rollback_count"] == 1
    assert snapshot["telemetry"]["operator"]["pause_event_count"] == 1
    assert snapshot["telemetry"]["operator"]["resume_event_count"] == 1
    assert validation["valid"] is True
    assert validation["drift_stable"] is True



def test_r7_step1_falls_back_to_bootstrap_when_live_window_empty():
    snapshot = build_baseline_regulation_snapshot(live_processes=[], get_runtime_events_fn=lambda process_id, limit=200: [])
    assert snapshot["selected_source"] == "artifact_bootstrap"
    assert snapshot["baseline_window"]["mode"] == "artifact_derived_bootstrap_lock"
