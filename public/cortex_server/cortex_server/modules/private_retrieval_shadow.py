"""Selective private-retrieval shadow observer.

The observer is deliberately non-interventional: it may classify a request and
retrieve a bounded candidate pack, but it never returns candidate text to the
answer path.  Only content-free operational telemetry is persisted.
"""
from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import tempfile
import threading
import time
from typing import Any, Callable, Dict, List, Mapping, Optional


SCHEMA_VERSION = "cortex.private_retrieval_shadow.v1"
MODE = "observe_only"
_DEFAULT_MAX_RECORDS = 1_000
_DEFAULT_MAX_PENDING = 32
_DEFAULT_RATE_LIMIT = 30
_DEFAULT_RATE_WINDOW_SECONDS = 60
_DEFAULT_RESULT_COUNT = 8
_DEFAULT_PACK_ITEMS = 3
_DEFAULT_PACK_TOKENS = 600
_DEFAULT_LATENCY_LIMIT_MS = 1_500

try:
    _WORKER_COUNT = int(os.getenv("CORTEX_PRIVATE_RETRIEVAL_SHADOW_WORKERS", "2"))
except (TypeError, ValueError):
    _WORKER_COUNT = 2
_EXECUTOR = ThreadPoolExecutor(
    max_workers=max(1, min(_WORKER_COUNT, 4)),
    thread_name_prefix="private-retrieval-shadow",
)
_PENDING_LOCK = threading.Lock()
_PENDING: Dict[Future, str] = {}
_RATE_LOCK = threading.Lock()
_RATE_WINDOWS: Dict[str, List[float]] = {}

_SENSITIVE_LOOKUP = re.compile(
    r"\b(password|passcode|api\s*key|access\s*token|refresh\s*token|private\s*key|secret\s*key|"
    r"social\s*security|ssn|credit\s*card|bank\s*account|routing\s*number|seed\s*phrase|"
    r"credential|oauth\s*code|recovery\s*code|\bpin)\b",
    re.I,
)
_EXTERNAL_VOLATILE = re.compile(
    r"\b(weather|forecast|news|stock|share price|market price|score|election|traffic|flight status|"
    r"latest release|current version|today'?s|right now)\b",
    re.I,
)
_PRIVATE_ANCHOR = re.compile(
    r"\b(my|our|we|us|i\s+(?:said|told|asked|chose|preferred)|you\s+(?:said|told|recommended)|"
    r"previous|prior|earlier|last time|on record|saved|workspace|project|client|family|server|"
    r"preference|preferred|setting|configured|configuration|decision|decided|codeword|reply prefix|"
    r"canonical status|current status|remaining surfaces)\b",
    re.I,
)
_FACT_LOOKUP = re.compile(
    r"(?:^|[.!?]\s*)(?:what|which|where|when|who|whose|how many|how much|do you remember|"
    r"can you recall|remind me|recall|remember)\b|\bwhat did\b|\bwhat was\b|\bwhat is\b|"
    r"\bwhere did\b|\bwhen did\b|\bwho did\b",
    re.I,
)
_ACTION_PREFIX = re.compile(
    r"^\s*(?:please\s+)?(?:(?:(?:can|could|would|will)\s+you|help\s+me)\s+)?"
    r"(?:write|draft|create|build|implement|fix|refactor|test|send|post|publish|email|message|"
    r"schedule|delete|remove|restart|deploy|translate|summarize|brainstorm|design)\b",
    re.I,
)
_EXPLICIT_MEMORY = re.compile(
    r"\b(?:from (?:memory|our records|the workspace)|memory search|look (?:back|up) in (?:memory|our records)|"
    r"do you remember|can you recall|what did we decide|what did i (?:say|tell|choose|prefer))\b",
    re.I,
)


