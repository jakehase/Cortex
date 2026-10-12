#!/usr/bin/env python3
"""Copy an exact pinned test environment into a workspace-local venv.

This is an offline provisioning fallback. It reads installed distributions from
an explicitly supplied source site-packages directory, requires exact versions
from the repository lock, copies only files recorded by those distributions,
and emits a content-digest receipt. It never installs into the source or system
interpreter.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import re
import shutil


ROOT = Path(__file__).resolve().parents[1]


def normalize_name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_pins(path: Path) -> dict[str, str]:
    pins: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, version = line.partition("==")
        if not separator or not name or not version:
            raise RuntimeError(f"dependency is not exactly pinned: {line}")
        pins[normalize_name(name)] = version
    return pins


def within(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-site", required=True)
    parser.add_argument("--destination-site", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()

    source_site = Path(args.source_site).resolve(strict=True)
    destination_site = Path(args.destination_site).resolve(strict=True)
    manifest = Path(args.manifest).resolve(strict=True)
    receipt_path = Path(args.receipt).resolve()
    local_venv = (ROOT / ".integration-venv").resolve(strict=True)
    if not within(destination_site, local_venv):
        raise RuntimeError("destination site-packages is outside .integration-venv")

    pins = load_pins(manifest)
    available = {
        normalize_name(dist.metadata["Name"]): dist
        for dist in metadata.distributions(path=[str(source_site)])
        if dist.metadata.get("Name")
    }
    copied: dict[str, dict[str, object]] = {}
    aggregate = hashlib.sha256()
    for name, expected_version in sorted(pins.items()):
        distribution = available.get(name)
        if distribution is None:
            raise RuntimeError(f"pinned distribution is absent from source: {name}")
        if distribution.version != expected_version:
            raise RuntimeError(
                f"source version mismatch for {name}: "
                f"expected {expected_version}, got {distribution.version}"
            )
        files = distribution.files
        if files is None:
            raise RuntimeError(f"distribution has no auditable file record: {name}")
        file_digests: list[tuple[str, str]] = []
        for recorded in files:
            relative = Path(str(recorded))
            source = (source_site / relative).resolve()
            destination = (destination_site / relative).resolve()
            if not within(source, source_site) or not within(destination, destination_site):
                continue
            if not source.is_file():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination, follow_symlinks=True)
            digest = sha256_file(destination)
            rendered = relative.as_posix()
            file_digests.append((rendered, digest))
            aggregate.update(f"{name}\0{rendered}\0{digest}\n".encode("utf-8"))
        if not file_digests:
            raise RuntimeError(f"distribution copied no bounded files: {name}")
        copied[name] = {
            "version": expected_version,
            "fileCount": len(file_digests),
            "contentSetSha256": hashlib.sha256(
                "".join(f"{path}\0{digest}\n" for path, digest in file_digests).encode(
                    "utf-8"
                )
            ).hexdigest(),
        }

    receipt = {
        "schemaVersion": "cortex.integration-dependency-provisioning.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "offline-copy-from-exact-local-distributions",
        "sourceSitePackages": str(source_site),
        "destinationSitePackages": str(destination_site),
        "dependencyManifest": str(manifest),
        "dependencyManifestSha256": sha256_file(manifest),
        "packages": copied,
        "copiedContentSha256": aggregate.hexdigest(),
        "systemPackagesModified": False,
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = receipt_path.with_name(f".{receipt_path.name}.tmp")
    temporary.write_text(
        f"{json.dumps(receipt, indent=2, sort_keys=True)}\n", encoding="utf-8"
    )
    os.chmod(temporary, 0o600)
    temporary.replace(receipt_path)
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
