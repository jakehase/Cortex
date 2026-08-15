#!/usr/bin/env python3
"""Continue one exact blocked continuous-math commissioning batch without rewriting history."""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from typing import Any

import commission_continuous_math_bank as commissioner


STATE_SCHEMA = "cortex.learning_os.continuous_math_bank_commissioning_continuation_state.v1"
BLOCKER_SCHEMA = "cortex.learning_os.continuous_math_bank_commissioning_continuation_blocker.v1"
PROVENANCE_SCHEMA = "cortex.learning_os.continuous_math_bank_commissioning_continuation_provenance.v1"
REPAIR_BATCH_ID = "batch-050"
REPAIR_BATCH_INDEX = 50
REPAIR_CONCEPT_IDS = [
    "differential-equations-weak-solutions",
    "statistics-likelihood-estimation",
    "statistics-neyman-pearson-testing",
    "numerical-analysis-conditioning",
]
EXPECTED_RUNTIME = {
    "provider": "openai-codex",
    "model": "gpt-5.6-sol",
    "thinking": "ultra",
    "serviceTier": "fast",
    "sandbox": "read-only",
    "toolsAllowed": False,
}
EXPECTED_BLUEPRINTS = [
    {"assessmentRole": "validity-direct", "variant": 1},
    {"assessmentRole": "validity-compositional", "variant": 1},
]
TRUTH_BOUNDARY = (
    "Commissioning continuation proves only identity-bound, role-isolated assessment-content mechanics. "
    "Reuse and acceptance grant no validity, retention, utility, mastery, or model-weight credit."
)
HEX_40 = re.compile(r"^[0-9a-f]{40}$")
HEX_64 = re.compile(r"^[0-9a-f]{64}$")


class ContinuationError(RuntimeError):
    pass


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_bytes(canonical_json(value).encode("utf-8"))


def strict_positive_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def read_regular_bytes(path: Path, *, maximum: int = 64 * 1024 * 1024) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ContinuationError(f"unsafe or unavailable regular file: {path}: {error}") from error
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size < 1 or before.st_size > maximum:
            raise ContinuationError(f"unsafe regular-file size or type: {path}")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, maximum + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                raise ContinuationError(f"regular file exceeds size cap: {path}")
        after = os.fstat(descriptor)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ):
            raise ContinuationError(f"regular file changed while being read: {path}")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def sha256_regular_file(
    path: Path,
    *,
    maximum: int = 512 * 1024 * 1024,
    allow_empty: bool = False,
) -> tuple[str, int]:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ContinuationError(f"unsafe or unavailable regular file: {path}: {error}") from error
    try:
        before = os.fstat(descriptor)
        minimum = 0 if allow_empty else 1
        if not stat.S_ISREG(before.st_mode) or before.st_size < minimum or before.st_size > maximum:
            raise ContinuationError(f"unsafe regular-file size or type: {path}")
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > maximum:
                raise ContinuationError(f"regular file exceeds size cap: {path}")
            digest.update(chunk)
        after = os.fstat(descriptor)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
        ):
            raise ContinuationError(f"regular file changed while being hashed: {path}")
        return digest.hexdigest(), total
    finally:
        os.close(descriptor)


def regular_tree_manifest(root: Path, *, label: str = "prior root") -> dict[str, Any]:
    try:
        root_mode = root.lstat().st_mode
    except OSError as error:
        raise ContinuationError(f"{label} is unavailable for manifesting: {root}: {error}") from error
    require(stat.S_ISDIR(root_mode), f"{label} is not a regular directory: {root}")
    directories = ["."]
    files: list[dict[str, Any]] = []
    pending = [root]
    while pending:
        directory = pending.pop()
        try:
            entries = sorted(directory.iterdir(), key=lambda entry: entry.name)
        except OSError as error:
            raise ContinuationError(f"{label} directory is unavailable for manifesting: {directory}: {error}") from error
        for entry in entries:
            relative = entry.relative_to(root).as_posix()
            try:
                mode = entry.lstat().st_mode
            except OSError as error:
                raise ContinuationError(f"{label} manifest entry is unavailable: {entry}: {error}") from error
            if stat.S_ISLNK(mode):
                raise ContinuationError(f"{label} manifest rejects symbolic links: {relative}")
            if stat.S_ISDIR(mode):
                directories.append(relative)
                pending.append(entry)
                continue
            if not stat.S_ISREG(mode):
                raise ContinuationError(f"{label} manifest rejects nonregular nodes: {relative}")
            digest, size = sha256_regular_file(entry, allow_empty=True)
            files.append({"relativePath": relative, "sha256": digest, "bytes": size})
    directories.sort()
    files.sort(key=lambda row: row["relativePath"])
    surface = {"directories": directories, "files": files}
    total_bytes = sum(row["bytes"] for row in files)
    manifest_digest = sha256_json(surface)
    return {
        "schemaVersion": "cortex.learning_os.regular_tree_manifest.v1",
        "algorithm": "sha256",
        "directories": directories,
        "files": files,
        "directoryCount": len(directories),
        "fileCount": len(files),
        "regularFileCount": len(files),
        "bytes": total_bytes,
        "totalBytes": total_bytes,
        "sha256": manifest_digest,
        "manifestSha256": manifest_digest,
    }


def require_manifest_bindings(
    manifest: dict[str, Any],
    *,
    prior_state_digest: str,
    accepted_inventory: list[dict[str, Any]],
) -> None:
    indexed = {row["relativePath"]: row for row in manifest["files"]}
    state_entry = indexed.get("state.json")
    require(
        isinstance(state_entry, dict) and state_entry.get("sha256") == prior_state_digest,
        "prior root manifest does not bind the approved blocked state",
    )
    for artifact in accepted_inventory:
        observed = indexed.get(artifact["relativePath"])
        require(
            isinstance(observed, dict)
            and observed.get("sha256") == artifact["sha256"]
            and observed.get("bytes") == artifact["bytes"],
            f"prior root manifest does not bind {artifact['relativePath']}",
        )


def decode_object(raw: bytes, path: Path) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ContinuationError(f"invalid JSON object: {path}: {error}") from error
    if not isinstance(value, dict):
        raise ContinuationError(f"JSON object required: {path}")
    return value


