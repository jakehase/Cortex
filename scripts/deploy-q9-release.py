#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
import shlex
import shutil
import sqlite3
import stat
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath

LOCK_PATH = Path("/run/cortex-q9-deploy.lock")
LIVE_ENV = Path("/etc/cortex/cortex.env")
LIVE_ORACLE_HELPER_ENV = Path("/etc/cortex/oracle-helper.env")
LIVE_OPENCLAW_CONFIG = Path("/root/.openclaw/openclaw.json")
OPENCLAW_RUNTIME_STATE = Path("/opt/openclaw-preastra-restore/2026.7.1-2/state")
OPENCLAW_MAIN_AGENT_DIR = OPENCLAW_RUNTIME_STATE / "agents/main/agent"
OPENCLAW_MAIN_AGENT_STORE = OPENCLAW_MAIN_AGENT_DIR / "openclaw-agent.sqlite"
LIVE_UNITS = {
    "cortex.service": Path("/etc/systemd/system/cortex.service"),
    "cortex-oracle-executor.service": Path("/etc/systemd/system/cortex-oracle-executor.service"),
    "cortex-health-watchdog.service": Path("/etc/systemd/system/cortex-health-watchdog.service"),
    "cortex-health-watchdog.timer": Path("/etc/systemd/system/cortex-health-watchdog.timer"),
    "cortex-owner-memory-index.service": Path("/etc/systemd/system/cortex-owner-memory-index.service"),
    "cortex-owner-memory-index.timer": Path("/etc/systemd/system/cortex-owner-memory-index.timer"),
    "cortex-ollama-tunnel.service": Path("/etc/systemd/system/cortex-ollama-tunnel.service"),
}
MANAGED_STOP_ORDER = (
    "cortex-owner-memory-index.timer",
    "cortex-owner-memory-index.service",
    "cortex-health-watchdog.timer",
    "cortex-health-watchdog.service",
    "cortex.service",
    "cortex-oracle-executor.service",
    "cortex-ollama-tunnel.service",
)
MANAGED_START_ORDER = (
    "cortex-ollama-tunnel.service",
    "cortex-oracle-executor.service",
    "cortex.service",
    "cortex-health-watchdog.timer",
    "cortex-owner-memory-index.timer",
)
CURRENT_POINTER = Path("/opt/cortex/current")
RELEASES_ROOT = Path("/opt/cortex/releases")
ATTESTATIONS_ROOT = Path("/var/lib/cortex/attestations")
RELEASE_SCHEMA = "cortex.release-envelope.v2"
GATEWAY_PREFLIGHT_SCHEMA = "cortex.gateway-code-manifest-preflight.v1"
SURFACE_EVIDENCE_SCHEMA = "cortex.repair-surface-evidence.v1"
TERMINAL_STATE_SCHEMA = "cortex.detached-job-terminal.v2"
TERMINAL_STATE_PRODUCER = "cortex.release-supervisor.v1"


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


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


def atomic_json(path: Path, payload: dict, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, mode)
    os.replace(temporary, path)
    fsync_dir(path.parent)


def fsync_dir(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def run(command: list[str], *, timeout: int = 180, cwd: Path | None = None, env=None, output: Path | None = None):
    result = subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True, timeout=timeout, check=False)
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode != 0:
        tail = (result.stdout + result.stderr)[-2000:]
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(command)}; tail={tail}")
    return result


def stop_managed_units() -> None:
    for name in MANAGED_STOP_ORDER:
        subprocess.run(["systemctl", "stop", name], check=False, timeout=120)
        if subprocess.run(
            ["systemctl", "is-active", "--quiet", name], check=False, timeout=15
        ).returncode == 0:
            raise RuntimeError(f"managed unit did not stop: {name}")


def load_json(path: Path, *, label: str) -> dict:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"{label} is not a regular non-symlink file")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid {label}: {type(exc).__name__}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"{label} must be a JSON object")
    return payload


def require_release_identity(payload: dict, contract: dict, *, label: str) -> None:
    expected = {
        "releaseId": contract["releaseId"],
        "sourceCommit": contract["sourceCommit"],
        "sourceTree": contract["sourceTree"],
    }
    mismatches = [key for key, value in expected.items() if payload.get(key) != value]
    if mismatches:
        raise RuntimeError(f"{label} release identity mismatch: {', '.join(mismatches)}")


def validate_release_envelope(envelope: dict, contract: dict) -> dict:
    if envelope.get("schemaVersion") != RELEASE_SCHEMA:
        raise RuntimeError("unsupported release envelope schema")
    if canonical_digest(envelope) != envelope.get("envelopeSha256"):
        raise RuntimeError("release envelope digest mismatch")
    require_release_identity(envelope, contract, label="release envelope")
    source_identity = envelope.get("sourceIdentity")
    if (
        not isinstance(source_identity, dict)
        or source_identity.get("clean") is not True
        or source_identity.get("indexTree") != envelope.get("sourceTree")
    ):
        raise RuntimeError("release envelope does not bind a clean exact source tree")
    qualification_receipts(envelope)
    return envelope


def qualification_receipts(envelope: dict) -> dict[str, dict]:
    rows = envelope.get("qualificationReceipts")
    if not isinstance(rows, list):
        raise RuntimeError("release envelope has no qualification receipts")
    indexed = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("kind"), str) or not isinstance(row.get("payload"), dict):
            raise RuntimeError("release envelope has an invalid qualification receipt")
        if row["kind"] in indexed:
            raise RuntimeError("release envelope has duplicate qualification receipt kinds")
        payload = row["payload"]
        payload_digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        if row.get("payloadSha256") != payload_digest:
            raise RuntimeError("release envelope qualification payload digest mismatch")
        receipt_digest = str(row.get("receiptSha256") or "")
        if len(receipt_digest) != 64 or any(character not in "0123456789abcdef" for character in receipt_digest):
            raise RuntimeError("release envelope qualification receipt digest is invalid")
        if (
            payload.get("schemaVersion") != "cortex.qualification-receipt.v1"
            or payload.get("kind") != row["kind"]
            or payload.get("outcome") != "green"
            or payload.get("sourceCommit") != envelope.get("sourceCommit")
            or payload.get("sourceTree") != envelope.get("sourceTree")
            or type(payload.get("exitCode")) is not int
            or payload.get("exitCode") != 0
        ):
            raise RuntimeError("release envelope qualification receipt is not exact-candidate green")
        replay = payload.get("replayCommand")
        artifacts = payload.get("artifacts")
        if not isinstance(replay, list) or not replay or not all(
            isinstance(value, str) and value for value in replay
        ):
            raise RuntimeError("release envelope qualification receipt has no replay argv")
        if not all(
            isinstance(payload.get(field), str) and payload.get(field)
            for field in ("startedAt", "completedAt")
        ):
            raise RuntimeError("release envelope qualification receipt has no bounded timestamps")
        if not isinstance(artifacts, list) or not artifacts:
            raise RuntimeError("release envelope qualification receipt has no hashed artifacts")
        for artifact in artifacts:
            digest = str(artifact.get("sha256") or "") if isinstance(artifact, dict) else ""
            relative = PurePosixPath(str(artifact.get("path") or "")) if isinstance(artifact, dict) else PurePosixPath()
            if (
                not isinstance(artifact, dict)
                or relative.is_absolute()
                or ".." in relative.parts
                or not relative.parts
                or len(digest) != 64
                or any(character not in "0123456789abcdef" for character in digest)
            ):
                raise RuntimeError("release envelope qualification receipt has invalid artifact identity")
        if row["kind"] == "focused-gates" and not isinstance(payload.get("surfaceIds"), list):
            raise RuntimeError("focused qualification receipt has no surface coverage")
        indexed[row["kind"]] = row
    if set(indexed) != {"full-suite", "focused-gates"}:
        raise RuntimeError("release envelope is missing required qualification receipt kinds")
    return indexed


