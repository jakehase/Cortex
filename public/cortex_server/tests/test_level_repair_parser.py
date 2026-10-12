"""L3 Parser repair: side-effect-free inline parsing, honest status, opt-in indexing."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import parser as parser_adapter
from cortex_server.routers import parsers as router
from cortex_server.services.parser_service import ParserService


def _run(coro):
    return asyncio.run(coro)


def _service():
    return ParserService(workspace_roots=())


def _http(service=None, routes=()):
    return SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(parser_service=service),
            routes=[SimpleNamespace(path=p, methods={m}) for m, p in routes],
        ),
        state=SimpleNamespace(),
    )


def test_inline_python_returns_symbols_and_never_touches_the_graph():
    service = _service()
    result = _run(service.parse_inline("python", "import os\ndef f(x):\n    return g(x)\nclass A: pass\n"))

    summary = result["summary"]
    assert [f["name"] for f in summary["functions"]] == ["f"]
    assert [c["name"] for c in summary["classes"]] == ["A"]
    assert {"caller": "f", "callee": "g", "line": 3} in summary["calls"]
    assert summary["imports"][0]["target"] == "os"
    assert result["persisted"] is False and result["nodes_added"] == 0 and result["edges_added"] == 0
    assert service._graph is None  # graph storage was never even constructed


def test_inline_syntax_error_is_reported_not_success():
    result = _run(_service().parse_inline("python", "def f(:\n"))
    assert result["ok"] is False
    assert result["errors"][0]["lineno"] == 1


def test_inline_javascript_never_spawns_node(monkeypatch):
    from cortex_server.parsers import js_parser

    def no_node(*_args, **_kwargs):
        raise AssertionError("inline JS must not spawn a Node subprocess")

    monkeypatch.setattr(js_parser.subprocess, "run", no_node)
    result = _run(_service().parse_inline("javascript", 'import x from "y"; export function a(){ return b(); }'))
    assert result["backend"] in {"tree_sitter", "regex_lightweight"}
    assert "a" in [f["name"] for f in result["summary"]["functions"]]
    assert result["persisted"] is False


def test_parse_endpoint_rejects_file_paths_and_persistence_flags():
    with pytest.raises(ValidationError):
        router.InlineParseRequest(content="x = 1", file_path="/etc/passwd")
    with pytest.raises(ValidationError):
        router.InlineParseRequest(content="x = 1", persist=True)
    with pytest.raises(ValidationError):
        router.InlineParseRequest(content="")


def test_parse_endpoint_happy_paths_for_code_html_json_and_text():
    http = _http(_service())
    code = _run(router.parse_inline(router.InlineParseRequest(content="def f():\n    return 1\n"), http))
    assert code["success"] is True and code["language"] == "python" and code["language_detected"] is True
    assert code["persisted"] is False and "nodes" not in code

    html = _run(router.parse_inline(router.InlineParseRequest(
        content="<html><title>T</title><h1>H</h1><a href='https://x.test/a'>l</a></html>", language="html"), http))
    assert html["document"]["title"] == "T"
    assert html["document"]["headings"][0]["text"] == "H"

    js = _run(router.parse_inline(router.InlineParseRequest(content='{"a": [1, 2]}'), http))
    assert js["language"] == "json" and js["structure"]["valid"] is True and js["structure"]["keys"][0]["key"] == "a"

    bad_json = _run(router.parse_inline(router.InlineParseRequest(content='{"a": ', language="json"), http))
    assert bad_json["ok"] is False and bad_json["structure"]["error"]["line"] == 1

    md = _run(router.parse_inline(router.InlineParseRequest(content="# Title\n\n- a\n- b\n", language="markdown"), http))
    assert md["structure"]["headings"] == [{"level": 1, "text": "Title", "line": 1}]


def test_parse_endpoint_unknown_language_is_422():
    response = _run(router.parse_inline(router.InlineParseRequest(content="x", language="cobol"), _http(_service())))
    assert response.status_code == 422


def test_status_lists_only_mounted_routes():
    http = _http(_service(), routes=[("GET", "/parsers/status"), ("POST", "/parsers/parse")])
    status = _run(router.status(http))
    assert status["capabilities"] == ["inline_parse"]
    missing = {row["capability"] for row in status["unavailable"]}
    assert {"python_parse_persist", "pdf_parse_persist", "directory_index", "html_extraction"} <= missing
    assert status["backends"]["javascript_inline"] in {"tree_sitter", "regex_lightweight"}


def test_extract_does_not_index_unless_persist_requested(monkeypatch):
    async def must_not_index(*_args, **_kwargs):
        raise AssertionError("default extraction must not write to memory")

    monkeypatch.setattr(router, "_auto_index", must_not_index)
    result = _run(router.extract(router.ExtractRequest(html="<title>ok</title><p>body</p>")))
    assert result["success"] is True and result["persisted"] is False

    indexed = []

    async def capture(content_type, summary, metadata):
        indexed.append(summary)

    monkeypatch.setattr(router, "_auto_index", capture)
    result = _run(router.extract(router.ExtractRequest(html="<title>ok</title><p>body text</p>", persist=True)))
    assert result["persisted"] is True
    assert "Title: ok" in indexed[0] and "body text" in indexed[0]  # real content, not "Extracted ... chars"


def test_adapter_contract_parses_code_block_and_blocks_without_content():
    out = _run(parser_adapter.run("what does this define?\n```python\ndef f(x):\n    return g(x)\n```", {}))
    assert out["operation"] == "parser.summary" and out["origin"] == "deterministic"
    assert "f@1" in out["summary"] and len(out["summary"]) <= 1500
    assert out["data"]["persisted"] is False
    json.dumps(out)
    assert parser_adapter.SAFE_AUTORUN is True and parser_adapter.NEEDS_MODEL is False

    with pytest.raises(ExecutionBlocked) as blocked:
        _run(parser_adapter.run("tell me a joke", {}))
    assert blocked.value.reason == "no_parseable_content_in_message"
