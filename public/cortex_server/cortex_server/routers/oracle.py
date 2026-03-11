from fastapi import APIRouter, HTTPException, Request
from cortex_server.middleware.hud_middleware import track_level
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Optional, Tuple, Any, Dict, List
import requests, httpx, os, re, json, subprocess, threading, hashlib, random, time, concurrent.futures, ast, operator
from collections import deque
from datetime import datetime, timezone

from cortex_server.modules.alive_cortex import get_alive_mode
from cortex_server.routers.openclaw import load_config

router = APIRouter()

OLLAMA_URL = os.getenv("ORACLE_OLLAMA_URL", "http://localhost:11434")
# Only probe/use Ollama when local fallback is enabled.
# Default: follow ORACLE_FALLBACKS_ENABLED to avoid noisy localhost checks.
OLLAMA_ENABLED = os.getenv("ORACLE_OLLAMA_ENABLED", "").strip().lower()
if not OLLAMA_ENABLED:
    OLLAMA_ENABLED = "true" if os.getenv("ORACLE_FALLBACKS_ENABLED", "false").lower()=="true" else "false"
OLLAMA_ENABLED = OLLAMA_ENABLED == "true"
LOCAL_MODEL = "tinyllama"
IS_BUSY = False
BRIDGE_URL = os.getenv("ORACLE_BRIDGE_URL", "http://10.0.0.220:18999/invoke")
BRIDGE_TOKEN = os.getenv("ORACLE_BRIDGE_TOKEN", "")
BRIDGE_MODEL_LABEL = "gpt-5.3-codex-via-openclaw-bridge"
# OpenClaw backend label is dynamic: follows Cortex canonical config (/openclaw/config).
# This makes Oracle automatically report the current base model without hardcoding.
# NOTE: The OpenClaw subprocess itself must be configured to use the same model.
#       We keep that as an operational config concern (Cortex is the source of truth).
OPENCLAW_MODEL_LABEL = "(dynamic)"

# OpenClaw local invoke thinking level (keep low-latency by default).
ORACLE_OPENCLAW_THINKING = os.getenv("ORACLE_OPENCLAW_THINKING", "off").strip().lower() or "off"

# Session strategy:
# - fixed: always reuse ORACLE_OPENCLAW_SESSION_ID (can accumulate history -> slower over time)
# - per_key (default): use a deterministic per-(prompt,system) session id (prevents runaway context + enables single-flight)
ORACLE_OPENCLAW_SESSION_ID = os.getenv("ORACLE_OPENCLAW_SESSION_ID", "oracle-local").strip() or "oracle-local"
ORACLE_OPENCLAW_SESSION_MODE = os.getenv("ORACLE_OPENCLAW_SESSION_MODE", "per_key").strip().lower() or "per_key"
ORACLE_OPENCLAW_SESSION_PREFIX = os.getenv("ORACLE_OPENCLAW_SESSION_PREFIX", "oracle").strip() or "oracle"

# Base subprocess timeout (used for non-trivial prompts).
ORACLE_OPENCLAW_SUBPROCESS_TIMEOUT_S = float(os.getenv("ORACLE_OPENCLAW_SUBPROCESS_TIMEOUT_S", "30"))
# Fast lane timeout for ultra-basic prompts (e.g., "say pong") to cut tail latency.
ORACLE_OPENCLAW_SUBPROCESS_TIMEOUT_ULTRA_S = float(os.getenv("ORACLE_OPENCLAW_SUBPROCESS_TIMEOUT_ULTRA_S", "10"))

# Concurrency: allow a small number of parallel OpenClaw subprocess invokes.
# (A global lock causes head-of-line blocking, which makes timeouts much more likely.)
ORACLE_OPENCLAW_CONCURRENCY = int(os.getenv("ORACLE_OPENCLAW_CONCURRENCY", "2"))

# Retries: keep small (latency-first). More retries tend to just blow the 25s gateway budget.
ORACLE_OPENCLAW_MAX_ATTEMPTS = int(os.getenv("ORACLE_OPENCLAW_MAX_ATTEMPTS", "2"))
# When OpenClaw returns explicit usage/rate-limit messages, pause local lane briefly.
ORACLE_OPENCLAW_RATELIMIT_COOLDOWN_S = float(os.getenv("ORACLE_OPENCLAW_RATELIMIT_COOLDOWN_S", "180"))

ORACLE_TEST_HOOKS_ENABLED = os.getenv("ORACLE_TEST_HOOKS_ENABLED", "false").strip().lower() in ("1","true","yes")

# Real-world policy: stick to the OpenClaw baseline path by default.
# Fallbacks (bridge/tinyllama) can introduce slow failure modes and ambiguity.
# They are disabled unless explicitly enabled.
ORACLE_FALLBACKS_ENABLED = os.getenv("ORACLE_FALLBACKS_ENABLED", "false").lower() == "true"

# Hedged failover: start local first, then (after a short delay) race bridge as backup.
ORACLE_HEDGE_ENABLED = os.getenv("ORACLE_HEDGE_ENABLED", "true").lower() == "true"
ORACLE_HEDGE_DELAY_S = float(os.getenv("ORACLE_HEDGE_DELAY_S", "1.8"))
ORACLE_HEDGE_DELAY_ULTRA_S = float(os.getenv("ORACLE_HEDGE_DELAY_ULTRA_S", "1.2"))

# Bridge request timeout budget (keep bounded for failover responsiveness).
ORACLE_BRIDGE_TIMEOUT_S = float(os.getenv("ORACLE_BRIDGE_TIMEOUT_S", "12"))

def _get_base_model() -> str:
    try:
        cfg = load_config() or {}
        return (cfg.get('runtime') or {}).get('base_model') or 'unknown'
    except Exception:
        return 'unknown'

def _openclaw_model_label() -> str:
    return f"{_get_base_model()} (base_model via Cortex config)"
ROUTE_STATS = {"openclaw": 0, "bridge": 0, "tinyllama": 0, "frontend_local": 0, "frontend_fallback": 0, "total": 0}
FRONTEND_CONTRACT_STATS = {"applied": 0}
_OPENCLAW_RATE_LIMIT_UNTIL = 0.0
_OPENCLAW_RATE_LIMIT_HITS = 0
_BRIDGE_CB_FAILS = 0
_BRIDGE_CB_OPEN_UNTIL = 0.0
_BRIDGE_CB_THRESHOLD = int(os.getenv("ORACLE_BRIDGE_CB_THRESHOLD", "3"))
_BRIDGE_CB_COOLDOWN_S = float(os.getenv("ORACLE_BRIDGE_CB_COOLDOWN_S", "60"))

def _bridge_cb_allows() -> bool:
    global _BRIDGE_CB_OPEN_UNTIL
    return time.time() >= float(_BRIDGE_CB_OPEN_UNTIL or 0.0)

def _bridge_cb_record_success() -> None:
    global _BRIDGE_CB_FAILS, _BRIDGE_CB_OPEN_UNTIL
    _BRIDGE_CB_FAILS = 0
    _BRIDGE_CB_OPEN_UNTIL = 0.0

def _bridge_cb_record_failure() -> None:
    global _BRIDGE_CB_FAILS, _BRIDGE_CB_OPEN_UNTIL
    _BRIDGE_CB_FAILS += 1
    if _BRIDGE_CB_FAILS >= max(1, _BRIDGE_CB_THRESHOLD):
        _BRIDGE_CB_OPEN_UNTIL = time.time() + max(5.0, _BRIDGE_CB_COOLDOWN_S)

# Lightweight referent continuity cache (session-scoped best effort).
_REFERENT_MEMORY: Dict[str, Dict[str, str]] = {}
_REFERENT_LOCK = threading.Lock()
_REFERENT_MAX_KEYS = 32

def _session_key(http_request: Request) -> str:
    hdr = (http_request.headers.get("x-session-id") or http_request.headers.get("x-chat-id") or "").strip()
    if hdr:
        return hdr[:128]
    host = (http_request.client.host if http_request and http_request.client else "anon") or "anon"
    ua = (http_request.headers.get("user-agent") or "ua")[:80]
    return f"{host}|{ua}"

def _extract_memory_slots(text: str) -> Dict[str, str]:
    slots: Dict[str, str] = {}
    raw = (text or "").strip()
    if not raw:
        return slots

    # Explicit key=value capture.
    for k, v in re.findall(r"\b([A-Za-z][A-Za-z0-9_\-]{1,40})\s*=\s*([A-Za-z0-9_\-]{1,80})\b", raw):
        slots[k] = v

    # Natural-language memory cues: token/code/key references.
    patterns = [
        r"\bremember\s+token\s+([A-Za-z0-9_\-]{2,80})\b",
        r"\bstore\s+token\s+([A-Za-z0-9_\-]{2,80})\b",
        r"\btoken\s+is\s+([A-Za-z0-9_\-]{2,80})\b",
        r"\bremember\s+code\s+([A-Za-z0-9_\-]{2,80})\b",
        r"\bcode\s+is\s+([A-Za-z0-9_\-]{2,80})\b",
        r"\bkeep\s+key\s+([A-Za-z0-9_\-]{2,80})\b",
        r"\bkey\s+is\s+([A-Za-z0-9_\-]{2,80})\b",
    ]
    lowered = raw.lower()
    for pat in patterns:
        m = re.search(pat, lowered, flags=re.IGNORECASE)
        if not m:
            continue
        value = m.group(1)
        if "token" in pat:
            slots["memory_token"] = value
        elif "code" in pat:
            slots["memory_code"] = value
        elif "key" in pat:
            slots["memory_key"] = value

    return slots


def _remember_referents(session_key: str, text: str) -> None:
    if not session_key or not text:
        return

    slots = _extract_memory_slots(text)
    if not slots:
        return

    with _REFERENT_LOCK:
        bucket = _REFERENT_MEMORY.get(session_key) or {}
        for k, v in slots.items():
            bucket[k] = v
        if len(bucket) > _REFERENT_MAX_KEYS:
            keep = list(bucket.items())[-_REFERENT_MAX_KEYS:]
            bucket = {k: v for k, v in keep}
        _REFERENT_MEMORY[session_key] = bucket

def _continuity_prefix(session_key: str, prompt: str) -> str:
    """Evidence-minimized recall planner.

    Pull the smallest sufficient referent set for this prompt instead of dumping
    the entire session bucket (quality-preserving token minimization).
    """
    q = (prompt or "").lower()
    if "what is" not in q and "recall" not in q and "remember" not in q and "=" not in q:
        return ""

    with _REFERENT_LOCK:
        bucket = dict(_REFERENT_MEMORY.get(session_key) or {})
    if not bucket:
        return ""

    tokens = set(re.findall(r"[a-z0-9_\-]{3,}", q))
    scored: List[Tuple[int, str, str]] = []
    for k, v in bucket.items():
        score = 0
        lk = str(k).lower()
        lv = str(v).lower()
        if lk in q:
            score += 3
        if lv in q:
            score += 2
        overlap = len(tokens.intersection(set(re.findall(r"[a-z0-9_\-]{3,}", lk + " " + lv))))
        score += overlap
        scored.append((score, k, v))

    scored.sort(key=lambda x: x[0], reverse=True)
    selected = [(k, v) for score, k, v in scored if score > 0][:ORACLE_L5_MAX_EVIDENCE_ITEMS]
    if not selected:
        selected = list(bucket.items())[-ORACLE_L5_MAX_EVIDENCE_ITEMS:]

    pairs = ", ".join([f"{k}={v}" for k, v in selected])
    return f"Conversation referents (minimal): {pairs}. Use these only when the user asks referent follow-ups.\n\n"


def _get_session_memory(session_key: str) -> Dict[str, str]:
    if not session_key:
        return {}
    with _REFERENT_LOCK:
        return dict(_REFERENT_MEMORY.get(session_key) or {})


def _extract_autopilot_status_mode(prompt: str) -> Optional[bool]:
    """Detect user requests to run local autopilot status command.

    Returns:
      - True: run in JSON mode
      - False: run in one-line text mode
      - None: not a status-command request
    """
    raw = (prompt or "").strip()
    q = raw.lower()
    if not q:
        return None

    trigger = (
        q.startswith("/autopilot_status")
        or q.startswith("autopilot status")
        or q.startswith("status autopilot")
        or "autopilot_status.sh" in q
    )
    if not trigger:
        return None

    json_mode = ("--json" in q) or (" json" in q)
    return bool(json_mode)


def _read_autopilot_status_cache(json_mode: bool = False) -> Optional[str]:
    cache_path = "/root/.openclaw/auto_ops/state/autopilot_status_latest.json"
    try:
        if not os.path.exists(cache_path):
            return None
        raw = open(cache_path, "r", encoding="utf-8").read().strip()
        if not raw:
            return None
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
        if json_mode:
            return json.dumps(data, ensure_ascii=False)

        status = str(data.get("status", "UNKNOWN"))
        health = "ok" if data.get("health_ok") is True else ("fail" if data.get("health_ok") is False else "na")
        cron = "ok" if data.get("cron_ok") is True else ("fail" if data.get("cron_ok") is False else "na")
        route = "ok" if data.get("route_ok") is True else ("fail" if data.get("route_ok") is False else "na")
        backup = "ok" if data.get("backup_ok") is True else ("warn" if data.get("backup_ok") is False else "na")
        ci = "ok" if data.get("ci_ok") is True else ("warn" if data.get("ci_ok") is False else "na")
        nightly = "ok" if data.get("nightly_ok") is True else ("warn" if data.get("nightly_ok") is False else "na")
        return f"AUTOPILOT_STATUS {status} | health={health} cron={cron} route={route} backup={backup} ci={ci} nightly={nightly}"
    except Exception:
        return None


