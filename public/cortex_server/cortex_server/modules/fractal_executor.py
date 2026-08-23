"""Fractal execution tree utilities.

Recursive bounded decomposition for complex tasks with merge-up aggregation.
This is orchestration scaffolding (planner/executor metadata), not shell execution.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Dict, List, Any
import hashlib
import re


@dataclass
class FractalNode:
    node_id: str
    task: str
    depth: int
    branch: str
    children: List["FractalNode"]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "node_id": self.node_id,
            "task": self.task,
            "depth": self.depth,
            "branch": self.branch,
            "children": [c.to_dict() for c in self.children],
        }


def _node_id(task: str, depth: int, branch: str) -> str:
    h = hashlib.sha256(f"{task}|{depth}|{branch}".encode("utf-8")).hexdigest()[:10]
    return f"n{depth}-{h}"


def _split_task(task: str, max_parts: int) -> List[str]:
    t = (task or "").strip()
    if not t:
        return []

    # Priority split by explicit connectors.
    parts = re.split(r"\b(?:and then|then|and|,|;|\|)\b", t, flags=re.IGNORECASE)
    parts = [p.strip(" .") for p in parts if p and p.strip(" .")]

    if len(parts) >= 2:
        return parts[:max_parts]

    # Heuristic decomposition templates.
    return [
        f"Analyze scope and constraints for: {t}",
        f"Implement core solution for: {t}",
        f"Validate and summarize outcomes for: {t}",
    ][:max_parts]


def build_fractal_plan(task: str, max_depth: int = 3, max_branching: int = 3, branch_prefix: str = "fractal") -> Dict[str, Any]:
    max_depth = max(1, min(int(max_depth), 6))
    max_branching = max(2, min(int(max_branching), 6))

    def grow(current_task: str, depth: int, branch: str) -> FractalNode:
        if depth >= max_depth:
            return FractalNode(
                node_id=_node_id(current_task, depth, branch),
                task=current_task,
                depth=depth,
                branch=branch,
                children=[],
            )

        parts = _split_task(current_task, max_branching)
        if len(parts) <= 1:
            # Stop if decomposition no longer meaningful.
            return FractalNode(
                node_id=_node_id(current_task, depth, branch),
                task=current_task,
                depth=depth,
                branch=branch,
                children=[],
            )

        children: List[FractalNode] = []
        for i, part in enumerate(parts, start=1):
            # The full parent path is part of the branch identity. Rebuilding a
            # branch from only depth/index lets equal tasks in separate sibling
            # subtrees receive the same node ID.
            child_branch = f"{branch}/d{depth+1}-b{i}"
            children.append(grow(part, depth + 1, child_branch))

        return FractalNode(
            node_id=_node_id(current_task, depth, branch),
            task=current_task,
            depth=depth,
            branch=branch,
            children=children,
        )

    root = grow(task.strip(), 0, f"{branch_prefix}/root")

    leaves: List[Dict[str, Any]] = []
    node_ids: List[str] = []
    max_seen_depth = 0

    def walk(node: FractalNode):
        nonlocal max_seen_depth
        max_seen_depth = max(max_seen_depth, node.depth)
        node_ids.append(str(node.node_id or ""))
        if not node.children:
            leaves.append({
                "node_id": node.node_id,
                "task": node.task,
                "depth": node.depth,
                "branch": node.branch,
                "worktree": f"wt-{node.node_id}",
            })
            return
        for c in node.children:
            walk(c)

    walk(root)

    if any(not node_id for node_id in node_ids) or len(set(node_ids)) != len(node_ids):
        raise ValueError("fractal plan contains duplicate or empty node IDs")
    leaf_ids = [str(leaf.get("node_id") or "") for leaf in leaves]
    if any(not node_id for node_id in leaf_ids) or len(set(leaf_ids)) != len(leaf_ids):
        raise ValueError("fractal plan contains duplicate or empty leaf node IDs")

    return {
        "root": root.to_dict(),
        "leaf_count": len(leaves),
        "max_depth": max_seen_depth,
        "leaves": leaves,
        "execution_pattern": "parallel_leaves_merge_up",
    }


def aggregate_fractal_results(plan: Dict[str, Any], leaf_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    leaves = plan.get("leaves") if isinstance(plan.get("leaves"), list) else []
    leaf_ids = [str(leaf.get("node_id") or "") for leaf in leaves if isinstance(leaf, dict)]
    if len(leaf_ids) != len(leaves) or any(not node_id for node_id in leaf_ids):
        raise ValueError("fractal plan contains an invalid leaf")
    if len(set(leaf_ids)) != len(leaf_ids):
        raise ValueError("fractal plan contains duplicate leaf node IDs")

    normalized_results = [row for row in (leaf_results or []) if isinstance(row, dict)]
    result_ids = [str(row.get("node_id") or "") for row in normalized_results]
    if any(not node_id for node_id in result_ids):
        raise ValueError("fractal result contains an empty node ID")
    if len(set(result_ids)) != len(result_ids):
        raise ValueError("fractal results contain duplicate node IDs")
    by_id = {node_id: row for node_id, row in zip(result_ids, normalized_results)}

    covered = 0
    summaries: List[str] = []
    for leaf in leaves:
        node_id = str(leaf.get("node_id"))
        row = by_id.get(node_id)
        if row:
            covered += 1
            summaries.append(str(row.get("summary") or row.get("result") or "completed"))

    coverage = covered / max(1, len(leaves))
    return {
        "success": coverage >= 0.8,
        "coverage": round(coverage, 4),
        "covered_leaves": covered,
        "total_leaves": len(leaves),
        "merged_summary": " | ".join(summaries[:12]),
        "pattern": "merge_up_recursive",
    }
