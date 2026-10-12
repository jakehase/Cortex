from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field
from typing import List, Dict, Optional, Any
import httpx
from bs4 import BeautifulSoup
import asyncio
import ipaddress
import socket
import json
import threading
import time
import inspect
import logging
import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

from cortex_server.modules.consciousness_integration import chain_to
from cortex_server.modules.action_capabilities import require_action_capability
from cortex_server.models.requests import ParsePythonRequest, ParsePDFRequest, ParseJavaScriptRequest, ParseDirectoryRequest
from cortex_server.outbound_egress import EgressPolicy, EgressPolicyError
from cortex_server.services.parser_service import ParserService
from cortex_server.modules.level_route_status import capability_report
from cortex_server.modules.health_status import (
    DEGRADED,
    DISABLED_BY_DESIGN,
    OPERATIONAL,
    RESTRICTED_BY_DESIGN,
    UNTESTED,
    aggregate_status,
    is_failure,
    vocabulary_payload,
)

MAX_DOWNLOAD_BYTES = 2_000_000
MAX_EXTRACT_REQUEST_BYTES = 2_000_000
MAX_EXTRACT_URL_LENGTH = 8_192
MAX_EXTRACT_RESPONSE_BYTES = 2_000_000
# JSON escaping can expand otherwise valid 2 MB source fields substantially.
MAX_PARSER_REQUEST_BYTES = 16_000_000
MAX_EXTRACT_SECONDS = 10.0
MAX_DNS_WORKERS = 4
MAX_HTML_WORKERS = 4
MAX_HTML_ADMISSIONS = 8
MAX_AUTO_INDEX_ADMISSIONS = 4

logger = logging.getLogger(__name__)

_dns_slots = threading.BoundedSemaphore(MAX_DNS_WORKERS)
_dns_tasks = set()
_html_worker_slots = threading.BoundedSemaphore(MAX_HTML_WORKERS)
_html_admissions = threading.BoundedSemaphore(MAX_HTML_ADMISSIONS)
_html_tasks = set()
_auto_index_admissions = threading.BoundedSemaphore(MAX_AUTO_INDEX_ADMISSIONS)


class _ExtractPolicyError(ValueError):
    """The requested extraction violates an input or egress policy."""


class _ExtractCapacityError(RuntimeError):
    """Extraction cannot be admitted with the currently available capacity."""


class _ExtractUpstreamError(RuntimeError):
    """The requested upstream resource could not provide usable content."""


def _track_dns_task(task: asyncio.Task) -> asyncio.Task:
    _dns_tasks.add(task)

    def finished(done: asyncio.Task) -> None:
        _dns_tasks.discard(done)
        if not done.cancelled():
            done.exception()

    task.add_done_callback(finished)
    return task


async def _run_html_worker(function, *args, deadline: float):
    """Run bounded CPU parsing while retaining timed-out executor work."""
    if not _html_admissions.acquire(blocking=False):
        raise _ExtractCapacityError("HTML parsing capacity exhausted")
    worker = None
    acquired_worker = False
    try:
        # A short cooperative poll keeps this limiter usable across application
        # event loops while making the absolute request deadline authoritative.
        while not _html_worker_slots.acquire(blocking=False):
            if time.monotonic() >= deadline:
                raise asyncio.TimeoutError
            await asyncio.sleep(min(0.01, max(0.0, deadline - time.monotonic())))
        acquired_worker = True
        worker = asyncio.create_task(asyncio.to_thread(function, *args))
        _html_tasks.add(worker)

        def finished(done: asyncio.Task) -> None:
            _html_tasks.discard(done)
            _html_worker_slots.release()
            _html_admissions.release()
            if not done.cancelled():
                done.exception()

        worker.add_done_callback(finished)
        # Shielding prevents request timeout/cancellation from losing the only
        # asyncio Task that observes the still-running executor future.
        return await asyncio.wait_for(
            asyncio.shield(worker), max(0.0, deadline - time.monotonic())
        )
    except BaseException:
        if worker is None:
            if acquired_worker:
                _html_worker_slots.release()
            _html_admissions.release()
        raise


def _limited_receive(receive, max_bytes: int):
    """Bound an ASGI request stream before a framework body decoder sees it."""
    received = 0

    async def limited():
        nonlocal received
        message = await receive()
        if message["type"] == "http.request":
            received += len(message.get("body", b""))
            if received > max_bytes:
                raise HTTPException(status_code=413, detail="Request body too large")
        return message

    return limited