def validate_gateway_preflight(contract: dict, envelope: dict) -> dict:
    value = contract.get("gatewayCodeManifestReceipt")
    if not isinstance(value, str) or not value:
        raise RuntimeError("deployment contract requires gatewayCodeManifestReceipt")
    receipt = load_json(Path(value).resolve(strict=True), label="gateway code-manifest preflight receipt")
    if receipt.get("schemaVersion") != GATEWAY_PREFLIGHT_SCHEMA or receipt.get("outcome") != "green":
        raise RuntimeError("gateway code-manifest preflight receipt is not green")
    require_release_identity(receipt, contract, label="gateway code-manifest preflight receipt")
    if receipt.get("releaseEnvelopeSha256") != envelope.get("envelopeSha256"):
        raise RuntimeError("gateway code-manifest preflight is not bound to the release envelope")
    if receipt.get("manifestMatched") is not True or int(receipt.get("inaccessiblePathCount", -1)) != 0:
        raise RuntimeError("gateway code-manifest preflight did not match every accessible path")
    manifest_hash = str(receipt.get("codeManifestSha256") or "")
    if len(manifest_hash) != 64 or any(character not in "0123456789abcdef" for character in manifest_hash):
        raise RuntimeError("gateway code-manifest preflight has no valid manifest digest")
    return receipt


def load_env(path: Path) -> dict[str, str]:
    values = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise RuntimeError("invalid environment assignment")
        key, value = line.split("=", 1)
        parsed = shlex.split(value, posix=True)
        values[key.strip()] = "" if not parsed else parsed[0]
    return values


