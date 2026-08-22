#!/usr/bin/env python3
"""Query Cortex structural code memory without Cortex runtime dependencies.

This is intended for execution-plane mirrors where workers need read-only access to
codebase structure but should not run a second Cortex service. It reads the
SQLite graph produced by scripts/index_codebase_memory.py.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "cortex_graph.db"


def connect_ro(db: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{db.resolve()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def row_dict(row: sqlite3.Row | None) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    data = dict(row)
    try:
        if isinstance(data.get("metadata"), str):
            data["metadata"] = json.loads(data["metadata"] or "{}")
    except Exception:
        data["metadata"] = {}
    return data


def stats(conn: sqlite3.Connection) -> Dict[str, Any]:
    return {
        "nodeCount": conn.execute("select count(*) from nodes").fetchone()[0],
        "edgeCount": conn.execute("select count(*) from edges").fetchone()[0],
        "nodeTypes": dict(conn.execute("select type,count(*) from nodes group by type order by count(*) desc").fetchall()),
        "edgeTypes": dict(conn.execute("select type,count(*) from edges group by type order by count(*) desc").fetchall()),
    }


def search(conn: sqlite3.Connection, query: str, node_type: str = "", limit: int = 10) -> List[Dict[str, Any]]:
    clauses = ["1=1"]
    params: List[Any] = []
    if node_type:
        clauses.append("type = ?")
        params.append(node_type)
    if query:
        clauses.append("(name like ? or uri like ?)")
        params.extend([f"%{query}%", f"%{query}%"])
    sql = f"select * from nodes where {' and '.join(clauses)} order by type, name limit ?"
    params.append(max(1, min(200, int(limit))))
    return [row_dict(row) for row in conn.execute(sql, params).fetchall()]


def get_node(conn: sqlite3.Connection, node_id: str) -> Optional[Dict[str, Any]]:
    return row_dict(conn.execute("select * from nodes where id = ?", (node_id,)).fetchone())


def edge_dict(row: sqlite3.Row | None) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    data = dict(row)
    try:
        if isinstance(data.get("metadata"), str):
            data["metadata"] = json.loads(data["metadata"] or "{}")
    except Exception:
        data["metadata"] = {}
    return data


def neighbors(conn: sqlite3.Connection, node_id: str, direction: str = "both", edge_type: str = "", limit: int = 50) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    max_rows = max(1, min(500, int(limit)))
    if direction in {"out", "both"}:
        params: List[Any] = [node_id]
        sql = "select * from edges where source_id = ?"
        if edge_type:
            sql += " and type = ?"
            params.append(edge_type)
        sql += " limit ?"
        params.append(max_rows)
        for edge_row in conn.execute(sql, params).fetchall():
            edge = edge_dict(edge_row)
            out.append({"direction": "out", "edge": edge, "node": get_node(conn, edge["target_id"]) if edge else None})
    if direction in {"in", "both"}:
        params = [node_id]
        sql = "select * from edges where target_id = ?"
        if edge_type:
            sql += " and type = ?"
            params.append(edge_type)
        sql += " limit ?"
        params.append(max_rows)
        for edge_row in conn.execute(sql, params).fetchall():
            edge = edge_dict(edge_row)
            out.append({"direction": "in", "edge": edge, "node": get_node(conn, edge["source_id"]) if edge else None})
    return out[:max_rows]


def impact(conn: sqlite3.Connection, query: str = "", node_id: str = "", edge_type: str = "", direction: str = "both", limit: int = 5) -> List[Dict[str, Any]]:
    nodes = [get_node(conn, node_id)] if node_id else search(conn, query, limit=limit)
    results = []
    for node in [n for n in nodes if n]:
        ns = neighbors(conn, node["id"], direction=direction, edge_type=edge_type, limit=100)
        results.append({"node": node, "neighborCount": len(ns), "neighbors": ns})
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DEFAULT_DB), help="structural graph SQLite DB")
    parser.add_argument("--health", action="store_true", help="print graph health/stats")
    parser.add_argument("--query", default="", help="search query for name/uri")
    parser.add_argument("--node-type", default="", help="optional node type, e.g. Function, Route, Module")
    parser.add_argument("--impact", action="store_true", help="include neighbor/impact results for query or node id")
    parser.add_argument("--node-id", default="", help="exact node id for impact mode")
    parser.add_argument("--edge-type", default="", help="optional edge type, e.g. IMPORTS, CALLS, CONTAINS")
    parser.add_argument("--direction", default="both", choices=["in", "out", "both"], help="impact edge direction")
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    db = Path(args.db)
    conn = connect_ro(db)
    if args.health:
        s = stats(conn)
        s.update({"ok": s["nodeCount"] > 0 and s["edgeCount"] > 0, "dbPath": str(db.resolve())})
        print(json.dumps(s, indent=2))
        return
    if args.impact:
        payload = {"query": args.query, "nodeId": args.node_id, "results": impact(conn, query=args.query, node_id=args.node_id, edge_type=args.edge_type, direction=args.direction, limit=args.limit)}
    else:
        payload = {"query": args.query, "nodeType": args.node_type, "results": search(conn, args.query, node_type=args.node_type, limit=args.limit)}
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
