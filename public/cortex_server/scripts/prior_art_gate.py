#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from cortex_server.modules.prior_art_gate import build_prior_art_gate, extract_prior_art_terms  # noqa: E402


def _read_text(path: Path, max_chars: int = 2000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:max_chars]
    except Exception:
        return ""


def _scan_files(terms: List[str], roots: List[Path], limit: int = 50) -> List[Dict[str, Any]]:
    matches: List[Dict[str, Any]] = []
    suffixes = {".py", ".mjs", ".js", ".ts", ".md", ".json"}
    skip_parts = {".git", "node_modules", "__pycache__", ".pytest_cache"}
    lowered_terms = [term.lower() for term in terms if term]
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if len(matches) >= limit:
                return matches
            if not path.is_file() or path.suffix.lower() not in suffixes:
                continue
            if any(part in skip_parts for part in path.parts):
                continue
            rel = str(path)
            haystack = rel.lower()
            text = ""
            if not any(term in haystack for term in lowered_terms):
                text = _read_text(path, max_chars=2500)
                haystack = f"{haystack}\n{text.lower()}"
            hit_terms = [term for term in lowered_terms if term in haystack]
            if not hit_terms:
                continue
            matches.append({
                "path": str(path),
                "snippet": (text or _read_text(path, max_chars=800))[:800],
                "matchedTerms": hit_terms[:8],
            })
    return matches


def _memory_results(query: str, n: int) -> List[Dict[str, Any]]:
    try:
        from cortex_server.routers.librarian import robust_search

        out = robust_search(query, n_results=n, allow_fallback=True)
        return out.get("results", []) or []
    except Exception:
        return []


def _structural_results(terms: List[str], limit: int) -> List[Dict[str, Any]]:
    try:
        from cortex_server.services.knowledge_service import KnowledgeService

        service = KnowledgeService()
        rows = []
        seen = set()
        for term in terms[:8]:
            for node in service.graph.query(name_pattern=term, limit=max(1, min(10, limit))):
                key = getattr(node, "id", None) or str(node)
                if key in seen:
                    continue
                seen.add(key)
                if hasattr(node, "model_dump"):
                    node_payload = node.model_dump(mode="json")
                elif hasattr(node, "dict"):
                    node_payload = node.dict()
                else:
                    node_payload = node
                rows.append({"node": node_payload})
                if len(rows) >= limit:
                    return rows
        return rows
    except Exception:
        return []


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Cortex prior-art/capability recall gate.")
    parser.add_argument("--objective", required=True)
    parser.add_argument("--capability", action="append", default=[])
    parser.add_argument("--path", action="append", default=[])
    parser.add_argument("--proposed-action", default="unspecified")
    parser.add_argument("--scan-root", action="append", default=[])
    parser.add_argument("--memory-results", type=int, default=6)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    terms = extract_prior_art_terms(
        objective=args.objective,
        planned_capabilities=args.capability,
        planned_paths=args.path,
    )
    memory_rows: List[Dict[str, Any]] = []
    for query in [*args.capability, *terms[:6]]:
        if not query:
            continue
        memory_rows.extend(_memory_results(query, max(2, args.memory_results // 2)))
    structural_rows = _structural_results(terms, limit=30)
    roots = [Path(item).resolve() for item in args.scan_root]
    if not roots:
        roots = [SERVER_ROOT / "cortex_server", SERVER_ROOT / "../.." / "large-project-capability-stack" / "packages"]
    file_rows = _scan_files(terms, roots, limit=60)
    gate = build_prior_art_gate(
        objective=args.objective,
        planned_capabilities=args.capability,
        planned_paths=args.path,
        proposed_action=args.proposed_action,
        memory_results=memory_rows,
        structural_results=structural_rows,
        file_results=file_rows,
    )
    print(json.dumps(gate, indent=2, sort_keys=True, default=str))
    return 0 if gate.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
