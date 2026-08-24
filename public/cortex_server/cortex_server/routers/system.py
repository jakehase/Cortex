"""Layered q9 system attestation without collapsing runtime and evidence truth."""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import os
import stat
import threading
import urllib.request
from pathlib import Path, PurePosixPath
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request

from cortex_server.routers.knowledge import service as knowledge_service

router = APIRouter()
_RELEASE_CACHE_LOCK = threading.Lock()
_RELEASE_CACHE: dict[tuple[object, ...], dict] = {}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_digest(payload: dict) -> str:
    unsigned = {key: value for key, value in payload.items() if key != "envelopeSha256"}
    return hashlib.sha256(
        json.dumps(unsigned, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _require_admin(request: Request) -> None:
    expected = os.getenv("CORTEX_ADMIN_TOKEN", "").strip()
    provided = str(request.headers.get("x-cortex-admin-token", "") or "")
    if not expected or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="administrator attestation access required")


def _release_layer() -> dict:
    root_value = os.getenv("CORTEX_RELEASE_ROOT", "").strip()
    envelope_value = os.getenv("CORTEX_RELEASE_ENVELOPE_PATH", "").strip()
    if not root_value or not envelope_value:
        return {"status": "unavailable", "reason": "release envelope is not configured"}
    root = Path(root_value).resolve(strict=True)
    envelope_path = Path(envelope_value).resolve(strict=True)
    cache_key = (
        str(root),
        str(envelope_path),
        envelope_path.stat().st_mtime_ns,
        envelope_path.stat().st_size,
    )
    with _RELEASE_CACHE_LOCK:
        cached = _RELEASE_CACHE.get(cache_key)
        if cached is not None:
            return dict(cached)
    envelope = json.loads(envelope_path.read_text(encoding="utf-8"))
    if envelope.get("schemaVersion") != "cortex.release-envelope.v1":
        return {"status": "red", "reason": "unsupported release envelope schema"}
    if _canonical_digest(envelope) != envelope.get("envelopeSha256"):
        return {"status": "red", "reason": "release envelope digest mismatch"}
    mismatches = []
    for row in envelope.get("files") or []:
        relative = str(row.get("path") or "")
        pure = PurePosixPath(relative)
        if pure.is_absolute() or ".." in pure.parts or not pure.parts:
            mismatches.append({"path": relative, "reason": "unsafe_path"})
            continue
        target = root.joinpath(*pure.parts)
        if target.is_symlink() or not target.is_file():
            mismatches.append({"path": relative, "reason": "missing_or_unsafe"})
            continue
        if stat.S_IMODE(target.stat().st_mode) != int(row["mode"]):
            mismatches.append({"path": relative, "reason": "mode"})
        elif target.stat().st_size != int(row["bytes"]):
            mismatches.append({"path": relative, "reason": "size"})
        elif _sha256(target) != row["sha256"]:
            mismatches.append({"path": relative, "reason": "sha256"})
        if len(mismatches) >= 20:
            break
    result = {
        "status": "green" if not mismatches else "red",
        "releaseId": envelope.get("releaseId"),
        "sourceCommit": envelope.get("sourceCommit"),
        "sourceTree": envelope.get("sourceTree"),
        "fileCount": envelope.get("fileCount"),
        "envelopeSha256": envelope.get("envelopeSha256"),
        "mismatchCount": len(mismatches),
        "mismatches": mismatches,
    }
    with _RELEASE_CACHE_LOCK:
        _RELEASE_CACHE.clear()
        _RELEASE_CACHE[cache_key] = dict(result)
    return result


def _receipt_layer(environment_name: str, *, maximum_age_seconds: int | None = None) -> dict:
    value = os.getenv(environment_name, "").strip()
    if not value:
        return {"status": "unavailable", "reason": f"{environment_name} is not configured"}
    path = Path(value)
    try:
        if path.is_symlink() or not path.is_file():
            raise ValueError("receipt path is not a regular file")
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"status": "red", "reason": f"invalid receipt: {type(exc).__name__}"}
    raw_status = str(payload.get("status") or payload.get("outcome") or "").lower()
    status = "green" if raw_status in {"green", "complete", "allowed"} else "red"
    expected_release = os.getenv("CORTEX_RELEASE_ID", "").strip()
    receipt_release = str(payload.get("releaseId") or "").strip()
    release_bound = bool(expected_release and receipt_release == expected_release)
    if not release_bound:
        status = "red"
    timestamp_value = next(
        (payload.get(key) for key in ("verifiedAt", "refreshedAt", "generatedAt", "completedAt") if payload.get(key)),
        None,
    )
    age_seconds = None
    stale = False
    if timestamp_value:
        try:
            observed = dt.datetime.fromisoformat(str(timestamp_value).replace("Z", "+00:00"))
            age_seconds = max(0.0, (_now() - observed.astimezone(dt.timezone.utc)).total_seconds())
            stale = maximum_age_seconds is not None and age_seconds > maximum_age_seconds
        except ValueError:
            status = "red"
    if stale and status == "green":
        status = "stale"
    return {
        "status": status,
        "receiptSchemaVersion": payload.get("schemaVersion"),
        "receiptSha256": _sha256(path),
        "releaseBound": release_bound,
        "releaseId": receipt_release or None,
        "ageSeconds": round(age_seconds, 3) if age_seconds is not None else None,
        "maximumAgeSeconds": maximum_age_seconds,
        "stale": stale,
    }