def read_regular_json(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = read_regular_bytes(path)
    return decode_object(raw, path), raw


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContinuationError(message)


def expected_source(args: argparse.Namespace) -> dict[str, str]:
    return {
        "sourceCommit": args.expected_source_commit,
        "sourceTree": args.expected_source_tree,
        "productTree": args.expected_product_tree,
    }


def validate_receipts(
    receipts: Any,
    *,
    batch_id: str,
    concept_ids: list[str],
    seen_threads: set[str],
) -> None:
    require(isinstance(receipts, list) and receipts, f"{batch_id}: provider receipts are missing")
    pending = set(concept_ids)
    prior_attempt = 0
    for receipt in receipts:
        require(isinstance(receipt, dict), f"{batch_id}: invalid provider receipt")
        attempt = receipt.get("attempt")
        require(strict_positive_int(attempt) and prior_attempt < attempt <= 6, f"{batch_id}: invalid receipt attempt")
        expected_receipt_id = batch_id if attempt == 1 else f"{batch_id}-repair-{attempt - 1}"
        require(receipt.get("batchId") == expected_receipt_id, f"{batch_id}: receipt identity mismatch")
        prior_attempt = attempt
        accepted_now = receipt.get("acceptedConceptIds")
        accepted_now_set = set(accepted_now) if isinstance(accepted_now, list) else set()
        require(
            isinstance(accepted_now, list)
            and len(accepted_now) == len(accepted_now_set),
            f"{batch_id}: invalid receipt accepted concepts",
        )
        rejected = receipt.get("rejected")
        rejected_ids = set(rejected) if isinstance(rejected, dict) else set()
        require(
            isinstance(rejected, dict)
            and accepted_now_set.isdisjoint(rejected_ids)
            and accepted_now_set.union(rejected_ids) == pending
            and all(
                isinstance(issues, list)
                and bool(issues)
                and all(isinstance(issue, str) and issue for issue in issues)
                for issues in rejected.values()
            ),
            f"{batch_id}: invalid receipt rejection surface",
        )
        pending = rejected_ids
        author_thread = receipt.get("authorThreadId")
        reviewer_thread = receipt.get("reviewerThreadId")
        require(
            isinstance(author_thread, str)
            and author_thread
            and isinstance(reviewer_thread, str)
            and reviewer_thread
            and author_thread != reviewer_thread,
            f"{batch_id}: author/reviewer session independence collapsed",
        )
        require(
            author_thread not in seen_threads and reviewer_thread not in seen_threads,
            f"{batch_id}: provider session was reused",
        )
        seen_threads.update((author_thread, reviewer_thread))
        for role in ("author", "reviewer"):
            usage = receipt.get(f"{role}Usage")
            require(
                isinstance(usage, dict)
                and strict_positive_int(usage.get("input_tokens"))
                and strict_positive_int(usage.get("output_tokens")),
                f"{batch_id}: {role} provider usage is missing",
            )
    require(not pending, f"{batch_id}: receipts do not accept every batch concept")


def validate_accepted(
    payload: dict[str, Any],
    *,
    batch_id: str,
    concepts: list[dict[str, Any]],
    spec: dict[str, Any],
    seen_threads: set[str],
) -> None:
    concept_ids = [row["conceptId"] for row in concepts]
    require(payload.get("batchId") == batch_id, f"{batch_id}: accepted artifact identity mismatch")
    require(payload.get("conceptIds") == concept_ids, f"{batch_id}: accepted concept partition mismatch")
    try:
        commissioner.validate_author(
            {"batchId": batch_id, "items": payload.get("items")},
            batch_id,
            concepts,
            spec,
        )
    except Exception as error:
        raise ContinuationError(f"{batch_id}: commissioner validation failed: {error}") from error
    validate_receipts(
        payload.get("receipts"),
        batch_id=batch_id,
        concept_ids=concept_ids,
        seen_threads=seen_threads,
    )


def validate_spec(args: argparse.Namespace) -> tuple[dict[str, Any], str]:
    spec, raw = read_regular_json(args.spec)
    digest = sha256_bytes(raw)
    require(digest == args.expected_spec_sha256, "commissioning spec SHA-256 differs from the frozen input")
    require(spec.get("schemaVersion") == commissioner.SPEC_SCHEMA, "commissioning spec schema mismatch")
    require(spec.get("campaignId") == args.expected_campaign_id, "commissioning campaign identity mismatch")
    require(spec.get("purpose") == "validity", "commissioning purpose is not validity")
    require(spec.get("source") == expected_source(args), "commissioning spec source identity mismatch")
    require(spec.get("modelRuntime") == EXPECTED_RUNTIME, "commissioning spec model runtime mismatch")
    require(spec.get("itemBlueprints") == EXPECTED_BLUEPRINTS, "commissioning validity blueprint mismatch")
    concepts = spec.get("concepts")
    require(
        isinstance(concepts, list)
        and len(concepts) == 288
        and spec.get("conceptCount") == 288
        and spec.get("expectedItemCount") == 576,
        "commissioning spec is not exact 288/576 coverage",
    )
    concept_ids = [row.get("conceptId") for row in concepts if isinstance(row, dict)]
    require(
        len(concept_ids) == 288
        and all(isinstance(value, str) and commissioner.SAFE_ID.fullmatch(value) for value in concept_ids)
        and len(set(concept_ids)) == 288,
        "commissioning spec has duplicate or invalid concept identities",
    )
    batches = [concepts[index:index + 4] for index in range(0, len(concepts), 4)]
    require(len(batches) == 72 and all(len(batch) == 4 for batch in batches), "commissioning partition is not exact 72 by 4")
    repair_ids = [row["conceptId"] for row in batches[REPAIR_BATCH_INDEX - 1]]
    require(repair_ids == REPAIR_CONCEPT_IDS, "batch-050 pending concept identities or order differ")
    return spec, digest


def validate_prior_state(args: argparse.Namespace) -> tuple[dict[str, Any], str]:
    state_path = args.prior_root / "state.json"
    prior, raw = read_regular_json(state_path)
    digest = sha256_bytes(raw)
    require(digest == args.expected_prior_state_sha256, "prior blocked state SHA-256 differs from the approved state")
    expected_blocker = f"{REPAIR_BATCH_ID} exhausted independent review repairs: {REPAIR_CONCEPT_IDS!r}"
    checks = {
        "schemaVersion": commissioner.SCHEMA,
        "status": "blocked",
        "campaignId": args.expected_campaign_id,
        "purpose": "validity",
        "artifactRoot": str(args.prior_root),
        "source": expected_source(args),
        "model": EXPECTED_RUNTIME["model"],
        "thinking": EXPECTED_RUNTIME["thinking"],
        "batchSize": 4,
        "totalBatches": 72,
        "completedBatches": 71,
        "acceptedConcepts": 284,
        "acceptedItems": 568,
        "blocker": expected_blocker,
    }
    for key, expected in checks.items():
        require(prior.get(key) == expected, f"prior blocked state {key} mismatch")
    started = prior.get("providerCallsStarted")
    completed = prior.get("providerCallsCompleted")
    require(
        strict_positive_int(started) and completed == started,
        "prior blocked state provider-call accounting is incomplete",
    )
    return prior, digest


def validate_batch_directories(prior_root: Path) -> None:
    batches_root = prior_root / "batches"
    require(batches_root.is_dir() and not batches_root.is_symlink(), "prior batches root is unsafe or missing")
    expected_names = {f"batch-{index:03d}" for index in range(1, 73)}
    observed: set[str] = set()
    for entry in batches_root.iterdir():
        require(entry.is_dir() and not entry.is_symlink(), f"unexpected non-directory prior batch entry: {entry.name}")
        observed.add(entry.name)
    require(observed == expected_names, "prior batch directory partition is not exact 72 batches")
    repair_root = batches_root / REPAIR_BATCH_ID
    require(not (repair_root / "accepted.json").exists(), "batch-050 unexpectedly has historical accepted content")
    attempt_names = {
        entry.name for entry in repair_root.iterdir()
        if entry.is_dir() and not entry.is_symlink() and entry.name.startswith("attempt-")
    }
    require(attempt_names == {f"attempt-{index}" for index in range(1, 7)}, "batch-050 does not have exactly six historical attempts")


def inventory_prior(
    args: argparse.Namespace,
    spec: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], set[str]]:
    validate_batch_directories(args.prior_root)
    batches = [spec["concepts"][index:index + 4] for index in range(0, 288, 4)]
    expected_paths = {
        args.prior_root / "batches" / f"batch-{index:03d}" / "accepted.json"
        for index in range(1, 73) if index != REPAIR_BATCH_INDEX
    }
    observed_paths = set((args.prior_root / "batches").rglob("accepted.json"))
    require(observed_paths == expected_paths, "prior accepted.json artifact set is not exactly 71 non-batch-050 files")
    inventory: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    seen_item_keys: set[str] = set()
    seen_concepts: set[str] = set()
    seen_threads: set[str] = set()
    for index, concepts in enumerate(batches, 1):
        if index == REPAIR_BATCH_INDEX:
            continue
        batch_id = f"batch-{index:03d}"
        path = args.prior_root / "batches" / batch_id / "accepted.json"
        payload, raw = read_regular_json(path)
        validate_accepted(
            payload,
            batch_id=batch_id,
            concepts=concepts,
            spec=spec,
            seen_threads=seen_threads,
        )
        concept_ids = [row["conceptId"] for row in concepts]
        item_keys = [row["itemKey"] for row in payload["items"]]
        require(not seen_concepts.intersection(concept_ids), f"{batch_id}: duplicate concept identity across batches")
        require(not seen_item_keys.intersection(item_keys), f"{batch_id}: duplicate item key across reused batches")
        seen_concepts.update(concept_ids)
        seen_item_keys.update(item_keys)
        inventory.append({
            "batchId": batch_id,
            "relativePath": f"batches/{batch_id}/accepted.json",
            "sha256": sha256_bytes(raw),
            "bytes": len(raw),
            "conceptIds": concept_ids,
            "itemCount": len(payload["items"]),
        })
        results.append(payload)
    require(len(inventory) == 71, "reused acceptance inventory is not exactly 71 artifacts")
    require(len(seen_concepts) == 284 and len(seen_item_keys) == 568, "reused acceptance coverage is not exact 284/568")
    require(set(REPAIR_CONCEPT_IDS).isdisjoint(seen_concepts), "missing concepts appear in reused acceptance coverage")
    return results, inventory, seen_threads