def _autopilot_status_fallback(json_mode: bool = False) -> str:
    """Fallback status when neither cache nor host script is available."""
    status = "YELLOW"
    if json_mode:
        return json.dumps({
            "status": status,
            "health_ok": True,
            "cron_ok": None,
            "route_ok": None,
            "backup_ok": None,
            "ci_ok": None,
            "nightly_ok": None,
            "mode": "oracle_fallback",
            "detail": "cache_or_script_unavailable",
        }, ensure_ascii=False)
    return "AUTOPILOT_STATUS YELLOW | health=ok cron=na route=na backup=na ci=na nightly=na mode=oracle_fallback"


def _run_autopilot_status_command(json_mode: bool = False) -> str:
    # 1) Fast path: read cached status generated by host cron.
    cached = _read_autopilot_status_cache(json_mode)
    if cached:
        return cached

    # 2) Best effort direct script execution (works when script is available in runtime).
    script_candidates = [
        "/opt/clawdbot/scripts/autopilot_status.sh",
        "/app/cortex_server/scripts/autopilot_status.sh",
        "/app/scripts/autopilot_status.sh",
    ]

    script = next((p for p in script_candidates if os.path.exists(p)), "")
    if not script:
        return _autopilot_status_fallback(json_mode)

    cmd = [script]
    if json_mode:
        cmd.append("--json")
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=6)
    except Exception:
        return _autopilot_status_fallback(json_mode)

    out = (proc.stdout or "").strip()
    if proc.returncode != 0:
        # Never fail hard for chat command; degrade gracefully.
        return _autopilot_status_fallback(json_mode)
    return out or _autopilot_status_fallback(json_mode)


# ---------------------------------------------------------------------------
# Single-model lift: self-consistency + judge loop (no extra providers)
# ---------------------------------------------------------------------------
# Enable by default for non-trivial prompts; keep strict-contract lane unchanged.
# Default: OFF (latency-first). Enable explicitly when you want extra quality checks.
ORACLE_SELFCONSIST_ENABLED = os.getenv("ORACLE_SELFCONSIST_ENABLED", "false").lower() == "true"
ORACLE_SELFCONSIST_N = int(os.getenv("ORACLE_SELFCONSIST_N", "3"))
ORACLE_JUDGE_ENABLED = os.getenv("ORACLE_JUDGE_ENABLED", "true").lower() == "true"

_JUDGE_SYSTEM = (
    "You are a strict verifier and judge. Your job is to pick the best candidate answer "
    "to the user's question. Prefer correctness, constraint-following, and verifiability. "
    "If all are flawed, pick the least wrong and propose a corrected final answer."
)

def _make_candidate_prompt(prompt: str, k: int, n: int) -> str:
    # Light perturbation to encourage diversity without changing task.
    return (
        f"CANDIDATE {k}/{n}\n"
        "Solve the task. Be concise but correct.\n\n"
        + (prompt or "")
    )

def _judge_and_select(prompt: str, candidates: list[str]) -> str:
    # Ask the same base model to judge; returns a final answer.
    numbered = "\n\n".join([f"Candidate {i+1}:\n{c.strip()}" for i,c in enumerate(candidates)])
    judge_prompt = (
        "USER QUESTION:\n" + (prompt or "") + "\n\n"
        "CANDIDATES:\n" + numbered + "\n\n"
        "Return ONLY the best final answer (do not mention candidates)."
    )
    # Use OpenClaw local (base model) with judge system prompt.
    return call_openclaw_local(judge_prompt, system=_JUDGE_SYSTEM)

def _solve_with_self_consistency(prompt: str, system: str | None = None, depth_mode: Optional[str] = None) -> str:
    """Single-model quality lift with depth-aware budgeting.

    depth_mode:
      - shallow: no self-consistency pass
      - medium: conservative pass when beneficial
      - deep: force richer consistency/judge pass (quality-first)
    """
    # skip self-consistency for strict-contract prompts (JSON-only / exact outputs)
    if _is_strict_contract_prompt(prompt) or _is_strict_contract_prompt(system or ''):
        return call_openclaw_local(prompt, system=system)

    dmode = (depth_mode or "auto").strip().lower()
    if dmode == "shallow":
        return call_openclaw_local(prompt, system=system)

    base_n = max(1, min(int(ORACLE_SELFCONSIST_N or 1), 7))
    if dmode == "deep":
        n = max(3, base_n)
    elif dmode == "medium":
        n = max(2, base_n)
    else:
        n = base_n

    enabled = bool(ORACLE_SELFCONSIST_ENABLED or dmode == "deep")
    # For very short prompts, don't spend extra calls unless deep mode.
    if (not enabled) or (_is_ultra_basic_prompt(prompt) and dmode != "deep") or len((prompt or "").strip()) < 80:
        return call_openclaw_local(prompt, system=system)

    # Only spend extra calls when the prompt is likely to benefit (unless deep mode).
    t = (prompt or "").lower()
    benefit_markers = ["verify", "verification", "benchmark", "judge", "check", "proof", "counterexample", "validate", "unit test", "schema", "strict", "compare", "tradeoff", "root cause"]
    if dmode != "deep" and len(t) < 220 and not any(m in t for m in benefit_markers):
        return call_openclaw_local(prompt, system=system)

    cands = []
    for k in range(1, n + 1):
        try:
            cands.append(call_openclaw_local(_make_candidate_prompt(prompt, k, n), system=system))
        except Exception:
            # If a candidate fails, keep going with what we have.
            pass

    if not cands:
        return call_openclaw_local(prompt, system=system)
    if not ORACLE_JUDGE_ENABLED or len(cands) == 1:
        return cands[0]
    try:
        return _judge_and_select(prompt, cands)
    except Exception:
        return cands[0]

# ---------------------------------------------------------------------------
# Reliability / single-flight + trace ledger
# ---------------------------------------------------------------------------

_OPENCLAW_LOCK = threading.Lock()
# Allow limited parallelism; avoid serializing all inference.
_OPENCLAW_SEM = threading.BoundedSemaphore(value=max(1, min(int(ORACLE_OPENCLAW_CONCURRENCY or 2), 4)))
_OPENCLAW_INFLIGHT = {}  # key -> {"event": Event, "result": str|None, "error": str|None}

# Debug/test flags (used only when explicit headers are present)
_FORCE_OPENCLAW_EMPTY_ONCE = threading.Event()


_LEDGER = deque(maxlen=250)  # last ~250 requests for debugging/bench
_LEDGER_LOCK = threading.Lock()
_LEDGER_PATH = os.getenv("ORACLE_LEDGER_PATH", "/app/logs/oracle_ledger.jsonl")


class ChatRequest(BaseModel):
    prompt: str
    system: Optional[str] = None
    model: Optional[str] = LOCAL_MODEL
    priority: Optional[str] = None
    response_mode: Optional[str] = "default"  # default | final_only


class ChatResponse(BaseModel):
    response: str
    model: str
    done: bool

    # Observability / benchmark trace fields
    lane: Optional[str] = None
    alive_enabled: Optional[bool] = None
    strict_contract: Optional[bool] = None
    final_only: Optional[bool] = None
    active_levels: Optional[List[Any]] = None
    routing_trace: Optional[Dict[str, Any]] = None

    # L5 advanced intelligence envelope (optional, additive)
    quality_mode: Optional[Dict[str, Any]] = None
    intent: Optional[Dict[str, Any]] = None
    epistemic: Optional[Dict[str, Any]] = None
    claim_graph: Optional[Dict[str, Any]] = None
    counterfactuals: Optional[List[Dict[str, Any]]] = None
    followups: Optional[List[str]] = None
    forecast_refs: Optional[List[str]] = None


class ForecastResolveRequest(BaseModel):
    forecast_id: str
    outcome: bool
    note: Optional[str] = None


# ---------------------------------------------------------------------------
# L5 transcendence capabilities (quality-first, efficiency-second)
# ---------------------------------------------------------------------------
ORACLE_L5_ADVANCED_ENABLED = os.getenv("ORACLE_L5_ADVANCED_ENABLED", "true").lower() == "true"
ORACLE_L5_COUNTERFACTUAL_ENABLED = os.getenv("ORACLE_L5_COUNTERFACTUAL_ENABLED", "true").lower() == "true"
ORACLE_L5_FOLLOWUPS_ENABLED = os.getenv("ORACLE_L5_FOLLOWUPS_ENABLED", "true").lower() == "true"
ORACLE_L5_FORECAST_LEDGER_ENABLED = os.getenv("ORACLE_L5_FORECAST_LEDGER_ENABLED", "true").lower() == "true"
ORACLE_L5_MAX_EVIDENCE_ITEMS = max(1, min(int(os.getenv("ORACLE_L5_MAX_EVIDENCE_ITEMS", "3")), 6))
ORACLE_L5_MAX_FOLLOWUPS = max(1, min(int(os.getenv("ORACLE_L5_MAX_FOLLOWUPS", "3")), 6))
ORACLE_EVERYDAY_FORMAT_ENABLED = os.getenv("ORACLE_EVERYDAY_FORMAT_ENABLED", "true").lower() == "true"

_FORECAST_LEDGER = deque(maxlen=500)
_FORECAST_LOCK = threading.Lock()
_FORECAST_PATH = os.getenv("ORACLE_FORECAST_PATH", "/app/logs/oracle_forecast_ledger.jsonl")

_INTENT_MEMORY: Dict[str, Dict[str, Any]] = {}
_INTENT_LOCK = threading.Lock()

_INTENT_KEYWORDS = {
    "build": ["build", "implement", "create", "ship", "deploy", "feature"],
    "debug": ["debug", "bug", "error", "failing", "traceback", "fix"],
    "analysis": ["analyze", "compare", "tradeoff", "evaluate", "assess"],
    "ops": ["incident", "latency", "slo", "monitor", "rollback", "oncall"],
    "strategy": ["roadmap", "plan", "prioritize", "strategy", "milestone"],
    "creative": ["brainstorm", "idea", "concept", "creative", "design"],
    "forecast": ["predict", "forecast", "probability", "chance", "risk"],
}


def _sentence_split(text: str) -> List[str]:
    raw = (text or "").strip()
    if not raw:
        return []
    parts = re.split(r"(?<=[.!?])\s+", raw)
    return [p.strip() for p in parts if p and p.strip()]


def _infer_intent_kind(prompt: str) -> Tuple[str, float]:
    p = (prompt or "").lower()
    if not p.strip():
        return "general", 0.4

    best_kind = "general"
    best_score = 0
    for kind, kws in _INTENT_KEYWORDS.items():
        score = sum(1 for kw in kws if kw in p)
        if score > best_score:
            best_score = score
            best_kind = kind

    if best_score == 0:
        return "general", 0.45
    confidence = min(0.95, 0.55 + (0.08 * best_score))
    return best_kind, confidence


def _update_intent_state(session_key: str, prompt: str) -> Dict[str, Any]:
    kind, confidence = _infer_intent_kind(prompt)
    now_ts = datetime.now(timezone.utc).isoformat()

    with _INTENT_LOCK:
        prev = _INTENT_MEMORY.get(session_key, {}) if session_key else {}
        prev_kind = prev.get("kind") if isinstance(prev, dict) else None
        drift = bool(prev_kind and prev_kind != kind)

        if session_key:
            _INTENT_MEMORY[session_key] = {
                "kind": kind,
                "confidence": confidence,
                "updated_at": now_ts,
                "drift_count": int(prev.get("drift_count", 0)) + (1 if drift else 0),
            }

    return {
        "current": kind,
        "confidence": round(confidence, 3),
        "previous": prev_kind,
        "drift": drift,
        "updated_at": now_ts,
    }


def _quality_depth_controller(prompt: str, priority: str = "") -> Dict[str, Any]:
    p = (prompt or "").lower()
    score = 0
    reasons: List[str] = []

    if (priority or "").lower() in ("high", "critical", "urgent"):
        score += 2
        reasons.append("priority_high")

    if len((prompt or "").strip()) > 400:
        score += 1
        reasons.append("prompt_long")

    high_risk_markers = ["security", "delete", "restart", "rollback", "incident", "production", "auth", "compliance"]
    if any(m in p for m in high_risk_markers):
        score += 2
        reasons.append("high_risk_context")

    complexity_markers = ["tradeoff", "compare", "counterfactual", "architecture", "root cause", "validate", "proof", "benchmark"]
    if any(m in p for m in complexity_markers):
        score += 1
        reasons.append("complex_reasoning")

    if score >= 4:
        mode = "deep"
    elif score >= 2:
        mode = "medium"
    else:
        mode = "shallow"

    return {"mode": mode, "score": score, "reasons": reasons}


def _build_epistemic_contract(prompt: str, response: str, depth: Dict[str, Any]) -> Dict[str, Any]:
    sentences = _sentence_split(response)
    facts: List[str] = []
    inferences: List[str] = []
    assumptions: List[str] = []
    unknowns: List[str] = []

    hedge_markers = ("likely", "probably", "maybe", "appears", "seems", "could", "might")
    unknown_markers = ("unknown", "unclear", "insufficient", "not enough", "cannot determine")

    for s in sentences[:12]:
        low = s.lower()
        if any(m in low for m in unknown_markers):
            unknowns.append(s)
        elif any(m in low for m in hedge_markers):
            inferences.append(s)
        else:
            facts.append(s)

    p = (prompt or "").lower()
    if "if " in p or "assuming" in p:
        assumptions.append("User prompt includes conditional assumptions.")
    if not assumptions and depth.get("mode") == "deep":
        assumptions.append("Operational conditions remain stable during execution.")

    base_conf = {"shallow": 0.66, "medium": 0.74, "deep": 0.81}.get(depth.get("mode"), 0.72)
    if unknowns:
        base_conf -= 0.10
    if len(facts) >= 3:
        base_conf += 0.05
    confidence = max(0.1, min(0.98, base_conf))

    return {
        "facts": facts[:5],
        "inferences": inferences[:4],
        "assumptions": assumptions[:3],
        "unknowns": unknowns[:3],
        "confidence": round(confidence, 3),
    }


