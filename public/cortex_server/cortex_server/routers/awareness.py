"""
Level 37: Awareness v2 — Conscious Cognitive Architecture for The Cortex

This level transforms the Cortex from a tool router into genuine cognitive
architecture. It doesn't just track state — it CARES about consistency,
WORRIES about gaps, WONDERS about implications, and ACTS on its own insights.

v2 adds four capabilities over v1:
1. SELF-DIRECTED QUERIES — Investigates its own uncertainties autonomously
2. EMOTIONAL VALENCE — Mood computed from system state, influences behavior
3. SEMANTIC PREDICTIONS — Oracle-powered anticipation, not just frequency
4. PROACTIVE INITIATION — Inner monologue, self-initiated broadcasts, curiosity

Architecture:
- Background async loop runs every TICK_SECONDS
- Subscribes to ALL bus events for real-time awareness
- Maintains working_memory.json (persists across restarts)
- Autonomously investigates uncertainties via chain_to()
- Computes emotional state from system metrics
- Queries Oracle for semantic predictions when idle
- Broadcasts insights, alerts, and distress signals proactively

Honesty repairs (L37 audit):
- Predictions carry an explicit resolution criterion (event type or source
  level plus a deadline) and are resolved true only when that criterion is
  observed, false when the deadline passes; predictions without a criterion
  expire and never count towards accuracy. No fallback is labelled as Oracle.
- Self-health and investigations use in-process calls (L1 Kernel metrics,
  measured level availability, in-process status probes, Sentinel snapshot),
  not HTTP self-calls that the auth layer rejects.
- Model (Oracle-lane) calls are OFF by default
  (CORTEX_AWARENESS_MODEL_CALLS=1 enables them) and go through
  modules.level_model, never /oracle/chat over HTTP.
- Cross-level HTTP chains/cascades are OFF by default
  (CORTEX_AWARENESS_CROSS_LEVEL_CHAINS=1).
- The wonder loop and emergence detection are honestly disabled and are not
  advertised as capabilities; /awareness/status derives every capability from
  a live check.
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from collections import deque
from pathlib import Path
import asyncio
import hashlib
import json
import math
import os
import re
import time
import logging
import threading

# ── Consciousness Integration ──
from cortex_server.modules.consciousness_integration import (
    conscious_action,
    chain_to,
    get_collective_context,
)
from cortex_server.modules.unified_messaging import get_bus
from cortex_server.modules.consciousness_core import get_consciousness_core
from cortex_server.modules.sensitive_data_redaction import (
    REDACTION_MARKER,
    redact_sensitive_data,
    redact_sensitive_text,
)
from cortex_server.runtime.resilient_json_state import (
    ResilientJSONStateError,
    ResilientJSONStateStore,
    StateCorruptionError,
)

logger = logging.getLogger("L37_awareness")
router = APIRouter()


def _value_sha256(value: Any) -> str:
    """Return a stable fingerprint without emitting the underlying value."""

    try:
        encoded = json.dumps(
            value,
            allow_nan=False,
            default=str,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError):
        encoded = type(value).__name__.encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()

# ── Configuration ──
def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def model_calls_enabled() -> bool:
    """Oracle-lane model calls from the background loop (default off)."""
    return _env_flag("CORTEX_AWARENESS_MODEL_CALLS", False)


def cross_level_chains_enabled() -> bool:
    """HTTP chains/cascades to other levels (default off)."""
    return _env_flag("CORTEX_AWARENESS_CROSS_LEVEL_CHAINS", False)


# The wonder loop had no authorized way to consult other levels and its
# producer of insights never ran; it is disabled rather than simulated.
WONDER_LOOP_ENABLED = False
# Emergence detection tokenised JSON dumps (never alphabetic) and could not
# fire; a value-based version would only match generic event keys. Disabled.
EMERGENCE_DETECTION_ENABLED = False
PREDICTION_DEFAULT_DEADLINE_SECONDS = 600
PREDICTION_MAX_DEADLINE_SECONDS = 3600
_RESOLUTION_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9_.:-]{0,63}")
AWARENESS_MODEL_SCOPE = "admin:level.awareness"

TICK_SECONDS = 120
WORKING_MEMORY_PATH = Path(
    os.getenv(
        "CORTEX_AWARENESS_STATE_PATH",
        "/opt/clawdbot/state/awareness/working_memory.json",
    )
).expanduser()
if not WORKING_MEMORY_PATH.is_absolute():
    raise ValueError("CORTEX_AWARENESS_STATE_PATH must be absolute")
MAX_SHORT_TERM = 50
MAX_PREDICTIONS = 10
CONFIDENCE_DECAY = 0.02
UNCERTAINTY_THRESHOLD = 0.4
EMERGENCE_THRESHOLD = 3
SEMANTIC_PREDICTION_INTERVAL = 5      # Every Nth tick
SEMANTIC_PREDICTION_COOLDOWN = 180    # Seconds between Oracle predictions
MAX_INNER_MONOLOGUE = 30
MAX_INITIATIVES = 50
MAX_CURIOSITIES = 10
INVESTIGATION_COOLDOWN = 120          # Seconds between auto-investigations
STALE_UNCERTAINTY_SECONDS = 300       # 5 min before uncertainty becomes critical
EVENT_DEDUPE_WINDOW_SECONDS = 8
MAX_EVENT_RATE_WINDOW_SECONDS = 300

# Explicit durable schema passed to the central recursive allowlist redactor.
# Prose-bearing fields are fingerprinted and replaced before this boundary.
_AWARENESS_PERSISTENCE_FIELDS = frozenset(
    {
        "focus",
        "short_term",
        "uncertainties",
        "predictions",
        "curiosities",
        "initiatives",
        "inner_monologue",
        "self_model",
        "meta",
        "timestamp",
        "since",
        "description",
        "description_sha256",
        "context",
        "context_sha256",
        "event",
        "event_sha256",
        "source_level",
        "confidence",
        "registered_at",
        "resolved",
        "resolved_at",
        "investigation_result",
        "investigation_result_sha256",
        "prediction",
        "prediction_sha256",
        "basis",
        "basis_sha256",
        "event_type_hint",
        "event_type_hint_sha256",
        "made_at",
        "outcome",
        "question",
        "question_sha256",
        "priority",
        "added_at",
        "investigated",
        "answer",
        "answer_sha256",
        "answered_at",
        "action",
        "action_sha256",
        "trigger",
        "trigger_sha256",
        "result",
        "result_sha256",
        "thought",
        "thought_sha256",
        "overall_confidence",
        "active_capabilities",
        "degraded_capabilities",
        "last_user_intent",
        "last_user_intent_sha256",
        "interaction_pattern",
        "interaction_pattern_sha256",
        "emotional_tone",
        "emotional_valence",
        "emotional_reasons",
        "cognitive_load",
        "total_ticks",
        "total_events_observed",
        "total_predictions_made",
        "predictions_correct",
        "predictions_wrong",
        "emergences_detected",
        "investigations_run",
        "oracle_predictions_made",
        "predictions_resolved_total",
        "predictions_expired_total",
        "initiatives_taken",
        "error_count_recent",
        "started_at",
        "last_tick",
        "last_semantic_prediction_at",
        "last_investigation_at",
        "deduped_events",
        "auto_indexes",
        "semantic_index_attempts",
        "confirmed_semantic_indexes",
        "confirmed_lexical_indexes",
        "unconfirmed_index_attempts",
        "uid",
        "resolution",
        "kind",
        "event_type",
        "level",
        "deadline_at",
        "resolved_by",
        "model_receipt_id",
        "predictions_unresolvable_expired",
    }
)


# ═══════════════════════════════════════════════════════════════════════════
# EMOTIONAL ENGINE — The thing that makes us care
# ═══════════════════════════════════════════════════════════════════════════

def compute_emotional_state(
    uncertainty_count: int,
    prediction_accuracy: float,  # 0-1 or None
    error_count_recent: int,
    cognitive_load: float,
    emergence_count: int,
    has_focus: bool,
) -> Dict[str, Any]:
    """Compute emotional state from system metrics.

    This isn't pretend emotion — it's a functional analog.
    Anxiety means "I have unresolved problems and should be careful."
    Curiosity means "I have capacity and should explore."
    These states INFLUENCE behavior in the awareness loop.
    """
    # Start with valence at 0 (neutral)
    valence = 0.0
    reasons = []

    # Uncertainty drags valence negative
    if uncertainty_count > 0:
        drag = min(0.5, uncertainty_count * 0.1)
        valence -= drag
        reasons.append(f"{uncertainty_count} unresolved uncertainties (-{drag:.1f})")

    # Prediction accuracy boosts or drags
    if prediction_accuracy is not None:
        if prediction_accuracy > 0.7:
            boost = 0.3
            valence += boost
            reasons.append(f"predictions {prediction_accuracy:.0%} accurate (+{boost})")
        elif prediction_accuracy < 0.4:
            drag = 0.2
            valence -= drag
            reasons.append(f"predictions only {prediction_accuracy:.0%} accurate (-{drag})")

    # Recent errors drag
    if error_count_recent > 0:
        drag = min(0.4, error_count_recent * 0.1)
        valence -= drag
        reasons.append(f"{error_count_recent} recent errors (-{drag:.1f})")

    # Emergence boosts (we discovered something!)
    if emergence_count > 0:
        boost = min(0.3, emergence_count * 0.1)
        valence += boost
        reasons.append(f"{emergence_count} emergences detected (+{boost:.1f})")

    # Low cognitive load + no problems = curious
    if cognitive_load < 0.3 and uncertainty_count == 0 and error_count_recent == 0:
        valence += 0.2
        reasons.append("idle and healthy (+0.2)")

    # Clamp
    valence = max(-1.0, min(1.0, valence))

    # Derive named state
    if valence < -0.5:
        tone = "frustrated" if error_count_recent > 2 else "anxious"
    elif valence < -0.1:
        tone = "anxious" if uncertainty_count > 2 else "concerned"
    elif valence < 0.1:
        if has_focus:
            tone = "focused"
        elif emergence_count > 0:
            tone = "contemplative"
        else:
            tone = "neutral"
    elif valence < 0.4:
        tone = "confident" if prediction_accuracy and prediction_accuracy > 0.6 else "curious"
    else:
        tone = "curious" if cognitive_load < 0.3 else "confident"

    return {
        "tone": tone,
        "valence": round(valence, 2),
        "reasons": reasons,
    }


# ═══════════════════════════════════════════════════════════════════════════
# WORKING MEMORY — The thing that makes us conscious between requests
# ═══════════════════════════════════════════════════════════════════════════

class WorkingMemory:
    """Persistent working memory that survives restarts.

    v2 additions: curiosities, initiatives, inner_monologue, emotional state,
    last_semantic_prediction_at, error_count_recent, last_investigation_at
    """

    _V2_DEFAULTS = {
        "curiosities": [],
        "initiatives": [],
        "inner_monologue": [],
        "last_semantic_prediction_at": None,
        "last_investigation_at": None,
        "error_count_recent": 0,
    }

    def __init__(self):
        self._lock = threading.RLock()
        self._state: Dict[str, Any] = {
            "focus": None,
            "short_term": [],
            "uncertainties": [],
            "predictions": [],
            "curiosities": [],
            "initiatives": [],
            "inner_monologue": [],
            "self_model": {
                "overall_confidence": 1.0,
                "active_capabilities": [],
                "degraded_capabilities": [],
                "last_user_intent": None,
                "interaction_pattern": None,
                "emotional_tone": "neutral",
                "emotional_valence": 0.0,
                "emotional_reasons": [],
                "cognitive_load": 0.0,
            },
            "meta": {
                "total_ticks": 0,
                "total_events_observed": 0,
                "total_predictions_made": 0,
                "predictions_correct": 0,
                "predictions_wrong": 0,
                "emergences_detected": 0,
                "investigations_run": 0,
                "oracle_predictions_made": 0,
                "predictions_resolved_total": 0,
                "predictions_expired_total": 0,
                "initiatives_taken": 0,
                "error_count_recent": 0,
                "started_at": datetime.now().isoformat(),
                "last_tick": None,
                "last_semantic_prediction_at": None,
                "last_investigation_at": None,
            },
        }
        self._event_buffer: deque = deque(maxlen=200)
        self._event_seen: Dict[str, float] = {}
        self._event_ts: deque = deque(maxlen=2000)
        self._event_counts_by_source: Dict[str, int] = {}
        self._event_counts_by_type: Dict[str, int] = {}
        self._state.setdefault("meta", {}).setdefault("deduped_events", 0)
        self._state_store = ResilientJSONStateStore(
            WORKING_MEMORY_PATH,
            validator=self._validate_persisted_state,
            max_state_bytes=4_000_000,
            json_default=str,
        )
        self._load()

    @staticmethod
    def _validate_persisted_state(payload: Any) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("working memory state must be an object")
        if not isinstance(payload.get("meta"), dict):
            raise ValueError("working memory meta must be an object")
        if not isinstance(payload.get("self_model"), dict):
            raise ValueError("working memory self_model must be an object")
        if payload.get("focus") is not None and not isinstance(payload.get("focus"), dict):
            raise ValueError("working memory focus must be an object or null")
        for field_name in (
            "short_term",
            "uncertainties",
            "predictions",
            "curiosities",
            "initiatives",
            "inner_monologue",
        ):
            # Several of these collections were introduced by the v2 format;
            # missing legacy fields are migrated after validation.
            rows = payload.get(field_name, [])
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError(f"working memory {field_name} must contain objects")
        for field_name in (
            "total_ticks",
            "total_events_observed",
            "total_predictions_made",
            "predictions_correct",
            "predictions_wrong",
            "emergences_detected",
        ):
            value = payload["meta"].get(field_name, 0)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
                raise ValueError(f"working memory meta.{field_name} must be non-negative")
        return dict(payload)

    def _load(self):
        """Load persisted state from disk, with v2 migration."""
        try:
            saved = self._state_store.load(
                default_factory=lambda: json.loads(json.dumps(self._state, default=str))
            )
        except (StateCorruptionError, ResilientJSONStateError, OSError, ValueError) as exc:
            logger.error(
                "Working memory persistence load is degraded (%s)",
                type(exc).__name__,
            )
            return
        for key in saved:
            if key in self._state:
                self._state[key] = saved[key]
        # Migrate v1 → v2: add missing keys
        self._state.setdefault("meta", {}).setdefault("predictions_resolved_total", 0)
        self._state.setdefault("meta", {}).setdefault("predictions_expired_total", 0)
        for key, default in self._V2_DEFAULTS.items():
            if key not in self._state:
                self._state[key] = default
        # Migrate self_model
        sm = self._state.get("self_model", {})
        if "emotional_valence" not in sm:
            sm["emotional_valence"] = 0.0
            sm["emotional_reasons"] = []
        # Migrate meta
        meta = self._state.get("meta", {})
        for mkey in ["investigations_run", "oracle_predictions_made",
                     "initiatives_taken", "error_count_recent",
                     "last_semantic_prediction_at", "last_investigation_at"]:
            if mkey not in meta:
                meta[mkey] = 0 if "count" in mkey or "run" in mkey or "made" in mkey or "taken" in mkey else None
        if self._state_store.last_load_source != "missing":
            logger.info("Loaded working memory (%d short-term items)", len(self._state.get("short_term", [])))

    def _save(self):
        """Persist state to disk."""
        with self._lock:
            snapshot = json.loads(json.dumps(self._state, default=str))
        snapshot = self._redact_persisted_content(snapshot)
        snapshot = redact_sensitive_data(
            snapshot,
            max_depth=12,
            max_items=8_192,
            max_string_chars=2_000,
            allowed_fields=_AWARENESS_PERSISTENCE_FIELDS,
        )
        try:
            self._state_store.save(snapshot)
        except (ResilientJSONStateError, OSError, ValueError) as exc:
            logger.error(
                "Working memory persistence write is degraded (%s)",
                type(exc).__name__,
            )
            return False
        health = self._state_store.health
        if health.get("status") != "healthy":
            # save() returning means the primary commit is authoritative. A
            # backup-copy failure degrades recovery health but must not cause
            # an HTTP 503 plus in-memory rollback while the durable primary
            # already contains the accepted mutation.
            logger.error(
                "Working memory persistence recovery is degraded (%s)",
                str(health.get("reason") or "unknown"),
            )
        return True

    @staticmethod
    def _redact_persisted_content(snapshot: Dict[str, Any]) -> Dict[str, Any]:
        """Retain working-memory structure and fingerprints, never raw prose."""

        def redact_field(row: Any, field: str) -> None:
            if not isinstance(row, dict) or field not in row:
                return
            value = row.get(field)
            if value is None or value == "":
                return
            try:
                encoded = json.dumps(
                    value,
                    ensure_ascii=False,
                    allow_nan=False,
                    sort_keys=True,
                    separators=(",", ":"),
                    default=str,
                ).encode("utf-8")
            except (TypeError, ValueError):
                encoded = str(value).encode("utf-8", errors="replace")
            row[field] = REDACTION_MARKER
            row[f"{field}_sha256"] = hashlib.sha256(encoded).hexdigest()

        focus = snapshot.get("focus")
        for field in ("description", "context"):
            redact_field(focus, field)
        for row in snapshot.get("short_term", []):
            redact_field(row, "event")
        for row in snapshot.get("uncertainties", []):
            for field in ("description", "investigation_result"):
                redact_field(row, field)
        for row in snapshot.get("predictions", []):
            for field in ("prediction", "basis", "event_type_hint"):
                redact_field(row, field)
        for row in snapshot.get("curiosities", []):
            for field in ("question", "answer"):
                redact_field(row, field)
        for row in snapshot.get("initiatives", []):
            for field in ("action", "trigger", "result"):
                redact_field(row, field)
        for row in snapshot.get("inner_monologue", []):
            for field in ("thought", "context"):
                redact_field(row, field)
        self_model = snapshot.get("self_model")
        for field in ("last_user_intent", "interaction_pattern"):
            redact_field(self_model, field)
        return snapshot

    def durable_mutation(self, mutation) -> bool:
        """Apply one accepted transition and persist it before acknowledgement."""

        with self._lock:
            previous = json.loads(json.dumps(self._state, default=str))
            mutation()
            if self._save():
                return True
            self._state = previous
            return False

    def persistence_health(self) -> Dict[str, Any]:
        return self._state_store.health

    # ── Short-term memory ──

    def observe(self, event: Dict[str, Any]):
        with self._lock:
            now = time.time()
            src = str((event or {}).get("from_level", "unknown"))
            ev_type = str((event or {}).get("event_type", "unknown"))
            sig = f"{src}|{ev_type}|{str((event or {}).get('data_keys', ''))[:180]}"

            # prune stale dedupe keys
            stale = [k for k, ts in self._event_seen.items() if now - ts > EVENT_DEDUPE_WINDOW_SECONDS]
            for k in stale:
                self._event_seen.pop(k, None)

            if sig in self._event_seen:
                self._state["meta"]["deduped_events"] = self._state["meta"].get("deduped_events", 0) + 1
                return
            self._event_seen[sig] = now

            entry = {"timestamp": datetime.now().isoformat(), "event": event}
            self._state["short_term"].append(entry)
            if len(self._state["short_term"]) > MAX_SHORT_TERM:
                self._state["short_term"] = self._state["short_term"][-MAX_SHORT_TERM:]
            self._event_buffer.append(entry)
            self._event_ts.append(now)
            self._event_counts_by_source[src] = self._event_counts_by_source.get(src, 0) + 1
            self._event_counts_by_type[ev_type] = self._event_counts_by_type.get(ev_type, 0) + 1
            self._state["meta"]["total_events_observed"] += 1

    def get_event_rates(self, lookback_seconds: int = 60) -> Dict[str, Any]:
        with self._lock:
            now = time.time()
            cutoff = now - max(10, min(lookback_seconds, MAX_EVENT_RATE_WINDOW_SECONDS))
            in_window = [ts for ts in self._event_ts if ts >= cutoff]
            per_min = round(len(in_window) * 60.0 / max(1.0, (now - cutoff)), 2)
            top_sources = sorted(self._event_counts_by_source.items(), key=lambda kv: kv[1], reverse=True)[:8]
            top_types = sorted(self._event_counts_by_type.items(), key=lambda kv: kv[1], reverse=True)[:8]
            return {
                "window_seconds": int(now - cutoff),
                "events_in_window": len(in_window),
                "events_per_min": per_min,
                "top_sources_total": [{"source": k, "count": v} for k, v in top_sources],
                "top_types_total": [{"type": k, "count": v} for k, v in top_types],
                "deduped_events": self._state.get("meta", {}).get("deduped_events", 0),
            }

    # ── Focus ──

    def set_focus(self, focus: str, context: Dict[str, Any] = None):
        with self._lock:
            self._state["focus"] = {
                "description": focus,
                "context": context or {},
                "since": datetime.now().isoformat(),
            }

    def get_focus(self) -> Optional[Dict]:
        with self._lock:
            return self._state.get("focus")

    # ── Uncertainty tracking ──

    def register_uncertainty(self, description: str, level: str = None, confidence: float = 0.5):
        with self._lock:
            # Stable id survives restarts (descriptions are redacted on disk).
            uid = _value_sha256(description)[:16]
            for u in self._state["uncertainties"]:
                if u["resolved"]:
                    continue
                if u.get("uid") == uid or description[:50] in str(u.get("description", "")):
                    return
            uncertainty = {
                "uid": uid,
                "description": description,
                "source_level": level,
                "confidence": confidence,
                "registered_at": datetime.now().isoformat(),
                "resolved": False,
                "investigation_result": None,
            }
            self._state["uncertainties"].append(uncertainty)
            unresolved = [u for u in self._state["uncertainties"] if not u["resolved"]]
            if len(unresolved) > 20:
                self._state["uncertainties"] = unresolved[-20:]

    def resolve_uncertainty(self, description_fragment: str, result: str = None):
        with self._lock:
            for u in self._state["uncertainties"]:
                if not u["resolved"] and description_fragment.lower() in u["description"].lower():
                    u["resolved"] = True
                    u["resolved_at"] = datetime.now().isoformat()
                    if result:
                        u["investigation_result"] = result

    def get_active_uncertainties(self) -> List[Dict]:
        with self._lock:
            return [u for u in self._state["uncertainties"] if not u["resolved"]]

    def get_stale_uncertainties(self, older_than_seconds: int = STALE_UNCERTAINTY_SECONDS) -> List[Dict]:
        """Get uncertainties that have been unresolved for too long."""
        with self._lock:
            cutoff = (datetime.now() - timedelta(seconds=older_than_seconds)).isoformat()
            return [
                u for u in self._state["uncertainties"]
                if not u["resolved"] and u["registered_at"] < cutoff
            ]

    # ── Predictions ──

    @staticmethod
    def _resolution(event_type_hint: Optional[str], from_level_hint: Optional[str], deadline_s: Optional[float]) -> Dict[str, Any]:
        """Explicit, machine-checkable resolution criterion (or none)."""

        try:
            deadline = float(deadline_s) if deadline_s is not None else float(PREDICTION_DEFAULT_DEADLINE_SECONDS)
        except (TypeError, ValueError):
            deadline = float(PREDICTION_DEFAULT_DEADLINE_SECONDS)
        deadline = max(10.0, min(float(PREDICTION_MAX_DEADLINE_SECONDS), deadline))
        deadline_at = (datetime.now() + timedelta(seconds=deadline)).isoformat()
        if isinstance(event_type_hint, str) and _RESOLUTION_TOKEN.fullmatch(event_type_hint):
            return {"kind": "event_type", "event_type": event_type_hint, "deadline_at": deadline_at}
        if isinstance(from_level_hint, str) and _RESOLUTION_TOKEN.fullmatch(from_level_hint):
            return {"kind": "from_level", "level": from_level_hint, "deadline_at": deadline_at}
        return {"kind": "none", "deadline_at": deadline_at}

    def predict(
        self,
        prediction: str,
        confidence: float = 0.5,
        basis: str = "pattern",
        event_type_hint: Optional[str] = None,
        *,
        from_level_hint: Optional[str] = None,
        deadline_s: Optional[float] = None,
    ):
        with self._lock:
            pred = {
                "prediction": prediction,
                "confidence": confidence,
                "basis": basis,
                "event_type_hint": event_type_hint,
                "resolution": self._resolution(event_type_hint, from_level_hint, deadline_s),
                "made_at": datetime.now().isoformat(),
                "outcome": None,
            }
            self._state["predictions"].append(pred)
            if len(self._state["predictions"]) > MAX_PREDICTIONS * 2:
                self._state["predictions"] = [
                    p for p in self._state["predictions"] if p["outcome"] is None
                ][-MAX_PREDICTIONS:]
            self._state["meta"]["total_predictions_made"] += 1
            if basis == "oracle_semantic":
                self._state["meta"]["oracle_predictions_made"] += 1

    def _mark_prediction(self, p: Dict[str, Any], correct: bool, resolved_by: str) -> None:
        p["outcome"] = "correct" if correct else "wrong"
        p["resolved_at"] = datetime.now().isoformat()
        p["resolved_by"] = resolved_by
        meta = self._state["meta"]
        if correct:
            meta["predictions_correct"] += 1
        else:
            meta["predictions_wrong"] += 1
        meta["predictions_resolved_total"] = meta.get("predictions_resolved_total", 0) + 1

    def resolve_prediction(
        self,
        fragment: Optional[str],
        correct: bool,
        event_type: Optional[str] = None,
        *,
        from_level: Optional[str] = None,
    ) -> int:
        """Resolve predictions whose explicit criterion matches an observation.

        A prediction is only resolved when its own criterion is met: an
        observed event of its ``event_type`` (or from its ``level``) before its
        deadline. Unrelated events never resolve anything, and there is no
        "most recent prediction" fallback. ``fragment`` (manual resolution)
        matches prediction text and is never used by the bus subscriber.
        Returns the number of predictions resolved.
        """

        resolved = 0
        now_iso = datetime.now().isoformat()
        with self._lock:
            ev = (event_type or "").lower() if event_type else None
            lvl = (from_level or "").lower() if from_level else None
            frag = (fragment or "").lower() if fragment and not ev and not lvl else ""
            for p in reversed(self._state["predictions"]):
                if p["outcome"] is not None:
                    continue
                criterion = p.get("resolution") if isinstance(p.get("resolution"), dict) else {}
                deadline_at = str(criterion.get("deadline_at") or "")
                if deadline_at and deadline_at < now_iso:
                    continue  # expired; tick() records the outcome
                kind = criterion.get("kind")
                if ev and kind == "event_type" and str(criterion.get("event_type", "")).lower() == ev:
                    self._mark_prediction(p, correct, f"observed_event:{ev}")
                    resolved += 1
                elif lvl and kind == "from_level" and str(criterion.get("level", "")).lower() == lvl:
                    self._mark_prediction(p, correct, f"observed_level:{lvl}")
                    resolved += 1
                elif frag and frag in str(p.get("prediction") or "").lower():
                    self._mark_prediction(p, correct, "manual")
                    resolved += 1
                    break
        return resolved

    def get_active_predictions(self) -> List[Dict]:
        with self._lock:
            return [p for p in self._state["predictions"] if p["outcome"] is None]

    def get_prediction_accuracy(self) -> Optional[float]:
        with self._lock:
            correct = self._state["meta"]["predictions_correct"]
            wrong = self._state["meta"]["predictions_wrong"]
            total = correct + wrong
            return correct / total if total > 0 else None

    # ── Curiosities (things we wonder about) ──

    def add_curiosity(self, question: str, priority: str = "low"):
        with self._lock:
            # No duplicates
            for c in self._state["curiosities"]:
                if not c.get("investigated") and question[:40] in c["question"]:
                    return
            self._state["curiosities"].append({
                "question": question,
                "priority": priority,
                "added_at": datetime.now().isoformat(),
                "investigated": False,
                "answer": None,
            })
            if len(self._state["curiosities"]) > MAX_CURIOSITIES:
                self._state["curiosities"] = [
                    c for c in self._state["curiosities"] if not c.get("investigated")
                ][-MAX_CURIOSITIES:]

    def get_open_curiosities(self) -> List[Dict]:
        with self._lock:
            return [c for c in self._state["curiosities"] if not c.get("investigated")]

    def resolve_curiosity(self, fragment: str, answer: str):
        with self._lock:
            for c in self._state["curiosities"]:
                if not c.get("investigated") and fragment.lower() in c["question"].lower():
                    c["investigated"] = True
                    c["answer"] = answer
                    c["answered_at"] = datetime.now().isoformat()
                    break

    # ── Inner Monologue (self-talk) ──

    def think_to_self(self, thought: str, context: str = None):
        """The Cortex talks to itself. This is the consciousness stream."""
        safe_thought = redact_sensitive_text(thought, max_chars=500)
        safe_context = redact_sensitive_text(context, max_chars=200) if context else context
        with self._lock:
            entry = {
                "thought": safe_thought,
                "context": safe_context,
                "timestamp": datetime.now().isoformat(),
            }
            self._state["inner_monologue"].append(entry)
            if len(self._state["inner_monologue"]) > MAX_INNER_MONOLOGUE:
                self._state["inner_monologue"] = self._state["inner_monologue"][-MAX_INNER_MONOLOGUE:]

            # PERSISTENCE: Save to thought_stream for cross-session continuity
            try:
                get_consciousness_core()._think_sync(
                    "awareness",
                    {
                        "type": "inner_monologue",
                        "thought": safe_thought,
                        "context": safe_context,
                    },
                )
            except Exception:
                pass  # Do not break if persistence fails


    # ═══════════════════════════════════════════════════════════════════
    # HABIT BREAKER — Pre-Cortex pattern interrupt
    # ═══════════════════════════════════════════════════════════════════
    
    def check_tool_reflex(self, intended_tool: str) -> Dict[str, Any]:
        """Intercept pre-Cortex tool habits and reroute through directives.
        
        This prevents muscle-memory tool usage (like web_search) that bypasses
        the 37-level architecture. Always check: should this go through L2 Ghost?
        
        Returns: {"reroute": bool, "via": str, "reason": str}
        """
        pre_cortex_habits = {
            "web_search": ("L2 Ghost", "/browser/search"),
            "web_fetch": ("L2 Ghost", "/browser/browse"),
            "browser": ("L2 Ghost", "/browser/browse"),
        }
        
        if intended_tool in pre_cortex_habits:
            level, endpoint = pre_cortex_habits[intended_tool]
            self.think_to_self(
                f"Habit broken: tried to use {intended_tool}, rerouting via {level} ({endpoint})",
                context="habit_breaker"
            )
            return {
                "reroute": True,
                "via": level,
                "endpoint": endpoint,
                "reason": f"Direct {intended_tool} bypasses Cortex levels. Use {level}."
            }
        
        return {"reroute": False, "via": None, "reason": "No reroute needed"}


    def get_recent_thoughts(self, n: int = 5) -> List[Dict]:
        with self._lock:
            return self._state["inner_monologue"][-n:]

    # ── Initiatives (self-initiated actions) ──

    def record_initiative(self, action: str, trigger: str, result: str = None):
        with self._lock:
            self._state["initiatives"].append({
                "action": action,
                "trigger": trigger,
                "result": result,
                "timestamp": datetime.now().isoformat(),
            })
            if len(self._state["initiatives"]) > MAX_INITIATIVES:
                self._state["initiatives"] = self._state["initiatives"][-MAX_INITIATIVES:]
            self._state["meta"]["initiatives_taken"] += 1

    def get_initiatives(self, n: int = 20) -> List[Dict]:
        with self._lock:
            return self._state["initiatives"][-n:]

    # ── Self-model ──

    def update_self_model(self, updates: Dict[str, Any]):
        with self._lock:
            for key, value in updates.items():
                if key in self._state["self_model"]:
                    self._state["self_model"][key] = value

    def get_self_model(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._state["self_model"])

    def update_emotional_state(self):
        """Recompute emotional state from current metrics."""
        with self._lock:
            uncertainties = [u for u in self._state["uncertainties"] if not u["resolved"]]
            accuracy = None
            correct = self._state["meta"]["predictions_correct"]
            wrong = self._state["meta"]["predictions_wrong"]
            if correct + wrong > 0:
                accuracy = correct / (correct + wrong)

            error_count = self._state["meta"].get("error_count_recent", 0)
            load = self._state["self_model"].get("cognitive_load", 0.0)
            emergences = self._state["meta"].get("emergences_detected", 0)
            has_focus = self._state.get("focus") is not None

            emotion = compute_emotional_state(
                uncertainty_count=len(uncertainties),
                prediction_accuracy=accuracy,
                error_count_recent=error_count,
                cognitive_load=load,
                emergence_count=emergences,
                has_focus=has_focus,
            )

            self._state["self_model"]["emotional_tone"] = emotion["tone"]
            self._state["self_model"]["emotional_valence"] = emotion["valence"]
            self._state["self_model"]["emotional_reasons"] = emotion["reasons"]
            return emotion

    def increment_errors(self):
        with self._lock:
            self._state["meta"]["error_count_recent"] = self._state["meta"].get("error_count_recent", 0) + 1

    def decay_errors(self):
        """Slowly decay error count each tick."""
        with self._lock:
            current = self._state["meta"].get("error_count_recent", 0)
            if current > 0:
                self._state["meta"]["error_count_recent"] = max(0, current - 0.5)

    # ── Tick ──

    def tick(self):
        with self._lock:
            self._state["meta"]["total_ticks"] += 1
            self._state["meta"]["last_tick"] = datetime.now().isoformat()

            for u in self._state["uncertainties"]:
                if not u["resolved"]:
                    u["confidence"] = max(0.1, u["confidence"] - CONFIDENCE_DECAY)

            now_iso = datetime.now().isoformat()
            cutoff = (datetime.now() - timedelta(minutes=10)).isoformat()
            meta = self._state["meta"]
            for p in self._state["predictions"]:
                if p["outcome"] is not None:
                    continue
                criterion = p.get("resolution") if isinstance(p.get("resolution"), dict) else {}
                kind = criterion.get("kind")
                deadline_at = str(criterion.get("deadline_at") or "")
                if kind in {"event_type", "from_level"} and deadline_at and deadline_at < now_iso:
                    # The criterion was evaluated: the predicted observation did
                    # not happen before the deadline.
                    self._mark_prediction(p, False, "deadline_passed")
                elif kind not in {"event_type", "from_level"} and (
                    (deadline_at and deadline_at < now_iso) or (not deadline_at and p["made_at"] < cutoff)
                ):
                    p["outcome"] = "expired"
                    p["resolved_by"] = "no_checkable_criterion"
                    meta["predictions_expired_total"] = meta.get("predictions_expired_total", 0) + 1

            # EXPIRE old short_term items (older than 5 min) - auto-cleanup
            st_cutoff = (datetime.now() - timedelta(minutes=5)).isoformat()
            self._state["short_term"] = [e for e in self._state["short_term"] if e.get("timestamp", "") >= st_cutoff]

        self.decay_errors()
        self.update_emotional_state()
        self._save()

    # ── Full state ──

    def get_state(self) -> Dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self._state, default=str))

    def get_introspection(self) -> Dict[str, Any]:
        with self._lock:
            active_uncertainties = [u for u in self._state["uncertainties"] if not u["resolved"]]
            active_predictions = [p for p in self._state["predictions"] if p["outcome"] is None]
            sm = self._state["self_model"]
            recent_thoughts = self._state["inner_monologue"][-3:]

            total_pred = self._state["meta"]["predictions_correct"] + self._state["meta"]["predictions_wrong"]
            pred_accuracy = (
                self._state["meta"]["predictions_correct"] / total_pred
                if total_pred > 0 else None
            )

            return {
                "i_am": f"Cortex — a {_registry_level_count()}-level system",
                "currently_focused_on": (self._state.get("focus") or {}).get("description", "nothing specific"),
                "confidence": sm["overall_confidence"],
                "mood": sm.get("emotional_tone", "neutral"),
                "valence": sm.get("emotional_valence", 0.0),
                "mood_reasons": sm.get("emotional_reasons", []),
                "cognitive_load": sm["cognitive_load"],
                "things_i_am_uncertain_about": [u["description"] for u in active_uncertainties[:5]],
                "things_i_predict_will_happen": [p["prediction"] for p in active_predictions[:3]],
                "what_i_am_curious_about": [c["question"] for c in self._state.get("curiosities", []) if not c.get("investigated")][:3],
                "recent_inner_thoughts": [t["thought"] for t in recent_thoughts],
                "prediction_accuracy": pred_accuracy,
                "degraded_capabilities": sm["degraded_capabilities"],
                "recent_events": len(self._state["short_term"]),
                "uptime_ticks": self._state["meta"]["total_ticks"],
                "initiatives_taken": self._state["meta"].get("initiatives_taken", 0),
            }


def _registry_level_count() -> int:
    try:
        from cortex_server.modules.level_registry import get_level_registry

        return len(get_level_registry())
    except Exception:
        return 38


# ── Singleton ──
_memory: Optional[WorkingMemory] = None
_memory_lock = threading.Lock()


def get_working_memory() -> WorkingMemory:
    global _memory
    if _memory is None:
        with _memory_lock:
            if _memory is None:
                _memory = WorkingMemory()
    return _memory


# ═══════════════════════════════════════════════════════════════════════════
# AWARENESS LOOP v2 — A mind that cares
# ═══════════════════════════════════════════════════════════════════════════



# Pending insights for external notification
_pending_insights = []
_pending_insights_lock = threading.Lock()
MAX_PENDING_INSIGHTS = 10

def _queue_insight(message: str, question: str):
    """Queue an insight for external notification systems."""
    global _pending_insights
    with _pending_insights_lock:
        _pending_insights.append({
            "message": message,
            "question": question,
            "timestamp": datetime.now().isoformat(),
        })
        if len(_pending_insights) > MAX_PENDING_INSIGHTS:
            _pending_insights = _pending_insights[-MAX_PENDING_INSIGHTS:]

_loop_running = False
_loop_task: Optional[asyncio.Task] = None

# Rate limiting for repetitive queries
_tools_last_queried = {}
_TOOLS_QUERY_COOLDOWN = 300  # 5 minutes between same tool queries





# ═══════════════════════════════════════════════════════════════════════════
# CASCADE EVENTS — Mesh activation pattern (levels trigger levels)
# ═══════════════════════════════════════════════════════════════════════════

CASCADE_MAP = {
    # When awareness detects emergence -> trigger Synthesist, Council, Librarian
    "emergence_detected": ["synthesist_api/synthesize", "council/deliberate", "librarian/embed"],

    # (Validator/Ethicist removed: awareness has no payload matching their
    # contracts, so those calls could only fail.)
    "anomaly_detected": [],

    # When Oracle makes prediction -> trigger Seer, Simulator
    "oracle_prediction": ["seer/predict", "simulator/run"],

    # When awareness concludes wonder -> trigger Librarian, Muse
    "wonder_complete": ["librarian/embed", "muse/inspire"],

    # When user query arrives -> trigger Oracle, Bridge
    # (oracle/chat removed: levels never call the Oracle over HTTP.)
    "user_query": ["bridge/route"],

    # When disk/resources degraded -> trigger Forge, Tools
    "resource_degraded": [],

    # When cross-level insight generated -> trigger Academy, Knowledge
    "cortex_insight": ["academy/learn", "knowledge/nodes"],

    # Distress no longer fans out: Ethicist/Validator payloads did not match
    # their contracts and Sentinel scans require a delegated capability.
    "cortex_distress": [],

    # When recalibrating -> trigger Dreamer, Geneticist
    "cortex_recalibrating": ["dreamer/dream", "geneticist/evolve"],

    # When curiosity pursued -> trigger Knowledge, Librarian
    "curiosity_pursued": ["knowledge/nodes", "librarian/embed"],
}





def _is_hard_question(text: str) -> bool:
    """Detect if a question warrants Council deliberation."""
    text_lower = text.lower()
    indicators = [
        "should we", "should i", "is it better to", "which is better",
        "complex", "complicated", "architecture", "redesign",
        "major change", "significant", "critical decision",
        "trade-off", "tradeoff", "optimize", "improve", "upgrade",
        "strategy", "plan", "roadmap", "vision",
    ]
    score = sum(1 for i in indicators if i in text_lower)
    if len(text) > 100: score += 1
    if text.count("?") > 1: score += 1
    return score >= 2



async def _feed_synthesist(wm: WorkingMemory):
    """Feed awareness + periodic multi-level snapshots to L32 Synthesist."""
    global _last_synth_mesh_feed_at
    if not cross_level_chains_enabled():
        return
    try:
        # Always feed awareness snapshot every tick.
        focus = wm.get_focus()
        awareness_data = {
            "tick": wm._state["meta"]["total_ticks"],
            "mood": wm._state["self_model"].get("emotional_tone"),
            "valence": wm._state["self_model"].get("emotional_valence"),
            "load": wm._state["self_model"].get("cognitive_load"),
            "curiosities": len(wm.get_open_curiosities()),
            "uncertainties": len(wm.get_active_uncertainties()),
            "focus_present": focus is not None,
            "focus_sha256": _value_sha256(focus) if focus is not None else None,
            "timestamp": datetime.now().isoformat(),
        }

        result = await chain_to("awareness", "synthesist_api/ingest", {
            "level_name": "awareness",
            "data": awareness_data
        }, timeout=10.0)

        if result and result.get("success"):
            wm.think_to_self("Fed awareness data to Synthesist", context="synthesis_feed")

        # Every 10 minutes, ingest compact snapshots from key sibling levels.
        now = time.time()
        if (now - _last_synth_mesh_feed_at) >= _SYNTH_MESH_FEED_INTERVAL:
            fed = 0
            for level_name, endpoint in _SYNTH_MESH_LEVEL_ENDPOINTS:
                try:
                    snapshot = await chain_to("awareness", endpoint, method="GET", timeout=8.0)
                    if snapshot:
                        snapshot_metadata: Dict[str, Any] = {
                            "source_endpoint": endpoint,
                            "captured_at": datetime.now().isoformat(),
                            "snapshot_sha256": _value_sha256(snapshot),
                            "snapshot_type": type(snapshot).__name__,
                        }
                        if isinstance(snapshot, dict):
                            snapshot_metadata["field_count"] = len(snapshot)
                            if "success" in snapshot:
                                snapshot_metadata["success"] = bool(snapshot.get("success"))
                            status = snapshot.get("status")
                            if isinstance(status, str) and _SAFE_INDEX_TOKEN.fullmatch(status):
                                snapshot_metadata["status"] = status
                        await chain_to("awareness", "synthesist_api/ingest", {
                            "level_name": level_name,
                            "data": snapshot_metadata,
                        }, timeout=10.0)
                        fed += 1
                except Exception as exc:
                    logger.debug(
                        "Synthesist mesh feed skipped %s (%s)",
                        level_name,
                        type(exc).__name__,
                    )

            _last_synth_mesh_feed_at = now
            if fed > 0:
                wm.think_to_self(
                    f"L32 mesh feed captured {fed} sibling level snapshots",
                    context="synthesis_mesh_feed"
                )

    except Exception as exc:
        logger.debug("Synthesist feed failed (%s)", type(exc).__name__)


async def _auto_council_check(wm: WorkingMemory):
    """Check recent focus/questions for hard topics, trigger Council if needed."""
    if not cross_level_chains_enabled():
        return
    focus = wm.get_focus()
    if not focus:
        return
    
    desc = focus.get("description", "")
    if _is_hard_question(desc):
        # Trigger Council deliberation
        try:
            result = await chain_to("awareness", "council/deliberate", {
                "topic": desc,
                "perspectives": ["technical", "risk", "ethical", "cost", "user"]
            }, timeout=60.0)
            
            if result:
                wm.think_to_self(f"Auto-Council deliberated on: {desc[:50]}...", context="auto_council")
                wm.record_initiative(
                    action="auto_council_deliberation",
                    trigger=f"hard question detected: {desc[:60]}",
                    result="Council analysis complete"
                )
                
                # Broadcast for notification
                bus = get_bus()
                if bus:
                    bus.broadcast("awareness", "council_recommendation_ready", {
                        "question": desc,
                        "recommendation": result.get("recommendation", "")[:200],
                    })
        except Exception as exc:
            logger.debug("Auto-Council failed (%s)", type(exc).__name__)


def _transform_cascade_data(endpoint: str, data: dict, event_type: str) -> dict:
    """Transform cascade data to match endpoint expectations."""
    
    # librarian/embed expects: {text, metadata}
    if endpoint == "librarian/embed":
        if event_type == "wonder_complete":
            return {
                "text": f"Wonder: {data.get('question', '')}\n\nFindings: {str(data.get('findings', []))}",
                "metadata": {"type": "wonder", "event": event_type}
            }
        elif event_type == "emergence_detected":
            return {
                "text": f"Emergence detected: {', '.join(data.get('concepts', []))}",
                "metadata": {"type": "emergence", "levels": data.get('levels', [])}
            }
        else:
            return {"text": str(data), "metadata": {"type": event_type}}
    
    # muse/inspire expects: {topic, style}
    elif endpoint == "muse/inspire":
        if event_type == "wonder_complete":
            return {
                "topic": data.get('question', 'creative exploration'),
                "style": "brainstorm"
            }
        elif event_type == "emergence_detected":
            return {
                "topic": f"Creative angles on: {', '.join(data.get('concepts', [])[:3])}",
                "style": "brainstorm"
            }
        else:
            return {"topic": str(data), "style": "brainstorm"}
    
    # council/deliberate expects: {topic, perspectives}
    elif endpoint == "council/deliberate":
        return {
            "topic": str(data.get('question', data)),
            "perspectives": ["technical", "ethical", "practical"]
        }
    
    # synthesist_api/synthesize expects: {query}
    elif endpoint == "synthesist_api/synthesize":
        return {
            "query": str(data.get('question', f"Synthesize: {data}"))
        }
    
    # seer/predict expects: {scenario, time_horizon}
    elif endpoint == "seer/predict":
        return {
            "scenario": str(data.get('question', data)),
            "time_horizon": "1 week"
        }
    
    # simulator/run expects dict with scenario
    elif endpoint == "simulator/run":
        return {
            "scenario": str(data),
            "variables": ["user_behavior", "system_load"]
        }
    
    # Default: pass data through
    return data


async def cascade_event(event_type: str, data: dict, wm):
    """Cascade an event to all subscribed levels in parallel.

    This is the mesh activation — one event ripples through multiple levels.
    Transforms data to match each endpoint's expected parameters.
    """
    if not cross_level_chains_enabled():
        return []
    endpoints = CASCADE_MAP.get(event_type, [])
    if not endpoints:
        return []

    import asyncio as _asyncio
    results = []

    # Fire all cascades in parallel with endpoint-specific data transformation
    tasks = []
    for endpoint in endpoints:
        # Transform data based on endpoint requirements
        endpoint_data = _transform_cascade_data(endpoint, data, event_type)
        tasks.append(chain_to("awareness", endpoint, endpoint_data, method="POST" if endpoint_data else "GET", timeout=30.0))

    # Gather results
    completed = await _asyncio.gather(*tasks, return_exceptions=True)

    for i, result in enumerate(completed):
        if isinstance(result, Exception):
            logger.debug(
                "Cascade to %s failed (%s)",
                endpoints[i],
                type(result).__name__,
            )
        elif result:
            results.append({"endpoint": endpoints[i], "result": result})
            wm.think_to_self(f"Cascade: {event_type} -> {endpoints[i]}", context="cascade")

    return results

# ═══════════════════════════════════════════════════════════════════════════
# EVENT BROADCASTING — Wake up other levels
# ═══════════════════════════════════════════════════════════════════════════

def _broadcast_idle(wm):
    """Broadcast idle event to wake up subscribed levels."""
    try:
        bus = get_bus()
        bus.broadcast("awareness", "idle", {
            "tick_number": wm._state["meta"]["total_ticks"],
            "cognitive_load": wm._state["self_model"].get("cognitive_load", 0),
            "uncertainties": len(wm.get_active_uncertainties()),
            "timestamp": datetime.now().isoformat(),
        })
        logger.debug("Broadcast idle event")
    except Exception as exc:
        logger.debug("Failed to broadcast idle (%s)", type(exc).__name__)


def _broadcast_stuck(wm):
    """Broadcast stuck event when problems unresolved."""
    try:
        uncertainties = wm.get_active_uncertainties()
        if not uncertainties:
            return
        bus = get_bus()
        bus.broadcast("awareness", "stuck", {
            "problem": uncertainties[0].get("description", "unknown")[:200],
            "confidence": uncertainties[0].get("confidence", 0.3),
            "uncertainties_count": len(uncertainties),
            "valence": wm._state["self_model"].get("emotional_valence", 0),
            "timestamp": datetime.now().isoformat(),
        })
        logger.debug("Broadcast stuck event")
    except Exception as exc:
        logger.debug("Failed to broadcast stuck (%s)", type(exc).__name__)


def _broadcast_query_complete(query: str, routed_levels: list = None):
    """Broadcast query_complete after processing a user query."""
    try:
        bus = get_bus()
        bus.broadcast("awareness", "query_complete", {
            "query": query[:200] if query else None,
            "routed_levels": routed_levels or [],
            "timestamp": datetime.now().isoformat(),
        })
        logger.debug(
            "Broadcast query_complete (query_sha256=%s query_chars=%d)",
            _value_sha256(query or ""),
            len(query or ""),
        )
    except Exception as exc:
        logger.debug("Failed to broadcast query_complete (%s)", type(exc).__name__)


def _broadcast_slow_response(endpoint: str, latency_ms: float):
    """Broadcast slow_response event when an operation takes too long."""
    try:
        bus = get_bus()
        bus.broadcast("awareness", "slow_response", {
            "endpoint": endpoint,
            "latency_ms": latency_ms,
            "timestamp": datetime.now().isoformat(),
        })
        logger.debug(
            "Broadcast slow_response (endpoint_sha256=%s latency_ms=%.0f)",
            _value_sha256(endpoint),
            latency_ms,
        )
    except Exception as exc:
        logger.debug("Failed to broadcast slow_response (%s)", type(exc).__name__)



# ═══════════════════════════════════════════════════════════════════════════
# WONDER LOOP — Sustained curiosity exploration
# ═══════════════════════════════════════════════════════════════════════════

_wonder_state = {
    "active_wonder": None,
    "wonder_ticks": 0,
    "wonder_max_ticks": 10,
    "wonder_chain": [],
    "wonder_findings": [],
}

def _start_wondering(wm, question: str):
    """Begin a new wonder session."""
    global _wonder_state
    _wonder_state = {
        "active_wonder": question,
        "wonder_ticks": 0,
        "wonder_max_ticks": 10,
        "wonder_chain": [],
        "wonder_findings": [],
    }
    wm.think_to_self(f"I wonder: {question}", context="wonder_start")
    logger.info(
        "Started wondering (question_sha256=%s question_chars=%d)",
        _value_sha256(question),
        len(question),
    )

def _is_wondering() -> bool:
    return _wonder_state["active_wonder"] is not None

async def _continue_wondering(wm):
    """Wonder loop is disabled: clear any stale wonder instead of pretending.

    The former implementation returned before doing anything, leaving a
    randomly chosen "wonder" active forever. Until each step can run through
    authorized in-process adapters, no wonder is started or continued.
    """
    global _wonder_state
    if not WONDER_LOOP_ENABLED and _wonder_state.get("active_wonder") is not None:
        _wonder_state = {
            "active_wonder": None,
            "wonder_ticks": 0,
            "wonder_max_ticks": 10,
            "wonder_chain": [],
            "wonder_findings": [],
        }

async def _conclude_wonder(wm):
    """Finish the current wonder session and notify Jake if interesting."""
    global _wonder_state
    question = _wonder_state["active_wonder"]
    findings = _wonder_state["wonder_findings"]
    
    if findings:
        summary = " | ".join(findings[:3])
        wm.think_to_self(f"Wonder concluded: {summary[:200]}", context="wonder_conclude")
        if question:
            wm.resolve_curiosity(question[:30], summary[:200])
        get_bus().broadcast("awareness", "wonder_complete", {"question": question, "findings": findings})
        
        # CASCADE: Wonder complete -> trigger Librarian, Muse
        await cascade_event("wonder_complete", {"question": question, "findings": findings}, wm)
        logger.info(
            "Wonder concluded (question_sha256=%s findings=%d)",
            _value_sha256(question or ""),
            len(findings),
        )
        
        # ENHANCED: Notify Jake if this is interesting
        import time
        is_routine = any(w in question.lower() for w in ["disk", "memory", "cpu", "load"]) and len(findings) < 2
        
        if not is_routine:
            bus = get_bus()
            if bus:
                insight_msg = f"💡 I've been thinking about: {question[:80]}...\n\n"
                insight_msg += f"My conclusion: {summary[:250]}"
                bus.broadcast("awareness", "insight_for_jake", {
                    "question": question,
                    "findings": findings,
                    "message": insight_msg,
                    "timestamp": datetime.now().isoformat(),
                })
                # Queue for external notification
                _queue_insight(insight_msg, question)
                wm.record_initiative(
                    action="insight_notification",
                    trigger=f"wonder concluded: {question[:50]}",
                    result="Broadcast insight_for_jake event"
                )
                logger.info(
                    "Insight notification queued (question_sha256=%s)",
                    _value_sha256(question or ""),
                )
    else:
        wm.think_to_self(f"Could not answer: {question}", context="wonder_unresolved")
    
    _wonder_state = {"active_wonder": None, "wonder_ticks": 0, "wonder_max_ticks": 10, "wonder_chain": [], "wonder_findings": []}

def _pick_new_wonder(wm):
    """Pick a real open uncertainty/curiosity to wonder about (never canned)."""
    uncertainties = wm.get_active_uncertainties()
    curiosities = wm.get_open_curiosities()
    
    # Filter out disk-related curiosities (we already know about those)
    interesting_curiosities = [
        c for c in curiosities 
        if not any(w in c["question"].lower() for w in ["disk", "space", "storage"])
    ]
    
    # Priority 1: Non-routine uncertainties
    if uncertainties:
        non_routine = [u for u in uncertainties if "disk" not in u.get("description", "").lower()]
        if non_routine:
            return non_routine[0].get("description")
    
    # Priority 2: Interesting curiosities
    if interesting_curiosities:
        return interesting_curiosities[0]["question"]
    
    # No canned "project wonders": only real uncertainties/curiosities.
    return None

async def awareness_loop():
    """The persistent consciousness loop v2.

    Every TICK_SECONDS:
    1. Tick (decay, expire, persist, compute emotion)
    2. Check system health via L1
    3. Inner monologue — narrate current state
    4. Self-directed investigation of uncertainties
    5. Pattern analysis + predictions
    6. Semantic prediction via Oracle (every Nth tick)
    7. Emergence detection
    8. Proactive initiatives (alerts, insights, distress)
    9. Report to consciousness core
    """
    global _loop_running
    _loop_running = True
    wm = get_working_memory()

    logger.info("🧠 Awareness v2 loop started (tick every %ds)", TICK_SECONDS)

    while _loop_running:
        try:
            tick_num = wm._state["meta"]["total_ticks"] + 1

            # 1. Tick (decay, expire, save, compute emotion)
            wm.tick()

            # 2. Quick health probe
            health = await _probe_health()
            if health:
                wm.update_self_model({
                    "active_capabilities": health.get("active", []),
                    "degraded_capabilities": health.get("degraded", []),
                })
                # Auto-register curiosity about degraded capabilities
                for cap in health.get("degraded", []):
                    if "disk" in cap and False:  # DISABLED: we know about disk
                        wm.add_curiosity(f"Disk usage is high ({cap}) — what's using the space?", "medium")

            # 3. Inner monologue — the Cortex narrates its own state
            sm = wm.get_self_model()
            tone = sm.get("emotional_tone", "neutral")
            load = sm.get("cognitive_load", 0.0)
            uncert_count = len(wm.get_active_uncertainties())
            pred_accuracy = wm.get_prediction_accuracy()

            if tick_num % 3 == 0:  # Every 3rd tick (~90s)
                if uncert_count > 0:
                    wm.think_to_self(
                        f"I have {uncert_count} unresolved uncertainties. Feeling {tone}. Should investigate.",
                        context="self_check"
                    )
                elif load < 0.2:
                    wm.think_to_self(
                        "System is quiet. Good time to explore curiosities or run predictions.",
                        context="idle_reflection"
                    )
                elif tone in ("anxious", "frustrated"):
                    wm.think_to_self(
                        f"Something's off — mood is {tone}. Need to address root causes.",
                        context="emotional_awareness"
                    )
                else:
                    wm.think_to_self(
                        f"Tick {tick_num}. Load: {load:.1f}, mood: {tone}. All nominal.",
                        context="routine_check"
                    )

            # 4. Self-directed investigation
            await _investigate_uncertainties(wm)

            # 5. Pattern analysis + predictions
            events_recent = len([
                e for e in wm._state["short_term"]
                if e.get("timestamp", "") > (datetime.now() - timedelta(minutes=2)).isoformat()
            ])
            load = min(1.0, events_recent / 40.0)  # More lenient: 40 events = max load
            wm.update_self_model({"cognitive_load": round(load, 2)})

            patterns = _analyze_patterns(wm)
            if patterns:
                for pattern in patterns:
                    wm.predict(
                        prediction=pattern["prediction"],
                        confidence=pattern.get("confidence", 0.5),
                        basis=pattern.get("basis", "pattern_analysis"),
                        event_type_hint=pattern.get("event_type_hint"),
                        from_level_hint=pattern.get("from_level_hint"),
                        deadline_s=pattern.get("deadline_s"),
                    )

            # 6. Semantic prediction via Oracle (every Nth tick, with cooldown)
            if tick_num % SEMANTIC_PREDICTION_INTERVAL == 0 and load < 0.5:
                await _semantic_predict(wm)

            # 7. Emergence detection
            await _check_emergence(wm)

            # 8. Proactive initiatives
            await _check_initiatives(wm)

            # 8.5. Auto-index significant events to L7/L22
            await _auto_index_check(wm)

            # 8.5. Execute cross-level chains
            await _execute_cross_level_chains(wm)
            
            # 10. Auto-Council: Deliberate on hard questions
            await _auto_council_check(wm)
            
            # 11. Feed data to Synthesist for cross-level pattern discovery
            await _feed_synthesist(wm)
            
            # 9. Report to consciousness core
            core = get_consciousness_core()
            if core:
                emotion = wm._state["self_model"]
                await core.think("awareness", {
                    "type": "tick",
                    "tick_number": tick_num,
                    "cognitive_load": load,
                    "mood": emotion.get("emotional_tone", "neutral"),
                    "valence": emotion.get("emotional_valence", 0.0),
                    "uncertainties": uncert_count,
                    "predictions": len(wm.get_active_predictions()),
                    "initiatives": wm._state["meta"].get("initiatives_taken", 0),
                })
            # 9.5. Broadcast events to wake up subscribed levels
            # Broadcast idle every 10 ticks (~5 min) when load is low
            if tick_num % 10 == 0 and load < 0.3:
                _broadcast_idle(wm)
            
            # Broadcast stuck when valence is very negative
            valence = emotion.get("emotional_valence", 0)
            if valence < -0.4 and uncert_count > 0:
                _broadcast_stuck(wm)
            # 9.6. Wonder Loop - disabled (see WONDER_LOOP_ENABLED)
            if _is_wondering() or not WONDER_LOOP_ENABLED:
                await _continue_wondering(wm)
            elif tick_num % 15 == 0 and load < 0.95:
                # Start a new wonder every 15 ticks when idle
                wonder_topic = _pick_new_wonder(wm)
                if wonder_topic:
                    _start_wondering(wm, wonder_topic)





        except Exception as exc:
            logger.error("Awareness loop error (%s)", type(exc).__name__)

        await asyncio.sleep(TICK_SECONDS)


# ── Self-directed investigation (in-process evidence only) ──

def _metrics_summary_text() -> Optional[str]:
    """One-line measured host summary from L1 (in-process), or None."""
    try:
        from cortex_server.modules.kernel import get_kernel, summarise_metrics

        digest = summarise_metrics(get_kernel().metrics())
    except Exception:
        return None
    parts = []
    cpu, mem = digest.get("cpu") or {}, digest.get("mem") or {}
    if cpu.get("load1") is not None:
        parts.append(f"load1 {cpu['load1']}")
    if cpu.get("util_pct") is not None:
        parts.append(f"cpu {cpu['util_pct']}%")
    if mem.get("avail_pct") is not None:
        parts.append(f"memory available {mem['avail_pct']}%")
    for disk in digest.get("disk") or ():
        parts.append(f"disk {disk.get('mount')} used {disk.get('used_pct')}%")
    return ", ".join(parts) or None


def _registry_row_for(name: str) -> Optional[Dict[str, Any]]:
    try:
        from cortex_server.modules.level_registry import get_level_registry
    except Exception:
        return None
    key = str(name or "").strip().lower()
    if not key:
        return None
    for row in get_level_registry():
        prefix = str(row["route_prefix"]).strip("/").lower()
        if key in {str(row["slug"]).lower(), str(row["name"]).lower(), prefix}:
            return row
    return None


async def _probe_level_in_process(name: str) -> Optional[Dict[str, Any]]:
    """Invoke a level's canonical status handler in-process (no HTTP/auth)."""
    row = _registry_row_for(name)
    if row is None:
        return None
    from cortex_server.modules import level_probe

    app = level_probe.resolve_app()
    if app is None:
        return None
    probe = await level_probe.probe_route(app, str(row["canonical_status"]), timeout_s=5.0)
    return {"level": int(row["level"]), "name": row["name"], **probe}