def runtime_material_provenance(args: argparse.Namespace) -> dict[str, Any]:
    require(os.access(args.codex, os.X_OK), "Codex executable lost executable approval during continuation")
    author_raw = read_regular_bytes(args.author_schema)
    reviewer_raw = read_regular_bytes(args.reviewer_schema)
    binding, binding_raw = read_regular_json(args.approved_model_executable_binding)
    codex_sha256, codex_bytes = sha256_regular_file(args.codex)
    require(sha256_bytes(author_raw) == args.expected_author_schema_sha256, "author output schema changed during continuation")
    require(sha256_bytes(reviewer_raw) == args.expected_reviewer_schema_sha256, "reviewer output schema changed during continuation")
    require(
        sha256_bytes(binding_raw) == args.expected_approved_model_executable_binding_sha256,
        "approved executable binding changed during continuation",
    )
    require(
        binding.get("path") == str(args.codex)
        and binding.get("sha256") == codex_sha256
        and binding.get("bytes") == codex_bytes,
        "approved executable changed during continuation",
    )
    return {
        "authorSchema": {"path": str(args.author_schema), "sha256": args.expected_author_schema_sha256},
        "reviewerSchema": {"path": str(args.reviewer_schema), "sha256": args.expected_reviewer_schema_sha256},
        "approvedModelExecutableBinding": {
            "path": str(args.approved_model_executable_binding),
            "sha256": args.expected_approved_model_executable_binding_sha256,
        },
        "codexExecutable": {"path": str(args.codex), "sha256": codex_sha256, "bytes": codex_bytes},
    }


