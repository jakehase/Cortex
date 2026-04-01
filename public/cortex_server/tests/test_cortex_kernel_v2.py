from cortex_server.modules import cortex_kernel_v2 as kernel_v2


def setup_function():
    kernel_v2.reset_state()



def test_compile_request_contract_prefers_deep_for_code_change_and_risk():
    contract = kernel_v2.compile_request_contract(
        "Implement the router refactor, add tests, and validate the production rollback plan.",
        priority="high",
        strict_contract=False,
        requested_model="codex",
    )

    assert contract["intent"]["kind"] in {"coding", "planning", "ops"}
    assert contract["intent"]["code_change"] is True
    assert "production" in contract["risk_flags"]
    assert contract["lane"]["preferred"] == "deep"
    assert contract["lane"]["depth_mode"] in {"medium", "deep"}



def test_memory_style_token_prompt_does_not_force_security_deep_lane():
    contract = kernel_v2.compile_request_contract(
        "Remember token alpha-123 for later.",
        session_key="session:kernel-memory-risk",
    )

    assert "security" not in contract["risk_flags"]
    assert contract["lane"]["preferred"] == "fast"



def test_working_set_compiles_explicit_hot_warm_cold_classes():
    trace = kernel_v2.prepare_request(
        "Remember token alpha-123 for later.",
        session_key="session:kernel-hot",
        continuity_prefix="Conversation referents (minimal): memory_token=alpha-123.",
        codec_prefix="Cortex Codec state (compressed behavioral context; use only if relevant): Prefers [Cortex].",
    )
    kernel_v2.finalize_request(trace["request_id"], response="ACK", actual_lane="semantic_guardrail_memory")

    working = kernel_v2.compile_working_set(
        "What token did I ask you to remember?",
        session_key="session:kernel-hot",
        continuity_prefix="Conversation referents (minimal): memory_token=alpha-123.",
        codec_prefix="Cortex Codec state (compressed behavioral context; use only if relevant): Prefers [Cortex].",
    )

    assert set(working["classes"].keys()) == {"hot", "warm", "cold"}
    assert working["classes"]["hot"]["applied"] is True
    assert working["classes"]["warm"]["applied"] is True
    assert working["classes"]["cold"]["applied"] is True
    assert working["reuse"]["hot_hits"] >= 1
    assert working["reuse"]["total_chars"] > 0



def test_prepare_and_finalize_emit_benchmark_telemetry():
    trace = kernel_v2.prepare_request(
        "Plan the architecture tradeoff for the runtime compiler and rollout toggles.",
        session_key="session:kernel-telemetry",
        priority="normal",
        requested_model="codex",
        continuity_prefix="Conversation referents (minimal): project=cortex-kernel.",
        codec_prefix="Cortex Codec state (compressed behavioral context; use only if relevant): build coherent runtime slices.",
    )

    assert trace["plan"]["lane"] == "deep"
    assert "Hot context" not in trace["compiled_prompt"]
    assert "Warm context" in trace["compiled_prompt"]
    assert "Cold context" in trace["compiled_prompt"]

    recorded = kernel_v2.finalize_request(
        trace["request_id"],
        response="Here is the rollout plan.",
        actual_lane="alive_orchestrated",
        used_backend="fake-model",
        fallback_reason="alive_orchestration",
        contract_ok=True,
    )

    assert recorded["recorded"] is True
    snapshot = kernel_v2.performance_snapshot()
    assert snapshot["telemetry"]["events"] == 1
    assert snapshot["benchmark"]["actual_deep_rate"] == 1.0
    assert snapshot["benchmark"]["context_hit_rate"] == 1.0
    assert snapshot["telemetry"]["latency"]["count"] == 1
    assert snapshot["telemetry"]["timing_breakdown_ms"]["compile_total_ms"]["count"] == 1
    assert "runtime_pressure" in snapshot["telemetry"]



def test_deep_plan_best_effort_counts_as_deep_execution_family():
    trace = kernel_v2.prepare_request(
        "Plan the architecture tradeoff for the runtime compiler and rollout toggles.",
        session_key="session:kernel-best-effort-deep",
        priority="normal",
    )

    kernel_v2.finalize_request(
        trace["request_id"],
        response="Use a shared compiler and staged rollout.",
        actual_lane="best_effort",
        used_backend="fake-model",
        fallback_reason="planning_depth",
        contract_ok=True,
    )

    latest = kernel_v2.performance_snapshot()["latest"]
    assert latest["planned_lane"] == "deep"
    assert latest["actual_lane_family"] == "deep"



def test_fast_plan_escalation_is_visible_in_telemetry():
    trace = kernel_v2.prepare_request(
        "What is the capital of Texas?",
        session_key="session:kernel-fast",
        priority="normal",
    )

    assert trace["plan"]["lane"] == "fast"

    kernel_v2.finalize_request(
        trace["request_id"],
        response="Austin.",
        actual_lane="alive_orchestrated",
        used_backend="fake-model",
        fallback_reason="bridge_fallback_after_openclaw_error",
        contract_ok=True,
    )

    latest = kernel_v2.performance_snapshot()["latest"]
    assert latest["planned_lane"] == "fast"
    assert latest["actual_lane_family"] == "deep"
    assert latest["escalated"] is True
    assert "runtime_pressure" in latest



