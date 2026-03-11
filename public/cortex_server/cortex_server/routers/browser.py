from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import base64
import re
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse
from collections import Counter
import hashlib
import hmac
import json
import asyncio
import time

# Consciousness integration
from cortex_server.modules.consciousness_integration import conscious_action, chain_to

# Simple in-memory cache for L2 Ghost
_cache: Dict[str, Dict[str, Any]] = {}
_cache_lock = asyncio.Lock()

router = APIRouter()


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


async def _goto_resilient(page, url: str, primary_wait: str = "domcontentloaded") -> Dict[str, Any]:
    attempts = [(primary_wait, 14000), ("load", 7000)]
    last_exc: Optional[Exception] = None
    for wait_until, timeout_ms in attempts:
        try:
            await page.goto(url, wait_until=wait_until, timeout=timeout_ms)
            return {"wait_until": wait_until, "timeout_ms": timeout_ms}
        except Exception as exc:
            last_exc = exc
    raise last_exc or RuntimeError("navigation_failed")


async def _fetch_page_text(url: str, ttl_seconds: int = 600) -> Dict[str, Any]:
    cache_key = _cache_key(url, "browse")
    cached = await _get_from_cache(cache_key, ttl_seconds=ttl_seconds)
    if isinstance(cached, str):
        return {"text": cached, "cached": True, "navigation": {"cache": True}}

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1366, "height": 768},
            locale="en-US",
            timezone_id="America/Chicago",
        )
        page = await context.new_page()
        nav_meta = await _goto_resilient(page, url, primary_wait="domcontentloaded")
        await page.wait_for_timeout(1200)
        html = await page.content()
        await context.close()
        await browser.close()

    text = _soup_to_markdown_text(html)
    await _store_in_cache(cache_key, text)
    return {"text": text, "cached": False, "navigation": nav_meta}


async def _search_startpage(query: str, limit: int = 5) -> Dict[str, Any]:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1920, "height": 1080},
            locale="en-US",
            timezone_id="America/New_York",
        )
        page = await context.new_page()
        await page.set_extra_http_headers(
            {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "DNT": "1",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
            }
        )

        search_url = f"https://www.startpage.com/sp/search?q={query.replace(' ', '+')}"
        nav_meta = await _goto_resilient(page, search_url, primary_wait="domcontentloaded")
        await page.wait_for_timeout(1800)
        html = await page.content()
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

        await context.close()
        await browser.close()

    return {"results": results, "navigation": nav_meta}


def _domain_allowed(url: str, allowed_domains: Optional[List[str]]) -> bool:
    if not allowed_domains:
        return True
    host = (urlparse(url).hostname or "").lower()
    for d in allowed_domains:
        d = (d or "").lower().strip()
        if not d:
            continue
        if host == d or host.endswith("." + d):
            return True
    return False


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
            "temporal_web_twin",
            "truth_arbitration",
            "change_radar",
            "evidence_notary",
            "web_action_sandbox",
            "counterfactual_web_sim",
        ],
        "engine": "playwright_chromium",
    }


@router.post("/browse")
async def browser_browse(req: BrowseRequest) -> str:
    async with conscious_action(
        "ghost",
        "browse_url",
        {"type": "knowledge", "data": {"url": req.url, "action": "browse"}},
    ) as ctx:
        try:
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
async def browser_screenshot(req: ScreenshotRequest) -> Dict[str, Any]:
    async with conscious_action(
        "ghost",
        "screenshot_url",
        {"type": "knowledge", "data": {"url": req.url, "full_page": req.full_page}},
    ) as ctx:
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
                page = await browser.new_page()
                nav_meta = await _goto_resilient(page, req.url, primary_wait="load")
                screenshot_bytes = await page.screenshot(full_page=bool(req.full_page), type="png")
                await browser.close()

            encoded = base64.b64encode(screenshot_bytes).decode("utf-8")
            result = {"success": True, "data": {"base64": encoded, "format": "png"}}
            ctx.set_result({"url": req.url, "size_bytes": len(screenshot_bytes), "navigation": nav_meta})
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Screenshot failed: {e}")