def build_reuse_provenance(
    args: argparse.Namespace,
    *,
    spec_digest: str,
    prior_state_digest: str,
    inventory: list[dict[str, Any]],
    prior_manifest: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schemaVersion": PROVENANCE_SCHEMA,
        "campaignId": args.expected_campaign_id,
        "source": expected_source(args),
        "modelRuntime": copy.deepcopy(EXPECTED_RUNTIME),
        "runtimeMaterials": runtime_material_provenance(args),
        "historicalRuntimeRoot": str(args.historical_runtime_root),
        "freshRuntimeRoot": str(args.fresh_runtime_root),
        "priorBlockedRoot": str(args.prior_root),
        "priorState": {
            "relativePath": "state.json",
            "sha256": prior_state_digest,
            "schemaVersion": commissioner.SCHEMA,
            "status": "blocked",
        },
        "commissioningSpec": {
            "path": str(args.spec),
            "sha256": spec_digest,
            "schemaVersion": commissioner.SPEC_SCHEMA,
        },
        "partition": {
            "batchSize": 4,
            "totalBatches": 72,
            "reusedBatches": 71,
            "reusedConcepts": 284,
            "reusedItems": 568,
            "repairBatchId": REPAIR_BATCH_ID,
            "repairConceptIds": list(REPAIR_CONCEPT_IDS),
            "historicalRepairAttempts": 6,
        },
        "priorRootManifest": copy.deepcopy(prior_manifest),
        "reusedAcceptedArtifacts": copy.deepcopy(inventory),
        "reusedAcceptedInventorySha256": sha256_json(inventory),
        "truthBoundary": TRUTH_BOUNDARY,
    }


def verify_prior_unchanged(
    args: argparse.Namespace,
    *,
    expected_spec: dict[str, Any],
    expected_provenance: dict[str, Any],
) -> tuple[list[dict[str, Any]], set[str]]:
    spec, spec_digest = validate_spec(args)
    _, prior_state_digest = validate_prior_state(args)
    results, inventory, seen_threads = inventory_prior(args, spec)
    prior_manifest = regular_tree_manifest(args.prior_root)
    require_manifest_bindings(
        prior_manifest,
        prior_state_digest=prior_state_digest,
        accepted_inventory=inventory,
    )
    require(canonical_json(spec) == canonical_json(expected_spec), "commissioning spec changed during continuation")
    observed = build_reuse_provenance(
        args,
        spec_digest=spec_digest,
        prior_state_digest=prior_state_digest,
        inventory=inventory,
        prior_manifest=prior_manifest,
    )
    require(observed == expected_provenance, "prior root, accepted inventory, or runtime material changed during continuation")
    return results, seen_threads


def directory_surface(path: Path, *, label: str) -> dict[str, str]:
    try:
        mode = path.lstat().st_mode
    except OSError as error:
        raise ContinuationError(f"{label} is unavailable: {path}: {error}") from error
    require(stat.S_ISDIR(mode), f"{label} is not a safe directory: {path}")
    surface: dict[str, str] = {}
    try:
        entries = list(path.iterdir())
    except OSError as error:
        raise ContinuationError(f"{label} cannot be enumerated: {path}: {error}") from error
    for entry in entries:
        try:
            entry_mode = entry.lstat().st_mode
        except OSError as error:
            raise ContinuationError(f"{label} entry is unavailable: {entry}: {error}") from error
        if stat.S_ISLNK(entry_mode):
            raise ContinuationError(f"{label} rejects symbolic links: {entry.name}")
        if stat.S_ISDIR(entry_mode):
            surface[entry.name] = "directory"
        elif stat.S_ISREG(entry_mode):
            surface[entry.name] = "file"
        else:
            raise ContinuationError(f"{label} rejects nonregular nodes: {entry.name}")
    return surface


