from __future__ import annotations

import os
import re
import threading
import time
from collections import deque
from copy import deepcopy
from datetime import datetime, timezone
from statistics import mean
from typing import Any, Deque, Dict, List, Optional, Tuple
from uuid import uuid4

from cortex_server.modules import runtime_pressure

JsonDict = Dict[str, Any]

_LOCK = threading.RLock()
_EVENTS: Deque[JsonDict] = deque(maxlen=600)
_SESSIONS: Dict[str, JsonDict] = {}
_PENDING: Dict[str, JsonDict] = {}
_SESSION_ACCESS: Dict[str, float] = {}
_SESSION_TTLS: Dict[str, int] = {}
_SESSION_RUNTIMES: Dict[str, str] = {}
_PENDING_CREATED: Dict[str, float] = {}
_RETENTION_EVICTIONS: JsonDict = {
    "session_ttl": 0,
    "session_capacity": 0,
    "pending_ttl": 0,
    "pending_capacity": 0,
}

_FAST_ACTUAL_LANES = {
    "strict_contract_micro_fastpath",
    "semantic_guardrail",
    "semantic_guardrail_identity",
    "semantic_guardrail_secret_refusal",
    "semantic_guardrail_clarification",
    "semantic_guardrail_contradiction",
    "semantic_guardrail_entity_resolution",
    "semantic_guardrail_fact_inference",
    "semantic_guardrail_math",
    "semantic_guardrail_factual",
    "semantic_guardrail_memory",
    "gated_direct",
    "best_effort",
    "fallback_best_effort",
    "nexus_fastlane",
    "qa_fastlane",
    "qa_fastlane_anytime",
}
_DEEP_ACTUAL_LANES = {"alive_orchestrated", "augmenter", "strict_contract", "nexus_orchestrated", "qa_fastlane_escalated"}
_DEFAULT_RUNTIMES = ("oracle", "nexus", "meta_conductor")
_DEFAULT_SURFACES = ("chat", "orchestrate")


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _env_value(name: Any) -> Optional[str]:
    if isinstance(name, str):
        names = [name]
    else:
        names = [str(item) for item in (name or []) if str(item or "").strip()]
    for candidate in names:
        raw = os.getenv(candidate)
        if raw is not None:
            return raw
    return None


def _env_names(scope: str, suffix: str) -> List[str]:
    normalized = (scope or "oracle").strip().lower() or "oracle"
    prefixes: List[str]
    if normalized == "oracle":
        prefixes = ["ORACLE", "CORTEX"]
    else:
        prefixes = [normalized.upper(), "CORTEX", "ORACLE"]
    names: List[str] = []
    for prefix in prefixes:
        candidate = f"{prefix}_{suffix}"
        if candidate not in names:
            names.append(candidate)
    return names


