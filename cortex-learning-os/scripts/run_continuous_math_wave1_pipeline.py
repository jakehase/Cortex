#!/usr/bin/env python3
"""Control-plane supervisor for continuous mathematics expansion wave 1."""
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

SCHEMA = "cortex.learning_os.continuous_math_wave1_pipeline.v1"
SOURCE_REF_RE = re.compile(r"^refs/heads/[A-Za-z0-9._/-]+$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
PURPOSES = ("acquisition", "validity", "retention")


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def atomic(path: Path, payload: dict[str, Any]) -> None:
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


def read(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"JSON object required: {path}")
    return value


def run(command: list[str | Path], *, cwd: Path | None = None, timeout: float = 1800, log_root: Path | None = None, label: str = "command") -> str:
    result = subprocess.run([str(item) for item in command], cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False)
    if log_root:
        log_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        (log_root / f"{label}.stdout.log").write_text(result.stdout, encoding="utf-8")
        (log_root / f"{label}.stderr.log").write_text(result.stderr, encoding="utf-8")
        os.chmod(log_root / f"{label}.stdout.log", 0o600)
        os.chmod(log_root / f"{label}.stderr.log", 0o600)
    if result.returncode != 0:
        detail = (result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}")[-4000:]
        raise RuntimeError(f"{label} failed: {detail}")
    return result.stdout


def parse_json_output(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise RuntimeError("command returned no JSON object")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--pipeline-id", required=True)
    result.add_argument("--artifact-root", required=True, type=Path)
    result.add_argument("--state-file", required=True, type=Path)
    result.add_argument("--repo-root", required=True, type=Path)
    result.add_argument("--cohort-plan", required=True, type=Path)
    result.add_argument("--source-ref", default="refs/heads/feat/cortex-learning-os-continuous-math-evidence-20260808")
    result.add_argument("--remote-host", default="root@37.27.129.239")
    result.add_argument("--remote-repo", default="/home/jake/clawd-remote", type=Path)
    result.add_argument("--state-root", default="/root/.openclaw/cortex-learning-os", type=Path)
    result.add_argument("--commission-wall-seconds", default=21600, type=int)
    result.add_argument("--acquisition-wall-seconds", default=21600, type=int)
    return result


def main() -> int:
    args = parser().parse_args()
    clos = args.repo_root / "cortex-learning-os"
    if not re.fullmatch(r"continuous-math-wave1-[0-9]{8}T[0-9]{6}Z", args.pipeline_id):
        raise RuntimeError("invalid pipeline identity")
    if not SOURCE_REF_RE.fullmatch(args.source_ref) or ".." in args.source_ref:
        raise RuntimeError("unsafe source ref")
    if not re.fullmatch(r"root@[A-Za-z0-9._:-]+", args.remote_host):
        raise RuntimeError("unsafe remote host")
    if args.state_file.exists() or args.artifact_root.exists():
        raise RuntimeError("pipeline state/artifact root must be fresh")
    args.artifact_root.mkdir(parents=True, mode=0o700)
    os.chmod(args.artifact_root, 0o700)
    logs = args.artifact_root / "logs"
    state: dict[str, Any] = {
        "schemaVersion": SCHEMA,
        "pipelineId": args.pipeline_id,
        "status": "preparing",
        "reason": "freezing exact source and bank commissioning inputs",
        "artifactRoot": str(args.artifact_root),
        "startedAt": now(),
        "updatedAt": now(),
        "sourceRef": args.source_ref,
        "remotePlacement": "Hetzner clawd-exec-hel1",
        "truthBoundary": "Pipeline completion can advance acquired-once evidence only. Validity and retention remain separate scored and elapsed-time lanes.",
    }
    atomic(args.state_file, state)

    def update(status: str, reason: str, **extra: Any) -> None:
        state.update(status=status, reason=reason, updatedAt=now(), **extra)
        atomic(args.state_file, state)

    try:
        source_commit = run(["git", "rev-parse", "HEAD"], cwd=args.repo_root, timeout=30).strip()
        source_tree = run(["git", "rev-parse", "HEAD^{tree}"], cwd=args.repo_root, timeout=30).strip()
        product_tree = run(["git", "rev-parse", "HEAD:cortex-learning-os"], cwd=args.repo_root, timeout=30).strip()
        if not COMMIT_RE.fullmatch(source_commit) or not COMMIT_RE.fullmatch(source_tree) or not COMMIT_RE.fullmatch(product_tree):
            raise RuntimeError("invalid exact source identity")
        if run(["git", "status", "--porcelain"], cwd=args.repo_root, timeout=30).strip():
            raise RuntimeError("pipeline source worktree is dirty")
        origin_source = run(["git", "ls-remote", "origin", args.source_ref], cwd=args.repo_root, timeout=60).split()
        if not origin_source or origin_source[0] != source_commit:
            raise RuntimeError("exact source commit is not pushed to the approved source ref")
        source = {"sourceCommit": source_commit, "sourceTree": source_tree, "productTree": product_tree}
        state["source"] = source
        source_path = args.artifact_root / "source-freeze.json"
        atomic(source_path, {"schemaVersion": "cortex.learning_os.continuous_math_wave1_source_freeze.v1", "source": source, "sourceRef": args.source_ref, "frozenAt": now()})

        spec_root = args.artifact_root / "commissioning-specs"
        output = run([
            "node", clos / "src/continuous-math-bank-spec.mjs",
            "--out-root", spec_root,
            "--cohort-plan", args.cohort_plan,
            "--campaign-prefix", f"continuous-math-wave1-20260809",
        ], cwd=clos, timeout=120, log_root=logs, label="build-specs")
        spec_result = parse_json_output(output)
        if not spec_result.get("ok"):
            raise RuntimeError("bank commissioning specs did not freeze")
        update("syncing_remote", "synchronizing exact pushed source and secretless commissioning specs to Hetzner", source=source)

        remote_mirror = str(args.remote_repo)
        remote_base = f"/home/jake/{args.pipeline_id}"
        remote_repo = f"{remote_base}/source"
        remote_clos = f"{remote_repo}/cortex-learning-os"
        remote_root = f"{remote_base}/run"
        run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host,
             "test", "!", "-e", remote_base], timeout=30, log_root=logs, label="remote-root-preflight")
        run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host,
             "sudo", "-u", "jake", "--", "git", "-C", remote_mirror, "fetch", "origin", args.source_ref], timeout=180, log_root=logs, label="remote-fetch")
        run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host,
             "install", "-d", "-m", "700", "-o", "jake", "-g", "jake", remote_base], timeout=30)
        run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host,
             "sudo", "-u", "jake", "--", "git", "-C", remote_mirror, "worktree", "add", "--detach", remote_repo, source_commit], timeout=180, log_root=logs, label="remote-worktree")
        remote_head = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host,
                           "sudo", "-u", "jake", "--", "git", "-C", remote_repo, "rev-parse", "HEAD"], timeout=30).strip()
        if remote_head != source_commit:
            raise RuntimeError("remote exact source checkout failed")
        run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host,
             "install", "-d", "-m", "700", "-o", "jake", "-g", "jake", remote_root, f"{remote_root}/specs"], timeout=30)
        marker_tmp = args.artifact_root / "CORTEX_LEARNING_OS_SOURCE_COMMIT"
        marker_tmp.write_text(f"{source_commit}\n", encoding="utf-8")
        os.chmod(marker_tmp, 0o600)
        run(["scp", "-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", marker_tmp, f"{args.remote_host}:{remote_repo}/CORTEX_LEARNING_OS_SOURCE_COMMIT"], timeout=60)
        run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host,
             "chown", "jake:jake", f"{remote_repo}/CORTEX_LEARNING_OS_SOURCE_COMMIT"], timeout=30)
        run(["rsync", "-a", "--chmod=Du=rwx,Dgo=,Fu=rw,Fgo=", f"{spec_root}/", f"{args.remote_host}:{remote_root}/specs/"], timeout=120, log_root=logs, label="remote-spec-sync")
        run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host,
             "chown", "-R", "jake:jake", remote_root], timeout=60)

        remote_state = f"{remote_root}/supervisor-state.json"
        unit = f"clos-{args.pipeline_id}-commission"
        update("commissioning", "three role-isolated author/reviewer lanes are running on Hetzner", remoteCommissioningState=remote_state, remoteUnit=unit)
        run([
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host,
            "systemd-run", f"--unit={unit}", "--collect", "--quiet",
            "--property=User=jake", "--property=Group=jake", f"--working-directory={remote_clos}",
            "/usr/bin/python3", f"{remote_clos}/scripts/supervise_continuous_math_commissioning.py",
            "--root", remote_root, "--clos-root", remote_clos, "--spec-root", f"{remote_root}/specs",
            "--codex", "/home/jake/.local/bin/codex", "--max-wall-seconds", str(args.commission_wall_seconds),
        ], timeout=60, log_root=logs, label="remote-commission-launch")
        deadline = time.monotonic() + args.commission_wall_seconds + 300
        remote_terminal: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.remote_host, "cat", remote_state], capture_output=True, text=True, timeout=30, check=False)
            if result.returncode == 0:
                remote_terminal = json.loads(result.stdout)
                state["commissioning"] = {
                    "status": remote_terminal.get("status"),
                    "providerCallsStarted": sum(int(row.get("providerCallsStarted", 0)) for row in remote_terminal.get("lanes", {}).values()),
                    "providerCallsCompleted": sum(int(row.get("providerCallsCompleted", 0)) for row in remote_terminal.get("lanes", {}).values()),
                    "acceptedItems": sum(int(row.get("acceptedItems", 0)) for row in remote_terminal.get("lanes", {}).values()),
                }
                state["updatedAt"] = now()
                atomic(args.state_file, state)
                if remote_terminal.get("status") in {"completed", "blocked"}:
                    break
            time.sleep(15)
        if not remote_terminal or remote_terminal.get("status") != "completed":
            raise RuntimeError(f"remote commissioning blocked: {(remote_terminal or {}).get('blocker') or 'timeout'}")
        remote_return = args.artifact_root / "remote-return"
        run(["rsync", "-a", "--chmod=Du=rwx,Dgo=,Fu=rw,Fgo=", f"{args.remote_host}:{remote_root}/", f"{remote_return}/"], timeout=900, log_root=logs, label="remote-return")

        update("signing", "commissioned content returned; applying four separated local signature gates")
        base_revision = int(read(args.state_root / "mastery.json")["revision"])
        authority_root = args.state_root / "production-authorities/clos-phd-production-20260802-v1"
        author_key = authority_root / "bank-authoring.private.pem"
        reviewer_key = authority_root / "bank-review.private.pem"
        bank_paths: dict[str, str] = {}
        bank_reports: dict[str, Any] = {}
        for purpose in PURPOSES:
            content_path = remote_return / purpose / "commissioned-content.json"
            signing = args.artifact_root / "signing" / purpose
            signing.mkdir(parents=True, mode=0o700)
            unsigned = signing / "00-unsigned-envelope.json"
            item_author = signing / "01-item-author-envelope.json"
            item_reviewer = signing / "02-item-reviewer-envelope.json"
            bank_author = signing / "03-bank-author-envelope.json"
            signed = signing / "04-signed-bank-envelope.json"
            run(["node", clos / "src/continuous-math-bank-assemble.mjs", content_path, unsigned, str(base_revision)], cwd=args.repo_root, timeout=300, log_root=logs, label=f"assemble-{purpose}")
            run(["node", clos / "src/continuous-math-bank-sign.mjs", "item-author", unsigned, item_author, author_key], cwd=args.repo_root, timeout=300, log_root=logs, label=f"sign-item-author-{purpose}")
            run(["node", clos / "src/continuous-math-bank-sign.mjs", "item-reviewer", item_author, item_reviewer, reviewer_key], cwd=args.repo_root, timeout=300, log_root=logs, label=f"sign-item-reviewer-{purpose}")
            run(["node", clos / "src/continuous-math-bank-sign.mjs", "bank-author", item_reviewer, bank_author, author_key], cwd=args.repo_root, timeout=300, log_root=logs, label=f"sign-bank-author-{purpose}")
            run(["node", clos / "src/continuous-math-bank-sign.mjs", "bank-reviewer", bank_author, signed, reviewer_key], cwd=args.repo_root, timeout=300, log_root=logs, label=f"sign-bank-reviewer-{purpose}")
            campaign_id = read(content_path)["campaignId"]
            bank_output = args.state_root / "assessment-banks" / f"{campaign_id}.json"
            report_output = args.artifact_root / "bank-reports" / f"{purpose}.json"
            run(["node", clos / "src/continuous-math-bank-validate.mjs", signed, content_path, bank_output, report_output], cwd=args.repo_root, timeout=600, log_root=logs, label=f"validate-{purpose}")
            report = read(report_output)
            if report.get("status") != "green":
                raise RuntimeError(f"{purpose} bank did not validate green")
            bank_paths[purpose] = str(bank_output)
            bank_reports[purpose] = report
        state["bankPaths"] = bank_paths
        state["bankReports"] = {purpose: {"bankId": row["bankId"], "bankDigest": row["bankDigest"], "conceptCount": row["conceptCount"], "itemCount": row["itemCount"], "providerCallCount": row["providerCallCount"]} for purpose, row in bank_reports.items()}
        atomic(args.state_file, state)

        update("migrating", "all three banks are valid; applying additive signed mastery migration")
        target_graph = clos / "capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json"
        source_graph = clos / "capsules/math-foundations/curriculum.phd-trajectory-v1.0.0-264.graph.json"
        policy = clos / "policies/adaptive-math-phd-v1.json"
        mastery = read(args.state_root / "mastery.json")
        if len(mastery.get("concepts", {})) == 264:
            freeze = parse_json_output(run([
                "node", clos / "src/live-control.mjs", "adaptive-migration-freeze",
                "--state-root", args.state_root,
                "--source-graph", source_graph, "--target-graph", target_graph,
                "--source-policy", policy, "--target-policy", policy,
            ], cwd=args.repo_root, timeout=180, log_root=logs, label="migration-freeze"))
            audit_path = args.state_root / "audits" / f"{args.pipeline_id}-additive.json"
            migrate = parse_json_output(run([
                "node", clos / "src/live-control.mjs", "adaptive-migrate-additive",
                "--state-root", args.state_root,
                "--source-graph", source_graph, "--target-graph", target_graph,
                "--source-policy", policy, "--target-policy", policy,
                "--audit-out", audit_path,
                "--source-commit", freeze["sourceCommit"], "--expected-source-commit", freeze["sourceCommit"],
                "--source-tree", freeze["sourceTree"], "--expected-source-tree", freeze["sourceTree"],
                "--expected-source-revision", str(freeze["expectedSourceRevision"]),
                "--expected-source-state-digest", freeze["expectedSourceStateDigest"],
                "--expected-source-graph-digest", freeze["expectedSourceGraphDigest"],
                "--expected-source-policy-digest", freeze["expectedSourcePolicyDigest"],
                "--expected-target-graph-digest", freeze["expectedTargetGraphDigest"],
                "--expected-target-policy-digest", freeze["expectedTargetPolicyDigest"],
            ], cwd=args.repo_root, timeout=300, log_root=logs, label="migration-apply"))
            state["migration"] = migrate
        elif len(mastery.get("concepts", {})) == 288:
            state["migration"] = {"alreadyApplied": True, "acquisitionRevision": mastery["revision"]}
        else:
            raise RuntimeError("live mastery concept count is neither source 264 nor target 288")
        atomic(args.state_file, state)

        update("auditing", "signed 288-row state and current-deployment banks are under read-only readiness audit")
        audit_root = args.artifact_root / "post-bank-phase0"
        audit = parse_json_output(run([
            "node", clos / "src/continuous-math-phase0-audit.mjs",
            "--artifact-root", audit_root,
            "--state-root", args.state_root,
            "--live-plugin-root", "/root/clawd/plugins/cortex-learning-os-live",
            "--remote-host", "jake@37.27.129.239",
            "--remote-root", remote_clos,
            "--remote-codex", "/home/jake/.local/bin/codex",
        ], cwd=args.repo_root, timeout=600, log_root=logs, label="post-bank-phase0"))
        if not audit.get("ok") or not audit.get("nextLearningExecutionReady"):
            raise RuntimeError(f"post-bank readiness audit blocked: {audit.get('readinessBlockers')}")
        state["postBankAudit"] = audit
        atomic(args.state_file, state)

        update("acquiring", "first bounded 24-concept acquisition continuation is running on Hetzner", acquisitionState=None)
        continuation_id = f"math-acceleration-{args.pipeline_id.removeprefix('continuous-math-wave1-')}-cmw001"
        continuation_state = args.artifact_root / "acquisition-continuation-state.json"
        acquisition_command = [
            "/usr/bin/python3", clos / "scripts/continue_parallel_adaptive_math.py",
            "--continuation-id", continuation_id,
            "--state-file", continuation_state,
            "--launcher", clos / "scripts/launch-parallel-adaptive-wave.sh",
            "--acquisition-state", args.state_root / "mastery.json",
            "--source-marker", args.repo_root / "CORTEX_LEARNING_OS_SOURCE_COMMIT",
            "--source-ref", args.source_ref,
            "--repo-root", args.repo_root,
            "--remote-repo", remote_repo,
            "--graph", target_graph,
            "--policy", policy,
            "--capsule", clos / "capsules/math-foundations/capsule.json",
            "--assessment-bank", bank_paths["acquisition"],
            "--approved-model-executable-binding", args.state_root / "approved-model-executable.json",
            "--remote-graph", f"{remote_clos}/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json",
            "--remote-policy", f"{remote_clos}/policies/adaptive-math-phd-v1.json",
            "--remote-capsule", f"{remote_clos}/capsules/math-foundations/capsule.json",
            "--concurrency", "4", "--max-waves", "20", "--max-sessions", "48",
            "--max-wall-seconds", str(args.acquisition_wall_seconds),
            "--wave-timeout-seconds", "3600", "--poll-seconds", "15",
        ]
        acquisition_output = run(acquisition_command, cwd=args.repo_root, timeout=args.acquisition_wall_seconds + 900, log_root=logs, label="acquisition-continuation")
        acquisition = parse_json_output(acquisition_output)
        state["acquisition"] = acquisition
        if acquisition.get("status") != "completed":
            raise RuntimeError(f"bounded acquisition continuation blocked: {acquisition.get('reason')}")

        final_mastery = read(args.state_root / "mastery.json")
        acquired_added = [concept_id for concept_id in read(args.state_root / "audits" / f"{args.pipeline_id}-additive.json")["addedConceptIds"] if final_mastery["concepts"][concept_id]["state"] == "acquired"]
        completion = {
            "schemaVersion": "cortex.learning_os.continuous_math_wave1_completion.v1",
            "pipelineId": args.pipeline_id,
            "completedAt": now(),
            "source": source,
            "bankReports": state["bankReports"],
            "addedConceptCount": 24,
            "addedAcquiredOnceCount": len(acquired_added),
            "validityConfirmedCount": 0,
            "retentionR7ConfirmedCount": 0,
            "modelWeightLearningClaim": False,
            "nextActions": [
                "Run the sealed disjoint validity packs in fresh sessions 24-72 hours after each new acquisition.",
                "Release R7 retention windows only after real elapsed-time gates and disjoint commitments mature.",
                "Keep new transfer profiles inactive until evidence-tier policy permits them.",
            ],
            "truthBoundary": "Completion records acquired-once evidence only; commissioned validity and retention banks are future probes, not passes.",
        }
        completion_path = args.artifact_root / "completion-summary.json"
        atomic(completion_path, completion)
        update("completed", "wave-1 acquisition reached its bounded terminal frontier; validity and elapsed retention remain scheduled", completedAt=now(), completionSummary=str(completion_path), addedAcquiredOnceCount=len(acquired_added))
        return 0
    except Exception as error:
        blocker = {"schemaVersion": "cortex.learning_os.continuous_math_wave1_blocker.v1", "pipelineId": args.pipeline_id, "blockedAt": now(), "blocker": str(error), "statusAtFailure": state.get("status"), "truthBoundary": "A blocker is not a partial pass and no missing evidence layer may be inferred."}
        blocker_path = args.artifact_root / "blocker-report.json"
        atomic(blocker_path, blocker)
        update("blocked", str(error), completedAt=now(), blockerReport=str(blocker_path))
        raise


if __name__ == "__main__":
    raise SystemExit(main())
