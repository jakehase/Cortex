#!/usr/bin/env python3
"""List, inspect, or explicitly review privacy-safe Cortex promotions."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
INDEXER = ROOT / "scripts" / "index-owner-memory.py"


def _load_indexer():
    spec = importlib.util.spec_from_file_location("cortex_owner_indexer", INDEXER)
    if spec is None or spec.loader is None:
        raise RuntimeError("owner memory client could not be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _list(client, status: str | None, limit: int, max_response_bytes: int) -> dict:
    query = urllib.parse.urlencode(
        {key: value for key, value in {"status": status, "limit": limit}.items() if value is not None}
    )
    url = f"{client.base_url}/l22/promotions?{query}"
    request = urllib.request.Request(url, method="GET", headers=client.headers)
    try:
        with client.opener.open(request, timeout=30) as response:
            raw = response.read(max_response_bytes + 1)
    except Exception as exc:
        raise RuntimeError("promotion queue request failed") from exc
    if len(raw) > max_response_bytes:
        raise RuntimeError("promotion queue response exceeds its byte bound")
    value = json.loads(raw.decode("utf-8"))
    if not isinstance(value, dict) or not isinstance(value.get("records"), list):
        raise RuntimeError("promotion queue response is invalid")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("list", "show", "approve", "reject"))
    parser.add_argument("memory_id", nargs="?")
    parser.add_argument("--status", choices=("blocked", "pending_review", "approved", "rejected", "promoted"))
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--confirm", action="store_true")
    parser.add_argument("--config", type=Path, default=Path("/root/.openclaw/openclaw.json"))
    args = parser.parse_args(argv)
    if not 1 <= args.limit <= 500:
        parser.error("--limit must be 1-500")
    if args.action in {"approve", "reject"} and (not args.memory_id or not args.confirm):
        parser.error("approve/reject requires memory_id and --confirm")
    if args.action == "show" and not args.memory_id:
        parser.error("show requires memory_id")
    if args.action == "list" and args.memory_id:
        parser.error("list does not accept a memory_id")
    if args.memory_id and (
        len(args.memory_id.encode("utf-8")) > 256
        or not args.memory_id.strip()
        or any(character.isspace() for character in args.memory_id)
    ):
        parser.error("memory_id must be a bounded non-whitespace identifier")

    indexer = _load_indexer()
    config = indexer._read_json(args.config, label="owner_config")
    assert config is not None
    plugin, scope, signature = indexer.signed_scope(config)
    client = indexer.HttpMemoryClient(plugin=plugin, scope=scope, signature=signature)
    if args.action == "list":
        result = _list(client, args.status, args.limit, indexer.MAX_RESPONSE_BYTES)
    elif args.action == "show":
        result = client.read(args.memory_id)
        if result is None:
            raise RuntimeError("promotion candidate memory is unavailable")
    else:
        result = client._post(
            "/l22/promotions/review",
            {"memory_id": args.memory_id, "approved": args.action == "approve"},
        )
    print(json.dumps(result, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
