from datetime import datetime, timedelta, timezone

import pytest

import cortex_server.modules.reasoning_approvals as approvals
from cortex_server.modules.reasoning_approvals import grant_allows_step


def test_approval_grant_scope_and_expiry(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    active = approvals.create_approval_grant(
        granted_by="Jake",
        scope="workflow",
        workflow_id="wf_ok",
        endpoint_prefixes=["/homeassistant/service"],
        methods=["POST"],
        risk_levels=["high"],
        note="allow lights",
    )
    expired = approvals.create_approval_grant(
        granted_by="Jake",
        scope="workflow",
        workflow_id="wf_ok",
        endpoint_prefixes=["/homeassistant/service"],
        methods=["POST"],
        risk_levels=["high"],
        expires_at=(datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
        note="expired",
    )

    step = {"endpoint": "/homeassistant/service", "method": "POST", "node_id": "lights", "metadata": {}}
    allowed = grant_allows_step(step, workflow_metadata={"workflow_id": "wf_ok", "approval_grant_ids": [active["grant_id"]]}, risk="high")
    denied_wrong_workflow = grant_allows_step(step, workflow_metadata={"workflow_id": "wf_other", "approval_grant_ids": [active["grant_id"]]}, risk="high")
    denied_expired = grant_allows_step(step, workflow_metadata={"workflow_id": "wf_ok", "approval_grant_ids": [expired["grant_id"]]}, risk="high")

    assert allowed is not None
    assert allowed["grant_id"] == active["grant_id"]
    assert denied_wrong_workflow is None
    assert denied_expired is None


def test_step_and_risk_scopes_require_nonempty_exact_runtime_bindings(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals, "DEFAULT_STATE_PATH", tmp_path / "reasoning_approvals.json")
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    grants = {}
    for name, values in {
        "empty_step": {"scope": "step", "node_ids": []},
        "bound_step": {"scope": "step", "node_ids": ["deploy"]},
        "empty_risk": {"scope": "risk_class", "risk_levels": []},
        "bound_risk": {"scope": "risk_class", "risk_levels": ["high"]},
    }.items():
        grants[name] = approvals.create_approval_grant(granted_by="Jake", **values)

    def allows(name, *, node_id="deploy", risk="high"):
        step = {"endpoint": "/deploy", "method": "POST", "node_id": node_id, "metadata": {}}
        metadata = {"approval_grant_ids": [grants[name]["grant_id"]]}
        return grant_allows_step(step, workflow_metadata=metadata, risk=risk)

    assert allows("empty_step") is None
    assert allows("bound_step", node_id="other") is None
    assert allows("bound_step") is not None
    assert allows("empty_risk") is None
    assert allows("bound_risk", risk="medium") is None
    assert allows("bound_risk") is not None


def test_malformed_durable_scope_bindings_fail_closed(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    state = approvals._default_state()
    state["grants"] = [
        {"grant_id": "bad-step", "created_at": approvals._now_iso(), "scope": "step", "node_ids": None},
        {"grant_id": "bad-risk", "created_at": approvals._now_iso(), "scope": "risk_class", "risk_levels": None},
    ]
    approvals.save_state(state)
    step = {"endpoint": "/deploy", "method": "POST", "node_id": "deploy", "metadata": {}}
    for grant_id in ("bad-step", "bad-risk"):
        assert grant_allows_step(
            step,
            workflow_metadata={"approval_grant_ids": [grant_id]},
            risk="high",
        ) is None


@pytest.mark.parametrize("field", ["node_ids", "endpoint_prefixes", "methods", "risk_levels"])
@pytest.mark.parametrize(
    "malformed",
    [
        pytest.param(None, id="null"),
        pytest.param("/safe", id="string"),
        pytest.param({"/safe": True}, id="mapping"),
        pytest.param(7, id="number"),
        pytest.param([["/safe"]], id="nested-list"),
        pytest.param(["/safe", ""], id="blank-item"),
        pytest.param(["/safe", "   "], id="whitespace-item"),
        pytest.param(["/safe", 7], id="non-string-item"),
    ],
)
def test_every_malformed_durable_list_binding_fails_closed(tmp_path, monkeypatch, field, malformed):
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    grant = {
        "grant_id": "malformed",
        "created_at": approvals._now_iso(),
        "scope": "workflow",
        "node_ids": ["deploy"],
        "endpoint_prefixes": ["/safe"],
        "methods": ["POST"],
        "risk_levels": ["high"],
    }
    grant[field] = malformed
    state = approvals._default_state()
    state["grants"] = [grant]
    approvals.save_state(state)

    metadata = {"approval_grant_ids": ["malformed"]}
    step = {"endpoint": "/safe/action", "method": "POST", "node_id": "deploy", "metadata": {}}
    assert grant_allows_step(step, workflow_metadata=metadata, risk="high") is None


def test_string_endpoint_prefix_is_not_split_into_character_grants(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    state = approvals._default_state()
    state["grants"] = [
        {
            "grant_id": "bad-prefix",
            "created_at": approvals._now_iso(),
            "scope": "workflow",
            "node_ids": [],
            "endpoint_prefixes": "/safe",
            "methods": ["POST"],
            "risk_levels": ["high"],
        }
    ]
    approvals.save_state(state)
    metadata = {"approval_grant_ids": ["bad-prefix"]}

    for endpoint in ("/", "/safe", "/safe/action", "/unrelated"):
        step = {"endpoint": endpoint, "method": "POST", "node_id": "deploy", "metadata": {}}
        assert grant_allows_step(step, workflow_metadata=metadata, risk="high") is None


def test_valid_tuple_bindings_preserve_exact_segment_prefix_matching(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    grant = approvals.create_approval_grant(
        scope="workflow",
        node_ids=("deploy",),
        endpoint_prefixes=("/safe",),
        methods=("post",),
        risk_levels=("HIGH",),
    )
    metadata = {"approval_grant_ids": [grant["grant_id"]]}

    def allows(endpoint):
        step = {"endpoint": endpoint, "method": "POST", "node_id": "deploy", "metadata": {}}
        return grant_allows_step(step, workflow_metadata=metadata, risk="high") is not None

    assert allows("/safe")
    assert allows("/safe/action")
    assert not allows("/")
    assert not allows("/safe-evil")
    assert not allows("/unrelated")


@pytest.mark.parametrize("prefix", ["///", "//safe", "/safe//action", "safe"])
def test_create_rejects_noncanonical_endpoint_prefixes(tmp_path, monkeypatch, prefix):
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")

    with pytest.raises(approvals.ReasoningApprovalError):
        approvals.create_approval_grant(endpoint_prefixes=[prefix])


@pytest.mark.parametrize("prefix", ["///", "//safe", "/safe//action", "safe"])
def test_malformed_persisted_endpoint_prefixes_fail_closed(tmp_path, monkeypatch, prefix):
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    state = approvals._default_state()
    state["grants"] = [
        {
            "grant_id": "bad-prefix",
            "created_at": approvals._now_iso(),
            "scope": "endpoint",
            "endpoint_prefixes": [prefix],
        }
    ]
    approvals.save_state(state)

    metadata = {"approval_grant_ids": ["bad-prefix"]}
    for endpoint in ("/", "/safe", "/unrelated"):
        step = {"endpoint": endpoint, "method": "POST", "node_id": "deploy", "metadata": {}}
        assert grant_allows_step(step, workflow_metadata=metadata, risk="high") is None


def test_root_endpoint_prefix_explicitly_matches_only_absolute_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr(approvals, "DEFAULT_DB_PATH", tmp_path / "reasoning_runtime.db")
    grant = approvals.create_approval_grant(scope="endpoint", endpoint_prefixes=["/"])
    metadata = {"approval_grant_ids": [grant["grant_id"]]}

    for endpoint in ("/", "/safe", "/safe/action"):
        assert grant_allows_step({"endpoint": endpoint}, workflow_metadata=metadata) is not None
    assert grant_allows_step({"endpoint": "relative"}, workflow_metadata=metadata) is None
