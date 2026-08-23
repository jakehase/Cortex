from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Iterable, Optional
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import base64
import re
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote_plus, urlsplit
from collections import Counter
import hashlib
import hmac
import json
import asyncio
import os
import time

# Consciousness integration
from cortex_server.modules.consciousness_integration import conscious_action, chain_to
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
    require_action_capability,
)
from cortex_server.modules.sensitive_data_redaction import (
    REDACTION_MARKER,
    redact_sensitive_data,
    redact_sensitive_text,
    redact_url_query_value,
)
from cortex_server.outbound_egress import (
    EgressError,
    EgressPolicy,
    EgressPolicyError,
    request as outbound_request,
    validate_destination,
)

# Simple in-memory cache for L2 Ghost
_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = asyncio.Lock()

router = APIRouter()

MAX_BROWSER_DOCUMENT_BYTES = 2_000_000
MAX_BROWSER_SCREENSHOT_BYTES = 8_000_000
MAX_PERSISTED_URL_CHARS = 8_192
NOTARY_SECRET_ENV = "L2_NOTARY_SECRET"
MIN_NOTARY_SECRET_BYTES = 32
_NOTARY_DISALLOWED_CREDENTIAL_ENVS = (
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "CORTEX_ADMIN_TOKEN",
    "CORTEX_CODEC_ADMIN_TOKEN",
    "CORTEX_WRITE_TOKEN",
    "CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN",
    "CORTEX_ACTION_DELEGATION_SECRET",
    "NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY",
    "NEXUS_ASSURANCE_SIGNING_KEY",
)


def configured_notary_secret(
    *,
    required: bool,
    environ: Optional[Dict[str, str]] = None,
    disallowed_candidates: Iterable[str] = (),
) -> Optional[bytes]:
    """Load only the dedicated notary key and reject credential reuse."""

    source = os.environ if environ is None else environ
    value = str(source.get(NOTARY_SECRET_ENV, "") or "")
    if not value:
        if required:
            raise RuntimeError(f"{NOTARY_SECRET_ENV} is required")
        return None
    encoded = value.encode("utf-8")
    if len(encoded) < MIN_NOTARY_SECRET_BYTES:
        raise RuntimeError(
            f"{NOTARY_SECRET_ENV} must contain at least {MIN_NOTARY_SECRET_BYTES} bytes"
        )
    if hmac.compare_digest(value, "cortex-notary-default"):
        raise RuntimeError(f"{NOTARY_SECRET_ENV} must not use the legacy public default")
    for name in _NOTARY_DISALLOWED_CREDENTIAL_ENVS:
        other = str(source.get(name, "") or "")
        if other and hmac.compare_digest(value, other):
            raise RuntimeError(f"{NOTARY_SECRET_ENV} must be a dedicated credential")
    for candidate in disallowed_candidates:
        other = str(candidate or "")
        if other and hmac.compare_digest(value, other):
            raise RuntimeError(f"{NOTARY_SECRET_ENV} must be a dedicated credential")
    return encoded


def _notary_secret_from_request(request: Request) -> bytes:
    value = getattr(request.app.state, "browser_notary_secret", None)
    if not isinstance(value, bytes) or len(value) < MIN_NOTARY_SECRET_BYTES:
        raise HTTPException(status_code=503, detail="browser notary is not configured")
    return value


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _cache_key(url: str, cache_type: str) -> str:
    return hashlib.md5(f"{cache_type}:{url}".encode()).hexdigest()


async def _get_from_cache(key: str, ttl_seconds: int) -> Optional[Any]:
    async with _cache_lock:
        if key in _cache:
            entry = _cache[key]
            if datetime.now() - entry["stored"] < timedelta(seconds=ttl_seconds):
                return entry["data"]
            del _cache[key]
    return None


async def _store_in_cache(key: str, data: Any):
    async with _cache_lock:
        _cache[key] = {"data": data, "stored": datetime.now()}
        # Best-effort memory indexing
        try:
            await chain_to(
                "ghost",
                "librarian/embed",
                {
                    "text": f"Ghost cache entry: {key[:16]}...",
                    "metadata": {"type": "ghost_cache", "key": key, "timestamp": datetime.now().isoformat()},
                },
                timeout=5.0,
            )
        except Exception:
            pass


def _state_path(name: str) -> Path:
    root = Path("/app/config/state")
    try:
        root.mkdir(parents=True, exist_ok=True)
    except Exception:
        root = Path("/tmp")
    return root / name