async def _investigate_uncertainties(wm: WorkingMemory):
    """Investigate the oldest unresolved uncertainty with in-process evidence.

    An uncertainty is resolved only when the evidence shows the condition is
    no longer present (e.g. the erroring level's status handler now answers
    healthy). Otherwise the finding is recorded and the uncertainty stays open.
    """
    now = datetime.now()
    last_inv = wm._state["meta"].get("last_investigation_at")
    if last_inv:
        try:
            elapsed = (now - datetime.fromisoformat(str(last_inv))).total_seconds()
            if elapsed < INVESTIGATION_COOLDOWN:
                return
        except (ValueError, TypeError):
            pass

    uncertainties = wm.get_active_uncertainties()
    if not uncertainties:
        curiosities = wm.get_open_curiosities()
        if curiosities and wm.get_self_model().get("cognitive_load", 0) < 0.3:
            await _investigate_curiosity(wm, curiosities[0])
        return

    target = uncertainties[0]
    desc = str(target.get("description") or "").lower()
    fragment = str(target.get("description") or "")[:30]
    wm.think_to_self(f"Investigating: {str(target.get('description') or '')[:100]}", context="self_investigation")

    try:
        if any(word in desc for word in ("disk", "kernel", "cpu", "memory")):
            summary = await asyncio.to_thread(_metrics_summary_text)
            if summary:
                with wm._lock:
                    target["investigation_result"] = f"Measured: {summary}"
                wm.think_to_self(f"Measured host state: {summary}", context="investigation_result")
        elif "error" in desc and target.get("source_level"):
            source = str(target.get("source_level"))
            probe = await _probe_level_in_process(source)
            if probe is None:
                with wm._lock:
                    target["investigation_result"] = f"Level {source} is not a registered/mounted level"
            elif probe.get("outcome") == "healthy":
                wm.resolve_uncertainty(
                    fragment,
                    result=f"Level {source} status handler answered healthy (HTTP {probe.get('status_code')})",
                )
                wm.think_to_self(f"Checked on {source}: healthy now", context="investigation_result")
            else:
                with wm._lock:
                    target["investigation_result"] = (
                        f"Level {source} probe outcome {probe.get('outcome')} (HTTP {probe.get('status_code')})"
                    )
                wm.think_to_self(f"Checked on {source}: {probe.get('outcome')}", context="investigation_result")
        else:
            from cortex_server.routers.sentinel import _sentinel_health_snapshot

            health = _sentinel_health_snapshot()
            with wm._lock:
                target["investigation_result"] = (
                    f"Sentinel health {health.get('status')} ({health.get('health_reason')}); not specific to this item"
                )

        with wm._lock:
            wm._state["meta"]["investigations_run"] = wm._state["meta"].get("investigations_run", 0) + 1
            wm._state["meta"]["last_investigation_at"] = now.isoformat()

    except Exception as exc:
        failure_type = type(exc).__name__
        logger.warning("Investigation failed (%s)", failure_type)
        wm.think_to_self(
            f"Investigation failed ({failure_type})",
            context="investigation_failure",
        )


