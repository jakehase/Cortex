from cortex_server.modules import reasoning_explain, reasoning_failures, reasoning_observability


def test_normalize_failure_code_infers_timeout_from_error_type():
    assert reasoning_failures.normalize_failure_code(None, error="timeout:ReadTimeout", error_type="timeout", success=False) == reasoning_failures.FAILURE_TIMEOUT


def test_classify_incident_prefers_structured_error_code_over_error_text():
    incident = reasoning_observability.classify_incident(
        node_id="step1",
        status="failed",
        error="something weird",
        error_code=reasoning_failures.FAILURE_APPROVAL_REQUIRED,
        success=False,
    )

    assert incident["category"] == reasoning_observability.INCIDENT_APPROVAL_BLOCKED
    assert incident["error_code"] == reasoning_failures.FAILURE_APPROVAL_REQUIRED
    assert incident["severity"] == reasoning_observability.SEVERITY_HIGH


def test_classify_incident_normalizes_deadline_without_explicit_error_code():
    incident = reasoning_observability.classify_incident(
        node_id="step2",
        status="cancelled",
        error=reasoning_failures.FAILURE_DEADLINE,
        success=False,
    )

    assert incident["category"] == reasoning_observability.INCIDENT_DEADLINE_EXCEEDED
    assert incident["error_code"] == reasoning_failures.FAILURE_DEADLINE
    assert incident["severity"] == reasoning_observability.SEVERITY_HIGH


def test_policy_outcome_evaluation_counts_structured_verification_failures():
    evaluation = reasoning_explain.policy_outcome_evaluation(
        policy={
            "settings": {"verification_mode": "strict"},
            "decisions": [{"domain": "verification", "chosen": "strict", "rationale": "test"}],
        },
        process={"status": "failed"},
        execution_trace_rows=[
            {"success": False, "error_code": reasoning_failures.FAILURE_PRE_VERIFICATION},
            {"success": False, "error_code": reasoning_failures.FAILURE_POST_VERIFICATION},
            {"success": False, "error_code": reasoning_failures.FAILURE_TIMEOUT},
        ],
        step_influences=[],
        belief_summary={"count": 0},
    )
    summary = reasoning_explain.policy_outcome_summary(evaluation)

    assert evaluation[0]["domain"] == "verification"
    assert evaluation[0]["observed"]["failure_count"] == 2
    assert evaluation[0]["comparison"]["mode_match"] is True
    assert evaluation[0]["outcome"] == "match"
    assert summary["overall"] == "mostly_match"


def test_policy_patch_preview_materializes_structured_metadata_patch():
    preview = reasoning_observability.policy_patch_preview(
        policy={
            "settings": {
                "retry_on_timeout": False,
                "step_timeout_seconds": 5,
            }
        },
        hooks=[
            {
                "target": "scheduler",
                "suggestion": "increase_timeout_or_retry_backoff",
                "reason": "Observed timeout incident",
                "proposed_settings": {
                    "retry_on_timeout": True,
                    "step_timeout_seconds": 10,
                    "unsupported_knob": "ignore-me",
                },
            },
            {
                "target": "scheduler",
                "suggestion": "nudge_timeout_again",
                "reason": "Second hook should fold into same patch",
                "proposed_settings": {
                    "step_timeout_seconds": 15,
                },
            },
        ],
    )

    assert str(preview["recommendation_version"]).startswith("polrec_")
    assert preview["change_count"] == 2
    assert preview["metadata_overrides"] == {
        "retry_on_timeout": True,
        "step_timeout_seconds": 15,
    }
    assert preview["apply_target"] == "workflow.metadata"
    assert preview["apply_mode"] == "merge"
    assert preview["rebuild_policy_required"] is True
    assert preview["operations"] == [
        {
            "op": "replace",
            "path": "/workflow/metadata/retry_on_timeout",
            "setting": "retry_on_timeout",
            "value": True,
            "target": "scheduler",
            "reason": "Observed timeout incident",
        },
        {
            "op": "replace",
            "path": "/workflow/metadata/step_timeout_seconds",
            "setting": "step_timeout_seconds",
            "value": 15,
            "target": "scheduler",
            "reason": "Second hook should fold into same patch",
        },
    ]
    assert preview["changes"][1]["sources"][-1]["suggestion"] == "nudge_timeout_again"
    assert preview["skipped"][0]["setting"] == "unsupported_knob"