def _append_jsonl(path: Path, row: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _read_jsonl(path: Path, limit: int = 5000) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    out: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if isinstance(obj, dict):
                    out.append(obj)
            except Exception:
                continue
    if len(out) > limit:
        out = out[-limit:]
    return out


def _read_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, type(default)):
                return data
    except Exception:
        pass
    return default


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _persisted_url(value: str, *, reject_sensitive: bool) -> str:
    """Remove URL credentials before state/attestation retention."""

    raw = str(value or "").strip()
    try:
        without_fragment = urlsplit(raw)._replace(fragment="").geturl()
    except ValueError:
        without_fragment = raw
    safe = redact_sensitive_text(raw, max_chars=MAX_PERSISTED_URL_CHARS)
    safe = redact_url_query_value(safe)
    if reject_sensitive and not hmac.compare_digest(safe, without_fragment):
        raise EgressPolicyError("sensitive URL parameters cannot be persisted")
    return safe


def _text_fingerprint(value: Any) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8", errors="replace")).hexdigest()


def _safe_timestamp(value: Any) -> Optional[str]:
    rendered = str(value or "")
    if not rendered or len(rendered) > 48:
        return None
    try:
        datetime.fromisoformat(rendered.replace("Z", "+00:00"))
    except ValueError:
        return None
    return rendered


def _safe_digest(value: Any) -> Optional[str]:
    rendered = str(value or "").lower()
    return rendered if re.fullmatch(r"[0-9a-f]{64}", rendered) else None


def _sanitize_twin_row(item: Any) -> Dict[str, Any]:
    """Return only non-reversible temporal-twin evidence metadata.

    The conversion also makes legacy rows safe on read: old topic, claim, and
    excerpt strings are fingerprinted in memory and are never echoed.
    """

    if not isinstance(item, dict):
        return {}
    safe: Dict[str, Any] = {}
    timestamp = _safe_timestamp(item.get("ts"))
    if timestamp is not None:
        safe["ts"] = timestamp
    raw_url = str(item.get("url") or "")
    if raw_url:
        safe["url"] = _persisted_url(raw_url, reject_sensitive=False)

    topic_hash = _safe_digest(item.get("topic_hash"))
    raw_topic = str(item.get("topic") or "")
    if raw_topic and raw_topic != REDACTION_MARKER:
        topic_hash = _text_fingerprint(raw_topic)
    safe["topic"] = REDACTION_MARKER if raw_topic or topic_hash else ""
    if topic_hash is not None:
        safe["topic_hash"] = topic_hash

    content_hash = _safe_digest(item.get("content_hash"))
    if content_hash is not None:
        safe["content_hash"] = content_hash

    claim_hashes: List[str] = []
    retained_hashes = item.get("claim_hashes")
    if not isinstance(retained_hashes, (list, tuple)):
        retained_hashes = []
    for value in retained_hashes[:256]:
        digest = _safe_digest(value)
        if digest is not None and digest not in claim_hashes:
            claim_hashes.append(digest)
    legacy_claims = item.get("claims")
    if not isinstance(legacy_claims, (list, tuple)):
        legacy_claims = []
    for value in legacy_claims[:256]:
        raw_claim = str(value or "")
        if raw_claim and raw_claim != REDACTION_MARKER:
            digest = _text_fingerprint(raw_claim)
            if digest not in claim_hashes:
                claim_hashes.append(digest)
    safe["claim_hashes"] = claim_hashes
    safe["claims"] = [REDACTION_MARKER for _digest in claim_hashes]

    excerpt_hash = _safe_digest(item.get("excerpt_hash"))
    raw_excerpt = str(item.get("excerpt") or "")
    if raw_excerpt and raw_excerpt != REDACTION_MARKER:
        excerpt_hash = _text_fingerprint(raw_excerpt)
    safe["excerpt"] = REDACTION_MARKER if raw_excerpt or excerpt_hash else ""
    if excerpt_hash is not None:
        safe["excerpt_hash"] = excerpt_hash
    return safe


def _sanitize_radar_item(item: Any) -> Dict[str, Any]:
    """Reduce a radar row to bounded metadata and non-reversible fingerprints."""

    if not isinstance(item, dict):
        raise EgressPolicyError("invalid retained watch")
    safe_url = _persisted_url(str(item.get("url") or ""), reject_sensitive=True)
    if not safe_url:
        raise EgressPolicyError("watch URL is required")
    safe: Dict[str, Any] = {"url": safe_url}

    for field in ("created_at", "updated_at", "last_checked_at"):
        timestamp = _safe_timestamp(item.get(field))
        if timestamp is not None:
            safe[field] = timestamp

    try:
        ratio = float(item.get("min_change_ratio", 0.08))
    except (TypeError, ValueError):
        ratio = 0.08
    safe["min_change_ratio"] = max(0.0, min(ratio, 1.0))

    last_hash = _safe_digest(item.get("last_hash"))
    safe["last_hash"] = last_hash or ""

    for field in ("topic", "last_excerpt"):
        digest_field = f"{field}_hash"
        existing_digest = _safe_digest(item.get(digest_field))
        raw_value = str(item.get(field) or "")
        if raw_value and raw_value != REDACTION_MARKER:
            existing_digest = _text_fingerprint(raw_value)
        safe[field] = REDACTION_MARKER if raw_value else ""
        if existing_digest is not None:
            safe[digest_field] = existing_digest

    # Old rows may contain raw exception text.  Its contents and all unknown
    # fields are intentionally omitted; only a constrained error class remains.
    error_type = str(item.get("error_type") or "")
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", error_type):
        safe["error_type"] = error_type
    if item.get("error"):
        safe["error"] = REDACTION_MARKER
    return safe


