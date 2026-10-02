#!/usr/bin/env python3
"""Run the bounded principal-scoped Cortex recall benchmark.

The case file is JSON with either a top-level list or ``{"cases": [...]}``.
Every case requires ``id`` and ``query`` and may include:

- ``expected_ids``
- ``expected_source_ids``
- ``expected_source_paths``
- ``expected_fact_keys``
- ``forbidden_source_ids``
- ``forbidden_source_paths``
- ``forbidden_projects``
- ``expected_winner_id``
- ``expected_winner_fact_key``
- typed ``filters``

The script rejects case text that the shared sensitive-data scanner would
redact.  It never writes benchmark questions into memory.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
INDEXER = ROOT / "scripts" / "index-owner-memory.py"
SERVER_ROOT = ROOT / "public" / "cortex_server"
MAX_CASE_FILE_BYTES = 2 * 1024 * 1024
ALLOWED_CASE_FIELDS = frozenset(
    {
        "id",
        "query",
        "filters",
        "expected_ids",
        "expected_source_ids",
        "expected_source_paths",
        "expected_fact_keys",
        "forbidden_source_ids",
        "forbidden_source_paths",
        "forbidden_projects",
        "expected_winner_id",
        "expected_winner_fact_key",
    }
)


def _load_indexer():
    spec = importlib.util.spec_from_file_location("cortex_owner_indexer", INDEXER)
    if spec is None or spec.loader is None:
        raise RuntimeError("owner memory client could not be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _load_cases(path: Path) -> list[dict[str, Any]]:
    encoded = path.read_bytes()
    if len(encoded) > MAX_CASE_FILE_BYTES:
        raise ValueError("recall case file exceeds its byte bound")
    raw = json.loads(encoded)
    cases = raw.get("cases") if isinstance(raw, dict) else raw
    if not isinstance(cases, list) or not 1 <= len(cases) <= 100:
        raise ValueError("benchmark requires 1-100 cases")
    if str(SERVER_ROOT) not in sys.path:
        sys.path.insert(0, str(SERVER_ROOT))
    from cortex_server.modules.sensitive_data_redaction import redact_sensitive_text

    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in cases:
        if not isinstance(item, dict):
            raise ValueError("every recall case must be an object")
        case = dict(item)
        case_id = str(case.get("id") or "").strip()
        query = str(case.get("query") or "").strip()
        if (
            set(case) - ALLOWED_CASE_FIELDS
            or not case_id
            or case_id in seen
            or len(case_id.encode("utf-8")) > 256
            or not query
            or len(query.encode("utf-8")) > 16_384
        ):
            raise ValueError("recall case IDs must be unique and queries must be non-empty")
        if redact_sensitive_text(case_id) != case_id or redact_sensitive_text(query) != query:
            raise ValueError(f"recall case {case_id!r} failed the no-sensitive-data gate")
        for winner_field in ("expected_winner_id", "expected_winner_fact_key"):
            winner_value = case.get(winner_field)
            if winner_value is not None and (
                not isinstance(winner_value, str)
                or not winner_value.strip()
                or len(winner_value.encode("utf-8")) > 512
            ):
                raise ValueError(
                    f"recall case {case_id!r} has an invalid {winner_field}"
                )
        if case.get("expected_winner_id") and case.get("expected_winner_fact_key"):
            raise ValueError(
                f"recall case {case_id!r} declares multiple contradiction winners"
            )
        for field_name in ALLOWED_CASE_FIELDS - {
            "id",
            "query",
            "filters",
            "expected_winner_id",
            "expected_winner_fact_key",
        }:
            values = case.get(field_name) or []
            if (
                not isinstance(values, list)
                or len(values) > 128
                or any(
                    not isinstance(value, str)
                    or not value.strip()
                    or len(value.encode("utf-8")) > 512
                    for value in values
                )
            ):
                raise ValueError(
                    f"recall case {case_id!r} has an invalid {field_name} list"
                )
        seen.add(case_id)
        normalized.append(case)
    return normalized


def _atomic_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("cases", type=Path)
    parser.add_argument("--config", type=Path, default=Path("/root/.openclaw/openclaw.json"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--n-results", type=int, default=5, choices=range(1, 26))
    args = parser.parse_args(argv)

    indexer = _load_indexer()
    config = indexer._read_json(args.config, label="owner_config")
    assert config is not None
    plugin, scope, signature = indexer.signed_scope(config)
    client = indexer.HttpMemoryClient(plugin=plugin, scope=scope, signature=signature)
    cases = _load_cases(args.cases)
    result = client._post(
        "/l22/recall/evaluate",
        {"cases": cases, "n_results": args.n_results},
    )
    if not isinstance(result, dict) or not isinstance(result.get("evaluation"), dict):
        raise RuntimeError("Cortex returned an invalid recall evaluation")
    if args.output:
        _atomic_write(args.output, result)
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
