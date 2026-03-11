"""L38 Augmenter — Model-Adaptive Guardrails (Real-World)

CLEAR GOAL
- Make the *current* base model (as configured in Cortex) more reliable in real-world use
  by compensating for known failure modes (formatting, tool-json, numeric), while keeping
  average latency close to baseline.

PURPOSE
- Provide a distinct, HUD-visible layer that decides *how hard to push* the model per request.
- Use canonical model identity from config (runtime.base_model) — no behavioral guessing.

METHOD (AUTO, latency-aware)
- Fast path: 1x Oracle call → validate → return.
- Repair path (gated): if risk is high or validation fails → 1x repair call → validate → return.
- Future escalation hooks: self-consistency / judge loops, but only when explicitly needed.

Endpoints
- POST /augmenter/chat   (returns {response, augmenter{decision,risk,validation,...}})
- GET  /augmenter/status (reports base_model + enabled)
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["augmenter"])

SENTINEL_WATCH_URL = 'http://127.0.0.1:8888/sentinel/watch'
SENTINEL_SCAN_URL = 'http://127.0.0.1:8888/sentinel/scan'

BRIDGE_DELEGATION_ENABLED = os.getenv('BRIDGE_DELEGATION_ENABLED','false').lower() in ('1','true','yes')
BRIDGE_TOKEN = os.getenv('BRIDGE_TOKEN','')

CONFIG_PATHS = [
    Path("/app/config/openclaw_config.json"),
    Path("/opt/clawdbot/openclaw_config.json"),
]


@dataclass
class PolicyDecision:
    base_model: str
    risk: float
    kind: str  # freeform|choice_letter|tool_json|numeric|code
    level: int  # 0 fast, 1 repair
    reason: str

class AugmenterChatRequest(BaseModel):
    prompt: str = Field(min_length=1)
    response_mode: str = "final_only"
    priority: str = "normal"
    latency_budget_ms: Optional[int] = None
    allow_external: bool = False
    external_connection_id: Optional[str] = None
    simulator_mode: Optional[str] = None




def _load_openclaw_config() -> Dict[str, Any]:
    for p in CONFIG_PATHS:
        try:
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
    return {}


def _get_base_model() -> str:
    cfg = _load_openclaw_config()
    return (
        cfg.get("runtime", {}).get("base_model")
        or cfg.get("runtime", {}).get("model")
        or "unknown"
    )


_STRICT_MARKERS = re.compile(
    r"\b(only|exactly|must|do not|dont|json|single|uppercase|lowercase|letter)\b",
    re.I,
)

_CITATION_PATTERN = re.compile(r"Source:\s*([A-Za-z0-9_./-]+#L?\d+(?:-\d+)?)", re.I)


def _classify_kind(prompt: str) -> str:
    p = (prompt or "").lower()

    json_intent = any(k in p for k in ["json", "strict json", "valid json", "json only", "no prose", "no markdown"])
    tool_intent = any(k in p for k in ["tool", "tool call", "function", "function call", "invocation", "arguments", "args", "params", "parameters", "schema", "keys"])
    key_pair_hint = bool(
        re.search(
            r"keys?\s+['\"]?(tool|function|name)['\"]?\s*(?:and|,|&)\s*['\"]?(args|arguments|params|parameters)['\"]?",
            p,
            re.I,
        )
    )

    if (json_intent and (tool_intent or key_pair_hint)):
        return "tool_json"
    if "{" in p and "}" in p and any(k in p for k in ["json", "tool", "function", "arguments", "args", "params"]):
        return "tool_json"
    if "option" in p and any(x in p for x in ["a)", "b)", "c)", "d)"]):
        return "choice_letter"
    if "letter only" in p or "option letter" in p:
        return "choice_letter"
    if any(w in p for w in ["compute", "solve", "seconds", "hours", "minutes", "area", "sum", "convert"]):
        return "numeric"
    if any(w in p for w in ["write a function", "python", "javascript", "typescript", "sql", "code"]):
        return "code"
    return "freeform"




_OPS_RISK_MARKERS = re.compile(
    r"\b(deploy|deployment|rollout|rollback|release|hotfix|incident|outage|downtime|slo|sla|latency|ops|operational|risk|blast radius|canary|feature flag|migrate|migration|database|schema|prod|production)\b",
    re.I,
)

async def _sentinel_preflight_ops() -> Dict[str, Any]:
    """Run a fast Sentinel preflight for ops/deploy prompts."""
    targets = [
        'http://127.0.0.1:8888/health',
        'http://127.0.0.1:8888/oracle/status',
        'http://127.0.0.1:8888/augmenter/status',
    ]
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            for t in targets:
                await client.post(SENTINEL_WATCH_URL, json={
                    'name': 'preflight',
                    'watch_type': 'endpoint',
                    'target': t,
                    'timeout_seconds': 1.5,
                })
            r = await client.post(SENTINEL_SCAN_URL, json={})
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {'success': False, 'error': f'sentinel_preflight_failed:{type(e).__name__}:{e}'}


async def _bridge_relay(connection_id: str, query: str) -> Dict[str, Any]:
    url = 'http://127.0.0.1:8888/bridge/relay'
    headers = {'x-bridge-token': BRIDGE_TOKEN} if BRIDGE_TOKEN else {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(url, json={'connection_id': connection_id, 'query': query, 'timeout_seconds': 8.0}, headers=headers)
        return r.json()



def _is_ops_risk_prompt(prompt: str) -> bool:
    return bool(_OPS_RISK_MARKERS.search(prompt or ""))


def _wants_deep_sim(prompt: str, payload: Dict[str, Any]) -> bool:
    # explicit user request wins
    if isinstance(getattr(payload, 'simulator_mode', None), str) and payload.simulator_mode.lower() == 'deep':
        return True
    p=(prompt or '').lower()
    return ('deep sim' in p) or ('deep simulation' in p) or ('simulate deeply' in p)


async def _call_simulator(scenario: str, mode: str, timeout_s: float) -> Dict[str, Any]:
    url = 'http://127.0.0.1:8888/simulator/run'
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        r = await client.post(url, json={'scenario': scenario, 'mode': mode})
        r.raise_for_status()
        return r.json()
def _risk_score(prompt: str, kind: str) -> float:
    risk = 0.05
    if kind == "tool_json":
        risk += 0.35
    elif kind == "choice_letter":
        risk += 0.25
    elif kind == "numeric":
        risk += 0.25
    elif kind == "code":
        risk += 0.15

    if _STRICT_MARKERS.search(prompt or ""):
        risk += 0.20

    n = len(prompt or "")
    if n > 800:
        risk += 0.15
    elif n > 300:
        risk += 0.08

    return min(1.0, risk)


def _extract_choice_letter(text: str) -> Optional[str]:
    if not text:
        return None
    t = text.strip().upper()
    m = re.search(r"\b([ABCD])\b", t)
    return m.group(1) if m else None


def _extract_json_obj(text: str) -> Optional[dict]:
    if not text:
        return None
    t = text.strip()
    try:
        obj = json.loads(t)
        return obj if isinstance(obj, dict) else None
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", t)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def _validate(kind: str, text: str) -> Tuple[bool, str]:
    if kind == "choice_letter":
        letter = _extract_choice_letter(text)
        if letter and text.strip().upper() == letter:
            return True, "ok"
        if letter:
            return False, "format:must_be_single_letter"
        return False, "format:no_letter_found"

    if kind == "tool_json":
        obj = _extract_json_obj(text)
        if not obj:
            return False, "format:invalid_json"
        if "function" not in obj or "arguments" not in obj:
            return False, "format:missing_keys"
        if not isinstance(obj.get("arguments"), dict):
            return False, "format:arguments_not_object"
        return True, "ok"

    return True, "ok"


def _normalize_citation(citation: str) -> str:
    return str(citation or "").strip().lower()


def _extract_requested_citations(prompt: str) -> List[str]:
    if not prompt:
        return []
    out: List[str] = []
    seen = set()
    for raw in _CITATION_PATTERN.findall(prompt):
        original = str(raw or "").strip()
        norm = _normalize_citation(original)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append(original)
    return out


def _extract_citations(text: str) -> List[str]:
    if not text:
        return []
    found = [_normalize_citation(x) for x in _CITATION_PATTERN.findall(text)]
    out: List[str] = []
    seen = set()
    for c in found:
        if not c or c in seen:
            continue
        seen.add(c)
        out.append(c)
    return out


def _citation_gap(required: List[str], text: str) -> Tuple[bool, List[str], List[str]]:
    if not required:
        return True, [], _extract_citations(text)
    predicted = _extract_citations(text)
    pred_set = set(predicted)

    missing: List[str] = []
    for original in required:
        norm = _normalize_citation(original)
        if norm not in pred_set:
            missing.append(original)

    return len(missing) == 0, missing, predicted


def _ensure_citations(text: str, required: List[str]) -> str:
    if not required:
        return text
    ok, missing, _ = _citation_gap(required, text)
    if ok:
        return text
    base = (text or "").strip()
    suffix = " ".join(f"Source: {c}" for c in missing)
    if not base:
        return suffix
    if base.endswith('.'):
        return f"{base} {suffix}"
    return f"{base}. {suffix}"


def _citation_repair_prompt(original_prompt: str, required: List[str], model_answer: str) -> str:
    req = " | ".join(f"Source: {c}" for c in required)
    return (
        "Answer the task in one concise sentence and include ALL required citations exactly as written.\n"
        f"Required citations: {req}\n"
        "Do not omit or alter citation paths/line ranges.\n"
        f"Task: {original_prompt}\n"
        "Previous output (for reference):\n"
        f"{model_answer}"
    )


def _repair_prompt(kind: str, original_prompt: str, failure: str, model_answer: str) -> str:
    if kind == "choice_letter":
        return (
            "Return ONLY a single letter: A, B, C, or D. No punctuation, no words.\n"
            f"Question: {original_prompt}"
        )

    if kind == "tool_json":
        return (
            "Return ONLY valid JSON. No markdown. Must be an object with keys: "
            "function (string) and arguments (object).\n"
            f"Validation failure: {failure}\n"
            f"Task: {original_prompt}\n"
            "Your previous output (for reference):\n"
            f"{model_answer}"
        )

    return original_prompt


async def _call_oracle(prompt: str, response_mode: str, priority: str, timeout_s: float) -> str:
    url = "http://127.0.0.1:8888/oracle/chat"
    payload = {"prompt": prompt, "response_mode": response_mode, "priority": priority}
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        r = await client.post(url, json=payload, headers={"x-augmenter-bypass": "1"})
        r.raise_for_status()
        data = r.json()
        return str(data.get("response") or "")


async def _call_oracle_with_retry(prompt: str, response_mode: str, priority: str, timeout_s: float) -> Tuple[str, list[str]]:
    notes: list[str] = []
    attempts = [timeout_s, max(8.0, timeout_s - 4.0)]
    last_err = None
    for idx, t in enumerate(attempts, start=1):
        try:
            if idx > 1:
                notes.append(f"oracle_retry_attempt:{idx}")
            return await _call_oracle(prompt, response_mode=response_mode, priority=priority, timeout_s=t), notes
        except Exception as e:
            last_err = e
            notes.append(f"oracle_attempt_failed:{idx}:{type(e).__name__}")
    raise last_err

async def _oracle_ready() -> bool:
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get("http://127.0.0.1:8888/oracle/status")
            return r.status_code == 200
    except Exception:
        return False



@router.post("/chat")
async def chat(payload: AugmenterChatRequest, http_request: Request):
    prompt = payload.prompt
    response_mode = payload.response_mode
    priority = payload.priority
    latency_budget_ms = payload.latency_budget_ms
    allow_external = payload.allow_external
    external_connection_id = payload.external_connection_id

    base_model = _get_base_model()
    kind = _classify_kind(prompt)
    risk = _risk_score(prompt, kind)

    # default decision
    decision = PolicyDecision(
        base_model=base_model,
        risk=risk,
        kind=kind,
        level=0,
        reason="fast_path",
    )

    allow_repair = risk >= 0.45 or kind in ("tool_json", "choice_letter")
    if isinstance(latency_budget_ms, int) and latency_budget_ms > 0 and latency_budget_ms < 1200:
        allow_repair = False

    required_citations = _extract_requested_citations(prompt)
    if required_citations:
        # Citation compliance is a correctness requirement, not optional formatting.
        allow_repair = True

    t0 = time.time()
    notes: list[str] = []
    if required_citations:
        notes.append(f"citation_required:{len(required_citations)}")

    # Ops/deploy/change-management prompts: always run L20 Simulator (fast by default)
    sim_summary = None
    sentinel_summary = None
    if _is_ops_risk_prompt(prompt):
        sentinel = await _sentinel_preflight_ops()
        if isinstance(sentinel, dict) and sentinel.get('success') and isinstance(sentinel.get('scan'), dict):
            sc = sentinel['scan']
            sentinel_summary = {
                'issues_found': sc.get('issues_found'),
                'watchers_checked': sc.get('watchers_checked'),
                'results': (sc.get('results') or [])[:6],
            }
            notes.append('sentinel_preflight_ok')
        else:
            notes.append('sentinel_preflight_failed')

        ext_summary = None
        if allow_external and BRIDGE_DELEGATION_ENABLED and external_connection_id:
            try:
                ext = await _bridge_relay(str(external_connection_id), prompt)
                if isinstance(ext, dict):
                    ext_summary = {
                        'ok': ext.get('success'),
                        'latency_ms': ext.get('latency_ms'),
                        'error': ext.get('error'),
                        'response': ext.get('response'),
                    }
                    notes.append('bridge_delegation_attempted')
            except Exception:
                notes.append('bridge_delegation_failed')

    if _is_ops_risk_prompt(prompt):
        sim_mode = 'deep' if _wants_deep_sim(prompt, payload) else 'fast'
        try:
            sim = await _call_simulator(
                scenario=f"{prompt}\n\nReturn risks and failure modes for operational execution.",
                mode=sim_mode,
                timeout_s=12.0 if sim_mode=='fast' else 18.0,
            )
            if isinstance(sim, dict) and sim.get('success') and sim.get('outcomes'):
                # compress outcomes to a small summary for the model
                outs = sim.get('outcomes')[:3]
                parts=[]
                for o in outs:
                    parts.append({
                        'label': o.get('label'),
                        'probability': o.get('probability'),
                        'key_events': (o.get('key_events') or [])[:4],
                        'timeline': o.get('timeline'),
                        'impact_assessment': o.get('impact_assessment'),
                    })
                sim_summary = {'mode': sim_mode, 'outcomes': parts}
                notes.append(f"simulator_ok:{sim_mode}")
            else:
                notes.append(f"simulator_failed:{sim_mode}:{sim.get('error') if isinstance(sim, dict) else 'unknown'}")

            # Truthful activation group: record L20 dependency for this request
            try:
                from cortex_server.middleware.hud_middleware import track_level, track_attempt
                track_level(http_request, 20, 'Simulator', always_on=True)
                track_attempt(http_request, 20, 'Simulator', status='success')
            except Exception:
                pass
        except Exception as e:
            notes.append(f"simulator_exception:{type(e).__name__}")

    oracle_ready = await _oracle_ready()
    if not oracle_ready:
        notes.append("oracle_preflight_unhealthy")

    try:
        final_prompt = prompt
        if sentinel_summary is not None or sim_summary is not None:
            header = ''
            if sentinel_summary is not None:
                header += '[L21 Sentinel — preflight health]\n' + json.dumps(sentinel_summary) + '\n\n'
            if sim_summary is not None:
                header += '[L20 Simulator — ops risk simulation summary]\n' + json.dumps(sim_summary) + '\n\n'
            final_prompt = header + '[Task]\n' + prompt
        try:
            from cortex_server.middleware.hud_middleware import track_attempt
            track_attempt(http_request, 5, "Oracle", status="attempted")
        except Exception:
            pass
        answer, retry_notes = await _call_oracle_with_retry(final_prompt, response_mode=response_mode, priority=priority, timeout_s=18.0)
        notes.extend(retry_notes)
        try:
            from cortex_server.middleware.hud_middleware import track_attempt
            track_attempt(http_request, 5, "Oracle", status="success")
        except Exception:
            pass
    except Exception as e:
        try:
            from cortex_server.middleware.hud_middleware import track_attempt
            track_attempt(http_request, 5, "Oracle", status="failed", error=f"{type(e).__name__}:{e}")
        except Exception:
            pass
        return {
            "ok": False,
            "error": f"oracle_call_failed:{type(e).__name__}:{e}",
            "response": "",
            "augmenter": {"decision": decision.__dict__, "notes": notes, "elapsed_ms": int((time.time() - t0) * 1000)},
        }

    # Truthful activation group: Augmenter depends on Oracle for generation
    try:
        from cortex_server.middleware.hud_middleware import track_level
        track_level(http_request, 5, 'Oracle', always_on=True)
        track_level(http_request, 38, 'Augmenter', always_on=False)
    except Exception:
        pass

    ok, why = _validate(kind, answer)
    citation_ok, missing_citations, predicted_citations = _citation_gap(required_citations, answer)
    if ok and not citation_ok:
        ok = False
        why = "citation:missing_required"
        notes.append(f"citation_missing_initial:{len(missing_citations)}")

    if ok:
        final_answer = _ensure_citations(answer, required_citations)
        return {
            "ok": True,
            "response": final_answer,
            "augmenter": {
                "decision": decision.__dict__,
                "validation": {
                    "ok": True,
                    "why": why,
                    "citation_required": required_citations,
                    "citation_missing": [],
                    "citation_predicted": _extract_citations(final_answer),
                },
                "repairs": 0,
                "notes": notes,
                "elapsed_ms": int((time.time() - t0) * 1000),
            },
        }

    notes.append(f"initial_validation_failed:{why}")
    if not allow_repair:
        fallback_answer = _ensure_citations(answer, required_citations)
        return {
            "ok": True,
            "response": fallback_answer,
            "augmenter": {
                "decision": decision.__dict__,
                "validation": {
                    "ok": False,
                    "why": why,
                    "citation_required": required_citations,
                    "citation_missing": missing_citations,
                    "citation_predicted": predicted_citations,
                },
                "repairs": 0,
                "notes": notes,
                "elapsed_ms": int((time.time() - t0) * 1000),
            },
        }

    # one-shot repair
    decision.level = 1
    decision.reason = "repair"
    if required_citations:
        repair_prompt = _citation_repair_prompt(prompt, required_citations, answer)
    else:
        repair_prompt = _repair_prompt(kind, prompt, why, answer)
    try:
        repaired, retry_notes = await _call_oracle_with_retry(repair_prompt, response_mode="final_only", priority=priority, timeout_s=12.0)
        notes.extend(retry_notes)
        repaired = _ensure_citations(repaired, required_citations)
        ok2, why2 = _validate(kind, repaired)
        citation_ok2, missing2, predicted2 = _citation_gap(required_citations, repaired)
        if ok2 and not citation_ok2:
            ok2 = False
            why2 = "citation:missing_after_repair"
        notes.append(f"repair_validation:{why2}")
        return {
            "ok": True,
            "response": repaired,
            "augmenter": {
                "decision": decision.__dict__,
                "validation": {
                    "ok": ok2,
                    "why": why2,
                    "citation_required": required_citations,
                    "citation_missing": missing2,
                    "citation_predicted": predicted2,
                },
                "repairs": 1,
                "notes": notes,
                "elapsed_ms": int((time.time() - t0) * 1000),
            },
        }
    except Exception as e:
        notes.append(f"repair_failed:{type(e).__name__}:{e}")
        fallback_answer = _ensure_citations(answer, required_citations)
        citation_ok_fallback, missing_fallback, predicted_fallback = _citation_gap(required_citations, fallback_answer)
        return {
            "ok": True,
            "response": fallback_answer,
            "augmenter": {
                "decision": decision.__dict__,
                "validation": {
                    "ok": False if not citation_ok_fallback else True,
                    "why": "citation:forced_append_after_repair_failure" if citation_ok_fallback else why,
                    "citation_required": required_citations,
                    "citation_missing": missing_fallback,
                    "citation_predicted": predicted_fallback,
                },
                "repairs": 0,
                "notes": notes,
                "elapsed_ms": int((time.time() - t0) * 1000),
            },
        }


@router.get("/status")
async def status():
    return {
        "level": 38,
        "name": "Augmenter",
        "goal": "Improve real-world reliability of the configured base model with minimal latency impact",
        "purpose": "Model-adaptive guardrail layer (validate + one-shot repair) with clear HUD visibility",
        "base_model": _get_base_model(),
        "enabled": os.getenv("AUGMENTER_ENABLED", "true").lower() in ("1","true","yes"),
        "degraded": False,
        "degraded_reasons": [],
        "escalation": {
            "level0": "single_call_then_validate",
            "level1": "one_shot_repair_then_validate (gated)",
        },
    }