class _BodyLimitedRoute(APIRoute):
    async def handle(self, scope, receive, send):
        if scope.get("method") == "POST":
            receive = _limited_receive(receive, MAX_PARSER_REQUEST_BYTES)
        await super().handle(scope, receive, send)


router = APIRouter(route_class=_BodyLimitedRoute)
_ACTION_DEPENDENCIES = [Depends(require_action_capability)]
def get_parser_service(request: Request) -> ParserService:
    """Resolve the immutable parser policy owned by this FastAPI app."""
    return request.app.state.parser_service

_parse_count = {"python": 0, "pdf": 0, "javascript": 0, "directory": 0, "html": 0, "inline": 0}

async def _auto_index(content_type: str, summary: str, metadata: dict):
    """Embed real extracted content (only reached when the caller set persist)."""
    await chain_to("parser", "librarian/embed", {
        "text": f"L3 Parser {content_type}: {summary}",
        "metadata": {"type": "parsed", "parser": content_type, **metadata}
    }, timeout=5.0)


def _index_text_for_document(result: Dict[str, Any]) -> str:
    """Bounded text that actually carries the extracted content."""
    parts = []
    if result.get("title"):
        parts.append(f"Title: {result['title']}")
    headings = [h.get("text") for h in (result.get("headings") or [])[:10] if h.get("text")]
    if headings:
        parts.append("Headings: " + " | ".join(headings))
    text = str(result.get("text") or "")
    if text:
        parts.append(text[:1500])
    return "\n".join(parts)[:2000]


async def _best_effort_auto_index(content_type: str, summary: str, metadata: dict, *, deadline: float) -> None:
    """Observe indexing inline, bounded by capacity and the request deadline."""
    if not _auto_index_admissions.acquire(blocking=False):
        logger.warning("HTML auto-indexing skipped: capacity exhausted")
        return
    try:
        await asyncio.wait_for(
            _auto_index(content_type, summary, metadata),
            timeout=max(0.0, deadline - time.monotonic()),
        )
    except asyncio.TimeoutError:
        logger.warning("HTML auto-indexing failed: request deadline exceeded")
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.error("HTML auto-indexing failed (%s)", type(exc).__name__)
    finally:
        _auto_index_admissions.release()

class ExtractRequest(BaseModel):
    url: Optional[str] = Field(default=None, max_length=MAX_EXTRACT_URL_LENGTH)
    html: Optional[str] = Field(default=None, max_length=2_000_000)
    extract_links: bool = True
    extract_text: bool = True
    extract_meta: bool = True
    extract_headings: bool = True
    # Memory indexing is opt-in; the default extraction has no side effects.
    persist: bool = False

    class Config:
        extra = "forbid"

@dataclass(frozen=True)
class _PinnedURL:
    url: str
    host_header: str
    sni_hostname: str

