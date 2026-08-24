#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import stat
import subprocess
from pathlib import Path, PurePosixPath

ALLOWED_GIT_MODES = {"100644": 0o644, "100755": 0o755}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def canonical_digest(payload: dict) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--surface-contract")
    parser.add_argument("--require-clean", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve(strict=True)
    output = Path(args.output).resolve()
    if args.require_clean and git(root, "status", "--porcelain"):
        raise SystemExit("release source is not clean")
    head = git(root, "rev-parse", "HEAD")
    tree = git(root, "rev-parse", "HEAD^{tree}")
    parent = git(root, "rev-parse", "HEAD^")
    rows = []
    raw = subprocess.check_output(
        ["git", "-C", str(root), "ls-files", "-s", "-z"]
    )
    for record in raw.split(b"\0"):
        if not record:
            continue
        metadata, raw_path = record.split(b"\t", 1)
        mode, object_id, stage = metadata.decode("ascii").split()
        if stage != "0":
            raise SystemExit(f"unmerged index stage for {raw_path!r}")
        if mode not in ALLOWED_GIT_MODES:
            raise SystemExit(f"unsupported Git mode {mode} for {raw_path!r}")
        relative = raw_path.decode("utf-8")
        pure = PurePosixPath(relative)
        if pure.is_absolute() or ".." in pure.parts or not pure.parts:
            raise SystemExit(f"unsafe release path: {relative}")
        target = root.joinpath(*pure.parts)
        if target.is_symlink() or not target.is_file():
            raise SystemExit(f"release path is not a regular non-symlink file: {relative}")
        observed_mode = stat.S_IMODE(target.stat().st_mode)
        if observed_mode != ALLOWED_GIT_MODES[mode]:
            raise SystemExit(f"filesystem/Git mode mismatch: {relative}")
        rows.append(
            {
                "path": relative,
                "gitMode": mode,
                "gitObjectId": object_id,
                "mode": observed_mode,
                "bytes": target.stat().st_size,
                "sha256": sha256(target),
            }
        )
    rows.sort(key=lambda row: row["path"])
    surface_contract = Path(args.surface_contract).resolve(strict=True) if args.surface_contract else None
    payload = {
        "schemaVersion": "cortex.release-envelope.v1",
        "releaseId": args.release_id,
        "sourceCommit": head,
        "sourceTree": tree,
        "parentCommit": parent,
        "fileCount": len(rows),
        "files": rows,
        "runtimeSurfaceContract": (
            {"path": surface_contract.name, "sha256": sha256(surface_contract)}
            if surface_contract
            else None
        ),
        "mutableStatePolicy": {
            "releaseSourceReadOnly": True,
            "allowedRoots": ["/opt/clawdbot", "/var/lib/cortex", "/var/log/cortex", "/run/cortex"],
            "sourceTreeWritesAllowed": False,
        },
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    payload["envelopeSha256"] = canonical_digest(payload)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o644)
    os.replace(temporary, output)
    print(json.dumps({
        "outcome": "green",
        "releaseId": payload["releaseId"],
        "sourceCommit": head,
        "sourceTree": tree,
        "fileCount": len(rows),
        "envelopeSha256": payload["envelopeSha256"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
