"""L9 Architect repair: model-backed advice-only /design, honest status, no host writes."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from cortex_server.modules import architect as core
from cortex_server.modules import level_model
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.l9_cif import run_l9_cif
from cortex_server.modules.level_adapters import architect as architect_adapter
from cortex_server.routers import architect


def _run(coro):
    return asyncio.run(coro)


def _blueprint():
    return {
        "summary": "Two-region Postgres with streaming replication and managed failover.",
        "design_type": "infrastructure",
        "assumptions": ["Single-writer workload"],
        "components": [
            {"name": "Primary DB", "responsibility": "Accept writes", "technology": "Postgres 16", "scaling": "vertical"},
            {"name": "Standby DB", "responsibility": "Synchronous replica in region B", "technology": "Postgres 16"},
            {"name": "Failover Controller", "responsibility": "Promote standby on failure", "technology": "Patroni"},
        ],
        "data_flows": [
            {"source": "Primary DB", "target": "Standby DB", "payload": "WAL", "protocol": "streaming", "sync": "stream"},
            {"source": "Primary DB", "target": "Backup Bucket", "payload": "base backups", "sync": "batch"},
        ],
        "data_model": [],
        "infrastructure": [{"resource": "2x db.r6g.2xlarge", "purpose": "primary+standby", "sizing": "2 TB gp3"}],
        "risks": [{"scenario": "Split brain", "impact": "divergent writes", "mitigation": "DCS fencing", "severity": "high"}],
        "tradeoffs": [{"decision": "sync vs async replication", "options": ["sync", "async"], "chosen": "sync",
                       "pros": ["RPO 0"], "cons": ["latency"], "rationale": "RPO 1 min requirement"}],
        "recommendation": "Start with Patroni + synchronous standby to meet the 1-minute RPO within budget.",
        "open_questions": ["Cross-region latency?"],
        "next_steps": ["Benchmark replication lag"],
    }


def _ok(data):
    return {"status": "ok", "ok": True, "level": 9, "name": "architect", "elapsed_ms": 7, "origin": "model",
            "data": data, "model": "gpt-5.6-sol", "receipt_id": "rcpt-arch", "provider_invoked": True, "attempts": 1}


def _unavailable(status="model_unavailable"):
    return {"status": status, "ok": False, "level": 9, "name": "architect", "elapsed_ms": 3,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL, "error": "down"}


def _model(monkeypatch, result):
    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        return result

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


def test_design_happy_path_returns_validated_blueprint_with_receipt(monkeypatch):
    calls = _model(monkeypatch, _ok(_blueprint()))
    out = _run(architect.architect_design(architect.DesignRequest(
        query="Design a multi-region Postgres failover for 2TB, RPO 1 min, budget $5k/mo",
        constraints="RPO 1 minute"), SimpleNamespace(state=SimpleNamespace())))
    assert out["success"] is True and out["origin"] == "model" and out["receipt_id"] == "rcpt-arch"
    assert out["advice_only"] is True
    assert len(out["blueprint"]["components"]) == 3
    assert "Backup Bucket" in " ".join(out["consistency_warnings"])  # flow to an unlisted component
    assert out["review_checklist"]["method"] == "keyword_presence"
    prompt = calls[0]["prompt"]
    assert "RPO 1 min" in prompt and "Constraints:" in prompt
    assert calls[0]["schema"] is core.ArchitectDesign
    assert calls[0]["principal_scope_key"] != "internal-system"


def test_design_model_unavailable_has_no_blueprint(monkeypatch):
    _model(monkeypatch, _unavailable("timeout"))
    out = _run(architect.architect_design(architect.DesignRequest(query="Design a queue"), None))
    assert out["success"] is False and out["blueprint"] is None
    assert out["origin"] == "model_unavailable" and out["label"] == level_model.LEVEL_MODEL_UNAVAILABLE_LABEL


def test_design_schema_rejects_kind_mismatch_and_empty_query():
    data = _blueprint()
    data["design_type"] = "data_model"
    with pytest.raises(ValidationError):
        core.ArchitectDesign.model_validate(data)
    with pytest.raises(ValidationError):
        architect.DesignRequest(query="")


def test_extend_and_reload_are_honest_refusals(monkeypatch):
    import subprocess

    def no_process(*_a, **_k):
        raise AssertionError("no pip install")

    monkeypatch.setattr(subprocess, "run", no_process)
    with pytest.raises(HTTPException) as extend:
        architect.extend_router(architect.ExtendRequest(
            filename="x.py", code="from fastapi import APIRouter\nrouter=APIRouter()", dependencies=["evil"]))
    assert extend.value.status_code == 403
    assert extend.value.detail["wrote_files"] is False
    with pytest.raises(HTTPException) as reload_:
        architect.reload_router()
    assert reload_.value.status_code == 501


def test_status_only_claims_mounted_design():
    request = SimpleNamespace(app=SimpleNamespace(routes=[
        SimpleNamespace(path="/architect/status", methods={"GET"}),
        SimpleNamespace(path="/architect/design", methods={"POST"}),
        SimpleNamespace(path="/architect/geneticist_contract", methods={"GET"}),
    ]))
    status = architect.architect_status(request)
    assert status["capabilities"] == ["design", "geneticist_contract"]
    reasons = {row["capability"]: row["reason"] for row in status["unavailable"]}
    assert reasons["extend"].startswith("disabled_in_code")
    assert reasons["handoff_to_geneticist"] == "route_not_mounted"


def test_legacy_cif_is_checklist_only_and_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    out = run_l9_cif("Use backups and failover with monitoring")
    assert "survival_score" not in json.dumps(out) and out["method"] == "keyword_presence"
    assert any(row["concern"] == "data_durability" for row in out["covered"])
    assert list(tmp_path.iterdir()) == []


def test_adapter_contract(monkeypatch):
    _model(monkeypatch, _ok(_blueprint()))
    out = _run(architect_adapter.run("Design Postgres failover", {"principal_scope_key": "principal:abc"}))
    assert out["operation"] == "architect.design" and out["origin"] == "model"
    assert out["receipt_id"] == "rcpt-arch" and len(out["summary"]) <= 1500
    assert out["data"]["components"][0]["name"] == "Primary DB"
    json.dumps(out)

    with pytest.raises(ExecutionBlocked) as no_scope:
        _run(architect_adapter.run("Design X", {}))
    assert no_scope.value.reason == "missing_principal_scope"

    _model(monkeypatch, _unavailable())
    with pytest.raises(ExecutionBlocked) as down:
        _run(architect_adapter.run("Design X", {"principal_scope_key": "principal:abc"}))
    assert down.value.reason.startswith("model_unavailable")
