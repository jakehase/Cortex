"""ExecutionEngine adapter for L3 Parser: structure of code/HTML/JSON pasted in
the user's message. Deterministic; no file paths, no graph or memory writes."""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Dict, List, Mapping, Optional

from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters._safe_level_common import clip, code_blocks, require_query

LEVEL = 3
NAME = "parser"
NEEDS_MODEL = False
SAFE_AUTORUN = True  # parses text already in the message; never reads files or persists
DEFAULT_DEADLINE_S = 20.0

_SERVICE = None
_HTML_HINT = re.compile(r"<(html|body|div|p|a|h[1-6]|title|table|ul|ol|span)\b[^>]*>", re.I)


def _service():
    global _SERVICE
    if _SERVICE is None:
        from cortex_server.services.parser_service import ParserService

        _SERVICE = ParserService(workspace_roots=())  # no roots: file reads are impossible
    return _SERVICE


def _code_summary(result: Dict[str, Any]) -> Dict[str, Any]:
    summary = result.get("summary") or {}
    return {
        "language": result.get("language"),
        "backend": result.get("backend"),
        "ok": result.get("ok"),
        "errors": (result.get("errors") or [])[:10],
        "functions": [
            {"name": f.get("qualified_name") or f.get("name"), "line": f.get("line")}
            for f in (summary.get("functions") or [])[:50]
        ],
        "classes": [{"name": c.get("name"), "line": c.get("line")} for c in (summary.get("classes") or [])[:30]],
        "imports": [i.get("target") for i in (summary.get("imports") or [])[:40]],
        "calls_count": (summary.get("counts") or {}).get("calls", 0),
        "routes": (summary.get("routes") or [])[:20],
        "truncated": bool(summary.get("truncated")),
    }


async def _parse_html(html: str, deadline_s: float) -> Dict[str, Any]:
    from cortex_server.routers import parsers as parsers_router

    request = parsers_router.ExtractRequest(html=html)
    deadline = time.monotonic() + deadline_s
    doc = await asyncio.wait_for(
        asyncio.to_thread(parsers_router._extract_document, html, None, request, deadline),
        timeout=deadline_s,
    )
    return {
        "language": "html",
        "title": doc.get("title"),
        "headings": (doc.get("headings") or [])[:20],
        "links": (doc.get("links") or [])[:30],
        "text_chars": len(doc.get("text") or ""),
        "meta_keys": sorted((doc.get("meta") or {}).keys())[:20],
    }


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    text = require_query(query)
    blocks = code_blocks(text)
    if not blocks and _HTML_HINT.search(text):
        blocks = [{"language": "html", "code": text}]
    if not blocks:
        raise ExecutionBlocked("no_parseable_content_in_message")
    service = _service()
    parsed: List[Dict[str, Any]] = []
    for block in blocks[:3]:
        language = block["language"]
        code = block["code"]
        if language in {"", "calc", "markdown"}:
            from cortex_server.routers.parsers import _detect_language

            language = _detect_language(code)
        if language in {"python", "javascript", "typescript"}:
            result = await service.parse_inline(language, code)
            if "error" in result:
                parsed.append({"language": language, "error": result["error"]})
            else:
                parsed.append(_code_summary(result))
        elif language == "html":
            parsed.append(await _parse_html(code, DEFAULT_DEADLINE_S - 5.0))
        elif language == "json":
            from cortex_server.routers.parsers import _json_structure

            parsed.append({"language": "json", **_json_structure(code)})
        else:
            parsed.append({"language": language or "unknown", "skipped": "unsupported_language"})
    lines = []
    for row in parsed:
        if row.get("error") or row.get("skipped"):
            lines.append(f"{row.get('language')}: not parsed ({row.get('error') or row.get('skipped')})")
        elif row.get("language") == "html":
            lines.append(f"html: title={row.get('title')!r}, {len(row.get('headings') or [])} headings, "
                         f"{len(row.get('links') or [])} links")
        elif row.get("language") == "json":
            lines.append(f"json: valid={row.get('valid')}" + (f", top-level {row.get('top_level_type')}" if row.get("valid")
                                                                else f", error {row.get('error')}"))
        else:
            fn = ", ".join(f"{f['name']}@{f['line']}" for f in row["functions"][:8])
            err = "; ".join(f"line {e.get('lineno')}: {e.get('message')}" for e in row["errors"][:3])
            lines.append(
                f"{row['language']} ({row['backend']}): ok={row['ok']}, {len(row['functions'])} functions [{fn}], "
                f"{len(row['classes'])} classes, imports {row['imports'][:8]}" + (f"; errors: {err}" if err else "")
            )
    return {
        "operation": "parser.summary",
        "origin": "deterministic",
        "summary": clip("Parsed content from the message — " + " | ".join(lines), 1500),
        "data": {"blocks": parsed, "persisted": False},
    }