def validate_oracle_helper_environment(
    path: Path = LIVE_ORACLE_HELPER_ENV,
    *,
    expected_uid: int = 0,
    expected_gid: int = 0,
) -> dict[str, str]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("Oracle helper environment is not a regular non-symlink file")
    info = path.stat()
    if (
        stat.S_IMODE(info.st_mode) != 0o600
        or info.st_uid != expected_uid
        or info.st_gid != expected_gid
    ):
        raise RuntimeError("Oracle helper environment must have the approved owner and mode 0600")
    values = load_env(path)
    unexpected = sorted(set(values) - {"ORACLE_BRIDGE_TOKEN"})
    if unexpected:
        raise RuntimeError(
            "Oracle helper environment must contain only ORACLE_BRIDGE_TOKEN; "
            f"unexpected keys: {', '.join(unexpected)}"
        )
    token = values.get("ORACLE_BRIDGE_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("Oracle helper environment requires a protected 32+ character token")
    return values


def validate_oracle_openclaw_auth(*, expected_uid: int = 0, expected_gid: int = 0) -> dict:
    """Prove the exact profile mounted into the helper can resolve approved OAuth.

    The command output is parsed in memory and never copied into deployment
    logs because model status includes account labels. The returned receipt is
    deliberately metadata-only.
    """
    if OPENCLAW_MAIN_AGENT_DIR.is_symlink() or not OPENCLAW_MAIN_AGENT_DIR.is_dir():
        raise RuntimeError("Oracle helper OAuth source is not a regular directory")
    directory_info = OPENCLAW_MAIN_AGENT_DIR.stat()
    if (
        directory_info.st_uid != expected_uid
        or directory_info.st_gid != expected_gid
        or stat.S_IMODE(directory_info.st_mode) & 0o077
    ):
        raise RuntimeError("Oracle helper OAuth source has unsafe owner or group/other access")
    if OPENCLAW_MAIN_AGENT_STORE.is_symlink() or not OPENCLAW_MAIN_AGENT_STORE.is_file():
        raise RuntimeError("Oracle helper OAuth store is not a regular file")
    store_info = OPENCLAW_MAIN_AGENT_STORE.stat()
    if (
        store_info.st_uid != expected_uid
        or store_info.st_gid != expected_gid
        or stat.S_IMODE(store_info.st_mode) != 0o600
    ):
        raise RuntimeError("Oracle helper OAuth store has unsafe owner or mode")

    environment = {
        **os.environ,
        "HOME": "/root",
        "OPENCLAW_STATE_DIR": str(OPENCLAW_RUNTIME_STATE),
        "OPENCLAW_CONFIG_PATH": str(LIVE_OPENCLAW_CONFIG),
    }
    result = subprocess.run(
        ["/usr/bin/openclaw", "models", "status", "--agent", "oracle", "--json"],
        env=environment,
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    raw = (result.stdout or "").encode("utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(
            "Oracle helper OAuth status failed; "
            f"returncode={result.returncode}; output_sha256={hashlib.sha256(raw).hexdigest()}"
        )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Oracle helper OAuth status was not JSON; output_sha256={hashlib.sha256(raw).hexdigest()}"
        ) from exc
    auth = payload.get("auth") if isinstance(payload, dict) else None
    providers = auth.get("providers") if isinstance(auth, dict) else None
    openai = next(
        (row for row in providers or [] if isinstance(row, dict) and row.get("provider") == "openai"),
        None,
    )
    effective = openai.get("effective") if isinstance(openai, dict) else None
    profiles = openai.get("profiles") if isinstance(openai, dict) else None
    oauth = auth.get("oauth") if isinstance(auth, dict) else None
    oauth_providers = oauth.get("providers") if isinstance(oauth, dict) else None
    oauth_openai = next(
        (row for row in oauth_providers or [] if isinstance(row, dict) and row.get("provider") == "openai"),
        None,
    )
    if (
        not isinstance(effective, dict)
        or effective.get("kind") != "profiles"
        or effective.get("detail") != str(OPENCLAW_MAIN_AGENT_STORE)
        or not isinstance(profiles, dict)
        or int(profiles.get("oauth") or 0) < 1
        or not isinstance(oauth_openai, dict)
        or oauth_openai.get("status") != "ok"
    ):
        raise RuntimeError("Oracle helper could not resolve approved OpenAI OAuth from the mounted profile")
    return {
        "schemaVersion": "cortex.oracle-auth-preflight.v1",
        "outcome": "green",
        "observedAt": now(),
        "agentId": "oracle",
        "provider": "openai",
        "authType": "oauth",
        "status": "ok",
        "profileCount": int(profiles.get("oauth") or 0),
        "stateDir": str(OPENCLAW_RUNTIME_STATE),
        "authStorePath": str(OPENCLAW_MAIN_AGENT_STORE),
    }


def install_file(source: Path, target: Path, *, mode: int, uid: int = 0, gid: int = 0) -> None:
    if source.is_symlink() or not source.is_file():
        raise RuntimeError(f"unsafe install source: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    with source.open("rb") as reader, temporary.open("xb") as writer:
        shutil.copyfileobj(reader, writer, length=1024 * 1024)
        writer.flush()
        os.fsync(writer.fileno())
    os.chmod(temporary, mode)
    os.chown(temporary, uid, gid)
    os.replace(temporary, target)
    fsync_dir(target.parent)


def set_state(root: Path, status: str, phase: str, blocker: str | None = None, **extra) -> None:
    atomic_json(
        root / "state.json",
        {
            "schemaVersion": "cortex.q9.deployment-state.v1",
            "status": status,
            "phase": phase,
            "blocker": blocker,
            "truthBoundary": "This state covers q9 extraction, activation, runtime verification and rollback only. Remote persistence and final contradiction remain separate gates.",
            "updatedAt": now(),
            **extra,
        },
    )


def safe_extract(archive: Path, destination: Path, release_id: str) -> Path:
    destination.mkdir(parents=True, exist_ok=False)
    with tarfile.open(archive, "r:gz") as handle:
        members = handle.getmembers()
        for member in members:
            pure = PurePosixPath(member.name)
            if pure.is_absolute() or ".." in pure.parts or not pure.parts or pure.parts[0] != release_id:
                raise RuntimeError(f"unsafe archive member: {member.name}")
            if member.issym() or member.islnk() or member.isdev() or member.isfifo():
                raise RuntimeError(f"unsupported archive member: {member.name}")
        handle.extractall(destination)
    release = destination / release_id
    if not release.is_dir() or release.is_symlink():
        raise RuntimeError("archive did not produce the expected release root")
    return release


def request_json(path: str, *, headers=None, timeout=20, expected=200):
    request = urllib.request.Request(f"http://127.0.0.1:8000{path}", headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = response.status
            raw = response.read(4 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read(4 * 1024 * 1024 + 1)
    if status != expected or len(raw) > 4 * 1024 * 1024:
        raise RuntimeError(f"GET {path} returned HTTP {status}")
    return json.loads(raw.decode()) if raw else {}


def wait_runtime(environment: dict[str, str], timeout_seconds: int = 120) -> tuple[dict, dict]:
    deadline = time.monotonic() + timeout_seconds
    last = None
    while time.monotonic() < deadline:
        try:
            health = request_json("/health", timeout=5)
            ready = request_json("/ready", timeout=5)
            if health.get("readiness") is True and ready.get("ready") is True:
                return health, ready
            last = {"health": health, "ready": ready}
        except Exception as exc:
            last = f"{type(exc).__name__}: {exc}"
        time.sleep(2)
    raise RuntimeError(f"Cortex did not become ready: {last}")


def wait_oracle_helper(timeout_seconds: int = 60) -> dict:
    token = validate_oracle_helper_environment()["ORACLE_BRIDGE_TOKEN"]
    deadline = time.monotonic() + timeout_seconds
    last = "not attempted"
    while time.monotonic() < deadline:
        request = urllib.request.Request(
            "http://127.0.0.1:18999/health",
            headers={"X-Bridge-Token": token},
        )
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                raw = response.read(256 * 1024 + 1)
            if len(raw) > 256 * 1024:
                raise RuntimeError("Oracle helper health response is too large")
            payload = json.loads(raw.decode("utf-8"))
            if (
                payload.get("ok") is True
                and payload.get("modelPolicy") == "gpt-5.6-sol"
                and payload.get("thinking") == "xhigh"
                and payload.get("authPolicy") == "pmhnp_oauth_approved_2026-09-25"
                and payload.get("serviceTierPolicy") == "provider_default_no_override"
                and payload.get("requestAuthentication") == "required"
                and payload.get("localExecution") is True
                and payload.get("resetAgentSession") is False
                and payload.get("sessionMode") == "ephemeral"
                and payload.get("openclawStatePolicy") == "service_owned_with_mounted_main_oauth"
            ):
                return payload
            last = "policy mismatch"
        except Exception as exc:
            last = type(exc).__name__
        time.sleep(1)
    raise RuntimeError(f"Oracle helper did not become ready: {last}")


def gateway_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(
        {
            "HOME": "/root",
            "XDG_RUNTIME_DIR": "/run/user/0",
            "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/0/bus",
        }
    )
    return environment


def restart_gateway(timeout_seconds: int = 120) -> None:
    environment = gateway_environment()
    run(["/usr/bin/openclaw", "config", "validate"], env=environment, timeout=60)
    # The release transaction can replace gateway unit/drop-in files after the
    # outer deployment preflight has already reloaded systemd. Reload the user
    # manager at the point of activation so the following restart always uses
    # the files that are currently on disk. A reload failure is fatal and is
    # handled by the caller's existing rollback path.
    run(["systemctl", "--user", "daemon-reload"], env=environment, timeout=30)
    run(["/usr/bin/openclaw", "gateway", "restart"], env=environment, timeout=90)
    deadline = time.monotonic() + timeout_seconds
    last = "not attempted"
    while time.monotonic() < deadline:
        result = subprocess.run(
            ["/usr/bin/openclaw", "gateway", "status"],
            env=environment,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )
        last = result.stdout + result.stderr
        if result.returncode == 0 and "Connectivity probe: ok" in last:
            return
        time.sleep(2)
    raise RuntimeError(f"OpenClaw gateway did not recover: {last[-1000:]}")


def validate_pending_environment(environment: dict[str, str], release_root: Path) -> None:
    required = [
        "CORTEX_WRITE_TOKEN", "CORTEX_ADMIN_TOKEN", "CORTEX_MEMORY_SCOPE_CREDENTIALS",
        "CORTEX_DB_PATH", "CORTEX_CHROMA_DIR", "CORTEX_RELEASE_ROOT",
        "CORTEX_RELEASE_ID",
        "CORTEX_RELEASE_ENVELOPE_PATH", "CORTEX_AIOS_ATTESTATION_PATH",
        "CORTEX_CANARY_RECEIPT_PATH", "CORTEX_ROLLBACK_RECEIPT_PATH",
        "CORTEX_REMOTE_PERSISTENCE_RECEIPT_PATH", "ORACLE_OLLAMA_ENABLED", "ORACLE_OLLAMA_URL",
    ]
    missing = [key for key in required if not environment.get(key)]
    if missing:
        raise RuntimeError(f"pending environment is missing: {', '.join(missing)}")
    if environment.get("CORTEX_ENV") != "production":
        raise RuntimeError("q9 requires CORTEX_ENV=production")
    if environment.get("CORTEX_SAFE_MODE", "").lower() not in {"1", "true"}:
        raise RuntimeError("q9 safe mode must remain enabled")
    if environment.get("CORTEX_WRITE_AUTH_MODE") != "token_required":
        raise RuntimeError("q9 write authorization must remain token_required")
    if environment.get("CORTEX_RELEASE_ROOT") != str(release_root):
        raise RuntimeError("pending environment release root mismatch")
    if environment.get("CORTEX_RELEASE_ID") != release_root.name:
        raise RuntimeError("pending environment release id mismatch")
    if environment.get("CORTEX_CHROMA_DIR") != "/var/lib/cortex/chroma":
        raise RuntimeError("q9 Chroma must live outside release source")
    if environment.get("CORTEX_DB_PATH") != "/var/lib/cortex/knowledge/cortex_graph.db":
        raise RuntimeError("q9 graph database must use the service-owned state root")
    if environment.get("CORTEX_L22_STRUCTURED_DB") != "/var/lib/cortex/state/l22-structured.db":
        raise RuntimeError("q9 L22 database must use the service-owned state root")
    if environment.get("ORACLE_OLLAMA_URL") != "http://127.0.0.1:11434":
        raise RuntimeError("q9 provider must use approved loopback endpoint")
    if "ORACLE_BRIDGE_TOKEN" in environment:
        raise RuntimeError("Oracle helper token must not be stored in the general Cortex environment")
    validate_oracle_helper_environment()


def capture_file(path: Path, backup: Path) -> dict:
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file():
            raise RuntimeError(f"unsafe preimage path: {path}")
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, backup)
        info = path.stat()
        return {"path": str(path), "existed": True, "sha256": sha256(path), "mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid, "backup": str(backup)}
    return {"path": str(path), "existed": False, "sha256": None, "mode": None, "uid": None, "gid": None, "backup": None}


def build_preimage(artifact_root: Path, contract: dict) -> dict:
    preimage = artifact_root / "preimage"
    preimage.mkdir(parents=True, exist_ok=False)
    files = []
    for name, path in {"cortex.env": LIVE_ENV, "openclaw.json": LIVE_OPENCLAW_CONFIG, **LIVE_UNITS}.items():
        safe = name.replace("/", "_")
        files.append(capture_file(path, preimage / "files" / safe))
    current_target = os.readlink(CURRENT_POINTER) if CURRENT_POINTER.is_symlink() else None
    graph_receipt = json.loads(Path(contract["graphBackupReceipt"]).read_text(encoding="utf-8"))
    if graph_receipt.get("outcome") != "green" or graph_receipt.get("remoteDigestMatch") is not True:
        raise RuntimeError("graph backup receipt is not green")
    backup = Path(graph_receipt["localBackup"]).resolve(strict=True)
    if sha256(backup) != graph_receipt.get("localBackupSha256"):
        raise RuntimeError("graph backup digest mismatch")
    active_database = Path(graph_receipt["sourcePath"]).resolve(strict=True)
    with sqlite3.connect(f"file:{active_database}?mode=ro", uri=True, timeout=30) as connection:
        observed_counts = {
            "nodes": int(connection.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]),
            "edges": int(connection.execute("SELECT COUNT(*) FROM edges").fetchone()[0]),
            "quotaLedgerRows": int(connection.execute("SELECT COUNT(*) FROM graph_quota_ledger").fetchone()[0]),
        }
    expected_counts = {
        "nodes": int(graph_receipt.get("nodes", -1)),
        "edges": int(graph_receipt.get("edges", -1)),
        "quotaLedgerRows": int(graph_receipt.get("quotaLedgerRows", -1)),
    }
    if observed_counts != expected_counts:
        raise RuntimeError("live graph changed after the approved backup; take a new backup")
    unit_states = {
        name: {
            "active": subprocess.run(
                ["systemctl", "is-active", "--quiet", name], check=False
            ).returncode == 0,
            "enabled": subprocess.run(
                ["systemctl", "is-enabled", "--quiet", name], check=False
            ).returncode == 0,
        }
        for name in LIVE_UNITS
    }
    manifest = {
        "schemaVersion": "cortex.q9.deployment-preimage.v1",
        "files": files,
        "currentPointerExisted": CURRENT_POINTER.is_symlink(),
        "currentPointerTarget": current_target,
        "cortexWasActive": subprocess.run(["systemctl", "is-active", "--quiet", "cortex.service"]).returncode == 0,
        "watchdogTimerWasActive": subprocess.run(["systemctl", "is-active", "--quiet", "cortex-health-watchdog.timer"]).returncode == 0,
        "unitStates": unit_states,
        "graphBackupReceipt": contract["graphBackupReceipt"],
        "graphDatabaseSha256": graph_receipt.get("localBackupSha256"),
        "createdAt": now(),
    }
    atomic_json(artifact_root / "preimage.json", manifest)
    return manifest


def prepare_release(contract: dict, artifact_root: Path) -> tuple[Path, dict, dict]:
    release_id = contract["releaseId"]
    archive = Path(contract["archive"]).resolve(strict=True)
    envelope_path = Path(contract["envelope"]).resolve(strict=True)
    if sha256(archive) != contract["archiveSha256"]:
        raise RuntimeError("q9 archive digest mismatch")
    envelope = load_json(envelope_path, label="release envelope")
    validate_release_envelope(envelope, contract)
    validate_gateway_preflight(contract, envelope)
    release = RELEASES_ROOT / release_id
    verification_path = artifact_root / "release-verification.json"
    if not release.exists():
        staging_parent = RELEASES_ROOT / f".{release_id}.staging-{os.getpid()}"
        extracted = safe_extract(archive, staging_parent, release_id)
        run(
            [sys.executable, str(extracted / "scripts/verify-release-envelope.py"), "--root", str(extracted), "--envelope", str(envelope_path), "--output", str(verification_path)],
            timeout=300,
            output=artifact_root / "release-verification.log",
        )
        RELEASES_ROOT.mkdir(parents=True, exist_ok=True)
        os.rename(extracted, release)
        staging_parent.rmdir()
        fsync_dir(RELEASES_ROOT)
    else:
        run(
            [sys.executable, str(release / "scripts/verify-release-envelope.py"), "--root", str(release), "--envelope", str(envelope_path), "--output", str(verification_path)],
            timeout=300,
            output=artifact_root / "release-verification.log",
        )
    pending_environment = load_env(Path(contract["pendingEnvironment"]))
    validate_pending_environment(pending_environment, release)
    return release, envelope, pending_environment


def install_units(contract: dict, release: Path) -> None:
    sources = {
        "cortex.service": release / "ops/systemd/cortex.service",
        "cortex-oracle-executor.service": release / "ops/systemd/cortex-oracle-executor.service",
        "cortex-health-watchdog.service": release / "ops/systemd/cortex-health-watchdog.service",
        "cortex-health-watchdog.timer": release / "ops/systemd/cortex-health-watchdog.timer",
        "cortex-owner-memory-index.service": release / "ops/systemd/cortex-owner-memory-index.service",
        "cortex-owner-memory-index.timer": release / "ops/systemd/cortex-owner-memory-index.timer",
        "cortex-ollama-tunnel.service": Path(contract["renderedTunnelUnit"]),
    }
    for name, target in LIVE_UNITS.items():
        install_file(sources[name], target, mode=0o644)


def restore_preimage(artifact_root: Path, contract: dict) -> None:
    manifest = json.loads((artifact_root / "preimage.json").read_text(encoding="utf-8"))
    stop_managed_units()
    receipt = json.loads(Path(manifest["graphBackupReceipt"]).read_text(encoding="utf-8"))
    backup = Path(receipt["localBackup"]).resolve(strict=True)
    if sha256(backup) != receipt["localBackupSha256"]:
        raise RuntimeError("graph rollback backup digest mismatch")
    install_file(backup, Path(receipt["sourcePath"]), mode=0o600)
    for row in manifest["files"]:
        path = Path(row["path"])
        if row["existed"]:
            install_file(Path(row["backup"]), path, mode=int(row["mode"]), uid=int(row["uid"]), gid=int(row["gid"]))
        elif path.exists() or path.is_symlink():
            if path.is_symlink() or path.is_file():
                path.unlink()
            else:
                raise RuntimeError(f"unsafe rollback target: {path}")
    if CURRENT_POINTER.exists() or CURRENT_POINTER.is_symlink():
        CURRENT_POINTER.unlink()
    if manifest["currentPointerExisted"]:
        CURRENT_POINTER.symlink_to(manifest["currentPointerTarget"])
    run(["systemctl", "daemon-reload"], timeout=30)
    unit_states = manifest.get("unitStates") or {
        "cortex.service": {"active": bool(manifest.get("cortexWasActive")), "enabled": True},
        "cortex-health-watchdog.timer": {
            "active": bool(manifest.get("watchdogTimerWasActive")),
            "enabled": bool(manifest.get("watchdogTimerWasActive")),
        },
    }
    for name in LIVE_UNITS:
        action = "enable" if (unit_states.get(name) or {}).get("enabled") else "disable"
        subprocess.run(["systemctl", action, name], check=False, timeout=45)
    for name in MANAGED_START_ORDER:
        if (unit_states.get(name) or {}).get("active"):
            run(["systemctl", "start", name], timeout=120)
            if name == "cortex.service":
                wait_runtime(load_env(LIVE_ENV), 120)
    restart_gateway()
    atomic_json(
        artifact_root / "rollback.json",
        {
            "schemaVersion": "cortex.q9.rollback.v1",
            "outcome": "green",
            "releaseId": contract["releaseId"],
            "sourceCommit": contract["sourceCommit"],
            "sourceTree": contract["sourceTree"],
            "releaseEnvelopeSha256": load_json(Path(contract["envelope"]), label="release envelope")["envelopeSha256"],
            "graphRestored": sha256(Path(receipt["sourcePath"])) == receipt["localBackupSha256"],
            "environmentRestored": next(row for row in manifest["files"] if row["path"] == str(LIVE_ENV))["sha256"] == sha256(LIVE_ENV),
            "priorRuntimeHealthy": True,
            "restoredReleaseRoot": manifest["currentPointerTarget"],
            "completedAt": now(),
            "truthBoundary": "Green proves restoration of the captured preimage and prior runtime health. The exact candidate is not accepted until a separately verified redeploy and remote accepted ref both match it.",
        },
    )


def activate(contract: dict, artifact_root: Path, *, redeploy: bool = False) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("q9 activation requires root")
    release, envelope, environment = prepare_release(contract, artifact_root)
    oracle_auth_preflight = validate_oracle_openclaw_auth()
    atomic_json(artifact_root / "oracle-auth-preflight.json", oracle_auth_preflight, mode=0o600)
    if not (artifact_root / "preimage.json").exists():
        build_preimage(artifact_root, contract)
    set_state(artifact_root, "running", "activate_q9")
    try:
        ATTESTATIONS_ROOT.mkdir(parents=True, exist_ok=True)
        os.chmod(ATTESTATIONS_ROOT, 0o700)
        install_file(Path(contract["envelope"]), Path(environment["CORTEX_RELEASE_ENVELOPE_PATH"]), mode=0o644)
        chroma_destination = Path(environment["CORTEX_CHROMA_DIR"])
        if not chroma_destination.exists():
            source = Path(contract["chromaSource"]).resolve(strict=True)
            if source.is_symlink() or not source.is_dir():
                raise RuntimeError("unsafe Chroma source")
            temporary = chroma_destination.with_name(f".{chroma_destination.name}.staging-{os.getpid()}")
            shutil.copytree(source, temporary, symlinks=False)
            os.rename(temporary, chroma_destination)
            fsync_dir(chroma_destination.parent)
        stop_managed_units()
        run(
            [sys.executable, str(release / "scripts/migrate-graph-quota.py"), "--database", environment["CORTEX_DB_PATH"], "--backup-receipt", contract["graphBackupReceipt"], "--output", str(artifact_root / "graph-migration.json")],
            cwd=release,
            env={
                **os.environ,
                "PYTHONPATH": str(release / "public/cortex_server"),
                "PYTHONDONTWRITEBYTECODE": "1",
            },
            timeout=600,
            output=artifact_root / "graph-migration.log",
        )
        install_file(Path(contract["pendingEnvironment"]), LIVE_ENV, mode=0o600)
        install_file(Path(contract["pendingOpenclawConfig"]), LIVE_OPENCLAW_CONFIG, mode=0o600)
        install_units(contract, release)
        temporary_pointer = CURRENT_POINTER.with_name(f".{CURRENT_POINTER.name}.{os.getpid()}.tmp")
        if temporary_pointer.exists() or temporary_pointer.is_symlink():
            temporary_pointer.unlink()
        temporary_pointer.symlink_to(release)
        os.replace(temporary_pointer, CURRENT_POINTER)
        fsync_dir(CURRENT_POINTER.parent)
        run(["systemctl", "daemon-reload"], timeout=30)
        run(["systemctl", "enable", "cortex-ollama-tunnel.service"], timeout=30)
        run(["systemctl", "restart", "cortex-ollama-tunnel.service"], timeout=60)
        run(["systemctl", "enable", "cortex-oracle-executor.service"], timeout=30)
        run(["systemctl", "start", "cortex-oracle-executor.service"], timeout=120)
        wait_oracle_helper(60)
        run(["systemctl", "enable", "cortex.service"], timeout=30)
        run(["systemctl", "start", "cortex.service"], timeout=120)
        wait_runtime(environment, 120)
        with sqlite3.connect(f"file:{environment['CORTEX_DB_PATH']}?mode=ro", uri=True, timeout=30) as diagnostic_connection:
            quota_scope_rows = diagnostic_connection.execute(
                """
                SELECT tenant_id, storage_workspace_id, COUNT(*)
                FROM graph_quota_ledger
                GROUP BY tenant_id, storage_workspace_id
                ORDER BY COUNT(*) DESC
                LIMIT 20
                """
            ).fetchall()
        atomic_json(
            artifact_root / "quota-pre-canary.json",
            {
                "schemaVersion": "cortex.q9.quota-pre-canary.v1",
                "rows": [
                    {"tenantId": row[0], "storageWorkspaceId": row[1], "rows": int(row[2])}
                    for row in quota_scope_rows
                ],
                "capturedAt": now(),
            },
        )
        restart_gateway()
        run(
            [sys.executable, str(release / "scripts/run-q9-canary.py"), "--env-file", str(LIVE_ENV), "--output", environment["CORTEX_CANARY_RECEIPT_PATH"]],
            cwd=release,
            timeout=600,
            output=artifact_root / "live-canary.log",
        )
        attestation = request_json(
            "/system/attestation",
            headers={"X-Cortex-Admin-Token": environment["CORTEX_ADMIN_TOKEN"]},
            timeout=120,
        )
        if attestation.get("functionalStatus") != "green":
            raise RuntimeError(f"q9 functional attestation is not green: {attestation}")
        run(["systemctl", "enable", "--now", "cortex-health-watchdog.timer"], timeout=60)
        run(["systemctl", "enable", "--now", "cortex-owner-memory-index.timer"], timeout=60)
        deployed_verification = artifact_root / ("redeployed-release-verification.json" if redeploy else "deployed-release-verification.json")
        run(
            [sys.executable, str(release / "scripts/verify-release-envelope.py"), "--root", str(release), "--envelope", str(Path(contract["envelope"]).resolve(strict=True)), "--output", str(deployed_verification)],
            timeout=300,
            output=artifact_root / ("redeployed-release-verification.log" if redeploy else "deployed-release-verification.log"),
        )
        if CURRENT_POINTER.resolve(strict=True) != release.resolve(strict=True):
            raise RuntimeError("current release pointer does not resolve to the exact candidate")
        result = {
            "schemaVersion": "cortex.q9.redeploy.v1" if redeploy else "cortex.q9.deployment.v2",
            "outcome": "green",
            "releaseId": contract["releaseId"],
            "sourceCommit": contract["sourceCommit"],
            "sourceTree": contract["sourceTree"],
            "releaseEnvelopeSha256": envelope["envelopeSha256"],
            "releaseVerificationPath": str(deployed_verification),
            "releaseVerificationSha256": sha256(deployed_verification),
            "deployedRoot": str(release),
            "currentPointerTarget": str(CURRENT_POINTER.resolve(strict=True)),
            "functionalStatus": attestation["functionalStatus"],
            "attestationStatus": attestation["attestationStatus"],
            "overallStatus": attestation["status"],
            "graphMigration": "green",
            "liveCanary": "green",
            "completedAt": now(),
            "truthBoundary": "Green proves exact immutable release hashes and functional runtime for this activation. Final acceptance still requires the matrix supervisor, rollback/redeploy pair, and authoritative remote accepted ref.",
        }
        atomic_json(artifact_root / ("redeploy.json" if redeploy else "deployment.json"), result)
        set_state(artifact_root, "running", "q9_redeploy_green" if redeploy else "q9_functional_green", releaseId=contract["releaseId"])
    except BaseException as exc:
        try:
            restore_preimage(artifact_root, contract)
            set_state(artifact_root, "blocked", "rolled_back", f"{type(exc).__name__}: {exc}", rollback="green")
        except BaseException as rollback_exc:
            set_state(artifact_root, "blocked", "rollback_failed", f"activation={type(exc).__name__}: {exc}; rollback={type(rollback_exc).__name__}: {rollback_exc}")
        raise


def validate_green_receipt(path: Path, contract: dict, envelope: dict, *, schema: str, label: str) -> dict:
    receipt = load_json(path, label=label)
    if receipt.get("schemaVersion") != schema or receipt.get("outcome") != "green":
        raise RuntimeError(f"{label} is not green")
    require_release_identity(receipt, contract, label=label)
    if receipt.get("releaseEnvelopeSha256") != envelope.get("envelopeSha256"):
        raise RuntimeError(f"{label} envelope digest mismatch")
    return receipt


def validate_deployed_verification(receipt: dict, contract: dict, *, label: str) -> dict:
    raw_path = receipt.get("releaseVerificationPath")
    expected_hash = receipt.get("releaseVerificationSha256")
    if not isinstance(raw_path, str) or not raw_path or not isinstance(expected_hash, str):
        raise RuntimeError(f"{label} has no deployed release verification")
    verification_path = Path(raw_path)
    if verification_path.is_symlink() or not verification_path.is_file() or sha256(verification_path) != expected_hash:
        raise RuntimeError(f"{label} deployed release verification digest mismatch")
    verification = load_json(verification_path, label=f"{label} deployed release verification")
    if verification.get("schemaVersion") != "cortex.release-envelope-verification.v2" or verification.get("outcome") != "green":
        raise RuntimeError(f"{label} deployed release verification is not green")
    require_release_identity(verification, contract, label=f"{label} deployed release verification")
    if verification.get("envelopeSha256") != receipt.get("releaseEnvelopeSha256"):
        raise RuntimeError(f"{label} deployed verification envelope digest mismatch")
    if receipt.get("deployedRoot") != receipt.get("currentPointerTarget"):
        raise RuntimeError(f"{label} current pointer did not identify the deployed root")
    return verification


def validate_surface_evidence(path: Path, contract: dict, envelope: dict) -> dict:
    receipt = load_json(path, label="surface evidence receipt")
    if receipt.get("schemaVersion") != SURFACE_EVIDENCE_SCHEMA or receipt.get("outcome") != "green":
        raise RuntimeError(f"surface evidence receipt is not green: {path}")
    require_release_identity(receipt, contract, label=f"surface evidence receipt {path}")
    if receipt.get("releaseEnvelopeSha256") != envelope.get("envelopeSha256"):
        raise RuntimeError(f"surface evidence receipt envelope digest mismatch: {path}")
    surface_ids = receipt.get("surfaceIds")
    if not isinstance(surface_ids, list) or not surface_ids or not all(isinstance(value, str) and value for value in surface_ids):
        raise RuntimeError(f"surface evidence receipt has no surfaceIds: {path}")
    replay = receipt.get("replayCommand")
    if not isinstance(replay, list) or not replay or not all(isinstance(value, str) and value for value in replay):
        raise RuntimeError(f"surface evidence receipt has no replayCommand argv: {path}")
    if not all(isinstance(receipt.get(field), str) and receipt.get(field) for field in ("startedAt", "completedAt")):
        raise RuntimeError(f"surface evidence receipt has no bounded timestamps: {path}")
    artifacts = receipt.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise RuntimeError(f"surface evidence receipt has no hashed artifacts: {path}")
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise RuntimeError(f"surface evidence receipt has an invalid artifact row: {path}")
        digest = str(artifact.get("sha256") or "")
        relative = PurePosixPath(str(artifact.get("path") or ""))
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or not relative.parts
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
        ):
            raise RuntimeError(f"surface evidence receipt has invalid artifact identity: {path}")
        artifact_path = path.parent.joinpath(*relative.parts)
        if (
            artifact_path.is_symlink()
            or not artifact_path.is_file()
            or sha256(artifact_path) != digest
        ):
            raise RuntimeError(f"surface evidence artifact digest mismatch: {artifact_path}")
    return receipt


def resolve_remote_accepted_ref(contract: dict) -> dict:
    remote = contract.get("authoritativeRemoteUrl")
    accepted_ref = contract.get("acceptedRef")
    if not isinstance(remote, str) or not remote or remote.startswith("-"):
        raise RuntimeError("deployment contract requires an authoritativeRemoteUrl")
    if not isinstance(accepted_ref, str) or not accepted_ref.startswith("refs/heads/accepted/"):
        raise RuntimeError("acceptedRef must be in refs/heads/accepted/")
    result = subprocess.run(
        ["git", "ls-remote", "--refs", remote, accepted_ref],
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"authoritative remote accepted ref lookup failed: {(result.stderr or result.stdout)[-500:]}")
    rows = [line.split() for line in result.stdout.splitlines() if line.strip()]
    if len(rows) != 1 or len(rows[0]) != 2 or rows[0][1] != accepted_ref:
        raise RuntimeError("authoritative remote accepted ref is missing or ambiguous")
    observed = rows[0][0]
    if observed != contract["sourceCommit"]:
        raise RuntimeError("authoritative remote accepted ref does not resolve to the deployed commit")
    return {"remote": remote, "ref": accepted_ref, "commit": observed}


def supervise(contract: dict, artifact_root: Path) -> bool:
    checks: dict[str, dict] = {}
    evidence_by_surface: dict[str, list[dict]] = {}
    envelope: dict = {}
    matrix: dict = {}

    def checked(name: str, operation):
        try:
            value = operation()
            checks[name] = {"outcome": "green"}
            return value
        except Exception as exc:
            checks[name] = {"outcome": "red", "reason": f"{type(exc).__name__}: {exc}"}
            return None

    envelope_path = Path(contract.get("envelope") or "")
    envelope = checked("releaseEnvelope", lambda: load_json(envelope_path.resolve(strict=True), label="release envelope")) or {}
    if envelope:
        validated_envelope = checked(
            "releaseEnvelopeIntegrity",
            lambda: validate_release_envelope(envelope, contract),
        )
        checked("releaseIdentity", lambda: require_release_identity(envelope, contract, label="release envelope"))
        embedded = checked("qualificationReceipts", lambda: qualification_receipts(envelope)) or {}
        if validated_envelope and embedded:
            focused = (embedded.get("focused-gates") or {}).get("payload") or {}
            for surface_id in focused.get("surfaceIds") or []:
                evidence_by_surface.setdefault(surface_id, []).append(
                    {"source": "embedded:focused-gates", "receiptSha256": (embedded.get("focused-gates") or {}).get("receiptSha256")}
                )
    else:
        embedded = {}

    deployment = checked(
        "deploymentReceipt",
        lambda: validate_green_receipt(
            artifact_root / "deployment.json", contract, envelope,
            schema="cortex.q9.deployment.v2", label="deployment receipt",
        ),
    )
    rollback = checked(
        "rollbackReceipt",
        lambda: validate_green_receipt(
            artifact_root / "rollback.json", contract, envelope,
            schema="cortex.q9.rollback.v1", label="rollback receipt",
        ),
    )
    redeploy = checked(
        "redeployReceipt",
        lambda: validate_green_receipt(
            artifact_root / "redeploy.json", contract, envelope,
            schema="cortex.q9.redeploy.v1", label="redeploy receipt",
        ),
    )
    if deployment:
        checked("deployedHashes", lambda: validate_deployed_verification(deployment, contract, label="deployment receipt"))
    if redeploy:
        checked("redeployedHashes", lambda: validate_deployed_verification(redeploy, contract, label="redeploy receipt"))
    checked("gatewayCodeManifest", lambda: validate_gateway_preflight(contract, envelope))
    remote_ref = checked("authoritativeRemoteAcceptedRef", lambda: resolve_remote_accepted_ref(contract))

    matrix_value = contract.get("surfaceMatrix")
    if isinstance(matrix_value, str) and matrix_value:
        matrix_path = Path(matrix_value).resolve()
        matrix = checked("surfaceMatrix", lambda: load_json(matrix_path, label="repair surface matrix")) or {}
        if matrix and envelope:
            def verify_matrix_binding():
                root = Path(contract["releaseSourceRoot"]).resolve(strict=True)
                relative = matrix_path.relative_to(root).as_posix()
                rows = [row for row in envelope.get("files") or [] if row.get("path") == relative]
                if len(rows) != 1 or rows[0].get("sha256") != sha256(matrix_path):
                    raise RuntimeError("repair surface matrix is not hash-bound in the release envelope")
                return rows[0]
            checked("surfaceMatrixBinding", verify_matrix_binding)
    else:
        checks["surfaceMatrix"] = {"outcome": "red", "reason": "deployment contract requires surfaceMatrix"}

    evidence_paths = contract.get("surfaceEvidence")
    if not isinstance(evidence_paths, list):
        evidence_paths = []
        checks["surfaceEvidenceSet"] = {"outcome": "red", "reason": "deployment contract requires surfaceEvidence list"}
    else:
        checks["surfaceEvidenceSet"] = {"outcome": "green"}
    for index, raw_path in enumerate(evidence_paths):
        name = f"surfaceEvidence[{index}]"
        if not isinstance(raw_path, str) or not raw_path:
            checks[name] = {"outcome": "red", "reason": "surface evidence path must be non-empty"}
            continue
        receipt_path = Path(raw_path).resolve()
        receipt = checked(
            name,
            lambda receipt_path=receipt_path: validate_surface_evidence(
                receipt_path, contract, envelope
            ),
        )
        if receipt:
            for surface_id in receipt["surfaceIds"]:
                evidence_by_surface.setdefault(surface_id, []).append(
                    {"source": str(receipt_path), "receiptSha256": sha256(receipt_path)}
                )

    release_chain_green = all(
        checks.get(name, {}).get("outcome") == "green"
        for name in (
            "releaseEnvelopeIntegrity",
            "releaseIdentity",
            "deploymentReceipt",
            "deployedHashes",
            "redeployReceipt",
            "redeployedHashes",
        )
    )
    provenance_green = release_chain_green
    rollback_ref_green = provenance_green and all(
        checks.get(name, {}).get("outcome") == "green"
        for name in ("rollbackReceipt", "authoritativeRemoteAcceptedRef", "gatewayCodeManifest")
    )
    qualification_green = all(
        checks.get(name, {}).get("outcome") == "green"
        for name in ("releaseEnvelopeIntegrity", "qualificationReceipts")
    )

    surface_results = []
    matrix_rows = matrix.get("surfaces") if isinstance(matrix, dict) else None
    if not isinstance(matrix_rows, list):
        matrix_rows = []
        checks["matrixRows"] = {"outcome": "red", "reason": "repair surface matrix has no surfaces"}
    else:
        identifiers = [row.get("id") for row in matrix_rows if isinstance(row, dict)]
        if len(identifiers) != len(set(identifiers)) or not all(isinstance(value, str) and value for value in identifiers):
            checks["matrixRows"] = {"outcome": "red", "reason": "repair surface matrix IDs are invalid or duplicated"}
        else:
            checks["matrixRows"] = {"outcome": "green"}
    for row in matrix_rows:
        if not isinstance(row, dict):
            continue
        surface_id = row.get("id")
        if surface_id == "PROV-1":
            green = provenance_green
            authority = "derived:immutable-deployment-and-redeploy-hashes"
        elif surface_id == "PROV-2":
            green = rollback_ref_green
            authority = "derived:rollback-redeploy-and-authoritative-remote-ref"
        elif surface_id == "QUAL-1":
            green = qualification_green
            authority = "derived:embedded-exact-candidate-qualification-receipts"
        else:
            green = bool(evidence_by_surface.get(surface_id))
            authority = "receipt" if green else "missing_surface_evidence"
        surface_results.append(
            {
                "id": surface_id,
                "severity": row.get("severity"),
                "acceptance": row.get("acceptance"),
                "outcome": "green" if green else "red",
                "authority": authority,
                "evidence": evidence_by_surface.get(surface_id, []),
            }
        )

    all_green = bool(surface_results) and all(row["outcome"] == "green" for row in surface_results)
    all_green = all_green and all(row.get("outcome") == "green" for row in checks.values())
    report = {
        "schemaVersion": "cortex.release-supervisor-report.v1",
        "outcome": "green" if all_green else "blocked",
        "releaseId": contract.get("releaseId"),
        "sourceCommit": contract.get("sourceCommit"),
        "sourceTree": contract.get("sourceTree"),
        "releaseEnvelopeSha256": envelope.get("envelopeSha256"),
        "surfaceMatrixSha256": sha256(Path(matrix_value)) if isinstance(matrix_value, str) and Path(matrix_value).is_file() else None,
        "stopCondition": matrix.get("stopCondition"),
        "checks": checks,
        "surfaces": surface_results,
        "remoteAcceptedRef": remote_ref,
        "completedAt": now(),
        "truthBoundary": "Supervisor truth is derived from the immutable repair surface matrix and hash-bound machine receipts. Worker notes and the matrix's prior status labels are not completion evidence.",
    }
    report_path = artifact_root / "supervisor-report.json"
    atomic_json(report_path, report)
    failed_surfaces = [row["id"] for row in surface_results if row["outcome"] != "green"]
    failed_checks = [name for name, row in checks.items() if row.get("outcome") != "green"]
    state = {
        "schemaVersion": TERMINAL_STATE_SCHEMA,
        "producer": TERMINAL_STATE_PRODUCER,
        "jobId": "cortex-repair-20261011",
        "runId": str(contract.get("supervisorRunId") or contract.get("releaseId") or "release-supervisor"),
        "status": "completed" if all_green else "blocked",
        "completedAt": report["completedAt"],
        "terminalSequence": int(contract.get("terminalSequence", 1)),
        "verificationPassed": all_green,
        "candidateHead": contract.get("sourceCommit"),
        "surfaceMatrixSha256": report["surfaceMatrixSha256"],
        "artifactManifest": {"path": str(report_path), "sha256": sha256(report_path)},
        "truthBoundary": report["truthBoundary"],
    }
    if not all_green:
        state["blocker"] = f"red surfaces={failed_surfaces}; red checks={failed_checks}"
    atomic_json(artifact_root / "state.json", state)
    return all_green


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("preflight", "activate", "rollback", "redeploy", "supervise"))
    parser.add_argument("--contract", required=True)
    args = parser.parse_args()
    contract_path = Path(args.contract).resolve(strict=True)
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    artifact_root = Path(contract["artifactRoot"]).resolve()
    artifact_root.mkdir(parents=True, exist_ok=True)
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_PATH.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.action == "preflight":
            release, envelope, environment = prepare_release(contract, artifact_root)
            validate_pending_environment(environment, release)
            gateway_receipt = validate_gateway_preflight(contract, envelope)
            atomic_json(artifact_root / "preflight.json", {"schemaVersion": "cortex.q9.deployment-preflight.v2", "outcome": "green", "releaseId": contract["releaseId"], "sourceCommit": contract["sourceCommit"], "sourceTree": contract["sourceTree"], "sourceClean": envelope["sourceIdentity"]["clean"], "envelopeSha256": envelope["envelopeSha256"], "qualificationReceiptKinds": sorted(qualification_receipts(envelope)), "gatewayCodeManifestReceiptSha256": sha256(Path(contract["gatewayCodeManifestReceipt"])), "gatewayCodeManifestSha256": gateway_receipt["codeManifestSha256"], "releaseVerificationSha256": sha256(artifact_root / "release-verification.json"), "releaseRoot": str(release), "verifiedAt": now(), "truthBoundary": "Preflight proves immutable source, classification, exact-candidate qualification, archive extraction, and gateway code-manifest evidence only; it does not mutate services or databases."})
            print(json.dumps({"outcome": "green", "releaseId": contract["releaseId"], "action": "preflight"}, sort_keys=True))
        elif args.action == "activate":
            activate(contract, artifact_root)
            print(json.dumps({"outcome": "green", "releaseId": contract["releaseId"], "action": "activate"}, sort_keys=True))
        elif args.action == "rollback":
            restore_preimage(artifact_root, contract)
            set_state(artifact_root, "complete", "rollback_green", rollback="green")
            print(json.dumps({"outcome": "green", "releaseId": contract["releaseId"], "action": "rollback"}, sort_keys=True))
        elif args.action == "redeploy":
            envelope = load_json(Path(contract["envelope"]).resolve(strict=True), label="release envelope")
            validate_green_receipt(artifact_root / "deployment.json", contract, envelope, schema="cortex.q9.deployment.v2", label="deployment receipt")
            validate_green_receipt(artifact_root / "rollback.json", contract, envelope, schema="cortex.q9.rollback.v1", label="rollback receipt")
            activate(contract, artifact_root, redeploy=True)
            print(json.dumps({"outcome": "green", "releaseId": contract["releaseId"], "action": "redeploy"}, sort_keys=True))
        else:
            green = supervise(contract, artifact_root)
            print(json.dumps({"outcome": "green" if green else "blocked", "releaseId": contract["releaseId"], "action": "supervise"}, sort_keys=True))
            raise SystemExit(0 if green else 1)


if __name__ == "__main__":
    main()
