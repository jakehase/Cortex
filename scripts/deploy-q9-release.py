#!/usr/bin/env python3
from __future__ import annotations

import argparse
import contextlib
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
LIVE_OPENCLAW_CONFIG = Path("/root/.openclaw/openclaw.json")
LIVE_UNITS = {
    "cortex.service": Path("/etc/systemd/system/cortex.service"),
    "cortex-health-watchdog.service": Path("/etc/systemd/system/cortex-health-watchdog.service"),
    "cortex-health-watchdog.timer": Path("/etc/systemd/system/cortex-health-watchdog.timer"),
    "cortex-ollama-tunnel.service": Path("/etc/systemd/system/cortex-ollama-tunnel.service"),
}
CURRENT_POINTER = Path("/opt/cortex/current")
RELEASES_ROOT = Path("/opt/cortex/releases")
ATTESTATIONS_ROOT = Path("/var/lib/cortex/attestations")


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
    if environment.get("ORACLE_OLLAMA_URL") != "http://127.0.0.1:11434":
        raise RuntimeError("q9 provider must use approved loopback endpoint")


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
    manifest = {
        "schemaVersion": "cortex.q9.deployment-preimage.v1",
        "files": files,
        "currentPointerExisted": CURRENT_POINTER.is_symlink(),
        "currentPointerTarget": current_target,
        "cortexWasActive": subprocess.run(["systemctl", "is-active", "--quiet", "cortex.service"]).returncode == 0,
        "watchdogTimerWasActive": subprocess.run(["systemctl", "is-active", "--quiet", "cortex-health-watchdog.timer"]).returncode == 0,
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
    envelope = json.loads(envelope_path.read_text(encoding="utf-8"))
    if envelope.get("releaseId") != release_id or envelope.get("sourceCommit") != contract["sourceCommit"] or envelope.get("sourceTree") != contract["sourceTree"]:
        raise RuntimeError("q9 release identity mismatch")
    release = RELEASES_ROOT / release_id
    if not release.exists():
        staging_parent = RELEASES_ROOT / f".{release_id}.staging-{os.getpid()}"
        extracted = safe_extract(archive, staging_parent, release_id)
        run(
            [sys.executable, str(extracted / "scripts/verify-release-envelope.py"), "--root", str(extracted), "--envelope", str(envelope_path)],
            timeout=300,
            output=artifact_root / "release-verification.log",
        )
        RELEASES_ROOT.mkdir(parents=True, exist_ok=True)
        os.rename(extracted, release)
        staging_parent.rmdir()
        fsync_dir(RELEASES_ROOT)
    else:
        run(
            [sys.executable, str(release / "scripts/verify-release-envelope.py"), "--root", str(release), "--envelope", str(envelope_path)],
            timeout=300,
            output=artifact_root / "release-verification.log",
        )
    pending_environment = load_env(Path(contract["pendingEnvironment"]))
    validate_pending_environment(pending_environment, release)
    return release, envelope, pending_environment


def install_units(contract: dict, release: Path) -> None:
    sources = {
        "cortex.service": release / "ops/systemd/cortex.service",
        "cortex-health-watchdog.service": release / "ops/systemd/cortex-health-watchdog.service",
        "cortex-health-watchdog.timer": release / "ops/systemd/cortex-health-watchdog.timer",
        "cortex-ollama-tunnel.service": Path(contract["renderedTunnelUnit"]),
    }
    for name, target in LIVE_UNITS.items():
        install_file(sources[name], target, mode=0o644)


def restore_preimage(artifact_root: Path) -> None:
    manifest = json.loads((artifact_root / "preimage.json").read_text(encoding="utf-8"))
    subprocess.run(["systemctl", "stop", "cortex-health-watchdog.timer"], check=False, timeout=30)
    subprocess.run(["systemctl", "stop", "cortex.service"], check=False, timeout=120)
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
    if manifest["cortexWasActive"]:
        run(["systemctl", "start", "cortex.service"], timeout=120)
        wait_runtime(load_env(LIVE_ENV), 120)
    if manifest["watchdogTimerWasActive"]:
        run(["systemctl", "enable", "--now", "cortex-health-watchdog.timer"], timeout=45)
    restart_gateway()
    atomic_json(
        artifact_root / "rollback.json",
        {
            "schemaVersion": "cortex.q9.rollback.v1",
            "outcome": "green",
            "graphRestored": sha256(Path(receipt["sourcePath"])) == receipt["localBackupSha256"],
            "environmentRestored": next(row for row in manifest["files"] if row["path"] == str(LIVE_ENV))["sha256"] == sha256(LIVE_ENV),
            "priorRuntimeHealthy": True,
            "completedAt": now(),
        },
    )


def activate(contract: dict, artifact_root: Path) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("q9 activation requires root")
    release, envelope, environment = prepare_release(contract, artifact_root)
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
        run(["systemctl", "stop", "cortex-health-watchdog.timer"], timeout=30)
        run(["systemctl", "stop", "cortex.service"], timeout=120)
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
        run(["systemctl", "enable", "cortex.service"], timeout=30)
        run(["systemctl", "start", "cortex.service"], timeout=120)
        wait_runtime(environment, 120)
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
        result = {
            "schemaVersion": "cortex.q9.deployment.v1",
            "outcome": "green",
            "releaseId": contract["releaseId"],
            "sourceCommit": contract["sourceCommit"],
            "sourceTree": contract["sourceTree"],
            "releaseEnvelopeSha256": envelope["envelopeSha256"],
            "functionalStatus": attestation["functionalStatus"],
            "attestationStatus": attestation["attestationStatus"],
            "overallStatus": attestation["status"],
            "graphMigration": "green",
            "liveCanary": "green",
            "completedAt": now(),
            "truthBoundary": "Green proves q9 activation and functional runtime. Full q9 green still requires rollback drill, burn-in, remote persistence and contradiction audit.",
        }
        atomic_json(artifact_root / "deployment.json", result)
        set_state(artifact_root, "complete", "q9_functional_green", releaseId=contract["releaseId"])
    except BaseException as exc:
        try:
            restore_preimage(artifact_root)
            set_state(artifact_root, "blocked", "rolled_back", f"{type(exc).__name__}: {exc}", rollback="green")
        except BaseException as rollback_exc:
            set_state(artifact_root, "blocked", "rollback_failed", f"activation={type(exc).__name__}: {exc}; rollback={type(rollback_exc).__name__}: {rollback_exc}")
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("preflight", "activate", "rollback"))
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
            atomic_json(artifact_root / "preflight.json", {"schemaVersion": "cortex.q9.deployment-preflight.v1", "outcome": "green", "releaseId": contract["releaseId"], "sourceCommit": contract["sourceCommit"], "sourceTree": contract["sourceTree"], "envelopeSha256": envelope["envelopeSha256"], "releaseRoot": str(release), "verifiedAt": now(), "truthBoundary": "Preflight only; no service or database mutation."})
            print(json.dumps({"outcome": "green", "releaseId": contract["releaseId"], "action": "preflight"}, sort_keys=True))
        elif args.action == "activate":
            activate(contract, artifact_root)
            print(json.dumps({"outcome": "green", "releaseId": contract["releaseId"], "action": "activate"}, sort_keys=True))
        else:
            restore_preimage(artifact_root)
            set_state(artifact_root, "complete", "rollback_green", rollback="green")
            print(json.dumps({"outcome": "green", "releaseId": contract["releaseId"], "action": "rollback"}, sort_keys=True))


if __name__ == "__main__":
    main()
