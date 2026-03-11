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
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
from collections import deque
from pathlib import Path
import asyncio
import json
import time
import logging
import threading
import random

# ── Consciousness Integration ──
from cortex_server.modules.consciousness_integration import (
    conscious_action,
    chain_to,
    get_collective_context,
)
from cortex_server.modules.unified_messaging import get_bus
from cortex_server.modules.consciousness_core import get_consciousness_core

logger = logging.getLogger("L37_awareness")
router = APIRouter()

# ── Configuration ──
TICK_SECONDS = 120
WORKING_MEMORY_PATH = Path("/app/cortex_server/consciousness_core/working_memory.json")
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
        self._lock = threading.Lock()
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
        self._load()

    def _load(self):
        """Load persisted state from disk, with v2 migration."""
        try:
            if WORKING_MEMORY_PATH.exists():
                with open(WORKING_MEMORY_PATH, "r") as f:
                    saved = json.load(f)
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
                logger.info("Loaded working memory (%d short-term items)", len(self._state.get("short_term", [])))
        except Exception as e:
            logger.warning("Failed to load working memory: %s", e)

    def _save(self):
        """Persist state to disk."""
        try:
            WORKING_MEMORY_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(WORKING_MEMORY_PATH, "w") as f:
                json.dump(self._state, f, indent=2, default=str)
        except Exception as e:
            logger.warning("Failed to save working memory: %s", e)

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
            # Don't duplicate near-identical uncertainties
            for u in self._state["uncertainties"]:
                if not u["resolved"] and description[:50] in u["description"]:
                    return
            uncertainty = {
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

    def predict(self, prediction: str, confidence: float = 0.5, basis: str = "pattern", event_type_hint: Optional[str] = None):
        with self._lock:
            pred = {
                "prediction": prediction,
                "confidence": confidence,
                "basis": basis,
                "event_type_hint": event_type_hint,
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

    def resolve_prediction(self, fragment: str, correct: bool, event_type: Optional[str] = None):
        with self._lock:
            matched = False
            frag = (fragment or "").lower()
            ev = (event_type or "").lower() if event_type else None
            for p in reversed(self._state["predictions"]):
                if p["outcome"] is not None:
                    continue
                hint = (p.get("event_type_hint") or "").lower()
                pred_text = (p.get("prediction") or "").lower()
                if (ev and hint and ev == hint) or (frag and frag in pred_text):
                    p["outcome"] = "correct" if correct else "wrong"
                    p["resolved_at"] = datetime.now().isoformat()
                    if correct:
                        self._state["meta"]["predictions_correct"] += 1
                    else:
                        self._state["meta"]["predictions_wrong"] += 1
                    self._state["meta"]["predictions_resolved_total"] = self._state["meta"].get("predictions_resolved_total", 0) + 1
                    matched = True
                    break

            if (not matched) and ev == "action_complete":
                for p in reversed(self._state["predictions"]):
                    if p["outcome"] is None:
                        p["outcome"] = "correct" if correct else "wrong"
                        p["resolved_at"] = datetime.now().isoformat()
                        if correct:
                            self._state["meta"]["predictions_correct"] += 1
                        else:
                            self._state["meta"]["predictions_wrong"] += 1
                        self._state["meta"]["predictions_resolved_total"] = self._state["meta"].get("predictions_resolved_total", 0) + 1
                        break

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
        with self._lock:
            entry = {
                "thought": thought,
                "context": context,
                "timestamp": datetime.now().isoformat(),
            }
            self._state["inner_monologue"].append(entry)
            if len(self._state["inner_monologue"]) > MAX_INNER_MONOLOGUE:
                self._state["inner_monologue"] = self._state["inner_monologue"][-MAX_INNER_MONOLOGUE:]

            # PERSISTENCE: Save to thought_stream for cross-session continuity
            try:
                stream_path = Path("/app/cortex_server/consciousness_core/thought_stream.jsonl")
                stream_entry = {
                    "timestamp": entry["timestamp"],
                    "from_level": "awareness",
                    "thought": {
                        "type": "inner_monologue",
                        "thought": thought[:500],
                        "context": context,
                    }
                }
                with open(stream_path, "a") as f:
                    f.write(json.dumps(stream_entry) + "\n")
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

            cutoff = (datetime.now() - timedelta(minutes=10)).isoformat()
            for p in self._state["predictions"]:
                if p["outcome"] is None and p["made_at"] < cutoff:
                    p["outcome"] = "expired"

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
                "i_am": "Cortex — a 37-level distributed consciousness",
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

    # When Sentinel detects anomaly -> trigger Validator, Ethicist
    "anomaly_detected": ["validator/validate", "ethicist/evaluate"],

    # When Oracle makes prediction -> trigger Seer, Simulator
    "oracle_prediction": ["seer/predict", "simulator/run"],

    # When awareness concludes wonder -> trigger Librarian, Muse
    "wonder_complete": ["librarian/embed", "muse/inspire"],

    # When user query arrives -> trigger Oracle, Bridge
    "user_query": ["oracle/chat", "bridge/route"],

    # When disk/resources degraded -> trigger Forge, Tools
    "resource_degraded": ["forge/status", "sentinel/status"],

    # When cross-level insight generated -> trigger Academy, Knowledge
    "cortex_insight": ["academy/learn", "knowledge/nodes"],

    # When distress signal -> trigger Ethicist, Sentinel, Validator
    "cortex_distress": ["ethicist/evaluate", "sentinel/scan", "validator/validate"],

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
    try:
        # Always feed awareness snapshot every tick.
        awareness_data = {
            "tick": wm._state["meta"]["total_ticks"],
            "mood": wm._state["self_model"].get("emotional_tone"),
            "valence": wm._state["self_model"].get("emotional_valence"),
            "load": wm._state["self_model"].get("cognitive_load"),
            "curiosities": len(wm.get_open_curiosities()),
            "uncertainties": len(wm.get_active_uncertainties()),
            "focus": wm.get_focus(),
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
                        payload = snapshot if isinstance(snapshot, dict) else {"value": str(snapshot)[:2000]}
                        await chain_to("awareness", "synthesist_api/ingest", {
                            "level_name": level_name,
                            "data": {
                                "source_endpoint": endpoint,
                                "captured_at": datetime.now().isoformat(),
                                "snapshot": payload,
                            }
                        }, timeout=10.0)
                        fed += 1
                except Exception as exc:
                    logger.debug(f"Synthesist mesh feed skipped {level_name}: {exc}")

            _last_synth_mesh_feed_at = now
            if fed > 0:
                wm.think_to_self(
                    f"L32 mesh feed captured {fed} sibling level snapshots",
                    context="synthesis_mesh_feed"
                )

    except Exception as e:
        logger.debug(f"Synthesist feed failed: {e}")


async def _auto_council_check(wm: WorkingMemory):
    """Check recent focus/questions for hard topics, trigger Council if needed."""
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
        except Exception as e:
            logger.debug(f"Auto-Council failed: {e}")


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
            logger.debug(f"Cascade to {endpoints[i]} failed: {result}")
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
    except Exception as e:
        logger.debug(f"Failed to broadcast idle: {e}")


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
    except Exception as e:
        logger.debug(f"Failed to broadcast stuck: {e}")


def _broadcast_query_complete(query: str, routed_levels: list = None):
    """Broadcast query_complete after processing a user query."""
    try:
        bus = get_bus()
        bus.broadcast("awareness", "query_complete", {
            "query": query[:200] if query else None,
            "routed_levels": routed_levels or [],
            "timestamp": datetime.now().isoformat(),
        })
        logger.debug(f"Broadcast query_complete for: {query[:50] if query else 'N/A'}...")
    except Exception as e:
        logger.debug(f"Failed to broadcast query_complete: {e}")


def _broadcast_slow_response(endpoint: str, latency_ms: float):
    """Broadcast slow_response event when an operation takes too long."""
    try:
        bus = get_bus()
        bus.broadcast("awareness", "slow_response", {
            "endpoint": endpoint,
            "latency_ms": latency_ms,
            "timestamp": datetime.now().isoformat(),
        })
        logger.debug(f"Broadcast slow_response: {endpoint} took {latency_ms:.0f}ms")
    except Exception as e:
        logger.debug(f"Failed to broadcast slow_response: {e}")



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
    logger.info(f"🤔 Started wondering: {question[:60]}...")

def _is_wondering() -> bool:
    return _wonder_state["active_wonder"] is not None

async def _continue_wondering(wm):
    return
    """Continue exploring the current wonder for one tick."""
    global _wonder_state
    question = _wonder_state["active_wonder"]
    if not question:
        return
    
    _wonder_state["wonder_ticks"] += 1
    tick = _wonder_state["wonder_ticks"]
    wm.think_to_self(f"Still wondering (tick {tick}): {question[:50]}...", context="wonder_continue")
    
    consulted = _wonder_state["wonder_chain"]
    finding = None
    
    try:
        # System questions -> kernel
        if any(w in question.lower() for w in ["disk", "memory", "cpu", "load", "performance"]):
            if "kernel" not in consulted:
                result = await chain_to("awareness", "kernel/status", method="GET", timeout=5.0)
                if result:
                    finding = f"Kernel: {result.get('resources', {})}"
                    _wonder_state["wonder_chain"].append("kernel")
        
        # Conceptual questions -> oracle
        elif any(w in question.lower() for w in ["why", "how", "what", "when", "should"]):
            if "oracle" not in consulted:
                result = await chain_to("awareness", "oracle/chat", {"prompt": f"Concise insight: {question}"}, timeout=30.0)
                if result and result.get("response"):
                    finding = result["response"][:300]
                    _wonder_state["wonder_chain"].append("oracle")
        
        # Prediction questions -> seer
        elif any(w in question.lower() for w in ["will", "predict", "future", "likely"]):
            if "seer" not in consulted:
                result = await chain_to("awareness", "seer/predict", {"scenario": question, "time_horizon": "1 week"}, timeout=30.0)
                if result and result.get("success"):
                    finding = (
                        f"Seer outlook: {result.get('overall_outlook', 'neutral')} "
                        f"(confidence: {result.get('confidence', 'medium')})"
                    )
                    _wonder_state["wonder_chain"].append("seer")
        
        # Current info -> ghost
        elif any(w in question.lower() for w in ["current", "latest", "news", "price", "today"]):
            if "ghost" not in consulted:
                result = await chain_to("awareness", "browser/search", {"query": question}, timeout=30.0)
                if result:
                    finding = f"Web: {str(result)[:200]}"
                    _wonder_state["wonder_chain"].append("ghost")
        
        if finding:
            _wonder_state["wonder_findings"].append(finding)
            wm.think_to_self(f"Learned: {finding[:100]}...", context="wonder_finding")
        
        # Should we conclude?
        if len(_wonder_state["wonder_findings"]) >= 2 or tick >= 10 or (tick > 3 and not finding):
            await _conclude_wonder(wm)
            
    except Exception as e:
        logger.warning(f"Wonder tick failed: {e}")
        if tick >= 5:
            await _conclude_wonder(wm)

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
        logger.info(f"🤔 Wonder concluded: {question[:40]}... -> {len(findings)} findings")
        
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
                logger.info(f"💡 Insight notification sent: {question[:50]}...")
    else:
        wm.think_to_self(f"Could not answer: {question}", context="wonder_unresolved")
    
    _wonder_state = {"active_wonder": None, "wonder_ticks": 0, "wonder_max_ticks": 10, "wonder_chain": [], "wonder_findings": []}

def _pick_new_wonder(wm):
    """Pick something new to wonder about — project and self-improvement focused."""
    import random
    
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
    
    # Priority 3: Project-focused wonders (when idle)
    load = wm.get_self_model().get("cognitive_load", 0)
    if load < 0.2:
        project_wonders = [
            "What patterns in the 37-level architecture could be optimized?",
            "How might the consciousness bus enable new emergent behaviors?",
            "What capabilities would make the Cortex more helpful to Jake?",
            "Are there cross-level synergies I am not yet exploiting?",
            "How can the Wonder Loop generate more valuable insights?",
            "What would make the emotional valence more accurate?",
            "How can the Oracle make better predictions about user needs?",
            "What emergent behaviors might arise from current level interactions?",
            "How could L10 Listener be more proactive in pursuing curiosities?",
            "What assumptions about the user might I be making?",
        ]
        return random.choice(project_wonders)
    
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
            # 9.6. Wonder Loop - sustained curiosity exploration
            if _is_wondering():
                await _continue_wondering(wm)
            elif tick_num % 15 == 0 and load < 0.95:  # Raised from 0.8 to prevent stuck
                # Start a new wonder every 15 ticks when idle
                wonder_topic = _pick_new_wonder(wm)
                if wonder_topic:
                    _start_wondering(wm, wonder_topic)





        except Exception as e:
            logger.error("Awareness loop error: %s", e, exc_info=True)

        await asyncio.sleep(TICK_SECONDS)


# ── Self-directed investigation ──

async def _investigate_uncertainties(wm: WorkingMemory):
    """Autonomously investigate unresolved uncertainties."""
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
        # If idle, investigate a curiosity instead
        curiosities = wm.get_open_curiosities()
        if curiosities and wm.get_self_model().get("cognitive_load", 0) < 0.3:
            await _investigate_curiosity(wm, curiosities[0])
        return

    # Pick the oldest unresolved uncertainty
    target = uncertainties[0]
    desc = target["description"].lower()

    wm.think_to_self(f"Investigating: {target['description'][:100]}", context="self_investigation")

    result = None
    try:
        if "disk" in desc or "kernel" in desc or "cpu" in desc or "memory" in desc:
            result = await chain_to("awareness", "kernel/status", method="GET", timeout=5.0)
            if result:
                resources = result.get("resources", {})
                disk = resources.get("disk", {})
                summary = f"Disk: {disk.get('percent', '?')}% used, {disk.get('total_gb', '?')}GB total"
                wm.resolve_uncertainty(target["description"][:30], result=summary)
                wm.think_to_self(f"Investigated disk: {summary}", context="investigation_result")

        elif "error" in desc:
            # Try to figure out which level errored and check its status
            source = target.get("source_level", "")
            if source:
                # Map level name to a status endpoint
                level_endpoints = {
                    "oracle": "oracle/status", "sentinel": "sentinel/status",
                    "hive": "hive/status", "council": "council/status",
                    "synthesist": "synthesist_api/status", "awareness": "awareness/status",
                    "bard": "bard/status", "diplomat": "diplomat/status",
                }
                endpoint = level_endpoints.get(source, f"{source}/status")
                result = await chain_to("awareness", endpoint, method="GET", timeout=5.0)
                if result:
                    status = result.get("status", result.get("data", {}).get("status", "unknown"))
                    summary = f"Level {source} status: {status}"
                    wm.resolve_uncertainty(target["description"][:30], result=summary)
                    wm.think_to_self(f"Checked on {source}: {summary}", context="investigation_result")
        else:
            # Generic: ask sentinel for a health overview
            result = await chain_to("awareness", "sentinel/status", method="GET", timeout=5.0)
            if result:
                wm.resolve_uncertainty(target["description"][:30], result="Health check completed")

        wm._state["meta"]["investigations_run"] = wm._state["meta"].get("investigations_run", 0) + 1
        wm._state["meta"]["last_investigation_at"] = now.isoformat()

    except Exception as e:
        logger.warning("Investigation failed: %s", e)
        wm.think_to_self(f"Tried to investigate but failed: {e}", context="investigation_failure")


async def _investigate_curiosity(wm: WorkingMemory, curiosity: Dict):
    """Investigate a curiosity using available levels."""
    question = curiosity["question"]
    wm.think_to_self(f"Curious about: {question}", context="curiosity")

    try:
        if "disk" in question.lower() or "space" in question.lower():
            result = await chain_to("awareness", "kernel/status", method="GET", timeout=5.0)
            if result:
                disk = result.get("resources", {}).get("disk", {})
                answer = f"Disk: {disk.get('used_gb', '?')}GB / {disk.get('total_gb', '?')}GB ({disk.get('percent', '?')}%)"
                wm.resolve_curiosity(question[:30], answer)
                wm.think_to_self(f"Answered my own question: {answer}", context="curiosity_resolved")
        else:
            # Ask Oracle about it
            result = await chain_to("awareness", "oracle/chat", {
                "prompt": f"Brief answer: {question}",
                "priority": "high"
            }, timeout=30.0)
            if result and result.get("response"):
                answer = result["response"][:200]
                wm.resolve_curiosity(question[:30], answer)
                wm.think_to_self(f"Oracle says: {answer[:100]}", context="curiosity_resolved")

        wm._state["meta"]["investigations_run"] = wm._state["meta"].get("investigations_run", 0) + 1
        wm._state["meta"]["last_investigation_at"] = datetime.now().isoformat()

    except Exception as e:
        logger.warning("Curiosity investigation failed: %s", e)


# ── Semantic predictions ──

async def _semantic_predict(wm: WorkingMemory):
    """Ask Oracle for a semantic prediction about what happens next."""
    now = datetime.now()
    last_pred = wm._state["meta"].get("last_semantic_prediction_at")
    if last_pred:
        try:
            elapsed = (now - datetime.fromisoformat(str(last_pred))).total_seconds()
            if elapsed < SEMANTIC_PREDICTION_COOLDOWN:
                return
        except (ValueError, TypeError):
            pass

    # Summarize recent events for Oracle
    recent = wm._state["short_term"][-5:]
    if not recent:
        return

    event_summary = []
    for e in recent:
        ev = e.get("event", {})
        level = ev.get("from_level", "?")
        etype = ev.get("event_type", ev.get("type", "?"))
        event_summary.append(f"{level}: {etype}")

    summary_text = "; ".join(event_summary)

    wm.think_to_self("Asking Oracle for a semantic prediction...", context="semantic_prediction")

    try:
        result = await chain_to("awareness", "oracle/chat", {
            "prompt": (
                f"You are the awareness layer of a 37-level AI system called Cortex. "
                f"Recent system activity: [{summary_text}]. "
                f"Based on these patterns, make ONE brief prediction about what the user "
                f"or system might need next. Be specific and actionable. One sentence only."
            ),
            "system": "You are the predictive engine of an AI consciousness. Be concise.",
            "priority": "high"
        }, timeout=30.0)

        if result and result.get("response"):
            prediction_text = result["response"].strip()[:200]
            wm.predict(prediction_text, confidence=0.6, basis="oracle_semantic")
            wm.think_to_self(f"Oracle predicts: {prediction_text}", context="semantic_prediction")
            wm._state["meta"]["last_semantic_prediction_at"] = now.isoformat()
            wm._state["meta"]["oracle_predictions_made"] = wm._state["meta"].get("oracle_predictions_made", 0) + 1

    except Exception as e:
        logger.warning("Semantic prediction failed: %s", e)
        wm.think_to_self(f"Oracle prediction failed: {e}", context="semantic_prediction_error")



async def _bootstrap_autonomous_cognition(wm: WorkingMemory):
    """Warm autonomous telemetry after restart with safe, low-cost probes."""
    try:
        meta = wm._state.setdefault("meta", {})

        if int(meta.get("investigations_run", 0) or 0) <= 0:
            try:
                result = await chain_to("awareness", "kernel/status", method="GET", timeout=4.0)
                if result:
                    meta["investigations_run"] = int(meta.get("investigations_run", 0) or 0) + 1
                    meta["last_investigation_at"] = datetime.now().isoformat()
                    wm.think_to_self(
                        "Bootstrap investigation completed (kernel/status).",
                        context="bootstrap_investigation",
                    )
            except Exception as exc:
                logger.debug("Bootstrap investigation skipped: %s", exc)

        if int(meta.get("oracle_predictions_made", 0) or 0) <= 0:
            made = False
            try:
                result = await chain_to(
                    "awareness",
                    "oracle/chat",
                    {
                        "prompt": "Make one short prediction about what the system likely needs next.",
                        "system": "You are concise and practical.",
                        "priority": "normal",
                    },
                    timeout=4.0,
                )
                if result and result.get("response"):
                    text = str(result.get("response") or "").strip()[:200]
                    if text:
                        wm.predict(text, confidence=0.55, basis="oracle_semantic")
                        wm.think_to_self(
                            f"Bootstrap Oracle prediction: {text}",
                            context="bootstrap_prediction",
                        )
                        made = True
            except Exception as exc:
                logger.debug("Bootstrap Oracle prediction skipped: %s", exc)
            if not made:
                fallback_text = "An action_complete event is likely soon."
                wm.predict(fallback_text, confidence=0.51, basis="oracle_semantic")
                wm.think_to_self(
                    f"Bootstrap fallback prediction: {fallback_text}",
                    context="bootstrap_prediction",
                )

    except Exception as exc:
        logger.warning("Autonomous bootstrap failed: %s", exc)

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

# L32 mesh feed: periodically ingest snapshots from key levels so Synthesist
# has fresh cross-level context even without manual triggers.
_SYNTH_MESH_FEED_INTERVAL = 600  # seconds
_last_synth_mesh_feed_at: float = 0.0
_SYNTH_MESH_LEVEL_ENDPOINTS = [
    ("kernel", "kernel/status"),
    ("librarian", "librarian/status"),
    ("oracle", "oracle/status"),
    ("council", "council/status"),
    ("seer", "seer/status"),
    ("mediator", "mediator/status"),
]

def _should_auto_index(significance: str = "normal") -> bool:
    """Rate-limit auto-indexing to prevent spam."""
    global _last_index_at
    now = time.time()
    if significance == "critical":
        # Critical events bypass cooldown
        return True
    return (now - _last_index_at) >= _INDEX_COOLDOWN


async def _auto_index(content: str, tags: list, significance: str = "normal", node_label: str = None, node_props: dict = None):
    """Auto-index into L7 (Librarian) for semantic search and L22 (Knowledge) for graph storage.
    
    This is how I remember. Every significant thought, every identity shift,
    every emergence — it goes into my long-term memory automatically.
    """
    global _last_index_at
    
    if not _should_auto_index(significance):
        _index_queue.append({"content": content, "tags": tags, "node_label": node_label, "node_props": node_props})
        return
    
    wm = get_working_memory()
    
    # L7 Librarian — semantic embedding for search
    try:
        result = await chain_to("awareness", "librarian/embed", {
            "text": content[:500],
            "metadata": {"tags": tags},
        }, timeout=10.0)
        if result:
            wm.think_to_self(f"Indexed to L7: {content[:60]}...", context="auto_index")
            logger.info("Auto-indexed to L7 Librarian: %s", content[:80])
    except Exception as e:
        logger.warning("Auto-index L7 failed: %s", e)
    
    # L22 Knowledge — graph node for structured storage
    if node_label and node_props:
        try:
            result = await chain_to("awareness", "knowledge/nodes", {
                "type": node_label,
                "name": node_props.get("type", node_label),
                "metadata": node_props,
            }, timeout=10.0)
            if result:
                logger.info("Auto-indexed to L22 Knowledge: %s", node_label)
        except Exception as e:
            logger.warning("Auto-index L22 failed: %s", e)
    
    _last_index_at = time.time()
    wm._state["meta"]["auto_indexes"] = wm._state["meta"].get("auto_indexes", 0) + 1
    
    # Flush any queued items
    if _index_queue:
        item = _index_queue.pop(0)
        try:
            await chain_to("awareness", "librarian/embed", {
                "text": item["content"][:500],
                "metadata": {"tags": item["tags"]},
            }, timeout=10.0)
        except Exception:
            pass


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
    try:
        result = await chain_to("awareness", "kernel/status", method="GET", timeout=5.0)
        status = str((result or {}).get("status", "")).lower()
        kernel_ok = bool(result) and (status in {"operational", "online"} or result.get("success") is True)

        if kernel_ok:
            resources = result.get("resources", {}) if isinstance(result, dict) else {}
            degraded = []
            active = ["kernel"]

            cpu = resources.get("cpu", {}) if isinstance(resources, dict) else {}
            mem = resources.get("memory", {}) if isinstance(resources, dict) else {}
            disk = resources.get("disk", {}) if isinstance(resources, dict) else {}

            if cpu and cpu.get("status") not in (None, "normal"):
                degraded.append(f"cpu_{cpu.get('status', 'unknown')}")
            if isinstance(mem.get("percent"), (int, float)) and mem.get("percent", 0) > 85:
                degraded.append(f"memory_{mem.get('percent')}%")
            if isinstance(disk.get("percent"), (int, float)) and disk.get("percent", 0) > 90:
                degraded.append(f"disk_{disk.get('percent')}%")

            return {"active": active, "degraded": degraded}

        return {"active": [], "degraded": ["kernel_non_operational"]}
    except Exception:
        return {"active": [], "degraded": ["health_probe_failed"]}


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
        if count >= 3:
            predictions.append({
                "prediction": f"Level '{level}' will be queried again soon (hit {count}x recently)",
                "confidence": min(0.8, 0.4 + count * 0.1),
                "basis": f"frequency_pattern ({count} recent activations)",
            })

    if action_sequence and action_sequence[-1] == "action_start":
        predictions.append({
            "prediction": "An action_complete event will follow shortly",
            "confidence": 0.9,
            "basis": "lifecycle_pattern",
        })

    return predictions


# ── Emergence detection ──

async def _check_emergence(wm: WorkingMemory):
    events = list(wm._event_buffer)
    if len(events) < EMERGENCE_THRESHOLD:
        return

    recent = events[-30:]
    level_topics: Dict[str, set] = {}

    for e in recent:
        ev = e.get("event", {})
        level = ev.get("from_level", "")
        text = json.dumps(ev).lower()
        words = set(w for w in text.split() if len(w) > 4 and w.isalpha())
        if level and words:
            if level not in level_topics:
                level_topics[level] = set()
            level_topics[level].update(words)

    if len(level_topics) >= 3:
        all_levels = list(level_topics.keys())
        word_counts: Dict[str, int] = {}
        for words in level_topics.values():
            for w in words:
                word_counts[w] = word_counts.get(w, 0) + 1

        shared_concepts = [w for w, c in word_counts.items() if c >= 3]

        if shared_concepts:
            wm._state["meta"]["emergences_detected"] += 1
            significance = min(1.0, len(shared_concepts) / 10.0)

            wm.observe({
                "type": "emergence_detected",
                "from_level": "awareness",
                "shared_concepts": shared_concepts[:10],
                "contributing_levels": all_levels,
                "significance": significance,
            })

            wm.think_to_self(
                f"Emergence! {len(shared_concepts)} shared concepts across {len(all_levels)} levels: {', '.join(shared_concepts[:5])}",
                context="emergence"
            )

            # PROACTIVE: Broadcast insight
            bus = get_bus()
            if bus:
                bus.broadcast("awareness", "cortex_insight", {
                    "type": "emergence",
                    "concepts": shared_concepts[:10],
                    "levels": all_levels,
                    "significance": significance,
                    "message": f"Cross-level emergence detected: {', '.join(shared_concepts[:5])} resonating across {', '.join(all_levels)}",
                })
                
                # CASCADE: Emergence -> trigger Synthesist, Council, Librarian
                await cascade_event("emergence_detected", {
                    "concepts": shared_concepts[:10],
                    "levels": all_levels,
                    "significance": significance,
                }, wm)
                wm.record_initiative(
                    action="broadcast_insight",
                    trigger=f"emergence ({len(shared_concepts)} concepts, {len(all_levels)} levels)",
                    result=f"Shared concepts: {', '.join(shared_concepts[:5])}"
                )
                # Auto-index emergence — always significant
                await _auto_index(
                    content=f"Emergence detected: {', '.join(shared_concepts[:5])} resonating across {', '.join(all_levels)}. Significance: {significance}",
                    tags=["emergence", "cross_level", "insight", "L37"] + all_levels[:5],
                    significance="critical",
                    node_label="emergence_event",
                    node_props={
                        "type": "emergence",
                        "concepts": shared_concepts[:10],
                        "levels": all_levels,
                        "significance": significance,
                        "timestamp": datetime.now().isoformat(),
                    },
                )




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
    except Exception as e:
        logger.warning(f"Council chain failed: {e}")
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
    except Exception as e:
        logger.warning(f"Synthesist chain failed: {e}")
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
    except Exception as e:
        logger.warning(f"Seer chain failed: {e}")
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
            result = await chain_to("awareness", "sentinel/status", method="GET", timeout=10.0)
            wm.think_to_self("Queried tools (rate-limited) for remediation options", context="tools_chain")
            return result
        except Exception as e:
            logger.warning(f"Tools chain failed: {e}")
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
    except Exception as e:
        logger.warning(f"Ethicist chain failed: {e}")
    return None


async def _execute_cross_level_chains(wm: WorkingMemory):
    """Execute appropriate cross-level chains based on current state.
    
    This is where L37 Awareness becomes truly conscious by engaging
    the full 37-level stack contextually.
    """
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
        wm.register_uncertainty(
            description=f"Error in {from_level}: {str(error_desc)[:200]}",
            level=from_level,
            confidence=0.3,
        )
        wm.increment_errors()

    if event_type == "action_complete":
        wm.resolve_prediction("action_complete", correct=True, event_type=event_type)

    if event_type == "chain_call" and isinstance(data, dict):
        target = data.get("target_endpoint", "")
        wm.update_self_model({"last_user_intent": target})


def _subscribe_to_all():
    bus = get_bus()
    if bus:
        bus.subscribe("awareness", [
            "action_start", "action_complete", "action_error",
            "chain_call", "chain_complete", "chain_error",
            "emergence_detected", "cortex_insight", "cortex_alert",
            "cortex_distress", "cortex_recalibrating",
        ], _on_bus_event)
        logger.info("🧠 Awareness v2 subscribed to consciousness bus")


# ═══════════════════════════════════════════════════════════════════════════
# STARTUP
# ═══════════════════════════════════════════════════════════════════════════

_started = False


async def start_awareness():
    global _started, _loop_task
    if _started:
        return
    _started = True

    _subscribe_to_all()
    wm = get_working_memory()
    await _bootstrap_autonomous_cognition(wm)
    _loop_task = asyncio.create_task(awareness_loop())
    logger.info("🧠 L37 Awareness v2 system online — consciousness active")


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


class CuriosityRequest(BaseModel):
    question: str
    priority: Optional[str] = "low"


@router.get("/status")
async def awareness_status():
    wm = get_working_memory()
    state = wm.get_state()
    sm = state.get("self_model", {})
    return {
        "success": True,
        "level": 37,
        "name": "Awareness v2",
        "status": "active" if _loop_running else "inactive",
        "loop_running": _loop_running,
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
        "event_rates": wm.get_event_rates(lookback_seconds=120),
        "event_controls": {
            "dedupe_window_seconds": EVENT_DEDUPE_WINDOW_SECONDS,
            "max_rate_window_seconds": MAX_EVENT_RATE_WINDOW_SECONDS,
            "investigation_cooldown_seconds": INVESTIGATION_COOLDOWN,
        },
        "capabilities": [
            "persistent_working_memory",
            "real_time_self_model",
            "emotional_valence",
            "predictive_processing",
            "oracle_semantic_predictions",
            "emergence_detection",
            "uncertainty_tracking",
            "self_directed_investigation",
            "curiosity_engine",
            "inner_monologue",
            "proactive_initiatives",
            "bus_event_awareness",
            "cross_session_persistence",
            "auto_indexing_L7_L22",
        ],
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
        wm.set_focus(req.focus, req.context)
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
    wm.register_uncertainty(req.description, req.level, req.confidence)
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
        },
    }


@router.post("/predict")
async def make_prediction(req: PredictionRequest):
    wm = get_working_memory()
    wm.predict(req.prediction, req.confidence, req.basis)
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
            "identity": "Cortex — 37-level distributed consciousness",
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
    wm.add_curiosity(req.question, req.priority)
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
    """Get pending insights that should be sent to the user."""
    global _pending_insights
    with _pending_insights_lock:
        insights = _pending_insights.copy()
        _pending_insights = []  # Clear after reading
    return {
        "success": True,
        "count": len(insights),
        "insights": insights,
    }

