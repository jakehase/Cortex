"""L12 Hive: model decomposition, read-only fan-out, model synthesis.

A swarm run takes one complex goal and:

1. asks the level model to break it into at most ``MAX_SUBTASKS`` independent,
   self-contained research questions, each routed to one READ-ONLY level
   (``librarian`` = the principal's saved memory, ``mnemosyne`` = knowledge
   graph search, ``ghost`` = governed web search) that is actually available;
2. runs those subtasks concurrently, in process, through the level adapters
   (bounded parallelism, per-subtask timeout, overall deadline).  Nothing here
   sends messages, writes user files, executes code or schedules work;
3. asks the model to synthesise an answer from the subtask evidence only,
   citing subtask ids; citations to ids that produced no evidence are dropped.

Every failure is reported as such.  There are no canned subtasks, no hashed
"bids" and no simulated workers.  Runs are recorded in a small JSONL store so
``GET /hive/plan/{run_id}`` can return them.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib
import inspect
import json
import os
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Literal, Mapping, Optional

from pydantic import BaseModel, ConfigDict, Field

LEVEL = 12
HIVE_SUBTASK_LEVELS = ("librarian", "mnemosyne", "ghost")
MAX_SUBTASKS = 4
DEFAULT_SUBTASKS = 3
MAX_PARALLEL_SUBTASKS = 3
SUBTASK_TIMEOUT_S = 20.0
DEFAULT_DEADLINE_S = 100.0
MAX_GOAL_CHARS = 4000
MAX_BACKGROUND_RUNS = 2
_EXCERPT_CHARS = 600

_LEVEL_DESCRIPTIONS = {
    "librarian": "the user's own saved Cortex memory (semantic recall of notes, facts and past conversations)",
    "mnemosyne": "the Cortex knowledge graph (entities and relations Cortex has recorded)",
    "ghost": "governed public web search (current public information)",
}

AdapterFn = Callable[[str, Mapping[str, Any]], Awaitable[Dict[str, Any]]]


class HiveSubtask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^t[1-9]$")
    question: str = Field(min_length=3, max_length=300)
    level: Literal["librarian", "mnemosyne", "ghost"]
    purpose: str = Field(default="", max_length=200)


class HiveDecomposition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subtasks: List[HiveSubtask] = Field(min_length=1, max_length=MAX_SUBTASKS)
    rationale: str = Field(default="", max_length=400)


class HiveSynthesis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: str = Field(min_length=1, max_length=2400)
    citations: List[str] = Field(default_factory=list, max_length=8)
    gaps: List[str] = Field(default_factory=list, max_length=6)
    confidence: Literal["high", "medium", "low"] = "low"


DECOMPOSE_SYSTEM = (
    "You are the decomposition step of Cortex level 12 (Hive). Break the user's goal into the smallest set of "
    "independent, self-contained READ-ONLY research questions whose answers together let someone answer the goal. "
    "Each question is routed to exactly one source level from the list you are given; use only those levels. "
    "Never create a subtask that performs an action (sending messages, buying, scheduling, editing files, running "
    "code); if the goal asks for such actions, decompose only the information needed and say in rationale that the "
    "action itself is out of scope. Questions must stand alone (repeat names/places, no pronouns pointing at other "
    "subtasks). Return ONLY JSON: {\"subtasks\": [{\"id\": \"t1\", \"question\": \"...\", \"level\": \"...\", "
    "\"purpose\": \"why this is needed\"}], \"rationale\": \"...\"}. Ids are t1, t2, ... in order."
)

SYNTHESIZE_SYSTEM = (
    "You are the synthesis step of Cortex level 12 (Hive). Answer the user's goal using ONLY the subtask evidence "
    "provided. Cite the subtask ids that support each claim in 'citations'. If the evidence is thin, missing or "
    "contradictory, say so plainly in the answer and list what is missing in 'gaps'; never fill gaps from general "
    "knowledge and never invent sources. Return ONLY JSON: {\"answer\": \"...\", \"citations\": [\"t1\"], "
    "\"gaps\": [\"...\"], \"confidence\": \"high|medium|low\"}."
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def _excerpt(payload: Any) -> str:
    if isinstance(payload, dict) and isinstance(payload.get("summary"), str) and payload["summary"].strip():
        return payload["summary"].strip()[:_EXCERPT_CHARS]
    try:
        text = json.dumps(payload, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        text = str(payload)
    return text[:_EXCERPT_CHARS]


# ── Read-only adapters ─────────────────────────────────────────────────────


def _engine_librarian_adapter() -> AdapterFn:
    from cortex_server.modules.execution_engine import ExecutionEngine

    async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
        payload = await asyncio.to_thread(ExecutionEngine._librarian_recall, query, context)
        recall = payload.get("recall") if isinstance(payload, dict) else {}
        rows = (recall or {}).get("results") or []
        snippets = []
        for row in rows[:5]:
            text = str((row or {}).get("text") or (row or {}).get("document") or "").strip()
            if text:
                snippets.append(text[:200])
        return {
            "operation": "librarian.recall",
            "origin": "deterministic",
            "summary": (" | ".join(snippets) if snippets else "No matching saved memories.")[:_EXCERPT_CHARS],
            "data": {"result_count": len(rows), "search_mode": (recall or {}).get("search_mode")},
        }

    return run


def available_subtask_adapters() -> Dict[str, Dict[str, Any]]:
    """Read-only adapters Hive may fan out to, with why others are unavailable."""

    out: Dict[str, Dict[str, Any]] = {}
    for slug in HIVE_SUBTASK_LEVELS:
        entry: Dict[str, Any] = {"available": False, "source": None, "reason": "adapter_missing"}
        try:
            module = importlib.import_module(f"cortex_server.modules.level_adapters.{slug}")
        except ModuleNotFoundError:
            module = None
        except Exception as exc:  # a broken adapter must not break Hive
            module = None
            entry["reason"] = f"adapter_import_failed:{type(exc).__name__}"
        if module is not None:
            if getattr(module, "SAFE_AUTORUN", False) is not True:
                entry["reason"] = "adapter_not_safe_for_autorun"
            elif str(getattr(module, "NAME", "")) != slug or not callable(getattr(module, "run", None)):
                entry["reason"] = "adapter_contract_mismatch"
            else:
                entry = {"available": True, "source": f"level_adapters.{slug}", "run": module.run,
                         "needs_model": bool(getattr(module, "NEEDS_MODEL", False))}
        if not entry["available"] and slug == "librarian":
            entry = {"available": True, "source": "execution_engine.librarian_recall",
                     "run": _engine_librarian_adapter(), "needs_model": False}
        out[slug] = entry
    return out


def adapter_availability() -> Dict[str, Any]:
    return {
        slug: {k: v for k, v in entry.items() if k != "run"}
        for slug, entry in available_subtask_adapters().items()
    }


# ── Swarm run ──────────────────────────────────────────────────────────────


async def _run_subtask(
    subtask: Dict[str, Any],
    adapters: Mapping[str, Dict[str, Any]],
    context: Mapping[str, Any],
    semaphore: asyncio.Semaphore,
    timeout_s: float,
) -> Dict[str, Any]:
    from cortex_server.modules.execution_engine import ExecutionBlocked

    receipt = {
        "id": subtask["id"],
        "question": subtask["question"],
        "level": subtask["level"],
        "purpose": subtask.get("purpose", ""),
        "status": "blocked",
        "latency_ms": 0,
    }
    entry = adapters.get(subtask["level"]) or {}
    if not entry.get("available"):
        receipt["reason"] = entry.get("reason") or "adapter_unavailable"
        return receipt
    receipt["adapter"] = entry.get("source")
    async with semaphore:
        started = time.monotonic()
        try:
            output = entry["run"](subtask["question"], context)
            if inspect.isawaitable(output):
                output = await asyncio.wait_for(output, timeout=timeout_s)
            receipt.update(status="succeeded", excerpt=_excerpt(output),
                           origin=(output or {}).get("origin") if isinstance(output, dict) else None)
            if isinstance(output, dict) and output.get("receipt_id"):
                receipt["receipt_id"] = output.get("receipt_id")
        except ExecutionBlocked as exc:
            receipt.update(status="blocked", reason=exc.reason)
        except asyncio.TimeoutError:
            receipt.update(status="timeout", reason=f"exceeded {timeout_s:.0f}s")
        except Exception as exc:
            receipt.update(status="failed", reason=type(exc).__name__)
        receipt["latency_ms"] = int((time.monotonic() - started) * 1000)
    return receipt


async def decompose_goal(
    goal: str,
    *,
    context: Optional[Mapping[str, Any]] = None,
    max_subtasks: int = DEFAULT_SUBTASKS,
    deadline_s: float = 45.0,
    model_fn: Optional[Callable[..., Awaitable[Dict[str, Any]]]] = None,
    adapters: Optional[Mapping[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Model decomposition only (no execution). Returns status 'ok' or an honest failure body."""

    ctx = dict(context or {})
    text = " ".join(str(goal or "").split())
    if not text:
        return {"success": False, "status": "empty_goal"}
    if len(text) > MAX_GOAL_CHARS:
        return {"success": False, "status": "goal_too_long", "max_chars": MAX_GOAL_CHARS}
    limit = max(1, min(int(max_subtasks or DEFAULT_SUBTASKS), MAX_SUBTASKS))
    scope = str(ctx.get("principal_scope_key") or "").strip()
    if not scope:
        return {"success": False, "status": "missing_principal_scope"}
    adapters = adapters if adapters is not None else available_subtask_adapters()
    usable = [slug for slug, entry in adapters.items() if entry.get("available")]
    availability = {slug: {k: v for k, v in entry.items() if k != "run"} for slug, entry in adapters.items()}
    if not usable:
        return {"success": False, "status": "no_read_only_adapters", "adapters": availability}

    if model_fn is None:
        from cortex_server.modules.level_model import level_model_json as model_fn  # type: ignore[no-redef]
    from cortex_server.modules.level_model import unavailable_payload

    level_lines = "\n".join(f"- {slug}: {_LEVEL_DESCRIPTIONS[slug]}" for slug in usable)
    conversation = str(ctx.get("conversation") or "").strip()[:1500]
    prompt = (
        f"Goal: {text}\n"
        + (f"Recent conversation (context only): {conversation}\n" if conversation else "")
        + (f"Caller context: {str(ctx.get('hive_context'))[:1500]}\n" if ctx.get("hive_context") else "")
        + f"Available source levels (use only these):\n{level_lines}\n"
        f"Produce at most {limit} subtasks."
    )
    decomposition = await model_fn(
        level=LEVEL, name="hive", system=DECOMPOSE_SYSTEM, prompt=prompt,
        principal_scope_key=scope, schema=HiveDecomposition, deadline_s=max(1.0, float(deadline_s)),
    )
    if not isinstance(decomposition, dict) or decomposition.get("status") != "ok":
        body = unavailable_payload(decomposition if isinstance(decomposition, dict) else {}, operation="hive.decompose")
        return {**body, "stage": "decompose", "adapters": availability}

    seen: set = set()
    subtasks: List[Dict[str, Any]] = []
    for row in list((decomposition.get("data") or {}).get("subtasks") or []):
        if not isinstance(row, dict) or row.get("id") in seen:
            continue
        seen.add(row.get("id"))
        subtasks.append({
            "id": str(row.get("id")),
            "question": str(row.get("question") or "")[:300],
            "level": str(row.get("level") or ""),
            "purpose": str(row.get("purpose") or "")[:200],
        })
        if len(subtasks) >= limit:
            break
    return {
        "success": True,
        "status": "ok",
        "goal": text,
        "subtasks": subtasks,
        "adapters": availability,
        "decomposition": {
            "model": decomposition.get("model"),
            "receipt_id": decomposition.get("receipt_id"),
            "rationale": str((decomposition.get("data") or {}).get("rationale") or "")[:400],
        },
    }


