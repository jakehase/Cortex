"""
Parser Service - Business logic for file parsing operations.
"""

import asyncio
import fnmatch
import os
import time
import threading
import json
import copy
import logging
import inspect
import stat
import re
from typing import Dict, Any, List
from pathlib import Path
from cortex_server.parsers.python_parser import PythonParser, ParserConfig
from cortex_server.parsers.pdf_parser import PDFParser, PDFParserConfig
from cortex_server.parsers.js_parser import JSParser, JSParserConfig
from cortex_server.models.requests import (
    ParsePythonRequest, ParsePDFRequest, ParseJavaScriptRequest, ParseDirectoryRequest
)
from cortex_server.knowledge.graph import Graph, Node, Edge, NodeType, EdgeType


logger = logging.getLogger(__name__)


class ParserService:
    """Service for parsing files and extracting knowledge."""
    
    MAX_FILES = 1000
    MAX_TOTAL_BYTES = 50_000_000
    MAX_RECORDS = 20_000
    MAX_RESPONSE_BYTES = 8_000_000
    MAX_SECONDS = 30.0
    MAX_WORKERS = 4
    MAX_VISITED_ENTRIES = 10_000

    def __init__(self, workspace_roots=None):
        configured = (os.getenv("CORTEX_WORKSPACE_ROOTS", os.getcwd()).split(os.pathsep)
                      if workspace_roots is None else workspace_roots)
        self.workspace_roots = tuple(Path(p).expanduser().resolve() for p in configured if p)
        self.python_parser = PythonParser(ParserConfig())
        self.pdf_parser = None
        self.pdf_parser_error = None
        try:
            self.pdf_parser = PDFParser(PDFParserConfig())
        except Exception as exc:
            logger.error("PDF parser initialization failed (%s)", type(exc).__name__)
            self.pdf_parser_error = type(exc).__name__
        self.js_parser = JSParser(JSParserConfig())
        self.graph = Graph()
        self._worker_slots = threading.BoundedSemaphore(self.MAX_WORKERS)
        self._worker_tasks = set()

    def _safe_path(self, value: str, *, directory: bool = False) -> Path:
        path = Path(value).expanduser().resolve(strict=True)
        if not any(path == root or path.is_relative_to(root) for root in self.workspace_roots):
            raise ValueError("Path is outside configured workspace roots")
        if directory and not path.is_dir():
            raise ValueError("Path is not a directory")
        if not directory and not path.is_file():
            raise ValueError("Path is not a file")
        return path

    def _read_workspace_snapshot(self, value: str, limit: int) -> tuple[bytes, str]:
        """Open once beneath a workspace root and return a bounded immutable snapshot."""
        requested = Path(value).expanduser()
        resolved = requested.resolve(strict=True)
        root = next(
            (candidate for candidate in self.workspace_roots
             if resolved != candidate and resolved.is_relative_to(candidate)),
            None,
        )
        if root is None:
            raise ValueError("Path is outside configured workspace roots")
        expected = resolved.stat()
        if not stat.S_ISREG(expected.st_mode):
            raise ValueError("Path is not a file")

        root_fd = os.open(
            root,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        current_fd = root_fd
        try:
            parts = resolved.relative_to(root).parts
            for index, part in enumerate(parts):
                flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                if index < len(parts) - 1:
                    flags |= getattr(os, "O_DIRECTORY", 0)
                next_fd = os.open(part, flags, dir_fd=current_fd)
                if current_fd != root_fd:
                    os.close(current_fd)
                current_fd = next_fd

            opened = os.fstat(current_fd)
            if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (expected.st_dev, expected.st_ino):
                raise ValueError("File changed while being opened")
            proc_link = f"/proc/self/fd/{current_fd}"
            if os.path.exists(proc_link):
                opened_path = Path(os.path.realpath(proc_link))
                if not (opened_path == root or opened_path.is_relative_to(root)):
                    raise ValueError("Opened file is outside configured workspace roots")

            chunks = []
            remaining = limit + 1
            while remaining:
                chunk = os.read(current_fd, min(64 * 1024, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            return b"".join(chunks), str(resolved)
        finally:
            if current_fd != root_fd:
                os.close(current_fd)
            os.close(root_fd)

    def _track_worker(self, task: asyncio.Task) -> asyncio.Task:
        workers = getattr(self, "_worker_tasks", None)
        if workers is None:
            workers = self._worker_tasks = set()
        workers.add(task)

        def finished(done: asyncio.Task) -> None:
            workers.discard(done)
            if not done.cancelled():
                done.exception()

        task.add_done_callback(finished)
        return task

    async def _run(self, function, *args, deadline=None):
        """Run with fresh parser state and retain admission until a timed-out thread exits."""
        if deadline is not None and time.monotonic() >= deadline:
            raise asyncio.TimeoutError
        slots = getattr(self, "_worker_slots", None)
        if slots is None:
            slots = self._worker_slots = threading.BoundedSemaphore(self.MAX_WORKERS)
        if not slots.acquire(blocking=False):
            raise asyncio.TimeoutError("Parser worker capacity exhausted")

        owner = getattr(function, "__self__", None)
        method_name = getattr(function, "__name__", None)
        bound_function = getattr(function, "__func__", None)
        if owner is not None and bound_function is not None:
            method_name = next(
                (name for name in dir(type(owner)) if getattr(type(owner), name, None) is bound_function),
                method_name,
            )

        fresh_parser = isinstance(owner, (PythonParser, JSParser, PDFParser))

        def invoke():
            try:
                if isinstance(owner, PythonParser):
                    return getattr(PythonParser(copy.deepcopy(owner.config)), method_name)(*args)
                if isinstance(owner, JSParser):
                    return getattr(JSParser(copy.deepcopy(owner.config)), method_name)(*args)
                if isinstance(owner, PDFParser):
                    return getattr(PDFParser(copy.deepcopy(owner.config)), method_name)(*args)
                return function(*args)
            finally:
                slots.release()

        if fresh_parser:
            task = self._track_worker(asyncio.create_task(asyncio.to_thread(invoke)))
        else:
            task = self._track_worker(asyncio.create_task(asyncio.to_thread(function, *args)))
            task.add_done_callback(lambda _done: slots.release())
        timeout = self.MAX_SECONDS
        if deadline is not None:
            timeout = max(0.0, min(timeout, deadline - time.monotonic()))
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
        except asyncio.TimeoutError:
            raise

    async def _run_directory_file(self, function, argument, deadline):
        """Pass the aggregate deadline while tolerating legacy test/service overrides."""
        if "deadline" in inspect.signature(self._run).parameters:
            return await self._run(function, argument, deadline=deadline)
        return await self._run(function, argument)

    async def _run_with_deadline(self, function, *args, deadline):
        """Pass a request deadline while tolerating lightweight test overrides."""
        if "deadline" in inspect.signature(self._run).parameters:
            return await self._run(function, *args, deadline=deadline)
        return await self._run(function, *args)

    @staticmethod
    def _parser_limit(parser, default: int) -> int:
        return getattr(getattr(parser, "config", None), "max_file_bytes", default) or default

    async def _parse_snapshot(self, parser, raw: bytes, display_path: str, deadline):
        """Use snapshot-aware production parsers; retain lightweight test adapter support."""
        parse_bytes = getattr(parser, "parse_bytes", None)
        if parse_bytes is not None:
            return await self._run_with_deadline(parse_bytes, raw, display_path, deadline=deadline)
        return await self._run_directory_file(parser.parse_file, display_path, deadline)

    async def _workspace_snapshot(self, value: str, limit: int, deadline):
        return await self._run_with_deadline(
            self._read_workspace_snapshot, value, limit, deadline=deadline
        )

    async def _commit_graph_batch(self, nodes, edges, deadline, max_records=None):
        if time.monotonic() >= deadline:
            raise asyncio.TimeoutError
        slots = getattr(self, "_worker_slots", None)
        if slots is None:
            slots = self._worker_slots = threading.BoundedSemaphore(self.MAX_WORKERS)
        if not slots.acquire(blocking=False):
            raise asyncio.TimeoutError("Parser worker capacity exhausted")
        cancelled = threading.Event()
        arguments = (nodes, edges) if max_records is None else (nodes, edges, max_records)

        def commit():
            try:
                if cancelled.is_set() or time.monotonic() >= deadline:
                    raise TimeoutError("graph commit deadline exceeded")
                return self._add_batch_to_graph(
                    *arguments, deadline=deadline, cancelled=cancelled
                )
            finally:
                slots.release()

        # Preserve the wrapped operation name for instrumentation and test adapters.
        commit.__name__ = "_add_batch_to_graph"

        try:
            worker = self._track_worker(asyncio.create_task(asyncio.to_thread(commit)))
        except BaseException:
            slots.release()
            raise
        try:
            committed = await asyncio.wait_for(
                asyncio.shield(worker), max(0.0, deadline - time.monotonic())
            )
            attempted = len(nodes) + len(edges)
            allowed = attempted if max_records is None else min(attempted, max(0, max_records))
            if allowed and committed["nodes"] + committed["edges"] == 0:
                raise RuntimeError("Graph commit failed")
            return committed
        except BaseException as failure:
            cancelled.set()
            # A failed request cannot outlive its writer: rollback and worker exit
            # are observed before timeout/cancellation is returned to the caller.
            await asyncio.shield(asyncio.gather(worker, return_exceptions=True))
            raise failure

    @staticmethod
    def _public_pdf_error(detail: str) -> str:
        if re.fullmatch(r"PDF(?: text)? exceeds \d+ (?:byte|page) limit", detail or ""):
            return detail
        logger.error("PDF parser reported an internal failure")
        return "PDF parsing failed"

    def _cap_response_collections(
        self, payload: Dict[str, Any], fields, *, reserved_fields=None, deadline=None
    ) -> Dict[str, Any]:
        """Retain whole records while accounting for the complete response object."""
        reserved_fields = dict(reserved_fields or {})
        if payload.keys() & reserved_fields.keys():
            raise ValueError("Reserved response fields overlap parser payload")
        source = {field: list(payload.get(field) or []) for field in fields}
        field_set = set(fields)
        scalar_json = {
            key: json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
            for key, value in {**reserved_fields, **payload}.items() if key not in field_set
        }
        record_json = {}
        for field in fields:
            encoded = []
            for record in source[field]:
                if deadline is not None and time.monotonic() >= deadline:
                    raise asyncio.TimeoutError
                encoded.append(json.dumps(record, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8"))
                if deadline is not None and time.monotonic() >= deadline:
                    raise asyncio.TimeoutError
            record_json[field] = encoded

        key_sizes = {
            key: len(json.dumps(key, ensure_ascii=False).encode("utf-8"))
            for key in (*reserved_fields.keys(), *payload.keys(), "response_truncated")
        }

        def empty_size(marker=False):
            value_count = len(scalar_json) + len(fields) + int(marker)
            size = 2 + max(0, value_count - 1)
            size += sum(key_sizes[key] + 1 + len(value) for key, value in scalar_json.items())
            size += sum(key_sizes[field] + 1 + 2 for field in fields)
            if marker:
                size += key_sizes["response_truncated"] + 1 + len(b"true")
            return size

        def records_size(counts, marker=False):
            return empty_size(marker) + sum(
                sum(len(record) for record in record_json[field][:counts[field]])
                + max(0, counts[field] - 1)
                for field in fields
            )

        all_counts = {field: len(source[field]) for field in fields}
        if records_size(all_counts) <= self.MAX_RESPONSE_BYTES:
            return dict(payload)

        counts = {field: 0 for field in fields}
        current_size = empty_size(marker=True)
        if current_size > self.MAX_RESPONSE_BYTES:
            return {"error": "Parser response exceeds serialized byte limit"}
        for field in fields:
            for encoded in record_json[field]:
                increment = len(encoded) + int(counts[field] > 0)
                if current_size + increment > self.MAX_RESPONSE_BYTES:
                    break
                current_size += increment
                counts[field] += 1
        capped = dict(payload)
        for field in fields:
            capped[field] = source[field][:counts[field]]
        capped["response_truncated"] = True
        return capped
    
    async def parse_python(self, request: ParsePythonRequest) -> Dict[str, Any]:
        """Parse Python code or file."""
        deadline = time.monotonic() + self.MAX_SECONDS
        if request.file_path:
            try:
                raw, path = await self._workspace_snapshot(request.file_path, self._parser_limit(self.python_parser, 2_000_000), deadline)
            except asyncio.TimeoutError:
                raise
            except (OSError, ValueError):
                return {"error": "Invalid or disallowed file path"}
            result = await self._parse_snapshot(self.python_parser, raw, path, deadline)
        elif request.code:
            result = await self._parse_snapshot(self.python_parser, request.code.encode(), "<input>.py", deadline)
        else:
            return {"error": "Either file_path or code must be provided"}
        
        payload = self._cap_response_collections({
            "nodes": result.nodes,
            "edges": result.edges,
            "errors": [{"filepath": e.filepath, "message": e.message, "lineno": e.lineno, "col": e.col} for e in result.errors],
            "ok": result.ok,
            "nodes_added": self.MAX_RECORDS,
            "edges_added": self.MAX_RECORDS,
        }, ("nodes", "edges", "errors"),
            reserved_fields={"success": True, "parsed": "python"}, deadline=deadline)
        if "error" in payload:
            return payload
        committed = await self._commit_graph_batch(payload["nodes"], payload["edges"], deadline)
        payload.update(nodes_added=committed["nodes"], edges_added=committed["edges"])
        return payload
    
    async def parse_pdf(self, request: ParsePDFRequest) -> Dict[str, Any]:
        """Parse PDF file."""
        deadline = time.monotonic() + self.MAX_SECONDS
        if self.pdf_parser is None:
            return {"error": "PDF parser unavailable"}
        try:
            raw, path = await self._workspace_snapshot(request.file_path, self._parser_limit(self.pdf_parser, 20_000_000), deadline)
        except asyncio.TimeoutError:
            raise
        except (OSError, ValueError):
            return {"error": "Invalid or disallowed file path"}
        try:
            result = await self._parse_snapshot(self.pdf_parser, raw, path, deadline)
        except asyncio.TimeoutError:
            raise
        except Exception as exc:
            logger.error("PDF parser failed (%s)", type(exc).__name__)
            return {"error": "PDF parsing failed"}
        
        if result.error:
            return {"error": self._public_pdf_error(result.error)}
        if not request.extract_structure:
            for page in result.pages:
                page.get("metadata", {}).pop("structures", None)
        
        payload = self._cap_response_collections(
            result.to_dict(), ("pages",),
            reserved_fields={"success": True, "parsed": "pdf"}, deadline=deadline,
        )
        if "error" in payload:
            return payload
        if result.document:
            pages = payload["pages"]
            edges = [{"id": f"CONTAINS:{result.document['id']}:{page['id']}", "type": "CONTAINS", "source_id": result.document["id"], "target_id": page["id"]} for page in pages]
            await self._commit_graph_batch([result.document, *pages], edges, deadline)
        return payload
    
    async def parse_javascript(self, request: ParseJavaScriptRequest) -> Dict[str, Any]:
        """Parse JavaScript/TypeScript code or file."""
        deadline = time.monotonic() + self.MAX_SECONDS
        if request.file_path:
            try:
                raw, path = await self._workspace_snapshot(request.file_path, self._parser_limit(self.js_parser, 2_000_000), deadline)
            except asyncio.TimeoutError:
                raise
            except (OSError, ValueError):
                return {"error": "Invalid or disallowed file path"}
            result = await self._parse_snapshot(self.js_parser, raw, path, deadline)
        elif request.code:
            result = await self._parse_snapshot(self.js_parser, request.code.encode(), "<input>.js", deadline)
        else:
            return {"error": "Either file_path or code must be provided"}
        
        payload = self._cap_response_collections({
            "nodes": result.nodes,
            "edges": result.edges,
            "errors": [{"filepath": e.filepath, "message": e.message, "lineno": e.lineno} for e in result.errors],
            "ok": result.ok,
            "nodes_added": self.MAX_RECORDS,
            "edges_added": self.MAX_RECORDS,
        }, ("nodes", "edges", "errors"),
            reserved_fields={"success": True, "parsed": "javascript"}, deadline=deadline)
        if "error" in payload:
            return payload
        committed = await self._commit_graph_batch(payload["nodes"], payload["edges"], deadline)
        payload.update(nodes_added=committed["nodes"], edges_added=committed["edges"])
        return payload
    
    async def parse_directory(self, request: ParseDirectoryRequest) -> Dict[str, Any]:
        """Parse all files in a directory."""
        try:
            path = self._safe_path(request.directory, directory=True)
        except (OSError, ValueError):
            return {"error": "Invalid or disallowed directory path"}
        started = time.monotonic()
        deadline = started + self.MAX_SECONDS
        total_bytes = 0
        records_remaining = self.MAX_RECORDS
        
        results = {
            "files_parsed": 0,
            "files_seen": 0,
            "files_skipped": 0,
            "nodes_added": 0,
            "edges_added": 0,
            "errors": [],
            "extensions": {},
        }
        
        exclude_patterns = request.exclude_patterns or []

        def excluded(candidate: Path) -> bool:
            rel = str(candidate.relative_to(path)) if candidate.is_relative_to(path) else str(candidate)
            normalized = rel.replace("\\", "/")
            parts = set(normalized.split("/"))
            if {".git", "node_modules", "artifacts", "tmp", "dist", "coverage", "__pycache__", ".venv", "venv"} & parts:
                return True
            return any(fnmatch.fnmatch(normalized, pat) for pat in exclude_patterns)

        def enumerate_files():
            """Discover a bounded, deterministic batch without blocking the event loop."""
            files = []
            skipped = 0
            visited = 0
            limited = False
            directories = [(path, 0)]
            while directories:
                current, depth = directories.pop()
                if time.monotonic() >= deadline:
                    limited = True
                    break
                entries = []
                try:
                    with os.scandir(current) as scan:
                        for entry in scan:
                            if time.monotonic() >= deadline:
                                limited = True
                                break
                            visited += 1
                            if visited > self.MAX_VISITED_ENTRIES:
                                limited = True
                                break
                            entries.append(entry)
                except OSError as exc:
                    logger.error(
                        "Unable to enumerate parser directory (%s)",
                        type(exc).__name__,
                    )
                    continue
                if limited:
                    break
                entries.sort(key=lambda entry: entry.name)
                child_directories = []
                for entry in entries:
                    if time.monotonic() >= deadline:
                        limited = True
                        break
                    candidate = current / entry.name
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if request.recursive and depth < 10 and not excluded(candidate):
                                child_directories.append((candidate, depth + 1))
                            continue
                        if not entry.is_file(follow_symlinks=True):
                            continue
                        resolved = self._safe_path(str(candidate))
                        size = resolved.stat().st_size
                    except (OSError, ValueError):
                        skipped += 1
                        continue
                    files.append((candidate, resolved, size))
                    if len(files) > self.MAX_FILES:
                        limited = True
                        break
                if limited:
                    break
                # Stack reversal preserves the old sorted os.walk traversal.
                directories.extend(reversed(child_directories))
                if not request.recursive:
                    break
            return files, skipped, limited

        try:
            file_rows, discovery_skipped, discovery_limited = await self._run_with_deadline(
                enumerate_files, deadline=deadline
            )
        except asyncio.TimeoutError:
            return {**results, "errors": ["Directory parsing limit exceeded"]}
        results["files_skipped"] += discovery_skipped

        for file_path, resolved, _size in file_rows[:self.MAX_FILES]:
            if records_remaining <= 0:
                results["errors"].append("Directory record limit exceeded")
                break
            if time.monotonic() >= deadline:
                results["errors"].append("Directory parsing limit exceeded")
                break
            results["files_seen"] += 1
            if excluded(file_path):
                results["files_skipped"] += 1
                continue
            try:
                ext = file_path.suffix.lower()
                results["extensions"][ext or "<none>"] = results["extensions"].get(ext or "<none>", 0) + 1

                if ext == ".py":
                    per_file_limit = min(self._parser_limit(self.python_parser, 2_000_000), self.MAX_TOTAL_BYTES - total_bytes)
                    raw, display_path = await self._workspace_snapshot(str(file_path), per_file_limit, deadline)
                    if len(raw) > per_file_limit:
                        results["errors"].append("Directory byte limit exceeded")
                        break
                    total_bytes += len(raw)
                    result = await self._parse_snapshot(self.python_parser, raw, display_path, deadline)
                    committed = await self._commit_graph_batch(result.nodes, result.edges, deadline, records_remaining)
                    results["nodes_added"] += committed["nodes"]
                    results["edges_added"] += committed["edges"]
                    records_remaining -= committed["nodes"] + committed["edges"]
                    results["files_parsed"] += 1

                elif ext in (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
                    per_file_limit = min(self._parser_limit(self.js_parser, 2_000_000), self.MAX_TOTAL_BYTES - total_bytes)
                    raw, display_path = await self._workspace_snapshot(str(file_path), per_file_limit, deadline)
                    if len(raw) > per_file_limit:
                        results["errors"].append("Directory byte limit exceeded")
                        break
                    total_bytes += len(raw)
                    result = await self._parse_snapshot(self.js_parser, raw, display_path, deadline)
                    committed = await self._commit_graph_batch(result.nodes, result.edges, deadline, records_remaining)
                    results["nodes_added"] += committed["nodes"]
                    results["edges_added"] += committed["edges"]
                    records_remaining -= committed["nodes"] + committed["edges"]
                    results["files_parsed"] += 1

                elif ext == ".pdf":
                    if self.pdf_parser is None:
                        results["files_skipped"] += 1
                        continue
                    per_file_limit = min(self._parser_limit(self.pdf_parser, 20_000_000), self.MAX_TOTAL_BYTES - total_bytes)
                    raw, display_path = await self._workspace_snapshot(str(file_path), per_file_limit, deadline)
                    if len(raw) > per_file_limit:
                        results["errors"].append("Directory byte limit exceeded")
                        break
                    total_bytes += len(raw)
                    result = await self._parse_snapshot(self.pdf_parser, raw, display_path, deadline)
                    if not result.error and result.document:
                        committed = await self._commit_graph_batch(
                            [result.document, *result.pages], [], deadline, records_remaining
                        )
                        results["nodes_added"] += committed["nodes"]
                        records_remaining -= committed["nodes"]
                        results["files_parsed"] += 1
                else:
                    results["files_skipped"] += 1

            except asyncio.TimeoutError:
                results["errors"].append("Directory parsing limit exceeded")
                break
            except Exception as exc:
                identifier = file_path.relative_to(path).as_posix()
                logger.error(
                    "Failed to parse directory file (%s)",
                    type(exc).__name__,
                )
                results["errors"].append(f"{identifier}: File parsing failed")

        if discovery_limited and "Directory parsing limit exceeded" not in results["errors"]:
            results["errors"].append("Directory parsing limit exceeded")
        
        try:
            results["graph"] = self.graph.stats()
        except Exception:
            pass
        return results
    
    def _add_node_to_graph(self, node_data: Dict[str, Any]) -> None:
        """Add a parsed node to the knowledge graph."""
        self.graph.add_node(self._node_from_data(node_data))

    def _node_from_data(self, node_data: Dict[str, Any]) -> Node:
        """Convert parsed node data to a graph Node."""
        try:
            node_type = NodeType(node_data.get("type", "Entity"))
        except ValueError:
            node_type = NodeType.ENTITY
        
        return Node(
            id=node_data["id"],
            type=node_type,
            name=node_data.get("name", "unknown"),
            uri=node_data.get("uri"),
            language=node_data.get("language"),
            metadata=node_data.get("metadata", {}),
        )
    
    def _add_edge_to_graph(self, edge_data: Dict[str, Any]) -> None:
        """Add a parsed edge to the knowledge graph."""
        self.graph.add_edge(self._edge_from_data(edge_data))

    def _edge_from_data(self, edge_data: Dict[str, Any]) -> Edge:
        """Convert parsed edge data to a graph Edge."""
        try:
            edge_type = EdgeType(edge_data.get("type", "REFERENCES"))
        except ValueError:
            edge_type = EdgeType.REFERENCES
        
        return Edge(
            id=edge_data["id"],
            type=edge_type,
            source_id=edge_data["source_id"],
            target_id=edge_data["target_id"],
            metadata=edge_data.get("metadata", {}),
        )

    def _add_batch_to_graph(
        self,
        node_data: List[Dict[str, Any]],
        edge_data: List[Dict[str, Any]],
        max_records: int = None,
        *,
        deadline: float = None,
        cancelled=None,
    ) -> Dict[str, int]:
        """Add parsed graph data using batched SQLite writes."""
        cancelled = cancelled or threading.Event()
        deadline = float("inf") if deadline is None else deadline

        def check_active() -> None:
            if cancelled.is_set() or time.monotonic() >= deadline:
                raise TimeoutError("graph commit deadline exceeded")

        nodes: List[Node] = []
        edges: List[Edge] = []
        try:
            check_active()
            for item in node_data:
                check_active()
                nodes.append(self._node_from_data(item))
            for item in edge_data:
                check_active()
                edges.append(self._edge_from_data(item))
        except Exception:
            if cancelled.is_set() or time.monotonic() >= deadline:
                raise TimeoutError("graph commit deadline exceeded")
            # Never commit a misleading subset when parser output is malformed.
            return {"nodes": 0, "edges": 0}
        record_limit = self.MAX_RECORDS if max_records is None else max(0, max_records)
        nodes = nodes[:record_limit]
        remaining = max(0, record_limit - len(nodes))
        edges = edges[:remaining]
        check_active()
        atomic_write = getattr(self.graph, "write_batch_atomic", None)
        if atomic_write is not None:
            try:
                atomic_write(nodes, edges, deadline=deadline, cancelled=cancelled)
            except Exception:
                if cancelled.is_set() or time.monotonic() >= deadline:
                    raise TimeoutError("graph commit deadline exceeded")
                return {"nodes": 0, "edges": 0}
        else:
            # Non-storage graph adapters must expose rollbackable list state.
            old_nodes = list(getattr(self.graph, "nodes", ()))
            old_edges = list(getattr(self.graph, "edges", ()))
            try:
                self.graph.add_nodes(nodes)
                if cancelled.is_set() or time.monotonic() >= deadline:
                    raise TimeoutError("graph commit deadline exceeded")
                self.graph.add_edges(edges)
                if cancelled.is_set() or time.monotonic() >= deadline:
                    raise TimeoutError("graph commit deadline exceeded")
            except Exception:
                if hasattr(self.graph, "nodes"):
                    self.graph.nodes[:] = old_nodes
                if hasattr(self.graph, "edges"):
                    self.graph.edges[:] = old_edges
                if cancelled.is_set() or time.monotonic() >= deadline:
                    raise TimeoutError("graph commit deadline exceeded")
                return {"nodes": 0, "edges": 0}
        return {"nodes": len(nodes), "edges": len(edges)}