def _extract_document(
    html: str,
    base_url: Optional[str],
    request: ExtractRequest,
    deadline: Optional[float] = None,
) -> Dict[str, Any]:
    def checkpoint() -> None:
        if deadline is not None and time.monotonic() >= deadline:
            raise asyncio.TimeoutError

    checkpoint()
    soup = BeautifulSoup(html, "html.parser")
    checkpoint()

    def bounded_text(tag, limit: int) -> str:
        parts = []
        length = 0
        for value in tag.stripped_strings:
            checkpoint()
            remaining = limit - length
            if remaining <= 0:
                break
            if parts:
                parts.append(" ")
                length += 1
                remaining -= 1
            if remaining > 0:
                part = str(value)[:remaining]
                parts.append(part)
                length += len(part)
        return "".join(parts)

    title_tag = None
    for tag in soup.descendants:
        checkpoint()
        if getattr(tag, "name", None) == "title":
            title_tag = tag
            break
    title = bounded_text(title_tag, 1000) if title_tag else None
    result: Dict[str, Any] = {"success": True, "title": title, "url": base_url}
    if request.extract_text:
        result["text"] = ""
    if request.extract_links:
        result["links"] = []
    if request.extract_meta:
        result["meta"] = {}
    if request.extract_headings:
        result["headings"] = []

    def json_size(value: Any) -> int:
        return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    response_size = json_size(result)

    if request.extract_text:
        text = bounded_text(soup, MAX_DOWNLOAD_BYTES)
        added = json_size(text) - 2  # Replace the serialized empty string.
        if response_size + added <= MAX_EXTRACT_RESPONSE_BYTES:
            result["text"] = text
            response_size += added
    if request.extract_links:
        retained = result["links"]
        seen = 0
        for tag in soup.descendants:
            checkpoint()
            if getattr(tag, "name", None) != "a" or not tag.has_attr("href"):
                continue
            seen += 1
            if seen > 1000:
                break
            # Once even the unexpanded href cannot fit, avoid creating a much
            # larger base-url expansion merely to discard it.
            href = tag.get("href")
            if not isinstance(href, str) or len(href.encode("utf-8")) >= MAX_EXTRACT_RESPONSE_BYTES:
                continue
            link = urljoin(base_url or "", href)
            if urlsplit(link).scheme not in {"http", "https"}:
                continue
            added = json_size(link) + (1 if retained else 0)
            if response_size + added <= MAX_EXTRACT_RESPONSE_BYTES:
                retained.append(link)
                response_size += added
            else:
                break
    if request.extract_meta:
        retained = result["meta"]
        seen = 0
        for tag in soup.descendants:
            checkpoint()
            if getattr(tag, "name", None) != "meta":
                continue
            seen += 1
            if seen > 200:
                break
            key = tag.get("name") or tag.get("property")
            if not key:
                continue
            value = tag.get("content", "")[:4000]
            if key in retained:
                added = json_size(value) - json_size(retained[key])
            else:
                added = json_size(key) + 1 + json_size(value) + (1 if retained else 0)
            if response_size + added <= MAX_EXTRACT_RESPONSE_BYTES:
                retained[key] = value
                response_size += added
            else:
                break
    if request.extract_headings:
        retained = result["headings"]
        seen = 0
        for tag in soup.descendants:
            checkpoint()
            if getattr(tag, "name", None) not in {"h1", "h2", "h3", "h4", "h5", "h6"}:
                continue
            seen += 1
            if seen > 500:
                break
            heading = {"level": int(tag.name[1]), "text": bounded_text(tag, 1000)}
            added = json_size(heading) + (1 if retained else 0)
            if response_size + added <= MAX_EXTRACT_RESPONSE_BYTES:
                retained.append(heading)
                response_size += added
            else:
                break
    return result

async def _public_http_url(value: str, *, deadline: Optional[float] = None) -> _PinnedURL:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise _ExtractPolicyError("Invalid HTTP(S) URL") from exc
    if parsed.scheme not in {"http", "https"} or not hostname or parsed.username or parsed.password:
        raise _ExtractPolicyError("Only public HTTP(S) URLs without credentials are allowed")
    try:
        policy = EgressPolicy.from_environment("parser")
        hostname_allowed = policy.permits_hostname(hostname)
    except EgressPolicyError as exc:
        raise _ExtractPolicyError("Parser egress policy is invalid") from exc
    if not hostname_allowed:
        raise _ExtractPolicyError("URL hostname is not server-authorized")
    if deadline is None:
        deadline = time.monotonic() + MAX_EXTRACT_SECONDS
    if not _dns_slots.acquire(blocking=False):
        raise _ExtractCapacityError("DNS resolution capacity exhausted")

    def resolve():
        try:
            return socket.getaddrinfo(
                hostname,
                port or (443 if parsed.scheme == "https" else 80),
                0,
                socket.SOCK_STREAM,
            )
        finally:
            _dns_slots.release()

    task = _track_dns_task(asyncio.create_task(asyncio.to_thread(resolve)))
    try:
        answers = await asyncio.wait_for(
            asyncio.shield(task), max(0.0, deadline - time.monotonic())
        )
    except asyncio.TimeoutError:
        raise
    except OSError as exc:
        raise _ExtractUpstreamError("URL host could not be resolved") from exc
    if not answers:
        raise _ExtractUpstreamError("URL host could not be resolved")
    for answer in answers:
        address = ipaddress.ip_address(answer[4][0].split("%", 1)[0])
        if not address.is_global:
            raise _ExtractPolicyError("URL resolves to a non-public address")
    address = ipaddress.ip_address(answers[0][4][0].split("%", 1)[0])
    literal = f"[{address}]" if address.version == 6 else str(address)
    netloc = f"{literal}:{port}" if port is not None else literal
    host = f"[{hostname}]" if ":" in hostname else hostname
    default_port = 443 if parsed.scheme == "https" else 80
    host_header = f"{host}:{port}" if port is not None and port != default_port else host
    return _PinnedURL(parsed._replace(netloc=netloc).geturl(), host_header, hostname)