def _sanitize_radar_items(items: Any) -> List[Dict[str, Any]]:
    safe_items: List[Dict[str, Any]] = []
    if not isinstance(items, list):
        return safe_items
    for item in items:
        try:
            safe_items.append(_sanitize_radar_item(item))
        except EgressPolicyError:
            continue
    return safe_items


class BrowseRequest(BaseModel):
    url: str


class ScreenshotRequest(BaseModel):
    url: str
    full_page: Optional[bool] = False


class SearchRequest(BaseModel):
    query: str


class TemporalTwinIngestRequest(BaseModel):
    url: str
    topic: Optional[str] = None
    max_claims: int = 8


class TemporalTwinQueryRequest(BaseModel):
    url: Optional[str] = None
    topic: Optional[str] = None
    limit: int = 30


class TruthClaim(BaseModel):
    claim: str
    source: str
    weight: float = 1.0


class TruthArbitrationRequest(BaseModel):
    claims: List[TruthClaim]
    consensus_threshold: float = 0.6


class RadarWatchRequest(BaseModel):
    url: str
    topic: Optional[str] = None
    min_change_ratio: float = 0.08


class RadarCheckRequest(BaseModel):
    urls: Optional[List[str]] = None


class NotaryRequest(BaseModel):
    url: str
    claim: Optional[str] = None
    include_screenshot: bool = False


class NotaryVerifyRequest(BaseModel):
    packet: Dict[str, Any]


class SandboxAction(BaseModel):
    type: str = Field(description="search|browse|screenshot")
    query: Optional[str] = None
    url: Optional[str] = None
    full_page: Optional[bool] = False


class SandboxRunRequest(BaseModel):
    actions: List[SandboxAction]
    allowed_domains: Optional[List[str]] = None


class CounterfactualRequest(BaseModel):
    base_claim: str
    assumptions: List[str]
    evidence: Optional[List[str]] = None


TWIN_PATH = _state_path("l2_temporal_twin.jsonl")
RADAR_PATH = _state_path("l2_change_radar_watchlist.json")
NOTARY_PATH = _state_path("l2_notary_packets.jsonl")


def _soup_to_markdown_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    lines = [line.strip() for line in text.splitlines()]
    cleaned = "\n".join([line for line in lines if line])
    cleaned = re.sub(r"\n{2,}", "\n\n", cleaned)
    return cleaned.strip()


def _extract_claims(text: str, max_claims: int = 8) -> List[str]:
    raw = re.split(r"(?<=[\.!?])\s+", (text or ""))
    claims = []
    for s in raw:
        s = s.strip()
        if len(s) < 40:
            continue
        if len(s) > 300:
            s = s[:300].rstrip() + "..."
        claims.append(s)
        if len(claims) >= max(1, min(max_claims, 20)):
            break
    return claims


def _token_set(text: str) -> set:
    return {w for w in re.findall(r"[a-zA-Z0-9_]+", (text or "").lower()) if len(w) > 2}


def _jaccard(a: str, b: str) -> float:
    sa, sb = _token_set(a), _token_set(b)
    if not sa and not sb:
        return 1.0
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(1, len(sa | sb))


def _browser_policy() -> EgressPolicy:
    return EgressPolicy.from_environment("browser")


def _domain_allowed(url: str, allowed_domains: Optional[List[str]]) -> bool:
    """Apply an optional caller constraint after the server policy."""

    if not allowed_domains:
        return True
    try:
        host = (urlsplit(url).hostname or "").encode("idna").decode("ascii").lower().rstrip(".")
    except (UnicodeError, ValueError):
        return False
    for value in allowed_domains:
        domain = str(value or "").strip().lower().rstrip(".")
        if domain.startswith("*."):
            domain = domain[2:]
        if not domain or "://" in domain or "/" in domain or ":" in domain:
            continue
        try:
            domain = domain.encode("idna").decode("ascii")
        except UnicodeError:
            continue
        if host == domain or host.endswith(f".{domain}"):
            return True
    return False


async def _validate_browser_destination(
    url: str,
    *,
    policy: Optional[EgressPolicy] = None,
    allowed_domains: Optional[List[str]] = None,
):
    destination = await validate_destination(url, policy or _browser_policy())
    if not _domain_allowed(destination.original_url, allowed_domains):
        raise EgressPolicyError("destination is outside the caller's domain constraint")
    return destination


