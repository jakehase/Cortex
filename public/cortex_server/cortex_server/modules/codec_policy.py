from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import threading
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, Optional


_SESSION_TURN_LOCK = threading.Lock()
_SESSION_LAST_TURN: Dict[str, Dict[str, Any]] = {}

from cortex_server.modules.latency_budget_governor import classify_task_archetype


_LOCK = threading.RLock()
_TRANSACTION_LOCAL = threading.local()
_STATE_PATH = Path(os.getenv("CODEC_POLICY_STATE_PATH", "/opt/clawdbot/state/cortex_codec_policy.json"))
_VARIANTS = ("query_only", "referents_only", "referents_plus_codec")
PASSIVE_SIGNAL_MIN_CONFIDENCE = float(os.getenv("CODEC_PASSIVE_MIN_CONFIDENCE", "0.6"))
PASSIVE_TURN_MAX_AGE_SECONDS = int(os.getenv("CODEC_PASSIVE_MAX_AGE_SECONDS", "900"))
PASSIVE_CONTEXT_BONUS_MAX = float(os.getenv("CODEC_PASSIVE_CONTEXT_BONUS_MAX", "0.22"))
PASSIVE_SEMANTIC_BONUS_MAX = float(os.getenv("CODEC_PASSIVE_SEMANTIC_BONUS_MAX", "0.18"))
AUTOTUNE_MIN_RUNS = int(os.getenv("CODEC_AUTOTUNE_MIN_RUNS", "3"))
AUTOTUNE_MAX_ROLLOUT_DELTA = int(os.getenv("CODEC_AUTOTUNE_MAX_ROLLOUT_DELTA", "25"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None



def _age_seconds(value: Optional[str]) -> Optional[int]:
    dt = _parse_iso(value)
    if dt is None:
        return None
    now = datetime.now(timezone.utc)
    try:
        return max(0, int((now - dt).total_seconds()))
    except Exception:
        return None



def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, float(value)))



def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9_]{3,}", (text or "").lower()))



def _token_overlap(a: str, b: str) -> float:
    ta = _tokenize(a)
    tb = _tokenize(b)
    if not ta or not tb:
        return 0.0
    return round(len(ta.intersection(tb)) / max(1, len(ta)), 3)



def _char_ngrams(text: str, n: int = 3) -> set[str]:
    raw = re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()
    if len(raw) < n:
        return {raw} if raw else set()
    return {raw[i:i+n] for i in range(0, max(1, len(raw) - n + 1))}



def _ngram_similarity(a: str, b: str, n: int = 3) -> float:
    na = _char_ngrams(a, n=n)
    nb = _char_ngrams(b, n=n)
    if not na or not nb:
        return 0.0
    return round(len(na.intersection(nb)) / max(1, len(na.union(nb))), 3)



def _semantic_similarity(a: str, b: str) -> float:
    token = _token_overlap(a, b)
    ngram = _ngram_similarity(a, b, n=3)
    return round((0.58 * token) + (0.42 * ngram), 3)


def _default_variant_row() -> Dict[str, Any]:
    return {
        "wins": 0,
        "weighted_wins": 0.0,
        "last_win_at": "",
        "outcome_events": 0,
        "weighted_outcome_events": 0.0,
        "success_events": 0,
        "correction_events": 0,
        "recovery_events": 0,
        "avg_reward": 0.0,
        "last_outcome_at": "",
    }


def _default_step_row() -> Dict[str, Any]:
    return {
        "exposures": 0,
        "weighted_exposures": 0.0,
        "reward_sum": 0.0,
        "avg_reward": 0.0,
        "success_events": 0,
        "recovery_events": 0,
        "last_seen_at": "",
    }



def _default_autotune_row() -> Dict[str, Any]:
    return {
        "runs": 0,
        "overall_passes": 0,
        "codec_wins": 0,
        "avg_judge_margin": 0.0,
        "avg_codec_margin": 0.0,
        "last_run_at": "",
        "last_reason": "collecting_evidence",
        "rollout_delta": 0,
        "action": "hold",
        "confidence": 0.0,
    }



def _default_archetype_row(archetype: str) -> Dict[str, Any]:
    return {
        "archetype": archetype,
        "evaluations": 0,
        "variants": {name: _default_variant_row() for name in _VARIANTS},
        "step_attribution": {},
        "recommendation": {
            "action": "neutral",
            "stage": "shadow",
            "preferred_variant": None,
            "confidence": 0.0,
            "rollout_percent": 0,
            "reason": "collecting_evidence",
            "updated_at": "",
        },
        "autotune": _default_autotune_row(),
        "last_winner": None,
        "last_judge_method": None,
    }


def _default_state() -> Dict[str, Any]:
    return {
        "version": "cortex.codec.policy.v1",
        "state_revision": 0,
        "enabled": True,
        "last_updated": "",
        "totals": {
            "evaluations": 0,
            "codec_wins": 0,
            "non_codec_wins": 0,
            "codec_weighted_wins": 0.0,
            "non_codec_weighted_wins": 0.0,
            "passive_feedback_recorded": 0,
            "passive_feedback_ignored": 0,
            "passive_verifier_used": 0,
            "passive_verifier_promoted": 0,
            "stale_turns": 0,
            "autotune_updates": 0,
        },
        "archetypes": {},
        "last_observation": None,
    }


def _load_state_unlocked() -> Dict[str, Any]:
    state = _default_state()
    try:
        if _STATE_PATH.exists():
            raw = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                state.update({k: v for k, v in raw.items() if k in state})
    except Exception:
        pass
    if not isinstance(state.get("archetypes"), dict):
        state["archetypes"] = {}
    state["state_revision"] = max(0, int(state.get("state_revision", 0) or 0))
    return state