def _provider_layer() -> dict:
    enabled = os.getenv("ORACLE_OLLAMA_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}
    url = os.getenv("ORACLE_OLLAMA_URL", "").strip()
    if not enabled:
        return {"status": "unavailable", "reason": "Ollama provider lane is disabled"}
    if url != "http://127.0.0.1:11434":
        return {"status": "red", "reason": "provider URL is not the approved loopback endpoint"}
    try:
        with urllib.request.urlopen(f"{url}/api/tags", timeout=2) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("provider response exceeded bound")
        payload = json.loads(raw.decode("utf-8"))
        models = [str(row.get("name") or "") for row in payload.get("models", []) if isinstance(row, dict)]
        tinyllama = any(model.split(":", 1)[0] == "tinyllama" for model in models)
    except Exception as exc:
        return {"status": "red", "reason": f"provider probe failed: {type(exc).__name__}"}
    return {
        "status": "green" if tinyllama else "red",
        "endpoint": "loopback",
        "tinyllamaAvailable": tinyllama,
        "modelCount": len(models),
    }


def _security_layer(request: Request) -> dict:
    safe_mode = os.getenv("CORTEX_SAFE_MODE", "true").strip().lower() in {"1", "true", "yes", "on"}
    strict_scope = os.getenv("CORTEX_MEMORY_SCOPE_STRICT", "").strip().lower() in {"1", "true", "yes", "on"}
    write_auth = os.getenv("CORTEX_WRITE_AUTH_MODE", "token_required").strip()
    try:
        registry = json.loads(os.getenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", "{}"))
        credential_count = len(registry) if isinstance(registry, dict) else 0
    except json.JSONDecodeError:
        credential_count = 0
    skipped = sorted(getattr(request.app.state, "router_load_report", {}).get("safeModeSkipped", []))
    green = safe_mode and strict_scope and write_auth == "token_required" and credential_count > 0
    return {
        "status": "green" if green else "red",
        "safeMode": safe_mode,
        "strictPrincipalScope": strict_scope,
        "writeAuthorization": write_auth,
        "credentialCount": credential_count,
        "safeModeSkippedRouters": skipped,
        "secretValuesExposed": False,
    }


@router.get("/attestation")
async def system_attestation(request: Request) -> Dict[str, Any]:
    _require_admin(request)
    try:
        capacity = knowledge_service.graph.storage.quota_status()
    except Exception as exc:
        capacity = {"status": "red", "reason": f"capacity probe failed: {type(exc).__name__}"}
    layers = {
        "runtime": {
            "status": "green",
            "routerLoadFailures": len(getattr(request.app.state, "router_load_report", {}).get("failed", [])),
        },
        "capacity": capacity,
        "sourceIntegrity": _release_layer(),
        "security": _security_layer(request),
        "provider": _provider_layer(),
        "evidenceFreshness": _receipt_layer("CORTEX_AIOS_ATTESTATION_PATH", maximum_age_seconds=900),
        "canaries": _receipt_layer("CORTEX_CANARY_RECEIPT_PATH", maximum_age_seconds=900),
        "rollbackReadiness": _receipt_layer("CORTEX_ROLLBACK_RECEIPT_PATH"),
        "remotePersistence": _receipt_layer("CORTEX_REMOTE_PERSISTENCE_RECEIPT_PATH"),
    }
    runtime_required = ("runtime", "capacity", "sourceIntegrity", "security", "provider")
    evidence_required = ("evidenceFreshness", "canaries", "rollbackReadiness", "remotePersistence")
    functional_green = all(layers[name].get("status") == "green" for name in runtime_required)
    evidence_green = all(layers[name].get("status") == "green" for name in evidence_required)
    return {
        "schemaVersion": "cortex.system-attestation.v1",
        "status": "green" if functional_green and evidence_green else "degraded",
        "functionalStatus": "green" if functional_green else "red",
        "attestationStatus": "green" if evidence_green else "degraded",
        "layers": layers,
        "generatedAt": _iso(_now()),
        "truthBoundary": "Functional runtime and evidence freshness are independent. An expired receipt never becomes a runtime outage, and runtime health never substitutes for current attestation evidence.",
    }
