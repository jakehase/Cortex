#!/usr/bin/env python3
"""Control-plane supervisor for the full 288-concept near-term validity lane."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
from pathlib import PurePosixPath
import re
import shutil
import stat as stat_module
import subprocess
import sys
import tempfile
import time
from typing import Any

SCHEMA = "cortex.learning_os.validity_pipeline.v1"
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
SOURCE_REF = re.compile(r"^refs/heads/[A-Za-z0-9._/-]+$")
REMOTE_HOST = re.compile(r"^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$")
REMOTE_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
TERMINAL = {"completed", "failed", "blocked"}
CONTINUATION_STATE_SCHEMA = "cortex.learning_os.continuous_math_bank_commissioning_continuation_state.v1"
CONTINUATION_PROVENANCE_SCHEMA = "cortex.learning_os.continuous_math_bank_commissioning_continuation_provenance.v1"
CONTINUATION_REPAIR_BATCH = "batch-050"
CONTINUATION_REPAIR_CONCEPTS = [
    "differential-equations-weak-solutions",
    "statistics-likelihood-estimation",
    "statistics-neyman-pearson-testing",
    "numerical-analysis-conditioning",
]
CONTINUATION_RUNTIME = {
    "provider": "openai-codex",
    "model": "gpt-5.6-sol",
    "thinking": "ultra",
    "serviceTier": "fast",
    "sandbox": "read-only",
    "toolsAllowed": False,
}
CONTINUATION_TRUTH_BOUNDARY = (
    "Commissioning continuation proves only identity-bound, role-isolated assessment-content mechanics. "
    "Reuse and acceptance grant no validity, retention, utility, mastery, or model-weight credit."
)


class ValidityPipelineError(RuntimeError):
    pass


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
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


def atomic_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def read(path: Path) -> dict[str, Any]:
    stat = path.lstat()
    if not path.is_file() or path.is_symlink() or stat.st_size < 1 or stat.st_size > 512 * 1024 * 1024:
        raise ValidityPipelineError(f"unsafe JSON input: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValidityPipelineError(f"JSON object required: {path}")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular_file_identity(
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
        raise ValidityPipelineError(f"unsafe or unavailable regular file: {path}: {error}") from error
    try:
        before = os.fstat(descriptor)
        minimum = 0 if allow_empty else 1
        if not stat_module.S_ISREG(before.st_mode) or before.st_size < minimum or before.st_size > maximum:
            raise ValidityPipelineError(f"unsafe regular-file size or type: {path}")
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > maximum:
                raise ValidityPipelineError(f"regular file exceeds size cap: {path}")
            digest.update(chunk)
        after = os.fstat(descriptor)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
        ):
            raise ValidityPipelineError(f"regular file changed while being hashed: {path}")
        return digest.hexdigest(), total
    finally:
        os.close(descriptor)


def regular_tree_manifest(root: Path) -> dict[str, Any]:
    try:
        root_mode = root.lstat().st_mode
    except OSError as error:
        raise ValidityPipelineError(f"regular tree root is unavailable: {root}: {error}") from error
    if not stat_module.S_ISDIR(root_mode):
        raise ValidityPipelineError(f"regular tree root is unsafe: {root}")
    directories = ["."]
    files: list[dict[str, Any]] = []
    pending = [root]
    while pending:
        directory = pending.pop()
        for entry in sorted(directory.iterdir(), key=lambda target: target.name):
            mode = entry.lstat().st_mode
            relative = entry.relative_to(root).as_posix()
            if stat_module.S_ISLNK(mode):
                raise ValidityPipelineError(f"regular tree contains a symlink: {relative}")
            if stat_module.S_ISDIR(mode):
                directories.append(relative)
                pending.append(entry)
            elif stat_module.S_ISREG(mode):
                digest, size = regular_file_identity(entry, allow_empty=True)
                files.append({"relativePath": relative, "sha256": digest, "bytes": size})
            else:
                raise ValidityPipelineError(f"regular tree contains a nonregular node: {relative}")
    directories.sort()
    files.sort(key=lambda row: row["relativePath"])
    total_bytes = sum(row["bytes"] for row in files)
    digest = canonical_sha256({"directories": directories, "files": files})
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
        "sha256": digest,
        "manifestSha256": digest,
    }


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def remote_path_is_canonical(value: str) -> bool:
    return bool(REMOTE_PATH.fullmatch(value)) and ".." not in value and str(PurePosixPath(value)) == value


def remote_roots_are_disjoint(left: str, right: str) -> bool:
    left_parts = PurePosixPath(left).parts
    right_parts = PurePosixPath(right).parts
    common = min(len(left_parts), len(right_parts))
    return left_parts != right_parts and left_parts[:common] != right_parts[:common]


def validate_continuation_state(
    value: dict[str, Any],
    *,
    bank_id: str,
    source: dict[str, str],
    historical_runtime_root: str,
    runtime_root: str,
    prior_root: str,
    continuation_root: str,
    prior_state_sha256: str,
    commissioned_content_sha256: str,
    spec_sha256: str,
    spec: dict[str, Any],
    runtime_materials: dict[str, Any],
) -> dict[str, Any]:
    expected_counts = {
        "completedBatches": 72,
        "totalBatches": 72,
        "acceptedConcepts": 288,
        "acceptedItems": 576,
        "reusedBatches": 71,
    }
    if (
        value.get("schemaVersion") != CONTINUATION_STATE_SCHEMA
        or value.get("status") != "completed"
        or value.get("phase") != "completed"
        or value.get("campaignId") != bank_id
        or value.get("purpose") != "validity"
        or value.get("artifactRoot") != continuation_root
        or value.get("historicalRuntimeRoot") != historical_runtime_root
        or value.get("freshRuntimeRoot") != runtime_root
        or value.get("priorBlockedRoot") != prior_root
        or value.get("source") != source
        or value.get("model") != CONTINUATION_RUNTIME["model"]
        or value.get("thinking") != CONTINUATION_RUNTIME["thinking"]
        or value.get("serviceTier") != CONTINUATION_RUNTIME["serviceTier"]
        or value.get("repairBatchId") != CONTINUATION_REPAIR_BATCH
        or value.get("repairConceptIds") != CONTINUATION_REPAIR_CONCEPTS
        or value.get("truthBoundary") != CONTINUATION_TRUTH_BOUNDARY
        or any(value.get(key) != expected for key, expected in expected_counts.items())
    ):
        raise ValidityPipelineError("commissioning continuation state identity or exact coverage mismatch")
    calls_started = value.get("providerCallsStarted")
    if not isinstance(calls_started, int) or isinstance(calls_started, bool) or calls_started < 2 or value.get("providerCallsCompleted") != calls_started:
        raise ValidityPipelineError("commissioning continuation provider-call accounting is incomplete")
    if value.get("outputSha256") != commissioned_content_sha256:
        raise ValidityPipelineError("commissioning continuation output SHA-256 differs from the pinned content")
    provenance = value.get("continuationProvenance")
    if not isinstance(provenance, dict):
        raise ValidityPipelineError("commissioning continuation provenance is missing")
    expected_partition = {
        "batchSize": 4,
        "totalBatches": 72,
        "reusedBatches": 71,
        "reusedConcepts": 284,
        "reusedItems": 568,
        "repairBatchId": CONTINUATION_REPAIR_BATCH,
        "repairConceptIds": CONTINUATION_REPAIR_CONCEPTS,
        "historicalRepairAttempts": 6,
    }
    if (
        provenance.get("schemaVersion") != CONTINUATION_PROVENANCE_SCHEMA
        or provenance.get("campaignId") != bank_id
        or provenance.get("source") != source
        or provenance.get("modelRuntime") != CONTINUATION_RUNTIME
        or provenance.get("runtimeMaterials") != runtime_materials
        or provenance.get("historicalRuntimeRoot") != historical_runtime_root
        or provenance.get("freshRuntimeRoot") != runtime_root
        or provenance.get("priorBlockedRoot") != prior_root
        or provenance.get("partition") != expected_partition
        or provenance.get("truthBoundary") != CONTINUATION_TRUTH_BOUNDARY
        or provenance.get("priorState") != {
            "relativePath": "state.json",
            "sha256": prior_state_sha256,
            "schemaVersion": "cortex.learning_os.continuous_math_bank_commissioning_state.v1",
            "status": "blocked",
        }
    ):
        raise ValidityPipelineError("commissioning continuation reuse provenance identity mismatch")
    spec_record = provenance.get("commissioningSpec")
    if (
        not isinstance(spec_record, dict)
        or spec_record.get("path") != f"{historical_runtime_root}/inputs/validity.commissioning-spec.json"
        or spec_record.get("sha256") != spec_sha256
        or spec_record.get("schemaVersion") != "cortex.learning_os.continuous_math_bank_commissioning_spec.v1"
    ):
        raise ValidityPipelineError("commissioning continuation spec provenance mismatch")
    inventory = provenance.get("reusedAcceptedArtifacts")
    expected_batch_ids = [f"batch-{index:03d}" for index in range(1, 73) if index != 50]
    if not isinstance(inventory, list) or len(inventory) != 71:
        raise ValidityPipelineError("commissioning continuation reuse inventory is not exactly 71 artifacts")
    concept_ids: list[str] = []
    for batch_id_value, row in zip(expected_batch_ids, inventory, strict=True):
        expected_relative = f"batches/{batch_id_value}/accepted.json"
        batch_index = int(batch_id_value.removeprefix("batch-"))
        expected_concept_ids = [
            concept["conceptId"]
            for concept in spec["concepts"][(batch_index - 1) * 4:batch_index * 4]
        ]
        if (
            not isinstance(row, dict)
            or row.get("batchId") != batch_id_value
            or row.get("relativePath") != expected_relative
            or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("sha256") or ""))
            or not isinstance(row.get("bytes"), int)
            or isinstance(row.get("bytes"), bool)
            or row["bytes"] < 1
            or row.get("itemCount") != 8
            or not isinstance(row.get("conceptIds"), list)
            or row["conceptIds"] != expected_concept_ids
        ):
            raise ValidityPipelineError(f"commissioning continuation inventory entry mismatch: {batch_id_value}")
        concept_ids.extend(row["conceptIds"])
    if len(concept_ids) != 284 or len(set(concept_ids)) != 284 or set(concept_ids).intersection(CONTINUATION_REPAIR_CONCEPTS):
        raise ValidityPipelineError("commissioning continuation inventory concept coverage mismatch")
    if provenance.get("reusedAcceptedInventorySha256") != canonical_sha256(inventory):
        raise ValidityPipelineError("commissioning continuation inventory digest mismatch")
    prior_tree = provenance.get("priorRootManifest")
    prior_tree_files = prior_tree.get("files") if isinstance(prior_tree, dict) else None
    prior_tree_directories = prior_tree.get("directories") if isinstance(prior_tree, dict) else None
    if (
        not isinstance(prior_tree, dict)
        or prior_tree.get("schemaVersion") != "cortex.learning_os.regular_tree_manifest.v1"
        or prior_tree.get("algorithm") != "sha256"
        or not isinstance(prior_tree_files, list)
        or not isinstance(prior_tree_directories, list)
        or not all(isinstance(row, str) for row in prior_tree_directories)
        or prior_tree_directories != sorted(set(prior_tree_directories))
        or not prior_tree_directories
        or prior_tree_directories[0] != "."
        or not re.fullmatch(r"[0-9a-f]{64}", str(prior_tree.get("sha256") or ""))
        or not isinstance(prior_tree.get("fileCount"), int)
        or isinstance(prior_tree.get("fileCount"), bool)
        or prior_tree["fileCount"] < 73
        or prior_tree["fileCount"] != len(prior_tree_files)
        or not isinstance(prior_tree.get("directoryCount"), int)
        or isinstance(prior_tree.get("directoryCount"), bool)
        or prior_tree["directoryCount"] < 79
        or prior_tree["directoryCount"] != len(prior_tree_directories)
        or not isinstance(prior_tree.get("totalBytes"), int)
        or isinstance(prior_tree.get("totalBytes"), bool)
        or prior_tree["totalBytes"] < 1
        or prior_tree.get("bytes") != prior_tree["totalBytes"]
        or prior_tree.get("manifestSha256") != prior_tree["sha256"]
        or prior_tree["sha256"] != canonical_sha256({
            "directories": prior_tree_directories,
            "files": prior_tree_files,
        })
    ):
        raise ValidityPipelineError("commissioning continuation prior-root manifest is invalid")
    if any(
        relative != "." and (
            not re.fullmatch(r"[A-Za-z0-9._/-]+", relative)
            or ".." in PurePosixPath(relative).parts
            or str(PurePosixPath(relative)) != relative
        )
        for relative in prior_tree_directories
    ):
        raise ValidityPipelineError("commissioning continuation prior-root manifest directory entry is invalid")
    prior_tree_index: dict[str, dict[str, Any]] = {}
    running_prior_bytes = 0
    for row in prior_tree_files:
        relative = row.get("relativePath") if isinstance(row, dict) else None
        if (
            not isinstance(relative, str)
            or not relative
            or relative.startswith("/")
            or not re.fullmatch(r"[A-Za-z0-9._/-]+", relative)
            or ".." in PurePosixPath(relative).parts
            or str(PurePosixPath(relative)) != relative
            or relative in prior_tree_index
            or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("sha256") or ""))
            or not isinstance(row.get("bytes"), int)
            or isinstance(row.get("bytes"), bool)
            or row["bytes"] < 0
        ):
            raise ValidityPipelineError("commissioning continuation prior-root manifest file entry is invalid")
        prior_tree_index[relative] = row
        running_prior_bytes += row["bytes"]
    if running_prior_bytes != prior_tree["totalBytes"]:
        raise ValidityPipelineError("commissioning continuation prior-root manifest byte total mismatch")
    expected_tree_bindings = {
        "state.json": prior_state_sha256,
        **{row["relativePath"]: row["sha256"] for row in inventory},
    }
    if any(
        relative not in prior_tree_index or prior_tree_index[relative]["sha256"] != digest
        for relative, digest in expected_tree_bindings.items()
    ):
        raise ValidityPipelineError("commissioning continuation prior-root manifest does not bind state and accepted inventory")
    if any(
        prior_tree_index[row["relativePath"]]["bytes"] != row["bytes"]
        for row in inventory
    ):
        raise ValidityPipelineError("commissioning continuation prior-root manifest byte sizes differ from the accepted inventory")
    repair = provenance.get("repairAcceptedArtifact")
    if (
        not isinstance(repair, dict)
        or repair.get("batchId") != CONTINUATION_REPAIR_BATCH
        or repair.get("relativePath") != "batches/batch-050/accepted.json"
        or repair.get("conceptIds") != CONTINUATION_REPAIR_CONCEPTS
        or repair.get("itemCount") != 8
        or not isinstance(repair.get("attemptCount"), int)
        or isinstance(repair.get("attemptCount"), bool)
        or not 1 <= repair["attemptCount"] <= 6
        or not isinstance(repair.get("reviewedAttemptCount"), int)
        or isinstance(repair.get("reviewedAttemptCount"), bool)
        or not 1 <= repair["reviewedAttemptCount"] <= repair["attemptCount"]
        or repair.get("acceptedAttempt") != repair["attemptCount"]
        or not isinstance(repair.get("bytes"), int)
        or isinstance(repair.get("bytes"), bool)
        or repair["bytes"] < 1
        or not re.fullmatch(r"[0-9a-f]{64}", str(repair.get("sha256") or ""))
    ):
        raise ValidityPipelineError("commissioning continuation repair artifact provenance mismatch")
    provider_calls = repair.get("providerCalls")
    if not isinstance(provider_calls, list) or len(provider_calls) != calls_started:
        raise ValidityPipelineError("commissioning continuation repair provider-call provenance mismatch")
    repair_manifest = repair.get("artifactManifest")
    repair_manifest_files = repair_manifest.get("files") if isinstance(repair_manifest, dict) else None
    repair_manifest_directories = repair_manifest.get("directories") if isinstance(repair_manifest, dict) else None
    if (
        not isinstance(repair_manifest, dict)
        or repair_manifest.get("schemaVersion") != "cortex.learning_os.regular_tree_manifest.v1"
        or repair_manifest.get("algorithm") != "sha256"
        or not re.fullmatch(r"[0-9a-f]{64}", str(repair_manifest.get("sha256") or ""))
        or not isinstance(repair_manifest_files, list)
        or not isinstance(repair_manifest_directories, list)
        or repair_manifest.get("fileCount") != len(repair_manifest_files)
        or repair_manifest.get("directoryCount") != len(repair_manifest_directories)
        or repair_manifest.get("bytes") != repair_manifest.get("totalBytes")
        or repair_manifest.get("manifestSha256") != repair_manifest.get("sha256")
        or repair_manifest.get("sha256") != canonical_sha256({
            "directories": repair_manifest_directories,
            "files": repair_manifest_files,
        })
    ):
        raise ValidityPipelineError("commissioning continuation repair artifact manifest is invalid")
    repair_manifest_index = {
        row.get("relativePath"): row
        for row in repair_manifest_files
        if isinstance(row, dict) and isinstance(row.get("relativePath"), str)
    }
    repair_accepted_manifest = repair_manifest_index.get("accepted.json")
    if (
        len(repair_manifest_index) != len(repair_manifest_files)
        or not isinstance(repair_accepted_manifest, dict)
        or repair_accepted_manifest.get("sha256") != repair["sha256"]
        or repair_accepted_manifest.get("bytes") != repair["bytes"]
    ):
        raise ValidityPipelineError("commissioning continuation repair manifest does not bind accepted.json")
    observed_threads: set[str] = set()
    observed_role_attempts: set[tuple[str, int]] = set()
    author_attempts: set[int] = set()
    reviewer_attempts: set[int] = set()
    for call in provider_calls:
        event_manifest = None
        if isinstance(call, dict) and isinstance(call.get("attempt"), int) and isinstance(call.get("role"), str):
            event_manifest = repair_manifest_index.get(
                f"attempt-{call['attempt']}/{call['role']}-events.jsonl"
            )
        if (
            not isinstance(call, dict)
            or call.get("role") not in {"author", "reviewer"}
            or not isinstance(call.get("attempt"), int)
            or isinstance(call.get("attempt"), bool)
            or not 1 <= call["attempt"] <= repair["attemptCount"]
            or not isinstance(call.get("threadId"), str)
            or not call["threadId"]
            or call["threadId"] in observed_threads
            or (call["role"], call["attempt"]) in observed_role_attempts
            or not re.fullmatch(r"[0-9a-f]{64}", str(call.get("eventsSha256") or ""))
            or not isinstance(event_manifest, dict)
            or event_manifest.get("sha256") != call.get("eventsSha256")
            or not isinstance(call.get("usage"), dict)
            or not isinstance(call["usage"].get("input_tokens"), int)
            or isinstance(call["usage"].get("input_tokens"), bool)
            or call["usage"]["input_tokens"] <= 0
            or not isinstance(call["usage"].get("output_tokens"), int)
            or isinstance(call["usage"].get("output_tokens"), bool)
            or call["usage"]["output_tokens"] <= 0
        ):
            raise ValidityPipelineError("commissioning continuation repair call ledger is invalid")
        observed_threads.add(call["threadId"])
        observed_role_attempts.add((call["role"], call["attempt"]))
        (author_attempts if call["role"] == "author" else reviewer_attempts).add(call["attempt"])
    if (
        len(provider_calls) != repair["attemptCount"] + repair["reviewedAttemptCount"]
        or author_attempts != set(range(1, repair["attemptCount"] + 1))
        or len(reviewer_attempts) != repair["reviewedAttemptCount"]
        or not reviewer_attempts.issubset(author_attempts)
        or repair["acceptedAttempt"] not in reviewer_attempts
    ):
        raise ValidityPipelineError("commissioning continuation repair call ledger attempt coverage mismatch")
    return provenance


def validate_continuation_content(
    content: dict[str, Any],
    *,
    bank_id: str,
    source: dict[str, str],
    spec: dict[str, Any],
    provenance: dict[str, Any],
    accepted_batches: list[dict[str, Any]] | None = None,
) -> None:
    items = content.get("items")
    receipts = content.get("batchReceipts")
    if (
        content.get("schemaVersion") != "cortex.learning_os.commissioned_assessment_content.v2"
        or content.get("campaignId") != bank_id
        or content.get("purpose") != "validity"
        or content.get("source") != source
        or content.get("conceptCount") != 288
        or content.get("itemCount") != 576
        or content.get("itemBlueprints") != spec.get("itemBlueprints")
        or content.get("authoringModel") != CONTINUATION_RUNTIME["model"]
        or content.get("reviewingModel") != CONTINUATION_RUNTIME["model"]
        or content.get("continuationProvenance") != provenance
        or content.get("truthBoundary") != CONTINUATION_TRUTH_BOUNDARY
        or not isinstance(items, list)
        or len(items) != 576
        or not isinstance(receipts, list)
        or len(receipts) != 72
    ):
        raise ValidityPipelineError("returned continuation content identity, provenance, or exact counts mismatch")
    expected_items = {
        f"{concept['conceptId']}:{blueprint['assessmentRole']}:{blueprint['variant']}": (
            concept["conceptId"], blueprint["assessmentRole"], blueprint["variant"]
        )
        for concept in spec["concepts"] for blueprint in spec["itemBlueprints"]
    }
    expected_item_keys = set(expected_items)
    item_keys = [row.get("itemKey") for row in items if isinstance(row, dict)]
    item_concepts = [row.get("conceptId") for row in items if isinstance(row, dict)]
    if (
        len(item_keys) != 576
        or len(set(item_keys)) != 576
        or set(item_keys) != expected_item_keys
        or len(set(item_concepts)) != 288
        or any(
            expected_items.get(row.get("itemKey")) != (
                row.get("conceptId"), row.get("assessmentRole"), row.get("variant")
            )
            for row in items if isinstance(row, dict)
        )
    ):
        raise ValidityPipelineError("returned continuation content has duplicate or incomplete item/concept identities")
    expected_batch_ids = [f"batch-{index:03d}" for index in range(1, 73)]
    if [row.get("batchId") for row in receipts if isinstance(row, dict)] != expected_batch_ids or any(
        not isinstance(row.get("receipts"), list) or not row["receipts"]
        for row in receipts if isinstance(row, dict)
    ):
        raise ValidityPipelineError("returned continuation content batch receipts are incomplete")
    if accepted_batches is not None:
        if [row.get("batchId") for row in accepted_batches] != expected_batch_ids:
            raise ValidityPipelineError("accepted artifact reconstruction is not exact 72-batch coverage")
        expected_assembled_items = [item for row in accepted_batches for item in row.get("items", [])]
        expected_assembled_receipts = [
            {"batchId": row.get("batchId"), "receipts": row.get("receipts")}
            for row in accepted_batches
        ]
        if items != expected_assembled_items or receipts != expected_assembled_receipts:
            raise ValidityPipelineError("returned continuation content differs from the exact prior-plus-repair assembly")
        repair_batch = accepted_batches[49]
        repair_record = provenance["repairAcceptedArtifact"]
        repair_receipts = repair_batch.get("receipts")
        calls_by_role_attempt = {
            (call["role"], call["attempt"]): call
            for call in repair_record["providerCalls"]
        }
        if (
            repair_batch.get("batchId") != CONTINUATION_REPAIR_BATCH
            or repair_batch.get("conceptIds") != CONTINUATION_REPAIR_CONCEPTS
            or not isinstance(repair_batch.get("items"), list)
            or len(repair_batch["items"]) != 8
            or not isinstance(repair_receipts, list)
            or len(repair_receipts) != repair_record["reviewedAttemptCount"]
            or repair_record["acceptedAttempt"] != repair_record["attemptCount"]
        ):
            raise ValidityPipelineError("reconstructed repair batch identity or reviewed-attempt coverage mismatch")
        for receipt in repair_receipts:
            attempt = receipt.get("attempt") if isinstance(receipt, dict) else None
            author_call = calls_by_role_attempt.get(("author", attempt))
            reviewer_call = calls_by_role_attempt.get(("reviewer", attempt))
            if (
                not isinstance(attempt, int)
                or isinstance(attempt, bool)
                or author_call is None
                or reviewer_call is None
                or receipt.get("authorThreadId") != author_call["threadId"]
                or receipt.get("reviewerThreadId") != reviewer_call["threadId"]
                or receipt.get("authorUsage") != author_call["usage"]
                or receipt.get("reviewerUsage") != reviewer_call["usage"]
            ):
                raise ValidityPipelineError("repair receipt is not exactly bound to its author/reviewer event ledgers")


def run(
    command: list[str | Path],
    *,
    cwd: Path | None = None,
    timeout: float = 1800,
    log_root: Path | None = None,
    label: str = "command",
) -> str:
    result = subprocess.run(
        [str(part) for part in command],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if log_root is not None:
        log_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        stdout_path = log_root / f"{label}.stdout.log"
        stderr_path = log_root / f"{label}.stderr.log"
        stdout_path.write_text(result.stdout, encoding="utf-8")
        stderr_path.write_text(result.stderr, encoding="utf-8")
        os.chmod(stdout_path, 0o600)
        os.chmod(stderr_path, 0o600)
    if result.returncode != 0:
        detail = (result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}")[-4000:]
        raise ValidityPipelineError(f"{label} failed: {detail}")
    return result.stdout


def parse_json_output(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValidityPipelineError("command returned no JSON object")


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument("--campaign-id", required=True)
    value.add_argument("--artifact-root", required=True, type=Path)
    value.add_argument("--state-file", required=True, type=Path)
    value.add_argument("--repo-root", required=True, type=Path)
    value.add_argument("--expected-source-commit", required=True)
    value.add_argument("--external-supervisor-path", required=True, type=Path)
    value.add_argument("--external-supervisor-sha256", required=True)
    value.add_argument("--source-ref", required=True)
    value.add_argument("--remote-host", default="jake@37.27.129.239")
    value.add_argument("--remote-mirror", default="/home/jake/clawd-remote")
    value.add_argument("--remote-source-base", default="/home/jake/cortex-learning-os-validity-sources")
    value.add_argument("--remote-runtime-base", default="/home/jake/.local/state/cortex-learning-os/validity")
    value.add_argument("--state-root", default="/root/.openclaw/cortex-learning-os", type=Path)
    value.add_argument("--approved-model-executable-binding", required=True, type=Path)
    value.add_argument("--remote-execution-private-key", default="/home/jake/.config/cortex-learning-os/authorities/execution.private.pem")
    value.add_argument("--authority-root", default="/root/.openclaw/cortex-learning-os/production-authorities/clos-phd-production-20260802-v1", type=Path)
    value.add_argument("--commission-concurrency", default=4, type=int)
    value.add_argument("--assessment-concurrency", default=8, type=int)
    value.add_argument("--commission-wall-seconds", default=86400, type=int)
    value.add_argument("--assessment-wall-seconds", default=86400, type=int)
    value.add_argument("--poll-seconds", default=30, type=int)
    value.add_argument("--prior-blocked-commissioning-root")
    value.add_argument("--prior-blocked-commissioning-state-sha256")
    value.add_argument("--adopt-commissioning-continuation-root")
    value.add_argument("--adopt-commissioning-continuation-state-sha256")
    value.add_argument("--adopt-commissioned-content-sha256")
    value.add_argument("--adoption-runtime-root")
    value.add_argument("--resume", action="store_true")
    return value


def main() -> int:
    args = parser().parse_args()
    if not SAFE_ID.fullmatch(args.campaign_id):
        raise ValidityPipelineError("invalid validity campaign identity")
    if not SOURCE_REF.fullmatch(args.source_ref) or ".." in args.source_ref:
        raise ValidityPipelineError("unsafe source ref")
    if not REMOTE_HOST.fullmatch(args.remote_host):
        raise ValidityPipelineError("unsafe remote host")
    for remote_path in (
        args.remote_mirror,
        args.remote_source_base,
        args.remote_runtime_base,
        args.remote_execution_private_key,
    ):
        if not REMOTE_PATH.fullmatch(remote_path) or ".." in remote_path:
            raise ValidityPipelineError("unsafe remote path")
    if not 1 <= args.commission_concurrency <= 8 or not 1 <= args.assessment_concurrency <= 8:
        raise ValidityPipelineError("validity concurrency must be 1..8")
    if not 300 <= args.commission_wall_seconds <= 86400 or not 300 <= args.assessment_wall_seconds <= 86400:
        raise ValidityPipelineError("validity wall-time bounds must be 300..86400 seconds")
    if not 5 <= args.poll_seconds <= 300:
        raise ValidityPipelineError("validity poll interval must be 5..300 seconds")
    adoption_values = (
        args.prior_blocked_commissioning_root,
        args.prior_blocked_commissioning_state_sha256,
        args.adopt_commissioning_continuation_root,
        args.adopt_commissioning_continuation_state_sha256,
        args.adopt_commissioned_content_sha256,
        args.adoption_runtime_root,
    )
    if any(adoption_values) != all(adoption_values):
        raise ValidityPipelineError(
            "commissioning continuation adoption requires prior/continuation/runtime roots and exact prior/continuation/content SHA-256 values"
        )
    commissioning_adoption: dict[str, str] | None = None
    if all(adoption_values):
        prior_root = str(args.prior_blocked_commissioning_root)
        continuation_root = str(args.adopt_commissioning_continuation_root)
        adoption_runtime_root = str(args.adoption_runtime_root)
        if (
            not remote_path_is_canonical(prior_root)
            or not remote_path_is_canonical(continuation_root)
            or not remote_path_is_canonical(adoption_runtime_root)
            or not remote_roots_are_disjoint(prior_root, adoption_runtime_root)
            or PurePosixPath(continuation_root).parent != PurePosixPath(adoption_runtime_root)
            or PurePosixPath(continuation_root).name != "commissioning"
            or not re.fullmatch(r"[0-9a-f]{64}", str(args.prior_blocked_commissioning_state_sha256))
            or not re.fullmatch(r"[0-9a-f]{64}", str(args.adopt_commissioning_continuation_state_sha256))
            or not re.fullmatch(r"[0-9a-f]{64}", str(args.adopt_commissioned_content_sha256))
        ):
            raise ValidityPipelineError("unsafe or overlapping commissioning continuation adoption boundary")
        commissioning_adoption = {
            "mode": "completed_continuation_only",
            "priorBlockedRoot": prior_root,
            "priorStateSha256": str(args.prior_blocked_commissioning_state_sha256),
            "continuationRoot": continuation_root,
            "continuationStateSha256": str(args.adopt_commissioning_continuation_state_sha256),
            "commissionedContentSha256": str(args.adopt_commissioned_content_sha256),
            "runtimeRoot": adoption_runtime_root,
        }
    repo = args.repo_root.resolve()
    clos = repo / "cortex-learning-os"
    if (
        not args.repo_root.is_absolute()
        or args.repo_root != repo
        or args.repo_root.is_symlink()
        or not repo.is_dir()
        or not clos.is_dir()
    ):
        raise ValidityPipelineError("validity source repository is unavailable")
    if not COMMIT.fullmatch(args.expected_source_commit):
        raise ValidityPipelineError("invalid expected source commit")
    supervisor = args.external_supervisor_path
    if (
        not supervisor.is_absolute()
        or supervisor != supervisor.resolve(strict=True)
        or supervisor == repo
        or repo in supervisor.parents
        or supervisor.resolve() != Path(__file__).resolve()
        or not re.fullmatch(r"[0-9a-f]{64}", args.external_supervisor_sha256)
    ):
        raise ValidityPipelineError("pipeline supervisor must be this exact external regular file outside the frozen source checkout")
    supervisor_sha256, supervisor_bytes = regular_file_identity(supervisor)
    if supervisor_sha256 != args.external_supervisor_sha256:
        raise ValidityPipelineError("external pipeline supervisor SHA-256 differs from the launch binding")
    for target, label, owner_only in (
        (args.approved_model_executable_binding, "approved model executable binding", False),
        (args.state_root / "mastery.json", "signed acquisition state", False),
        (args.state_root / "mastery.hmac", "acquisition signing secret", True),
        (args.authority_root / "bank-authoring.private.pem", "bank authoring key", True),
        (args.authority_root / "bank-review.private.pem", "bank review key", True),
        (args.authority_root / "proctor.private.pem", "proctor key", True),
        (args.authority_root / "grader.private.pem", "grader key", True),
    ):
        target_stat = target.lstat()
        if not target.is_file() or target.is_symlink() or (owner_only and target_stat.st_mode & 0o077):
            raise ValidityPipelineError(f"{label} must be {'owner-only ' if owner_only else ''}regular material")
    approved_binding_sha256, approved_binding_bytes = regular_file_identity(args.approved_model_executable_binding)

    source_commit = run(["git", "-C", repo, "rev-parse", "HEAD^{commit}"], timeout=30).strip()
    source_tree = run(["git", "-C", repo, "rev-parse", "HEAD^{tree}"], timeout=30).strip()
    product_tree = run(["git", "-C", repo, "rev-parse", "HEAD:cortex-learning-os"], timeout=30).strip()
    source = {"sourceCommit": source_commit, "sourceTree": source_tree, "productTree": product_tree}
    if not all(COMMIT.fullmatch(value) for value in source.values()):
        raise ValidityPipelineError("local validity source identity is invalid")
    if source_commit != args.expected_source_commit:
        raise ValidityPipelineError("local validity source differs from the exact approved repair baseline commit")
    if run(["git", "-C", repo, "status", "--porcelain=v1", "--untracked-files=all"], timeout=30).strip():
        raise ValidityPipelineError("local validity source worktree must be clean")
    origin = run(["git", "-C", repo, "ls-remote", "origin", args.source_ref], timeout=60).split()
    if not origin or origin[0] != source_commit:
        raise ValidityPipelineError("exact validity source commit is not pushed to the approved source ref")

    historical_runtime_root = f"{args.remote_runtime_base}/{args.campaign_id}"
    if commissioning_adoption is not None:
        if commissioning_adoption["priorBlockedRoot"] != f"{historical_runtime_root}/commissioning":
            raise ValidityPipelineError("prior blocked commissioning root differs from the exact historical campaign runtime")
        if not remote_roots_are_disjoint(historical_runtime_root, commissioning_adoption["runtimeRoot"]):
            raise ValidityPipelineError("fresh adoption runtime overlaps the historical campaign runtime")
    effective_remote_runtime = (
        commissioning_adoption["runtimeRoot"]
        if commissioning_adoption is not None
        else historical_runtime_root
    )
    remote_source_root_boundary = f"{args.remote_source_base}/{args.campaign_id}/source"
    if not remote_roots_are_disjoint(remote_source_root_boundary, effective_remote_runtime):
        raise ValidityPipelineError("remote runtime overlaps the exact frozen source checkout")
    remote_boundary = {
        "remoteHost": args.remote_host,
        "remoteMirror": args.remote_mirror,
        "remoteSourceBase": args.remote_source_base,
        "remoteRuntimeBase": args.remote_runtime_base,
        "effectiveRemoteRuntime": effective_remote_runtime,
        "expectedSourceCommit": args.expected_source_commit,
        "externalSupervisor": {
            "path": str(supervisor),
            "sha256": supervisor_sha256,
            "bytes": supervisor_bytes,
        },
        "remoteExecutionPrivateKey": args.remote_execution_private_key,
        "approvedModelExecutableBinding": {
            "path": str(args.approved_model_executable_binding.resolve()),
            "sha256": approved_binding_sha256,
            "bytes": approved_binding_bytes,
        },
    }

    if args.state_file.exists():
        if not args.resume:
            raise ValidityPipelineError("validity pipeline state exists; use --resume")
        state = read(args.state_file)
        if (
            state.get("schemaVersion") != SCHEMA
            or state.get("campaignId") != args.campaign_id
            or state.get("sourceRef") != args.source_ref
            or state.get("source") != source
            or state.get("artifactRoot") != str(args.artifact_root)
            or state.get("commissioningAdoption") != commissioning_adoption
            or state.get("remoteBoundary") != remote_boundary
        ):
            raise ValidityPipelineError("validity pipeline resume boundary changed or is terminal")
        if state.get("status") == "completed":
            print(json.dumps(state, indent=2, sort_keys=True))
            return 0
        if state.get("status") in {"blocked", "failed"}:
            raise ValidityPipelineError("validity pipeline resume boundary is terminal")
    else:
        if args.artifact_root.exists():
            raise ValidityPipelineError("validity artifact root exists without resumable state")
        args.artifact_root.mkdir(parents=True, mode=0o700)
        os.chmod(args.artifact_root, 0o700)
        state = {
            "schemaVersion": SCHEMA,
            "campaignId": args.campaign_id,
            "status": "preparing",
            "phase": "source_freeze",
            "reason": "freezing exact source, acquired-once state, and independent validity commissioning inputs",
            "artifactRoot": str(args.artifact_root),
            "sourceRef": args.source_ref,
            "source": source,
            "commissioningAdoption": commissioning_adoption,
            "remoteBoundary": remote_boundary,
            "remoteHost": args.remote_host,
            "startedAt": now(),
            "updatedAt": now(),
            "counts": {
                "acquiredOnce": 288,
                "validityConfirmed": 0,
                "validityFailed": 0,
                "validityBlocked": 0,
                "retentionR7": 0,
                "utilityQualified": 0,
            },
            "truthBoundary": "The pipeline preserves acquired-once history and may add near-term validity evidence only. Commissioning, candidate execution, and process completion are not retention, utility, mastery, or model-weight evidence.",
        }
        atomic_json(args.state_file, state)

    logs = args.artifact_root / "logs"

    def update(status: str, phase: str, reason: str, **extra: Any) -> None:
        state.update(status=status, phase=phase, reason=reason, updatedAt=now(), **extra)
        atomic_json(args.state_file, state)

    def ssh(*remote_command: str, timeout: float = 180, label: str = "ssh") -> str:
        return run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host, *remote_command],
            timeout=timeout,
            log_root=logs,
            label=label,
        )

    def remote_json(remote_path: str) -> dict[str, Any] | None:
        result = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host, "cat", remote_path],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode != 0:
            return None
        value = json.loads(result.stdout)
        return value if isinstance(value, dict) else None

    def remote_exists(remote_path: str) -> bool:
        result = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host, "test", "-e", remote_path],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode not in {0, 1}:
            detail = (result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}")[-2000:]
            raise ValidityPipelineError(f"remote existence check failed for {remote_path}: {detail}")
        return result.returncode == 0

    def wait_remote_state(remote_path: str, wall_seconds: int, lane: str) -> dict[str, Any]:
        started = time.monotonic()
        last: dict[str, Any] | None = None
        failures = 0
        while time.monotonic() - started <= wall_seconds:
            try:
                observed = remote_json(remote_path)
                if observed is None:
                    failures += 1
                else:
                    failures = 0
                    last = observed
                    progress = {
                        "status": observed.get("status"),
                        "completedSessions": observed.get("completedSessions"),
                        "totalSessions": observed.get("totalSessions"),
                        "candidateSessions": observed.get("candidateSessions"),
                        "failedSessions": observed.get("failedSessions"),
                        "completedBatches": observed.get("completedBatches"),
                        "totalBatches": observed.get("totalBatches"),
                        "acceptedConcepts": observed.get("acceptedConcepts"),
                        "acceptedItems": observed.get("acceptedItems"),
                        "providerCallsStarted": observed.get("providerCallsStarted"),
                        "providerCallsCompleted": observed.get("providerCallsCompleted"),
                    }
                    update(
                        "running",
                        lane,
                        f"Hetzner {lane.replace('_', ' ')} is active",
                        remoteProgress={key: value for key, value in progress.items() if value is not None},
                    )
                    if observed.get("status") in TERMINAL:
                        return observed
                if failures >= 20:
                    raise ValidityPipelineError(f"remote {lane} state remained unavailable across 20 polls")
            except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
                failures += 1
                if failures >= 20:
                    raise ValidityPipelineError(f"remote {lane} state could not be read: {error}") from error
            time.sleep(args.poll_seconds)
        raise ValidityPipelineError(
            f"remote {lane} exceeded its {wall_seconds}-second wall-time cap: {(last or {}).get('reason') or 'no terminal state'}"
        )

    try:
        source_freeze = args.artifact_root / "source-freeze.json"
        if not source_freeze.exists():
            atomic_json(source_freeze, {
                "schemaVersion": "cortex.learning_os.validity_source_freeze.v1",
                "source": source,
                "sourceRef": args.source_ref,
                "commissioningAdoption": commissioning_adoption,
                "remoteBoundary": remote_boundary,
                "frozenAt": now(),
                "localWorktreeClean": True,
            })
        else:
            frozen_source = read(source_freeze)
            if (
                frozen_source.get("source") != source
                or frozen_source.get("commissioningAdoption") != commissioning_adoption
                or frozen_source.get("remoteBoundary") != remote_boundary
            ):
                raise ValidityPipelineError("persisted validity source freeze or commissioning adoption boundary changed")

        bank_id = f"{args.campaign_id}-bank"
        spec_path = args.artifact_root / "validity.commissioning-spec.json"
        if not spec_path.exists():
            update("running", "commissioning_spec", "freezing all 288 validity commissioning inputs")
            spec = parse_json_output(run([
                "node", clos / "src/continuous-math-validity-spec.mjs",
                "--out", spec_path,
                "--campaign-id", bank_id,
                "--thinking", "ultra",
            ], cwd=clos, timeout=180, log_root=logs, label="validity-spec"))
            if not spec.get("ok") or spec.get("conceptCount") != 288 or spec.get("expectedItemCount") != 576:
                raise ValidityPipelineError("validity commissioning spec did not freeze exact 288/576 coverage")
        spec = read(spec_path)
        if (
            spec.get("schemaVersion") != "cortex.learning_os.continuous_math_bank_commissioning_spec.v1"
            or spec.get("campaignId") != bank_id
            or spec.get("purpose") != "validity"
            or spec.get("source") != source
            or spec.get("conceptCount") != 288
            or spec.get("expectedItemCount") != 576
            or not isinstance(spec.get("concepts"), list)
            or len(spec["concepts"]) != 288
            or len({row.get("conceptId") for row in spec["concepts"] if isinstance(row, dict)}) != 288
            or spec.get("modelRuntime") != CONTINUATION_RUNTIME
            or spec.get("itemBlueprints") != [
                {"assessmentRole": "validity-direct", "variant": 1},
                {"assessmentRole": "validity-compositional", "variant": 1},
            ]
            or [row.get("conceptId") for row in spec["concepts"][196:200]] != CONTINUATION_REPAIR_CONCEPTS
        ):
            raise ValidityPipelineError("frozen validity commissioning spec identity or coverage mismatch")

        remote_source_root = f"{args.remote_source_base}/{args.campaign_id}/source"
        remote_source_parent = f"{args.remote_source_base}/{args.campaign_id}"
        remote_clos = f"{remote_source_root}/cortex-learning-os"
        historical_remote_runtime = f"{args.remote_runtime_base}/{args.campaign_id}"
        remote_runtime = effective_remote_runtime
        remote_inputs = f"{remote_runtime}/inputs"
        remote_spec = f"{remote_inputs}/validity.commissioning-spec.json"
        remote_binding = f"{remote_inputs}/approved-model-executable.json"
        historical_remote_spec = f"{historical_remote_runtime}/inputs/validity.commissioning-spec.json"
        historical_remote_binding = f"{historical_remote_runtime}/inputs/approved-model-executable.json"
        remote_commission = (
            commissioning_adoption["continuationRoot"]
            if commissioning_adoption is not None
            else f"{remote_runtime}/commissioning"
        )
        remote_commission_state = f"{remote_commission}/state.json"
        remote_commission_content = f"{remote_commission}/commissioned-content.json"
        remote_bank = f"{remote_inputs}/validity-bank.json"
        remote_plan = f"{remote_inputs}/validity-plan.json"
        remote_assessment = f"{remote_runtime}/assessment"
        remote_assessment_state = f"{remote_assessment}/supervisor-state.json"

        remote_head_result = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host, "git", "-C", remote_source_root, "rev-parse", "HEAD^{commit}"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if remote_head_result.returncode != 0:
            update("running", "remote_source_sync", "creating an isolated clean Hetzner source worktree outside runtime roots")
            ssh("test", "!", "-e", remote_source_parent, timeout=30, label="remote-source-preflight")
            ssh("git", "-C", args.remote_mirror, "fetch", "origin", args.source_ref, timeout=300, label="remote-fetch")
            ssh("install", "-d", "-m", "700", remote_source_parent, timeout=30, label="remote-source-parent")
            ssh("git", "-C", args.remote_mirror, "worktree", "add", "--detach", remote_source_root, source_commit, timeout=300, label="remote-worktree")
        remote_observed = {
            "sourceCommit": ssh("git", "-C", remote_source_root, "rev-parse", "HEAD^{commit}", timeout=30, label="remote-head").strip(),
            "sourceTree": ssh("git", "-C", remote_source_root, "rev-parse", "HEAD^{tree}", timeout=30, label="remote-tree").strip(),
            "productTree": ssh("git", "-C", remote_source_root, "rev-parse", "HEAD:cortex-learning-os", timeout=30, label="remote-product-tree").strip(),
        }
        remote_status = ssh("git", "-C", remote_source_root, "status", "--porcelain=v1", "--untracked-files=all", timeout=30, label="remote-clean").strip()
        if remote_observed != source or remote_status:
            raise ValidityPipelineError("isolated Hetzner source commit/tree/product-tree or clean-checkout proof failed")
        if commissioning_adoption is not None:
            canonical_targets = [
                remote_source_root,
                historical_remote_runtime,
                commissioning_adoption["priorBlockedRoot"],
                commissioning_adoption["runtimeRoot"],
                commissioning_adoption["continuationRoot"],
            ]
            for index, target in enumerate(canonical_targets):
                observed_realpath = ssh("realpath", "-e", target, timeout=30, label=f"remote-canonical-root-{index}").strip()
                if observed_realpath != target:
                    raise ValidityPipelineError(f"remote continuation boundary is symlinked or non-canonical: {target}")
                ssh("test", "-d", target, timeout=30, label=f"remote-directory-root-{index}")
                ssh("test", "!", "-L", target, timeout=30, label=f"remote-nonsymlink-root-{index}")
            if (
                not remote_roots_are_disjoint(remote_source_root, commissioning_adoption["runtimeRoot"])
                or not remote_roots_are_disjoint(historical_remote_runtime, commissioning_adoption["runtimeRoot"])
            ):
                raise ValidityPipelineError("canonical fresh continuation runtime overlaps source or historical campaign storage")
        remote_proof = args.artifact_root / "remote-source-proof.json"
        if not remote_proof.exists():
            atomic_json(remote_proof, {
                "schemaVersion": "cortex.learning_os.remote_source_proof.v1",
                "placement": "hetzner",
                "host": args.remote_host,
                "sourceRoot": remote_source_root,
                "runtimeRoot": remote_runtime,
                "source": remote_observed,
                "sourceWorktreeClean": True,
                "runtimeOutsideSourceWorktree": not remote_runtime.startswith(f"{remote_source_root}/"),
                "verifiedAt": now(),
            })
        else:
            persisted_remote_proof = read(remote_proof)
            if (
                persisted_remote_proof.get("host") != args.remote_host
                or persisted_remote_proof.get("sourceRoot") != remote_source_root
                or persisted_remote_proof.get("runtimeRoot") != remote_runtime
                or persisted_remote_proof.get("source") != remote_observed
                or persisted_remote_proof.get("sourceWorktreeClean") is not True
                or persisted_remote_proof.get("runtimeOutsideSourceWorktree") is not True
            ):
                raise ValidityPipelineError("persisted remote source/runtime separation proof changed")
        if commissioning_adoption is None:
            ssh("install", "-d", "-m", "700", remote_runtime, remote_inputs, timeout=30, label="remote-runtime-root")
            run(["scp", "-q", "-o", "BatchMode=yes", spec_path, f"{args.remote_host}:{remote_spec}"], timeout=120, log_root=logs, label="sync-spec")
            run(["scp", "-q", "-o", "BatchMode=yes", args.approved_model_executable_binding, f"{args.remote_host}:{remote_binding}"], timeout=120, log_root=logs, label="sync-binding")
            ssh("chmod", "600", remote_spec, remote_binding, timeout=30, label="remote-input-modes")
        else:
            update("running", "commissioning_continuation_adoption", "verifying frozen remote inputs without rewriting historical runtime artifacts")
            remote_input_hashes = ssh(
                "sha256sum",
                historical_remote_spec,
                historical_remote_binding,
                timeout=60,
                label="remote-adoption-input-hashes",
            ).splitlines()
            observed_input_hashes = [line.split()[0] for line in remote_input_hashes if line.split()]
            if observed_input_hashes != [sha256(spec_path), approved_binding_sha256]:
                raise ValidityPipelineError("remote historical spec or executable binding differs from the frozen adoption inputs")
            if args.resume and remote_exists(remote_inputs):
                resumed_input_hashes = ssh(
                    "sha256sum", remote_spec, remote_binding,
                    timeout=60, label="remote-resume-input-hashes",
                ).splitlines()
                observed_resumed_hashes = [line.split()[0] for line in resumed_input_hashes if line.split()]
                if observed_resumed_hashes != [sha256(spec_path), approved_binding_sha256]:
                    raise ValidityPipelineError("resumed adoption inputs differ from the frozen spec or executable binding")
                ssh("test", "-d", remote_inputs, timeout=30, label="remote-resume-input-directory")
                ssh("test", "!", "-L", remote_inputs, timeout=30, label="remote-resume-input-nonsymlink")
            else:
                ssh("test", "!", "-e", remote_inputs, timeout=30, label="fresh-adoption-input-preflight")
                ssh("test", "!", "-e", remote_assessment, timeout=30, label="fresh-adoption-assessment-preflight")
                ssh("install", "-d", "-m", "700", remote_runtime, remote_inputs, timeout=30, label="fresh-adoption-runtime-root")
                run(["scp", "-q", "-o", "BatchMode=yes", spec_path, f"{args.remote_host}:{remote_spec}"], timeout=120, log_root=logs, label="sync-adoption-spec")
                run(["scp", "-q", "-o", "BatchMode=yes", args.approved_model_executable_binding, f"{args.remote_host}:{remote_binding}"], timeout=120, log_root=logs, label="sync-adoption-binding")
                ssh("chmod", "600", remote_spec, remote_binding, timeout=30, label="remote-adoption-input-modes")
        approved = read(args.approved_model_executable_binding)
        approved_codex = str(approved.get("path") or "")
        approved_codex_sha256 = approved.get("sha256")
        approved_codex_bytes = approved.get("bytes")
        if (
            approved.get("schemaVersion") != "cortex.learning_os.approved_model_executable.v1"
            or not re.fullmatch(r"/opt/cortex-learning-os/approved-model-executors/[0-9a-f]{64}/codex", approved_codex)
            or not isinstance(approved_codex_sha256, str)
            or not re.fullmatch(r"[0-9a-f]{64}", approved_codex_sha256)
            or not isinstance(approved_codex_bytes, int)
            or isinstance(approved_codex_bytes, bool)
            or approved_codex_bytes < 1
        ):
            raise ValidityPipelineError("approved model executable binding path is invalid")
        author_schema_sha256 = sha256(clos / "schemas" / "continuous-math-bank-author-output.schema.json")
        reviewer_schema_sha256 = sha256(clos / "schemas" / "continuous-math-bank-reviewer-output.schema.json")
        continuation_runtime_materials = {
            "authorSchema": {
                "path": f"{remote_clos}/schemas/continuous-math-bank-author-output.schema.json",
                "sha256": author_schema_sha256,
            },
            "reviewerSchema": {
                "path": f"{remote_clos}/schemas/continuous-math-bank-reviewer-output.schema.json",
                "sha256": reviewer_schema_sha256,
            },
            "approvedModelExecutableBinding": {
                "path": historical_remote_binding,
                "sha256": approved_binding_sha256,
            },
            "codexExecutable": {
                "path": approved_codex,
                "sha256": approved_codex_sha256,
                "bytes": approved_codex_bytes,
            },
        }
        ssh("test", "-f", approved_codex, timeout=30, label="remote-approved-codex-file")
        ssh("test", "!", "-L", approved_codex, timeout=30, label="remote-approved-codex-nonsymlink")
        ssh("test", "-x", approved_codex, timeout=30, label="remote-approved-codex")
        if ssh("realpath", "-e", approved_codex, timeout=30, label="remote-approved-codex-realpath").strip() != approved_codex:
            raise ValidityPipelineError("approved remote model executable path is non-canonical")
        remote_material_hash_lines = ssh(
            "sha256sum",
            approved_codex,
            continuation_runtime_materials["authorSchema"]["path"],
            continuation_runtime_materials["reviewerSchema"]["path"],
            timeout=120,
            label="remote-runtime-material-hashes",
        ).splitlines()
        observed_material_hashes = [line.split()[0] for line in remote_material_hash_lines if line.split()]
        if observed_material_hashes != [approved_codex_sha256, author_schema_sha256, reviewer_schema_sha256]:
            raise ValidityPipelineError("remote executable or commissioning schemas differ from their exact provenance binding")
        remote_codex_size = ssh("stat", "-c", "%s", approved_codex, timeout=30, label="remote-approved-codex-size").strip()
        if remote_codex_size != str(approved_codex_bytes):
            raise ValidityPipelineError("remote model executable byte size differs from its approved binding")
        ssh(approved_codex, "login", "status", timeout=60, label="remote-codex-auth")
        key_mode = ssh("stat", "-c", "%U:%G:%a", args.remote_execution_private_key, timeout=30, label="remote-execution-key").strip()
        if key_mode != "jake:jake:600":
            raise ValidityPipelineError("remote execution authority private key is not jake-owned owner-only material")

        if commissioning_adoption is not None:
            anchored_paths = [
                f"{commissioning_adoption['priorBlockedRoot']}/state.json",
                remote_commission_state,
                remote_commission_content,
            ]
            for index, target in enumerate(anchored_paths):
                ssh("test", "-f", target, timeout=30, label=f"remote-anchored-file-{index}")
                ssh("test", "!", "-L", target, timeout=30, label=f"remote-anchored-file-nonsymlink-{index}")
                if ssh("realpath", "-e", target, timeout=30, label=f"remote-anchored-file-realpath-{index}").strip() != target:
                    raise ValidityPipelineError(f"remote anchored continuation material is non-canonical: {target}")
            anchored_hash_lines = ssh(
                "sha256sum", *anchored_paths,
                timeout=120, label="remote-anchored-continuation-hashes",
            ).splitlines()
            observed_anchored_hashes = [line.split()[0] for line in anchored_hash_lines if line.split()]
            expected_anchored_hashes = [
                commissioning_adoption["priorStateSha256"],
                commissioning_adoption["continuationStateSha256"],
                commissioning_adoption["commissionedContentSha256"],
            ]
            if observed_anchored_hashes != expected_anchored_hashes:
                raise ValidityPipelineError("prior state or completed continuation bytes differ from the pinned adoption hashes")
        remote_commission_terminal = remote_json(remote_commission_state)
        continuation_provenance: dict[str, Any] | None = None
        commissioning_continuation_receipt: dict[str, Any] | None = None
        if commissioning_adoption is None:
            if remote_commission_terminal is None:
                update("running", "commissioning", "launching 288-concept independent author/reviewer commissioning on Hetzner")
                unit = f"clos-{args.campaign_id.replace('.', '-').replace(':', '-')}-commission"
                ssh(
                    "systemd-run", "--user", f"--unit={unit}", "--collect", "--quiet",
                    f"--working-directory={remote_clos}",
                    "/usr/bin/python3", f"{remote_clos}/scripts/commission_continuous_math_bank.py",
                    "--root", remote_commission,
                    "--spec", remote_spec,
                    "--author-schema", f"{remote_clos}/schemas/continuous-math-bank-author-output.schema.json",
                    "--reviewer-schema", f"{remote_clos}/schemas/continuous-math-bank-reviewer-output.schema.json",
                    "--codex", approved_codex,
                    "--home", "/home/jake",
                    "--empty", f"{remote_runtime}/empty",
                    "--model", "gpt-5.6-sol",
                    "--thinking", "ultra",
                    "--service-tier", "fast",
                    "--batch-size", "4",
                    "--concurrency", str(args.commission_concurrency),
                    "--max-attempts", "6",
                    "--call-timeout", "1200",
                    timeout=60,
                    label="remote-commission-launch",
                )
            remote_commission_terminal = wait_remote_state(
                remote_commission_state,
                args.commission_wall_seconds,
                "commissioning",
            )
            if (
                remote_commission_terminal.get("status") != "completed"
                or remote_commission_terminal.get("acceptedConcepts") != 288
                or remote_commission_terminal.get("acceptedItems") != 576
            ):
                raise ValidityPipelineError(
                    f"remote validity commissioning did not complete exact 288/576 coverage: {remote_commission_terminal.get('blocker') or remote_commission_terminal.get('status')}"
                )
        else:
            update("running", "commissioning_continuation_adoption", "adopting only a pre-completed fresh commissioning continuation")
            if remote_commission_terminal is None:
                raise ValidityPipelineError("completed commissioning continuation state is unavailable; adoption never falls back to commissioning")
            prior_state = remote_json(f"{commissioning_adoption['priorBlockedRoot']}/state.json")
            expected_prior_blocker = f"{CONTINUATION_REPAIR_BATCH} exhausted independent review repairs: {CONTINUATION_REPAIR_CONCEPTS!r}"
            if (
                prior_state is None
                or prior_state.get("schemaVersion") != "cortex.learning_os.continuous_math_bank_commissioning_state.v1"
                or prior_state.get("status") != "blocked"
                or prior_state.get("campaignId") != bank_id
                or prior_state.get("purpose") != "validity"
                or prior_state.get("artifactRoot") != commissioning_adoption["priorBlockedRoot"]
                or prior_state.get("source") != source
                or prior_state.get("model") != CONTINUATION_RUNTIME["model"]
                or prior_state.get("thinking") != CONTINUATION_RUNTIME["thinking"]
                or prior_state.get("batchSize") != 4
                or prior_state.get("totalBatches") != 72
                or prior_state.get("completedBatches") != 71
                or prior_state.get("acceptedConcepts") != 284
                or prior_state.get("acceptedItems") != 568
                or prior_state.get("blocker") != expected_prior_blocker
                or not isinstance(prior_state.get("providerCallsStarted"), int)
                or isinstance(prior_state.get("providerCallsStarted"), bool)
                or prior_state["providerCallsStarted"] < 142
                or prior_state.get("providerCallsCompleted") != prior_state["providerCallsStarted"]
            ):
                raise ValidityPipelineError("prior blocked commissioning state semantic identity mismatch")
            ssh(
                "test",
                "!",
                "-e",
                f"{commissioning_adoption['priorBlockedRoot']}/batches/batch-050/accepted.json",
                timeout=30,
                label="prior-batch-050-still-missing",
            )
            continuation_provenance = validate_continuation_state(
                remote_commission_terminal,
                bank_id=bank_id,
                source=source,
                historical_runtime_root=historical_remote_runtime,
                runtime_root=commissioning_adoption["runtimeRoot"],
                prior_root=commissioning_adoption["priorBlockedRoot"],
                continuation_root=commissioning_adoption["continuationRoot"],
                prior_state_sha256=commissioning_adoption["priorStateSha256"],
                commissioned_content_sha256=commissioning_adoption["commissionedContentSha256"],
                spec_sha256=sha256(spec_path),
                spec=spec,
                runtime_materials=continuation_runtime_materials,
            )
            prior_manifest = continuation_provenance["priorRootManifest"]
            prior_manifest_files = prior_manifest["files"]
            observed_symlinks = ssh(
                "find", commissioning_adoption["priorBlockedRoot"], "-type", "l", "-print",
                timeout=120, label="remote-prior-manifest-symlinks",
            ).strip()
            if observed_symlinks:
                raise ValidityPipelineError("prior blocked commissioning root gained a symbolic link")
            observed_nonregular = ssh(
                "find", commissioning_adoption["priorBlockedRoot"], "-mindepth", "1",
                "!", "-type", "f", "!", "-type", "d", "!", "-type", "l", "-print",
                timeout=120, label="remote-prior-manifest-nonregular",
            ).strip()
            if observed_nonregular:
                raise ValidityPipelineError("prior blocked commissioning root gained a nonregular node")
            prior_prefix = f"{commissioning_adoption['priorBlockedRoot']}/"
            observed_manifest_file_paths = ssh(
                "find", commissioning_adoption["priorBlockedRoot"], "-type", "f", "-print",
                timeout=120, label="remote-prior-manifest-file-surface",
            ).splitlines()
            if any(not line.startswith(prior_prefix) for line in observed_manifest_file_paths):
                raise ValidityPipelineError("prior blocked commissioning file enumeration escaped its root")
            observed_manifest_files = sorted(line.removeprefix(prior_prefix) for line in observed_manifest_file_paths)
            expected_manifest_files = [row["relativePath"] for row in prior_manifest_files]
            if observed_manifest_files != expected_manifest_files:
                raise ValidityPipelineError("prior blocked commissioning regular-file surface changed after continuation completion")
            observed_manifest_directory_paths = ssh(
                "find", commissioning_adoption["priorBlockedRoot"], "-type", "d", "-print",
                timeout=120, label="remote-prior-manifest-directory-surface",
            ).splitlines()
            observed_manifest_directories = [
                "." if line == commissioning_adoption["priorBlockedRoot"] else line.removeprefix(prior_prefix)
                for line in observed_manifest_directory_paths
            ]
            if any(
                line != commissioning_adoption["priorBlockedRoot"] and not line.startswith(prior_prefix)
                for line in observed_manifest_directory_paths
            ):
                raise ValidityPipelineError("prior blocked commissioning directory enumeration escaped its root")
            observed_manifest_directories.sort()
            if observed_manifest_directories != prior_manifest["directories"]:
                raise ValidityPipelineError("prior blocked commissioning directory surface changed after continuation completion")
            for chunk_start in range(0, len(prior_manifest_files), 100):
                chunk = prior_manifest_files[chunk_start:chunk_start + 100]
                chunk_paths = [
                    f"{commissioning_adoption['priorBlockedRoot']}/{row['relativePath']}"
                    for row in chunk
                ]
                hash_lines = ssh(
                    "sha256sum", *chunk_paths,
                    timeout=300, label=f"remote-prior-manifest-hashes-{chunk_start // 100:03d}",
                ).splitlines()
                observed_hashes = [line.split()[0] for line in hash_lines if line.split()]
                if observed_hashes != [row["sha256"] for row in chunk]:
                    raise ValidityPipelineError("prior blocked commissioning file content changed after continuation completion")
                size_lines = ssh(
                    "stat", "-c", "%s", *chunk_paths,
                    timeout=300, label=f"remote-prior-manifest-sizes-{chunk_start // 100:03d}",
                ).splitlines()
                try:
                    observed_sizes = [int(line.strip()) for line in size_lines if line.strip()]
                except ValueError as error:
                    raise ValidityPipelineError("prior blocked commissioning manifest size output is invalid") from error
                if observed_sizes != [row["bytes"] for row in chunk]:
                    raise ValidityPipelineError("prior blocked commissioning file size changed after continuation completion")
            inventory = continuation_provenance["reusedAcceptedArtifacts"]
            prior_hash_paths = [
                f"{commissioning_adoption['priorBlockedRoot']}/state.json",
                *[
                    f"{commissioning_adoption['priorBlockedRoot']}/{row['relativePath']}"
                    for row in inventory
                ],
            ]
            expected_prior_hashes = [
                commissioning_adoption["priorStateSha256"],
                *[row["sha256"] for row in inventory],
            ]
            observed_lines = ssh(
                "sha256sum",
                *prior_hash_paths,
                timeout=300,
                label="remote-prior-commissioning-reverification",
            ).splitlines()
            observed_prior_hashes = [line.split()[0] for line in observed_lines if line.split()]
            if observed_prior_hashes != expected_prior_hashes:
                raise ValidityPipelineError("prior blocked commissioning state or reused accepted artifact mutated after continuation assembly")
            observed_size_lines = ssh(
                "stat", "-c", "%s",
                *prior_hash_paths[1:],
                timeout=300,
                label="remote-prior-commissioning-sizes",
            ).splitlines()
            try:
                observed_prior_sizes = [int(line.strip()) for line in observed_size_lines if line.strip()]
            except ValueError as error:
                raise ValidityPipelineError("prior accepted artifact size inventory is invalid") from error
            if observed_prior_sizes != [row["bytes"] for row in inventory]:
                raise ValidityPipelineError("prior accepted artifact byte-size inventory changed after continuation assembly")

        remote_commission_return = args.artifact_root / (
            "remote-commissioning-continuation" if commissioning_adoption is not None else "remote-commissioning"
        )
        remote_commission_return.mkdir(parents=True, exist_ok=True, mode=0o700)
        run([
            "rsync", "-a", "--delete", "--chmod=Du=rwx,Dgo=,Fu=rw,Fgo=", "--protect-args",
            f"{args.remote_host}:{remote_commission}/", f"{remote_commission_return}/",
        ], timeout=1800, log_root=logs, label="commission-return")
        commissioned_content = remote_commission_return / "commissioned-content.json"
        commissioned = read(commissioned_content)
        if commissioning_adoption is None:
            if commissioned.get("conceptCount") != 288 or commissioned.get("itemCount") != 576:
                raise ValidityPipelineError("returned validity content is not exact 288/576 coverage")
        else:
            returned_state = read(remote_commission_return / "state.json")
            returned_state_sha256, _ = regular_file_identity(remote_commission_return / "state.json")
            returned_content_sha256, _ = regular_file_identity(commissioned_content)
            if (
                returned_state_sha256 != commissioning_adoption["continuationStateSha256"]
                or returned_content_sha256 != commissioning_adoption["commissionedContentSha256"]
            ):
                raise ValidityPipelineError("returned continuation state or content differs from the pinned adoption bytes")
            returned_provenance = validate_continuation_state(
                returned_state,
                bank_id=bank_id,
                source=source,
                historical_runtime_root=historical_remote_runtime,
                runtime_root=commissioning_adoption["runtimeRoot"],
                prior_root=commissioning_adoption["priorBlockedRoot"],
                continuation_root=commissioning_adoption["continuationRoot"],
                prior_state_sha256=commissioning_adoption["priorStateSha256"],
                commissioned_content_sha256=commissioning_adoption["commissionedContentSha256"],
                spec_sha256=sha256(spec_path),
                spec=spec,
                runtime_materials=continuation_runtime_materials,
            )
            if returned_state != remote_commission_terminal or returned_provenance != continuation_provenance:
                raise ValidityPipelineError("commissioning continuation state changed during artifact return")
            if sha256(commissioned_content) != returned_state["outputSha256"]:
                raise ValidityPipelineError("returned commissioning continuation output SHA-256 mismatch")
            repair_artifact = returned_provenance["repairAcceptedArtifact"]
            repair_path = remote_commission_return / repair_artifact["relativePath"]
            returned_repair_manifest = regular_tree_manifest(repair_path.parent)
            if returned_repair_manifest != repair_artifact["artifactManifest"]:
                raise ValidityPipelineError("returned fresh batch-050 artifact tree differs from its pinned manifest")
            repair_sha256, repair_bytes = regular_file_identity(repair_path)
            if repair_sha256 != repair_artifact["sha256"] or repair_bytes != repair_artifact["bytes"]:
                raise ValidityPipelineError("returned commissioning continuation repair artifact SHA-256 mismatch")
            inventory = returned_provenance["reusedAcceptedArtifacts"]
            prior_return = args.artifact_root / "prior-commissioning-acceptances"
            prior_return.mkdir(parents=True, exist_ok=True, mode=0o700)
            prior_files_from = args.artifact_root / "prior-commissioning-accepted-files.txt"
            atomic_bytes(
                prior_files_from,
                ("\n".join(row["relativePath"] for row in inventory) + "\n").encode("utf-8"),
            )
            run([
                "rsync", "-a", "--delete", "--delete-excluded", "--prune-empty-dirs",
                "--chmod=Du=rwx,Dgo=,Fu=rw,Fgo=", f"--files-from={prior_files_from}", "--protect-args",
                f"{args.remote_host}:{commissioning_adoption['priorBlockedRoot']}/", f"{prior_return}/",
            ], timeout=1800, log_root=logs, label="prior-acceptance-return")
            expected_returned_paths = {row["relativePath"] for row in inventory}
            observed_returned_paths: set[str] = set()
            for target in prior_return.rglob("*"):
                if target.is_symlink():
                    raise ValidityPipelineError("returned prior acceptance inventory contains a symlink")
                if target.is_file():
                    observed_returned_paths.add(target.relative_to(prior_return).as_posix())
                elif not target.is_dir():
                    raise ValidityPipelineError("returned prior acceptance inventory contains a non-regular node")
            if observed_returned_paths != expected_returned_paths:
                raise ValidityPipelineError("returned prior acceptance artifact set is not exactly the pinned 71-file inventory")
            accepted_batches: list[dict[str, Any]] = []
            for row in inventory:
                accepted_path = prior_return / row["relativePath"]
                accepted_sha256, accepted_bytes = regular_file_identity(accepted_path)
                accepted = read(accepted_path)
                if (
                    accepted_sha256 != row["sha256"]
                    or accepted_bytes != row["bytes"]
                    or accepted.get("batchId") != row["batchId"]
                    or accepted.get("conceptIds") != row["conceptIds"]
                    or not isinstance(accepted.get("items"), list)
                    or len(accepted["items"]) != row["itemCount"]
                    or not isinstance(accepted.get("receipts"), list)
                    or not accepted["receipts"]
                ):
                    raise ValidityPipelineError(f"returned prior acceptance differs from its pinned inventory: {row['batchId']}")
                accepted_batches.append(accepted)
            repair_accepted = read(repair_path)
            if (
                repair_accepted.get("batchId") != CONTINUATION_REPAIR_BATCH
                or repair_accepted.get("conceptIds") != CONTINUATION_REPAIR_CONCEPTS
                or not isinstance(repair_accepted.get("items"), list)
                or len(repair_accepted["items"]) != 8
                or not isinstance(repair_accepted.get("receipts"), list)
                or not repair_accepted["receipts"]
            ):
                raise ValidityPipelineError("returned repair acceptance identity or exact item coverage mismatch")
            accepted_batches.append(repair_accepted)
            accepted_batches.sort(key=lambda row: str(row.get("batchId") or ""))
            validate_continuation_content(
                commissioned,
                bank_id=bank_id,
                source=source,
                spec=spec,
                provenance=returned_provenance,
                accepted_batches=accepted_batches,
            )
            commissioning_continuation_receipt = {
                "schemaVersion": "cortex.learning_os.validity_pipeline_commissioning_continuation_receipt.v1",
                "historicalRuntimeRoot": historical_remote_runtime,
                "priorBlockedRoot": commissioning_adoption["priorBlockedRoot"],
                "priorStateSha256": commissioning_adoption["priorStateSha256"],
                "continuationRoot": commissioning_adoption["continuationRoot"],
                "continuationStateSha256": commissioning_adoption["continuationStateSha256"],
                "runtimeRoot": commissioning_adoption["runtimeRoot"],
                "source": source,
                "reusedAcceptedInventorySha256": returned_provenance["reusedAcceptedInventorySha256"],
                "priorRootManifestSha256": returned_provenance["priorRootManifest"]["sha256"],
                "repairAcceptedSha256": returned_provenance["repairAcceptedArtifact"]["sha256"],
                "commissionedContentSha256": returned_state["outputSha256"],
                "truthBoundary": CONTINUATION_TRUTH_BOUNDARY,
            }
            update(
                "running",
                "commissioning_continuation_adopted",
                "fresh continuation provenance and all reused artifact hashes were verified",
                commissioningContinuationReceipt=commissioning_continuation_receipt,
            )

        bank_path = args.state_root / "assessment-banks" / f"{bank_id}.json"
        bank_report_path = args.artifact_root / "bank-validation-report.json"
        if not bank_path.exists():
            update("running", "bank_signing", "applying separated item/bank author and reviewer signatures locally")
            signing_root = args.artifact_root / "signing"
            if signing_root.exists():
                signing_root = args.artifact_root / f"signing-resume-{int(time.time())}"
            signing_root.mkdir(parents=True, mode=0o700)
            unsigned = signing_root / "00-unsigned-envelope.json"
            item_author = signing_root / "01-item-author-envelope.json"
            item_reviewer = signing_root / "02-item-reviewer-envelope.json"
            bank_author = signing_root / "03-bank-author-envelope.json"
            signed = signing_root / "04-signed-bank-envelope.json"
            revision = int(read(args.state_root / "mastery.json")["revision"])
            author_key = args.authority_root / "bank-authoring.private.pem"
            reviewer_key = args.authority_root / "bank-review.private.pem"
            run(["node", clos / "src/continuous-math-bank-assemble.mjs", commissioned_content, unsigned, str(revision)], cwd=repo, timeout=600, log_root=logs, label="assemble-bank")
            run(["node", clos / "src/continuous-math-bank-sign.mjs", "item-author", unsigned, item_author, author_key], cwd=repo, timeout=600, log_root=logs, label="sign-item-author")
            run(["node", clos / "src/continuous-math-bank-sign.mjs", "item-reviewer", item_author, item_reviewer, reviewer_key], cwd=repo, timeout=600, log_root=logs, label="sign-item-reviewer")
            run(["node", clos / "src/continuous-math-bank-sign.mjs", "bank-author", item_reviewer, bank_author, author_key], cwd=repo, timeout=600, log_root=logs, label="sign-bank-author")
            run(["node", clos / "src/continuous-math-bank-sign.mjs", "bank-reviewer", bank_author, signed, reviewer_key], cwd=repo, timeout=600, log_root=logs, label="sign-bank-reviewer")
            run(["node", clos / "src/continuous-math-bank-validate.mjs", signed, commissioned_content, bank_path, bank_report_path], cwd=repo, timeout=1200, log_root=logs, label="validate-bank")
        bank_report = read(bank_report_path)
        signed_bank = read(bank_path)
        if (
            bank_report.get("status") != "green"
            or bank_report.get("conceptCount") != 288
            or bank_report.get("itemCount") != 576
            or signed_bank.get("bankDigest") != bank_report.get("bankDigest")
        ):
            raise ValidityPipelineError("signed full validity bank validation is not green")

        contamination_path = args.artifact_root / "contamination-report.json"
        if not contamination_path.exists():
            update("running", "contamination_audit", "checking the full new bank against all prior assessment banks")
            references = sorted(
                target for target in (args.state_root / "assessment-banks").glob("*.json")
                if target.resolve() != bank_path.resolve()
            )
            command: list[str | Path] = [
                "node", clos / "src/continuous-math-validity-contamination.mjs",
                "--candidate", bank_path,
                "--report", contamination_path,
            ]
            for reference in references:
                command.extend(["--reference", reference])
            run(command, cwd=repo, timeout=1800, log_root=logs, label="contamination-audit")
        if read(contamination_path).get("status") != "green":
            raise ValidityPipelineError("validity bank contamination audit is not green")

        plan_path = args.artifact_root / "validity-plan.json"
        if not plan_path.exists():
            update("running", "plan_signing", "binding signed acquired-once state and all 288 fresh validity sessions under the proctor authority")
            plan_result = parse_json_output(run([
                "node", clos / "src/continuous-math-validity-plan.mjs",
                "--out", plan_path,
                "--bank", bank_path,
                "--campaign-id", args.campaign_id,
                "--state-root", args.state_root,
                "--proctor-private-key", args.authority_root / "proctor.private.pem",
                "--thinking", "ultra",
            ], cwd=repo, timeout=1200, log_root=logs, label="validity-plan"))
            if not plan_result.get("ok") or plan_result.get("sessionCount") != 288:
                raise ValidityPipelineError("proctor-signed validity plan did not freeze 288 sessions")
        validity_plan = read(plan_path)

        run(["scp", "-q", "-o", "BatchMode=yes", bank_path, f"{args.remote_host}:{remote_bank}"], timeout=600, log_root=logs, label="sync-bank")
        run(["scp", "-q", "-o", "BatchMode=yes", plan_path, f"{args.remote_host}:{remote_plan}"], timeout=600, log_root=logs, label="sync-plan")
        ssh("chmod", "600", remote_bank, remote_plan, timeout=30, label="remote-assessment-input-modes")

        remote_assessment_terminal = remote_json(remote_assessment_state)
        if remote_assessment_terminal is None:
            update("running", "assessment", "launching 288 fresh no-tools validity candidate sessions on Hetzner")
            unit = f"clos-{args.campaign_id.replace('.', '-').replace(':', '-')}-assess"
            ssh(
                "systemd-run", "--user", f"--unit={unit}", "--collect", "--quiet",
                f"--working-directory={remote_clos}",
                "/usr/bin/python3", f"{remote_clos}/scripts/supervise_continuous_math_validity.py",
                "--root", remote_assessment,
                "--source-root", remote_source_root,
                "--plan", remote_plan,
                "--bank", remote_bank,
                "--approved-model-executable-binding", remote_binding,
                "--execution-private-key", args.remote_execution_private_key,
                "--codex-command", approved_codex,
                "--concurrency", str(args.assessment_concurrency),
                "--session-timeout-seconds", "1800",
                timeout=60,
                label="remote-assessment-launch",
            )
        remote_assessment_terminal = wait_remote_state(
            remote_assessment_state,
            args.assessment_wall_seconds,
            "assessment",
        )
        if (
            remote_assessment_terminal.get("status") != "completed"
            or remote_assessment_terminal.get("completedSessions") != 288
        ):
            raise ValidityPipelineError(
                f"remote validity assessment supervisor did not terminalize all 288 sessions: {remote_assessment_terminal.get('reason') or remote_assessment_terminal.get('status')}"
            )
        remote_assessment_return = args.artifact_root / "remote-assessment"
        remote_assessment_return.mkdir(parents=True, exist_ok=True, mode=0o700)
        update("running", "artifact_return", "returning all 288 identity-bound session artifacts to the control plane")
        run([
            "rsync", "-a", "--delete", "--chmod=Du=rwx,Dgo=,Fu=rw,Fgo=", "--protect-args",
            f"{args.remote_host}:{remote_assessment}/", f"{remote_assessment_return}/",
        ], timeout=7200, log_root=logs, label="assessment-return")

        verification_root = args.artifact_root / "verification"
        if not verification_root.exists():
            update("running", "independent_replay", "replaying trusted execution and deterministic grading for every returned concept")
            verification = parse_json_output(run([
                "node", clos / "src/verify-continuous-math-validity-run.mjs",
                "--plan", plan_path,
                "--bank", bank_path,
                "--remote-state", remote_assessment_return / "supervisor-state.json",
                "--incoming-root", remote_assessment_return,
                "--out-root", verification_root,
                "--approved-model-executable-binding", args.approved_model_executable_binding,
                "--grader-private-key", args.authority_root / "grader.private.pem",
            ], cwd=repo, timeout=14400, log_root=logs, label="verify-assessment"))
            if not verification.get("ok"):
                raise ValidityPipelineError("control-plane validity replay did not complete")
        summary = read(verification_root / "completion-summary.json")
        validity_state = read(verification_root / "validity-state.json")
        counts = summary.get("counts") or {}
        if counts.get("conceptCount") != 288 or counts.get("acquiredOnce") != 288:
            raise ValidityPipelineError("validity replay lost the exact 288-concept acquired-once surface")

        canonical_validity = args.state_root / "validity.json"
        if canonical_validity.exists():
            existing = read(canonical_validity)
            if existing.get("stateSha256") != validity_state.get("stateSha256"):
                history = args.state_root / "validity-history"
                history.mkdir(parents=True, exist_ok=True, mode=0o700)
                backup = history / f"validity-{int(time.time())}-{existing.get('stateSha256', 'unknown')}.json"
                shutil.copy2(canonical_validity, backup)
                os.chmod(backup, 0o600)
        atomic_bytes(canonical_validity, (verification_root / "validity-state.json").read_bytes())
        installed = read(canonical_validity)
        if installed.get("stateSha256") != validity_state.get("stateSha256"):
            raise ValidityPipelineError("canonical validity state install verification failed")

        final_remote_clean = ssh("git", "-C", remote_source_root, "status", "--porcelain=v1", "--untracked-files=all", timeout=30, label="remote-final-clean").strip()
        if final_remote_clean:
            raise ValidityPipelineError("remote isolated source checkout accumulated runtime debris")
        completion = {
            "schemaVersion": "cortex.learning_os.validity_pipeline_completion.v1",
            "status": "completed",
            "campaignId": args.campaign_id,
            "completedAt": now(),
            "source": source,
            "sourceRef": args.source_ref,
            "bankId": signed_bank.get("bankId"),
            "bankDigest": signed_bank.get("bankDigest"),
            "planSha256": validity_plan.get("planSha256"),
            "stateSha256": validity_state.get("stateSha256"),
            "counts": counts,
            "canonicalValidityState": str(canonical_validity),
            "artifactRoot": str(args.artifact_root),
            "remoteSourceRoot": remote_source_root,
            "remoteRuntimeRoot": remote_runtime,
            "remoteSourceWorktreeClean": True,
            "commissioningContinuationReceipt": commissioning_continuation_receipt,
            "retentionR7Confirmed": 0,
            "utilityQualified": 0,
            "modelWeightLearningClaim": False,
            "truthBoundary": summary.get("truthBoundary"),
        }
        completion_path = args.artifact_root / "completion-summary.json"
        if not completion_path.exists():
            atomic_json(completion_path, completion)
        update(
            "completed",
            "completed",
            "all 288 concepts reached independently replayed near-term validity states; acquisition history remains separate and retention/utility remain unclaimed",
            completedAt=completion["completedAt"],
            counts={
                "acquiredOnce": counts.get("acquiredOnce"),
                "validityConfirmed": counts.get("validityConfirmed"),
                "validityFailed": counts.get("validityFailed"),
                "validityBlocked": counts.get("validityBlocked"),
                "retentionR7": 0,
                "utilityQualified": 0,
            },
            completionSummary=str(completion_path),
            canonicalValidityState=str(canonical_validity),
            stateSha256=validity_state.get("stateSha256"),
            bankDigest=signed_bank.get("bankDigest"),
            planSha256=validity_plan.get("planSha256"),
            remoteSourceWorktreeClean=True,
            commissioningContinuationReceipt=commissioning_continuation_receipt,
        )
        print(json.dumps(state, indent=2, sort_keys=True))
        return 0
    except Exception as error:
        blocker = {
            "schemaVersion": "cortex.learning_os.validity_pipeline_blocker.v1",
            "status": "blocked",
            "campaignId": args.campaign_id,
            "blockedAt": now(),
            "phase": state.get("phase"),
            "blocker": {"code": "validity_pipeline_blocked", "message": str(error)},
            "artifactRoot": str(args.artifact_root),
            "source": source,
            "counts": state.get("counts"),
            "truthBoundary": "A blocked validity lane grants no missing validity, retention, utility, mastery, or model-weight credit. Historical acquired-once evidence remains unchanged.",
        }
        blocker_path = args.artifact_root / "blocker-report.json"
        if blocker_path.exists():
            blocker_path = args.artifact_root / f"blocker-report-{int(time.time())}.json"
        atomic_json(blocker_path, blocker)
        update(
            "blocked",
            str(state.get("phase") or "unknown"),
            str(error),
            blockedAt=blocker["blockedAt"],
            blocker=blocker["blocker"],
            blockerReport=str(blocker_path),
        )
        print(json.dumps(state, indent=2, sort_keys=True))
        return 2


def entrypoint() -> int:
    try:
        return main()
    except Exception as error:
        blocker = {
            "schemaVersion": "cortex.learning_os.validity_pipeline_blocker.v1",
            "status": "blocked",
            "phase": "preflight",
            "blockedAt": now(),
            "blocker": {"code": "validity_pipeline_preflight_rejected", "message": str(error)},
            "truthBoundary": "A rejected validity preflight grants no validity, retention, utility, mastery, or model-weight credit and changes no historical evidence.",
        }
        print(json.dumps(blocker, indent=2, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(entrypoint())
