#!/usr/bin/env python3
"""Report raw LOC truth for a git worktree.

This intentionally separates physical LOC from meaningful/product-quality claims.
It counts tracked + untracked text files under selected product roots, compares
tracked changes against HEAD (or a supplied git ref), and reports repetition
signals so raw generated bulk is not mistaken for deep architecture.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import subprocess
from pathlib import Path

SKIP_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf",
    ".zip", ".gz", ".tar", ".sqlite", ".db", ".map",
}

BLOAT_MARKERS = [
    "full_clone_remediation_leaf_evaluated",
    "compact primary-product adoption marker",
    "remaining-work remediation product slice for strict Mailchimp clone blockers",
    '"fidelity": "full_clone"',
    '"requirements": [',
    '"remediationContracts": [',
]


def run(args: list[str], cwd: Path, *, check: bool = True) -> str:
    proc = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and proc.returncode:
        raise SystemExit(f"command failed ({proc.returncode}): {' '.join(args)}\n{proc.stderr}")
    return proc.stdout


def split_lines(data: bytes) -> list[str] | None:
    if b"\0" in data:
        return None
    return data.decode("utf-8", errors="ignore").splitlines()


def read_worktree_lines(path: Path) -> list[str] | None:
    try:
        return split_lines(path.read_bytes())
    except OSError:
        return None


def normalize(line: str) -> str:
    return re.sub(r"\s+", " ", line.strip())


def file_record(worktree: Path, rel: str, untracked: set[str]) -> dict | None:
    path = worktree / rel
    if not path.is_file() or path.suffix.lower() in SKIP_EXTENSIONS:
        return None
    lines = read_worktree_lines(path)
    if lines is None:
        return None
    normalized = [normalize(line) for line in lines if line.strip()]
    counts = collections.Counter(normalized)
    return {
        "path": rel,
        "loc": len(lines),
        "nonblank": len(normalized),
        "uniqueNormalized": len(counts),
        "duplicateNormalizedInstances": max(0, len(normalized) - len(counts)),
        "repeated5PlusInstances": sum(count for count in counts.values() if count >= 5),
        "maxRepeat": max(counts.values(), default=0),
        "untracked": rel in untracked,
    }


def baseline_loc(worktree: Path, baseline: str, tracked: list[str], git_prefix: str = "") -> tuple[int, int]:
    total = 0
    files = 0
    for rel in tracked:
        if Path(rel).suffix.lower() in SKIP_EXTENSIONS:
            continue
        proc = subprocess.run(
            ["git", "show", f"{baseline}:{git_prefix}{rel}"],
            cwd=worktree,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        if proc.returncode:
            continue
        lines = split_lines(proc.stdout)
        if lines is None:
            continue
        total += len(lines)
        files += 1
    return total, files


def diff_numstat(worktree: Path, baseline: str, roots: list[str]) -> tuple[int, int, int]:
    output = run(["git", "diff", "--numstat", baseline, "--", *roots], worktree)
    add = delete = files = 0
    for line in output.splitlines():
        parts = line.split("\t")
        if len(parts) >= 3 and parts[0].isdigit() and parts[1].isdigit():
            add += int(parts[0])
            delete += int(parts[1])
            files += 1
    return add, delete, files


def added_line_repetition(worktree: Path, baseline: str, roots: list[str], records: list[dict]) -> dict:
    added: list[str] = []
    diff = run(["git", "diff", "--unified=0", baseline, "--", *roots], worktree, check=False)
    for line in diff.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            normalized = normalize(line[1:])
            if normalized:
                added.append(normalized)
    for rec in records:
        if not rec["untracked"]:
            continue
        lines = read_worktree_lines(worktree / rec["path"]) or []
        added.extend(normalize(line) for line in lines if line.strip())
    counts = collections.Counter(added)
    marker_counts = {
        marker: sum(1 for line in added if marker in line)
        for marker in BLOAT_MARKERS
    }
    duplicate_instances = max(0, len(added) - len(counts))
    duplicate_ratio = round(duplicate_instances / len(added), 4) if added else 0
    marker_line_count = sum(marker_counts.values())
    semantic_bloat_reasons: list[str] = []
    if len(added) >= 500 and duplicate_ratio >= 0.55:
        semantic_bloat_reasons.append("high_duplicate_normalized_added_line_ratio")
    if marker_counts.get("full_clone_remediation_leaf_evaluated", 0) >= 20:
        semantic_bloat_reasons.append("repeated_remediation_marker_blocks")
    if marker_counts.get('"fidelity": "full_clone"', 0) >= 20 or marker_counts.get('"remediationContracts": [', 0) >= 20:
        semantic_bloat_reasons.append("remediation_blueprint_boilerplate_concentration")
    if marker_line_count >= 100 and marker_line_count / max(1, len(added)) >= 0.03:
        semantic_bloat_reasons.append("marker_heavy_product_delta")
    return {
        "addedNonblankLinesApprox": len(added),
        "addedUniqueNormalizedLinesApprox": len(counts),
        "addedDuplicateNormalizedInstancesApprox": duplicate_instances,
        "duplicateAddedLineRatio": duplicate_ratio,
        "markerCounts": marker_counts,
        "markerLineCount": marker_line_count,
        "semanticBloatSuspect": bool(semantic_bloat_reasons),
        "semanticBloatReasons": semantic_bloat_reasons,
        "mostCommonAddedLines": [
            {"line": line[:160], "count": count}
            for line, count in counts.most_common(10)
            if count >= 10
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute truthful raw LOC and repetition signals for a git worktree.")
    parser.add_argument("--worktree", default=".", help="git worktree path")
    parser.add_argument("--baseline", default="HEAD", help="git ref used as launch/baseline comparison; default HEAD")
    parser.add_argument(
        "--roots",
        nargs="+",
        default=["apps/web", "packages/app", "packages/predictive-segments", "packages/send-time-optimizer"],
        help="product roots to count",
    )
    parser.add_argument("--top", type=int, default=20, help="number of top files to include")
    args = parser.parse_args()

    worktree = Path(args.worktree).resolve()
    roots = args.roots
    git_prefix = run(["git", "rev-parse", "--show-prefix"], worktree).strip()
    tracked = run(["git", "ls-files", "--", *roots], worktree).splitlines()
    untracked_list = run(["git", "ls-files", "--others", "--exclude-standard", "--", *roots], worktree).splitlines()
    untracked = set(untracked_list)
    all_files = sorted(set(tracked) | untracked)

    records = [record for rel in all_files if (record := file_record(worktree, rel, untracked))]
    current_loc = sum(record["loc"] for record in records)
    current_nonblank = sum(record["nonblank"] for record in records)
    current_unique = len(set().union(*[
        {normalize(line) for line in (read_worktree_lines(worktree / record["path"]) or []) if line.strip()}
        for record in records
    ])) if records else 0
    base_loc, base_files = baseline_loc(worktree, args.baseline, tracked, git_prefix)
    add, delete, changed_files = diff_numstat(worktree, args.baseline, roots)
    untracked_loc = sum(record["loc"] for record in records if record["untracked"])

    report = {
        "worktree": str(worktree),
        "gitPrefix": git_prefix,
        "baseline": args.baseline,
        "productRoots": roots,
        "baselineProductLOC": base_loc,
        "baselineTrackedFiles": base_files,
        "currentProductLOC": current_loc,
        "currentProductFiles": len(records),
        "trackedProductLOC": sum(record["loc"] for record in records if not record["untracked"]),
        "trackedProductFiles": sum(1 for record in records if not record["untracked"]),
        "untrackedProductLOC": untracked_loc,
        "untrackedProductFiles": sum(1 for record in records if record["untracked"]),
        "trackedChangedFiles": changed_files,
        "trackedAdd": add,
        "trackedDelete": delete,
        "trackedNet": add - delete,
        "netIncludingUntracked": add - delete + untracked_loc,
        "currentNonblankLines": current_nonblank,
        "currentUniqueNormalizedLinesCrossFile": current_unique,
        "currentDuplicateNormalizedInstancesCrossFile": max(0, current_nonblank - current_unique),
        "topFilesByLOC": sorted(records, key=lambda record: record["loc"], reverse=True)[: args.top],
    }
    report.update(added_line_repetition(worktree, args.baseline, roots, records))
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
