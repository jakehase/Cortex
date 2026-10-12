"""L22 Mnemosyne: status capability honesty and structured-recall adapter."""

from __future__ import annotations

import inspect
import json

import pytest

import cortex_server.routers.knowledge as knowledge
import cortex_server.routers.librarian as librarian_router
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import mnemosyne as mnemosyne_adapter
from cortex_server.runtime import memory_governance


PRINCIPAL = "principal:" + "d" * 64


# --------------------------------------------------------------------------
# /knowledge/status capability claims
# --------------------------------------------------------------------------


def _principal():
    return knowledge._authenticated_memory_principal_scope(
        knowledge.DEFAULT_TENANT_ID,
        knowledge.DEFAULT_WORKSPACE_ID,
        None,
    )


def test_status_omits_knowledge_graph_when_graph_is_empty(monkeypatch):
    monkeypatch.setattr(
        knowledge,
        "_principal_semantic_memory_probe",
        lambda principal: {"available": True, "count": 3, "countIsLowerBound": False, "scanLimit": 256},
    )
    monkeypatch.setattr(knowledge, "_principal_graph_nodes", lambda principal, **kwargs: [])
    payload = knowledge._knowledge_status_payload(_principal())
    assert payload["success"] is True
    assert "knowledge_graph" not in payload["capabilities"]
    assert set(payload["capabilities"]) == {"semantic_search", "memory_persistence"}
    assert payload["unavailable_capabilities"]["knowledge_graph"] == "graph_empty_for_principal"
    assert "entity_relationships" in payload["unavailable_capabilities"]
    assert payload["knowledge_graph_populated"] is False


def test_status_lists_knowledge_graph_only_when_nodes_exist(monkeypatch):
    monkeypatch.setattr(
        knowledge,
        "_principal_semantic_memory_probe",
        lambda principal: {"available": True, "count": 1},
    )
    monkeypatch.setattr(knowledge, "_principal_graph_nodes", lambda principal, **kwargs: [object()])
    payload = knowledge._knowledge_status_payload(_principal())
    assert "knowledge_graph" in payload["capabilities"]
    assert payload["knowledge_graph_populated"] is True


def test_status_graph_probe_failure_is_not_a_capability(monkeypatch):
    monkeypatch.setattr(
        knowledge,
        "_principal_semantic_memory_probe",
        lambda principal: {"available": False, "count": None, "error": "down"},
    )

    def broken(principal, **kwargs):
        raise RuntimeError("graph db locked")

    monkeypatch.setattr(knowledge, "_principal_graph_nodes", broken)
    payload = knowledge._knowledge_status_payload(_principal())
    assert payload["success"] is False
    assert payload["capabilities"] == []
    assert payload["unavailable_capabilities"]["knowledge_graph"].startswith("graph_probe_failed")
    assert payload["unavailable_capabilities"]["semantic_search"] == "semantic_memory_backend_unavailable"


# --------------------------------------------------------------------------
# Adapter
# --------------------------------------------------------------------------


def test_adapter_contract_attributes():
    assert mnemosyne_adapter.LEVEL == 22
    assert mnemosyne_adapter.NAME == "mnemosyne"
    assert mnemosyne_adapter.NEEDS_MODEL is False
    assert mnemosyne_adapter.SAFE_AUTORUN is True
    assert inspect.iscoroutinefunction(mnemosyne_adapter.run)


def _fake_search_result():
    return {
        "results": [
            {
                "id": "m1",
                "text": "Dana Ruiz is the billing contact at Acme Psychiatry",
                "metadata": {
                    "fact_key": "acme.billing_contact",
                    "claim_key": "acme.billing_contact#v",
                    "subject": "Acme Psychiatry",
                    "predicate": "billing_contact",
                    "fact_value": "Dana Ruiz",
                    "memory_status": "active",
                    "valid_from": "2026-03-01",
                    "memory_principal_key": PRINCIPAL,
                    "user_id": "owner",
                },
            },
            {"id": "m2", "text": "Unstructured note about payers", "metadata": {"type": "note"}},
        ],
        "search_mode": "semantic",
        "degraded": False,
        "available": True,
    }