@dataclass(frozen=True)
class ShadowConfig:
    enabled: bool = True
    kill_switch: bool = False
    max_records: int = _DEFAULT_MAX_RECORDS
    max_pending: int = _DEFAULT_MAX_PENDING
    rate_limit: int = _DEFAULT_RATE_LIMIT
    rate_window_seconds: int = _DEFAULT_RATE_WINDOW_SECONDS
    result_count: int = _DEFAULT_RESULT_COUNT
    pack_items: int = _DEFAULT_PACK_ITEMS
    pack_tokens: int = _DEFAULT_PACK_TOKENS
    latency_limit_ms: int = _DEFAULT_LATENCY_LIMIT_MS

    @classmethod
    def from_env(cls) -> "ShadowConfig":
        return cls(
            enabled=_env_bool("CORTEX_PRIVATE_RETRIEVAL_SHADOW_ENABLED", True),
            kill_switch=_env_bool("CORTEX_PRIVATE_RETRIEVAL_SHADOW_KILL_SWITCH", False),
            max_records=_bounded_env_int("CORTEX_PRIVATE_RETRIEVAL_SHADOW_MAX_RECORDS", _DEFAULT_MAX_RECORDS, 10, 10_000),
            max_pending=_bounded_env_int("CORTEX_PRIVATE_RETRIEVAL_SHADOW_MAX_PENDING", _DEFAULT_MAX_PENDING, 1, 256),
            rate_limit=_bounded_env_int("CORTEX_PRIVATE_RETRIEVAL_SHADOW_RATE_LIMIT", _DEFAULT_RATE_LIMIT, 1, 1_000),
            rate_window_seconds=_bounded_env_int("CORTEX_PRIVATE_RETRIEVAL_SHADOW_RATE_WINDOW_SECONDS", _DEFAULT_RATE_WINDOW_SECONDS, 1, 3_600),
            result_count=_bounded_env_int("CORTEX_PRIVATE_RETRIEVAL_SHADOW_RESULT_COUNT", _DEFAULT_RESULT_COUNT, 1, 20),
            pack_items=_bounded_env_int("CORTEX_PRIVATE_RETRIEVAL_SHADOW_PACK_ITEMS", _DEFAULT_PACK_ITEMS, 1, 5),
            pack_tokens=_bounded_env_int("CORTEX_PRIVATE_RETRIEVAL_SHADOW_PACK_TOKENS", _DEFAULT_PACK_TOKENS, 64, 1_200),
            latency_limit_ms=_bounded_env_int("CORTEX_PRIVATE_RETRIEVAL_SHADOW_LATENCY_LIMIT_MS", _DEFAULT_LATENCY_LIMIT_MS, 50, 30_000),
        )


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def classify_private_retrieval_query(query: str) -> Dict[str, Any]:
    """Classify only open-ended, non-sensitive private fact lookups."""
    text = re.sub(r"\s+", " ", str(query or "")).strip()
    if not text:
        return {"eligible": False, "reason": "empty_query", "signals": []}
    if len(text) > 16_384:
        return {"eligible": False, "reason": "query_too_large", "signals": []}
    if _SENSITIVE_LOOKUP.search(text):
        return {"eligible": False, "reason": "sensitive_lookup_blocked", "signals": ["sensitive_term"]}
    if _ACTION_PREFIX.search(text):
        return {"eligible": False, "reason": "action_or_generation_request", "signals": ["action_prefix"]}

    explicit_memory = bool(_EXPLICIT_MEMORY.search(text))
    private_anchor = bool(
        _PRIVATE_ANCHOR.search(text)
        or re.search(r"\b(?:what )?prefix\b.{0,32}\brepl(?:y|ies)\b", text, re.I)
    )
    fact_lookup = bool(_FACT_LOOKUP.search(text) or text.rstrip().endswith("?"))
    external_volatile = bool(_EXTERNAL_VOLATILE.search(text))
    if external_volatile and not private_anchor and not explicit_memory:
        return {"eligible": False, "reason": "external_volatile_lookup", "signals": ["external_volatile"]}
    if not fact_lookup:
        return {"eligible": False, "reason": "not_fact_lookup", "signals": []}
    if not (private_anchor or explicit_memory):
        return {"eligible": False, "reason": "no_private_anchor", "signals": ["fact_lookup"]}

    signals: List[str] = ["fact_lookup"]
    if explicit_memory:
        signals.append("explicit_memory")
    if private_anchor:
        signals.append("private_anchor")
    fact_class = "private_fact"
    lowered = text.lower()
    if re.search(r"\b(prefer|preference|reply prefix|call me)\b", lowered):
        fact_class = "preference"
    elif re.search(r"\b(decide|decision|approved|chose)\b", lowered):
        fact_class = "prior_decision"
    elif re.search(r"\b(status|remaining|project|workspace)\b", lowered):
        fact_class = "project_state"
    elif re.search(r"\b(setting|configured|configuration|server)\b", lowered):
        fact_class = "operational_setting"
    return {"eligible": True, "reason": "selective_private_fact_lookup", "signals": signals, "factClass": fact_class}