@contextmanager
def _state_file_lock(*, exclusive: bool) -> Iterator[None]:
    _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    lock_path = _STATE_PATH.with_name(f"{_STATE_PATH.name}.lock")
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        yield
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def _atomic_save_state_unlocked(state: Dict[str, Any]) -> None:
    _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    last_updated = _now_iso()
    next_revision = max(0, int(state.get("state_revision", 0) or 0)) + 1
    persisted_state = {**state, "last_updated": last_updated, "state_revision": next_revision}
    payload = json.dumps(persisted_state, ensure_ascii=False, indent=2)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{_STATE_PATH.name}.",
        suffix=".tmp",
        dir=str(_STATE_PATH.parent),
    )
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            descriptor = -1
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, _STATE_PATH)
        directory_fd = os.open(_STATE_PATH.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        state["last_updated"] = last_updated
        state["state_revision"] = next_revision
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def load_state() -> Dict[str, Any]:
    with _LOCK:
        if bool(getattr(_TRANSACTION_LOCAL, "active", False)):
            return _load_state_unlocked()
        try:
            with _state_file_lock(exclusive=False):
                return _load_state_unlocked()
        except OSError:
            # Policy reads remain fail-soft when the configured state mount is
            # unavailable or read-only. Mutating transactions still surface a
            # persistence error instead of falsely acknowledging a write.
            return _load_state_unlocked()


def save_state(state: Dict[str, Any]) -> None:
    with _LOCK:
        if bool(getattr(_TRANSACTION_LOCAL, "active", False)):
            _atomic_save_state_unlocked(state)
            return
        with _state_file_lock(exclusive=True):
            _atomic_save_state_unlocked(state)


_DEFAULT_LOAD_STATE = load_state
_DEFAULT_SAVE_STATE = save_state


@contextmanager
def _state_transaction() -> Iterator[None]:
    with _LOCK:
        if bool(getattr(_TRANSACTION_LOCAL, "active", False)):
            yield
            return
        use_file_lock = load_state is _DEFAULT_LOAD_STATE and save_state is _DEFAULT_SAVE_STATE
        if use_file_lock:
            with _state_file_lock(exclusive=True):
                _TRANSACTION_LOCAL.active = True
                try:
                    yield
                finally:
                    _TRANSACTION_LOCAL.active = False
            return
        _TRANSACTION_LOCAL.active = True
        try:
            yield
        finally:
            _TRANSACTION_LOCAL.active = False


def _transactional_state_update(function: Callable[..., Dict[str, Any]]) -> Callable[..., Dict[str, Any]]:
    @wraps(function)
    def wrapped(*args: Any, **kwargs: Any) -> Dict[str, Any]:
        with _state_transaction():
            return function(*args, **kwargs)

    return wrapped


def _record_policy_total(total_name: str, *, last_observation: Optional[Dict[str, Any]] = None) -> None:
    with _state_transaction():
        state = load_state()
        totals = state.setdefault("totals", {})
        totals[total_name] = int(totals.get(total_name, 0) or 0) + 1
        if last_observation is not None:
            state["last_observation"] = last_observation
        save_state(state)


def _archetype_row(state: Dict[str, Any], archetype: str) -> Dict[str, Any]:
    row = state.setdefault("archetypes", {}).setdefault(archetype, _default_archetype_row(archetype))
    if not isinstance(row.get("variants"), dict):
        row["variants"] = {name: _default_variant_row() for name in _VARIANTS}
    for name in _VARIANTS:
        if not isinstance(row["variants"].get(name), dict):
            row["variants"][name] = _default_variant_row()
    if not isinstance(row.get("step_attribution"), dict):
        row["step_attribution"] = {}
    if not isinstance(row.get("recommendation"), dict):
        row["recommendation"] = {
            "action": "neutral",
            "stage": "shadow",
            "preferred_variant": None,
            "confidence": 0.0,
            "rollout_percent": 0,
            "reason": "collecting_evidence",
            "updated_at": "",
        }
    if not isinstance(row.get("autotune"), dict):
        row["autotune"] = _default_autotune_row()
    return row


def _recompute_autotune(row: Dict[str, Any]) -> Dict[str, Any]:
    auto = row.get("autotune") if isinstance(row.get("autotune"), dict) else _default_autotune_row()
    runs = int(auto.get("runs", 0) or 0)
    overall_passes = int(auto.get("overall_passes", 0) or 0)
    codec_wins = int(auto.get("codec_wins", 0) or 0)
    avg_judge_margin = float(auto.get("avg_judge_margin", 0.0) or 0.0)
    avg_codec_margin = float(auto.get("avg_codec_margin", 0.0) or 0.0)

    action = "hold"
    rollout_delta = 0
    reason = "collecting_evidence"
    confidence = 0.0

    if runs >= max(1, AUTOTUNE_MIN_RUNS):
        pass_rate = overall_passes / max(1, runs)
        codec_win_rate = codec_wins / max(1, runs)
        confidence = round(_clamp((0.45 * pass_rate) + (0.35 * codec_win_rate) + (0.20 * _clamp((avg_judge_margin + 0.12) / 0.24))), 3)
        if avg_codec_margin >= 0.08 and pass_rate >= 0.6:
            action = "increase_rollout"
            rollout_delta = min(AUTOTUNE_MAX_ROLLOUT_DELTA, max(5, int(round((avg_codec_margin + pass_rate) * 10))))
            reason = f"codec eval history positive ({avg_codec_margin:.3f} margin, {pass_rate:.2f} pass rate)"
        elif avg_codec_margin <= -0.08 or pass_rate < 0.4:
            action = "decrease_rollout"
            rollout_delta = -min(AUTOTUNE_MAX_ROLLOUT_DELTA, max(5, int(round((abs(avg_codec_margin) + (1.0 - pass_rate)) * 10))))
            reason = f"codec eval history weak ({avg_codec_margin:.3f} margin, {pass_rate:.2f} pass rate)"
        else:
            action = "hold"
            rollout_delta = 0
            reason = "mixed eval history"

    auto.update({
        "action": action,
        "rollout_delta": int(rollout_delta),
        "confidence": float(confidence),
        "last_reason": reason,
    })
    row["autotune"] = auto
    return auto



@_transactional_state_update
def observe_codec_eval_history(
    *,
    query: str,
    acceptance_gates: Dict[str, Any],
    winner: str = "",
    session_key: Optional[str] = None,
) -> Dict[str, Any]:
    archetype = classify_task_archetype(query)
    state = load_state()
    row = _archetype_row(state, archetype)
    auto = row.get("autotune") if isinstance(row.get("autotune"), dict) else _default_autotune_row()
    summary = (acceptance_gates.get("summary") or {}) if isinstance(acceptance_gates, dict) else {}
    runs = int(auto.get("runs", 0) or 0) + 1
    overall_passes = int(auto.get("overall_passes", 0) or 0) + (1 if bool(summary.get("overall_pass")) else 0)
    codec_wins = int(auto.get("codec_wins", 0) or 0) + (1 if winner == "referents_plus_codec" else 0)
    judge_margin = float((acceptance_gates.get("judge_margin") or 0.0) if isinstance(acceptance_gates, dict) else 0.0)
    codec_margin = float((acceptance_gates.get("codec_margin_vs_best_non_codec") or 0.0) if isinstance(acceptance_gates, dict) else 0.0)
    prev_runs = max(0, int(auto.get("runs", 0) or 0))
    auto.update({
        "runs": runs,
        "overall_passes": overall_passes,
        "codec_wins": codec_wins,
        "avg_judge_margin": round(((float(auto.get("avg_judge_margin", 0.0) or 0.0) * prev_runs) + judge_margin) / max(1, runs), 3),
        "avg_codec_margin": round(((float(auto.get("avg_codec_margin", 0.0) or 0.0) * prev_runs) + codec_margin) / max(1, runs), 3),
        "last_run_at": _now_iso(),
    })
    row["autotune"] = auto
    recommendation = _recompute_autotune(row)
    totals = state.setdefault("totals", {})
    totals["autotune_updates"] = int(totals.get("autotune_updates", 0) or 0) + 1
    state["last_observation"] = {
        "ts": _now_iso(),
        "query": (query or "")[:240],
        "session_key": (session_key or "")[:128] if session_key else None,
        "archetype": archetype,
        "source": "eval_history_autotune",
        "winner": winner,
        "overall_pass": bool(summary.get("overall_pass")),
        "judge_margin": round(judge_margin, 3),
        "codec_margin_vs_best_non_codec": round(codec_margin, 3),
        "autotune": recommendation,
    }
    save_state(state)
    return {
        "recorded": True,
        "archetype": archetype,
        "autotune": recommendation,
        "runs": runs,
    }



def _recompute_recommendation(row: Dict[str, Any]) -> Dict[str, Any]:
    evaluations = int(row.get("evaluations", 0) or 0)
    variants = row.get("variants") if isinstance(row.get("variants"), dict) else {}
    wins = {name: int((variants.get(name) or {}).get("wins", 0) or 0) for name in _VARIANTS}
    weighted_wins = {name: float((variants.get(name) or {}).get("weighted_wins", wins.get(name, 0)) or 0.0) for name in _VARIANTS}
    outcome_events = {name: int((variants.get(name) or {}).get("outcome_events", 0) or 0) for name in _VARIANTS}
    weighted_outcome_events = {name: float((variants.get(name) or {}).get("weighted_outcome_events", outcome_events.get(name, 0)) or 0.0) for name in _VARIANTS}
    avg_rewards = {name: float((variants.get(name) or {}).get("avg_reward", 0.0) or 0.0) for name in _VARIANTS}
    codec_wins = wins.get("referents_plus_codec", 0)
    non_codec_wins = wins.get("query_only", 0) + wins.get("referents_only", 0)
    codec_weighted = weighted_wins.get("referents_plus_codec", 0.0)
    non_codec_weighted = weighted_wins.get("query_only", 0.0) + weighted_wins.get("referents_only", 0.0)
    codec_outcomes = weighted_outcome_events.get("referents_plus_codec", 0.0)
    non_codec_outcomes = weighted_outcome_events.get("query_only", 0.0) + weighted_outcome_events.get("referents_only", 0.0)
    codec_reward = avg_rewards.get("referents_plus_codec", 0.0)
    non_codec_reward = (
        ((avg_rewards.get("query_only", 0.0) * weighted_outcome_events.get("query_only", 0.0)) + (avg_rewards.get("referents_only", 0.0) * weighted_outcome_events.get("referents_only", 0.0))) / max(1.0, non_codec_outcomes)
    ) if non_codec_outcomes else 0.0
    codec_signal = codec_weighted + (codec_reward * min(4, codec_outcomes))
    non_codec_signal = non_codec_weighted + (non_codec_reward * min(4, non_codec_outcomes))
    total_signal = max(1.0, codec_signal + non_codec_signal)
    preferred_variant = max(
        _VARIANTS,
        key=lambda name: ((weighted_wins.get(name, 0.0) + (avg_rewards.get(name, 0.0) * min(4.0, weighted_outcome_events.get(name, 0.0)))), wins.get(name, 0), name),
    ) if (evaluations > 0 or sum(outcome_events.values()) > 0) else None

    action = "neutral"
    stage = "shadow"
    reason = "collecting_evidence"
    confidence = 0.0
    rollout_percent = 0

    evidence_points = evaluations + sum(outcome_events.values())
    if evidence_points >= 3:
        evidence = _clamp(evidence_points / 12.0)
        margin = codec_signal - non_codec_signal
        confidence = round(_clamp((0.55 * evidence) + (0.45 * (abs(margin) / total_signal))), 3)
        if codec_signal >= 2.5 and margin >= 1.0:
            action = "prefer_codec"
            if evidence_points >= 8 and margin >= 2.5:
                stage = "active_rollout"
                rollout_percent = 100
            elif evidence_points >= 5 and margin >= 1.5:
                stage = "bounded_rollout"
                rollout_percent = 50
            else:
                stage = "recommend"
                rollout_percent = 25
            reason = f"codec signal winning for this archetype ({codec_signal:.2f} vs {non_codec_signal:.2f})"
        elif non_codec_signal >= 2.5 and margin <= -1.0:
            action = "skip_codec"
            if evidence_points >= 8 and margin <= -2.5:
                stage = "active_rollout"
                rollout_percent = 100
            elif evidence_points >= 5 and margin <= -1.5:
                stage = "bounded_rollout"
                rollout_percent = 50
            else:
                stage = "recommend"
                rollout_percent = 25
            reason = f"non-codec signal winning for this archetype ({non_codec_signal:.2f} vs {codec_signal:.2f})"
        else:
            action = "neutral"
            stage = "shadow"
            reason = "no clear codec advantage yet"

    recommendation = {
        "action": action,
        "stage": stage,
        "preferred_variant": preferred_variant,
        "confidence": confidence,
        "rollout_percent": rollout_percent,
        "reason": reason,
        "updated_at": _now_iso(),
        "wins": wins,
        "weighted_wins": {k: round(v, 3) for k, v in weighted_wins.items()},
        "outcome_events": outcome_events,
        "weighted_outcome_events": {k: round(v, 3) for k, v in weighted_outcome_events.items()},
        "avg_rewards": {k: round(v, 3) for k, v in avg_rewards.items()},
        "signals": {
            "codec": round(codec_signal, 3),
            "non_codec": round(non_codec_signal, 3),
        },
    }
    row["recommendation"] = recommendation
    return recommendation


@_transactional_state_update
def observe_codec_evaluation(
    *,
    query: str,
    winner: str,
    judge_method: str = "heuristic",
    session_key: Optional[str] = None,
    judge_confidence: Optional[float] = None,
) -> Dict[str, Any]:
    if winner not in _VARIANTS:
        return {"recorded": False, "reason": "unknown_winner"}

    archetype = classify_task_archetype(query)
    state = load_state()
    row = _archetype_row(state, archetype)
    row["evaluations"] = int(row.get("evaluations", 0)) + 1
    row["last_winner"] = winner
    row["last_judge_method"] = judge_method
    row["variants"][winner]["wins"] = int(row["variants"][winner].get("wins", 0)) + 1
    base_weight = 1.15 if judge_method == "oracle_judge" else 1.0
    conf_weight = 0.85 + (0.5 * _clamp(judge_confidence if judge_confidence is not None else 0.5, 0.0, 1.0))
    weight = round(base_weight * conf_weight, 3)
    row["variants"][winner]["weighted_wins"] = round(float(row["variants"][winner].get("weighted_wins", 0.0) or 0.0) + weight, 3)
    row["variants"][winner]["last_win_at"] = _now_iso()
    recommendation = _recompute_recommendation(row)

    totals = state.setdefault("totals", {})
    totals["evaluations"] = int(totals.get("evaluations", 0)) + 1
    if winner == "referents_plus_codec":
        totals["codec_wins"] = int(totals.get("codec_wins", 0)) + 1
        totals["codec_weighted_wins"] = round(float(totals.get("codec_weighted_wins", 0.0) or 0.0) + weight, 3)
    else:
        totals["non_codec_wins"] = int(totals.get("non_codec_wins", 0)) + 1
        totals["non_codec_weighted_wins"] = round(float(totals.get("non_codec_weighted_wins", 0.0) or 0.0) + weight, 3)

    state["last_observation"] = {
        "ts": _now_iso(),
        "query": (query or "")[:240],
        "session_key": (session_key or "")[:128] if session_key else None,
        "archetype": archetype,
        "winner": winner,
        "judge_method": judge_method,
        "judge_confidence": judge_confidence,
        "weight": weight,
    }
    save_state(state)
    return {
        "recorded": True,
        "archetype": archetype,
        "weight": weight,
        "recommendation": recommendation,
        "totals": totals,
    }


def _rollout_bucket(query: str) -> int:
    if not (query or "").strip():
        return 0
    return int(hashlib.sha256((query or "").encode("utf-8")).hexdigest(), 16) % 100



def _outcome_reward(*, execution_success: bool, user_correction: bool, recovery_needed: bool, validator_pass: bool) -> float:
    reward = 0.0
    reward += 0.5 if execution_success else 0.0
    reward += 0.3 if validator_pass else 0.0
    reward -= 0.2 if user_correction else 0.0
    reward -= 0.25 if recovery_needed else 0.0
    return round(_clamp(reward, 0.0, 1.0), 3)



def infer_served_variant(*, codec_applied: bool, referents_applied: bool) -> str:
    if codec_applied:
        return "referents_plus_codec"
    if referents_applied:
        return "referents_only"
    return "query_only"



def _passive_verifier_bonus(query: str, *, semantic_query_similarity: float, semantic_response_similarity: float, referential_bonus: float) -> Dict[str, Any]:
    q = (query or "").strip().lower()
    positive_verbs = {
        "solved": 0.26,
        "resolved": 0.24,
        "cleared": 0.2,
        "unblocked": 0.24,
        "stable": 0.18,
        "good now": 0.18,
    }
    negative_verbs = {
        "broken": 0.26,
        "failing": 0.24,
        "stuck": 0.2,
        "blocked": 0.22,
        "bad": 0.16,
        "issue": 0.12,
    }
    positive_hits = [marker for marker in positive_verbs if marker in q]
    negative_hits = [marker for marker in negative_verbs if marker in q]
    semantic_strength = max(semantic_query_similarity, semantic_response_similarity)
    if semantic_strength < 0.18:
        return {"success_bonus": 0.0, "correction_bonus": 0.0, "positive_hits": [], "negative_hits": []}

    success_bonus = 0.0
    correction_bonus = 0.0
    if positive_hits:
        success_bonus = max([positive_verbs[m] for m in positive_hits], default=0.0) + (0.35 * semantic_strength) + referential_bonus
        if semantic_strength >= 0.35:
            success_bonus = max(success_bonus, 0.45)
    if negative_hits:
        correction_bonus = max([negative_verbs[m] for m in negative_hits], default=0.0) + (0.35 * semantic_strength) + referential_bonus
        if semantic_strength >= 0.35:
            correction_bonus = max(correction_bonus, 0.45)
    return {
        "success_bonus": round(min(0.5, success_bonus), 3),
        "correction_bonus": round(min(0.5, correction_bonus), 3),
        "positive_hits": positive_hits,
        "negative_hits": negative_hits,
    }



def _passive_signal(query: str, *, prior_query: str = "", prior_response: str = "") -> Dict[str, Any]:
    q = (query or "").strip().lower()
    success_markers = {
        "that worked": 0.95,
        "it worked": 0.9,
        "works now": 0.9,
        "fixed it": 0.94,
        "that fixed it": 0.96,
        "perfect": 0.72,
        "exactly": 0.72,
        "thanks": 0.52,
        "thank you": 0.52,
        "nice": 0.48,
        "great": 0.48,
        "awesome": 0.48,
    }
    completion_markers = {
        "tests pass": 0.96,
        "tests passed": 0.96,
        "deploy works": 0.94,
        "site works": 0.94,
        "build passed": 0.94,
        "resolved": 0.86,
        "green now": 0.88,
        "working now": 0.9,
    }
    correction_markers = {
        "actually": 0.62,
        "correction": 0.82,
        "that's wrong": 0.94,
        "that was wrong": 0.94,
        "wrong": 0.76,
        "not what i asked": 0.94,
        "you forgot": 0.84,
        "missing": 0.66,
        "doesn't work": 0.94,
        "didn't work": 0.94,
        "not working": 0.92,
        "fix this": 0.88,
    }
    failure_markers = {
        "still broken": 0.97,
        "still failing": 0.97,
        "same issue": 0.9,
        "still not working": 0.96,
        "still wrong": 0.92,
        "error still": 0.88,
    }
    recovery_markers = {
        "retry": 0.78,
        "again": 0.58,
        "redo": 0.82,
        "recover": 0.82,
        "try again": 0.9,
        "re-run": 0.84,
        "rerun": 0.84,
    }

    success_hits = [marker for marker in success_markers if marker in q]
    completion_hits = [marker for marker in completion_markers if marker in q]
    correction_hits = [marker for marker in correction_markers if marker in q]
    failure_hits = [marker for marker in failure_markers if marker in q]
    recovery_hits = [marker for marker in recovery_markers if marker in q]

    success_conf = max([success_markers[m] for m in success_hits], default=0.0)
    completion_conf = max([completion_markers[m] for m in completion_hits], default=0.0)
    correction_conf = max([correction_markers[m] for m in correction_hits], default=0.0)
    failure_conf = max([failure_markers[m] for m in failure_hits], default=0.0)
    recovery_conf = max([recovery_markers[m] for m in recovery_hits], default=0.0)

    query_overlap = _token_overlap(q, prior_query)
    response_overlap = _token_overlap(q, prior_response)
    semantic_query_similarity = _semantic_similarity(q, prior_query)
    semantic_response_similarity = _semantic_similarity(q, prior_response)
    context_bonus = min(PASSIVE_CONTEXT_BONUS_MAX, (0.08 * query_overlap) + (0.14 * response_overlap))
    semantic_bonus = min(PASSIVE_SEMANTIC_BONUS_MAX, (0.10 * semantic_query_similarity) + (0.14 * semantic_response_similarity))
    referential_bonus = 0.06 if re.search(r"\b(that|it|this|those|them)\b", q) else 0.0
    verifier_bonus = _passive_verifier_bonus(
        q,
        semantic_query_similarity=semantic_query_similarity,
        semantic_response_similarity=semantic_response_similarity,
        referential_bonus=referential_bonus,
    )

    success_conf = min(1.0, max(success_conf, completion_conf) + context_bonus + semantic_bonus + verifier_bonus.get("success_bonus", 0.0))
    correction_conf = min(1.0, max(correction_conf, failure_conf) + context_bonus + semantic_bonus + verifier_bonus.get("correction_bonus", 0.0))
    recovery_conf = min(1.0, recovery_conf + (0.5 * context_bonus) + (0.5 * semantic_bonus) + (0.5 * referential_bonus))

    confidence = max(success_conf, correction_conf, recovery_conf)
    signal_type = "none"
    if confidence > 0.0:
        if max(correction_conf, recovery_conf) >= success_conf:
            signal_type = "correction"
        else:
            signal_type = "success"
    return {
        "signal_type": signal_type,
        "confidence": round(confidence, 3),
        "success": success_conf > max(correction_conf, recovery_conf) and success_conf >= PASSIVE_SIGNAL_MIN_CONFIDENCE,
        "correction": correction_conf >= PASSIVE_SIGNAL_MIN_CONFIDENCE,
        "recovery": recovery_conf >= PASSIVE_SIGNAL_MIN_CONFIDENCE,
        "success_hits": success_hits,
        "completion_hits": completion_hits,
        "correction_hits": correction_hits,
        "failure_hits": failure_hits,
        "recovery_hits": recovery_hits,
        "query_overlap": query_overlap,
        "response_overlap": response_overlap,
        "semantic_query_similarity": semantic_query_similarity,
        "semantic_response_similarity": semantic_response_similarity,
        "context_bonus": round(context_bonus, 3),
        "semantic_bonus": round(semantic_bonus, 3),
        "referential_bonus": round(referential_bonus, 3),
        "verifier_positive_hits": verifier_bonus.get("positive_hits", []),
        "verifier_negative_hits": verifier_bonus.get("negative_hits", []),
    }



def register_codec_session_turn(
    session_key: str,
    *,
    query: str,
    response: str = "",
    variant: str,
    codec_applied: bool,
    referents_applied: bool,
    lane: str = "",
) -> Dict[str, Any]:
    if not session_key or variant not in _VARIANTS or not (query or "").strip():
        return {"recorded": False, "reason": "invalid_session_turn"}
    with _SESSION_TURN_LOCK:
        _SESSION_LAST_TURN[session_key] = {
            "query": query,
            "query_hash": hashlib.sha256((query or "").encode("utf-8")).hexdigest()[:16],
            "response_excerpt": (response or "")[:480],
            "response_hash": hashlib.sha256((response or "").encode("utf-8")).hexdigest()[:16] if (response or "").strip() else "",
            "variant": variant,
            "codec_applied": bool(codec_applied),
            "referents_applied": bool(referents_applied),
            "lane": lane,
            "recorded_at": _now_iso(),
            "passive_feedback_recorded": False,
        }
    return {"recorded": True, "variant": variant, "session_key": session_key}



def observe_passive_codec_feedback(session_key: str, followup_query: str, verifier: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None) -> Dict[str, Any]:
    if not session_key or not (followup_query or "").strip():
        return {"recorded": False, "reason": "missing_session_or_query"}

    with _SESSION_TURN_LOCK:
        last_turn = dict(_SESSION_LAST_TURN.get(session_key) or {})
    if not last_turn:
        return {"recorded": False, "reason": "no_last_turn"}
    if bool(last_turn.get("passive_feedback_recorded")):
        return {"recorded": False, "reason": "already_recorded"}

    age_seconds = _age_seconds(last_turn.get("recorded_at"))
    if age_seconds is not None and age_seconds > max(30, PASSIVE_TURN_MAX_AGE_SECONDS):
        _record_policy_total("stale_turns", last_observation={
            "ts": _now_iso(),
            "session_key": session_key,
            "source": "passive_followup",
            "recorded": False,
            "reason": "stale_turn",
            "age_seconds": age_seconds,
            "variant": last_turn.get("variant"),
        })
        with _SESSION_TURN_LOCK:
            _SESSION_LAST_TURN.pop(session_key, None)
        return {"recorded": False, "reason": "stale_turn", "age_seconds": age_seconds}

    signal = _passive_signal(
        followup_query,
        prior_query=str(last_turn.get("query") or ""),
        prior_response=str(last_turn.get("response_excerpt") or ""),
    )
    verifier_result: Dict[str, Any] = {}
    should_try_verifier = (
        verifier is not None
        and float(signal.get("confidence", 0.0) or 0.0) < PASSIVE_SIGNAL_MIN_CONFIDENCE
        and float(signal.get("confidence", 0.0) or 0.0) >= 0.28
        and (
            float(signal.get("semantic_response_similarity", 0.0) or 0.0) >= 0.22
            or float(signal.get("semantic_query_similarity", 0.0) or 0.0) >= 0.22
            or bool(signal.get("verifier_positive_hits") or signal.get("verifier_negative_hits"))
            or bool(signal.get("completion_hits") or signal.get("failure_hits"))
        )
    )
    if should_try_verifier:
        _record_policy_total("passive_verifier_used")
        try:
            verifier_result = verifier({
                "session_key": session_key,
                "followup_query": followup_query,
                "prior_query": str(last_turn.get("query") or ""),
                "prior_response": str(last_turn.get("response_excerpt") or ""),
                "variant": str(last_turn.get("variant") or ""),
                "signal": signal,
            }) or {}
        except Exception as exc:
            verifier_result = {"decision": "none", "confidence": 0.0, "error": str(exc)[:160]}

        verifier_conf = _clamp(verifier_result.get("confidence", 0.0) or 0.0, 0.0, 1.0)
        verifier_decision = str(verifier_result.get("decision") or "none").strip().lower()
        if verifier_decision in {"success", "correction", "recovery"} and verifier_conf >= PASSIVE_SIGNAL_MIN_CONFIDENCE:
            signal = {
                **signal,
                "signal_type": "correction" if verifier_decision in {"correction", "recovery"} else "success",
                "confidence": round(max(float(signal.get("confidence", 0.0) or 0.0), verifier_conf), 3),
                "success": verifier_decision == "success",
                "correction": verifier_decision == "correction",
                "recovery": verifier_decision == "recovery",
                "verifier_model_decision": verifier_decision,
                "verifier_model_confidence": verifier_conf,
                "verifier_model_reason": verifier_result.get("reason"),
            }
            _record_policy_total("passive_verifier_promoted")

    if float(signal.get("confidence", 0.0) or 0.0) < PASSIVE_SIGNAL_MIN_CONFIDENCE:
        _record_policy_total("passive_feedback_ignored", last_observation={
            "ts": _now_iso(),
            "session_key": session_key,
            "source": "passive_followup",
            "recorded": False,
            "reason": "low_confidence_or_no_signal",
            "signal": signal,
            "verifier": verifier_result,
            "age_seconds": age_seconds,
            "variant": last_turn.get("variant"),
        })
        return {"recorded": False, "reason": "low_confidence_or_no_signal", "signal": signal, "verifier": verifier_result, "age_seconds": age_seconds}

    result = observe_codec_outcome(
        query=str(last_turn.get("query") or ""),
        policy_label=str(last_turn.get("variant") or ""),
        execution_success=bool(signal.get("success")) and not bool(signal.get("correction") or signal.get("recovery")),
        user_correction=bool(signal.get("correction")),
        recovery_needed=bool(signal.get("recovery")),
        validator_pass=bool(signal.get("success")) and not bool(signal.get("correction") or signal.get("recovery")),
        session_key=session_key,
        note=f"passive_followup:{(followup_query or '')[:180]}",
        outcome_confidence=float(signal.get("confidence", 0.0) or 0.0),
        source="passive_followup",
    )
    if result.get("recorded"):
        with _SESSION_TURN_LOCK:
            if session_key in _SESSION_LAST_TURN:
                _SESSION_LAST_TURN[session_key]["passive_feedback_recorded"] = True
                _SESSION_LAST_TURN[session_key]["last_passive_signal"] = signal
                _SESSION_LAST_TURN[session_key]["last_passive_recorded_at"] = _now_iso()
        result["passive"] = True
        result["signal"] = signal
        result["verifier"] = verifier_result
        result["age_seconds"] = age_seconds
    return result



def _normalize_step_key(name: str) -> str:
    raw = re.sub(r"[^a-z0-9:_\-/]+", "_", (name or "").strip().lower()).strip("_")
    return raw[:80]



def _apply_step_attribution(
    row: Dict[str, Any],
    *,
    step_attribution: Optional[Dict[str, float]],
    weighted_reward: float,
    execution_success: bool,
    recovery_needed: bool,
) -> None:
    if not isinstance(step_attribution, dict):
        return
    bucket = row.setdefault("step_attribution", {}) if isinstance(row, dict) else {}
    for raw_name, raw_weight in step_attribution.items():
        name = _normalize_step_key(str(raw_name or ""))
        if not name:
            continue
        try:
            weight = _clamp(float(raw_weight), 0.0, 1.0)
        except Exception:
            weight = 0.0
        if weight <= 0.0:
            continue
        step = bucket.setdefault(name, _default_step_row())
        step["exposures"] = int(step.get("exposures", 0) or 0) + 1
        step["weighted_exposures"] = round(float(step.get("weighted_exposures", 0.0) or 0.0) + weight, 3)
        step["reward_sum"] = round(float(step.get("reward_sum", 0.0) or 0.0) + (weighted_reward * weight), 3)
        denom = max(0.001, float(step.get("weighted_exposures", 0.0) or 0.0))
        step["avg_reward"] = round(float(step.get("reward_sum", 0.0) or 0.0) / denom, 3)
        step["success_events"] = int(step.get("success_events", 0) or 0) + (1 if execution_success else 0)
        step["recovery_events"] = int(step.get("recovery_events", 0) or 0) + (1 if recovery_needed else 0)
        step["last_seen_at"] = _now_iso()



def _step_attribution_summary(row: Dict[str, Any], *, limit: int = 5) -> Dict[str, Any]:
    bucket = row.get("step_attribution") if isinstance(row.get("step_attribution"), dict) else {}
    items = []
    for name, stats in bucket.items():
        if not isinstance(stats, dict):
            continue
        exposures = int(stats.get("exposures", 0) or 0)
        weighted_exposures = float(stats.get("weighted_exposures", 0.0) or 0.0)
        avg_reward = float(stats.get("avg_reward", 0.0) or 0.0)
        if exposures <= 0:
            continue
        score = round(avg_reward * min(2.0, weighted_exposures), 3)
        items.append({
            "name": name,
            "exposures": exposures,
            "weighted_exposures": round(weighted_exposures, 3),
            "avg_reward": round(avg_reward, 3),
            "success_events": int(stats.get("success_events", 0) or 0),
            "recovery_events": int(stats.get("recovery_events", 0) or 0),
            "score": score,
        })
    helpful = sorted(items, key=lambda x: (-x["score"], -x["weighted_exposures"], x["name"]))[:limit]
    risky = sorted(items, key=lambda x: (x["avg_reward"], -x["weighted_exposures"], x["name"]))[:limit]
    return {"helpful": helpful, "risky": risky}



def infer_codec_variant(policy_label: Optional[str] = None, *, query: str = "") -> Optional[str]:
    label = str(policy_label or "").strip().lower()
    mapping = {
        "codec": "referents_plus_codec",
        "codec_state": "referents_plus_codec",
        "referents_plus_codec": "referents_plus_codec",
        "codec_plus_referents": "referents_plus_codec",
        "referents_only": "referents_only",
        "referent_only": "referents_only",
        "query_only": "query_only",
        "baseline": "query_only",
        "no_codec": "query_only",
        "skip_codec": "query_only",
    }
    if label in mapping:
        return mapping[label]

    if (query or "").strip():
        policy = get_codec_policy_for_query(query)
        action = str(policy.get("action") or "neutral")
        preferred = str(policy.get("preferred_variant") or "")
        if action == "prefer_codec" or preferred == "referents_plus_codec":
            return "referents_plus_codec"
        if action == "skip_codec":
            return "query_only"
    return None



@_transactional_state_update
def observe_codec_outcome(
    *,
    query: str,
    policy_label: Optional[str] = None,
    execution_success: bool,
    user_correction: bool,
    recovery_needed: bool,
    validator_pass: bool,
    session_key: Optional[str] = None,
    note: str = "",
    outcome_confidence: Optional[float] = None,
    source: str = "real_outcome",
    step_attribution: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    variant = infer_codec_variant(policy_label, query=query)
    if variant not in _VARIANTS:
        return {"recorded": False, "reason": "no_codec_variant_inferred"}

    archetype = classify_task_archetype(query)
    state = load_state()
    row = _archetype_row(state, archetype)
    reward = _outcome_reward(
        execution_success=execution_success,
        user_correction=user_correction,
        recovery_needed=recovery_needed,
        validator_pass=validator_pass,
    )
    variant_row = row["variants"][variant]
    variant_row["outcome_events"] = int(variant_row.get("outcome_events", 0)) + 1
    confidence = _clamp(outcome_confidence if outcome_confidence is not None else 1.0, 0.0, 1.0)
    variant_row["weighted_outcome_events"] = round(float(variant_row.get("weighted_outcome_events", 0.0) or 0.0) + confidence, 3)
    variant_row["success_events"] = int(variant_row.get("success_events", 0)) + (1 if execution_success else 0)
    variant_row["correction_events"] = int(variant_row.get("correction_events", 0)) + (1 if user_correction else 0)
    variant_row["recovery_events"] = int(variant_row.get("recovery_events", 0)) + (1 if recovery_needed else 0)
    n = int(variant_row.get("outcome_events", 0))
    prev_avg = float(variant_row.get("avg_reward", 0.0) or 0.0)
    weighted_reward = reward * confidence
    variant_row["avg_reward"] = round(((prev_avg * (n - 1)) + weighted_reward) / max(1, n), 3)
    variant_row["last_outcome_at"] = _now_iso()
    _apply_step_attribution(
        row,
        step_attribution=step_attribution,
        weighted_reward=weighted_reward,
        execution_success=execution_success,
        recovery_needed=recovery_needed,
    )
    recommendation = _recompute_recommendation(row)

    totals = state.setdefault("totals", {})
    if source == "passive_followup":
        totals["passive_feedback_recorded"] = int(totals.get("passive_feedback_recorded", 0) or 0) + 1

    state["last_observation"] = {
        "ts": _now_iso(),
        "query": (query or "")[:240],
        "session_key": (session_key or "")[:128] if session_key else None,
        "archetype": archetype,
        "variant": variant,
        "source": source,
        "reward": reward,
        "weighted_reward": round(weighted_reward, 3),
        "outcome_confidence": round(confidence, 3),
        "execution_success": execution_success,
        "user_correction": user_correction,
        "recovery_needed": recovery_needed,
        "validator_pass": validator_pass,
        "note": (note or "")[:240],
    }
    save_state(state)
    return {
        "recorded": True,
        "archetype": archetype,
        "variant": variant,
        "reward": reward,
        "outcome_confidence": round(confidence, 3),
        "weighted_reward": round(weighted_reward, 3),
        "step_summary": _step_attribution_summary(row),
        "recommendation": recommendation,
    }



def get_codec_policy_for_query(query: str) -> Dict[str, Any]:
    archetype = classify_task_archetype(query)
    state = load_state()
    row = _archetype_row(state, archetype)
    recommendation = row.get("recommendation") if isinstance(row.get("recommendation"), dict) else _recompute_recommendation(row)
    autotune = row.get("autotune") if isinstance(row.get("autotune"), dict) else _default_autotune_row()
    wins = recommendation.get("wins") if isinstance(recommendation.get("wins"), dict) else {}
    weighted_wins = recommendation.get("weighted_wins") if isinstance(recommendation.get("weighted_wins"), dict) else {}
    base_rollout_percent = int(recommendation.get("rollout_percent", 0) or 0)
    rollout_delta = int(autotune.get("rollout_delta", 0) or 0)
    rollout_percent = max(0, min(100, base_rollout_percent + rollout_delta))
    rollout_bucket = _rollout_bucket(query)
    rollout_hit = rollout_percent > 0 and rollout_bucket < rollout_percent
    action = str(recommendation.get("action") or "neutral")
    should_inject = True
    boost_factor = 1.0
    if action == "skip_codec":
        should_inject = not rollout_hit
    elif action == "prefer_codec":
        should_inject = True
        boost_factor = 1.0 + (0.5 * (rollout_percent / 100.0) if rollout_hit else 0.0)
    if str(autotune.get("action") or "") == "decrease_rollout" and action == "neutral":
        should_inject = rollout_hit
    return {
        "enabled": bool(state.get("enabled", True)),
        "version": str(state.get("version", "cortex.codec.policy.v1")),
        "archetype": archetype,
        "evaluations": int(row.get("evaluations", 0) or 0),
        "action": action,
        "stage": str(recommendation.get("stage") or "shadow"),
        "preferred_variant": recommendation.get("preferred_variant"),
        "confidence": float(recommendation.get("confidence", 0.0) or 0.0),
        "rollout_percent": rollout_percent,
        "base_rollout_percent": base_rollout_percent,
        "rollout_delta": rollout_delta,
        "rollout_bucket": rollout_bucket,
        "rollout_hit": rollout_hit,
        "should_inject": should_inject,
        "boost_factor": round(boost_factor, 3),
        "reason": str(recommendation.get("reason") or "collecting_evidence"),
        "autotune": autotune,
        "wins": wins,
        "weighted_wins": weighted_wins,
        "step_patterns": _step_attribution_summary(row),
        "last_winner": row.get("last_winner"),
        "last_judge_method": row.get("last_judge_method"),
    }



def get_codec_routing_priors(query: str) -> Dict[str, Any]:
    policy = get_codec_policy_for_query(query)
    helpful = [str(item.get("name") or "") for item in (policy.get("step_patterns") or {}).get("helpful", []) if isinstance(item, dict)]
    risky = [str(item.get("name") or "") for item in (policy.get("step_patterns") or {}).get("risky", []) if isinstance(item, dict)]
    confidence = float(policy.get("confidence", 0.0) or 0.0)

    prefer_orchestrated = any(name in {"lane:alive_orchestrated", "lane:strict_contract"} for name in helpful)
    prefer_gated_direct = any(name == "lane:gated_direct" for name in helpful)
    avoid_fallback = any(name.startswith("fallback:") or name == "lane:fallback_best_effort" or name == "pattern:failed_steps" or name == "pattern:rollbacks" for name in risky)
    avoid_tinyllama = any("tinyllama" in name for name in risky)
    prefer_strict_contract = any(name == "lane:strict_contract" for name in helpful)
    prefer_bridge_first = any(name.startswith("fallback:bridge_first") or name.startswith("fallback:bridge_won_hedge") or name.startswith("backend:gpt-5.3-codex-via-openclaw-bridge") for name in helpful)
    avoid_bridge_fallback = any(name.startswith("fallback:bridge_") or name.startswith("backend:gpt-5.3-codex-via-openclaw-bridge") for name in risky)
    prefer_openclaw_primary = prefer_orchestrated or prefer_strict_contract

    quality_bias = "neutral"
    if confidence >= 0.4 and (prefer_orchestrated or avoid_fallback or avoid_tinyllama or avoid_bridge_fallback):
        quality_bias = "deeper"

    return {
        "confidence": confidence,
        "prefer_orchestrated": bool(prefer_orchestrated and confidence >= 0.35),
        "prefer_gated_direct": bool(prefer_gated_direct and confidence >= 0.35),
        "prefer_strict_contract": bool(prefer_strict_contract and confidence >= 0.35),
        "prefer_openclaw_primary": bool(prefer_openclaw_primary and confidence >= 0.35),
        "prefer_bridge_first": bool(prefer_bridge_first and confidence >= 0.35),
        "avoid_fallback": bool(avoid_fallback and confidence >= 0.35),
        "avoid_bridge_fallback": bool(avoid_bridge_fallback and confidence >= 0.35),
        "avoid_tinyllama": bool(avoid_tinyllama and confidence >= 0.35),
        "quality_bias": quality_bias,
        "helpful": helpful[:5],
        "risky": risky[:5],
    }



def get_codec_backend_policy(query: str, runtime_state: Optional[Dict[str, Any]] = None, *, priors_override: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    priors = priors_override if isinstance(priors_override, dict) else get_codec_routing_priors(query)
    runtime = runtime_state if isinstance(runtime_state, dict) else {}
    fallbacks_enabled = bool(runtime.get("fallbacks_enabled", True))
    bridge_available = bool(runtime.get("bridge_available", True))
    bridge_cb_allows = bool(runtime.get("bridge_cb_allows", True))
    openclaw_rate_limited = bool(runtime.get("openclaw_rate_limited", False))

    prefer_bridge_first = bool(priors.get("prefer_bridge_first")) and bridge_available and bridge_cb_allows
    prefer_openclaw_primary = bool(priors.get("prefer_openclaw_primary"))
    avoid_bridge_fallback = bool(priors.get("avoid_bridge_fallback"))
    avoid_tinyllama = bool(priors.get("avoid_tinyllama"))
    avoid_fallback = bool(priors.get("avoid_fallback"))

    allow_tinyllama = bool(fallbacks_enabled and (not avoid_tinyllama))
    allow_bridge_fallback = bool(fallbacks_enabled and bridge_available and bridge_cb_allows and (not avoid_bridge_fallback))
    degraded_fastpath_enabled = bool(fallbacks_enabled and not (priors.get("quality_bias") == "deeper" and avoid_fallback))
    hedge_bridge = bool(allow_bridge_fallback and (not prefer_openclaw_primary) and (not prefer_bridge_first))

    order = []
    if prefer_bridge_first:
        order.append("bridge")
    if openclaw_rate_limited and allow_bridge_fallback and (not prefer_openclaw_primary) and (not prefer_bridge_first):
        order.extend(["bridge", "openclaw"])
    else:
        order.append("openclaw")
        if allow_bridge_fallback and (not prefer_bridge_first):
            order.append("bridge")
    if allow_tinyllama:
        order.append("tinyllama")

    backend_order = []
    seen = set()
    for name in order:
        if name in seen:
            continue
        seen.add(name)
        backend_order.append(name)

    reasons = []
    if prefer_bridge_first:
        reasons.append("bridge_patterns_helpful")
    if prefer_openclaw_primary:
        reasons.append("openclaw_patterns_helpful")
    if avoid_bridge_fallback:
        reasons.append("bridge_fallback_patterns_risky")
    if avoid_tinyllama:
        reasons.append("tinyllama_patterns_risky")
    if avoid_fallback:
        reasons.append("fallback_patterns_risky")
    if openclaw_rate_limited:
        reasons.append("openclaw_rate_limited")

    return {
        "backend_order": backend_order,
        "prefer_bridge_first": prefer_bridge_first,
        "prefer_openclaw_primary": prefer_openclaw_primary,
        "allow_bridge_fallback": allow_bridge_fallback,
        "allow_tinyllama": allow_tinyllama,
        "degraded_fastpath_enabled": degraded_fastpath_enabled,
        "hedge_bridge": hedge_bridge,
        "quality_bias": priors.get("quality_bias", "neutral"),
        "confidence": float(priors.get("confidence", 0.0) or 0.0),
        "reasons": reasons,
        "priors": priors,
        "runtime_state": {
            "fallbacks_enabled": fallbacks_enabled,
            "bridge_available": bridge_available,
            "bridge_cb_allows": bridge_cb_allows,
            "openclaw_rate_limited": openclaw_rate_limited,
        },
    }



def get_codec_session_telemetry(session_key: str) -> Dict[str, Any]:
    if not session_key:
        return {
            "available": False,
            "max_age_seconds": PASSIVE_TURN_MAX_AGE_SECONDS,
            "min_confidence": PASSIVE_SIGNAL_MIN_CONFIDENCE,
        }
    with _SESSION_TURN_LOCK:
        row = dict(_SESSION_LAST_TURN.get(session_key) or {})
    if not row:
        return {
            "available": False,
            "max_age_seconds": PASSIVE_TURN_MAX_AGE_SECONDS,
            "min_confidence": PASSIVE_SIGNAL_MIN_CONFIDENCE,
        }
    age_seconds = _age_seconds(row.get("recorded_at"))
    expired = age_seconds is not None and age_seconds > max(30, PASSIVE_TURN_MAX_AGE_SECONDS)
    return {
        "available": True,
        "session_key": session_key,
        "variant": row.get("variant"),
        "lane": row.get("lane"),
        "codec_applied": bool(row.get("codec_applied")),
        "referents_applied": bool(row.get("referents_applied")),
        "query_hash": row.get("query_hash"),
        "response_hash": row.get("response_hash"),
        "response_excerpt_chars": len(str(row.get("response_excerpt") or "")),
        "recorded_at": row.get("recorded_at"),
        "age_seconds": age_seconds,
        "expired": bool(expired),
        "passive_feedback_recorded": bool(row.get("passive_feedback_recorded")),
        "last_passive_signal": row.get("last_passive_signal"),
        "last_passive_recorded_at": row.get("last_passive_recorded_at"),
        "max_age_seconds": PASSIVE_TURN_MAX_AGE_SECONDS,
        "min_confidence": PASSIVE_SIGNAL_MIN_CONFIDENCE,
    }


def get_codec_policy_status(query: Optional[str] = None, *, session_key: Optional[str] = None) -> Dict[str, Any]:
    state = load_state()
    out = {
        "enabled": bool(state.get("enabled", True)),
        "version": str(state.get("version", "cortex.codec.policy.v1")),
        "last_updated": state.get("last_updated"),
        "totals": state.get("totals", {}),
        "last_observation": state.get("last_observation"),
        "passive_config": {
            "min_confidence": PASSIVE_SIGNAL_MIN_CONFIDENCE,
            "max_age_seconds": PASSIVE_TURN_MAX_AGE_SECONDS,
        },
        "autotune_config": {
            "min_runs": AUTOTUNE_MIN_RUNS,
            "max_rollout_delta": AUTOTUNE_MAX_ROLLOUT_DELTA,
        },
        "archetypes": {},
    }
    for archetype, row in sorted((state.get("archetypes") or {}).items()):
        if not isinstance(row, dict):
            continue
        recommendation = row.get("recommendation") if isinstance(row.get("recommendation"), dict) else {}
        out["archetypes"][archetype] = {
            "evaluations": int(row.get("evaluations", 0) or 0),
            "last_winner": row.get("last_winner"),
            "last_judge_method": row.get("last_judge_method"),
            "recommendation": recommendation,
            "autotune": row.get("autotune") if isinstance(row.get("autotune"), dict) else _default_autotune_row(),
            "step_patterns": _step_attribution_summary(row),
        }
    if query:
        out["query_policy"] = get_codec_policy_for_query(query)
        out["query_backend_policy"] = get_codec_backend_policy(query)
    if session_key:
        out["session_telemetry"] = get_codec_session_telemetry(session_key)
    return out
