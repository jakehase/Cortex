"""Tavily is the primary web search provider; DuckDuckGo is the fallback."""

from __future__ import annotations

import json

import pytest

from cortex_server.outbound_egress import EgressResponse, EgressUpstreamError
from cortex_server.routers import browser

FAKE_KEY = "tvly-test-0000000000000000000000"
_DDG_HTML = (
    '<div class="result"><a class="result__a" '
    'href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.python.org%2F3%2F">Python docs</a>'
    '<a class="result__snippet">Official documentation</a></div>'
)


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(
        browser, "_tavily_state", {"disabled_until": 0.0, "last_status": None, "calls": 0, "fallbacks": 0}
    )
    ddg_calls = []

    async def document(url, *, policy=None, allowed_domains=None):
        ddg_calls.append(url)
        return _DDG_HTML, {"transport": "pinned_http", "status_code": 200, "final_url": url}

    monkeypatch.setattr(browser, "_fetch_browser_document", document)
    return ddg_calls


def _tavily_reply(monkeypatch, *, status=200, body=None, error=None):
    seen = []

    async def fake_request(method, url, **kwargs):
        seen.append({"method": method, "url": url, **kwargs})
        if error is not None:
            raise error
        payload = body if body is not None else {
            "results": [
                {"title": "CMS telehealth FAQ", "url": "https://www.cms.gov/telehealth", "content": "Behavioral  health\nvisits ..."},
                {"title": "bad", "url": "javascript:alert(1)", "content": "x"},
            ]
        }
        return EgressResponse(status_code=status, body=json.dumps(payload).encode(), headers={}, final_url=url)

    monkeypatch.setattr(browser, "outbound_request", fake_request)
    return seen


@pytest.mark.asyncio
async def test_no_key_uses_duckduckgo(monkeypatch, _fresh_state):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    seen = _tavily_reply(monkeypatch)
    out = await browser._search_public_web("python docs")
    assert seen == [] and _fresh_state
    assert out["provider"] == "duckduckgo" and "fallback_from" not in out
    assert out["results"] == [{"title": "Python docs", "link": "https://docs.python.org/3/"}]


@pytest.mark.asyncio
async def test_tavily_primary_shape_and_request(monkeypatch, _fresh_state):
    monkeypatch.setenv("TAVILY_API_KEY", FAKE_KEY)
    seen = _tavily_reply(monkeypatch)
    plain = await browser._search_public_web("telehealth 2027", limit=5)
    assert plain["provider"] == "tavily" and _fresh_state == []
    assert plain["results"] == [{"title": "CMS telehealth FAQ", "link": "https://www.cms.gov/telehealth"}]
    rich = await browser._search_public_web("telehealth 2027", include_snippets=True)
    assert rich["results"][0]["snippet"] == "Behavioral health visits ..."
    call = seen[0]
    assert call["method"] == "POST" and call["url"] == browser.TAVILY_SEARCH_URL
    assert call["headers"]["Authorization"] == f"Bearer {FAKE_KEY}"
    assert call["policy"].allowed_hosts == ("api.tavily.com",) and call["max_redirects"] == 0
    assert call["json"]["query"] == "telehealth 2027" and call["json"]["include_raw_content"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 429, 432, 433])
async def test_quota_or_auth_failure_falls_back_and_cools_down(monkeypatch, _fresh_state, status):
    monkeypatch.setenv("TAVILY_API_KEY", FAKE_KEY)
    seen = _tavily_reply(monkeypatch, status=status, body={"detail": "limit"})
    out = await browser._search_public_web("python docs")
    assert out["provider"] == "duckduckgo" and out["fallback_from"] == "tavily"
    assert out["results"][0]["link"] == "https://docs.python.org/3/"
    again = await browser._search_public_web("python docs")
    assert again["provider"] == "duckduckgo" and len(seen) == 1  # cooling down: Tavily not retried
    status_view = browser.search_provider_status()
    assert status_view["tavily_cooling_down_s"] > 0 and status_view["fallbacks_to_duckduckgo"] == 2
    assert FAKE_KEY not in json.dumps(status_view)


@pytest.mark.asyncio
async def test_transport_error_or_bad_payload_falls_back(monkeypatch, _fresh_state):
    monkeypatch.setenv("TAVILY_API_KEY", FAKE_KEY)
    _tavily_reply(monkeypatch, error=EgressUpstreamError("outbound request timed out"))
    out = await browser._search_public_web("python docs")
    assert out["provider"] == "duckduckgo" and out["fallback_from"] == "tavily"
    _tavily_reply(monkeypatch, body={"unexpected": True})
    out = await browser._search_public_web("python docs")
    assert out["provider"] == "duckduckgo"


@pytest.mark.asyncio
async def test_malformed_key_is_ignored(monkeypatch, _fresh_state):
    monkeypatch.setenv("TAVILY_API_KEY", "bad key with spaces")
    seen = _tavily_reply(monkeypatch)
    out = await browser._search_public_web("python docs")
    assert seen == [] and out["provider"] == "duckduckgo"
    assert browser.search_provider_status()["tavily_configured"] is False