def validate_fresh_attempts(
    args: argparse.Namespace,
    *,
    prior_threads: set[str],
    receipts: Any,
) -> tuple[int, list[dict[str, Any]]]:
    require(isinstance(receipts, list) and receipts, "fresh accepted artifact has no reviewed receipts")
    require(
        directory_surface(args.empty, label="fresh no-tools working directory") == {},
        "fresh no-tools working directory is no longer empty",
    )
    receipt_by_attempt: dict[int, dict[str, Any]] = {}
    for receipt in receipts:
        require(isinstance(receipt, dict), "fresh accepted artifact has an invalid receipt")
        attempt = receipt.get("attempt")
        require(
            strict_positive_int(attempt) and attempt not in receipt_by_attempt,
            "fresh accepted artifact has duplicate or invalid receipt attempts",
        )
        receipt_by_attempt[attempt] = receipt

    batches_root = args.root / "batches"
    require(
        directory_surface(batches_root, label="fresh batches root") == {REPAIR_BATCH_ID: "directory"},
        "fresh batches root must contain only batch-050",
    )
    batch_root = batches_root / REPAIR_BATCH_ID
    batch_surface = directory_surface(batch_root, label="fresh repair batch root")
    attempt_names = sorted(
        name for name, kind in batch_surface.items()
        if kind == "directory" and re.fullmatch(r"attempt-[1-6]", name)
    )
    attempt_numbers = sorted(int(name.removeprefix("attempt-")) for name in attempt_names)
    require(
        bool(attempt_numbers)
        and attempt_numbers == list(range(1, max(attempt_numbers) + 1))
        and max(attempt_numbers) <= args.max_attempts,
        "fresh repair attempt directories are incomplete or out of bounds",
    )
    expected_batch_surface = {
        **{name: "directory" for name in attempt_names},
        "accepted.json": "file",
        "progress.json": "file",
    }
    require(batch_surface == expected_batch_surface, "fresh repair batch artifact surface is not exact")
    progress, _ = read_regular_json(batch_root / "progress.json")
    require(
        progress.get("acceptedConceptIds") == sorted(REPAIR_CONCEPT_IDS)
        and progress.get("pendingConceptIds") == []
        and progress.get("receipts") == receipts,
        "fresh repair progress does not exactly describe the accepted artifact",
    )

    calls: list[dict[str, Any]] = []
    event_threads: set[str] = set()
    role_attempts: set[tuple[int, str]] = set()
    reviewed_attempts: set[int] = set()
    author_files = {
        "author-prompt.txt",
        "author-output.json",
        "author-events.jsonl",
        "author-stderr.log",
    }
    reviewer_files = {
        "reviewer-prompt.txt",
        "reviewer-output.json",
        "reviewer-events.jsonl",
        "reviewer-stderr.log",
    }
    pending_ids = set(REPAIR_CONCEPT_IDS)
    for attempt in attempt_numbers:
        attempt_root = batch_root / f"attempt-{attempt}"
        attempt_surface = directory_surface(attempt_root, label=f"fresh attempt {attempt}")
        mechanical_rejection = "mechanical-rejection.json" in attempt_surface
        expected_files = author_files | ({"mechanical-rejection.json"} if mechanical_rejection else reviewer_files)
        require(
            attempt_surface == {name: "file" for name in expected_files},
            f"fresh attempt {attempt} artifact surface is not exact",
        )
        expected_batch_id = REPAIR_BATCH_ID if attempt == 1 else f"{REPAIR_BATCH_ID}-repair-{attempt - 1}"
        author_output, _ = read_regular_json(attempt_root / "author-output.json")
        read_regular_bytes(attempt_root / "author-prompt.txt")
        receipt = receipt_by_attempt.get(attempt)
        if mechanical_rejection:
            require(receipt is None, f"fresh attempt {attempt} mechanical rejection unexpectedly has a receipt")
            rejection, _ = read_regular_json(attempt_root / "mechanical-rejection.json")
            rejected_ids = rejection.get("rejectedConceptIds")
            require(
                rejection.get("batchId") == expected_batch_id
                and isinstance(rejection.get("error"), str)
                and bool(rejection["error"])
                and isinstance(rejected_ids, list)
                and bool(rejected_ids)
                and len(rejected_ids) == len(set(rejected_ids))
                and set(rejected_ids) == pending_ids,
                f"fresh attempt {attempt} mechanical rejection is invalid",
            )
        else:
            require(receipt is not None, f"fresh reviewed attempt {attempt} has no exact receipt")
            require(receipt.get("batchId") == expected_batch_id, f"fresh attempt {attempt} receipt identity mismatch")
            require(author_output.get("batchId") == expected_batch_id, f"fresh attempt {attempt} author identity mismatch")
            reviewer_output, _ = read_regular_json(attempt_root / "reviewer-output.json")
            require(reviewer_output.get("batchId") == expected_batch_id, f"fresh attempt {attempt} reviewer identity mismatch")
            read_regular_bytes(attempt_root / "reviewer-prompt.txt")
            reviewed_attempts.add(attempt)
            pending_ids = set(receipt["rejected"])

        for role in (("author",) if mechanical_rejection else ("author", "reviewer")):
            role_attempt = (attempt, role)
            require(role_attempt not in role_attempts, f"fresh attempt {attempt} duplicated the {role} call")
            role_attempts.add(role_attempt)
            events_path = attempt_root / f"{role}-events.jsonl"
            raw = read_regular_bytes(events_path)
            try:
                observed = commissioner.validate_event_bytes(raw)
            except Exception as error:
                raise ContinuationError(f"fresh attempt {attempt} {role} event validation failed: {error}") from error
            thread_id = observed["threadId"]
            require(
                isinstance(thread_id, str)
                and thread_id
                and thread_id not in prior_threads
                and thread_id not in event_threads,
                f"fresh attempt {attempt} reused a provider session",
            )
            event_threads.add(thread_id)
            if receipt is not None:
                require(
                    receipt.get(f"{role}ThreadId") == thread_id
                    and receipt.get(f"{role}Usage") == observed["usage"],
                    f"fresh attempt {attempt} {role} receipt is not exactly bound to its event ledger",
                )
            calls.append({
                "attempt": attempt,
                "role": role,
                "threadId": thread_id,
                "eventsSha256": sha256_bytes(raw),
                "usage": observed["usage"],
            })
    require(set(receipt_by_attempt) == reviewed_attempts, "fresh reviewed attempts and receipts differ")
    require(not pending_ids, "fresh repair attempt surface does not end in full acceptance")
    final_attempt = max(attempt_numbers)
    require(
        final_attempt in reviewed_attempts
        and receipt_by_attempt[final_attempt].get("rejected") == {},
        "final fresh repair attempt was not independently reviewed and fully accepted",
    )
    require(
        commissioner.PROGRESS.get("providerCallsStarted") == len(calls)
        and commissioner.PROGRESS.get("providerCallsCompleted") == len(calls),
        "fresh provider-call accounting differs from event-ledger coverage",
    )
    return final_attempt, calls


def validate_repair_artifact(
    args: argparse.Namespace,
    *,
    spec: dict[str, Any],
    prior_threads: set[str],
) -> tuple[dict[str, Any], dict[str, Any]]:
    repair_concepts = spec["concepts"][(REPAIR_BATCH_INDEX - 1) * 4:REPAIR_BATCH_INDEX * 4]
    repair_path = args.root / "batches" / REPAIR_BATCH_ID / "accepted.json"
    repair_result, repair_raw = read_regular_json(repair_path)
    all_receipt_threads = set(prior_threads)
    validate_accepted(
        repair_result,
        batch_id=REPAIR_BATCH_ID,
        concepts=repair_concepts,
        spec=spec,
        seen_threads=all_receipt_threads,
    )
    attempt_count, provider_calls = validate_fresh_attempts(
        args,
        prior_threads=prior_threads,
        receipts=repair_result.get("receipts"),
    )
    repair_manifest = regular_tree_manifest(
        args.root / "batches" / REPAIR_BATCH_ID,
        label="fresh repair batch root",
    )
    artifact = {
        "batchId": REPAIR_BATCH_ID,
        "relativePath": f"batches/{REPAIR_BATCH_ID}/accepted.json",
        "sha256": sha256_bytes(repair_raw),
        "bytes": len(repair_raw),
        "conceptIds": list(REPAIR_CONCEPT_IDS),
        "itemCount": len(repair_result["items"]),
        "attemptCount": attempt_count,
        "acceptedAttempt": attempt_count,
        "reviewedAttemptCount": len(repair_result["receipts"]),
        "providerCalls": provider_calls,
        "artifactManifest": repair_manifest,
    }
    return repair_result, artifact