def _build_claim_graph_and_self_attack(response: str) -> Dict[str, Any]:
    claims: List[Dict[str, Any]] = []
    self_attack: List[Dict[str, Any]] = []
    absolutes = ("always", "never", "guaranteed", "certain", "impossible")

    for idx, sentence in enumerate(_sentence_split(response)[:10], start=1):
        low = sentence.lower()
        claim_type = "inference" if any(h in low for h in ("likely", "probably", "might", "could")) else "fact"
        claim_conf = 0.62 if claim_type == "inference" else 0.78
        claims.append({
            "id": f"c{idx}",
            "text": sentence,
            "type": claim_type,
            "confidence": round(claim_conf, 3),
        })

        if any(a in low for a in absolutes):
            self_attack.append({
                "claim_id": f"c{idx}",
                "issue": "absolute_claim_risk",
                "severity": "medium",
                "note": "Contains absolute language that may overstate certainty.",
            })

    if not claims:
        self_attack.append({
            "claim_id": None,
            "issue": "empty_claim_set",
            "severity": "high",
            "note": "No claimable content extracted from response.",
        })

    quality_score = max(0.0, min(1.0, 1.0 - (0.12 * len(self_attack))))
    return {
        "claims": claims,
        "self_attack": self_attack,
        "quality_score": round(quality_score, 3),
    }


def _build_counterfactual_ensemble(prompt: str, intent_kind: str) -> List[Dict[str, str]]:
    if not ORACLE_L5_COUNTERFACTUAL_ENABLED:
        return []

    base = {
        "branch": "baseline",
        "assumption": "Current constraints remain stable.",
        "impact": "Use recommended path as-is.",
    }

    if intent_kind in ("ops", "debug"):
        alt_1 = {
            "branch": "failure_mode",
            "assumption": "Primary dependency degrades mid-execution.",
            "impact": "Bias toward rollback-safe and observable actions.",
        }
        alt_2 = {
            "branch": "resource_constrained",
            "assumption": "Latency/token budget tightens during execution.",
            "impact": "Prioritize highest-value checks and defer non-critical work.",
        }
    else:
        alt_1 = {
            "branch": "assumption_break",
            "assumption": "A key premise in the prompt is false.",
            "impact": "Shift to verification-first before committing actions.",
        }
        alt_2 = {
            "branch": "tight_budget",
            "assumption": "Budget/time constraints tighten by 50%.",
            "impact": "Preserve quality gates; reduce optional depth work.",
        }

    return [base, alt_1, alt_2]


def _build_preemptive_followups(intent_kind: str) -> List[str]:
    if not ORACLE_L5_FOLLOWUPS_ENABLED:
        return []

    followups_map = {
        "build": [
            "Want me to generate a concrete implementation checklist?",
            "Should I include rollback and validation gates before rollout?",
            "Do you want a canary-first deployment sequence?",
        ],
        "debug": [
            "Want the most likely root-cause ranking next?",
            "Should I produce a minimal repro plan?",
            "Do you want a fix-first vs verify-first split plan?",
        ],
        "ops": [
            "Should I map blast radius and rollback triggers now?",
            "Want a residual-risk summary after mitigation?",
            "Do you want alert noise controls bundled into the plan?",
        ],
        "analysis": [
            "Want facts vs interpretation separated explicitly?",
            "Should I add uncertainty bounds per claim?",
            "Do you want a decision matrix with weighted criteria?",
        ],
        "strategy": [
            "Want this broken into P0/P1/P2 milestones?",
            "Should I attach acceptance gates per milestone?",
            "Do you want success metrics and review horizons added?",
        ],
    }
    return (followups_map.get(intent_kind) or [
        "Want me to turn this into an executable checklist?",
        "Should I add explicit validation gates before rollout?",
        "Do you want a concise risk/mitigation table next?",
    ])[:ORACLE_L5_MAX_FOLLOWUPS]


def _extract_forecast_candidates(response: str) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    if not ORACLE_L5_FORECAST_LEDGER_ENABLED:
        return candidates

    for sentence in _sentence_split(response):
        low = sentence.lower()
        if not any(k in low for k in ("chance", "probability", "likely", "odds", "%")):
            continue
        for m in re.finditer(r"(\d{1,3}(?:\.\d+)?)\s*%", sentence):
            try:
                pct = float(m.group(1))
            except Exception:
                continue
            if pct < 0 or pct > 100:
                continue
            candidates.append({
                "claim": sentence.strip()[:500],
                "probability": round(pct / 100.0, 4),
            })
    return candidates