async def _fetch_html(value: str, *, deadline: Optional[float] = None) -> str:
    if deadline is None:
        deadline = time.monotonic() + MAX_EXTRACT_SECONDS
    current = value
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0), follow_redirects=False, trust_env=False) as client:
        for _ in range(6):
            if time.monotonic() >= deadline:
                raise asyncio.TimeoutError
            if "deadline" in inspect.signature(_public_http_url).parameters:
                pinned = await _public_http_url(current, deadline=deadline)
            else:
                pinned = await _public_http_url(current)
            # Tests and embedders may provide a compatible validator returning a
            # string; production resolution always returns a pinned destination.
            target = pinned.url if isinstance(pinned, _PinnedURL) else pinned
            headers = {"Accept": "text/html"}
            extensions = None
            if isinstance(pinned, _PinnedURL):
                headers["Host"] = pinned.host_header
                extensions = {"sni_hostname": pinned.sni_hostname.encode("idna")}
            # httpx timeouts apply to individual socket operations.  Keep the
            # request's absolute deadline authoritative across a slow-drip
            # response whose chunks each arrive inside that per-read timeout.
            async with asyncio.timeout(max(0.0, deadline - time.monotonic())):
                async with client.stream("GET", target, headers=headers, extensions=extensions) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise _ExtractUpstreamError("Invalid redirect")
                        current = urljoin(current, location)
                        continue
                    response.raise_for_status()
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(content) + len(chunk) > MAX_DOWNLOAD_BYTES:
                            raise _ExtractPolicyError("Remote content exceeds byte limit")
                        content.extend(chunk)
                    return bytes(content).decode(response.encoding or "utf-8", errors="replace")
        raise _ExtractUpstreamError("Too many redirects")

_STATUS_CAPABILITIES = {
    "inline_parse": [("POST", "/parse")],
    "html_extraction": [("POST", "/extract")],
    "python_parse_persist": [("POST", "/python")],
    "javascript_parse_persist": [("POST", "/javascript")],
    "pdf_parse_persist": [("POST", "/pdf")],
    "directory_index": [("POST", "/directory"), ("POST", "/index-codebase")],
}


@router.get("/status")
async def status(request: Request = None):
    """Report only mounted parser routes and the parser backends really present."""
    service = getattr(getattr(getattr(request, "app", None), "state", None), "parser_service", None)
    backends: Dict[str, Any] = {
        "service": OPERATIONAL if service is not None else DEGRADED,
        "python": "python_ast",
        "html": "beautifulsoup",
    }
    if service is not None:
        backends["javascript_inline"] = service.js_backend()
        pdf_status = service.pdf_backend_status()
    else:
        backends["javascript_inline"] = "unknown"
        pdf_status = {
            "status": DEGRADED,
            "available": False,
            "backend": None,
            "reason": "parser_service_unavailable",
        }
    backends["pdf_available"] = pdf_status["available"]
    backends["pdf"] = pdf_status
    extra_unavailable = None
    if pdf_status["status"] in {DEGRADED, DISABLED_BY_DESIGN}:
        extra_unavailable = {
            "pdf_parse_persist": str(pdf_status.get("reason") or pdf_status["status"])
        }
    report = capability_report(
        request,
        "/parsers",
        _STATUS_CAPABILITIES,
        extra_unavailable=extra_unavailable,
    )
    usable = bool(report["capabilities"])
    parser_status = OPERATIONAL if usable else UNTESTED
    if service is None:
        parser_status = DEGRADED
    load_report = getattr(
        getattr(getattr(request, "app", None), "state", None),
        "router_load_report",
        {},
    )
    safe_partial = {
        str(row.get("router") if isinstance(row, dict) else row)
        for row in (load_report.get("safeModePartial") or [])
    } if isinstance(load_report, dict) else set()
    if "parsers" in safe_partial:
        parser_status = aggregate_status([parser_status, RESTRICTED_BY_DESIGN])
    pdf_route_mounted = "POST /parsers/pdf" in report["mounted_routes"]
    if pdf_route_mounted:
        parser_status = aggregate_status([parser_status, pdf_status["status"]])
    return {
        "success": not is_failure(parser_status),
        "level": 3,
        "name": "Parser",
        "status": parser_status,
        "status_vocabulary": vocabulary_payload(),
        "capabilities": report["capabilities"],
        "unavailable": report["unavailable"],
        "mounted_routes": report["mounted_routes"],
        "backends": backends,
        "parse_counts": dict(_parse_count),
        "persistence_default": "none (inline /parse never writes; /python, /javascript, /pdf, /directory commit to the graph and need an action capability)",
    }