def initialize_progress(args: argparse.Namespace, reuse_provenance: dict[str, Any]) -> dict[str, Any]:
    started = utc_now()
    return {
        "schemaVersion": STATE_SCHEMA,
        "status": "running",
        "phase": "repair_batch_commissioning",
        "campaignId": args.expected_campaign_id,
        "purpose": "validity",
        "artifactRoot": str(args.root),
        "historicalRuntimeRoot": str(args.historical_runtime_root),
        "freshRuntimeRoot": str(args.fresh_runtime_root),
        "priorBlockedRoot": str(args.prior_root),
        "source": expected_source(args),
        "model": EXPECTED_RUNTIME["model"],
        "thinking": EXPECTED_RUNTIME["thinking"],
        "serviceTier": EXPECTED_RUNTIME["serviceTier"],
        "concurrency": 1,
        "batchSize": 4,
        "completedBatches": 71,
        "totalBatches": 72,
        "acceptedConcepts": 284,
        "acceptedItems": 568,
        "reusedBatches": 71,
        "repairBatchId": REPAIR_BATCH_ID,
        "repairConceptIds": list(REPAIR_CONCEPT_IDS),
        "providerCallsStarted": 0,
        "providerCallsCompleted": 0,
        "providerInputTokens": 0,
        "providerOutputTokens": 0,
        "providerReasoningTokens": 0,
        "reuseProvenance": copy.deepcopy(reuse_provenance),
        "startedAt": started,
        "updatedAt": started,
        "truthBoundary": TRUTH_BOUNDARY,
    }


def validate_paths_and_runtime(args: argparse.Namespace) -> None:
    require(
        args.historical_runtime_root.is_absolute()
        and args.fresh_runtime_root.is_absolute()
        and args.root.is_absolute()
        and args.prior_root.is_absolute()
        and args.spec.is_absolute(),
        "continuation paths must be absolute",
    )
    require(
        args.historical_runtime_root == args.historical_runtime_root.resolve(strict=True),
        "historical runtime root must be a canonical existing path",
    )
    require(
        args.historical_runtime_root.is_dir() and not args.historical_runtime_root.is_symlink(),
        "historical runtime root is unsafe",
    )
    require(
        args.fresh_runtime_root == args.fresh_runtime_root.resolve(strict=False),
        "fresh runtime root must be a canonical absolute path",
    )
    require(args.root == args.root.resolve(strict=False), "continuation root must be a canonical absolute path")
    require(args.prior_root == args.prior_root.resolve(strict=True), "prior blocked root must be a canonical existing path")
    require(args.prior_root.is_dir() and not args.prior_root.is_symlink(), "prior blocked root is unsafe")
    require(
        args.prior_root == args.historical_runtime_root / "commissioning",
        "prior blocked root is not the historical runtime commissioning root",
    )
    require(
        args.root == args.fresh_runtime_root / "commissioning",
        "continuation root is not the fresh runtime commissioning root",
    )
    require(
        args.historical_runtime_root != args.fresh_runtime_root
        and args.historical_runtime_root not in args.fresh_runtime_root.parents
        and args.fresh_runtime_root not in args.historical_runtime_root.parents,
        "historical and fresh runtime roots must be disjoint",
    )
    require(args.empty.is_absolute() and args.empty == args.empty.resolve(strict=False), "empty working directory must be canonical and absolute")
    require(args.fresh_runtime_root in args.empty.parents, "empty working directory must remain under the fresh runtime root")
    require(
        args.empty != args.root
        and args.empty not in args.root.parents
        and args.root not in args.empty.parents,
        "empty working directory and commissioning root must be disjoint",
    )
    require(
        args.spec == args.historical_runtime_root / "inputs" / "validity.commissioning-spec.json",
        "commissioning spec is not the exact historical campaign input",
    )
    require(
        args.approved_model_executable_binding
        == args.historical_runtime_root / "inputs" / "approved-model-executable.json",
        "approved executable binding is not the exact historical campaign input",
    )
    for material, historical_input_allowed in (
        (args.spec, True),
        (args.author_schema, False),
        (args.reviewer_schema, False),
        (args.codex, False),
        (args.approved_model_executable_binding, True),
    ):
        require(material.is_absolute(), f"runtime material path must be absolute: {material}")
        require(material == material.resolve(strict=True), f"runtime material path must be canonical: {material}")
        if not historical_input_allowed:
            require(
                args.historical_runtime_root != material and args.historical_runtime_root not in material.parents,
                f"mutable runtime material is inside the historical runtime root: {material}",
            )
    require(args.home.is_absolute() and args.home == args.home.resolve(strict=True), "continuation HOME must be canonical and absolute")
    require(
        args.home != args.historical_runtime_root and args.historical_runtime_root not in args.home.parents,
        "continuation HOME is inside the historical runtime root",
    )
    require(args.model == EXPECTED_RUNTIME["model"], "continuation model must be gpt-5.6-sol")
    require(args.thinking == EXPECTED_RUNTIME["thinking"], "continuation thinking must be ultra")
    require(args.service_tier == EXPECTED_RUNTIME["serviceTier"], "continuation service tier must be fast")
    require(1 <= args.max_attempts <= 6, "continuation attempts must be bounded to 1..6")
    require(1 <= args.call_timeout <= 1800, "continuation provider timeout must be bounded to 1..1800 seconds")
    require(commissioner.SAFE_ID.fullmatch(args.expected_campaign_id) is not None, "invalid expected campaign identity")
    require(HEX_40.fullmatch(args.expected_source_commit) is not None, "invalid expected source commit")
    require(HEX_40.fullmatch(args.expected_source_tree) is not None, "invalid expected source tree")
    require(HEX_40.fullmatch(args.expected_product_tree) is not None, "invalid expected product tree")
    require(HEX_64.fullmatch(args.expected_prior_state_sha256) is not None, "invalid expected prior state SHA-256")
    require(HEX_64.fullmatch(args.expected_spec_sha256) is not None, "invalid expected spec SHA-256")
    require(HEX_64.fullmatch(args.expected_author_schema_sha256) is not None, "invalid expected author schema SHA-256")
    require(HEX_64.fullmatch(args.expected_reviewer_schema_sha256) is not None, "invalid expected reviewer schema SHA-256")
    require(HEX_64.fullmatch(args.expected_approved_model_executable_binding_sha256) is not None, "invalid expected executable binding SHA-256")