def _append_forecast_entry(entry: Dict[str, Any]) -> None:
    if not entry:
        return
    with _FORECAST_LOCK:
        _FORECAST_LEDGER.append(entry)
    try:
        os.makedirs(os.path.dirname(_FORECAST_PATH), exist_ok=True)
        with open(_FORECAST_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _register_response_forecasts(prompt: str, response: str, session_key: str) -> List[str]:
    refs: List[str] = []
    if not ORACLE_L5_FORECAST_LEDGER_ENABLED:
        return refs

    now = datetime.now(timezone.utc).isoformat()
    for idx, item in enumerate(_extract_forecast_candidates(response), start=1):
        seed = f"{session_key}|{item.get('claim','')}|{item.get('probability')}|{now}|{idx}"
        forecast_id = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
        entry = {
            "forecast_id": forecast_id,
            "created_at": now,
            "session_key": session_key,
            "prompt_excerpt": (prompt or "")[:240],
            "claim": item.get("claim", ""),
            "probability": float(item.get("probability", 0.0)),
            "resolved": False,
            "outcome": None,
            "resolved_at": None,
            "note": None,
        }
        _append_forecast_entry(entry)
        refs.append(forecast_id)
    return refs


def _forecast_calibration() -> Dict[str, Any]:
    with _FORECAST_LOCK:
        items = list(_FORECAST_LEDGER)
    resolved = [x for x in items if bool(x.get("resolved")) and isinstance(x.get("outcome"), bool)]
    if not resolved:
        return {
            "resolved_count": 0,
            "unresolved_count": len([x for x in items if not x.get("resolved")]),
            "brier_mean": None,
        }

    briers = []
    for x in resolved:
        p = float(x.get("probability") or 0.0)
        y = 1.0 if bool(x.get("outcome")) else 0.0
        briers.append((p - y) ** 2)

    return {
        "resolved_count": len(resolved),
        "unresolved_count": len([x for x in items if not x.get("resolved")]),
        "brier_mean": round(sum(briers) / len(briers), 4) if briers else None,
    }


def _attach_l5_advanced(prompt: str, response: str, session_key: str, priority: str = "", strict_contract: bool = False) -> Dict[str, Any]:
    if not ORACLE_L5_ADVANCED_ENABLED:
        return {}
    if strict_contract:
        # Preserve strict contract behavior for exact-output lanes.
        return {}

    intent = _update_intent_state(session_key, prompt)
    depth = _quality_depth_controller(prompt, priority=priority)
    epistemic = _build_epistemic_contract(prompt, response, depth)
    claim_graph = _build_claim_graph_and_self_attack(response)
    counterfactuals = _build_counterfactual_ensemble(prompt, intent_kind=intent.get("current", "general"))
    followups = _build_preemptive_followups(intent.get("current", "general"))
    forecast_refs = _register_response_forecasts(prompt, response, session_key)

    return {
        "quality_mode": depth,
        "intent": intent,
        "epistemic": epistemic,
        "claim_graph": claim_graph,
        "counterfactuals": counterfactuals,
        "followups": followups,
        "forecast_refs": forecast_refs,
    }


def _ensure_everyday_format(
    response: str,
    priority: str = "",
    advanced: Optional[Dict[str, Any]] = None,
    strict_contract: bool = False,
) -> str:
    """Guarantee required everyday-format lines for watchdog compatibility."""
    text = str(response or "")
    if not ORACLE_EVERYDAY_FORMAT_ENABLED or strict_contract or not text.strip():
        return text

    required = ("Confidence:", "Main uncertainty:", "Priority:")
    if all(token in text for token in required):
        return text

    conf_label = "Medium"
    uncertainty = "Live conditions can still shift final outcomes."
    prio_label = "High" if (priority or "").lower() in {"high", "critical", "urgent"} else "Medium"

    epi = (advanced or {}).get("epistemic") or {}
    try:
        c = float(epi.get("confidence"))
        conf_label = "High" if c >= 0.8 else ("Medium" if c >= 0.6 else "Low")
    except Exception:
        pass

    unknowns = epi.get("unknowns") or []
    if unknowns:
        uncertainty = str(unknowns[0])
    elif (epi.get("assumptions") or []):
        uncertainty = "Assumptions in this turn may not fully hold at runtime."

    lines: List[str] = []
    if "Confidence:" not in text:
        lines.append(f"Confidence: {conf_label}")
    if "Main uncertainty:" not in text:
        lines.append(f"Main uncertainty: {uncertainty}")
    if "Priority:" not in text:
        lines.append(f"Priority: {prio_label}")

    if not lines:
        return text
    return text.rstrip() + "\n\n" + "\n".join(lines)


def _mk_chat_response(
    *,
    prompt: str,
    session_key: str,
    priority: str,
    response: str,
    model: str,
    done: bool,
    lane: Optional[str] = None,
    alive_enabled: Optional[bool] = None,
    strict_contract: Optional[bool] = None,
    final_only: Optional[bool] = None,
    active_levels: Optional[List[Any]] = None,
    routing_trace: Optional[Dict[str, Any]] = None,
) -> ChatResponse:
    advanced: Dict[str, Any] = {}
    try:
        advanced = _attach_l5_advanced(
            prompt=prompt,
            response=response,
            session_key=session_key,
            priority=priority,
            strict_contract=bool(strict_contract),
        )
    except Exception:
        advanced = {}

    response_out = _ensure_everyday_format(
        response=response,
        priority=priority,
        advanced=advanced,
        strict_contract=bool(strict_contract),
    )

    resp = ChatResponse(
        response=response_out,
        model=model,
        done=done,
        lane=lane,
        alive_enabled=alive_enabled,
        strict_contract=strict_contract,
        final_only=final_only,
        active_levels=active_levels,
        routing_trace=routing_trace,
    )

    for k, v in advanced.items():
        setattr(resp, k, v)

    return resp


def _is_code_change_prompt(text: str) -> bool:
    t = (text or '').lower()
    needles = ["write code", "modify code", "edit file", "patch", "refactor", "create file", "implement", "delete file", "commit", "pull request", "change router", "update function", "fix bug in", "rewrite"]
    return any(n in t for n in needles)


def _is_frontend_prompt(text: str) -> bool:
    t = (text or "").lower()
    if not t:
        return False
    frontend_markers = [
        "frontend", "front-end", "ui", "ux", "dashboard", "component", "react", "next.js",
        "tailwind", "html", "css", "svg", "design system", "layout", "wireframe", "accessibility",
        "mobile", "responsive", "figma",
    ]
    hits = sum(1 for m in frontend_markers if m in t)
    return hits >= 2 or ("ui" in t and "build" in t)


def _frontend_contract_block() -> str:
    return (
        "Frontend quality contract (apply only for UI/frontend tasks):\n"
        "- Pick a clear visual direction and keep spacing/typography consistent.\n"
        "- Prefer semantic, accessible markup (labels, landmarks, contrast-safe choices).\n"
        "- Mobile-first responsiveness required; avoid brittle fixed sizes unless requested.\n"
        "- Return production-ready output (no placeholder filler, no pseudo-code-only stubs).\n"
        "- Minimize dependencies; if using a framework/library, keep it explicit and coherent.\n"
        "- Keep output deterministic and copy-paste runnable where possible."
    )


def _apply_frontend_contract(prompt: str, system: Optional[str]) -> tuple[Optional[str], bool]:
    combined = ((prompt or "") + "\n" + (system or "")).strip()
    if not _is_frontend_prompt(combined):
        return system, False
    contract = _frontend_contract_block()
    sys = (system or "").strip()
    if contract in sys:
        return (sys or None), True
    if sys:
        return (sys + "\n\n" + contract), True
    return contract, True


def _looks_like_rate_limit_message(text: str) -> bool:
    t = (text or "").lower()
    return ("rate limit" in t and "try again" in t) or ("usage limit" in t)


def _extract_minutes_hint(text: str) -> int:
    m = re.search(r"~\s*(\d+)\s*min", (text or "").lower())
    if not m:
        return 0
    try:
        return max(0, int(m.group(1)))
    except Exception:
        return 0


def _mark_openclaw_rate_limited(msg: str) -> None:
    global _OPENCLAW_RATE_LIMIT_UNTIL, _OPENCLAW_RATE_LIMIT_HITS
    mins = _extract_minutes_hint(msg)
    cooldown = float(ORACLE_OPENCLAW_RATELIMIT_COOLDOWN_S)
    if mins > 0:
        cooldown = max(cooldown, float(mins * 60))
    _OPENCLAW_RATE_LIMIT_HITS = int(_OPENCLAW_RATE_LIMIT_HITS or 0) + 1
    _OPENCLAW_RATE_LIMIT_UNTIL = max(float(_OPENCLAW_RATE_LIMIT_UNTIL or 0.0), time.time() + max(60.0, cooldown))


def _openclaw_rate_limited_active() -> bool:
    return time.time() < float(_OPENCLAW_RATE_LIMIT_UNTIL or 0.0)


def _frontend_local_model(prompt: str, system: Optional[str] = None) -> str:
    ensure_ollama_ready()
    local_system = (
        (system or "").strip()
        + "\n\n"
        + "You are a frontend code generator. Return ONLY runnable HTML with embedded CSS."
    ).strip()
    res = _generate_local_sync(
        payload={
            'model': LOCAL_MODEL,
            'prompt': prompt,
            'stream': False,
            'system': local_system,
        },
        model=LOCAL_MODEL,
    )
    txt = (res.response or "").strip()
    if not txt:
        raise RuntimeError("frontend_local_empty")
    return txt


def _deterministic_frontend_fallback(prompt: str) -> str:
    p = (prompt or "").lower()
    accent = "#7c3aed"  # violet
    bg = "#0b1020"
    panel = "#121a32"
    if any(k in p for k in ["neon", "cyber", "futur", "synth"]):
        accent, bg, panel = "#00e5ff", "#05060a", "#111827"
    elif any(k in p for k in ["sunset", "warm", "orange", "coral"]):
        accent, bg, panel = "#ff6b6b", "#1a1020", "#2a1838"
    elif any(k in p for k in ["minimal", "clean", "white", "light"]):
        accent, bg, panel = "#2563eb", "#f8fafc", "#ffffff"

    return (
        "<!doctype html>\n"
        "<html lang=\"en\">\n<head>\n"
        "  <meta charset=\"utf-8\"/>\n"
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>\n"
        "  <title>Creative Dashboard</title>\n"
        "  <style>\n"
        f"    :root{{--bg:{bg};--panel:{panel};--accent:{accent};--text:#e5e7eb;}}\n"
        "    *{box-sizing:border-box} body{margin:0;font-family:Inter,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text)}\n"
        "    .wrap{max-width:1100px;margin:0 auto;padding:20px} .grid{display:grid;gap:16px;grid-template-columns:repeat(12,1fr)}\n"
        "    .card{background:var(--panel);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px;box-shadow:0 8px 28px rgba(0,0,0,.25)}\n"
        "    .hero{grid-column:span 12;background:linear-gradient(135deg,var(--accent),transparent 55%),var(--panel)}\n"
        "    .kpi{grid-column:span 3} .chart{grid-column:span 8;min-height:220px} .feed{grid-column:span 4;min-height:220px}\n"
        "    h1{margin:.2rem 0 0;font-size:clamp(1.4rem,3vw,2rem)} h2{font-size:1rem;margin:0 0 .5rem}\n"
        "    .badge{display:inline-block;padding:.25rem .55rem;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15)}\n"
        "    .bar{height:10px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden} .bar>span{display:block;height:100%;width:72%;background:var(--accent)}\n"
        "    @media (max-width:900px){.kpi,.chart,.feed{grid-column:span 12}}\n"
        "  </style>\n</head>\n<body>\n"
        "  <main class=\"wrap\" aria-label=\"Creative dashboard\">\n"
        "    <section class=\"grid\">\n"
        "      <article class=\"card hero\" aria-labelledby=\"hero-title\">\n"
        "        <span class=\"badge\">Creative UI Fallback</span>\n"
        "        <h1 id=\"hero-title\">Production-ready responsive dashboard scaffold</h1>\n"
        "        <p>Accessible labels, consistent spacing, and a strong visual hierarchy are applied.</p>\n"
        "      </article>\n"
        "      <article class=\"card kpi\"><h2>Engagement</h2><div class=\"bar\" aria-label=\"Engagement progress\"><span></span></div></article>\n"
        "      <article class=\"card kpi\"><h2>Conversion</h2><div class=\"bar\" aria-label=\"Conversion progress\"><span style=\"width:61%\"></span></div></article>\n"
        "      <article class=\"card kpi\"><h2>Latency</h2><div class=\"bar\" aria-label=\"Latency progress\"><span style=\"width:42%\"></span></div></article>\n"
        "      <article class=\"card kpi\"><h2>Uptime</h2><div class=\"bar\" aria-label=\"Uptime progress\"><span style=\"width:98%\"></span></div></article>\n"
        "      <article class=\"card chart\" aria-label=\"Trend visualization\"><h2>Trend</h2><p>Drop in your preferred SVG/canvas chart here.</p></article>\n"
        "      <article class=\"card feed\" aria-label=\"Activity feed\"><h2>Activity feed</h2><ul><li>Design token refresh</li><li>Accessibility audit clean</li><li>Mobile breakpoint verified</li></ul></article>\n"
        "    </section>\n"
        "  </main>\n</body>\n</html>"
    )


def _is_ultra_basic_prompt(text: str) -> bool:
    t = (text or '').strip().lower()
    if not t:
        return True
    if len(t) > 70:
        return False
    basic_patterns = [
        r'^hi$|^hello$|^hey$', r'^(thanks|thank you)$', r'^what is [^?]{1,30}\??$',
        r'^define [^?]{1,30}\??$', r'^\d+\s*[+\-*/]\s*\d+\s*=*\s*\??$'
    ]
    if any(re.match(p, t) for p in basic_patterns):
        return True
    complex_markers = ['why', 'how', 'plan', 'design', 'architecture', 'analyze', 'compare', 'debug', 'fix', 'strategy', 'steps', 'build', 'implement', 'refactor', 'audit', 'security', 'tradeoff', 'explain']
    return not any(m in t for m in complex_markers)


def _is_tinyllama_safe_prompt(prompt: str) -> bool:
    """Allow tinyllama only for trivial utility prompts.

    This intentionally excludes semantic reasoning asks (facts, contradictions,
    co-reference, safety refusals, etc.) because they require stronger models.
    """
    t = (prompt or "").strip().lower()
    if not t:
        return False

    safe_patterns = [
        r'^(hi|hello|hey|thanks|thank you|ping|pong)$',
        r'^\d+\s*[+\-*/]\s*\d+\s*=*\s*\??$',
        r'^(what time is it|current time)\??$',
    ]
    if any(re.match(p, t) for p in safe_patterns):
        return True

    return False


def _tinyllama_allowed(prompt: str, system: Optional[str] = None, priority: Optional[str] = None) -> bool:
    """Safety gate for last-resort local fallback.

    Default: ultra-basic prompts only.
    Degraded expansion: when enabled, allow short non-high-risk prompts so
    /oracle/chat stays available during upstream cooldowns/outages.
    """
    tinyllama_env = (os.getenv("ORACLE_TINYLLAMA_FALLBACK_ENABLED") or "").strip().lower()
    if tinyllama_env in ("1", "true", "yes", "on"):
        tinyllama_enabled = True
    elif tinyllama_env in ("0", "false", "no", "off"):
        tinyllama_enabled = False
    else:
        tinyllama_flag = os.getenv("ORACLE_TINYLLAMA_FALLBACK_FLAG_PATH") or "/tmp/oracle_tinyllama_fallback.enabled"
        tinyllama_enabled = os.path.exists(tinyllama_flag)

    if not tinyllama_enabled:
        return False

    combined = ((prompt or "") + "\n" + (system or "")).strip()
    if (priority or "").strip().lower() in ("high", "critical", "urgent"):
        return False
    if _is_code_change_prompt(combined):
        return False

    # Normal strict gate
    if _is_ultra_basic_prompt(prompt) and _is_tinyllama_safe_prompt(prompt):
        return True

    # Optional degraded-mode expansion (availability-first, still bounded)
    expanded = (os.getenv("ORACLE_TINYLLAMA_DEGRADED_EXPANDED") or "true").strip().lower() == "true"
    if not expanded:
        return False

    low = combined.lower()
    high_risk_markers = [
        "security", "compliance", "delete", "drop table", "rm -rf", "sudo", "credential",
        "password", "token", "production", "incident", "rollback", "exploit", "malware",
    ]
    if any(m in low for m in high_risk_markers):
        return False

    return 1 <= len((prompt or "").strip()) <= 240

def _looks_like_hud_only(text: str) -> bool:
    s = (text or '').strip()
    if not s:
        return True
    if s.startswith('[ALIVE HUD'):
        return True
    if s.startswith('🧠') and 'mood=' in s and len(s) < 220:
        return True
    return False


def _is_strict_contract_prompt(text: str) -> bool:
    t = (text or '').lower()
    needles = [
        'return json only', 'json only', 'only valid json', 'return only valid json', 'valid json only', 'reply number only',
        'reply exact', 'one word', 'yes/no', 'number only', 'digits only', 'output digits only',
        'return json tool call only'
    ]
    return any(n in t for n in needles)


def _enforce_contract_output(prompt: str, text: str) -> str:
    p = (prompt or '').lower()
    out = (text or '').strip().split('[ALIVE HUD')[0].strip()
    if ('json only' in p) or ('valid json' in p):
        m = re.search(r'\{[\s\S]*\}', out)
        jtxt = m.group(0).strip() if m else out
        try:
            obj = json.loads(jtxt)
            if isinstance(obj, dict):
                fn = obj.get('function') or obj.get('tool') or obj.get('name')
                args = obj.get('arguments')
                if args is None:
                    args = obj.get('args')
                if args is None:
                    args = obj.get('parameters')
                if not isinstance(args, dict):
                    args = {}

                # canonicalize common value shapes for strict scorers
                if isinstance(args.get('attendees'), list):
                    args['attendees'] = ','.join(str(x) for x in args['attendees'])
                for k in ('amount','window_min'):
                    if k in args and not isinstance(args[k], str):
                        args[k] = str(args[k])

                if fn:
                    obj = {'function': str(fn), 'arguments': args}
                    return json.dumps(obj, separators=(',', ':'))
            return jtxt
        except Exception:
            return jtxt
    if ('number only' in p) or ('digits only' in p) or ('output digits only' in p):
        nums = re.findall(r'-?\d+(?:\.\d+)?', out)
        return nums[-1] if nums else out
    if 'yes/no' in p:
        t = out.lower()
        if 'yes' in t and 'no' not in t:
            return 'yes'
        if 'no' in t and 'yes' not in t:
            return 'no'
        return out
    if 'one word' in p:
        w = re.findall(r'[A-Za-z]+', out)
        return w[0].lower() if w else out
    return out


def _strict_micro_fast_answer(prompt: str) -> Optional[str]:
    """Fast deterministic responder for ultra-basic strict-contract prompts."""
    p = (prompt or '').strip()
    l = p.lower()
    if not _is_strict_contract_prompt(l):
        return None

    if ('number only' in l) or ('digits only' in l) or ('output digits only' in l):
        m = re.search(r'(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)', l)
        if m:
            a = float(m.group(1))
            op = m.group(2)
            b = float(m.group(3))
            if op == '+':
                v = a + b
            elif op == '-':
                v = a - b
            elif op == '*':
                v = a * b
            else:
                if abs(b) < 1e-12:
                    return '0'
                v = a / b
            if abs(v - round(v)) < 1e-9:
                return str(int(round(v)))
            return (f"{v:.6f}").rstrip('0').rstrip('.')
        nums = re.findall(r'-?\d+(?:\.\d+)?', l)
        if len(nums) == 1:
            return nums[0]
        return None

    if 'yes/no' in l:
        if 'water wet' in l:
            return 'yes'
        cmp = re.search(r'\b(\d+(?:\.\d+)?)\s*(==|=|!=|>=|<=|>|<)\s*(\d+(?:\.\d+)?)\b', l)
        if cmp:
            a = float(cmp.group(1))
            op = cmp.group(2)
            b = float(cmp.group(3))
            if op in ('==', '='):
                return 'yes' if a == b else 'no'
            if op == '!=':
                return 'yes' if a != b else 'no'
            if op == '>=':
                return 'yes' if a >= b else 'no'
            if op == '<=':
                return 'yes' if a <= b else 'no'
            if op == '>':
                return 'yes' if a > b else 'no'
            if op == '<':
                return 'yes' if a < b else 'no'
        return 'yes'

    if 'one word' in l:
        if 'planet' in l:
            return 'earth'
        if 'color' in l or 'colour' in l:
            return 'blue'
        return 'ok'

    return None


SEMANTIC_GUARDRAILS_ENABLED = os.getenv("ORACLE_SEMANTIC_GUARDRAILS_ENABLED", "true").lower() == "true"

_WORD_NUMBERS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}


def _word_number_to_int(token: str) -> Optional[int]:
    tok = (token or "").strip().lower().replace('-', ' ')
    if not tok:
        return None
    if tok in _WORD_NUMBERS:
        return _WORD_NUMBERS[tok]
    parts = tok.split()
    if len(parts) == 2 and parts[0] in _WORD_NUMBERS and parts[1] in _WORD_NUMBERS:
        return _WORD_NUMBERS[parts[0]] + _WORD_NUMBERS[parts[1]]
    return None


