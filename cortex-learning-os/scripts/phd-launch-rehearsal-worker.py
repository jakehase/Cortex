#!/usr/bin/env python3
"""Zero-provider remote canary for the PhD qualification launch topology."""

from __future__ import annotations

import argparse
import grp
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time


DIGEST = re.compile(r"^[0-9a-f]{64}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
SAFE_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trial-id", required=True)
    parser.add_argument("--nonce", required=True)
    parser.add_argument("--job", required=True, type=Path)
    parser.add_argument("--expected-job-sha256", required=True)
    parser.add_argument("--proof", required=True, type=Path)
    parser.add_argument("--hold-seconds", type=float, default=20.0)
    parser.add_argument("--inject-exit", type=int)
    args = parser.parse_args()

    if os.geteuid() != 0:
        raise SystemExit("rehearsal worker must run as root")
    if not IDENTIFIER.fullmatch(args.trial_id) or not IDENTIFIER.fullmatch(args.nonce):
        raise SystemExit("invalid rehearsal identity")
    if not DIGEST.fullmatch(args.expected_job_sha256):
        raise SystemExit("invalid expected job digest")
    for value in (args.job, args.proof):
        if not SAFE_PATH.fullmatch(str(value)):
            raise SystemExit("unsafe rehearsal path")
    if args.inject_exit is not None:
        if args.inject_exit < 1 or args.inject_exit > 125:
            raise SystemExit("invalid injected exit status")
        return args.inject_exit

    observed = args.job.lstat()
    worker_gid = grp.getgrnam("jake").gr_gid
    if (
        not stat.S_ISREG(observed.st_mode)
        or stat.S_IMODE(observed.st_mode) != 0o440
        or observed.st_uid != 0
        or observed.st_gid != worker_gid
        or observed.st_nlink != 1
    ):
        raise SystemExit("rehearsal job metadata differs from production contract")
    result = subprocess.run(
        [
            "/usr/sbin/runuser",
            "--user",
            "jake",
            "--group",
            "jake",
            "--",
            "/usr/bin/sha256sum",
            str(args.job),
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode != 0:
        raise SystemExit("worker service user cannot read the published rehearsal job")
    worker_digest = result.stdout.split()[0] if result.stdout.split() else ""
    direct_digest = hashlib.sha256(args.job.read_bytes()).hexdigest()
    if worker_digest != args.expected_job_sha256 or direct_digest != args.expected_job_sha256:
        raise SystemExit("rehearsal job bytes differ across the worker boundary")

    atomic_json(
        args.proof,
        {
            "schemaVersion": "cortex.learning_os.phd_launch_rehearsal_remote_proof.v1",
            "status": "worker_running",
            "trialId": args.trial_id,
            "nonce": args.nonce,
            "jobPath": str(args.job),
            "jobSha256": direct_digest,
            "serviceEuid": os.geteuid(),
            "workerReadAs": "jake:jake",
            "providerCalls": 0,
            "modelExecutableInvoked": False,
            "observedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "truthBoundary": "This is a zero-provider launch-topology canary, not learning or qualification evidence.",
        },
    )
    time.sleep(max(5.0, min(args.hold_seconds, 60.0)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
