from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from datetime import datetime
from pydantic import BaseModel, Field
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
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

from cortex_server.modules.consciousness_integration import chain_to
from cortex_server.models.requests import ParsePythonRequest, ParsePDFRequest, ParseJavaScriptRequest, ParseDirectoryRequest
from cortex_server.services.parser_service import ParserService

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
def get_parser_service(request: Request) -> ParserService:
    """Resolve the immutable parser policy owned by this FastAPI app."""
    return request.app.state.parser_service

_parse_count = {"python": 0, "pdf": 0, "javascript": 0, "directory": 0, "html": 0}

async def _auto_index(content_type: str, summary: str, metadata: dict):
    await chain_to("parser", "librarian/embed", {
        "text": f"L3 Parser {content_type}: {summary}",
        "metadata": {"type": "parsed", "parser": content_type, **metadata}
    }, timeout=5.0)


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
    except Exception:
        logger.exception("HTML auto-indexing failed")
    finally:
        _auto_index_admissions.release()

class ExtractRequest(BaseModel):
    url: Optional[str] = Field(default=None, max_length=MAX_EXTRACT_URL_LENGTH)
    html: Optional[str] = Field(default=None, max_length=2_000_000)
    extract_links: bool = True
    extract_text: bool = True
    extract_meta: bool = True
    extract_headings: bool = True

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

@router.get("/status")
async def status():
    return {"success": True, "level": 3, "name": "Parser", "status": "active", "capabilities": ["python", "pdf", "javascript", "directory", "html_extraction"]}

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

@router.post("/extract")
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
        title = result["title"]
        
        summary = f"Extracted {title or 'untitled'} - {len(html)} chars"
        await _best_effort_auto_index("html", summary, {"url": url}, deadline=deadline)
        
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


@router.post("/python")
async def parse_python(request: ParsePythonRequest, service: ParserService = Depends(get_parser_service)):
    _parse_count["python"] += 1
    result = await service.parse_python(request)
    if "error" in result:
        return _parser_failure_response(result, "python")
    return {"success": True, "parsed": "python", **result}

@router.post("/pdf")
async def parse_pdf(request: ParsePDFRequest, service: ParserService = Depends(get_parser_service)):
    _parse_count["pdf"] += 1
    result = await service.parse_pdf(request)
    if "error" in result:
        return _parser_failure_response(result, "pdf")
    return {"success": True, "parsed": "pdf", **result}

@router.post("/javascript")
async def parse_js(request: ParseJavaScriptRequest, service: ParserService = Depends(get_parser_service)):
    _parse_count["javascript"] += 1
    result = await service.parse_javascript(request)
    if "error" in result:
        return _parser_failure_response(result, "javascript")
    return {"success": True, "parsed": "javascript", **result}

@router.post("/directory")
async def parse_dir(request: ParseDirectoryRequest, service: ParserService = Depends(get_parser_service)):
    _parse_count["directory"] += 1
    result = await service.parse_directory(request)
    if "error" in result:
        return _parser_failure_response(result, "directory")
    return {"success": True, "parsed": "directory", **result}

@router.post("/index-codebase")
async def index_codebase(request: ParseDirectoryRequest, service: ParserService = Depends(get_parser_service)):
    """Alias for directory parsing with codebase-memory terminology."""
    _parse_count["directory"] += 1
    result = await service.parse_directory(request)
    if "error" in result:
        return _parser_failure_response(result, "directory", indexed=False)
    indexed = not bool(result.get("errors"))
    return {**result, "success": True, "parsed": "directory", "indexed": indexed}