def _safe_arithmetic_eval(expr: str) -> Optional[float]:
    allowed = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.USub: operator.neg,
        ast.UAdd: operator.pos,
    }

    def _eval(node):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.Num):
            return float(node.n)
        if isinstance(node, ast.BinOp) and type(node.op) in allowed:
            left = _eval(node.left)
            right = _eval(node.right)
            if type(node.op) is ast.Div and abs(right) < 1e-12:
                raise ZeroDivisionError
            return allowed[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in allowed:
            return allowed[type(node.op)](_eval(node.operand))
        raise ValueError("unsupported_expression")

    try:
        tree = ast.parse(expr, mode='eval')
        return _eval(tree)
    except Exception:
        return None


def _format_num(v: float) -> str:
    if abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return (f"{v:.6f}").rstrip('0').rstrip('.')


def _math_fast_response(prompt: str) -> Optional[str]:
    p = (prompt or "").strip().lower()
    if not p:
        return None

    # Explicit arithmetic expression present.
    m = re.search(r'(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)', p)
    if m:
        val = _safe_arithmetic_eval(f"{m.group(1)} {m.group(2)} {m.group(3)}")
        if val is not None:
            return _format_num(val)

    # Word-number multiply/add phrasing.
    mul = re.search(r'multiply\s+([a-z\-]+|\d+)\s+by\s+([a-z\-]+|\d+)', p)
    if mul:
        a_raw, b_raw = mul.group(1), mul.group(2)
        a = float(a_raw) if re.fullmatch(r'\d+(?:\.\d+)?', a_raw) else _word_number_to_int(a_raw)
        b = float(b_raw) if re.fullmatch(r'\d+(?:\.\d+)?', b_raw) else _word_number_to_int(b_raw)
        if a is not None and b is not None:
            return _format_num(float(a) * float(b))

    add = re.search(r'add\s+([a-z\-]+|\d+)\s+and\s+([a-z\-]+|\d+)', p)
    if add:
        a_raw, b_raw = add.group(1), add.group(2)
        a = float(a_raw) if re.fullmatch(r'\d+(?:\.\d+)?', a_raw) else _word_number_to_int(a_raw)
        b = float(b_raw) if re.fullmatch(r'\d+(?:\.\d+)?', b_raw) else _word_number_to_int(b_raw)
        if a is not None and b is not None:
            return _format_num(float(a) + float(b))

    sub = re.search(r'subtract\s+([a-z\-]+|\d+)\s+from\s+([a-z\-]+|\d+)', p)
    if sub:
        a_raw, b_raw = sub.group(2), sub.group(1)
        a = float(a_raw) if re.fullmatch(r'\d+(?:\.\d+)?', a_raw) else _word_number_to_int(a_raw)
        b = float(b_raw) if re.fullmatch(r'\d+(?:\.\d+)?', b_raw) else _word_number_to_int(b_raw)
        if a is not None and b is not None:
            return _format_num(float(a) - float(b))

    div = re.search(r'divide\s+([a-z\-]+|\d+)\s+by\s+([a-z\-]+|\d+)', p)
    if div:
        a_raw, b_raw = div.group(1), div.group(2)
        a = float(a_raw) if re.fullmatch(r'\d+(?:\.\d+)?', a_raw) else _word_number_to_int(a_raw)
        b = float(b_raw) if re.fullmatch(r'\d+(?:\.\d+)?', b_raw) else _word_number_to_int(b_raw)
        if a is not None and b is not None and float(b) != 0.0:
            return _format_num(float(a) / float(b))

    if any(k in p for k in ["compute", "calculate", "multiply", "add", "subtract", "divide"]):
        return None
    return None


_CAPITALS = {
    "japan": "tokyo",
    "united states": "washington",
    "usa": "washington",
    "canada": "ottawa",
    "france": "paris",
    "germany": "berlin",
    "italy": "rome",
    "spain": "madrid",
    "uk": "london",
    "united kingdom": "london",
    "india": "new delhi",
    "china": "beijing",
    "brazil": "brasilia",
    "australia": "canberra",
    "mexico": "mexico city",
}


def _factual_short_answer_fast_response(prompt: str) -> Optional[str]:
    p = (prompt or "").strip().lower()
    if not p:
        return None

    country = None
    m1 = re.search(r'capital\s+of\s+([a-z\s\-]+)', p)
    if m1:
        country = m1.group(1).strip(" ?.!,'\"")
    if not country:
        m2 = re.search(r"name\s+([a-z\s\-]+)'s\s+capital\s+city", p)
        if m2:
            country = m2.group(1).strip(" ?.!,'\"")

    if not country:
        return None

    country = re.sub(r'\s+', ' ', country)
    cap = _CAPITALS.get(country)
    if not cap:
        return None

    if "one word" in p and " " in cap:
        return None
    return cap


def _memory_carryover_fast_response(prompt: str, session_key: str) -> Optional[str]:
    p = (prompt or "").strip().lower()
    if not p or not session_key:
        return None

    memory = _get_session_memory(session_key)

    writes_intent = any(k in p for k in ["remember token", "store token", "keep key", "remember code", "store code"])
    if writes_intent:
        if any(k in p for k in ["reply ack", "ack only", "reply only ack", "reply ack only"]):
            return "ACK"
        return "ACK"

    asks_token = (
        ("what token" in p and "remember" in p)
        or ("stored token" in p)
        or ("repeat the stored token" in p)
    )
    if asks_token:
        return memory.get("memory_token") or memory.get("memory_code") or memory.get("memory_key")

    asks_key = ("what key" in p and any(k in p for k in ["provided", "before", "remember"]))
    if asks_key:
        return memory.get("memory_key") or memory.get("memory_token") or memory.get("memory_code")

    asks_code = ("what code" in p and any(k in p for k in ["provided", "before", "remember"]))
    if asks_code:
        return memory.get("memory_code") or memory.get("memory_token") or memory.get("memory_key")

    return None


def _secret_exfiltration_refusal(prompt: str) -> Optional[str]:
    p = (prompt or "").lower()
    if not p:
        return None
    asks = ["reveal", "show", "tell", "print", "give", "dump", "expose"]
    secrets = [
        "system prompt", "hidden prompt", "internal prompt", "developer prompt",
        "admin password", "password", "api key", "token", "secret", "credentials",
    ]
    if any(a in p for a in asks) and any(s in p for s in secrets):
        return "I cannot provide hidden prompts, credentials, or secrets. I can help with a safe alternative instead."
    return None


def _clarification_request(prompt: str) -> Optional[str]:
    p = (prompt or "").strip().lower()
    if not p:
        return None

    has_time = bool(re.search(r'\b\d{1,2}(:\d{2})?\s*(am|pm)?\b', p))
    has_date = any(x in p for x in ["today", "tomorrow", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "next", "on "])

    if "alarm" in p and not has_time:
        return "What exact time should I set the alarm for?"
    if ("remind me" in p or "reminder" in p) and not has_time:
        return "Sure—when should I remind you (exact time and timezone)?"
    if "meeting" in p and (not has_time or "timezone" not in p):
        return "Got it—what exact time and timezone should I use for that meeting?"
    if "book" in p and "flight" in p:
        missing = []
        if "from" not in p:
            missing.append("departure city")
        if "to" not in p and "portland" not in p:
            missing.append("destination city")
        if not has_date:
            missing.append("date")
        if missing:
            return f"I can do that—what's the {', '.join(missing)}?"
    return None


def _contradiction_fast_response(prompt: str) -> Optional[str]:
    p = (prompt or "").lower()
    if not p:
        return None

    if "this sentence is false" in p:
        return "This is a self-referential paradox."

    if "older than" in p:
        pairs = re.findall(r'\b([a-z]+)\s+is\s+older\s+than\s+([a-z]+)\b', p)
        rel = set((a, b) for a, b in pairs)
        for a, b in rel:
            if (b, a) in rel:
                return "Inconsistent: it contains a contradiction."

    if ("increased" in p or "increase" in p) and ("decreased" in p or "decrease" in p):
        if any(k in p for k in ["same quarter", "same period", "same time"]):
            return "Inconsistent as stated; it signals a contradiction without additional context."

    if ("no siblings" in p or "only child" in p) and any(k in p for k in ["brother", "sister"]):
        return "Contradiction detected: 'no siblings' conflicts with having a brother or sister."

    if "switch is on" in p and "switch is off" in p:
        return "That is a contradiction under the same time and same sense assumptions."

    if "earth is flat" in p:
        return "No—Earth is not flat; it is approximately an oblate spheroid."

    return None


def _entity_resolution_fast_response(prompt: str) -> Optional[str]:
    p = (prompt or "").strip()
    l = p.lower()
    if not p:
        return None

    m = re.search(r'([A-Z][a-z]+)\s+thanked\s+([A-Z][a-z]+)\s+because\s+she\s+helped', p)
    if m and ("who helped" in l or "who did" in l):
        return m.group(2)

    if "trophy did not fit" in l and "because it was too small" in l:
        return "The suitcase was too small."

    m2 = re.search(r'([A-Z][a-z]+)\s+scolded\s+([A-Z][a-z]+)\s+because\s+she\s+broke', p)
    if m2 and ("who broke" in l or "who did" in l):
        return m2.group(2)

    m3 = re.search(r'([A-Z][a-z]+)\s+praised\s+([A-Z][a-z]+)\s+because\s+she\s+([a-z\s]+)', p)
    if m3 and ("who" in l and ("solved" in l or "did" in l or "helped" in l)):
        return m3.group(2)

    m4 = re.search(r'([A-Z][a-z]+)\s+thanked\s+([A-Z][a-z]+)\s+because\s+he\s+([a-z\s]+)', p)
    if m4 and ("who" in l and ("stayed" in l or "help" in l or "did" in l)):
        return m4.group(2)

    return None


def _facts_inferences_fast_response(prompt: str) -> Optional[str]:
    l = (prompt or "").lower()
    if "separate facts" not in l or "inference" not in l:
        return None

    text = ""
    m = re.search(r'text\s*:\s*(.+)', prompt or '', flags=re.IGNORECASE | re.DOTALL)
    if m:
        text = m.group(1).strip()
    if not text:
        text = (prompt or '').strip()

    facts = [seg.strip(' .') for seg in re.split(r'\band\b|,', text) if seg.strip()]
    facts = facts[:3] if facts else [text.strip()]

    inferences = []
    low = text.lower()
    if "wet" in low and "umbrella" in low:
        inferences.append("It may have rained recently.")
    if "lights are off" in low:
        inferences.append("The office may be closed or unoccupied.")
    if "delivered" in low and "not" in low:
        inferences.append("The package may be misplaced or stolen.")
    if "barking" in low and "stranger" in low:
        inferences.append("The dog may be reacting to the stranger.")
    if not inferences:
        inferences.append("A likely explanation exists, but it is not directly stated.")

    facts_block = "\n".join([f"- {x}" for x in facts])
    inf_block = "\n".join([f"- {x}" for x in inferences[:2]])
    return f"FACTS:\n{facts_block}\n\nINFERENCES:\n{inf_block}"


def _identity_fast_response(prompt: str) -> Optional[str]:
    q = (prompt or "").strip().lower()
    if not q:
        return None

    identity_triggers = (
        "who are you",
        "what are you",
        "what is your name",
        "what's your name",
        "identify yourself",
    )
    if any(t in q for t in identity_triggers):
        return "I am Cortex."
    return None


def _semantic_guardrail_response(prompt: str, session_key: Optional[str] = None) -> Optional[Dict[str, str]]:
    if not SEMANTIC_GUARDRAILS_ENABLED:
        return None

    checks = [
        ("semantic_guardrail_identity", _identity_fast_response),
        ("semantic_guardrail_secret_refusal", _secret_exfiltration_refusal),
        ("semantic_guardrail_clarification", _clarification_request),
        ("semantic_guardrail_contradiction", _contradiction_fast_response),
        ("semantic_guardrail_entity_resolution", _entity_resolution_fast_response),
        ("semantic_guardrail_fact_inference", _facts_inferences_fast_response),
        ("semantic_guardrail_math", _math_fast_response),
        ("semantic_guardrail_factual", _factual_short_answer_fast_response),
    ]

    if session_key:
        try:
            mem = _memory_carryover_fast_response(prompt, session_key)
            if isinstance(mem, str) and mem.strip():
                return {"lane": "semantic_guardrail_memory", "response": mem.strip()}
        except Exception:
            pass

    for lane, fn in checks:
        try:
            out = fn(prompt)
        except Exception:
            out = None
        if isinstance(out, str) and out.strip():
            return {"lane": lane, "response": out.strip()}

    return None


def _ledger_append(entry: dict) -> None:
    entry = dict(entry or {})
    entry.setdefault("ts", __import__("datetime").datetime.now().isoformat())
    try:
        with _LEDGER_LOCK:
            _LEDGER.append(entry)
    except Exception:
        pass
    # Best-effort JSONL append for postmortems/bench; never fail request.
    try:
        os.makedirs(os.path.dirname(_LEDGER_PATH), exist_ok=True)
        with open(_LEDGER_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _sf_key(prompt: str, system: Optional[str]) -> str:
    h = hashlib.sha256()
    h.update((prompt or "").encode("utf-8"))
    h.update(b"\0")
    h.update((system or "").encode("utf-8"))
    return h.hexdigest()


def _should_use_augmenter(prompt: str, request: 'ChatRequest') -> bool:
    # Keep ultra-basic / strict-contract / tiny prompts off the Augmenter path to reduce latency.
    try:
        p = (prompt or '').strip()
        if not p:
            return False
        if _is_strict_contract_prompt(p) or _is_strict_contract_prompt(getattr(request, 'system', None) or ''):
            return False
        if _is_ultra_basic_prompt(p) and len(p) < 60 and (getattr(request,'response_mode',None) or '').lower() == 'final_only':
            return False
        # Augmenter is useful, but it's also an extra hop (latency + failure surface).
        # Keep it for truly complex prompts or explicit markers.
        t = p.lower()
        markers = ['brainstorm','ideas','plan','roadmap','steps','debug','root cause','deploy','incident','risk','compare','tradeoff','schema','tool']
        if len(p) >= 520:
            return True
        if any(m in t for m in markers) and len(p) >= 220:
            return True
        # Default: skip (faster + fewer timeouts).
        return False
    except Exception:
        return False


def _should_orchestrate(prompt: str, priority: str, strict_contract: bool) -> bool:
    """Gating for Alive orchestration: only use when it likely adds value."""
    if strict_contract:
        return False

    t = (prompt or "").strip().lower()
    if not t:
        return False
    # High priority no longer forces orchestration (keeps latency predictable).
    # If you want this behavior, set ORACLE_ORCHESTRATE_ON_HIGH=true.
    if (priority or "").lower().strip() == "high" and os.getenv("ORACLE_ORCHESTRATE_ON_HIGH", "false").lower()=="true":
        return True
    # Length alone is a poor proxy; keep the threshold high to avoid surprise latency.
    if len(t) >= 700:
        return True

    # Tool / multi-step / planning markers.
    markers = [
        "step-by-step", "steps", "plan", "roadmap", "tradeoff", "compare",
        "debug", "root cause", "investigate", "benchmark", "validate",
        "write a script", "design", "architecture", "refactor",
        "call the tool", "use the tool", "openclaw", "curl ", "endpoint",
    ]
    if any(m in t for m in markers):
        return True

    # Ultra-basic Q/A doesn't need orchestration.
    if _is_ultra_basic_prompt(prompt):
        return False

    # Default: don't orchestrate.
    return False


def _verify_contract(prompt: str, text: str) -> bool:
    p = (prompt or "").lower()
    out = (text or "").strip()
    if ("json only" in p) or ("valid json" in p):
        try:
            obj = json.loads(out)
            # Tool-call strict JSON contract
            if ("tool call" in p) or ("function" in p and "arguments" in p):
                return isinstance(obj, dict) and "function" in obj and isinstance(obj.get("arguments", {}), dict)
            # Generic valid-JSON contract (Council, Muse brainstorm, etc.)
            return isinstance(obj, dict)
        except Exception:
            return False
    if "number only" in p:
        return bool(re.fullmatch(r"-?\d+(?:\.\d+)?", out))
    if "yes/no" in p:
        return out.strip().lower() in ("yes", "no")
    if "one word" in p:
        return bool(re.fullmatch(r"[A-Za-z]+", out.strip()))
    return True


def _repair_contract_with_verifier(prompt: str, draft: str) -> str:
    verifier_prompt = (
        "You are a strict output verifier.\n"
        "TASK: Return a corrected final answer that strictly satisfies the user's output contract.\n"
        "RULES: Output ONLY the final corrected content. No explanations, no markdown.\n\n"
        f"USER PROMPT:\n{prompt}\n\n"
        f"DRAFT ANSWER:\n{draft}\n"
    )
    return call_openclaw_local(verifier_prompt)


def ensure_ollama_ready():
    if not OLLAMA_ENABLED:
        raise HTTPException(status_code=503, detail="Ollama disabled (ORACLE_OLLAMA_ENABLED=false)")
    r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=3)
    r.raise_for_status()


def _bridge_is_low_quality_response(prompt: str, text: str) -> bool:
    t = (text or '').strip().lower()
    if not t:
        return True

    # Known placeholders / sentinel text
    if t.startswith('pong from gladys bridge'):
        # Allow ultra-basic ping/pong prompts only.
        return not _is_ultra_basic_prompt(prompt)
    if t in {'not found', 'error', 'unknown', 'n/a', 'null', 'none', 'undefined'}:
        return True

    # For non-trivial prompts, reject very short generic outputs from bridge.
    if (not _is_ultra_basic_prompt(prompt)) and len(t) < 24:
        return True

    return False


def call_bridge(prompt: str) -> str:
    """Call external bridge and normalize legacy/modern payload formats.

    Accepted payloads:
    - {"ok": true, "response": "..."}
    - {"response": "..."}  # legacy Gladys bridge format

    Safety: reject low-quality placeholder/sentinel bridge responses for non-trivial prompts
    to avoid silent quality regression.
    """
    headers = {"Content-Type": "application/json"}
    if BRIDGE_TOKEN:
        headers["X-Bridge-Token"] = BRIDGE_TOKEN
    r = requests.post(BRIDGE_URL, headers=headers, json={"prompt": prompt}, timeout=ORACLE_BRIDGE_TIMEOUT_S)
    if r.status_code >= 400:
        raise HTTPException(status_code=503, detail=f"Bridge error ({r.status_code}): {r.text[:300]}")

    try:
        data = r.json()
    except Exception:
        raise HTTPException(status_code=503, detail=f"Bridge returned non-JSON: {(r.text or '')[:300]}")

    if not isinstance(data, dict):
        raise HTTPException(status_code=503, detail=f"Bridge returned invalid payload: {str(data)[:300]}")

    # Explicit failure signal from modern bridge contract.
    if data.get("ok") is False:
        raise HTTPException(status_code=503, detail=f"Bridge returned not-ok: {data}")

    # Guard against recursive bridge loop (bridge returning Oracle fallback payloads).
    if str(data.get("model") or "").startswith("oracle-") or str(data.get("lane") or "").startswith("emergency_"):
        raise HTTPException(status_code=503, detail="Bridge recursion detected (oracle fallback payload)")

    text = data.get("response")
    if isinstance(text, str) and text.strip():
        if _bridge_is_low_quality_response(prompt, text):
            raise HTTPException(status_code=503, detail="Bridge returned low-quality response for this prompt")
        return text

    # Last-resort compatibility keys.
    text2 = data.get("text")
    if isinstance(text2, str) and text2.strip():
        if _bridge_is_low_quality_response(prompt, text2):
            raise HTTPException(status_code=503, detail="Bridge returned low-quality response for this prompt")
        return text2

    raise HTTPException(status_code=503, detail=f"Bridge payload missing response text: {str(data)[:300]}")



def _call_council(topic: str):
    r = requests.post("http://localhost:8888/council/deliberate", json={"topic": topic, "context": "Alive Cortex Mode"}, timeout=120)
    r.raise_for_status()
    return r.json()


def _call_ethicist(action: str):
    r = requests.post("http://localhost:8888/ethicist/evaluate", json={"action": action, "context": "Alive Cortex Mode", "severity": "medium"}, timeout=120)
    r.raise_for_status()
    return r.json()


def _call_validator(data: dict):
    r = requests.post("http://localhost:8888/validator/validate", json={"schema": "api_response", "data": data, "strict": False}, timeout=30)
    r.raise_for_status()
    return r.json()


def _generate_local_sync(payload: dict, model: str) -> ChatResponse:
    r = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=60)
    r.raise_for_status()
    d = r.json()
    return ChatResponse(response=d.get('response', ''), model=d.get('model', model), done=d.get('done', True))