async def run_swarm(
    goal: str,
    *,
    context: Optional[Mapping[str, Any]] = None,
    max_subtasks: int = DEFAULT_SUBTASKS,
    deadline_s: float = DEFAULT_DEADLINE_S,
    run_id: Optional[str] = None,
    model_fn: Optional[Callable[..., Awaitable[Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    """Run one bounded swarm. Never raises for model/adapter failures."""

    started = time.monotonic()
    run_id = run_id or f"hive_{uuid.uuid4().hex[:16]}"
    ctx = dict(context or {})
    base = {"operation": "hive.run", "run_id": run_id, "level": LEVEL}
    if model_fn is None:
        from cortex_server.modules.level_model import level_model_json as model_fn  # type: ignore[no-redef]
    from cortex_server.modules.level_model import unavailable_payload

    def remaining() -> float:
        return max(1.0, float(deadline_s) - (time.monotonic() - started))

    adapters = available_subtask_adapters()
    plan = await decompose_goal(goal, context=ctx, max_subtasks=max_subtasks,
                                deadline_s=min(45.0, remaining()), model_fn=model_fn, adapters=adapters)
    if plan.get("status") != "ok":
        failure = {k: v for k, v in plan.items() if k != "operation"}
        return {**base, **failure, "success": False, "subtasks": [],
                "elapsed_ms": int((time.monotonic() - started) * 1000)}
    scope = str(ctx.get("principal_scope_key") or "").strip()
    text = plan["goal"]
    subtasks = plan["subtasks"]
    availability = plan["adapters"]
    decompose_meta = plan["decomposition"]

    sub_ctx = {k: v for k, v in ctx.items() if k not in {"hive_context"}}
    sub_ctx["parent_level"] = "hive"
    semaphore = asyncio.Semaphore(MAX_PARALLEL_SUBTASKS)
    timeout_s = min(SUBTASK_TIMEOUT_S, remaining())
    receipts = await asyncio.gather(
        *(_run_subtask(st, adapters, sub_ctx, semaphore, timeout_s) for st in subtasks)
    )
    succeeded = [r for r in receipts if r["status"] == "succeeded"]
    counts = {
        status: sum(1 for r in receipts if r["status"] == status)
        for status in ("succeeded", "blocked", "failed", "timeout")
    }
    result: Dict[str, Any] = {
        **base,
        "goal": text[:500],
        "subtasks": list(receipts),
        "subtask_counts": counts,
        "adapters": availability,
        "decomposition": decompose_meta,
        "synthesis": None,
    }
    if not succeeded:
        result.update(
            success=False,
            status="no_subtask_evidence",
            origin="model",
            note="Every subtask was blocked, failed or timed out; no synthesis was attempted.",
            elapsed_ms=int((time.monotonic() - started) * 1000),
        )
        return result

    evidence = "\n\n".join(
        f"[{r['id']}] ({r['level']}) Q: {r['question']}\nEvidence: {r.get('excerpt', '')}"
        for r in succeeded
    )
    missing = [f"[{r['id']}] {r['question']} -> {r['status']} ({r.get('reason', '')})" for r in receipts if r["status"] != "succeeded"]
    synth_prompt = (
        f"Goal: {text}\n\nSubtask evidence:\n{evidence}\n"
        + (f"\nSubtasks that produced no evidence:\n" + "\n".join(missing) if missing else "")
    )
    synthesis = await model_fn(
        level=LEVEL, name="hive", system=SYNTHESIZE_SYSTEM, prompt=synth_prompt,
        principal_scope_key=scope, schema=HiveSynthesis, deadline_s=min(45.0, remaining()),
    )
    if not isinstance(synthesis, dict) or synthesis.get("status") != "ok":
        body = unavailable_payload(synthesis if isinstance(synthesis, dict) else {}, operation="hive.run")
        result.update({**body, "stage": "synthesize", "elapsed_ms": int((time.monotonic() - started) * 1000)})
        result["subtasks"] = list(receipts)  # real evidence stays visible
        return result

    data = synthesis.get("data") or {}
    valid_ids = {r["id"] for r in succeeded}
    citations = [c for c in (data.get("citations") or []) if c in valid_ids]
    dropped = [c for c in (data.get("citations") or []) if c not in valid_ids]
    result.update(
        success=True,
        status="completed",
        origin="model",
        synthesis={
            "answer": str(data.get("answer") or "")[:2400],
            "citations": citations,
            "dropped_citations": dropped,
            "gaps": [str(g)[:200] for g in (data.get("gaps") or [])][:6],
            "confidence": data.get("confidence"),
            "model": synthesis.get("model"),
            "receipt_id": synthesis.get("receipt_id"),
        },
        model=synthesis.get("model"),
        receipt_id=synthesis.get("receipt_id"),
        elapsed_ms=int((time.monotonic() - started) * 1000),
    )
    return result


# ── Run store + background runs ────────────────────────────────────────────

_STORE_LOCK = threading.Lock()
_ACTIVE: Dict[str, "asyncio.Task[Any]"] = {}
_MAX_STORE_READ_BYTES = 4 * 1024 * 1024
_STATS = {"runs_started": 0, "runs_completed": 0, "runs_failed": 0, "last_run_at": None, "last_status": None}


class HiveBusy(RuntimeError):
    """Too many background swarms are already running."""


def _store_path() -> Path:
    configured = os.getenv("CORTEX_HIVE_STATE_DIR") or os.getenv("CORTEX_SCHEDULER_STATE_DIR") or "/app/config/state"
    directory = Path(configured)
    try:
        directory.mkdir(parents=True, exist_ok=True)
        probe = directory / ".hive_write_probe"
        probe.touch()
        probe.unlink()
    except OSError:
        directory = Path(tempfile.gettempdir()) / "cortex-hive-state"
        directory.mkdir(parents=True, exist_ok=True)
    return directory / "l12_hive_runs.jsonl"


def record_run(row: Dict[str, Any]) -> None:
    line = json.dumps({**row, "recorded_at": _now_iso()}, ensure_ascii=False, default=str)
    with _STORE_LOCK:
        path = _store_path()
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def _read_rows() -> List[Dict[str, Any]]:
    path = _store_path()
    if not path.exists():
        return []
    with _STORE_LOCK:
        size = path.stat().st_size
        with path.open("rb") as handle:
            if size > _MAX_STORE_READ_BYTES:
                handle.seek(size - _MAX_STORE_READ_BYTES)
                handle.readline()
            data = handle.read().decode("utf-8", errors="ignore")
    rows = []
    for line in data.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def get_run(run_id: str) -> Optional[Dict[str, Any]]:
    latest: Optional[Dict[str, Any]] = None
    for row in _read_rows():
        if row.get("run_id") == run_id:
            latest = row
    if latest is None:
        return None
    if latest.get("status") in {"queued", "running"} and run_id not in _ACTIVE:
        latest = {**latest, "status": "interrupted",
                  "note": "the process that owned this run stopped before it finished"}
    return latest


def _find_idempotent(key_sha: str, owner_sha: str) -> Optional[Dict[str, Any]]:
    found: Optional[Dict[str, Any]] = None
    for row in _read_rows():
        if row.get("idempotency_key_sha256") == key_sha and row.get("owner_scope_sha256") == owner_sha:
            found = row
    return found


def stats() -> Dict[str, Any]:
    return {**_STATS, "active_background_runs": len(_ACTIVE)}


def _finish_stats(status: str) -> None:
    _STATS["last_run_at"] = _now_iso()
    _STATS["last_status"] = status
    if status == "completed":
        _STATS["runs_completed"] += 1
    else:
        _STATS["runs_failed"] += 1


async def run_and_record(goal: str, *, context: Mapping[str, Any], max_subtasks: int = DEFAULT_SUBTASKS,
                         run_id: Optional[str] = None, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    run_id = run_id or f"hive_{uuid.uuid4().hex[:16]}"
    _STATS["runs_started"] += 1
    owner_sha = _sha(str(context.get("principal_scope_key") or ""))
    result = await run_swarm(goal, context=context, max_subtasks=max_subtasks, run_id=run_id)
    _finish_stats(str(result.get("status")))
    try:
        record_run({"run_id": run_id, "status": result.get("status"), "owner_scope_sha256": owner_sha,
                    **(extra or {}), "result": result})
    except OSError:
        result["persisted"] = False
    return result


def start_background_run(goal: str, *, context: Mapping[str, Any], idempotency_key: str,
                         max_subtasks: int = DEFAULT_SUBTASKS) -> Dict[str, Any]:
    """Start (or return the existing) background swarm for an idempotency key."""

    owner_sha = _sha(str(context.get("principal_scope_key") or ""))
    key_sha = _sha(idempotency_key)
    existing = _find_idempotent(key_sha, owner_sha)
    if existing is not None:
        current = get_run(str(existing.get("run_id"))) or existing
        return {"run_id": existing.get("run_id"), "status": current.get("status"), "reused": True}
    if len(_ACTIVE) >= MAX_BACKGROUND_RUNS:
        raise HiveBusy(f"{len(_ACTIVE)} background swarms already running")
    run_id = f"hive_{uuid.uuid4().hex[:16]}"
    extra = {"idempotency_key_sha256": key_sha, "goal_sha256": _sha(goal)}
    record_run({"run_id": run_id, "status": "running", "owner_scope_sha256": owner_sha, **extra})

    async def runner() -> None:
        try:
            await run_and_record(goal, context=context, max_subtasks=max_subtasks, run_id=run_id, extra=extra)
        except Exception as exc:  # recorded, never silently "completed"
            _finish_stats("failed")
            try:
                record_run({"run_id": run_id, "status": "failed", "owner_scope_sha256": owner_sha,
                            "error": type(exc).__name__, **extra})
            except OSError:
                pass
        finally:
            _ACTIVE.pop(run_id, None)

    _ACTIVE[run_id] = asyncio.get_running_loop().create_task(runner(), name=f"hive-swarm-{run_id}")
    return {"run_id": run_id, "status": "running", "reused": False}


__all__ = [
    "DECOMPOSE_SYSTEM",
    "HIVE_SUBTASK_LEVELS",
    "HiveBusy",
    "HiveDecomposition",
    "HiveSubtask",
    "HiveSynthesis",
    "MAX_SUBTASKS",
    "SYNTHESIZE_SYSTEM",
    "adapter_availability",
    "available_subtask_adapters",
    "get_run",
    "record_run",
    "run_and_record",
    "run_swarm",
    "start_background_run",
    "stats",
]
