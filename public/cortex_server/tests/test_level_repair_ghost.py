"""L2 Ghost repair: status honesty, cache, error codes, redirects, worker, adapter."""

from __future__ import annotations

import ast
import asyncio
import inspect
import textwrap
import json
import time

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from cortex_server import outbound_egress
from cortex_server.modules import ghost as ghost_module
from cortex_server.modules.execution_engine import ExecutionBlocked, ExecutionEngine
from cortex_server.modules.level_adapters import ghost as ghost_adapter
from cortex_server.outbound_egress import (
    EgressPolicyError,
    EgressUpstreamError,
)
from cortex_server.routers import browser, ghost as ghost_router


PRINCIPAL = {"memory_principal_key": "principal:" + "a" * 64}


def _public_dns(_hostname, port, *_args):
    return [
        (
            outbound_egress.socket.AF_INET,
            outbound_egress.socket.SOCK_STREAM,
            6,
            "",
            ("93.184.216.34", port),
        )
    ]


@pytest.fixture(autouse=True)
def _isolate_browser(monkeypatch):
    monkeypatch.delenv("CORTEX_BROWSER_EGRESS_ALLOWED_HOSTS", raising=False)
    monkeypatch.delenv(browser.BROWSER_PUBLIC_READ_ENV, raising=False)
    browser._cache.clear()
    yield
    browser._cache.clear()


def _status_client(*, with_ghost: bool = True) -> TestClient:
    app = FastAPI()
    app.include_router(browser.router, prefix="/browser")
    if with_ghost:
        app.include_router(ghost_router.router, prefix="/ghost")
    return TestClient(app)


# --------------------------------------------------------------------------
# Status honesty
# --------------------------------------------------------------------------


def test_status_does_not_advertise_web_capabilities_without_egress():
    body = _status_client().get("/browser/status").json()
    assert body["egress"]["mode"] == "denied"
    assert "web_browse" not in body["capabilities"]
    assert "web_search" not in body["capabilities"]
    assert body["unavailable_capabilities"]["web_browse"] == "browse_egress_not_permitted"
    assert body["unavailable_capabilities"]["web_search"] == "search_egress_not_permitted"
    assert body["success"] is False
    assert body["status"] != "active"
    assert "egress" in body["reason"]
    # Egress-free local heuristics remain honestly listed.
    assert "heuristic_truth_arbitration" in body["capabilities"]