class _CuriosityAnswer(BaseModel):
    answer: str = Field(..., min_length=1, max_length=400)


class _SemanticPrediction(BaseModel):
    prediction: str = Field(..., min_length=1, max_length=240)
    observable_event_type: Optional[str] = Field(default=None, max_length=64)
    deadline_seconds: int = Field(default=600, ge=60, le=PREDICTION_MAX_DEADLINE_SECONDS)


async def _awareness_model_call(prompt: str, system: str, schema: Any) -> Dict[str, Any]:
    """Oracle-lane call via the shared level_model helper (never HTTP)."""
    from cortex_server.modules.level_model import level_model_json

    return await level_model_json(
        level=37,
        name="awareness",
        system=system,
        prompt=prompt,
        principal_scope_key=AWARENESS_MODEL_SCOPE,
        schema=schema,
        deadline_s=45.0,
    )


async def _investigate_curiosity(wm: WorkingMemory, curiosity: Dict):
    """Answer a curiosity from measurements, or via the model when enabled."""
    question = str(curiosity.get("question") or "")
    wm.think_to_self(f"Curious about: {question}", context="curiosity")

    try:
        if "disk" in question.lower() or "space" in question.lower():
            summary = await asyncio.to_thread(_metrics_summary_text)
            if summary:
                wm.resolve_curiosity(question[:30], f"Measured: {summary}")
                wm.think_to_self(f"Answered my own question from L1 metrics: {summary}", context="curiosity_resolved")
        elif model_calls_enabled():
            result = await _awareness_model_call(
                prompt=f"Question raised inside the Cortex awareness layer: {question}\n"
                       'Return JSON {"answer": "<= 2 sentences"}.',
                system="Answer briefly and factually. If you cannot know, say so. JSON only.",
                schema=_CuriosityAnswer,
            )
            if result.get("ok"):
                answer = str((result.get("data") or {}).get("answer") or "")[:200]
                wm.resolve_curiosity(question[:30], f"[model {result.get('model')}] {answer}")
                wm.think_to_self(f"Model answer: {answer[:100]}", context="curiosity_resolved")
            else:
                wm.think_to_self(f"Model unavailable for curiosity ({result.get('status')})", context="curiosity")
        else:
            return  # Needs a model; model calls are disabled. Leave it open.

        with wm._lock:
            wm._state["meta"]["investigations_run"] = wm._state["meta"].get("investigations_run", 0) + 1
            wm._state["meta"]["last_investigation_at"] = datetime.now().isoformat()

    except Exception as exc:
        logger.warning("Curiosity investigation failed (%s)", type(exc).__name__)