# ---------------------------------------------------------------------------
# Inline, side-effect-free parsing (safe-mode subset candidate)
# ---------------------------------------------------------------------------

MAX_INLINE_PARSE_CHARS = 1_000_000
_INLINE_LANGUAGES = ("auto", "python", "javascript", "typescript", "html", "json", "markdown", "text")
_JS_MARKERS = re.compile(
    r"(^|\n)\s*(import\s+[^\n]+\s+from\s+['\"]|export\s+(default\s+)?(function|class|const)|const\s+\w+\s*=|let\s+\w+\s*=|function\s+\w+\s*\()|\)\s*=>"
)
_URL_RE = re.compile(r"https?://[^\s<>()\[\]\"']+")


class InlineParseRequest(BaseModel):
    """Parse content supplied in the request body. No file paths, no persistence."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(..., min_length=1, max_length=MAX_INLINE_PARSE_CHARS)
    language: str = Field(default="auto", max_length=32)
    include_graph: bool = False


def _detect_language(content: str) -> str:
    stripped = content.lstrip()
    if stripped.startswith(("{", "[")):
        try:
            json.loads(content)
            return "json"
        except (ValueError, RecursionError):
            pass
    if stripped.startswith("<") and re.search(r"<(html|head|body|div|p|a|h[1-6]|title|span|table|ul|ol|!doctype)\b", stripped[:4000], re.I):
        return "html"
    try:
        compile(content, "<input>", "exec", flags=0x400, dont_inherit=True)  # ast.PyCF_ONLY_AST
        looks_like_prose = not re.search(r"^\s*(def |class |import |from |@|if |for |while |return |\w+\s*=)", content, re.M)
        if not looks_like_prose:
            return "python"
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        pass
    if _JS_MARKERS.search(content):
        return "javascript"
    if re.search(r"^#{1,6}\s+\S", content, re.M) or "```" in content:
        return "markdown"
    return "text"


def _text_structure(content: str, *, markdown: bool) -> Dict[str, Any]:
    lines = content.splitlines()
    headings: List[Dict[str, Any]] = []
    code_blocks: List[Dict[str, Any]] = []
    in_code = None
    list_items = 0
    for number, line in enumerate(lines, start=1):
        fence = re.match(r"^\s*```\s*([\w+-]*)", line)
        if fence:
            if in_code is None:
                in_code = {"language": fence.group(1) or None, "line": number, "lines": 0}
            else:
                code_blocks.append(in_code)
                in_code = None
            continue
        if in_code is not None:
            in_code["lines"] += 1
            continue
        heading = re.match(r"^(#{1,6})\s+(.+?)\s*#*\s*$", line) if markdown else None
        if heading and len(headings) < 200:
            headings.append({"level": len(heading.group(1)), "text": heading.group(2)[:300], "line": number})
        if re.match(r"^\s*([-*+]|\d+[.)])\s+\S", line):
            list_items += 1
    if in_code is not None:
        in_code["unterminated"] = True
        code_blocks.append(in_code)
    paragraphs = [block for block in re.split(r"\n\s*\n", content) if block.strip()]
    links = []
    for match in _URL_RE.finditer(content):
        if len(links) >= 200:
            break
        links.append(match.group(0).rstrip(".,;:"))
    words = re.findall(r"\S+", content)
    return {
        "lines": len(lines),
        "words": len(words),
        "characters": len(content),
        "paragraphs": len(paragraphs),
        "headings": headings,
        "code_blocks": code_blocks[:100],
        "list_items": list_items,
        "links": links,
    }


def _json_structure(content: str) -> Dict[str, Any]:
    try:
        value = json.loads(content)
    except json.JSONDecodeError as exc:
        return {"valid": False, "error": {"message": exc.msg, "line": exc.lineno, "col": exc.colno}}
    except RecursionError:
        return {"valid": False, "error": {"message": "nesting too deep", "line": None, "col": None}}

    def depth(node: Any, level: int = 1) -> int:
        if level > 200:
            return level
        if isinstance(node, dict) and node:
            return max(depth(v, level + 1) for v in node.values())
        if isinstance(node, list) and node:
            return max(depth(v, level + 1) for v in node)
        return level

    summary: Dict[str, Any] = {"valid": True, "top_level_type": type(value).__name__, "max_depth": depth(value)}
    if isinstance(value, dict):
        summary["key_count"] = len(value)
        summary["keys"] = [
            {"key": str(k)[:200], "type": type(v).__name__} for k, v in list(value.items())[:100]
        ]
    elif isinstance(value, list):
        summary["length"] = len(value)
        summary["item_types"] = sorted({type(v).__name__ for v in value[:1000]})
    return summary


@router.post("/parse")
async def parse_inline(request: InlineParseRequest, http_request: Request = None):
    """Parse pasted code/HTML/JSON/text. Pure computation: no file reads, no graph or memory writes."""
    _parse_count["inline"] += 1
    language = (request.language or "auto").strip().lower()
    aliases = {"py": "python", "js": "javascript", "jsx": "javascript", "ts": "typescript",
               "tsx": "typescript", "md": "markdown", "htm": "html", "txt": "text", "plain": "text"}
    language = aliases.get(language, language)
    if language not in _INLINE_LANGUAGES:
        return JSONResponse(status_code=422, content={"success": False, "error": "Unsupported language", "supported": list(_INLINE_LANGUAGES)})
    detected = language == "auto"
    if detected:
        language = _detect_language(request.content)
    base = {"success": True, "parsed": "inline", "language": language, "language_detected": detected,
            "persisted": False, "nodes_added": 0, "edges_added": 0}
    if language in {"python", "javascript", "typescript"}:
        service = None
        if http_request is not None:
            service = getattr(getattr(http_request.app, "state", None), "parser_service", None)
        if service is None:
            return JSONResponse(status_code=503, content={"success": False, "error": "Parser service unavailable"})
        try:
            result = await service.parse_inline(language, request.content)
        except asyncio.TimeoutError:
            return JSONResponse(status_code=503, content={"success": False, "error": "Parser capacity or deadline exceeded"})
        if "error" in result:
            status_code = 413 if "byte limit" in str(result["error"]) else 422
            return JSONResponse(status_code=status_code, content={"success": False, "error": result["error"], "parsed": "inline"})
        out = {**base, **{k: v for k, v in result.items() if k not in {"nodes", "edges"}}}
        out["success"] = True
        if request.include_graph:
            out["nodes"] = result.get("nodes", [])
            out["edges"] = result.get("edges", [])
        return out
    if language == "html":
        deadline = time.monotonic() + MAX_EXTRACT_SECONDS
        try:
            document = await _run_html_worker(
                _extract_document, request.content, None, ExtractRequest(html=request.content), deadline,
                deadline=deadline,
            )
        except _ExtractCapacityError:
            return JSONResponse(status_code=503, content={"success": False, "error": "Content extraction failed"})
        except asyncio.TimeoutError:
            return JSONResponse(status_code=504, content={"success": False, "error": "Content extraction failed"})
        document.pop("success", None)
        document.pop("url", None)
        return {**base, "backend": "beautifulsoup", "ok": True, "document": document}
    if language == "json":
        structure = _json_structure(request.content)
        return {**base, "backend": "json", "ok": bool(structure.get("valid")), "structure": structure}
    structure = _text_structure(request.content, markdown=language == "markdown")
    return {**base, "backend": "text_structure", "ok": True, "structure": structure}


async def _read_extract_request(request: Request) -> ExtractRequest:
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_EXTRACT_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail="Request body too large")
        content.extend(chunk)
    try:
        value = json.loads(bytes(content))
        return ExtractRequest.parse_obj(value)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Invalid request body") from exc

@router.post("/extract", dependencies=_ACTION_DEPENDENCIES)
async def extract(request: Request):
    deadline = time.monotonic() + MAX_EXTRACT_SECONDS
    parsed_request = await _read_extract_request(request) if not isinstance(request, ExtractRequest) else request
    _parse_count["html"] += 1
    try:
        html = parsed_request.html
        url = parsed_request.url
        if url and html:
            if "deadline" in inspect.signature(_public_http_url).parameters:
                await _public_http_url(url, deadline=deadline)
            else:
                await _public_http_url(url)
        elif url:
            if "deadline" in inspect.signature(_fetch_html).parameters:
                html = await asyncio.wait_for(
                    _fetch_html(url, deadline=deadline),
                    timeout=max(0.0, deadline - time.monotonic()),
                )
            else:
                html = await asyncio.wait_for(
                    _fetch_html(url),
                    timeout=max(0.0, deadline - time.monotonic()),
                )
        if not html:
            return JSONResponse(
                status_code=422,
                content={"success": False, "error": "No content"},
            )
        
        result = await _run_html_worker(
            _extract_document, html, url, parsed_request, deadline, deadline=deadline
        )
        if parsed_request.persist:
            indexed_text = _index_text_for_document(result)
            if indexed_text:
                await _best_effort_auto_index("html", indexed_text, {"url": url}, deadline=deadline)
            result["persisted"] = bool(indexed_text)
        else:
            result["persisted"] = False
        return result
    except _ExtractPolicyError:
        return JSONResponse(
            status_code=422,
            content={"success": False, "error": "Content extraction failed"},
        )
    except _ExtractCapacityError:
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": "Content extraction failed"},
        )
    except asyncio.TimeoutError:
        return JSONResponse(
            status_code=504,
            content={"success": False, "error": "Content extraction failed"},
        )
    except (_ExtractUpstreamError, httpx.HTTPError):
        return JSONResponse(
            status_code=502,
            content={"success": False, "error": "Content extraction failed"},
        )
    except Exception:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": "Parser failure"},
        )

def _parser_failure_response(result: Dict[str, Any], parsed: str, *, indexed: Optional[bool] = None) -> JSONResponse:
    """Translate the parser service's sanitized failure vocabulary to HTTP semantics."""
    error = str(result.get("error") or "Parser failure")
    if error.startswith(("Invalid or disallowed", "Either file_path or code")):
        status_code = 422
    elif error == "Parser response exceeds serialized byte limit":
        status_code = 413
    elif error == "PDF parser unavailable":
        status_code = 503
    else:
        status_code = 500
    content: Dict[str, Any] = {"success": False, "error": error, "parsed": parsed}
    if indexed is not None:
        content["indexed"] = indexed
    return JSONResponse(status_code=status_code, content=content)


