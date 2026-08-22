"""World-grounding helpers for live external-state reasoning.

Focus: detect volatile/freshness-sensitive prompts and attach live evidence
from L2 Ghost search + optional notary packets.
"""
from __future__ import annotations

from typing import Dict, Any, List
from datetime import datetime, timezone
from urllib.parse import urlparse, quote_plus, parse_qs, unquote
import hashlib
import requests
import re
from bs4 import BeautifulSoup


_DDG_LITE_URL = "https://lite.duckduckgo.com/lite/"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bucket(query: str) -> str:
    q = (query or "").lower()
    high = [
        "right now",
        "currently",
        "today",
        "latest",
        "breaking",
        "live",
        "price",
        "stock",
        "weather",
        "outage",
        "score",
        "traffic",
        "election",
    ]
    medium = ["this week", "recent", "new update", "status", "release"]
    if any(k in q for k in high):
        return "high"
    if any(k in q for k in medium):
        return "medium"
    return "low"


def assess_need(query: str) -> Dict[str, Any]:
    q = (query or "").lower()
    reasons: List[str] = []
    triggers = {
        "time_sensitive": any(k in q for k in ["today", "now", "currently", "latest", "breaking", "live"]),
        "market_sensitive": any(k in q for k in ["price", "stock", "rate", "quote", "market cap"]),
        "operational_state": any(k in q for k in ["status", "outage", "incident", "down", "latency"]),
        "event_drift": any(k in q for k in ["score", "weather", "traffic", "results", "election"]),
    }

    for key, hit in triggers.items():
        if hit:
            reasons.append(key)

    required = bool(reasons)
    freshness = _bucket(query)
    stale_after_seconds = 900 if freshness == "high" else 3600 if freshness == "medium" else 21600

    return {
        "required": required,
        "freshness_bucket": freshness,
        "stale_after_seconds": stale_after_seconds,
        "reason_codes": reasons,
        "triggers": triggers,
    }


def _domain(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def _search_web(query: str, timeout_s: float = 3.2) -> List[Dict[str, Any]]:
    # Avoid recursive calls back into /browser/search from within Nexus request handling.
    # Directly query DuckDuckGo lite HTML and parse top links.
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    }
    url = f"{_DDG_LITE_URL}?q={quote_plus(query)}"
    resp = requests.get(url, headers=headers, timeout=timeout_s)
    if resp.status_code != 200:
        raise RuntimeError(f"ddg_lite_http_{resp.status_code}")

    soup = BeautifulSoup(resp.text, "html.parser")
    out: List[Dict[str, Any]] = []

    # DuckDuckGo lite renders a table of result links; include a generic fallback parser.
    links = soup.select("a")
    for a in links:
        href = str(a.get("href") or "").strip()
        title = re.sub(r"\s+", " ", a.get_text(" ", strip=True))

        # DuckDuckGo often wraps outbound links as /l/?uddg=<urlencoded-target>
        if href.startswith("/") and "uddg=" in href:
            try:
                q = parse_qs(urlparse(href).query)
                target = (q.get("uddg") or [""])[0]
                if target:
                    href = unquote(target)
            except Exception:
                pass

        if not href.startswith("http"):
            continue
        if any(x in href for x in ["duckduckgo.com", "startpage.com"]):
            continue
        if len(title) < 4:
            continue
        out.append({"title": title, "url": href, "domain": _domain(href)})
        if len(out) >= 8:
            break

    return out


def _fetch_excerpt(url: str, timeout_s: float = 2.8) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    }
    resp = requests.get(url, headers=headers, timeout=timeout_s)
    if resp.status_code >= 400:
        raise RuntimeError(f"source_http_{resp.status_code}")
    text = resp.text or ""
    # Lightweight HTML cleanup.
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:900]


def _create_local_notary(url: str, claim: str, excerpt: str) -> Dict[str, Any]:
    ts = _now_iso()
    canonical = f"{url}|{claim}|{excerpt[:600]}|{ts}"
    content_hash = hashlib.sha256(excerpt.encode("utf-8", errors="ignore")).hexdigest()
    signature = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return {
        "packet_id": hashlib.sha256(f"{url}|{ts}".encode("utf-8")).hexdigest()[:16],
        "content_hash": content_hash,
        "signature": signature,
        "ts": ts,
        "source": "world_grounding.local_notary.v1",
    }


def gather_live_evidence(
    query: str,
    *,
    max_sources: int = 3,
    notary_packets: int = 1,
    enabled: bool = True,
) -> Dict[str, Any]:
    need = assess_need(query)
    if not enabled or not need.get("required"):
        return {
            "required": bool(need.get("required")),
            "engaged": False,
            "mode": "not_required",
            "as_of": _now_iso(),
            **need,
            "evidence": [],
            "evidence_count": 0,
            "degraded": False,
            "error": None,
        }

    evidence: List[Dict[str, Any]] = []
    degraded = False
    error = None

    try:
        rows = _search_web(query, timeout_s=2.6)
        if not rows:
            raise RuntimeError("empty_search_results")

        limit = max(1, min(int(max_sources), 5))
        for i, row in enumerate(rows[:limit]):
            claim_fingerprint = hashlib.sha256(f"{query}|{row.get('url')}".encode("utf-8")).hexdigest()[:16]
            packet = None
            excerpt = ""
            if i < max(0, min(int(notary_packets), 2)):
                try:
                    excerpt = _fetch_excerpt(row.get("url", ""), timeout_s=2.8)
                    packet = _create_local_notary(row.get("url", ""), query, excerpt)
                except Exception:
                    degraded = True
            evidence.append(
                {
                    "rank": i + 1,
                    "title": row.get("title"),
                    "url": row.get("url"),
                    "domain": row.get("domain"),
                    "claim_fingerprint": claim_fingerprint,
                    "excerpt": excerpt[:240] if excerpt else "",
                    "notary": packet,
                }
            )

    except Exception as exc:
        degraded = True
        error = str(exc)[:240]

    mode = "live_grounded" if evidence else "live_grounding_failed"
    return {
        "required": True,
        "engaged": True,
        "mode": mode,
        "as_of": _now_iso(),
        **need,
        "evidence": evidence,
        "evidence_count": len(evidence),
        "degraded": degraded,
        "error": error,
    }
