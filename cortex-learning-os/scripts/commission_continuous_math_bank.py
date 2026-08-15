#!/usr/bin/env python3
"""Commission one role-isolated continuous-math bank on the execution plane."""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
from typing import Any

SCHEMA = "cortex.learning_os.continuous_math_bank_commissioning_state.v1"
SPEC_SCHEMA = "cortex.learning_os.continuous_math_bank_commissioning_spec.v1"
OUTPUT_SCHEMA = "cortex.learning_os.commissioned_assessment_content.v2"
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
LOCK = threading.Lock()
PROGRESS: dict[str, Any] = {}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True, ensure_ascii=False)
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


def read_json(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 64 * 1024 * 1024:
        raise RuntimeError(f"unsafe JSON input: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"JSON object required: {path}")
    return value


def exact_json(left: Any, right: Any) -> bool:
    return json.dumps(left, sort_keys=True, separators=(",", ":"), ensure_ascii=False) == json.dumps(
        right, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def update_state(state_path: Path, **changes: Any) -> None:
    with LOCK:
        PROGRESS.update(changes)
        PROGRESS["updatedAt"] = utc_now()
        atomic_json(state_path, PROGRESS)


def canonical_expected(text: str) -> Any:
    value = json.loads(text)
    if json.dumps(value, ensure_ascii=False, separators=(",", ":")) != text:
        raise ValueError("expectedJson is not canonical JSON")
    return value


def validate_checker(row: dict[str, Any]) -> None:
    checker = row["checker"]
    value = canonical_expected(checker["expectedJson"])
    mode = checker["mode"]
    if mode in {"exact_number", "numeric_tolerance"}:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{row['itemKey']}: numeric checker expects a number")
    elif mode == "exact_integer_string":
        if not isinstance(value, str) or not re.fullmatch(r"-?[0-9]+", value):
            raise ValueError(f"{row['itemKey']}: invalid integer-string checker")
    elif mode in {"exact_string", "multiple_choice"}:
        if not isinstance(value, str) or not value:
            raise ValueError(f"{row['itemKey']}: invalid string checker")
    elif mode == "set_equality":
        if not isinstance(value, list) or not value or any(isinstance(item, bool) or not isinstance(item, (str, int, float)) for item in value):
            raise ValueError(f"{row['itemKey']}: invalid set checker")
    elif mode == "ordered_numeric_tuple":
        if not isinstance(value, list) or not value or any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value):
            raise ValueError(f"{row['itemKey']}: invalid tuple checker")
    else:
        raise ValueError(f"{row['itemKey']}: unsupported checker mode")
    if mode != "numeric_tolerance" and checker["tolerance"] != 0:
        raise ValueError(f"{row['itemKey']}: unexpected tolerance")


def expected_items(spec: dict[str, Any], concepts: list[dict[str, Any]]) -> dict[str, tuple[dict[str, Any], dict[str, Any]]]:
    rows: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    for concept in concepts:
        for blueprint in spec["itemBlueprints"]:
            key = f"{concept['conceptId']}:{blueprint['assessmentRole']}:{blueprint['variant']}"
            rows[key] = (concept, blueprint)
    return rows


def validate_author(payload: dict[str, Any], batch_id: str, concepts: list[dict[str, Any]], spec: dict[str, Any]) -> None:
    if payload.get("batchId") != batch_id or not isinstance(payload.get("items"), list):
        raise ValueError("author batch identity or item list mismatch")
    expected = expected_items(spec, concepts)
    if len(payload["items"]) != len(expected) or {row.get("itemKey") for row in payload["items"]} != set(expected):
        raise ValueError("author did not return the exact identity-bound item set")
    prompts: set[str] = set()
    for row in payload["items"]:
        concept, blueprint = expected[row["itemKey"]]
        if row.get("conceptId") != concept["conceptId"] or row.get("assessmentRole") != blueprint["assessmentRole"] or row.get("variant") != blueprint["variant"]:
            raise ValueError(f"{row.get('itemKey')}: item identity mismatch")
        outcome_coverage = row.get("outcomeCoverage") or []
        if len(outcome_coverage) != len(set(outcome_coverage)):
            raise ValueError(f"{row['itemKey']}: duplicate outcome coverage")
        if set(outcome_coverage) != set(concept["outcomes"]):
            raise ValueError(f"{row['itemKey']}: outcome coverage mismatch")
        normalized = " ".join(row["prompt"].split()).casefold()
        if normalized in prompts:
            raise ValueError(f"{row['itemKey']}: duplicate prompt")
        prompts.add(normalized)
        validate_checker(row)


def validate_event_bytes(raw: bytes) -> dict[str, Any]:
    try:
        text = raw.decode("utf-8")
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"provider event ledger is invalid JSONL: {error}") from error
    if not rows or any(not isinstance(row, dict) for row in rows):
        raise ValueError("provider event ledger must contain JSON objects")
    started = [row for row in rows if row.get("type") == "thread.started"]
    completed = [row for row in rows if row.get("type") == "turn.completed"]
    forbidden: list[str] = []
    for row in rows:
        if row.get("type") in {"item.started", "item.completed"} and row.get("item", {}).get("type") not in {"agent_message", "reasoning"}:
            forbidden.append(str(row.get("item", {}).get("type")))
        if row.get("type") in {"command.started", "command.completed", "tool.started", "tool.completed"}:
            forbidden.append(str(row.get("type")))
    if len(started) != 1 or len(completed) != 1 or forbidden:
        raise ValueError(f"provider event ledger is incomplete or used tools: {forbidden}")
    usage = completed[0].get("usage") or {}
    if int(usage.get("input_tokens", 0)) <= 0 or int(usage.get("output_tokens", 0)) <= 0:
        raise ValueError("provider-observed token usage is missing")
    return {"threadId": started[0]["thread_id"], "usage": usage}


def validate_events(path: Path) -> dict[str, Any]:
    return validate_event_bytes(path.read_bytes())


def run_model(args: argparse.Namespace, state_path: Path, *, role: str, attempt_dir: Path, prompt: str, schema: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    attempt_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(attempt_dir, 0o700)
    prompt_path = attempt_dir / f"{role}-prompt.txt"
    output_path = attempt_dir / f"{role}-output.json"
    events_path = attempt_dir / f"{role}-events.jsonl"
    stderr_path = attempt_dir / f"{role}-stderr.log"
    prompt_path.write_text(prompt, encoding="utf-8")
    os.chmod(prompt_path, 0o600)
    command = [
        str(args.codex), "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral",
        "--sandbox", "read-only", "--skip-git-repo-check", "--cd", str(args.empty),
        "--model", args.model, "--config", f'model_reasoning_effort="{args.thinking}"',
    ]
    if args.service_tier is not None:
        command.extend(["--config", f'service_tier="{args.service_tier}"'])
    command.extend([
        "--output-schema", str(schema), "--json", "-o", str(output_path), "-",
    ])
    with LOCK:
        PROGRESS["providerCallsStarted"] += 1
        PROGRESS["updatedAt"] = utc_now()
        atomic_json(state_path, PROGRESS)
    with prompt_path.open("rb") as stdin, events_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        result = subprocess.run(command, stdin=stdin, stdout=stdout, stderr=stderr, timeout=args.call_timeout, check=False, env={**os.environ, "HOME": str(args.home)})
    if result.returncode != 0:
        stderr_detail = stderr_path.read_text(encoding="utf-8", errors="replace")[-1000:]
        event_detail = events_path.read_text(encoding="utf-8", errors="replace")[-3000:]
        detail = f"stderr:\n{stderr_detail}\nprovider-events:\n{event_detail}"
        raise RuntimeError(f"{role} provider call failed with exit {result.returncode}: {detail}")
    provenance = validate_events(events_path)
    payload = read_json(output_path)
    usage = provenance["usage"]
    with LOCK:
        PROGRESS["providerCallsCompleted"] += 1
        PROGRESS["providerInputTokens"] += int(usage.get("input_tokens", 0))
        PROGRESS["providerOutputTokens"] += int(usage.get("output_tokens", 0))
        PROGRESS["providerReasoningTokens"] += int(usage.get("reasoning_output_tokens", 0))
        PROGRESS["updatedAt"] = utc_now()
        atomic_json(state_path, PROGRESS)
    return payload, provenance


def role_guidance(purpose: str) -> str:
    if purpose == "acquisition":
        return "Acquisition checks immediate covered-once understanding. Correction variants must diagnose or repair materially different misconceptions and must not be numerical substitutions."
    if purpose == "validity":
        return "Validity is disjoint from acquisition: validity-direct applies the concept in a fresh instance; validity-compositional combines it with prerequisites, proof, counterexample, diagnosis, or implementation reasoning. Never imitate a generic acquisition drill."
    return "Retention items are future sealed probes. Both variants must use disjoint semantic families and substantially different reasoning paths. Do not mention prior attempts, elapsed time, or learning context."


def author_prompt(spec: dict[str, Any], batch_id: str, concepts: list[dict[str, Any]], feedback: dict[str, list[str]] | None) -> str:
    correction = ""
    if feedback:
        correction = f"\nA separate reviewer rejected prior proposals for these reasons. Redesign every pending item; do not defend or lightly edit a rejected template:\n{json.dumps(feedback, ensure_ascii=False, indent=2)}\n"
    return f"""You are the independent assessment-bank AUTHOR for one bounded Cortex Learning OS mathematics campaign. Work only from the concept metadata and item blueprint below. Do not use tools, browse, inspect files, or rely on existing generated exercises or bank families. Produce original deterministic items.{correction}

Campaign purpose: {spec['purpose']}
{role_guidance(spec['purpose'])}
Truth boundary: {spec['truthBoundary']}

For each concept return exactly the supplied item blueprints. itemKey must be <conceptId>:<assessmentRole>:<variant>.

Quality contract:
- Directly and substantively assess every stated outcome at the declared stage.
- Each prompt is self-contained, unambiguous, no-tools solvable, and has exactly one supported checker answer.
- Advanced items may use carefully designed multiple choice, but distractors must be plausible and only one option correct.
- Put answer formatting in the prompt. Never reveal or mention expected answers, checkers, hidden metadata, or commissioning.
- Compute expected values carefully as canonical JSON in checker.expectedJson. Use tolerance 0 except numeric_tolerance.
- Prompts across the batch must be original and materially distinct; do not copy public source exercises.
- authorRationale must derive the answer and explain outcome coverage.
- Return only schema-valid JSON with batchId exactly {json.dumps(batch_id)}.

Item blueprints:
{json.dumps(spec['itemBlueprints'], ensure_ascii=False, indent=2)}

Concept metadata:
{json.dumps(concepts, ensure_ascii=False, indent=2)}
"""


def reviewer_prompt(spec: dict[str, Any], batch_id: str, concepts: list[dict[str, Any]], author: dict[str, Any]) -> str:
    return f"""You are the independent assessment-bank REVIEWER in a fresh session with no shared author context. Do not use tools, browse, or trust the author's rationale. Independently solve and audit every item.

Campaign purpose: {spec['purpose']}
{role_guidance(spec['purpose'])}
Truth boundary: {spec['truthBoundary']}

Accept an item only if it substantively assesses every outcome at the declared stage; is self-contained and no-tools solvable; has exactly one answer; independently recomputes to checker.expectedJson; uses an appropriate checker; does not leak answers; and is materially distinct from all sibling items. Reject copied-looking, superficial, ambiguous, or parameter-substitution items. For validity and retention, reject any semantic-family overlap with another item in this batch when it could expose prior-answer memorization.

Return one exact-key review per proposal. recomputedExpectedJson must contain your independently computed canonical JSON answer even when rejected. Top-level accepted is true only when every item is accepted and batchIssues is empty. Return only schema-valid JSON with batchId exactly {json.dumps(batch_id)}.

Concept metadata:
{json.dumps(concepts, ensure_ascii=False, indent=2)}

Author proposals:
{json.dumps(author, ensure_ascii=False, indent=2)}
"""


def validate_review(review: dict[str, Any], author: dict[str, Any], batch_id: str) -> dict[str, list[str]]:
    if review.get("batchId") != batch_id or not isinstance(review.get("reviews"), list):
        raise ValueError("review batch identity mismatch")
    proposals = {row["itemKey"]: row for row in author["items"]}
    reviews = {row.get("itemKey"): row for row in review["reviews"]}
    if len(review["reviews"]) != len(proposals) or len(reviews) != len(proposals) or set(reviews) != set(proposals):
        raise ValueError("review did not cover every proposal exactly once")
    rejected: dict[str, list[str]] = {}
    for key, proposal in proposals.items():
        row = reviews[key]
        try:
            recomputed = canonical_expected(row["recomputedExpectedJson"])
            expected = canonical_expected(proposal["checker"]["expectedJson"])
        except Exception as error:
            row["accepted"] = False
            row.setdefault("issues", []).append(str(error))
            recomputed, expected = object(), None
        if recomputed != expected:
            row["accepted"] = False
            row.setdefault("issues", []).append("independently recomputed answer differs from checker")
        if not row.get("accepted") or row.get("issues"):
            rejected.setdefault(proposal["conceptId"], []).extend(row.get("issues") or ["reviewer rejected item"])
    for issue in review.get("batchIssues") or []:
        for proposal in proposals.values():
            rejected.setdefault(proposal["conceptId"], []).append(issue)
    if bool(review.get("accepted")) != (not rejected):
        raise ValueError("review top-level acceptance contradicts item results")
    return rejected


def commission_batch(args: argparse.Namespace, state_path: Path, spec: dict[str, Any], index: int, concepts: list[dict[str, Any]]) -> dict[str, Any]:
    base_id = f"batch-{index:03d}"
    batch_root = args.root / "batches" / base_id
    accepted: dict[str, list[dict[str, Any]]] = {}
    receipts: list[dict[str, Any]] = []
    pending = list(concepts)
    feedback: dict[str, list[str]] | None = None
    for attempt in range(1, args.max_attempts + 1):
        if not pending:
            break
        batch_id = base_id if attempt == 1 else f"{base_id}-repair-{attempt - 1}"
        attempt_dir = batch_root / f"attempt-{attempt}"
        author, author_provenance = run_model(args, state_path, role="author", attempt_dir=attempt_dir, prompt=author_prompt(spec, batch_id, pending, feedback), schema=args.author_schema)
        try:
            validate_author(author, batch_id, pending, spec)
        except Exception as error:
            feedback = {concept["conceptId"]: [f"mechanical author-output rejection: {error}"] for concept in pending}
            atomic_json(attempt_dir / "mechanical-rejection.json", {"batchId": batch_id, "error": str(error), "rejectedConceptIds": [row["conceptId"] for row in pending]})
            continue
        reviewer, reviewer_provenance = run_model(args, state_path, role="reviewer", attempt_dir=attempt_dir, prompt=reviewer_prompt(spec, batch_id, pending, author), schema=args.reviewer_schema)
        rejected = validate_review(reviewer, author, batch_id)
        pending_ids = {concept["conceptId"] for concept in pending}
        accepted_now = pending_ids - set(rejected)
        for concept_id in accepted_now:
            accepted[concept_id] = [row for row in author["items"] if row["conceptId"] == concept_id]
        receipts.append({
            "attempt": attempt,
            "batchId": batch_id,
            "authorThreadId": author_provenance["threadId"],
            "authorUsage": author_provenance["usage"],
            "reviewerThreadId": reviewer_provenance["threadId"],
            "reviewerUsage": reviewer_provenance["usage"],
            "acceptedConceptIds": sorted(accepted_now),
            "rejected": rejected,
        })
        pending = [concept for concept in pending if concept["conceptId"] in rejected]
        feedback = rejected or None
        atomic_json(batch_root / "progress.json", {"acceptedConceptIds": sorted(accepted), "pendingConceptIds": [row["conceptId"] for row in pending], "receipts": receipts})
    if pending:
        raise RuntimeError(f"{base_id} exhausted independent review repairs: {[row['conceptId'] for row in pending]}")
    items = [item for concept in concepts for item in accepted[concept["conceptId"]]]
    result = {"batchId": base_id, "conceptIds": [row["conceptId"] for row in concepts], "items": items, "receipts": receipts}
    atomic_json(batch_root / "accepted.json", result)
    with LOCK:
        PROGRESS["completedBatches"] += 1
        PROGRESS["acceptedConcepts"] += len(concepts)
        PROGRESS["acceptedItems"] += len(items)
        PROGRESS["updatedAt"] = utc_now()
        atomic_json(state_path, PROGRESS)
    return result


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--root", required=True, type=Path)
    result.add_argument("--spec", required=True, type=Path)
    result.add_argument("--author-schema", required=True, type=Path)
    result.add_argument("--reviewer-schema", required=True, type=Path)
    result.add_argument("--codex", default="/home/jake/.local/bin/codex", type=Path)
    result.add_argument("--home", default="/home/jake", type=Path)
    result.add_argument("--empty", required=True, type=Path)
    result.add_argument("--model", default="gpt-5.6-sol")
    result.add_argument("--thinking", default="xhigh", choices=["high", "xhigh", "ultra"])
    result.add_argument("--service-tier", choices=["fast"])
    result.add_argument("--batch-size", default=4, type=int)
    result.add_argument("--concurrency", default=2, type=int)
    result.add_argument("--max-attempts", default=6, type=int)
    result.add_argument("--call-timeout", default=1200, type=int)
    return result


def main() -> int:
    args = parser().parse_args()
    if not 1 <= args.batch_size <= 8 or not 1 <= args.concurrency <= 4 or not 1 <= args.max_attempts <= 8:
        raise RuntimeError("unsafe commissioning bounds")
    for file_path in (args.spec, args.author_schema, args.reviewer_schema, args.codex):
        if not file_path.is_file() or file_path.is_symlink():
            raise RuntimeError(f"required regular file missing: {file_path}")
    args.root.mkdir(parents=True, exist_ok=True, mode=0o700)
    args.empty.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(args.root, 0o700)
    os.chmod(args.empty, 0o700)
    state_path = args.root / "state.json"
    output_path = args.root / "commissioned-content.json"
    if state_path.exists() or output_path.exists() or (args.root / "batches").exists():
        raise RuntimeError("commissioning root is not fresh")
    spec = read_json(args.spec)
    if spec.get("schemaVersion") != SPEC_SCHEMA or spec.get("purpose") not in {"acquisition", "validity", "retention"}:
        raise RuntimeError("invalid commissioning spec")
    if not SAFE_ID.fullmatch(str(spec.get("campaignId") or "")):
        raise RuntimeError("invalid campaign identity")
    concepts = spec.get("concepts")
    blueprints = spec.get("itemBlueprints")
    if not isinstance(concepts, list) or spec.get("conceptCount") != len(concepts) or len({row.get("conceptId") for row in concepts}) != len(concepts):
        raise RuntimeError("invalid commissioning concept surface")
    if not isinstance(blueprints, list) or spec.get("expectedItemCount") != len(concepts) * len(blueprints):
        raise RuntimeError("invalid commissioning item blueprint")
    if args.service_tier is None:
        expected_model_runtime = {
            "provider": "openai-codex",
            "model": args.model,
            "thinking": args.thinking,
            "sandbox": "read-only",
            "toolsAllowed": False,
        }
    else:
        expected_model_runtime = {
            "provider": "openai-codex",
            "model": "gpt-5.6-sol",
            "thinking": "ultra",
            "serviceTier": "fast",
            "sandbox": "read-only",
            "toolsAllowed": False,
        }
        if spec.get("purpose") != "validity":
            raise RuntimeError("tiered commissioning is reserved for the full validity path")
        if args.model != expected_model_runtime["model"] or args.thinking != expected_model_runtime["thinking"]:
            raise RuntimeError("tiered model runtime arguments differ from the frozen validity runtime")
    if not exact_json(spec.get("modelRuntime"), expected_model_runtime):
        raise RuntimeError("model runtime differs from frozen spec")
    batches = [concepts[index:index + args.batch_size] for index in range(0, len(concepts), args.batch_size)]
    PROGRESS.update({
        "schemaVersion": SCHEMA,
        "status": "running",
        "campaignId": spec["campaignId"],
        "purpose": spec["purpose"],
        "artifactRoot": str(args.root),
        "source": spec["source"],
        "model": args.model,
        "thinking": args.thinking,
        "concurrency": args.concurrency,
        "batchSize": args.batch_size,
        "completedBatches": 0,
        "totalBatches": len(batches),
        "acceptedConcepts": 0,
        "acceptedItems": 0,
        "providerCallsStarted": 0,
        "providerCallsCompleted": 0,
        "providerInputTokens": 0,
        "providerOutputTokens": 0,
        "providerReasoningTokens": 0,
        "startedAt": utc_now(),
        "updatedAt": utc_now(),
        "truthBoundary": "Commissioning acceptance proves role-isolated bank content mechanics only; it grants no validity, retention, utility, mastery, or model-weight credit.",
    })
    atomic_json(state_path, PROGRESS)
    try:
        results: list[dict[str, Any]] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futures = {pool.submit(commission_batch, args, state_path, spec, index, batch): index for index, batch in enumerate(batches, 1)}
            for future in concurrent.futures.as_completed(futures):
                results.append(future.result())
        results.sort(key=lambda row: row["batchId"])
        items = [item for result in results for item in result["items"]]
        if len(items) != spec["expectedItemCount"] or len({row["itemKey"] for row in items}) != len(items):
            raise RuntimeError("commissioned output item count or identity mismatch")
        output = {
            "schemaVersion": OUTPUT_SCHEMA,
            "campaignId": spec["campaignId"],
            "purpose": spec["purpose"],
            "source": spec["source"],
            "conceptCount": len(concepts),
            "itemCount": len(items),
            "itemBlueprints": blueprints,
            "authoringModel": args.model,
            "reviewingModel": args.model,
            "roleIsolation": "fresh_ephemeral_no_tool_author_and_reviewer_sessions",
            "items": items,
            "batchReceipts": [{"batchId": row["batchId"], "receipts": row["receipts"]} for row in results],
            "completedAt": utc_now(),
            "truthBoundary": PROGRESS["truthBoundary"],
        }
        atomic_json(output_path, output)
        update_state(state_path, status="completed", outputPath=str(output_path), completedAt=utc_now())
        print(json.dumps(PROGRESS, indent=2, sort_keys=True))
        return 0
    except Exception as error:
        update_state(state_path, status="blocked", blocker=str(error), completedAt=utc_now())
        raise


if __name__ == "__main__":
    raise SystemExit(main())