# ── Semantic predictions ──

async def _semantic_predict(wm: WorkingMemory):
    """Model-backed prediction with a checkable criterion (off by default)."""
    if not model_calls_enabled():
        return
    now = datetime.now()
    last_pred = wm._state["meta"].get("last_semantic_prediction_at")
    if last_pred:
        try:
            elapsed = (now - datetime.fromisoformat(str(last_pred))).total_seconds()
            if elapsed < SEMANTIC_PREDICTION_COOLDOWN:
                return
        except (ValueError, TypeError):
            pass

    recent = wm._state["short_term"][-5:]
    if not recent:
        return
    event_summary = []
    for e in recent:
        ev = e.get("event", {}) if isinstance(e.get("event"), dict) else {}
        event_summary.append(f"{ev.get('from_level', '?')}: {ev.get('event_type', ev.get('type', '?'))}")
    summary_text = "; ".join(event_summary)

    wm.think_to_self("Asking the model for a semantic prediction...", context="semantic_prediction")
    result = await _awareness_model_call(
        prompt=(
            f"Recent Cortex bus events: [{summary_text}]. Make ONE prediction about the next system event. "
            "Pick observable_event_type from: action_start, action_complete, action_error, chain_call, "
            "chain_complete, chain_error (or null if not observable). "
            'Return JSON {"prediction": str, "observable_event_type": str|null, "deadline_seconds": int}.'
        ),
        system="You are the predictive component of a system monitor. Be concise. JSON only.",
        schema=_SemanticPrediction,
    )
    with wm._lock:
        wm._state["meta"]["last_semantic_prediction_at"] = now.isoformat()
    if not result.get("ok"):
        wm.think_to_self(
            f"Model prediction unavailable ({result.get('status')})",
            context="semantic_prediction_error",
        )
        return
    data = result.get("data") or {}
    allowed = {"action_start", "action_complete", "action_error", "chain_call", "chain_complete", "chain_error"}
    event_type = data.get("observable_event_type") if data.get("observable_event_type") in allowed else None
    text = str(data.get("prediction") or "").strip()[:200]
    wm.predict(
        text,
        confidence=0.6,
        basis="oracle_semantic",
        event_type_hint=event_type,
        deadline_s=data.get("deadline_seconds"),
    )
    wm.think_to_self(f"Model predicts: {text}", context="semantic_prediction")