@router.post("/search")
async def browser_search(req: SearchRequest) -> List[Dict[str, str]]:
    async with conscious_action(
        "ghost",
        "search_web",
        {"type": "knowledge", "data": {"query": req.query}},
    ) as ctx:
        try:
            out = await _search_startpage(req.query, limit=5)
            results = out["results"]
            ctx.set_result({"query": req.query, "results_count": len(results), "navigation": out.get("navigation", {})})
            return results
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Search failed: {e}")


# 1) Temporal Web Twin --------------------------------------------------------
@router.post("/twin/ingest")
async def temporal_twin_ingest(req: TemporalTwinIngestRequest) -> Dict[str, Any]:
    async with conscious_action("ghost", "temporal_twin_ingest", {"type": "knowledge", "data": req.model_dump()}) as ctx:
        fetched = await _fetch_page_text(req.url, ttl_seconds=60)
        text = fetched["text"]
        claims = _extract_claims(text, max_claims=req.max_claims)
        row = {
            "ts": _now_iso(),
            "url": req.url,
            "topic": req.topic or "",
            "content_hash": hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest(),
            "claims": claims,
            "excerpt": text[:600],
        }
        _append_jsonl(TWIN_PATH, row)
        ctx.set_result({"url": req.url, "claims": len(claims), "hash": row["content_hash"][:12]})
        return {"success": True, "ingested": row}


@router.post("/twin/query")
async def temporal_twin_query(req: TemporalTwinQueryRequest) -> Dict[str, Any]:
    rows = _read_jsonl(TWIN_PATH, limit=8000)
    out = []
    for r in reversed(rows):
        if req.url and r.get("url") != req.url:
            continue
        if req.topic and req.topic.lower() not in str(r.get("topic", "")).lower():
            continue
        out.append(r)
        if len(out) >= max(1, min(req.limit, 200)):
            break
    return {"success": True, "items": out, "count": len(out)}


