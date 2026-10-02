import asyncio
import json
import os
import socket
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request

from cortex_server.models.requests import (
    ParseDirectoryRequest,
    ParseJavaScriptRequest,
    ParsePDFRequest,
    ParsePythonRequest,
)
from cortex_server.routers import parsers as router
from cortex_server.services.parser_service import ParserService
from cortex_server.services import parser_service
from cortex_server.parsers.python_parser import PythonParser, ParserConfig
from cortex_server.parsers.js_parser import JSParser, JSParserConfig, TRUNCATION_MESSAGE
from cortex_server.parsers.pdf_parser import PDFParser, PDFParserConfig


@pytest.fixture(autouse=True)
def _configured_parser_egress_hosts(monkeypatch):
    """Keep legacy parser fixtures explicit under the default-deny host policy."""

    monkeypatch.setenv(
        "CORTEX_PARSER_EGRESS_ALLOWED_HOSTS",
        ",".join(
            (
                "example.test",
                "other.test",
                "one.test",
                "two.test",
                "three.test",
                "public.test",
            )
        ),
    )


class RecordingGraph:
    def __init__(self, *, fail=False):
        self.nodes = []
        self.edges = []
        self.fail = fail

    def add_nodes(self, records):
        if self.fail:
            raise RuntimeError("database detail must not escape")
        self.nodes.extend(records)

    def add_edges(self, records):
        if self.fail:
            raise RuntimeError("database detail must not escape")
        self.edges.extend(records)

    def stats(self):
        return {"nodes": len(self.nodes), "edges": len(self.edges)}


def service(root: Path) -> ParserService:
    # Avoid opening the process-global SQLite graph: these boundary tests inject
    # a deterministic graph and exercise ParserService's real commit logic.
    instance = object.__new__(ParserService)
    instance.workspace_roots = (root.resolve(),)
    instance.python_parser = SimpleNamespace(parse_file=None)
    instance.js_parser = SimpleNamespace(parse_file=None)
    instance.pdf_parser = None
    instance.pdf_parser_error = None
    instance.graph = RecordingGraph()
    return instance


async def run_inline(function, *args):
    return function(*args)


@pytest.mark.parametrize("model", [ParsePythonRequest, ParseJavaScriptRequest])
def test_inline_source_is_exclusive_and_capped_by_encoded_bytes(model):
    with pytest.raises(ValidationError):
        model(code="x", file_path="also.py")
    with pytest.raises(ValidationError):
        model(code="é" * 1_000_001)