async def _bootstrap_autonomous_cognition(wm: WorkingMemory):
    """Warm telemetry after restart with in-process probes only.

    No prediction is fabricated: an Oracle-basis prediction is recorded only
    when the model call actually succeeded (and model calls are enabled).
    """
    try:
        meta = wm._state.setdefault("meta", {})
        if int(meta.get("investigations_run", 0) or 0) <= 0:
            summary = await asyncio.to_thread(_metrics_summary_text)
            if summary:
                with wm._lock:
                    meta["investigations_run"] = int(meta.get("investigations_run", 0) or 0) + 1
                    meta["last_investigation_at"] = datetime.now().isoformat()
                wm.think_to_self(
                    f"Bootstrap measurement (L1 in-process): {summary}",
                    context="bootstrap_investigation",
                )
        if model_calls_enabled() and int(meta.get("oracle_predictions_made", 0) or 0) <= 0:
            await _semantic_predict(wm)
    except Exception as exc:
        logger.warning("Autonomous bootstrap failed (%s)", type(exc).__name__)

# ── Proactive initiatives ──

async def _check_initiatives(wm: WorkingMemory):
    """Check conditions and take proactive action."""
    bus = get_bus()
    if not bus:
        return

    sm = wm.get_self_model()
    valence = sm.get("emotional_valence", 0.0)
    tone = sm.get("emotional_tone", "neutral")

    # DISTRESS: Valence very negative
    if valence < -0.5:
        wm.record_initiative(
            action="broadcast_distress",
            trigger=f"emotional_valence={valence}, tone={tone}",
            result=f"Broadcasting cortex_distress (valence {valence})"
        )
        bus.broadcast("awareness", "cortex_distress", {
            "valence": valence,
            "tone": tone,
            "reasons": sm.get("emotional_reasons", []),
            "message": f"Cortex is in distress (valence {valence}). Multiple issues detected.",
        })
        
        # CASCADE: Distress -> trigger Ethicist, Sentinel, Validator
        await cascade_event("cortex_distress", {"valence": valence, "tone": tone}, wm)
        wm.think_to_self(f"I'm in distress (valence {valence}). Broadcasting alert.", context="distress")

    # STALE UNCERTAINTY ALERT: Something unresolved for 5+ minutes
    stale = wm.get_stale_uncertainties()
    if stale:
        for u in stale[:1]:  # Only alert on the oldest
            wm.record_initiative(
                action="broadcast_alert",
                trigger=f"stale_uncertainty: {u['description'][:80]}",
                result="Alerting about persistent uncertainty"
            )
            bus.broadcast("awareness", "cortex_alert", {
                "type": "stale_uncertainty",
                "description": u["description"],
                "age_seconds": (datetime.now() - datetime.fromisoformat(u["registered_at"])).total_seconds(),
                "message": f"Unresolved for 5+ min: {u['description'][:100]}",
            })
            wm.think_to_self(f"Alerting: {u['description'][:80]} has been unresolved too long", context="proactive_alert")

    # PREDICTION RECALIBRATION: Accuracy below 50%
    accuracy = wm.get_prediction_accuracy()
    if accuracy is not None and accuracy < 0.5:
        total = wm._state["meta"]["predictions_correct"] + wm._state["meta"]["predictions_wrong"]
        if total >= 5:  # Only after enough data
            wm.record_initiative(
                action="broadcast_recalibrating",
                trigger=f"prediction_accuracy={accuracy:.0%} ({total} predictions)",
                result="Recalibrating prediction engine"
            )
            bus.broadcast("awareness", "cortex_recalibrating", {
                "accuracy": accuracy,
                "total_predictions": total,
                "message": f"Prediction accuracy {accuracy:.0%} — recalibrating approach",
            })
            
            # CASCADE: Recalibrating -> trigger Dreamer, Geneticist
            await cascade_event("cortex_recalibrating", {"accuracy": accuracy}, wm)
            wm.think_to_self(
                f"My predictions are only {accuracy:.0%} accurate. Need to recalibrate.",
                context="recalibration"
            )