@router.post("/python", dependencies=_ACTION_DEPENDENCIES)
async def parse_python(request: ParsePythonRequest, service: ParserService = Depends(get_parser_service)):
    _parse_count["python"] += 1
    result = await service.parse_python(request)
    if "error" in result:
        return _parser_failure_response(result, "python")
    return {"success": True, "parsed": "python", **result}

@router.post("/pdf", dependencies=_ACTION_DEPENDENCIES)
async def parse_pdf(request: ParsePDFRequest, service: ParserService = Depends(get_parser_service)):
    _parse_count["pdf"] += 1
    result = await service.parse_pdf(request)
    if "error" in result:
        return _parser_failure_response(result, "pdf")
    return {"success": True, "parsed": "pdf", **result}

@router.post("/javascript", dependencies=_ACTION_DEPENDENCIES)
async def parse_js(request: ParseJavaScriptRequest, service: ParserService = Depends(get_parser_service)):
    _parse_count["javascript"] += 1
    result = await service.parse_javascript(request)
    if "error" in result:
        return _parser_failure_response(result, "javascript")
    return {"success": True, "parsed": "javascript", **result}

@router.post("/directory", dependencies=_ACTION_DEPENDENCIES)
async def parse_dir(request: ParseDirectoryRequest, service: ParserService = Depends(get_parser_service)):
    _parse_count["directory"] += 1
    result = await service.parse_directory(request)
    if "error" in result:
        return _parser_failure_response(result, "directory")
    return {"success": True, "parsed": "directory", **result}

@router.post("/index-codebase", dependencies=_ACTION_DEPENDENCIES)
async def index_codebase(request: ParseDirectoryRequest, service: ParserService = Depends(get_parser_service)):
    """Alias for directory parsing with codebase-memory terminology."""
    _parse_count["directory"] += 1
    result = await service.parse_directory(request)
    if "error" in result:
        return _parser_failure_response(result, "directory", indexed=False)
    indexed = not bool(result.get("errors"))
    return {**result, "success": True, "parsed": "directory", "indexed": indexed}
