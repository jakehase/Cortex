"""L38 Augmenter — output-contract guardrails around an Oracle answer.

What it does (POST /augmenter/chat):

1. Infers the output contract the prompt asks for (``tool_json``,
   ``choice_letter``, ``numeric``, ``code``, ``freeform``) and any required
   ``Source: path#Lx`` citations (``modules.augmenter``).
2. For clearly operational prompts (multi-word ops intents such as "database
   migration" or "rollback plan") it adds two in-process inputs: a read-only
   Sentinel health snapshot and an L20 Simulator run. No watchers are
   registered and no HTTP self-calls are made.
3. Generates the answer through ``/oracle/chat`` with the caller's forwarded
   principal and write token (completion receipt required).
4. Validates the answer deterministically; at most one model repair.
5. Returns ``ok: true`` only when the final answer passes its contract. A
   failing answer is still returned in ``response`` but with ``ok: false``.
   Missing citations are reported, never appended.

GET /augmenter/status reports measured counters and honours AUGMENTER_ENABLED
(when false, /chat answers 503 ``augmenter_disabled``).
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from cortex_server.internal_addressing import internal_url
from cortex_server.modules import augmenter as core
from cortex_server.modules import level_model

router = APIRouter(tags=["augmenter"])

CONFIG_PATHS = [
    Path("/app/config/openclaw_config.json"),
    Path("/opt/clawdbot/openclaw_config.json"),
]
DEGRADED_FAILURE_RATE = 0.5
SIMULATOR_DEADLINES_S = {"fast": 30.0, "deep": 45.0}


@dataclass
class PolicyDecision:
    base_model: str
    risk: float
    kind: str  # freeform|choice_letter|tool_json|numeric|code
    level: int  # 0 fast, 1 repair
    reason: str
    risk_basis: str = "routing_heuristic"


class AugmenterChatRequest(BaseModel):
    prompt: str = Field(min_length=1)
    system: Optional[str] = None
    response_mode: str = "final_only"
    priority: str = "normal"
    latency_budget_ms: Optional[int] = None
    # Accepted for compatibility. External bridge delegation was removed: it
    # forwarded the user's prompt to an external connection and discarded the reply.
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
    return cfg.get("runtime", {}).get("base_model") or cfg.get("runtime", {}).get("model") or "unknown"


# Backward-compatible names for the deterministic helpers.
_classify_kind = core.classify_kind
_validate = core.validate
_extract_requested_citations = core.requested_citations
_extract_citations = core.answer_citations
_citation_gap = core.citation_gap


def _risk_score(prompt: str, kind: str) -> float:
    return core.routing_risk(prompt, kind)


def _is_ops_risk_prompt(prompt: str) -> bool:
    return core.is_ops_intent(prompt)


def _wants_deep_sim(prompt: str, payload: Any) -> bool:
    mode = getattr(payload, "simulator_mode", None)
    if isinstance(mode, str) and mode.lower() == "deep":
        return True
    p = (prompt or "").lower()
    return ("deep sim" in p) or ("deep simulation" in p) or ("simulate deeply" in p)


async def _sentinel_snapshot() -> Optional[Dict[str, Any]]:
    """Read-only, in-process Sentinel health snapshot (no watcher registration)."""
    try:
        from cortex_server.routers import sentinel

        status = await sentinel.sentinel_status()
    except Exception:
        return None
    if not isinstance(status, dict):
        return None
    return {
        "status": status.get("status"),
        "health_reason": status.get("health_reason"),
        "active_watchers": status.get("active_watchers"),
        "latest_scan_issues": status.get("latest_scan_issues"),
        "last_scan_age_seconds": status.get("last_scan_age_seconds"),
    }


async def _simulate_in_process(prompt: str, mode: str, scope_key: str) -> Dict[str, Any]:
    """L20 Simulator via its in-process core (principal-scoped model call)."""
    from cortex_server.routers.simulator import simulate_core

    return await simulate_core(
        f"{prompt}\n\nFocus on operational risks and failure modes of executing this.",
        mode=mode,
        principal_scope_key=scope_key,
        deadline_s=SIMULATOR_DEADLINES_S.get(mode, 30.0),
    )


async def _call_oracle(
    prompt: str,
    response_mode: str,
    priority: str,
    timeout_s: float,
    *,
    headers: Optional[Dict[str, str]] = None,
    system: Optional[str] = None,
) -> str:
    url = internal_url("/oracle/chat")
    payload = {"prompt": prompt, "response_mode": response_mode, "priority": priority, "system": system}
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        r = await client.post(url, json=payload, headers={**dict(headers or {}), "x-augmenter-bypass": "1"})
        r.raise_for_status()
        data = r.json()
        text = str(data.get("response") or "")
        from cortex_server.routers.oracle import _EvidenceText, _upstream_completion

        completion = _upstream_completion(data, response=text, default_origin="oracle_child")
        if completion["done"] and data.get("degraded") is not True and data.get("ok") is not False:
            return _EvidenceText(
                text, completion_receipt=completion["completion_receipt"],
                origin=completion["origin"], provider_invoked=completion["provider_invoked"],
                selected_model=completion["model"], selected_provider=completion["provider"],
            )
        return text


async def _call_oracle_with_retry(
    prompt: str,
    response_mode: str,
    priority: str,
    timeout_s: float,
    *,
    headers: Optional[Dict[str, str]] = None,
    system: Optional[str] = None,
) -> Tuple[str, List[str]]:
    notes: List[str] = []
    last_err: Optional[Exception] = None
    for idx, t in enumerate([timeout_s, max(8.0, timeout_s - 4.0)], start=1):
        try:
            if idx > 1:
                notes.append(f"oracle_retry_attempt:{idx}")
            return await _call_oracle(prompt, response_mode=response_mode, priority=priority,
                                      timeout_s=t, headers=headers, system=system), notes
        except Exception as e:
            last_err = e
            notes.append(f"oracle_attempt_failed:{idx}:{type(e).__name__}")
    raise last_err if last_err else RuntimeError("oracle_call_failed")


def _completion_fields(answer: str, final_answer: str, *, validation_ok: bool) -> Dict[str, Any]:
    """Forward only verified evidence; formatting does not invent a provider call."""
    from cortex_server.routers.oracle import _upstream_completion

    original = str(answer)
    fields = _upstream_completion({
        "done": bool(getattr(answer, "completion_receipt", None)),
        "completion_receipt": getattr(answer, "completion_receipt", None),
        "provider_invoked": getattr(answer, "provider_invoked", False),
        "model": getattr(answer, "selected_model", None),
        "origin": getattr(answer, "origin", None),
    }, response=original, default_origin="augmenter")
    if not validation_ok:
        fields.update(done=False, degraded=True, origin="augmenter_validation_failed")
        return fields
    if fields["done"]:
        receipt = dict(fields["completion_receipt"])
        receipt["delivered_response_sha256"] = hashlib.sha256(final_answer.encode("utf-8")).hexdigest()
        fields["completion_receipt"] = receipt
        fields["origin"] = "augmenter_verified_transform" if final_answer != original else "augmenter_verified_passthrough"
    return fields


def _check(kind: str, text: str, prompt: str, required: List[str]) -> Tuple[bool, str, List[str], List[str]]:
    ok, why = core.validate(kind, text, prompt)
    cited_ok, missing, predicted = core.citation_gap(required, text)
    if ok and not cited_ok:
        ok, why = False, "citation:missing_required"
    return ok, why, missing, predicted


def _forwarded_headers(http_request: Request, session_id: str) -> Dict[str, str]:
    names = {
        "x-cortex-tenant-id", "x-cortex-workspace-id", "x-cortex-agent-id", "x-cortex-user-id",
        "x-cortex-channel-id", "x-cortex-session-id", "x-cortex-scope-credential-id",
        "x-cortex-scope-signature", "x-session-id", "x-chat-id",
        os.getenv("CORTEX_WRITE_TOKEN_HEADER", "x-cortex-write-token").strip().lower(),
    }
    headers = {n: str(http_request.headers.get(n) or "") for n in names if str(http_request.headers.get(n) or "").strip()}
    headers["x-session-id"] = session_id
    return headers


def _track(http_request: Request, level: int, name: str, *, status: Optional[str] = None,
           always_on: Optional[bool] = None, **extra: Any) -> None:
    try:
        from cortex_server.middleware.hud_middleware import track_attempt, track_level

        if status is not None:
            track_attempt(http_request, level, name, status=status, **extra)
        if always_on is not None:
            track_level(http_request, level, name, always_on=always_on)
    except Exception:
        pass


@router.post("/chat")
async def chat(payload: AugmenterChatRequest, http_request: Request):
    if not core.augmenter_enabled():
        core.STATS.record_disabled()
        return JSONResponse(status_code=503, content={
            "ok": False, "error": "augmenter_disabled", "response": "",
            "detail": "AUGMENTER_ENABLED is false",
        })

    from cortex_server.routers.nexus import _authenticated_nexus_principal

    transport_session = str(http_request.headers.get("x-session-id") or http_request.headers.get("x-chat-id") or "").strip()
    principal, _ = _authenticated_nexus_principal(http_request, session_hint=transport_session)
    oracle_headers = _forwarded_headers(http_request, principal.session_id)
    prompt = payload.prompt
    latency_budget_ms = payload.latency_budget_ms

    kind = core.classify_kind(prompt)
    decision = PolicyDecision(base_model=_get_base_model(), risk=core.routing_risk(prompt, kind),
                              kind=kind, level=0, reason="fast_path")
    allow_repair = decision.risk >= 0.45 or kind in ("tool_json", "choice_letter", "code")
    tight_budget = isinstance(latency_budget_ms, int) and 0 < latency_budget_ms < 1200
    if tight_budget:
        allow_repair = False
    required = core.requested_citations(prompt)
    if required and not tight_budget:
        allow_repair = True

    t0 = time.time()
    notes: List[str] = []
    if required:
        notes.append(f"citation_required:{len(required)}")
    if payload.allow_external or payload.external_connection_id:
        notes.append("bridge_delegation_removed")

    sentinel_summary = None
    sim_summary = None
    if core.is_ops_intent(prompt) and not tight_budget:
        sentinel_summary = await _sentinel_snapshot()
        notes.append("sentinel_snapshot_ok" if sentinel_summary is not None else "sentinel_snapshot_unavailable")
        sim_mode = "deep" if _wants_deep_sim(prompt, payload) else "fast"
        try:
            sim = await _simulate_in_process(prompt, sim_mode, level_model.scope_key_for_request(http_request, "augmenter"))
            if isinstance(sim, dict) and sim.get("success") and sim.get("outcomes"):
                sim_summary = {
                    "mode": sim_mode,
                    "probability_basis": sim.get("probability_basis"),
                    "outcomes": [{k: o.get(k) for k in ("label", "probability", "key_events", "timeline", "impact_assessment")}
                                 for o in sim["outcomes"][:3]],
                }
                notes.append(f"simulator_ok:{sim_mode}")
                _track(http_request, 20, "Simulator", status="success", always_on=True)
            else:
                notes.append(f"simulator_unavailable:{sim_mode}:{(sim or {}).get('status') if isinstance(sim, dict) else 'unknown'}")
        except Exception as e:
            notes.append(f"simulator_exception:{type(e).__name__}")

    final_system = payload.system
    if sentinel_summary is not None or sim_summary is not None:
        header = ""
        if sentinel_summary is not None:
            header += "[L21 Sentinel — read-only health snapshot]\n" + json.dumps(sentinel_summary) + "\n\n"
        if sim_summary is not None:
            header += "[L20 Simulator — model-estimated operational outcomes]\n" + json.dumps(sim_summary) + "\n\n"
        final_system = header + (payload.system or "")

    _track(http_request, 5, "Oracle", status="attempted")
    try:
        answer, retry_notes = await _call_oracle_with_retry(
            prompt, response_mode=payload.response_mode, priority=payload.priority, timeout_s=18.0,
            headers=oracle_headers, system=final_system)
        notes.extend(retry_notes)
        _track(http_request, 5, "Oracle", status="success")
    except Exception as e:
        _track(http_request, 5, "Oracle", status="failed", error=type(e).__name__)
        core.STATS.record(kind=kind, oracle_ok=False, final_ok=False, initial_ok=False,
                          repaired=False, repair_ok=False, error_type=type(e).__name__)
        return {
            "ok": False,
            "error": f"oracle_call_failed:{type(e).__name__}",
            "response": "",
            "augmenter": {"decision": decision.__dict__, "notes": notes, "elapsed_ms": int((time.time() - t0) * 1000)},
        }

    _track(http_request, 5, "Oracle", always_on=True)
    _track(http_request, 38, "Augmenter", always_on=False)

    def body(ok: bool, final_text: str, source_answer: str, why: str, missing: List[str],
             predicted: List[str], repairs: int) -> Dict[str, Any]:
        return {
            "ok": ok,
            "response": final_text,
            **_completion_fields(source_answer, final_text, validation_ok=ok),
            "augmenter": {
                "decision": decision.__dict__,
                "contract": core.contract_guidance(kind, required),
                "validation": {
                    "ok": ok,
                    "why": why,
                    "citation_required": required,
                    "citation_missing": missing,
                    "citation_predicted": predicted,
                },
                "repairs": repairs,
                "notes": notes,
                "elapsed_ms": int((time.time() - t0) * 1000),
            },
        }

    ok, why, missing, predicted = _check(kind, answer, prompt, required)
    if ok:
        core.STATS.record(kind=kind, oracle_ok=True, final_ok=True, initial_ok=True, repaired=False, repair_ok=False)
        return body(True, answer, answer, why, [], predicted, 0)

    notes.append(f"initial_validation_failed:{why}")
    if not allow_repair:
        core.STATS.record(kind=kind, oracle_ok=True, final_ok=False, initial_ok=False, repaired=False,
                          repair_ok=False, error_type=why)
        return body(False, answer, answer, why, missing, predicted, 0)

    decision.level = 1
    decision.reason = "repair"
    try:
        repaired, retry_notes = await _call_oracle_with_retry(
            core.repair_prompt(kind, prompt, why, str(answer), required), response_mode="final_only",
            priority=payload.priority, timeout_s=12.0, headers=oracle_headers, system=final_system)
        notes.extend(retry_notes)
    except Exception as e:
        notes.append(f"repair_failed:{type(e).__name__}")
        core.STATS.record(kind=kind, oracle_ok=True, final_ok=False, initial_ok=False, repaired=True,
                          repair_ok=False, error_type=f"repair_failed:{type(e).__name__}")
        return body(False, answer, answer, why, missing, predicted, 0)

    ok2, why2, missing2, predicted2 = _check(kind, repaired, prompt, required)
    if not ok2 and why2 == "citation:missing_required":
        why2 = "citation:missing_after_repair"
    notes.append(f"repair_validation:{why2}")
    core.STATS.record(kind=kind, oracle_ok=True, final_ok=ok2, initial_ok=False, repaired=True,
                      repair_ok=ok2, error_type=None if ok2 else why2)
    return body(ok2, repaired, repaired, why2, missing2, predicted2, 1)


@router.get("/status")
async def status():
    enabled = core.augmenter_enabled()
    stats = core.STATS.snapshot()
    reasons: List[str] = []
    if not enabled:
        reasons.append("disabled_by_AUGMENTER_ENABLED")
    rate = stats.get("recent_oracle_failure_rate")
    if rate is not None and rate >= DEGRADED_FAILURE_RATE:
        reasons.append(f"oracle_failure_rate_{rate}_over_last_{stats.get('recent_window')}_calls")
    return {
        "level": 38,
        "name": "Augmenter",
        "purpose": "Output-contract validation with at most one model repair around Oracle answers",
        "base_model": _get_base_model(),
        "enabled": enabled,
        "degraded": bool(reasons),
        "degraded_reasons": reasons,
        "health_basis": "measured" if stats.get("recent_window") else "no_calls_observed_since_boot",
        "stats": stats,
        "validated_contracts": ["tool_json", "choice_letter", "numeric", "code(python)", "citations"],
        "escalation": {
            "level0": "single_call_then_validate",
            "level1": "one_shot_repair_then_validate (gated)",
        },
    }