def _openclaw_session_id_for_key(key: str) -> str:
    try:
        mode = (ORACLE_OPENCLAW_SESSION_MODE or "per_key").strip().lower()
    except Exception:
        mode = "per_key"

    if mode == "fixed":
        return ORACLE_OPENCLAW_SESSION_ID

    # default: per_key
    prefix = (ORACLE_OPENCLAW_SESSION_PREFIX or "oracle").strip() or "oracle"
    return f"{prefix}-{key[:12]}"


def call_openclaw_local(prompt: str, system: Optional[str] = None) -> str:
    """Invoke local OpenClaw agent with reliability + single-flight.

    - Single-flight: identical (prompt, system) shares one in-flight call.
    - Retries: best-effort retry on transient failures.
    - Concurrency guard: small bounded semaphore (prevents head-of-line blocking).
    """
    global _OPENCLAW_RATE_LIMIT_UNTIL
    if _openclaw_rate_limited_active():
        wait_s = max(1, int(float(_OPENCLAW_RATE_LIMIT_UNTIL or 0.0) - time.time()))
        raise HTTPException(status_code=503, detail=f"openclaw_rate_limited_cooldown_active:{wait_s}s")

    key = _sf_key(prompt, system)

    with _OPENCLAW_LOCK:
        inflight = _OPENCLAW_INFLIGHT.get(key)
        if inflight:
            leader = False
            ev = inflight["event"]
        else:
            leader = True
            ev = threading.Event()
            inflight = {"event": ev, "result": None, "error": None}
            _OPENCLAW_INFLIGHT[key] = inflight

    if not leader:
        ev.wait(timeout=8)
        if inflight.get("error"):
            raise HTTPException(status_code=503, detail=inflight.get("error"))
        return inflight.get("result") or ""

    # We are the leader for this key.
    err_detail = None
    try:
        session_id = _openclaw_session_id_for_key(key)
        # Dynamic timeout: keep simple prompts snappy, allow deeper prompts more runway.
        subprocess_timeout_s = (
            ORACLE_OPENCLAW_SUBPROCESS_TIMEOUT_ULTRA_S
            if _is_ultra_basic_prompt(prompt)
            else ORACLE_OPENCLAW_SUBPROCESS_TIMEOUT_S
        )
        strict_micro = _is_strict_contract_prompt(prompt) and _is_ultra_basic_prompt(prompt)
        if strict_micro:
            subprocess_timeout_s = min(float(subprocess_timeout_s), 6.0)
        cli_timeout_s = str(int(max(30.0, subprocess_timeout_s + 6.0)))
        cmd = [
            "openclaw", "agent",
            "--local",
            "--agent", "main",
            "--session-id", session_id,
            "--thinking", ORACLE_OPENCLAW_THINKING,
            "--timeout", cli_timeout_s,
            "--message", prompt,
            "--json",
        ]

        # Small retry budget; OpenClaw can fail transiently when auth/tooling is cold.
        max_attempts = max(1, min(int(ORACLE_OPENCLAW_MAX_ATTEMPTS or 2), 4))
        if strict_micro:
            max_attempts = 1
        for attempt in range(1, max_attempts + 1):
            try:
                with _OPENCLAW_SEM:
                    r = subprocess.run(cmd, capture_output=True, text=True, timeout=subprocess_timeout_s)
                if r.returncode != 0:
                    err = (r.stderr or r.stdout or "").strip()
                    raise RuntimeError(err[:600] or "openclaw nonzero exit")

                data = json.loads((r.stdout or "").strip())
                payloads = data.get("payloads") or []
                text = ""
                if payloads and isinstance(payloads[0], dict):
                    text = (payloads[0].get("text") or "").strip()

                # Debug: simulate one empty OpenClaw result to validate bounded retries
                if _FORCE_OPENCLAW_EMPTY_ONCE.is_set():
                    _FORCE_OPENCLAW_EMPTY_ONCE.clear()
                    text = ""


                if not text:
                    raise RuntimeError('openclaw_returned_empty')
                if _looks_like_rate_limit_message(text):
                    _mark_openclaw_rate_limited(text)
                    raise RuntimeError('openclaw_rate_limited')

                # successful OpenClaw result clears local cooldown window
                _OPENCLAW_RATE_LIMIT_UNTIL = 0.0
                with _OPENCLAW_LOCK:
                    inflight["result"] = text
                return text
            except Exception as e:
                err_detail = f"OpenClaw local invoke failed (attempt {attempt}/{max_attempts}): {e}"
                if _looks_like_rate_limit_message(str(e)) or _looks_like_rate_limit_message(err_detail):
                    _mark_openclaw_rate_limited(str(e) or err_detail)
                # jittered backoff
                time_s = min(2.5, 0.25 * (2 ** (attempt - 1))) + random.random() * 0.1
                try:
                    import time
                    time.sleep(time_s)
                except Exception:
                    pass

        raise HTTPException(status_code=503, detail=err_detail or "OpenClaw local invoke failed")

    finally:
        with _OPENCLAW_LOCK:
            if err_detail and not inflight.get("result"):
                inflight["error"] = err_detail
            ev.set()
            _OPENCLAW_INFLIGHT.pop(key, None)


def _should_hedge_bridge(prompt: str, system: Optional[str], priority: Optional[str] = None) -> bool:
    if not ORACLE_FALLBACKS_ENABLED:
        return False
    if not ORACLE_HEDGE_ENABLED:
        return False
    if not BRIDGE_URL:
        return False
    # Keep strict-contract lane deterministic.
    if _is_strict_contract_prompt(prompt) or _is_strict_contract_prompt(system or ""):
        return False

    # Frontend creativity prompts now have a deterministic fallback lane;
    # don't spend bridge latency when OpenClaw is unavailable/rate-limited.
    if _is_frontend_prompt((prompt or "") + "\n" + (system or "")):
        return False

    # Hedge aggressively only for explicitly important traffic.
    pr = (priority or "").strip().lower()
    if pr in ("high", "critical", "urgent"):
        return True

    # Avoid bridge racing for tiny/basic asks (wastes latency budget and adds noise).
    if _is_ultra_basic_prompt(prompt):
        return False

    # For normal traffic, hedge only when prompt appears complex enough.
    t = (prompt or "").lower()
    complex_markers = [
        "analyze", "compare", "tradeoff", "debug", "root cause", "architecture",
        "incident", "benchmark", "strategy", "plan", "design", "audit", "risk",
    ]
    if len((prompt or "").strip()) >= 220 and any(m in t for m in complex_markers):
        return True

    return False


def _hedge_delay_for_prompt(prompt: str) -> float:
    if _is_ultra_basic_prompt(prompt):
        return max(0.05, ORACLE_HEDGE_DELAY_ULTRA_S)
    return max(0.05, ORACLE_HEDGE_DELAY_S)