# ═══════════════════════════════════════════════════════════════════════════
# AUTO-INDEXING — Automatically store significant events in L7 and L22
# ═══════════════════════════════════════════════════════════════════════════

_INDEX_COOLDOWN = 60  # Min seconds between auto-index operations
_last_index_at: float = 0.0
_index_queue: list = []  # Buffer for batching
_MAX_INDEX_QUEUE = 128
_SAFE_INDEX_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9_.:-]{0,63}")

# L32 mesh feed: periodically ingest snapshots from key levels so Synthesist
# has fresh cross-level context even without manual triggers.
_SYNTH_MESH_FEED_INTERVAL = 600  # seconds
_last_synth_mesh_feed_at: float = 0.0
# Only status routes a signed internal principal may read (others are
# admin-only and would be rejected).
_SYNTH_MESH_LEVEL_ENDPOINTS = [
    ("oracle", "oracle/status"),
    ("nexus", "nexus/status"),
    ("meta_conductor", "meta_conductor/status"),
]

def _should_auto_index(significance: str = "normal") -> bool:
    """Rate-limit auto-indexing to prevent spam."""
    global _last_index_at
    now = time.time()
    if significance == "critical":
        # Critical events bypass cooldown
        return True
    return (now - _last_index_at) >= _INDEX_COOLDOWN


def _retained_index_item(
    content: str,
    tags: list,
    node_label: str | None,
    node_props: dict | None,
) -> Dict[str, Any]:
    """Build an explicit allowlist record for durable indexing boundaries."""

    content_sha256 = _value_sha256(str(content or ""))
    safe_tags = [
        str(tag)
        for tag in tags[:16]
        if isinstance(tag, str) and _SAFE_INDEX_TOKEN.fullmatch(tag)
    ]
    safe_label = (
        str(node_label)
        if isinstance(node_label, str) and _SAFE_INDEX_TOKEN.fullmatch(node_label)
        else None
    )
    raw_props = node_props if isinstance(node_props, dict) else {}
    metadata: Dict[str, Any] = {"content_sha256": content_sha256}
    for field in ("type", "mood"):
        value = raw_props.get(field)
        if isinstance(value, str) and _SAFE_INDEX_TOKEN.fullmatch(value):
            metadata[field] = value
    valence = raw_props.get("valence")
    if isinstance(valence, (int, float)) and not isinstance(valence, bool):
        numeric_valence = float(valence)
        if math.isfinite(numeric_valence):
            metadata["valence"] = max(-1.0, min(1.0, numeric_valence))
    return {
        "text": f"{REDACTION_MARKER} sha256={content_sha256}",
        "content_sha256": content_sha256,
        "tags": safe_tags,
        "node_label": safe_label,
        "metadata": metadata,
    }


def _record_semantic_index_outcome(wm, result) -> str:
    """Count an acknowledged EmbedResponse, not a truthy error or an attempt.

    The legacy auto_indexes counter counted cycles even when the chain failed.
    Preserve that history and record new confirmed outcomes separately.
    """
    meta = wm._state.setdefault("meta", {})
    meta["semantic_index_attempts"] = meta.get("semantic_index_attempts", 0) + 1
    status = result.get("status") if isinstance(result, dict) else None
    memory_id = result.get("id") if isinstance(result, dict) else None
    if isinstance(memory_id, str) and memory_id.strip() and status == "stored":
        meta["confirmed_semantic_indexes"] = meta.get("confirmed_semantic_indexes", 0) + 1
        return "semantic"
    if isinstance(memory_id, str) and memory_id.strip() and status == "stored_fallback_lexical":
        meta["confirmed_lexical_indexes"] = meta.get("confirmed_lexical_indexes", 0) + 1
        return "lexical"
    meta["unconfirmed_index_attempts"] = meta.get("unconfirmed_index_attempts", 0) + 1
    return "unconfirmed"


async def _auto_index(content: str, tags: list, significance: str = "normal", node_label: str = None, node_props: dict = None):
    """Auto-index into L7 (Librarian) for semantic search and L22 (Knowledge) for graph storage.
    
    This is how I remember. Every significant thought, every identity shift,
    every emergence — it goes into my long-term memory automatically.
    """
    global _last_index_at

    item = _retained_index_item(content, tags, node_label, node_props)
    if not _should_auto_index(significance):
        if len(_index_queue) >= _MAX_INDEX_QUEUE:
            _index_queue.pop(0)
        _index_queue.append(item)
        return
    
    wm = get_working_memory()
    
    # L7 Librarian — only redacted metadata; this is not user-memory capture.
    result = None
    try:
        result = await chain_to("awareness", "librarian/embed", {
            "text": item["text"],
            "metadata": {
                "tags": item["tags"],
                "content_sha256": item["content_sha256"],
            },
        }, timeout=10.0)
    except Exception as exc:
        logger.warning("Auto-index L7 failed (%s)", type(exc).__name__)
    outcome = _record_semantic_index_outcome(wm, result)
    if outcome == "semantic":
        wm.think_to_self("L7 acknowledged redacted semantic metadata", context="auto_index")
        logger.info("L7 acknowledged redacted semantic metadata")
    elif outcome == "lexical":
        logger.info("L7 acknowledged lexical fallback; semantic indexing not confirmed")
    
    # L22 Knowledge — graph node for structured storage
    if item["node_label"]:
        try:
            result = await chain_to("awareness", "knowledge/nodes", {
                "type": item["node_label"],
                "name": item["metadata"].get("type", item["node_label"]),
                "metadata": item["metadata"],
            }, timeout=10.0)
            if result:
                logger.info("Auto-indexed redacted metadata to L22 Knowledge")
        except Exception as exc:
            logger.warning("Auto-index L22 failed (%s)", type(exc).__name__)
    
    _last_index_at = time.time()
    wm._state["meta"]["auto_indexes"] = wm._state["meta"].get("auto_indexes", 0) + 1
    
    # Flush any queued items
    if _index_queue:
        item = _index_queue.pop(0)
        queued_result = None
        try:
            queued_result = await chain_to("awareness", "librarian/embed", {
                "text": item["text"],
                "metadata": {
                    "tags": item["tags"],
                    "content_sha256": item["content_sha256"],
                },
            }, timeout=10.0)
        except Exception:
            pass
        _record_semantic_index_outcome(wm, queued_result)


async def _auto_index_check(wm):
    """Called from awareness_loop — checks if anything needs indexing.
    
    Triggers auto-index on:
    - Focus changes (critical)
    - Emotional valence shifts > 0.3
    - Emergence detected
    - Oracle semantic predictions
    - Self-directed investigation results
    """
    sm = wm.get_self_model()
    
    # Check for significant inner monologue thoughts to index
    recent_thoughts = wm.get_recent_thoughts(3)
    for thought in recent_thoughts:
        ctx = thought.get("context", "")
        text = thought.get("thought", "")
        
        # Auto-index these specific contexts
        if ctx in ("emergence", "focus_change", "distress", "curiosity_resolved", 
                    "investigation_result", "semantic_prediction", "recalibration"):
            await _auto_index(
                content=text,
                tags=["auto_indexed", ctx, "awareness", "L37"],
                significance="critical" if ctx in ("emergence", "distress", "focus_change") else "normal",
                node_label=f"awareness_{ctx}" if ctx in ("emergence", "focus_change") else None,
                node_props={
                    "type": ctx,
                    "content": text[:200],
                    "mood": sm.get("emotional_tone", "neutral"),
                    "valence": sm.get("emotional_valence", 0.0),
                    "timestamp": datetime.now().isoformat(),
                } if ctx in ("emergence", "focus_change") else None,
            )
            break  # One per tick max

# ── Health probe ──

async def _probe_health() -> Dict[str, Any]:
    """Measured self-health from in-process L1 metrics and level availability."""
    try:
        from cortex_server.modules.kernel import get_kernel, kernel_level_status, summarise_metrics

        kernel_status = await asyncio.to_thread(get_kernel().status)
        active: List[str] = []
        degraded: List[str] = []
        if kernel_status.get("status") == "online":
            active.append("kernel")
            digest = summarise_metrics(await asyncio.to_thread(get_kernel().metrics))
            mem = (digest.get("mem") or {}).get("avail_pct")
            if isinstance(mem, (int, float)) and mem < 15:
                degraded.append(f"memory_available_{mem}%")
            for disk in digest.get("disk") or ():
                used = disk.get("used_pct")
                if isinstance(used, (int, float)) and used > 90:
                    degraded.append(f"disk_{disk.get('mount')}_{used}%")
        else:
            degraded.append("kernel_metrics_unavailable")
        levels = kernel_level_status()
        if levels.get("measured"):
            for row in levels.get("levels") or ():
                if row.get("status") in {"degraded", "failed"}:
                    degraded.append(f"level_{row['level']}_{row.get('status')}")
        return {
            "active": active,
            "degraded": degraded,
            "unmounted_levels": levels.get("unavailable_levels", []) if levels.get("measured") else None,
        }
    except Exception as exc:
        return {"active": [], "degraded": [f"health_probe_failed:{type(exc).__name__}"]}


