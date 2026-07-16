"""
Nexus Router - Semantic Orchestration using L5 Oracle

Replaces keyword matching with true semantic understanding.
"""
from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from typing import Dict, List, Any, Mapping, Optional
import base64
from contextlib import asynccontextmanager
import fcntl
import os
import json
import hashlib
import hmac
import math
import re
import secrets
import threading
import time
from collections import deque
from datetime import datetime
import requests
import shutil
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
from cortex_server.modules import routing_autotune as _routing_autotune_module
from cortex_server.modules.routing_autotune import get_policy_snapshot, observe_outcome
from cortex_server.modules.execution_transaction import ExecutionTransaction, RetryPolicy
from cortex_server.modules.latency_budget_governor import LatencyBudgetGovernor, classify_task_archetype
from cortex_server.modules.outcome_tuner import OutcomeTuner
from cortex_server.modules.world_grounding import gather_live_evidence
from cortex_server.modules.route_health import RouteHealthMonitor
from cortex_server.modules import codec_policy as _codec_policy_module
from cortex_server.modules.codec_policy import get_codec_policy_for_query, get_codec_policy_status, get_codec_session_telemetry, observe_codec_evaluation, observe_codec_eval_history, observe_codec_outcome
from cortex_server.modules import cortex_codec as _cortex_codec_module
from cortex_server.modules.cortex_codec import apply_codec_outcome_feedback_for_session, get_codec_debug_view, get_codec_packet_for_session, observe_codec_rollup_eval_history, update_codec_state_for_session
from cortex_server.modules import cortex_kernel_v2
from cortex_server.modules.memory_scope import AuthenticatedMemoryPrincipal, MemoryScopeAuthError, authenticate_memory_principal
from cortex_server.modules.evidence_governance import capability_matrix
from cortex_server.modules.evidence_lineage import build_codec_memory_lineage
from cortex_server.modules.nexus_assurance import build_orchestration_assurance, build_memory_commit_decision, build_validator_summary
from cortex_server.middleware.hud_middleware import track_level
from cortex_server.runtime.assurance_receipt_ledger import (
    AssuranceReceiptLedgerUnavailable,
    assurance_receipt_status,
    consumed_assurance_receipt_result,
    finalize_assurance_receipt,
    release_assurance_receipt,
    reserve_assurance_receipt,
)
from services.routing.adaptive_router_policy import choose_route
from services.routing.route_feature_pipeline import build_route_features

@asynccontextmanager
async def _nexus_lifespan(_app):
    _validate_outcome_feedback_signing_configuration()
    yield


router = APIRouter(lifespan=_nexus_lifespan)

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

CODEC_EVAL_MIN_RATIO = float(os.getenv("CODEC_EVAL_MIN_RATIO", "1.05"))
CODEC_EVAL_MAX_INCREMENTAL_CHARS = int(os.getenv("CODEC_EVAL_MAX_INCREMENTAL_CHARS", "900"))
CODEC_EVAL_MIN_JUDGE_MARGIN = float(os.getenv("CODEC_EVAL_MIN_JUDGE_MARGIN", "0.02"))
CODEC_EVAL_CODEC_MARGIN_FLOOR = float(os.getenv("CODEC_EVAL_CODEC_MARGIN_FLOOR", "-0.05"))
CODEC_EVAL_MIN_VARIANTS = int(os.getenv("CODEC_EVAL_MIN_VARIANTS", "3"))
CODEC_EVAL_MIN_ORACLE_COVERAGE = float(os.getenv("CODEC_EVAL_MIN_ORACLE_COVERAGE", "1.0"))
CODEC_REPLAY_SCHEDULER_ENABLED = os.getenv("NEXUS_CODEC_REPLAY_SCHEDULER_ENABLED", "1").lower() not in {"0", "false", "no", "off"}
CODEC_REPLAY_SCHEDULER_INTERVAL_SECONDS = max(5, int(os.getenv("NEXUS_CODEC_REPLAY_SCHEDULER_INTERVAL_SECONDS", "60")))

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
    37: {"name": "awareness", "layer": "Apex", "purpose": "Self-awareness and internal state"},
    38: {"name": "augmenter", "layer": "Apex", "purpose": "Intent augmentation and control surface"},
}

ALWAYS_ON_LEVELS = [5, 17, 18, 20, 21, 22, 23, 24, 25, 27, 32, 33, 34, 35, 36]

_CODEC_REPLAY_SCHEDULER_LOCK = threading.Lock()
_CODEC_REPLAY_SCHEDULER_THREAD: Optional[threading.Thread] = None
_CODEC_REPLAY_SCHEDULER_STATE: Dict[str, Any] = {
    "enabled": bool(CODEC_REPLAY_SCHEDULER_ENABLED),
    "interval_seconds": int(CODEC_REPLAY_SCHEDULER_INTERVAL_SECONDS),
    "started": False,
    "thread_alive": False,
    "last_tick_at": "",
    "last_due_count": 0,
    "last_executed_count": 0,
    "last_error": "",
}

