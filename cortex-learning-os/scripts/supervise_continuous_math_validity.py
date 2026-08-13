#!/usr/bin/env python3
"""Run the bounded 288-concept validity candidate farm on Hetzner."""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
from typing import Any

SCHEMA = "cortex.learning_os.remote_validity_supervisor.v1"
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
VALIDITY_MODEL_RUNTIME = {
    "provider": "openai-codex",
    "model": "gpt-5.6-sol",
    "thinking": "ultra",
    "serviceTier": "fast",
    "sandbox": "read-only",
    "toolsAllowed": False,
}
LOCK = threading.Lock()


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
    stat = path.lstat()
    if not path.is_file() or path.is_symlink() or stat.st_size < 1 or stat.st_size > 128 * 1024 * 1024:
        raise RuntimeError(f"unsafe JSON input: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"JSON object required: {path}")
    return value


def exact_json(left: Any, right: Any) -> bool:
    return json.dumps(left, sort_keys=True, separators=(",", ":")) == json.dumps(
        right, sort_keys=True, separators=(",", ":")
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(repo: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["/usr/bin/git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *arguments],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
        env={
            **os.environ,
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_OPTIONAL_LOCKS": "0",
            "GIT_PAGER": "cat",
            "GIT_TERMINAL_PROMPT": "0",
            "LANG": "C",
            "LC_ALL": "C",
            "TZ": "UTC",
        },
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"git exited {result.returncode}")
    return result.stdout.strip()


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--root", required=True, type=Path)
    result.add_argument("--source-root", required=True, type=Path)
    result.add_argument("--plan", required=True, type=Path)
    result.add_argument("--bank", required=True, type=Path)
    result.add_argument("--approved-model-executable-binding", required=True, type=Path)
    result.add_argument("--execution-private-key", required=True, type=Path)
    result.add_argument("--codex-command", required=True)
    result.add_argument("--concurrency", default=8, type=int)
    result.add_argument("--session-timeout-seconds", default=1800, type=int)
    return result


def main() -> int:
    args = parser().parse_args()
    if not 1 <= args.concurrency <= 8:
        raise RuntimeError("validity concurrency must be 1..8")
    if not 60 <= args.session_timeout_seconds <= 1800:
        raise RuntimeError("validity session timeout must be 60..1800 seconds")
    if not re.fullmatch(r"/[A-Za-z0-9._/-]+", args.codex_command) or ".." in args.codex_command:
        raise RuntimeError("unsafe approved model executable path")
    if args.root.exists():
        raise RuntimeError("remote validity runtime root must be fresh")
    for target, label, owner_only in (
        (args.plan, "validity plan", False),
        (args.bank, "validity bank", False),
        (args.approved_model_executable_binding, "approved executable binding", False),
        (args.execution_private_key, "execution authority private key", True),
    ):
        stat = target.lstat()
        if not target.is_file() or target.is_symlink() or (owner_only and stat.st_mode & 0o077):
            raise RuntimeError(f"{label} must be {'owner-only ' if owner_only else ''}regular material")
    plan = read(args.plan)
    bank = read(args.bank)
    binding = read(args.approved_model_executable_binding)
    if binding.get("path") != args.codex_command:
        raise RuntimeError("requested model executable differs from the approved binding")
    if not exact_json(plan.get("modelRuntime"), VALIDITY_MODEL_RUNTIME):
        raise RuntimeError("signed validity plan model runtime differs from the frozen production runtime")
    source = plan.get("source") or {}
    if (
        not COMMIT.fullmatch(str(source.get("sourceCommit") or ""))
        or not COMMIT.fullmatch(str(source.get("sourceTree") or ""))
        or not COMMIT.fullmatch(str(source.get("productTree") or ""))
    ):
        raise RuntimeError("validity plan source identity is invalid")
    observed = {
        "sourceCommit": git(args.source_root, "rev-parse", "HEAD^{commit}"),
        "sourceTree": git(args.source_root, "rev-parse", "HEAD^{tree}"),
        "productTree": git(args.source_root, "rev-parse", "HEAD:cortex-learning-os"),
    }
    if observed != source:
        raise RuntimeError("remote validity source commit/tree/product-tree differs from the signed plan")
    if git(args.source_root, "status", "--porcelain=v1", "--untracked-files=all"):
        raise RuntimeError("remote validity source checkout is dirty before launch")
    sessions = plan.get("sessions")
    if (
        plan.get("schemaVersion") != "cortex.learning_os.validity_plan.v1"
        or not SAFE_ID.fullmatch(str(plan.get("campaignId") or ""))
        or not isinstance(sessions, list)
        or len(sessions) != 288
        or len({row.get("conceptId") for row in sessions if isinstance(row, dict)}) != 288
        or bank.get("bankDigest") != (plan.get("bank") or {}).get("bankDigest")
        or sha256(args.bank) != (plan.get("bank") or {}).get("bankSha256")
    ):
        raise RuntimeError("remote validity plan, bank, or exact 288-session surface is invalid")

    args.root.mkdir(parents=True, mode=0o700)
    os.chmod(args.root, 0o700)
    sessions_root = args.root / "sessions"
    logs_root = args.root / "logs"
    sessions_root.mkdir(mode=0o700)
    logs_root.mkdir(mode=0o700)
    state_path = args.root / "supervisor-state.json"
    state: dict[str, Any] = {
        "schemaVersion": SCHEMA,
        "status": "running",
        "campaignId": plan["campaignId"],
        "planSha256": plan.get("planSha256"),
        "source": source,
        "bank": plan.get("bank"),
        "artifactRoot": str(args.root),
        "placement": "hetzner",
        "concurrency": args.concurrency,
        "totalSessions": len(sessions),
        "completedSessions": 0,
        "candidateSessions": 0,
        "failedSessions": 0,
        "providerCallsCompleted": 0,
        "startedAt": now(),
        "updatedAt": now(),
        "results": [],
        "truthBoundary": "This execution-plane supervisor records candidate session completion only. It cannot grade, sign, or qualify validity state.",
    }
    atomic(state_path, state)
    results: list[dict[str, Any]] = []

    def publish(result: dict[str, Any]) -> None:
        with LOCK:
            results.append(result)
            ordered = sorted(results, key=lambda row: int(row["index"]))
            state.update(
                completedSessions=len(ordered),
                candidateSessions=sum(row.get("status") == "candidate" for row in ordered),
                failedSessions=sum(row.get("status") == "failed" for row in ordered),
                providerCallsCompleted=sum(row.get("status") == "candidate" for row in ordered),
                updatedAt=now(),
                results=ordered,
            )
            atomic(state_path, state)

    def execute(index: int, session: dict[str, Any]) -> dict[str, Any]:
        concept_id = str(session.get("conceptId") or "")
        if not SAFE_ID.fullmatch(concept_id):
            return {"index": index, "conceptId": concept_id, "status": "failed", "reason": "invalid concept identity"}
        relative = f"sessions/{index:03d}-{concept_id}"
        artifact = args.root / relative
        stdout_path = logs_root / f"{index:03d}-{concept_id}.stdout.log"
        stderr_path = logs_root / f"{index:03d}-{concept_id}.stderr.log"
        command = [
            "/usr/bin/node",
            str(args.source_root / "cortex-learning-os/src/run-continuous-math-validity-session.mjs"),
            "--plan", str(args.plan),
            "--bank", str(args.bank),
            "--artifact-root", str(artifact),
            "--approved-model-executable-binding", str(args.approved_model_executable_binding),
            "--execution-private-key", str(args.execution_private_key),
            "--concept-id", concept_id,
            "--codex-command", args.codex_command,
            "--timeout-seconds", str(args.session_timeout_seconds),
        ]
        with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
            try:
                completed = subprocess.run(
                    command,
                    cwd=args.source_root / "cortex-learning-os",
                    stdin=subprocess.DEVNULL,
                    stdout=stdout,
                    stderr=stderr,
                    timeout=args.session_timeout_seconds + 120,
                    check=False,
                    env={**os.environ, "HOME": str(Path.home()), "PATH": f"{Path.home()}/.local/bin:/usr/local/bin:/usr/bin:/bin"},
                )
            except subprocess.TimeoutExpired:
                return {
                    "index": index,
                    "conceptId": concept_id,
                    "status": "failed",
                    "reason": "validity candidate process exceeded its bounded timeout",
                    "artifactRelativePath": relative,
                    "completedAt": now(),
                }
        if completed.returncode != 0:
            return {
                "index": index,
                "conceptId": concept_id,
                "status": "failed",
                "reason": f"validity candidate process exited {completed.returncode}; inspect {stderr_path}",
                "artifactRelativePath": relative,
                "completedAt": now(),
            }
        try:
            receipt = read(artifact / "worker_receipt.json")
            manifest = artifact / "artifact_manifest.json"
            if (
                receipt.get("status") != "candidate"
                or receipt.get("conceptId") != concept_id
                or receipt.get("placement") != "hetzner"
                or receipt.get("planSha256") != plan.get("planSha256")
                or not exact_json(receipt.get("modelRuntime"), VALIDITY_MODEL_RUNTIME)
                or not manifest.is_file()
                or manifest.is_symlink()
            ):
                raise RuntimeError("worker receipt identity is invalid")
            return {
                "index": index,
                "conceptId": concept_id,
                "status": "candidate",
                "artifactRelativePath": relative,
                "artifactManifestSha256": sha256(manifest),
                "executionEvidenceSha256": receipt.get("executionEvidenceSha256"),
                "startedAt": receipt.get("startedAt"),
                "completedAt": receipt.get("completedAt"),
            }
        except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
            return {
                "index": index,
                "conceptId": concept_id,
                "status": "failed",
                "reason": f"candidate artifact receipt failed preflight: {error}",
                "artifactRelativePath": relative,
                "completedAt": now(),
            }

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = {
                pool.submit(execute, index, session): index
                for index, session in enumerate(sessions, 1)
            }
            for future in concurrent.futures.as_completed(futures):
                try:
                    publish(future.result())
                except Exception as error:  # one child must not erase the remaining assessment surface
                    index = futures[future]
                    session = sessions[index - 1]
                    publish({
                        "index": index,
                        "conceptId": session.get("conceptId"),
                        "status": "failed",
                        "reason": f"unhandled bounded candidate failure: {error}",
                        "completedAt": now(),
                    })
        if len(results) != len(sessions):
            raise RuntimeError("remote validity supervisor lost one or more session results")
        if git(args.source_root, "status", "--porcelain=v1", "--untracked-files=all"):
            raise RuntimeError("remote source checkout became dirty during external-root execution")
        state.update(
            status="completed",
            completedAt=now(),
            updatedAt=now(),
            results=sorted(results, key=lambda row: int(row["index"])),
            reason="all 288 candidate sessions reached a bounded terminal result; independent control-plane replay and grading remain pending",
        )
        atomic(state_path, state)
        return 0
    except Exception as error:
        state.update(
            status="failed",
            reason=str(error)[:3000],
            completedAt=now(),
            updatedAt=now(),
            results=sorted(results, key=lambda row: int(row["index"])),
        )
        atomic(state_path, state)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
