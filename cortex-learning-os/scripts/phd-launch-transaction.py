#!/usr/bin/env python3
"""Production launch rehearsal, signed gate, and one-attempt circuit breaker."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import time
import uuid


DIGEST = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
KEY_ID = re.compile(r"^[0-9a-f]{16}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
SAFE_HOST = re.compile(r"^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$")
SAFE_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")
REHEARSAL_SCHEMA = "cortex.learning_os.phd_launch_rehearsal_receipt.v1"
STATE_SCHEMA = "cortex.learning_os.phd_launch_rehearsal_state.v1"
ATTEMPT_SCHEMA = "cortex.learning_os.phd_launch_attempt.v1"
EXPECTED_INJECTED_EXIT = 42
DETECTION_LIMIT_SECONDS = 30.0
RECEIPT_LIFETIME_SECONDS = 24 * 60 * 60


class TransactionError(RuntimeError):
    pass


class CircuitBreakerError(TransactionError):
    pass


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def canonical_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def secure_secret(path: Path) -> str:
    observed = path.stat()
    if (
        not stat.S_ISREG(observed.st_mode)
        or path.is_symlink()
        or observed.st_uid != 0
        or observed.st_gid != 0
        or stat.S_IMODE(observed.st_mode) != 0o600
        or observed.st_nlink != 1
    ):
        raise TransactionError("launch signing secret metadata is unsafe")
    secret = path.read_text(encoding="utf-8").strip()
    if len(secret) < 32:
        raise TransactionError("launch signing secret is invalid")
    return secret


def sign(payload: dict, secret: str) -> dict:
    unsigned = dict(payload)
    unsigned.pop("controlPlaneSignature", None)
    return {
        **unsigned,
        "controlPlaneSignature": {
            "algorithm": "hmac-sha256",
            "keyId": hashlib.sha256(secret.encode()).hexdigest()[:16],
            "digest": hmac.new(secret.encode(), canonical_bytes(unsigned), hashlib.sha256).hexdigest(),
        },
    }


def verify_signature(payload: dict, secret: str) -> bool:
    signature = payload.get("controlPlaneSignature")
    if not isinstance(signature, dict):
        return False
    unsigned = {key: value for key, value in payload.items() if key != "controlPlaneSignature"}
    expected = hmac.new(secret.encode(), canonical_bytes(unsigned), hashlib.sha256).hexdigest()
    return (
        signature.get("algorithm") == "hmac-sha256"
        and signature.get("keyId") == hashlib.sha256(secret.encode()).hexdigest()[:16]
        and hmac.compare_digest(str(signature.get("digest", "")), expected)
    )


def secure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    observed = path.parent.stat()
    if (
        not stat.S_ISDIR(observed.st_mode)
        or path.parent.is_symlink()
        or observed.st_uid != 0
        or observed.st_gid != 0
        or stat.S_IMODE(observed.st_mode) != 0o700
    ):
        raise TransactionError("launch receipt parent metadata is unsafe")


def atomic_json(path: Path, payload: dict) -> None:
    secure_parent(path)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
        temporary = Path(handle.name)
    temporary.chmod(0o600)
    temporary.replace(path)
    directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def read_secure_json(path: Path) -> dict:
    observed = path.stat()
    if (
        not stat.S_ISREG(observed.st_mode)
        or path.is_symlink()
        or observed.st_uid != 0
        or observed.st_gid != 0
        or stat.S_IMODE(observed.st_mode) != 0o600
        or observed.st_nlink != 1
    ):
        raise TransactionError("launch receipt metadata is unsafe")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise TransactionError("launch receipt is not an object")
    return value


def validate_common(args: argparse.Namespace) -> None:
    for value in (args.plan_digest, args.campaign_digest, args.deployment_digest):
        if not DIGEST.fullmatch(value):
            raise TransactionError("invalid launch digest")
    for value in (args.source_commit, args.source_tree, args.product_tree):
        if not COMMIT.fullmatch(value):
            raise TransactionError("invalid launch source identity")
    if not IDENTIFIER.fullmatch(args.subject_id) or not IDENTIFIER.fullmatch(args.campaign_id):
        raise TransactionError("invalid launch identity")
    if not SAFE_HOST.fullmatch(args.ssh_host):
        raise TransactionError("unsafe launch SSH host")
    for name in ("state_root", "remote_state_root"):
        if not SAFE_PATH.fullmatch(str(getattr(args, name))):
            raise TransactionError("unsafe launch state root")


def run(command: list[str], *, timeout: float = 30.0, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
        raise TransactionError(f"command failed: {detail}")
    return result


def remote(args: argparse.Namespace, command: list[str], *, timeout: float = 30.0, check: bool = True) -> subprocess.CompletedProcess:
    return run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.ssh_host, shlex.join(command)],
        timeout=timeout,
        check=check,
    )


def machine_id_sha256_local() -> str:
    return hashlib.sha256(Path("/etc/machine-id").read_bytes()).hexdigest()


def machine_id_sha256_remote(args: argparse.Namespace) -> str:
    result = remote(args, ["cat", "/etc/machine-id"])
    return hashlib.sha256(result.stdout.encode()).hexdigest()


def systemctl_fields(command: list[str], *, remote_args: argparse.Namespace | None = None) -> dict[str, str]:
    fields = ["LoadState", "ActiveState", "SubState", "Result", "ExecMainStatus", "MainPID", "User", "Group", "WorkingDirectory", "Environment"]
    full = command + ["--no-pager"] + [f"--property={field}" for field in fields]
    result = remote(remote_args, full, check=False) if remote_args else run(full, check=False)
    values: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def wait_unit_terminal(unit: str, *, remote_args: argparse.Namespace | None, deadline: float) -> tuple[dict[str, str], float]:
    started = time.monotonic()
    while time.monotonic() < deadline:
        command = ["systemctl", "show", unit]
        fields = systemctl_fields(command, remote_args=remote_args)
        if fields.get("ActiveState") in {"failed", "inactive"} and fields.get("SubState") in {"failed", "dead", "exited"}:
            return fields, time.monotonic() - started
        time.sleep(0.2)
    raise TransactionError(f"transient unit did not reach terminal state within {DETECTION_LIMIT_SECONDS:.0f}s: {unit}")


def wait_path(path: Path, deadline: float) -> None:
    while time.monotonic() < deadline:
        if path.is_file() and not path.is_symlink():
            return
        time.sleep(0.1)
    raise TransactionError(f"rehearsal path did not appear: {path}")


def unit_name(kind: str, identity: str) -> str:
    digest = hashlib.sha256(identity.encode()).hexdigest()[:24]
    return f"clos-phd-rehearsal-{kind}-{digest}"


def harvest_canary(args: argparse.Namespace) -> int:
    secret = secure_secret(args.secret)
    proof_result = remote(args, ["cat", str(args.remote_proof)])
    proof = json.loads(proof_result.stdout)
    if not isinstance(proof, dict):
        raise TransactionError("remote rehearsal proof is invalid")
    fields = systemctl_fields(["systemctl", "show", args.remote_unit], remote_args=args)
    expected = {
        "schemaVersion": "cortex.learning_os.phd_launch_rehearsal_remote_proof.v1",
        "status": "worker_running",
        "trialId": args.trial_id,
        "nonce": args.nonce,
        "jobSha256": args.expected_job_sha256,
        "providerCalls": 0,
        "modelExecutableInvoked": False,
    }
    if any(proof.get(key) != value for key, value in expected.items()):
        raise TransactionError("remote rehearsal proof differs from the expected canary")
    environment = set(shlex.split(fields.get("Environment", "")))
    if (
        fields.get("ActiveState") != "active"
        or fields.get("SubState") != "running"
        or fields.get("User") != "root"
        or fields.get("Group") != "root"
        or environment != {
            f"CLOS_REHEARSAL_ID={args.trial_id}",
            "CLOS_REHEARSAL_NO_PROVIDER=1",
        }
    ):
        raise TransactionError("remote rehearsal worker was not active with the exact service identity")
    payload = {
        "schemaVersion": STATE_SCHEMA,
        "status": "running",
        "trialId": args.trial_id,
        "nonce": args.nonce,
        "planDigest": args.plan_digest,
        "campaignDigest": args.campaign_digest,
        "deploymentDigest": args.deployment_digest,
        "sourceCommit": args.source_commit,
        "remoteUnit": args.remote_unit,
        "remoteUnitObservedActive": True,
        "remoteProofSha256": hashlib.sha256(proof_result.stdout.encode()).hexdigest(),
        "providerCalls": 0,
        "modelExecutableInvoked": False,
        "observedAt": utc_now(),
        "truthBoundary": "Signed running state proves only the zero-provider production launch rehearsal.",
    }
    atomic_json(args.local_state, sign(payload, secret))
    return 0


def cleanup_unit(args: argparse.Namespace, unit: str, *, is_remote: bool) -> None:
    command = ["systemctl", "stop", unit]
    if is_remote:
        remote(args, command, check=False)
        remote(args, ["systemctl", "reset-failed", unit], check=False)
    else:
        run(command, check=False)
        run(["systemctl", "reset-failed", unit], check=False)


def run_trial(args: argparse.Namespace, *, kind: str, index: int, secret: str) -> dict:
    trial_id = f"{args.rehearsal_id}.{kind}.{index}"
    nonce = uuid.uuid4().hex
    remote_unit = unit_name("worker", f"{args.plan_digest}:{trial_id}:{nonce}")
    local_unit = unit_name("harvest", f"{args.plan_digest}:{trial_id}:{nonce}")
    remote_proof = args.remote_proof_root / f"{trial_id}.json"
    local_state = args.local_evidence_root / f"{trial_id}.state.json"
    cleanup_unit(args, remote_unit, is_remote=True)
    cleanup_unit(args, local_unit, is_remote=False)
    remote(args, ["rm", "-f", str(remote_proof)])
    try:
        worker = [
            "python3", str(args.remote_worker),
            "--trial-id", trial_id,
            "--nonce", nonce,
            "--job", str(args.remote_job),
            "--expected-job-sha256", args.expected_job_sha256,
            "--proof", str(remote_proof),
            "--hold-seconds", "20",
        ]
        if kind == "failure":
            worker.extend(("--inject-exit", str(EXPECTED_INJECTED_EXIT)))
        start = time.monotonic()
        remote(
            args,
            [
                "systemd-run", f"--unit={remote_unit}", "--quiet",
                "--description=Cortex Learning OS zero-provider launch rehearsal",
                "--property=User=root", "--property=Group=root",
                f"--property=Environment=CLOS_REHEARSAL_ID={trial_id}",
                "--property=Environment=CLOS_REHEARSAL_NO_PROVIDER=1",
                "--property=IPAddressDeny=any",
                "--property=RestrictAddressFamilies=AF_UNIX",
                "--property=NoNewPrivileges=yes",
                "--working-directory=/", *worker,
            ],
        )
        if kind == "failure":
            observed, latency = wait_unit_terminal(
                remote_unit,
                remote_args=args,
                deadline=start + DETECTION_LIMIT_SECONDS,
            )
            if observed.get("Result") != "exit-code" or observed.get("ExecMainStatus") != str(EXPECTED_INJECTED_EXIT):
                raise TransactionError("failure-injection unit returned the wrong terminal identity")
            proof_check = remote(args, ["test", "!", "-e", str(remote_proof)], check=False)
            if proof_check.returncode != 0 or local_state.exists():
                raise TransactionError("failure injection manufactured rehearsal success evidence")
            return {
                "kind": "failure_injection",
                "trialId": trial_id,
                "status": "detected",
                "jobSha256": args.expected_job_sha256,
                "expectedExitStatus": EXPECTED_INJECTED_EXIT,
                "observedExitStatus": EXPECTED_INJECTED_EXIT,
                "detectionLatencyMs": round(latency * 1000),
                "providerCalls": 0,
                "modelExecutableInvoked": False,
            }

        deadline = start + DETECTION_LIMIT_SECONDS
        while time.monotonic() < deadline:
            found = remote(args, ["test", "-f", str(remote_proof)], check=False)
            if found.returncode == 0:
                break
            remote_fields = systemctl_fields(["systemctl", "show", remote_unit], remote_args=args)
            if remote_fields.get("ActiveState") in {"failed", "inactive"}:
                raise TransactionError("successful rehearsal worker exited before producing running proof")
            time.sleep(0.2)
        else:
            raise TransactionError("successful rehearsal worker did not publish running proof")

        harvest_command = [
            "python3", str(args.local_helper), "harvest-canary",
            "--secret", str(args.secret), "--ssh-host", args.ssh_host,
            "--remote-proof", str(remote_proof), "--remote-unit", remote_unit,
            "--local-state", str(local_state), "--trial-id", trial_id,
            "--nonce", nonce, "--expected-job-sha256", args.expected_job_sha256,
            "--plan-digest", args.plan_digest, "--campaign-digest", args.campaign_digest,
            "--deployment-digest", args.deployment_digest, "--source-commit", args.source_commit,
        ]
        run(
            [
                "systemd-run", f"--unit={local_unit}", "--quiet",
                "--description=Cortex Learning OS zero-provider rehearsal harvester",
                "--property=User=root", "--property=Group=root", "--working-directory=/",
                *harvest_command,
            ]
        )
        wait_path(local_state, deadline)
        state = read_secure_json(local_state)
        if (
            not verify_signature(state, secret)
            or state.get("schemaVersion") != STATE_SCHEMA
            or state.get("status") != "running"
            or state.get("trialId") != trial_id
            or state.get("nonce") != nonce
            or state.get("remoteUnitObservedActive") is not True
            or state.get("providerCalls") != 0
            or state.get("modelExecutableInvoked") is not False
        ):
            raise TransactionError("signed rehearsal running state is invalid")
        local_fields, _ = wait_unit_terminal(local_unit, remote_args=None, deadline=deadline)
        if local_fields.get("Result") != "success" or local_fields.get("ExecMainStatus") != "0":
            raise TransactionError("rehearsal harvester did not exit successfully")
        return {
            "kind": "success",
            "trialId": trial_id,
            "status": "passed",
            "jobSha256": args.expected_job_sha256,
            "signedRunningStateSha256": sha256_file(local_state),
            "remoteWorkerObservedActive": True,
            "localHarvesterResult": "success",
            "providerCalls": 0,
            "modelExecutableInvoked": False,
        }
    finally:
        cleanup_unit(args, remote_unit, is_remote=True)
        cleanup_unit(args, local_unit, is_remote=False)


def run_rehearsal_suite(args: argparse.Namespace) -> int:
    validate_common(args)
    if os.geteuid() != 0:
        raise TransactionError("launch rehearsal must run as root")
    if not IDENTIFIER.fullmatch(args.rehearsal_id):
        raise TransactionError("invalid rehearsal ID")
    if not DIGEST.fullmatch(args.expected_job_sha256):
        raise TransactionError("invalid rehearsal job digest")
    for name in (
        "remote_job", "remote_proof_root", "remote_worker", "local_evidence_root",
        "remote_worker_local_copy", "local_helper", "launcher", "inventory_helper",
        "receipt_out",
    ):
        if not SAFE_PATH.fullmatch(str(getattr(args, name))):
            raise TransactionError("unsafe rehearsal path")
    secret = secure_secret(args.secret)
    args.local_evidence_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(args.local_evidence_root, 0o700)
    remote(args, ["install", "-d", "-m", "700", "-o", "root", "-g", "root", str(args.remote_proof_root)])
    remote_worker_gid = remote(args, ["id", "-g", "jake"]).stdout.strip()
    if not remote_worker_gid.isdigit():
        raise TransactionError("remote worker GID is invalid")

    trials = [
        run_trial(args, kind="failure", index=1, secret=secret),
        run_trial(args, kind="success", index=1, secret=secret),
        run_trial(args, kind="success", index=2, secret=secret),
    ]
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "schemaVersion": REHEARSAL_SCHEMA,
        "status": "passed",
        "subjectId": args.subject_id,
        "campaignId": args.campaign_id,
        "campaignDigest": args.campaign_digest,
        "planDigest": args.plan_digest,
        "deploymentDigest": args.deployment_digest,
        "sourceCommit": args.source_commit,
        "sourceTree": args.source_tree,
        "productTree": args.product_tree,
        "sshHost": args.ssh_host,
        "stateRoot": str(args.state_root),
        "remoteStateRoot": str(args.remote_state_root),
        "localMachineIdSha256": machine_id_sha256_local(),
        "remoteMachineIdSha256": machine_id_sha256_remote(args),
        "remoteWorkerGid": int(remote_worker_gid),
        "launcherSha256": sha256_file(args.launcher),
        "inventoryHelperSha256": sha256_file(args.inventory_helper),
        "transactionHelperSha256": sha256_file(args.local_helper),
        "remoteCanaryWorkerSha256": sha256_file(args.remote_worker_local_copy),
        "rehearsedJobSha256": args.expected_job_sha256,
        "successTrialCount": 2,
        "failureDetectionVerified": True,
        "providerCallsObserved": 0,
        "modelExecutableInvoked": False,
        "trials": trials,
        "completedAt": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "expiresAt": (now + dt.timedelta(seconds=RECEIPT_LIFETIME_SECONDS)).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "truthBoundary": "This proves the exact zero-provider VM102-to-Hetzner launch topology, not learning or qualification.",
    }
    signed = sign(payload, secret)
    atomic_json(args.receipt_out, signed)
    print(json.dumps({"status": "passed", "receipt": str(args.receipt_out), "receiptSha256": sha256_file(args.receipt_out)}, sort_keys=True))
    return 0


def verify_rehearsal(args: argparse.Namespace) -> int:
    validate_common(args)
    secret = secure_secret(args.secret)
    receipt = read_secure_json(args.receipt)
    expected = {
        "schemaVersion": REHEARSAL_SCHEMA,
        "status": "passed",
        "subjectId": args.subject_id,
        "campaignId": args.campaign_id,
        "campaignDigest": args.campaign_digest,
        "planDigest": args.plan_digest,
        "deploymentDigest": args.deployment_digest,
        "sourceCommit": args.source_commit,
        "sourceTree": args.source_tree,
        "productTree": args.product_tree,
        "sshHost": args.ssh_host,
        "stateRoot": str(args.state_root),
        "remoteStateRoot": str(args.remote_state_root),
        "localMachineIdSha256": machine_id_sha256_local(),
        "remoteMachineIdSha256": machine_id_sha256_remote(args),
        "launcherSha256": sha256_file(args.launcher),
        "inventoryHelperSha256": sha256_file(args.inventory_helper),
        "transactionHelperSha256": sha256_file(args.local_helper),
        "remoteCanaryWorkerSha256": sha256_file(args.remote_worker_local_copy),
        "successTrialCount": 2,
        "failureDetectionVerified": True,
        "providerCallsObserved": 0,
        "modelExecutableInvoked": False,
    }
    if not verify_signature(receipt, secret) or any(receipt.get(key) != value for key, value in expected.items()):
        raise TransactionError("launch rehearsal receipt is unauthenticated or does not bind the exact production launch")
    remote_worker_gid = remote(args, ["id", "-g", "jake"]).stdout.strip()
    if receipt.get("remoteWorkerGid") != int(remote_worker_gid):
        raise TransactionError("launch rehearsal worker identity changed")
    now = dt.datetime.now(dt.timezone.utc)
    completed = parse_time(str(receipt.get("completedAt", "")))
    expires = parse_time(str(receipt.get("expiresAt", "")))
    if completed > now or expires <= now or expires - completed > dt.timedelta(seconds=RECEIPT_LIFETIME_SECONDS):
        raise TransactionError("launch rehearsal receipt is expired or has an invalid validity window")
    if not DIGEST.fullmatch(str(receipt.get("rehearsedJobSha256", ""))):
        raise TransactionError("launch rehearsal receipt has an invalid job identity")
    trials = receipt.get("trials")
    if not isinstance(trials, list) or len(trials) != 3:
        raise TransactionError("launch rehearsal receipt has the wrong trial set")
    failures = [trial for trial in trials if trial.get("kind") == "failure_injection"]
    successes = [trial for trial in trials if trial.get("kind") == "success"]
    if (
        len(failures) != 1
        or failures[0].get("status") != "detected"
        or failures[0].get("observedExitStatus") != EXPECTED_INJECTED_EXIT
        or not isinstance(failures[0].get("detectionLatencyMs"), int)
        or failures[0]["detectionLatencyMs"] > int(DETECTION_LIMIT_SECONDS * 1000)
        or len(successes) != 2
        or any(trial.get("status") != "passed" or trial.get("remoteWorkerObservedActive") is not True for trial in successes)
        or any(trial.get("jobSha256") != receipt.get("rehearsedJobSha256") for trial in trials)
        or any(trial.get("providerCalls") != 0 or trial.get("modelExecutableInvoked") is not False for trial in trials)
    ):
        raise TransactionError("launch rehearsal trials do not satisfy the circuit-breaker gate")
    print(json.dumps({"status": "verified", "receiptSha256": sha256_file(args.receipt)}, sort_keys=True))
    return 0


def begin_attempt(args: argparse.Namespace) -> int:
    validate_common(args)
    if not DIGEST.fullmatch(args.rehearsal_receipt_sha256):
        raise TransactionError("invalid rehearsal receipt digest")
    secret = secure_secret(args.secret)
    secure_parent(args.attempt_file)
    if args.attempt_file.exists() or args.attempt_file.is_symlink():
        existing = read_secure_json(args.attempt_file)
        status_value = existing.get("status", "unknown") if verify_signature(existing, secret) else "unauthenticated"
        raise CircuitBreakerError(f"launch circuit breaker is open for this exact plan: {status_value}")
    attempt_id = uuid.uuid4().hex
    payload = sign({
        "schemaVersion": ATTEMPT_SCHEMA,
        "status": "started",
        "attemptId": attempt_id,
        "subjectId": args.subject_id,
        "campaignId": args.campaign_id,
        "campaignDigest": args.campaign_digest,
        "planDigest": args.plan_digest,
        "deploymentDigest": args.deployment_digest,
        "sourceCommit": args.source_commit,
        "sourceTree": args.source_tree,
        "productTree": args.product_tree,
        "rehearsalReceiptSha256": args.rehearsal_receipt_sha256,
        "phase": "attempt_started",
        "exitCode": None,
        "startedAt": utc_now(),
        "updatedAt": utc_now(),
        "completionClaim": "not_launched",
        "truthBoundary": "A started launch attempt is not proof of a worker, harvest, or learning.",
    }, secret)
    encoded = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode()
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(args.attempt_file, flags, 0o600)
    try:
        os.write(descriptor, encoded)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    directory = os.open(args.attempt_file.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    print(attempt_id)
    return 0


def finish_attempt(args: argparse.Namespace) -> int:
    secret = secure_secret(args.secret)
    existing = read_secure_json(args.attempt_file)
    if (
        not verify_signature(existing, secret)
        or existing.get("schemaVersion") != ATTEMPT_SCHEMA
        or existing.get("status") != "started"
        or existing.get("attemptId") != args.attempt_id
    ):
        raise CircuitBreakerError("launch attempt terminal transition does not match the unique started attempt")
    status_value = "launch_transaction_completed" if args.exit_code == 0 else "failed"
    completion = "launch_transaction_completed" if args.exit_code == 0 else "not_launched"
    payload = dict(existing)
    payload.pop("controlPlaneSignature", None)
    payload.update({
        "status": status_value,
        "phase": args.phase,
        "exitCode": args.exit_code,
        "updatedAt": utc_now(),
        "completionClaim": completion,
        "truthBoundary": (
            "The launcher observed signed running state and detached topology; this is not retention qualification."
            if args.exit_code == 0
            else "The launch failed closed; no launch or retention credit is claimed."
        ),
    })
    atomic_json(args.attempt_file, sign(payload, secret))
    return 0


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--subject-id", required=True)
    parser.add_argument("--campaign-id", required=True)
    parser.add_argument("--campaign-digest", required=True)
    parser.add_argument("--plan-digest", required=True)
    parser.add_argument("--deployment-digest", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--source-tree", required=True)
    parser.add_argument("--product-tree", required=True)
    parser.add_argument("--ssh-host", required=True)
    parser.add_argument("--state-root", required=True, type=Path)
    parser.add_argument("--remote-state-root", required=True, type=Path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    harvest = commands.add_parser("harvest-canary")
    harvest.add_argument("--secret", required=True, type=Path)
    harvest.add_argument("--ssh-host", required=True)
    harvest.add_argument("--remote-proof", required=True, type=Path)
    harvest.add_argument("--remote-unit", required=True)
    harvest.add_argument("--local-state", required=True, type=Path)
    harvest.add_argument("--trial-id", required=True)
    harvest.add_argument("--nonce", required=True)
    harvest.add_argument("--expected-job-sha256", required=True)
    harvest.add_argument("--plan-digest", required=True)
    harvest.add_argument("--campaign-digest", required=True)
    harvest.add_argument("--deployment-digest", required=True)
    harvest.add_argument("--source-commit", required=True)

    suite = commands.add_parser("run-rehearsal-suite")
    add_common(suite)
    suite.add_argument("--secret", required=True, type=Path)
    suite.add_argument("--rehearsal-id", required=True)
    suite.add_argument("--remote-job", required=True, type=Path)
    suite.add_argument("--expected-job-sha256", required=True)
    suite.add_argument("--remote-proof-root", required=True, type=Path)
    suite.add_argument("--remote-worker", required=True, type=Path)
    suite.add_argument("--remote-worker-local-copy", required=True, type=Path)
    suite.add_argument("--local-evidence-root", required=True, type=Path)
    suite.add_argument("--local-helper", required=True, type=Path)
    suite.add_argument("--launcher", required=True, type=Path)
    suite.add_argument("--inventory-helper", required=True, type=Path)
    suite.add_argument("--receipt-out", required=True, type=Path)

    verify = commands.add_parser("verify-rehearsal")
    add_common(verify)
    verify.add_argument("--secret", required=True, type=Path)
    verify.add_argument("--receipt", required=True, type=Path)
    verify.add_argument("--local-helper", required=True, type=Path)
    verify.add_argument("--launcher", required=True, type=Path)
    verify.add_argument("--inventory-helper", required=True, type=Path)
    verify.add_argument("--remote-worker-local-copy", required=True, type=Path)

    begin = commands.add_parser("begin-attempt")
    add_common(begin)
    begin.add_argument("--secret", required=True, type=Path)
    begin.add_argument("--attempt-file", required=True, type=Path)
    begin.add_argument("--rehearsal-receipt-sha256", required=True)

    finish = commands.add_parser("finish-attempt")
    finish.add_argument("--secret", required=True, type=Path)
    finish.add_argument("--attempt-file", required=True, type=Path)
    finish.add_argument("--attempt-id", required=True)
    finish.add_argument("--phase", required=True)
    finish.add_argument("--exit-code", required=True, type=int)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "harvest-canary":
        return harvest_canary(args)
    if args.command == "run-rehearsal-suite":
        return run_rehearsal_suite(args)
    if args.command == "verify-rehearsal":
        return verify_rehearsal(args)
    if args.command == "begin-attempt":
        return begin_attempt(args)
    if args.command == "finish-attempt":
        return finish_attempt(args)
    raise AssertionError(args.command)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (CircuitBreakerError, TransactionError, OSError, ValueError, KeyError, json.JSONDecodeError, subprocess.SubprocessError) as error:
        print(f"phd-launch-transaction: {error}", file=sys.stderr)
        raise SystemExit(3)