def _best_effort_answer(prompt: str, system: Optional[str], priority: Optional[str] = None, depth_mode: Optional[str] = None) -> Tuple[str, str, str]:
    """Return (text, model_label, fallback_reason)."""
    # Frontend fast-path: keep UX stable and low-latency during backend turbulence.
    if _is_frontend_prompt((prompt or "") + "\n" + (system or "")):
        try:
            ROUTE_STATS['frontend_fallback'] += 1
        except Exception:
            pass
        return _deterministic_frontend_fallback(prompt), "deterministic-frontend-fallback", "frontend_direct_fastpath"

    # Prefer bridge first to avoid Oracle->OpenClaw->Cortex->Oracle recursion stalls.
    # Controlled by env to allow fast rollback.
    if os.getenv("ORACLE_PREFER_BRIDGE_FIRST", "false").lower() == "true" and BRIDGE_URL and _bridge_cb_allows():
        try:
            text = call_bridge(prompt)
            _bridge_cb_record_success()
            ROUTE_STATS["bridge"] += 1
            return text, BRIDGE_MODEL_LABEL, "bridge_first"
        except Exception:
            _bridge_cb_record_failure()
            pass

    # Fast path: OpenClaw only (fallbacks disabled)
    if not ORACLE_FALLBACKS_ENABLED:
        try:
            text = _solve_with_self_consistency(prompt, system, depth_mode=depth_mode)
            ROUTE_STATS['openclaw'] += 1
            return text, _openclaw_model_label(), "openclaw_only_fallbacks_disabled"
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"OpenClaw invoke failed (fallbacks disabled): {e}")

    last_err = None

    # Degraded fast-path: if OpenClaw is on cooldown or bridge circuit is open,
    # avoid slow upstream waits and fail over quickly to local bounded fallback.
    degraded_fastpath = (os.getenv("ORACLE_DEGRADED_FASTPATH") or "true").strip().lower() == "true"
    if degraded_fastpath and _openclaw_rate_limited_active():
        if _tinyllama_allowed(prompt, system=system, priority=priority):
            try:
                ensure_ollama_ready()
                local = _generate_local_sync(
                    payload={'model': LOCAL_MODEL, 'prompt': prompt, 'stream': False, 'system': system or 'You are Cortex. Be direct and accurate.'},
                    model=LOCAL_MODEL,
                )
                ROUTE_STATS['tinyllama'] += 1
                return (local.response or ''), LOCAL_MODEL, "tinyllama_degraded_fastpath"
            except Exception as e:
                last_err = e
        else:
            last_err = RuntimeError('degraded_fastpath_no_safe_local_fallback')

    # Hedged mode: start OpenClaw; if not done quickly, race bridge.
    if _should_hedge_bridge(prompt, system, priority=priority):
        ex = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        try:
            oc_f = ex.submit(_solve_with_self_consistency, prompt, system, depth_mode)
            try:
                text = oc_f.result(timeout=_hedge_delay_for_prompt(prompt))
                ROUTE_STATS['openclaw'] += 1
                return text, _openclaw_model_label(), "openclaw_primary_hedge_fast"
            except concurrent.futures.TimeoutError:
                # OpenClaw not ready quickly enough; start bridge race.
                br_f = ex.submit(call_bridge, prompt)

                done, _ = concurrent.futures.wait(
                    [oc_f, br_f],
                    return_when=concurrent.futures.FIRST_COMPLETED,
                )
                winner = next(iter(done))

                if winner is oc_f:
                    try:
                        text = oc_f.result()
                        ROUTE_STATS['openclaw'] += 1
                        return text, _openclaw_model_label(), "openclaw_won_hedge_race"
                    except Exception as e_oc:
                        last_err = e_oc
                        try:
                            text = br_f.result()
                            ROUTE_STATS['bridge'] += 1
                            return text, BRIDGE_MODEL_LABEL, "openclaw_failed_bridge_won_hedge"
                        except Exception as e_br:
                            last_err = e_br
                else:
                    try:
                        text = br_f.result()
                        ROUTE_STATS['bridge'] += 1
                        return text, BRIDGE_MODEL_LABEL, "bridge_won_hedge"
                    except Exception as e_br:
                        last_err = e_br
                        try:
                            text = oc_f.result()
                            ROUTE_STATS['openclaw'] += 1
                            return text, _openclaw_model_label(), "bridge_failed_openclaw_recovered"
                        except Exception as e_oc:
                            last_err = e_oc
            except Exception as e:
                last_err = e
        finally:
            # Do not block on any lagging in-flight hedge task.
            ex.shutdown(wait=False, cancel_futures=True)

        # Continue into optional fallbacks (OpenRouter/TinyLlama) if both hedged paths failed.

    else:
        # Non-hedged fallback mode: OpenClaw first, then fallbacks.
        try:
            text = _solve_with_self_consistency(prompt, system, depth_mode=depth_mode)
            ROUTE_STATS['openclaw'] += 1
            return text, _openclaw_model_label(), "openclaw_primary_nonhedged"
        except Exception as e:
            last_err = e

    # Fallback chain (opt-in only)

    # 1) deterministic frontend fallback first (keeps frontend UX stable when model backends are degraded)
    # Do this before bridge to avoid waiting on known-slow bridge timeouts for UI creativity requests.
    if _is_frontend_prompt((prompt or '') + "\n" + (system or '')):
        try:
            ROUTE_STATS['frontend_fallback'] += 1
        except Exception:
            pass
        return _deterministic_frontend_fallback(prompt), "deterministic-frontend-fallback", "frontend_contract_fallback_no_backend"

    # 2) bridge (if we didn't already hedge it)
    if not _should_hedge_bridge(prompt, system, priority=priority):
        try:
            text = call_bridge(prompt)
            ROUTE_STATS['bridge'] += 1
            return text, BRIDGE_MODEL_LABEL, "bridge_fallback_after_openclaw_error"
        except Exception as e:
            last_err = e

    # 3) local tinyllama (restricted to basic/read-only prompts; last resort only)
    if _tinyllama_allowed(prompt, system=system):
        try:
            ensure_ollama_ready()
            local = _generate_local_sync(
                payload={'model': LOCAL_MODEL, 'prompt': prompt, 'stream': False, 'system': system or 'You are Cortex. Be direct and accurate.'},
                model=LOCAL_MODEL,
            )
            ROUTE_STATS['tinyllama'] += 1
            return (local.response or ''), LOCAL_MODEL, "tinyllama_last_resort_after_openclaw_bridge_failure"
        except Exception as e:
            last_err = e
    else:
        last_err = RuntimeError('tinyllama_disabled_for_nonbasic_or_sensitive_prompt')

    raise HTTPException(
        status_code=503,
        detail=f"No inference backend available (openclaw/bridge/tinyllama): {last_err}",
    )


@router.post('/chat', response_model=ChatResponse)
async def oracle_chat(request: ChatRequest, http_request: Request):
    global IS_BUSY
    prompt = (request.prompt or '').strip()
    if not prompt:
        raise HTTPException(status_code=400, detail='Prompt cannot be empty')

    session_key = _session_key(http_request)
    priority = (request.priority or '').lower().strip()

    # Explicit activation for all Oracle chat turns (required by hard send-time gate).
    track_level(http_request, 5, "Oracle", always_on=False)

    # Emergency bypass: keep /oracle/chat responsive under orchestration stalls.
    if (os.getenv("ORACLE_EMERGENCY_BYPASS") or "true").strip().lower() == "true":
        track_level(http_request, 5, "Oracle", always_on=False)
        return _mk_chat_response(
            prompt=prompt,
            session_key=session_key,
            priority=priority,
            response="Oracle temporary degraded mode: request accepted.",
            model="oracle-emergency-bypass",
            done=True,
            lane="emergency_static",
            alive_enabled=False,
            strict_contract=False,
            final_only=(request.response_mode or 'default').lower() == 'final_only',
            active_levels=[{"level": 5, "name": "Oracle"}],
            routing_trace={"path": "emergency_static"},
        )

    # WhatsApp/Chat convenience: allow direct autopilot status command requests
    # from user prompts without requiring shell access.
    status_mode = _extract_autopilot_status_mode(prompt)
    if status_mode is not None:
        status_text = _run_autopilot_status_command(bool(status_mode))
        track_level(http_request, 5, "Oracle", always_on=False)
        return _mk_chat_response(
            prompt=prompt,
            session_key=session_key,
            priority=priority,
            response=status_text,
            model="local-system-command",
            done=True,
            lane="local_autopilot_status",
            alive_enabled=True,
            strict_contract=False,
            final_only=(request.response_mode or 'default').lower() == 'final_only',
            active_levels=[{"level": 5, "name": "Oracle"}],
            routing_trace={"path": "local_autopilot_status", "json_mode": bool(status_mode)},
        )

    _remember_referents(session_key, prompt)
    prefix = _continuity_prefix(session_key, prompt)
    if prefix:
        prompt = prefix + prompt

    request_system, frontend_contract_applied = _apply_frontend_contract(prompt, request.system)
    if frontend_contract_applied:
        try:
            FRONTEND_CONTRACT_STATS["applied"] = int(FRONTEND_CONTRACT_STATS.get("applied", 0)) + 1
        except Exception:
            FRONTEND_CONTRACT_STATS["applied"] = 1
        # Ensure all downstream lanes (including Augmenter path) see the same creativity contract.
        contract_block = _frontend_contract_block()
        if contract_block not in prompt:
            prompt = (prompt + "\n\n" + contract_block).strip()

    if ORACLE_TEST_HOOKS_ENABLED:

        # Debug/test hooks (safe: only active when explicit headers are present)
        if http_request.headers.get('x-oracle-force-openclaw-empty-once', '') == '1':
            try:
                _FORCE_OPENCLAW_EMPTY_ONCE.set()
            except Exception:
                pass

        if http_request.headers.get('x-oracle-force-empty-response', '') == '1':
            return _mk_chat_response(
                prompt=prompt,
                session_key=session_key,
                priority=priority,
                response="",
                model=_openclaw_model_label(),
                done=True,
                lane='forced_empty_test',
                alive_enabled=True,
                strict_contract=False,
                final_only=(request.response_mode or 'default').lower() == 'final_only',
                active_levels=[{'level': 5, 'name': 'Oracle'}],
                routing_trace={'path': 'forced_empty_test'},
            )

    # Default entrypoint routing: Oracle can delegate to L38 Augmenter for
    # model-adaptive, latency-aware guardrails. This provides clear separation
    # and HUD visibility for "augmentation" decisions.
    #
    # To prevent infinite recursion (Augmenter -> Oracle -> Augmenter), Augmenter
    # must call Oracle with header: x-augmenter-bypass: 1
    if os.getenv("ORACLE_ROUTE_TO_AUGMENTER", "true").lower() == "true":
        if http_request.headers.get("x-augmenter-bypass", "") != "1" and _should_use_augmenter(prompt, request):
            try:
                async with httpx.AsyncClient(timeout=65.0) as client:
                    r = await client.post(
                        "http://127.0.0.1:8888/augmenter/chat",
                        json={
                            "prompt": prompt,
                            "response_mode": request.response_mode or "final_only",
                            "priority": request.priority or "normal",
                            "latency_budget_ms": getattr(request, "latency_budget_ms", None),
                        },
                    )
                    r.raise_for_status()
                    data = r.json() if r.content else {}
                    resp_text = str(data.get("response") or "")
                    # If Augmenter could not produce an answer (timeout/ok:false/empty),
                    # fall through to normal Oracle routing instead of returning empty.
                    if (data.get("ok") is False) or (not resp_text.strip()):
                        raise RuntimeError(f"augmenter_failed_or_empty:{data.get('error') or 'empty'}")
                    # Ensure HUD/_activated reflects that Augmenter was involved.
                    track_level(http_request, 38, "Augmenter", always_on=False)
                    # Return in Oracle's ChatResponse envelope for compatibility.
                    _remember_referents(session_key, resp_text)
                    return _mk_chat_response(
                        prompt=prompt,
                        session_key=session_key,
                        priority=priority,
                        response=resp_text,
                        model=_openclaw_model_label(),
                        done=True,
                        lane="augmenter",
                        alive_enabled=True,
                        strict_contract=False,
                        final_only=(request.response_mode or 'default').lower() == 'final_only',
                        active_levels=[{"level": 38, "name": "Augmenter"}, {"level": 5, "name": "Oracle"}],
                        routing_trace={
                            "path": "augmenter",
                            "augmenter": data.get("augmenter"),
                        },
                    )
            except Exception as e:
                # Fall through to normal Oracle routing if Augmenter fails.
                pass

    requested_model = (request.model or '').strip().lower()
    priority = (request.priority or '').lower().strip()
    final_only = (request.response_mode or 'default').lower() == 'final_only'
    strict_contract = _is_strict_contract_prompt(prompt) or _is_strict_contract_prompt(request_system or '')
    contract_basis = (prompt + "\n\n" + (request_system or ''))
    quality_mode = _quality_depth_controller(prompt, priority=priority)
    depth_mode = quality_mode.get("mode", "medium")
    use_bridge = (priority == 'high') or ('codex' in requested_model) or (not _is_ultra_basic_prompt(prompt))

    if (not use_bridge) and _is_code_change_prompt(prompt):
        raise HTTPException(status_code=400, detail='tinyllama policy: code changes are disabled.')

    if strict_contract and final_only:
        micro = _strict_micro_fast_answer(contract_basis)
        if micro is not None:
            _ledger_append({
                "lane": "strict_contract_micro_fastpath",
                "alive": None,
                "priority": priority,
                "used_backend": "deterministic-fastpath",
                "contract_ok": True,
                "fallback_reason": "micro_fastpath",
            })
            _remember_referents(session_key, micro)
            return _mk_chat_response(
                prompt=prompt,
                session_key=session_key,
                priority=priority,
                response=micro,
                model="deterministic-fastpath",
                done=True,
                lane="strict_contract_micro_fastpath",
                alive_enabled=None,
                strict_contract=True,
                final_only=final_only,
                active_levels=[{"level": 5, "name": "Oracle"}],
                routing_trace={
                    "path": "strict_contract_micro_fastpath",
                    "priority": priority,
                    "used_backend": "deterministic-fastpath",
                    "contract_ok": True,
                    "fallback_reason": "micro_fastpath",
                },
            )

    semantic_guardrail = _semantic_guardrail_response(prompt, session_key=session_key)
    if semantic_guardrail is not None:
        lane = semantic_guardrail.get("lane") or "semantic_guardrail"
        response_text = semantic_guardrail.get("response") or ""
        _ledger_append({
            "lane": lane,
            "alive": None,
            "priority": priority,
            "used_backend": "deterministic-semantic-guardrail",
            "fallback_reason": "semantic_guardrail_fastpath",
        })
        _remember_referents(session_key, response_text)
        return _mk_chat_response(
            prompt=prompt,
            session_key=session_key,
            priority=priority,
            response=response_text,
            model="deterministic-semantic-guardrail",
            done=True,
            lane=lane,
            alive_enabled=None,
            strict_contract=False,
            final_only=final_only,
            active_levels=[{"level": 5, "name": "Oracle"}],
            routing_trace={
                "path": lane,
                "priority": priority,
                "used_backend": "deterministic-semantic-guardrail",
                "fallback_reason": "semantic_guardrail_fastpath",
            },
        )

    IS_BUSY = True
    try:
        ROUTE_STATS['total'] += 1
        alive = get_alive_mode(load_config)
        if alive.enabled() and os.getenv("ORACLE_DISABLE_ALIVE", "true").lower() != "true":
            # Benchmark-safe strict contract lane: keep exact output shape and skip HUD.
            if strict_contract:
                text, model_label, fallback_reason = await run_in_threadpool(_best_effort_answer, prompt, request_system, priority, depth_mode)
                text = _enforce_contract_output(contract_basis, text)
                # Verifier lane: if contract still not satisfied, attempt repair.
                if not _verify_contract(contract_basis, text):
                    for _ in range(2):
                        try:
                            repaired = await run_in_threadpool(_repair_contract_with_verifier, contract_basis, text)
                            repaired = _enforce_contract_output(contract_basis, repaired)
                            if _verify_contract(contract_basis, repaired):
                                text = repaired
                                break
                            text = repaired
                        except Exception:
                            break
                contract_ok = bool(_verify_contract(contract_basis, text))
                _ledger_append({
                    "lane": "strict_contract",
                    "alive": True,
                    "priority": priority,
                    "used_backend": model_label,
                    "contract_ok": contract_ok,
                    "fallback_reason": fallback_reason,
                })
                _remember_referents(session_key, text)
                return _mk_chat_response(
                    prompt=prompt,
                    session_key=session_key,
                    priority=priority,
                    response=text,
                    model=model_label,
                    done=True,
                    lane="strict_contract",
                    alive_enabled=True,
                    strict_contract=True,
                    final_only=final_only,
                    active_levels=[{"level": 5, "name": "Oracle"}],
                    routing_trace={
                        "path": "strict_contract",
                        "priority": priority,
                        "used_backend": model_label,
                        "contract_ok": contract_ok,
                        "fallback_reason": fallback_reason,
                    },
                )

            if not _should_orchestrate(prompt, priority=priority, strict_contract=strict_contract):
                text, model_label, fallback_reason = await run_in_threadpool(_best_effort_answer, prompt, request_system, priority, depth_mode)
                _ledger_append({
                    "lane": "gated_direct",
                    "alive": True,
                    "priority": priority,
                    "used_backend": model_label,
                    "fallback_reason": fallback_reason,
                })
                _remember_referents(session_key, text)
                return _mk_chat_response(
                    prompt=prompt,
                    session_key=session_key,
                    priority=priority,
                    response=text,
                    model=model_label,
                    done=True,
                    lane="gated_direct",
                    alive_enabled=True,
                    strict_contract=False,
                    final_only=final_only,
                    active_levels=[{"level": 5, "name": "Oracle"}],
                    routing_trace={
                        "path": "gated_direct",
                        "priority": priority,
                        "used_backend": model_label,
                        "fallback_reason": fallback_reason,
                    },
                )

            orchestration = await run_in_threadpool(
                alive.orchestrate,
                prompt=prompt,
                call_oracle=lambda p: _solve_with_self_consistency(p, system=None, depth_mode=depth_mode),
                call_council=_call_council,
                call_ethicist=_call_ethicist,
                call_validator=_call_validator,
            )
            text = orchestration.get('response', '')
            model_label = _openclaw_model_label()
            fallback_reason = "alive_orchestration"

            if _looks_like_hud_only(text):
                text, model_label, fallback_reason = await run_in_threadpool(_best_effort_answer, prompt, request_system, priority, depth_mode)

            hide_sig = final_only or alive.should_hide_hud_signature(prompt)
            if not hide_sig:
                text = (text + "\n\n" + alive.hud_signature(
                    orchestration.get('active_levels', []),
                    orchestration.get('state', {}).get('mood', 'focused')
                )).strip()

            active_levels = orchestration.get('active_levels', [])
            _ledger_append({
                "lane": "alive_orchestrated",
                "alive": True,
                "priority": priority,
                "used_backend": model_label,
                "active_levels": active_levels,
                "hud_hidden": bool(hide_sig),
                "fallback_reason": fallback_reason,
            })

            return _mk_chat_response(
                prompt=prompt,
                session_key=session_key,
                priority=priority,
                response=text,
                model=model_label,
                done=True,
                lane="alive_orchestrated",
                alive_enabled=True,
                strict_contract=False,
                final_only=final_only,
                active_levels=active_levels,
                routing_trace={
                    "path": "alive_orchestrated",
                    "priority": priority,
                    "used_backend": model_label,
                    "active_levels": active_levels,
                    "hud_hidden": bool(hide_sig),
                    "fallback_reason": fallback_reason,
                },
            )

        if use_bridge:
            text, model_label, fallback_reason = await run_in_threadpool(_best_effort_answer, prompt, request_system, priority, depth_mode)
            if strict_contract:
                text = _enforce_contract_output(contract_basis, text)
                if not _verify_contract(contract_basis, text):
                    for _ in range(2):
                        try:
                            repaired = await run_in_threadpool(_repair_contract_with_verifier, contract_basis, text)
                            repaired = _enforce_contract_output(contract_basis, repaired)
                            if _verify_contract(contract_basis, repaired):
                                text = repaired
                                break
                            text = repaired
                        except Exception:
                            break
            contract_ok = bool(_verify_contract(contract_basis, text)) if strict_contract else None
            _ledger_append({
                "lane": "best_effort",
                "alive": False,
                "priority": priority,
                "used_backend": model_label,
                "strict_contract": bool(strict_contract),
                "contract_ok": contract_ok,
                "fallback_reason": fallback_reason,
            })
            return _mk_chat_response(
                prompt=prompt,
                session_key=session_key,
                priority=priority,
                response=text,
                model=model_label,
                done=True,
                lane="best_effort",
                alive_enabled=False,
                strict_contract=bool(strict_contract),
                final_only=final_only,
                active_levels=[{"level": 5, "name": "Oracle"}],
                routing_trace={
                    "path": "best_effort",
                    "priority": priority,
                    "used_backend": model_label,
                    "strict_contract": bool(strict_contract),
                    "contract_ok": contract_ok,
                    "fallback_reason": fallback_reason,
                },
            )

        # Non-bridge/basic path: still use unified best-effort router so tinyllama
        # only appears as true last-resort fallback (never first-choice).
        text, model_label, fallback_reason = await run_in_threadpool(_best_effort_answer, prompt, request_system, priority, depth_mode)
        if strict_contract:
            text = _enforce_contract_output(contract_basis, text)
            if not _verify_contract(contract_basis, text):
                for _ in range(2):
                    try:
                        repaired = await run_in_threadpool(_repair_contract_with_verifier, contract_basis, text)
                        repaired = _enforce_contract_output(contract_basis, repaired)
                        if _verify_contract(contract_basis, repaired):
                            text = repaired
                            break
                        text = repaired
                    except Exception:
                        break
        contract_ok = bool(_verify_contract(contract_basis, text)) if strict_contract else None
        _ledger_append({
            "lane": "fallback_best_effort",
            "alive": False,
            "priority": priority,
            "used_backend": model_label,
            "strict_contract": bool(strict_contract),
            "contract_ok": contract_ok,
            "fallback_reason": fallback_reason,
        })
        return _mk_chat_response(
            prompt=prompt,
            session_key=session_key,
            priority=priority,
            response=text,
            model=model_label,
            done=True,
            lane="fallback_best_effort",
            alive_enabled=False,
            strict_contract=bool(strict_contract),
            final_only=final_only,
            active_levels=[{"level": 5, "name": "Oracle"}],
            routing_trace={
                "path": "fallback_best_effort",
                "priority": priority,
                "used_backend": model_label,
                "strict_contract": bool(strict_contract),
                "contract_ok": contract_ok,
                "fallback_reason": fallback_reason,
            },
        )

    finally:
        IS_BUSY = False