def validate_runtime_material(args: argparse.Namespace) -> None:
    for path, label in (
        (args.author_schema, "author schema"),
        (args.reviewer_schema, "reviewer schema"),
        (args.codex, "Codex executable"),
    ):
        require(path.is_file() and not path.is_symlink(), f"{label} must be regular material")
    require(os.access(args.codex, os.X_OK), "Codex executable is not executable")
    require(args.home.is_dir() and not args.home.is_symlink(), "continuation HOME is unsafe or missing")
    author_schema_raw = read_regular_bytes(args.author_schema)
    reviewer_schema_raw = read_regular_bytes(args.reviewer_schema)
    require(sha256_bytes(author_schema_raw) == args.expected_author_schema_sha256, "author output schema SHA-256 mismatch")
    require(sha256_bytes(reviewer_schema_raw) == args.expected_reviewer_schema_sha256, "reviewer output schema SHA-256 mismatch")
    decode_object(author_schema_raw, args.author_schema)
    decode_object(reviewer_schema_raw, args.reviewer_schema)
    binding, binding_raw = read_regular_json(args.approved_model_executable_binding)
    require(
        sha256_bytes(binding_raw) == args.expected_approved_model_executable_binding_sha256,
        "approved model executable binding SHA-256 mismatch",
    )
    executable_sha256, executable_bytes = sha256_regular_file(args.codex)
    require(
        binding.get("schemaVersion") == "cortex.learning_os.approved_model_executable.v1"
        and binding.get("path") == str(args.codex)
        and binding.get("sha256") == executable_sha256
        and binding.get("bytes") == executable_bytes,
        "Codex executable differs from its approved binding",
    )
    require(not args.empty.exists(), "empty working directory is not fresh")
    args.empty.mkdir(parents=True, mode=0o700)
    os.chmod(args.empty, 0o700)
    require(not any(args.empty.iterdir()), "empty working directory is not empty")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--historical-runtime-root", required=True, type=Path)
    result.add_argument("--fresh-runtime-root", required=True, type=Path)
    result.add_argument("--root", required=True, type=Path)
    result.add_argument("--prior-root", required=True, type=Path)
    result.add_argument("--spec", required=True, type=Path)
    result.add_argument("--author-schema", required=True, type=Path)
    result.add_argument("--reviewer-schema", required=True, type=Path)
    result.add_argument("--codex", required=True, type=Path)
    result.add_argument("--approved-model-executable-binding", required=True, type=Path)
    result.add_argument("--home", required=True, type=Path)
    result.add_argument("--empty", required=True, type=Path)
    result.add_argument("--expected-campaign-id", required=True)
    result.add_argument("--expected-source-commit", required=True)
    result.add_argument("--expected-source-tree", required=True)
    result.add_argument("--expected-product-tree", required=True)
    result.add_argument("--expected-prior-state-sha256", required=True)
    result.add_argument("--expected-spec-sha256", required=True)
    result.add_argument("--expected-author-schema-sha256", required=True)
    result.add_argument("--expected-reviewer-schema-sha256", required=True)
    result.add_argument("--expected-approved-model-executable-binding-sha256", required=True)
    result.add_argument("--model", default="gpt-5.6-sol")
    result.add_argument("--thinking", default="ultra", choices=["ultra"])
    result.add_argument("--service-tier", default="fast", choices=["fast"])
    result.add_argument("--max-attempts", default=6, type=int)
    result.add_argument("--call-timeout", default=1200, type=int)
    return result


def structured_preflight_blocker(args: argparse.Namespace, error: Exception) -> int:
    value = {
        "schemaVersion": BLOCKER_SCHEMA,
        "status": "blocked",
        "phase": "preflight",
        "campaignId": getattr(args, "expected_campaign_id", None),
        "historicalRuntimeRoot": str(getattr(args, "historical_runtime_root", "")),
        "freshRuntimeRoot": str(getattr(args, "fresh_runtime_root", "")),
        "blocker": {"code": "continuation_preflight_rejected", "message": str(error)},
        "truthBoundary": TRUTH_BOUNDARY,
    }
    print(json.dumps(value, indent=2, sort_keys=True), file=sys.stderr)
    return 2