def test_status_is_active_with_public_read_and_ghost_alias_matches(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    client = _status_client()
    body = client.get("/browser/status").json()
    assert body["status"] == "active" and body["success"] is True
    assert {"web_browse", "web_search"} <= set(body["capabilities"])
    # Allowlist-only helpers are not usable in public-read mode.
    assert body["unavailable_capabilities"]["screenshot"] == "requires_server_egress_allowlist"
    alias = client.get("/ghost/status").json()
    assert alias["alias_of"] == "/browser/status"
    assert alias["capabilities"] == body["capabilities"]
    assert alias["restricted_capabilities"] == body["restricted_capabilities"]
    assert alias["status"] == body["status"]


def test_allowlist_without_search_upstream_reports_search_unavailable(monkeypatch):
    monkeypatch.setenv("CORTEX_BROWSER_EGRESS_ALLOWED_HOSTS", "docs.example.com")
    state = browser.browser_egress_state()
    assert state["mode"] == "allowlist"
    assert state["browse_available"] is True
    assert state["search_available"] is False
    assert "html.duckduckgo.com" in state["reason"]
    body = _status_client(with_ghost=False).get("/browser/status").json()
    assert "web_browse" in body["capabilities"]
    assert "web_search" not in body["capabilities"]
    # Host names are never exposed on the public-redacted status.
    assert "docs.example.com" not in json.dumps(body)


def test_invalid_allowlist_is_reported_as_misconfigured(monkeypatch):
    monkeypatch.setenv("CORTEX_BROWSER_EGRESS_ALLOWED_HOSTS", "*")
    assert browser.browser_egress_state()["mode"] == "misconfigured"


# --------------------------------------------------------------------------
# Same-site redirects under public read
# --------------------------------------------------------------------------


def test_same_site_hosts_rule():
    assert browser._same_site_hosts("example.com") == ("example.com", "www.example.com")
    assert browser._same_site_hosts("www.example.com") == ("www.example.com", "example.com")
    assert browser._same_site_hosts("93.184.216.34") == ("93.184.216.34",)
    assert browser._same_site_hosts("localhost") == ("localhost",)
    assert browser._same_site_hosts("www.com") == ("www.com",)


@pytest.mark.asyncio
async def test_public_read_policy_admits_www_sibling_but_nothing_else(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    monkeypatch.setattr(outbound_egress.socket, "getaddrinfo", _public_dns)
    policy = browser._browser_public_read_policy("http://nytimes.com/")
    assert policy.permits_hostname("nytimes.com")
    assert policy.permits_hostname("www.nytimes.com")
    assert not policy.permits_hostname("evil.example")
    assert not policy.permits_hostname("cdn.nytimes.com")
    destination = await outbound_egress.validate_destination("https://www.nytimes.com/", policy)
    assert destination.hostname == "www.nytimes.com"
    with pytest.raises(EgressPolicyError, match="server-authorized"):
        await outbound_egress.validate_destination("https://evil.example/", policy)


@pytest.mark.asyncio
async def test_public_read_sibling_still_rejects_private_answers(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")

    def private(_hostname, port, *_args):
        return [
            (
                outbound_egress.socket.AF_INET,
                outbound_egress.socket.SOCK_STREAM,
                6,
                "",
                ("10.0.0.52", port),
            )
        ]

    monkeypatch.setattr(outbound_egress.socket, "getaddrinfo", private)
    policy = browser._browser_public_read_policy("https://example.com/")
    with pytest.raises(EgressPolicyError, match="non-global"):
        await outbound_egress.validate_destination("https://www.example.com/", policy)


def test_explicit_allowlist_remains_authoritative(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    monkeypatch.setenv("CORTEX_BROWSER_EGRESS_ALLOWED_HOSTS", "example.com")
    policy = browser._browser_public_read_policy("https://example.com/")
    assert policy.allowed_hosts == ("example.com",)
    assert not policy.permits_hostname("www.example.com")


# --------------------------------------------------------------------------
# Cache: no memory write, no I/O under the lock, bounded
# --------------------------------------------------------------------------


def _code_identifiers(obj) -> set:
    tree = ast.parse(textwrap.dedent(inspect.getsource(obj)))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            names.add(node.attr)
    # Identifiers only: docstrings may legitimately describe the old bypass.
    return names


def test_cache_store_performs_no_memory_write():
    assert not hasattr(browser, "chain_to")
    identifiers = _code_identifiers(browser._store_in_cache)
    assert "chain_to" not in identifiers
    assert not any("embed" in name or "librarian" in name for name in identifiers)


@pytest.mark.asyncio
async def test_cache_is_bounded():
    for index in range(browser.MAX_BROWSER_CACHE_ENTRIES + 5):
        await browser._store_in_cache(f"key-{index}", "text")
    assert len(browser._cache) == browser.MAX_BROWSER_CACHE_ENTRIES
    assert "key-0" not in browser._cache
    assert f"key-{browser.MAX_BROWSER_CACHE_ENTRIES + 4}" in browser._cache


@pytest.mark.asyncio
async def test_concurrent_cache_misses_do_not_serialise(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    monkeypatch.setattr(outbound_egress.socket, "getaddrinfo", _public_dns)

    async def slow_document(url, *, policy=None, allowed_domains=None):
        await asyncio.sleep(0.2)
        return "<p>page</p>", {"transport": "pinned_http", "status_code": 200, "final_url": url}

    monkeypatch.setattr(browser, "_fetch_browser_document", slow_document)
    started = time.monotonic()
    results = await asyncio.gather(
        *(
            browser._fetch_page_text(f"https://example.com/?page={index}", public_read=True)
            for index in range(6)
        )
    )
    elapsed = time.monotonic() - started
    assert all(row["text"] == "page" for row in results)
    assert elapsed < 0.2 * 6 * 0.6


# --------------------------------------------------------------------------
# Honest HTTP status codes on /browser/browse and /browser/search
# --------------------------------------------------------------------------


async def _browse_status(monkeypatch, exc: BaseException) -> int:
    async def failing(*_args, **_kwargs):
        raise exc

    monkeypatch.setattr(browser, "assert_action_authorized", lambda _auth: None)
    monkeypatch.setattr(browser, "_fetch_page_text", failing)
    with pytest.raises(HTTPException) as raised:
        await browser.browser_browse(browser.BrowseRequest(url="https://example.com/"), object())
    return raised.value


@pytest.mark.asyncio
async def test_browse_policy_denial_is_422_with_public_read(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    error = await _browse_status(monkeypatch, EgressPolicyError("only HTTP(S) destinations are allowed"))
    assert error.status_code == 422


@pytest.mark.asyncio
async def test_browse_without_egress_configuration_is_503(monkeypatch):
    error = await _browse_status(monkeypatch, EgressPolicyError("destination hostname is not server-authorized"))
    assert error.status_code == 503


@pytest.mark.asyncio
async def test_browse_upstream_errors_are_502_and_504(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    assert (await _browse_status(monkeypatch, EgressUpstreamError("outbound request failed"))).status_code == 502
    assert (await _browse_status(monkeypatch, EgressUpstreamError("outbound request timed out"))).status_code == 504


@pytest.mark.asyncio
async def test_browse_internal_error_is_500_without_raw_exception_text(monkeypatch):
    error = await _browse_status(monkeypatch, RuntimeError("/etc/secret-path leaked"))
    assert error.status_code == 500
    assert "secret-path" not in str(error.detail)


@pytest.mark.asyncio
async def test_browse_authorization_failure_keeps_its_403(monkeypatch):
    def deny(_auth):
        raise HTTPException(status_code=403, detail="trusted action authorization required")

    monkeypatch.setattr(browser, "assert_action_authorized", deny)
    with pytest.raises(HTTPException) as raised:
        await browser.browser_browse(browser.BrowseRequest(url="https://example.com/"), object())
    assert raised.value.status_code == 403


@pytest.mark.asyncio
async def test_browse_success_shape_unchanged(monkeypatch):
    async def fetched(url, ttl_seconds=600, *, allowed_domains=None, public_read=False):
        assert public_read is True
        return {"text": "Example Domain", "cached": False, "navigation": {}}

    monkeypatch.setattr(browser, "assert_action_authorized", lambda _auth: None)
    monkeypatch.setattr(browser, "_fetch_page_text", fetched)
    result = await browser.browser_browse(browser.BrowseRequest(url="https://example.com/"), object())
    assert result == "Example Domain"


_RESULT_HTML = (
    '<div class="result"><a class="result__a" '
    'href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.python.org%2F3%2F">Python docs</a>'
    '<a class="result__snippet">Official documentation</a></div>'
)


def _fake_document(html: str, status_code: int = 200):
    async def document(url, *, policy=None, allowed_domains=None):
        return html, {"transport": "pinned_http", "status_code": status_code, "final_url": url}

    return document


@pytest.mark.asyncio
async def test_search_success_keeps_title_link_shape(monkeypatch):
    monkeypatch.setattr(browser, "assert_action_authorized", lambda _auth: None)
    monkeypatch.setattr(browser, "_fetch_browser_document", _fake_document(_RESULT_HTML))
    results = await browser.browser_search(browser.SearchRequest(query="python docs"), object())
    assert results == [{"title": "Python docs", "link": "https://docs.python.org/3/"}]


@pytest.mark.asyncio
async def test_search_antibot_page_is_502_not_empty_success(monkeypatch):
    monkeypatch.setattr(browser, "assert_action_authorized", lambda _auth: None)
    monkeypatch.setattr(
        browser,
        "_fetch_browser_document",
        _fake_document('<div class="anomaly-modal">Unfortunately, bots use DuckDuckGo too.</div>', 202),
    )
    with pytest.raises(HTTPException) as raised:
        await browser.browser_search(browser.SearchRequest(query="python docs"), object())
    assert raised.value.status_code == 502


@pytest.mark.asyncio
async def test_search_query_echo_is_not_mistaken_for_antibot(monkeypatch):
    monkeypatch.setattr(
        browser,
        "_fetch_browser_document",
        _fake_document('<input value="captcha solver"><div class="no-results">No results.</div>'),
    )
    out = await browser._search_public_web("captcha solver")
    assert out["results"] == [] and out["reason"] == "no_results"


@pytest.mark.asyncio
async def test_search_snippets_are_opt_in(monkeypatch):
    monkeypatch.setattr(browser, "_fetch_browser_document", _fake_document(_RESULT_HTML))
    plain = await browser._search_public_web("python")
    assert set(plain["results"][0]) == {"title", "link"}
    rich = await browser._search_public_web("python", include_snippets=True)
    assert rich["results"][0]["snippet"] == "Official documentation"


# --------------------------------------------------------------------------
# Worker module no longer bypasses the egress broker
# --------------------------------------------------------------------------


def test_worker_ghost_has_no_direct_browser_navigation():
    identifiers = _code_identifiers(ghost_module)
    assert "sync_playwright" not in identifiers
    assert "goto" not in identifiers
    assert "chromium" not in identifiers


def test_worker_ghost_is_denied_without_egress_before_dns(monkeypatch):
    def unexpected_dns(*_args):
        raise AssertionError("egress-denied fetch must not resolve DNS")

    monkeypatch.setattr(outbound_egress.socket, "getaddrinfo", unexpected_dns)
    with pytest.raises(EgressPolicyError):
        ghost_module.Ghost().browse("http://169.254.169.254/latest/meta-data")
    with pytest.raises(EgressPolicyError):
        ghost_module.Ghost().search("anything")


def test_worker_ghost_search_uses_governed_search(monkeypatch):
    calls = []

    async def governed(query, limit=5, *, include_snippets=False):
        calls.append((query, limit))
        return {"results": [{"title": "T", "link": "https://x.example/"}], "reason": "ok"}

    monkeypatch.setattr(browser, "_search_public_web", governed)
    assert ghost_module.Ghost().search("q", max_results=3) == [{"title": "T", "link": "https://x.example/"}]
    assert calls == [("q", 3)]


# --------------------------------------------------------------------------
# ExecutionEngine adapter
# --------------------------------------------------------------------------


def test_adapter_contract_attributes():
    assert ghost_adapter.LEVEL == 2
    assert ghost_adapter.NAME == "ghost"
    assert ghost_adapter.NEEDS_MODEL is False
    assert ghost_adapter.SAFE_AUTORUN is True
    assert ghost_adapter.DEFAULT_DEADLINE_S > 0
    assert inspect.iscoroutinefunction(ghost_adapter.run)


def _install_fake_web(monkeypatch, calls):
    async def fake_search(query, limit=5, *, include_snippets=False):
        calls.append(("search", query, include_snippets))
        return {
            "results": [
                {"title": "Modifier guide", "link": "https://a.example/", "snippet": "snippet a"},
                {"title": "Second", "link": "https://b.example/", "snippet": "snippet b"},
                {"title": "Third", "link": "https://c.example/", "snippet": "snippet c"},
            ],
            "reason": "ok",
            "navigation": {},
        }

    async def fake_fetch(url, ttl_seconds=600, *, allowed_domains=None, public_read=False):
        calls.append(("fetch", url, public_read))
        if "b.example" in url:
            raise EgressUpstreamError("outbound request failed")
        return {
            "text": "Nav\nTelehealth modifier 95 applies to psychiatric evaluation codes billed via video.\nFooter text long enough to be considered a block.",
            "cached": False,
            "navigation": {"final_url": url, "status_code": 200},
        }

    monkeypatch.setattr(browser, "_search_public_web", fake_search)
    monkeypatch.setattr(browser, "_fetch_page_text", fake_fetch)


@pytest.mark.asyncio
async def test_adapter_search_returns_bounded_results_and_excerpts(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    calls = []
    _install_fake_web(monkeypatch, calls)
    out = await ghost_adapter.run(
        "Which telehealth modifier applies to psychiatric evaluation? reach me at jake@example.com",
        PRINCIPAL,
    )
    json.dumps(out)
    assert out["operation"] == "ghost.search"
    assert out["origin"] == "deterministic"
    assert len(out["summary"]) <= 1500
    search_call = calls[0]
    assert search_call[0] == "search" and search_call[2] is True
    assert "jake@example.com" not in search_call[1]
    results = out["data"]["results"]
    assert [row["rank"] for row in results] == [1, 2, 3]
    assert "modifier 95" in results[0]["excerpt"]
    assert results[1]["page_error"] == "browse_upstream_failed"
    assert "excerpt" not in results[2]  # only the top two pages are read
    assert all(call[2] is True for call in calls if call[0] == "fetch")
    assert "Modifier guide" in out["summary"]


@pytest.mark.asyncio
async def test_adapter_reads_urls_from_message(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    calls = []
    _install_fake_web(monkeypatch, calls)
    out = await ghost_adapter.run("Summarize https://a.example/page.html please", PRINCIPAL)
    assert out["operation"] == "ghost.read"
    assert calls == [("fetch", "https://a.example/page.html", True)]
    assert out["data"]["items"][0]["final_url"] == "https://a.example/page.html"
    assert len(out["data"]["items"][0]["sha256"]) == 64


async def _blocked_reason(query, context):
    with pytest.raises(ExecutionBlocked) as raised:
        await ghost_adapter.run(query, context)
    return raised.value.reason


@pytest.mark.asyncio
async def test_adapter_blocks_without_principal_or_query(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    assert await _blocked_reason("latest news", {}) == "authenticated_principal_required"
    assert await _blocked_reason("   ", PRINCIPAL) == "empty_query"


@pytest.mark.asyncio
async def test_adapter_blocks_when_egress_not_configured():
    assert await _blocked_reason("latest news", PRINCIPAL) == "browser_search_egress_not_configured"
    assert await _blocked_reason("read https://a.example/", PRINCIPAL) == "browser_egress_not_configured"


@pytest.mark.asyncio
async def test_adapter_honors_supplied_action_policy(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    context = {**PRINCIPAL, "allowed_actions": ["POST:/browser/browse"]}
    assert await _blocked_reason("latest news", context) == "browser_action_not_authorized"
    assert (
        await _blocked_reason("latest news", {**PRINCIPAL, "external_action_kill_switch": True})
        == "external_actions_disabled"
    )


@pytest.mark.asyncio
async def test_adapter_never_fabricates_on_blocked_upstream_or_policy_denial(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")

    async def blocked_search(query, limit=5, *, include_snippets=False):
        return {"results": [], "reason": "upstream_blocked", "navigation": {}}

    async def denied_fetch(url, ttl_seconds=600, *, allowed_domains=None, public_read=False):
        raise EgressPolicyError("destination resolves to a non-global address")

    monkeypatch.setattr(browser, "_search_public_web", blocked_search)
    monkeypatch.setattr(browser, "_fetch_page_text", denied_fetch)
    assert await _blocked_reason("latest news", PRINCIPAL) == "search_upstream_blocked"
    assert (
        await _blocked_reason("read http://169.254.169.254/latest", PRINCIPAL)
        == "browser_egress_policy_denied"
    )


@pytest.mark.asyncio
async def test_adapter_receipts_through_execution_engine(monkeypatch):
    monkeypatch.setenv(browser.BROWSER_PUBLIC_READ_ENV, "true")
    calls = []
    _install_fake_web(monkeypatch, calls)
    engine = ExecutionEngine({"ghost": ghost_adapter.run})
    ok = await engine.execute_stack([{"level": 2, "name": "ghost"}], "telehealth modifier", context=PRINCIPAL)
    assert ok["executionResults"]["ghost"]["status"] == "succeeded"
    blocked = await engine.execute_stack([{"level": 2, "name": "ghost"}], "telehealth modifier", context={})
    assert blocked["executionResults"]["ghost"]["status"] == "blocked"
    assert blocked["executionResults"]["ghost"]["reason"] == "authenticated_principal_required"