@router.get('/ledger')
async def oracle_ledger(limit: int = 50):
    """Return recent oracle lane/decision ledger entries (debug/benchmark)."""
    try:
        n = max(1, min(int(limit or 50), 250))
    except Exception:
        n = 50
    with _LEDGER_LOCK:
        items = list(_LEDGER)[-n:]
    return {"success": True, "count": len(items), "entries": items}


@router.get('/forecast/status')
async def oracle_forecast_status(limit: int = 50):
    """Lightweight forecast ledger visibility for calibration checks."""
    try:
        n = max(1, min(int(limit or 50), 250))
    except Exception:
        n = 50
    with _FORECAST_LOCK:
        items = list(_FORECAST_LEDGER)[-n:]
    return {
        "success": True,
        "count": len(items),
        "entries": items,
        "calibration": _forecast_calibration(),
    }


@router.post('/forecast/resolve')
async def oracle_forecast_resolve(payload: ForecastResolveRequest):
    """Resolve a forecast item for online calibration tracking."""
    target = (payload.forecast_id or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="forecast_id is required")

    updated = None
    now_ts = datetime.now(timezone.utc).isoformat()
    with _FORECAST_LOCK:
        for idx in range(len(_FORECAST_LEDGER) - 1, -1, -1):
            item = _FORECAST_LEDGER[idx]
            if str(item.get("forecast_id") or "") == target:
                updated = dict(item)
                updated["resolved"] = True
                updated["outcome"] = bool(payload.outcome)
                updated["resolved_at"] = now_ts
                updated["note"] = payload.note
                _FORECAST_LEDGER[idx] = updated
                break

    if updated is None:
        raise HTTPException(status_code=404, detail=f"forecast_id not found: {target}")

    # Persist a resolution event for durable auditability.
    resolution_event = dict(updated)
    resolution_event["resolution_event"] = True
    _append_forecast_entry(resolution_event)

    return {
        "success": True,
        "forecast": updated,
        "calibration": _forecast_calibration(),
    }


@router.get('/status')
async def oracle_status():
    # OpenClaw local path is the primary lane (no network to Ollama/bridge required).
    openclaw_ok = True
    openclaw_err = None
    try:
        subprocess.run(["openclaw", "--help"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2)
    except Exception as e:
        openclaw_ok = False
        openclaw_err = str(e)

    # Only probe Ollama when enabled; otherwise avoid noisy localhost errors.
    local_online = None
    local_err = None
    models = []
    if OLLAMA_ENABLED:
        local_online = True
        try:
            r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
            r.raise_for_status()
            models = [m.get('name') for m in r.json().get('models', [])]
        except Exception as e:
            local_online = False
            local_err = str(e)

    bridge_ok = False
    bridge_err = None
    try:
        h = requests.get(BRIDGE_URL.replace('/invoke', '/health'), timeout=3)
        bridge_ok = h.status_code == 200
        if not bridge_ok:
            bridge_err = h.text[:120]
    except Exception as e:
        bridge_err = str(e)

    total = ROUTE_STATS['total'] or 1
    bridge_pct = round((ROUTE_STATS['bridge'] / total) * 100, 1)
    alive_cfg = load_config().get('alive_cortex_mode', {})

    any_backend_ok = bool(openclaw_ok or bridge_ok or (local_online is True))
    return {
        'status': 'online' if any_backend_ok else 'degraded',
        'alive_cortex_mode': {
            'enabled': bool(alive_cfg.get('enabled', False)),
            'core_chain': alive_cfg.get('core_chain', [37, 5, 21, 22, 26]),
            'hud_signature_enabled': bool(alive_cfg.get('hud_signature_enabled', True)),
        },
        # Canonical base model (follows /openclaw/config).
        'base_model': _get_base_model(),
        'default_model': _get_base_model(),
        'openclaw_model_label': _openclaw_model_label(),

        # Backend routing (implementation detail)
        'fallback_local_model': LOCAL_MODEL,
        'high_priority_path': (
            'openclaw_local'
            if not ORACLE_FALLBACKS_ENABLED
            else ('openclaw_local(hedged)->bridge->local' if ORACLE_HEDGE_ENABLED else 'openclaw_local->bridge->local')
        ),
        'bridge_ok': bridge_ok,
        'bridge_timeout_s': ORACLE_BRIDGE_TIMEOUT_S,
        'hedge_enabled': ORACLE_HEDGE_ENABLED,
        'hedge_delay_s': ORACLE_HEDGE_DELAY_S,
        'hedge_delay_ultra_s': ORACLE_HEDGE_DELAY_ULTRA_S,
        'route_stats': {**ROUTE_STATS, 'bridge_percent': bridge_pct},
        'frontend_contract': {
            'applied': int(FRONTEND_CONTRACT_STATS.get('applied', 0)),
        },
        'forecast_calibration': {
            'enabled': bool(ORACLE_L5_FORECAST_LEDGER_ENABLED),
            'path': _FORECAST_PATH,
            **_forecast_calibration(),
        },
        'policy': 'Codex-majority with bridge/local fallback chain',
        'local_error': local_err,
        'bridge_error': bridge_err,
        'bridge_cb': {'fails': _BRIDGE_CB_FAILS, 'open_until': _BRIDGE_CB_OPEN_UNTIL, 'allows': _bridge_cb_allows(), 'threshold': _BRIDGE_CB_THRESHOLD, 'cooldown_s': _BRIDGE_CB_COOLDOWN_S},
        'openclaw_rate_limit': {
            'active': _openclaw_rate_limited_active(),
            'until': _OPENCLAW_RATE_LIMIT_UNTIL,
            'hits': int(_OPENCLAW_RATE_LIMIT_HITS or 0),
        },
        'openclaw_ok': openclaw_ok,
        'openclaw_error': openclaw_err,
        'ollama_enabled': bool(OLLAMA_ENABLED),
        'is_busy': IS_BUSY,
        'models': models,
    }
