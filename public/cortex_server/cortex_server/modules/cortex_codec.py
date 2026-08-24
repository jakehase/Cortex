from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import copy
import hashlib
import importlib
import json
import os
import re
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from cortex_server.modules.latency_budget_governor import classify_task_archetype
from cortex_server.modules.evidence_lineage import build_codec_memory_facts


CODEC_VERSION = "cortex.codec.v1"
CODEC_SCHEMA_VERSION = "cortex.codec.schema.v1"

PREFERENCE_HINTS = (
    "prefer",
    "call me",
    "start replies",
    "begin with",
    "begin replies with",
    "reply prefix",
    "always",
)

OPEN_LOOP_HINTS = (
    "todo",
    "tbd",
    "remaining",
    "what remains",
    "need to",
    "follow up",
    "next",
    "pending",
    "open loop",
)

FAILURE_HINTS = (
    "bug",
    "mistake",
    "failed",
    "failure",
    "regression",
    "issue",
    "hallucinat",
    "overconfident",
    "drift",
)

OUTCOME_SUCCESS_HINTS = (
    "worked",
    "fixed",
    "passed",
    "green",
    "resolved",
    "success",
    "successful",
)

OUTCOME_FAILURE_HINTS = (
    "failed",
    "broke",
    "regressed",
    "wrong",
    "error",
)

PROJECT_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "into",
    "your",
    "have",
    "will",
    "about",
    "would",
    "could",
    "should",
    "using",
    "build",
    "cortex",
    "codex",
    "codec",
}

PROJECT_GENERIC_TAGS = {
    "preference",
    "preferences",
    "planning",
    "plan",
    "decision",
    "decisions",
    "identity",
    "feedback",
    "note",
    "notes",
    "postmortem",
    "research",
    "nexus_query",
    "nexus_response",
}

PROJECT_SINGLE_TOKEN_STOPWORDS = {
    "start",
    "begin",
    "need",
    "important",
    "call",
    "prefer",
    "correction",
    "actually",
    "thanks",
    "thank",
    "note",
    "feedback",
    "planning",
    "decision",
    "we",
    "do",
}

PROJECT_CONTEXT_NOUNS = (
    "project",
    "program",
    "pilot",
    "initiative",
    "repo",
    "repository",
    "workspace",
    "codebase",
    "capsule",
)

PROJECT_ALIASES = (
    (re.compile(r"\blearning[\s_-]+os\b", re.IGNORECASE), "Learning OS"),
    (re.compile(r"\bprofessional[\s_-]+web(?:site)?[\s_-]+design\b", re.IGNORECASE), "Website Design"),
    (re.compile(r"\bwebsite[\s_-]+design\b", re.IGNORECASE), "Website Design"),
    (re.compile(r"\bweb[\s_-]+design\b", re.IGNORECASE), "Website Design"),
)

_PROJECT_NEGATED_ACTIVITY_TERMS = (
    "change",
    "changes",
    "work",
    "deployment",
    "deployments",
    "activity",
    "touch",
    "touches",
    "update",
    "updates",
)

_SESSION_CODEC_STATE: Dict[str, Dict[str, Any]] = {}
_SESSION_CODEC_LOCK = threading.Lock()
_SESSION_CODEC_PERSIST: Dict[str, Dict[str, Any]] = {}
_ROLLUP_AUTOTUNE_LOCK = threading.Lock()
_ROLLUP_AUTOTUNE_STATE_PATH = Path(os.getenv("CODEC_ROLLUP_POLICY_STATE_PATH", "/opt/clawdbot/state/cortex_codec_rollup_policy.json"))
_ROLLUP_AUTOTUNE_STATE: Optional[Dict[str, Any]] = None
CODEC_DURABLE_ENABLED = True
CODEC_RETENTION_MAX_SNAPSHOTS = int(os.getenv("CODEC_RETENTION_MAX_SNAPSHOTS", "4"))
CODEC_RETENTION_MIN_PRIORITY = float(os.getenv("CODEC_RETENTION_MIN_PRIORITY", "2.4"))
CODEC_RETENTION_MAX_PRIORITY_OVERFLOW = int(os.getenv("CODEC_RETENTION_MAX_PRIORITY_OVERFLOW", "2"))
CODEC_IN_MEMORY_MAX_SESSIONS = int(os.getenv("CODEC_IN_MEMORY_MAX_SESSIONS", "128"))
CODEC_STATE_TEXT_MAX_CHARS = int(os.getenv("CODEC_STATE_TEXT_MAX_CHARS", "1200"))
CODEC_STATE_SUMMARY_MAX_CHARS = int(os.getenv("CODEC_STATE_SUMMARY_MAX_CHARS", "2400"))
_CODEC_DERIVED_STATE_KEYS = {
    "durable_write",
    "memory_facts",
    "promotion_state",
    "rollup_state",
    "schema_state",
}
_CODEC_SOURCE_STATE_KEYS = {
    "version",
    "schema_version",
    "state_revision",
    "generated_at",
    "source_event_count",
    "source_refs",
    "compression",
    "identity_state",
    "project_state",
    "world_state",
    "failure_state",
    "outcome_state",
    "utility_state",
    "summary",
    "migration",
}

UTILITY_BUCKET_WEIGHTS = {
    "preferences": 1.0,
    "active_projects": 0.7,
    "active_goals": 0.92,
    "open_loops": 1.08,
    "durable_facts": 0.95,
    "patterns": 0.88,
    "lessons": 0.9,
}
UTILITY_REPEAT_BOOST = 0.12
UTILITY_MAX_SCORE = 3.0
UTILITY_DECAY = 0.92
UTILITY_OUTCOME_BOOST = 0.35
PROMOTION_MIN_SCORE = float(os.getenv("CODEC_PROMOTION_MIN_SCORE", "1.15"))
PROMOTION_MIN_EVIDENCE = int(os.getenv("CODEC_PROMOTION_MIN_EVIDENCE", "1"))
PROMOTION_MIN_CONFIDENCE = float(os.getenv("CODEC_PROMOTION_MIN_CONFIDENCE", "0.42"))
PROMOTION_CANDIDATE_MARGIN = float(os.getenv("CODEC_PROMOTION_CANDIDATE_MARGIN", "0.18"))
PROMOTION_OUTCOME_BONUS = float(os.getenv("CODEC_PROMOTION_OUTCOME_BONUS", "0.22"))
CODEC_ROLLUP_MATCH_MIN_OVERLAP = float(os.getenv("CODEC_ROLLUP_MATCH_MIN_OVERLAP", "0.84"))
CODEC_ROLLUP_ALIAS_PREFER_SESSION_DELTA = int(os.getenv("CODEC_ROLLUP_ALIAS_PREFER_SESSION_DELTA", "1"))
CODEC_ROLLUP_ALIAS_PREFER_EVIDENCE_DELTA = int(os.getenv("CODEC_ROLLUP_ALIAS_PREFER_EVIDENCE_DELTA", "1"))
CODEC_ROLLUP_CONFIDENCE_BLEND = float(os.getenv("CODEC_ROLLUP_CONFIDENCE_BLEND", "0.30"))
CODEC_ROLLUP_CROSS_SESSION_CONFIDENCE_PER_SESSION = float(os.getenv("CODEC_ROLLUP_CROSS_SESSION_CONFIDENCE_PER_SESSION", "0.04"))
CODEC_ROLLUP_CROSS_SESSION_CONFIDENCE_CAP = float(os.getenv("CODEC_ROLLUP_CROSS_SESSION_CONFIDENCE_CAP", "0.16"))
CODEC_ROLLUP_CROSS_SESSION_SCORE_PER_SESSION = float(os.getenv("CODEC_ROLLUP_CROSS_SESSION_SCORE_PER_SESSION", "0.03"))
CODEC_ROLLUP_CROSS_SESSION_SCORE_CAP = float(os.getenv("CODEC_ROLLUP_CROSS_SESSION_SCORE_CAP", "0.18"))
CODEC_ROLLUP_AUTOTUNE_MIN_RUNS = int(os.getenv("CODEC_ROLLUP_AUTOTUNE_MIN_RUNS", "3"))
CODEC_ROLLUP_AUTOTUNE_MAX_OVERLAP_DELTA = float(os.getenv("CODEC_ROLLUP_AUTOTUNE_MAX_OVERLAP_DELTA", "0.06"))
CODEC_ROLLUP_AUTOTUNE_MAX_BLEND_DELTA = float(os.getenv("CODEC_ROLLUP_AUTOTUNE_MAX_BLEND_DELTA", "0.18"))
CODEC_ROLLUP_AUTOTUNE_MAX_CROSS_SESSION_SCORE_DELTA = float(os.getenv("CODEC_ROLLUP_AUTOTUNE_MAX_CROSS_SESSION_SCORE_DELTA", "0.03"))
CODEC_PACKET_MAX_ITEMS_PER_BUCKET = int(os.getenv("CODEC_PACKET_MAX_ITEMS_PER_BUCKET", "2"))
CODEC_PACKET_INCLUDE_STALE = os.getenv("CODEC_PACKET_INCLUDE_STALE", "0").strip().lower() in {"1", "true", "yes", "on"}
CODEC_PACKET_USE_PROMOTION = os.getenv("CODEC_PACKET_USE_PROMOTION", "1").strip().lower() not in {"0", "false", "no", "off"}
CODEC_PACKET_INCLUDE_GOALS = os.getenv("CODEC_PACKET_INCLUDE_GOALS", "0").strip().lower() in {"1", "true", "yes", "on"}
CODEC_PACKET_INCLUDE_PATTERNS = os.getenv("CODEC_PACKET_INCLUDE_PATTERNS", "0").strip().lower() in {"1", "true", "yes", "on"}
REVISION_LOG_LIMIT = 12
REVISION_HINTS = (
    "actually",
    "update",
    "updated",
    "correction",
    "instead",
    "rather than",
    "no longer",
    "switched",
    "switch",
    "changed",
    "change",
    "now",
)


def _codec_retention_policy() -> Dict[str, Any]:
    return {
        "max_snapshots": max(1, int(CODEC_RETENTION_MAX_SNAPSHOTS)),
        "min_priority_to_preserve": float(CODEC_RETENTION_MIN_PRIORITY),
        "max_priority_overflow": max(0, int(CODEC_RETENTION_MAX_PRIORITY_OVERFLOW)),
        "dedupe_by_fingerprint": True,
        "selection_order": ["protected", "retention_priority", "generated_at"],
    }


def _compact_codec_state(state: Dict[str, Any]) -> Dict[str, Any]:
    """Return bounded source state; global rollups and projections are derived on read."""
    if not isinstance(state, dict):
        return {}
    return _sanitize_codec_source_state(state)


def _cache_codec_state(session_key: str, state: Dict[str, Any], persist: Optional[Dict[str, Any]] = None) -> None:
    if not session_key:
        return
    compact = _compact_codec_state(state)
    with _SESSION_CODEC_LOCK:
        _SESSION_CODEC_STATE.pop(session_key, None)
        _SESSION_CODEC_STATE[session_key] = compact
        if persist is not None:
            _SESSION_CODEC_PERSIST.pop(session_key, None)
            _SESSION_CODEC_PERSIST[session_key] = dict(persist)
        while len(_SESSION_CODEC_STATE) > max(1, CODEC_IN_MEMORY_MAX_SESSIONS):
            oldest = next(iter(_SESSION_CODEC_STATE))
            _SESSION_CODEC_STATE.pop(oldest, None)
            _SESSION_CODEC_PERSIST.pop(oldest, None)


def _default_rollup_autotune_row() -> Dict[str, Any]:
    return {
        "runs": 0,
        "overall_passes": 0,
        "codec_wins": 0,
        "avg_judge_margin": 0.0,
        "avg_codec_margin": 0.0,
        "adjustments": {
            "match_min_overlap_delta": 0.0,
            "confidence_blend_delta": 0.0,
            "cross_session_score_per_session_delta": 0.0,
            "alias_prefer_session_delta_delta": 0,
            "alias_prefer_evidence_delta_delta": 0,
        },
        "action": "hold",
        "confidence": 0.0,
        "reason": "collecting_evidence",
        "last_session_key": "",
    }



def _default_rollup_autotune_state() -> Dict[str, Any]:
    return {
        "version": "cortex.codec.rollup_autotune.v1",
        "updated_at": "",
        **_default_rollup_autotune_row(),
        "archetypes": {},
    }