def test_realpath_confinement_rejects_traversal_and_symlink_escape(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    inside = root / "ok.py"
    inside.write_text("value = 1")
    outside = tmp_path / "secret.py"
    outside.write_text("secret = 1")
    link = root / "link.py"
    link.symlink_to(outside)
    parser = service(root)
    parser._run = run_inline

    assert parser._safe_path(str(inside)) == inside.resolve()
    for candidate in (root / ".." / "secret.py", link):
        with pytest.raises(ValueError, match="outside configured workspace roots"):
            parser._safe_path(str(candidate))


def test_descriptor_open_rejects_leaf_swap_and_preserves_internal_symlink(monkeypatch, tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    target = root / "target.py"
    target.write_bytes(b"safe = True")
    alias = root / "alias.py"
    alias.symlink_to(target)
    parser = service(root)

    raw, display = parser._read_workspace_snapshot(str(alias), 100)
    assert raw == b"safe = True"
    assert display == str(target)

    replacement = root / "replacement.py"
    replacement.write_bytes(b"stolen = True")
    real_open = parser_service.os.open
    calls = 0

    def swapping_open(path, flags, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            target.unlink()
            replacement.rename(target)
        return real_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(parser_service.os, "open", swapping_open)
    with pytest.raises(ValueError, match="changed while being opened"):
        parser._read_workspace_snapshot(str(target), 100)


def test_javascript_high_amplification_stops_at_combined_budget():
    parser = JSParser(JSParserConfig(use_tree_sitter=False, max_records=7))
    parser._node_parser_available = False
    source = "\n".join(
        f"import x{i} from 'package-{i}'; function f{i}() {{ return x{i}(); }}"
        for i in range(2_000)
    )

    result = parser.parse_bytes(source.encode(), "large.js")

    assert len(result.nodes) + len(result.edges) == 7
    assert result.truncated is True
    assert [error.message for error in result.errors] == [TRUNCATION_MESSAGE]


def test_pdf_library_error_is_logged_but_public_error_has_no_path(caplog, tmp_path):
    secret = tmp_path / "private-document.pdf"
    parser = object.__new__(PDFParser)
    parser.config = PDFParserConfig()

    class BrokenLibrary:
        @staticmethod
        def open(_source):
            raise RuntimeError(f"decoder exploded while reading {secret}")

    parser._pdfplumber = BrokenLibrary()
    caplog.set_level("ERROR", logger="cortex_server.parsers.pdf_parser")
    result = parser.parse_bytes(b"%PDF", str(secret))

    assert result.error == "PDF parsing failed"
    assert str(secret) not in result.error
    assert str(secret) not in caplog.text
    assert "RuntimeError" in caplog.text


def test_pdf_oversized_content_is_rejected_before_chars_materialization():
    parser = object.__new__(PDFParser)
    parser.config = PDFParserConfig(max_page_content_bytes=8)

    class Page:
        page_obj = SimpleNamespace(
            attrs={"Contents": SimpleNamespace(attrs={"Length": 9}, rawdata=b"")}
        )

        @property
        def chars(self):
            raise AssertionError("chars must not be materialized")

    with pytest.raises(ValueError, match="content limit"):
        parser._parse_page(Page(), 1, "doc:test")


@pytest.mark.parametrize(
    ("config", "page_results"),
    [
        (
            PDFParserConfig(max_page_result_bytes=150),
            [
                {"metadata": {"text": "", "structures": [], "padding": "x" * 80}},
                {"metadata": {"text": "", "structures": [], "padding": "x" * 80}},
            ],
        ),
        (
            PDFParserConfig(max_page_result_records=3),
            [
                {"metadata": {"text": "", "structures": [{"type": "Paragraph"}]}},
                {"metadata": {"text": "", "structures": [{"type": "Paragraph"}]}},
            ],
        ),
    ],
)
def test_pdf_rejects_complete_result_when_aggregate_page_budget_is_exceeded(
    config, page_results
):
    parser = object.__new__(PDFParser)
    parser.config = config

    class Document:
        pages = [SimpleNamespace(page_obj=SimpleNamespace(attrs={})) for _ in page_results]
        metadata = {}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    class Library:
        @staticmethod
        def open(_source):
            return Document()

    parser._pdfplumber = Library()
    parser._parse_page_bounded = lambda _raw, page_index, *_args: page_results[page_index]

    result = parser.parse_bytes(b"%PDF", "aggregate.pdf")

    assert result.error == "PDF page results exceed aggregate limit"
    assert result.document is None
    assert result.pages == []


def test_pdf_page_timeout_terminates_and_joins_worker(monkeypatch):
    parser = object.__new__(PDFParser)
    parser.config = PDFParserConfig(page_timeout_seconds=0.001)
    events = []

    class Parent:
        def poll(self, _timeout):
            return False

        def close(self):
            events.append("parent-close")

    class Child:
        def close(self):
            events.append("child-close")

    class Process:
        alive = True

        def start(self):
            events.append("start")

        def is_alive(self):
            return self.alive

        def terminate(self):
            events.append("terminate")
            self.alive = False

        def join(self, timeout):
            assert timeout == 1.0
            events.append("join")

        def kill(self):
            events.append("kill")

    class Context:
        def Pipe(self, duplex):
            assert duplex is False
            return Parent(), Child()

        def Process(self, **_kwargs):
            return Process()

    monkeypatch.setattr("multiprocessing.get_all_start_methods", lambda: ["fork"])
    monkeypatch.setattr("multiprocessing.get_context", lambda _method: Context())

    with pytest.raises(TimeoutError, match="timed out"):
        parser._parse_page_bounded(b"%PDF", 0, 1, "doc:test", 1.0)

    assert events == ["start", "child-close", "parent-close", "terminate", "join"]


def test_missing_and_wrong_path_kinds_fail_closed_without_path_disclosure(tmp_path):
    parser = service(tmp_path)
    parser._run = run_inline
    missing = tmp_path / "private-name.py"
    result = asyncio.run(parser.parse_python(ParsePythonRequest(file_path=str(missing))))
    assert result == {"error": "Invalid or disallowed file path"}
    (tmp_path / "file").write_text("not a directory")
    with pytest.raises(ValueError, match="not a directory"):
        parser._safe_path(str(tmp_path / "file"), directory=True)


def test_directory_skips_symlink_escape_and_honors_nonrecursive_mode(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    (root / "top.py").write_text("x = 1")
    nested = root / "nested"
    nested.mkdir()
    (nested / "deep.py").write_text("y = 2")
    outside = tmp_path / "outside.py"
    outside.write_text("z = 3")
    (root / "escape.py").symlink_to(outside)
    parser = service(root)
    parser._run = run_inline
    parsed = []
    parser.python_parser.parse_file = lambda path: parsed.append(path) or SimpleNamespace(nodes=[], edges=[])

    result = asyncio.run(parser.parse_directory(ParseDirectoryRequest(directory=str(root), recursive=False)))

    assert parsed == [str((root / "top.py").resolve())]
    assert result["files_parsed"] == 1
    assert result["files_skipped"] == 1


def test_directory_caps_files_and_aggregate_bytes_before_parsing(tmp_path):
    for name in ("a.py", "b.py", "c.py"):
        (tmp_path / name).write_bytes(b"1234")
    parser = service(tmp_path)
    parser.MAX_FILES = 1
    parser._run = run_inline
    parser.python_parser.parse_file = lambda path: SimpleNamespace(nodes=[], edges=[])
    result = asyncio.run(parser.parse_directory(ParseDirectoryRequest(directory=str(tmp_path))))
    assert result["files_parsed"] == 1
    assert result["errors"] == ["Directory parsing limit exceeded"]

    parser = service(tmp_path)
    parser.MAX_TOTAL_BYTES = 5
    parser._run = run_inline
    parser.python_parser.parse_file = lambda path: SimpleNamespace(nodes=[], edges=[])
    result = asyncio.run(parser.parse_directory(ParseDirectoryRequest(directory=str(tmp_path))))
    assert result["files_parsed"] == 1
    assert result["errors"] == ["Directory byte limit exceeded"]


def test_directory_discovery_runs_off_loop_and_bounds_entries(monkeypatch, tmp_path):
    for name in ("a.py", "b.py", "c.py", "d.py"):
        (tmp_path / name).write_text("x=1")
    parser = service(tmp_path)
    parser.MAX_VISITED_ENTRIES = 2
    parser.python_parser.parse_file = lambda path: SimpleNamespace(nodes=[], edges=[])
    real_to_thread = asyncio.to_thread
    calls = []

    async def recording_to_thread(function, *args):
        calls.append(function.__name__)
        return await real_to_thread(function, *args)

    monkeypatch.setattr(asyncio, "to_thread", recording_to_thread)
    result = asyncio.run(parser.parse_directory(ParseDirectoryRequest(directory=str(tmp_path))))

    assert calls == ["enumerate_files"]
    assert result["files_seen"] == 0
    assert result["errors"] == ["Directory parsing limit exceeded"]


def test_wedged_directory_discovery_holds_worker_capacity(monkeypatch, tmp_path):
    parser = service(tmp_path)
    parser.MAX_WORKERS = 1
    parser.MAX_SECONDS = 0.02
    entered = threading.Event()
    release = threading.Event()
    real_scandir = os.scandir

    def blocked_scandir(path):
        entered.set()
        release.wait(1)
        return real_scandir(path)

    monkeypatch.setattr(parser_service.os, "scandir", blocked_scandir)

    async def scenario():
        first = asyncio.create_task(parser.parse_directory(
            ParseDirectoryRequest(directory=str(tmp_path))
        ))
        assert await asyncio.to_thread(entered.wait, 1)
        first_result = await first
        assert first_result["errors"] == ["Directory parsing limit exceeded"]
        assert parser._worker_slots._value == 0

        second_result = await parser.parse_directory(
            ParseDirectoryRequest(directory=str(tmp_path))
        )
        assert second_result["errors"] == ["Directory parsing limit exceeded"]
        assert len(parser._worker_tasks) == 1

        release.set()
        deadline = time.monotonic() + 1
        while parser._worker_slots._value == 0 and time.monotonic() < deadline:
            await asyncio.sleep(0.005)
        assert parser._worker_slots._value == 1
        await asyncio.sleep(0.01)

    asyncio.run(scenario())


def test_directory_failure_response_uses_relative_identifier_and_sanitized_error(
    tmp_path, caplog
):
    source = tmp_path / "private" / "secret.py"
    source.parent.mkdir()
    source.write_text("x=1")
    parser = service(tmp_path)
    parser._run = run_inline

    def fail(_path):
        raise RuntimeError(f"database password leaked near {tmp_path}")

    parser.python_parser.parse_file = fail
    caplog.set_level("ERROR", logger="cortex_server.services.parser_service")
    result = asyncio.run(parser.parse_directory(ParseDirectoryRequest(directory=str(tmp_path))))

    assert result["errors"] == ["private/secret.py: File parsing failed"]
    assert str(tmp_path) not in str(result)
    assert "database password leaked" not in str(result)
    assert "database password leaked" not in caplog.text
    assert "RuntimeError" in caplog.text


def test_directory_record_budget_is_aggregate_includes_pdfs_and_stops(tmp_path):
    (tmp_path / "a.pdf").write_bytes(b"pdf")
    (tmp_path / "b.pdf").write_bytes(b"pdf")
    parser = service(tmp_path)
    parser.MAX_RECORDS = 2
    parser._run = run_inline
    parsed = []

    def parse_pdf(path):
        parsed.append(path)
        stem = Path(path).stem
        return SimpleNamespace(
            error=None,
            document={"id": f"{stem}-doc", "name": stem, "type": "Document"},
            pages=[
                {"id": f"{stem}-page-1", "name": "1", "type": "Entity"},
                {"id": f"{stem}-page-2", "name": "2", "type": "Entity"},
            ],
        )

    parser.pdf_parser = SimpleNamespace(parse_file=parse_pdf)
    result = asyncio.run(parser.parse_directory(ParseDirectoryRequest(directory=str(tmp_path))))

    assert parsed == [str((tmp_path / "a.pdf").resolve())]
    assert result["files_parsed"] == 1
    assert result["nodes_added"] == 2
    assert result["edges_added"] == 0
    assert result["errors"] == ["Directory record limit exceeded"]
    assert len(parser.graph.nodes) == 2


def test_recursive_walk_has_a_hard_depth_limit(tmp_path):
    current = tmp_path
    for index in range(12):
        current = current / str(index)
        current.mkdir()
        (current / f"f{index}.py").write_text("x=1")
    parser = service(tmp_path)
    parser._run = run_inline
    parsed = []
    parser.python_parser.parse_file = lambda path: parsed.append(path) or SimpleNamespace(nodes=[], edges=[])
    asyncio.run(parser.parse_directory(ParseDirectoryRequest(directory=str(tmp_path))))
    assert len(parsed) == 10
    assert not any("f10.py" in path or "f11.py" in path for path in parsed)


def test_blocking_parser_runs_off_event_loop(monkeypatch, tmp_path):
    source = tmp_path / "slow.py"
    source.write_text("x=1")
    parser = service(tmp_path)
    entered = asyncio.Event()
    release = asyncio.Event()

    def blocking(_path):
        raise AssertionError("blocking parser must not run on the event loop")

    async def fake_to_thread(function, *args, **kwargs):
        if function.__name__ in {"_read_workspace_snapshot", "_add_batch_to_graph"}:
            return function(*args, **kwargs)
        assert function is blocking
        entered.set()
        await release.wait()
        return SimpleNamespace(nodes=[], edges=[], errors=[], ok=True)

    parser.python_parser.parse_file = blocking
    monkeypatch.setattr(asyncio, "to_thread", fake_to_thread)

    async def scenario():
        task = asyncio.create_task(parser.parse_python(ParsePythonRequest(file_path=str(source))))
        await entered.wait()
        await asyncio.sleep(0)
        assert not task.done()
        release.set()
        return await task

    assert asyncio.run(scenario())["ok"] is True


@pytest.mark.parametrize("slow_stage", ["snapshot", "commit"])
def test_snapshot_and_commit_workers_keep_event_loop_responsive(monkeypatch, tmp_path, slow_stage):
    source = tmp_path / "slow.py"
    source.write_text("x=1")
    parser = service(tmp_path)
    parser.python_parser.parse_file = lambda _path: SimpleNamespace(
        nodes=[{"id": "n", "name": "node", "type": "Entity"}],
        edges=[], errors=[], ok=True,
    )

    async def scenario():
        entered = asyncio.Event()
        release = asyncio.Event()

        async def slow_to_thread(function, *args, **kwargs):
            stage = "snapshot" if function.__name__ == "_read_workspace_snapshot" else (
                "commit" if function.__name__ == "_add_batch_to_graph" else "parse"
            )
            if stage == slow_stage:
                entered.set()
                await release.wait()
            return function(*args, **kwargs)

        monkeypatch.setattr(asyncio, "to_thread", slow_to_thread)
        task = asyncio.create_task(parser.parse_python(ParsePythonRequest(file_path=str(source))))
        deadline = time.monotonic() + 1
        heartbeats = 0
        while not entered.is_set() and time.monotonic() < deadline:
            await asyncio.sleep(0.001)
        assert entered.is_set()
        for _ in range(5):
            await asyncio.sleep(0.001)
            heartbeats += 1
        assert heartbeats == 5 and not task.done()
        release.set()
        return await task

    assert asyncio.run(scenario())["nodes_added"] == 1


def test_snapshot_parse_and_commit_share_one_absolute_deadline(tmp_path):
    source = tmp_path / "input.py"
    source.write_text("x=1")
    parser = service(tmp_path)
    deadlines = []

    async def recording_run(function, *args, deadline):
        deadlines.append((function.__name__, deadline))
        if function.__name__ == "_read_workspace_snapshot":
            return source.read_bytes(), str(source)
        if function.__name__ == "parse_file":
            return SimpleNamespace(nodes=[], edges=[], errors=[], ok=True)
        return {"nodes": 0, "edges": 0}

    def parse_file(_path):
        return None

    parser.python_parser.parse_file = parse_file
    parser._run = recording_run
    asyncio.run(parser.parse_python(ParsePythonRequest(file_path=str(source))))

    assert [name for name, _ in deadlines] == [
        "_read_workspace_snapshot", "parse_file"
    ]
    assert len({deadline for _, deadline in deadlines}) == 1


def test_timed_out_sqlite_commit_rolls_back_before_return_and_retry_is_safe(tmp_path):
    from cortex_server.knowledge.graph import Graph, SQLiteStorage

    parser = service(tmp_path)
    parser.graph = Graph(SQLiteStorage(str(tmp_path / "transaction.db")))
    nodes = [{"id": f"n{i}", "name": str(i), "type": "Entity"} for i in range(2)]
    edges = [{"id": "e", "source_id": "n0", "target_id": "n1", "type": "REFERENCES"}]
    entered = threading.Event()
    release = threading.Event()

    def block_mid_transaction():
        entered.set()
        release.wait(1)

    parser.graph.storage._batch_transaction_hook = block_mid_transaction

    async def scenario():
        loop = asyncio.get_running_loop()
        loop.call_later(0.05, release.set)
        with pytest.raises(asyncio.TimeoutError):
            await parser._commit_graph_batch(nodes, edges, time.monotonic() + 0.02)
        assert entered.is_set()
        assert parser.graph.stats()["nodeCount"] == 0
        assert parser.graph.stats()["edgeCount"] == 0

        del parser.graph.storage._batch_transaction_hook
        assert await parser._commit_graph_batch(nodes, edges, time.monotonic() + 1) == {
            "nodes": 2, "edges": 1
        }
        assert parser.graph.stats()["nodeCount"] == 2
        assert parser.graph.stats()["edgeCount"] == 1

    asyncio.run(scenario())


def test_timed_out_commit_does_not_interrupt_concurrent_writer(tmp_path):
    parser = service(tmp_path)
    slow_entered = threading.Event()
    healthy_entered = threading.Event()
    release_healthy = threading.Event()
    interrupted = threading.Event()

    class ConcurrentGraph:
        def write_batch_atomic(self, nodes, _edges, *, deadline, cancelled):
            if nodes[0].id == "slow":
                slow_entered.set()
                while not cancelled.wait(0.001):
                    assert time.monotonic() < deadline + 1
                raise TimeoutError("graph commit deadline exceeded")

            healthy_entered.set()
            assert release_healthy.wait(1)
            if interrupted.is_set():
                raise RuntimeError("unrelated transaction interrupted")

        def interrupt_transactions(self):
            interrupted.set()

    parser.graph = ConcurrentGraph()

    async def scenario():
        slow = asyncio.create_task(parser._commit_graph_batch(
            [{"id": "slow", "name": "slow", "type": "Entity"}], [],
            time.monotonic() + 0.05,
        ))
        assert await asyncio.to_thread(slow_entered.wait, 1)

        healthy = asyncio.create_task(parser._commit_graph_batch(
            [{"id": "healthy", "name": "healthy", "type": "Entity"}], [],
            time.monotonic() + 1,
        ))
        assert await asyncio.to_thread(healthy_entered.wait, 1)

        with pytest.raises(asyncio.TimeoutError):
            await slow
        release_healthy.set()
        assert await healthy == {"nodes": 1, "edges": 0}
        assert not interrupted.is_set()

    asyncio.run(scenario())


def test_graph_commits_have_bounded_admission_and_retained_workers(tmp_path):
    parser = service(tmp_path)
    parser.MAX_WORKERS = 1
    entered = threading.Event()
    release = threading.Event()
    calls = 0

    def blocked_commit(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        entered.set()
        release.wait(1)
        return {"nodes": 0, "edges": 0}

    parser._add_batch_to_graph = blocked_commit

    async def scenario():
        first = asyncio.create_task(parser._commit_graph_batch(
            [], [], time.monotonic() + 1,
        ))
        assert await asyncio.to_thread(entered.wait, 1)
        assert len(parser._worker_tasks) == 1

        with pytest.raises(asyncio.TimeoutError, match="capacity exhausted"):
            await parser._commit_graph_batch([], [], time.monotonic() + 1)
        assert calls == 1
        assert len(parser._worker_tasks) == 1

        release.set()
        assert await first == {"nodes": 0, "edges": 0}
        await asyncio.sleep(0)
        assert parser._worker_slots._value == 1
        assert not parser._worker_tasks

    asyncio.run(scenario())


def test_cancelled_graph_commit_stops_before_record_conversion_or_storage(tmp_path):
    parser = service(tmp_path)
    converted = False

    def convert(_item):
        nonlocal converted
        converted = True
        raise AssertionError("cancelled records must not be converted")

    parser._node_from_data = convert
    cancelled = threading.Event()
    cancelled.set()

    with pytest.raises(TimeoutError, match="deadline exceeded"):
        parser._add_batch_to_graph(
            [{"id": "n"}], [], deadline=time.monotonic() + 1,
            cancelled=cancelled,
        )
    assert converted is False
    assert parser.graph.nodes == []


def test_atomic_parser_batch_updates_referenced_node_without_deleting_edge(tmp_path):
    from cortex_server.knowledge.graph import (
        Edge, EdgeType, Graph, Node, NodeType, SQLiteStorage,
    )

    parser = service(tmp_path)
    parser.graph = Graph(SQLiteStorage(str(tmp_path / "transaction.db")))
    parser.graph.add_nodes([
        Node(id="existing", name="old name", type=NodeType.ENTITY),
        Node(id="target", name="target", type=NodeType.ENTITY),
    ])
    parser.graph.add_edge(Edge(
        id="existing-edge",
        source_id="existing",
        target_id="target",
        type=EdgeType.REFERENCES,
    ))

    result = asyncio.run(parser._commit_graph_batch(
        [{"id": "existing", "name": "updated name", "type": "Entity"}],
        [],
        time.monotonic() + 1,
    ))

    assert result == {"nodes": 1, "edges": 0}
    assert parser.graph.get_node("existing").name == "updated name"
    assert parser.graph.get_edge("existing-edge").source_id == "existing"
    assert parser.graph.stats()["edgeCount"] == 1


def test_parser_timeout_is_bounded(monkeypatch, tmp_path):
    parser = service(tmp_path)
    parser.MAX_SECONDS = 0.01
    async def never_returns(function, *args):
        await asyncio.sleep(10)

    monkeypatch.setattr(asyncio, "to_thread", never_returns)

    started = time.monotonic()
    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(parser._run(lambda: None))
    assert time.monotonic() - started < 0.5


def test_timed_out_worker_holds_capacity_and_uses_fresh_parser_state(monkeypatch, tmp_path):
    parser = service(tmp_path)
    parser.MAX_WORKERS = 1
    parser.MAX_SECONDS = 0.01
    parser.python_parser = PythonParser(ParserConfig())
    release = threading.Event()
    instances = []

    def blocked(self, _path):
        instances.append(self)
        release.wait(1)
        return SimpleNamespace(nodes=[], edges=[], errors=[], ok=True)

    monkeypatch.setattr(PythonParser, "parse_file", blocked)
    async def scenario():
        with pytest.raises(asyncio.TimeoutError):
            await parser._run(parser.python_parser.parse_file, "ignored")
        assert instances and instances[0] is not parser.python_parser
        with pytest.raises(asyncio.TimeoutError, match="capacity exhausted"):
            await parser._run(parser.python_parser.parse_file, "ignored")
        release.set()
        deadline = time.monotonic() + 1
        while parser._worker_slots._value == 0 and time.monotonic() < deadline:
            await asyncio.sleep(0.005)
        assert parser._worker_slots._value == 1
        # Let the to_thread task observe its completed executor future before
        # asyncio.run performs pending-task shutdown.
        await asyncio.sleep(0.01)

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(scenario())
    finally:
        loop.close()


def test_directory_uses_one_absolute_deadline_for_every_file(tmp_path):
    for name in ("a.py", "b.py"):
        (tmp_path / name).write_text("x=1")
    parser = service(tmp_path)
    deadlines = []

    async def bounded_run(function, *arguments, deadline):
        function_name = getattr(function, "__name__", "")
        if function_name in {"_read_workspace_snapshot", "enumerate_files"}:
            return function(*arguments)
        if function_name == "_add_batch_to_graph":
            return {"nodes": 0, "edges": 0}
        deadlines.append(deadline)
        if len(deadlines) == 2:
            raise asyncio.TimeoutError
        return SimpleNamespace(nodes=[], edges=[])

    parser._run = bounded_run
    result = asyncio.run(parser.parse_directory(ParseDirectoryRequest(directory=str(tmp_path))))

    assert len(deadlines) == 2
    assert deadlines[0] == deadlines[1]
    assert result["files_parsed"] == 1
    assert result["errors"] == ["Directory parsing limit exceeded"]


def test_wedged_html_parsing_has_bounded_admission_and_retains_workers():
    from cortex_server.routers import parsers as router

    release = threading.Event()
    entered = threading.Semaphore(0)

    def wedged(body):
        entered.release()
        release.wait(2)
        return body

    async def scenario():
        deadline = time.monotonic() + 0.05
        admitted = [
            asyncio.create_task(router._run_html_worker(wedged, object(), deadline=deadline))
            for _ in range(router.MAX_HTML_ADMISSIONS)
        ]
        for _ in range(router.MAX_HTML_WORKERS):
            assert await asyncio.to_thread(entered.acquire, True, 1)

        with pytest.raises(RuntimeError, match="capacity exhausted"):
            await router._run_html_worker(wedged, object(), deadline=deadline)

        results = await asyncio.gather(*admitted, return_exceptions=True)
        assert all(isinstance(result, asyncio.TimeoutError) for result in results)
        assert len(router._html_tasks) == router.MAX_HTML_WORKERS

        release.set()
        timeout = time.monotonic() + 1
        while router._html_tasks and time.monotonic() < timeout:
            await asyncio.sleep(0.01)
        assert not router._html_tasks

    asyncio.run(scenario())


def test_success_response_cap_keeps_whole_records_and_commits_only_retained(tmp_path):
    source = tmp_path / "input.py"
    source.write_text("x=1")
    parser = service(tmp_path)
    parser.MAX_RESPONSE_BYTES = 360
    parser._run = run_inline
    nodes = [
        {"id": f"n{index}", "name": "é" * 45, "type": "Entity"}
        for index in range(4)
    ]
    parser.python_parser.parse_file = lambda _path: SimpleNamespace(
        nodes=nodes, edges=[], errors=[], ok=True
    )

    result = asyncio.run(parser.parse_python(ParsePythonRequest(file_path=str(source))))

    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    assert len(encoded) <= parser.MAX_RESPONSE_BYTES
    assert result["response_truncated"] is True
    assert result["nodes"] == nodes[: len(result["nodes"])]
    assert [node.id for node in parser.graph.nodes] == [node["id"] for node in result["nodes"]]
    assert result["nodes_added"] == len(result["nodes"])


@pytest.mark.asyncio
async def test_route_response_cap_includes_envelope_for_concurrent_parsers(tmp_path):
    parser = service(tmp_path)
    parser.MAX_RESPONSE_BYTES = 360
    parser._run = run_inline
    records = [
        {"id": f"n{index}", "name": "x\n\"\\é" * 18, "type": "Entity"}
        for index in range(5)
    ]
    parsed = SimpleNamespace(nodes=records, edges=[], errors=[], ok=True)
    parser.python_parser.parse_file = lambda _path: parsed
    parser.js_parser.parse_file = lambda _path: parsed

    python_response, javascript_response = await asyncio.gather(
        router.parse_python(ParsePythonRequest(code="x = 1"), parser),
        router.parse_js(ParseJavaScriptRequest(code="const x = 1"), parser),
    )

    for response in (python_response, javascript_response):
        assert len(router.JSONResponse(content=response).body) <= parser.MAX_RESPONSE_BYTES
        assert response["success"] is True
        assert response["response_truncated"] is True


@pytest.mark.asyncio
async def test_pdf_route_response_cap_includes_envelope(tmp_path):
    source = tmp_path / "input.pdf"
    source.write_bytes(b"%PDF-test")
    parser = service(tmp_path)
    parser.MAX_RESPONSE_BYTES = 300
    parser._run = run_inline
    pages = [
        {"id": f"p{index}", "text": "x\n\"\\é" * 20}
        for index in range(4)
    ]
    parsed = SimpleNamespace(
        error=None,
        pages=pages,
        document=None,
        to_dict=lambda: {"pages": pages, "page_count": len(pages)},
    )
    parser.pdf_parser = SimpleNamespace(parse_bytes=lambda _raw, _path: parsed)

    response = await router.parse_pdf(ParsePDFRequest(file_path=str(source)), parser)

    assert len(router.JSONResponse(content=response).body) <= parser.MAX_RESPONSE_BYTES
    assert response["success"] is True
    assert response["response_truncated"] is True


def test_response_cap_serializes_each_record_once_at_near_limit_scale(monkeypatch, tmp_path):
    parser = service(tmp_path)
    records = [{"id": f"n{i}", "name": "x" * 80, "type": "Entity"} for i in range(2000)]
    full = {"nodes": records, "edges": [], "ok": True}
    parser.MAX_RESPONSE_BYTES = len(json.dumps(full, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()) - 100
    real_dumps = json.dumps
    calls = 0

    def counting_dumps(*args, **kwargs):
        nonlocal calls
        calls += 1
        return real_dumps(*args, **kwargs)

    monkeypatch.setattr(parser_service.json, "dumps", counting_dumps)
    result = parser._cap_response_collections(full, ("nodes", "edges"), deadline=time.monotonic() + 1)

    assert result["response_truncated"] is True
    assert result["nodes"] == records[: len(result["nodes"])]
    assert calls <= len(records) + 10
    assert len(real_dumps(result, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()) <= parser.MAX_RESPONSE_BYTES


def test_graph_counts_only_committed_records_and_rejects_malformed_batch(tmp_path):
    parser = service(tmp_path)
    parser.MAX_RECORDS = 2
    nodes = [{"id": f"n{i}", "name": str(i), "type": "Entity"} for i in range(3)]
    edges = [{"id": "e", "source_id": "n0", "target_id": "n1", "type": "REFERENCES"}]
    assert parser._add_batch_to_graph(nodes, edges) == {"nodes": 2, "edges": 0}
    assert len(parser.graph.nodes) == 2

    parser.graph = RecordingGraph(fail=True)
    assert parser._add_batch_to_graph(nodes[:1], []) == {"nodes": 0, "edges": 0}
    parser.graph = RecordingGraph()
    assert parser._add_batch_to_graph(nodes[:1] + [{"name": "bad"}], []) == {"nodes": 0, "edges": 0}
    assert parser.graph.nodes == []


def test_failed_nonempty_graph_commit_is_not_reported_as_a_zero_count_success(tmp_path):
    parser = service(tmp_path)
    parser.graph = RecordingGraph(fail=True)

    with pytest.raises(RuntimeError, match="Graph commit failed"):
        asyncio.run(parser._commit_graph_batch(
            [{"id": "n", "name": "node", "type": "Entity"}], [],
            time.monotonic() + 1,
        ))


def test_graph_batch_rolls_back_nodes_when_edge_insert_fails(tmp_path):
    parser = service(tmp_path)

    class EdgeFailGraph(RecordingGraph):
        def add_edges(self, records):
            raise RuntimeError("edge write failed")

    parser.graph = EdgeFailGraph()
    result = parser._add_batch_to_graph(
        [{"id": "n", "name": "node", "type": "Entity"}],
        [{"id": "e", "source_id": "n", "target_id": "n", "type": "REFERENCES"}],
    )
    assert result == {"nodes": 0, "edges": 0}
    assert parser.graph.nodes == [] and parser.graph.edges == []


def test_html_extraction_honors_every_flag_and_filters_link_schemes():
    html = """<html><head><title>T</title><meta name='description' content='D'></head>
    <body><h1>Heading</h1><p>Words</p><a href='/ok'>ok</a><a href='javascript:alert(1)'>bad</a></body></html>"""
    enabled = router._extract_document(html, "https://example.test/base", router.ExtractRequest())
    assert enabled["links"] == ["https://example.test/ok"]
    assert enabled["text"] and enabled["meta"] == {"description": "D"}
    assert enabled["headings"] == [{"level": 1, "text": "Heading"}]

    disabled = router._extract_document(
        html,
        None,
        router.ExtractRequest(extract_links=False, extract_text=False, extract_meta=False, extract_headings=False),
    )
    assert disabled == {"success": True, "title": "T", "url": None}


def test_extract_url_has_small_limit_independent_of_request_body_cap():
    assert router.MAX_EXTRACT_URL_LENGTH < router.MAX_EXTRACT_REQUEST_BYTES
    with pytest.raises(ValidationError):
        router.ExtractRequest(url="https://example.test/" + "x" * router.MAX_EXTRACT_URL_LENGTH)


def test_html_extraction_enforces_exact_aggregate_serialized_byte_cap(monkeypatch):
    monkeypatch.setattr(router, "MAX_EXTRACT_RESPONSE_BYTES", 650)
    base = "https://example.test/" + "b" * 180
    html = """<title>bounded</title><p>{text}</p>{links}
        <meta name='description' content='{meta}'><h1>{heading}</h1>""".format(
        text="t" * 300,
        links="".join("<a href='relative-{0}'>link</a>".format(i) for i in range(20)),
        meta="m" * 200,
        heading="h" * 200,
    )
    result = router._extract_document(html, base, router.ExtractRequest())
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    assert len(encoded) <= router.MAX_EXTRACT_RESPONSE_BYTES
    assert set(result) == {"success", "title", "url", "text", "links", "meta", "headings"}
    assert result["text"] == ""  # the whole oversized field is rejected
    assert result["links"]
    assert all(link.endswith(tuple("relative-{0}".format(i) for i in range(20))) for link in result["links"])


def test_html_extraction_checks_deadline_during_document_traversal(monkeypatch):
    ticks = iter(range(20))
    monkeypatch.setattr(router.time, "monotonic", lambda: next(ticks))

    with pytest.raises(asyncio.TimeoutError):
        router._extract_document(
            "".join("<div>value</div>" for _ in range(100)),
            None,
            router.ExtractRequest(
                extract_links=False, extract_meta=False, extract_headings=False
            ),
            deadline=5,
        )


def test_html_link_accounting_does_not_serialize_growing_response(monkeypatch):
    real_dumps = router.json.dumps
    response_serializations = 0

    def counting_dumps(value, *args, **kwargs):
        nonlocal response_serializations
        if isinstance(value, dict):
            response_serializations += 1
        return real_dumps(value, *args, **kwargs)

    monkeypatch.setattr(router.json, "dumps", counting_dumps)
    html = "".join("<a href='https://example.test/{0}'>x</a>".format(i) for i in range(1000))
    result = router._extract_document(
        html,
        None,
        router.ExtractRequest(
            extract_text=False, extract_meta=False, extract_headings=False
        ),
        deadline=time.monotonic() + 5,
    )

    assert len(result["links"]) == 1000
    assert response_serializations == 1


def test_timed_out_html_traversals_release_worker_capacity():
    html = "".join("<div>value</div>" for _ in range(20_000))
    request = router.ExtractRequest(
        extract_links=False, extract_meta=False, extract_headings=False
    )

    async def scenario():
        deadline = time.monotonic() + 0.01
        results = await asyncio.gather(
            *(
                router._run_html_worker(
                    router._extract_document, html, None, request, deadline,
                    deadline=deadline,
                )
                for _ in range(router.MAX_HTML_WORKERS)
            ),
            return_exceptions=True,
        )
        assert all(isinstance(result, asyncio.TimeoutError) for result in results)

        timeout = time.monotonic() + 2
        while router._html_tasks and time.monotonic() < timeout:
            await asyncio.sleep(0.01)
        assert not router._html_tasks

        later_deadline = time.monotonic() + 1
        result = await router._run_html_worker(
            router._extract_document, "<p>ok</p>", None, request, later_deadline,
            deadline=later_deadline,
        )
        assert result["text"] == "ok"

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "url",
    ["file:///etc/passwd", "ftp://example.test/a", "http://u:p@example.test/", "http:///missing"],
)
def test_url_validator_rejects_non_http_credentials_and_missing_hosts(url):
    with pytest.raises(ValueError, match="Only public HTTP"):
        asyncio.run(router._public_http_url(url))


@pytest.mark.parametrize(
    "url",
    ["http://[::1", "http://example.test:not-a-port/", "http://example.test:65536/"],
)
def test_url_validator_translates_malformed_authorities_to_policy_errors(monkeypatch, url):
    def unexpected_dns(*_args, **_kwargs):
        pytest.fail("malformed URLs must be rejected before DNS resolution")

    monkeypatch.setattr(router.socket, "getaddrinfo", unexpected_dns)

    with pytest.raises(router._ExtractPolicyError, match="Invalid HTTP"):
        asyncio.run(router._public_http_url(url))


@pytest.mark.parametrize("url", ["http://[::1", "http://example.test:65536/"])
def test_extract_returns_sanitized_422_for_malformed_url_authorities(url):
    response = asyncio.run(router.extract(router.ExtractRequest(url=url)))

    assert response.status_code == 422
    assert json.loads(response.body) == {"success": False, "error": "Content extraction failed"}


@pytest.mark.parametrize(
    "url",
    ["file:///etc/passwd", "http://u:p@example.test/", "http://127.0.0.1/private"],
)
def test_extract_validates_url_when_html_is_also_supplied(monkeypatch, url):
    async def denied(value, *, deadline=None):
        assert value == url
        assert deadline is not None
        raise router._ExtractPolicyError("private URL")

    monkeypatch.setattr(router, "_public_http_url", denied)
    response = asyncio.run(
        router.extract(router.ExtractRequest(url=url, html="<a href='/secret'>link</a>"))
    )

    assert response.status_code == 422
    assert json.loads(response.body) == {"success": False, "error": "Content extraction failed"}


def test_extract_uses_validated_url_as_base_without_fetching_supplied_html(monkeypatch):
    checked = []

    async def valid(value, *, deadline=None):
        checked.append((value, deadline))
        return router._PinnedURL("https://93.184.216.34/base/", "example.test", "example.test")

    async def unexpected_fetch(*_args, **_kwargs):
        pytest.fail("supplied HTML must not be replaced by a fetch")

    async def no_index(*_args, **_kwargs):
        return None

    monkeypatch.setattr(router, "_public_http_url", valid)
    monkeypatch.setattr(router, "_fetch_html", unexpected_fetch)
    monkeypatch.setattr(router, "_auto_index", no_index)

    result = asyncio.run(
        router.extract(
            router.ExtractRequest(
                url="https://example.test/base/", html="<a href='child'>link</a>"
            )
        )
    )

    assert len(checked) == 1 and checked[0][0] == "https://example.test/base/"
    assert checked[0][1] is not None
    assert result["url"] == "https://example.test/base/"
    assert result["links"] == ["https://example.test/base/child"]


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.1", "169.254.1.2", "::1", "192.0.2.1"])
def test_url_validator_rejects_non_global_dns_answers(monkeypatch, address):
    async def inline(function, *args):
        return function(*args)

    monkeypatch.setattr(router.asyncio, "to_thread", inline)
    monkeypatch.setattr(router.socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 80))])
    with pytest.raises(ValueError, match="non-public"):
        asyncio.run(router._public_http_url("http://example.test/"))


def test_url_validator_checks_every_dns_answer(monkeypatch):
    async def inline(function, *args):
        return function(*args)

    monkeypatch.setattr(router.asyncio, "to_thread", inline)
    answers = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80)),
    ]
    monkeypatch.setattr(router.socket, "getaddrinfo", lambda *a, **k: answers)
    with pytest.raises(ValueError, match="non-public"):
        asyncio.run(router._public_http_url("http://example.test/"))