def test_apply_policy_patch_preview_merges_metadata_overrides_for_control_plane():
    preview = reasoning_observability.policy_patch_preview(
        policy={"settings": {"retry_on_timeout": False}},
        hooks=[
            {
                "target": "scheduler",
                "suggestion": "increase_timeout_or_retry_backoff",
                "reason": "Observed timeout incident",
                "proposed_settings": {
                    "retry_on_timeout": True,
                    "step_timeout_seconds": 30,
                },
            }
        ],
    )

    applied = reasoning_observability.apply_policy_patch_preview(
        workflow_metadata={"goal": "demo", "retry_on_timeout": False},
        preview=preview,
    )

    assert applied["applied"] is True
    assert applied["applied_count"] == 2
    assert applied["updated_metadata"]["retry_on_timeout"] is True
    assert applied["updated_metadata"]["step_timeout_seconds"] == 30
    assert [row["setting"] for row in applied["applied_settings"]] == ["retry_on_timeout", "step_timeout_seconds"]



def test_select_policy_patch_preview_supports_setting_filter_and_operator_overrides():
    preview = reasoning_observability.policy_patch_preview(
        policy={"settings": {"retry_on_timeout": False, "step_timeout_seconds": 5}},
        hooks=[
            {
                "target": "scheduler",
                "suggestion": "increase_timeout_or_retry_backoff",
                "reason": "Observed timeout incident",
                "proposed_settings": {
                    "retry_on_timeout": True,
                    "step_timeout_seconds": 30,
                    "retry_max_attempts": 2,
                },
            }
        ],
    )

    selected = reasoning_observability.select_policy_patch_preview(
        preview=preview,
        include_settings=["step_timeout_seconds"],
        metadata_overrides={"step_timeout_seconds": 45},
    )

    assert selected["change_count"] == 1
    assert selected["metadata_overrides"] == {"step_timeout_seconds": 45}
    assert selected["operations"][0]["path"] == "/workflow/metadata/step_timeout_seconds"
    assert selected["changes"][0]["sources"][-1]["suggestion"] == "operator_override"



def test_select_policy_patch_preview_blocks_confirmation_required_settings_by_default():
    preview = reasoning_observability.policy_patch_preview(
        policy={"settings": {"verification_mode": "basic", "step_timeout_seconds": 5}},
        hooks=[
            {
                "target": "verification",
                "suggestion": "tighten_contract_authoring",
                "reason": "Observed verification failure",
                "proposed_settings": {
                    "verification_mode": "strict",
                    "step_timeout_seconds": 30,
                },
            }
        ],
    )

    blocked = reasoning_observability.select_policy_patch_preview(preview=preview)
    allowed = reasoning_observability.select_policy_patch_preview(preview=preview, allow_confirmation_required=True)

    assert blocked["metadata_overrides"] == {"step_timeout_seconds": 30}
    assert any(row["setting"] == "verification_mode" and row["skipped"] == "confirmation_required" for row in blocked["skipped"])
    assert allowed["metadata_overrides"]["verification_mode"] == "strict"



def test_policy_patch_preview_validates_and_skips_invalid_values():
    preview = reasoning_observability.policy_patch_preview(
        policy={"settings": {"step_timeout_seconds": 5}},
        hooks=[
            {
                "target": "scheduler",
                "suggestion": "bad_patch",
                "reason": "test invalid settings",
                "proposed_settings": {
                    "step_timeout_seconds": -1,
                    "retry_on_status_codes": [200, 999],
                    "retry_backoff_seconds": 0.75,
                },
            }
        ],
    )

    assert preview["metadata_overrides"] == {"retry_backoff_seconds": 0.75}
    assert preview["invalid_setting_count"] == 2
    assert preview["valid"] is False
    assert any(row["setting"] == "step_timeout_seconds" and row["skipped"] == "invalid_value" for row in preview["skipped"])
    assert any(row["setting"] == "retry_on_status_codes" and row["skipped"] == "invalid_value" for row in preview["skipped"])



def test_select_and_apply_policy_patch_preview_detects_setting_conflicts():
    selected = reasoning_observability.select_policy_patch_preview(
        preview={
            "current_settings": {"execution_mode": "sequential", "max_parallelism": 1},
            "changes": [
                {
                    "setting": "max_parallelism",
                    "before": 1,
                    "after": 4,
                    "target": "operator",
                    "reason": "operator_override",
                    "sources": [],
                }
            ],
            "apply_target": "workflow.metadata",
            "apply_mode": "merge",
            "skipped": [],
        },
        include_settings=["max_parallelism"],
        metadata_overrides={"max_parallelism": 4},
        allow_confirmation_required=True,
    )

    applied = reasoning_observability.apply_policy_patch_preview(
        workflow_metadata={"execution_mode": "sequential", "max_parallelism": 1},
        preview=selected,
    )

    assert selected["conflict_count"] == 1
    assert selected["valid"] is False
    assert selected["conflicts"][0]["code"] == "execution_parallelism_mismatch"
    assert applied["applied"] is False
    assert any(row["skipped"] == "conflict_detected" for row in applied["skipped"])
