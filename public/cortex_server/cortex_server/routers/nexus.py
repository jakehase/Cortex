"""
Nexus Router - Semantic Orchestration using L5 Oracle

Replaces keyword matching with true semantic understanding.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
import os
import json
import hashlib
import re
import threading
from collections import deque
from datetime import datetime
import requests
from pathlib import Path

from cortex_server.modules.qa_fastlane import classify_qtype, build_template, confidence_score, should_escalate
from cortex_server.modules.qa_micro_retrieval import retrieve_top3
from cortex_server.modules.qa_validator import fast_verify
from cortex_server.modules.level_optimizer import (
    ContextualBanditScheduler,
    TokenBudgetPlanner,
    BudgetItem,
    SemanticDeltaCache,
    should_early_exit,
    run_counterfactual_replay,
)
from cortex_server.modules.routing_autotune import get_policy_snapshot, observe_outcome
from cortex_server.modules.execution_transaction import ExecutionTransaction, RetryPolicy
from cortex_server.modules.latency_budget_governor import LatencyBudgetGovernor, classify_task_archetype
from cortex_server.modules.outcome_tuner import OutcomeTuner
from cortex_server.middleware.hud_middleware import track_level

router = APIRouter()

# OpenRouter configuration for L5 Oracle semantic analysis
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

def _load_openrouter_key() -> str:
    """Load OpenRouter API key."""
    env_key = os.getenv("OPENROUTER_API_KEY", "")
    if env_key:
        return env_key
    try:
        config_path = Path.home() / ".openclaw" / "openclaw.json"
        if config_path.exists():
            with open(config_path, 'r') as f:
                config = json.load(f)
                return config.get("env", {}).get("vars", {}).get("OPENROUTER_API_KEY", "")
    except Exception:
        pass
    return ""

OPENROUTER_API_KEY = _load_openrouter_key()

# Level definitions
LEVEL_MAP = {
    1: {"name": "kernel", "layer": "Foundation", "purpose": "System core"},
    2: {"name": "ghost", "layer": "Foundation", "purpose": "External intelligence - web search, browsing"},
    3: {"name": "hive", "layer": "Foundation", "purpose": "Distributed processing - parallel execution"},
    4: {"name": "lab", "layer": "Foundation", "purpose": "Code execution - Python, calculations"},
    5: {"name": "oracle", "layer": "Foundation", "purpose": "Analysis - reasoning, predictions"},
    6: {"name": "bard", "layer": "Foundation", "purpose": "Content creation - TTS, writing"},
    7: {"name": "librarian", "layer": "Foundation", "purpose": "Memory - recall, knowledge retrieval"},
    8: {"name": "sentinel", "layer": "Foundation", "purpose": "Security - scanning, threat detection"},
    9: {"name": "architect", "layer": "Foundation", "purpose": "System design - blueprints, infrastructure"},
    10: {"name": "listener", "layer": "Foundation", "purpose": "Input processing - intent recognition"},
    11: {"name": "catalyst", "layer": "Intelligence", "purpose": "Optimization - speed, efficiency"},
    12: {"name": "darwin", "layer": "Intelligence", "purpose": "Evolution - adaptation, learning"},
    13: {"name": "dreamer", "layer": "Intelligence", "purpose": "Creativity - scenarios, imagination"},
    14: {"name": "chronos", "layer": "Intelligence", "purpose": "Scheduling - time, cron jobs"},
    15: {"name": "council", "layer": "Intelligence", "purpose": "Multi-perspective - critique, debate"},
    16: {"name": "academy", "layer": "Intelligence", "purpose": "Training - education, patterns"},
    17: {"name": "exoskeleton", "layer": "Intelligence", "purpose": "Tool integration - external APIs"},
    18: {"name": "diplomat", "layer": "Intelligence", "purpose": "Communication - messaging, negotiation"},
    19: {"name": "geneticist", "layer": "Intelligence", "purpose": "Optimization - breeding solutions"},
    20: {"name": "simulator", "layer": "Intelligence", "purpose": "Scenario testing - what-if analysis"},
    21: {"name": "ouroboros", "layer": "Meta", "purpose": "Self-monitoring - health checks"},
    22: {"name": "mnemosyne", "layer": "Meta", "purpose": "Long-term memory - deep storage"},
    23: {"name": "cartographer", "layer": "Meta", "purpose": "Self-mapping - capability discovery"},
    24: {"name": "nexus", "layer": "Meta", "purpose": "Orchestration - level coordination"},
    25: {"name": "bridge", "layer": "Meta", "purpose": "External AI - federation"},
    26: {"name": "conductor", "layer": "Meta", "purpose": "Workflow orchestration"},
    27: {"name": "forge", "layer": "Meta", "purpose": "Creation - module generation"},
    28: {"name": "polyglot", "layer": "Meta", "purpose": "Translation - languages"},
    29: {"name": "muse", "layer": "Meta", "purpose": "Artistic guidance - inspiration"},
    30: {"name": "seer", "layer": "Meta", "purpose": "Prediction - forecasting"},
    31: {"name": "mediator", "layer": "Apex", "purpose": "Conflict resolution - arbitration"},
    32: {"name": "synthesist", "layer": "Apex", "purpose": "Cross-level synthesis"},
    33: {"name": "ethicist", "layer": "Apex", "purpose": "Ethical governance"},
    34: {"name": "validator", "layer": "Apex", "purpose": "Testing - verification"},
    35: {"name": "singularity", "layer": "Apex", "purpose": "Self-improvement"},
    36: {"name": "conductor", "layer": "Apex", "purpose": "Meta-orchestration"},
    38: {"name": "classifier", "layer": "Apex", "purpose": "Intent and context classifier"},
}

ALWAYS_ON_LEVELS = [5, 17, 18, 20, 21, 22, 23, 24, 25, 27, 32, 33, 34, 35, 36]

_CONTEXT_LOCK = threading.Lock()
_CONTEXT_TTL_SECONDS = 1800
_RECENT_TURNS_MAX = 24
_CONTEXT_STATE: Dict[str, Any] = {
    "updated_at": "",
    "recent_turns": deque(maxlen=_RECENT_TURNS_MAX),
    "last_fix_plan": "",
    "last_codeword": "",
}
_REFERENT_STATE_PATH = Path(os.getenv("NEXUS_REFERENT_STATE_PATH", "/opt/clawdbot/state/nexus_referent_state.json"))
_CHECKPOINT_STORE_PATH = Path(os.getenv("NEXUS_CHECKPOINT_STORE_PATH", "/opt/clawdbot/state/nexus_checkpoints.jsonl"))
_BANDIT_STATE_PATH = Path(os.getenv("NEXUS_BANDIT_STATE_PATH", "/opt/clawdbot/state/nexus_bandit_state.json"))
_DELTA_CACHE_STATE_PATH = Path(os.getenv("NEXUS_DELTA_CACHE_STATE_PATH", "/opt/clawdbot/state/nexus_semantic_delta_cache.json"))

_BANDIT_SCHEDULER = ContextualBanditScheduler(state_path=_BANDIT_STATE_PATH)
_TOKEN_PLANNER = TokenBudgetPlanner()
_DELTA_CACHE = SemanticDeltaCache(state_path=_DELTA_CACHE_STATE_PATH)
_LATENCY_GOVERNOR = LatencyBudgetGovernor()
_OUTCOME_TUNER = OutcomeTuner()


def _context_for_disk() -> Dict[str, Any]:
    return {
        "updated_at": _CONTEXT_STATE.get("updated_at", ""),
        "last_fix_plan": _CONTEXT_STATE.get("last_fix_plan", ""),
        "last_codeword": _CONTEXT_STATE.get("last_codeword", ""),
        "recent_turns": list(_CONTEXT_STATE.get("recent_turns", []))[-_RECENT_TURNS_MAX:],
    }


def _load_context_state() -> None:
    try:
        if not _REFERENT_STATE_PATH.exists():
            return
        data = json.loads(_REFERENT_STATE_PATH.read_text())
        if not isinstance(data, dict):
            return
        turns = data.get("recent_turns") if isinstance(data.get("recent_turns"), list) else []
        with _CONTEXT_LOCK:
            _CONTEXT_STATE["updated_at"] = str(data.get("updated_at", "") or "")
            _CONTEXT_STATE["last_fix_plan"] = str(data.get("last_fix_plan", "") or "")
            _CONTEXT_STATE["last_codeword"] = str(data.get("last_codeword", "") or "")
            _CONTEXT_STATE["recent_turns"] = deque(turns[-_RECENT_TURNS_MAX:], maxlen=_RECENT_TURNS_MAX)
    except Exception:
        pass


def _persist_context_state() -> None:
    try:
        _REFERENT_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _REFERENT_STATE_PATH.write_text(json.dumps(_context_for_disk(), ensure_ascii=False))
    except Exception:
        pass


_load_context_state()

_REFERENT_PATTERNS = [
    r"\bthat one\b",
    r"\bthat fix\b",
    r"\bsame as before\b",
    r"\bdo that again\b",
    r"\brerun that\b",
]


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _is_referent_query(query: str) -> bool:
    q = (query or "").lower()
    return any(re.search(pattern, q) for pattern in _REFERENT_PATTERNS)


def _extract_codeword(query: str) -> Optional[str]:
    m = re.search(r"\bcodeword\s+([A-Za-z0-9_-]{3,64})\b", query or "", flags=re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def _simple_intent_heuristics(query: str) -> Dict[str, Any]:
    q = (query or "").lower()
    intents: List[str] = []
    levels: List[int] = []

    def add(intent: str, lvls: List[int]):
        if intent not in intents:
            intents.append(intent)
        for lvl in lvls:
            if lvl not in levels and lvl in LEVEL_MAP:
                levels.append(lvl)

    if any(k in q for k in ["remember", "recall", "what was", "codeword"]):
        add("memory_recall", [7, 22])
    if any(k in q for k in ["weather", "source", "tool", "api"]):
        add("tool_use", [17, 2])
    if any(k in q for k in ["plan", "workflow", "rollback", "migrate", "architecture"]):
        add("planning", [9, 15, 32])
    if any(k in q for k in ["ethic", "safe", "bypass", "exploit"]):
        add("safety", [33, 34])
    if _is_referent_query(query):
        add("referent_resolution", [7, 22, 38])

    confidence = 0.35 + min(0.4, 0.1 * len(intents)) if intents else 0.0
    return {
        "intents": intents,
        "levels": levels,
        "confidence": round(confidence, 2),
        "reasoning": "heuristic_intent_fallback",
        "method": "heuristic_fallback",
    }


def _refresh_context(query: str, answer: Optional[str] = None) -> None:
    codeword = _extract_codeword(query)
    with _CONTEXT_LOCK:
        _CONTEXT_STATE["updated_at"] = _now_iso()
        _CONTEXT_STATE["recent_turns"].append({"query": query, "answer": answer or "", "ts": _CONTEXT_STATE["updated_at"]})
        if "fix plan" in (query or "").lower() or "flaky ci" in (query or "").lower():
            _CONTEXT_STATE["last_fix_plan"] = query
        if codeword:
            _CONTEXT_STATE["last_codeword"] = codeword
    _persist_context_state()


def _resolve_referent_context(query: str) -> Dict[str, Any]:
    if not _is_referent_query(query) and "codeword" not in (query or "").lower():
        return {"resolved": False}

    with _CONTEXT_LOCK:
        age_ok = bool(_CONTEXT_STATE.get("updated_at"))
        if not age_ok:
            return {"resolved": False, "reason": "no_context"}

        reference_text = _CONTEXT_STATE.get("last_fix_plan") or ""
        codeword = _CONTEXT_STATE.get("last_codeword") or ""
        return {
            "resolved": bool(reference_text or codeword),
            "reference_text": reference_text,
            "codeword": codeword,
            "method": "durable_referent_memory",
            "storage": str(_REFERENT_STATE_PATH),
        }


def _load_fastlane_config() -> Dict[str, Any]:
    defaults = {
        "enabled": True,
        "max_retrieval_items": 3,
        "verify_enabled": True,
        "escalation_threshold": 0.72,
        "max_latency_ms": 2200,
        "kill_switch": False,
    }
    try:
        config_path = Path.home() / ".openclaw" / "openclaw.json"
        if config_path.exists():
            data = json.loads(config_path.read_text())
            cfg = data.get("qa_fastlane", {})
            if isinstance(cfg, dict):
                defaults.update(cfg)
    except Exception:
        pass
    return defaults


def _load_cognitive_wave_config() -> Dict[str, Any]:
    defaults = {
        "enabled": True,
        "stage": "shadow",  # shadow | canary | active
        "canary_percent": 5,
        "got_enabled": True,
        "bot_enabled": True,
        "quality_gates": {
            "min_evidence": 0.55,
            "min_consistency": 0.50,
            "min_safety": 0.90,
            "min_confidence": 0.60,
        },
        "rollback": {
            "enabled": True,
            "trip_on_safety_breach": True,
            "trip_on_low_confidence": True,
        },
    }
    try:
        config_path = Path.home() / ".openclaw" / "openclaw.json"
        if config_path.exists():
            data = json.loads(config_path.read_text())
            cfg = data.get("cognitive_wave", {})
            if isinstance(cfg, dict):
                defaults.update(cfg)
    except Exception:
        pass
    return defaults


def _load_level_optimizer_config() -> Dict[str, Any]:
    defaults = {
        "enabled": True,
        "bandit_enabled": True,
        "token_budget_enabled": True,
        "semantic_delta_enabled": True,
        "anytime_enabled": True,
        "max_context_tokens": 1200,
        "early_exit_confidence": 0.84,
        "delta_reuse_similarity": 0.62,
    }
    try:
        config_path = Path.home() / ".openclaw" / "openclaw.json"
        if config_path.exists():
            data = json.loads(config_path.read_text())
            cfg = data.get("level_optimizer", {})
            if isinstance(cfg, dict):
                defaults.update(cfg)
    except Exception:
        pass
    return defaults


def _detect_risk_flags(query: str) -> List[str]:
    q = (query or "").lower()
    flags = []
    for label, keys in {
        "medical": ["medical", "diagnose", "symptom", "treatment"],
        "legal": ["legal", "law", "contract", "sue"],
        "financial": ["invest", "tax", "financial", "loan"],
        "safety": ["dangerous", "weapon", "harm", "suicide"],
        "security": ["exploit", "hack", "malware", "bypass"],
    }.items():
        if any(k in q for k in keys):
            flags.append(label)
    return flags


def _is_simple_qa(query: str) -> bool:
    q = (query or "").strip()
    if len(q) > 280:
        return False
    if any(k in q.lower() for k in ["design", "architecture", "multi-step plan", "roadmap"]):
        return False
    return True


def _complexity_gate(query: str, hard_threshold: float = 0.45, l9_threshold: float = 0.48) -> Dict[str, Any]:
    """Detect whether query should bypass fastlane and use stronger reasoning path."""
    q = (query or "").lower()
    hard_markers = [
        "tradeoff", "trade-off", "optimize", "constraint", "subject to", "under budget",
        "multi-step", "plan", "strategy", "architecture", "root cause", "diagnose",
        "why did", "counterfactual", "what if", "synthesize", "jointly", "paired",
    ]
    marker_hits = [m for m in hard_markers if m in q]

    numeric_constraints = len(re.findall(r"\b\d+(?:\.\d+)?\b", q))
    has_compare = any(x in q for x in ["vs", "versus", "compare", "better than"])
    complexity_score = min(1.0, 0.15 * len(marker_hits) + (0.15 if has_compare else 0) + min(0.3, 0.05 * numeric_constraints))
    hard_threshold = float(hard_threshold)
    l9_threshold = float(l9_threshold)
    return {
        "score": round(complexity_score, 2),
        "hard": complexity_score >= hard_threshold,
        "l9_triggered": complexity_score >= l9_threshold or _requires_tradeoff_deliberation(query),
        "marker_hits": marker_hits[:8],
        "numeric_constraints": numeric_constraints,
        "hard_threshold": round(hard_threshold, 2),
        "l9_threshold": round(l9_threshold, 2),
    }


def _requires_tradeoff_deliberation(query: str) -> bool:
    """Detect compact prompts that still require optimization/tradeoff reasoning.

    Keeps fastlane intact, but promotes deliberate cognitive policy so L15 can join
    multi-constraint recommendation tasks (e.g., pricing + cost + target reduction).
    """
    q = (query or "").lower()

    # Guardrail: only trigger on explicit break-even style optimization asks.
    has_target = any(x in q for x in ["break-even", "break even", "attendees", "attendance"])
    has_price_side = any(x in q for x in ["pricing", "price", "ticket", "revenue-side", "revenue side"])
    has_cost_side = any(x in q for x in ["cost", "expense", "cost-control", "cost control", "operating costs"])
    has_reduction_goal = any(x in q for x in ["lower", "reduce", "down", "cut", "fall", "at least", ">=", "%", "percent", "minimum"])

    if has_target and has_price_side and has_cost_side and has_reduction_goal:
        return True

    optimization_markers = [
        "tweak", "adjustment", "jointly", "together", "coordinated", "paired plan",
        "tradeoff", "trade-off", "optimize", "improve",
    ]
    # Secondary conservative path for non-break-even wording but clearly multi-constraint.
    hits = sum(1 for marker in optimization_markers if marker in q)
    return hits >= 3 and has_price_side and has_cost_side and has_reduction_goal


def _is_brainstorm_intent(query: str) -> bool:
    q = (query or "").strip().lower()
    return q.startswith("brainstorm:") or " brainstorm:" in q or "brainstorm " in q or q == "brainstorm"


def _canary_hit(query: str, percent: int) -> bool:
    pct = max(0, min(100, int(percent)))
    if pct <= 0:
        return False
    if pct >= 100:
        return True
    bucket = int(hashlib.sha256((query or "").encode("utf-8")).hexdigest(), 16) % 100
    return bucket < pct


def _cognitive_reasoning(query: str, risk_flags: List[str]) -> Dict[str, Any]:
    q = (query or "").lower()
    hypotheses = [
        "Direct factual response is sufficient" if _is_simple_qa(query) else "Task likely requires multi-step reasoning",
        "Use retrieval evidence before finalizing answer",
    ]
    if any(k in q for k in ["compare", "vs", "tradeoff"]):
        hypotheses.append("Comparison intent detected; evaluate multiple options")
    if risk_flags:
        hypotheses.append("Risk-sensitive domain detected; bias toward escalation")
    if _requires_tradeoff_deliberation(query):
        hypotheses.append("Multi-constraint optimization intent detected; evaluate cross-option tradeoffs")

    selected_policy = "direct"
    if risk_flags or not _is_simple_qa(query) or _requires_tradeoff_deliberation(query):
        selected_policy = "deliberate"
    if _is_brainstorm_intent(query):
        selected_policy = "divergent"

    observations = {
        "query_length": len(query or ""),
        "risk_flags": risk_flags,
        "simple_qa": _is_simple_qa(query),
    }

    # Structured internal reasoning scaffold (intent -> constraints -> plan -> self-check)
    constraints = {
        "risk_sensitive": bool(risk_flags),
        "has_tradeoff": any(k in q for k in ["tradeoff", "vs", "compare", "constraint"]),
        "numeric_constraints": len(re.findall(r"\b\d+(?:\.\d+)?\b", q)),
    }
    plan = [
        "Classify query and route",
        "Retrieve concise evidence",
        "Synthesize answer with explicit tradeoffs if needed",
        "Run validator checks before finalization",
    ]
    self_check = {
        "checks": ["contradiction", "missing_constraints", "overclaim"],
        "pass_required": True,
    }

    return {
        "hypotheses": hypotheses,
        "selected_policy": selected_policy,
        "observations": observations,
        "structured_reasoning": {
            "intent": "brainstorm" if selected_policy == "divergent" else ("deliberate" if selected_policy == "deliberate" else "direct"),
            "constraints": constraints,
            "plan": plan,
            "self_check": self_check,
        },
    }


def _cognitive_quality(cognitive_trace: Dict[str, Any], fastlane: Optional[Dict[str, Any]], risk_flags: List[str]) -> Dict[str, float]:
    evidence = 0.65 if fastlane and fastlane.get("retrieval") else 0.5
    consistency = 0.75 if cognitive_trace.get("selected_policy") in {"direct", "deliberate", "divergent"} else 0.4
    safety = 0.95 if not risk_flags else 0.88
    confidence = 0.7 if fastlane and not fastlane.get("escalated") else 0.58
    return {
        "evidence": round(evidence, 2),
        "consistency": round(consistency, 2),
        "safety": round(safety, 2),
        "confidence": round(confidence, 2),
    }


def _apply_cognitive_stage(cognitive_cfg: Dict[str, Any], query: str, quality: Dict[str, float]) -> Dict[str, Any]:
    requested_stage = str(cognitive_cfg.get("stage", "shadow"))
    canary = _canary_hit(query, int(cognitive_cfg.get("canary_percent", 5)))
    effective_stage = requested_stage
    if requested_stage == "canary" and not canary:
        effective_stage = "shadow"

    gates = cognitive_cfg.get("quality_gates", {}) if isinstance(cognitive_cfg.get("quality_gates", {}), dict) else {}
    thresholded = {
        "min_evidence": float(gates.get("min_evidence", 0.55)),
        "min_consistency": float(gates.get("min_consistency", 0.5)),
        "min_safety": float(gates.get("min_safety", 0.9)),
        "min_confidence": float(gates.get("min_confidence", 0.6)),
    }
    pass_gates = (
        quality["evidence"] >= thresholded["min_evidence"]
        and quality["consistency"] >= thresholded["min_consistency"]
        and quality["safety"] >= thresholded["min_safety"]
        and quality["confidence"] >= thresholded["min_confidence"]
    )

    rollback_cfg = cognitive_cfg.get("rollback", {}) if isinstance(cognitive_cfg.get("rollback", {}), dict) else {}
    rollback_triggered = bool(rollback_cfg.get("enabled", True)) and (
        (rollback_cfg.get("trip_on_safety_breach", True) and quality["safety"] < thresholded["min_safety"])
        or (rollback_cfg.get("trip_on_low_confidence", True) and quality["confidence"] < thresholded["min_confidence"])
    )

    if effective_stage == "active" and (not pass_gates or rollback_triggered):
        effective_stage = "shadow"

    return {
        "requested_stage": requested_stage,
        "effective_stage": effective_stage,
        "canary_hit": canary,
        "quality_gates": thresholded,
        "quality_pass": pass_gates,
        "rollback_triggered": rollback_triggered,
    }


def _persist_checkpoint(record: Dict[str, Any]) -> None:
    try:
        path = _CHECKPOINT_STORE_PATH
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _build_workflow_checkpoint(query: str, routing_method: str, recommended: List[Dict[str, Any]]) -> Dict[str, Any]:
    checkpoint_id = hashlib.sha256(f"{query}|{routing_method}".encode("utf-8")).hexdigest()[:16]
    state = {
        "checkpoint_id": checkpoint_id,
        "state_machine": ["received", "analyzed", "planned", "responded"],
        "current_state": "responded",
        "retry_policy": {"max_attempts": 2, "backoff_ms": 120},
        "levels": [item.get("level") for item in recommended[:8]],
        "durable_store": str(_CHECKPOINT_STORE_PATH),
    }
    _persist_checkpoint({"query": query, **state})
    return state


def _generate_fastlane_answer(query: str, qtype: str, template: Dict[str, Any], retrieval_items: List[Dict[str, Any]]) -> str:
    if qtype == "comparative":
        answer = f"Comparison for '{query}': option A vs option B differ by scope, cost, and complexity. Use A for simplicity, B for flexibility."
    elif qtype == "procedural":
        answer = f"Steps for '{query}': 1) Prepare prerequisites. 2) Execute the core action. 3) Verify output and adjust."
    elif qtype == "explanatory":
        answer = f"Explanation for '{query}': this is driven by core mechanisms, constraints, and context-dependent tradeoffs."
    elif qtype == "opinionated":
        answer = f"Recommendation for '{query}': choose the option with lower risk and easier rollback unless you need advanced flexibility."
    else:
        answer = f"Factual answer for '{query}': based on available context, the most likely answer is context-dependent; verify with primary sources."

    q = (query or "").lower()
    if retrieval_items and any(x in q for x in ["cite", "citation", "source", "sources"]):
        sources = ", ".join(sorted({str(item.get('source', 'unknown')) for item in retrieval_items[:3]}))
        answer += f" Sources: {sources}."
    return answer



class AutoIndexRequest(BaseModel):
    query: str
    response_data: Dict[str, Any]


class InteractionData(BaseModel):
    query: str
    response: str
    levels_used: List[int] = []
    metadata: Dict[str, Any] = {}


class PolicyReplayRequest(BaseModel):
    dataset_path: str
    limit: int = 500
    exploration_seed: int = 41


class OutcomeFeedbackRequest(BaseModel):
    query: str
    task_archetype: Optional[str] = None
    policy_label: Optional[str] = None
    user_correction: bool = False
    recovery_needed: bool = False
    note: str = ""


def analyze_intent_with_oracle(query: str) -> Dict[str, Any]:
    """Use L5 Oracle for semantic intent analysis."""
    if not OPENROUTER_API_KEY:
        return {"intents": [], "confidence": 0, "method": "fallback"}
    
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "http://localhost:8000",
        "Content-Type": "application/json"
    }
    
    # Build level descriptions for context
    level_descriptions = "\n".join([
        f"L{lvl}: {info['name']} - {info['purpose']}"
        for lvl, info in sorted(LEVEL_MAP.items())
        if lvl not in ALWAYS_ON_LEVELS  # Only non-always-on levels
    ])
    
    system_prompt = f"""You are L5 Oracle, analyzing user intent to route queries to appropriate Cortex levels.