def test_dns_timeout_retains_worker_until_resolver_finishes(monkeypatch):
    entered = threading.Event()
    release = threading.Event()
    monkeypatch.setattr(router, "_dns_slots", threading.BoundedSemaphore(1))
    monkeypatch.setattr(router, "_dns_tasks", set())

    def wedged(*args, **kwargs):
        entered.set()
        release.wait(1)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))]

    monkeypatch.setattr(router.socket, "getaddrinfo", wedged)

    async def scenario():
        with pytest.raises(asyncio.TimeoutError):
            await router._public_http_url("http://example.test", deadline=time.monotonic() + 0.01)
        assert entered.is_set() and len(router._dns_tasks) == 1
        with pytest.raises(router._ExtractCapacityError, match="capacity exhausted"):
            await router._public_http_url("http://other.test", deadline=time.monotonic() + 0.1)
        release.set()
        limit = time.monotonic() + 1
        while router._dns_tasks and time.monotonic() < limit:
            await asyncio.sleep(0.005)
        assert not router._dns_tasks
        assert router._dns_slots.acquire(blocking=False)
        router._dns_slots.release()

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(scenario())
    finally:
        release.set()
        loop.close()


def test_dns_resolution_concurrency_is_capped_without_queueing(monkeypatch):
    active = peak = 0
    release = asyncio.Event()
    monkeypatch.setattr(router, "_dns_slots", threading.BoundedSemaphore(2))
    monkeypatch.setattr(router, "_dns_tasks", set())

    monkeypatch.setattr(
        router.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))],
    )

    async def blocked_to_thread(function, *args):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await release.wait()
            return function(*args)
        finally:
            active -= 1
    monkeypatch.setattr(router.asyncio, "to_thread", blocked_to_thread)

    async def scenario():
        first = asyncio.create_task(router._public_http_url("http://one.test", deadline=time.monotonic() + 2))
        second = asyncio.create_task(router._public_http_url("http://two.test", deadline=time.monotonic() + 2))
        limit = time.monotonic() + 1
        while peak < 2 and time.monotonic() < limit:
            await asyncio.sleep(0.005)
        with pytest.raises(router._ExtractCapacityError, match="capacity exhausted"):
            await router._public_http_url("http://three.test", deadline=time.monotonic() + 0.05)
        assert len(router._dns_tasks) == 2 and peak == 2
        release.set()
        await asyncio.gather(first, second)

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(scenario())
    finally:
        release.set()
        loop.close()
    assert peak == 2 and not router._dns_tasks