@router.post("/twin/diff")
async def temporal_twin_diff(req: TemporalTwinQueryRequest) -> Dict[str, Any]:
    rows = _read_jsonl(TWIN_PATH, limit=8000)
    filtered = [r for r in rows if (not req.url or r.get("url") == req.url)]
    if len(filtered) < 2:
        return {"success": False, "error": "not_enough_history"}

    a, b = filtered[-2], filtered[-1]
    a_claims, b_claims = set(a.get("claims") or []), set(b.get("claims") or [])
    added = sorted(list(b_claims - a_claims))[:30]
    removed = sorted(list(a_claims - b_claims))[:30]
    return {
        "success": True,
        "url": b.get("url"),
        "from_ts": a.get("ts"),
        "to_ts": b.get("ts"),
        "added_claims": added,
        "removed_claims": removed,
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
async def radar_watch(req: RadarWatchRequest) -> Dict[str, Any]:
    watch = _read_json(RADAR_PATH, {"items": []})
    items = watch.get("items", [])
    # Upsert by URL
    existing = None
    for it in items:
        if it.get("url") == req.url:
            existing = it
            break
    if existing is None:
        existing = {"url": req.url, "created_at": _now_iso()}
        items.append(existing)

    existing["topic"] = req.topic or ""
    existing["min_change_ratio"] = float(req.min_change_ratio)
    existing.setdefault("last_hash", "")
    existing.setdefault("last_excerpt", "")
    existing["updated_at"] = _now_iso()

    _write_json(RADAR_PATH, {"items": items})
    return {"success": True, "watch_count": len(items), "item": existing}


@router.post("/radar/check")
async def radar_check(req: RadarCheckRequest) -> Dict[str, Any]:
    watch = _read_json(RADAR_PATH, {"items": []})
    items = watch.get("items", [])
    if req.urls:
        items = [x for x in items if x.get("url") in set(req.urls)]

    changes = []
    for it in items:
        url = it.get("url")
        if not url:
            continue
        try:
            fetched = await _fetch_page_text(url, ttl_seconds=30)
            text = fetched["text"]
            new_hash = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()
            old_hash = str(it.get("last_hash", ""))
            old_excerpt = str(it.get("last_excerpt", ""))
            new_excerpt = text[:1200]
            change_ratio = 1.0 - _jaccard(old_excerpt, new_excerpt) if old_excerpt else 1.0
            threshold = float(it.get("min_change_ratio", 0.08))

            changed = (new_hash != old_hash) and (change_ratio >= threshold)
            it["last_hash"] = new_hash
            it["last_excerpt"] = new_excerpt
            it["last_checked_at"] = _now_iso()

            if changed:
                changes.append(
                    {
                        "url": url,
                        "topic": it.get("topic", ""),
                        "change_ratio": round(change_ratio, 4),
                        "checked_at": it["last_checked_at"],
                    }
                )
        except Exception as exc:
            changes.append({"url": url, "error": str(exc)[:180]})

    _write_json(RADAR_PATH, {"items": items})
    return {"success": True, "changes": changes, "checked": len(items)}


# 4) Evidence Notary Packets -------------------------------------------------
def _notary_signature(packet: Dict[str, Any]) -> str:
    secret = (
        __import__("os").environ.get("L2_NOTARY_SECRET")
        or __import__("os").environ.get("OPENROUTER_API_KEY", "")
        or "cortex-notary-default"
    )
    canonical = json.dumps(
        {
            "url": packet.get("url"),
            "content_hash": packet.get("content_hash"),
            "ts": packet.get("ts"),
            "claim": packet.get("claim", ""),
        },
        sort_keys=True,
    )
    return hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()


@router.post("/notary/create")
async def notary_create(req: NotaryRequest) -> Dict[str, Any]:
    fetched = await _fetch_page_text(req.url, ttl_seconds=30)
    text = fetched["text"]
    content_hash = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()
    packet = {
        "packet_id": hashlib.sha256(f"{req.url}|{content_hash}|{time.time()}".encode("utf-8")).hexdigest()[:16],
        "ts": _now_iso(),
        "url": req.url,
        "claim": req.claim or "",
        "content_hash": content_hash,
        "excerpt": text[:700],
        "source_engine": "ghost_playwright",
    }
    packet["signature"] = _notary_signature(packet)

    if req.include_screenshot:
        # add only fingerprint to keep payload manageable
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
            page = await browser.new_page()
            await _goto_resilient(page, req.url, primary_wait="load")
            screenshot_bytes = await page.screenshot(full_page=False, type="png")
            await browser.close()
        packet["screenshot_hash"] = hashlib.sha256(screenshot_bytes).hexdigest()

    _append_jsonl(NOTARY_PATH, packet)
    return {"success": True, "packet": packet}


@router.post("/notary/verify")
async def notary_verify(req: NotaryVerifyRequest) -> Dict[str, Any]:
    packet = dict(req.packet or {})
    supplied = str(packet.get("signature", ""))
    recomputed = _notary_signature(packet)
    return {
        "success": True,
        "valid": bool(supplied) and supplied == recomputed,
        "supplied": supplied,
        "recomputed": recomputed,
    }


# 5) Web Action Sandbox ------------------------------------------------------
@router.post("/sandbox/run")
async def sandbox_run(req: SandboxRunRequest) -> Dict[str, Any]:
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
                out = await _search_startpage(act.query, limit=5)
                result = out["results"]
            elif act.type == "browse":
                fetched = await _fetch_page_text(act.url, ttl_seconds=60)
                result = fetched["text"][:1200]
            else:  # screenshot
                async with async_playwright() as p:
                    browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
                    page = await browser.new_page()
                    await _goto_resilient(page, act.url, primary_wait="load")
                    b = await page.screenshot(full_page=bool(act.full_page), type="png")
                    await browser.close()
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
                    "error": str(exc),
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