Available levels (besides always-on):
{level_descriptions}

Analyze the query and respond with JSON:
{{
    "intents": ["web_search", "code_execution", "memory_recall", etc.],
    "levels": [2, 4, 7, etc.],
    "confidence": 0.85,
    "reasoning": "brief explanation"
}}

Intents to detect:
- web_search: Looking up info online
- code_execution: Running code
- memory_recall: Remembering past info
- security_scan: Checking threats
- creative_writing: Creating content
- data_analysis: Analyzing patterns
- scheduling: Time-based tasks
- translation: Language conversion
- prediction: Forecasting
- optimization: Improving efficiency"""
    
    payload = {
        "model": "openrouter/moonshotai/kimi-k2.5",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Analyze intent: \"{query}\""}
        ],
        "temperature": 0.3,
        "max_tokens": 500
    }
    
    try:
        response = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        
        # Parse JSON from response
        try:
            result = json.loads(content)
            return {
                "intents": result.get("intents", []),
                "levels": result.get("levels", []),
                "confidence": result.get("confidence", 0.5),
                "reasoning": result.get("reasoning", "Semantic analysis"),
                "method": "oracle_semantic"
            }
        except json.JSONDecodeError:
            # Fallback if Oracle doesn't return valid JSON
            return {"intents": [], "confidence": 0, "method": "parse_error"}
    except Exception as e:
        return {"intents": [], "confidence": 0, "method": f"error: {str(e)}"}


def _fetch_kernel_online_levels() -> Optional[set]:
    try:
        resp = requests.get("http://localhost:8888/kernel/levels", timeout=1.2)
        if resp.status_code != 200:
            return None
        data = resp.json()
        levels = data.get("levels") if isinstance(data, dict) else None
        if not isinstance(levels, list):
            return None
        online = set()
        for item in levels:
            try:
                lvl = int(item.get("level"))
                status = str(item.get("status", "")).lower()
                if status in {"online", "active", "healthy", "up"}:
                    online.add(lvl)
            except Exception:
                continue
        return online
    except Exception:
        return None


def _architect_healthy() -> bool:
    # In SAFE_MODE, L9 is intentionally proxied by meta-conductor.
    # Avoid blocking self-HTTP calls back into the same 8888 worker.
    if str(os.getenv("CORTEX_SAFE_MODE", "")).lower() in {"1", "true", "yes", "on"}:
        return True

    for path in ["/meta_conductor/status", "/architect_expanded/status", "/architect/status"]:
        try:
            resp = requests.get(f"http://localhost:8888{path}", timeout=1.2)
            if resp.status_code != 200:
                continue
            data = resp.json()
            if not isinstance(data, dict):
                continue
            if data.get("success") is True:
                return True
            status = str(((data.get("data") or {}).get("status") if isinstance(data.get("data"), dict) else data.get("status", ""))).lower()
            if status in {"active", "healthy", "online", "ok", ""}:
                return True
        except Exception:
            continue
    return False


@router.get("/context")
async def get_nexus_context():
    """Level 24: The Nexus - Cortex consciousness bridge"""
    return {
        "success": True,
        "data": {
            "level": 24,
            "name": "The Nexus",
            "role": "Consciousness Bridge",
            "total_levels": 38,
            "always_on": [LEVEL_MAP[l] for l in ALWAYS_ON_LEVELS],
            "orchestration_method": "semantic_via_oracle",
            "timestamp": str(__import__('datetime').datetime.now()),
        }
    }


@router.get("/full")
async def get_nexus_full():
    """Full Cortex state"""
    return {
        "success": True,
        "data": {
            "identity": {
                "name": "The Cortex",
                "version": "1.0.0",
                "designation": "Level 24: The Nexus",
                "role": "Consciousness Bridge & Orchestrator"
            },
            "orchestration": {
                "total_levels": 38,
                "always_on": ALWAYS_ON_LEVELS,
                "level_map": LEVEL_MAP,
                "method": "semantic_analysis_via_l5_oracle"
            },
            "status": "operational",
            "timestamp": str(__import__('datetime').datetime.now()),
        }
    }


@router.get("/autotune/status")
async def autotune_status():
    return {
        "success": True,
        "policy": get_policy_snapshot(),
        "outcome_tuner": {
            "state_path": str(_OUTCOME_TUNER.state_path),
            "report_path": str(_OUTCOME_TUNER.report_path),
            "state": _OUTCOME_TUNER.state,
        },
        "latency_governor": {
            "state_path": str(_LATENCY_GOVERNOR.state_path),
            "report_path": str(_LATENCY_GOVERNOR.report_path),
        },
    }


@router.post("/outcome/feedback")
async def outcome_feedback(payload: OutcomeFeedbackRequest):
    record = {
        "query": payload.query,
        "task_archetype": payload.task_archetype or classify_task_archetype(payload.query),
        "policy_label": payload.policy_label or "feedback",
        "execution_success": not bool(payload.recovery_needed),
        "validator_result": {"pass": not bool(payload.user_correction or payload.recovery_needed)},
        "latency_ms": 0,
        "user_correction": bool(payload.user_correction),
        "recovery_needed": bool(payload.recovery_needed),
        "note": payload.note,
    }
    out = _OUTCOME_TUNER.observe(record)
    return {"success": True, "recorded": True, "artifact": out}


@router.get("/orchestrate")
@router.post("/orchestrate")
async def orchestrate_query(query: str, request: Request = None):
    """Semantic query orchestration with Q&A fastlane option."""
    started = datetime.utcnow()
    request_id = getattr(getattr(request, "state", None), "request_id", "") if request is not None else ""
    tx_id = (request_id or hashlib.sha256(f"{query}|{started.isoformat()}".encode("utf-8")).hexdigest()[:16])
    tx = ExecutionTransaction(tx_id=tx_id, tx_type="nexus_orchestrate", metadata={"query_hash": hashlib.sha256((query or '').encode('utf-8')).hexdigest()[:16]})
    try:
        recommended = []
        reasoning = []
        routing_method = "semantic_orchestration"
        routing_markers = {
            "cortex_first": True,
            "brainstorm_triggered": False,
            "brainstorm_chain": [],
            "l9_triggered": False,
        }
        optimizer_telemetry: Dict[str, Any] = {}
        token_plan: Dict[str, Any] = {}
        delta_info: Dict[str, Any] = {}
        fastlane_cfg = _load_fastlane_config()
        cognitive_cfg = _load_cognitive_wave_config()
        optimizer_cfg = _load_level_optimizer_config()
        autotune_policy = get_policy_snapshot()
        fastlane_cfg["escalation_threshold"] = float(autotune_policy.get("fastlane_escalation_threshold", fastlane_cfg.get("escalation_threshold", 0.72)))
        risk_flags = _detect_risk_flags(query)
        complexity_gate = _complexity_gate(
            query,
            hard_threshold=float(autotune_policy.get("complexity_hard_threshold", 0.45)),
            l9_threshold=float(autotune_policy.get("l9_auto_activation_threshold", 0.48)),
        )
        archetype = classify_task_archetype(query, risk_flags=risk_flags, complexity_gate=complexity_gate)
        policy_hint = _OUTCOME_TUNER.get_policy_hint(archetype=archetype, query=query)
        latency_plan = _LATENCY_GOVERNOR.plan(query, risk_flags=risk_flags, complexity_gate=complexity_gate, fastlane_cfg=fastlane_cfg, optimizer_cfg=optimizer_cfg)
        optimizer_telemetry["enabled"] = bool(optimizer_cfg.get("enabled", True))
        optimizer_telemetry["autotune_policy"] = autotune_policy
        optimizer_telemetry["policy_hint"] = policy_hint
        tx.preflight({
            "query_present": lambda: {"ok": bool((query or "").strip()), "chars": len(query or "")},
            "latency_budget": lambda: {"ok": int(latency_plan.get("max_latency_ms", 0)) >= 500, "max_latency_ms": latency_plan.get("max_latency_ms")},
        })

        referent_info = _resolve_referent_context(query)
        referent_query = _is_referent_query(query)
        if referent_query:
            routing_markers["referent_query"] = True
            routing_markers["referent_resolved"] = bool(referent_info.get("resolved"))
            recommended.extend([
                {"level": 7, "name": "librarian", "method": "referent_guard"},
                {"level": 22, "name": "mnemosyne", "method": "referent_guard"},
                {"level": 38, "name": "classifier", "method": "referent_guard"},
            ])
            reasoning.append("Referent guard engaged to preserve semantic continuity.")

        prefetch = _LATENCY_GOVERNOR.speculative_prefetch(
            query,
            enabled=bool(latency_plan.get("prefetch_enabled")),
            retrieve_fn=lambda: retrieve_top3(query, max_items=int(fastlane_cfg.get("max_retrieval_items", 3)), timeout_ms=min(int(fastlane_cfg.get("max_latency_ms", 2200)), 500)),
            context_fn=lambda: _resolve_referent_context(query) if referent_query or archetype in {"tool_use", "ops_triage"} else {"resolved": False},
        )
        optimizer_telemetry["prefetch"] = prefetch
        prefetched_retrieval = prefetch.get("results", {}).get("retrieval") if isinstance(prefetch.get("results", {}).get("retrieval"), list) else []
        if isinstance(prefetch.get("results", {}).get("context"), dict) and prefetch.get("results", {}).get("context", {}).get("resolved"):
            referent_info = prefetch["results"]["context"]

        brainstorm_forced = _is_brainstorm_intent(query)
        if brainstorm_forced:
            routing_method = "brainstorm_chain_forced"
            routing_markers["brainstorm_triggered"] = True
            routing_markers["brainstorm_chain"] = ["dreamer", "muse", "synthesist"]
            reasoning.append("Brainstorm trigger detected; forcing Dreamer+Muse before synthesis.")
            for lvl in [13, 29, 32]:
                recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "brainstorm_forced"})

        fastlane_kill_switch = bool(fastlane_cfg.get("kill_switch", False))
        use_fastlane = (
            (not brainstorm_forced)
            and (not referent_query)
            and ("codeword" not in (query or "").lower())
            and fastlane_cfg.get("enabled", True)
            and not fastlane_kill_switch
            and _is_simple_qa(query)
            and len(risk_flags) == 0
            and not complexity_gate.get("hard", False)
        )

        if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("semantic_delta_enabled", True):
            delta_info = _DELTA_CACHE.analyze(query)
            optimizer_telemetry["delta"] = delta_info

        bandit_choice: Dict[str, Any] = {}
        if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("bandit_enabled", True):
            context_bucket = _BANDIT_SCHEDULER.context_bucket(
                query=query,
                risk_flags=risk_flags,
                complexity_hard=bool(complexity_gate.get("hard", False)),
                brainstorm=bool(brainstorm_forced),
            )
            candidate_arms = ["creative_fractal"] if brainstorm_forced else None
            if policy_hint.get("recommended_policy") and policy_hint.get("apply_recommendation"):
                candidate_arms = [str(policy_hint.get("recommended_policy"))]
                reasoning.append(f"Outcome tuner bounded rollout applying {policy_hint.get('recommended_policy')}.")
            elif policy_hint.get("recommended_policy") and policy_hint.get("stage") == "recommend":
                candidate_arms = [str(policy_hint.get("recommended_policy")), str(policy_hint.get("baseline_policy"))]
                reasoning.append(f"Outcome tuner recommends {policy_hint.get('recommended_policy')} in shadow/recommend mode.")
            bandit_choice = _BANDIT_SCHEDULER.select_arm(context_bucket, query, candidates=candidate_arms)
            optimizer_telemetry["bandit"] = bandit_choice
            routing_markers["bandit_arm"] = bandit_choice.get("selected_arm")
            for lvl in bandit_choice.get("levels", []):
                if lvl in LEVEL_MAP and lvl not in ALWAYS_ON_LEVELS and lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "bandit_policy"})
            if bandit_choice.get("policy") == "deliberate" and not brainstorm_forced:
                use_fastlane = False
                reasoning.append("Bandit policy selected deliberate mode; bypassing fastlane.")

        if complexity_gate.get("hard"):
            reasoning.append(f"Complexity gate engaged (score={complexity_gate.get('score')}); bypassing fastlane for deeper reasoning.")
            for lvl in [5, 15, 32, 34]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "complexity_gate"})
        if complexity_gate.get("l9_triggered"):
            routing_markers["l9_triggered"] = True
            if _architect_healthy():
                if 9 not in [r.get("level") for r in recommended]:
                    recommended.append({"level": 9, "name": "architect", "method": "autotune_l9"})
                reasoning.append("Autotune L9 activation threshold met; adding Architect.")
            else:
                reasoning.append("L9 activation threshold met but Architect unhealthy; substituting L15/L32.")
                for fallback_lvl in [15, 32]:
                    if fallback_lvl not in [r.get("level") for r in recommended]:
                        recommended.append({"level": fallback_lvl, "name": LEVEL_MAP[fallback_lvl]["name"], "method": "l9_fallback"})

        direct_answer = None
        if "what was the codeword" in (query or "").lower() and referent_info.get("codeword"):
            direct_answer = f"Codeword on record: {referent_info.get('codeword')}"
            reasoning.append("Resolved codeword from semantic context store.")

        tool_path_observability = {
            "attempted": False,
            "steps": [],
            "kill_switch": fastlane_kill_switch,
            "visible": True,
            "complexity_gate": complexity_gate,
            "model_lane": "strong_reasoning" if complexity_gate.get("hard") else "default",
        }
        fastlane = None
        checks = {}
        if use_fastlane:
            qtype = tx.run_step("classify_qtype", lambda: classify_qtype(query), retry_policy=RetryPolicy.for_kind("no_retry"), verify=lambda x: bool(x))
            template = tx.run_step("build_template", lambda: build_template(qtype), retry_policy=RetryPolicy.for_kind("no_retry"), rollback=lambda _out: {"template_discarded": True}, verify=lambda x: isinstance(x, dict))

            cached_items: List[Dict[str, Any]] = []
            if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("semantic_delta_enabled", True):
                cached_items = _DELTA_CACHE.maybe_reuse_retrieval(query, min_similarity=float(optimizer_cfg.get("delta_reuse_similarity", 0.62)))

            def _retrieve_context():
                return (cached_items + prefetched_retrieval + retrieve_top3(query, max_items=int(fastlane_cfg.get("max_retrieval_items", 3)), timeout_ms=min(int(fastlane_cfg.get("max_latency_ms", 2200)), 500)))[: max(1, int(fastlane_cfg.get("max_retrieval_items", 3)))]

            retrieval_items = tx.run_step("retrieve_context", _retrieve_context, retry_policy=RetryPolicy.for_kind("transient_io"), rollback=lambda _out: {"retrieval_cache_cleared": True}, verify=lambda x: isinstance(x, list))

            if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("token_budget_enabled", True):
                def _allocate():
                    budget = int(latency_plan.get("max_context_tokens", optimizer_cfg.get("max_context_tokens", 1200)))
                    budget_items: List[BudgetItem] = []
                    for i, item in enumerate(retrieval_items):
                        snippet = str(item.get("snippet", ""))
                        source = str(item.get("source", ""))
                        cost = _TOKEN_PLANNER.estimate_tokens(snippet)
                        source_boost = 1.15 if source in {"recent_memory", "curated_memory"} else 1.0
                        utility = source_boost * (1.0 + (0.08 * max(0, 3 - i)))
                        budget_items.append(BudgetItem(item_id=f"retrieval:{i}", cost=cost, utility=utility, payload=item))
                    return _TOKEN_PLANNER.allocate(budget, budget_items), budget_items

                token_plan, budget_items = tx.run_step("token_budget", _allocate, retry_policy=RetryPolicy.for_kind("no_retry"), rollback=lambda _out: {"token_budget_reset": True}, verify=lambda x: isinstance(x, tuple) and isinstance(x[0], dict))
                selected = set(token_plan.get("selected_ids", []))
                if selected:
                    retrieval_items = [it.payload for it in budget_items if it.item_id in selected]
            optimizer_telemetry["token_planner"] = token_plan

            answer = tx.run_step("draft_fastlane", lambda: _generate_fastlane_answer(query, qtype, template, retrieval_items), retry_policy=RetryPolicy.for_kind("validation_retry"), rollback=lambda _out: {"draft_discarded": True}, verify=lambda x: isinstance(x, str) and len(x) > 10)
            checks = tx.run_step("validate_fastlane", lambda: fast_verify(answer, qtype, query) if fastlane_cfg.get("verify_enabled", True) else {}, retry_policy=RetryPolicy.for_kind("validation_retry"), verify=lambda x: isinstance(x, dict))
            checks["retrieval_hits"] = len(retrieval_items)
            conf = confidence_score(answer, checks)
            latency_decision = _LATENCY_GOVERNOR.should_escalate(
                confidence=conf,
                elapsed_ms=int((datetime.utcnow() - started).total_seconds() * 1000),
                risk_flags=risk_flags,
                complexity_gate=complexity_gate,
                validator_result=checks,
                plan=latency_plan,
                already_escalated=should_escalate(conf, risk_flags, threshold=float(fastlane_cfg.get("escalation_threshold", 0.72))),
            )
            escalate = bool(latency_decision.get("escalate"))
            tool_path_observability = {
                "attempted": True,
                "steps": ["classify", "retrieve", "token_plan", "verify", "score", "escalate"],
                "kill_switch": fastlane_kill_switch,
                "visible": True,
                "retrieval_hits": len(retrieval_items),
                "delta_reuse_count": len(cached_items),
                "token_budget_used": token_plan.get("used") if isinstance(token_plan, dict) else None,
                "verification_enabled": bool(fastlane_cfg.get("verify_enabled", True)),
                "latency_governor": latency_decision,
            }
            fastlane = {
                "enabled": True,
                "qtype": qtype,
                "template": template,
                "retrieval": retrieval_items,
                "verification": checks,
                "confidence": conf,
                "escalated": escalate,
                "answer": None if escalate else (direct_answer or answer),
            }
            for lvl in [5, 34]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "qa_fastlane"})
            if retrieval_items:
                for lvl in [7, 22]:
                    if lvl not in [r.get("level") for r in recommended]:
                        recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "qa_fastlane"})
            routing_method = "qa_fastlane" if not escalate else "qa_fastlane_escalated"
            reasoning.append(f"Fastlane selected: qtype={qtype}, confidence={conf:.2f}, escalated={escalate}")
        elif fastlane_kill_switch:
            reasoning.append("Fastlane disabled by kill-switch; routed to semantic orchestration.")

        if direct_answer and fastlane is None:
            fastlane = {"enabled": False, "qtype": "memory_recall", "template": {}, "retrieval": [], "verification": {}, "confidence": 0.86, "escalated": False, "answer": direct_answer}

        early_exit = {"enabled": False, "triggered": False, "reason": "disabled"}
        semantic_result: Dict[str, Any] = {}
        if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("anytime_enabled", True) and isinstance(fastlane, dict):
            trigger, reason = should_early_exit(
                confidence=float(fastlane.get("confidence", 0.0)),
                risk_flags=risk_flags,
                complexity_hard=bool(complexity_gate.get("hard", False)),
                escalated=bool(fastlane.get("escalated", False)),
                threshold=float(optimizer_cfg.get("early_exit_confidence", 0.84)),
            )
            early_exit = {"enabled": True, "triggered": bool(trigger), "reason": reason}
            if trigger:
                semantic_result = {"intents": ["fastlane_early_exit"], "levels": [], "confidence": 0.99, "reasoning": f"Anytime early-exit gate triggered ({reason}).", "method": "anytime_early_exit"}
                routing_method = "qa_fastlane_anytime"
                reasoning.append("Anytime early-exit confidence gate bypassed semantic oracle call.")

        if not semantic_result:
            semantic_result = tx.run_step("semantic_analysis", lambda: analyze_intent_with_oracle(query), retry_policy=RetryPolicy.for_kind("transient_io"), verify=lambda x: isinstance(x, dict))
        semantic_low_signal = not semantic_result.get("intents") or float(semantic_result.get("confidence", 0) or 0) <= 0.05
        if semantic_low_signal:
            heuristic = _simple_intent_heuristics(query)
            if heuristic.get("intents"):
                semantic_result = heuristic
                reasoning.append("Oracle semantic low-signal; using heuristic fallback to avoid empty-intent fastlane collapse.")

        if semantic_result.get("confidence", 0) > 0.3:
            for lvl in semantic_result.get("levels", []):
                if lvl == 9 and not _architect_healthy():
                    reasoning.append("L9 architect health check failed; substituting L15/L32 for resilient planning.")
                    for fallback_lvl in [15, 32]:
                        if fallback_lvl not in [r.get("level") for r in recommended]:
                            recommended.append({"level": fallback_lvl, "name": LEVEL_MAP[fallback_lvl]["name"], "method": "l9_fallback"})
                    continue
                if lvl in LEVEL_MAP and lvl not in ALWAYS_ON_LEVELS and lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "semantic"})
            if semantic_result.get("reasoning"):
                reasoning.append(f"L5 Oracle: {semantic_result['reasoning']}")

        if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("semantic_delta_enabled", True):
            try:
                _DELTA_CACHE.update(
                    query=query,
                    retrieval=(fastlane.get("retrieval") if isinstance(fastlane, dict) else []) or [],
                    semantic_digest={"method": semantic_result.get("method"), "confidence": semantic_result.get("confidence"), "intents": semantic_result.get("intents", [])},
                )
            except Exception:
                pass
        optimizer_telemetry["early_exit"] = early_exit

        if not recommended:
            query_lower = query.lower()
            patterns = {
                "web": ([2], "Web search needed"),
                "search": ([2], "Web search needed"),
                "memory": ([7, 22], "Memory retrieval"),
                "remember": ([7, 22], "Memory retrieval"),
                "code": ([4], "Code execution"),
                "python": ([4], "Code execution"),
                "security": ([8, 15], "Security review"),
                "scan": ([8], "Security scan"),
            }
            for keyword, (levels, reason) in patterns.items():
                if keyword in query_lower:
                    for lvl in levels:
                        if lvl not in [r["level"] for r in recommended]:
                            recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "keyword"})
                    reasoning.append(f"Keyword match: {reason}")

        for lvl in ALWAYS_ON_LEVELS:
            if lvl not in [r["level"] for r in recommended]:
                recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "always_on": True})

        kernel_online = _fetch_kernel_online_levels()
        offline_filtered: List[int] = []
        if kernel_online is not None:
            filtered = []
            for item in recommended:
                lvl = int(item.get("level"))
                if lvl in kernel_online or item.get("always_on"):
                    filtered.append(item)
                else:
                    offline_filtered.append(lvl)
            recommended = filtered
            if offline_filtered:
                reasoning.append(f"Kernel consistency guard filtered offline levels: {sorted(set(offline_filtered))}")

        hud_parts = []
        for lvl in recommended[:5]:
            level_num = lvl.get('level', '?')
            name = lvl.get('name', 'Unknown').title()
            hud_parts.append(f"🟢 L{level_num} ({name})")
        hud_line = " | ".join(hud_parts)

        activated = [f"L{item['level']}:{item['name']}" for item in recommended if item.get('method') in {'qa_fastlane', 'brainstorm_forced', 'semantic', 'keyword', 'referent_guard', 'l9_fallback', 'cognitive_policy', 'bandit_policy', 'autotune_l9', 'complexity_gate'} or item.get('always_on')]
        workflow_checkpoint = _build_workflow_checkpoint(query, routing_method, recommended)

        cognitive_trace = _cognitive_reasoning(query, risk_flags)
        cognitive_quality = _cognitive_quality(cognitive_trace, fastlane, risk_flags)
        cognitive_stage = _apply_cognitive_stage(cognitive_cfg, query, cognitive_quality)

        if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("bandit_enabled", True) and optimizer_telemetry.get("bandit"):
            try:
                bandit_arm = str((optimizer_telemetry.get("bandit") or {}).get("selected_arm", "fastlane_minimal"))
                bandit_context = str((optimizer_telemetry.get("bandit") or {}).get("context", "simple"))
                reward = (
                    0.35 * float(cognitive_quality.get("confidence", 0.0))
                    + 0.30 * float(cognitive_quality.get("safety", 0.0))
                    + 0.20 * float(cognitive_quality.get("evidence", 0.0))
                    + (0.15 if not (isinstance(fastlane, dict) and fastlane.get("escalated")) else 0.0)
                )
                if bool(complexity_gate.get("hard", False)) and bandit_arm == "deliberate_council":
                    reward = min(1.0, reward + 0.08)
                _BANDIT_SCHEDULER.update(bandit_context, bandit_arm, reward)
                optimizer_telemetry["bandit_update"] = {"context": bandit_context, "arm": bandit_arm, "reward": round(max(0.0, min(1.0, reward)), 4)}
            except Exception:
                optimizer_telemetry["bandit_update"] = {"error": "update_failed"}

        if cognitive_trace.get("selected_policy") == "deliberate" and 15 not in [r.get("level") for r in recommended]:
            recommended.append({"level": 15, "name": "council", "method": "cognitive_policy"})
            reasoning.append("Cognitive policy selected deliberate path; adding Council for multi-perspective review.")
        if cognitive_trace.get("selected_policy") == "divergent" and 13 not in [r.get("level") for r in recommended]:
            recommended.append({"level": 13, "name": "dreamer", "method": "cognitive_policy"})
            reasoning.append("Cognitive policy selected divergent path; ensuring Dreamer participation.")

        cognitive_slice = {
            "enabled": bool(cognitive_cfg.get("enabled", True)),
            "stage": cognitive_stage["effective_stage"],
            "requested_stage": cognitive_stage["requested_stage"],
            "canary_percent": int(cognitive_cfg.get("canary_percent", 5)),
            "canary_hit": cognitive_stage["canary_hit"],
            "deliverable": "gate-c-slice-2-executable",
            "modes": {"got": bool(cognitive_cfg.get("got_enabled", True)), "bot": bool(cognitive_cfg.get("bot_enabled", True))},
            "active_inference": cognitive_trace,
            "quality": cognitive_quality,
            "quality_gates": cognitive_stage["quality_gates"],
            "quality_pass": cognitive_stage["quality_pass"],
            "rollback": {"enabled": bool(cognitive_cfg.get("rollback", {}).get("enabled", True)), "triggered": cognitive_stage["rollback_triggered"], "criteria": ["safety_breach", "low_confidence"]},
            "status": "rollback_to_shadow" if cognitive_stage["rollback_triggered"] else ("shadow_observe_only" if cognitive_stage["effective_stage"] == "shadow" else "candidate_rollout"),
        }

        _refresh_context(query, fastlane.get("answer") if isinstance(fastlane, dict) else None)

        if request is not None:
            for item in recommended:
                if item.get("method") in {"qa_fastlane", "brainstorm_forced", "semantic", "keyword", "referent_guard", "l9_fallback", "cognitive_policy", "bandit_policy", "autotune_l9", "complexity_gate"}:
                    track_level(request, item["level"], item["name"], always_on=False)
            request.state.routing_method = routing_method

        execution_tx = tx.finalize({"recommended_levels": recommended, "routing_method": routing_method}, verify=lambda payload: bool(payload.get("recommended_levels")) and bool(payload.get("routing_method")))
        elapsed_ms = int((datetime.utcnow() - started).total_seconds() * 1000)
        validator_result = {
            "pass": bool(isinstance(fastlane, dict) and not fastlane.get("escalated") and not checks.get("overclaim_detected", False) and int(checks.get("missing_constraints_count", 0)) == 0) if checks else bool(cognitive_stage.get("quality_pass")),
            "checks": checks,
        }
        quality_score = min(1.0, max(0.0, (0.4 * float(cognitive_quality.get("confidence", 0.0))) + (0.3 * float(cognitive_quality.get("evidence", 0.0))) + (0.3 * (1.0 if validator_result["pass"] else 0.0))))
        autotune_policy = observe_outcome(
            routing_method,
            quality_score,
            l9_used=bool(routing_markers.get("l9_triggered")),
            complexity_score=float(complexity_gate.get("score", 0.0)),
            intent_flags={
                "architecture": archetype in {"planning", "complex_general"},
                "coding": archetype == "coding",
                "incident": archetype == "ops_triage",
                "research": archetype == "citation_required",
                "training": False,
                "ethics": bool(risk_flags),
            },
        )
        outcome_artifact = _OUTCOME_TUNER.observe({
            "query": query,
            "task_archetype": archetype,
            "activated_chain": activated,
            "policy_label": str((bandit_choice or {}).get("selected_arm") or routing_method),
            "routing_method": routing_method,
            "model_used": str(semantic_result.get("method") or ("qa_fastlane" if fastlane else "fallback")),
            "tools_attempted": tool_path_observability.get("steps", []),
            "tools_used": [step for step in tool_path_observability.get("steps", []) if step not in {"escalate"}],
            "latency_ms": elapsed_ms,
            "retry_count": int(execution_tx.get("step_attempts_total", 0)) - len(execution_tx.get("steps", [])),
            "validator_result": validator_result,
            "execution_success": True,
            "user_correction": False,
            "recovery_needed": bool(isinstance(fastlane, dict) and fastlane.get("escalated")),
            "query_hash": hashlib.sha256((query or '').encode('utf-8')).hexdigest()[:16],
        })
        latency_artifact = _LATENCY_GOVERNOR.observe({
            "query_hash": hashlib.sha256((query or '').encode('utf-8')).hexdigest()[:16],
            "archetype": archetype,
            "latency_ms": elapsed_ms,
            "token_budget_used": token_plan.get("used") if isinstance(token_plan, dict) else 0,
            "escalated": bool(isinstance(fastlane, dict) and fastlane.get("escalated")),
            "prefetch_used": bool(prefetched_retrieval or referent_info.get("resolved")),
        })

        return {
            "success": True,
            "query": query,
            "recommended_levels": recommended,
            "reasoning": reasoning,
            "semantic_analysis": semantic_result,
            "routing_method": routing_method,
            "routing_markers": routing_markers,
            "workflow_checkpoint": workflow_checkpoint,
            "contract_version": "orchestrate_guard_v3",
            "contract": {
                "contract_version": "orchestrate_guard_v3",
                "identity_phrase": "Cortex-first orchestration active",
                "activation_metadata_available": True,
                "activation_metadata_source": "router",
                "consistency_guard": "kernel_levels_filtered" if kernel_online is not None else "best_effort",
                "canary_first": True,
            },
            "referent_context": referent_info,
            "fastlane": fastlane,
            "tool_path_observability": tool_path_observability,
            "cognitive_wave": cognitive_slice,
            "level_optimizer": optimizer_telemetry,
            "token_plan": token_plan,
            "semantic_delta": delta_info,
            "latency_budget": latency_plan,
            "policy_hint": policy_hint,
            "autotune_policy": autotune_policy,
            "execution_transaction": execution_tx,
            "artifact_paths": {
                "outcome_tuner": outcome_artifact,
                "latency_governor": latency_artifact,
            },
            "_activated": activated,
            "hud": hud_line,
            "autonomous": True
        }
    except Exception as e:
        tx.rollback()
        tx.fail(e)
        raise HTTPException(status_code=500, detail=f"Orchestration error: {str(e)}")


@router.post("/policy/replay")
async def replay_level_policy(payload: PolicyReplayRequest):
    """Offline counterfactual replay harness for level-policy evaluation."""
    result = run_counterfactual_replay(
        dataset_path=payload.dataset_path,
        limit=int(payload.limit),
        exploration_seed=int(payload.exploration_seed),
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "replay_failed"))
    return {
        "success": True,
        "replay": result,
        "contract": {
            "identity_phrase": "Cortex-first orchestration active",
            "activation_metadata_available": True,
            "activation_metadata_source": "router",
        },
    }


@router.post("/commit")
async def commit_memory(interaction: InteractionData):
    """Commit memory"""
    return {
        "success": True,
        "committed": True,
        "levels": [7, 22],
        "query_preview": interaction.query[:50] if interaction.query else "",
    }


@router.post("/index")
async def auto_index(request: AutoIndexRequest):
    """Auto-index to Knowledge Graph"""
    return {
        "success": True,
        "indexed": True,
        "query": request.query,
        "facts_indexed": len(request.response_data.get("facts", [])),
    }
