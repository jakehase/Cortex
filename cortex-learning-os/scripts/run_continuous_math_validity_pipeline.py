#!/usr/bin/env python3
"""Control-plane supervisor for the full 288-concept near-term validity lane."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
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
    repo = args.repo_root.resolve()
    clos = repo / "cortex-learning-os"
    if not repo.is_dir() or not clos.is_dir():
        raise ValidityPipelineError("validity source repository is unavailable")
    for target, label, owner_only in (
        (args.approved_model_executable_binding, "approved model executable binding", False),
        (args.state_root / "mastery.json", "signed acquisition state", False),
        (args.state_root / "mastery.hmac", "acquisition signing secret", True),
        (args.authority_root / "bank-authoring.private.pem", "bank authoring key", True),
        (args.authority_root / "bank-review.private.pem", "bank review key", True),
        (args.authority_root / "proctor.private.pem", "proctor key", True),
        (args.authority_root / "grader.private.pem", "grader key", True),
    ):
        stat = target.lstat()
        if not target.is_file() or target.is_symlink() or (owner_only and stat.st_mode & 0o077):
            raise ValidityPipelineError(f"{label} must be {'owner-only ' if owner_only else ''}regular material")

    source_commit = run(["git", "-C", repo, "rev-parse", "HEAD^{commit}"], timeout=30).strip()
    source_tree = run(["git", "-C", repo, "rev-parse", "HEAD^{tree}"], timeout=30).strip()
    product_tree = run(["git", "-C", repo, "rev-parse", "HEAD:cortex-learning-os"], timeout=30).strip()
    source = {"sourceCommit": source_commit, "sourceTree": source_tree, "productTree": product_tree}
    if not all(COMMIT.fullmatch(value) for value in source.values()):
        raise ValidityPipelineError("local validity source identity is invalid")
    if run(["git", "-C", repo, "status", "--porcelain=v1", "--untracked-files=all"], timeout=30).strip():
        raise ValidityPipelineError("local validity source worktree must be clean")
    origin = run(["git", "-C", repo, "ls-remote", "origin", args.source_ref], timeout=60).split()
    if not origin or origin[0] != source_commit:
        raise ValidityPipelineError("exact validity source commit is not pushed to the approved source ref")

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
            or state.get("status") in {"completed", "blocked"}
        ):
            if state.get("status") == "completed":
                print(json.dumps(state, indent=2, sort_keys=True))
                return 0
            raise ValidityPipelineError("validity pipeline resume boundary changed or is terminal")
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
                "frozenAt": now(),
                "localWorktreeClean": True,
            })
        elif read(source_freeze).get("source") != source:
            raise ValidityPipelineError("persisted validity source freeze differs from current source")

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

        remote_source_root = f"{args.remote_source_base}/{args.campaign_id}/source"
        remote_source_parent = f"{args.remote_source_base}/{args.campaign_id}"
        remote_clos = f"{remote_source_root}/cortex-learning-os"
        remote_runtime = f"{args.remote_runtime_base}/{args.campaign_id}"
        remote_inputs = f"{remote_runtime}/inputs"
        remote_spec = f"{remote_inputs}/validity.commissioning-spec.json"
        remote_binding = f"{remote_inputs}/approved-model-executable.json"
        remote_commission = f"{remote_runtime}/commissioning"
        remote_commission_state = f"{remote_commission}/state.json"
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
        ssh("install", "-d", "-m", "700", remote_runtime, remote_inputs, timeout=30, label="remote-runtime-root")
        run(["scp", "-q", "-o", "BatchMode=yes", spec_path, f"{args.remote_host}:{remote_spec}"], timeout=120, log_root=logs, label="sync-spec")
        run(["scp", "-q", "-o", "BatchMode=yes", args.approved_model_executable_binding, f"{args.remote_host}:{remote_binding}"], timeout=120, log_root=logs, label="sync-binding")
        ssh("chmod", "600", remote_spec, remote_binding, timeout=30, label="remote-input-modes")
        approved = read(args.approved_model_executable_binding)
        approved_codex = str(approved.get("path") or "")
        if not re.fullmatch(r"/opt/cortex-learning-os/approved-model-executors/[0-9a-f]{64}/codex", approved_codex):
            raise ValidityPipelineError("approved model executable binding path is invalid")
        ssh("test", "-x", approved_codex, timeout=30, label="remote-approved-codex")
        ssh(approved_codex, "login", "status", timeout=60, label="remote-codex-auth")
        key_mode = ssh("stat", "-c", "%U:%G:%a", args.remote_execution_private_key, timeout=30, label="remote-execution-key").strip()
        if key_mode != "jake:jake:600":
            raise ValidityPipelineError("remote execution authority private key is not jake-owned owner-only material")

        remote_commission_terminal = remote_json(remote_commission_state)
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
        remote_commission_return = args.artifact_root / "remote-commissioning"
        remote_commission_return.mkdir(parents=True, exist_ok=True, mode=0o700)
        run([
            "rsync", "-a", "--delete", "--chmod=Du=rwx,Dgo=,Fu=rw,Fgo=", "--protect-args",
            f"{args.remote_host}:{remote_commission}/", f"{remote_commission_return}/",
        ], timeout=1800, log_root=logs, label="commission-return")
        commissioned_content = remote_commission_return / "commissioned-content.json"
        commissioned = read(commissioned_content)
        if commissioned.get("conceptCount") != 288 or commissioned.get("itemCount") != 576:
            raise ValidityPipelineError("returned validity content is not exact 288/576 coverage")

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
            "blocker": str(error),
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
            blockerReport=str(blocker_path),
        )
        print(json.dumps(state, indent=2, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
