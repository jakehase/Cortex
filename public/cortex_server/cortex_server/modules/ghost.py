"""Ghost Module - synchronous facade over the governed L2 browser path.

Celery workers (``worker.process_swarm``) use this class.  It formerly drove a
``--no-sandbox`` Chromium directly with ``page.goto`` to arbitrary URLs and to
Startpage, bypassing the pinned outbound-egress broker that the L2 router
treats as mandatory (SSRF to internal hosts / cloud metadata was possible).

Every method now delegates to the same in-process functions that back
``/browser/browse``, ``/browser/search`` and ``/browser/screenshot``.  Those
functions enforce the server-owned egress policy
(``CORTEX_BROWSER_EGRESS_ALLOWED_HOSTS`` or
``CORTEX_BROWSER_PUBLIC_READ_ENABLED``), pinned global-only DNS, scheme and
credential checks, per-hop redirect validation, byte limits and timeouts.
When egress is not configured they raise ``EgressPolicyError``; callers see the
failure instead of an unguarded fetch.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import re
from typing import Any, Awaitable, Dict, List

from bs4 import BeautifulSoup

_SYNC_BRIDGE_TIMEOUT_S = 60.0


def _run_sync(coro: Awaitable[Any]) -> Any:
    """Run a coroutine from synchronous code, even if a loop is running."""

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)  # type: ignore[arg-type]
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result(timeout=_SYNC_BRIDGE_TIMEOUT_S)


def _browser():
    # Imported lazily: the router module pulls in FastAPI/Playwright and is
    # only needed when a worker actually browses.
    from cortex_server.routers import browser

    return browser


class Ghost:
    """Synchronous governed web access for Celery task workers."""

    def __init__(self, headless: bool = True):
        # Kept for call-site compatibility; rendering is always headless and
        # offline (broker-fetched HTML, JavaScript disabled, subrequests aborted).
        self.headless = headless

    def browse(self, url: str) -> str:
        """Fetch a public URL through the egress broker and return its text."""

        browser = _browser()
        fetched = _run_sync(browser._fetch_page_text(str(url), public_read=True))
        return str(fetched.get("text") or "")

    def search(self, query: str, max_results: int = 5) -> List[Dict[str, str]]:
        """Search through the governed L2 search path (pinned broker)."""

        browser = _browser()
        limit = max(1, min(int(max_results or 5), 10))
        out = _run_sync(browser._search_public_web(str(query), limit=limit))
        results = list(out.get("results") or [])
        if not results and out.get("reason") == "upstream_blocked":
            raise browser.SearchUpstreamBlocked("search upstream blocked")
        return [
            {"title": str(row.get("title") or ""), "link": str(row.get("link") or "")}
            for row in results
        ]

    def screenshot(self, url: str, full_page: bool = False) -> bytes:
        """Render broker-fetched HTML offline and return PNG bytes."""

        browser = _browser()
        screenshot_bytes, _navigation = _run_sync(
            browser._capture_screenshot(str(url), full_page=bool(full_page))
        )
        return screenshot_bytes

    @staticmethod
    def _html_to_text(html: str) -> str:
        """Convert HTML to readable markdown-friendly text."""
        soup = BeautifulSoup(html, "html.parser")

        # Remove scripts/styles
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()

        # Get text and normalize whitespace
        text = soup.get_text(separator="\n")
        lines = [line.strip() for line in text.splitlines()]
        cleaned = "\n".join([line for line in lines if line])
        cleaned = re.sub(r"\n{2,}", "\n\n", cleaned)
        return cleaned.strip()