def _score(row: Mapping[str, Any]) -> float:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {}
    for value in (row.get("score"), metadata.get("hybrid_score"), metadata.get("relevance_score")):
        try:
            if value is not None:
                return max(0.0, min(float(value), 1.0))
        except (TypeError, ValueError):
            continue
    try:
        return max(0.0, min(1.0 - float(row.get("distance", 1.0)), 1.0))
    except (TypeError, ValueError):
        return 0.0


def _select_pack(rows: List[Mapping[str, Any]], *, max_items: int, max_tokens: int) -> Dict[str, Any]:
    selected = 0
    estimated_tokens = 0
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        metadata = row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {}
        if str(metadata.get("memory_status", "active")).lower() not in {"", "active"}:
            continue
        if bool(metadata.get("codec_state_noise")) or bool(metadata.get("memory_system_meta_noise")):
            continue
        source = str(metadata.get("source", "")).lower()
        if source in {"ghost_cache", "probe", "benchmark_probe"}:
            continue
        text = re.sub(r"\s+", " ", str(row.get("text") or row.get("snippet") or "")).strip()
        if not text:
            continue
        score = _score(row)
        if score < 0.20:
            continue
        tokens = max(1, math.ceil(len(text) / 4))
        remaining = max_tokens - estimated_tokens
        if remaining <= 0:
            break
        tokens = min(tokens, remaining)
        selected += 1
        estimated_tokens += tokens
        if selected >= max_items:
            break
    return {
        "candidateCount": len(rows),
        "packCount": selected,
        "packEstimateTokens": estimated_tokens,
    }


def _default_state() -> Dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "mode": MODE,
        "answerInfluence": False,
        "updatedAt": None,
        "counters": {
            "completed": 0,
            "succeeded": 0,
            "failed": 0,
            "packsAvailable": 0,
            "qualityCompared": 0,
        },
        "records": [],
    }


def _load_state_unlocked(path: Path) -> Dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(value, dict) and value.get("schemaVersion") == SCHEMA_VERSION:
            return value
    except Exception:
        pass
    return _default_state()