async def _install_browser_egress_guard(
    context,
    *,
    policy: EgressPolicy,
    allowed_domains: Optional[List[str]] = None,
) -> None:
    """Keep the offline renderer offline, including popups and subresources."""

    async def guard_route(route) -> None:
        # Destination validation and redirect handling occur in the pinned
        # HTTP broker before content reaches Playwright.  Chromium must never
        # perform a second, independently resolved network connection.
        await route.abort("blockedbyclient")

    async def block_websocket(websocket_route) -> None:
        # The browser capability is deliberately HTTP(S)-only.  In-page
        # WebSockets otherwise bypass request routing and DNS policy.
        await websocket_route.close(code=1008, reason="outbound policy")

    await context.route("**/*", guard_route)
    await context.route_web_socket("**/*", block_websocket)


async def _goto_resilient(
    page,
    url: str,
    primary_wait: str = "domcontentloaded",
    *,
    policy: Optional[EgressPolicy] = None,
    allowed_domains: Optional[List[str]] = None,
) -> Dict[str, Any]:
    del page, url, primary_wait, policy, allowed_domains
    raise EgressPolicyError(
        "direct browser network navigation is disabled; use the pinned broker"
    )


def _caller_destination_guard(allowed_domains: Optional[List[str]]):
    if not allowed_domains:
        return None

    def guard(destination) -> None:
        if not _domain_allowed(destination.original_url, allowed_domains):
            raise EgressPolicyError(
                "redirect is outside the caller's domain constraint"
            )

    return guard


async def _fetch_browser_document(
    url: str,
    *,
    policy: Optional[EgressPolicy] = None,
    allowed_domains: Optional[List[str]] = None,
) -> tuple[str, Dict[str, Any]]:
    resolved_policy = policy or _browser_policy()
    await _validate_browser_destination(
        url,
        policy=resolved_policy,
        allowed_domains=allowed_domains,
    )
    response = await outbound_request(
        "GET",
        url,
        policy=resolved_policy,
        headers={
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
            "Accept-Language": "en-US,en;q=0.5",
        },
        timeout=15.0,
        max_response_bytes=MAX_BROWSER_DOCUMENT_BYTES,
        destination_guard=_caller_destination_guard(allowed_domains),
    )
    return response.text, {
        "transport": "pinned_http",
        "status_code": response.status_code,
        "final_url": response.final_url,
    }


async def _fetch_page_text(
    url: str,
    ttl_seconds: int = 600,
    *,
    allowed_domains: Optional[List[str]] = None,
) -> Dict[str, Any]:
    policy = _browser_policy()
    await _validate_browser_destination(
        url,
        policy=policy,
        allowed_domains=allowed_domains,
    )
    cache_key = _cache_key(url, "browse")
    cached = await _get_from_cache(cache_key, ttl_seconds=ttl_seconds)
    if isinstance(cached, str):
        return {"text": cached, "cached": True, "navigation": {"cache": True}}

    html, nav_meta = await _fetch_browser_document(
        url,
        policy=policy,
        allowed_domains=allowed_domains,
    )

    text = _soup_to_markdown_text(html)
    await _store_in_cache(cache_key, text)
    return {"text": text, "cached": False, "navigation": nav_meta}


async def _search_startpage(query: str, limit: int = 5) -> Dict[str, Any]:
    policy = _browser_policy()
    search_url = f"https://www.startpage.com/sp/search?q={quote_plus(query)}"
    html, nav_meta = await _fetch_browser_document(
        search_url,
        policy=policy,
    )
    soup = BeautifulSoup(html, "html.parser")

    results: List[Dict[str, str]] = []
    for container in soup.select(".result"):
        if len(results) >= limit:
            break
        link_el = container.select_one("a.result-title") or container.select_one("h3 a") or container.select_one("a[href^='http']")
        if not link_el:
            continue
        title = link_el.get_text(strip=True)
        href = link_el.get("href")
        if title and href and href.startswith("http") and "startpage.com" not in href:
            results.append({"title": title, "link": href})

    return {"results": results, "navigation": nav_meta}


async def _capture_screenshot(
    url: str,
    *,
    full_page: bool,
    allowed_domains: Optional[List[str]] = None,
) -> tuple[bytes, Dict[str, Any]]:
    policy = _browser_policy()
    html, nav_meta = await _fetch_browser_document(
        url,
        policy=policy,
        allowed_domains=allowed_domains,
    )
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox"],
        )
        context = await browser.new_context(
            java_script_enabled=False,
            service_workers="block",
        )
        try:
            await _install_browser_egress_guard(
                context,
                policy=policy,
                allowed_domains=allowed_domains,
            )
            page = await context.new_page()
            await page.set_content(
                html,
                wait_until="domcontentloaded",
                timeout=10_000,
            )
            screenshot_bytes = await page.screenshot(
                full_page=bool(full_page),
                type="png",
            )
            if len(screenshot_bytes) > MAX_BROWSER_SCREENSHOT_BYTES:
                raise EgressPolicyError("browser screenshot exceeds the byte limit")
            return screenshot_bytes, nav_meta
        finally:
            await context.close()
            await browser.close()