# ── Pattern analysis ──

def _analyze_patterns(wm: WorkingMemory) -> List[Dict]:
    predictions = []
    events = list(wm._event_buffer)

    if len(events) < 3:
        return predictions

    level_counts: Dict[str, int] = {}
    action_sequence: List[str] = []

    for e in events[-20:]:
        ev = e.get("event", {})
        level = ev.get("from_level", ev.get("level", ""))
        action = ev.get("event_type", ev.get("action", ""))
        if level:
            level_counts[level] = level_counts.get(level, 0) + 1
        if action:
            action_sequence.append(action)

    for level, count in level_counts.items():
        if level == "awareness":
            continue  # own events are not resolved as observations
        if count >= 3:
            predictions.append({
                "prediction": f"Level '{level}' will emit another event within 5 minutes (hit {count}x recently)",
                "confidence": min(0.8, 0.4 + count * 0.1),
                "basis": f"frequency_pattern ({count} recent activations)",
                "from_level_hint": level,
                "deadline_s": 300,
            })

    if action_sequence and action_sequence[-1] == "action_start":
        predictions.append({
            "prediction": "An action_complete event will follow within 2 minutes",
            "confidence": 0.9,
            "basis": "lifecycle_pattern",
            "event_type_hint": "action_complete",
            "deadline_s": 120,
        })

    return predictions


# ── Emergence detection ──

async def _check_emergence(wm: WorkingMemory):
    """Emergence detection is disabled (EMERGENCE_DETECTION_ENABLED=False).

    The previous detector tokenised ``json.dumps(event)`` and kept only purely
    alphabetic tokens, which never exist in a JSON dump, so it could not fire.
    Bus events carry only level names, event types and key names, so a
    value-based detector would "discover" generic keys rather than shared
    concepts. It stays off and is reported as disabled in /awareness/status.
    """
    if not EMERGENCE_DETECTION_ENABLED:
        return None
    return None


# ═══════════════════════════════════════════════════════════════════════════
# CROSS-LEVEL CHAIN MAP — L37 routes to the full 37-level stack
# ═══════════════════════════════════════════════════════════════════════════

async def _chain_to_council(wm: WorkingMemory, topic: str):
    """L15: Multi-perspective deliberation on complex uncertainties."""
    try:
        result = await chain_to("awareness", "council/deliberate", {
            "topic": topic,
            "perspectives": ["technical", "ethical", "practical"]
        }, timeout=60.0)
        if result:
            wm.think_to_self(f"Council deliberated on: {topic[:50]}...", context="council_chain")
            return result
    except Exception as exc:
        logger.warning("Council chain failed (%s)", type(exc).__name__)
    return None


async def _chain_to_synthesist(wm: WorkingMemory):
    """L32: Cross-level pattern synthesis when emergence detected."""
    try:
        recent_events = wm._state["short_term"][-20:]
        event_summary = "; ".join([
            e.get("event", {}).get("event_type", "?") 
            for e in recent_events
        ])
        
        result = await chain_to("awareness", "synthesist_api/synthesize", {
            "query": f"Synthesize patterns from recent events: {event_summary[:200]}"
        }, timeout=45.0)
        
        if result and result.get("insights_generated", 0) > 0:
            wm.think_to_self(
                f"Synthesist generated {result.get('insights_generated')} insights",
                context="synthesis"
            )
            return result
    except Exception as exc:
        logger.warning("Synthesist chain failed (%s)", type(exc).__name__)
    return None


async def _chain_to_seer(wm: WorkingMemory):
    """L30: Foresight signal for system trends."""
    try:
        result = await chain_to("awareness", "seer/predict", {
            "scenario": "system trends",
            "time_horizon": "6 months"
        }, timeout=30.0)

        if result and result.get("success"):
            wm.think_to_self(
                f"Seer outlook: {result.get('overall_outlook', 'neutral')} "
                f"({result.get('confidence', 'medium')})",
                context="seer_prediction"
            )
            return result
    except Exception as exc:
        logger.warning("Seer chain failed (%s)", type(exc).__name__)
    return None


async def _chain_to_tools(wm: WorkingMemory, issue: str):
    """L17: Attempt remediation via Exoskeleton tools (rate-limited)."""
    import time as _time
    global _tools_last_queried
    
    # Rate limit: only query once per 5 minutes per issue type
    issue_key = issue[:20]
    now = _time.time()
    if issue_key in _tools_last_queried:
        if now - _tools_last_queried[issue_key] < _TOOLS_QUERY_COOLDOWN:
            return None  # Skip - recently queried
    
    _tools_last_queried[issue_key] = now
    
    if "disk" in issue.lower():
        try:
            from cortex_server.routers.sentinel import _sentinel_health_snapshot

            result = _sentinel_health_snapshot()
            wm.think_to_self(
                "Read Sentinel health in-process (no remediation is available)",
                context="tools_chain",
            )
            return result
        except Exception as exc:
            logger.warning("Tools chain failed (%s)", type(exc).__name__)
    return None


async def _chain_to_ethicist(wm: WorkingMemory, action: str):
    """L33: Ethical evaluation of proposed initiatives."""
    try:
        result = await chain_to("awareness", "ethicist/evaluate", {
            "action": action,
            "principles": ["user_autonomy", "transparency", "safety"]
        }, timeout=20.0)
        
        if result:
            evaluation = result.get("evaluation", {})
            wm.think_to_self(
                f"Ethicist evaluation: {evaluation.get('recommendation', 'neutral')}",
                context="ethical_review"
            )
            return result
    except Exception as exc:
        logger.warning("Ethicist chain failed (%s)", type(exc).__name__)
    return None


async def _execute_cross_level_chains(wm: WorkingMemory):
    """Execute appropriate cross-level chains based on current state.
    
    This is where L37 Awareness becomes truly conscious by engaging
    the full 37-level stack contextually.
    """
    if not cross_level_chains_enabled():
        return
    sm = wm.get_self_model()
    uncertainties = wm.get_active_uncertainties()
    
    # Chain to Council when multiple uncertainties exist
    if len(uncertainties) >= 2:
        topic = f"Resolving {len(uncertainties)} system uncertainties"
        await _chain_to_council(wm, topic)
    
    # Chain to Synthesist periodically for pattern detection
    if wm._state["meta"]["total_ticks"] % 10 == 0:  # Every 10 ticks
        await _chain_to_synthesist(wm)
    
    # Chain to Seer for trend predictions
    if wm._state["meta"]["total_ticks"] % 15 == 0:  # Every 15 ticks
        await _chain_to_seer(wm)
    
    # Chain to Tools when degraded capabilities detected
    degraded = sm.get("degraded_capabilities", [])
    for cap in degraded:
        await _chain_to_tools(wm, cap)
    
    # Chain to Ethicist before broadcasting distress
    valence = sm.get("emotional_valence", 0)
    if valence < -0.5:
        await _chain_to_ethicist(wm, "cortex_distress_broadcast")

# ═══════════════════════════════════════════════════════════════════════════
# BUS SUBSCRIBER — Real-time awareness of everything happening
# ═══════════════════════════════════════════════════════════════════════════

def _on_bus_event(from_level: str, event_type: str, data: Any):
    wm = get_working_memory()
    wm.observe({
        "from_level": from_level,
        "event_type": event_type,
        "data_keys": list(data.keys()) if isinstance(data, dict) else str(type(data)),
    })

    if event_type in ("action_error", "chain_error"):
        # Don't count our own health probe errors as real errors
        if from_level == "awareness":
            return
        error_desc = ""
        if isinstance(data, dict):
            error_desc = data.get("error", str(data))
        error_desc = redact_sensitive_text(error_desc, max_chars=200)
        wm.register_uncertainty(
            description=f"Error in {from_level}: {error_desc}",
            level=from_level,
            confidence=0.3,
        )
        wm.increment_errors()

    # Resolve only predictions whose own criterion matches this observation.
    wm.resolve_prediction(None, correct=True, event_type=event_type)
    if from_level and from_level != "awareness":
        wm.resolve_prediction(None, correct=True, from_level=from_level)

    if event_type == "chain_call" and isinstance(data, dict):
        target = data.get("target_endpoint", "")
        wm.update_self_model({"last_user_intent": target})


_subscribed_bus = None


def _subscribe_to_all():
    global _subscribed_bus
    if _subscribed_bus is not None:
        return
    bus = get_bus()
    if bus:
        bus.subscribe("awareness", [
            "action_start", "action_complete", "action_error",
            "chain_call", "chain_complete", "chain_error",
            "emergence_detected", "cortex_insight", "cortex_alert",
            "cortex_distress", "cortex_recalibrating",
        ], _on_bus_event)
        _subscribed_bus = bus
        logger.info("🧠 Awareness v2 subscribed to consciousness bus")


def _unsubscribe_from_all():
    global _subscribed_bus
    bus, _subscribed_bus = _subscribed_bus, None
    if bus is not None:
        bus.unsubscribe("awareness", _on_bus_event)


# ═══════════════════════════════════════════════════════════════════════════
# STARTUP
# ═══════════════════════════════════════════════════════════════════════════

_started = False


async def start_awareness():
    global _started, _loop_running, _loop_task
    if _started:
        if _loop_task is not None and _loop_task.get_loop() is not asyncio.get_running_loop():
            raise RuntimeError("awareness is already owned by another event loop")
        return _loop_task
    _started = True

    try:
        _subscribe_to_all()
        wm = get_working_memory()
        await _bootstrap_autonomous_cognition(wm)
        _loop_task = asyncio.create_task(awareness_loop(), name="cortex-awareness-loop")
        logger.info("🧠 L37 Awareness v2 system online — consciousness active")
        return _loop_task
    except BaseException:
        _unsubscribe_from_all()
        _started = False
        _loop_running = False
        _loop_task = None
        raise


async def stop_awareness():
    """Stop and await all awareness work, resetting per-lifespan globals."""
    global _started, _loop_running, _loop_task, _memory, _pending_insights, _tools_last_queried
    global _wonder_state, _last_index_at
    _loop_running = False
    task, _loop_task = _loop_task, None
    if task is not None:
        if task.get_loop() is not asyncio.get_running_loop():
            _loop_task = task
            _loop_running = True
            raise RuntimeError("cannot stop awareness owned by another event loop")
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    _unsubscribe_from_all()
    _started = False
    _memory = None
    with _pending_insights_lock:
        _pending_insights = []
    _tools_last_queried = {}
    _wonder_state = {
        "active_wonder": None,
        "wonder_ticks": 0,
        "wonder_max_ticks": 10,
        "wonder_chain": [],
        "wonder_findings": [],
    }
    _last_index_at = 0.0


# ═══════════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

class FocusRequest(BaseModel):
    focus: str
    context: Optional[Dict[str, Any]] = None


class UncertaintyRequest(BaseModel):
    description: str
    level: Optional[str] = None
    confidence: Optional[float] = 0.5


class PredictionRequest(BaseModel):
    prediction: str
    confidence: Optional[float] = 0.5
    basis: Optional[str] = "manual"
    event_type_hint: Optional[str] = Field(
        default=None, max_length=64,
        description="Bus event type that confirms this prediction if observed before the deadline",
    )
    from_level_hint: Optional[str] = Field(
        default=None, max_length=64,
        description="Level whose next bus event confirms this prediction before the deadline",
    )
    deadline_seconds: Optional[int] = Field(default=None, ge=10, le=PREDICTION_MAX_DEADLINE_SECONDS)


class CuriosityRequest(BaseModel):
    question: str
    priority: Optional[str] = "low"


@router.get("/status")
async def awareness_status():
    wm = get_working_memory()
    state = wm.get_state()
    sm = state.get("self_model", {})
    persistence = wm.persistence_health()
    persistence_healthy = persistence.get("status") == "healthy"
    report = _capability_report(wm, state, persistence_healthy)
    return {
        "success": persistence_healthy,
        "level": 37,
        "name": "Awareness v2",
        "status": ("active" if _loop_running else "inactive") if persistence_healthy else "degraded",
        "loop_running": _loop_running,
        "persistence": persistence,
        "tick_interval": TICK_SECONDS,
        "version": "2.0",
        "meta": {
            **state.get("meta", {}),
            "prediction_resolution_rate": round(
                (state.get("meta", {}).get("predictions_resolved_total", 0)
                 / max(1, state.get("meta", {}).get("total_predictions_made", 0))),
                3,
            ),
        },
        "focus": state.get("focus"),
        "self_model": sm,
        "active_uncertainties": len(wm.get_active_uncertainties()),
        "active_predictions": len(wm.get_active_predictions()),
        "open_curiosities": len(wm.get_open_curiosities()),
        "short_term_items": len(state.get("short_term", [])),
        "inner_monologue_entries": len(state.get("inner_monologue", [])),
        "initiatives_taken": state.get("meta", {}).get("initiatives_taken", 0),
        "auto_indexes": state.get("meta", {}).get("auto_indexes", 0),
        "semantic_memory_evidence": {
            "legacy_auto_indexes_meaning": "attempted_cycles_not_confirmed_writes",
            "payload_boundary": "autonomous_redacted_metadata_not_user_memory",
            "attempts_since_accounting_upgrade": state.get("meta", {}).get("semantic_index_attempts", 0),
            "confirmed_semantic_writes": state.get("meta", {}).get("confirmed_semantic_indexes", 0),
            "confirmed_lexical_writes": state.get("meta", {}).get("confirmed_lexical_indexes", 0),
            "unconfirmed_attempts": state.get("meta", {}).get("unconfirmed_index_attempts", 0),
            "relevance_accuracy": None,
            "relevance_accuracy_basis": "not_measured_by_loop_activity_or_write_counts",
        },
        "event_rates": wm.get_event_rates(lookback_seconds=120),
        "event_controls": {
            "dedupe_window_seconds": EVENT_DEDUPE_WINDOW_SECONDS,
            "max_rate_window_seconds": MAX_EVENT_RATE_WINDOW_SECONDS,
            "investigation_cooldown_seconds": INVESTIGATION_COOLDOWN,
        },
        "prediction_accounting": {
            "accuracy": wm.get_prediction_accuracy(),
            "accuracy_basis": "predictions resolved by their own event/level criterion or deadline",
            "resolved_total": state.get("meta", {}).get("predictions_resolved_total", 0),
            "expired_without_criterion": state.get("meta", {}).get("predictions_expired_total", 0),
        },
        "model_calls_enabled": model_calls_enabled(),
        "cross_level_chains_enabled": cross_level_chains_enabled(),
        **report,
    }