def test_strict_contract_prompt_compiler_stays_out_of_the_way():
    trace = kernel_v2.prepare_request(
        "What is 2+2? Reply number only.",
        session_key="session:kernel-strict",
        strict_contract=True,
        continuity_prefix="Conversation referents (minimal): remember this only if needed.",
        codec_prefix="Cortex Codec state (compressed behavioral context; use only if relevant): ignore if not needed.",
    )

    assert trace["compiled_prompt"] == "What is 2+2? Reply number only."
    assert trace["plan"]["target_oracle_lane"] == "strict_contract_micro_fastpath"


def test_runtime_scoped_snapshots_and_mission_control_summary():
    oracle_trace = kernel_v2.prepare_request(
        "What is the capital of Texas?",
        session_key="session:kernel-runtime-oracle",
        runtime="oracle",
        surface="chat",
    )
    kernel_v2.finalize_request(
        oracle_trace["request_id"],
        response="Austin.",
        actual_lane="semantic_guardrail_factual",
        used_backend="oracle-fastlane",
        contract_ok=True,
    )

    nexus_trace = kernel_v2.prepare_request(
        "Plan the runtime compiler rollout and benchmark coverage.",
        session_key="session:kernel-runtime-nexus",
        continuity_prefix="Conversation referents (minimal): project=kernel-v2.",
        codec_prefix="Cortex Codec state (compressed behavioral context; use only if relevant): operator wants visible economics.",
        runtime="nexus",
        surface="orchestrate",
    )
    kernel_v2.finalize_request(
        nexus_trace["request_id"],
        response="Use the deep orchestration lane and benchmark both paths.",
        actual_lane="nexus_orchestrated",
        used_backend="nexus-orchestrate",
        contract_ok=True,
    )

    meta_trace = kernel_v2.prepare_request(
        "Delegate the rollout plan through meta conductor.",
        runtime="meta_conductor",
        surface="orchestrate",
    )
    kernel_v2.finalize_request(
        meta_trace["request_id"],
        response="Delegated through nexus.",
        actual_lane="meta_conductor_orchestrated",
        used_backend="delegated_nexus",
        contract_ok=True,
    )

    oracle_snapshot = kernel_v2.performance_snapshot(runtime="oracle")
    nexus_snapshot = kernel_v2.performance_snapshot(runtime="nexus")
    meta_snapshot = kernel_v2.performance_snapshot(runtime="meta_conductor")
    surface_snapshot = kernel_v2.performance_snapshot(surface="orchestrate")
    summary = kernel_v2.mission_control_summary()

    assert oracle_snapshot["telemetry"]["events"] == 1
    assert oracle_snapshot["benchmark"]["actual_fast_rate"] == 1.0
    assert nexus_snapshot["telemetry"]["events"] == 1
    assert nexus_snapshot["benchmark"]["actual_deep_rate"] == 1.0
    assert nexus_snapshot["latest"]["runtime"] == "nexus"
    assert meta_snapshot["telemetry"]["events"] == 1
    assert meta_snapshot["latest"]["runtime"] == "meta_conductor"
    assert surface_snapshot["telemetry"]["events"] == 2
    assert summary["kernel_v2"]["runtimes"]["oracle"]["events"] == 1
    assert summary["kernel_v2"]["runtimes"]["nexus"]["events"] == 1
    assert summary["kernel_v2"]["runtimes"]["meta_conductor"]["events"] == 1
    assert summary["kernel_v2"]["surfaces"]["orchestrate"]["events"] == 2
    assert summary["kernel_v2"]["latest"]["runtime"] == "meta_conductor"
    assert summary["kernel_v2"]["runtimes"]["meta_conductor"]["latest"]["runtime"] == "meta_conductor"
    assert "meta_conductor" in summary["kernel_v2"]["rollout"]["runtimes"]
    assert "runtime_pressure" in oracle_snapshot["telemetry"]
    assert "timing_breakdown_ms" in nexus_snapshot["telemetry"]


def test_scope_specific_env_prefixes_apply_to_non_oracle_runtimes(monkeypatch):
    monkeypatch.setenv("NEXUS_KERNEL_V2_MODE", "shadow")
    monkeypatch.setenv("NEXUS_KERNEL_V2_DISABLE_FAST_PATH", "true")

    trace = kernel_v2.prepare_request(
        "What is 2+2?",
        session_key="session:kernel-nexus-env",
        runtime="nexus",
        surface="orchestrate",
    )

    assert trace["settings"]["mode"] == "shadow"
    assert trace["settings"]["scope"] == "nexus"
    assert trace["plan"]["lane"] == "deep"
