from datetime import datetime, timedelta, timezone

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