def _load_rollup_autotune_state() -> Dict[str, Any]:
    state = _default_rollup_autotune_state()
    try:
        if _ROLLUP_AUTOTUNE_STATE_PATH.exists():
            raw = json.loads(_ROLLUP_AUTOTUNE_STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                for key in state:
                    if key in raw:
                        state[key] = raw[key]
    except Exception:
        pass
    if not isinstance(state.get("adjustments"), dict):
        state["adjustments"] = _default_rollup_autotune_row()["adjustments"]
    if not isinstance(state.get("archetypes"), dict):
        state["archetypes"] = {}
    normalized_archetypes = {}
    for key, row in (state.get("archetypes") or {}).items():
        if not isinstance(row, dict):
            continue
        merged = _default_rollup_autotune_row()
        for rk, rv in row.items():
            merged[rk] = rv
        if not isinstance(merged.get("adjustments"), dict):
            merged["adjustments"] = _default_rollup_autotune_row()["adjustments"]
        normalized_archetypes[str(key)] = merged
    state["archetypes"] = normalized_archetypes
    return state



def _get_rollup_autotune_state() -> Dict[str, Any]:
    global _ROLLUP_AUTOTUNE_STATE
    with _ROLLUP_AUTOTUNE_LOCK:
        if not isinstance(_ROLLUP_AUTOTUNE_STATE, dict):
            _ROLLUP_AUTOTUNE_STATE = _load_rollup_autotune_state()
        return json.loads(json.dumps(_ROLLUP_AUTOTUNE_STATE))



def _save_rollup_autotune_state(state: Dict[str, Any]) -> None:
    global _ROLLUP_AUTOTUNE_STATE
    safe = _default_rollup_autotune_state()
    if isinstance(state, dict):
        for key in safe:
            if key in state:
                safe[key] = state[key]
    if not isinstance(safe.get("adjustments"), dict):
        safe["adjustments"] = _default_rollup_autotune_row()["adjustments"]
    if not isinstance(safe.get("archetypes"), dict):
        safe["archetypes"] = {}
    safe["updated_at"] = _now_iso()
    with _ROLLUP_AUTOTUNE_LOCK:
        _ROLLUP_AUTOTUNE_STATE = json.loads(json.dumps(safe))
        try:
            _ROLLUP_AUTOTUNE_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            _ROLLUP_AUTOTUNE_STATE_PATH.write_text(json.dumps(_ROLLUP_AUTOTUNE_STATE, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass



def _recompute_rollup_autotune(state: Dict[str, Any]) -> Dict[str, Any]:
    state = dict(state or {})
    runs = int(state.get("runs", 0) or 0)
    overall_passes = int(state.get("overall_passes", 0) or 0)
    codec_wins = int(state.get("codec_wins", 0) or 0)
    avg_judge_margin = _coerce_float(state.get("avg_judge_margin"), 0.0)
    avg_codec_margin = _coerce_float(state.get("avg_codec_margin"), 0.0)

    pass_rate = overall_passes / max(1, runs)
    codec_win_rate = codec_wins / max(1, runs)
    confidence = 0.0
    adjustments = _default_rollup_autotune_state()["adjustments"]
    action = "hold"
    reason = "collecting_evidence"

    if runs >= max(1, int(CODEC_ROLLUP_AUTOTUNE_MIN_RUNS)):
        confidence = round(_clamp((0.45 * pass_rate) + (0.35 * codec_win_rate) + (0.20 * _clamp((avg_judge_margin + 0.12) / 0.24, 0.0, 1.0)), 0.0, 1.0), 3)
        if avg_codec_margin >= 0.06 and pass_rate >= 0.6:
            action = "loosen_rollup"
            strength = _clamp((avg_codec_margin / 0.18) + (pass_rate - 0.6), 0.0, 1.0)
            adjustments = {
                "match_min_overlap_delta": round(-min(CODEC_ROLLUP_AUTOTUNE_MAX_OVERLAP_DELTA, 0.02 + (CODEC_ROLLUP_AUTOTUNE_MAX_OVERLAP_DELTA * strength)), 3),
                "confidence_blend_delta": round(min(CODEC_ROLLUP_AUTOTUNE_MAX_BLEND_DELTA, 0.03 + (CODEC_ROLLUP_AUTOTUNE_MAX_BLEND_DELTA * strength)), 3),
                "cross_session_score_per_session_delta": round(min(CODEC_ROLLUP_AUTOTUNE_MAX_CROSS_SESSION_SCORE_DELTA, 0.006 + (CODEC_ROLLUP_AUTOTUNE_MAX_CROSS_SESSION_SCORE_DELTA * strength)), 3),
                "alias_prefer_session_delta_delta": -1,
                "alias_prefer_evidence_delta_delta": -1,
            }
            reason = f"eval history favors codec rollup support ({avg_codec_margin:.3f} margin, {pass_rate:.2f} pass rate)"
        elif avg_codec_margin <= -0.06 or pass_rate < 0.45:
            action = "tighten_rollup"
            strength = _clamp((abs(avg_codec_margin) / 0.18) + max(0.0, 0.45 - pass_rate), 0.0, 1.0)
            adjustments = {
                "match_min_overlap_delta": round(min(CODEC_ROLLUP_AUTOTUNE_MAX_OVERLAP_DELTA, 0.02 + (CODEC_ROLLUP_AUTOTUNE_MAX_OVERLAP_DELTA * strength)), 3),
                "confidence_blend_delta": round(-min(CODEC_ROLLUP_AUTOTUNE_MAX_BLEND_DELTA, 0.03 + (CODEC_ROLLUP_AUTOTUNE_MAX_BLEND_DELTA * strength)), 3),
                "cross_session_score_per_session_delta": round(-min(CODEC_ROLLUP_AUTOTUNE_MAX_CROSS_SESSION_SCORE_DELTA, 0.006 + (CODEC_ROLLUP_AUTOTUNE_MAX_CROSS_SESSION_SCORE_DELTA * strength)), 3),
                "alias_prefer_session_delta_delta": 1,
                "alias_prefer_evidence_delta_delta": 1,
            }
            reason = f"eval history penalizes broad rollup support ({avg_codec_margin:.3f} margin, {pass_rate:.2f} pass rate)"
        else:
            action = "hold"
            adjustments = _default_rollup_autotune_state()["adjustments"]
            reason = "mixed eval history"

    state["adjustments"] = adjustments
    state["action"] = action
    state["confidence"] = confidence
    state["reason"] = reason
    return state



def observe_codec_rollup_eval_history(
    *,
    acceptance_gates: Dict[str, Any],
    winner: str = "",
    session_key: str = "",
    query: str = "",
) -> Dict[str, Any]:
    state = _get_rollup_autotune_state()
    runs = int(state.get("runs", 0) or 0) + 1
    summary = (acceptance_gates.get("summary") or {}) if isinstance(acceptance_gates, dict) else {}
    prev_runs = max(0, int(state.get("runs", 0) or 0))
    judge_margin = _coerce_float((acceptance_gates.get("judge_margin") if isinstance(acceptance_gates, dict) else 0.0), 0.0)
    codec_margin = _coerce_float((acceptance_gates.get("codec_margin_vs_best_non_codec") if isinstance(acceptance_gates, dict) else 0.0), 0.0)
    state.update({
        "runs": runs,
        "overall_passes": int(state.get("overall_passes", 0) or 0) + (1 if bool(summary.get("overall_pass")) else 0),
        "codec_wins": int(state.get("codec_wins", 0) or 0) + (1 if winner == "referents_plus_codec" else 0),
        "avg_judge_margin": round(((_coerce_float(state.get("avg_judge_margin"), 0.0) * prev_runs) + judge_margin) / max(1, runs), 3),
        "avg_codec_margin": round(((_coerce_float(state.get("avg_codec_margin"), 0.0) * prev_runs) + codec_margin) / max(1, runs), 3),
        "last_session_key": (session_key or "")[:128],
    })
    state = _recompute_rollup_autotune(state)

    archetype = classify_task_archetype(query) if query else ""
    if archetype:
        archetypes = state.setdefault("archetypes", {})
        row = archetypes.get(archetype) if isinstance(archetypes.get(archetype), dict) else _default_rollup_autotune_row()
        row_prev_runs = max(0, int(row.get("runs", 0) or 0))
        row.update({
            "runs": int(row.get("runs", 0) or 0) + 1,
            "overall_passes": int(row.get("overall_passes", 0) or 0) + (1 if bool(summary.get("overall_pass")) else 0),
            "codec_wins": int(row.get("codec_wins", 0) or 0) + (1 if winner == "referents_plus_codec" else 0),
            "avg_judge_margin": round(((_coerce_float(row.get("avg_judge_margin"), 0.0) * row_prev_runs) + judge_margin) / max(1, int(row.get("runs", 0) or 0)), 3),
            "avg_codec_margin": round(((_coerce_float(row.get("avg_codec_margin"), 0.0) * row_prev_runs) + codec_margin) / max(1, int(row.get("runs", 0) or 0)), 3),
            "last_session_key": (session_key or "")[:128],
        })
        archetypes[archetype] = _recompute_rollup_autotune(row)

    _save_rollup_autotune_state(state)
    effective = _effective_rollup_autotune_row(query)
    return {
        "recorded": True,
        "runs": int(state.get("runs", 0) or 0),
        "overall_passes": int(state.get("overall_passes", 0) or 0),
        "codec_wins": int(state.get("codec_wins", 0) or 0),
        "autotune": {
            "action": str(effective.get("action") or "hold"),
            "confidence": _coerce_float(effective.get("confidence"), 0.0),
            "reason": str(effective.get("reason") or "collecting_evidence"),
            "scope": str(effective.get("scope") or "global"),
            "archetype": str(effective.get("archetype") or ""),
            "adjustments": effective.get("adjustments", {}),
        },
    }



def _effective_rollup_autotune_row(query: str = "") -> Dict[str, Any]:
    state = _get_rollup_autotune_state()
    if query:
        archetype = classify_task_archetype(query)
        row = (state.get("archetypes") or {}).get(archetype) if isinstance(state.get("archetypes"), dict) else None
        if isinstance(row, dict) and int(row.get("runs", 0) or 0) >= max(1, int(CODEC_ROLLUP_AUTOTUNE_MIN_RUNS)):
            return {**row, "scope": "archetype", "archetype": archetype}
    return {
        "runs": int(state.get("runs", 0) or 0),
        "overall_passes": int(state.get("overall_passes", 0) or 0),
        "codec_wins": int(state.get("codec_wins", 0) or 0),
        "avg_judge_margin": _coerce_float(state.get("avg_judge_margin"), 0.0),
        "avg_codec_margin": _coerce_float(state.get("avg_codec_margin"), 0.0),
        "adjustments": state.get("adjustments", {}),
        "action": str(state.get("action") or "hold"),
        "confidence": _coerce_float(state.get("confidence"), 0.0),
        "reason": str(state.get("reason") or "collecting_evidence"),
        "scope": "global",
        "archetype": classify_task_archetype(query) if query else "",
    }



def _codec_rollup_policy(query: str = "") -> Dict[str, Any]:
    autotune = _effective_rollup_autotune_row(query)
    adjustments = autotune.get("adjustments") if isinstance(autotune.get("adjustments"), dict) else {}
    base = {
        "match_min_overlap": round(float(CODEC_ROLLUP_MATCH_MIN_OVERLAP), 3),
        "alias_prefer_session_delta": max(0, int(CODEC_ROLLUP_ALIAS_PREFER_SESSION_DELTA)),
        "alias_prefer_evidence_delta": max(0, int(CODEC_ROLLUP_ALIAS_PREFER_EVIDENCE_DELTA)),
        "confidence_blend": round(_clamp(float(CODEC_ROLLUP_CONFIDENCE_BLEND), 0.0, 1.0), 3),
        "cross_session_confidence_per_session": round(max(0.0, float(CODEC_ROLLUP_CROSS_SESSION_CONFIDENCE_PER_SESSION)), 3),
        "cross_session_confidence_cap": round(max(0.0, float(CODEC_ROLLUP_CROSS_SESSION_CONFIDENCE_CAP)), 3),
        "cross_session_score_per_session": round(max(0.0, float(CODEC_ROLLUP_CROSS_SESSION_SCORE_PER_SESSION)), 3),
        "cross_session_score_cap": round(max(0.0, float(CODEC_ROLLUP_CROSS_SESSION_SCORE_CAP)), 3),
    }
    effective = {
        "match_min_overlap": round(_clamp(base["match_min_overlap"] + _coerce_float(adjustments.get("match_min_overlap_delta"), 0.0), 0.65, 0.98), 3),
        "alias_prefer_session_delta": max(0, int(base["alias_prefer_session_delta"] + int(adjustments.get("alias_prefer_session_delta_delta", 0) or 0))),
        "alias_prefer_evidence_delta": max(0, int(base["alias_prefer_evidence_delta"] + int(adjustments.get("alias_prefer_evidence_delta_delta", 0) or 0))),
        "confidence_blend": round(_clamp(base["confidence_blend"] + _coerce_float(adjustments.get("confidence_blend_delta"), 0.0), 0.0, 1.0), 3),
        "cross_session_confidence_per_session": base["cross_session_confidence_per_session"],
        "cross_session_confidence_cap": base["cross_session_confidence_cap"],
        "cross_session_score_per_session": round(max(0.0, base["cross_session_score_per_session"] + _coerce_float(adjustments.get("cross_session_score_per_session_delta"), 0.0)), 3),
        "cross_session_score_cap": base["cross_session_score_cap"],
        "autotune": {
            "runs": int(autotune.get("runs", 0) or 0),
            "overall_passes": int(autotune.get("overall_passes", 0) or 0),
            "codec_wins": int(autotune.get("codec_wins", 0) or 0),
            "action": str(autotune.get("action") or "hold"),
            "confidence": round(_coerce_float(autotune.get("confidence"), 0.0), 3),
            "reason": str(autotune.get("reason") or "collecting_evidence"),
            "scope": str(autotune.get("scope") or "global"),
            "archetype": str(autotune.get("archetype") or ""),
            "adjustments": adjustments,
        },
        "base": base,
    }
    return effective


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _clean_state_text(value: Any) -> str:
    return _clean_text(value)[: max(128, int(CODEC_STATE_TEXT_MAX_CHARS))]


def _normalize_text_list(value: Any, *, limit: int = 8) -> List[str]:
    items = value if isinstance(value, list) else []
    cleaned: List[str] = []
    seen = set()
    for item in items:
        text = _clean_state_text(item)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
    return cleaned[:limit]


def _normalize_revision_log(value: Any) -> List[Dict[str, Any]]:
    entries = value if isinstance(value, list) else []
    normalized: List[Dict[str, Any]] = []
    for item in entries:
        if not isinstance(item, dict):
            continue
        normalized.append({
            "bucket": _clean_text(item.get("bucket")),
            "superseded_text": _clean_state_text(item.get("superseded_text")),
            "replacement_text": _clean_state_text(item.get("replacement_text")),
            "claim_key": _clean_state_text(item.get("claim_key")),
            "reason": _clean_state_text(item.get("reason") or "revision"),
            "generated_at": _clean_text(item.get("generated_at")),
        })
    return normalized[-REVISION_LOG_LIMIT:]


def _stable_state_view(state: Dict[str, Any]) -> Dict[str, Any]:
    payload = state or {}
    return {
        "version": payload.get("version", CODEC_VERSION),
        "schema_version": payload.get("schema_version", CODEC_SCHEMA_VERSION),
        "identity_state": payload.get("identity_state", {}),
        "project_state": payload.get("project_state", {}),
        "world_state": payload.get("world_state", {}),
        "failure_state": payload.get("failure_state", {}),
        "outcome_state": payload.get("outcome_state", {}),
        "utility_state": payload.get("utility_state", {}),
        "promotion_state": payload.get("promotion_state", {}),
        "schema_state": payload.get("schema_state", {}),
    }


def _state_fingerprint(state: Dict[str, Any]) -> str:
    try:
        raw = json.dumps(_stable_state_view(state or {}), sort_keys=True, ensure_ascii=False)
    except Exception:
        raw = str(_stable_state_view(state or {}))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _iter_text_candidates(event: Dict[str, Any]) -> Iterable[str]:
    for key in ("text", "content", "summary", "message", "note"):
        value = event.get(key)
        if isinstance(value, str) and value.strip():
            yield value.strip()


def _contains_any(text: str, hints: Iterable[str]) -> bool:
    lowered = text.lower()
    return any(hint in lowered for hint in hints)


def _looks_like_completed_checkpoint(text: str) -> bool:
    """Recognize bounded, reusable completion/status checkpoints.

    These signals describe observed work state (completed, committed, verified,
    or clean), not merely intent. Negated completion phrases are removed before
    matching so "not yet complete" does not become a durable success fact.
    """

    lowered = _clean_text(text).lower()
    if not lowered:
        return False
    affirmative = re.sub(
        r"\b(?:not|never)\s+(?:(?:yet|fully|successfully)\s+)?(?:complete|completed|finished|done|saved|committed|implemented|verified|passed|clean)\b",
        "",
        lowered,
    )
    affirmative = re.sub(
        r"\b(?:no|zero)\s+[^.!?\n]{0,80}\b(?:complete|completed|finished|done|saved|committed|implemented|verified|passed|clean)\b",
        "",
        affirmative,
    )
    affirmative = re.sub(r"\b0\s*/\s*\d+\s+tests?\b[^.!?\n]{0,40}\bpassed\b", "", affirmative)
    signals = (
        r"\b(?:completed|finished|done|saved|committed|implemented|verified)\b",
        r"\b(?:is|are|was|were|has been|have been)\s+complete\b",
        r"\b(?:task|work|implementation|foundation|checkpoint|phase|migration|build|repair)s?\s+complete\b",
        r"\bcommit\s*[:#]\s*[0-9a-f]{7,40}\b",
        r"\btests?\b[^.!?\n]{0,80}\bpassed\b",
        r"\b(?:validation|replay|checks?|scans?)\b[^.!?\n]{0,80}\bpassed\b",
        r"\bworktree\b[^.!?\n]{0,40}\bclean\b",
    )
    return any(re.search(pattern, affirmative, flags=re.IGNORECASE) for pattern in signals)


def _looks_like_success_outcome(text: str) -> bool:
    lowered = _clean_text(text).lower()
    hint_pattern = "|".join(re.escape(hint) for hint in OUTCOME_SUCCESS_HINTS)
    affirmative = re.sub(
        rf"\b(?:not|never)\s+(?:(?:yet|fully|successfully)\s+)?(?:{hint_pattern})\b",
        "",
        lowered,
    )
    affirmative = re.sub(
        rf"\b(?:no|zero)\s+[^.!?\n]{{0,80}}\b(?:{hint_pattern})\b",
        "",
        affirmative,
    )
    affirmative = re.sub(r"\b0\s*/\s*\d+\s+tests?\b[^.!?\n]{0,40}\bpassed\b", "", affirmative)
    return bool(re.search(rf"\b(?:{hint_pattern})\b", affirmative))


def _project_alias_candidates(value: str) -> List[str]:
    return [label for pattern, label in PROJECT_ALIASES if pattern.search(value or "")]


def _project_mention_is_negated(text: str, candidate: str) -> bool:
    """Reject explicit non-assignment/activity boundaries for a project name."""

    candidate_tokens = re.findall(r"[a-z0-9]+", (candidate or "").lower())
    if not candidate_tokens:
        return False
    candidate_pattern = r"[\s_-]+".join(re.escape(token) for token in candidate_tokens)
    activity_pattern = "|".join(re.escape(term) for term in _PROJECT_NEGATED_ACTIVITY_TERMS)
    patterns = (
        rf"\bno\s+{candidate_pattern}(?:\s+(?:production|live|project))?\s+(?:{activity_pattern})\b",
        rf"\bwithout\s+{candidate_pattern}(?:\s+(?:production|live|project))?\s+(?:{activity_pattern})\b",
        rf"\bnot\s+(?:a\s+|an\s+|part\s+of\s+|for\s+|related\s+to\s+){candidate_pattern}\b",
    )
    return any(re.search(pattern, text or "", flags=re.IGNORECASE) for pattern in patterns)


def _looks_like_question(text: str) -> bool:
    return "?" in text or text.lower().startswith(("what ", "how ", "why ", "when ", "could ", "should "))


def _text_key(value: Any) -> str:
    return _clean_text(value).lower()


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _bounded_nonnegative_int(value: Any, *, maximum: int, default: int = 0) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = int(default)
    return max(0, min(int(maximum), parsed))


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


CLAIM_TOKEN_STOPWORDS = {
    "the", "a", "an", "this", "that", "these", "those", "with", "from", "into", "onto", "very",
    "really", "actually", "updated", "update", "correction", "instead", "rather", "than", "now", "anymore",
}


def _normalize_claim_fragment(value: Any) -> str:
    cleaned = re.sub(r"[^a-z0-9\s]", " ", _strip_revision_prefix(_clean_text(value)).lower())
    cleaned = re.sub(r"\b(?:the|a|an)\b", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _claim_tokens(value: Any) -> List[str]:
    return [token for token in _normalize_claim_fragment(value).split() if len(token) > 2 and token not in CLAIM_TOKEN_STOPWORDS]


def _claim_overlap(a: Any, b: Any) -> float:
    a_tokens = set(_claim_tokens(a))
    b_tokens = set(_claim_tokens(b))
    if not a_tokens or not b_tokens:
        return 0.0
    return len(a_tokens & b_tokens) / max(1, len(a_tokens | b_tokens))


def _trim_claim_tail(value: Any) -> str:
    return re.split(r"(?:instead of|rather than|anymore|because)", _clean_text(value), maxsplit=1)[0].strip()


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    text = _clean_text(value)
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _hours_since(last_seen_at: Any, *, reference_at: Any = "") -> float:
    reference = _parse_iso_datetime(reference_at) or datetime.now(timezone.utc)
    seen = _parse_iso_datetime(last_seen_at) or reference
    return round(max(0.0, (reference - seen).total_seconds() / 3600.0), 3)


def _freshness_band(age_hours: float) -> str:
    hours = max(0.0, float(age_hours or 0.0))
    if hours <= 24:
        return "fresh"
    if hours <= 72:
        return "warm"
    if hours <= 168:
        return "aging"
    return "stale"


def _freshness_score(age_hours: float) -> float:
    hours = max(0.0, float(age_hours or 0.0))
    if hours <= 24:
        return 1.0
    if hours <= 72:
        return 0.88
    if hours <= 168:
        return 0.7
    if hours <= 336:
        return 0.52
    return 0.35


def _confidence_score(score: float, evidence_count: int, age_hours: float) -> float:
    utility = _clamp(_coerce_float(score, 0.0) / max(UTILITY_MAX_SCORE, 0.001), 0.0, 1.0)
    evidence = _clamp(int(evidence_count or 0) / 4.0, 0.0, 1.0)
    freshness = _freshness_score(age_hours)
    return round(_clamp((utility * 0.55) + (evidence * 0.25) + (freshness * 0.20), 0.0, 1.0), 3)


def _annotate_utility_entry(entry: Dict[str, Any], *, reference_at: Any = "") -> Dict[str, Any]:
    age_hours = _hours_since(entry.get("last_seen_at"), reference_at=reference_at)
    entry["age_hours"] = age_hours
    entry["freshness"] = _freshness_band(age_hours)
    entry["confidence"] = _confidence_score(entry.get("score"), int(entry.get("evidence_count", 0) or 0), age_hours)
    return entry


def _base_utility_score(text: str, bucket: str) -> float:
    score = float(UTILITY_BUCKET_WEIGHTS.get(bucket, 0.6))
    if _contains_any(text, PREFERENCE_HINTS):
        score += 0.22
    if _contains_any(text, OPEN_LOOP_HINTS):
        score += 0.24
    if _contains_any(text, FAILURE_HINTS):
        score += 0.18
    if _looks_like_success_outcome(text) or _contains_any(text, OUTCOME_FAILURE_HINTS):
        score += 0.16
    if _looks_like_question(text):
        score += 0.12
    if re.search(r"\b(decision|important|remember|fact|state)\b", text.lower()):
        score += 0.12
    if re.search(r"\b(goal|aim|want|ship|implement|create|need to)\b", text.lower()):
        score += 0.1
    if _looks_like_completed_checkpoint(text):
        score += 0.22
    return _clamp(score, 0.0, UTILITY_MAX_SCORE)


def _build_bucket_utility(
    bucket: str,
    kept_items: List[str],
    raw_items: List[str],
    previous_scores: Optional[Dict[str, Any]] = None,
    *,
    generated_at: str = "",
) -> Dict[str, Dict[str, Any]]:
    previous_scores = previous_scores or {}
    normalized_previous: Dict[str, Dict[str, Any]] = {}
    for previous_key, previous_value in previous_scores.items():
        if not isinstance(previous_value, dict):
            continue
        bounded = _clean_state_text(previous_value.get("text") or previous_key)
        if bounded:
            normalized_previous[bounded.lower()] = previous_value

    counts: Counter[str] = Counter()
    originals: Dict[str, str] = {}
    for item in raw_items:
        cleaned = _clean_state_text(item)
        if not cleaned:
            continue
        key = cleaned.lower()
        counts[key] += 1
        originals.setdefault(key, cleaned)

    out: Dict[str, Dict[str, Any]] = {}
    for item in kept_items or []:
        cleaned = _clean_state_text(item)
        if not cleaned:
            continue
        key = cleaned.lower()
        prior = normalized_previous.get(key) if isinstance(normalized_previous.get(key), dict) else {}
        current_seen = int(counts.get(key, 0) or 0)
        prior_evidence = max(0, int(prior.get("evidence_count", 0) or 0))
        evidence_count = max(1, prior_evidence + current_seen)
        prior_score = _coerce_float(prior.get("score"), 0.0)
        base_score = _base_utility_score(cleaned, bucket)
        repeat_bonus = min(0.5, UTILITY_REPEAT_BOOST * max(0, current_seen - 1))
        if current_seen > 0:
            score = max(base_score + repeat_bonus, prior_score * UTILITY_DECAY + (0.18 * current_seen))
        else:
            score = max(prior_score * UTILITY_DECAY, base_score * 0.72 if prior_score <= 0 else prior_score * UTILITY_DECAY)
        out[key] = _annotate_utility_entry({
            "text": originals.get(key, cleaned),
            "bucket": bucket,
            "score": round(_clamp(score, 0.0, UTILITY_MAX_SCORE), 3),
            "evidence_count": evidence_count,
            "observation_count": current_seen,
            "last_seen_at": generated_at if current_seen > 0 else (_clean_text(prior.get("last_seen_at")) or generated_at or _now_iso()),
        }, reference_at=generated_at)
    return out


def _normalize_bucket_utility_scores(
    bucket: str,
    kept_items: List[str],
    previous_scores: Optional[Dict[str, Dict[str, Any]]],
    *,
    generated_at: str,
) -> Dict[str, Dict[str, Any]]:
    previous_scores = previous_scores if isinstance(previous_scores, dict) else {}
    normalized_previous: Dict[str, Dict[str, Any]] = {}
    for previous_key, previous_value in previous_scores.items():
        if not isinstance(previous_value, dict):
            continue
        bounded = _clean_state_text(previous_value.get("text") or previous_key)
        if bounded:
            normalized_previous[bounded.lower()] = previous_value

    out: Dict[str, Dict[str, Any]] = {}
    for item in kept_items or []:
        cleaned = _clean_state_text(item)
        if not cleaned:
            continue
        key = cleaned.lower()
        prior = normalized_previous.get(key)
        if isinstance(prior, dict):
            normalized = dict(prior)
            normalized["text"] = cleaned
            normalized["bucket"] = bucket
            out[key] = _annotate_utility_entry(normalized, reference_at=generated_at)
        else:
            out.update(_build_bucket_utility(bucket, [cleaned], [], {}, generated_at=generated_at))
    return out


def _utility_summary(bucket_scores: Dict[str, Dict[str, Dict[str, Any]]]) -> Dict[str, Any]:
    entries: List[Dict[str, Any]] = []
    for bucket, scores in (bucket_scores or {}).items():
        if not isinstance(scores, dict):
            continue
        for item in scores.values():
            if isinstance(item, dict):
                entries.append({**item, "bucket": str(item.get("bucket") or bucket)})

    entries.sort(key=lambda item: (-_coerce_float(item.get("score"), 0.0), -_coerce_float(item.get("confidence"), 0.0), str(item.get("text") or "")))
    total_score = round(sum(_coerce_float(item.get("score"), 0.0) for item in entries), 3)
    average_confidence = round(
        sum(_coerce_float(item.get("confidence"), 0.0) for item in entries) / max(1, len(entries)),
        3,
    )
    retention_priority = round(
        total_score
        + (0.18 * len(entries))
        + (0.12 * len([item for item in entries if _coerce_float(item.get("score"), 0.0) >= 1.2]))
        + (0.35 * average_confidence),
        3,
    )
    return {
        "item_count": len(entries),
        "total_score": total_score,
        "average_confidence": average_confidence,
        "retention_priority": retention_priority,
        "top_items": [
            {
                "text": str(item.get("text") or ""),
                "bucket": str(item.get("bucket") or ""),
                "score": round(_coerce_float(item.get("score"), 0.0), 3),
                "confidence": round(_coerce_float(item.get("confidence"), 0.0), 3),
                "freshness": str(item.get("freshness") or ""),
            }
            for item in entries[:5]
        ],
    }



def _promotion_rules() -> Dict[str, Any]:
    return {
        "version": "cortex.codec.promotion.v1",
        "default": {
            "min_score": float(PROMOTION_MIN_SCORE),
            "min_evidence": max(1, int(PROMOTION_MIN_EVIDENCE)),
            "min_confidence": float(PROMOTION_MIN_CONFIDENCE),
        },
        "candidate_margin": float(PROMOTION_CANDIDATE_MARGIN),
        "outcome_bonus": float(PROMOTION_OUTCOME_BONUS),
        "buckets": {
            "preferences": {"min_score": 1.0, "min_evidence": 1, "min_confidence": 0.45},
            "active_goals": {"min_score": 1.02, "min_evidence": 1, "min_confidence": 0.42},
            "open_loops": {"min_score": 1.08, "min_evidence": 1, "min_confidence": 0.38},
            "durable_facts": {"min_score": max(1.08, float(PROMOTION_MIN_SCORE)), "min_evidence": 1, "min_confidence": 0.46},
            "patterns": {"min_score": max(1.1, float(PROMOTION_MIN_SCORE)), "min_evidence": 1, "min_confidence": 0.44},
            "lessons": {"min_score": max(1.1, float(PROMOTION_MIN_SCORE)), "min_evidence": 1, "min_confidence": 0.44},
        },
    }



def _promotion_bonus(bucket: str, text: str, state: Dict[str, Any]) -> float:
    bonus = 0.0
    lowered = _clean_text(text).lower()
    outcome_state = state.get("outcome_state", {}) if isinstance(state.get("outcome_state", {}), dict) else {}
    if bucket == "durable_facts" and re.search(r"\b(decision|important|remember|fact|state)\b", lowered):
        bonus += 0.12
    if bucket == "durable_facts" and _looks_like_completed_checkpoint(lowered):
        bonus += 0.12
    if bucket == "open_loops" and _contains_any(lowered, OPEN_LOOP_HINTS):
        bonus += 0.08
    if bucket == "lessons":
        if _looks_like_success_outcome(lowered) or int(outcome_state.get("success_count", 0) or 0) > 0:
            bonus += PROMOTION_OUTCOME_BONUS
        if _contains_any(lowered, OUTCOME_FAILURE_HINTS):
            bonus += 0.08
    if bucket == "patterns":
        if _contains_any(lowered, FAILURE_HINTS) or int(outcome_state.get("failure_count", 0) or 0) > 0:
            bonus += PROMOTION_OUTCOME_BONUS
    return round(bonus, 3)



def _build_promotion_state(state: Dict[str, Any]) -> Dict[str, Any]:
    rules = _promotion_rules()
    utility_state = state.get("utility_state", {}) if isinstance(state.get("utility_state", {}), dict) else {}
    bucket_scores = utility_state.get("bucket_scores", {}) if isinstance(utility_state.get("bucket_scores", {}), dict) else {}
    bucket_items = {
        "preferences": (state.get("identity_state", {}) if isinstance(state.get("identity_state", {}), dict) else {}).get("preferences", []),
        "active_goals": (state.get("project_state", {}) if isinstance(state.get("project_state", {}), dict) else {}).get("active_goals", []),
        "open_loops": (state.get("project_state", {}) if isinstance(state.get("project_state", {}), dict) else {}).get("open_loops", []),
        "durable_facts": (state.get("world_state", {}) if isinstance(state.get("world_state", {}), dict) else {}).get("durable_facts", []),
        "patterns": (state.get("failure_state", {}) if isinstance(state.get("failure_state", {}), dict) else {}).get("patterns", []),
        "lessons": (state.get("failure_state", {}) if isinstance(state.get("failure_state", {}), dict) else {}).get("lessons", []),
    }

    promoted: Dict[str, List[Dict[str, Any]]] = {}
    candidates: List[Dict[str, Any]] = []
    default_rule = rules.get("default", {}) if isinstance(rules.get("default", {}), dict) else {}
    bucket_rule_map = rules.get("buckets", {}) if isinstance(rules.get("buckets", {}), dict) else {}
    candidate_margin = _coerce_float(rules.get("candidate_margin"), 0.0)

    for bucket, items in bucket_items.items():
        active_items = _normalize_text_list(items, limit=64)
        if not active_items:
            continue
        rule = bucket_rule_map.get(bucket, default_rule) if isinstance(bucket_rule_map.get(bucket, default_rule), dict) else default_rule
        min_score = _coerce_float(rule.get("min_score"), _coerce_float(default_rule.get("min_score"), 1.0))
        min_evidence = max(1, int(rule.get("min_evidence", default_rule.get("min_evidence", 1)) or 1))
        bucket_meta = bucket_scores.get(bucket, {}) if isinstance(bucket_scores.get(bucket, {}), dict) else {}
        promoted_rows: List[Dict[str, Any]] = []
        for item in active_items:
            meta = bucket_meta.get(item.lower()) if isinstance(bucket_meta.get(item.lower()), dict) else {}
            base_score = _coerce_float(meta.get("score"), _base_utility_score(item, bucket))
            evidence_count = max(1, int(meta.get("evidence_count", 1) or 1))
            confidence = _coerce_float(meta.get("confidence"), _confidence_score(base_score, evidence_count, _coerce_float(meta.get("age_hours"), 0.0)))
            global_evidence_count = max(evidence_count, int(meta.get("global_evidence_count", 0) or 0))
            cross_session_count = max(0, int(meta.get("cross_session_count", 0) or 0))
            rollup_confidence = _coerce_float(meta.get("rollup_confidence"), confidence)
            rollup_policy = _codec_rollup_policy()
            blend = _coerce_float(rollup_policy.get("confidence_blend"), CODEC_ROLLUP_CONFIDENCE_BLEND)
            confidence_lift = min(
                _coerce_float(rollup_policy.get("cross_session_confidence_cap"), CODEC_ROLLUP_CROSS_SESSION_CONFIDENCE_CAP),
                _coerce_float(rollup_policy.get("cross_session_confidence_per_session"), CODEC_ROLLUP_CROSS_SESSION_CONFIDENCE_PER_SESSION) * cross_session_count,
            )
            effective_confidence = _clamp(max(confidence, (confidence * (1.0 - blend)) + (rollup_confidence * blend) + confidence_lift), 0.0, 1.0)
            cross_session_score_bonus = min(
                _coerce_float(rollup_policy.get("cross_session_score_cap"), CODEC_ROLLUP_CROSS_SESSION_SCORE_CAP),
                _coerce_float(rollup_policy.get("cross_session_score_per_session"), CODEC_ROLLUP_CROSS_SESSION_SCORE_PER_SESSION) * cross_session_count,
            )
            bonus = _promotion_bonus(bucket, item, state) + cross_session_score_bonus
            effective_score = round(base_score + bonus, 3)
            min_confidence = _coerce_float(rule.get("min_confidence"), _coerce_float(default_rule.get("min_confidence"), PROMOTION_MIN_CONFIDENCE))
            row = {
                "text": item,
                "bucket": bucket,
                "score": round(base_score, 3),
                "effective_score": effective_score,
                "confidence": round(effective_confidence, 3),
                "local_confidence": round(confidence, 3),
                "rollup_confidence": round(rollup_confidence, 3),
                "freshness": str(meta.get("freshness") or _freshness_band(_coerce_float(meta.get("age_hours"), 0.0))),
                "age_hours": round(_coerce_float(meta.get("age_hours"), 0.0), 3),
                "evidence_count": evidence_count,
                "global_evidence_count": global_evidence_count,
                "cross_session_count": cross_session_count,
                "promotion_status": "candidate",
                "promotion_reason": [],
            }
            if global_evidence_count >= min_evidence:
                row["promotion_reason"].append("evidence_threshold")
            if effective_score >= min_score:
                row["promotion_reason"].append("score_threshold")
            if effective_confidence >= min_confidence:
                row["promotion_reason"].append("confidence_threshold")
            if cross_session_count > 0:
                row["promotion_reason"].append("cross_session_support")
            if bonus > 0:
                row["promotion_reason"].append("outcome_or_priority_bonus")
            if global_evidence_count >= min_evidence and effective_score >= min_score and effective_confidence >= min_confidence:
                row["promotion_status"] = "promoted"
                promoted_rows.append(row)
            elif effective_score >= max(0.0, min_score - candidate_margin) or effective_confidence >= max(0.0, min_confidence - 0.08):
                candidates.append(row)
        if promoted_rows:
            promoted[bucket] = sorted(promoted_rows, key=lambda item: (-_coerce_float(item.get("effective_score"), 0.0), str(item.get("text") or "")))

    candidates.sort(key=lambda item: (-_coerce_float(item.get("effective_score"), 0.0), str(item.get("text") or "")))
    promoted_count = sum(len(items) for items in promoted.values())
    return {
        "version": "cortex.codec.promotion.v1",
        "rules": rules,
        "promoted": promoted,
        "candidates": candidates[:8],
        "summary": {
            "promoted_count": promoted_count,
            "candidate_count": len(candidates),
            "promoted_buckets": sorted(promoted.keys()),
        },
    }



def _schema_bucket(items: List[str], *, revisions: Optional[List[Dict[str, Any]]] = None, revision_count: int = 0) -> Dict[str, Any]:
    payload = {
        "items": _normalize_text_list(items, limit=64),
        "count": len(_normalize_text_list(items, limit=64)),
    }
    if revisions is not None:
        payload["revisions"] = _normalize_revision_log(revisions)
        payload["revision_count"] = max(int(revision_count or 0), len(payload["revisions"]))
    return payload


def _source_refs_from_events(events: List[Dict[str, Any]], *, limit: int = 16) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for event in events or []:
        if not isinstance(event, dict):
            continue
        event_id = str(event.get("event_id") or event.get("id") or "").strip()
        session_key = str(event.get("session_key") or event.get("chat_id") or event.get("conversation_id") or "").strip() or None
        event_kind = str(event.get("event_kind") or event.get("kind") or event.get("type") or "event").strip() or "event"
        ref_key = (event_id, session_key, event_kind)
        if ref_key in seen:
            continue
        seen.add(ref_key)
        out.append(
            {
                "event_id": event_id or None,
                "session_key": session_key,
                "event_kind": event_kind,
                "ts": str(event.get("ts") or event.get("created_at") or event.get("timestamp") or "").strip() or None,
            }
        )
        if len(out) >= max(1, int(limit or 16)):
            break
    return out



def _export_schema_state(state: Dict[str, Any]) -> Dict[str, Any]:
    identity_state = state.get("identity_state", {}) if isinstance(state.get("identity_state", {}), dict) else {}
    project_state = state.get("project_state", {}) if isinstance(state.get("project_state", {}), dict) else {}
    world_state = state.get("world_state", {}) if isinstance(state.get("world_state", {}), dict) else {}
    failure_state = state.get("failure_state", {}) if isinstance(state.get("failure_state", {}), dict) else {}
    outcome_state = state.get("outcome_state", {}) if isinstance(state.get("outcome_state", {}), dict) else {}
    utility_state = state.get("utility_state", {}) if isinstance(state.get("utility_state", {}), dict) else {}

    return {
        "version": CODEC_SCHEMA_VERSION,
        "identity": {
            "preferences": _schema_bucket(
                identity_state.get("preferences", []),
                revisions=identity_state.get("preference_revisions", []),
                revision_count=int(identity_state.get("preference_revision_count", 0) or 0),
            ),
        },
        "projects": {
            "active_projects": _schema_bucket(project_state.get("active_projects", [])),
            "active_goals": _schema_bucket(project_state.get("active_goals", [])),
            "open_loops": _schema_bucket(project_state.get("open_loops", [])),
        },
        "world": {
            "durable_facts": _schema_bucket(
                world_state.get("durable_facts", []),
                revisions=world_state.get("fact_revisions", []),
                revision_count=int(world_state.get("fact_revision_count", 0) or 0),
            ),
        },
        "failure": {
            "patterns": _schema_bucket(failure_state.get("patterns", [])),
            "lessons": _schema_bucket(
                failure_state.get("lessons", []),
                revisions=failure_state.get("lesson_revisions", []),
                revision_count=int(failure_state.get("lesson_revision_count", 0) or 0),
            ),
        },
        "outcomes": {
            "success_count": int(outcome_state.get("success_count", 0) or 0),
            "failure_count": int(outcome_state.get("failure_count", 0) or 0),
            "neutral_count": int(outcome_state.get("neutral_count", 0) or 0),
        },
        "utility": {
            "summary": utility_state.get("summary", {}) if isinstance(utility_state.get("summary", {}), dict) else {},
            "retention_policy": utility_state.get("retention_policy", _codec_retention_policy()) if isinstance(utility_state, dict) else _codec_retention_policy(),
            "bucket_scores": utility_state.get("bucket_scores", {}) if isinstance(utility_state.get("bucket_scores", {}), dict) else {},
        },
        "promotion": state.get("promotion_state", {}) if isinstance(state.get("promotion_state", {}), dict) else _build_promotion_state(state),
    }



def _migrate_codec_state(state: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    payload = dict(state or {})
    has_explicit_contract = bool(payload) and ("version" in payload or "schema_version" in payload)
    previous_version = _clean_text(payload.get("version") or CODEC_VERSION) or CODEC_VERSION
    previous_schema_version = _clean_text(payload.get("schema_version") or (CODEC_SCHEMA_VERSION if not has_explicit_contract else ""))

    identity_state = payload.get("identity_state", {}) if isinstance(payload.get("identity_state", {}), dict) else {}
    project_state = payload.get("project_state", {}) if isinstance(payload.get("project_state", {}), dict) else {}
    world_state = payload.get("world_state", {}) if isinstance(payload.get("world_state", {}), dict) else {}
    failure_state = payload.get("failure_state", {}) if isinstance(payload.get("failure_state", {}), dict) else {}
    outcome_state = payload.get("outcome_state", {}) if isinstance(payload.get("outcome_state", {}), dict) else {}
    utility_state = payload.get("utility_state", {}) if isinstance(payload.get("utility_state", {}), dict) else {}

    payload["version"] = CODEC_VERSION
    payload["schema_version"] = CODEC_SCHEMA_VERSION
    payload["identity_state"] = {
        "preferences": _normalize_text_list(identity_state.get("preferences", [])),
        "preference_revisions": _normalize_revision_log(identity_state.get("preference_revisions", [])),
        "preference_revision_count": max(_bounded_nonnegative_int(identity_state.get("preference_revision_count"), maximum=10**12), len(_normalize_revision_log(identity_state.get("preference_revisions", [])))),
    }
    payload["project_state"] = {
        "active_projects": _normalize_text_list(project_state.get("active_projects", [])),
        "active_goals": _normalize_text_list(project_state.get("active_goals", [])),
        "open_loops": _normalize_text_list(project_state.get("open_loops", [])),
    }
    payload["world_state"] = {
        "durable_facts": _normalize_text_list(world_state.get("durable_facts", [])),
        "fact_revisions": _normalize_revision_log(world_state.get("fact_revisions", [])),
        "fact_revision_count": max(_bounded_nonnegative_int(world_state.get("fact_revision_count"), maximum=10**12), len(_normalize_revision_log(world_state.get("fact_revisions", [])))),
    }
    payload["failure_state"] = {
        "patterns": _normalize_text_list(failure_state.get("patterns", [])),
        "lessons": _normalize_text_list(failure_state.get("lessons", [])),
        "lesson_revisions": _normalize_revision_log(failure_state.get("lesson_revisions", [])),
        "lesson_revision_count": max(_bounded_nonnegative_int(failure_state.get("lesson_revision_count"), maximum=10**12), len(_normalize_revision_log(failure_state.get("lesson_revisions", [])))),
    }
    payload["outcome_state"] = {
        "success_count": _bounded_nonnegative_int(outcome_state.get("success_count"), maximum=10**12),
        "failure_count": _bounded_nonnegative_int(outcome_state.get("failure_count"), maximum=10**12),
        "neutral_count": _bounded_nonnegative_int(outcome_state.get("neutral_count"), maximum=10**12),
    }
    previous_bucket_scores = utility_state.get("bucket_scores", {}) if isinstance(utility_state.get("bucket_scores", {}), dict) else {}
    generated_at = _clean_text(payload.get("generated_at")) or _now_iso()
    active_bucket_items = {
        "preferences": payload["identity_state"]["preferences"],
        "active_projects": payload["project_state"]["active_projects"],
        "active_goals": payload["project_state"]["active_goals"],
        "open_loops": payload["project_state"]["open_loops"],
        "durable_facts": payload["world_state"]["durable_facts"],
        "patterns": payload["failure_state"]["patterns"],
        "lessons": payload["failure_state"]["lessons"],
    }
    bucket_scores = {
        bucket: _normalize_bucket_utility_scores(
            bucket,
            items,
            previous_bucket_scores.get(bucket) if isinstance(previous_bucket_scores.get(bucket), dict) else {},
            generated_at=generated_at,
        )
        for bucket, items in active_bucket_items.items()
    }
    utility_summary = _utility_summary(bucket_scores)
    payload["source_refs"] = [dict(row) for row in (payload.get("source_refs") or []) if isinstance(row, dict)][:32]
    payload["utility_state"] = {
        "version": _clean_text(utility_state.get("version") or "cortex.codec.utility.v1") or "cortex.codec.utility.v1",
        "bucket_scores": bucket_scores,
        "summary": utility_summary,
        "retention_policy": utility_state.get("retention_policy", _codec_retention_policy()) if isinstance(utility_state, dict) else _codec_retention_policy(),
    }
    payload["promotion_state"] = _build_promotion_state(payload)
    payload["schema_state"] = _export_schema_state(payload)
    payload["memory_facts"] = [dict(row) for row in (payload.get("memory_facts") or []) if isinstance(row, dict)][:64]
    payload["migration"] = {
        "source_version": previous_version,
        "source_schema_version": previous_schema_version or "legacy",
        "compat_mode": previous_version != CODEC_VERSION or previous_schema_version != CODEC_SCHEMA_VERSION,
    }
    return payload


def _sanitize_codec_source_state(state: Dict[str, Any]) -> Dict[str, Any]:
    """Bound an already-current Codec state without changing semantic scores."""

    payload = {
        key: copy.deepcopy(state[key])
        for key in _CODEC_SOURCE_STATE_KEYS
        if key in state and key not in _CODEC_DERIVED_STATE_KEYS
    }
    payload["version"] = CODEC_VERSION
    payload["schema_version"] = CODEC_SCHEMA_VERSION
    payload["generated_at"] = (_clean_text(payload.get("generated_at")) or _now_iso())[:128]
    payload["summary"] = _clean_text(payload.get("summary"))[:CODEC_STATE_SUMMARY_MAX_CHARS]
    payload["state_revision"] = _bounded_nonnegative_int(payload.get("state_revision"), maximum=10**12)
    payload["source_event_count"] = _bounded_nonnegative_int(payload.get("source_event_count"), maximum=10**12)

    identity = payload.get("identity_state") if isinstance(payload.get("identity_state"), dict) else {}
    project = payload.get("project_state") if isinstance(payload.get("project_state"), dict) else {}
    world = payload.get("world_state") if isinstance(payload.get("world_state"), dict) else {}
    failure = payload.get("failure_state") if isinstance(payload.get("failure_state"), dict) else {}
    payload["identity_state"] = {
        "preferences": _normalize_text_list(identity.get("preferences", [])),
        "preference_revisions": _normalize_revision_log(identity.get("preference_revisions", [])),
        "preference_revision_count": _bounded_nonnegative_int(identity.get("preference_revision_count"), maximum=10**12),
    }
    payload["project_state"] = {
        "active_projects": _normalize_text_list(project.get("active_projects", [])),
        "active_goals": _normalize_text_list(project.get("active_goals", [])),
        "open_loops": _normalize_text_list(project.get("open_loops", [])),
    }
    payload["world_state"] = {
        "durable_facts": _normalize_text_list(world.get("durable_facts", [])),
        "fact_revisions": _normalize_revision_log(world.get("fact_revisions", [])),
        "fact_revision_count": _bounded_nonnegative_int(world.get("fact_revision_count"), maximum=10**12),
    }
    payload["failure_state"] = {
        "patterns": _normalize_text_list(failure.get("patterns", [])),
        "lessons": _normalize_text_list(failure.get("lessons", [])),
        "lesson_revisions": _normalize_revision_log(failure.get("lesson_revisions", [])),
        "lesson_revision_count": _bounded_nonnegative_int(failure.get("lesson_revision_count"), maximum=10**12),
    }

    normalized_refs = []
    for row in payload.get("source_refs", []) if isinstance(payload.get("source_refs"), list) else []:
        if not isinstance(row, dict):
            continue
        normalized_refs.append({
            "event_id": _clean_state_text(row.get("event_id")) or None,
            "session_key": _clean_state_text(row.get("session_key")) or None,
            "event_kind": _clean_state_text(row.get("event_kind") or "event") or "event",
            "ts": _clean_state_text(row.get("ts")) or None,
        })
        if len(normalized_refs) >= 32:
            break
    payload["source_refs"] = normalized_refs

    active_items = {
        "preferences": payload["identity_state"]["preferences"],
        "active_projects": payload["project_state"]["active_projects"],
        "active_goals": payload["project_state"]["active_goals"],
        "open_loops": payload["project_state"]["open_loops"],
        "durable_facts": payload["world_state"]["durable_facts"],
        "patterns": payload["failure_state"]["patterns"],
        "lessons": payload["failure_state"]["lessons"],
    }
    utility = payload.get("utility_state") if isinstance(payload.get("utility_state"), dict) else {}
    prior_buckets = utility.get("bucket_scores") if isinstance(utility.get("bucket_scores"), dict) else {}
    bucket_scores: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for bucket, items in active_items.items():
        prior = prior_buckets.get(bucket) if isinstance(prior_buckets.get(bucket), dict) else {}
        rows: Dict[str, Dict[str, Any]] = {}
        for text in items:
            key = text.lower()
            candidate = prior.get(key) if isinstance(prior.get(key), dict) else {}
            row = {
                "text": text,
                "bucket": bucket,
                "score": round(_clamp(_coerce_float(candidate.get("score"), _base_utility_score(text, bucket)), 0.0, UTILITY_MAX_SCORE), 3),
                "evidence_count": max(1, _bounded_nonnegative_int(candidate.get("evidence_count"), maximum=10**9, default=1)),
                "observation_count": _bounded_nonnegative_int(candidate.get("observation_count"), maximum=10**9),
                "last_seen_at": _clean_text(candidate.get("last_seen_at"))[:128],
                "age_hours": round(_clamp(_coerce_float(candidate.get("age_hours"), 0.0), 0.0, 10**9), 3),
                "freshness": (_clean_text(candidate.get("freshness")) or "fresh")[:32],
                "confidence": round(_clamp(_coerce_float(candidate.get("confidence"), 0.0), 0.0, 1.0), 3),
            }
            for field in ("global_evidence_count", "global_session_count", "cross_session_count"):
                if field in candidate:
                    row[field] = _bounded_nonnegative_int(candidate.get(field), maximum=10**9)
            for field in ("rollup_confidence",):
                if field in candidate:
                    row[field] = round(_clamp(_coerce_float(candidate.get(field), 0.0), 0.0, 1.0), 3)
            for field in ("rollup_last_seen_at", "rollup_freshness", "rollup_match_type"):
                if field in candidate:
                    row[field] = _clean_state_text(candidate.get(field))
            aliases = candidate.get("rollup_alias_members")
            if isinstance(aliases, list):
                row["rollup_alias_members"] = _normalize_text_list(aliases, limit=5)
            rows[key] = row
        bucket_scores[bucket] = rows
    payload["utility_state"] = {
        "version": (_clean_text(utility.get("version") or "cortex.codec.utility.v1") or "cortex.codec.utility.v1")[:128],
        "bucket_scores": bucket_scores,
        "summary": _utility_summary(bucket_scores),
        "retention_policy": _codec_retention_policy(),
    }

    compression = payload.get("compression") if isinstance(payload.get("compression"), dict) else {}
    payload["compression"] = {
        "source_events": _bounded_nonnegative_int(compression.get("source_events", payload["source_event_count"]), maximum=10**12),
        "raw_characters": _bounded_nonnegative_int(compression.get("raw_characters"), maximum=10**15),
        "prompt_characters": _bounded_nonnegative_int(compression.get("prompt_characters"), maximum=10**15),
        "ratio": round(_clamp(_coerce_float(compression.get("ratio"), 0.0), 0.0, 10**9), 3),
    }
    outcome = payload.get("outcome_state") if isinstance(payload.get("outcome_state"), dict) else {}
    payload["outcome_state"] = {
        key: _bounded_nonnegative_int(outcome.get(key), maximum=10**12)
        for key in ("success_count", "failure_count", "neutral_count")
    }
    migration = payload.get("migration") if isinstance(payload.get("migration"), dict) else {}
    payload["migration"] = {
        "source_version": (_clean_text(migration.get("source_version") or CODEC_VERSION) or CODEC_VERSION)[:128],
        "source_schema_version": (_clean_text(migration.get("source_schema_version") or CODEC_SCHEMA_VERSION) or CODEC_SCHEMA_VERSION)[:128],
        "compat_mode": bool(migration.get("compat_mode")),
    }
    return payload


def _boost_utility_bucket(
    state: Dict[str, Any],
    bucket: str,
    text: str,
    *,
    delta: float = UTILITY_OUTCOME_BOOST,
    generated_at: str = "",
) -> None:
    cleaned = _clean_text(text)
    if not cleaned:
        return
    utility_state = state.setdefault("utility_state", {})
    bucket_scores = utility_state.setdefault("bucket_scores", {})
    bucket_map = bucket_scores.setdefault(bucket, {})
    key = cleaned.lower()
    current = bucket_map.get(key) if isinstance(bucket_map.get(key), dict) else {}
    score = max(_base_utility_score(cleaned, bucket), _coerce_float(current.get("score"), 0.0) + delta)
    bucket_map[key] = _annotate_utility_entry({
        "text": cleaned,
        "bucket": bucket,
        "score": round(_clamp(score, 0.0, UTILITY_MAX_SCORE), 3),
        "evidence_count": max(1, int(current.get("evidence_count", 0) or 0) + 1),
        "observation_count": max(1, int(current.get("observation_count", 0) or 0) + 1),
        "last_seen_at": generated_at or _now_iso(),
    }, reference_at=generated_at or _now_iso())
    utility_state["summary"] = _utility_summary(bucket_scores)


def _extract_project_candidates(event: Dict[str, Any], text: str) -> List[str]:
    candidates: List[str] = []
    preference_like = _contains_any(text, PREFERENCE_HINTS)
    feedback_like = _contains_any(text, FAILURE_HINTS) and not _contains_any(text, OPEN_LOOP_HINTS)

    metadata = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
    for key in ("project", "topic", "domain"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            cleaned = value.strip()
            aliases = [alias for alias in _project_alias_candidates(cleaned) if not _project_mention_is_negated(text, alias)]
            if aliases:
                candidates.extend(aliases)
            elif not _project_mention_is_negated(text, cleaned):
                candidates.append(cleaned)

    tags = event.get("tags")
    if isinstance(tags, list):
        for tag in tags:
            if not isinstance(tag, str) or not tag.strip():
                continue
            cleaned = tag.strip()
            lowered = cleaned.lower()
            if lowered in PROJECT_STOPWORDS or lowered in PROJECT_GENERIC_TAGS:
                continue
            aliases = [alias for alias in _project_alias_candidates(cleaned) if not _project_mention_is_negated(text, alias)]
            if aliases:
                candidates.extend(aliases)
                continue
            explicit = re.match(r"^(?:project|repo|repository|workspace)\s*[:=/]\s*(.+)$", cleaned, flags=re.IGNORECASE)
            if explicit and not _project_mention_is_negated(text, explicit.group(1)):
                candidates.append(explicit.group(1).strip())

    candidates.extend(alias for alias in _project_alias_candidates(text) if not _project_mention_is_negated(text, alias))

    if not preference_like and not feedback_like:
        for match in re.findall(r"\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2})\b", text):
            cleaned = match.strip()
            parts = cleaned.split()
            if parts and parts[0].lower() in {"no", "not", "without"}:
                continue
            if len(parts) > 1 and parts[0].lower() == "the":
                cleaned = " ".join(parts[1:])
                parts = cleaned.split()
            lowered = cleaned.lower()
            if not cleaned or lowered in PROJECT_STOPWORDS or lowered in PROJECT_GENERIC_TAGS:
                continue
            if len(parts) == 1 and not re.search(r"[a-z][A-Z]", cleaned):
                continue
            if len(parts) == 1 and lowered in PROJECT_SINGLE_TOKEN_STOPWORDS:
                continue
            if _project_mention_is_negated(text, cleaned):
                continue
            aliases = _project_alias_candidates(cleaned)
            candidates.extend(aliases or [cleaned])

    context_nouns = "|".join(re.escape(noun) for noun in PROJECT_CONTEXT_NOUNS)
    contextual_patterns = (
        rf"\b(?:{context_nouns})\s+(?:called\s+|named\s+)?[`'\"]?([a-z0-9]+(?:[-_][a-z0-9]+)+)",
        rf"\b([a-z0-9]+(?:[-_][a-z0-9]+)+)\s+(?:{context_nouns})\b",
    )
    for pattern in contextual_patterns:
        for match in re.findall(pattern, text.lower()):
            if match not in PROJECT_STOPWORDS and not _project_mention_is_negated(text, match):
                aliases = _project_alias_candidates(match)
                candidates.extend(aliases or [match])

    deduped: List[str] = []
    seen = set()
    for item in candidates:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _rank_unique(items: Iterable[str], *, limit: int = 8) -> List[str]:
    counter: Counter[str] = Counter()
    original: Dict[str, str] = {}
    for raw in items:
        text = _clean_state_text(raw)
        if not text:
            continue
        key = text.lower()
        counter[key] += 1
        original.setdefault(key, text)
    ranked = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    return [original[key] for key, _count in ranked[:limit]]


def _merge_ranked(existing: Optional[List[str]], new_items: Iterable[str], *, limit: int = 8) -> List[str]:
    merged: List[str] = []
    seen = set()
    for bucket in (existing or [], list(new_items)):
        for item in bucket:
            text = _clean_state_text(item)
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            merged.append(text)
    return merged[:limit]



def _strip_revision_prefix(text: str) -> str:
    cleaned = _clean_text(text)
    return re.sub(
        r"^(?:important\s+decision|decision|remember\s+this(?:\s+(?:fact|lesson|note|decision))?|note|correction|update|updated)\s*:\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )



def _claim_signature(text: str) -> Dict[str, Any]:
    raw_lowered = _clean_text(text).lower()
    cleaned = _strip_revision_prefix(text)
    normalized = _normalize_claim_fragment(cleaned)
    normalized = re.sub(r"^(?:actually|now|updated|update)\s+", "", normalized).strip()
    explicit_revision = _contains_any(raw_lowered, REVISION_HINTS)

    match = re.match(r"^(?P<prefix>do not use|don't use|avoid|use)\s+(?P<value>.+?)\s+for\s+(?P<context>.+)$", normalized)
    if match:
        prefix = match.group("prefix")
        value = _trim_claim_tail(match.group("value"))
        context = _trim_claim_tail(match.group("context"))
        return {
            "kind": "imperative_context",
            "key": f"use_for:{_normalize_claim_fragment(context)}",
            "value": _normalize_claim_fragment(value),
            "polarity": -1 if prefix in {"do not use", "don't use", "avoid"} else 1,
            "explicit_revision": explicit_revision,
            "normalized_text": normalized,
        }

    match = re.match(r"^(?P<prefix>do not start replies with|don't start replies with|start replies with|begin replies with)\s+(?P<value>.+)$", normalized)
    if match:
        prefix = match.group("prefix")
        value = _trim_claim_tail(match.group("value"))
        return {
            "kind": "reply_prefix",
            "key": "reply_prefix",
            "value": _normalize_claim_fragment(value),
            "polarity": -1 if prefix.startswith(("do not", "don't")) else 1,
            "explicit_revision": explicit_revision,
            "normalized_text": normalized,
        }

    match = re.match(r"^call me\s+(?P<value>.+)$", normalized)
    if match:
        value = _trim_claim_tail(match.group("value"))
        return {
            "kind": "call_me",
            "key": "call_me",
            "value": _normalize_claim_fragment(value),
            "polarity": 1,
            "explicit_revision": explicit_revision,
            "normalized_text": normalized,
        }

    match = re.match(r"^prefer\s+(?P<value>.+)$", normalized)
    if match:
        value = _trim_claim_tail(match.group("value"))
        return {
            "kind": "preference_value",
            "key": "prefer",
            "value": _normalize_claim_fragment(value),
            "polarity": 1,
            "explicit_revision": explicit_revision,
            "normalized_text": normalized,
        }

    for prefix in ("do not use ", "don't use ", "avoid "):
        if normalized.startswith(prefix):
            target = _trim_claim_tail(normalized[len(prefix):].strip())
            return {
                "kind": "imperative",
                "key": f"use:{_normalize_claim_fragment(target)}",
                "value": _normalize_claim_fragment(target),
                "polarity": -1,
                "explicit_revision": explicit_revision,
                "normalized_text": normalized,
            }
    if normalized.startswith("use "):
        target = _trim_claim_tail(normalized[4:].strip())
        return {
            "kind": "imperative",
            "key": f"use:{_normalize_claim_fragment(target)}",
            "value": _normalize_claim_fragment(target),
            "polarity": 1,
            "explicit_revision": explicit_revision,
            "normalized_text": normalized,
        }

    match = re.match(r"^(?P<subject>.+?)\s+uses\s+(?P<predicate>.+)$", normalized)
    if match:
        subject = _normalize_claim_fragment(match.group("subject"))
        predicate = _trim_claim_tail(match.group("predicate"))
        return {
            "kind": "usage",
            "key": f"uses:{subject}",
            "value": _normalize_claim_fragment(predicate),
            "polarity": 1,
            "explicit_revision": explicit_revision,
            "normalized_text": normalized,
        }

    match = re.match(r"^(?P<subject>.+?)\s+(?:is|are|was|were)\s+(?P<predicate>.+)$", normalized)
    if match:
        subject = _normalize_claim_fragment(match.group("subject"))
        predicate = match.group("predicate").strip()
        polarity = 1
        if predicate.startswith(("not ", "no ", "never ")):
            polarity = -1
            predicate = re.sub(r"^(?:not|no|never)\s+", "", predicate).strip()
        predicate = _trim_claim_tail(predicate)
        return {
            "kind": "copula",
            "key": f"copula:{subject}",
            "value": _normalize_claim_fragment(predicate),
            "polarity": polarity,
            "explicit_revision": explicit_revision,
            "normalized_text": normalized,
        }

    return {
        "kind": "text",
        "key": f"text:{' '.join(normalized.split()[:6])}",
        "value": normalized,
        "polarity": 0,
        "explicit_revision": explicit_revision,
        "normalized_text": normalized,
    }


def _claims_conflict(existing: Dict[str, Any], candidate: Dict[str, Any]) -> bool:
    if not existing or not candidate:
        return False
    existing_key = str(existing.get("key") or "")
    candidate_key = str(candidate.get("key") or "")
    same_key = existing_key == candidate_key
    same_text = str(existing.get("normalized_text") or "") == str(candidate.get("normalized_text") or "")
    if same_key and same_text:
        return False
    if same_key:
        if int(existing.get("polarity") or 0) != int(candidate.get("polarity") or 0):
            return True
        if str(existing.get("value") or "") != str(candidate.get("value") or ""):
            return True
        if bool(existing.get("explicit_revision")) or bool(candidate.get("explicit_revision")):
            return True
        return False

    overlap = _claim_overlap(existing.get("normalized_text"), candidate.get("normalized_text"))
    if overlap >= 0.72 and (bool(existing.get("explicit_revision")) or bool(candidate.get("explicit_revision"))):
        return True
    if overlap >= 0.82 and int(existing.get("polarity") or 0) != int(candidate.get("polarity") or 0):
        return True
    return False


def _resolve_bucket_revisions(
    existing_items: Optional[List[str]],
    new_items: Optional[List[str]],
    previous_revisions: Optional[List[Dict[str, Any]]],
    *,
    bucket: str,
    generated_at: str,
    limit: int = 8,
) -> Dict[str, Any]:
    revisions = [item for item in (previous_revisions or []) if isinstance(item, dict)]
    active: List[str] = []
    seen = set()
    for item in existing_items or []:
        cleaned = _clean_state_text(item)
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        active.append(cleaned)

    for item in new_items or []:
        cleaned = _clean_state_text(item)
        if not cleaned:
            continue
        candidate_claim = _claim_signature(cleaned)
        surviving: List[str] = []
        replaced: List[str] = []
        for prior in active:
            prior_claim = _claim_signature(prior)
            if _claims_conflict(prior_claim, candidate_claim):
                replaced.append(prior)
                continue
            if prior.lower() == cleaned.lower():
                continue
            surviving.append(prior)
        active = [cleaned] + surviving
        if replaced:
            for prior in replaced:
                revisions.append({
                    "bucket": bucket,
                    "superseded_text": prior,
                    "replacement_text": cleaned,
                    "claim_key": str(candidate_claim.get("key") or ""),
                    "reason": "contradiction_or_revision",
                    "generated_at": generated_at,
                })

    return {
        "items": active[:limit],
        "revisions": revisions[-REVISION_LOG_LIMIT:],
        "revision_count": len(revisions),
    }


def build_codec_state(
    events: List[Dict[str, Any]],
    previous_state: Optional[Dict[str, Any]] = None,
    *,
    max_items_per_bucket: int = 8,
) -> Dict[str, Any]:
    """Compile raw events into a compact persistent state packet.

    This is the first Cortex Codec primitive: convert messy interaction traces into
    reusable state rather than replaying whole transcripts.
    """

    previous_state = _migrate_codec_state(previous_state or {})

    raw_texts: List[str] = []
    preferences: List[str] = []
    open_loops: List[str] = []
    failure_patterns: List[str] = []
    lessons: List[str] = []
    goals: List[str] = []
    facts: List[str] = []
    project_candidates: List[str] = []
    outcome_counters = {"success": 0, "failure": 0, "neutral": 0}

    for event in events:
        event_text = " | ".join(_iter_text_candidates(event))
        text = _clean_state_text(event_text)
        if not text:
            continue
        raw_texts.append(text)

        project_candidates.extend(_extract_project_candidates(event, text))

        lowered = text.lower()
        completed_checkpoint = _looks_like_completed_checkpoint(text)
        if _contains_any(text, PREFERENCE_HINTS):
            preferences.append(text)
        if _contains_any(text, OPEN_LOOP_HINTS) or _looks_like_question(text):
            open_loops.append(text)
        if _contains_any(text, FAILURE_HINTS):
            failure_patterns.append(text)
        if _looks_like_success_outcome(text) or completed_checkpoint:
            outcome_counters["success"] += 1
            lessons.append(text)
        elif _contains_any(text, OUTCOME_FAILURE_HINTS):
            outcome_counters["failure"] += 1
            lessons.append(text)
        else:
            outcome_counters["neutral"] += 1

        if re.search(r"\b(goal|aim|want|build|ship|design|implement|create)\b", lowered):
            goals.append(text)
        if re.search(r"\b(decision|important|note|fact|remember|state)\b", lowered) or completed_checkpoint:
            facts.append(text)

    projects = _rank_unique(project_candidates, limit=max_items_per_bucket)
    preferences = _rank_unique(preferences, limit=max_items_per_bucket)
    open_loops = _rank_unique(open_loops, limit=max_items_per_bucket)
    failure_patterns = _rank_unique(failure_patterns, limit=max_items_per_bucket)
    lessons = _rank_unique(lessons, limit=max_items_per_bucket)
    goals = _rank_unique(goals, limit=max_items_per_bucket)
    facts = _rank_unique(facts, limit=max_items_per_bucket)

    generated_at = _now_iso()

    preference_resolution = _resolve_bucket_revisions(
        previous_state.get("identity_state", {}).get("preferences"),
        preferences,
        previous_state.get("identity_state", {}).get("preference_revisions"),
        bucket="preferences",
        generated_at=generated_at,
        limit=max_items_per_bucket,
    )

    fact_resolution = _resolve_bucket_revisions(
        previous_state.get("world_state", {}).get("durable_facts"),
        facts,
        previous_state.get("world_state", {}).get("fact_revisions"),
        bucket="durable_facts",
        generated_at=generated_at,
        limit=max_items_per_bucket,
    )
    lesson_resolution = _resolve_bucket_revisions(
        previous_state.get("failure_state", {}).get("lessons"),
        lessons,
        previous_state.get("failure_state", {}).get("lesson_revisions"),
        bucket="lessons",
        generated_at=generated_at,
        limit=max_items_per_bucket,
    )

    state = {
        "version": CODEC_VERSION,
        "schema_version": CODEC_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_event_count": len(events),
        "source_refs": _source_refs_from_events(events),
        "compression": {
            "raw_characters": sum(len(text) for text in raw_texts),
            "state_fields": 7,
            "compression_mode": "state_not_transcript",
        },
        "identity_state": {
            "preferences": preference_resolution["items"],
            "preference_revisions": preference_resolution["revisions"],
            "preference_revision_count": preference_resolution["revision_count"],
        },
        "project_state": {
            "active_projects": _merge_ranked(previous_state.get("project_state", {}).get("active_projects"), projects, limit=max_items_per_bucket),
            "active_goals": _merge_ranked(previous_state.get("project_state", {}).get("active_goals"), goals, limit=max_items_per_bucket),
            "open_loops": _merge_ranked(previous_state.get("project_state", {}).get("open_loops"), open_loops, limit=max_items_per_bucket),
        },
        "world_state": {
            "durable_facts": fact_resolution["items"],
            "fact_revisions": fact_resolution["revisions"],
            "fact_revision_count": fact_resolution["revision_count"],
        },
        "failure_state": {
            "patterns": _merge_ranked(previous_state.get("failure_state", {}).get("patterns"), failure_patterns, limit=max_items_per_bucket),
            "lessons": lesson_resolution["items"],
            "lesson_revisions": lesson_resolution["revisions"],
            "lesson_revision_count": lesson_resolution["revision_count"],
        },
        "outcome_state": {
            "success_count": int(previous_state.get("outcome_state", {}).get("success_count", 0)) + outcome_counters["success"],
            "failure_count": int(previous_state.get("outcome_state", {}).get("failure_count", 0)) + outcome_counters["failure"],
            "neutral_count": int(previous_state.get("outcome_state", {}).get("neutral_count", 0)) + outcome_counters["neutral"],
        },
    }

    previous_bucket_scores = previous_state.get("utility_state", {}).get("bucket_scores", {}) if isinstance(previous_state.get("utility_state", {}), dict) else {}
    bucket_scores = {
        "preferences": _build_bucket_utility("preferences", state["identity_state"]["preferences"], preferences, previous_bucket_scores.get("preferences"), generated_at=generated_at),
        "active_projects": _build_bucket_utility("active_projects", state["project_state"]["active_projects"], project_candidates, previous_bucket_scores.get("active_projects"), generated_at=generated_at),
        "active_goals": _build_bucket_utility("active_goals", state["project_state"]["active_goals"], goals, previous_bucket_scores.get("active_goals"), generated_at=generated_at),
        "open_loops": _build_bucket_utility("open_loops", state["project_state"]["open_loops"], open_loops, previous_bucket_scores.get("open_loops"), generated_at=generated_at),
        "durable_facts": _build_bucket_utility("durable_facts", state["world_state"]["durable_facts"], facts, previous_bucket_scores.get("durable_facts"), generated_at=generated_at),
        "patterns": _build_bucket_utility("patterns", state["failure_state"]["patterns"], failure_patterns, previous_bucket_scores.get("patterns"), generated_at=generated_at),
        "lessons": _build_bucket_utility("lessons", state["failure_state"]["lessons"], lessons, previous_bucket_scores.get("lessons"), generated_at=generated_at),
    }
    state["utility_state"] = {
        "version": "cortex.codec.utility.v1",
        "bucket_scores": bucket_scores,
        "summary": _utility_summary(bucket_scores),
        "retention_policy": _codec_retention_policy(),
    }
    state["promotion_state"] = _build_promotion_state(state)
    state["memory_facts"] = []

    summary_parts: List[str] = []
    if state["project_state"]["active_projects"]:
        summary_parts.append("Projects: " + ", ".join(state["project_state"]["active_projects"][:3]))
    if state["project_state"]["active_goals"]:
        summary_parts.append("Goals: " + "; ".join(state["project_state"]["active_goals"][:2]))
    if state["project_state"]["open_loops"]:
        summary_parts.append("Open loops: " + "; ".join(state["project_state"]["open_loops"][:2]))
    if state["identity_state"]["preferences"]:
        summary_parts.append("Preferences: " + "; ".join(state["identity_state"]["preferences"][:1]))
    state["summary"] = (" | ".join(summary_parts) if summary_parts else "No stable state extracted yet.")[: max(256, int(CODEC_STATE_SUMMARY_MAX_CHARS))]

    compressed_chars = len(compress_codec_for_prompt(state, max_chars=10000))
    raw_chars = max(1, state["compression"]["raw_characters"])
    state["compression"]["prompt_characters"] = compressed_chars
    state["compression"]["ratio"] = round(raw_chars / max(1, compressed_chars), 3)
    state["memory_facts"] = build_codec_memory_facts(session_key=None, codec_state=state)

    return _migrate_codec_state(state)


def apply_codec_outcome_feedback(
    state: Dict[str, Any],
    outcome_event: Dict[str, Any],
    *,
    max_items_per_bucket: int = 8,
) -> Dict[str, Any]:
    """Update Codec state based on observed reality, not just immediate salience."""

    state = _migrate_codec_state(state)

    updated = {
        **state,
        "identity_state": dict(state.get("identity_state", {})),
        "project_state": dict(state.get("project_state", {})),
        "world_state": dict(state.get("world_state", {})),
        "failure_state": dict(state.get("failure_state", {})),
        "outcome_state": dict(state.get("outcome_state", {})),
        "utility_state": json.loads(json.dumps(state.get("utility_state", {}))) if isinstance(state.get("utility_state", {}), dict) else {},
    }

    text = _clean_state_text(outcome_event.get("text") or outcome_event.get("summary") or outcome_event.get("message"))
    status = str(outcome_event.get("status") or "neutral").lower()

    if status == "success":
        updated["outcome_state"]["success_count"] = int(updated["outcome_state"].get("success_count", 0)) + 1
        updated["failure_state"]["lessons"] = _merge_ranked(
            updated["failure_state"].get("lessons"),
            [text] if text else [],
            limit=max_items_per_bucket,
        )
        _boost_utility_bucket(updated, "lessons", text, delta=UTILITY_OUTCOME_BOOST)
    elif status == "failure":
        updated["outcome_state"]["failure_count"] = int(updated["outcome_state"].get("failure_count", 0)) + 1
        updated["failure_state"]["patterns"] = _merge_ranked(
            updated["failure_state"].get("patterns"),
            [text] if text else [],
            limit=max_items_per_bucket,
        )
        _boost_utility_bucket(updated, "patterns", text, delta=UTILITY_OUTCOME_BOOST + 0.08)
    else:
        updated["outcome_state"]["neutral_count"] = int(updated["outcome_state"].get("neutral_count", 0)) + 1

    updated["generated_at"] = _now_iso()
    if isinstance(updated.get("utility_state"), dict):
        updated["utility_state"]["summary"] = _utility_summary(updated["utility_state"].get("bucket_scores", {}))
    updated["promotion_state"] = _build_promotion_state(updated)
    updated["schema_state"] = _export_schema_state(updated)
    updated["summary"] = build_codec_state([], previous_state=updated, max_items_per_bucket=max_items_per_bucket).get("summary", updated.get("summary"))
    updated["memory_facts"] = build_codec_memory_facts(session_key=None, codec_state=updated)
    return _migrate_codec_state(updated)


def _packet_bucket_rank(bucket: str, item: str, state: Dict[str, Any]) -> Dict[str, Any]:
    promoted = _promoted_texts(state, bucket)
    promoted_index = promoted.index(item) if item in promoted else None
    meta = _bucket_meta(state, bucket, item)
    freshness = str(meta.get("freshness") or "")
    freshness_rank = {"fresh": 0, "warm": 1, "aging": 2, "stale": 3}.get(freshness, 4)
    return {
        "text": item,
        "promoted": promoted_index is not None,
        "promoted_index": promoted_index if promoted_index is not None else 999,
        "score": _coerce_float(meta.get("score"), _base_utility_score(item, bucket)),
        "confidence": _coerce_float(meta.get("confidence"), 0.0),
        "freshness": freshness,
        "freshness_rank": freshness_rank,
        "age_hours": _coerce_float(meta.get("age_hours"), 0.0),
    }


def _promoted_texts(state: Dict[str, Any], bucket: str) -> List[str]:
    promoted = (state.get("promotion_state", {}) if isinstance(state.get("promotion_state", {}), dict) else {}).get("promoted", {})
    rows = promoted.get(bucket) if isinstance(promoted.get(bucket), list) else []
    return [str(row.get("text") or "") for row in rows if isinstance(row, dict) and _clean_text(row.get("text"))]


def _bucket_meta(state: Dict[str, Any], bucket: str, item: str) -> Dict[str, Any]:
    utility = (state.get("utility_state", {}) if isinstance(state.get("utility_state", {}), dict) else {}).get("bucket_scores", {})
    bucket_scores = utility.get(bucket) if isinstance(utility.get(bucket), dict) else {}
    return bucket_scores.get(_clean_text(item).lower()) if isinstance(bucket_scores.get(_clean_text(item).lower()), dict) else {}


def _packet_bucket_items(bucket: str, state: Dict[str, Any], *, limit: int) -> List[str]:
    bucket_map = {
        "preferences": (state.get("identity_state", {}) if isinstance(state.get("identity_state", {}), dict) else {}).get("preferences", []),
        "active_projects": (state.get("project_state", {}) if isinstance(state.get("project_state", {}), dict) else {}).get("active_projects", []),
        "active_goals": (state.get("project_state", {}) if isinstance(state.get("project_state", {}), dict) else {}).get("active_goals", []),
        "open_loops": (state.get("project_state", {}) if isinstance(state.get("project_state", {}), dict) else {}).get("open_loops", []),
        "durable_facts": (state.get("world_state", {}) if isinstance(state.get("world_state", {}), dict) else {}).get("durable_facts", []),
        "patterns": (state.get("failure_state", {}) if isinstance(state.get("failure_state", {}), dict) else {}).get("patterns", []),
        "lessons": (state.get("failure_state", {}) if isinstance(state.get("failure_state", {}), dict) else {}).get("lessons", []),
    }
    items = _normalize_text_list(bucket_map.get(bucket, []), limit=64)
    if not items:
        return []

    ranked = [_packet_bucket_rank(bucket, item, state) for item in items]
    if not CODEC_PACKET_INCLUDE_STALE:
        ranked = [row for row in ranked if row.get("freshness") != "stale"]
    if CODEC_PACKET_USE_PROMOTION and any(row.get("promoted") for row in ranked):
        ranked = [row for row in ranked if row.get("promoted")]
    ranked.sort(
        key=lambda row: (
            0 if row.get("promoted") else 1,
            int(row.get("promoted_index") or 999),
            int(row.get("freshness_rank") or 9),
            -_coerce_float(row.get("confidence"), 0.0),
            -_coerce_float(row.get("score"), 0.0),
            _coerce_float(row.get("age_hours"), 0.0),
            str(row.get("text") or ""),
        )
    )
    return [str(row.get("text") or "") for row in ranked[: max(1, int(limit))] if _clean_text(row.get("text"))]


def compress_codec_for_prompt(state: Dict[str, Any], *, max_chars: int = 1200) -> str:
    """Render a compact prompt packet from Codec state.

    The goal is not perfect reconstruction. The goal is to preserve the parts of
    history that should still change behavior now.
    """

    sections: List[str] = []

    def _line(label: str, values: Optional[List[str]]) -> None:
        cleaned = [_clean_text(v) for v in (values or []) if _clean_text(v)]
        if cleaned:
            sections.append(f"{label}: " + " | ".join(cleaned))

    bucket_order = [
        ("Prefs", "preferences"),
        ("Projects", "active_projects"),
        ("Open", "open_loops"),
        ("Facts", "durable_facts"),
        ("Lessons", "lessons"),
    ]
    include_goals = CODEC_PACKET_INCLUDE_GOALS
    if not include_goals and _packet_bucket_items("active_goals", state, limit=1):
        include_goals = not any(
            _packet_bucket_items(bucket, state, limit=1)
            for bucket in ("preferences", "open_loops", "durable_facts", "lessons")
        )
    if include_goals:
        bucket_order.insert(2, ("Goals", "active_goals"))
    if CODEC_PACKET_INCLUDE_PATTERNS:
        bucket_order.insert(-1, ("FailurePatterns", "patterns"))
    for label, bucket in bucket_order:
        _line(label, _packet_bucket_items(bucket, state, limit=max(1, int(CODEC_PACKET_MAX_ITEMS_PER_BUCKET))))

    packet = "\n".join(sections).strip()
    if len(packet) <= max_chars:
        return packet

    truncated_sections: List[str] = []
    remaining = max_chars
    for section in sections:
        section = _clean_text(section)
        if remaining <= 0 or not section:
            break
        section_len = len(section)
        if section_len <= remaining:
            truncated_sections.append(section)
            remaining -= section_len + 1
            continue
        if remaining >= 24:
            truncated_sections.append(section[: max(0, remaining - 1)] + "…")
        break
    return "\n".join(truncated_sections).strip()


def _fetch_codec_rows_from_l22(session_key: str, *, limit: int = 25) -> List[Dict[str, Any]]:
    if not session_key or not CODEC_DURABLE_ENABLED:
        return []

    try:
        from cortex_server.routers.l22 import list_structured_memory_records

        records = list_structured_memory_records(memory_type="codec_state", lookup_key=session_key, limit=limit)
        return [{
            "id": record.get("id"),
            "document": record.get("content", ""),
            "metadata": record.get("metadata", {}),
            "generated_at": str((record.get("metadata") or {}).get("codec_generated_at") or record.get("created_at") or ""),
            "fingerprint": str((record.get("metadata") or {}).get("codec_fingerprint") or ""),
        } for record in records]
    except ImportError:
        # Compatibility fallback for older embedders and isolated unit-test doubles.
        try:
            from cortex_server.routers.librarian import collection
            rows = collection.get(where={"codec_session_key": session_key}, limit=limit, include=["documents", "metadatas"])
        except Exception:
            return []
    except Exception:
        return []

    ids = rows.get("ids") or []
    documents = rows.get("documents") or []
    metadatas = rows.get("metadatas") or []
    out: List[Dict[str, Any]] = []
    max_len = max(len(documents), len(metadatas), len(ids))
    for idx in range(max_len):
        meta = metadatas[idx] if idx < len(metadatas) and isinstance(metadatas[idx], dict) else {}
        if (
            str(meta.get("type") or "") != "codec_state"
            or str(meta.get("codec_session_key") or "") != session_key
        ):
            continue
        out.append({
            "id": ids[idx] if idx < len(ids) else None,
            "document": documents[idx] if idx < len(documents) else "",
            "metadata": meta,
            "generated_at": str(meta.get("codec_generated_at") or meta.get("generated_at") or ""),
            "fingerprint": str(meta.get("codec_fingerprint") or ""),
        })
    out.sort(key=lambda item: item.get("generated_at", ""), reverse=True)
    return out



def _fetch_global_codec_rows_from_l22(*, limit: int = 200) -> List[Dict[str, Any]]:
    if not CODEC_DURABLE_ENABLED:
        return []

    try:
        from cortex_server.routers.l22 import list_structured_memory_records

        records = list_structured_memory_records(memory_type="codec_state", limit=limit)
        return [{
            "id": record.get("id"),
            "document": record.get("content", ""),
            "metadata": record.get("metadata", {}),
            "generated_at": str((record.get("metadata") or {}).get("codec_generated_at") or record.get("created_at") or ""),
            "fingerprint": str((record.get("metadata") or {}).get("codec_fingerprint") or ""),
        } for record in records]
    except ImportError:
        try:
            from cortex_server.routers.librarian import collection
            rows = collection.get(where={"type": "codec_state"}, limit=limit, include=["documents", "metadatas"])
        except Exception:
            return []
    except Exception:
        return []

    ids = rows.get("ids") or []
    documents = rows.get("documents") or []
    metadatas = rows.get("metadatas") or []
    out: List[Dict[str, Any]] = []
    max_len = max(len(documents), len(metadatas), len(ids))
    for idx in range(max_len):
        meta = metadatas[idx] if idx < len(metadatas) and isinstance(metadatas[idx], dict) else {}
        if str(meta.get("type") or "") != "codec_state":
            continue
        out.append({
            "id": ids[idx] if idx < len(ids) else None,
            "document": documents[idx] if idx < len(documents) else "",
            "metadata": meta,
            "generated_at": str(meta.get("codec_generated_at") or meta.get("generated_at") or ""),
            "fingerprint": str(meta.get("codec_fingerprint") or ""),
        })
    out.sort(key=lambda item: item.get("generated_at", ""), reverse=True)
    return out



def _rollup_alias_key(bucket: str, text: Any) -> str:
    cleaned = _clean_text(text)
    if not cleaned:
        return ""
    claim = _claim_signature(cleaned)
    key = _clean_text(claim.get("key"))
    value = _clean_text(claim.get("value"))
    if key and not key.startswith("text:"):
        return f"{bucket}|{key}|{value}"
    tokens = _claim_tokens(cleaned)
    if tokens:
        return f"{bucket}|tokens:{' '.join(tokens[:6])}"
    return f"{bucket}|text:{_normalize_claim_fragment(cleaned)}"



def _find_rollup_match(bucket: str, item: Dict[str, Any], rollup_bucket: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(item, dict) or not isinstance(rollup_bucket, dict):
        return {}
    policy = _codec_rollup_policy()
    exact_scores = rollup_bucket.get("exact_scores", {}) if isinstance(rollup_bucket.get("exact_scores", {}), dict) else {}
    alias_scores = rollup_bucket.get("alias_scores", {}) if isinstance(rollup_bucket.get("alias_scores", {}), dict) else {}
    text = _clean_text(item.get("text"))
    key = text.lower()
    exact = exact_scores.get(key) if isinstance(exact_scores.get(key), dict) else {}
    alias_key = _rollup_alias_key(bucket, text)
    alias = alias_scores.get(alias_key) if isinstance(alias_scores.get(alias_key), dict) else {}
    if exact and alias:
        session_delta = int(alias.get("global_session_count", 0) or 0) - int(exact.get("global_session_count", 0) or 0)
        evidence_delta = int(alias.get("global_evidence_count", 0) or 0) - int(exact.get("global_evidence_count", 0) or 0)
        if session_delta >= int(policy.get("alias_prefer_session_delta", 0) or 0):
            return {**alias, "match_type": "alias"}
        if evidence_delta >= int(policy.get("alias_prefer_evidence_delta", 0) or 0):
            return {**alias, "match_type": "alias"}
        return {**exact, "match_type": "exact"}
    if exact:
        return {**exact, "match_type": "exact"}
    if alias:
        return {**alias, "match_type": "alias"}
    best: Dict[str, Any] = {}
    best_overlap = 0.0
    for candidate in exact_scores.values():
        if not isinstance(candidate, dict):
            continue
        overlap = _claim_overlap(text, candidate.get("text"))
        if overlap > best_overlap:
            best_overlap = overlap
            best = candidate
    if best and best_overlap >= _coerce_float(policy.get("match_min_overlap"), CODEC_ROLLUP_MATCH_MIN_OVERLAP):
        return {**best, "match_type": "overlap", "match_overlap": round(best_overlap, 3)}
    return {}



def _build_codec_rollup_from_rows(rows: List[Dict[str, Any]], *, session_key: str = "", reference_at: str = "") -> Dict[str, Any]:
    bucket_rollups: Dict[str, Dict[str, Dict[str, Any]]] = {}
    seen_fingerprints = set()

    for row in rows or []:
        fingerprint = str(row.get("fingerprint") or "")
        if fingerprint and fingerprint in seen_fingerprints:
            continue
        if fingerprint:
            seen_fingerprints.add(fingerprint)
        meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        source_session_key = str(meta.get("codec_session_key") or "")
        try:
            doc = json.loads(row.get("document") or "{}")
        except Exception:
            doc = {}
        utility_state = doc.get("utility_state", {}) if isinstance(doc, dict) and isinstance(doc.get("utility_state", {}), dict) else {}
        bucket_scores = utility_state.get("bucket_scores", {}) if isinstance(utility_state.get("bucket_scores", {}), dict) else {}
        for bucket, scores in bucket_scores.items():
            if not isinstance(scores, dict):
                continue
            bucket_entry = bucket_rollups.setdefault(bucket, {"exact_scores": {}, "alias_scores": {}})
            exact_scores = bucket_entry.setdefault("exact_scores", {})
            alias_scores = bucket_entry.setdefault("alias_scores", {})
            for key, item in scores.items():
                if not isinstance(item, dict):
                    continue
                text = _clean_text(item.get("text") or key)
                if not text:
                    continue
                exact_key = str(key)
                rollup = exact_scores.setdefault(exact_key, {
                    "text": text,
                    "bucket": bucket,
                    "score": 0.0,
                    "evidence_count": 0,
                    "session_keys": set(),
                    "session_max_evidence": {},
                    "last_seen_at": "",
                    "alias_key": _rollup_alias_key(bucket, text),
                })
                rollup["score"] = max(_coerce_float(rollup.get("score"), 0.0), _coerce_float(item.get("score"), 0.0))
                per_session = rollup.setdefault("session_max_evidence", {})
                if source_session_key:
                    per_session[source_session_key] = max(int(per_session.get(source_session_key, 0) or 0), int(item.get("evidence_count", 0) or 0))
                    rollup["session_keys"].add(source_session_key)
                rollup["last_seen_at"] = max(str(rollup.get("last_seen_at") or ""), str(item.get("last_seen_at") or row.get("generated_at") or ""))

    for bucket, bucket_entry in bucket_rollups.items():
        exact_scores = bucket_entry.get("exact_scores", {}) if isinstance(bucket_entry.get("exact_scores", {}), dict) else {}
        alias_scores: Dict[str, Dict[str, Any]] = {}
        for item in exact_scores.values():
            if not isinstance(item, dict):
                continue
            item["session_keys"] = sorted(item.get("session_keys", set()))
            item["global_session_count"] = len(item["session_keys"])
            item["global_evidence_count"] = int(sum((item.get("session_max_evidence") or {}).values()))
            age_hours = _hours_since(item.get("last_seen_at"), reference_at=reference_at)
            item["age_hours"] = age_hours
            item["freshness"] = _freshness_band(age_hours)
            item["rollup_confidence"] = _confidence_score(item.get("score"), item.get("global_evidence_count"), age_hours)
            item.pop("session_max_evidence", None)

            alias_key = str(item.get("alias_key") or "")
            if not alias_key:
                continue
            alias = alias_scores.setdefault(alias_key, {
                "text": item.get("text", ""),
                "bucket": bucket,
                "score": 0.0,
                "global_evidence_count": 0,
                "session_keys": set(),
                "last_seen_at": "",
                "alias_key": alias_key,
                "member_texts": [],
            })
            alias["score"] = max(_coerce_float(alias.get("score"), 0.0), _coerce_float(item.get("score"), 0.0))
            alias["global_evidence_count"] = max(int(alias.get("global_evidence_count", 0) or 0), int(item.get("global_evidence_count", 0) or 0))
            alias["last_seen_at"] = max(str(alias.get("last_seen_at") or ""), str(item.get("last_seen_at") or ""))
            alias["member_texts"].append(str(item.get("text") or ""))
            for session in item.get("session_keys", []):
                alias["session_keys"].add(session)

        for alias in alias_scores.values():
            alias["session_keys"] = sorted(alias.get("session_keys", set()))
            alias["global_session_count"] = len(alias["session_keys"])
            age_hours = _hours_since(alias.get("last_seen_at"), reference_at=reference_at)
            alias["age_hours"] = age_hours
            alias["freshness"] = _freshness_band(age_hours)
            alias["rollup_confidence"] = _confidence_score(alias.get("score"), alias.get("global_evidence_count"), age_hours)
            alias["member_texts"] = sorted({text for text in alias.get("member_texts", []) if text})

        bucket_entry["alias_scores"] = alias_scores

    return {
        "version": "cortex.codec.rollup.v1",
        "policy": _codec_rollup_policy(),
        "bucket_scores": bucket_rollups,
        "summary": {
            "bucket_count": len(bucket_rollups),
            "item_count": sum(len((scores.get("exact_scores", {}) if isinstance(scores, dict) else {})) for scores in bucket_rollups.values()),
            "alias_count": sum(len((scores.get("alias_scores", {}) if isinstance(scores, dict) else {})) for scores in bucket_rollups.values()),
            "source_snapshot_count": len(seen_fingerprints),
            "source_session_count": len({session for scores in bucket_rollups.values() for item in (scores.get("exact_scores", {}) if isinstance(scores, dict) else {}).values() for session in item.get("session_keys", [])}),
            "session_key": session_key,
        },
    }



def _enrich_codec_state_with_rollups(session_key: str, state: Dict[str, Any], *, limit: int = 200, query: str = "") -> Dict[str, Any]:
    if not session_key or not isinstance(state, dict) or not state:
        return state

    # Source state is what is cached and persisted; projections are rebuilt on read.
    if isinstance(state.get("utility_state"), dict):
        state["utility_state"]["summary"] = _utility_summary(state["utility_state"].get("bucket_scores", {}))
    state["promotion_state"] = _build_promotion_state(state)
    state["schema_state"] = _export_schema_state(state)
    state["memory_facts"] = build_codec_memory_facts(session_key=session_key, codec_state=state)
    if not CODEC_DURABLE_ENABLED:
        return state

    # A Codec packet is principal-session state. Cross-session rollups used to
    # merge every durable Codec row and could project another caller's facts
    # into this read. Keep the rollup machinery for compatibility, but feed it
    # only exact-session snapshots selected by the server-derived key.
    rows = _fetch_codec_rows_from_l22(session_key, limit=limit)
    rollup_state = _build_codec_rollup_from_rows(rows, session_key=session_key, reference_at=str(state.get("generated_at") or ""))
    bucket_rollups = rollup_state.get("bucket_scores", {}) if isinstance(rollup_state.get("bucket_scores", {}), dict) else {}
    utility_state = state.get("utility_state", {}) if isinstance(state.get("utility_state", {}), dict) else {}
    bucket_scores = utility_state.get("bucket_scores", {}) if isinstance(utility_state.get("bucket_scores", {}), dict) else {}

    matched_count = 0
    alias_matched_count = 0
    overlap_matched_count = 0
    for bucket, scores in bucket_scores.items():
        if not isinstance(scores, dict):
            continue
        rollup_bucket = bucket_rollups.get(bucket, {}) if isinstance(bucket_rollups.get(bucket, {}), dict) else {}
        for key, item in scores.items():
            if not isinstance(item, dict):
                continue
            rollup = _find_rollup_match(bucket, item, rollup_bucket)
            if not rollup:
                continue
            matched_count += 1
            match_type = str(rollup.get("match_type") or "exact")
            if match_type == "alias":
                alias_matched_count += 1
            elif match_type == "overlap":
                overlap_matched_count += 1
            session_keys = rollup.get("session_keys", []) if isinstance(rollup.get("session_keys", []), list) else []
            cross_session_count = len([value for value in session_keys if value and value != session_key])
            item["global_evidence_count"] = int(rollup.get("global_evidence_count", 0) or 0)
            item["global_session_count"] = int(rollup.get("global_session_count", 0) or 0)
            item["cross_session_count"] = cross_session_count
            item["rollup_confidence"] = round(_coerce_float(rollup.get("rollup_confidence"), 0.0), 3)
            item["rollup_last_seen_at"] = str(rollup.get("last_seen_at") or "")
            item["rollup_freshness"] = str(rollup.get("freshness") or "")
            item["rollup_match_type"] = match_type
            if rollup.get("member_texts"):
                item["rollup_alias_members"] = list(rollup.get("member_texts") or [])[:5]

    state["rollup_state"] = {
        **rollup_state,
        "policy": _codec_rollup_policy(query=query),
        "summary": {
            **(rollup_state.get("summary", {}) if isinstance(rollup_state.get("summary", {}), dict) else {}),
            "matched_item_count": matched_count,
            "alias_matched_item_count": alias_matched_count,
            "overlap_matched_item_count": overlap_matched_count,
        },
    }
    if isinstance(state.get("utility_state"), dict):
        state["utility_state"]["summary"] = _utility_summary(state["utility_state"].get("bucket_scores", {}))
    state["promotion_state"] = _build_promotion_state(state)
    state["schema_state"] = _export_schema_state(state)
    state["memory_facts"] = build_codec_memory_facts(session_key=session_key, codec_state=state)
    return state



def _load_codec_state_from_l22(session_key: str) -> Dict[str, Any]:
    candidates = _fetch_codec_rows_from_l22(session_key, limit=25)
    if not candidates:
        return {}

    top = candidates[0]
    meta = top.get("metadata") if isinstance(top.get("metadata"), dict) else {}
    doc = top.get("document")
    try:
        state = json.loads(doc)
    except Exception:
        return {}
    if not isinstance(state, dict):
        return {}
    state = _compact_codec_state(_migrate_codec_state(state))
    persist = {
        "fingerprint": str(meta.get("codec_fingerprint") or _state_fingerprint(state)),
        "stored_id": str(top.get("id") or meta.get("codec_store_id") or ""),
        "loaded_from_l22": True,
        "generated_at": str(meta.get("codec_generated_at") or state.get("generated_at") or ""),
    }
    _cache_codec_state(session_key, state, persist)
    return copy.deepcopy(state)


def get_codec_state(session_key: str) -> Dict[str, Any]:
    if not session_key:
        return {}
    with _SESSION_CODEC_LOCK:
        current = copy.deepcopy(_SESSION_CODEC_STATE.get(session_key)) if isinstance(_SESSION_CODEC_STATE.get(session_key), dict) else None
    if isinstance(current, dict):
        migrated = _compact_codec_state(_migrate_codec_state(current))
        _cache_codec_state(session_key, migrated)
        return _enrich_codec_state_with_rollups(session_key, copy.deepcopy(migrated))
    hydrated = _load_codec_state_from_l22(session_key)
    if isinstance(hydrated, dict) and hydrated:
        return _enrich_codec_state_with_rollups(session_key, copy.deepcopy(hydrated))
    return {}



def _codec_retention_priority_from_row(row: Dict[str, Any]) -> float:
    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    if meta:
        direct = meta.get("codec_retention_priority")
        if direct is not None:
            return _coerce_float(direct, 0.0)
    try:
        doc = json.loads(row.get("document") or "{}")
    except Exception:
        doc = {}
    utility_summary = doc.get("utility_state", {}).get("summary", {}) if isinstance(doc, dict) else {}
    return _coerce_float(utility_summary.get("retention_priority"), 0.0)



def _prune_codec_snapshots_in_l22(session_key: str, *, keep_fingerprint: str = "") -> Dict[str, Any]:
    rows = _fetch_codec_rows_from_l22(session_key, limit=200)
    if not rows:
        return {"status": "noop", "deleted": 0, "kept": 0, "policy": _codec_retention_policy()}

    policy = _codec_retention_policy()
    protected = {str(keep_fingerprint or "")} if keep_fingerprint else set()
    deduped: List[Dict[str, Any]] = []
    seen_fingerprints = set()
    for row in rows:
        fingerprint = str(row.get("fingerprint") or "")
        row_id = row.get("id")
        if not row_id:
            continue
        if fingerprint and fingerprint in seen_fingerprints:
            continue
        deduped.append({
            **row,
            "retention_priority": _codec_retention_priority_from_row(row),
            "protected": fingerprint in protected,
        })
        if fingerprint:
            seen_fingerprints.add(fingerprint)

    deduped.sort(
        key=lambda row: (
            1 if row.get("protected") else 0,
            _coerce_float(row.get("retention_priority"), 0.0),
            str(row.get("generated_at") or ""),
        ),
        reverse=True,
    )

    keep_limit = int(policy.get("max_snapshots", 1) or 1)
    overflow_limit = int(policy.get("max_priority_overflow", 0) or 0)
    min_priority = _coerce_float(policy.get("min_priority_to_preserve"), 0.0)

    keep_rows = deduped[:keep_limit]
    keep_fingerprints = {str(row.get("fingerprint") or "") for row in keep_rows if row.get("fingerprint")}
    if protected - keep_fingerprints:
        for row in deduped[keep_limit:]:
            fingerprint = str(row.get("fingerprint") or "")
            if fingerprint in protected:
                keep_rows.append(row)
                keep_fingerprints.add(fingerprint)

    overflow_rows: List[Dict[str, Any]] = []
    if overflow_limit > 0:
        for row in deduped[keep_limit:]:
            fingerprint = str(row.get("fingerprint") or "")
            if fingerprint in keep_fingerprints:
                continue
            if _coerce_float(row.get("retention_priority"), 0.0) < min_priority:
                continue
            overflow_rows.append(row)
            keep_fingerprints.add(fingerprint)
            if len(overflow_rows) >= overflow_limit:
                break

    keep_rows.extend(overflow_rows)
    keep_ids = {str(row.get("id")) for row in keep_rows if row.get("id")}
    delete_ids = [str(row.get("id")) for row in rows if row.get("id") and str(row.get("id")) not in keep_ids]
    if not delete_ids:
        return {
            "status": "noop",
            "deleted": 0,
            "kept": len(keep_ids),
            "kept_fingerprints": sorted(keep_fingerprints),
            "overflow_kept": len(overflow_rows),
            "policy": policy,
        }

    try:
        from cortex_server.routers.l22 import delete_structured_memory_records
        delete_structured_memory_records(delete_ids)
    except ImportError:
        try:
            from cortex_server.routers.librarian import collection
            collection.delete(ids=delete_ids)
        except Exception as exc:
            return {"status": "delete_failed", "deleted": 0, "kept": len(keep_ids), "error": str(exc), "policy": policy}
    except Exception as exc:
        return {"status": "delete_failed", "deleted": 0, "kept": len(keep_ids), "error": str(exc), "policy": policy}

    return {
        "status": "pruned",
        "deleted": len(delete_ids),
        "kept": len(keep_ids),
        "deleted_ids": delete_ids,
        "kept_fingerprints": sorted(keep_fingerprints),
        "overflow_kept": len(overflow_rows),
        "policy": policy,
    }



def _persist_codec_state_to_l22(session_key: str, state: Dict[str, Any]) -> Dict[str, Any]:
    if not session_key or not CODEC_DURABLE_ENABLED or not isinstance(state, dict) or not state:
        return {"status": "skipped"}

    persisted_state = _compact_codec_state(state)
    fingerprint = _state_fingerprint(persisted_state)
    with _SESSION_CODEC_LOCK:
        prior = _SESSION_CODEC_PERSIST.get(session_key) if isinstance(_SESSION_CODEC_PERSIST.get(session_key), dict) else {}
        if str(prior.get("fingerprint") or "") == fingerprint:
            return {
                "status": "unchanged",
                "fingerprint": fingerprint,
                "stored_id": prior.get("stored_id"),
            }

    try:
        # Resolve through importlib so isolated tests and compatibility runtimes can
        # supply an L22 module without depending on a stale package attribute.
        l22_router = importlib.import_module("cortex_server.routers.l22")

        content = json.dumps(persisted_state, ensure_ascii=False, sort_keys=True)
        utility_summary = persisted_state.get("utility_state", {}).get("summary", {}) if isinstance(persisted_state.get("utility_state", {}), dict) else {}
        top_items = utility_summary.get("top_items", []) if isinstance(utility_summary.get("top_items", []), list) else []
        metadata = {
            "type": "codec_state",
            "codec_session_key": session_key,
            "codec_version": persisted_state.get("version", CODEC_VERSION),
            "codec_generated_at": persisted_state.get("generated_at", _now_iso()),
            "codec_summary": persisted_state.get("summary", ""),
            "codec_fingerprint": fingerprint,
            "codec_source_event_count": int(persisted_state.get("source_event_count", 0) or 0),
            "codec_retention_priority": round(_coerce_float(utility_summary.get("retention_priority"), 0.0), 3),
            "codec_utility_item_count": int(utility_summary.get("item_count", 0) or 0),
            "codec_top_utility_score": round(max([_coerce_float(item.get("score"), 0.0) for item in top_items] or [0.0]), 3),
        }
        store_record = getattr(l22_router, "store_structured_memory_record", l22_router.store_memory_record)
        result = store_record(
            content=content,
            memory_type="codec_state",
            tags=["cortex_codec", "codec_state", "durable_memory"],
            metadata=metadata,
        )
    except Exception as exc:
        return {"status": "write_failed", "error": str(exc), "fingerprint": fingerprint}

    prune = _prune_codec_snapshots_in_l22(session_key, keep_fingerprint=fingerprint)

    persist = {
        "fingerprint": fingerprint,
        "stored_id": result.get("id"),
        "loaded_from_l22": False,
        "generated_at": persisted_state.get("generated_at", ""),
        "retention": prune,
    }
    _cache_codec_state(session_key, persisted_state, persist)

    return {
        "status": result.get("status", "stored"),
        "id": result.get("id"),
        "fingerprint": fingerprint,
        "metadata": result.get("metadata", {}),
        "retention": prune,
    }


def update_codec_state_for_session(
    session_key: str,
    events: List[Dict[str, Any]],
    *,
    max_items_per_bucket: int = 8,
) -> Dict[str, Any]:
    if not session_key:
        return build_codec_state(events, previous_state={}, max_items_per_bucket=max_items_per_bucket)

    previous = _compact_codec_state(get_codec_state(session_key))
    updated = _compact_codec_state(build_codec_state(events, previous_state=previous, max_items_per_bucket=max_items_per_bucket))
    _cache_codec_state(session_key, updated)
    persist = _persist_codec_state_to_l22(session_key, updated)
    result = copy.deepcopy(updated)
    result["durable_write"] = persist
    return result


def apply_codec_outcome_feedback_for_session(
    session_key: str,
    outcome_event: Dict[str, Any],
    *,
    max_items_per_bucket: int = 8,
) -> Dict[str, Any]:
    if not session_key:
        return {}

    previous = _compact_codec_state(get_codec_state(session_key))
    updated = _compact_codec_state(apply_codec_outcome_feedback(previous, outcome_event, max_items_per_bucket=max_items_per_bucket))
    _cache_codec_state(session_key, updated)
    persist = _persist_codec_state_to_l22(session_key, updated)
    result = copy.deepcopy(updated)
    result["durable_write"] = persist
    return result


def get_codec_packet_for_session(session_key: str, *, max_chars: int = 1200, query: str = "") -> Dict[str, Any]:
    state = get_codec_state(session_key)
    if state and query:
        state = _enrich_codec_state_with_rollups(session_key, json.loads(json.dumps(state)), query=query)
    if state:
        state = json.loads(json.dumps(state))
        state["memory_facts"] = build_codec_memory_facts(session_key=session_key, codec_state=state)
    packet = compress_codec_for_prompt(state, max_chars=max_chars) if state else ""
    with _SESSION_CODEC_LOCK:
        persist = dict(_SESSION_CODEC_PERSIST.get(session_key) or {}) if session_key else {}
    return {
        "available": bool(packet),
        "session_key": session_key,
        "packet": packet,
        "summary": state.get("summary", "") if isinstance(state, dict) else "",
        "state": state,
        "max_chars": max_chars,
        "durable": persist,
    }



def get_codec_debug_view(session_key: str, *, max_chars: int = 1200, history_limit: int = 8, query: str = "") -> Dict[str, Any]:
    packet = get_codec_packet_for_session(session_key, max_chars=max_chars, query=query)
    state = packet.get("state") if isinstance(packet.get("state"), dict) else {}
    compression = state.get("compression") if isinstance(state.get("compression"), dict) else {}
    raw_characters = int(compression.get("raw_characters", 0) or 0)
    prompt_characters = int(compression.get("prompt_characters", len(packet.get("packet", "")) or 0) or 0)
    saved_characters = max(0, raw_characters - prompt_characters)
    rows = _fetch_codec_rows_from_l22(session_key, limit=max(1, min(int(history_limit), 50))) if session_key else []
    recent = []
    for row in rows[: max(1, min(int(history_limit), 50))]:
        meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        row_state = {}
        row_packet_chars = 0
        row_raw_chars = 0
        try:
            row_state = json.loads(row.get("document") or "{}")
            if isinstance(row_state, dict):
                row_packet_chars = len(compress_codec_for_prompt(row_state, max_chars=max_chars))
                row_raw_chars = int(((row_state.get("compression") or {}).get("raw_characters", 0) if isinstance(row_state.get("compression"), dict) else 0) or 0)
        except Exception:
            row_state = {}
        recent.append({
            "id": row.get("id"),
            "generated_at": row.get("generated_at"),
            "fingerprint": row.get("fingerprint"),
            "summary": meta.get("codec_summary", ""),
            "source_event_count": meta.get("codec_source_event_count"),
            "retention_priority": _coerce_float(meta.get("codec_retention_priority"), 0.0),
            "packet_chars": row_packet_chars,
            "raw_characters": row_raw_chars,
        })

    durable = packet.get("durable") if isinstance(packet.get("durable"), dict) else {}
    return {
        "enabled": True,
        "durable_enabled": bool(CODEC_DURABLE_ENABLED),
        "session_key": session_key,
        "available": bool(packet.get("available")),
        "summary": packet.get("summary", ""),
        "packet": packet.get("packet", ""),
        "packet_chars": len(packet.get("packet", "")) if isinstance(packet.get("packet"), str) else 0,
        "state_fingerprint": _state_fingerprint(state) if state else "",
        "in_memory": bool(session_key and isinstance(_SESSION_CODEC_STATE.get(session_key), dict)),
        "loaded_from_l22": bool(durable.get("loaded_from_l22")),
        "source_event_count": int(state.get("source_event_count", 0) or 0) if state else 0,
        "compression": {
            "raw_characters": raw_characters,
            "prompt_characters": prompt_characters,
            "saved_characters": saved_characters,
            "compression_ratio": compression.get("ratio", round(raw_characters / max(1, prompt_characters), 3) if raw_characters else 0.0),
            "max_chars": max_chars,
        },
        "schema_version": state.get("schema_version", CODEC_SCHEMA_VERSION) if isinstance(state, dict) else CODEC_SCHEMA_VERSION,
        "schema": state.get("schema_state", {}) if isinstance(state, dict) else {},
        "rollups": state.get("rollup_state", {}) if isinstance(state.get("rollup_state", {}), dict) else {},
        "promotion": state.get("promotion_state", {}) if isinstance(state.get("promotion_state", {}), dict) else {},
        "memory_facts": state.get("memory_facts", []) if isinstance(state.get("memory_facts", []), list) else [],
        "source_refs": state.get("source_refs", []) if isinstance(state.get("source_refs", []), list) else [],
        "utility": state.get("utility_state", {}).get("summary", {}) if isinstance(state.get("utility_state", {}), dict) else {},
        "retention_policy": state.get("utility_state", {}).get("retention_policy", _codec_retention_policy()) if isinstance(state.get("utility_state", {}), dict) else _codec_retention_policy(),
        "revisions": {
            "fact_revision_count": int(state.get("world_state", {}).get("fact_revision_count", 0) or 0) if isinstance(state.get("world_state", {}), dict) else 0,
            "lesson_revision_count": int(state.get("failure_state", {}).get("lesson_revision_count", 0) or 0) if isinstance(state.get("failure_state", {}), dict) else 0,
            "recent_fact_revisions": (state.get("world_state", {}).get("fact_revisions", []) if isinstance(state.get("world_state", {}), dict) else [])[-3:],
            "recent_lesson_revisions": (state.get("failure_state", {}).get("lesson_revisions", []) if isinstance(state.get("failure_state", {}), dict) else [])[-3:],
        },
        "durable": durable,
        "persisted_snapshots": {
            "count": len(rows),
            "recent": recent,
        },
    }