def _atomic_write(path: Path, value: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            descriptor = -1
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _append_record(path: Path, record: Dict[str, Any], max_records: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.parent.is_symlink() or path.is_symlink():
        raise RuntimeError("private retrieval shadow state path cannot be a symbolic link")
    lock_path = path.with_name(f"{path.name}.lock")
    if lock_path.is_symlink():
        raise RuntimeError("private retrieval shadow lock path cannot be a symbolic link")
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        state = _load_state_unlocked(path)
        records = state.get("records") if isinstance(state.get("records"), list) else []
        records.append(record)
        state["records"] = records[-max_records:]
        counters = state.get("counters") if isinstance(state.get("counters"), dict) else {}
        counters["completed"] = int(counters.get("completed", 0) or 0) + 1
        if record.get("retrievalSucceeded"):
            counters["succeeded"] = int(counters.get("succeeded", 0) or 0) + 1
        else:
            counters["failed"] = int(counters.get("failed", 0) or 0) + 1
        if int(record.get("packCount", 0) or 0) > 0:
            counters["packsAvailable"] = int(counters.get("packsAvailable", 0) or 0) + 1
        # Shadow execution has no answer access, so quality is intentionally not
        # inferred from candidate presence or baseline run success.
        counters["qualityCompared"] = int(counters.get("qualityCompared", 0) or 0)
        state["counters"] = counters
        state["updatedAt"] = _now_iso()
        _atomic_write(path, state)
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def run_private_retrieval_shadow_probe(
    *,
    observation_id: str,
    query: str,
    state_path: Path,
    retriever: Callable[..., Dict[str, Any]],
    tenant_id: str,
    workspace_id: str,
    classification: Optional[Dict[str, Any]] = None,
    config: Optional[ShadowConfig] = None,
) -> Dict[str, Any]:
    """Execute one bounded probe and persist no query or candidate content."""
    cfg = config or ShadowConfig.from_env()
    decision = classification or classify_private_retrieval_query(query)
    started = time.monotonic()
    result: Dict[str, Any] = {}
    error_code: Optional[str] = None
    try:
        result = retriever(
            query,
            n_results=cfg.result_count,
            allow_fallback=True,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
        )
        rows = (result.get("results") if isinstance(result.get("results"), list) else [])[: cfg.result_count]
        pack = _select_pack(rows, max_items=cfg.pack_items, max_tokens=cfg.pack_tokens)
        raw_mode = str(result.get("search_mode", result.get("mode", "unknown"))).lower()
        allowed_modes = {
            "exact_lexical",
            "semantic_hybrid",
            "semantic",
            "lexical_fallback",
            "semantic+novelty",
            "lexical+novelty_fallback",
        }
        retrieval_mode = raw_mode if raw_mode in allowed_modes else "other"
        succeeded = bool(result.get("available", True)) and raw_mode not in {"error", "failed", "disabled", "unavailable"}
    except Exception as exc:  # Retrieval failure must not affect the answer path.
        rows = []
        pack = _select_pack(rows, max_items=cfg.pack_items, max_tokens=cfg.pack_tokens)
        succeeded = False
        retrieval_mode = "error"
        error_code = type(exc).__name__[:80]
    latency_ms = round((time.monotonic() - started) * 1000, 3)
    record = {
        "schemaVersion": SCHEMA_VERSION,
        "observationId": observation_id,
        "completedAt": _now_iso(),
        "mode": MODE,
        "eligible": bool(decision.get("eligible")),
        "selectionReason": str(decision.get("reason", "unknown"))[:80],
        "factClass": str(decision.get("factClass", "unknown"))[:80],
        "answerInfluence": False,
        "retrievalAttempted": True,
        "retrievalSucceeded": succeeded,
        "retrievalMode": retrieval_mode,
        **pack,
        "latencyMs": latency_ms,
        "latencyLimitMs": cfg.latency_limit_ms,
        "latencyWithinLimit": latency_ms <= cfg.latency_limit_ms,
        "qualityCompared": False,
        "qualityComparisonReason": "answer_path_isolated",
        **({"errorCode": error_code} if error_code else {}),
    }
    _append_record(Path(state_path), record, cfg.max_records)
    return record


def _admit_rate(scope_key: str, cfg: ShadowConfig) -> bool:
    now = time.monotonic()
    with _RATE_LOCK:
        if len(_RATE_WINDOWS) >= 4_096 and scope_key not in _RATE_WINDOWS:
            oldest_key = min(_RATE_WINDOWS, key=lambda key: _RATE_WINDOWS[key][-1] if _RATE_WINDOWS[key] else 0.0)
            _RATE_WINDOWS.pop(oldest_key, None)
        window = [stamp for stamp in _RATE_WINDOWS.get(scope_key, []) if now - stamp < cfg.rate_window_seconds]
        if len(window) >= cfg.rate_limit:
            _RATE_WINDOWS[scope_key] = window
            return False
        window.append(now)
        _RATE_WINDOWS[scope_key] = window
        return True


def submit_private_retrieval_shadow(
    *,
    query: str,
    state_path: Path,
    scope_key: str,
    retriever: Callable[..., Dict[str, Any]],
    tenant_id: str,
    workspace_id: str,
    config: Optional[ShadowConfig] = None,
) -> Dict[str, Any]:
    """Schedule a non-blocking shadow probe and return content-free markers."""
    cfg = config or ShadowConfig.from_env()
    decision = classify_private_retrieval_query(query)
    base = {
        "schemaVersion": SCHEMA_VERSION,
        "mode": MODE,
        "enabled": cfg.enabled,
        "killSwitch": cfg.kill_switch,
        "eligible": bool(decision.get("eligible")),
        "selectionReason": str(decision.get("reason", "unknown"))[:80],
        "factClass": str(decision.get("factClass", "unknown"))[:80],
        "answerInfluence": False,
        "candidateContentExposed": False,
        "scheduled": False,
    }
    if not cfg.enabled:
        return {**base, "selectionReason": "disabled"}
    if cfg.kill_switch:
        return {**base, "selectionReason": "kill_switch"}
    if not decision.get("eligible"):
        return base

    with _PENDING_LOCK:
        if len(_PENDING) >= cfg.max_pending:
            return {**base, "selectionReason": "global_capacity_limited"}
        if not _admit_rate(scope_key, cfg):
            return {**base, "selectionReason": "principal_rate_limited"}
        observation_id = hashlib.sha256(
            f"{scope_key}\0{secrets.token_hex(32)}".encode("utf-8")
        ).hexdigest()[:32]
        try:
            future = _EXECUTOR.submit(
                run_private_retrieval_shadow_probe,
                observation_id=observation_id,
                query=query,
                state_path=Path(state_path),
                retriever=retriever,
                tenant_id=tenant_id,
                workspace_id=workspace_id,
                classification=decision,
                config=cfg,
            )
        except Exception:
            return {**base, "selectionReason": "executor_unavailable"}
        _PENDING[future] = observation_id

    def complete(done: Future) -> None:
        with _PENDING_LOCK:
            _PENDING.pop(done, None)
        try:
            done.result()
        except Exception:
            # Probe exceptions are contained; run_private_retrieval_shadow_probe
            # already records retriever errors whenever persistence is available.
            pass

    future.add_done_callback(complete)
    return {**base, "scheduled": True, "observationId": observation_id}


def private_retrieval_shadow_status(state_path: Path) -> Dict[str, Any]:
    state = _load_state_unlocked(Path(state_path))
    records = state.get("records") if isinstance(state.get("records"), list) else []
    return {
        "schemaVersion": SCHEMA_VERSION,
        "mode": MODE,
        "answerInfluence": False,
        "updatedAt": state.get("updatedAt"),
        "counters": dict(state.get("counters") or {}),
        "retainedRecords": len(records),
        "latest": records[-1] if records else None,
    }


def wait_for_private_retrieval_shadow_idle(timeout_seconds: float = 5.0) -> bool:
    deadline = time.monotonic() + max(0.0, timeout_seconds)
    while time.monotonic() < deadline:
        with _PENDING_LOCK:
            if not _PENDING:
                return True
        time.sleep(0.01)
    with _PENDING_LOCK:
        return not _PENDING


def reset_private_retrieval_shadow_runtime_for_tests() -> None:
    with _RATE_LOCK:
        _RATE_WINDOWS.clear()