class FakeResponse:
    def __init__(self, *, redirect=None, chunks=()):
        self.headers = {"location": redirect} if redirect else {}
        self.is_redirect = redirect is not None
        self.encoding = "utf-8"
        self._chunks = chunks

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    def raise_for_status(self):
        return None

    async def aiter_bytes(self):
        for chunk in self._chunks:
            yield chunk


def test_fetch_revalidates_redirect_and_disables_environment_proxies(monkeypatch):
    constructed = {}
    responses = [FakeResponse(redirect="http://127.0.0.1/secret")]

    class Client:
        def __init__(self, **kwargs):
            constructed.update(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def stream(self, *args, **kwargs):
            return responses.pop(0)

    checked = []

    async def validate(url):
        checked.append(url)
        if "127.0.0.1" in url:
            raise ValueError("non-public")
        return url

    monkeypatch.setattr(router.httpx, "AsyncClient", Client)
    monkeypatch.setattr(router, "_public_http_url", validate)
    with pytest.raises(ValueError, match="non-public"):
        asyncio.run(router._fetch_html("https://public.test/start"))
    assert checked == ["https://public.test/start", "http://127.0.0.1/secret"]
    assert constructed["follow_redirects"] is False and constructed["trust_env"] is False


def test_fetch_streams_with_strict_byte_cap(monkeypatch):
    extended_chunks = []

    class RecordingBytearray(bytearray):
        def extend(self, chunk):
            extended_chunks.append(chunk)
            super().extend(chunk)

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def stream(self, *args, **kwargs):
            return FakeResponse(chunks=(b"a" * router.MAX_DOWNLOAD_BYTES, b"x"))

    async def valid(url):
        return url

    monkeypatch.setattr(router, "bytearray", RecordingBytearray, raising=False)
    monkeypatch.setattr(router.httpx, "AsyncClient", Client)
    monkeypatch.setattr(router, "_public_http_url", valid)
    with pytest.raises(ValueError, match="byte limit"):
        asyncio.run(router._fetch_html("https://public.test/large"))
    assert len(extended_chunks) == 1
    assert len(extended_chunks[0]) == router.MAX_DOWNLOAD_BYTES


def test_fetch_applies_absolute_deadline_to_slow_stream(monkeypatch):
    class SlowResponse(FakeResponse):
        async def aiter_bytes(self):
            for chunk in (b"one", b"two"):
                await asyncio.sleep(0.02)
                yield chunk

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        def stream(self, *_args, **_kwargs):
            return SlowResponse()

    async def valid(url):
        return url

    monkeypatch.setattr(router.httpx, "AsyncClient", Client)
    monkeypatch.setattr(router, "_public_http_url", valid)
    started = time.monotonic()
    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(
            router._fetch_html(
                "https://public.test/slow",
                deadline=time.monotonic() + 0.025,
            )
        )
    assert time.monotonic() - started < 0.2


def test_fetch_pins_validated_address_while_preserving_host_and_sni(monkeypatch):
    captured = {}

    async def inline(function, *args):
        return function(*args)

    monkeypatch.setattr(router.asyncio, "to_thread", inline)
    monkeypatch.setattr(
        router.socket,
        "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))],
    )

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        def stream(self, method, url, **kwargs):
            captured.update(url=url, **kwargs)
            return FakeResponse(chunks=(b"ok",))

    monkeypatch.setattr(router.httpx, "AsyncClient", Client)
    assert asyncio.run(router._fetch_html("https://public.test/path?q=1")) == "ok"
    assert captured["url"] == "https://93.184.216.34/path?q=1"
    assert captured["headers"]["Host"] == "public.test"
    assert captured["extensions"]["sni_hostname"] == b"public.test"


def _request_with_chunks(chunks):
    chunks = iter(chunks)

    async def receive():
        try:
            body = next(chunks)
        except StopIteration:
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.request", "body": body, "more_body": True}

    return Request({"type": "http", "method": "POST", "path": "/extract", "headers": []}, receive)


def test_extract_raw_body_cap_precedes_json_decode_and_unknown_fields_are_forbidden():
    oversized = _request_with_chunks((b'{"html":"', b"x" * router.MAX_EXTRACT_REQUEST_BYTES))
    with pytest.raises(Exception) as exc:
        asyncio.run(router._read_extract_request(oversized))
    assert exc.value.status_code == 413

    extra = _request_with_chunks((b'{"html":"ok","unexpected":true}',))
    with pytest.raises(Exception) as exc:
        asyncio.run(router._read_extract_request(extra))
    assert exc.value.status_code == 422


def test_extract_rejects_oversized_chunk_before_appending_it(monkeypatch):
    extends = []

    class InstrumentedBuffer(bytearray):
        def extend(self, chunk):
            extends.append(chunk)
            super().extend(chunk)

    monkeypatch.setattr(router, "bytearray", InstrumentedBuffer, raising=False)
    prefix = b'{"html":"'
    oversized = b"x" * router.MAX_EXTRACT_REQUEST_BYTES
    request = _request_with_chunks((prefix, oversized))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(router._read_extract_request(request))

    assert exc.value.status_code == 413
    assert extends == [prefix]
    assert all(chunk is not oversized for chunk in extends)


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (ParsePythonRequest, {"code": "x", "unexpected": True}),
        (ParseJavaScriptRequest, {"code": "x", "unexpected": True}),
        (ParsePDFRequest, {"file_path": "x.pdf", "unexpected": True}),
        (ParseDirectoryRequest, {"directory": ".", "unexpected": True}),
    ],
)
def test_parser_request_models_forbid_unknown_fields(model, payload):
    with pytest.raises(ValidationError):
        model(**payload)


