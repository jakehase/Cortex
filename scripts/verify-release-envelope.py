#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
from pathlib import Path, PurePosixPath


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_digest(payload: dict) -> str:
    unsigned = {key: value for key, value in payload.items() if key != "envelopeSha256"}
    return hashlib.sha256(
        json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--envelope", required=True)
    parser.add_argument("--output")
    parser.add_argument("--allow-git-directory", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve(strict=True)
    envelope_path = Path(args.envelope).resolve(strict=True)
    envelope = json.loads(envelope_path.read_text(encoding="utf-8"))
    if envelope.get("schemaVersion") != "cortex.release-envelope.v1":
        raise SystemExit("unsupported release envelope schema")
    if canonical_digest(envelope) != envelope.get("envelopeSha256"):
        raise SystemExit("release envelope digest mismatch")
    rows = envelope.get("files") or []
    if len(rows) != envelope.get("fileCount"):
        raise SystemExit("release envelope file count mismatch")
    expected = set()
    mismatches = []
    for row in rows:
        relative = str(row.get("path") or "")
        pure = PurePosixPath(relative)
        if pure.is_absolute() or ".." in pure.parts or not pure.parts:
            mismatches.append({"path": relative, "reason": "unsafe_path"})
            continue
        if relative in expected:
            mismatches.append({"path": relative, "reason": "duplicate_path"})
            continue
        expected.add(relative)
        target = root.joinpath(*pure.parts)
        if target.is_symlink() or not target.is_file():
            mismatches.append({"path": relative, "reason": "missing_or_unsafe"})
            continue
        observed_mode = stat.S_IMODE(target.stat().st_mode)
        observed_hash = sha256(target)
        if observed_mode != int(row["mode"]):
            mismatches.append({"path": relative, "reason": "mode", "observed": observed_mode})
        if target.stat().st_size != int(row["bytes"]):
            mismatches.append({"path": relative, "reason": "size", "observed": target.stat().st_size})
        if observed_hash != row["sha256"]:
            mismatches.append({"path": relative, "reason": "sha256", "observed": observed_hash})

    observed = set()
    unsafe = []
    for target in sorted(root.rglob("*")):
        relative = target.relative_to(root).as_posix()
        if relative == ".git" or relative.startswith(".git/"):
            if args.allow_git_directory:
                continue
            unsafe.append({"path": relative, "reason": "git_metadata_present"})
            continue
        if target.is_dir():
            continue
        if target.is_symlink() or not target.is_file():
            unsafe.append({"path": relative, "reason": "non_regular_entry"})
            continue
        observed.add(relative)
    extras = sorted(observed - expected)
    missing = sorted(expected - observed)
    outcome = "green" if not mismatches and not unsafe and not extras and not missing else "red"
    result = {
        "schemaVersion": "cortex.release-envelope-verification.v1",
        "outcome": outcome,
        "releaseId": envelope.get("releaseId"),
        "sourceCommit": envelope.get("sourceCommit"),
        "sourceTree": envelope.get("sourceTree"),
        "expectedFileCount": len(expected),
        "observedFileCount": len(observed),
        "mismatches": mismatches,
        "unsafeEntries": unsafe,
        "extraPaths": extras,
        "missingPaths": missing,
        "envelopeSha256": envelope.get("envelopeSha256"),
        "truthBoundary": "Green proves exact files, modes, sizes, hashes, and absence of unclassified release entries. It does not prove runtime health.",
    }
    if args.output:
        output = Path(args.output).resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        os.chmod(temporary, 0o644)
        os.replace(temporary, output)
    print(json.dumps({
        "outcome": outcome,
        "releaseId": result["releaseId"],
        "expectedFileCount": len(expected),
        "observedFileCount": len(observed),
        "mismatchCount": len(mismatches),
        "unsafeEntryCount": len(unsafe),
        "extraPathCount": len(extras),
        "missingPathCount": len(missing),
    }, sort_keys=True))
    raise SystemExit(0 if outcome == "green" else 1)


if __name__ == "__main__":
    main()
