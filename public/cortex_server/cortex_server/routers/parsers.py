from fastapi import APIRouter
from datetime import datetime
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
import httpx
from bs4 import BeautifulSoup
import asyncio

from cortex_server.modules.consciousness_integration import chain_to
from cortex_server.models.requests import ParsePythonRequest, ParsePDFRequest, ParseJavaScriptRequest, ParseDirectoryRequest
from cortex_server.services.parser_service import ParserService

router = APIRouter()
service = ParserService()

_parse_count = {"python": 0, "pdf": 0, "javascript": 0, "directory": 0, "html": 0}

async def _auto_index(content_type: str, summary: str, metadata: dict):
    try:
        await chain_to("parser", "librarian/embed", {
            "text": f"L3 Parser {content_type}: {summary}",
            "metadata": {"type": "parsed", "parser": content_type, **metadata}
        }, timeout=5.0)
    except:
        pass

class ExtractRequest(BaseModel):
    url: Optional[str] = None
    html: Optional[str] = None
    extract_links: bool = True
    extract_text: bool = True
    extract_meta: bool = True
    extract_headings: bool = True

@router.get("/status")
async def status():
    return {"success": True, "level": 3, "name": "Parser", "status": "active", "capabilities": ["python", "pdf", "javascript", "directory", "html_extraction"]}

@router.post("/extract")
async def extract(request: ExtractRequest):
    _parse_count["html"] += 1
    try:
        html = request.html
        url = request.url
        if url and not html:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(url)
                html = resp.text
        if not html:
            return {"success": False, "error": "No content"}
        
        soup = BeautifulSoup(html, "html.parser")
        title = soup.title.string if soup.title else None
        
        summary = f"Extracted {title or 'untitled'} - {len(html)} chars"
        asyncio.create_task(_auto_index("html", summary, {"url": url}))
        
        return {"success": True, "title": title, "url": url}
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.post("/python")
async def parse_python(request: ParsePythonRequest):
    _parse_count["python"] += 1
    result = await service.parse_python(request)
    if "error" in result:
        return {"success": False, "error": result["error"], "parsed": "python"}
    return {"success": True, "parsed": "python", **result}

@router.post("/pdf")
async def parse_pdf(request: ParsePDFRequest):
    _parse_count["pdf"] += 1
    result = await service.parse_pdf(request)
    if "error" in result:
        return {"success": False, "error": result["error"], "parsed": "pdf"}
    return {"success": True, "parsed": "pdf", **result}

@router.post("/javascript")
async def parse_js(request: ParseJavaScriptRequest):
    _parse_count["javascript"] += 1
    result = await service.parse_javascript(request)
    if "error" in result:
        return {"success": False, "error": result["error"], "parsed": "javascript"}
    return {"success": True, "parsed": "javascript", **result}

@router.post("/directory")
async def parse_dir(request: ParseDirectoryRequest):
    _parse_count["directory"] += 1
    result = await service.parse_directory(request)
    if "error" in result:
        return {"success": False, "error": result["error"], "parsed": "directory"}
    return {"success": True, "parsed": "directory", **result}

@router.post("/index-codebase")
async def index_codebase(request: ParseDirectoryRequest):
    """Alias for directory parsing with codebase-memory terminology."""
    _parse_count["directory"] += 1
    result = await service.parse_directory(request)
    if "error" in result:
        return {"success": False, "error": result["error"], "parsed": "directory", "indexed": False}
    return {"success": True, "parsed": "directory", "indexed": True, **result}