@router.get("/status")
async def browser_status():
    return {
        "success": True,
        "level": 2,
        "name": "Ghost (Browser)",
        "status": "active",
        "capabilities": [
            "web_search",
            "web_browse",
            "screenshot",
            "temporal_cache_ingest",
            "heuristic_truth_arbitration",
            "local_change_radar",
            "evidence_packet_notary",
            "domain_limited_web_action_sandbox",
            "heuristic_counterfactual_simulation",
        ],
        "capability_details": {
            "web_search": "Playwright-backed Startpage retrieval; dependent on upstream page structure and anti-bot behavior.",
            "web_browse": "Playwright page fetch plus BeautifulSoup text extraction with short-lived in-memory cache.",
            "screenshot": "Playwright Chromium screenshot capture.",
            "temporal_cache_ingest": "Local JSONL snapshots and claim extraction; not a complete web archive.",
            "heuristic_truth_arbitration": "Token-similarity clustering over provided claims; not an independent fact verifier.",
            "local_change_radar": "Local watchlist plus repeated fetch/diff; requires scheduled caller to run checks.",
            "evidence_packet_notary": "Hash/signature packet for fetched evidence; does not prove source truthfulness.",
            "domain_limited_web_action_sandbox": "Allows search/browse/screenshot actions constrained by caller-supplied domains.",
            "heuristic_counterfactual_simulation": "Textual assumption comparison using overlap heuristics.",
        },
        "honesty": "Advanced Ghost endpoints are local/heuristic helpers unless the detail explicitly says otherwise.",
        "engine": "playwright_chromium",
    }


