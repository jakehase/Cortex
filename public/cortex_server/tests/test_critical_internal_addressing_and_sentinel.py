import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cortex_server import internal_addressing
from cortex_server import main as main_module
from cortex_server.modules import reasoning_runtime_service


def _run_preflight(payload):
    async def preflight():
        return payload

    return asyncio.run(
        reasoning_runtime_service.maybe_sentinel_gate(
            metadata={"requires_preflight": True},
            workflow_id="wf_critical_preflight",
            sentinel_preflight_fn=preflight,
        )
    )


def test_agg_f002_internal_origin_defaults_to_deployed_port_and_derives_bind_settings():
    assert internal_addressing.resolve_internal_base_url({}) == "http://127.0.0.1:8000"
    assert internal_addressing.resolve_internal_base_url(
        {"CORTEX_HOST": "127.0.0.9", "CORTEX_PORT": "8017"}
    ) == "http://127.0.0.9:8017"
    assert internal_addressing.resolve_internal_base_url(
        {"CORTEX_HOST": "0.0.0.0", "CORTEX_PORT": "8000"}
    ) == "http://127.0.0.1:8000"
    assert internal_addressing.resolve_internal_base_url(
        {"CORTEX_INTERNAL_BASE_URL": "http://cortex.internal:9000"}
    ) == "http://cortex.internal:9000"


@pytest.mark.parametrize(
    "configured",
    [
        "ftp://127.0.0.1:8000",
        "http://user:pass@127.0.0.1:8000",
        "http://127.0.0.1:8000/not-an-origin",
        "http://127.0.0.1:8000?query=1",
    ],
)
def test_agg_f002_internal_origin_rejects_malformed_or_credentialed_values(configured):
    with pytest.raises(ValueError):
        internal_addressing.resolve_internal_base_url({"CORTEX_INTERNAL_BASE_URL": configured})


def test_agg_f002_readiness_fails_when_configured_self_origin_is_unreachable(monkeypatch):
    async def unreachable_probe(**_kwargs):
        return {
            "ok": False,
            "status": "unreachable",
            "target": "http://127.0.0.1:8000/_internal/reachability",
            "error": "ConnectError:connection refused",
        }

    monkeypatch.setattr(main_module, "probe_internal_reachability", unreachable_probe)
    client = TestClient(main_module.create_app())
    response = client.get("/ready")

    assert response.status_code == 503
    payload = response.json()
    assert payload["ready"] is False
    assert payload["checks"]["internalSelfReachability"]["status"] == "unreachable"


def test_agg_f002_self_probe_rejects_a_reachable_wrong_service(monkeypatch):
    class WrongServiceResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"service": "not-cortex", "status": "reachable"}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _target):
            return WrongServiceResponse()

    monkeypatch.setattr(internal_addressing.httpx, "AsyncClient", lambda **_kwargs: FakeClient())
    result = asyncio.run(internal_addressing.probe_internal_reachability())

    assert result["ok"] is False
    assert result["status"] == "identity_mismatch"


def test_agg_f002_runtime_self_calls_have_no_legacy_8888_origin():
    package_root = Path(main_module.__file__).resolve().parent
    legacy_lines = []
    for source_path in sorted(package_root.rglob("*.py")):
        for line_number, line in enumerate(source_path.read_text(encoding="utf-8").splitlines(), start=1):
            if "8888" in line:
                legacy_lines.append((source_path.relative_to(package_root).as_posix(), line_number, line.strip()))

    assert legacy_lines == []


@pytest.mark.parametrize(
    "payload,expected_error",
    [
        (None, "sentinel_preflight_malformed"),
        (False, "sentinel_preflight_malformed"),
        ({}, "sentinel_preflight_unavailable"),
        ({"success": False}, "sentinel_preflight_unavailable"),
        ({"success": True}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": None}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {}}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {"issues_found": "0"}}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {"issues_found": False}}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {"issues_found": -1}}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {"issues_found": 0}}, "sentinel_preflight_malformed"),
        ({"success": True, "scan": {"issues_found": 0, "watchers_checked": 1, "results": []}}, "sentinel_preflight_malformed"),
    ],
)
def test_agg_f052_required_sentinel_preflight_blocks_false_missing_and_malformed(payload, expected_error):
    blocked = _run_preflight(payload)

    assert blocked["success"] is False
    assert blocked["error"] == expected_error
    assert blocked["workflow_id"] == "wf_critical_preflight"


@pytest.mark.parametrize("failure", [TimeoutError("timed out"), ConnectionError("connection refused")])
def test_agg_f052_required_sentinel_preflight_blocks_timeout_and_unreachable(failure):
    async def failed_preflight():
        raise failure

    blocked = asyncio.run(
        reasoning_runtime_service.maybe_sentinel_gate(
            metadata={"requires_preflight": True},
            workflow_id="wf_dependency_down",
            sentinel_preflight_fn=failed_preflight,
        )
    )

    assert blocked["success"] is False
    assert blocked["error"] == "sentinel_preflight_unavailable"
    assert blocked["workflow_id"] == "wf_dependency_down"


def test_agg_f052_required_sentinel_preflight_allows_only_valid_issue_free_scan():
    allowed = _run_preflight(
        {
            "success": True,
            "scan": {
                "issues_found": 0,
                "watchers_checked": 1,
                "results": [{"ok": True, "status_code": 200}],
            },
        }
    )
    blocked = _run_preflight(
        {
            "success": True,
            "scan": {
                "issues_found": 1,
                "watchers_checked": 1,
                "results": [{"ok": False, "status_code": 503}],
            },
        }
    )

    assert allowed is None
    assert blocked["error"] == "sentinel_gate_failed"


def test_agg_f052_malformed_preflight_never_reaches_async_workflow_executor():
    executed = []
    persisted = []
    applied = []

    async def malformed_preflight():
        return {"success": True, "scan": {"issues_found": 0}}

    async def unexpected_execution(_workflow):
        executed.append(True)
        raise AssertionError("workflow executor must not run after a malformed required preflight")

    workflow = {"workflow_id": "wf_fail_closed", "executions": []}
    asyncio.run(
        reasoning_runtime_service.finalize_async_workflow(
            workflow,
            metadata={"requires_preflight": True},
            sentinel_preflight_fn=malformed_preflight,
            execute_workflow_fn=unexpected_execution,
            apply_execution_result_fn=lambda target, execution, **_kwargs: applied.append((target, execution)),
            build_blocked_execution_fn=lambda **kwargs: {"success": False, "blocked": kwargs},
            build_error_execution_fn=lambda error: {"success": False, "error": str(error)},
            persist_workflow_fn=lambda target: persisted.append(target),
            max_executions=3,
        )
    )

    assert executed == []
    assert len(applied) == 1
    assert persisted == [workflow]