def _env_bool(name: Any, default: bool) -> bool:
    raw = _env_value(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: Any, default: int, *, minimum: int, maximum: int) -> int:
    raw = _env_value(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except Exception:
        return default
    return max(minimum, min(maximum, value))


def _env_float(name: Any, default: float, *, minimum: float, maximum: float) -> float:
    raw = _env_value(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except Exception:
        return default
    return max(minimum, min(maximum, value))


def _settings(scope: str = "oracle") -> JsonDict:
    mode = (_env_value(_env_names(scope, "KERNEL_V2_MODE")) or "active").strip().lower() or "active"
    if mode not in {"active", "shadow", "disabled"}:
        mode = "active"
    enabled = _env_bool(_env_names(scope, "KERNEL_V2_ENABLED"), True) and mode != "disabled"
    return {
        "version": "cortex.kernel.v2",
        "scope": (scope or "oracle").strip().lower() or "oracle",
        "enabled": enabled,
        "mode": mode,
        "disable_context_reuse": _env_bool(_env_names(scope, "KERNEL_V2_DISABLE_CONTEXT_REUSE"), False),
        "disable_fast_path": _env_bool(_env_names(scope, "KERNEL_V2_DISABLE_FAST_PATH"), False),
        "disable_deep_path": _env_bool(_env_names(scope, "KERNEL_V2_DISABLE_DEEP_PATH"), False),
        "disable_prompt_compiler": _env_bool(_env_names(scope, "KERNEL_V2_DISABLE_PROMPT_COMPILER"), False),
        "disable_codec_context": _env_bool(_env_names(scope, "KERNEL_V2_DISABLE_CODEC_CONTEXT"), False),
        "fast_complexity_threshold": _env_float(_env_names(scope, "KERNEL_V2_FAST_COMPLEXITY_THRESHOLD"), 0.36, minimum=0.1, maximum=0.95),
        "deep_complexity_threshold": _env_float(_env_names(scope, "KERNEL_V2_DEEP_COMPLEXITY_THRESHOLD"), 0.68, minimum=0.2, maximum=0.99),
        "hot_turn_window": _env_int(_env_names(scope, "KERNEL_V2_HOT_TURN_WINDOW"), 3, minimum=1, maximum=8),
        "hot_chars_budget": _env_int(_env_names(scope, "KERNEL_V2_HOT_CHARS_BUDGET"), 320, minimum=80, maximum=2000),
        "warm_chars_budget": _env_int(_env_names(scope, "KERNEL_V2_WARM_CHARS_BUDGET"), 240, minimum=80, maximum=1200),
        "cold_chars_budget": _env_int(_env_names(scope, "KERNEL_V2_COLD_CHARS_BUDGET"), 420, minimum=120, maximum=2400),
        "telemetry_limit": _env_int(_env_names(scope, "KERNEL_V2_TELEMETRY_LIMIT"), 600, minimum=50, maximum=1200),
        "session_capacity": _env_int(_env_names(scope, "KERNEL_V2_SESSION_CAPACITY"), 512, minimum=1, maximum=10000),
        "session_ttl_seconds": _env_int(_env_names(scope, "KERNEL_V2_SESSION_TTL_SECONDS"), 3600, minimum=1, maximum=604800),
        "pending_capacity": _env_int(_env_names(scope, "KERNEL_V2_PENDING_CAPACITY"), 1024, minimum=1, maximum=20000),
        "pending_ttl_seconds": _env_int(_env_names(scope, "KERNEL_V2_PENDING_TTL_SECONDS"), 300, minimum=1, maximum=86400),
        "session_key_max_chars": _env_int(_env_names(scope, "KERNEL_V2_SESSION_KEY_MAX_CHARS"), 256, minimum=32, maximum=2048),
        "fast_latency_budget_ms": _env_int(_env_names(scope, "KERNEL_V2_FAST_BUDGET_MS"), 1600, minimum=200, maximum=10000),
        "deep_latency_budget_ms": _env_int(_env_names(scope, "KERNEL_V2_DEEP_BUDGET_MS"), 4200, minimum=600, maximum=20000),
    }


def _canonical_session_key(session_key: Any, *, max_chars: int = 256) -> str:
    raw = str(session_key or "").strip()
    if not raw:
        return ""
    if re.fullmatch(r"sha256:[0-9a-f]{64}", raw):
        return raw
    if len(raw) <= max(32, int(max_chars)) and all(ord(char) >= 32 for char in raw):
        return raw
    import hashlib

    return f"sha256:{hashlib.sha256(raw.encode('utf-8', errors='replace')).hexdigest()}"


def _session_storage_key(session_key: str, settings: JsonDict) -> str:
    runtime = str(settings.get("scope") or "oracle").strip().lower() or "oracle"
    return f"{runtime}\0{session_key}"


def _evict_session_locked(session_key: str, reason: str) -> None:
    _SESSIONS.pop(session_key, None)
    _SESSION_ACCESS.pop(session_key, None)
    _SESSION_TTLS.pop(session_key, None)
    _SESSION_RUNTIMES.pop(session_key, None)
    _RETENTION_EVICTIONS[reason] = int(_RETENTION_EVICTIONS.get(reason, 0) or 0) + 1


def _evict_pending_locked(request_id: str, reason: str) -> None:
    _PENDING.pop(request_id, None)
    _PENDING_CREATED.pop(request_id, None)
    _RETENTION_EVICTIONS[reason] = int(_RETENTION_EVICTIONS.get(reason, 0) or 0) + 1


def _cleanup_retention_locked(*, now: Optional[float] = None) -> None:
    current = time.monotonic() if now is None else float(now)
    for session_key, accessed_at in list(_SESSION_ACCESS.items()):
        ttl = max(1, int(_SESSION_TTLS.get(session_key, 3600) or 3600))
        if current - float(accessed_at) >= ttl:
            _evict_session_locked(session_key, "session_ttl")
    for request_id, created_at in list(_PENDING_CREATED.items()):
        trace = _PENDING.get(request_id) or {}
        settings = trace.get("settings") if isinstance(trace.get("settings"), dict) else {}
        ttl = max(1, int(settings.get("pending_ttl_seconds", 300) or 300))
        if current - float(created_at) >= ttl:
            _evict_pending_locked(request_id, "pending_ttl")


def _enforce_session_capacity_locked(settings: JsonDict, *, protected: str = "") -> None:
    capacity = max(1, int(settings.get("session_capacity", 512) or 512))
    runtime = str(settings.get("scope") or "oracle").strip().lower() or "oracle"
    runtime_keys = [key for key in _SESSIONS if _SESSION_RUNTIMES.get(key) == runtime]
    while len(runtime_keys) > capacity:
        candidates = [key for key in runtime_keys if key != protected]
        if not candidates:
            break
        oldest = min(candidates, key=lambda key: float(_SESSION_ACCESS.get(key, 0.0)))
        _evict_session_locked(oldest, "session_capacity")
        runtime_keys.remove(oldest)


def _enforce_pending_capacity_locked(settings: JsonDict, *, protected: str = "") -> None:
    capacity = max(1, int(settings.get("pending_capacity", 1024) or 1024))
    runtime = str(settings.get("scope") or "oracle").strip().lower() or "oracle"
    runtime_keys = [
        key for key, trace in _PENDING.items()
        if str(trace.get("runtime") or "oracle").strip().lower() == runtime
    ]
    while len(runtime_keys) > capacity:
        candidates = [key for key in runtime_keys if key != protected]
        if not candidates:
            break
        oldest = min(candidates, key=lambda key: float(_PENDING_CREATED.get(key, 0.0)))
        _evict_pending_locked(oldest, "pending_capacity")
        runtime_keys.remove(oldest)


def _retention_snapshot_locked(settings: JsonDict) -> JsonDict:
    _cleanup_retention_locked()
    runtime = str(settings.get("scope") or "oracle").strip().lower() or "oracle"
    session_count = sum(1 for key in _SESSIONS if _SESSION_RUNTIMES.get(key) == runtime)
    pending_count = sum(
        1 for trace in _PENDING.values()
        if str(trace.get("runtime") or "oracle").strip().lower() == runtime
    )
    return {
        "sessions": {
            "current": session_count,
            "capacity": max(1, int(settings.get("session_capacity", 512) or 512)),
            "ttl_seconds": max(1, int(settings.get("session_ttl_seconds", 3600) or 3600)),
        },
        "pending": {
            "current": pending_count,
            "capacity": max(1, int(settings.get("pending_capacity", 1024) or 1024)),
            "ttl_seconds": max(1, int(settings.get("pending_ttl_seconds", 300) or 300)),
        },
        "session_key_max_chars": max(32, int(settings.get("session_key_max_chars", 256) or 256)),
        "evictions": dict(_RETENTION_EVICTIONS),
    }


def _normalize_text(text: str) -> str:
    return " ".join((text or "").split()).strip()


def _truncate(text: str, limit: int) -> str:
    normalized = _normalize_text(text)
    if len(normalized) <= limit:
        return normalized
    return normalized[: max(1, limit - 1)] + "…"


def _keywords(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9_\-]{3,}", (text or "").lower()))


def _overlap_score(a: str, b: str) -> int:
    return len(_keywords(a).intersection(_keywords(b)))


def _risk_flags(prompt: str) -> List[str]:
    text = (prompt or "").lower()
    security_markers = ["security", "auth", "credential", "secret", "password", "exploit", "api key", "oauth", "jwt", "ssh key", "bearer token", "access token", "auth token"]
    checks = {
        "safety": ["safety", "danger", "hazard", "harm"],
        "legal": ["legal", "contract", "law", "breach"],
        "medical": ["medical", "diagnosis", "symptom", "prescription"],
        "financial": ["financial", "investment", "tax", "credit"],
        "production": ["production", "incident", "outage", "rollback", "on-call"],
    }
    flags: List[str] = []
    if any(needle in text for needle in security_markers):
        flags.append("security")
    elif "token" in text and any(marker in text for marker in ["api", "auth", "bearer", "access", "credential", "secret", "password"]):
        flags.append("security")
    flags.extend(name for name, needles in checks.items() if any(needle in text for needle in needles))
    if any(word in text for word in ["implement", "refactor", "patch", "edit file", "write code", "fix bug"]):
        flags.append("code_change")
    return sorted(set(flags))


def _intent_kind(prompt: str) -> str:
    text = (prompt or "").lower()
    mapping = [
        ("ops", ["incident", "latency", "rollback", "outage", "slo", "monitor"]),
        ("coding", ["implement", "refactor", "bug", "test", "api", "python", "router", "module"]),
        ("planning", ["plan", "roadmap", "architecture", "milestone", "tradeoff", "strategy"]),
        ("analysis", ["analyze", "compare", "evaluate", "audit", "assess"]),
        ("retrieval", ["what is", "who is", "capital of", "define", "when did"]),
        ("creative", ["brainstorm", "idea", "creative", "design"]),
    ]
    scores = [(kind, sum(1 for needle in needles if needle in text)) for kind, needles in mapping]
    best_kind, best_score = max(scores, key=lambda row: row[1], default=("general", 0))
    return best_kind if best_score > 0 else "general"


def _complexity(prompt: str, *, strict_contract: bool, risk_flags: List[str]) -> Tuple[float, List[str]]:
    text = _normalize_text(prompt)
    lowered = text.lower()
    score = 0.08
    reasons: List[str] = []

    word_count = len(re.findall(r"\S+", text))
    if word_count > 30:
        score += 0.12
        reasons.append("prompt_longer_than_30_words")
    if word_count > 80:
        score += 0.12
        reasons.append("prompt_longer_than_80_words")

    markers = {
        "multi_step": ["step", "steps", "plan", "roadmap", "checklist"],
        "analysis": ["why", "analyze", "compare", "tradeoff", "root cause"],
        "build": ["implement", "refactor", "patch", "ship", "build"],
        "verification": ["verify", "validate", "test", "benchmark", "prove"],
    }
    for name, needles in markers.items():
        if any(needle in lowered for needle in needles):
            score += 0.12
            reasons.append(name)

    if strict_contract:
        score -= 0.12
        reasons.append("strict_contract")
    if any(flag in {"security", "production", "code_change"} for flag in risk_flags):
        score += 0.18
        reasons.append("high_risk")
    if "?" in text and word_count <= 12:
        score -= 0.06
        reasons.append("single_question")
    if word_count <= 8:
        score -= 0.04
        reasons.append("very_short")

    return max(0.0, min(1.0, round(score, 3))), reasons


def _simple_qa(prompt: str, *, strict_contract: bool, complexity_score: float) -> bool:
    lowered = (prompt or "").strip().lower()
    if not lowered:
        return True
    if strict_contract and len(lowered) <= 100:
        return True
    if complexity_score >= 0.4:
        return False
    complex_markers = ["plan", "roadmap", "architecture", "debug", "fix", "compare", "tradeoff", "implement", "audit"]
    return not any(marker in lowered for marker in complex_markers)


def _is_follow_up(prompt: str) -> bool:
    lowered = (prompt or "").lower()
    cues = [
        "that",
        "it",
        "those",
        "they",
        "what about",
        "follow up",
        "as above",
        "same issue",
        "what did i ask you",
        "what token did i ask",
        "what was the token",
    ]
    return any(cue in lowered for cue in cues)


def compile_request_contract(
    prompt: str,
    *,
    system: Optional[str] = None,
    priority: str = "",
    session_key: Optional[str] = None,
    response_mode: str = "default",
    strict_contract: bool = False,
    requested_model: str = "",
    settings: Optional[JsonDict] = None,
) -> JsonDict:
    risk_flags = _risk_flags(prompt)
    intent = _intent_kind(prompt)
    complexity_score, complexity_reasons = _complexity(prompt, strict_contract=strict_contract, risk_flags=risk_flags)
    simple_qa = _simple_qa(prompt, strict_contract=strict_contract, complexity_score=complexity_score)
    priority_norm = (priority or "").strip().lower() or "normal"
    settings = dict(settings or _settings())
    session_key = _canonical_session_key(session_key, max_chars=int(settings["session_key_max_chars"])) or None

    preferred_lane = "fast"
    if settings["disable_fast_path"]:
        preferred_lane = "deep"
    elif strict_contract and simple_qa:
        preferred_lane = "fast"
    elif settings["disable_deep_path"]:
        preferred_lane = "fast"
    elif complexity_score >= settings["deep_complexity_threshold"]:
        preferred_lane = "deep"
    elif any(flag in {"security", "production", "code_change"} for flag in risk_flags):
        preferred_lane = "deep"
    elif intent in {"planning", "coding", "ops"} and complexity_score >= max(0.28, float(settings["fast_complexity_threshold"]) - 0.08):
        preferred_lane = "deep"
    elif priority_norm in {"high", "critical", "urgent"} and not simple_qa:
        preferred_lane = "deep"

    if settings["disable_deep_path"]:
        preferred_lane = "fast"

    depth_mode = "shallow" if preferred_lane == "fast" else ("deep" if complexity_score >= 0.82 or "production" in risk_flags else "medium")
    if strict_contract and simple_qa:
        depth_mode = "shallow"

    return {
        "version": settings["version"],
        "compiled_at": _utcnow_iso(),
        "session_key": session_key,
        "priority": priority_norm,
        "requested_model": requested_model,
        "response_mode": response_mode,
        "strict_contract": bool(strict_contract),
        "intent": {
            "kind": intent,
            "follow_up_like": _is_follow_up(prompt),
            "simple_qa": simple_qa,
            "frontend": "frontend" in (prompt or "").lower() or "react" in (prompt or "").lower(),
            "code_change": "code_change" in risk_flags,
        },
        "risk_flags": risk_flags,
        "complexity": {
            "score": complexity_score,
            "reasons": complexity_reasons,
        },
        "lane": {
            "preferred": preferred_lane,
            "depth_mode": depth_mode,
            "latency_budget_ms": settings["fast_latency_budget_ms"] if preferred_lane == "fast" else settings["deep_latency_budget_ms"],
            "escalate_if": ["fallback_backend", "contract_failed", "response_missing", "validator_failed"] if preferred_lane == "fast" else ["response_missing", "validator_failed"],
        },
        "system_present": bool((system or "").strip()),
    }


def _session_state(session_key: str, *, settings: Optional[JsonDict] = None) -> JsonDict:
    resolved_settings = dict(settings or _settings())
    session_key = _canonical_session_key(
        session_key,
        max_chars=int(resolved_settings.get("session_key_max_chars", 256) or 256),
    )
    storage_key = _session_storage_key(session_key, resolved_settings)
    with _LOCK:
        now = time.monotonic()
        _cleanup_retention_locked(now=now)
        state = _SESSIONS.get(storage_key)
        if state is None:
            state = {
                "hot_turns": deque(maxlen=12),
                "warm_notes": deque(maxlen=8),
                "cold_context": {},
                "updated_at": None,
                "runtime": str(resolved_settings.get("scope") or "oracle"),
                "session_key": session_key,
            }
            _SESSIONS[storage_key] = state
        _SESSION_ACCESS[storage_key] = now
        _SESSION_TTLS[storage_key] = max(1, int(resolved_settings.get("session_ttl_seconds", 3600) or 3600))
        _SESSION_RUNTIMES[storage_key] = str(resolved_settings.get("scope") or "oracle").strip().lower() or "oracle"
        _enforce_session_capacity_locked(resolved_settings, protected=storage_key)
        return state


def _compile_hot_context(session_key: Optional[str], prompt: str, *, settings: JsonDict) -> JsonDict:
    if not session_key or settings["disable_context_reuse"]:
        return {"class": "hot", "applied": False, "items": [], "text": "", "chars": 0, "hit_count": 0}
    state = _session_state(session_key, settings=settings)
    candidates = []
    with _LOCK:
        turns = list(state.get("hot_turns") or [])[- int(settings["hot_turn_window"]):]
    for turn in reversed(turns):
        overlap = _overlap_score(prompt, str(turn.get("prompt") or "")) + _overlap_score(prompt, str(turn.get("response") or ""))
        if overlap <= 0 and not turn.get("follow_up_like"):
            continue
        candidates.append({
            "prompt": _truncate(str(turn.get("prompt") or ""), 120),
            "response": _truncate(str(turn.get("response") or ""), 180),
            "lane": turn.get("lane"),
            "overlap": overlap,
        })
    text_parts = []
    used_chars = 0
    kept = []
    for item in candidates:
        section = f"Recent turn: user={item['prompt']} | reply={item['response']}"
        if used_chars + len(section) > int(settings["hot_chars_budget"]):
            break
        kept.append(item)
        text_parts.append(section)
        used_chars += len(section)
    text = "\n".join(text_parts)
    return {"class": "hot", "applied": bool(kept), "items": kept, "text": text, "chars": len(text), "hit_count": len(kept)}


def _compile_warm_context(continuity_prefix: str, *, settings: JsonDict) -> JsonDict:
    text = _truncate(continuity_prefix or "", int(settings["warm_chars_budget"])) if continuity_prefix else ""
    applied = bool(text)
    items = []
    if text:
        items.append({"kind": "referent_memory", "preview": text})
    return {"class": "warm", "applied": applied, "items": items, "text": text, "chars": len(text), "hit_count": len(items)}


def _compile_cold_context(session_key: Optional[str], codec_prefix: str, *, settings: JsonDict) -> JsonDict:
    if settings["disable_codec_context"]:
        return {"class": "cold", "applied": False, "items": [], "text": "", "chars": 0, "hit_count": 0}
    text = _truncate(codec_prefix or "", int(settings["cold_chars_budget"])) if codec_prefix else ""
    items = []
    if text:
        items.append({"kind": "codec", "preview": text})
    elif session_key and not settings["disable_context_reuse"]:
        state = _session_state(session_key, settings=settings)
        with _LOCK:
            cold = dict((state.get("cold_context") or {}))
        cached = _truncate(str(cold.get("text") or ""), int(settings["cold_chars_budget"]))
        if cached:
            text = cached
            items.append({"kind": cold.get("kind") or "codec", "preview": cached, "cached": True})
    return {"class": "cold", "applied": bool(text), "items": items, "text": text, "chars": len(text), "hit_count": len(items)}


def compile_working_set(
    prompt: str,
    *,
    session_key: Optional[str] = None,
    continuity_prefix: str = "",
    codec_prefix: str = "",
    settings: Optional[JsonDict] = None,
) -> JsonDict:
    settings = dict(settings or _settings())
    session_key = _canonical_session_key(
        session_key,
        max_chars=int(settings.get("session_key_max_chars", 256) or 256),
    ) or None
    hot = _compile_hot_context(session_key, prompt, settings=settings)
    warm = _compile_warm_context(continuity_prefix, settings=settings)
    cold = _compile_cold_context(session_key, codec_prefix, settings=settings)
    total_chars = int(hot.get("chars", 0) or 0) + int(warm.get("chars", 0) or 0) + int(cold.get("chars", 0) or 0)
    return {
        "version": settings["version"],
        "classes": {"hot": hot, "warm": warm, "cold": cold},
        "reuse": {
            "hot_hits": int(hot.get("hit_count", 0) or 0),
            "warm_hits": int(warm.get("hit_count", 0) or 0),
            "cold_hits": int(cold.get("hit_count", 0) or 0),
            "total_chars": total_chars,
        },
    }


def assemble_prompt(prompt: str, *, strict_contract: bool, working_set: JsonDict, settings: Optional[JsonDict] = None) -> str:
    settings = dict(settings or _settings())
    if settings["disable_prompt_compiler"] or strict_contract:
        return prompt
    blocks = []
    classes = dict(working_set.get("classes") or {})
    hot = dict(classes.get("hot") or {})
    warm = dict(classes.get("warm") or {})
    cold = dict(classes.get("cold") or {})
    if hot.get("applied") and hot.get("text"):
        blocks.append("Hot context (recent, reuse only if helpful):\n" + str(hot.get("text")))
    if warm.get("applied") and warm.get("text"):
        blocks.append("Warm context (session referents):\n" + str(warm.get("text")))
    if cold.get("applied") and cold.get("text"):
        blocks.append("Cold context (bounded codec memory, optional):\n" + str(cold.get("text")))
    blocks.append(prompt)
    return "\n\n".join(block for block in blocks if str(block or "").strip()).strip()


def plan_execution(contract: JsonDict, working_set: JsonDict, settings: Optional[JsonDict] = None) -> JsonDict:
    settings = dict(settings or _settings())
    preferred_lane = str((((contract or {}).get("lane") or {}).get("preferred")) or "fast")
    intent = dict((contract or {}).get("intent") or {})
    risk_flags = list((contract or {}).get("risk_flags") or [])
    complexity_score = float((((contract or {}).get("complexity") or {}).get("score")) or 0.0)
    strict_contract = bool((contract or {}).get("strict_contract"))

    lane = preferred_lane
    if settings["disable_fast_path"]:
        lane = "deep"
    if settings["disable_deep_path"]:
        lane = "fast"

    target_oracle_lane = "gated_direct"
    if strict_contract and intent.get("simple_qa"):
        target_oracle_lane = "strict_contract_micro_fastpath"
    elif strict_contract:
        target_oracle_lane = "strict_contract"
    elif lane == "deep":
        target_oracle_lane = "alive_orchestrated"
    elif intent.get("simple_qa"):
        target_oracle_lane = "gated_direct"

    use_bridge = bool(lane == "deep" or intent.get("code_change") or complexity_score >= settings["deep_complexity_threshold"])
    force_orchestrate = bool(lane == "deep" and not strict_contract)

    return {
        "lane": lane,
        "depth_mode": (((contract or {}).get("lane") or {}).get("depth_mode")) or ("deep" if lane == "deep" else "shallow"),
        "target_oracle_lane": target_oracle_lane,
        "use_bridge": use_bridge,
        "force_orchestrate": force_orchestrate,
        "latency_budget_ms": (((contract or {}).get("lane") or {}).get("latency_budget_ms")) or (settings["fast_latency_budget_ms"] if lane == "fast" else settings["deep_latency_budget_ms"]),
        "context_reuse": dict((working_set.get("reuse") or {})),
        "reason": "high_complexity_or_risk" if lane == "deep" else "fast_path_budgeted",
    }


def prepare_request(
    prompt: str,
    *,
    system: Optional[str] = None,
    priority: str = "",
    session_key: Optional[str] = None,
    response_mode: str = "default",
    strict_contract: bool = False,
    requested_model: str = "",
    continuity_prefix: str = "",
    codec_prefix: str = "",
    runtime: str = "oracle",
    surface: str = "chat",
) -> JsonDict:
    settings = _settings(runtime)
    session_key = _canonical_session_key(
        session_key,
        max_chars=int(settings.get("session_key_max_chars", 256) or 256),
    ) or None
    started = time.perf_counter()
    contract_started = time.perf_counter()
    contract = compile_request_contract(
        prompt,
        system=system,
        priority=priority,
        session_key=session_key,
        response_mode=response_mode,
        strict_contract=strict_contract,
        requested_model=requested_model,
        settings=settings,
    )
    contract_ms = round((time.perf_counter() - contract_started) * 1000.0, 3)
    context_started = time.perf_counter()
    working_set = compile_working_set(
        prompt,
        session_key=session_key,
        continuity_prefix=continuity_prefix,
        codec_prefix=codec_prefix,
        settings=settings,
    )
    context_ms = round((time.perf_counter() - context_started) * 1000.0, 3)
    plan_started = time.perf_counter()
    plan = plan_execution(contract, working_set, settings=settings)
    plan_ms = round((time.perf_counter() - plan_started) * 1000.0, 3)
    prompt_started = time.perf_counter()
    compiled_prompt = assemble_prompt(prompt, strict_contract=strict_contract, working_set=working_set, settings=settings)
    prompt_assembly_ms = round((time.perf_counter() - prompt_started) * 1000.0, 3)
    request_id = f"kernel_{uuid4().hex[:12]}"
    compile_ms = round((time.perf_counter() - started) * 1000.0, 3)
    timing_ms = {
        "contract_ms": contract_ms,
        "context_ms": context_ms,
        "plan_ms": plan_ms,
        "prompt_assembly_ms": prompt_assembly_ms,
        "compile_total_ms": compile_ms,
    }
    trace = {
        "request_id": request_id,
        "created_at": _utcnow_iso(),
        "settings": settings,
        "contract": contract,
        "working_set": working_set,
        "plan": plan,
        "compiled_prompt": compiled_prompt,
        "compiled_system": system,
        "compile_ms": compile_ms,
        "timing_ms": timing_ms,
        "session_key": session_key,
        "runtime": (runtime or "oracle").strip().lower() or "oracle",
        "surface": (surface or "chat").strip().lower() or "chat",
        "raw_prompt": prompt,
        "started_perf": started,
        "continuity_prefix": continuity_prefix,
        "codec_prefix": codec_prefix,
    }
    with _LOCK:
        now = time.monotonic()
        _cleanup_retention_locked(now=now)
        _PENDING[request_id] = trace
        _PENDING_CREATED[request_id] = now
        _enforce_pending_capacity_locked(settings, protected=request_id)
    return trace


def _actual_lane_family(actual_lane: str, *, planned_lane: str = "fast", target_oracle_lane: str = "") -> str:
    lane = str(actual_lane or "").strip()
    if lane in _DEEP_ACTUAL_LANES:
        return "deep"
    if lane in _FAST_ACTUAL_LANES:
        if lane in {"best_effort", "fallback_best_effort", "gated_direct"}:
            target = str(target_oracle_lane or "").strip().lower()
            if str(planned_lane or "").strip().lower() == "deep":
                return "deep"
            if target in {"alive_orchestrated", "augmenter", "strict_contract", "best_effort"} and "direct" not in target:
                return "deep"
        return "fast"
    if lane.startswith("semantic_guardrail") or lane.startswith("strict_contract_micro"):
        return "fast"
    return "deep" if "orchestr" in lane or "augment" in lane else "fast"


def _latency_stats(values: List[float]) -> JsonDict:
    if not values:
        return {"count": 0, "avg_ms": 0.0, "p50_ms": 0.0, "p95_ms": 0.0}
    ordered = sorted(values)
    def _pct(p: float) -> float:
        idx = max(0, min(len(ordered) - 1, int(round((len(ordered) - 1) * p))))
        return round(float(ordered[idx]), 3)
    return {
        "count": len(values),
        "avg_ms": round(float(mean(values)), 3),
        "p50_ms": _pct(0.50),
        "p95_ms": _pct(0.95),
    }


def _runtime_pressure_marker() -> JsonDict:
    status = dict((runtime_pressure.pressure_snapshot().get("status") or {}))
    return {
        "level": status.get("level") or "normal",
        "degraded": bool(status.get("degraded")),
        "reason": status.get("reason"),
    }


def _new_summary_accumulator() -> JsonDict:
    return {
        "events": 0,
        "pending_requests": 0,
        "latency_values": [],
        "compile_values": [],
        "timing_values": {
            "contract_ms": [],
            "context_ms": [],
            "plan_ms": [],
            "prompt_assembly_ms": [],
            "compile_total_ms": [],
        },
        "planned_fast": 0,
        "planned_deep": 0,
        "actual_fast": 0,
        "actual_deep": 0,
        "escalations": 0,
        "context_hit_events": 0,
        "hot_hits": 0,
        "warm_hits": 0,
        "cold_hits": 0,
        "total_chars": 0,
        "runtime_breakdown": {},
        "surface_breakdown": {},
        "latest": None,
        "session_keys": set(),
    }


def _accumulate_event_summary(acc: JsonDict, event: JsonDict) -> None:
    acc["events"] += 1
    latency = float(event.get("latency_ms") or 0.0)
    compile_ms = float(event.get("compile_ms") or 0.0)
    acc["latency_values"].append(latency)
    acc["compile_values"].append(compile_ms)
    planned_lane = str(event.get("planned_lane") or "fast")
    actual_lane = str(event.get("actual_lane_family") or "fast")
    if planned_lane == "fast":
        acc["planned_fast"] += 1
    elif planned_lane == "deep":
        acc["planned_deep"] += 1
    if actual_lane == "fast":
        acc["actual_fast"] += 1
    elif actual_lane == "deep":
        acc["actual_deep"] += 1
    if event.get("escalated"):
        acc["escalations"] += 1
    reuse = dict(event.get("context_reuse") or {})
    total_chars = int(reuse.get("total_chars") or 0)
    if total_chars > 0:
        acc["context_hit_events"] += 1
    acc["hot_hits"] += int(reuse.get("hot_hits") or 0)
    acc["warm_hits"] += int(reuse.get("warm_hits") or 0)
    acc["cold_hits"] += int(reuse.get("cold_hits") or 0)
    acc["total_chars"] += total_chars
    runtime_key = str(event.get("runtime") or "oracle")
    surface_key = str(event.get("surface") or "chat")
    acc["runtime_breakdown"][runtime_key] = acc["runtime_breakdown"].get(runtime_key, 0) + 1
    acc["surface_breakdown"][surface_key] = acc["surface_breakdown"].get(surface_key, 0) + 1
    timing = dict(event.get("timing_ms") or {})
    for key in ["contract_ms", "context_ms", "plan_ms", "prompt_assembly_ms", "compile_total_ms"]:
        if key in timing:
            acc.setdefault("timing_values", {}).setdefault(key, []).append(float(timing.get(key) or 0.0))
    session_key = str(event.get("session_key") or "").strip()
    if session_key:
        acc["session_keys"].add(session_key)
    acc["latest"] = event


def _accumulate_pending_summary(acc: JsonDict, trace: JsonDict) -> None:
    acc["pending_requests"] += 1
    session_key = str(trace.get("session_key") or "").strip()
    if session_key:
        acc["session_keys"].add(session_key)


def _finalize_summary_accumulator(acc: JsonDict, *, settings: JsonDict, scope_runtime: Optional[str] = None, scope_surface: Optional[str] = None, active_sessions: Optional[int] = None) -> JsonDict:
    count = int(acc.get("events") or 0)
    latency_values = list(acc.get("latency_values") or [])
    compile_values = list(acc.get("compile_values") or [])
    benchmark = {
        "count": count,
        "planned_fast_rate": round(int(acc.get("planned_fast") or 0) / count, 3) if count else 0.0,
        "planned_deep_rate": round(int(acc.get("planned_deep") or 0) / count, 3) if count else 0.0,
        "actual_fast_rate": round(int(acc.get("actual_fast") or 0) / count, 3) if count else 0.0,
        "actual_deep_rate": round(int(acc.get("actual_deep") or 0) / count, 3) if count else 0.0,
        "escalation_rate": round(int(acc.get("escalations") or 0) / count, 3) if count else 0.0,
        "context_hit_rate": round(int(acc.get("context_hit_events") or 0) / count, 3) if count else 0.0,
        "avg_context_chars": round(int(acc.get("total_chars") or 0) / count, 2) if count else 0.0,
    }
    latency_stats = _latency_stats(latency_values)
    compile_stats = _latency_stats(compile_values)
    timing_breakdown = {
        key: _latency_stats(list(values or []))
        for key, values in dict(acc.get("timing_values") or {}).items()
    }
    session_total = active_sessions if active_sessions is not None else len(acc.get("session_keys") or set())
    return {
        "version": settings["version"],
        "scope": {"runtime": scope_runtime or None, "surface": scope_surface or None},
        "enabled": settings["enabled"],
        "mode": settings["mode"],
        "settings": {
            "disable_context_reuse": settings["disable_context_reuse"],
            "disable_fast_path": settings["disable_fast_path"],
            "disable_deep_path": settings["disable_deep_path"],
            "disable_prompt_compiler": settings["disable_prompt_compiler"],
            "disable_codec_context": settings["disable_codec_context"],
            "fast_complexity_threshold": settings["fast_complexity_threshold"],
            "deep_complexity_threshold": settings["deep_complexity_threshold"],
        },
        "telemetry": {
            "events": count,
            "pending_requests": int(acc.get("pending_requests") or 0),
            "active_sessions": session_total,
            "latency": latency_stats,
            "compile": compile_stats,
            "timing_breakdown_ms": timing_breakdown,
            "context_hits": {
                "hot": int(acc.get("hot_hits") or 0),
                "warm": int(acc.get("warm_hits") or 0),
                "cold": int(acc.get("cold_hits") or 0),
            },
            "runtime_breakdown": dict(acc.get("runtime_breakdown") or {}),
            "surface_breakdown": dict(acc.get("surface_breakdown") or {}),
            "runtime_pressure": runtime_pressure.pressure_snapshot(),
        },
        "benchmark": benchmark,
        "economics": {
            "latency_budget_ms": {
                "fast": settings["fast_latency_budget_ms"],
                "deep": settings["deep_latency_budget_ms"],
            },
            "compile_p95_ms": compile_stats.get("p95_ms", 0.0),
            "latency_p95_ms": latency_stats.get("p95_ms", 0.0),
            "avg_context_chars": benchmark.get("avg_context_chars", 0.0),
            "escalation_rate": benchmark.get("escalation_rate", 0.0),
            "planned_fast_rate": benchmark.get("planned_fast_rate", 0.0),
            "actual_fast_rate": benchmark.get("actual_fast_rate", 0.0),
            "actual_deep_rate": benchmark.get("actual_deep_rate", 0.0),
        },
        "latest": acc.get("latest"),
    }


def finalize_request(
    request_id: Optional[str],
    *,
    response: Optional[str],
    actual_lane: str,
    used_backend: str = "",
    fallback_reason: Optional[str] = None,
    contract_ok: Optional[bool] = None,
    error: Optional[str] = None,
) -> JsonDict:
    with _LOCK:
        _cleanup_retention_locked()
        trace = _PENDING.pop(str(request_id or ""), None) if request_id else None
        if request_id:
            _PENDING_CREATED.pop(str(request_id or ""), None)
    if trace is None:
        return {"recorded": False, "reason": "missing_trace"}

    elapsed_ms = round((time.perf_counter() - float(trace.get("started_perf") or time.perf_counter())) * 1000.0, 3)
    planned_lane = str((((trace.get("plan") or {}).get("lane")) or "fast"))
    target_oracle_lane = str((((trace.get("plan") or {}).get("target_oracle_lane")) or "gated_direct"))
    actual_lane_family = _actual_lane_family(actual_lane, planned_lane=planned_lane, target_oracle_lane=target_oracle_lane)
    response_text = str(response or "")
    escalated = False
    if planned_lane == "fast" and actual_lane_family == "deep":
        escalated = True
    if contract_ok is False or not response_text.strip() or error or (fallback_reason and ("fallback" in str(fallback_reason).lower() or "bridge" in str(fallback_reason).lower())):
        escalated = True

    event = {
        "event_id": f"evt_{uuid4().hex[:10]}",
        "ts": _utcnow_iso(),
        "request_id": trace.get("request_id"),
        "session_key": trace.get("session_key"),
        "runtime": trace.get("runtime") or ((trace.get("settings") or {}).get("scope")) or "oracle",
        "surface": trace.get("surface") or "chat",
        "intent_kind": (((trace.get("contract") or {}).get("intent") or {}).get("kind")) or "general",
        "planned_lane": planned_lane,
        "actual_lane": actual_lane,
        "actual_lane_family": actual_lane_family,
        "target_oracle_lane": target_oracle_lane,
        "used_backend": used_backend,
        "fallback_reason": fallback_reason,
        "contract_ok": contract_ok,
        "response_present": bool(response_text.strip()),
        "error": error,
        "escalated": bool(escalated),
        "compile_ms": float(trace.get("compile_ms") or 0.0),
        "timing_ms": deepcopy(trace.get("timing_ms") or {}),
        "latency_ms": elapsed_ms,
        "context_reuse": deepcopy(((trace.get("working_set") or {}).get("reuse") or {})),
        "strict_contract": bool((trace.get("contract") or {}).get("strict_contract")),
        "mode": str(((trace.get("settings") or {}).get("mode")) or "active"),
        "shadow": str(((trace.get("settings") or {}).get("mode")) or "active") == "shadow",
        "prompt_preview": _truncate(str(trace.get("raw_prompt") or ""), 180),
        "runtime_pressure": _runtime_pressure_marker(),
    }

    session_key = str(trace.get("session_key") or "").strip()
    if session_key and not bool((trace.get("settings") or {}).get("disable_context_reuse")):
        with _LOCK:
            state = _session_state(session_key, settings=trace.get("settings"))
            hot_turns = state.get("hot_turns")
            if isinstance(hot_turns, deque):
                hot_turns.append(
                    {
                        "prompt": _truncate(str(trace.get("raw_prompt") or ""), 180),
                        "response": _truncate(response_text, 220),
                        "lane": actual_lane,
                        "follow_up_like": bool((((trace.get("contract") or {}).get("intent") or {}).get("follow_up_like"))),
                        "ts": _utcnow_iso(),
                    }
                )
            warm_notes = state.get("warm_notes")
            if isinstance(warm_notes, deque):
                continuity = _truncate(str(trace.get("continuity_prefix") or ""), 220)
                if continuity:
                    warm_notes.append({"text": continuity, "ts": _utcnow_iso()})
            codec_text = _truncate(str(trace.get("codec_prefix") or ""), int(((trace.get("settings") or {}).get("cold_chars_budget")) or 420))
            if codec_text:
                state["cold_context"] = {"kind": "codec", "text": codec_text, "updated_at": _utcnow_iso()}
            state["updated_at"] = _utcnow_iso()
            _SESSIONS[_session_storage_key(session_key, trace.get("settings") or {})] = state
            _EVENTS.append(event)
    else:
        with _LOCK:
            _EVENTS.append(event)

    return {"recorded": True, "event": event}


def recent_events(limit: int = 50, *, runtime: Optional[str] = None, surface: Optional[str] = None) -> List[JsonDict]:
    with _LOCK:
        _cleanup_retention_locked()
        items = list(_EVENTS)
    if runtime:
        runtime_norm = str(runtime or "").strip().lower()
        items = [item for item in items if str(item.get("runtime") or "").strip().lower() == runtime_norm]
    if surface:
        surface_norm = str(surface or "").strip().lower()
        items = [item for item in items if str(item.get("surface") or "").strip().lower() == surface_norm]
    try:
        n = max(1, min(int(limit or 50), len(items) or 1))
    except Exception:
        n = 50
    return items[-n:]


def known_runtimes(*, include_defaults: bool = True) -> List[str]:
    with _LOCK:
        _cleanup_retention_locked()
        names = {
            str(item.get("runtime") or "").strip().lower()
            for item in [*_EVENTS, *_PENDING.values()]
            if str(item.get("runtime") or "").strip()
        }
    if include_defaults:
        names.update(_DEFAULT_RUNTIMES)
    return sorted(name for name in names if name)


def known_surfaces(*, runtime: Optional[str] = None, include_defaults: bool = True) -> List[str]:
    runtime_norm = str(runtime or "").strip().lower()
    with _LOCK:
        _cleanup_retention_locked()
        names = {
            str(item.get("surface") or "").strip().lower()
            for item in [*_EVENTS, *_PENDING.values()]
            if str(item.get("surface") or "").strip()
            and (not runtime_norm or str(item.get("runtime") or "").strip().lower() == runtime_norm)
        }
    if include_defaults:
        if not runtime_norm or runtime_norm == "oracle":
            names.add("chat")
        if not runtime_norm or runtime_norm in {"nexus", "meta_conductor"}:
            names.add("orchestrate")
        if not names:
            names.update(_DEFAULT_SURFACES)
    return sorted(name for name in names if name)


def performance_snapshot(*, runtime: Optional[str] = None, surface: Optional[str] = None) -> JsonDict:
    scope = str(runtime or "oracle").strip().lower() or "oracle"
    settings = _settings(scope)
    with _LOCK:
        retention = _retention_snapshot_locked(settings)
        all_events = list(_EVENTS)
        pending_traces = list(_PENDING.values())
        global_active_sessions = len(_SESSIONS)
    runtime_norm = str(runtime or "").strip().lower()
    surface_norm = str(surface or "").strip().lower()
    events = all_events
    if runtime_norm:
        events = [event for event in events if str(event.get("runtime") or "").strip().lower() == runtime_norm]
        pending_traces = [trace for trace in pending_traces if str(trace.get("runtime") or "").strip().lower() == runtime_norm]
    if surface_norm:
        events = [event for event in events if str(event.get("surface") or "").strip().lower() == surface_norm]
        pending_traces = [trace for trace in pending_traces if str(trace.get("surface") or "").strip().lower() == surface_norm]
    if runtime_norm or surface_norm:
        active_sessions = len(
            {
                str(item.get("session_key") or "").strip()
                for item in [*events, *pending_traces]
                if str(item.get("session_key") or "").strip()
            }
        )
    else:
        active_sessions = global_active_sessions
    pending = len(pending_traces)
    latency_values = [float(event.get("latency_ms") or 0.0) for event in events]
    compile_values = [float(event.get("compile_ms") or 0.0) for event in events]
    planned_fast = sum(1 for event in events if event.get("planned_lane") == "fast")
    planned_deep = sum(1 for event in events if event.get("planned_lane") == "deep")
    actual_fast = sum(1 for event in events if event.get("actual_lane_family") == "fast")
    actual_deep = sum(1 for event in events if event.get("actual_lane_family") == "deep")
    escalations = sum(1 for event in events if event.get("escalated"))
    hot_hits = sum(int(((event.get("context_reuse") or {}).get("hot_hits")) or 0) for event in events)
    warm_hits = sum(int(((event.get("context_reuse") or {}).get("warm_hits")) or 0) for event in events)
    cold_hits = sum(int(((event.get("context_reuse") or {}).get("cold_hits")) or 0) for event in events)
    total_chars = sum(int(((event.get("context_reuse") or {}).get("total_chars")) or 0) for event in events)
    count = len(events)
    benchmark = {
        "count": count,
        "planned_fast_rate": round(planned_fast / count, 3) if count else 0.0,
        "planned_deep_rate": round(planned_deep / count, 3) if count else 0.0,
        "actual_fast_rate": round(actual_fast / count, 3) if count else 0.0,
        "actual_deep_rate": round(actual_deep / count, 3) if count else 0.0,
        "escalation_rate": round(escalations / count, 3) if count else 0.0,
        "context_hit_rate": round(sum(1 for event in events if int(((event.get("context_reuse") or {}).get("total_chars")) or 0) > 0) / count, 3) if count else 0.0,
        "avg_context_chars": round(total_chars / count, 2) if count else 0.0,
    }
    runtime_breakdown: Dict[str, int] = {}
    surface_breakdown: Dict[str, int] = {}
    timing_breakdown = {
        key: _latency_stats([float((dict(event.get("timing_ms") or {})).get(key) or 0.0) for event in events if key in dict(event.get("timing_ms") or {})])
        for key in ["contract_ms", "context_ms", "plan_ms", "prompt_assembly_ms", "compile_total_ms"]
    }
    for event in events:
        runtime_key = str(event.get("runtime") or "oracle")
        surface_key = str(event.get("surface") or "chat")
        runtime_breakdown[runtime_key] = runtime_breakdown.get(runtime_key, 0) + 1
        surface_breakdown[surface_key] = surface_breakdown.get(surface_key, 0) + 1
    snapshot = {
        "version": settings["version"],
        "scope": {"runtime": runtime_norm or None, "surface": surface_norm or None},
        "enabled": settings["enabled"],
        "mode": settings["mode"],
        "settings": {
            "disable_context_reuse": settings["disable_context_reuse"],
            "disable_fast_path": settings["disable_fast_path"],
            "disable_deep_path": settings["disable_deep_path"],
            "disable_prompt_compiler": settings["disable_prompt_compiler"],
            "disable_codec_context": settings["disable_codec_context"],
            "fast_complexity_threshold": settings["fast_complexity_threshold"],
            "deep_complexity_threshold": settings["deep_complexity_threshold"],
        },
        "telemetry": {
            "events": count,
            "pending_requests": pending,
            "active_sessions": active_sessions,
            "latency": _latency_stats(latency_values),
            "compile": _latency_stats(compile_values),
            "timing_breakdown_ms": timing_breakdown,
            "context_hits": {
                "hot": hot_hits,
                "warm": warm_hits,
                "cold": cold_hits,
            },
            "runtime_breakdown": runtime_breakdown,
            "surface_breakdown": surface_breakdown,
            "runtime_pressure": runtime_pressure.pressure_snapshot(),
        },
        "benchmark": benchmark,
        "economics": {
            "latency_budget_ms": {
                "fast": settings["fast_latency_budget_ms"],
                "deep": settings["deep_latency_budget_ms"],
            },
            "compile_p95_ms": (( _latency_stats(compile_values) ).get("p95_ms")) if compile_values else 0.0,
            "latency_p95_ms": (( _latency_stats(latency_values) ).get("p95_ms")) if latency_values else 0.0,
            "avg_context_chars": benchmark.get("avg_context_chars", 0.0),
            "escalation_rate": benchmark.get("escalation_rate", 0.0),
            "planned_fast_rate": benchmark.get("planned_fast_rate", 0.0),
            "actual_fast_rate": benchmark.get("actual_fast_rate", 0.0),
            "actual_deep_rate": benchmark.get("actual_deep_rate", 0.0),
        },
        "latest": events[-1] if events else None,
    }
    snapshot["telemetry"]["retention"] = retention
    return snapshot


def mission_control_summary() -> JsonDict:
    with _LOCK:
        retention = _retention_snapshot_locked(_settings("oracle"))
        all_events = list(_EVENTS)
        pending_traces = list(_PENDING.values())
        global_active_sessions = len(_SESSIONS)

    runtime_names = sorted({*known_runtimes(), *(str(event.get("runtime") or "").strip().lower() for event in all_events if str(event.get("runtime") or "").strip())})
    surface_names = sorted({*known_surfaces(), *(str(event.get("surface") or "").strip().lower() for event in all_events if str(event.get("surface") or "").strip())})

    global_acc = _new_summary_accumulator()
    runtime_accs: Dict[str, JsonDict] = {name: _new_summary_accumulator() for name in runtime_names}
    surface_accs: Dict[str, JsonDict] = {name: _new_summary_accumulator() for name in surface_names}

    for event in all_events:
        _accumulate_event_summary(global_acc, event)
        runtime_key = str(event.get("runtime") or "").strip().lower()
        surface_key = str(event.get("surface") or "").strip().lower()
        if runtime_key:
            runtime_accs.setdefault(runtime_key, _new_summary_accumulator())
            _accumulate_event_summary(runtime_accs[runtime_key], event)
        if surface_key:
            surface_accs.setdefault(surface_key, _new_summary_accumulator())
            _accumulate_event_summary(surface_accs[surface_key], event)

    for trace in pending_traces:
        _accumulate_pending_summary(global_acc, trace)
        runtime_key = str(trace.get("runtime") or "").strip().lower()
        surface_key = str(trace.get("surface") or "").strip().lower()
        if runtime_key:
            runtime_accs.setdefault(runtime_key, _new_summary_accumulator())
            _accumulate_pending_summary(runtime_accs[runtime_key], trace)
        if surface_key:
            surface_accs.setdefault(surface_key, _new_summary_accumulator())
            _accumulate_pending_summary(surface_accs[surface_key], trace)

    snapshot = _finalize_summary_accumulator(global_acc, settings=_settings("oracle"), active_sessions=global_active_sessions)
    benchmark = dict(snapshot.get("benchmark") or {})
    telemetry = dict(snapshot.get("telemetry") or {})

    runtime_summaries: Dict[str, JsonDict] = {}
    for name in sorted(runtime_accs):
        runtime_snapshot = _finalize_summary_accumulator(runtime_accs[name], settings=_settings(name), scope_runtime=name)
        runtime_benchmark = dict(runtime_snapshot.get("benchmark") or {})
        runtime_telemetry = dict(runtime_snapshot.get("telemetry") or {})
        runtime_economics = dict(runtime_snapshot.get("economics") or {})
        runtime_summaries[name] = {
            "enabled": runtime_snapshot.get("enabled"),
            "mode": runtime_snapshot.get("mode"),
            "events": runtime_telemetry.get("events", 0),
            "pending_requests": runtime_telemetry.get("pending_requests", 0),
            "active_sessions": runtime_telemetry.get("active_sessions", 0),
            "planned_fast_rate": runtime_benchmark.get("planned_fast_rate", 0.0),
            "actual_fast_rate": runtime_benchmark.get("actual_fast_rate", 0.0),
            "actual_deep_rate": runtime_benchmark.get("actual_deep_rate", 0.0),
            "escalation_rate": runtime_benchmark.get("escalation_rate", 0.0),
            "context_hit_rate": runtime_benchmark.get("context_hit_rate", 0.0),
            "latency_p95_ms": runtime_economics.get("latency_p95_ms", 0.0),
            "compile_p95_ms": runtime_economics.get("compile_p95_ms", 0.0),
            "avg_context_chars": runtime_economics.get("avg_context_chars", 0.0),
            "surface_breakdown": dict(runtime_telemetry.get("surface_breakdown") or {}),
            "settings": {
                "disable_context_reuse": ((runtime_snapshot.get("settings") or {}).get("disable_context_reuse")),
                "disable_fast_path": ((runtime_snapshot.get("settings") or {}).get("disable_fast_path")),
                "disable_deep_path": ((runtime_snapshot.get("settings") or {}).get("disable_deep_path")),
                "disable_prompt_compiler": ((runtime_snapshot.get("settings") or {}).get("disable_prompt_compiler")),
                "disable_codec_context": ((runtime_snapshot.get("settings") or {}).get("disable_codec_context")),
            },
            "latency_budget_ms": dict(runtime_economics.get("latency_budget_ms") or {}),
            "latest": runtime_snapshot.get("latest"),
        }

    surface_summaries: Dict[str, JsonDict] = {}
    for name in sorted(surface_accs):
        surface_snapshot = _finalize_summary_accumulator(surface_accs[name], settings=_settings("oracle"), scope_surface=name)
        surface_benchmark = dict(surface_snapshot.get("benchmark") or {})
        surface_telemetry = dict(surface_snapshot.get("telemetry") or {})
        surface_economics = dict(surface_snapshot.get("economics") or {})
        latest = surface_snapshot.get("latest") if isinstance(surface_snapshot.get("latest"), dict) else None
        surface_summaries[name] = {
            "events": surface_telemetry.get("events", 0),
            "pending_requests": surface_telemetry.get("pending_requests", 0),
            "active_sessions": surface_telemetry.get("active_sessions", 0),
            "planned_fast_rate": surface_benchmark.get("planned_fast_rate", 0.0),
            "actual_fast_rate": surface_benchmark.get("actual_fast_rate", 0.0),
            "actual_deep_rate": surface_benchmark.get("actual_deep_rate", 0.0),
            "escalation_rate": surface_benchmark.get("escalation_rate", 0.0),
            "context_hit_rate": surface_benchmark.get("context_hit_rate", 0.0),
            "latency_p95_ms": surface_economics.get("latency_p95_ms", 0.0),
            "compile_p95_ms": surface_economics.get("compile_p95_ms", 0.0),
            "avg_context_chars": surface_economics.get("avg_context_chars", 0.0),
            "runtime_breakdown": dict(surface_telemetry.get("runtime_breakdown") or {}),
            "latest_runtime": latest.get("runtime") if latest else None,
            "latest": latest,
        }

    return {
        "kernel_v2": {
            "enabled": snapshot.get("enabled"),
            "mode": snapshot.get("mode"),
            "events": telemetry.get("events", 0),
            "pending_requests": telemetry.get("pending_requests", 0),
            "active_sessions": telemetry.get("active_sessions", 0),
            "planned_fast_rate": benchmark.get("planned_fast_rate", 0.0),
            "actual_fast_rate": benchmark.get("actual_fast_rate", 0.0),
            "actual_deep_rate": benchmark.get("actual_deep_rate", 0.0),
            "escalation_rate": benchmark.get("escalation_rate", 0.0),
            "context_hit_rate": benchmark.get("context_hit_rate", 0.0),
            "latency_p95_ms": ((telemetry.get("latency") or {}).get("p95_ms")) or 0.0,
            "compile_p95_ms": ((telemetry.get("compile") or {}).get("p95_ms")) or 0.0,
            "avg_context_chars": benchmark.get("avg_context_chars", 0.0),
            "runtime_breakdown": dict(telemetry.get("runtime_breakdown") or {}),
            "surface_breakdown": dict(telemetry.get("surface_breakdown") or {}),
            "retention": retention,
            "latest": snapshot.get("latest"),
            "runtimes": runtime_summaries,
            "surfaces": surface_summaries,
            "rollout": {
                "runtimes": {
                    name: {
                        "enabled": runtime_summaries[name].get("enabled"),
                        "mode": runtime_summaries[name].get("mode"),
                        "settings": dict(runtime_summaries[name].get("settings") or {}),
                        "latency_budget_ms": dict(runtime_summaries[name].get("latency_budget_ms") or {}),
                    }
                    for name in runtime_summaries
                }
            },
        }
    }


def diagnostic_bundle(*, runtime: Optional[str] = None, surface: Optional[str] = None, limit: int = 50) -> JsonDict:
    return {
        "status": performance_snapshot(runtime=runtime, surface=surface),
        "events": recent_events(limit=limit, runtime=runtime, surface=surface),
    }


def reset_state() -> None:
    with _LOCK:
        _EVENTS.clear()
        _SESSIONS.clear()
        _PENDING.clear()
        _SESSION_ACCESS.clear()
        _SESSION_TTLS.clear()
        _SESSION_RUNTIMES.clear()
        _PENDING_CREATED.clear()
        for key in _RETENTION_EVICTIONS:
            _RETENTION_EVICTIONS[key] = 0