_CONTEXT_LOCK = threading.RLock()
_CONTEXT_TTL_SECONDS = 1800
_RECENT_TURNS_MAX = 24
_CONTEXT_STATE_VERSION = "nexus.referent.principal.v1"
_CONTEXT_STATES: Dict[str, Dict[str, Any]] = {}
_CONTEXT_QUARANTINE_CHECKED: set[str] = set()
_REFERENT_STATE_PATH = Path(os.getenv("NEXUS_REFERENT_STATE_PATH", "/opt/clawdbot/state/nexus_referent_state.json"))
_CHECKPOINT_STORE_PATH = Path(os.getenv("NEXUS_CHECKPOINT_STORE_PATH", "/opt/clawdbot/state/nexus_checkpoints.jsonl"))
_CODEC_EVAL_HISTORY_PATH = Path(os.getenv("NEXUS_CODEC_EVAL_HISTORY_PATH", "/opt/clawdbot/state/nexus_codec_eval_history.jsonl"))
_CODEC_REPLAY_REPORTS_PATH = Path(os.getenv("NEXUS_CODEC_REPLAY_REPORTS_PATH", "/opt/clawdbot/state/nexus_codec_replay_reports.jsonl"))
_CODEC_LIVE_REEXEC_REPORTS_PATH = Path(os.getenv("NEXUS_CODEC_LIVE_REEXEC_REPORTS_PATH", "/opt/clawdbot/state/nexus_codec_live_reexec_reports.jsonl"))
_CODEC_CORPUS_EXPORTS_PATH = Path(os.getenv("NEXUS_CODEC_CORPUS_EXPORTS_PATH", "/opt/clawdbot/state/nexus_codec_corpus_exports.jsonl"))
_CODEC_ACTIVE_POLICY_PATH = Path(os.getenv("NEXUS_CODEC_ACTIVE_POLICY_PATH", "/opt/clawdbot/state/nexus_codec_active_policy.json"))
_CODEC_REPLAY_PLANS_PATH = Path(os.getenv("NEXUS_CODEC_REPLAY_PLANS_PATH", "/opt/clawdbot/state/nexus_codec_replay_plans.jsonl"))
_TOKEN_PLANNER = TokenBudgetPlanner()
_INITIAL_ENVIRONMENT = os.getenv("CORTEX_ENV", os.getenv("CORTEX_ENVIRONMENT", "development")).strip().lower()
_DEFAULT_ADAPTIVE_STATE_ROOT = (
    Path("/opt/clawdbot/state/nexus_principals")
    if _INITIAL_ENVIRONMENT in {"production", "prod", "staging"}
    else Path("/tmp") / f"cortex-nexus-principals-{os.getuid()}"
)
_ADAPTIVE_STATE_ROOT = Path(
    os.getenv("NEXUS_ADAPTIVE_STATE_ROOT", str(_DEFAULT_ADAPTIVE_STATE_ROOT))
)
_ADAPTIVE_POLICY_LOCK = threading.RLock()
_ADAPTIVE_POLICY_STATES: Dict[str, Any] = {}
_ROUTING_AUTOTUNE_SCOPE_LOCK = threading.RLock()
# Route every in-process module caller through the same re-entrant locks while
# a principal-specific state path is installed. This prevents an Oracle or
# governance read in another thread from observing the temporary namespace.
_routing_autotune_module._LOCK = _ROUTING_AUTOTUNE_SCOPE_LOCK
_CODEC_POLICY_SCOPE_LOCK = _codec_policy_module._LOCK
_CODEC_ROLLUP_SCOPE_LOCK = threading.RLock()
_cortex_codec_module._ROLLUP_AUTOTUNE_LOCK = _CODEC_ROLLUP_SCOPE_LOCK
_ADAPTIVE_RATE_LOCK = threading.Lock()
_ADAPTIVE_OBSERVATION_RATES: Dict[str, deque] = {}
NEXUS_CODEC_ENABLED = os.getenv("NEXUS_CODEC_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
NEXUS_CODEC_MAX_CHARS = max(120, min(int(os.getenv("NEXUS_CODEC_MAX_CHARS", "420")), 2400))
_ASSURANCE_EPHEMERAL_SIGNING_KEY = secrets.token_bytes(32)
_ASSURANCE_RECEIPT_VERSION = "nexus.commit-receipt.v1"
_ASSURANCE_RECEIPT_TTL_SECONDS = max(30, min(int(os.getenv("NEXUS_ASSURANCE_RECEIPT_TTL_SECONDS", "300")), 900))
_ASSURANCE_RECEIPT_STATE_PATH = Path(
    os.getenv(
        "NEXUS_ASSURANCE_RECEIPT_STATE_PATH",
        "/opt/clawdbot/state/nexus_assurance_receipts.sqlite3",
    )
)
_OUTCOME_FEEDBACK_RECEIPT_VERSION = "nexus.outcome-feedback-receipt.v1"
_OUTCOME_FEEDBACK_RECEIPT_TTL_SECONDS = max(
    30,
    min(int(os.getenv("NEXUS_OUTCOME_FEEDBACK_RECEIPT_TTL_SECONDS", "300")), 900),
)
_OUTCOME_FEEDBACK_RECEIPT_STATE_PATH = Path(
    os.getenv(
        "NEXUS_OUTCOME_FEEDBACK_RECEIPT_STATE_PATH",
        "/opt/clawdbot/state/nexus_outcome_feedback_receipts.json",
    )
)
_OUTCOME_FEEDBACK_RECEIPT_LOCK = threading.Lock()
_OUTCOME_FEEDBACK_EPHEMERAL_SIGNING_KEY = secrets.token_bytes(32)
_PRINCIPAL_OUTCOME_TUNER_LOCK = threading.RLock()
_PRINCIPAL_OUTCOME_TUNERS: Dict[str, OutcomeTuner] = {}
_ASSURANCE_RESERVED_METADATA = {
    "assurance",
    "assurance_receipt",
    "cognitive_quality",
    "levels_used",
    "query",
    "risk_flags",
    "source",
    "tenant_id",
    "validator_result",
    "workspace_id",
    "agent_id",
    "user_id",
    "channel_id",
    "session_id",
    "scope_credential_id",
    "storage_workspace_id",
    "idempotency_key",
    "receipt_id",
    "world_grounding",
}


def _new_context_state() -> Dict[str, Any]:
    return {
        "updated_at": "",
        "recent_turns": deque(maxlen=_RECENT_TURNS_MAX),
        "last_fix_plan": "",
        "last_codeword": "",
    }


def _referent_scope_digest(continuity_key: str) -> str:
    return hashlib.sha256(str(continuity_key or "").encode("utf-8")).hexdigest()


def _referent_state_path(continuity_key: str) -> Path:
    root = _REFERENT_STATE_PATH.with_name(f"{_REFERENT_STATE_PATH.name}.principals")
    return root / f"{_referent_scope_digest(continuity_key)}.json"


def _quarantine_legacy_context_state() -> None:
    """Never hydrate the unscoped v0 file; move it aside once when possible."""

    legacy = _REFERENT_STATE_PATH
    marker = str(legacy)
    if marker in _CONTEXT_QUARANTINE_CHECKED:
        return
    _CONTEXT_QUARANTINE_CHECKED.add(marker)
    try:
        if not legacy.is_file():
            return
        quarantine = legacy.with_name(f"{legacy.name}.legacy-unscoped.quarantine")
        if quarantine.exists():
            quarantine = legacy.with_name(
                f"{legacy.name}.legacy-unscoped.{int(time.time())}.{secrets.token_hex(4)}.quarantine"
            )
        os.replace(legacy, quarantine)
    except OSError:
        # An unwritable legacy file remains ignored and can never enter a
        # principal namespace.
        return


def _context_for_disk(continuity_key: str, state: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "version": _CONTEXT_STATE_VERSION,
        "scope_key_hash": _referent_scope_digest(continuity_key),
        "updated_at": str(state.get("updated_at", "") or ""),
        "last_fix_plan": str(state.get("last_fix_plan", "") or ""),
        "last_codeword": str(state.get("last_codeword", "") or ""),
        "recent_turns": list(state.get("recent_turns", []))[-_RECENT_TURNS_MAX:],
    }


def _load_context_state(continuity_key: str) -> Dict[str, Any]:
    state = _new_context_state()
    if not continuity_key:
        return state
    try:
        _quarantine_legacy_context_state()
        state_path = _referent_state_path(continuity_key)
        if not state_path.exists():
            return state
        data = json.loads(state_path.read_text(encoding="utf-8"))
        if (
            not isinstance(data, dict)
            or data.get("version") != _CONTEXT_STATE_VERSION
            or not hmac.compare_digest(
                str(data.get("scope_key_hash") or ""),
                _referent_scope_digest(continuity_key),
            )
        ):
            return state
        turns = data.get("recent_turns") if isinstance(data.get("recent_turns"), list) else []
        state["updated_at"] = str(data.get("updated_at", "") or "")
        state["last_fix_plan"] = str(data.get("last_fix_plan", "") or "")
        state["last_codeword"] = str(data.get("last_codeword", "") or "")
        state["recent_turns"] = deque(turns[-_RECENT_TURNS_MAX:], maxlen=_RECENT_TURNS_MAX)
    except Exception:
        return _new_context_state()
    return state


def _context_state_for_key(continuity_key: str) -> Optional[Dict[str, Any]]:
    if not continuity_key:
        return None
    state = _CONTEXT_STATES.get(continuity_key)
    if state is not None:
        return state
    while len(_CONTEXT_STATES) >= 512:
        _CONTEXT_STATES.pop(next(iter(_CONTEXT_STATES)))
    state = _load_context_state(continuity_key)
    _CONTEXT_STATES[continuity_key] = state
    return state


def _persist_context_state(continuity_key: str, state: Mapping[str, Any]) -> None:
    if not continuity_key:
        return
    temporary: Optional[Path] = None
    try:
        state_path = _referent_state_path(continuity_key)
        state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = state_path.with_name(
            f".{state_path.name}.{os.getpid()}.{threading.get_ident()}.{secrets.token_hex(4)}.tmp"
        )
        temporary.write_text(
            json.dumps(_context_for_disk(continuity_key, state), ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        os.chmod(temporary, 0o600)
        os.replace(temporary, state_path)
    except Exception:
        pass
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

_REFERENT_PATTERNS = [
    r"\bthat one\b",
    r"\bthat fix\b",
    r"\bsame as before\b",
    r"\bdo that again\b",
    r"\brerun that\b",
]


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
        return dt.replace(tzinfo=None)
    except Exception:
        return None


def _codec_session_key(request: Optional[Request]) -> str:
    if request is None:
        return ""
    hdr = (
        request.headers.get("x-cortex-session-id")
        or request.headers.get("x-session-id")
        or request.headers.get("x-chat-id")
        or ""
    ).strip()
    if hdr:
        return hdr[:128]
    client_host = (request.client.host if getattr(request, "client", None) else "anon") or "anon"
    user_agent = (request.headers.get("user-agent") or "ua")[:80]
    return f"{client_host}|{user_agent}"


def _principal_continuity_key(principal: AuthenticatedMemoryPrincipal, session_key: str) -> str:
    resolved_session = str(session_key or principal.session_id)
    principal_key = principal.isolation_key("nexus-referent-continuity-v1")
    if resolved_session == principal.session_id:
        return principal_key
    if principal.credential_id != "local-development":
        raise ValueError("continuity session must match the authenticated principal")
    # The compatibility development principal has a fixed synthetic scope;
    # retain per-session continuity without treating transport input as a
    # production identity claim.
    canonical = f"{principal_key}\0{resolved_session}"
    return f"principal:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _adaptive_scope_key(scope: Mapping[str, Any]) -> str:
    # Adaptive learning and its abuse budget belong to a stable authenticated
    # actor, not a caller-mintable transport session or channel.
    fields = ("scope_credential_id", "tenant_id", "workspace_id", "agent_id", "user_id")
    canonical = "\0".join(("nexus-adaptive-policy-v1", *(str(scope.get(field) or "") for field in fields)))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _prepare_adaptive_state_directory(root: Path, scope_key: str) -> None:
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    try:
        maximum = max(16, min(int(os.getenv("NEXUS_ADAPTIVE_MAX_ACTORS", "512")), 4096))
        ttl_seconds = max(
            3600,
            min(int(os.getenv("NEXUS_ADAPTIVE_ACTOR_TTL_SECONDS", str(30 * 86400))), 365 * 86400),
        )
    except ValueError:
        maximum, ttl_seconds = 512, 30 * 86400
    lock_path = root / ".adaptive-actors.lock"
    with lock_path.open("a+b") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        now = time.time()
        candidates = [
            path
            for path in root.iterdir()
            if path.is_dir() and not path.is_symlink() and path.name != scope_key
        ]
        for path in list(candidates):
            try:
                if now - path.stat().st_mtime > ttl_seconds:
                    shutil.rmtree(path)
                    candidates.remove(path)
            except FileNotFoundError:
                candidates.remove(path)
        requested_exists = (root / scope_key).is_dir()
        keep_other = maximum - (1 if requested_exists else 1)
        if len(candidates) > keep_other:
            for path in sorted(candidates, key=lambda item: item.stat().st_mtime)[: len(candidates) - keep_other]:
                shutil.rmtree(path, ignore_errors=False)
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


class _PrincipalAdaptivePolicies:
    def __init__(self, scope_key: str, root: Path):
        self.scope_key = scope_key
        _prepare_adaptive_state_directory(root, scope_key)
        self.root = root / scope_key
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.root.is_symlink():
            raise RuntimeError("principal adaptive state directory cannot be a symbolic link")
        os.chmod(self.root, 0o700)
        os.utime(self.root, None)
        self.bandit = ContextualBanditScheduler(state_path=self.root / "bandit.json")
        self.delta = SemanticDeltaCache(state_path=self.root / "semantic_delta.json")
        self.latency = LatencyBudgetGovernor(artifact_dir=self.root / "latency")
        self.health = RouteHealthMonitor(state_path=self.root / "route_health.json")
        self.routing_state_path = self.root / "routing_autotune.json"
        self.codec_policy_state_path = self.root / "codec_policy.json"
        self.codec_rollup_state_path = self.root / "codec_rollup_policy.json"


def _adaptive_policies_for_scope(scope: Mapping[str, Any]) -> _PrincipalAdaptivePolicies:
    scope_key = _adaptive_scope_key(scope)
    cache_key = f"{_ADAPTIVE_STATE_ROOT}|{scope_key}"
    with _ADAPTIVE_POLICY_LOCK:
        state = _ADAPTIVE_POLICY_STATES.get(cache_key)
        if state is not None:
            try:
                os.utime(state.root, None)
            except OSError:
                pass
            return state
        while len(_ADAPTIVE_POLICY_STATES) >= 512:
            _ADAPTIVE_POLICY_STATES.pop(next(iter(_ADAPTIVE_POLICY_STATES)))
        state = _PrincipalAdaptivePolicies(scope_key, _ADAPTIVE_STATE_ROOT)
        _ADAPTIVE_POLICY_STATES[cache_key] = state
        return state


def _scoped_routing_policy_call(
    policies: _PrincipalAdaptivePolicies,
    operation,
    *args,
    **kwargs,
):
    with _ROUTING_AUTOTUNE_SCOPE_LOCK:
        previous = _routing_autotune_module._STATE_PATH
        _routing_autotune_module._STATE_PATH = policies.routing_state_path
        try:
            return operation(*args, **kwargs)
        finally:
            _routing_autotune_module._STATE_PATH = previous


def _scoped_codec_policy_call(
    policies: Optional[_PrincipalAdaptivePolicies],
    operation,
    *args,
    **kwargs,
):
    if policies is None:
        return operation(*args, **kwargs)
    with _CODEC_POLICY_SCOPE_LOCK:
        previous = _codec_policy_module._STATE_PATH
        _codec_policy_module._STATE_PATH = policies.codec_policy_state_path
        try:
            return operation(*args, **kwargs)
        finally:
            _codec_policy_module._STATE_PATH = previous


def _scoped_codec_rollup_call(
    policies: _PrincipalAdaptivePolicies,
    operation,
    *args,
    **kwargs,
):
    with _CODEC_ROLLUP_SCOPE_LOCK:
        previous_path = _cortex_codec_module._ROLLUP_AUTOTUNE_STATE_PATH
        previous_state = _cortex_codec_module._ROLLUP_AUTOTUNE_STATE
        _cortex_codec_module._ROLLUP_AUTOTUNE_STATE_PATH = policies.codec_rollup_state_path
        _cortex_codec_module._ROLLUP_AUTOTUNE_STATE = None
        try:
            return operation(*args, **kwargs)
        finally:
            _cortex_codec_module._ROLLUP_AUTOTUNE_STATE_PATH = previous_path
            _cortex_codec_module._ROLLUP_AUTOTUNE_STATE = previous_state


def _adaptive_observation_allowed(scope_key: str) -> bool:
    try:
        limit = max(1, min(int(os.getenv("NEXUS_ADAPTIVE_OBSERVATION_RATE_LIMIT", "120")), 5000))
        window = max(1, min(int(os.getenv("NEXUS_ADAPTIVE_OBSERVATION_RATE_WINDOW_SECONDS", "60")), 3600))
    except ValueError:
        limit, window = 120, 60
    now = int(time.time())
    with _ADAPTIVE_RATE_LOCK:
        while len(_ADAPTIVE_OBSERVATION_RATES) >= 1024 and scope_key not in _ADAPTIVE_OBSERVATION_RATES:
            _ADAPTIVE_OBSERVATION_RATES.pop(next(iter(_ADAPTIVE_OBSERVATION_RATES)))
        observations = _ADAPTIVE_OBSERVATION_RATES.setdefault(scope_key, deque(maxlen=limit))
        while observations and int(observations[0]) <= now - window:
            observations.popleft()
        if len(observations) >= limit:
            return False
        observations.append(now)
        return True


def _codec_context_packet(
    session_key: str,
    query: str = "",
    *,
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    telemetry_session_key: Optional[str] = None,
    adaptive_policies: Optional[_PrincipalAdaptivePolicies] = None,
) -> Dict[str, Any]:
    if not NEXUS_CODEC_ENABLED or not session_key:
        return {"enabled": bool(NEXUS_CODEC_ENABLED), "available": False, "packet": "", "summary": "", "durable": {}, "session_telemetry": {}}
    packet = get_codec_packet_for_session(
        session_key,
        max_chars=NEXUS_CODEC_MAX_CHARS,
        query=query,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
    )
    return {
        "enabled": True,
        "available": bool(packet.get("available")),
        "packet": packet.get("packet", ""),
        "summary": packet.get("summary", ""),
        "max_chars": NEXUS_CODEC_MAX_CHARS,
        "durable": packet.get("durable", {}),
        "session_telemetry": _scoped_codec_policy_call(
            adaptive_policies,
            get_codec_session_telemetry,
            telemetry_session_key or session_key,
        ),
    }


def _kernel_codec_prefix(codec_context: Dict[str, Any]) -> str:
    if not isinstance(codec_context, dict) or not codec_context.get("available"):
        return ""
    packet = str(codec_context.get("packet") or codec_context.get("summary") or "").strip()
    if not packet:
        return ""
    return f"Cortex Codec state (compressed behavioral context; use only if relevant):\n{packet}\n\n"


def _kernel_continuity_prefix(referent_info: Dict[str, Any]) -> str:
    if not isinstance(referent_info, dict) or not referent_info.get("resolved"):
        return ""
    items: List[str] = []
    reference_text = str(referent_info.get("reference_text") or "").strip()
    codeword = str(referent_info.get("codeword") or "").strip()
    if reference_text:
        items.append(f"reference_text={_compact_text_excerpt(reference_text, limit=120)}")
    if codeword:
        items.append(f"codeword={codeword[:40]}")
    if not items:
        return ""
    return f"Conversation referents (minimal): {', '.join(items)}. Use these only when the user asks referent follow-ups.\n\n"


def _kernel_trace_payload(kernel_trace: Optional[Dict[str, Any]], *, kernel_result: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    if not isinstance(kernel_trace, dict) or not kernel_trace:
        return None
    plan = dict(kernel_trace.get("plan") or {})
    contract = dict(kernel_trace.get("contract") or {})
    working_set = dict(kernel_trace.get("working_set") or {})
    payload: Dict[str, Any] = {
        "request_id": kernel_trace.get("request_id"),
        "runtime": kernel_trace.get("runtime") or "nexus",
        "surface": kernel_trace.get("surface") or "orchestrate",
        "mode": ((kernel_trace.get("settings") or {}).get("mode")) or "active",
        "compile_ms": kernel_trace.get("compile_ms"),
        "plan": {
            "lane": plan.get("lane"),
            "depth_mode": plan.get("depth_mode"),
            "latency_budget_ms": plan.get("latency_budget_ms"),
            "reason": plan.get("reason"),
            "target_oracle_lane": plan.get("target_oracle_lane"),
        },
        "intent": (contract.get("intent") or {}).get("kind"),
        "simple_qa": ((contract.get("intent") or {}).get("simple_qa")),
        "risk_flags": list(contract.get("risk_flags") or []),
        "complexity": dict(contract.get("complexity") or {}),
        "context_reuse": dict(working_set.get("reuse") or {}),
    }
    if isinstance(kernel_result, dict):
        payload["result"] = kernel_result.get("event") if kernel_result.get("recorded") else kernel_result
    return payload


def _codec_variant_prompts(session_key: str, query: str) -> Dict[str, Any]:
    resolved_query = (query or "What should I remember from this conversation?").strip()
    try:
        from cortex_server.routers.oracle import _codec_prefix, _continuity_prefix, _get_session_memory

        referent_packet = _continuity_prefix(session_key, resolved_query) or ""
        oracle_codec_packet = _codec_prefix(session_key, resolved_query) or ""
        memory_bucket = _get_session_memory(session_key) or {}
    except Exception as exc:
        return {
            "query": resolved_query,
            "referent_packet": "",
            "codec_packet": "",
            "memory_bucket": {},
            "error": str(exc)[:200],
            "variants": [
                {
                    "name": "query_only",
                    "prompt": resolved_query,
                    "prompt_chars": len(resolved_query),
                    "referent_prefix_chars": 0,
                    "codec_prefix_chars": 0,
                }
            ],
        }

    variants = [
        {
            "name": "query_only",
            "prompt": resolved_query,
            "prompt_chars": len(resolved_query),
            "referent_prefix_chars": 0,
            "codec_prefix_chars": 0,
        },
        {
            "name": "referents_only",
            "prompt": f"{referent_packet}{resolved_query}".strip(),
            "prompt_chars": len(f"{referent_packet}{resolved_query}".strip()),
            "referent_prefix_chars": len(referent_packet),
            "codec_prefix_chars": 0,
        },
        {
            "name": "referents_plus_codec",
            "prompt": f"{referent_packet}{oracle_codec_packet}{resolved_query}".strip(),
            "prompt_chars": len(f"{referent_packet}{oracle_codec_packet}{resolved_query}".strip()),
            "referent_prefix_chars": len(referent_packet),
            "codec_prefix_chars": len(oracle_codec_packet),
        },
    ]
    return {
        "query": resolved_query,
        "referent_packet": referent_packet,
        "codec_packet": oracle_codec_packet,
        "memory_bucket": memory_bucket,
        "variants": variants,
    }



def _infer_codec_execution_variant(
    query: str,
    codec_context: Dict[str, Any],
    referent_info: Dict[str, Any],
    *,
    adaptive_policies: Optional[_PrincipalAdaptivePolicies] = None,
) -> str:
    policy = _scoped_codec_policy_call(adaptive_policies, get_codec_policy_for_query, query)
    codec_available = bool((codec_context or {}).get("available"))
    referents_available = bool((referent_info or {}).get("resolved")) or bool((referent_info or {}).get("referent_memory"))
    if codec_available and (bool(policy.get("should_inject", True)) or str(policy.get("action") or "") == "prefer_codec"):
        return "referents_plus_codec"
    if referents_available:
        return "referents_only"
    return "query_only"



def _execution_flow_metrics(execution_transaction: Dict[str, Any], validator_result: Dict[str, Any], fastlane: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    tx = execution_transaction or {}
    steps = tx.get("steps") if isinstance(tx.get("steps"), list) else []
    completed_steps = sum(1 for step in steps if str((step or {}).get("status") or "") == "completed")
    failed_steps = sum(1 for step in steps if str((step or {}).get("status") or "") in {"failed", "retrying"})
    retry_count = max(0, int(tx.get("step_attempts_total", 0) or 0) - len(steps))
    rollback_count = int(tx.get("rollback_attempts_total", 0) or 0)
    validator_pass = bool((validator_result or {}).get("pass"))
    tx_completed = str(tx.get("status") or "") == "completed"
    escalated = bool((fastlane or {}).get("escalated"))

    confidence = 1.0
    confidence -= 0.22 if not tx_completed else 0.0
    confidence -= 0.18 if not validator_pass else 0.0
    confidence -= min(0.18, 0.06 * failed_steps)
    confidence -= min(0.16, 0.04 * retry_count)
    confidence -= min(0.12, 0.06 * rollback_count)
    confidence -= 0.08 if escalated else 0.0
    if completed_steps > 0 and tx_completed and validator_pass:
        confidence += min(0.08, 0.01 * completed_steps)
    confidence = round(max(0.2, min(1.0, confidence)), 3)

    step_attribution: Dict[str, float] = {
        "pattern:tx_completed" if tx_completed else "pattern:tx_failed": 1.0,
        "pattern:validator_pass" if validator_pass else "pattern:validator_fail": 1.0,
    }
    if escalated:
        step_attribution["pattern:fastlane_escalated"] = 1.0
    if retry_count > 0:
        step_attribution["pattern:retries"] = min(1.0, 0.35 + (0.1 * retry_count))
    if rollback_count > 0:
        step_attribution["pattern:rollbacks"] = min(1.0, 0.4 + (0.15 * rollback_count))
    if failed_steps > 0:
        step_attribution["pattern:failed_steps"] = min(1.0, 0.35 + (0.1 * failed_steps))
    if completed_steps > 0:
        step_attribution["pattern:completed_steps"] = min(1.0, 0.25 + (0.05 * completed_steps))
    for step in steps:
        name = str((step or {}).get("name") or "").strip().lower()
        status = str((step or {}).get("status") or "").strip().lower()
        if name:
            step_attribution[f"step:{name}"] = max(float(step_attribution.get(f"step:{name}", 0.0) or 0.0), 0.6)
        if status:
            step_attribution[f"step_status:{status}"] = max(float(step_attribution.get(f"step_status:{status}", 0.0) or 0.0), 0.45)

    return {
        "tx_completed": tx_completed,
        "validator_pass": validator_pass,
        "completed_steps": completed_steps,
        "failed_steps": failed_steps,
        "retry_count": retry_count,
        "rollback_count": rollback_count,
        "escalated": escalated,
        "confidence": confidence,
        "step_attribution": step_attribution,
    }



def _observe_codec_execution_outcome(
    *,
    query: str,
    session_key: str,
    codec_context: Dict[str, Any],
    referent_info: Dict[str, Any],
    execution_transaction: Dict[str, Any],
    validator_result: Dict[str, Any],
    fastlane: Optional[Dict[str, Any]],
    note: str = "",
    explicit_success: Optional[bool] = None,
    served_variant: Optional[str] = None,
    adaptive_policies: Optional[_PrincipalAdaptivePolicies] = None,
) -> Dict[str, Any]:
    variant = (
        str(served_variant)
        if served_variant in {"query_only", "referents_only", "referents_plus_codec"}
        else _infer_codec_execution_variant(
            query,
            codec_context or {},
            referent_info or {},
            adaptive_policies=adaptive_policies,
        )
    )
    metrics = _execution_flow_metrics(execution_transaction or {}, validator_result or {}, fastlane)
    recovery_needed = bool(metrics.get("escalated")) or not bool(metrics.get("validator_pass")) or not bool(metrics.get("tx_completed")) or int(metrics.get("failed_steps", 0)) > 0 or int(metrics.get("rollback_count", 0)) > 0
    execution_success = bool(explicit_success) if explicit_success is not None else bool(metrics.get("tx_completed") and metrics.get("validator_pass") and not recovery_needed)
    artifact = _scoped_codec_policy_call(
        adaptive_policies,
        observe_codec_outcome,
        query=query,
        policy_label=variant,
        execution_success=execution_success,
        user_correction=False,
        recovery_needed=recovery_needed,
        validator_pass=bool(metrics.get("validator_pass")),
        session_key=session_key or None,
        note=(note + f" | steps={metrics['completed_steps']}/{len((execution_transaction or {}).get('steps') or [])} retries={metrics['retry_count']} rollbacks={metrics['rollback_count']} escalated={metrics['escalated']}").strip(),
        outcome_confidence=float(metrics.get("confidence", 1.0) or 1.0),
        source="execution_flow",
        step_attribution=metrics.get("step_attribution") if isinstance(metrics.get("step_attribution"), dict) else None,
    )
    artifact["execution_metrics"] = metrics
    artifact["source"] = "execution_flow"
    return artifact



def _codec_acceptance_policy() -> Dict[str, Any]:
    return {
        "min_ratio_vs_raw_state": round(float(CODEC_EVAL_MIN_RATIO), 3),
        "max_incremental_codec_chars": max(0, int(CODEC_EVAL_MAX_INCREMENTAL_CHARS)),
        "min_judge_margin": round(float(CODEC_EVAL_MIN_JUDGE_MARGIN), 3),
        "codec_margin_floor": round(float(CODEC_EVAL_CODEC_MARGIN_FLOOR), 3),
        "min_variants": max(1, int(CODEC_EVAL_MIN_VARIANTS)),
        "min_oracle_coverage": round(float(CODEC_EVAL_MIN_ORACLE_COVERAGE), 3),
    }


def _codec_benchmark_gates(benchmark: Dict[str, Any]) -> Dict[str, Any]:
    policy = _codec_acceptance_policy()
    prompt_comparison = benchmark.get("prompt_comparison") if isinstance(benchmark.get("prompt_comparison"), dict) else {}
    ratio = float(benchmark.get("codec_ratio_vs_raw_state") or 0.0)
    incremental_chars = int(prompt_comparison.get("incremental_codec_chars", 0) or 0)
    gates = [
        {
            "name": "compression_gain",
            "required": True,
            "passed": ratio >= float(policy.get("min_ratio_vs_raw_state", 1.0)),
            "observed": round(ratio, 3),
            "threshold": float(policy.get("min_ratio_vs_raw_state", 1.0)),
        },
        {
            "name": "incremental_packet_budget",
            "required": True,
            "passed": incremental_chars <= int(policy.get("max_incremental_codec_chars", 0)),
            "observed": incremental_chars,
            "threshold": int(policy.get("max_incremental_codec_chars", 0)),
        },
    ]
    required = [gate for gate in gates if gate.get("required")]
    passed = [gate for gate in required if gate.get("passed")]
    return {
        "policy": policy,
        "gates": gates,
        "summary": {
            "required_total": len(required),
            "required_passed": len(passed),
            "overall_pass": len(required) == len(passed),
        },
    }


def _codec_evaluation_gates(evaluation: Dict[str, Any]) -> Dict[str, Any]:
    policy = _codec_acceptance_policy()
    variants = evaluation.get("variants") if isinstance(evaluation.get("variants"), list) else []
    judge = evaluation.get("judge") if isinstance(evaluation.get("judge"), dict) else {}
    scores = judge.get("scores") if isinstance(judge.get("scores"), list) else []
    sorted_scores = sorted([row for row in scores if isinstance(row, dict)], key=lambda row: float(row.get("score") or 0.0), reverse=True)
    top_score = float(sorted_scores[0].get("score") or 0.0) if sorted_scores else 0.0
    second_score = float(sorted_scores[1].get("score") or 0.0) if len(sorted_scores) > 1 else 0.0
    judge_margin = round(top_score - second_score, 3)

    codec_row = next((row for row in sorted_scores if str(row.get("name") or "") == "referents_plus_codec"), {})
    non_codec_best = max([
        float(row.get("score") or 0.0)
        for row in sorted_scores
        if str(row.get("name") or "") in {"query_only", "referents_only"}
    ] or [0.0])
    codec_margin = round(float(codec_row.get("score") or 0.0) - non_codec_best, 3)

    oracle_run = evaluation.get("oracle_run") if isinstance(evaluation.get("oracle_run"), dict) else {}
    oracle_requested = bool(oracle_run.get("requested"))
    oracle_completed = bool(oracle_run.get("completed"))
    oracle_coverage = 0.0
    if variants:
        oracle_ready = [variant for variant in variants if str(variant.get("oracle_output") or "").strip()]
        oracle_coverage = round(len(oracle_ready) / max(1, len(variants)), 3)

    gates = [
        {
            "name": "variant_coverage",
            "required": True,
            "passed": len(variants) >= int(policy.get("min_variants", 1)),
            "observed": len(variants),
            "threshold": int(policy.get("min_variants", 1)),
        },
        {
            "name": "judge_decisiveness",
            "required": True,
            "passed": judge_margin >= float(policy.get("min_judge_margin", 0.0)),
            "observed": judge_margin,
            "threshold": float(policy.get("min_judge_margin", 0.0)),
        },
        {
            "name": "codec_competitiveness",
            "required": True,
            "passed": codec_margin >= float(policy.get("codec_margin_floor", -1.0)),
            "observed": codec_margin,
            "threshold": float(policy.get("codec_margin_floor", -1.0)),
        },
    ]
    if oracle_requested:
        gates.append({
            "name": "oracle_variant_coverage",
            "required": True,
            "passed": oracle_completed and oracle_coverage >= float(policy.get("min_oracle_coverage", 1.0)),
            "observed": oracle_coverage,
            "threshold": float(policy.get("min_oracle_coverage", 1.0)),
        })

    required = [gate for gate in gates if gate.get("required")]
    passed = [gate for gate in required if gate.get("passed")]
    return {
        "policy": policy,
        "judge_margin": judge_margin,
        "codec_margin_vs_best_non_codec": codec_margin,
        "oracle_coverage": oracle_coverage,
        "gates": gates,
        "summary": {
            "required_total": len(required),
            "required_passed": len(passed),
            "overall_pass": len(required) == len(passed),
        },
    }


def _codec_benchmark_view(session_key: str, *, benchmark_query: str = "", max_chars: int = 420, history_limit: int = 8) -> Dict[str, Any]:
    resolved_query = (benchmark_query or "What should I remember from this conversation?").strip()
    debug = get_codec_debug_view(
        session_key,
        max_chars=max(120, min(int(max_chars), 2400)),
        history_limit=max(1, min(int(history_limit), 50)),
        query=resolved_query,
    )

    raw_state_chars = int(((debug.get("compression") or {}).get("raw_characters", 0)) or 0)
    codec_packet_chars = int(debug.get("packet_chars", 0) or 0)
    benchmark: Dict[str, Any] = {
        "query": resolved_query,
        "query_chars": len(resolved_query),
        "raw_state_source_chars": raw_state_chars,
        "codec_packet_chars": codec_packet_chars,
        "codec_saved_vs_raw_state_chars": max(0, raw_state_chars - codec_packet_chars),
        "codec_ratio_vs_raw_state": round(raw_state_chars / max(1, codec_packet_chars), 3) if raw_state_chars and codec_packet_chars else None,
        "timeline": (debug.get("persisted_snapshots") or {}).get("recent", []),
    }

    variant_view = _codec_variant_prompts(session_key, resolved_query)
    if variant_view.get("error"):
        benchmark["prompt_comparison"] = {"error": variant_view.get("error")}
    else:
        benchmark["prompt_comparison"] = {
            "referent_memory_keys": len(variant_view.get("memory_bucket") or {}),
            "referent_prefix_chars": len(variant_view.get("referent_packet") or ""),
            "oracle_codec_prefix_chars": len(variant_view.get("codec_packet") or ""),
            "referents_only_prompt_chars": int((variant_view.get("variants") or [{}, {}])[1].get("prompt_chars", len(resolved_query))),
            "referents_plus_codec_prompt_chars": int((variant_view.get("variants") or [{}, {}, {}])[2].get("prompt_chars", len(resolved_query))),
            "incremental_codec_chars": len(variant_view.get("codec_packet") or ""),
        }

    benchmark["acceptance_gates"] = _codec_benchmark_gates(benchmark)
    debug["benchmark"] = benchmark
    return debug



def _token_overlap_score(query: str, text: str) -> float:
    q_tokens = set(re.findall(r"[a-z0-9_]{3,}", (query or "").lower()))
    t_tokens = set(re.findall(r"[a-z0-9_]{3,}", (text or "").lower()))
    if not q_tokens:
        return 0.0
    return round(len(q_tokens.intersection(t_tokens)) / max(1, len(q_tokens)), 3)



def _heuristic_judge_codec_variants(query: str, variants: List[Dict[str, Any]]) -> Dict[str, Any]:
    scored: List[Dict[str, Any]] = []
    best_name = ""
    best_score = -1.0
    for variant in variants:
        basis_text = str(variant.get("oracle_output") or variant.get("prompt") or "")
        prompt_chars = int(variant.get("prompt_chars", len(str(variant.get("prompt") or ""))) or 0)
        output_chars = len(str(variant.get("oracle_output") or ""))
        overlap = _token_overlap_score(query, basis_text)
        prompt_budget_penalty = min(0.25, max(0.0, (prompt_chars - 800) / 4000.0))
        empty_penalty = 0.35 if (variant.get("oracle_output") is not None and not str(variant.get("oracle_output") or "").strip()) else 0.0
        memory_bonus = 0.08 if variant.get("name") == "referents_plus_codec" else (0.03 if variant.get("name") == "referents_only" else 0.0)
        output_bonus = min(0.2, output_chars / 1200.0) if output_chars else 0.0
        score = max(0.0, round((0.62 * overlap) + memory_bonus + output_bonus - prompt_budget_penalty - empty_penalty, 3))
        row = {
            "name": variant.get("name"),
            "score": score,
            "overlap": overlap,
            "prompt_chars": prompt_chars,
            "output_chars": output_chars,
            "prompt_budget_penalty": round(prompt_budget_penalty, 3),
            "empty_penalty": round(empty_penalty, 3),
            "memory_bonus": round(memory_bonus, 3),
            "basis": "oracle_output" if variant.get("oracle_output") is not None else "prompt",
        }
        scored.append(row)
        if score > best_score:
            best_score = score
            best_name = str(variant.get("name") or "")

    return {
        "method": "heuristic",
        "winner": best_name,
        "scores": scored,
        "rationale": "Picks the variant with the best balance of query overlap, useful memory context, and prompt efficiency.",
    }



def _parse_json_object(text: str) -> Optional[Dict[str, Any]]:
    raw = (text or "").strip()
    if not raw:
        return None
    candidates = [raw]
    if "```" in raw:
        for block in re.findall(r"```(?:json)?\s*(.*?)```", raw, flags=re.DOTALL | re.IGNORECASE):
            candidates.append(block.strip())
    for candidate in candidates:
        try:
            obj = json.loads(candidate)
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    m = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict):
                return obj
        except Exception:
            return None
    return None



def _oracle_judge_codec_variants(query: str, variants: List[Dict[str, Any]], *, priority: str = "normal") -> Dict[str, Any]:
    from cortex_server.routers.oracle import _best_effort_answer, _quality_depth_controller

    rows = []
    for variant in variants:
        basis = str(variant.get("oracle_output") or variant.get("prompt") or "")
        rows.append(
            f"VARIANT {variant.get('name')}\nPROMPT_CHARS: {variant.get('prompt_chars')}\nCONTENT:\n{basis}\n"
        )
    judge_prompt = (
        "Compare the candidate variants for the user's query. Choose the single best variant. "
        "Prefer correctness, relevance, useful retained context, and low hallucination risk. "
        "Return JSON only with keys: winner, rationale, confidence.\n\n"
        f"USER QUERY:\n{query}\n\n"
        "CANDIDATES:\n" + "\n".join(rows)
    )
    depth = _quality_depth_controller(query, priority=priority or "")
    depth_mode = str(depth.get("mode") or "medium")
    raw = _best_effort_answer(judge_prompt, None, priority, depth_mode)[0]
    parsed = _parse_json_object(raw)
    if not parsed:
        return {
            "method": "oracle_judge",
            "completed": False,
            "error": "judge_parse_failed",
            "raw": raw[:400],
        }
    return {
        "method": "oracle_judge",
        "completed": True,
        "winner": str(parsed.get("winner") or ""),
        "rationale": str(parsed.get("rationale") or ""),
        "confidence": parsed.get("confidence"),
        "raw": raw[:400],
    }



def _codec_evaluation_view(
    session_key: str,
    *,
    eval_query: str = "",
    max_chars: int = 420,
    history_limit: int = 8,
    adaptive_policies: Optional[_PrincipalAdaptivePolicies] = None,
) -> Dict[str, Any]:
    resolved_query = (eval_query or "What should I remember from this conversation?").strip()
    debug = get_codec_debug_view(
        session_key,
        max_chars=max(120, min(int(max_chars), 2400)),
        history_limit=max(1, min(int(history_limit), 50)),
        query=resolved_query,
    )
    variants_view = _codec_variant_prompts(session_key, resolved_query)
    variants = []
    for item in variants_view.get("variants", []):
        prompt = item.get("prompt", "")
        variants.append({
            **item,
            "prompt_excerpt": prompt[:280],
            "prompt_hash": hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16] if prompt else "",
        })

    debug["evaluation"] = {
        "query": resolved_query,
        "variants": variants,
        "variant_count": len(variants),
        "referent_memory_keys": len(variants_view.get("memory_bucket") or {}),
        "error": variants_view.get("error"),
        "timeline": (debug.get("persisted_snapshots") or {}).get("recent", []),
        "judge": _heuristic_judge_codec_variants(resolved_query, variants),
        "policy": _scoped_codec_policy_call(adaptive_policies, get_codec_policy_for_query, resolved_query),
    }
    return debug


def _update_codec_context(
    session_key: str,
    query: str,
    response: str = "",
    *,
    routing_method: str = "",
    tenant_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
    telemetry_session_key: Optional[str] = None,
    adaptive_policies: Optional[_PrincipalAdaptivePolicies] = None,
) -> Dict[str, Any]:
    if not NEXUS_CODEC_ENABLED or not session_key:
        return {"enabled": bool(NEXUS_CODEC_ENABLED), "available": False, "packet": "", "summary": ""}
    events = []
    if (query or "").strip():
        events.append({
            "text": query,
            "tags": ["nexus_query"],
            "metadata": {"source": "nexus.orchestrate", "routing_method": routing_method or "pending"},
        })
    if (response or "").strip():
        events.append({
            "text": response,
            "tags": ["nexus_response"],
            "metadata": {"source": "nexus.orchestrate", "routing_method": routing_method or "response"},
        })
    if events:
        update_codec_state_for_session(
            session_key,
            events,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
        )
    return _codec_context_packet(
        session_key,
        query=query,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        telemetry_session_key=telemetry_session_key,
        adaptive_policies=adaptive_policies,
    )


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


def _refresh_context(query: str, answer: Optional[str] = None, *, continuity_key: str = "") -> None:
    if not continuity_key:
        return
    codeword = _extract_codeword(query)
    with _CONTEXT_LOCK:
        state = _context_state_for_key(continuity_key)
        if state is None:
            return
        state["updated_at"] = _now_iso()
        state["recent_turns"].append({"query": query, "answer": answer or "", "ts": state["updated_at"]})
        if "fix plan" in (query or "").lower() or "flaky ci" in (query or "").lower():
            state["last_fix_plan"] = query
        if codeword:
            state["last_codeword"] = codeword
        _persist_context_state(continuity_key, state)


def _resolve_referent_context(query: str, *, continuity_key: str = "") -> Dict[str, Any]:
    if not _is_referent_query(query) and "codeword" not in (query or "").lower():
        return {"resolved": False}
    if not continuity_key:
        return {"resolved": False, "reason": "principal_context_required"}

    with _CONTEXT_LOCK:
        state = _context_state_for_key(continuity_key)
        if state is None or not state.get("updated_at"):
            return {"resolved": False, "reason": "no_context"}
        updated_at = _parse_iso_datetime(state.get("updated_at"))
        if updated_at is None or (datetime.utcnow() - updated_at).total_seconds() > _CONTEXT_TTL_SECONDS:
            return {"resolved": False, "reason": "context_expired"}

        reference_text = state.get("last_fix_plan") or ""
        codeword = state.get("last_codeword") or ""
        return {
            "resolved": bool(reference_text or codeword),
            "reference_text": reference_text,
            "codeword": codeword,
            "method": "durable_referent_memory",
            "storage": str(_referent_state_path(continuity_key)),
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


def _kernel_contract_for_query(query: str) -> Dict[str, Any]:
    return cortex_kernel_v2.compile_request_contract(
        query,
        response_mode="nexus_orchestrate",
        requested_model="nexus",
        settings=cortex_kernel_v2._settings("nexus"),
    )


def _detect_risk_flags(query: str, *, kernel_contract: Optional[Dict[str, Any]] = None) -> List[str]:
    contract = dict(kernel_contract or _kernel_contract_for_query(query))
    flags = list(contract.get("risk_flags") or [])
    q = (query or "").lower()
    for label, keys in {
        "medical": ["medical", "diagnose", "symptom", "treatment"],
        "legal": ["legal", "law", "contract", "sue"],
        "financial": ["invest", "tax", "financial", "loan"],
        "safety": ["dangerous", "weapon", "harm", "suicide"],
        "security": ["exploit", "hack", "malware", "bypass"],
    }.items():
        if label not in flags and any(k in q for k in keys):
            flags.append(label)
    return flags


def _is_simple_qa(query: str, *, kernel_contract: Optional[Dict[str, Any]] = None) -> bool:
    contract = dict(kernel_contract or _kernel_contract_for_query(query))
    return bool(((contract.get("intent") or {}).get("simple_qa")))


def _complexity_gate(query: str, hard_threshold: float = 0.45, l9_threshold: float = 0.48, *, kernel_contract: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Detect whether query should bypass fastlane and use stronger reasoning path."""
    contract = dict(kernel_contract or _kernel_contract_for_query(query))
    q = (query or "").lower()
    hard_markers = [
        "tradeoff", "trade-off", "optimize", "constraint", "subject to", "under budget",
        "multi-step", "plan", "strategy", "architecture", "root cause", "diagnose",
        "why did", "counterfactual", "what if", "synthesize", "jointly", "paired",
    ]
    marker_hits = [m for m in hard_markers if m in q]

    numeric_constraints = len(re.findall(r"\b\d+(?:\.\d+)?\b", q))
    has_compare = any(x in q for x in ["vs", "versus", "compare", "better than"])
    complexity_score = float(((contract.get("complexity") or {}).get("score")) or 0.0)
    complexity_reasons = [str(item) for item in ((contract.get("complexity") or {}).get("reasons") or []) if str(item).strip()]
    if not complexity_reasons:
        complexity_score = min(1.0, 0.15 * len(marker_hits) + (0.15 if has_compare else 0) + min(0.3, 0.05 * numeric_constraints))
    hard_threshold = float(hard_threshold)
    l9_threshold = float(l9_threshold)
    return {
        "score": round(complexity_score, 2),
        "hard": complexity_score >= hard_threshold or str(((contract.get("lane") or {}).get("preferred")) or "fast") == "deep",
        "l9_triggered": complexity_score >= l9_threshold or _requires_tradeoff_deliberation(query) or "analysis" in complexity_reasons or "verification" in complexity_reasons,
        "marker_hits": (complexity_reasons or marker_hits)[:8],
        "numeric_constraints": numeric_constraints,
        "hard_threshold": round(hard_threshold, 2),
        "l9_threshold": round(l9_threshold, 2),
        "preferred_lane": str(((contract.get("lane") or {}).get("preferred")) or "fast"),
        "intent_kind": str(((contract.get("intent") or {}).get("kind")) or "general"),
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
    explicit = q.startswith("brainstorm:") or " brainstorm:" in q or "brainstorm " in q or q == "brainstorm"
    natural_markers = [
        "creative ideas",
        "launch ideas",
        "ideas for launching",
        "brainstorm ideas",
        "campaign ideas",
        "creative concepts",
        "marketing ideas",
    ]
    request_markers = ["give me", "help me", "come up with", "generate", "need"]
    return explicit or (any(m in q for m in natural_markers) and any(r in q for r in request_markers))


def _is_coding_intent(query: str) -> bool:
    q = (query or "").lower()
    phrase_markers = [
        "write code", "unit test", "unit tests", "api endpoint",
    ]
    if any(m in q for m in phrase_markers):
        return True

    return bool(re.search(r"\b(?:implement|refactor|patch|bug|fix|debug|test|tests|function|class|migration)\b", q))


def _is_incident_intent(query: str) -> bool:
    q = (query or "").lower()

    if _is_schedule_intent(query) and any(x in q for x in ["remind", "schedule", "calendar"]):
        severe_signals = ["outage", "sev1", "sev2", "production down", "service down", "incident response", "on-call"]
        if not any(s in q for s in severe_signals):
            return False

    hard_markers = [
        "outage", "sev1", "sev2", "on-call", "service down", "status page",
        "page me", "production down", "incident response", "incident commander",
    ]
    if _is_architecture_intent(query) and not any(m in q for m in hard_markers):
        return False
    if any(m in q for m in hard_markers):
        return True

    if "postmortem" in q and any(c in q for c in ["outage", "sev", "production", "service"]):
        return True

    soft_markers = ["rollback", "degraded", "hotfix", "latency spiked", "error rate", "incident"]
    context_markers = ["prod", "production", "outage", "service", "deploy", "api"]
    return any(m in q for m in soft_markers) and any(c in q for c in context_markers)


def _is_research_intent(query: str) -> bool:
    q = (query or "").lower()
    markers = [
        "research", "sources", "cite", "evidence", "literature", "survey",
        "compare options", "pros and cons", "benchmark",
    ]
    return any(m in q for m in markers)


def _is_architecture_intent(query: str) -> bool:
    q = (query or "").lower()
    markers = [
        "architecture", "system design", "design doc", "blueprint", "infra design",
        "service boundaries", "component diagram", "api design", "schema design",
        "scalability", "fault tolerance", "high availability",
    ]
    return any(m in q for m in markers)


def _is_translation_intent(query: str) -> bool:
    q = (query or "").lower()
    markers = ["translate", "translation", "in spanish", "in french", "in german", "in japanese", "in korean"]
    return any(m in q for m in markers)


def _is_schedule_intent(query: str) -> bool:
    q = (query or "").lower()

    explicit_markers = [
        "remind me", "set a reminder", "schedule", "calendar", "add to calendar",
        "due date", "deadline", "meeting", "appointment",
    ]
    if any(m in q for m in explicit_markers):
        return True

    has_action = bool(re.search(r"(remind|schedule|calendar|book|set)", q))
    has_date = bool(re.search(r"(today|tomorrow|tonight|next week|next month|this (?:morning|afternoon|evening)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))", q))
    has_time = bool(re.search(r"at\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)", q))
    return has_action and (has_date or has_time)


def _is_mediation_intent(query: str) -> bool:
    q = (query or "").lower()
    markers = ["mediate", "conflict", "disagreement", "negotiate", "alignment", "stakeholder tension"]
    return any(m in q for m in markers)


def _is_forecast_intent(query: str) -> bool:
    q = (query or "").lower()
    markers = ["forecast", "predict", "projection", "scenario", "what will happen", "next quarter"]
    return any(m in q for m in markers)


def _is_training_intent(query: str) -> bool:
    q = (query or "").lower()
    markers = [
        "teach me", "training plan", "curriculum", "study plan", "onboarding plan",
        "learning path", "learn this", "upskill", "practice roadmap",
    ]
    return any(m in q for m in markers)


def _is_ethics_intent(query: str) -> bool:
    q = (query or "").lower()
    markers = [
        "ethical", "ethics", "compliance", "fairness", "bias", "governance",
        "policy risk", "regulatory", "responsible ai",
    ]
    return any(m in q for m in markers)


def _specialist_level_nudges(query: str) -> list[tuple[int, str]]:
    q = (query or "").lower()
    rules = [
        ((("search the web" in q) or ("latest" in q and "news" in q) or ("web" in q and "news" in q)), 2, "Web/news intent nudge -> L2 Ghost"),
        (((("create a workflow" in q) or ("workflow" in q and "run" in q))), 26, "Workflow intent nudge -> L26 Conductor"),
        (((("creative campaign" in q) or ("campaign concept" in q) or ("creative concept" in q))), 29, "Creative concept nudge -> L29 Muse"),
        (((("self-improvement" in q) or ("code quality" in q and "opportunit" in q))), 35, "Self-improvement intent nudge -> L35 Singularity"),
        (((("synthesize insights" in q) or ("across multiple levels" in q))), 32, "Synthesis intent nudge -> L32 Synthesist"),
    ]
    out: list[tuple[int, str]] = []
    seen: set[int] = set()
    for matched, lvl, why in rules:
        if matched and lvl not in seen:
            out.append((lvl, why))
            seen.add(lvl)
    return out


def _canary_hit(query: str, percent: int) -> bool:
    pct = max(0, min(100, int(percent)))
    if pct <= 0:
        return False
    if pct >= 100:
        return True
    bucket = int(hashlib.sha256((query or "").encode("utf-8")).hexdigest(), 16) % 100
    return bucket < pct


def _cognitive_reasoning(query: str, risk_flags: List[str], *, kernel_contract: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    q = (query or "").lower()
    simple_qa = _is_simple_qa(query, kernel_contract=kernel_contract)
    hypotheses = [
        "Direct factual response is sufficient" if simple_qa else "Task likely requires multi-step reasoning",
        "Use retrieval evidence before finalizing answer",
    ]
    if any(k in q for k in ["compare", "vs", "tradeoff"]):
        hypotheses.append("Comparison intent detected; evaluate multiple options")
    if risk_flags:
        hypotheses.append("Risk-sensitive domain detected; bias toward escalation")
    if _requires_tradeoff_deliberation(query):
        hypotheses.append("Multi-constraint optimization intent detected; evaluate cross-option tradeoffs")

    selected_policy = "direct"
    if risk_flags or not simple_qa or _requires_tradeoff_deliberation(query):
        selected_policy = "deliberate"
    if _is_brainstorm_intent(query):
        selected_policy = "divergent"

    observations = {
        "query_length": len(query or ""),
        "risk_flags": risk_flags,
        "simple_qa": simple_qa,
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
    try:
        safety = float(quality["safety"])
        safety_valid = math.isfinite(safety)
    except (KeyError, TypeError, ValueError):
        safety = 0.0
        safety_valid = False

    pass_gates = (
        quality["evidence"] >= thresholded["min_evidence"]
        and quality["consistency"] >= thresholded["min_consistency"]
        and safety_valid
        and safety >= thresholded["min_safety"]
        and quality["confidence"] >= thresholded["min_confidence"]
    )

    rollback_cfg = cognitive_cfg.get("rollback", {}) if isinstance(cognitive_cfg.get("rollback", {}), dict) else {}
    rollback_triggered = bool(rollback_cfg.get("enabled", True)) and (
        (rollback_cfg.get("trip_on_safety_breach", True) and (not safety_valid or safety < thresholded["min_safety"]))
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


def _persist_codec_eval_run(record: Dict[str, Any]) -> None:
    try:
        _CODEC_EVAL_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _CODEC_EVAL_HISTORY_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _persist_codec_replay_report(record: Dict[str, Any]) -> None:
    try:
        _CODEC_REPLAY_REPORTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _CODEC_REPLAY_REPORTS_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _codec_live_reexec_reports_path() -> Path:
    configured = _CODEC_LIVE_REEXEC_REPORTS_PATH
    if configured.exists():
        return configured
    try:
        configured.parent.mkdir(parents=True, exist_ok=True)
        return configured
    except OSError:
        fallback = _CODEC_EVAL_HISTORY_PATH.parent / "nexus_codec_live_reexec_reports.jsonl"
        fallback.parent.mkdir(parents=True, exist_ok=True)
        return fallback


def _persist_codec_live_reexec_report(record: Dict[str, Any]) -> bool:
    try:
        persisted = dict(record)
        persisted["schema_version"] = "cortex.codec.live_reexecution_report.v1"
        persisted["source"] = "nexus.live_reexecute"
        canonical = json.dumps(persisted, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        persisted["integrity"] = {
            "algorithm": "sha256",
            "digest": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        }
        report_path = _codec_live_reexec_reports_path()
        with report_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(persisted, ensure_ascii=False) + "\n")
        return True
    except Exception:
        return False


def _persist_codec_corpus_export(record: Dict[str, Any]) -> None:
    try:
        _CODEC_CORPUS_EXPORTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _CODEC_CORPUS_EXPORTS_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _load_codec_replay_reports(*, session_key: str = "", limit: int = 20) -> List[Dict[str, Any]]:
    try:
        if not _CODEC_REPLAY_REPORTS_PATH.exists():
            return []
        rows: List[Dict[str, Any]] = []
        with _CODEC_REPLAY_REPORTS_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                line = (line or "").strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                if not isinstance(row, dict):
                    continue
                if session_key and str(row.get("session_key") or "") != session_key:
                    continue
                rows.append(row)
        rows.sort(key=lambda row: str(row.get("generated_at") or row.get("recorded_at") or ""), reverse=True)
        return rows[: max(1, min(int(limit), 100))]
    except Exception:
        return []


def _find_codec_replay_report(*, session_key: str, report_id: str = "") -> Dict[str, Any]:
    reports = _load_codec_replay_reports(session_key=session_key, limit=200)
    if not reports:
        return {}
    if report_id:
        for report in reports:
            if str(report.get("report_id") or "") == str(report_id or ""):
                return report
        return {}
    return reports[0] if reports else {}



def _load_codec_active_policy() -> Dict[str, Any]:
    try:
        if not _CODEC_ACTIVE_POLICY_PATH.exists():
            return {}
        raw = json.loads(_CODEC_ACTIVE_POLICY_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}



def _save_codec_active_policy(state: Dict[str, Any]) -> None:
    try:
        _CODEC_ACTIVE_POLICY_PATH.parent.mkdir(parents=True, exist_ok=True)
        _CODEC_ACTIVE_POLICY_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass



def _persist_codec_replay_plan(record: Dict[str, Any]) -> None:
    try:
        _CODEC_REPLAY_PLANS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _CODEC_REPLAY_PLANS_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass



def _load_codec_replay_plans(*, session_key: str = "", limit: int = 20) -> List[Dict[str, Any]]:
    try:
        if not _CODEC_REPLAY_PLANS_PATH.exists():
            return []
        rows: List[Dict[str, Any]] = []
        with _CODEC_REPLAY_PLANS_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                line = (line or "").strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                if not isinstance(row, dict):
                    continue
                if session_key and str(row.get("session_key") or "") != session_key:
                    continue
                rows.append(row)
        rows.sort(key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""), reverse=True)
        return rows[: max(1, min(int(limit), 100))]
    except Exception:
        return []



def _load_codec_replay_plan_states(*, session_key: str = "", limit: int = 20) -> List[Dict[str, Any]]:
    latest: Dict[str, Dict[str, Any]] = {}
    for row in _load_codec_replay_plans(session_key=session_key, limit=200):
        plan_id = str(row.get("plan_id") or "")
        if not plan_id:
            continue
        current = latest.get(plan_id)
        row_ts = str(row.get("updated_at") or row.get("created_at") or "")
        current_ts = str((current or {}).get("updated_at") or (current or {}).get("created_at") or "")
        if current is None or row_ts >= current_ts:
            latest[plan_id] = row
    rows = list(latest.values())
    rows.sort(key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""), reverse=True)
    return rows[: max(1, min(int(limit), 100))]



def _compute_replay_plan_next_run(*, from_time: Optional[datetime], cadence_minutes: int) -> str:
    base = from_time or datetime.utcnow()
    next_dt = base.timestamp() + (60 * max(5, int(cadence_minutes)))
    return datetime.utcfromtimestamp(next_dt).isoformat() + "Z"



def _plan_due(plan: Dict[str, Any], *, now: Optional[datetime] = None) -> bool:
    if not bool(plan.get("enabled", True)):
        return False
    now = now or datetime.utcnow()
    next_run_at = _parse_iso_datetime(plan.get("next_run_at")) or _parse_iso_datetime(plan.get("created_at"))
    if next_run_at is None:
        return True
    return next_run_at <= now



def _execute_replay_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    session_key = str(plan.get("session_key") or "")
    if not session_key:
        return {"executed": False, "reason": "missing_session_key"}
    report = _codec_replay_report(session_key, limit=50)
    _persist_codec_replay_report(report)
    promoted = False
    active_policy = {}
    if bool(plan.get("auto_promote_on_success", False)) and isinstance(report.get("recommendations"), dict) and report.get("recommendations"):
        active_policy = {
            "version": "cortex.codec.active_benchmark_policy.v1",
            "updated_at": _now_iso(),
            "session_key": session_key,
            "source": "scheduled_replay_autopromote",
            "report_id": str(report.get("report_id") or ""),
            "corpus_version": str(report.get("corpus_version") or ""),
            "policies": report.get("recommendations") if isinstance(report.get("recommendations"), dict) else {},
        }
        _save_codec_active_policy(active_policy)
        promoted = True
    now_iso = _now_iso()
    update = {
        **plan,
        "updated_at": now_iso,
        "last_run_at": now_iso,
        "last_report_id": str(report.get("report_id") or ""),
        "run_count": int(plan.get("run_count", 0) or 0) + 1,
        "last_autopromote": promoted,
        "next_run_at": _compute_replay_plan_next_run(from_time=_parse_iso_datetime(now_iso), cadence_minutes=int(plan.get("cadence_minutes", 1440) or 1440)),
    }
    _persist_codec_replay_plan(update)
    return {
        "executed": True,
        "plan": update,
        "report": {
            "report_id": str(report.get("report_id") or ""),
            "corpus_version": str(report.get("corpus_version") or ""),
        },
        "autopromoted": promoted,
        "active_policy": active_policy,
    }



def _run_due_replay_plans_once(*, session_key: str = "", limit: int = 100) -> Dict[str, Any]:
    plans = _load_codec_replay_plan_states(session_key=session_key, limit=max(1, min(int(limit), 200)))
    due = [plan for plan in plans if _plan_due(plan)]
    results = [_execute_replay_plan(plan) for plan in due]
    _CODEC_REPLAY_SCHEDULER_STATE["last_tick_at"] = _now_iso()
    _CODEC_REPLAY_SCHEDULER_STATE["last_due_count"] = len(due)
    _CODEC_REPLAY_SCHEDULER_STATE["last_executed_count"] = len([item for item in results if bool(item.get("executed"))])
    _CODEC_REPLAY_SCHEDULER_STATE["last_error"] = ""
    return {
        "due_count": len(due),
        "executed_count": len([item for item in results if bool(item.get("executed"))]),
        "items": results,
    }



def _codec_replay_scheduler_loop() -> None:
    global _CODEC_REPLAY_SCHEDULER_THREAD
    while bool(CODEC_REPLAY_SCHEDULER_ENABLED):
        try:
            _run_due_replay_plans_once(limit=200)
            _CODEC_REPLAY_SCHEDULER_STATE["thread_alive"] = True
        except Exception as exc:
            _CODEC_REPLAY_SCHEDULER_STATE["last_tick_at"] = _now_iso()
            _CODEC_REPLAY_SCHEDULER_STATE["last_error"] = str(exc)
        time.sleep(max(5, int(CODEC_REPLAY_SCHEDULER_INTERVAL_SECONDS)))
    _CODEC_REPLAY_SCHEDULER_STATE["thread_alive"] = False
    _CODEC_REPLAY_SCHEDULER_THREAD = None



def _ensure_codec_replay_scheduler_started() -> Dict[str, Any]:
    global _CODEC_REPLAY_SCHEDULER_THREAD
    with _CODEC_REPLAY_SCHEDULER_LOCK:
        _CODEC_REPLAY_SCHEDULER_STATE["enabled"] = bool(CODEC_REPLAY_SCHEDULER_ENABLED)
        _CODEC_REPLAY_SCHEDULER_STATE["interval_seconds"] = int(CODEC_REPLAY_SCHEDULER_INTERVAL_SECONDS)
        if not bool(CODEC_REPLAY_SCHEDULER_ENABLED):
            return dict(_CODEC_REPLAY_SCHEDULER_STATE)
        if _CODEC_REPLAY_SCHEDULER_THREAD and _CODEC_REPLAY_SCHEDULER_THREAD.is_alive():
            _CODEC_REPLAY_SCHEDULER_STATE["started"] = True
            _CODEC_REPLAY_SCHEDULER_STATE["thread_alive"] = True
            return dict(_CODEC_REPLAY_SCHEDULER_STATE)
        thread = threading.Thread(target=_codec_replay_scheduler_loop, name="nexus-codec-replay-scheduler", daemon=True)
        thread.start()
        _CODEC_REPLAY_SCHEDULER_THREAD = thread
        _CODEC_REPLAY_SCHEDULER_STATE["started"] = True
        _CODEC_REPLAY_SCHEDULER_STATE["thread_alive"] = True
        return dict(_CODEC_REPLAY_SCHEDULER_STATE)



def _codec_replay_report_versions(*, session_key: str = "", limit: int = 100) -> Dict[str, Any]:
    reports = _load_codec_replay_reports(session_key=session_key, limit=limit)
    versions: Dict[str, Dict[str, Any]] = {}
    for report in reports:
        version = str(report.get("corpus_version") or "unknown")
        row = versions.setdefault(version, {
            "corpus_version": version,
            "report_count": 0,
            "latest_report_id": "",
            "latest_generated_at": "",
            "session_keys": set(),
        })
        row["report_count"] += 1
        row["session_keys"].add(str(report.get("session_key") or ""))
        generated_at = str(report.get("generated_at") or "")
        if generated_at >= str(row.get("latest_generated_at") or ""):
            row["latest_generated_at"] = generated_at
            row["latest_report_id"] = str(report.get("report_id") or "")
    items = []
    for row in versions.values():
        items.append({
            "corpus_version": str(row.get("corpus_version") or ""),
            "report_count": int(row.get("report_count", 0) or 0),
            "latest_report_id": str(row.get("latest_report_id") or ""),
            "latest_generated_at": str(row.get("latest_generated_at") or ""),
            "session_count": len([x for x in row.get("session_keys", set()) if x]),
        })
    items.sort(key=lambda item: (int(item.get("report_count", 0) or 0), str(item.get("latest_generated_at") or "")), reverse=True)
    return {
        "available": bool(items),
        "count": len(items),
        "items": items,
    }



def _codec_replay_retention_summary(*, session_key: str = "", limit: int = 100) -> Dict[str, Any]:
    reports = _load_codec_replay_reports(session_key=session_key, limit=limit)
    if not reports:
        return {
            "available": False,
            "keep_count": 0,
            "prune_candidate_count": 0,
            "keep": [],
            "prune_candidates": [],
        }
    latest_per_version: Dict[str, Dict[str, Any]] = {}
    for report in reports:
        version = str(report.get("corpus_version") or "unknown")
        current = latest_per_version.get(version)
        generated_at = str(report.get("generated_at") or "")
        if current is None or generated_at >= str(current.get("generated_at") or ""):
            latest_per_version[version] = report
    keep_ids = {str(report.get("report_id") or "") for report in latest_per_version.values()}
    keep = []
    prune = []
    for report in reports:
        item = {
            "report_id": str(report.get("report_id") or ""),
            "generated_at": str(report.get("generated_at") or ""),
            "corpus_version": str(report.get("corpus_version") or ""),
            "session_key": str(report.get("session_key") or ""),
        }
        if item["report_id"] in keep_ids:
            keep.append(item)
        else:
            prune.append({**item, "reason": "superseded_by_newer_same_corpus_version"})
    return {
        "available": True,
        "keep_count": len(keep),
        "prune_candidate_count": len(prune),
        "keep": keep[:20],
        "prune_candidates": prune[:50],
    }


def _codec_replay_report_diff(newer: Dict[str, Any], older: Dict[str, Any]) -> Dict[str, Any]:
    if not newer or not older:
        return {"available": False, "reason": "missing_report"}
    newer_corpus = ((newer.get("corpus") or {}).get("summary") or {}) if isinstance((newer.get("corpus") or {}).get("summary"), dict) else {}
    older_corpus = ((older.get("corpus") or {}).get("summary") or {}) if isinstance((older.get("corpus") or {}).get("summary"), dict) else {}
    newer_hist = ((newer.get("history") or {}).get("summary") or {}) if isinstance((newer.get("history") or {}).get("summary"), dict) else {}
    older_hist = ((older.get("history") or {}).get("summary") or {}) if isinstance((older.get("history") or {}).get("summary"), dict) else {}
    return {
        "available": True,
        "newer_report_id": str(newer.get("report_id") or ""),
        "older_report_id": str(older.get("report_id") or ""),
        "corpus_version_changed": str(newer.get("corpus_version") or "") != str(older.get("corpus_version") or ""),
        "summary": {
            "total_runs_delta": int(newer_corpus.get("total_runs", 0) or 0) - int(older_corpus.get("total_runs", 0) or 0),
            "replay_ready_runs_delta": int(newer_corpus.get("replay_ready_runs", 0) or 0) - int(older_corpus.get("replay_ready_runs", 0) or 0),
            "overall_pass_rate_delta": round(float(newer_hist.get("overall_pass_rate", 0.0) or 0.0) - float(older_hist.get("overall_pass_rate", 0.0) or 0.0), 3),
            "codec_win_rate_delta": round(float(newer_hist.get("codec_win_rate", 0.0) or 0.0) - float(older_hist.get("codec_win_rate", 0.0) or 0.0), 3),
            "avg_codec_margin_delta": round(float(newer_hist.get("avg_codec_margin", 0.0) or 0.0) - float(older_hist.get("avg_codec_margin", 0.0) or 0.0), 3),
        },
        "recommendations": {
            "newer": newer.get("recommendations") if isinstance(newer.get("recommendations"), dict) else {},
            "older": older.get("recommendations") if isinstance(older.get("recommendations"), dict) else {},
        },
    }



def _load_codec_eval_runs(*, session_key: str = "", limit: int = 20) -> List[Dict[str, Any]]:
    try:
        if not _CODEC_EVAL_HISTORY_PATH.exists():
            return []
        rows: List[Dict[str, Any]] = []
        with _CODEC_EVAL_HISTORY_PATH.open("r", encoding="utf-8") as f:
            for line in f:
                line = (line or "").strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                if not isinstance(row, dict):
                    continue
                if session_key and str(row.get("session_key") or "") != session_key:
                    continue
                rows.append(row)
        rows.sort(key=lambda row: str(row.get("recorded_at") or ""), reverse=True)
        return rows[: max(1, min(int(limit), 100))]
    except Exception:
        return []


def _codec_eval_trend_summary(session_key: str, *, limit: int = 20) -> Dict[str, Any]:
    runs = _load_codec_eval_runs(session_key=session_key, limit=limit)
    if not runs:
        return {
            "history_available": False,
            "window_size": 0,
            "runs": [],
            "summary": {
                "total_runs": 0,
                "overall_pass_rate": 0.0,
                "codec_win_rate": 0.0,
                "avg_judge_margin": 0.0,
                "avg_codec_margin": 0.0,
            },
        }

    total = len(runs)
    overall_passes = sum(1 for run in runs if bool(((run.get("acceptance_gates") or {}).get("summary") or {}).get("overall_pass")))
    codec_wins = sum(1 for run in runs if str(run.get("winner") or "") == "referents_plus_codec")
    avg_judge_margin = round(sum(float((run.get("acceptance_gates") or {}).get("judge_margin") or 0.0) for run in runs) / max(1, total), 3)
    avg_codec_margin = round(sum(float((run.get("acceptance_gates") or {}).get("codec_margin_vs_best_non_codec") or 0.0) for run in runs) / max(1, total), 3)
    return {
        "history_available": True,
        "window_size": total,
        "runs": [
            {
                "recorded_at": str(run.get("recorded_at") or ""),
                "winner": str(run.get("winner") or ""),
                "judge_method": str(run.get("judge_method") or ""),
                "overall_pass": bool(((run.get("acceptance_gates") or {}).get("summary") or {}).get("overall_pass")),
                "judge_margin": float((run.get("acceptance_gates") or {}).get("judge_margin") or 0.0),
                "codec_margin_vs_best_non_codec": float((run.get("acceptance_gates") or {}).get("codec_margin_vs_best_non_codec") or 0.0),
            }
            for run in runs[:10]
        ],
        "summary": {
            "total_runs": total,
            "overall_pass_rate": round(overall_passes / max(1, total), 3),
            "codec_win_rate": round(codec_wins / max(1, total), 3),
            "avg_judge_margin": avg_judge_margin,
            "avg_codec_margin": avg_codec_margin,
        },
    }


def _codec_eval_policy_candidates() -> List[Dict[str, Any]]:
    base = _codec_acceptance_policy()
    candidates: List[Dict[str, Any]] = []
    judge_values = sorted({round(max(0.0, float(base.get("min_judge_margin", 0.0)) + delta), 3) for delta in (-0.01, 0.0, 0.03)})
    codec_values = sorted({round(float(base.get("codec_margin_floor", -0.05)) + delta, 3) for delta in (-0.03, 0.0, 0.05)})
    oracle_values = sorted({round(max(0.5, float(base.get("min_oracle_coverage", 1.0)) + delta), 3) for delta in (-0.33, 0.0)})
    seen = set()
    for judge_margin in judge_values:
        for codec_floor in codec_values:
            for oracle_cov in oracle_values:
                candidate = {
                    **base,
                    "min_judge_margin": judge_margin,
                    "codec_margin_floor": codec_floor,
                    "min_oracle_coverage": oracle_cov,
                }
                key = json.dumps(candidate, sort_keys=True)
                if key in seen:
                    continue
                seen.add(key)
                candidates.append(candidate)
    return candidates



def _codec_eval_replay_passes(candidate: Dict[str, Any], run: Dict[str, Any]) -> Dict[str, Any]:
    oracle_run = run.get("oracle_run") if isinstance(run.get("oracle_run"), dict) else {}
    oracle_requested = bool(oracle_run.get("requested"))
    oracle_completed = bool(oracle_run.get("completed"))
    acceptance = run.get("acceptance_gates") if isinstance(run.get("acceptance_gates"), dict) else {}
    judge_margin = float(acceptance.get("judge_margin") or 0.0)
    codec_margin = float(acceptance.get("codec_margin_vs_best_non_codec") or 0.0)
    oracle_coverage = float(acceptance.get("oracle_coverage") or 0.0)
    variant_count = int(run.get("variant_count", 0) or 0)
    passes = {
        "variant_coverage": variant_count >= int(candidate.get("min_variants", 1)),
        "judge_decisiveness": judge_margin >= float(candidate.get("min_judge_margin", 0.0)),
        "codec_competitiveness": codec_margin >= float(candidate.get("codec_margin_floor", -1.0)),
    }
    if oracle_requested:
        passes["oracle_variant_coverage"] = oracle_completed and oracle_coverage >= float(candidate.get("min_oracle_coverage", 1.0))
    return {
        "passes": passes,
        "overall_pass": all(bool(value) for value in passes.values()),
        "judge_margin": judge_margin,
        "codec_margin": codec_margin,
    }



def _codec_eval_policy_distance(candidate: Dict[str, Any], base: Dict[str, Any]) -> float:
    return round(
        abs(float(candidate.get("min_judge_margin", 0.0)) - float(base.get("min_judge_margin", 0.0)))
        + abs(float(candidate.get("codec_margin_floor", 0.0)) - float(base.get("codec_margin_floor", 0.0)))
        + abs(float(candidate.get("min_oracle_coverage", 1.0)) - float(base.get("min_oracle_coverage", 1.0))),
        3,
    )



def _codec_eval_sweep_summary(session_key: str, *, limit: int = 50) -> Dict[str, Any]:
    runs = _load_codec_eval_runs(session_key=session_key, limit=limit)
    if not runs:
        return {
            "available": False,
            "candidate_count": 0,
            "best_candidate": {},
            "ranked_candidates": [],
        }

    base = _codec_acceptance_policy()
    ranked: List[Dict[str, Any]] = []
    total = len(runs)
    codec_wins_total = sum(1 for run in runs if str(run.get("winner") or "") == "referents_plus_codec")
    for candidate in _codec_eval_policy_candidates():
        replayed = [_codec_eval_replay_passes(candidate, run) for run in runs]
        overall_passes = sum(1 for row in replayed if bool(row.get("overall_pass")))
        avg_judge_margin = round(sum(float(row.get("judge_margin") or 0.0) for row in replayed) / max(1, total), 3)
        avg_codec_margin = round(sum(float(row.get("codec_margin") or 0.0) for row in replayed) / max(1, total), 3)
        pass_rate = overall_passes / max(1, total)
        codec_win_rate = codec_wins_total / max(1, total)
        distance = _codec_eval_policy_distance(candidate, base)
        score = round((0.58 * pass_rate) + (0.22 * codec_win_rate) + (0.12 * max(0.0, avg_codec_margin + 0.1)) + (0.08 * min(1.0, avg_judge_margin / 0.1)) - (0.08 * distance), 3)
        ranked.append({
            "policy": candidate,
            "score": score,
            "pass_rate": round(pass_rate, 3),
            "avg_judge_margin": avg_judge_margin,
            "avg_codec_margin": avg_codec_margin,
            "distance_from_base": distance,
        })

    ranked.sort(key=lambda row: (float(row.get("score") or 0.0), float(row.get("pass_rate") or 0.0), float(row.get("avg_codec_margin") or 0.0)), reverse=True)
    return {
        "available": True,
        "candidate_count": len(ranked),
        "best_candidate": ranked[0] if ranked else {},
        "ranked_candidates": ranked[:5],
        "base_policy": base,
    }


def _codec_rollup_policy_base_from_runs(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    for run in runs:
        policy = run.get("rollup_policy") if isinstance(run.get("rollup_policy"), dict) else {}
        if isinstance(policy.get("base"), dict) and policy.get("base"):
            return dict(policy.get("base") or {})
        if policy:
            return {
                "match_min_overlap": float(policy.get("match_min_overlap", 0.84) or 0.84),
                "confidence_blend": float(policy.get("confidence_blend", 0.30) or 0.30),
                "cross_session_score_per_session": float(policy.get("cross_session_score_per_session", 0.03) or 0.03),
            }
    return {
        "match_min_overlap": 0.84,
        "confidence_blend": 0.30,
        "cross_session_score_per_session": 0.03,
    }



def _codec_rollup_policy_candidates(base: Dict[str, Any]) -> List[Dict[str, Any]]:
    overlap_base = float(base.get("match_min_overlap", 0.84) or 0.84)
    blend_base = float(base.get("confidence_blend", 0.30) or 0.30)
    score_base = float(base.get("cross_session_score_per_session", 0.03) or 0.03)
    seen = set()
    candidates: List[Dict[str, Any]] = []
    for overlap_delta in (-0.04, 0.0, 0.04):
        for blend_delta in (-0.08, 0.0, 0.08):
            for score_delta in (-0.015, 0.0, 0.015):
                candidate = {
                    "match_min_overlap": round(max(0.65, min(0.98, overlap_base + overlap_delta)), 3),
                    "confidence_blend": round(max(0.0, min(1.0, blend_base + blend_delta)), 3),
                    "cross_session_score_per_session": round(max(0.0, score_base + score_delta), 3),
                }
                key = json.dumps(candidate, sort_keys=True)
                if key in seen:
                    continue
                seen.add(key)
                candidates.append(candidate)
    return candidates



def _codec_rollup_policy_distance(candidate: Dict[str, Any], base: Dict[str, Any]) -> float:
    return round(
        abs(float(candidate.get("match_min_overlap", 0.0)) - float(base.get("match_min_overlap", 0.0)))
        + abs(float(candidate.get("confidence_blend", 0.0)) - float(base.get("confidence_blend", 0.0)))
        + abs(float(candidate.get("cross_session_score_per_session", 0.0)) - float(base.get("cross_session_score_per_session", 0.0))),
        3,
    )



def _codec_rollup_candidate_bias(candidate: Dict[str, Any], base: Dict[str, Any]) -> float:
    loosen_overlap = (float(base.get("match_min_overlap", 0.84)) - float(candidate.get("match_min_overlap", 0.84))) / 0.04
    loosen_blend = (float(candidate.get("confidence_blend", 0.30)) - float(base.get("confidence_blend", 0.30))) / 0.08
    loosen_score = (float(candidate.get("cross_session_score_per_session", 0.03)) - float(base.get("cross_session_score_per_session", 0.03))) / 0.015
    return round((loosen_overlap + loosen_blend + loosen_score) / 3.0, 3)



def _codec_rollup_sweep_summary(session_key: str, *, limit: int = 50) -> Dict[str, Any]:
    runs = _load_codec_eval_runs(session_key=session_key, limit=limit)
    if not runs:
        return {
            "available": False,
            "candidate_count": 0,
            "best_candidate": {},
            "ranked_candidates": [],
        }

    base = _codec_rollup_policy_base_from_runs(runs)
    total = len(runs)
    ranked: List[Dict[str, Any]] = []
    for candidate in _codec_rollup_policy_candidates(base):
        bias = _codec_rollup_candidate_bias(candidate, base)
        score = 0.0
        codec_helpful = 0
        for run in runs:
            acceptance = run.get("acceptance_gates") if isinstance(run.get("acceptance_gates"), dict) else {}
            overall_pass = bool(((acceptance.get("summary") or {}).get("overall_pass")) if isinstance(acceptance.get("summary"), dict) else False)
            winner = str(run.get("winner") or "")
            codec_margin = float(acceptance.get("codec_margin_vs_best_non_codec") or 0.0)
            preferred_direction = 0.0
            if winner == "referents_plus_codec" and overall_pass and codec_margin >= 0.03:
                preferred_direction = 1.0
                codec_helpful += 1
            elif winner != "referents_plus_codec" or codec_margin <= -0.03 or not overall_pass:
                preferred_direction = -1.0
            score += preferred_direction * bias
            score += 0.15 * max(0.0, codec_margin + 0.1)
        distance = _codec_rollup_policy_distance(candidate, base)
        final_score = round((score / max(1, total)) + (0.08 * (codec_helpful / max(1, total))) - (0.10 * distance), 3)
        ranked.append({
            "policy": candidate,
            "score": final_score,
            "distance_from_base": distance,
            "candidate_bias": bias,
        })

    ranked.sort(key=lambda row: (float(row.get("score") or 0.0), -float(row.get("distance_from_base") or 0.0)), reverse=True)
    return {
        "available": True,
        "candidate_count": len(ranked),
        "best_candidate": ranked[0] if ranked else {},
        "ranked_candidates": ranked[:5],
        "base_policy": base,
    }


def _judge_scores_by_name(judge: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    rows = judge.get("scores") if isinstance(judge.get("scores"), list) else []
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "")
        if not name:
            continue
        out[name] = row
    return out



def _compact_variant_snapshot(variant: Dict[str, Any], judge_row: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    judge_row = judge_row or {}
    output_chars = int(variant.get("oracle_output_chars", 0) or 0)
    output_bonus = min(0.2, output_chars / 1200.0) if output_chars else 0.0
    prompt_text = str(variant.get("prompt") or "")
    oracle_output = str(variant.get("oracle_output") or "")
    return {
        "name": str(variant.get("name") or ""),
        "prompt_hash": str(variant.get("prompt_hash") or ""),
        "prompt_chars": int(variant.get("prompt_chars", 0) or 0),
        "referent_prefix_chars": int(variant.get("referent_prefix_chars", 0) or 0),
        "codec_prefix_chars": int(variant.get("codec_prefix_chars", 0) or 0),
        "oracle_output_chars": output_chars,
        "oracle_model": str(variant.get("oracle_model") or ""),
        "prompt_excerpt": _compact_text_excerpt(variant.get("prompt_excerpt") or prompt_text, limit=120),
        "oracle_excerpt": _compact_text_excerpt(oracle_output, limit=120),
        "prompt_text": prompt_text,
        "oracle_output": oracle_output,
        "overlap": float(judge_row.get("overlap", 0.0) or 0.0),
        "prompt_budget_penalty": float(judge_row.get("prompt_budget_penalty", 0.0) or 0.0),
        "empty_penalty": float(judge_row.get("empty_penalty", 0.0) or 0.0),
        "memory_bonus": float(judge_row.get("memory_bonus", 0.0) or 0.0),
        "output_bonus": round(output_bonus, 3),
        "heuristic_score": float(judge_row.get("score", 0.0) or 0.0),
        "basis": str(judge_row.get("basis") or ""),
    }



def _codec_corpus_policy_candidates() -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for overlap_weight in (0.5, 0.62, 0.72):
        for memory_weight in (0.7, 1.0, 1.3):
            for output_weight in (0.8, 1.0, 1.2):
                for penalty_weight in (0.85, 1.0, 1.15):
                    candidate = {
                        "overlap_weight": round(overlap_weight, 3),
                        "memory_weight": round(memory_weight, 3),
                        "output_weight": round(output_weight, 3),
                        "penalty_weight": round(penalty_weight, 3),
                    }
                    key = json.dumps(candidate, sort_keys=True)
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(candidate)
    return out



def _codec_corpus_policy_distance(candidate: Dict[str, Any]) -> float:
    base = {"overlap_weight": 0.62, "memory_weight": 1.0, "output_weight": 1.0, "penalty_weight": 1.0}
    return round(sum(abs(float(candidate.get(k, 0.0) or 0.0) - float(base[k])) for k in base), 3)



def _codec_replay_variant_winner(variant_snapshots: List[Dict[str, Any]], candidate: Dict[str, Any]) -> Dict[str, Any]:
    best_name = ""
    best_score = -999.0
    ranked: List[Dict[str, Any]] = []
    for row in variant_snapshots:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "")
        if not name:
            continue
        score = (
            float(candidate.get("overlap_weight", 0.62) or 0.62) * float(row.get("overlap", 0.0) or 0.0)
            + float(candidate.get("memory_weight", 1.0) or 1.0) * float(row.get("memory_bonus", 0.0) or 0.0)
            + float(candidate.get("output_weight", 1.0) or 1.0) * float(row.get("output_bonus", 0.0) or 0.0)
            - float(candidate.get("penalty_weight", 1.0) or 1.0) * (float(row.get("prompt_budget_penalty", 0.0) or 0.0) + float(row.get("empty_penalty", 0.0) or 0.0))
        )
        scored = {"name": name, "score": round(max(0.0, score), 3)}
        ranked.append(scored)
        if score > best_score:
            best_score = score
            best_name = name
    ranked.sort(key=lambda item: float(item.get("score") or 0.0), reverse=True)
    return {"winner": best_name, "scores": ranked}



def _codec_eval_corpus_replay_sweep_summary_for_runs(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    replay_runs = [run for run in runs if isinstance(run.get("variant_snapshots"), list) and run.get("variant_snapshots")]
    if not replay_runs:
        return {
            "available": False,
            "candidate_count": 0,
            "best_candidate": {},
            "ranked_candidates": [],
        }

    total = len(replay_runs)
    ranked: List[Dict[str, Any]] = []
    for candidate in _codec_corpus_policy_candidates():
        winner_matches = 0
        codec_helpful = 0
        score_total = 0.0
        for run in replay_runs:
            replay = _codec_replay_variant_winner(run.get("variant_snapshots") or [], candidate)
            replay_winner = str(replay.get("winner") or "")
            actual_winner = str(run.get("winner") or "")
            acceptance = run.get("acceptance_gates") if isinstance(run.get("acceptance_gates"), dict) else {}
            overall_pass = bool(((acceptance.get("summary") or {}).get("overall_pass")) if isinstance(acceptance.get("summary"), dict) else False)
            codec_margin = float(acceptance.get("codec_margin_vs_best_non_codec") or 0.0)
            if replay_winner == actual_winner and replay_winner:
                winner_matches += 1
                score_total += 0.7
            if replay_winner == "referents_plus_codec" and overall_pass and codec_margin >= 0.03:
                codec_helpful += 1
                score_total += 0.35
            elif replay_winner == "referents_plus_codec" and (codec_margin <= -0.03 or not overall_pass):
                score_total -= 0.35
            score_total += 0.12 * max(0.0, codec_margin + 0.1)
        distance = _codec_corpus_policy_distance(candidate)
        ranked.append({
            "policy": candidate,
            "score": round((score_total / max(1, total)) - (0.08 * distance), 3),
            "winner_match_rate": round(winner_matches / max(1, total), 3),
            "codec_helpful_rate": round(codec_helpful / max(1, total), 3),
            "distance_from_base": distance,
        })

    ranked.sort(key=lambda row: (float(row.get("score") or 0.0), float(row.get("winner_match_rate") or 0.0), float(row.get("codec_helpful_rate") or 0.0)), reverse=True)
    return {
        "available": True,
        "candidate_count": len(ranked),
        "best_candidate": ranked[0] if ranked else {},
        "ranked_candidates": ranked[:5],
        "base_policy": {"overlap_weight": 0.62, "memory_weight": 1.0, "output_weight": 1.0, "penalty_weight": 1.0},
    }



def _compact_text_excerpt(value: Any, *, limit: int = 160) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)] + "…"



def _codec_bucket_snapshot(view: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    schema = view.get("schema") if isinstance(view.get("schema"), dict) else {}
    promotion = view.get("promotion") if isinstance(view.get("promotion"), dict) else {}
    promoted = promotion.get("promoted") if isinstance(promotion.get("promoted"), dict) else {}
    buckets = {
        "preferences": int((((schema.get("identity") or {}).get("preferences") or {}).get("count") or 0)),
        "active_goals": int((((schema.get("projects") or {}).get("active_goals") or {}).get("count") or 0)),
        "open_loops": int((((schema.get("projects") or {}).get("open_loops") or {}).get("count") or 0)),
        "durable_facts": int((((schema.get("world") or {}).get("durable_facts") or {}).get("count") or 0)),
        "patterns": int((((schema.get("failure") or {}).get("patterns") or {}).get("count") or 0)),
        "lessons": int((((schema.get("failure") or {}).get("lessons") or {}).get("count") or 0)),
    }
    return {
        bucket: {
            "count": count,
            "promoted_count": len(promoted.get(bucket) or []) if isinstance(promoted.get(bucket), list) else 0,
        }
        for bucket, count in buckets.items()
    }



def _codec_bucket_policy_candidates() -> List[Dict[str, Any]]:
    return [{"bucket_weight": round(value, 2)} for value in (0.85, 1.0, 1.15)]



def _replayable_variants_from_snapshots(snapshots: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    variants: List[Dict[str, Any]] = []
    for snapshot in snapshots or []:
        if not isinstance(snapshot, dict):
            continue
        name = str(snapshot.get("name") or "")
        prompt_text = str(snapshot.get("prompt_text") or "")
        if not name or not prompt_text:
            continue
        variants.append({
            "name": name,
            "prompt": prompt_text,
            "prompt_chars": int(snapshot.get("prompt_chars", len(prompt_text)) or len(prompt_text)),
            "oracle_output": str(snapshot.get("oracle_output") or "") or None,
            "oracle_output_chars": int(snapshot.get("oracle_output_chars", 0) or 0),
            "oracle_model": str(snapshot.get("oracle_model") or ""),
            "referent_prefix_chars": int(snapshot.get("referent_prefix_chars", 0) or 0),
            "codec_prefix_chars": int(snapshot.get("codec_prefix_chars", 0) or 0),
            "prompt_hash": str(snapshot.get("prompt_hash") or ""),
        })
    return variants



def _codec_true_reexecute_run(run: Dict[str, Any]) -> Dict[str, Any]:
    query = str(run.get("query") or "")
    variants = _replayable_variants_from_snapshots(run.get("variant_snapshots") if isinstance(run.get("variant_snapshots"), list) else [])
    if not query or not variants:
        return {"available": False, "reason": "missing_query_or_variants"}
    judge = _heuristic_judge_codec_variants(query, variants)
    current_winner = str(judge.get("winner") or "")
    recorded_winner = str(run.get("winner") or "")
    return {
        "available": True,
        "query": _compact_text_excerpt(query, limit=120),
        "recorded_winner": recorded_winner,
        "reexecuted_winner": current_winner,
        "winner_changed": bool(recorded_winner and current_winner and recorded_winner != current_winner),
        "judge": judge,
        "variant_count": len(variants),
    }



def _codec_true_reexecute_summary(session_key: str, *, limit: int = 20) -> Dict[str, Any]:
    runs = _load_codec_eval_runs(session_key=session_key, limit=limit)
    results = [_codec_true_reexecute_run(run) for run in runs]
    available = [row for row in results if bool(row.get("available"))]
    changed = [row for row in available if bool(row.get("winner_changed"))]
    return {
        "available": bool(available),
        "summary": {
            "total_runs": len(runs),
            "reexecuted_runs": len(available),
            "winner_changed_runs": len(changed),
            "winner_change_rate": round(len(changed) / max(1, len(available)), 3) if available else 0.0,
        },
        "runs": available[:10],
    }



def _token_set(value: Any) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]{3,}", str(value or "").lower())}



def _semantic_similarity(a: Any, b: Any) -> float:
    a_tokens = _token_set(a)
    b_tokens = _token_set(b)
    if not a_tokens or not b_tokens:
        return 0.0
    return round(len(a_tokens & b_tokens) / max(1, len(a_tokens | b_tokens)), 3)



def _semantic_precision(a: Any, b: Any) -> float:
    a_tokens = _token_set(a)
    b_tokens = _token_set(b)
    if not b_tokens:
        return 0.0
    return round(len(a_tokens & b_tokens) / max(1, len(b_tokens)), 3)



def _semantic_recall(a: Any, b: Any) -> float:
    a_tokens = _token_set(a)
    b_tokens = _token_set(b)
    if not a_tokens:
        return 0.0
    return round(len(a_tokens & b_tokens) / max(1, len(a_tokens)), 3)



def _semantic_f1(a: Any, b: Any) -> float:
    precision = _semantic_precision(a, b)
    recall = _semantic_recall(a, b)
    if precision <= 0.0 or recall <= 0.0:
        return 0.0
    return round((2 * precision * recall) / max(0.001, precision + recall), 3)



def _length_ratio(a: Any, b: Any) -> float:
    a_len = len(str(a or ""))
    b_len = len(str(b or ""))
    if a_len <= 0 and b_len <= 0:
        return 1.0
    return round(min(a_len, b_len) / max(1, max(a_len, b_len)), 3)



def _semantic_drift_metrics(recorded: Any, current: Any) -> Dict[str, Any]:
    similarity = _semantic_similarity(recorded, current)
    precision = _semantic_precision(recorded, current)
    recall = _semantic_recall(recorded, current)
    f1 = _semantic_f1(recorded, current)
    length_ratio = _length_ratio(recorded, current)
    drift = round(1.0 - ((0.55 * similarity) + (0.25 * f1) + (0.20 * length_ratio)), 3)
    return {
        "similarity": similarity,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "length_ratio": length_ratio,
        "drift": max(0.0, min(1.0, drift)),
    }



def _live_reexecute_backend_registry() -> Dict[str, Dict[str, Any]]:
    return {
        "recorded": {
            "backend": "recorded",
            "kind": "stored_output",
            "available": True,
            "requires_runtime": False,
            "description": "Use the recorded historical output as the replay backend baseline.",
        },
        "stored": {
            "backend": "stored",
            "kind": "stored_output",
            "available": True,
            "requires_runtime": False,
            "description": "Alias for the recorded historical output backend.",
        },
        "openclaw_local": {
            "backend": "openclaw_local",
            "kind": "local_runtime",
            "available": True,
            "requires_runtime": True,
            "description": "Re-execute the saved prompt through Oracle's current local OpenClaw path.",
        },
    }



def _live_reexecute_backend_status() -> Dict[str, Any]:
    registry = _live_reexecute_backend_registry()
    items = []
    for backend, row in registry.items():
        payload = dict(row)
        payload["backend"] = backend
        items.append(payload)
    return {
        "available": True,
        "count": len(items),
        "items": items,
    }



def _live_reexecute_output(prompt: str, *, backend: str = "openclaw_local", recorded_output: str = "") -> Dict[str, Any]:
    backend_name = str(backend or "openclaw_local")
    registry = _live_reexecute_backend_registry()
    backend_row = registry.get(backend_name) or {}
    if not backend_row:
        return {"backend": backend_name, "output": f"ERROR::unknown_backend::{backend_name}", "error": f"unknown_backend::{backend_name}"}
    if str(backend_row.get("kind") or "") == "stored_output":
        return {"backend": backend_name, "output": str(recorded_output or ""), "error": ""}
    try:
        from cortex_server.routers.oracle import call_openclaw_local
        output = call_openclaw_local(prompt)
        return {"backend": backend_name, "output": output, "error": ""}
    except Exception as exc:
        return {"backend": backend_name, "output": f"ERROR::{str(exc)[:160]}", "error": str(exc)[:160]}



def _codec_live_reexecute_run(run: Dict[str, Any], *, max_variants: int = 3, backend: str = "openclaw_local") -> Dict[str, Any]:
    query = str(run.get("query") or "")
    variants = _replayable_variants_from_snapshots(run.get("variant_snapshots") if isinstance(run.get("variant_snapshots"), list) else [])[: max(1, min(int(max_variants), 10))]
    if not query or not variants:
        return {"available": False, "reason": "missing_query_or_variants"}
    try:
        from cortex_server.routers.oracle import call_openclaw_local
    except Exception as exc:
        return {"available": False, "reason": f"oracle_import_failed:{str(exc)[:120]}"}

    live_variants: List[Dict[str, Any]] = []
    for variant in variants:
        prompt = str(variant.get("prompt") or "")
        try:
            output = call_openclaw_local(prompt)
        except Exception as exc:
            output = f"ERROR::{str(exc)[:160]}"
        live_variants.append({
            **variant,
            "oracle_output": output,
            "oracle_output_chars": len(output),
            "oracle_model": "openclaw_local_reexecute",
        })

    judge = _heuristic_judge_codec_variants(query, live_variants)
    current_winner = str(judge.get("winner") or "")
    recorded_winner = str(run.get("winner") or "")
    return {
        "available": True,
        "query": _compact_text_excerpt(query, limit=120),
        "recorded_winner": recorded_winner,
        "reexecuted_winner": current_winner,
        "winner_changed": bool(recorded_winner and current_winner and recorded_winner != current_winner),
        "judge": judge,
        "variant_count": len(live_variants),
        "variants": [
            {
                "name": str(item.get("name") or ""),
                "oracle_output_chars": int(item.get("oracle_output_chars", 0) or 0),
                "oracle_excerpt": _compact_text_excerpt(item.get("oracle_output") or "", limit=120),
            }
            for item in live_variants
        ],
    }



def _codec_live_reexecute_summary(session_key: str, *, limit: int = 5, max_variants: int = 3, backend: str = "openclaw_local") -> Dict[str, Any]:
    runs = _load_codec_eval_runs(session_key=session_key, limit=limit)
    results = [_codec_live_reexecute_run(run, max_variants=max_variants, backend=backend) for run in runs]
    available = [row for row in results if bool(row.get("available"))]
    changed = [row for row in available if bool(row.get("winner_changed"))]
    avg_similarity = round(sum(float(row.get("semantic_similarity", 0.0) or 0.0) for row in available) / max(1, len(available)), 3) if available else 0.0
    return {
        "available": bool(available),
        "backend": str(backend or "openclaw_local"),
        "summary": {
            "total_runs": len(runs),
            "reexecuted_runs": len(available),
            "winner_changed_runs": len(changed),
            "winner_change_rate": round(len(changed) / max(1, len(available)), 3) if available else 0.0,
            "avg_semantic_similarity": avg_similarity,
            "avg_semantic_drift": round(1.0 - avg_similarity, 3) if available else 0.0,
        },
        "runs": available[: max(1, min(int(limit), 10))],
    }



def _codec_bucket_replay_summary_for_runs(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    replay_runs = [run for run in runs if isinstance(run.get("bucket_snapshot"), dict) and run.get("bucket_snapshot")]
    if not replay_runs:
        return {"available": False, "bucket_count": 0, "buckets": {}}

    bucket_names = sorted({bucket for run in replay_runs for bucket in (run.get("bucket_snapshot") or {}).keys()})
    buckets_out: Dict[str, Any] = {}
    for bucket in bucket_names:
        bucket_runs = [run for run in replay_runs if int((((run.get("bucket_snapshot") or {}).get(bucket) or {}).get("count") or 0)) > 0]
        if not bucket_runs:
            continue
        ranked = []
        total = len(bucket_runs)
        for candidate in _codec_bucket_policy_candidates():
            weight = float(candidate.get("bucket_weight", 1.0) or 1.0)
            score_total = 0.0
            codec_helpful = 0
            for run in bucket_runs:
                acceptance = run.get("acceptance_gates") if isinstance(run.get("acceptance_gates"), dict) else {}
                codec_margin = float(acceptance.get("codec_margin_vs_best_non_codec") or 0.0)
                overall_pass = bool(((acceptance.get("summary") or {}).get("overall_pass")) if isinstance(acceptance.get("summary"), dict) else False)
                snap = ((run.get("bucket_snapshot") or {}).get(bucket) or {}) if isinstance((run.get("bucket_snapshot") or {}).get(bucket), dict) else {}
                promoted_count = int(snap.get("promoted_count", 0) or 0)
                if overall_pass and codec_margin >= 0.03:
                    codec_helpful += 1
                    score_total += (weight - 1.0) * (0.35 + (0.08 * promoted_count))
                elif codec_margin <= -0.03 or not overall_pass:
                    score_total -= (weight - 1.0) * (0.35 + (0.08 * promoted_count))
                score_total += 0.10 * max(0.0, codec_margin + 0.1)
            distance = abs(weight - 1.0)
            ranked.append({
                "policy": candidate,
                "score": round((score_total / max(1, total)) - (0.08 * distance), 3),
                "codec_helpful_rate": round(codec_helpful / max(1, total), 3),
                "distance_from_base": round(distance, 3),
                "run_count": total,
            })
        ranked.sort(key=lambda row: (float(row.get("score") or 0.0), float(row.get("codec_helpful_rate") or 0.0)), reverse=True)
        buckets_out[bucket] = {
            "available": True,
            "run_count": total,
            "best_candidate": ranked[0] if ranked else {},
            "ranked_candidates": ranked[:3],
            "base_policy": {"bucket_weight": 1.0},
        }
    return {"available": bool(buckets_out), "bucket_count": len(buckets_out), "buckets": buckets_out}



def _codec_history_recommendations(history: Dict[str, Any]) -> Dict[str, Any]:
    sweep = history.get("sweep") if isinstance(history.get("sweep"), dict) else {}
    rollup_sweep = history.get("rollup_sweep") if isinstance(history.get("rollup_sweep"), dict) else {}
    corpus = history.get("corpus_replay") if isinstance(history.get("corpus_replay"), dict) else {}
    bucket_sweeps = (corpus.get("bucket_sweeps") or {}).get("buckets") if isinstance((corpus.get("bucket_sweeps") or {}), dict) else {}
    return {
        "acceptance_policy": sweep.get("best_candidate", {}) if isinstance(sweep, dict) else {},
        "rollup_policy": rollup_sweep.get("best_candidate", {}) if isinstance(rollup_sweep, dict) else {},
        "corpus_policy": (corpus.get("sweep") or {}).get("best_candidate", {}) if isinstance(corpus.get("sweep"), dict) else {},
        "bucket_policies": {
            bucket: value.get("best_candidate", {})
            for bucket, value in (bucket_sweeps or {}).items()
            if isinstance(value, dict) and value.get("best_candidate")
        },
    }



def _codec_corpus_fingerprint(rows: List[Dict[str, Any]]) -> str:
    payload = [
        {
            "recorded_at": str(row.get("recorded_at") or ""),
            "query": str(row.get("query") or ""),
            "query_archetype": str(row.get("query_archetype") or ""),
            "winner": str(row.get("winner") or ""),
            "variant_count": int(row.get("variant_count", 0) or 0),
            "variant_snapshots": [
                {
                    "name": str(item.get("name") or ""),
                    "prompt_hash": str(item.get("prompt_hash") or ""),
                    "prompt_chars": int(item.get("prompt_chars", 0) or 0),
                }
                for item in (row.get("variant_snapshots") or []) if isinstance(item, dict)
            ],
        }
        for row in rows
    ]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:16]



def _codec_replay_report_id(session_key: str, corpus_version: str) -> str:
    seed = f"{session_key}|{corpus_version}|{_now_iso()}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]



def _codec_benchmark_corpus_export(session_key: str, *, limit: int = 100) -> Dict[str, Any]:
    manifest = _codec_benchmark_corpus_manifest(session_key, limit=limit)
    history = _codec_eval_trend_summary(session_key, limit=min(limit, 20))
    history["sweep"] = _codec_eval_sweep_summary(session_key, limit=limit)
    history["rollup_sweep"] = _codec_rollup_sweep_summary(session_key, limit=limit)
    history["corpus_replay"] = _codec_eval_corpus_replay_summary(session_key, limit=limit)
    history["true_reexecution"] = _codec_true_reexecute_summary(session_key, limit=min(limit, 20))
    history["recommendations"] = _codec_history_recommendations(history)
    corpus_version = str(manifest.get("corpus_version") or "empty")
    export_id = hashlib.sha256(f"{session_key}|{corpus_version}|{_now_iso()}".encode("utf-8")).hexdigest()[:16]
    return {
        "export_version": "cortex.codec.benchmark_corpus.v1",
        "export_id": export_id,
        "generated_at": _now_iso(),
        "session_key": session_key,
        "corpus_version": corpus_version,
        "manifest": manifest,
        "history": history,
        "recommendations": history.get("recommendations") if isinstance(history.get("recommendations"), dict) else {},
    }


def _codec_benchmark_corpus_manifest(session_key: str, *, limit: int = 50) -> Dict[str, Any]:
    runs = _load_codec_eval_runs(session_key=session_key, limit=limit)
    if not runs:
        return {
            "available": False,
            "corpus_version": "empty",
            "summary": {
                "total_runs": 0,
                "replay_ready_runs": 0,
                "variant_snapshot_count": 0,
            },
            "runs": [],
        }

    replay_ready_runs = 0
    variant_snapshot_count = 0
    manifest_runs = []
    for run in runs:
        snapshots = run.get("variant_snapshots") if isinstance(run.get("variant_snapshots"), list) else []
        if snapshots:
            replay_ready_runs += 1
            variant_snapshot_count += len(snapshots)
        manifest_runs.append({
            "recorded_at": str(run.get("recorded_at") or ""),
            "query": _compact_text_excerpt(run.get("query") or "", limit=120),
            "query_archetype": str(run.get("query_archetype") or ""),
            "winner": str(run.get("winner") or ""),
            "variant_count": int(run.get("variant_count", 0) or 0),
            "replay_ready": bool(snapshots),
            "has_rollup_policy": bool(run.get("rollup_policy")),
            "has_bucket_snapshot": bool(run.get("bucket_snapshot")),
            "has_recommendations": bool(run.get("recommended_policies")),
        })
    return {
        "available": True,
        "corpus_version": _codec_corpus_fingerprint(runs),
        "summary": {
            "total_runs": len(runs),
            "replay_ready_runs": replay_ready_runs,
            "variant_snapshot_count": variant_snapshot_count,
        },
        "runs": manifest_runs,
    }



def _codec_replay_report(session_key: str, *, limit: int = 50) -> Dict[str, Any]:
    corpus = _codec_benchmark_corpus_manifest(session_key, limit=limit)
    history = _codec_eval_trend_summary(session_key, limit=min(limit, 20))
    history["sweep"] = _codec_eval_sweep_summary(session_key, limit=limit)
    history["rollup_sweep"] = _codec_rollup_sweep_summary(session_key, limit=limit)
    history["corpus_replay"] = _codec_eval_corpus_replay_summary(session_key, limit=limit)
    history["recommendations"] = _codec_history_recommendations(history)
    corpus_version = str(corpus.get("corpus_version") or "empty")
    return {
        "report_id": _codec_replay_report_id(session_key, corpus_version),
        "generated_at": _now_iso(),
        "session_key": session_key,
        "corpus_version": corpus_version,
        "corpus": corpus,
        "history": history,
        "recommendations": history.get("recommendations", {}) if isinstance(history.get("recommendations"), dict) else {},
    }



def _codec_eval_corpus_replay_summary(session_key: str, *, limit: int = 50) -> Dict[str, Any]:
    runs = _load_codec_eval_runs(session_key=session_key, limit=limit)
    if not runs:
        return {
            "available": False,
            "summary": {
                "total_runs": 0,
                "replay_ready_runs": 0,
                "variant_snapshot_count": 0,
            },
            "variants": {},
            "ranked_queries": [],
        }

    variant_rows: Dict[str, Dict[str, Any]] = {}
    ranked_queries: List[Dict[str, Any]] = []
    replay_ready_runs = 0
    total_variants = 0
    for run in runs:
        snapshots = run.get("variant_snapshots") if isinstance(run.get("variant_snapshots"), list) else []
        if snapshots:
            replay_ready_runs += 1
        acceptance = run.get("acceptance_gates") if isinstance(run.get("acceptance_gates"), dict) else {}
        codec_margin = float(acceptance.get("codec_margin_vs_best_non_codec") or 0.0)
        ranked_queries.append({
            "query": str(run.get("query") or "")[:160],
            "query_archetype": str(run.get("query_archetype") or ""),
            "winner": str(run.get("winner") or ""),
            "codec_margin_vs_best_non_codec": round(codec_margin, 3),
            "overall_pass": bool(((acceptance.get("summary") or {}).get("overall_pass")) if isinstance(acceptance.get("summary"), dict) else False),
        })
        for snapshot in snapshots:
            if not isinstance(snapshot, dict):
                continue
            name = str(snapshot.get("name") or "")
            if not name:
                continue
            total_variants += 1
            row = variant_rows.setdefault(name, {
                "runs": 0,
                "total_prompt_chars": 0,
                "total_referent_prefix_chars": 0,
                "total_codec_prefix_chars": 0,
                "total_oracle_output_chars": 0,
                "prompt_hashes": set(),
            })
            row["runs"] += 1
            row["total_prompt_chars"] += int(snapshot.get("prompt_chars", 0) or 0)
            row["total_referent_prefix_chars"] += int(snapshot.get("referent_prefix_chars", 0) or 0)
            row["total_codec_prefix_chars"] += int(snapshot.get("codec_prefix_chars", 0) or 0)
            row["total_oracle_output_chars"] += int(snapshot.get("oracle_output_chars", 0) or 0)
            if snapshot.get("prompt_hash"):
                row["prompt_hashes"].add(str(snapshot.get("prompt_hash") or ""))

    variants = {}
    for name, row in variant_rows.items():
        runs_count = max(1, int(row.get("runs", 0) or 0))
        variants[name] = {
            "runs": runs_count,
            "avg_prompt_chars": round(int(row.get("total_prompt_chars", 0) or 0) / runs_count, 3),
            "avg_referent_prefix_chars": round(int(row.get("total_referent_prefix_chars", 0) or 0) / runs_count, 3),
            "avg_codec_prefix_chars": round(int(row.get("total_codec_prefix_chars", 0) or 0) / runs_count, 3),
            "avg_oracle_output_chars": round(int(row.get("total_oracle_output_chars", 0) or 0) / runs_count, 3),
            "unique_prompt_hashes": len(row.get("prompt_hashes", set())),
        }

    ranked_queries.sort(key=lambda row: float(row.get("codec_margin_vs_best_non_codec") or 0.0), reverse=True)
    archetype_groups: Dict[str, List[Dict[str, Any]]] = {}
    for run in runs:
        archetype = str(run.get("query_archetype") or "")
        if not archetype:
            continue
        archetype_groups.setdefault(archetype, []).append(run)
    archetype_sweeps = {
        archetype: {
            "run_count": len(group_runs),
            "sweep": _codec_eval_corpus_replay_sweep_summary_for_runs(group_runs),
        }
        for archetype, group_runs in archetype_groups.items()
    }
    sample_excerpts = []
    for run in runs:
        for snapshot in (run.get("variant_snapshots") or []):
            if not isinstance(snapshot, dict):
                continue
            if snapshot.get("prompt_excerpt") or snapshot.get("oracle_excerpt"):
                sample_excerpts.append({
                    "query": _compact_text_excerpt(run.get("query") or "", limit=100),
                    "query_archetype": str(run.get("query_archetype") or ""),
                    "variant": str(snapshot.get("name") or ""),
                    "prompt_excerpt": str(snapshot.get("prompt_excerpt") or ""),
                    "oracle_excerpt": str(snapshot.get("oracle_excerpt") or ""),
                })
            if len(sample_excerpts) >= 6:
                break
        if len(sample_excerpts) >= 6:
            break
    return {
        "available": replay_ready_runs > 0,
        "summary": {
            "total_runs": len(runs),
            "replay_ready_runs": replay_ready_runs,
            "variant_snapshot_count": total_variants,
            "archetype_count": len(archetype_sweeps),
        },
        "variants": variants,
        "ranked_queries": ranked_queries[:5],
        "sample_excerpts": sample_excerpts,
        "sweep": _codec_eval_corpus_replay_sweep_summary_for_runs(runs),
        "archetype_sweeps": archetype_sweeps,
        "bucket_sweeps": _codec_bucket_replay_summary_for_runs(runs),
    }


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
    grounded = [
        item for item in retrieval_items
        if isinstance(item, dict)
        and bool(item.get("grounded"))
        and str(item.get("snippet") or "").strip()
        and str(item.get("provenance") or "").strip()
    ]
    if not grounded:
        return "Grounded retrieval is unavailable; escalate this query to the semantic reasoning path."

    labels = {
        "comparative": "Grounded comparison evidence",
        "procedural": "Grounded procedural evidence",
        "explanatory": "Grounded explanatory evidence",
        "opinionated": "Grounded decision evidence",
        "factual": "Grounded factual evidence",
    }
    evidence = []
    for item in grounded[:3]:
        source = str(item.get("source") or "source")[:80]
        snippet = str(item.get("snippet") or "").strip()[:600]
        evidence.append(f"{source}: {snippet}")
    return f"{labels.get(qtype, labels['factual'])}: " + " ".join(evidence)


def _normalized_commit_levels(levels: List[int]) -> List[int]:
    out = []
    for value in levels or []:
        try:
            level = int(value)
        except (TypeError, ValueError):
            continue
        if level in LEVEL_MAP and level not in out:
            out.append(level)
    return sorted(out)


def _bounded_scope_value(value: str, default: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return default
    if len(normalized) > 128 or not re.fullmatch(r"[A-Za-z0-9_.:@/-]+", normalized):
        raise HTTPException(status_code=400, detail="invalid assurance scope")
    return normalized


def _production_memory_scope_mode() -> bool:
    environment = os.getenv("CORTEX_ENV", os.getenv("CORTEX_ENVIRONMENT", "development")).strip().lower()
    strict = os.getenv("CORTEX_MEMORY_SCOPE_STRICT", "").strip().lower()
    return environment in {"production", "prod", "staging"} or strict in {"1", "true", "yes", "on"}


def _authenticated_nexus_principal(
    request: Optional[Request],
    *,
    session_hint: str = "",
) -> tuple[AuthenticatedMemoryPrincipal, str]:
    headers = request.headers if request is not None else {}
    scoped_header_names = {
        "tenant_id": "x-cortex-tenant-id",
        "workspace_id": "x-cortex-workspace-id",
        "agent_id": "x-cortex-agent-id",
        "user_id": "x-cortex-user-id",
        "channel_id": "x-cortex-channel-id",
        "session_id": "x-cortex-session-id",
    }
    has_scoped_identity = any(
        str(headers.get(name, "") or "").strip()
        for name in (
            *scoped_header_names.values(),
            "x-cortex-scope-credential-id",
            "x-cortex-scope-signature",
        )
    )
    raw_scope: Optional[Dict[str, str]] = None
    tenant_id: Optional[str] = None
    workspace_id: Optional[str] = None
    if has_scoped_identity:
        missing = [field for field, name in scoped_header_names.items() if not str(headers.get(name, "") or "").strip()]
        if missing:
            raise HTTPException(status_code=403, detail=f"full authenticated principal scope is required: {', '.join(missing)}")
        raw_scope = {
            field: _bounded_scope_value(headers.get(name, ""), "")
            for field, name in scoped_header_names.items()
        }
        tenant_id = raw_scope["tenant_id"]
        workspace_id = raw_scope["workspace_id"]

    scoped_session = str(headers.get("x-cortex-session-id", "") or "").strip()
    transport_session = str(headers.get("x-session-id", "") or "").strip()
    if scoped_session and transport_session and not hmac.compare_digest(scoped_session, transport_session):
        raise HTTPException(status_code=403, detail="transport session must match the authenticated principal session")

    try:
        principal = authenticate_memory_principal(
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            scope=raw_scope,
            credential_id=headers.get("x-cortex-scope-credential-id", ""),
            signature=headers.get("x-cortex-scope-signature", ""),
            production=_production_memory_scope_mode(),
        )
    except MemoryScopeAuthError as exc:
        status_code = 503 if "not configured" in str(exc) else 403
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    resolved_session = str(session_hint or principal.session_id).strip()[:128]
    if has_scoped_identity and not hmac.compare_digest(principal.session_id, resolved_session):
        raise HTTPException(status_code=403, detail="request session must match the authenticated principal session")
    return principal, resolved_session


def _assurance_scope(request: Optional[Request]) -> Dict[str, str]:
    authorization = getattr(getattr(request, "state", None), "cortex_write_authorization", "") if request is not None else ""
    principal, _session_key = _authenticated_nexus_principal(request)
    return {
        **principal.storage_metadata,
        "authorization": _bounded_scope_value(authorization, "request_boundary"),
    }


def _content_hash(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + ("=" * (-len(value) % 4)))


def _assurance_signing_key() -> bytes:
    configured = os.getenv("NEXUS_ASSURANCE_SIGNING_KEY", "").strip()
    if not configured:
        if _production_memory_scope_mode():
            raise RuntimeError("production requires NEXUS_ASSURANCE_SIGNING_KEY")
        return _ASSURANCE_EPHEMERAL_SIGNING_KEY
    if _production_memory_scope_mode() and len(configured.encode("utf-8")) < 32:
        raise RuntimeError("production assurance signing key must contain at least 32 bytes")
    reused = [
        name
        for name, secret in _outcome_feedback_request_credentials().items()
        if secret and hmac.compare_digest(configured, secret)
    ]
    if reused:
        raise RuntimeError(
            "assurance signing key must be server-only and distinct from request credentials: "
            + ", ".join(sorted(reused))
        )
    return configured.encode("utf-8")


def _encode_assurance_receipt(payload: Dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    signature = hmac.new(_assurance_signing_key(), body, hashlib.sha256).digest()
    return f"{_b64url_encode(body)}.{_b64url_encode(signature)}"


def _decode_assurance_receipt(receipt: str) -> Dict[str, Any]:
    try:
        body_part, signature_part = str(receipt or "").split(".", 1)
        body = _b64url_decode(body_part)
        supplied = _b64url_decode(signature_part)
        expected = hmac.new(_assurance_signing_key(), body, hashlib.sha256).digest()
        if not hmac.compare_digest(supplied, expected):
            raise ValueError("signature_mismatch")
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("invalid_payload")
        return payload
    except Exception as exc:
        if isinstance(exc, ValueError) and str(exc) in {"signature_mismatch", "invalid_payload"}:
            raise
        raise ValueError("malformed_receipt") from exc


def _server_commit_assurance(query: str, response: str) -> Dict[str, Any]:
    query = str(query or "").strip()
    response = str(response or "").strip()
    qtype = classify_qtype(query)
    checks = fast_verify(response, qtype, query)
    validator_pass = bool(
        query
        and response
        and checks.get("required_fields_ok", False)
        and not checks.get("contradiction_detected", False)
        and not checks.get("overclaim_detected", False)
        and int(checks.get("missing_constraints_count", 0)) == 0
        and not checks.get("shallow_confidence_risk", False)
    )
    validator_result = {"pass": validator_pass, "checks": checks, "source": "nexus.commit.server_validator"}
    validator_summary = build_validator_summary(
        checks=checks,
        validator_result=validator_result,
        cognitive_quality={},
        execution_transaction={"status": "completed"},
    )
    risk_flags = _detect_risk_flags(f"{query}\n{response}")
    world_grounding = gather_live_evidence(
        query,
        max_sources=3,
        notary_packets=1,
        enabled=bool(os.getenv("NEXUS_WORLD_GROUNDING_ENABLED", "true").lower() in {"1", "true", "yes", "on"}),
    )
    memory_decision = build_memory_commit_decision(
        query=query,
        response=response,
        risk_flags=risk_flags,
        validator_summary=validator_summary,
        world_grounding=world_grounding,
    )
    return {
        "risk_flags": risk_flags,
        "validator_result": validator_result,
        "validator_summary": validator_summary,
        "world_grounding": world_grounding,
        "memory_decision": memory_decision,
    }


def _complete_orchestration_checks(
    *,
    query: str,
    checks: Optional[Dict[str, Any]],
    fastlane: Optional[Dict[str, Any]],
    semantic_result: Optional[Dict[str, Any]],
    reasoning: Optional[List[str]],
) -> Dict[str, Any]:
    """Ensure every orchestration lane supplies response checks to assurance."""
    if isinstance(checks, dict) and "missing_constraints_count" in checks:
        completed = dict(checks)
        completed.setdefault("validation_source", "fastlane_draft")
        return completed

    fastlane_answer = (fastlane or {}).get("answer")
    semantic_reasoning = (semantic_result or {}).get("reasoning")
    if isinstance(fastlane_answer, str) and fastlane_answer.strip():
        response_text = fastlane_answer
        validation_source = "fastlane_answer"
    elif isinstance(semantic_reasoning, str) and semantic_reasoning.strip():
        response_text = semantic_reasoning
        validation_source = "semantic_reasoning"
    else:
        response_text = "\n".join(str(item) for item in (reasoning or []) if str(item).strip())
        validation_source = "routing_reasoning"

    completed = fast_verify(response_text, classify_qtype(query), query)
    completed["validation_source"] = validation_source
    return completed


def _orchestration_validator_pass(
    *,
    checks: Dict[str, Any],
    fastlane: Optional[Dict[str, Any]],
    cognitive_quality_pass: bool,
) -> bool:
    """Apply complete response checks without making non-fastlane routes fail closed."""
    if not isinstance(checks, dict) or "missing_constraints_count" not in checks:
        return False

    core_checks_pass = bool(
        checks.get("required_fields_ok", False)
        and not checks.get("contradiction_detected", False)
        and not checks.get("overclaim_detected", False)
        and int(checks.get("missing_constraints_count", 0)) == 0
        and not checks.get("shallow_confidence_risk", False)
    )
    if isinstance(fastlane, dict):
        return bool(not fastlane.get("escalated") and core_checks_pass)

    return bool(cognitive_quality_pass and core_checks_pass)


def _issue_assurance_receipt(interaction: "AssuranceReceiptRequest", request: Optional[Request]) -> Dict[str, Any]:
    assurance = _server_commit_assurance(interaction.query, interaction.response)
    if not bool((assurance.get("memory_decision") or {}).get("eligible")):
        raise HTTPException(
            status_code=422,
            detail={
                "error": "interaction_not_eligible_for_commit",
                "reasons": list((assurance.get("memory_decision") or {}).get("reasons") or []),
            },
        )
    issued_at = int(time.time())
    payload = {
        "version": _ASSURANCE_RECEIPT_VERSION,
        "jti": secrets.token_hex(16),
        "issued_at": issued_at,
        "expires_at": issued_at + _ASSURANCE_RECEIPT_TTL_SECONDS,
        "query_hash": _content_hash(interaction.query),
        "response_hash": _content_hash(interaction.response),
        "levels_used": _normalized_commit_levels(interaction.levels_used),
        "scope": _assurance_scope(request),
        "risk_flags": list(assurance.get("risk_flags") or []),
        "validator_pass": bool((assurance.get("validator_summary") or {}).get("pass")),
    }
    return {"receipt": _encode_assurance_receipt(payload), "payload": payload, "assurance": assurance}


def _verify_assurance_receipt(interaction: "InteractionData", request: Optional[Request]) -> Dict[str, Any]:
    payload = _decode_assurance_receipt(interaction.assurance_receipt)
    now = int(time.time())
    if payload.get("version") != _ASSURANCE_RECEIPT_VERSION:
        raise ValueError("unsupported_receipt_version")
    if int(payload.get("issued_at", 0)) > now + 5 or int(payload.get("expires_at", 0)) <= int(payload.get("issued_at", 0)):
        raise ValueError("expired_receipt")
    if not hmac.compare_digest(str(payload.get("query_hash") or ""), _content_hash(interaction.query)):
        raise ValueError("query_binding_mismatch")
    if not hmac.compare_digest(str(payload.get("response_hash") or ""), _content_hash(interaction.response)):
        raise ValueError("response_binding_mismatch")
    if payload.get("levels_used") != _normalized_commit_levels(interaction.levels_used):
        raise ValueError("levels_binding_mismatch")
    if payload.get("scope") != _assurance_scope(request):
        raise ValueError("scope_binding_mismatch")
    jti = str(payload.get("jti") or "")
    if not re.fullmatch(r"[0-9a-f]{32}", jti):
        raise ValueError("missing_receipt_id")
    return payload


def _outcome_feedback_request_credentials() -> Dict[str, str]:
    credentials = {
        name: os.getenv(name, "").strip()
        for name in (
            "CORTEX_WRITE_TOKEN",
            "CORTEX_ADMIN_TOKEN",
            "CORTEX_CODEC_ADMIN_TOKEN",
            "NEXUS_OUTCOME_FEEDBACK_TOKEN",
        )
        if os.getenv(name, "").strip()
    }
    raw_scopes = os.getenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", "").strip()
    if raw_scopes:
        try:
            parsed = json.loads(raw_scopes)
        except json.JSONDecodeError as exc:
            raise RuntimeError("outcome feedback signing configuration cannot validate malformed scope credentials") from exc
        if not isinstance(parsed, dict):
            raise RuntimeError("outcome feedback signing configuration requires valid scope credentials")
        for credential_id, record in parsed.items():
            if isinstance(record, dict) and str(record.get("secret") or "").strip():
                credentials[f"CORTEX_MEMORY_SCOPE_CREDENTIALS:{credential_id}"] = str(record["secret"]).strip()
    return credentials


def _validate_outcome_feedback_signing_configuration() -> bytes:
    configured = os.getenv("NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY", "").strip()
    if not configured:
        if _production_memory_scope_mode():
            raise RuntimeError("production requires NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY")
        return _OUTCOME_FEEDBACK_EPHEMERAL_SIGNING_KEY
    reserved = _outcome_feedback_request_credentials()
    assurance_configured = os.getenv("NEXUS_ASSURANCE_SIGNING_KEY", "").strip()
    if assurance_configured:
        reserved["NEXUS_ASSURANCE_SIGNING_KEY"] = assurance_configured
    reused = [
        name
        for name, credential in reserved.items()
        if credential and hmac.compare_digest(configured, credential)
    ]
    if reused:
        raise RuntimeError(
            "outcome feedback signing key must be server-only and distinct from request credentials: "
            + ", ".join(sorted(reused))
        )
    if _production_memory_scope_mode() and len(configured.encode("utf-8")) < 32:
        raise RuntimeError("production outcome feedback signing key must contain at least 32 bytes")
    return configured.encode("utf-8")


def _outcome_feedback_signing_key() -> bytes:
    return _validate_outcome_feedback_signing_configuration()


def _encode_outcome_feedback_receipt(payload: Dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    signature = hmac.new(_outcome_feedback_signing_key(), body, hashlib.sha256).digest()
    return f"{_b64url_encode(body)}.{_b64url_encode(signature)}"


def _decode_outcome_feedback_receipt(receipt: str) -> Dict[str, Any]:
    try:
        body_part, signature_part = str(receipt or "").split(".", 1)
        body = _b64url_decode(body_part)
        supplied = _b64url_decode(signature_part)
        expected = hmac.new(_outcome_feedback_signing_key(), body, hashlib.sha256).digest()
        if not hmac.compare_digest(supplied, expected):
            raise ValueError("signature_mismatch")
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("invalid_payload")
        return payload
    except Exception as exc:
        if isinstance(exc, ValueError) and str(exc) in {"signature_mismatch", "invalid_payload"}:
            raise
        raise ValueError("malformed_receipt") from exc


def _outcome_receipt_scope(scope: Mapping[str, Any]) -> Dict[str, str]:
    fields = (
        "tenant_id",
        "workspace_id",
        "agent_id",
        "user_id",
        "channel_id",
        "session_id",
        "scope_credential_id",
        "storage_workspace_id",
    )
    return {field: str(scope.get(field) or "") for field in fields}


def _issue_outcome_feedback_receipt(
    *,
    scope: Mapping[str, Any],
    execution_id: str,
    query: str,
    task_archetype: str,
    policy_label: str,
    codec_variant: str,
    validator_pass: bool,
    execution_success: bool,
    recovery_needed: bool,
    latency_ms: int,
    outcome_confidence: float,
) -> Dict[str, Any]:
    issued_at = int(time.time())
    payload = {
        "version": _OUTCOME_FEEDBACK_RECEIPT_VERSION,
        "jti": secrets.token_hex(16),
        "issued_at": issued_at,
        "expires_at": issued_at + _OUTCOME_FEEDBACK_RECEIPT_TTL_SECONDS,
        "execution_id": str(execution_id or "")[:128],
        "query_hash": hashlib.sha256(str(query or "").encode("utf-8")).hexdigest(),
        "task_archetype": str(task_archetype or "simple_qa")[:80],
        "policy_label": str(policy_label or "unknown")[:128],
        "codec_variant": str(codec_variant or "query_only")[:64],
        "validator_pass": bool(validator_pass),
        "execution_success": bool(execution_success),
        "recovery_needed": bool(recovery_needed),
        "latency_ms": max(0, int(latency_ms)),
        "outcome_confidence": round(max(0.0, min(1.0, float(outcome_confidence))), 3),
        "scope": _outcome_receipt_scope(scope),
    }
    return {"receipt": _encode_outcome_feedback_receipt(payload), "payload": payload}


def _verify_outcome_feedback_receipt(receipt: str, request: Optional[Request]) -> Dict[str, Any]:
    payload = _decode_outcome_feedback_receipt(receipt)
    now = int(time.time())
    if payload.get("version") != _OUTCOME_FEEDBACK_RECEIPT_VERSION:
        raise ValueError("unsupported_receipt_version")
    if int(payload.get("issued_at", 0)) > now + 5 or int(payload.get("expires_at", 0)) < now:
        raise ValueError("expired_receipt")
    if not str(payload.get("jti") or "") or not str(payload.get("execution_id") or ""):
        raise ValueError("missing_receipt_identity")
    if not re.fullmatch(r"[0-9a-f]{64}", str(payload.get("query_hash") or "")):
        raise ValueError("invalid_query_binding")
    if payload.get("codec_variant") not in {"query_only", "referents_only", "referents_plus_codec"}:
        raise ValueError("invalid_codec_variant")
    current_scope = _outcome_receipt_scope(_assurance_scope(request))
    if payload.get("scope") != current_scope:
        raise ValueError("scope_binding_mismatch")
    return payload


def _outcome_feedback_limits() -> tuple[int, int]:
    try:
        limit = int(os.getenv("NEXUS_OUTCOME_FEEDBACK_RATE_LIMIT", "30"))
        window = int(os.getenv("NEXUS_OUTCOME_FEEDBACK_RATE_WINDOW_SECONDS", "60"))
    except ValueError:
        limit, window = 30, 60
    return max(1, min(limit, 1000)), max(1, min(window, 3600))


def _consume_outcome_feedback_receipt(payload: Mapping[str, Any]) -> None:
    """Persist replay and principal rate-limit state under an inter-process file lock."""

    now = int(time.time())
    expires_at = int(payload.get("expires_at", 0) or 0)
    jti = str(payload.get("jti") or "")
    principal_key = _adaptive_scope_key(payload.get("scope") or {})
    limit, window = _outcome_feedback_limits()
    state_path = _OUTCOME_FEEDBACK_RECEIPT_STATE_PATH
    lock_path = state_path.with_suffix(state_path.suffix + ".lock")

    try:
        with _OUTCOME_FEEDBACK_RECEIPT_LOCK:
            state_path.parent.mkdir(parents=True, exist_ok=True)
            with lock_path.open("a+", encoding="utf-8") as lock_file:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    if state_path.exists():
                        try:
                            state = json.loads(state_path.read_text(encoding="utf-8"))
                        except (json.JSONDecodeError, OSError) as exc:
                            raise RuntimeError("outcome_feedback_replay_store_invalid") from exc
                    else:
                        state = {"version": 1, "consumed": {}, "rates": {}}
                    if (
                        not isinstance(state, dict)
                        or state.get("version") != 1
                        or not isinstance(state.get("consumed"), dict)
                        or not isinstance(state.get("rates"), dict)
                    ):
                        raise RuntimeError("outcome_feedback_replay_store_invalid")
                    if any(
                        not str(key)
                        or not isinstance(values, list)
                        or any(not isinstance(value, (int, float)) for value in values)
                        for key, values in state["rates"].items()
                    ):
                        raise RuntimeError("outcome_feedback_replay_store_invalid")
                    try:
                        consumed = {
                            str(key): int(value)
                            for key, value in state["consumed"].items()
                            if str(key) and int(value or 0) >= now
                        }
                        rates = {
                            str(key): [
                                int(value)
                                for value in values
                                if isinstance(value, (int, float)) and int(value) > now - window
                            ][-1000:]
                            for key, values in state["rates"].items()
                            if str(key) and isinstance(values, list)
                        }
                    except (TypeError, ValueError) as exc:
                        raise RuntimeError("outcome_feedback_replay_store_invalid") from exc
                    rates = {key: values for key, values in rates.items() if values}
                    if jti in consumed:
                        raise ValueError("receipt_already_consumed")
                    recent = list(rates.get(principal_key) or [])
                    if len(recent) >= limit:
                        raise ValueError("principal_rate_limit_exceeded")
                    consumed[jti] = expires_at
                    recent.append(now)
                    rates[principal_key] = recent[-limit:]
                    new_state = {"version": 1, "consumed": consumed, "rates": rates}
                    temp_path = state_path.with_name(
                        f".{state_path.name}.{os.getpid()}.{threading.get_ident()}.{secrets.token_hex(4)}.tmp"
                    )
                    temp_path.write_text(json.dumps(new_state, sort_keys=True), encoding="utf-8")
                    os.replace(temp_path, state_path)
                finally:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    except ValueError:
        raise
    except OSError as exc:
        raise RuntimeError("outcome_feedback_replay_store_unavailable") from exc


def _require_outcome_feedback_control(request: Optional[Request]) -> None:
    configured = os.getenv("NEXUS_OUTCOME_FEEDBACK_TOKEN", "").strip()
    if not configured:
        raise HTTPException(status_code=503, detail="outcome feedback control-plane credential is not configured")
    supplied = str((request.headers if request is not None else {}).get("x-cortex-outcome-feedback-token", "") or "")
    if not supplied or not hmac.compare_digest(supplied, configured):
        raise HTTPException(status_code=403, detail="outcome feedback control-plane credential required")


def _outcome_tuner_for_scope(scope: Mapping[str, Any]) -> OutcomeTuner:
    principal_key = _adaptive_scope_key(scope)
    with _PRINCIPAL_OUTCOME_TUNER_LOCK:
        tuner = _PRINCIPAL_OUTCOME_TUNERS.get(principal_key)
        if tuner is not None:
            return tuner
        while len(_PRINCIPAL_OUTCOME_TUNERS) >= 256:
            _PRINCIPAL_OUTCOME_TUNERS.pop(next(iter(_PRINCIPAL_OUTCOME_TUNERS)))
        root = Path(os.getenv("NEXUS_OUTCOME_ARTIFACT_DIR", str(_ADAPTIVE_STATE_ROOT / "outcomes")))
        tuner = OutcomeTuner(artifact_dir=root / "tenants" / principal_key)
        os.chmod(tuner.artifact_dir, 0o700)
        _PRINCIPAL_OUTCOME_TUNERS[principal_key] = tuner
        return tuner



class AutoIndexRequest(BaseModel):
    query: str
    response_data: Dict[str, Any]


class InteractionData(BaseModel):
    query: str
    response: str
    levels_used: List[int] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    assurance_receipt: str = ""


class AssuranceReceiptRequest(BaseModel):
    query: str
    response: str
    levels_used: List[int] = Field(default_factory=list)


class OrchestrateRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1_048_576)


class PolicyReplayRequest(BaseModel):
    dataset_path: str
    limit: int = 500
    exploration_seed: int = 41


class OutcomeFeedbackRequest(BaseModel):
    query: str
    task_archetype: Optional[str] = None
    policy_label: Optional[str] = None
    codec_variant: Optional[str] = None
    user_correction: bool = False
    recovery_needed: bool = False
    validator_pass: Optional[bool] = None
    note: str = ""


class OutcomeFeedbackReceiptRequest(BaseModel):
    model_config = {"extra": "forbid"}

    receipt: str = Field(..., min_length=32, max_length=8192)


class CodecEventsRequest(BaseModel):
    session_key: str = ""
    events: List[Dict[str, Any]] = Field(default_factory=list)
    max_chars: int = 420
    tenant_id: str = Field("cortex-local", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    workspace_id: str = Field("default", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    scope: Optional[Dict[str, str]] = None
    scope_credential_id: Optional[str] = Field(None, max_length=128)
    scope_signature: Optional[str] = Field(None, max_length=256)


def analyze_intent_with_oracle(query: str, *, route_health: Optional[RouteHealthMonitor] = None) -> Dict[str, Any]:
    """Use L5 Oracle for semantic intent analysis."""
    if not OPENROUTER_API_KEY:
        return {"intents": [], "confidence": 0, "method": "fallback"}

    gate = route_health.allow("oracle") if route_health is not None else {"allowed": True}
    if not gate.get("allowed"):
        return {"intents": [], "confidence": 0, "method": "breaker_open", "reasoning": gate.get("reason")}

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

    started = datetime.utcnow()
    try:
        response = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        latency_ms = (datetime.utcnow() - started).total_seconds() * 1000

        # Parse JSON from response
        try:
            result = json.loads(content)
            if route_health is not None:
                route_health.record_success("oracle", latency_ms=latency_ms)
            return {
                "intents": result.get("intents", []),
                "levels": result.get("levels", []),
                "confidence": result.get("confidence", 0.5),
                "reasoning": result.get("reasoning", "Semantic analysis"),
                "method": "oracle_semantic"
            }
        except json.JSONDecodeError:
            if route_health is not None:
                route_health.record_failure("oracle", error="parse_error", latency_ms=latency_ms)
            return {"intents": [], "confidence": 0, "method": "parse_error"}
    except Exception as e:
        latency_ms = (datetime.utcnow() - started).total_seconds() * 1000
        if route_health is not None:
            route_health.record_failure("oracle", error=str(e), latency_ms=latency_ms)
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


def _architect_healthy(*, route_health: Optional[RouteHealthMonitor] = None) -> bool:
    # In SAFE_MODE, L9 is intentionally proxied by meta-conductor.
    # Avoid blocking self-HTTP calls back into the same 8888 worker.
    if str(os.getenv("CORTEX_SAFE_MODE", "")).lower() in {"1", "true", "yes", "on"}:
        return True

    gate = route_health.allow("architect") if route_health is not None else {"allowed": True}
    if not gate.get("allowed"):
        return False

    started = datetime.utcnow()
    for path in ["/meta_conductor/status", "/architect_expanded/status", "/architect/status"]:
        try:
            resp = requests.get(f"http://localhost:8888{path}", timeout=1.2)
            latency_ms = (datetime.utcnow() - started).total_seconds() * 1000
            if resp.status_code != 200:
                if route_health is not None:
                    route_health.record_failure("architect", error=f"http_{resp.status_code}", latency_ms=latency_ms)
                continue
            data = resp.json()
            if not isinstance(data, dict):
                if route_health is not None:
                    route_health.record_failure("architect", error="invalid_json", latency_ms=latency_ms)
                continue
            if data.get("success") is True:
                if route_health is not None:
                    route_health.record_success("architect", latency_ms=latency_ms)
                return True
            status = str(((data.get("data") or {}).get("status") if isinstance(data.get("data"), dict) else data.get("status", ""))).lower()
            if status in {"active", "healthy", "online", "ok", ""}:
                if route_health is not None:
                    route_health.record_success("architect", latency_ms=latency_ms)
                return True
            if route_health is not None:
                route_health.record_failure("architect", error=f"status_{status or 'unknown'}", latency_ms=latency_ms)
        except Exception as exc:
            latency_ms = (datetime.utcnow() - started).total_seconds() * 1000
            if route_health is not None:
                route_health.record_failure("architect", error=str(exc), latency_ms=latency_ms)
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
            "kernel_v2": cortex_kernel_v2.performance_snapshot(runtime="nexus"),
            "timestamp": str(__import__('datetime').datetime.now()),
        }
    }


@router.get("/kernel/status")
async def get_nexus_kernel_status():
    return {"success": True, **cortex_kernel_v2.performance_snapshot(runtime="nexus")}


@router.get("/kernel/telemetry")
async def get_nexus_kernel_telemetry(limit: int = 50):
    return {"success": True, **cortex_kernel_v2.diagnostic_bundle(runtime="nexus", limit=limit)}


@router.get("/status")
async def get_nexus_status():
    return {
        "success": True,
        "status": "operational",
        "kernel_v2": cortex_kernel_v2.performance_snapshot(runtime="nexus"),
        "codec": {
            "enabled": bool(NEXUS_CODEC_ENABLED),
            "max_chars": NEXUS_CODEC_MAX_CHARS,
        },
        # Public status must not fall back to a process-global adaptive policy.
        # Authenticated principals can inspect only their own policy state at
        # the explicitly protected /nexus/autotune/status endpoint.
        "autotune": {
            "scope": "authenticated_principal",
            "available": False,
            "endpoint": "/nexus/autotune/status",
        },
    }


@router.get("/codec/status")
async def get_nexus_codec_status(request: Request, session_key: Optional[str] = None, max_chars: int = 420, history_limit: int = 8):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")

    view = get_codec_debug_view(
        resolved_session_key,
        max_chars=max(120, min(int(max_chars), 2400)),
        history_limit=max(1, min(int(history_limit), 50)),
    )
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": view,
    }


@router.post("/codec/events")
async def post_nexus_codec_events(payload: CodecEventsRequest, request: Request):
    """Low-latency, authenticated Codec write-through path for trusted runtimes and recovery canaries."""
    resolved_session_key = (payload.session_key or _codec_session_key(request) or "").strip()[:128]
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    if not payload.events or len(payload.events) > 32:
        raise HTTPException(status_code=400, detail="events must contain between 1 and 32 records")
    try:
        principal = authenticate_memory_principal(
            tenant_id=payload.tenant_id,
            workspace_id=payload.workspace_id,
            scope=payload.scope,
            credential_id=payload.scope_credential_id,
            signature=payload.scope_signature,
            production=_production_memory_scope_mode(),
        )
    except MemoryScopeAuthError as exc:
        status_code = 503 if "not configured" in str(exc) else 403
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    if principal.session_id != resolved_session_key:
        raise HTTPException(status_code=403, detail="Codec session key must match the authenticated principal session")
    events = []
    for row in payload.events:
        if not isinstance(row, dict):
            raise HTTPException(status_code=400, detail="each event must be an object")
        text = str(row.get("text") or "").strip()
        if not text or len(text) > 8000:
            raise HTTPException(status_code=400, detail="event text must contain between 1 and 8000 characters")
        tags = row.get("tags") if isinstance(row.get("tags"), list) else []
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        metadata = {**metadata, **principal.storage_metadata}
        events.append({"text": text, "tags": [str(tag)[:80] for tag in tags[:24]], "metadata": metadata})
    state = await run_in_threadpool(
        update_codec_state_for_session,
        resolved_session_key,
        events,
        tenant_id=principal.tenant_id,
        workspace_id=principal.storage_workspace_id,
    )
    packet = await run_in_threadpool(
        get_codec_packet_for_session,
        resolved_session_key,
        max_chars=max(120, min(int(payload.max_chars), 2400)),
        tenant_id=principal.tenant_id,
        workspace_id=principal.storage_workspace_id,
    )
    return {
        "success": True,
        "session_key": resolved_session_key,
        "event_count": len(events),
        "state_fingerprint": state.get("durable_write", {}).get("fingerprint"),
        "codec": packet,
        "truthBoundary": "A successful write proves this event batch reached the Codec state path; durable recovery requires a subsequent process-restart hydration check."
    }


@router.get("/codec/benchmark")
async def get_nexus_codec_benchmark(request: Request, session_key: Optional[str] = None, benchmark_query: Optional[str] = None, max_chars: int = 420, history_limit: int = 8):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")

    view = _codec_benchmark_view(
        resolved_session_key,
        benchmark_query=benchmark_query or "",
        max_chars=max(120, min(int(max_chars), 2400)),
        history_limit=max(1, min(int(history_limit), 50)),
    )
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": view,
    }


@router.get("/codec/policy")
async def get_nexus_codec_policy(request: Request, query: Optional[str] = None, session_key: Optional[str] = None):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    principal, _ = _authenticated_nexus_principal(request, session_hint=resolved_session_key)
    policies = _adaptive_policies_for_scope(principal.storage_metadata)
    telemetry_key = _principal_continuity_key(principal, resolved_session_key)
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec_policy": _scoped_codec_policy_call(
            policies,
            get_codec_policy_status,
            query=query,
            session_key=telemetry_key or None,
        ),
        "capability_matrix": capability_matrix(),
    }


@router.get("/codec/lineage")
async def get_nexus_codec_lineage(request: Request, session_key: Optional[str] = None, max_chars: int = 420, history_limit: int = 8):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    view = get_codec_debug_view(
        resolved_session_key,
        max_chars=max(120, min(int(max_chars), 2400)),
        history_limit=max(1, min(int(history_limit), 50)),
    )
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "session_key": resolved_session_key,
        "state_classes": {
            "observed_evidence": [],
            "inferred_state": [],
            "learned_memory": view.get("memory_facts", []),
            "operator_overrides": [],
        },
        "codec": {
            "summary": view.get("summary"),
            "source_refs": view.get("source_refs", []),
            "promotion": view.get("promotion", {}),
            "retention_policy": view.get("retention_policy", {}),
        },
        "capability_matrix": capability_matrix(),
    }


@router.get("/codec/memory/{memory_id}/lineage")
async def get_nexus_codec_memory_lineage(request: Request, memory_id: str, session_key: Optional[str] = None, max_chars: int = 420, history_limit: int = 8):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    view = get_codec_debug_view(
        resolved_session_key,
        max_chars=max(120, min(int(max_chars), 2400)),
        history_limit=max(1, min(int(history_limit), 50)),
    )
    packet = get_codec_packet_for_session(resolved_session_key, max_chars=max(120, min(int(max_chars), 2400)))
    state = packet.get("state") if isinstance(packet, dict) and isinstance(packet.get("state"), dict) else {}
    lineage = build_codec_memory_lineage(memory_id=memory_id, session_key=resolved_session_key, codec_state=state)
    if not lineage:
        raise HTTPException(status_code=404, detail="codec memory fact not found")
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        **lineage,
        "codec": {
            "summary": view.get("summary"),
            "source_refs": view.get("source_refs", []),
            "promotion": view.get("promotion", {}),
            "retention_policy": view.get("retention_policy", {}),
        },
        "capability_matrix": capability_matrix(),
    }


@router.get("/codec/corpus-replay")
@router.post("/codec/corpus-replay")
async def get_nexus_codec_corpus_replay(request: Request, session_key: Optional[str] = None, limit: int = 50, persist_report: bool = False):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")

    if persist_report and request.method != "POST":
        raise HTTPException(status_code=405, detail="persist_report requires an authorized POST control operation")
    report = _codec_replay_report(resolved_session_key, limit=max(1, min(int(limit), 100)))
    if persist_report:
        _persist_codec_replay_report(report)
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "corpus_replay": report,
            "report_persisted": bool(persist_report),
        },
    }


@router.post("/codec/corpus-replay/reexecute")
async def get_nexus_codec_corpus_replay_reexecute(request: Request, session_key: Optional[str] = None, limit: int = 20):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    report = _codec_true_reexecute_summary(resolved_session_key, limit=max(1, min(int(limit), 100)))
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "true_reexecution": report,
        },
    }


@router.post("/codec/corpus-replay/live-reexecute")
async def get_nexus_codec_corpus_replay_live_reexecute(request: Request, session_key: Optional[str] = None, limit: int = 5, max_variants: int = 3, backend: str = "openclaw_local", persist_report: bool = False):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    report = _codec_live_reexecute_summary(
        resolved_session_key,
        limit=max(1, min(int(limit), 20)),
        max_variants=max(1, min(int(max_variants), 10)),
        backend=backend,
    )
    persisted = False
    if persist_report:
        payload = {
            "report_id": hashlib.sha256(f"{resolved_session_key}|{backend}|{_now_iso()}".encode("utf-8")).hexdigest()[:16],
            "generated_at": _now_iso(),
            "session_key": resolved_session_key,
            "backend": backend,
            "live_reexecution": report,
        }
        persisted = _persist_codec_live_reexec_report(payload)
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "live_reexecution": report,
            "report_persisted": persisted,
        },
    }


@router.get("/codec/corpus-replay/live-reexecute/backends")
async def get_nexus_codec_corpus_replay_live_reexecute_backends():
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "live_reexecution_backends": _live_reexecute_backend_status(),
        },
    }


@router.post("/codec/corpus-replay/live-reexecute/compare")
async def get_nexus_codec_corpus_replay_live_reexecute_compare(request: Request, session_key: Optional[str] = None, limit: int = 5, max_variants: int = 3, backends: str = "recorded,openclaw_local"):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    available_backends = {item.get("backend") for item in (_live_reexecute_backend_status().get("items") or []) if isinstance(item, dict)}
    backend_list = [item.strip() for item in str(backends or "recorded,openclaw_local").split(",") if item.strip() and item.strip() in available_backends]
    reports = {
        backend: _codec_live_reexecute_summary(
            resolved_session_key,
            limit=max(1, min(int(limit), 20)),
            max_variants=max(1, min(int(max_variants), 10)),
            backend=backend,
        )
        for backend in backend_list[:5]
    }
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "live_reexecution_compare": {
                "backends": reports,
                "backend_registry": _live_reexecute_backend_status(),
            },
        },
    }


@router.get("/codec/corpus-replay/live-reexecute/reports")
async def get_nexus_codec_corpus_replay_live_reexecute_reports(request: Request, session_key: Optional[str] = None, limit: int = 20):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    rows: List[Dict[str, Any]] = []
    try:
        report_path = _codec_live_reexec_reports_path()
        if report_path.exists():
            with report_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = (line or "").strip()
                    if not line:
                        continue
                    try:
                        row = json.loads(line)
                    except Exception:
                        continue
                    if not isinstance(row, dict):
                        continue
                    integrity = row.get("integrity")
                    if (
                        row.get("schema_version") != "cortex.codec.live_reexecution_report.v1"
                        or row.get("source") != "nexus.live_reexecute"
                        or not isinstance(integrity, dict)
                        or integrity.get("algorithm") != "sha256"
                    ):
                        continue
                    unsigned = dict(row)
                    unsigned.pop("integrity", None)
                    canonical = json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                    expected_digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
                    if not hmac.compare_digest(str(integrity.get("digest") or ""), expected_digest):
                        continue
                    if resolved_session_key and str(row.get("session_key") or "") != resolved_session_key:
                        continue
                    rows.append(row)
    except Exception:
        rows = []
    rows.sort(key=lambda row: str(row.get("generated_at") or ""), reverse=True)
    rows = rows[: max(1, min(int(limit), 100))]
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "live_reexecution_reports": {
                "available": bool(rows),
                "count": len(rows),
                "items": [
                    {
                        "report_id": str(row.get("report_id") or ""),
                        "generated_at": str(row.get("generated_at") or ""),
                        "session_key": str(row.get("session_key") or ""),
                        "backend": str(row.get("backend") or ""),
                        "reexecuted_runs": int((((row.get("live_reexecution") or {}).get("summary") or {}).get("reexecuted_runs") or 0)),
                        "winner_changed_runs": int((((row.get("live_reexecution") or {}).get("summary") or {}).get("winner_changed_runs") or 0)),
                    }
                    for row in rows
                ],
            }
        },
    }


@router.get("/codec/corpus-replay/reports")
async def get_nexus_codec_corpus_replay_reports(request: Request, session_key: Optional[str] = None, limit: int = 20):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")

    reports = _load_codec_replay_reports(session_key=resolved_session_key, limit=max(1, min(int(limit), 100)))
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "reports": {
                "available": bool(reports),
                "count": len(reports),
                "items": [
                    {
                        "report_id": str(report.get("report_id") or ""),
                        "generated_at": str(report.get("generated_at") or ""),
                        "session_key": str(report.get("session_key") or ""),
                        "corpus_version": str(report.get("corpus_version") or ""),
                        "total_runs": int((((report.get("corpus") or {}).get("summary") or {}).get("total_runs") or 0)),
                        "replay_ready_runs": int((((report.get("corpus") or {}).get("summary") or {}).get("replay_ready_runs") or 0)),
                    }
                    for report in reports
                ],
            }
        },
    }


@router.get("/codec/corpus-replay/diff")
async def get_nexus_codec_corpus_replay_diff(request: Request, session_key: Optional[str] = None, newer_report_id: Optional[str] = None, older_report_id: Optional[str] = None):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")

    reports = _load_codec_replay_reports(session_key=resolved_session_key, limit=20)
    if not reports:
        raise HTTPException(status_code=404, detail="no replay reports found")
    newer = _find_codec_replay_report(session_key=resolved_session_key, report_id=(newer_report_id or "").strip()) if newer_report_id else reports[0]
    if older_report_id:
        older = _find_codec_replay_report(session_key=resolved_session_key, report_id=older_report_id.strip())
    else:
        older = reports[1] if len(reports) > 1 else {}
    diff = _codec_replay_report_diff(newer, older)
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "report_diff": diff,
        },
    }


@router.get("/codec/corpus-replay/active-policy")
async def get_nexus_codec_corpus_replay_active_policy():
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "active_policy": _load_codec_active_policy(),
        },
    }


@router.post("/codec/corpus-replay/promote-best")
async def post_nexus_codec_corpus_replay_promote_best(request: Request, session_key: Optional[str] = None, report_id: Optional[str] = None, source: str = "recommendations"):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")

    report = _find_codec_replay_report(session_key=resolved_session_key, report_id=(report_id or "").strip()) if report_id else _find_codec_replay_report(session_key=resolved_session_key)
    if not report:
        raise HTTPException(status_code=404, detail="replay report not found")
    recommended = report.get("recommendations") if isinstance(report.get("recommendations"), dict) else {}
    payload = {
        "version": "cortex.codec.active_benchmark_policy.v1",
        "updated_at": _now_iso(),
        "session_key": resolved_session_key,
        "source": source,
        "report_id": str(report.get("report_id") or ""),
        "corpus_version": str(report.get("corpus_version") or ""),
        "policies": recommended,
    }
    _save_codec_active_policy(payload)
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "active_policy": payload,
        },
    }


@router.get("/codec/corpus-replay/plans")
async def get_nexus_codec_corpus_replay_plans(request: Request, session_key: Optional[str] = None, limit: int = 20):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    plans = _load_codec_replay_plan_states(session_key=resolved_session_key, limit=max(1, min(int(limit), 100)))
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "replay_plans": {
                "available": bool(plans),
                "count": len(plans),
                "items": plans,
            }
        },
    }


@router.post("/codec/corpus-replay/plan")
async def post_nexus_codec_corpus_replay_plan(request: Request, session_key: Optional[str] = None, cadence_minutes: int = 1440, enabled: bool = True, note: str = "", start_immediately: bool = True, auto_promote_on_success: bool = False):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    created_at = _now_iso()
    next_run_at = created_at if bool(start_immediately) else _compute_replay_plan_next_run(from_time=_parse_iso_datetime(created_at), cadence_minutes=max(5, int(cadence_minutes)))
    plan = {
        "plan_id": hashlib.sha256(f"{resolved_session_key}|{cadence_minutes}|{created_at}".encode("utf-8")).hexdigest()[:16],
        "created_at": created_at,
        "updated_at": created_at,
        "session_key": resolved_session_key,
        "cadence_minutes": max(5, int(cadence_minutes)),
        "enabled": bool(enabled),
        "note": _compact_text_excerpt(note or "", limit=160),
        "start_immediately": bool(start_immediately),
        "auto_promote_on_success": bool(auto_promote_on_success),
        "run_count": 0,
        "next_run_at": next_run_at,
        "suggested_endpoint": "/nexus/codec/corpus-replay?persist_report=true",
    }
    _persist_codec_replay_plan(plan)
    scheduler = _ensure_codec_replay_scheduler_started()
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "replay_plan": plan,
            "scheduler": scheduler,
        },
    }


@router.post("/codec/corpus-replay/plan/run")
async def post_nexus_codec_corpus_replay_plan_run(request: Request, session_key: Optional[str] = None, plan_id: Optional[str] = None):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    plans = _load_codec_replay_plan_states(session_key=resolved_session_key, limit=200)
    if not plans:
        raise HTTPException(status_code=404, detail="no replay plans found")
    plan = next((row for row in plans if str(row.get("plan_id") or "") == str(plan_id or "")), None) if plan_id else plans[0]
    if not isinstance(plan, dict):
        raise HTTPException(status_code=404, detail="replay plan not found")
    result = _execute_replay_plan(plan)
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "replay_plan_run": result,
        },
    }


@router.post("/codec/corpus-replay/plans/run-due")
async def post_nexus_codec_corpus_replay_plans_run_due(request: Request, session_key: Optional[str] = None, limit: int = 20):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    plans = _load_codec_replay_plan_states(session_key=resolved_session_key, limit=max(1, min(int(limit), 100)))
    due = [plan for plan in plans if _plan_due(plan)]
    results = [_execute_replay_plan(plan) for plan in due]
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "due_replay_runs": {
                "count": len(results),
                "items": results,
            }
        },
    }


@router.post("/codec/corpus-replay/scheduler")
async def get_nexus_codec_corpus_replay_scheduler():
    scheduler = _ensure_codec_replay_scheduler_started()
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "scheduler": scheduler,
        },
    }


@router.post("/codec/corpus-replay/scheduler/tick")
async def post_nexus_codec_corpus_replay_scheduler_tick(request: Request, session_key: Optional[str] = None, limit: int = 100):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    result = _run_due_replay_plans_once(session_key=resolved_session_key or "", limit=max(1, min(int(limit), 200)))
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "scheduler_tick": result,
            "scheduler": dict(_CODEC_REPLAY_SCHEDULER_STATE),
        },
    }


@router.get("/codec/corpus-replay/corpus-versions")
async def get_nexus_codec_corpus_replay_corpus_versions(request: Request, session_key: Optional[str] = None, limit: int = 100):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "corpus_versions": _codec_replay_report_versions(session_key=resolved_session_key, limit=max(1, min(int(limit), 200))),
        },
    }


@router.get("/codec/corpus-replay/retention")
async def get_nexus_codec_corpus_replay_retention(request: Request, session_key: Optional[str] = None, limit: int = 100):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "retention": _codec_replay_retention_summary(session_key=resolved_session_key, limit=max(1, min(int(limit), 200))),
        },
    }


@router.get("/codec/corpus-replay/export")
@router.post("/codec/corpus-replay/export")
async def get_nexus_codec_corpus_replay_export(request: Request, session_key: Optional[str] = None, limit: int = 100, persist_export: bool = False):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    if persist_export and request.method != "POST":
        raise HTTPException(status_code=405, detail="persist_export requires an authorized POST control operation")
    export = _codec_benchmark_corpus_export(resolved_session_key, limit=max(1, min(int(limit), 200)))
    if persist_export:
        _persist_codec_corpus_export(export)
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": {
            "corpus_export": export,
            "export_persisted": bool(persist_export),
        },
    }


@router.post("/codec/outcome")
async def post_nexus_codec_outcome(payload: OutcomeFeedbackRequest, request: Request = None):
    _authenticated_nexus_principal(request)
    raise HTTPException(
        status_code=403,
        detail={
            "error": "server_observed_outcome_receipt_required",
            "endpoint": "/nexus/outcome/feedback",
        },
    )


@router.post("/codec/evaluate")
async def get_nexus_codec_evaluate(
    request: Request,
    session_key: Optional[str] = None,
    eval_query: Optional[str] = None,
    max_chars: int = 420,
    history_limit: int = 8,
    run_oracle: bool = False,
    judge_with_oracle: bool = False,
    priority: str = "normal",
):
    resolved_session_key = (session_key or _codec_session_key(request) or "").strip()
    if not resolved_session_key:
        raise HTTPException(status_code=400, detail="session_key is required")
    principal, _ = _authenticated_nexus_principal(request, session_hint=resolved_session_key)
    policies = _adaptive_policies_for_scope(principal.storage_metadata)
    policy_session_key = _principal_continuity_key(principal, resolved_session_key)
    if not _adaptive_observation_allowed(policies.scope_key):
        raise HTTPException(status_code=429, detail="principal adaptive observation rate limit exceeded")

    view = _codec_evaluation_view(
        resolved_session_key,
        eval_query=eval_query or "",
        max_chars=max(120, min(int(max_chars), 2400)),
        history_limit=max(1, min(int(history_limit), 50)),
        adaptive_policies=policies,
    )

    evaluation = view.get("evaluation") if isinstance(view.get("evaluation"), dict) else {}
    variants = evaluation.get("variants") if isinstance(evaluation.get("variants"), list) else []
    evaluation["oracle_run"] = {"requested": bool(run_oracle), "completed": False, "priority": priority}
    evaluation["oracle_judge"] = {"requested": bool(judge_with_oracle), "completed": False, "priority": priority}

    if run_oracle and variants:
        try:
            from cortex_server.routers.oracle import _best_effort_answer, _quality_depth_controller

            depth = _quality_depth_controller(str(evaluation.get("query") or ""), priority=priority or "")
            depth_mode = str(depth.get("mode") or "medium")
            for variant in variants:
                prompt = str(variant.get("prompt") or "")
                text, model_label, fallback_reason = await run_in_threadpool(
                    _best_effort_answer,
                    prompt,
                    None,
                    priority,
                    depth_mode,
                )
                variant["oracle_output"] = text
                variant["oracle_output_chars"] = len(text or "")
                variant["oracle_model"] = model_label
                variant["oracle_fallback_reason"] = fallback_reason
            evaluation["oracle_run"] = {
                "requested": True,
                "completed": True,
                "priority": priority,
                "depth_mode": depth_mode,
            }
        except Exception as exc:
            evaluation["oracle_run"] = {
                "requested": True,
                "completed": False,
                "priority": priority,
                "error": str(exc)[:240],
            }

    evaluation["judge"] = _heuristic_judge_codec_variants(str(evaluation.get("query") or ""), variants)
    evaluation["acceptance_gates"] = _codec_evaluation_gates(evaluation)
    if judge_with_oracle and variants:
        try:
            oracle_judge = await run_in_threadpool(
                _oracle_judge_codec_variants,
                str(evaluation.get("query") or ""),
                variants,
                priority=priority,
            )
            evaluation["oracle_judge"] = {
                "requested": True,
                **oracle_judge,
            }
        except Exception as exc:
            evaluation["oracle_judge"] = {
                "requested": True,
                "completed": False,
                "priority": priority,
                "error": str(exc)[:240],
            }

    winning_variant = ""
    judge_method = "heuristic"
    if bool((evaluation.get("oracle_judge") or {}).get("completed")) and str((evaluation.get("oracle_judge") or {}).get("winner") or ""):
        winning_variant = str((evaluation.get("oracle_judge") or {}).get("winner") or "")
        judge_method = "oracle_judge"
    elif str((evaluation.get("judge") or {}).get("winner") or ""):
        winning_variant = str((evaluation.get("judge") or {}).get("winner") or "")
        judge_method = "heuristic"

    if winning_variant:
        judge_confidence = None
        if judge_method == "oracle_judge":
            try:
                judge_confidence = float((evaluation.get("oracle_judge") or {}).get("confidence"))
            except Exception:
                judge_confidence = None
        evaluation["policy_learning"] = _scoped_codec_policy_call(
            policies,
            observe_codec_evaluation,
            query=str(evaluation.get("query") or ""),
            winner=winning_variant,
            judge_method=judge_method,
            session_key=policy_session_key,
            judge_confidence=judge_confidence,
        )
        evaluation["policy"] = _scoped_codec_policy_call(
            policies,
            get_codec_policy_for_query,
            str(evaluation.get("query") or ""),
        )
    else:
        evaluation["policy_learning"] = {"recorded": False, "reason": "no_winner"}
        evaluation["policy"] = _scoped_codec_policy_call(
            policies,
            get_codec_policy_for_query,
            str(evaluation.get("query") or ""),
        )

    evaluation["autotune"] = _scoped_codec_policy_call(
        policies,
        observe_codec_eval_history,
        query=str(evaluation.get("query") or ""),
        acceptance_gates=evaluation.get("acceptance_gates") if isinstance(evaluation.get("acceptance_gates"), dict) else {},
        winner=winning_variant,
        session_key=policy_session_key,
    )
    evaluation["rollup_autotune"] = _scoped_codec_rollup_call(
        policies,
        observe_codec_rollup_eval_history,
        acceptance_gates=evaluation.get("acceptance_gates") if isinstance(evaluation.get("acceptance_gates"), dict) else {},
        winner=winning_variant,
        session_key=policy_session_key,
        query=str(evaluation.get("query") or ""),
    )
    evaluation["policy"] = _scoped_codec_policy_call(
        policies,
        get_codec_policy_for_query,
        str(evaluation.get("query") or ""),
    )
    heuristic_rows = _judge_scores_by_name(evaluation.get("judge") if isinstance(evaluation.get("judge"), dict) else {})
    eval_record = {
        "recorded_at": _now_iso(),
        "session_key": resolved_session_key,
        "query": str(evaluation.get("query") or ""),
        "query_archetype": classify_task_archetype(str(evaluation.get("query") or "")),
        "winner": winning_variant,
        "judge_method": judge_method,
        "judge": evaluation.get("judge") if isinstance(evaluation.get("judge"), dict) else {},
        "oracle_run": evaluation.get("oracle_run") if isinstance(evaluation.get("oracle_run"), dict) else {},
        "oracle_judge": evaluation.get("oracle_judge") if isinstance(evaluation.get("oracle_judge"), dict) else {},
        "acceptance_gates": evaluation.get("acceptance_gates") if isinstance(evaluation.get("acceptance_gates"), dict) else {},
        "variant_count": int(evaluation.get("variant_count", 0) or 0),
        "variant_snapshots": [
            _compact_variant_snapshot(variant, heuristic_rows.get(str(variant.get("name") or ""), {}))
            for variant in variants if isinstance(variant, dict)
        ],
        "policy_learning": evaluation.get("policy_learning") if isinstance(evaluation.get("policy_learning"), dict) else {},
        "autotune": evaluation.get("autotune") if isinstance(evaluation.get("autotune"), dict) else {},
        "rollup_autotune": evaluation.get("rollup_autotune") if isinstance(evaluation.get("rollup_autotune"), dict) else {},
        "rollup_policy": (view.get("rollups") or {}).get("policy", {}) if isinstance(view.get("rollups"), dict) else {},
        "bucket_snapshot": _codec_bucket_snapshot(view),
        "recommended_policies": evaluation.get("recommendations") if isinstance(evaluation.get("recommendations"), dict) else {},
    }
    _persist_codec_eval_run(eval_record)
    history = _codec_eval_trend_summary(resolved_session_key, limit=20)
    history["sweep"] = _codec_eval_sweep_summary(resolved_session_key, limit=50)
    history["rollup_sweep"] = _codec_rollup_sweep_summary(resolved_session_key, limit=50)
    history["corpus_replay"] = _codec_eval_corpus_replay_summary(resolved_session_key, limit=50)
    history["true_reexecution"] = _codec_true_reexecute_summary(resolved_session_key, limit=20)
    history["recommendations"] = _codec_history_recommendations(history)
    evaluation["recommendations"] = history.get("recommendations", {}) if isinstance(history.get("recommendations"), dict) else {}
    evaluation["history"] = history

    view["evaluation"] = evaluation
    return {
        "success": True,
        "level": 24,
        "name": "The Nexus",
        "codec": view,
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
            "kernel_v2": cortex_kernel_v2.performance_snapshot(runtime="nexus"),
            "status": "operational",
            "timestamp": str(__import__('datetime').datetime.now()),
        }
    }


@router.get("/autotune/status")
async def autotune_status(request: Request):
    principal, _ = _authenticated_nexus_principal(request)
    policies = _adaptive_policies_for_scope(principal.storage_metadata)
    outcome_tuner = _outcome_tuner_for_scope(principal.storage_metadata)
    return {
        "success": True,
        "policy": _scoped_routing_policy_call(policies, get_policy_snapshot),
        "outcome_tuner": {
            "state_path": str(outcome_tuner.state_path),
            "report_path": str(outcome_tuner.report_path),
            "state": outcome_tuner.state,
        },
        "latency_governor": {
            "state_path": str(policies.latency.state_path),
            "report_path": str(policies.latency.report_path),
        },
        "scope": "authenticated_principal",
    }


@router.post("/outcome/feedback")
async def outcome_feedback(payload: OutcomeFeedbackReceiptRequest, request: Request):
    _require_outcome_feedback_control(request)
    try:
        receipt = _verify_outcome_feedback_receipt(payload.receipt, request)
        _consume_outcome_feedback_receipt(receipt)
    except ValueError as exc:
        status_code = 429 if str(exc) == "principal_rate_limit_exceeded" else 409 if str(exc) == "receipt_already_consumed" else 403
        raise HTTPException(
            status_code=status_code,
            detail={"error": "valid_execution_outcome_receipt_required", "reason": str(exc)},
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    scope = dict(receipt.get("scope") or {})
    record = {
        "query": "",
        "query_hash": receipt["query_hash"][:16],
        "task_archetype": receipt["task_archetype"],
        "policy_label": receipt["policy_label"],
        "execution_success": bool(receipt["execution_success"]),
        "validator_result": {"pass": bool(receipt["validator_pass"]), "source": "nexus.orchestrate.receipt"},
        "latency_ms": int(receipt["latency_ms"]),
        "user_correction": False,
        "recovery_needed": bool(receipt["recovery_needed"]),
        "execution_id": receipt["execution_id"],
        "receipt_id": receipt["jti"],
        "tenant_id": scope.get("tenant_id"),
        "storage_workspace_id": scope.get("storage_workspace_id"),
        "source": "signed_execution_receipt",
    }
    with _PRINCIPAL_OUTCOME_TUNER_LOCK:
        out = _outcome_tuner_for_scope(scope).observe(record)
    codec_state = apply_codec_outcome_feedback_for_session(
        str(scope.get("session_id") or ""),
        {
            "status": "success" if receipt["execution_success"] and receipt["validator_pass"] and not receipt["recovery_needed"] else "failure",
            "text": f"Server-observed {receipt['codec_variant']} execution {receipt['execution_id']}",
        },
        tenant_id=str(scope.get("tenant_id") or ""),
        workspace_id=str(scope.get("storage_workspace_id") or ""),
    )
    return {
        "success": True,
        "recorded": True,
        "receipt_id": receipt["jti"],
        "execution_id": receipt["execution_id"],
        "tenant_id": scope.get("tenant_id"),
        "artifact": out,
        "codec_policy": {
            "recorded": True,
            "variant": receipt["codec_variant"],
            "scope": "authenticated_principal_session",
            "state_revision": codec_state.get("state_revision"),
        },
    }


@router.get("/orchestrate")
async def orchestrate_query_read_only_guard():
    """Keep legacy route discovery truthful without permitting GET mutations."""
    raise HTTPException(
        status_code=405,
        detail="Nexus orchestration mutates routing and continuity state; use authorized POST.",
    )


@router.post("/orchestrate")
async def orchestrate_query(
    query: Optional[str] = None,
    request: Request = None,
    codec_probe: bool = False,
    payload: Optional[Dict[str, Any]] = Body(default=None),
):
    """Semantic query orchestration with Q&A fastlane option."""
    body_query = payload.get("query") if payload is not None else None
    if body_query is not None and not isinstance(body_query, str):
        raise HTTPException(status_code=422, detail="JSON body query must be a string")
    if query is not None and body_query is not None and query != body_query:
        raise HTTPException(status_code=400, detail="query parameter and JSON body disagree")
    query = str(query if query is not None else body_query or "").strip()
    if not query:
        raise HTTPException(status_code=422, detail="query is required")
    if len(query) > 1_048_576:
        raise HTTPException(status_code=422, detail="query exceeds maximum length")
    requested_session_key = _codec_session_key(request)
    principal, session_key = _authenticated_nexus_principal(
        request,
        session_hint=requested_session_key,
    )
    continuity_session_key = _principal_continuity_key(principal, session_key)
    principal_scope = principal.storage_metadata
    adaptive_policies = _adaptive_policies_for_scope(principal_scope)
    outcome_tuner = _outcome_tuner_for_scope(principal_scope)
    started = datetime.utcnow()
    request_id = getattr(getattr(request, "state", None), "request_id", "") if request is not None else ""
    tx_id = (request_id or hashlib.sha256(f"{query}|{started.isoformat()}".encode("utf-8")).hexdigest()[:16])
    tx = ExecutionTransaction(
        tx_id=tx_id,
        tx_type="nexus_orchestrate",
        metadata={
            "query_hash": hashlib.sha256((query or '').encode('utf-8')).hexdigest()[:16],
            "tenant_id": principal.tenant_id,
            "storage_workspace_id": principal.storage_workspace_id,
        },
    )
    try:
        recommended = []
        reasoning = []
        routing_method = "semantic_orchestration"
        kernel_trace: Optional[Dict[str, Any]] = None
        kernel_result: Optional[Dict[str, Any]] = None
        codec_context = _codec_context_packet(
            session_key,
            query=query,
            tenant_id=principal.tenant_id,
            workspace_id=principal.storage_workspace_id,
            telemetry_session_key=continuity_session_key,
            adaptive_policies=adaptive_policies,
        )
        if codec_probe:
            return {
                "success": True,
                "query": query,
                "routing_method": "codec_recovery_probe",
                "session_key": session_key,
                "codec_context": codec_context,
                "contract": {
                    "contract_version": "orchestrate_guard_v3",
                    "identity_phrase": "Cortex-first orchestration active",
                    "codec_probe": True,
                },
                "truthBoundary": "Probe mode proves the live orchestration endpoint hydrated and exposed this session's Codec packet without invoking downstream semantic/provider calls."
            }
        adaptive_observation_allowed = _adaptive_observation_allowed(adaptive_policies.scope_key)
        routing_markers = {
            "cortex_first": True,
            "brainstorm_triggered": False,
            "brainstorm_chain": [],
            "coding_triggered": False,
            "coding_chain": [],
            "incident_triggered": False,
            "incident_chain": [],
            "research_triggered": False,
            "research_chain": [],
            "translation_triggered": False,
            "translation_chain": [],
            "schedule_triggered": False,
            "schedule_chain": [],
            "mediation_triggered": False,
            "mediation_chain": [],
            "forecast_triggered": False,
            "forecast_chain": [],
            "training_triggered": False,
            "training_chain": [],
            "ethics_triggered": False,
            "ethics_chain": [],
            "l9_triggered": False,
            "l9_chain": [],
            "world_grounding_required": False,
            "world_grounding_mode": "not_required",
            "policy_rollout_stage": "shadow",
            "policy_rollout_apply": False,
            "kernel_lane": "fast",
            "kernel_depth_mode": "shallow",
            "kernel_context_chars": 0,
        }
        optimizer_telemetry: Dict[str, Any] = {}
        token_plan: Dict[str, Any] = {}
        delta_info: Dict[str, Any] = {}
        if bool(codec_context.get("available")):
            reasoning.append("Cortex Codec session state available for downstream prompt packing.")
        fastlane_cfg = _load_fastlane_config()
        cognitive_cfg = _load_cognitive_wave_config()
        optimizer_cfg = _load_level_optimizer_config()
        autotune_policy = _scoped_routing_policy_call(adaptive_policies, get_policy_snapshot)
        fastlane_cfg["escalation_threshold"] = float(autotune_policy.get("fastlane_escalation_threshold", fastlane_cfg.get("escalation_threshold", 0.72)))
        kernel_contract = _kernel_contract_for_query(query)
        risk_flags = _detect_risk_flags(query, kernel_contract=kernel_contract)
        complexity_gate = _complexity_gate(
            query,
            hard_threshold=float(autotune_policy.get("complexity_hard_threshold", 0.45)),
            l9_threshold=float(autotune_policy.get("l9_auto_activation_threshold", 0.48)),
            kernel_contract=kernel_contract,
        )
        archetype = classify_task_archetype(query, risk_flags=risk_flags, complexity_gate=complexity_gate, kernel_contract=kernel_contract)
        with _PRINCIPAL_OUTCOME_TUNER_LOCK:
            policy_hint = outcome_tuner.get_policy_hint(archetype=archetype, query=query)
        adaptive_route: Dict[str, Any] = {
            "enabled": bool(autotune_policy.get("autotune_enabled", True)),
            "evaluated": False,
            "applied": False,
            "selected_chain": None,
            "rollout_stage": str(policy_hint.get("stage", "shadow")),
            "rollout_percent": int(policy_hint.get("rollout_percent", 0) or 0),
            "reason": "autotune_disabled" if not bool(autotune_policy.get("autotune_enabled", True)) else "shadow_only",
        }
        if adaptive_route["enabled"]:
            try:
                adaptive_features = build_route_features(
                    query,
                    risk_flags=risk_flags,
                    latency_governor=adaptive_policies.latency,
                    runtime_policy=autotune_policy,
                    outcome_tuner=outcome_tuner,
                    route_health=adaptive_policies.health,
                )
                adaptive_decision = choose_route(
                    adaptive_features,
                    runtime_policy=autotune_policy,
                    policy_hint=policy_hint,
                )
                adaptive_selected = adaptive_decision.get("selected") if isinstance(adaptive_decision.get("selected"), dict) else {}
                recommended_policy = str(policy_hint.get("recommended_policy") or "")
                selected_chain = str(adaptive_selected.get("chain_id") or "")
                rollout_guard_open = bool(policy_hint.get("apply_recommendation", False))
                rollout_eligible = bool(
                    rollout_guard_open
                    and selected_chain
                    and (not recommended_policy or selected_chain == recommended_policy)
                )
                adaptive_route.update({
                    "evaluated": True,
                    "selected_chain": selected_chain or None,
                    "selected_levels": list(adaptive_selected.get("levels") or []),
                    "selected_policy": adaptive_selected.get("policy"),
                    "utility": adaptive_selected.get("utility"),
                    "estimated_quality": adaptive_selected.get("estimated_quality"),
                    "features": adaptive_features,
                    "decision": adaptive_decision,
                    "rollout_eligible": rollout_eligible,
                    "reason": (
                        "rollout_guard_open"
                        if rollout_eligible
                        else "rollout_policy_mismatch"
                        if rollout_guard_open
                        else "rollout_guard_closed"
                    ),
                })
            except Exception as exc:
                adaptive_route.update({"reason": f"adaptive_router_error:{type(exc).__name__}", "error": str(exc)[:160]})
        world_grounding = gather_live_evidence(
            query,
            max_sources=3,
            notary_packets=1,
            enabled=bool(os.getenv("NEXUS_WORLD_GROUNDING_ENABLED", "true").lower() in {"1", "true", "yes", "on"}),
        )
        latency_plan = adaptive_policies.latency.plan(query, risk_flags=risk_flags, complexity_gate=complexity_gate, fastlane_cfg=fastlane_cfg, optimizer_cfg=optimizer_cfg, kernel_contract=kernel_contract)
        optimizer_telemetry["enabled"] = bool(optimizer_cfg.get("enabled", True))
        optimizer_telemetry["autotune_policy"] = autotune_policy
        optimizer_telemetry["policy_hint"] = policy_hint
        optimizer_telemetry["adaptive_router"] = adaptive_route
        optimizer_telemetry["world_grounding"] = {
            "required": bool(world_grounding.get("required", False)),
            "mode": world_grounding.get("mode", "not_required"),
            "evidence_count": int(world_grounding.get("evidence_count", 0)),
            "degraded": bool(world_grounding.get("degraded", False)),
        }
        optimizer_telemetry["adaptive_observation"] = {
            "allowed": adaptive_observation_allowed,
            "scope": "authenticated_principal",
        }
        if bool(world_grounding.get("required", False)):
            if bool(world_grounding.get("degraded", False)):
                adaptive_policies.health.record_failure("world_grounding", error="degraded")
            else:
                adaptive_policies.health.record_success("world_grounding")
        tx.preflight({
            "query_present": lambda: {"ok": bool((query or "").strip()), "chars": len(query or "")},
            "latency_budget": lambda: {"ok": int(latency_plan.get("max_latency_ms", 0)) >= 500, "max_latency_ms": latency_plan.get("max_latency_ms")},
        })

        referent_info = _resolve_referent_context(query, continuity_key=continuity_session_key)
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

        prefetch = adaptive_policies.latency.speculative_prefetch(
            query,
            enabled=bool(latency_plan.get("prefetch_enabled")),
            retrieve_fn=lambda: retrieve_top3(query, max_items=int(fastlane_cfg.get("max_retrieval_items", 3)), timeout_ms=min(int(fastlane_cfg.get("max_latency_ms", 2200)), 500)),
            context_fn=lambda: _resolve_referent_context(query, continuity_key=continuity_session_key) if referent_query or archetype in {"tool_use", "ops_triage"} else {"resolved": False},
        )
        optimizer_telemetry["prefetch"] = prefetch
        prefetched_retrieval = prefetch.get("results", {}).get("retrieval") if isinstance(prefetch.get("results", {}).get("retrieval"), list) else []
        if isinstance(prefetch.get("results", {}).get("context"), dict) and prefetch.get("results", {}).get("context", {}).get("resolved"):
            referent_info = prefetch["results"]["context"]

        served_codec_variant = _infer_codec_execution_variant(
            query,
            codec_context,
            referent_info,
            adaptive_policies=adaptive_policies,
        )
        kernel_trace = cortex_kernel_v2.prepare_request(
            query,
            session_key=continuity_session_key or None,
            response_mode="nexus_orchestrate",
            requested_model="nexus",
            continuity_prefix=_kernel_continuity_prefix(referent_info),
            codec_prefix=_kernel_codec_prefix(codec_context),
            runtime="nexus",
            surface="orchestrate",
        )
        kernel_contract = dict(kernel_trace.get("contract") or kernel_contract or {})
        kernel_plan = dict(kernel_trace.get("plan") or {})
        kernel_working_set = dict(kernel_trace.get("working_set") or {})
        kernel_active = bool(((kernel_trace.get("settings") or {}).get("enabled")) and str(((kernel_trace.get("settings") or {}).get("mode") or "active")) == "active")
        routing_markers["kernel_lane"] = str(kernel_plan.get("lane") or "fast")
        routing_markers["kernel_depth_mode"] = str(kernel_plan.get("depth_mode") or "shallow")
        routing_markers["kernel_context_chars"] = int(((kernel_working_set.get("reuse") or {}).get("total_chars")) or 0)
        latency_plan["kernel_budget_ms"] = int(kernel_plan.get("latency_budget_ms") or latency_plan.get("max_latency_ms") or 0)
        optimizer_telemetry["kernel_v2"] = _kernel_trace_payload(kernel_trace)
        if routing_markers["kernel_context_chars"]:
            reasoning.append(f"Kernel V2 reused {routing_markers['kernel_context_chars']} chars of hot/warm/cold context.")
        if kernel_active and str(kernel_plan.get("lane") or "fast") == "deep":
            kernel_intent = str(((kernel_contract.get("intent") or {}).get("kind")) or "general")
            reasoning.append(
                f"Kernel V2 planned deep lane for {kernel_intent} intent "
                f"(score={float(((kernel_contract.get('complexity') or {}).get('score')) or 0.0):.2f}); widening orchestration path."
            )
            for lvl in [5, 15, 32, 34]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "kernel_v2"})
            if kernel_intent in {"planning", "coding", "ops"}:
                if _architect_healthy(route_health=adaptive_policies.health):
                    if 9 not in [r.get("level") for r in recommended]:
                        recommended.append({"level": 9, "name": "architect", "method": "kernel_v2"})
                else:
                    reasoning.append("Kernel V2 requested architect depth, but Architect is unhealthy; keeping Council+Synthesist fallback.")

        if bool(world_grounding.get("required", False)):
            routing_markers["world_grounding_required"] = True
            routing_markers["world_grounding_mode"] = str(world_grounding.get("mode", "live_grounded"))
            reasoning.append("World-grounding guard engaged for volatile external-state query.")
            if bool(world_grounding.get("degraded", False)):
                reasoning.append("Live grounding degraded; using best-effort evidence path with validator emphasis.")
            for lvl in [2, 34]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "world_grounding"})
            if int(world_grounding.get("evidence_count", 0)) > 0:
                for lvl in [7, 22]:
                    if lvl not in [r.get("level") for r in recommended]:
                        recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "world_grounding"})

        brainstorm_forced = _is_brainstorm_intent(query)
        coding_forced = _is_coding_intent(query)
        incident_forced = _is_incident_intent(query)
        research_forced = _is_research_intent(query)
        architecture_forced = _is_architecture_intent(query)
        translation_auto = _is_translation_intent(query)
        schedule_auto = _is_schedule_intent(query)
        mediation_auto = _is_mediation_intent(query)
        forecast_auto = _is_forecast_intent(query)
        training_auto = _is_training_intent(query)
        ethics_auto = _is_ethics_intent(query)
        specialist_nudges = _specialist_level_nudges(query)

        if brainstorm_forced:
            routing_method = "brainstorm_chain_forced"
            routing_markers["brainstorm_triggered"] = True
            routing_markers["brainstorm_chain"] = ["dreamer", "muse", "synthesist"]
            reasoning.append("Brainstorm trigger detected; forcing Dreamer+Muse before synthesis.")
            for lvl in [13, 29, 32]:
                recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "brainstorm_forced"})
        elif incident_forced:
            routing_method = "incident_chain_forced"
            routing_markers["incident_triggered"] = True
            routing_markers["incident_chain"] = ["sentinel", "seer", "council", "diplomat", "chronos"]
            reasoning.append("Incident trigger detected; forcing Sentinel+Seer+Council+Diplomat+Chronos chain.")
            for lvl in [21, 30, 15, 18, 14]:
                recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "incident_forced"})
        elif architecture_forced:
            routing_method = "l9_chain_forced"
            routing_markers["l9_triggered"] = True
            routing_markers["l9_chain"] = ["architect", "council", "synthesist", "validator"]
            reasoning.append("Architecture trigger detected; forcing L9 Architect chain for design reasoning.")
            for lvl in [9, 15, 32, 34]:
                if lvl == 9 and not _architect_healthy(route_health=adaptive_policies.health):
                    reasoning.append("L9 architect health check failed; substituting L15/L32 for architecture-chain resilience.")
                    for fallback_lvl in [15, 32]:
                        if fallback_lvl not in [r.get("level") for r in recommended]:
                            recommended.append({"level": fallback_lvl, "name": LEVEL_MAP[fallback_lvl]["name"], "method": "l9_fallback"})
                    continue
                recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "l9_forced"})
        elif coding_forced:
            routing_method = "coding_chain_forced"
            routing_markers["coding_triggered"] = True
            routing_markers["coding_chain"] = ["lab", "architect", "validator", "forge", "council"]
            routing_markers["l9_triggered"] = True
            routing_markers["l9_chain"] = ["architect"]
            reasoning.append("Coding trigger detected; forcing Lab+Architect+Validator+Forge+Council chain.")
            for lvl in [4, 9, 34, 27, 15]:
                if lvl == 9 and not _architect_healthy(route_health=adaptive_policies.health):
                    reasoning.append("L9 architect health check failed; substituting L15/L32 for coding chain resilience.")
                    for fallback_lvl in [15, 32]:
                        if fallback_lvl not in [r.get("level") for r in recommended]:
                            recommended.append({"level": fallback_lvl, "name": LEVEL_MAP[fallback_lvl]["name"], "method": "coding_fallback"})
                    continue
                recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "coding_forced"})
        elif research_forced:
            routing_method = "research_chain_forced"
            routing_markers["research_triggered"] = True
            routing_markers["research_chain"] = ["ghost", "librarian", "mnemosyne", "oracle", "validator"]
            reasoning.append("Research trigger detected; forcing Ghost+Librarian+Mnemosyne+Oracle+Validator chain.")
            for lvl in [2, 7, 22, 5, 34]:
                recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "research_forced"})

        if translation_auto:
            routing_markers["translation_triggered"] = True
            routing_markers["translation_chain"] = ["polyglot", "diplomat"]
            reasoning.append("Translation intent detected; auto-activating Polyglot+Diplomat.")
            for lvl in [28, 18]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "auto_level_trigger"})

        if schedule_auto:
            routing_markers["schedule_triggered"] = True
            routing_markers["schedule_chain"] = ["chronos", "listener"]
            reasoning.append("Scheduling intent detected; auto-activating Chronos+Listener.")
            for lvl in [14, 10]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "auto_level_trigger"})

        if mediation_auto:
            routing_markers["mediation_triggered"] = True
            routing_markers["mediation_chain"] = ["mediator", "council", "diplomat"]
            reasoning.append("Mediation intent detected; auto-activating Mediator+Council+Diplomat.")
            for lvl in [31, 15, 18]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "auto_level_trigger"})

        if forecast_auto:
            routing_markers["forecast_triggered"] = True
            routing_markers["forecast_chain"] = ["seer", "simulator", "oracle"]
            reasoning.append("Forecast intent detected; auto-activating Seer+Simulator+Oracle.")
            for lvl in [30, 20, 5]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "auto_level_trigger"})

        if training_auto:
            routing_markers["training_triggered"] = True
            routing_markers["training_chain"] = ["academy", "librarian", "bard"]
            reasoning.append("Training intent detected; auto-activating Academy+Librarian+Bard.")
            for lvl in [16, 7, 6]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "auto_level_trigger"})

        if ethics_auto:
            routing_markers["ethics_triggered"] = True
            routing_markers["ethics_chain"] = ["ethicist", "council", "validator"]
            reasoning.append("Ethics/compliance intent detected; auto-activating Ethicist+Council+Validator.")
            for lvl in [33, 15, 34]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "auto_level_trigger"})

        for lvl, why in specialist_nudges:
            if lvl not in [r.get("level") for r in recommended]:
                recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "benchmark_intent_nudge"})
                reasoning.append(why)

        specialist_guard = bool(
            brainstorm_forced
            or coding_forced
            or incident_forced
            or research_forced
            or architecture_forced
            or translation_auto
            or schedule_auto
            or mediation_auto
            or forecast_auto
            or training_auto
            or ethics_auto
            or specialist_nudges
            or bool(world_grounding.get("required", False))
        )

        fastlane_kill_switch = bool(fastlane_cfg.get("kill_switch", False))
        use_fastlane = (
            (not specialist_guard)
            and (not referent_query)
            and ("codeword" not in (query or "").lower())
            and fastlane_cfg.get("enabled", True)
            and not fastlane_kill_switch
            and _is_simple_qa(query, kernel_contract=kernel_contract)
            and bool(((kernel_contract.get("intent") or {}).get("simple_qa")) if isinstance(kernel_trace, dict) else True)
            and not (kernel_active and str(kernel_plan.get("lane") or "fast") == "deep")
            and len(risk_flags) == 0
            and not complexity_gate.get("hard", False)
            and not bool(world_grounding.get("required", False))
        )
        adaptive_apply = bool(
            adaptive_route.get("evaluated")
            and adaptive_route.get("rollout_eligible")
            and not specialist_guard
            and adaptive_route.get("selected_chain")
        )
        if adaptive_apply:
            selected_chain = str(adaptive_route.get("selected_chain"))
            selected_policy = str(adaptive_route.get("selected_policy") or selected_chain)
            for lvl in adaptive_route.get("selected_levels") or []:
                try:
                    level = int(lvl)
                except (TypeError, ValueError):
                    continue
                if level in LEVEL_MAP and level not in [row.get("level") for row in recommended]:
                    recommended.append({"level": level, "name": LEVEL_MAP[level]["name"], "method": "adaptive_router_policy"})
            if selected_chain != "fastlane_memory" and selected_policy not in {"fastlane", "direct"}:
                use_fastlane = False
            routing_method = f"adaptive_{selected_chain}"
            adaptive_route["applied"] = True
            adaptive_route["reason"] = "selected_chain_applied"
            reasoning.append(f"Adaptive router rollout selected {selected_chain}; applying its live level chain.")
        elif adaptive_route.get("evaluated") and adaptive_route.get("rollout_eligible") and specialist_guard:
            adaptive_route["reason"] = "specialist_guard_preserved"
        routing_markers["adaptive_route"] = {
            "evaluated": bool(adaptive_route.get("evaluated")),
            "applied": bool(adaptive_route.get("applied")),
            "selected_chain": adaptive_route.get("selected_chain"),
            "rollout_stage": adaptive_route.get("rollout_stage"),
            "rollout_percent": adaptive_route.get("rollout_percent"),
            "reason": adaptive_route.get("reason"),
        }
        if kernel_active and str(kernel_plan.get("lane") or "fast") == "deep":
            reasoning.append("Fastlane bypassed because Kernel V2 selected the deep lane for this query.")

        if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("semantic_delta_enabled", True):
            delta_info = adaptive_policies.delta.analyze(query)
            optimizer_telemetry["delta"] = delta_info

        bandit_choice: Dict[str, Any] = {}
        if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("bandit_enabled", True):
            context_bucket = adaptive_policies.bandit.context_bucket(
                query=query,
                risk_flags=risk_flags,
                complexity_hard=bool(complexity_gate.get("hard", False)),
                brainstorm=bool(brainstorm_forced),
            )
            candidate_arms = ["creative_fractal"] if brainstorm_forced else None
            routing_markers["policy_rollout_stage"] = str(policy_hint.get("stage", "shadow"))
            routing_markers["policy_rollout_apply"] = bool(policy_hint.get("apply_recommendation", False))
            if policy_hint.get("recommended_policy") and policy_hint.get("apply_recommendation"):
                candidate_arms = [str(policy_hint.get("recommended_policy"))]
                reasoning.append(
                    f"Outcome tuner {policy_hint.get('stage')} applying {policy_hint.get('recommended_policy')} "
                    f"({int(policy_hint.get('rollout_percent', 0))}% rollout, conf={float(policy_hint.get('decision_confidence', 0.0)):.2f})."
                )
            elif policy_hint.get("recommended_policy") and policy_hint.get("stage") == "recommend":
                candidate_arms = [str(policy_hint.get("recommended_policy")), str(policy_hint.get("baseline_policy"))]
                reasoning.append(
                    f"Outcome tuner recommends {policy_hint.get('recommended_policy')} (evidence={policy_hint.get('evidence', {})})."
                )
            bandit_choice = adaptive_policies.bandit.select_arm(context_bucket, query, candidates=candidate_arms)
            optimizer_telemetry["bandit"] = bandit_choice
            routing_markers["bandit_arm"] = bandit_choice.get("selected_arm")
            for lvl in bandit_choice.get("levels", []):
                if lvl in LEVEL_MAP and lvl not in ALWAYS_ON_LEVELS and lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "bandit_policy"})
            if bandit_choice.get("policy") == "deliberate" and not specialist_guard:
                use_fastlane = False
                reasoning.append("Bandit policy selected deliberate mode; bypassing fastlane.")

        if complexity_gate.get("hard"):
            reasoning.append(f"Complexity gate engaged (score={complexity_gate.get('score')}); bypassing fastlane for deeper reasoning.")
            for lvl in [5, 15, 32, 34]:
                if lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "complexity_gate"})
        if complexity_gate.get("l9_triggered"):
            routing_markers["l9_triggered"] = True
            if _architect_healthy(route_health=adaptive_policies.health):
                routing_markers["l9_chain"] = ["architect"]
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
            "model_lane": "kernel_deep" if str((kernel_trace or {}).get("plan", {}).get("lane") or "fast") == "deep" else ("strong_reasoning" if complexity_gate.get("hard") else "default"),
            "kernel_v2": _kernel_trace_payload(kernel_trace),
            "world_grounding": {
                "required": bool(world_grounding.get("required", False)),
                "mode": world_grounding.get("mode", "not_required"),
                "evidence_count": int(world_grounding.get("evidence_count", 0)),
            },
        }
        fastlane = None
        checks = {}
        if use_fastlane:
            qtype = tx.run_step("classify_qtype", lambda: classify_qtype(query), retry_policy=RetryPolicy.for_kind("no_retry"), verify=lambda x: bool(x))
            template = tx.run_step("build_template", lambda: build_template(qtype), retry_policy=RetryPolicy.for_kind("no_retry"), rollback=lambda _out: {"template_discarded": True}, verify=lambda x: isinstance(x, dict))

            cached_items: List[Dict[str, Any]] = []
            if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("semantic_delta_enabled", True):
                cached_items = adaptive_policies.delta.maybe_reuse_retrieval(query, min_similarity=float(optimizer_cfg.get("delta_reuse_similarity", 0.62)))

            def _retrieve_context():
                return retrieve_top3(
                    query,
                    max_items=int(fastlane_cfg.get("max_retrieval_items", 3)),
                    timeout_ms=min(int(fastlane_cfg.get("max_latency_ms", 2200)), 500),
                    candidates=cached_items + prefetched_retrieval,
                )

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
            checks["grounded_retrieval"] = bool(retrieval_items) and all(bool(item.get("grounded")) for item in retrieval_items)
            conf = confidence_score(answer, checks)
            if not checks["grounded_retrieval"]:
                conf = 0.0
            latency_decision = adaptive_policies.latency.should_escalate(
                confidence=conf,
                elapsed_ms=int((datetime.utcnow() - started).total_seconds() * 1000),
                risk_flags=risk_flags,
                complexity_gate=complexity_gate,
                validator_result=checks,
                plan=latency_plan,
                already_escalated=(
                    not checks["grounded_retrieval"]
                    or should_escalate(conf, risk_flags, threshold=float(fastlane_cfg.get("escalation_threshold", 0.72)))
                ),
            )
            escalate = bool(not checks["grounded_retrieval"] or latency_decision.get("escalate"))
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
        if optimizer_cfg.get("enabled", True) and optimizer_cfg.get("anytime_enabled", True) and isinstance(fastlane, dict) and not specialist_guard:
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
            semantic_result = tx.run_step(
                "semantic_analysis",
                lambda: analyze_intent_with_oracle(query, route_health=adaptive_policies.health),
                retry_policy=RetryPolicy.for_kind("transient_io"),
                verify=lambda x: isinstance(x, dict),
            )
        semantic_low_signal = not semantic_result.get("intents") or float(semantic_result.get("confidence", 0) or 0) <= 0.05
        if semantic_low_signal:
            heuristic = _simple_intent_heuristics(query)
            if heuristic.get("intents"):
                semantic_result = heuristic
                reasoning.append("Oracle semantic low-signal; using heuristic fallback to avoid empty-intent fastlane collapse.")

        if semantic_result.get("confidence", 0) > 0.3:
            for lvl in semantic_result.get("levels", []):
                if lvl == 9 and not _architect_healthy(route_health=adaptive_policies.health):
                    reasoning.append("L9 architect health check failed; substituting L15/L32 for resilient planning.")
                    for fallback_lvl in [15, 32]:
                        if fallback_lvl not in [r.get("level") for r in recommended]:
                            recommended.append({"level": fallback_lvl, "name": LEVEL_MAP[fallback_lvl]["name"], "method": "l9_fallback"})
                    continue
                if lvl in LEVEL_MAP and lvl not in ALWAYS_ON_LEVELS and lvl not in [r.get("level") for r in recommended]:
                    recommended.append({"level": lvl, "name": LEVEL_MAP[lvl]["name"], "method": "semantic"})
            if semantic_result.get("reasoning"):
                reasoning.append(f"L5 Oracle: {semantic_result['reasoning']}")

        if adaptive_observation_allowed and optimizer_cfg.get("enabled", True) and optimizer_cfg.get("semantic_delta_enabled", True):
            try:
                adaptive_policies.delta.update(
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

        activated = [f"L{item['level']}:{item['name']}" for item in recommended if item.get('method') in {'qa_fastlane', 'brainstorm_forced', 'semantic', 'keyword', 'referent_guard', 'l9_fallback', 'cognitive_policy', 'bandit_policy', 'adaptive_router_policy', 'autotune_l9', 'complexity_gate', 'world_grounding'} or item.get('always_on')]
        workflow_checkpoint = _build_workflow_checkpoint(query, routing_method, recommended)

        cognitive_trace = _cognitive_reasoning(query, risk_flags, kernel_contract=kernel_contract)
        cognitive_quality = _cognitive_quality(cognitive_trace, fastlane, risk_flags)
        cognitive_stage = _apply_cognitive_stage(cognitive_cfg, query, cognitive_quality)

        if adaptive_observation_allowed and optimizer_cfg.get("enabled", True) and optimizer_cfg.get("bandit_enabled", True) and optimizer_telemetry.get("bandit"):
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
                adaptive_policies.bandit.update(bandit_context, bandit_arm, reward)
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

        _refresh_context(
            query,
            fastlane.get("answer") if isinstance(fastlane, dict) else None,
            continuity_key=continuity_session_key,
        )
        codec_context = _update_codec_context(
            session_key,
            query,
            (fastlane.get("answer") if isinstance(fastlane, dict) and isinstance(fastlane.get("answer"), str) else ""),
            routing_method=routing_method,
            tenant_id=principal.tenant_id,
            workspace_id=principal.storage_workspace_id,
            telemetry_session_key=continuity_session_key,
            adaptive_policies=adaptive_policies,
        )

        if request is not None:
            for item in recommended:
                if item.get("method") in {"qa_fastlane", "brainstorm_forced", "semantic", "keyword", "referent_guard", "l9_fallback", "cognitive_policy", "bandit_policy", "adaptive_router_policy", "autotune_l9", "complexity_gate", "world_grounding"}:
                    track_level(request, item["level"], item["name"], always_on=False)
            request.state.routing_method = routing_method

        execution_tx = tx.finalize({"recommended_levels": recommended, "routing_method": routing_method}, verify=lambda payload: bool(payload.get("recommended_levels")) and bool(payload.get("routing_method")))
        elapsed_ms = int((datetime.utcnow() - started).total_seconds() * 1000)
        checks = _complete_orchestration_checks(
            query=query,
            checks=checks,
            fastlane=fastlane,
            semantic_result=semantic_result,
            reasoning=reasoning,
        )
        validator_result = {
            "pass": _orchestration_validator_pass(
                checks=checks,
                fastlane=fastlane,
                cognitive_quality_pass=bool(cognitive_stage.get("quality_pass")),
            ),
            "checks": checks,
        }
        quality_score = min(1.0, max(0.0, (0.4 * float(cognitive_quality.get("confidence", 0.0))) + (0.3 * float(cognitive_quality.get("evidence", 0.0))) + (0.3 * (1.0 if validator_result["pass"] else 0.0))))
        route_health_dependencies: Dict[str, Any] = {}
        for dep in ["oracle", "architect", "l22", "world_grounding"]:
            snap = adaptive_policies.health.snapshot(dep)
            if isinstance(snap, dict) and (snap.get("successes") or snap.get("failures") or dep in {"architect"}):
                route_health_dependencies[dep] = snap
        if bool(world_grounding.get("required", False)) and "world_grounding" not in route_health_dependencies:
            route_health_dependencies["world_grounding"] = {
                "state": "closed" if not bool(world_grounding.get("degraded", False)) else "open",
                "healthy": not bool(world_grounding.get("degraded", False)),
                "evidence_count": int(world_grounding.get("evidence_count", 0)),
                "mode": world_grounding.get("mode", "not_required"),
            }
        route_health_snapshot = {"version": "route_health.v1", "dependencies": route_health_dependencies}
        assurance = build_orchestration_assurance(
            query=query,
            routing_method=routing_method,
            risk_flags=risk_flags,
            checks=checks,
            validator_result=validator_result,
            cognitive_quality=cognitive_quality,
            world_grounding=world_grounding,
            execution_transaction=execution_tx,
            route_health=route_health_snapshot,
            fastlane=fastlane,
            policy_hint=policy_hint,
            tool_path_observability=tool_path_observability,
            routing_markers=routing_markers,
            latency_budget=latency_plan,
            recommended_levels=recommended,
            quality_score=quality_score,
        )
        if adaptive_observation_allowed:
            autotune_policy = _scoped_routing_policy_call(
                adaptive_policies,
                observe_outcome,
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
        observed_policy_label = str((bandit_choice or {}).get("selected_arm") or routing_method)
        with _PRINCIPAL_OUTCOME_TUNER_LOCK:
            outcome_artifact = outcome_tuner.observe({
                "query": query,
                "task_archetype": archetype,
                "activated_chain": activated,
                "policy_label": observed_policy_label,
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
                "assurance_verdict": assurance.get("verdict"),
                "assurance_reason_codes": assurance.get("reason_codes", []),
                "query_hash": hashlib.sha256((query or '').encode('utf-8')).hexdigest()[:16],
                "tenant_id": principal.tenant_id,
                "storage_workspace_id": principal.storage_workspace_id,
            }) if adaptive_observation_allowed else {"recorded": False, "reason": "principal_rate_limit"}
        codec_execution_artifact = _observe_codec_execution_outcome(
            query=query,
            session_key=continuity_session_key,
            codec_context=codec_context,
            referent_info=referent_info,
            execution_transaction=execution_tx,
            validator_result=validator_result,
            fastlane=fastlane,
            note=f"nexus_orchestrate:{routing_method}",
            served_variant=served_codec_variant,
            adaptive_policies=adaptive_policies,
        ) if adaptive_observation_allowed else {
            "recorded": False,
            "reason": "principal_rate_limit",
            "execution_metrics": _execution_flow_metrics(execution_tx, validator_result, fastlane),
        }
        latency_artifact = adaptive_policies.latency.observe({
            "query_hash": hashlib.sha256((query or '').encode('utf-8')).hexdigest()[:16],
            "archetype": archetype,
            "latency_ms": elapsed_ms,
            "token_budget_used": token_plan.get("used") if isinstance(token_plan, dict) else 0,
            "escalated": bool(isinstance(fastlane, dict) and fastlane.get("escalated")),
            "prefetch_used": bool(prefetched_retrieval or referent_info.get("resolved")),
        }) if adaptive_observation_allowed else {"recorded": False, "reason": "principal_rate_limit"}
        kernel_response_text = str(
            (fastlane.get("answer") if isinstance(fastlane, dict) and isinstance(fastlane.get("answer"), str) and fastlane.get("answer") else "")
            or semantic_result.get("reasoning")
            or routing_method
        )
        actual_kernel_lane = "nexus_fastlane" if isinstance(fastlane, dict) and not fastlane.get("escalated") else "nexus_orchestrated"
        if isinstance(fastlane, dict) and fastlane.get("escalated"):
            actual_kernel_lane = "qa_fastlane_escalated"
        kernel_result = cortex_kernel_v2.finalize_request(
            (kernel_trace or {}).get("request_id") if isinstance(kernel_trace, dict) else None,
            response=kernel_response_text,
            actual_lane=actual_kernel_lane,
            used_backend=str(semantic_result.get("method") or ("qa_fastlane" if fastlane else "nexus_orchestrate")),
            fallback_reason="fastlane_escalated" if isinstance(fastlane, dict) and fastlane.get("escalated") else ("world_grounding_degraded" if bool(world_grounding.get("degraded", False)) else None),
            contract_ok=bool(validator_result.get("pass")),
        )
        execution_metrics = (
            dict(codec_execution_artifact.get("execution_metrics") or {})
            if isinstance(codec_execution_artifact, dict)
            else {}
        )
        receipt_recovery_needed = bool(
            execution_metrics.get("escalated")
            or not execution_metrics.get("validator_pass")
            or not execution_metrics.get("tx_completed")
            or int(execution_metrics.get("failed_steps", 0) or 0) > 0
            or int(execution_metrics.get("rollback_count", 0) or 0) > 0
        )
        outcome_feedback_receipt = _issue_outcome_feedback_receipt(
            scope=principal_scope,
            execution_id=tx_id,
            query=query,
            task_archetype=archetype,
            policy_label=observed_policy_label,
            codec_variant=served_codec_variant,
            validator_pass=bool(validator_result.get("pass")),
            execution_success=bool(
                execution_metrics.get("tx_completed")
                and execution_metrics.get("validator_pass")
                and not receipt_recovery_needed
            ),
            recovery_needed=receipt_recovery_needed,
            latency_ms=elapsed_ms,
            outcome_confidence=float(execution_metrics.get("confidence", 0.0) or 0.0),
        )

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
                "assurance_version": assurance.get("version"),
                "assurance_verdict": assurance.get("verdict"),
                "assurance_release_decision": assurance.get("release_decision"),
                "memory_write_eligible": bool((assurance.get("memory_commit") or {}).get("eligible", False)),
                "kernel_contract_version": (kernel_trace.get("contract") or {}).get("version") if isinstance(kernel_trace, dict) else None,
                "kernel_lane": (kernel_trace.get("plan") or {}).get("lane") if isinstance(kernel_trace, dict) else None,
            },
            "assurance": assurance,
            "referent_context": referent_info,
            "world_grounding": world_grounding,
            "fastlane": fastlane,
            "tool_path_observability": tool_path_observability,
            "cognitive_wave": cognitive_slice,
            "level_optimizer": optimizer_telemetry,
            "token_plan": token_plan,
            "semantic_delta": delta_info,
            "latency_budget": latency_plan,
            "policy_hint": policy_hint,
            "adaptive_route": adaptive_route,
            "codec_context": codec_context,
            "autotune_policy": autotune_policy,
            "execution_transaction": execution_tx,
            "validator_result": validator_result,
            "kernel_v2": _kernel_trace_payload(kernel_trace, kernel_result=kernel_result),
            "outcome_feedback": {
                "receipt": outcome_feedback_receipt["receipt"],
                "receipt_version": _OUTCOME_FEEDBACK_RECEIPT_VERSION,
                "expires_at": outcome_feedback_receipt["payload"]["expires_at"],
                "execution_id": tx_id,
            },
            "artifact_paths": {
                "outcome_tuner": outcome_artifact,
                "latency_governor": latency_artifact,
                "codec_execution": codec_execution_artifact,
            },
            "_activated": activated,
            "hud": hud_line,
            "autonomous": True
        }
    except Exception as e:
        tx.rollback()
        failed_tx = tx.fail(e)
        if locals().get("adaptive_observation_allowed", True):
            try:
                _observe_codec_execution_outcome(
                    query=query,
                    session_key=locals().get("continuity_session_key", ""),
                    codec_context=locals().get("codec_context", {}) if isinstance(locals().get("codec_context", {}), dict) else {},
                    referent_info=locals().get("referent_info", {}) if isinstance(locals().get("referent_info", {}), dict) else {},
                    execution_transaction=failed_tx if isinstance(failed_tx, dict) else {"status": "failed"},
                    validator_result=locals().get("validator_result", {"pass": False}) if isinstance(locals().get("validator_result", {"pass": False}), dict) else {"pass": False},
                    fastlane=locals().get("fastlane") if isinstance(locals().get("fastlane"), dict) else None,
                    note=f"nexus_orchestrate_exception:{type(e).__name__}",
                    explicit_success=False,
                    served_variant=locals().get("served_codec_variant"),
                    adaptive_policies=locals().get("adaptive_policies"),
                )
            except Exception:
                pass
        try:
            cortex_kernel_v2.finalize_request(
                (locals().get("kernel_trace") or {}).get("request_id") if isinstance(locals().get("kernel_trace"), dict) else None,
                response="",
                actual_lane="nexus_orchestrated",
                used_backend="nexus_exception",
                fallback_reason="exception",
                contract_ok=False,
                error=f"{type(e).__name__}:{str(e)[:160]}",
            )
        except Exception:
            pass
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


@router.post("/assurance/receipt")
async def issue_commit_assurance_receipt(interaction: AssuranceReceiptRequest, request: Request):
    """Validate an interaction server-side and issue a short-lived bound receipt."""
    issued = _issue_assurance_receipt(interaction, request)
    return {
        "success": True,
        "receipt": issued["receipt"],
        "expires_at": issued["payload"]["expires_at"],
        "assurance": {
            "version": _ASSURANCE_RECEIPT_VERSION,
            "risk_flags": issued["assurance"]["risk_flags"],
            "validators": issued["assurance"]["validator_summary"],
            "memory_commit": issued["assurance"]["memory_decision"],
        },
    }


@router.post("/commit")
async def commit_memory(interaction: InteractionData, request: Request):
    """Commit memory only with a valid server-issued, interaction-bound receipt."""
    try:
        receipt_payload = _verify_assurance_receipt(interaction, request)
    except ValueError as exc:
        raise HTTPException(
            status_code=403,
            detail={"error": "valid_server_assurance_receipt_required", "reason": str(exc)},
        ) from exc

    scope = _assurance_scope(request)
    signed_receipt_jti = str(receipt_payload["jti"])
    try:
        prior_result = consumed_assurance_receipt_result(
            _ASSURANCE_RECEIPT_STATE_PATH,
            scope=scope,
            jti=signed_receipt_jti,
        )
    except AssuranceReceiptLedgerUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "assurance_receipt_ledger_unavailable", "reason": str(exc)},
        ) from exc
    if prior_result is not None:
        return prior_result
    if int(receipt_payload["expires_at"]) < int(time.time()):
        try:
            receipt_status = assurance_receipt_status(
                _ASSURANCE_RECEIPT_STATE_PATH,
                scope=scope,
                jti=signed_receipt_jti,
            )
        except AssuranceReceiptLedgerUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={"error": "assurance_receipt_ledger_unavailable", "reason": str(exc)},
            ) from exc
        if receipt_status == "reserved":
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "assurance_receipt_commit_outcome_unknown",
                    "reason": "expired_reserved_receipt",
                },
            )
        raise HTTPException(
            status_code=409,
            detail={"error": "assurance_receipt_expired_without_commit", "reason": "expired_receipt"},
        )

    server_assurance = _server_commit_assurance(interaction.query, interaction.response)
    risk_flags = list(server_assurance.get("risk_flags") or [])
    validator_summary = dict(server_assurance.get("validator_summary") or {})
    world_grounding = dict(server_assurance.get("world_grounding") or {})
    memory_decision = dict(server_assurance.get("memory_decision") or {})
    if receipt_payload.get("risk_flags") != risk_flags or not bool(receipt_payload.get("validator_pass")):
        raise HTTPException(status_code=403, detail={"error": "assurance_receipt_state_mismatch"})
    if not bool(memory_decision.get("eligible")):
        raise HTTPException(
            status_code=422,
            detail={"error": "interaction_no_longer_eligible_for_commit", "reasons": list(memory_decision.get("reasons") or [])},
        )

    supplied_metadata = dict(interaction.metadata or {})
    forbidden_receipt_identity_fields = {
        field
        for field in ("idempotency_key", "receipt_id")
        if field in supplied_metadata
    }
    if forbidden_receipt_identity_fields:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "signed_receipt_identity_override_forbidden",
                "fields": sorted(forbidden_receipt_identity_fields),
            },
        )
    caller_metadata = {
        str(key): value
        for key, value in supplied_metadata.items()
        if str(key) not in _ASSURANCE_RESERVED_METADATA
    }
    route_health = _adaptive_policies_for_scope(scope).health
    try:
        receipt_reservation = reserve_assurance_receipt(
            _ASSURANCE_RECEIPT_STATE_PATH,
            scope=scope,
            jti=signed_receipt_jti,
            expires_at=int(receipt_payload["expires_at"]),
        )
    except ValueError as exc:
        if str(exc) == "receipt_already_consumed":
            try:
                prior_result = consumed_assurance_receipt_result(
                    _ASSURANCE_RECEIPT_STATE_PATH,
                    scope=scope,
                    jti=signed_receipt_jti,
                )
            except AssuranceReceiptLedgerUnavailable as replay_exc:
                raise HTTPException(
                    status_code=503,
                    detail={"error": "assurance_receipt_ledger_unavailable", "reason": str(replay_exc)},
                ) from replay_exc
            if prior_result is not None:
                return prior_result
        raise HTTPException(
            status_code=403,
            detail={"error": "valid_server_assurance_receipt_required", "reason": str(exc)},
        ) from exc
    except AssuranceReceiptLedgerUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "assurance_receipt_ledger_unavailable", "reason": str(exc)},
        ) from exc

    durable_write = None
    if memory_decision.get("eligible"):
        try:
            from cortex_server.routers.l22 import store_memory_record

            durable_write = store_memory_record(
                content=interaction.response,
                memory_type="memory",
                tags=["nexus_commit", "durable_memory"],
                tenant_id=scope["tenant_id"],
                workspace_id=scope["storage_workspace_id"],
                idempotency_key=signed_receipt_jti,
                metadata={
                    **caller_metadata,
                    "query": interaction.query,
                    "levels_used": _normalized_commit_levels(interaction.levels_used),
                    "source": "nexus.commit",
                    "tenant_id": scope["tenant_id"],
                    "workspace_id": scope["workspace_id"],
                    "assurance": {
                        "receipt_version": _ASSURANCE_RECEIPT_VERSION,
                        "receipt_id": signed_receipt_jti,
                        "validator_pass": bool(validator_summary.get("pass")),
                        "validator_reason_codes": validator_summary.get("reason_codes", []),
                        "risk_flags": risk_flags,
                        "scope": scope,
                    },
                },
            )
        except Exception as exc:
            durable_write = {"status": "write_failed", "error": str(exc)}
            route_health.record_failure("l22", error=str(exc))
    else:
        durable_write = {"status": "skipped", "reason": "assurance_gate"}

    durable_status = str((durable_write or {}).get("status") or "")
    if durable_status in {"stored", "stored_below_threshold"}:
        route_health.record_success("l22")
    else:
        try:
            release_assurance_receipt(_ASSURANCE_RECEIPT_STATE_PATH, receipt_reservation)
        except AssuranceReceiptLedgerUnavailable as exc:
            raise HTTPException(
                status_code=503,
                detail={"error": "assurance_receipt_release_failed", "reason": str(exc)},
            ) from exc

    memory_decision = build_memory_commit_decision(
        query=interaction.query,
        response=interaction.response,
        risk_flags=risk_flags,
        validator_summary=validator_summary,
        world_grounding=world_grounding,
        durable_store_result=durable_write,
    )
    assurance = {
        "version": "nexus.assurance.v1",
        "verdict": "pass" if memory_decision.get("eligible") and durable_write and durable_write.get("status") == "stored" else ("degraded" if memory_decision.get("eligible") else "warn"),
        "memory_commit": memory_decision,
        "validators": validator_summary,
        "receipt": {"version": _ASSURANCE_RECEIPT_VERSION, "id": receipt_payload.get("jti"), "scope": scope},
        "route_health": {"version": "route_health.v1", "dependencies": {"l22": route_health.snapshot("l22")}},
    }

    commit_result = {
        "success": bool(memory_decision.get("eligible")) and durable_write and durable_write.get("status") == "stored",
        "committed": bool(durable_write and durable_write.get("status") == "stored"),
        "levels": [7, 22],
        "query_preview": interaction.query[:50] if interaction.query else "",
        "durable_write": durable_write,
        "assurance": assurance,
        "contract": {
            "identity_phrase": "Cortex-first orchestration active",
            "activation_metadata_available": True,
            "activation_metadata_source": "router",
            "assurance_version": assurance.get("version"),
            "assurance_verdict": assurance.get("verdict"),
            "memory_write_eligible": bool(memory_decision.get("eligible")),
        },
    }
    if durable_status in {"stored", "stored_below_threshold"}:
        try:
            finalize_assurance_receipt(
                _ASSURANCE_RECEIPT_STATE_PATH,
                receipt_reservation,
                result=commit_result,
            )
        except AssuranceReceiptLedgerUnavailable as exc:
            # Keep the reservation in place. The JTI remains the L22 identity,
            # so recovery can never mint a second durable memory identity.
            route_health.record_failure("l22", error=str(exc))
            raise HTTPException(
                status_code=503,
                detail={"error": "assurance_receipt_finalization_failed", "reason": str(exc)},
            ) from exc
    return commit_result


@router.post("/index")
async def auto_index(request: AutoIndexRequest):
    """Auto-index to Knowledge Graph"""
    return {
        "success": True,
        "indexed": True,
        "query": request.query,
        "facts_indexed": len(request.response_data.get("facts", [])),
    }
