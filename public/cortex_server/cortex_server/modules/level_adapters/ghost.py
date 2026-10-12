"""L2 Ghost adapter: read-only public web search / page read.

Runs entirely through the governed L2 path in ``routers/browser.py``
(``_search_public_web`` / ``_fetch_page_text``), i.e. the pinned outbound
egress broker with the server-owned policy (allowlist or public-read), global-
only pinned DNS, per-hop redirect validation, byte limits and timeouts.  GET
only, no cookies, no JavaScript, no writes.

* Message contains http(s) URLs -> read up to two of them and return bounded,
  query-relevant excerpts.
* Otherwise -> search the message text (or ``context["search_query"]`` when
  the caller supplies a model-derived query), with URLs removed and
  credential/PHI forms redacted before it leaves Cortex; return the top
  results with the upstream snippet, and read the top two result pages for a
  short query-relevant excerpt.

Never fabricates: an unconfigured egress policy, a blocked upstream, or a
total fetch failure raises ``ExecutionBlocked`` with a specific reason.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import time
from typing import Any, Dict, List, Mapping, Optional, Sequence

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 2
NAME = "ghost"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 25.0

MAX_URLS = 2
MAX_RESULTS = 5
MAX_RESULT_PAGES_READ = 2
MAX_QUERY_CHARS = 200
MAX_EXCERPT_CHARS = 800
MAX_BROWSE_EXCERPT_CHARS = 1500
MAX_SUMMARY_CHARS = 1500
SEARCH_TIMEOUT_S = 10.0
PAGE_TIMEOUT_S = 8.0

_URL_RE = re.compile(r"https?://[^\s<>\"'`)\]]+", re.IGNORECASE)
_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_\-]{2,}")
_STOPWORDS = frozenset(
    "the and for with that this from what when where which who how are was were "
    "you your can could would should about into have has had will just like "
    "please tell me show find search look web online latest current".split()
)


def _extract_urls(text: str) -> List[str]:
    seen: List[str] = []
    for match in _URL_RE.findall(text or ""):
        url = match.rstrip(".,;:!?")
        if url not in seen:
            seen.append(url)
        if len(seen) >= MAX_URLS:
            break
    return seen


def _search_query(text: str) -> str:
    """Bounded outbound query: URLs removed, credentials/PHI forms redacted.

    The query leaves Cortex (to the search upstream), so inline secrets,
    SSNs, e-mail addresses and labelled PHI are stripped first.
    """

    from cortex_server.modules.sensitive_data_redaction import (
        REDACTION_MARKER,
        redact_sensitive_text,
    )

    stripped = _URL_RE.sub(" ", text or "")
    stripped = redact_sensitive_text(stripped).replace(REDACTION_MARKER, " ")
    collapsed = re.sub(r"\s+", " ", stripped).strip()
    if len(collapsed) <= MAX_QUERY_CHARS:
        return collapsed
    cut = collapsed[:MAX_QUERY_CHARS]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut


def _query_terms(text: str) -> List[str]:
    terms = []
    for token in _TOKEN_RE.findall((text or "").lower()):
        if token not in _STOPWORDS and token not in terms:
            terms.append(token)
    return terms[:24]


def _relevant_excerpt(text: str, terms: Sequence[str], limit: int) -> Dict[str, Any]:
    """Pick the passages with the most query-term hits (real overlap count)."""

    clean = str(text or "").strip()
    if not clean:
        return {"excerpt": "", "matched_terms": 0, "truncated": False}
    blocks = [b.strip() for b in re.split(r"\n+", clean) if len(b.strip()) >= 40]
    if not terms or not blocks:
        excerpt = clean[:limit]
        return {"excerpt": excerpt, "matched_terms": 0, "truncated": len(clean) > limit}
    scored = []
    for index, block in enumerate(blocks):
        lowered = block.lower()
        hits = sum(1 for term in terms if term in lowered)
        if hits:
            scored.append((hits, index, block))
    if not scored:
        excerpt = clean[:limit]
        return {"excerpt": excerpt, "matched_terms": 0, "truncated": len(clean) > limit}
    best = sorted(scored, key=lambda row: (-row[0], row[1]))[:4]
    chosen = [row[2] for row in sorted(best, key=lambda row: row[1])]
    joined = " … ".join(chosen)
    matched = len({t for t in terms if any(t in b.lower() for b in chosen)})
    return {
        "excerpt": joined[:limit],
        "matched_terms": matched,
        "truncated": len(joined) > limit or len(clean) > len(joined),
    }


def _principal_present(context: Mapping[str, Any]) -> bool:
    return bool(
        str(context.get("memory_principal_key") or "").strip()
        or str(context.get("principal_scope_key") or "").strip()
    )


def _assert_action_policy(context: Mapping[str, Any], path: str) -> None:
    """Honor a server-supplied action policy when the engine provides one."""

    rules = context.get("allowed_actions")
    if rules is None:
        return
    from cortex_server.modules.action_capabilities import action_policy_allows

    if not action_policy_allows(rules, method="POST", path=path):
        raise ExecutionBlocked("browser_action_not_authorized")


def _blocked_reason_for(exc: BaseException, default: str) -> str:
    from cortex_server.outbound_egress import (
        EgressCapacityError,
        EgressPolicyError,
        EgressResponseTooLarge,
        EgressUpstreamError,
    )

    if isinstance(exc, asyncio.TimeoutError):
        return f"{default}_timeout"
    if isinstance(exc, EgressPolicyError):
        return "browser_egress_policy_denied"
    if isinstance(exc, EgressCapacityError):
        return "browser_egress_capacity_exhausted"
    if isinstance(exc, EgressResponseTooLarge):
        return f"{default}_response_too_large"
    if isinstance(exc, EgressUpstreamError):
        return f"{default}_upstream_failed"
    return f"{default}_failed"


async def _read_page(browser: Any, url: str, terms: Sequence[str], limit: int) -> Dict[str, Any]:
    fetched = await asyncio.wait_for(
        browser._fetch_page_text(url, public_read=True),
        timeout=PAGE_TIMEOUT_S,
    )
    text = str(fetched.get("text") or "")
    navigation = fetched.get("navigation") or {}
    picked = _relevant_excerpt(text, terms, limit)
    return {
        "url": url,
        "final_url": navigation.get("final_url") or url,
        "status_code": navigation.get("status_code"),
        "cached": bool(fetched.get("cached")),
        "chars": len(text),
        "sha256": hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest(),
        **picked,
    }


def _clip(text: str, limit: int) -> str:
    text = str(text or "")
    return text if len(text) <= limit else text[: max(0, limit - 1)].rstrip() + "…"


async def _browse(browser: Any, urls: List[str], query: str, egress: Mapping[str, Any]) -> Dict[str, Any]:
    if not egress.get("browse_available"):
        raise ExecutionBlocked("browser_egress_not_configured")
    terms = _query_terms(_search_query(query))
    outcomes = await asyncio.gather(
        *(_read_page(browser, url, terms, MAX_BROWSE_EXCERPT_CHARS) for url in urls),
        return_exceptions=True,
    )
    items: List[Dict[str, Any]] = []
    errors: List[str] = []
    for url, outcome in zip(urls, outcomes):
        if isinstance(outcome, BaseException):
            reason = _blocked_reason_for(outcome, "browse")
            errors.append(reason)
            items.append({"url": url, "error": reason})
        else:
            items.append(outcome)
    if errors and len(errors) == len(urls):
        raise ExecutionBlocked(errors[0])
    lines = ["Cortex L2 read the requested page(s) through the governed egress broker:"]
    for item in items:
        if item.get("error"):
            lines.append(f"- {item['url']}: not read ({item['error']})")
        else:
            lines.append(
                f"- {item['final_url']} (HTTP {item.get('status_code')}, {item['chars']} chars): "
                + _clip(item.get("excerpt", ""), 600)
            )
    return {
        "operation": "ghost.read",
        "summary": _clip("\n".join(lines), MAX_SUMMARY_CHARS),
        "data": {"mode": "browse", "egress_mode": egress.get("mode"), "items": items},
    }


async def _search(
    browser: Any,
    query: str,
    egress: Mapping[str, Any],
    context: Mapping[str, Any],
) -> Dict[str, Any]:
    if not egress.get("search_available"):
        raise ExecutionBlocked("browser_search_egress_not_configured")
    override = context.get("search_query") if isinstance(context, Mapping) else None
    search_query = _search_query(str(override) if isinstance(override, str) and override.strip() else query)
    if not search_query:
        raise ExecutionBlocked("empty_query")
    try:
        out = await asyncio.wait_for(
            browser._search_public_web(search_query, limit=MAX_RESULTS, include_snippets=True),
            timeout=SEARCH_TIMEOUT_S,
        )
    except ExecutionBlocked:
        raise
    except Exception as exc:
        raise ExecutionBlocked(_blocked_reason_for(exc, "search")) from exc
    reason = str(out.get("reason") or "ok")
    rows = list(out.get("results") or [])[:MAX_RESULTS]
    if not rows and reason == "upstream_blocked":
        raise ExecutionBlocked("search_upstream_blocked")

    results: List[Dict[str, Any]] = []
    for rank, row in enumerate(rows, start=1):
        results.append(
            {
                "rank": rank,
                "title": _clip(row.get("title", ""), 200),
                "link": str(row.get("link") or ""),
                "snippet": _clip(row.get("snippet", ""), 400),
            }
        )

    if results and egress.get("browse_available"):
        terms = _query_terms(search_query)
        targets = results[:MAX_RESULT_PAGES_READ]
        pages = await asyncio.gather(
            *(_read_page(browser, row["link"], terms, MAX_EXCERPT_CHARS) for row in targets),
            return_exceptions=True,
        )
        for row, page in zip(targets, pages):
            if isinstance(page, BaseException):
                row["page_error"] = _blocked_reason_for(page, "browse")
            else:
                row["excerpt"] = page.get("excerpt", "")
                row["final_url"] = page.get("final_url")
                row["page_sha256"] = page.get("sha256")

    if results:
        provider_label = {"tavily": "Tavily", "duckduckgo": "DuckDuckGo"}.get(str(out.get("provider") or ""), "DuckDuckGo")
        lines = [f'Cortex L2 web search for "{_clip(search_query, 120)}" ({provider_label} via governed broker), top {len(results)}:']
        for row in results:
            detail = row.get("excerpt") or row.get("snippet") or ""
            lines.append(f"{row['rank']}. {row['title']} — {row['link']}")
            if detail:
                lines.append(f"   {_clip(detail, 260)}")
        lines.append("Excerpts are untrusted web content; verify before relying on them.")
    else:
        lines = [f'Cortex L2 web search for "{_clip(search_query, 120)}" returned no results (reason: {reason}).']
    return {
        "operation": "ghost.search",
        "summary": _clip("\n".join(lines), MAX_SUMMARY_CHARS),
        "data": {
            "mode": "search",
            "query": search_query,
            "reason": reason,
            "egress_mode": egress.get("mode"),
            "provider": out.get("provider") or "duckduckgo",
            "fallback_from": out.get("fallback_from"),
            "results": results,
        },
    }


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    started = time.monotonic()
    text = str(query or "").strip()
    if not text:
        raise ExecutionBlocked("empty_query")
    context = context or {}
    if context.get("external_action_kill_switch"):
        # Mirrors require_action_capability's app.state kill switch.
        raise ExecutionBlocked("external_actions_disabled")
    if not _principal_present(context):
        raise ExecutionBlocked("authenticated_principal_required")

    from cortex_server.routers import browser

    egress = browser.browser_egress_state()
    urls = _extract_urls(text)
    if urls:
        _assert_action_policy(context, "/browser/browse")
        result = await _browse(browser, urls, text, egress)
    else:
        _assert_action_policy(context, "/browser/search")
        result = await _search(browser, text, egress, context)
    result["origin"] = "deterministic"
    result["elapsed_ms"] = int((time.monotonic() - started) * 1000)
    return result