@router.post("/browse")
async def browser_browse(
    req: BrowseRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> str:
    async with conscious_action(
        "ghost",
        "browse_url",
        {"type": "knowledge", "data": {"url": req.url, "action": "browse"}},
    ) as ctx:
        try:
            assert_action_authorized(authorization)
            fetched = await _fetch_page_text(req.url, ttl_seconds=600)
            result = fetched["text"]
            ctx.set_result(
                {
                    "url": req.url,
                    "content_length": len(result),
                    "cached": fetched.get("cached", False),
                    "navigation": fetched.get("navigation", {}),
                }
            )
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Browse failed: {e}")


@router.post("/screenshot")
async def browser_screenshot(
    req: ScreenshotRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> Dict[str, Any]:
    async with conscious_action(
        "ghost",
        "screenshot_url",
        {"type": "knowledge", "data": {"url": req.url, "full_page": req.full_page}},
    ) as ctx:
        try:
            assert_action_authorized(authorization)
            screenshot_bytes, nav_meta = await _capture_screenshot(
                req.url,
                full_page=bool(req.full_page),
            )

            encoded = base64.b64encode(screenshot_bytes).decode("utf-8")
            result = {"success": True, "data": {"base64": encoded, "format": "png"}}
            ctx.set_result({"url": req.url, "size_bytes": len(screenshot_bytes), "navigation": nav_meta})
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Screenshot failed: {e}")


@router.post("/search")
async def browser_search(
    req: SearchRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> List[Dict[str, str]]:
    async with conscious_action(
        "ghost",
        "search_web",
        {"type": "knowledge", "data": {"query": req.query}},
    ) as ctx:
        try:
            assert_action_authorized(authorization)
            out = await _search_startpage(req.query, limit=5)
            results = out["results"]
            ctx.set_result({"query": req.query, "results_count": len(results), "navigation": out.get("navigation", {})})
            return results
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Search failed: {e}")


# 1) Temporal Web Twin --------------------------------------------------------
@router.post("/twin/ingest")
async def temporal_twin_ingest(
    req: TemporalTwinIngestRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> Dict[str, Any]:
    persisted_url = _persisted_url(req.url, reject_sensitive=False)
    raw_topic = str(req.topic or "")
    safe_context = {
        "type": "knowledge",
        "data": {
            "url": persisted_url,
            "topic_hash": _text_fingerprint(raw_topic) if raw_topic else None,
            "max_claims": req.max_claims,
        },
    }
    async with conscious_action("ghost", "temporal_twin_ingest", safe_context) as ctx:
        assert_action_authorized(authorization)
        fetched = await _fetch_page_text(req.url, ttl_seconds=60)
        text = fetched["text"]
        claims = _extract_claims(text, max_claims=req.max_claims)
        row = {
            "ts": _now_iso(),
            "url": persisted_url,
            "topic": REDACTION_MARKER if raw_topic else "",
            "topic_hash": _text_fingerprint(raw_topic) if raw_topic else None,
            "content_hash": hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest(),
            "claim_hashes": [_text_fingerprint(claim) for claim in claims],
            "claims": [REDACTION_MARKER for _claim in claims],
            "excerpt": REDACTION_MARKER if text else "",
            "excerpt_hash": _text_fingerprint(text[:600]) if text else None,
        }
        _append_jsonl(TWIN_PATH, row)
        ctx.set_result({"url": row["url"], "claims": len(claims), "hash": row["content_hash"][:12]})
        return {"success": True, "ingested": row}


@router.post("/twin/query")
async def temporal_twin_query(req: TemporalTwinQueryRequest) -> Dict[str, Any]:
    rows = _read_jsonl(TWIN_PATH, limit=8000)
    requested_url = _persisted_url(req.url, reject_sensitive=False) if req.url else None
    requested_topic_hash = _text_fingerprint(req.topic) if req.topic else None
    out = []
    for raw_row in reversed(rows):
        r = _sanitize_twin_row(raw_row)
        if requested_url and r.get("url") != requested_url:
            continue
        if requested_topic_hash and r.get("topic_hash") != requested_topic_hash:
            continue
        out.append(r)
        if len(out) >= max(1, min(req.limit, 200)):
            break
    return {"success": True, "items": out, "count": len(out)}


@router.post("/twin/diff")
async def temporal_twin_diff(req: TemporalTwinQueryRequest) -> Dict[str, Any]:
    rows = [_sanitize_twin_row(row) for row in _read_jsonl(TWIN_PATH, limit=8000)]
    requested_url = _persisted_url(req.url, reject_sensitive=False) if req.url else None
    requested_topic_hash = _text_fingerprint(req.topic) if req.topic else None
    filtered = [
        r
        for r in rows
        if (not requested_url or r.get("url") == requested_url)
        and (not requested_topic_hash or r.get("topic_hash") == requested_topic_hash)
    ]
    if len(filtered) < 2:
        return {"success": False, "error": "not_enough_history"}

    a, b = filtered[-2], filtered[-1]
    a_claims = set(a.get("claim_hashes") or [])
    b_claims = set(b.get("claim_hashes") or [])
    added = sorted(list(b_claims - a_claims))[:30]
    removed = sorted(list(a_claims - b_claims))[:30]
    return {
        "success": True,
        "url": b.get("url"),
        "from_ts": a.get("ts"),
        "to_ts": b.get("ts"),
        "added_claim_hashes": added,
        "removed_claim_hashes": removed,
        "changed": bool(added or removed),
    }


# 2) Multi-Source Truth Arbitration -----------------------------------------
@router.post("/truth/arbitrate")
async def truth_arbitrate(req: TruthArbitrationRequest) -> Dict[str, Any]:
    if not req.claims:
        raise HTTPException(status_code=400, detail="claims required")

    # Cluster by semantic similarity (very light heuristic).
    clusters: List[Dict[str, Any]] = []
    for c in req.claims:
        placed = False
        for cl in clusters:
            sim = _jaccard(c.claim, cl["representative"])
            if sim >= 0.55:
                cl["items"].append(c)
                cl["total_weight"] += float(c.weight or 1.0)
                placed = True
                break
        if not placed:
            clusters.append({"representative": c.claim, "items": [c], "total_weight": float(c.weight or 1.0)})

    total_weight = sum(float(c.weight or 1.0) for c in req.claims) or 1.0
    ranked = sorted(clusters, key=lambda x: x["total_weight"], reverse=True)

    consensus = []
    for cl in ranked:
        score = cl["total_weight"] / total_weight
        consensus.append(
            {
                "claim": cl["representative"],
                "consensus_score": round(score, 4),
                "source_count": len({i.source for i in cl["items"]}),
                "sources": sorted(list({i.source for i in cl["items"]}))[:12],
            }
        )

    majority = [x for x in consensus if x["consensus_score"] >= req.consensus_threshold]
    minority = [x for x in consensus if x["consensus_score"] < req.consensus_threshold][:6]

    return {
        "success": True,
        "consensus": majority,
        "minority_report": minority,
        "uncertainty": round(1.0 - (majority[0]["consensus_score"] if majority else consensus[0]["consensus_score"]), 4),
    }


# 3) Live Change Radar -------------------------------------------------------
@router.post("/radar/watch")
async def radar_watch(
    req: RadarWatchRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> Dict[str, Any]:
    assert_action_authorized(authorization)
    try:
        await _validate_browser_destination(req.url)
    except EgressError as exc:
        raise HTTPException(
            status_code=400,
            detail="watch target is not permitted by the server egress policy",
        ) from exc
    try:
        persisted_url = _persisted_url(req.url, reject_sensitive=True)
    except EgressPolicyError as exc:
        raise HTTPException(
            status_code=400,
            detail="watch target contains sensitive URL parameters",
        ) from exc

    watch = _read_json(RADAR_PATH, {"items": []})
    items = _sanitize_radar_items(watch.get("items", []))
    # Upsert by URL
    existing = None
    for it in items:
        if it.get("url") == persisted_url:
            existing = it
            break
    if existing is None:
        existing = {"url": persisted_url, "created_at": _now_iso()}
        items.append(existing)

    raw_topic = str(req.topic or "")
    existing["topic"] = REDACTION_MARKER if raw_topic else ""
    if raw_topic:
        existing["topic_hash"] = _text_fingerprint(raw_topic)
    else:
        existing.pop("topic_hash", None)
    existing["min_change_ratio"] = float(req.min_change_ratio)
    existing.setdefault("last_hash", "")
    existing.setdefault("last_excerpt", "")
    existing["updated_at"] = _now_iso()

    items = _sanitize_radar_items(items)
    _write_json(RADAR_PATH, {"items": items})
    return {"success": True, "watch_count": len(items), "item": existing}


@router.post("/radar/check")
async def radar_check(
    req: RadarCheckRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> Dict[str, Any]:
    watch = _read_json(RADAR_PATH, {"items": []})
    all_items = _sanitize_radar_items(watch.get("items", []))
    items = all_items
    if req.urls:
        requested_urls = {
            _persisted_url(url, reject_sensitive=False) for url in req.urls
        }
        items = [x for x in all_items if x.get("url") in requested_urls]

    changes = []
    removed_sensitive_items: set[int] = set()
    for it in items:
        url = it.get("url")
        if not url:
            continue
        try:
            safe_url = _persisted_url(url, reject_sensitive=True)
            it["url"] = safe_url
            assert_action_authorized(authorization)
            fetched = await _fetch_page_text(safe_url, ttl_seconds=30)
            text = fetched["text"]
            new_hash = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()
            old_hash = str(it.get("last_hash", ""))
            new_excerpt = text[:1200]
            # Durable state keeps only fingerprints.  Without raw old content,
            # exact equality is the only defensible change metric.
            change_ratio = 0.0 if old_hash and hmac.compare_digest(old_hash, new_hash) else 1.0
            threshold = float(it.get("min_change_ratio", 0.08))

            changed = (new_hash != old_hash) and (change_ratio >= threshold)
            it["last_hash"] = new_hash
            it["last_excerpt"] = REDACTION_MARKER if new_excerpt else ""
            if new_excerpt:
                it["last_excerpt_hash"] = _text_fingerprint(new_excerpt)
            it["last_checked_at"] = _now_iso()

            if changed:
                changes.append(
                    {
                        "url": safe_url,
                        "topic": it.get("topic", ""),
                        "change_ratio": round(change_ratio, 4),
                        "checked_at": it["last_checked_at"],
                    }
                )
        except EgressPolicyError:
            removed_sensitive_items.add(id(it))
            changes.append({"error": "watch removed because its URL cannot be retained safely"})
        except Exception as exc:
            changes.append(
                {
                    "url_hash": _text_fingerprint(url),
                    "error": "watch_check_failed",
                    "error_type": type(exc).__name__,
                }
            )

    retained_items = [item for item in all_items if id(item) not in removed_sensitive_items]
    retained_items = _sanitize_radar_items(retained_items)
    _write_json(RADAR_PATH, {"items": retained_items})
    return {"success": True, "changes": changes, "checked": len(items)}


# 4) Evidence Notary Packets -------------------------------------------------
def _notary_signature(packet: Dict[str, Any], secret: bytes) -> str:
    """Sign the complete attestation body with an explicit dedicated key."""

    canonical = json.dumps(
        {key: value for key, value in packet.items() if key != "signature"},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hmac.new(secret, canonical.encode("utf-8"), hashlib.sha256).hexdigest()


@router.post("/notary/create")
async def notary_create(
    req: NotaryRequest,
    request: Request,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> Dict[str, Any]:
    secret = _notary_secret_from_request(request)
    assert_action_authorized(authorization)
    fetched = await _fetch_page_text(req.url, ttl_seconds=30)
    text = fetched["text"]
    content_hash = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()
    raw_claim = str(req.claim or "")
    packet = redact_sensitive_data({
        "packet_id": hashlib.sha256(f"{req.url}|{content_hash}|{time.time()}".encode("utf-8")).hexdigest()[:16],
        "ts": _now_iso(),
        "url": REDACTION_MARKER,
        "url_hash": _text_fingerprint(req.url),
        "claim": REDACTION_MARKER if raw_claim else "",
        "claim_hash": _text_fingerprint(raw_claim) if raw_claim else None,
        "claim_present": bool(raw_claim),
        "content_hash": content_hash,
        "excerpt": REDACTION_MARKER if text else "",
        "excerpt_hash": _text_fingerprint(text[:700]) if text else None,
        "excerpt_chars": min(len(text), 700),
        "source_engine": "ghost_pinned_http",
    },
        max_string_chars=2_048,
        allowed_fields={
            "packet_id",
            "ts",
            "url",
            "url_hash",
            "claim",
            "claim_hash",
            "claim_present",
            "content_hash",
            "excerpt",
            "excerpt_hash",
            "excerpt_chars",
            "source_engine",
        },
    )
    if req.include_screenshot:
        # add only fingerprint to keep payload manageable
        assert_action_authorized(authorization)
        screenshot_bytes, _navigation = await _capture_screenshot(
            req.url,
            full_page=False,
        )
        packet["screenshot_hash"] = hashlib.sha256(screenshot_bytes).hexdigest()

    packet["signature"] = _notary_signature(packet, secret)
    _append_jsonl(NOTARY_PATH, packet)
    return {"success": True, "packet": packet}


@router.post("/notary/verify")
async def notary_verify(
    req: NotaryVerifyRequest,
    request: Request,
) -> Dict[str, Any]:
    secret = _notary_secret_from_request(request)
    packet = dict(req.packet or {})
    supplied = str(packet.get("signature", ""))
    recomputed = _notary_signature(packet, secret)
    supplied_is_digest = bool(re.fullmatch(r"[0-9a-f]{64}", supplied))
    candidate = supplied if supplied_is_digest else ("0" * 64)
    signature_matches = hmac.compare_digest(candidate, recomputed)
    return {
        "success": True,
        "valid": supplied_is_digest and signature_matches,
    }


# 5) Web Action Sandbox ------------------------------------------------------
@router.post("/sandbox/run")
async def sandbox_run(
    req: SandboxRunRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> Dict[str, Any]:
    traces: List[Dict[str, Any]] = []
    for idx, act in enumerate(req.actions):
        t0 = time.time()
        try:
            if act.type not in {"search", "browse", "screenshot"}:
                raise HTTPException(status_code=400, detail=f"unsupported action type: {act.type}")

            if act.type in {"browse", "screenshot"}:
                if not act.url:
                    raise HTTPException(status_code=400, detail="url required for browse/screenshot")
                if not _domain_allowed(act.url, req.allowed_domains):
                    raise HTTPException(status_code=403, detail=f"domain not allowed: {act.url}")

            if act.type == "search":
                if not act.query:
                    raise HTTPException(status_code=400, detail="query required for search")
                assert_action_authorized(authorization)
                out = await _search_startpage(act.query, limit=5)
                result = redact_sensitive_data(out["results"], max_string_chars=1_200)
            elif act.type == "browse":
                assert_action_authorized(authorization)
                fetched = await _fetch_page_text(
                    act.url,
                    ttl_seconds=60,
                    allowed_domains=req.allowed_domains,
                )
                result = redact_sensitive_text(fetched["text"], max_chars=1_200)
            else:  # screenshot
                assert_action_authorized(authorization)
                b, _navigation = await _capture_screenshot(
                    act.url,
                    full_page=bool(act.full_page),
                    allowed_domains=req.allowed_domains,
                )
                result = {"screenshot_hash": hashlib.sha256(b).hexdigest(), "size_bytes": len(b)}

            traces.append(
                {
                    "step": idx + 1,
                    "type": act.type,
                    "ok": True,
                    "duration_ms": int((time.time() - t0) * 1000),
                    "result": result,
                }
            )
        except Exception as exc:
            traces.append(
                {
                    "step": idx + 1,
                    "type": act.type,
                    "ok": False,
                    "duration_ms": int((time.time() - t0) * 1000),
                    "error": redact_sensitive_text(exc, max_chars=300),
                }
            )

    return {"success": True, "trace": traces, "steps": len(traces)}


# 6) Counterfactual Web Simulator -------------------------------------------
@router.post("/simulate/counterfactual")
async def simulate_counterfactual(req: CounterfactualRequest) -> Dict[str, Any]:
    base_tokens = _token_set(req.base_claim)
    evidence = req.evidence or []

    scenarios = []
    for i, a in enumerate(req.assumptions):
        # simple perturbation model: stronger evidence overlap -> higher plausibility.
        ev_overlap = 0.0
        if evidence:
            sims = [_jaccard(a, ev) for ev in evidence]
            ev_overlap = sum(sims) / max(1, len(sims))

        score = max(0.0, min(1.0, 0.35 + 0.45 * ev_overlap + (0.1 if len(_token_set(a) & base_tokens) > 0 else 0.0)))
        scenarios.append(
            {
                "scenario_id": f"cf-{i+1}",
                "assumption": a,
                "predicted_effect": f"If '{a}', expected outcome shifts relative to base claim.",
                "plausibility": round(score, 4),
                "confidence_band": "high" if score >= 0.75 else ("medium" if score >= 0.5 else "low"),
            }
        )

    scenarios = sorted(scenarios, key=lambda x: x["plausibility"], reverse=True)
    return {
        "success": True,
        "base_claim": req.base_claim,
        "scenarios": scenarios,
        "top_scenario": scenarios[0] if scenarios else None,
    }