def test_parser_route_receive_limit_precedes_framework_decode():
    request = _request_with_chunks((b'{"code":"', b"x" * router.MAX_PARSER_REQUEST_BYTES))
    limited = router._limited_receive(request.receive, router.MAX_PARSER_REQUEST_BYTES)

    assert asyncio.run(limited())["body"] == b'{"code":"'
    with pytest.raises(Exception) as exc:
        asyncio.run(limited())
    assert exc.value.status_code == 413
    assert all(isinstance(route, router._BodyLimitedRoute) for route in router.router.routes)


def test_extract_returns_stable_sanitized_failure_and_success_shape(monkeypatch):
    async def inline(function, *args):
        return function(*args)

    monkeypatch.setattr(router.asyncio, "to_thread", inline)

    async def denied(_url):
        raise router._ExtractPolicyError("secret resolver detail")

    monkeypatch.setattr(router, "_fetch_html", denied)
    failed = asyncio.run(router.extract(router.ExtractRequest(url="https://example.test")))
    assert failed.status_code == 422
    assert json.loads(failed.body) == {"success": False, "error": "Content extraction failed"}

    async def no_index(*_args, **_kwargs):
        return None

    monkeypatch.setattr(router, "_auto_index", no_index)
    success = asyncio.run(router.extract(router.ExtractRequest(html="<title>ok</title><p>body</p>")))
    assert success["success"] is True
    assert success["title"] == "ok"
    assert success["url"] is None


