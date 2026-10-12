"""L7 Librarian adapter: principal-scoped recall via the live robust_search."""

from __future__ import annotations

import inspect
import json

import pytest

import cortex_server.routers.librarian as librarian_router
from cortex_server.modules.execution_engine import ExecutionBlocked, ExecutionEngine
from cortex_server.modules.level_adapters import librarian as librarian_adapter


PRINCIPAL_A = "principal:" + "a" * 64
PRINCIPAL_B = "principal:" + "b" * 64


def test_adapter_contract_attributes():
    assert librarian_adapter.LEVEL == 7
    assert librarian_adapter.NAME == "librarian"
    assert librarian_adapter.NEEDS_MODEL is False
    assert librarian_adapter.SAFE_AUTORUN is True
    assert librarian_adapter.DEFAULT_DEADLINE_S > 0
    assert inspect.iscoroutinefunction(librarian_adapter.run)


def test_recall_kwargs_use_only_live_robust_search_parameters():
    accepted = set(inspect.signature(librarian_router.robust_search).parameters)
    kwargs = librarian_adapter.recall_kwargs(
        "q",
        {
            "memory_principal_key": PRINCIPAL_A,
            "file_memory_grant_key": "principal-fixed:" + "c" * 64,
            "tenant_id": "tenant-a",
            "workspace_id": "workspace-a",
            "memory_limit": 50,
        },
    )
    assert set(kwargs) <= accepted
    assert "file_memory_grant_key" not in kwargs
    assert kwargs["n_results"] == librarian_adapter.MAX_RESULTS
    assert kwargs["memory_principal_key"] == PRINCIPAL_A


def test_recall_kwargs_drop_malformed_scope_ids():
    kwargs = librarian_adapter.recall_kwargs(
        "q",
        {"memory_principal_key": PRINCIPAL_A, "tenant_id": "bad tenant!", "workspace_id": "../x y"},
    )
    assert kwargs["tenant_id"] is None and kwargs["workspace_id"] is None


@pytest.mark.asyncio
async def test_adapter_blocks_without_principal_and_on_empty_query():
    with pytest.raises(ExecutionBlocked) as raised:
        await librarian_adapter.run("what is my dog's name", {})
    assert raised.value.reason == "authenticated_memory_scope_required"
    with pytest.raises(ExecutionBlocked) as raised:
        await librarian_adapter.run("   ", {"memory_principal_key": PRINCIPAL_A})
    assert raised.value.reason == "empty_query"


@pytest.mark.asyncio
async def test_adapter_bounds_results_and_withholds_identity_metadata(monkeypatch):
    captured = {}

    def fake_search(query, n_results=5, allow_fallback=True, *, tenant_id=None, workspace_id=None, memory_principal_key=None, filters=None):
        captured.update(query=query, n_results=n_results, memory_principal_key=memory_principal_key)
        return {
            "query": query,
            "results": [
                {
                    "id": f"m{index}",
                    "text": "Billing contact is Dana " + "x" * 3000,
                    "distance": 0.1,
                    "metadata": {
                        "fact_key": "acme.billing_contact",
                        "memory_principal_key": PRINCIPAL_A,
                        "user_id": "owner-user",
                        "session_id": "s1",
                        "source": "conversation",
                    },
                }
                for index in range(20)
            ],
            "search_mode": "semantic",
            "degraded": False,
            "warning": None,
            "available": True,
        }

    monkeypatch.setattr(librarian_router, "robust_search", fake_search)
    out = await librarian_adapter.run("who is the billing contact", {"memory_principal_key": PRINCIPAL_A})
    encoded = json.dumps(out)
    assert captured["memory_principal_key"] == PRINCIPAL_A
    assert out["operation"] == "librarian.recall" and out["origin"] == "deterministic"
    assert len(out["data"]["results"]) == librarian_adapter.DEFAULT_RESULTS
    assert all(len(row["text"]) <= librarian_adapter.MAX_TEXT_CHARS for row in out["data"]["results"])
    assert out["data"]["sources"][0] == "m0"
    assert out["data"]["results"][0]["fact_key"] == "acme.billing_contact"
    assert "owner-user" not in encoded and PRINCIPAL_A not in encoded and '"s1"' not in encoded
    assert len(out["summary"]) <= 1500


@pytest.mark.asyncio
async def test_adapter_never_reports_empty_recall_when_store_unavailable(monkeypatch):
    monkeypatch.setattr(
        librarian_router,
        "robust_search",
        lambda *a, **k: {"results": [], "search_mode": "lexical_fallback", "degraded": True, "available": False},
    )
    with pytest.raises(ExecutionBlocked) as raised:
        await librarian_adapter.run("anything", {"memory_principal_key": PRINCIPAL_A})
    assert raised.value.reason == "memory_store_unavailable"


@pytest.mark.asyncio
async def test_adapter_reports_genuine_empty_recall(monkeypatch):
    monkeypatch.setattr(
        librarian_router,
        "robust_search",
        lambda *a, **k: {"results": [], "search_mode": "semantic", "degraded": False, "available": True},
    )
    out = await librarian_adapter.run("anything", {"memory_principal_key": PRINCIPAL_A})
    assert out["data"]["results"] == []
    assert "No stored memories matched" in out["summary"]


class _ScopedFakeCollection:
    """Collection fake that honours the principal ``where`` like Chroma does."""

    rows = [
        ("a1", "L7PROBE-zx81 the owner's dog is named Biscuit", {"memory_principal_key": PRINCIPAL_A, "source": "chat"}),
        ("b1", "L7PROBE-zx81 another principal's secret note", {"memory_principal_key": PRINCIPAL_B, "source": "chat"}),
    ]

    def get(self, *args, **kwargs):
        return {
            "ids": [row[0] for row in self.rows],
            "documents": [row[1] for row in self.rows],
            "metadatas": [dict(row[2]) for row in self.rows],
        }

    def query(self, *args, **kwargs):
        return {"ids": [[]], "documents": [[]], "distances": [[]], "metadatas": [[]]}

    def count(self):
        return len(self.rows)


@pytest.mark.asyncio
async def test_adapter_end_to_end_with_live_robust_search_is_principal_isolated(monkeypatch, tmp_path):
    empty_root = tmp_path / "empty-local-memory"
    empty_root.mkdir()
    monkeypatch.setenv(librarian_router._LOCAL_FILE_MEMORY_ROOTS_ENV, str(empty_root))
    monkeypatch.setattr(librarian_router, "collection", _ScopedFakeCollection())
    engine = ExecutionEngine({"librarian": librarian_adapter.run})
    out = await engine.execute_stack(
        [{"level": 7, "name": "librarian"}],
        "L7PROBE-zx81",
        context={"memory_principal_key": PRINCIPAL_A},
    )
    receipt = out["executionResults"]["librarian"]
    # The legacy engine adapter failed here with TypeError (file_memory_grant_key).
    assert receipt["status"] == "succeeded", receipt
    texts = [row["text"] for row in receipt["result"]["data"]["results"]]
    assert any("Biscuit" in text for text in texts)
    assert not any("another principal" in text for text in texts)
