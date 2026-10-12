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
from typing import Any

ALLOWED_GIT_MODES = {"100644": 0o644, "100755": 0o755}
RECEIPT_SCHEMA = "cortex.qualification-receipt.v1"
RELEASE_SCHEMA = "cortex.release-envelope.v2"
SHA256_HEX_LENGTH = 64


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def canonical_digest(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _safe_relative(value: str, *, field: str) -> str:
    pure = PurePosixPath(value)
    if pure.is_absolute() or ".." in pure.parts or not pure.parts:
        raise SystemExit(f"unsafe {field}: {value}")
    return pure.as_posix()


def _load_object(path: Path, *, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise SystemExit(f"{label} is not a regular non-symlink file: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"invalid {label}: {type(exc).__name__}") from exc
    if not isinstance(payload, dict):
        raise SystemExit(f"{label} must contain a JSON object")
    return payload


def _parse_receipt_arg(value: str) -> tuple[str, Path]:
    kind, separator, raw_path = value.partition("=")
    if not separator or not kind.strip() or not raw_path.strip():
        raise argparse.ArgumentTypeError("qualification receipt must use KIND=PATH")
    return kind.strip(), Path(raw_path).resolve(strict=True)


def _validate_qualification_receipt(
    *,
    kind: str,
    path: Path,
    source_commit: str,
    source_tree: str,
    focused_surface_ids: set[str],
) -> dict[str, Any]:
    payload = _load_object(path, label=f"qualification receipt {kind}")
    if payload.get("schemaVersion") != RECEIPT_SCHEMA:
        raise SystemExit(f"qualification receipt {kind} has unsupported schema")
    if payload.get("kind") != kind:
        raise SystemExit(f"qualification receipt kind mismatch: expected {kind}")
    if str(payload.get("outcome") or "").lower() != "green":
        raise SystemExit(f"qualification receipt {kind} is not green")
    if payload.get("sourceCommit") != source_commit or payload.get("sourceTree") != source_tree:
        raise SystemExit(f"qualification receipt {kind} is not bound to the exact candidate")
    exit_code = payload.get("exitCode")
    if isinstance(exit_code, bool) or exit_code != 0:
        raise SystemExit(f"qualification receipt {kind} does not record exitCode=0")
    replay = payload.get("replayCommand")
    if not isinstance(replay, list) or not replay or not all(isinstance(item, str) and item for item in replay):
        raise SystemExit(f"qualification receipt {kind} requires replayCommand as a non-empty argv array")
    for timestamp in ("startedAt", "completedAt"):
        if not isinstance(payload.get(timestamp), str) or not payload[timestamp].strip():
            raise SystemExit(f"qualification receipt {kind} requires {timestamp}")
    if kind == "focused-gates":
        observed = payload.get("surfaceIds")
        if not isinstance(observed, list) or not all(isinstance(item, str) for item in observed):
            raise SystemExit("focused-gates receipt requires surfaceIds")
        missing = sorted(focused_surface_ids - set(observed))
        if missing:
            raise SystemExit(f"focused-gates receipt is missing surfaces: {', '.join(missing)}")
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise SystemExit(f"qualification receipt {kind} requires at least one hashed artifact")
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise SystemExit(f"qualification receipt {kind} has an invalid artifact")
        _safe_relative(str(artifact.get("path") or ""), field="receipt artifact path")
        digest = str(artifact.get("sha256") or "")
        if len(digest) != SHA256_HEX_LENGTH or any(character not in "0123456789abcdef" for character in digest):
            raise SystemExit(f"qualification receipt {kind} has an invalid artifact SHA-256")
    return {
        "kind": kind,
        "receiptSha256": sha256(path),
        "payloadSha256": canonical_digest(payload),
        "payload": payload,
    }


def _classification(relative: str, classification: dict[str, Any]) -> str:
    if classification.get("matchPolicy") != "first_match":
        raise SystemExit("source classification matchPolicy must be first_match")
    categories = classification.get("trackedCategories")
    if not isinstance(categories, list) or not categories:
        raise SystemExit("surface contract requires sourceClassification.trackedCategories")
    default_categories: list[str] = []
    for row in categories:
        if not isinstance(row, dict) or not isinstance(row.get("name"), str):
            raise SystemExit("invalid tracked source classification")
        name = row["name"]
        if row.get("default") is True:
            default_categories.append(name)
            continue
        prefixes = row.get("pathPrefixes") or []
        exact_paths = row.get("exactPaths") or []
        contains = row.get("pathComponents") or []
        if not all(isinstance(value, str) and value for value in [*prefixes, *exact_paths, *contains]):
            raise SystemExit(f"invalid path matcher in source classification {name}")
        components = PurePosixPath(relative).parts
        if (
            relative in exact_paths
            or any(relative.startswith(prefix) for prefix in prefixes)
            or any(component in components for component in contains)
        ):
            return name
    if len(default_categories) != 1:
        raise SystemExit(f"release path must have exactly one default classification: {relative}")
    return default_categories[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--surface-contract", required=True)
    parser.add_argument(
        "--qualification-receipt",
        action="append",
        default=[],
        type=_parse_receipt_arg,
        metavar="KIND=PATH",
    )
    # Retained for replay compatibility. Clean source is mandatory for v2.
    parser.add_argument("--require-clean", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve(strict=True)
    output = Path(args.output).resolve()
    try:
        output.relative_to(root)
    except ValueError:
        pass
    else:
        raise SystemExit("release envelope output must be outside the release source")
    status = git(root, "status", "--porcelain=v1", "--untracked-files=all")
    if status:
        raise SystemExit("release source is not clean")
    head = git(root, "rev-parse", "HEAD")
    tree = git(root, "rev-parse", "HEAD^{tree}")
    parent = git(root, "rev-parse", "HEAD^")
    if git(root, "write-tree") != tree:
        raise SystemExit("release index tree does not match HEAD tree")

    surface_contract = Path(args.surface_contract).resolve(strict=True)
    try:
        surface_relative = surface_contract.relative_to(root).as_posix()
    except ValueError as exc:
        raise SystemExit("surface contract must be inside the release source") from exc
    surface_payload = _load_object(surface_contract, label="runtime surface contract")
    if surface_payload.get("schemaVersion") != "cortex.runtime-surface-contract.v2":
        raise SystemExit("unsupported runtime surface contract schema")
    classification = surface_payload.get("sourceClassification")
    if not isinstance(classification, dict):
        raise SystemExit("runtime surface contract requires sourceClassification")
    private_runtime = classification.get("privateRuntime")
    if not isinstance(private_runtime, dict) or private_runtime.get("trackedFilesAllowed") is not False:
        raise SystemExit("private/runtime classification must prohibit tracked files")
    private_roots = private_runtime.get("absoluteRoots")
    if not isinstance(private_roots, list) or not private_roots or not all(
        isinstance(value, str) and value.startswith("/") for value in private_roots
    ):
        raise SystemExit("private/runtime classification requires absoluteRoots")

    rows = []
    raw = subprocess.check_output(["git", "-C", str(root), "ls-files", "-s", "-z"])
    classification_counts: dict[str, int] = {}
    for record in raw.split(b"\0"):
        if not record:
            continue
        metadata, raw_path = record.split(b"\t", 1)
        mode, object_id, stage = metadata.decode("ascii").split()
        if stage != "0":
            raise SystemExit(f"unmerged index stage for {raw_path!r}")
        if mode not in ALLOWED_GIT_MODES:
            raise SystemExit(f"unsupported Git mode {mode} for {raw_path!r}")
        relative = _safe_relative(raw_path.decode("utf-8"), field="release path")
        target = root.joinpath(*PurePosixPath(relative).parts)
        if target.is_symlink() or not target.is_file():
            raise SystemExit(f"release path is not a regular non-symlink file: {relative}")
        observed_mode = stat.S_IMODE(target.stat().st_mode)
        if observed_mode != ALLOWED_GIT_MODES[mode]:
            raise SystemExit(f"filesystem/Git mode mismatch: {relative}")
        category = _classification(relative, classification)
        if category == "private_runtime":
            raise SystemExit(f"private/runtime data must never be tracked or packaged: {relative}")
        classification_counts[category] = classification_counts.get(category, 0) + 1
        rows.append(
            {
                "path": relative,
                "classification": category,
                "gitMode": mode,
                "gitObjectId": object_id,
                "mode": observed_mode,
                "bytes": target.stat().st_size,
                "sha256": sha256(target),
            }
        )
    rows.sort(key=lambda row: row["path"])

    qualification = surface_payload.get("qualification")
    if not isinstance(qualification, dict):
        raise SystemExit("runtime surface contract requires qualification policy")
    required_kinds = qualification.get("requiredReceiptKinds")
    focused_ids = qualification.get("focusedSurfaceIds")
    if not isinstance(required_kinds, list) or not required_kinds or not all(
        isinstance(value, str) and value for value in required_kinds
    ):
        raise SystemExit("qualification policy requires requiredReceiptKinds")
    if not isinstance(focused_ids, list) or not focused_ids or not all(
        isinstance(value, str) and value for value in focused_ids
    ):
        raise SystemExit("qualification policy requires focusedSurfaceIds")
    supplied = dict(args.qualification_receipt)
    if len(supplied) != len(args.qualification_receipt):
        raise SystemExit("duplicate qualification receipt kind")
    if set(supplied) != set(required_kinds):
        missing = sorted(set(required_kinds) - set(supplied))
        extra = sorted(set(supplied) - set(required_kinds))
        raise SystemExit(f"qualification receipt set mismatch; missing={missing}; extra={extra}")
    receipts = [
        _validate_qualification_receipt(
            kind=kind,
            path=supplied[kind],
            source_commit=head,
            source_tree=tree,
            focused_surface_ids=set(focused_ids),
        )
        for kind in required_kinds
    ]

    payload: dict[str, Any] = {
        "schemaVersion": RELEASE_SCHEMA,
        "releaseId": args.release_id,
        "sourceCommit": head,
        "sourceTree": tree,
        "parentCommit": parent,
        "sourceIdentity": {
            "clean": True,
            "statusPorcelainSha256": hashlib.sha256(b"").hexdigest(),
            "indexTree": tree,
            "objectFormat": git(root, "rev-parse", "--show-object-format"),
        },
        "fileCount": len(rows),
        "files": rows,
        "sourceClassification": {
            "contractPath": surface_relative,
            "contractSha256": sha256(surface_contract),
            "trackedCounts": dict(sorted(classification_counts.items())),
            "privateRuntime": {
                "trackedFileCount": 0,
                "trackedFilesAllowed": False,
                "absoluteRoots": private_roots,
            },
        },
        "runtimeSurfaceContract": {"path": surface_relative, "sha256": sha256(surface_contract)},
        "qualificationReceipts": receipts,
        "mutableStatePolicy": {
            "releaseSourceReadOnly": True,
            "allowedRoots": private_roots,
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
    print(
        json.dumps(
            {
                "outcome": "green",
                "releaseId": payload["releaseId"],
                "sourceCommit": head,
                "sourceTree": tree,
                "sourceClean": True,
                "fileCount": len(rows),
                "qualificationReceiptKinds": required_kinds,
                "envelopeSha256": payload["envelopeSha256"],
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