class _FakeGovernanceStore:
    calls = []

    def conflict_projection(self, *, principal_key, memory_ids):
        self.calls.append((principal_key, list(memory_ids)))
        return {
            "m1": {
                "fact_key": "acme.billing_contact",
                "claim_key": "acme.billing_contact#v",
                "fact_status": "conflicted",
                "active_winner_id": "m9",
                "edges": [{"edge_type": "contradicts", "from_memory_id": "m1", "to_memory_id": "m9", "reason": "r"}],
            }
        }


@pytest.mark.asyncio
async def test_adapter_returns_structured_facts_with_conflict_projection(monkeypatch):
    _FakeGovernanceStore.calls = []
    monkeypatch.setattr(librarian_router, "robust_search", lambda *a, **k: _fake_search_result())
    monkeypatch.setattr(memory_governance, "MemoryGovernanceStore", _FakeGovernanceStore)
    out = await mnemosyne_adapter.run("who is Acme's billing contact", {"memory_principal_key": PRINCIPAL})
    encoded = json.dumps(out)
    assert out["operation"] == "mnemosyne.recall" and out["origin"] == "deterministic"
    fact = out["data"]["facts"][0]
    assert fact["fact_key"] == "acme.billing_contact"
    assert fact["effective_fact_status"] == "conflicted"
    assert fact["active_winner_id"] == "m9"
    assert out["data"]["other_memories"][0]["id"] == "m2"
    assert out["data"]["fact_projection"] == "ok"
    assert _FakeGovernanceStore.calls == [(PRINCIPAL, ["m1"])]
    assert "Acme Psychiatry billing_contact Dana Ruiz" in out["summary"]
    assert PRINCIPAL not in encoded and '"owner"' not in encoded
    assert len(out["summary"]) <= 1500


@pytest.mark.asyncio
async def test_adapter_projection_failure_is_reported_not_hidden(monkeypatch):
    class Broken:
        def conflict_projection(self, **kwargs):
            raise memory_governance.MemoryGovernanceError("db unavailable")

    monkeypatch.setattr(librarian_router, "robust_search", lambda *a, **k: _fake_search_result())
    monkeypatch.setattr(memory_governance, "MemoryGovernanceStore", Broken)
    out = await mnemosyne_adapter.run("billing contact", {"memory_principal_key": PRINCIPAL})
    assert out["data"]["fact_projection"].startswith("unavailable:")
    assert "effective_fact_status" not in out["data"]["facts"][0]


@pytest.mark.asyncio
async def test_adapter_blocks_without_principal_empty_query_or_store(monkeypatch):
    with pytest.raises(ExecutionBlocked) as raised:
        await mnemosyne_adapter.run("x", {})
    assert raised.value.reason == "authenticated_memory_scope_required"
    with pytest.raises(ExecutionBlocked) as raised:
        await mnemosyne_adapter.run("  ", {"memory_principal_key": PRINCIPAL})
    assert raised.value.reason == "empty_query"
    monkeypatch.setattr(
        librarian_router,
        "robust_search",
        lambda *a, **k: {"results": [], "search_mode": "error", "degraded": True, "available": False},
    )
    with pytest.raises(ExecutionBlocked) as raised:
        await mnemosyne_adapter.run("x", {"memory_principal_key": PRINCIPAL})
    assert raised.value.reason == "memory_store_unavailable"


def test_adapter_passes_only_live_signature_parameters(monkeypatch):
    accepted = set(inspect.signature(librarian_router.robust_search).parameters)
    seen = {}

    def strict(query, n_results=5, allow_fallback=True, *, tenant_id=None, workspace_id=None, memory_principal_key=None, filters=None):
        seen["ok"] = True
        return {"results": [], "search_mode": "semantic", "degraded": False, "available": True}

    assert {"query", "n_results", "allow_fallback", "tenant_id", "workspace_id", "memory_principal_key"} <= accepted
    monkeypatch.setattr(librarian_router, "robust_search", strict)
    import asyncio

    out = asyncio.run(
        mnemosyne_adapter.run("x", {"memory_principal_key": PRINCIPAL, "file_memory_grant_key": "g"})
    )
    assert seen["ok"] and out["data"]["facts"] == []