@pytest.mark.parametrize(
    ("failure", "status", "error"),
    [
        (router._ExtractPolicyError("private policy detail"), 422, "Content extraction failed"),
        (router._ExtractCapacityError("private capacity detail"), 503, "Content extraction failed"),
        (router._ExtractUpstreamError("private upstream detail"), 502, "Content extraction failed"),
        (httpx.ConnectError("private connection detail"), 502, "Content extraction failed"),
        (asyncio.TimeoutError("private deadline detail"), 504, "Content extraction failed"),
        (RuntimeError("private parser detail"), 500, "Parser failure"),
    ],
)
def test_extract_failures_use_stable_transport_statuses(monkeypatch, failure, status, error):
    async def fail(_url):
        raise failure

    monkeypatch.setattr(router, "_fetch_html", fail)
    response = asyncio.run(router.extract(router.ExtractRequest(url="https://example.test")))

    assert response.status_code == status
    assert json.loads(response.body) == {"success": False, "error": error}


def test_extract_missing_content_is_an_input_rejection():
    response = asyncio.run(router.extract(router.ExtractRequest()))

    assert response.status_code == 422
    assert json.loads(response.body) == {"success": False, "error": "No content"}


@pytest.mark.asyncio
async def test_extract_auto_index_is_bounded_awaited_and_best_effort(monkeypatch, caplog):
    active = 0
    peak = 0
    release = asyncio.Event()

    async def slow_index(*_args, **_kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await release.wait()
            raise RuntimeError("index detail")
        finally:
            active -= 1

    monkeypatch.setattr(router, "_auto_index", slow_index)
    requests = [
        asyncio.create_task(router.extract(router.ExtractRequest(html=f"<p>{i}</p>")))
        for i in range(router.MAX_AUTO_INDEX_ADMISSIONS * 2)
    ]
    await asyncio.sleep(0.05)
    assert peak <= router.MAX_AUTO_INDEX_ADMISSIONS
    release.set()
    results = await asyncio.gather(*requests)
    assert all(result["success"] for result in results)
    assert active == 0
    assert not [task for task in asyncio.all_tasks() if task is not asyncio.current_task() and not task.done()]
    assert "HTML auto-indexing failed" in caplog.text


@pytest.mark.asyncio
async def test_extract_index_timeout_leaves_no_pending_task(monkeypatch):
    cancelled = asyncio.Event()

    async def never_index(*_args, **_kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(router, "MAX_EXTRACT_SECONDS", 0.02)
    monkeypatch.setattr(router, "_auto_index", never_index)
    result = await router.extract(router.ExtractRequest(html="<p>ok</p>"))

    assert result["success"] is True
    assert cancelled.is_set()
    assert not [task for task in asyncio.all_tasks() if task is not asyncio.current_task() and not task.done()]


class _FailingParserService:
    def __init__(self, error: str):
        self.error = error

    async def parse_python(self, _request):
        return {"error": self.error}

    async def parse_pdf(self, _request):
        return {"error": self.error}

    async def parse_javascript(self, _request):
        return {"error": self.error}

    async def parse_directory(self, _request):
        return {"error": self.error}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("endpoint", "parser_request", "error", "status", "indexed"),
    [
        (router.parse_python, router.ParsePythonRequest(code="print(1)"), "Invalid or disallowed file path", 422, None),
        (router.parse_pdf, router.ParsePDFRequest(file_path="/tmp/x.pdf"), "PDF parser unavailable", 503, None),
        (router.parse_js, router.ParseJavaScriptRequest(code="1"), "Parser response exceeds serialized byte limit", 413, None),
        (router.parse_dir, router.ParseDirectoryRequest(directory="/tmp"), "Directory parser failed", 500, None),
        (router.index_codebase, router.ParseDirectoryRequest(directory="/tmp"), "Directory parser failed", 500, False),
    ],
)
async def test_parser_service_failures_use_http_failure_statuses(endpoint, parser_request, error, status, indexed):
    response = await endpoint(parser_request, _FailingParserService(error))

    assert response.status_code == status
    body = json.loads(response.body)
    assert body["success"] is False
    assert body["error"] == error
    if indexed is not None:
        assert body["indexed"] is indexed


class _DirectoryResultService:
    def __init__(self, result):
        self.result = result

    async def parse_directory(self, _request):
        await asyncio.sleep(0)
        return dict(self.result)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("result", "indexed"),
    [
        ({"files_parsed": 1, "nodes_added": 0, "edges_added": 0,
          "errors": ["broken.py: File parsing failed"]}, False),
        ({"files_parsed": 0, "nodes_added": 0, "edges_added": 0, "errors": []}, True),
        ({"files_parsed": 1, "nodes_added": 2, "edges_added": 1, "errors": []}, True),
    ],
)
async def test_index_codebase_reports_completion_only_for_error_free_results(result, indexed):
    response = await router.index_codebase(
        router.ParseDirectoryRequest(directory="/tmp"), _DirectoryResultService(result)
    )

    assert response["success"] is True
    assert response["indexed"] is indexed


@pytest.mark.asyncio
async def test_concurrent_index_codebase_results_cannot_forge_each_others_completion():
    failed, succeeded = await asyncio.gather(
        router.index_codebase(
            router.ParseDirectoryRequest(directory="/tmp/failed"),
            _DirectoryResultService({
                "nodes_added": 0, "edges_added": 0,
                "errors": ["source.py: File parsing failed"], "indexed": True,
            }),
        ),
        router.index_codebase(
            router.ParseDirectoryRequest(directory="/tmp/succeeded"),
            _DirectoryResultService({
                "nodes_added": 1, "edges_added": 0, "errors": [], "indexed": False,
            }),
        ),
    )

    assert failed["indexed"] is False
    assert succeeded["indexed"] is True