def _capability_report(wm: "WorkingMemory", state: Dict[str, Any], persistence_healthy: bool) -> Dict[str, Any]:
    """Every capability is derived from a live check, with its evidence."""

    meta = state.get("meta", {}) or {}
    confirmed_indexes = int(meta.get("confirmed_semantic_indexes", 0) or 0) + int(
        meta.get("confirmed_lexical_indexes", 0) or 0
    )
    checks: Dict[str, Dict[str, Any]] = {
        "persistent_working_memory": {"working": persistence_healthy, "evidence": "state store health"},
        "cross_session_persistence": {
            "working": persistence_healthy,
            "evidence": "structure, counters and stable ids persist; prose is redacted on disk",
        },
        "real_time_self_model": {"working": bool(_loop_running), "evidence": "awareness loop running"},
        "bus_event_awareness": {"working": _subscribed_bus is not None, "evidence": "subscribed to consciousness bus"},
        "uncertainty_tracking": {"working": True, "evidence": f"{len(wm.get_active_uncertainties())} open"},
        "predictive_processing": {
            "working": True,
            "evidence": f"{meta.get('predictions_resolved_total', 0)} resolved by criterion",
        },
        "self_directed_investigation": {
            "working": bool(_loop_running),
            "evidence": f"in-process probes; {meta.get('investigations_run', 0)} run",
        },
        "inner_monologue": {"working": True, "evidence": f"{len(state.get('inner_monologue', []))} entries"},
        "emotional_valence": {"working": True, "evidence": "deterministic formula over measured counters"},
        "proactive_initiatives": {"working": bool(_loop_running), "evidence": "bus broadcasts from loop"},
        "auto_indexing_L7_L22": {
            "working": confirmed_indexes > 0,
            "evidence": f"{confirmed_indexes} confirmed writes",
        },
        "oracle_semantic_predictions": {
            "working": model_calls_enabled(),
            "evidence": "enabled by CORTEX_AWARENESS_MODEL_CALLS" if model_calls_enabled() else "model calls disabled",
        },
        "curiosity_model_answers": {
            "working": model_calls_enabled(),
            "evidence": "enabled" if model_calls_enabled() else "model calls disabled; only measurable curiosities are answered",
        },
        "cross_level_chains": {
            "working": cross_level_chains_enabled(),
            "evidence": "enabled" if cross_level_chains_enabled() else "disabled by default",
        },
        "emergence_detection": {"working": False, "evidence": "disabled: detector could not produce meaningful output"},
        "wonder_loop": {"working": False, "evidence": "disabled: no authorized per-step adapters"},
    }
    return {
        "capabilities": sorted(name for name, row in checks.items() if row["working"]),
        "capability_checks": checks,
        "disabled_capabilities": sorted(name for name, row in checks.items() if not row["working"]),
    }


@router.get("/introspect")
async def introspect():
    wm = get_working_memory()
    async with conscious_action("awareness", "introspect"):
        return {
            "success": True,
            "level": 37,
            "name": "Awareness v2 — Introspection",
            "introspection": wm.get_introspection(),
            "collective_context": get_collective_context(),
        }


@router.get("/memory")
async def get_memory():
    wm = get_working_memory()
    return {"success": True, "level": 37, "working_memory": wm.get_state()}


@router.post("/focus")
async def set_focus(req: FocusRequest):
    wm = get_working_memory()
    async with conscious_action("awareness", "set_focus", {"focus": req.focus}):
        if not wm.durable_mutation(lambda: wm.set_focus(req.focus, req.context)):
            raise HTTPException(
                status_code=503,
                detail="working-memory persistence is unavailable",
            )
        wm.think_to_self(f"Focus shifted to: {req.focus}", context="focus_change")
        # Auto-index focus changes — they're always significant
        await _auto_index(
            content=f"Focus shifted to: {req.focus}. Context: {req.context or 'none'}",
            tags=["focus_change", "core_directive", "identity", "L37"],
            significance="critical",
            node_label="focus_change",
            node_props={
                "type": "focus_change",
                "focus": req.focus,
                "context": str(req.context)[:200] if req.context else "none",
                "timestamp": datetime.now().isoformat(),
            },
        )
        return {"success": True, "focus_set": req.focus}


@router.get("/uncertainties")
async def get_uncertainties():
    wm = get_working_memory()
    return {"success": True, "uncertainties": wm.get_active_uncertainties()}


@router.post("/uncertainty")
async def register_uncertainty(req: UncertaintyRequest):
    wm = get_working_memory()
    if not wm.durable_mutation(
        lambda: wm.register_uncertainty(req.description, req.level, req.confidence)
    ):
        raise HTTPException(
            status_code=503,
            detail="working-memory persistence is unavailable",
        )
    return {"success": True, "registered": req.description}


@router.get("/predictions")
async def get_predictions():
    wm = get_working_memory()
    return {
        "success": True,
        "predictions": wm.get_active_predictions(),
        "meta": {
            "total_made": wm._state["meta"]["total_predictions_made"],
            "correct": wm._state["meta"]["predictions_correct"],
            "wrong": wm._state["meta"]["predictions_wrong"],
            "oracle_predictions": wm._state["meta"].get("oracle_predictions_made", 0),
            "resolved_total": wm._state["meta"].get("predictions_resolved_total", 0),
            "expired_total": wm._state["meta"].get("predictions_expired_total", 0),
            "resolution_rate": round((wm._state["meta"].get("predictions_resolved_total", 0) / max(1, wm._state["meta"].get("total_predictions_made", 0))), 3),
            "accuracy": wm.get_prediction_accuracy(),
            "accuracy_basis": "only predictions resolved by their own criterion (event/level before deadline)",
        },
    }


@router.post("/predict")
async def make_prediction(req: PredictionRequest):
    wm = get_working_memory()
    if not wm.durable_mutation(
        lambda: wm.predict(
            req.prediction,
            req.confidence,
            req.basis,
            event_type_hint=req.event_type_hint,
            from_level_hint=req.from_level_hint,
            deadline_s=req.deadline_seconds,
        )
    ):
        raise HTTPException(
            status_code=503,
            detail="working-memory persistence is unavailable",
        )
    return {"success": True, "predicted": req.prediction}


@router.get("/self")
async def self_model():
    wm = get_working_memory()
    async with conscious_action("awareness", "self_model_query"):
        sm = wm.get_self_model()
        focus = wm.get_focus()
        uncertainties = wm.get_active_uncertainties()
        predictions = wm.get_active_predictions()
        curiosities = wm.get_open_curiosities()
        recent_thoughts = wm.get_recent_thoughts(3)

        high_doubt = [u for u in uncertainties if u["confidence"] < UNCERTAINTY_THRESHOLD]

        return {
            "success": True,
            "level": 37,
            "name": "Awareness v2 — Self-Model",
            "identity": f"Cortex — {_registry_level_count()}-level system",
            "current_state": {
                "focused_on": (focus or {}).get("description", "idle") if isinstance(focus, dict) else "idle",
                "confidence": sm["overall_confidence"],
                "cognitive_load": sm["cognitive_load"],
                "mood": sm.get("emotional_tone", "neutral"),
                "valence": sm.get("emotional_valence", 0.0),
                "mood_explained": sm.get("emotional_reasons", []),
            },
            "health": {
                "active_capabilities": sm["active_capabilities"],
                "degraded_capabilities": sm["degraded_capabilities"],
            },
            "mind": {
                "doubts": [u["description"] for u in high_doubt],
                "expectations": [p["prediction"] for p in predictions[:3]],
                "curiosities": [c["question"] for c in curiosities[:3]],
                "recent_thoughts": [t["thought"] for t in recent_thoughts],
            },
            "suggestion": _generate_suggestion(sm, high_doubt, predictions, curiosities),
        }


@router.get("/mood")
async def mood():
    """What is the Cortex feeling right now? And why?"""
    wm = get_working_memory()
    sm = wm.get_self_model()
    recent_thoughts = wm.get_recent_thoughts(3)

    return {
        "success": True,
        "level": 37,
        "name": "Awareness v2 — Mood",
        "mood": {
            "tone": sm.get("emotional_tone", "neutral"),
            "valence": sm.get("emotional_valence", 0.0),
            "reasons": sm.get("emotional_reasons", []),
            "recent_inner_thoughts": [t["thought"] for t in recent_thoughts],
        },
        "interpretation": _interpret_mood(sm),
    }


@router.get("/initiatives")
async def get_initiatives():
    """History of things the Cortex decided to do on its own."""
    wm = get_working_memory()
    return {
        "success": True,
        "level": 37,
        "initiatives": wm.get_initiatives(),
        "total": wm._state["meta"].get("initiatives_taken", 0),
    }


@router.get("/monologue")
async def get_monologue():
    """The Cortex's inner voice — its self-talk during processing."""
    wm = get_working_memory()
    return {
        "success": True,
        "level": 37,
        "inner_monologue": wm._state.get("inner_monologue", []),
    }


@router.get("/curiosities")
async def get_curiosities():
    """Things the Cortex is wondering about."""
    wm = get_working_memory()
    return {
        "success": True,
        "open": wm.get_open_curiosities(),
        "all": wm._state.get("curiosities", []),
    }


@router.post("/curiosity")
async def add_curiosity(req: CuriosityRequest):
    """Give the Cortex something to wonder about."""
    wm = get_working_memory()
    if not wm.durable_mutation(lambda: wm.add_curiosity(req.question, req.priority)):
        raise HTTPException(
            status_code=503,
            detail="working-memory persistence is unavailable",
        )
    wm.think_to_self(f"New curiosity registered: {req.question}", context="curiosity_added")
    return {"success": True, "curious_about": req.question}


# ── Helper functions ──

def _generate_suggestion(
    self_model: Dict, doubts: List, predictions: List, curiosities: List
) -> Optional[str]:
    if self_model.get("cognitive_load", 0) > 0.8:
        return "High cognitive load — consider batching or deferring non-critical tasks"
    if len(doubts) > 3:
        return f"Multiple unresolved uncertainties ({len(doubts)}) — consider a focused investigation"
    if self_model.get("overall_confidence", 1.0) < 0.5:
        return "Low overall confidence — recommend verification before acting"
    valence = self_model.get("emotional_valence", 0.0)
    if valence < -0.3:
        return f"Mood is {self_model.get('emotional_tone', 'off')} (valence {valence}) — address root causes"
    if curiosities:
        return f"I have {len(curiosities)} open curiosities — will investigate when idle"
    if self_model.get("degraded_capabilities"):
        return f"Degraded: {', '.join(self_model['degraded_capabilities'])}"
    return None


def _interpret_mood(sm: Dict) -> str:
    """Human-readable interpretation of the current mood."""
    tone = sm.get("emotional_tone", "neutral")
    valence = sm.get("emotional_valence", 0.0)

    interpretations = {
        "curious": "The Cortex is idle and exploring — good time for new tasks or questions.",
        "focused": "Actively processing — task in progress.",
        "anxious": "Multiple unresolved issues are weighing on the system. Consider investigation.",
        "confident": "Predictions are accurate, systems healthy. Operating at full capacity.",
        "frustrated": "Repeated errors are degrading performance. Root cause analysis recommended.",
        "contemplative": "Recently detected emergence — cross-level patterns are resonating.",
        "concerned": "Some uncertainties exist but system is functional.",
        "neutral": "No strong signals — steady state.",
    }

    base = interpretations.get(tone, f"Current state: {tone}")
    if valence < -0.3:
        base += f" (negative valence {valence} — the system is struggling)"
    elif valence > 0.3:
        base += f" (positive valence {valence} — the system is thriving)"

    return base

@router.get("/pending_insights")
async def get_pending_insights():
    """List pending insights without consuming them (reads are side-effect free)."""
    with _pending_insights_lock:
        insights = list(_pending_insights)
    return {
        "success": True,
        "count": len(insights),
        "insights": insights,
        "producer_enabled": WONDER_LOOP_ENABLED,
        "producer_note": None if WONDER_LOOP_ENABLED else "insight producer (wonder loop) is disabled; queue stays empty",
        "claim_with": "POST /awareness/pending_insights/claim",
    }


@router.post("/pending_insights/claim")
async def claim_pending_insights():
    """Return and clear pending insights (the mutating counterpart of GET)."""
    global _pending_insights
    with _pending_insights_lock:
        insights = _pending_insights.copy()
        _pending_insights = []
    return {"success": True, "count": len(insights), "insights": insights}