def main() -> int:
    args = parser().parse_args()
    try:
        validate_paths_and_runtime(args)
        if args.fresh_runtime_root.exists() or args.fresh_runtime_root.is_symlink():
            raise ContinuationError("fresh runtime root must be absent")
        if args.root.exists() or args.root.is_symlink():
            raise ContinuationError("continuation root must be fresh and absent")
        args.fresh_runtime_root.mkdir(parents=True, mode=0o700)
        os.chmod(args.fresh_runtime_root, 0o700)
        args.root.mkdir(mode=0o700)
        os.chmod(args.root, 0o700)
        state_path = args.root / "state.json"
        blocker_path = args.root / "blocker-report.json"
        output_path = args.root / "commissioned-content.json"
        bootstrap = {
            "schemaVersion": STATE_SCHEMA,
            "status": "validating",
            "phase": "prior_identity_validation",
            "campaignId": args.expected_campaign_id,
            "artifactRoot": str(args.root),
            "historicalRuntimeRoot": str(args.historical_runtime_root),
            "freshRuntimeRoot": str(args.fresh_runtime_root),
            "priorBlockedRoot": str(args.prior_root),
            "source": expected_source(args),
            "repairBatchId": REPAIR_BATCH_ID,
            "repairConceptIds": list(REPAIR_CONCEPT_IDS),
            "startedAt": utc_now(),
            "updatedAt": utc_now(),
            "truthBoundary": TRUTH_BOUNDARY,
        }
        atomic_json(state_path, bootstrap)
    except Exception as error:
        return structured_preflight_blocker(args, error)

    phase = "prior_identity_validation"
    try:
        validate_runtime_material(args)
        spec, spec_digest = validate_spec(args)
        _, prior_state_digest = validate_prior_state(args)
        prior_results, inventory, prior_threads = inventory_prior(args, spec)
        prior_manifest = regular_tree_manifest(args.prior_root)
        require_manifest_bindings(
            prior_manifest,
            prior_state_digest=prior_state_digest,
            accepted_inventory=inventory,
        )
        reuse_provenance = build_reuse_provenance(
            args,
            spec_digest=spec_digest,
            prior_state_digest=prior_state_digest,
            inventory=inventory,
            prior_manifest=prior_manifest,
        )

        commissioner.PROGRESS.clear()
        commissioner.PROGRESS.update(initialize_progress(args, reuse_provenance))
        atomic_json(state_path, commissioner.PROGRESS)
        phase = "repair_batch_commissioning"
        repair_concepts = spec["concepts"][(REPAIR_BATCH_INDEX - 1) * 4:REPAIR_BATCH_INDEX * 4]
        commissioner.commission_batch(args, state_path, spec, REPAIR_BATCH_INDEX, repair_concepts)

        phase = "prior_inventory_reverification"
        commissioner.update_state(
            state_path,
            phase=phase,
            status="running",
        )
        prior_results, prior_threads = verify_prior_unchanged(
            args,
            expected_spec=spec,
            expected_provenance=reuse_provenance,
        )

        repair_result, repair_artifact = validate_repair_artifact(
            args,
            spec=spec,
            prior_threads=prior_threads,
        )
        continuation_provenance = copy.deepcopy(reuse_provenance)
        continuation_provenance["repairAcceptedArtifact"] = repair_artifact

        phase = "fresh_output_assembly"
        results = [*prior_results, repair_result]
        results.sort(key=lambda row: row["batchId"])
        require([row["batchId"] for row in results] == [f"batch-{index:03d}" for index in range(1, 73)], "assembled batch receipts are not exact 72-batch coverage")
        concept_ids = [concept_id for row in results for concept_id in row["conceptIds"]]
        items = [item for row in results for item in row["items"]]
        item_keys = [row["itemKey"] for row in items]
        require(len(concept_ids) == 288 and len(set(concept_ids)) == 288, "assembled concept identity coverage is not unique 288")
        require(len(items) == 576 and len(set(item_keys)) == 576, "assembled item key coverage is not unique 576")
        require(set(concept_ids) == {row["conceptId"] for row in spec["concepts"]}, "assembled concept surface differs from the spec")
        require(set(item_keys) == set(commissioner.expected_items(spec, spec["concepts"])), "assembled item surface differs from the spec")
        output = {
            "schemaVersion": commissioner.OUTPUT_SCHEMA,
            "campaignId": spec["campaignId"],
            "purpose": spec["purpose"],
            "source": spec["source"],
            "conceptCount": 288,
            "itemCount": 576,
            "itemBlueprints": spec["itemBlueprints"],
            "authoringModel": args.model,
            "reviewingModel": args.model,
            "roleIsolation": "fresh_ephemeral_no_tool_author_and_reviewer_sessions_with_sha256_verified_prior_acceptance_reuse",
            "items": items,
            "batchReceipts": [{"batchId": row["batchId"], "receipts": row["receipts"]} for row in results],
            "continuationProvenance": continuation_provenance,
            "completedAt": utc_now(),
            "truthBoundary": TRUTH_BOUNDARY,
        }
        atomic_json(output_path, output)
        phase = "final_provenance_reverification"
        try:
            _, final_prior_threads = verify_prior_unchanged(
                args,
                expected_spec=spec,
                expected_provenance=reuse_provenance,
            )
            _, final_repair_artifact = validate_repair_artifact(
                args,
                spec=spec,
                prior_threads=final_prior_threads,
            )
            require(
                final_repair_artifact == repair_artifact,
                "fresh repair artifact or provider provenance changed before completion",
            )
            final_output, final_output_raw = read_regular_json(output_path)
            require(final_output == output, "assembled output changed before completion")
            output_digest = sha256_bytes(final_output_raw)
        except Exception as verification_error:
            try:
                output_path.unlink(missing_ok=True)
            except OSError as removal_error:
                raise ContinuationError(
                    f"final provenance verification failed ({verification_error}); "
                    f"fresh output removal also failed: {removal_error}"
                ) from verification_error
            raise
        commissioner.update_state(
            state_path,
            status="completed",
            phase="completed",
            completedBatches=72,
            acceptedConcepts=288,
            acceptedItems=576,
            reusedBatches=71,
            continuationProvenance=continuation_provenance,
            outputPath=str(output_path),
            outputSha256=output_digest,
            completedAt=utc_now(),
        )
        print(json.dumps(commissioner.PROGRESS, indent=2, sort_keys=True))
        return 0
    except Exception as error:
        blocker = {
            "schemaVersion": BLOCKER_SCHEMA,
            "status": "blocked",
            "campaignId": args.expected_campaign_id,
            "blockedAt": utc_now(),
            "phase": phase,
            "artifactRoot": str(args.root),
            "historicalRuntimeRoot": str(args.historical_runtime_root),
            "freshRuntimeRoot": str(args.fresh_runtime_root),
            "priorBlockedRoot": str(args.prior_root),
            "repairBatchId": REPAIR_BATCH_ID,
            "repairConceptIds": list(REPAIR_CONCEPT_IDS),
            "blocker": {
                "code": "continuation_contract_rejected",
                "message": str(error),
            },
            "truthBoundary": TRUTH_BOUNDARY,
        }
        atomic_json(blocker_path, blocker)
        state = dict(commissioner.PROGRESS) if commissioner.PROGRESS else bootstrap
        reused_validated = phase != "prior_identity_validation"
        state.update({
            "schemaVersion": STATE_SCHEMA,
            "status": "blocked",
            "phase": phase,
            "blocker": blocker["blocker"],
            "blockerReport": str(blocker_path),
            "completedBatches": 71 if reused_validated else 0,
            "acceptedConcepts": 284 if reused_validated else 0,
            "acceptedItems": 568 if reused_validated else 0,
            "assembledOutputAvailable": False,
            "blockedAt": blocker["blockedAt"],
            "updatedAt": utc_now(),
            "truthBoundary": TRUTH_BOUNDARY,
        })
        atomic_json(state_path, state)
        print(json.dumps(state, indent=2, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
