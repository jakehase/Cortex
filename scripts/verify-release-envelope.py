#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
from pathlib import Path, PurePosixPath
from typing import Any

RELEASE_SCHEMA = "cortex.release-envelope.v2"
RECEIPT_SCHEMA = "cortex.qualification-receipt.v1"
SHA256_HEX = set("0123456789abcdef")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_digest(payload: dict[str, Any]) -> str:
    unsigned = {key: value for key, value in payload.items() if key != "envelopeSha256"}
    return hashlib.sha256(
        json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _valid_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= SHA256_HEX


def _safe_relative(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    pure = PurePosixPath(value)
    if pure.is_absolute() or ".." in pure.parts or not pure.parts:
        return None
    return pure.as_posix()


def _classify(relative: str, source_classification: dict[str, Any]) -> str | None:
    if source_classification.get("matchPolicy") != "first_match":
        return None
    categories = source_classification.get("trackedCategories")
    if not isinstance(categories, list):
        return None
    defaults: list[str] = []
    for row in categories:
        if not isinstance(row, dict) or not isinstance(row.get("name"), str):
            return None
        if row.get("default") is True:
            defaults.append(row["name"])
            continue
        prefixes = row.get("pathPrefixes") or []
        exact_paths = row.get("exactPaths") or []
        components = row.get("pathComponents") or []
        if (
            relative in exact_paths
            or any(relative.startswith(value) for value in prefixes if isinstance(value, str))
            or any(value in PurePosixPath(relative).parts for value in components if isinstance(value, str))
        ):
            return row["name"]
    return defaults[0] if len(defaults) == 1 else None


def _validate_provenance(envelope: dict[str, Any]) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    for field in ("sourceCommit", "sourceTree", "parentCommit"):
        value = envelope.get(field)
        if not isinstance(value, str) or len(value) != 40 or set(value) - set("0123456789abcdef"):
            errors.append({"field": field, "reason": "invalid_git_object_id"})
    identity = envelope.get("sourceIdentity")
    if not isinstance(identity, dict):
        errors.append({"field": "sourceIdentity", "reason": "missing"})
    else:
        empty_status = hashlib.sha256(b"").hexdigest()
        if identity.get("clean") is not True:
            errors.append({"field": "sourceIdentity.clean", "reason": "not_true"})
        if identity.get("statusPorcelainSha256") != empty_status:
            errors.append({"field": "sourceIdentity.statusPorcelainSha256", "reason": "not_clean"})
        if identity.get("indexTree") != envelope.get("sourceTree"):
            errors.append({"field": "sourceIdentity.indexTree", "reason": "tree_mismatch"})
        if identity.get("objectFormat") != "sha1":
            errors.append({"field": "sourceIdentity.objectFormat", "reason": "unsupported"})
    classification = envelope.get("sourceClassification")
    if not isinstance(classification, dict):
        errors.append({"field": "sourceClassification", "reason": "missing"})
    else:
        private = classification.get("privateRuntime")
        if not isinstance(private, dict):
            errors.append({"field": "sourceClassification.privateRuntime", "reason": "missing"})
        elif private.get("trackedFilesAllowed") is not False or private.get("trackedFileCount") != 0:
            errors.append({"field": "sourceClassification.privateRuntime", "reason": "tracked_private_data"})
        contract_path = _safe_relative(classification.get("contractPath"))
        if contract_path is None or not _valid_sha256(classification.get("contractSha256")):
            errors.append({"field": "sourceClassification.contract", "reason": "invalid"})
    receipts = envelope.get("qualificationReceipts")
    if not isinstance(receipts, list) or not receipts:
        errors.append({"field": "qualificationReceipts", "reason": "missing"})
    else:
        kinds: set[str] = set()
        for index, row in enumerate(receipts):
            field = f"qualificationReceipts[{index}]"
            if not isinstance(row, dict):
                errors.append({"field": field, "reason": "invalid"})
                continue
            payload = row.get("payload")
            kind = row.get("kind")
            if not isinstance(kind, str) or not kind or kind in kinds:
                errors.append({"field": f"{field}.kind", "reason": "invalid_or_duplicate"})
                continue
            kinds.add(kind)
            if not isinstance(payload, dict):
                errors.append({"field": f"{field}.payload", "reason": "missing"})
                continue
            if row.get("payloadSha256") != hashlib.sha256(
                json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            ).hexdigest():
                errors.append({"field": f"{field}.payloadSha256", "reason": "digest_mismatch"})
            if not _valid_sha256(row.get("receiptSha256")):
                errors.append({"field": f"{field}.receiptSha256", "reason": "invalid"})
            if (
                payload.get("schemaVersion") != RECEIPT_SCHEMA
                or payload.get("kind") != kind
                or str(payload.get("outcome") or "").lower() != "green"
                or payload.get("sourceCommit") != envelope.get("sourceCommit")
                or payload.get("sourceTree") != envelope.get("sourceTree")
                or payload.get("exitCode") != 0
            ):
                errors.append({"field": field, "reason": "candidate_or_outcome_mismatch"})
            replay = payload.get("replayCommand")
            artifacts = payload.get("artifacts")
            if not isinstance(replay, list) or not replay or not all(isinstance(value, str) and value for value in replay):
                errors.append({"field": f"{field}.replayCommand", "reason": "missing"})
            if not all(isinstance(payload.get(name), str) and payload.get(name) for name in ("startedAt", "completedAt")):
                errors.append({"field": f"{field}.timestamps", "reason": "missing"})
            if not isinstance(artifacts, list) or not artifacts:
                errors.append({"field": f"{field}.artifacts", "reason": "missing"})
            else:
                for artifact in artifacts:
                    if (
                        not isinstance(artifact, dict)
                        or _safe_relative(artifact.get("path")) is None
                        or not _valid_sha256(artifact.get("sha256"))
                    ):
                        errors.append({"field": f"{field}.artifacts", "reason": "invalid"})
                        break
        if kinds != {"full-suite", "focused-gates"}:
            errors.append({"field": "qualificationReceipts", "reason": "required_kinds_missing"})
    return errors


def verify(root: Path, envelope: dict[str, Any], *, allow_git_directory: bool = False) -> dict[str, Any]:
    provenance_errors = _validate_provenance(envelope)
    source_contract: dict[str, Any] = {}
    contract_relative = _safe_relative((envelope.get("sourceClassification") or {}).get("contractPath"))
    if contract_relative is not None:
        contract_path = root.joinpath(*PurePosixPath(contract_relative).parts)
        try:
            source_contract = json.loads(contract_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            provenance_errors.append({"field": "sourceClassification.contract", "reason": f"unreadable_{type(exc).__name__}"})
        if source_contract.get("schemaVersion") != "cortex.runtime-surface-contract.v2":
            provenance_errors.append({"field": "sourceClassification.contract", "reason": "unsupported_schema"})
        qualification_policy = source_contract.get("qualification") or {}
        receipt_index = {
            row.get("kind"): row.get("payload")
            for row in envelope.get("qualificationReceipts") or []
            if isinstance(row, dict) and isinstance(row.get("payload"), dict)
        }
        if set(receipt_index) != set(qualification_policy.get("requiredReceiptKinds") or []):
            provenance_errors.append({"field": "qualificationReceipts", "reason": "contract_kind_mismatch"})
        focused_required = set(qualification_policy.get("focusedSurfaceIds") or [])
        focused_observed = set((receipt_index.get("focused-gates") or {}).get("surfaceIds") or [])
        if not focused_required or not focused_required <= focused_observed:
            provenance_errors.append({"field": "qualificationReceipts.focused-gates", "reason": "surface_coverage_missing"})
    rows = envelope.get("files") or []
    if not isinstance(rows, list) or len(rows) != envelope.get("fileCount"):
        provenance_errors.append({"field": "fileCount", "reason": "mismatch"})
        rows = rows if isinstance(rows, list) else []
    expected: set[str] = set()
    mismatches: list[dict[str, Any]] = []
    observed_classifications: dict[str, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            mismatches.append({"path": "", "reason": "invalid_manifest_row"})
            continue
        relative = _safe_relative(row.get("path"))
        if relative is None:
            mismatches.append({"path": str(row.get("path") or ""), "reason": "unsafe_path"})
            continue
        if relative in expected:
            mismatches.append({"path": relative, "reason": "duplicate_path"})
            continue
        expected.add(relative)
        category = row.get("classification")
        if category not in {"product", "generated", "quarantined"}:
            mismatches.append({"path": relative, "reason": "invalid_classification"})
        else:
            observed_classifications[category] = observed_classifications.get(category, 0) + 1
            expected_category = _classify(relative, source_contract.get("sourceClassification") or {})
            if expected_category != category:
                mismatches.append({"path": relative, "reason": "classification_contract_mismatch"})
        target = root.joinpath(*PurePosixPath(relative).parts)
        if target.is_symlink() or not target.is_file():
            mismatches.append({"path": relative, "reason": "missing_or_unsafe"})
            continue
        try:
            expected_mode = int(row["mode"])
            expected_size = int(row["bytes"])
        except (KeyError, TypeError, ValueError):
            mismatches.append({"path": relative, "reason": "invalid_metadata"})
            continue
        observed_mode = stat.S_IMODE(target.stat().st_mode)
        observed_hash = sha256(target)
        if observed_mode != expected_mode:
            mismatches.append({"path": relative, "reason": "mode", "observed": observed_mode})
        if target.stat().st_size != expected_size:
            mismatches.append({"path": relative, "reason": "size", "observed": target.stat().st_size})
        if not _valid_sha256(row.get("sha256")) or observed_hash != row.get("sha256"):
            mismatches.append({"path": relative, "reason": "sha256", "observed": observed_hash})

    declared_counts = (envelope.get("sourceClassification") or {}).get("trackedCounts")
    if declared_counts != dict(sorted(observed_classifications.items())):
        provenance_errors.append({"field": "sourceClassification.trackedCounts", "reason": "mismatch"})
    surface = envelope.get("runtimeSurfaceContract")
    if not isinstance(surface, dict):
        provenance_errors.append({"field": "runtimeSurfaceContract", "reason": "missing"})
    else:
        relative = _safe_relative(surface.get("path"))
        if relative is None or relative not in expected:
            provenance_errors.append({"field": "runtimeSurfaceContract.path", "reason": "not_packaged"})
        elif sha256(root.joinpath(*PurePosixPath(relative).parts)) != surface.get("sha256"):
            provenance_errors.append({"field": "runtimeSurfaceContract.sha256", "reason": "mismatch"})
        elif (
            relative != contract_relative
            or surface.get("sha256") != (envelope.get("sourceClassification") or {}).get("contractSha256")
        ):
            provenance_errors.append({"field": "runtimeSurfaceContract", "reason": "classification_contract_mismatch"})

    observed: set[str] = set()
    unsafe: list[dict[str, str]] = []
    for target in sorted(root.rglob("*")):
        relative = target.relative_to(root).as_posix()
        if relative == ".git" or relative.startswith(".git/"):
            if allow_git_directory:
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
    outcome = "green" if not provenance_errors and not mismatches and not unsafe and not extras and not missing else "red"
    return {
        "schemaVersion": "cortex.release-envelope-verification.v2",
        "outcome": outcome,
        "releaseId": envelope.get("releaseId"),
        "sourceCommit": envelope.get("sourceCommit"),
        "sourceTree": envelope.get("sourceTree"),
        "sourceClean": (envelope.get("sourceIdentity") or {}).get("clean") is True,
        "expectedFileCount": len(expected),
        "observedFileCount": len(observed),
        "classificationCounts": dict(sorted(observed_classifications.items())),
        "provenanceErrors": provenance_errors,
        "mismatches": mismatches,
        "unsafeEntries": unsafe,
        "extraPaths": extras,
        "missingPaths": missing,
        "envelopeSha256": envelope.get("envelopeSha256"),
        "truthBoundary": "Green proves exact classified files, modes, sizes, hashes, clean source identity, embedded exact-candidate qualification receipts, and absence of unclassified release entries. It does not prove runtime health, rollback, redeploy, or the remote accepted ref.",
    }


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o644)
    os.replace(temporary, path)


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
    if envelope.get("schemaVersion") != RELEASE_SCHEMA:
        raise SystemExit("unsupported release envelope schema")
    if canonical_digest(envelope) != envelope.get("envelopeSha256"):
        raise SystemExit("release envelope digest mismatch")
    result = verify(root, envelope, allow_git_directory=args.allow_git_directory)
    if args.output:
        _atomic_json(Path(args.output).resolve(), result)
    print(
        json.dumps(
            {
                "outcome": result["outcome"],
                "releaseId": result["releaseId"],
                "expectedFileCount": result["expectedFileCount"],
                "observedFileCount": result["observedFileCount"],
                "provenanceErrorCount": len(result["provenanceErrors"]),
                "mismatchCount": len(result["mismatches"]),
                "unsafeEntryCount": len(result["unsafeEntries"]),
                "extraPathCount": len(result["extraPaths"]),
                "missingPathCount": len(result["missingPaths"]),
            },
            sort_keys=True,
        )
    )
    raise SystemExit(0 if result["outcome"] == "green" else 1)


if __name__ == "__main__":
    main()
