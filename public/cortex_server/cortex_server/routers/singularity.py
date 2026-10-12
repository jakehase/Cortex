"""
Level 35 — The Singularity: automated code review.

* POST /singularity/analyze — model-backed review (gpt-5.6-sol through the
  Oracle lane via ``level_model``) plus deterministic static checks, each
  labelled ``source: "static"``. If the model is unavailable the response is
  HTTP 503 ``success: false, mode: "fallback_static_only"`` with only the
  static findings. ``file_path`` is admin-only and limited to source files
  inside the cortex_server package.
* POST /singularity/improve — model-proposed rewrite returned as a unified diff
  with a syntax check. Nothing is applied.
* GET /singularity/analyze/jobs/{id}, /metrics, /status — real in-process state.
"""

import asyncio
import time
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from cortex_server.models.api_contracts import (
    AcceptedJobResponse,
    SingularityAnalysisResponse,
)
from cortex_server.modules import level_model
from cortex_server.modules import singularity as review_core
from cortex_server.modules.consciousness_integration import conscious_action
from cortex_server.modules.unified_messaging import get_bus

router = APIRouter(tags=["Singularity"])

ANALYZE_JOB_TTL_SECONDS = 60 * 60
ANALYZE_JOB_MAX = 200
MAX_HISTORY = 50

ALLOWED_FINDING_CATEGORIES = set(review_core.CATEGORIES)
ALLOWED_SEVERITIES = set(review_core.SEVERITIES)

# ── Module-level state (since boot) ─────────────────────────────────
singularity_state: Dict[str, Any] = {
    "analyses_run": 0,
    "analyses_model": 0,
    "analyses_static_only": 0,
    "improvements_suggested": 0,
    "improvement_proposals": 0,
    "last_analysis_ts": None,
    "last_improvement_ts": None,
    "history": [],
    "async_jobs_created": 0,
    "async_jobs_completed": 0,
    "async_jobs_failed": 0,
}

analyze_jobs: Dict[str, Dict[str, Any]] = {}


# ── Request Models ──────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    code: Optional[str] = None
    file_path: Optional[str] = None  # admin only; cortex_server source files
    scope: str = "full"  # full | quick
    mode: str = "sync"  # sync | async
    wait_seconds: float = 0.0  # optional long-poll for async mode


class ImproveRequest(BaseModel):
    code: str
    goal: str = "general improvement"
    aggressive: bool = False


# ── Helpers ─────────────────────────────────────────────────────────
def _request_is_admin(http_request: Optional[Request]) -> bool:
    state = getattr(http_request, "state", None) if http_request is not None else None
    principal = getattr(state, "cortex_principal", None) if state is not None else None
    return bool(
        principal is not None
        and getattr(principal, "role", None) == "admin"
        and getattr(principal, "credential_id", None) == "cortex-admin"
    )


def _record_history(op: str, detail: str) -> None:
    singularity_state["history"].append({"op": op, "detail": detail[:200], "ts": time.time()})
    if len(singularity_state["history"]) > MAX_HISTORY:
        singularity_state["history"] = singularity_state["history"][-MAX_HISTORY:]


def _broadcast_self_improvement(event_subtype: str, data: dict):
    try:
        get_bus().broadcast("singularity", "self_improvement", {"subtype": event_subtype, **data})
    except Exception:
        pass


def _validate_analyze_contract(request: AnalyzeRequest) -> Optional[str]:
    if not request.code and not request.file_path:
        return "provide code or file_path"
    if request.code and len(request.code) > review_core.MAX_CODE_CHARS:
        return "code too large (max 80k chars)"
    if request.scope not in {"full", "quick"}:
        return "scope must be full or quick"
    if request.mode not in {"sync", "async"}:
        return "mode must be sync or async"
    if request.wait_seconds < 0 or request.wait_seconds > 10:
        return "wait_seconds must be between 0 and 10"
    return None


def _validate_improve_contract(request: ImproveRequest) -> Optional[str]:
    if not request.code or not request.code.strip():
        return "code is required"
    if len(request.code) > review_core.MAX_CODE_CHARS:
        return "code too large (max 80k chars)"
    if len(request.goal) > 1000:
        return "goal too long (max 1000 chars)"
    return None


def _cleanup_analyze_jobs() -> None:
    now = time.time()
    for job_id in [j for j, job in analyze_jobs.items()
                   if (now - float(job.get("updated_at", now))) > ANALYZE_JOB_TTL_SECONDS]:
        analyze_jobs.pop(job_id, None)
    if len(analyze_jobs) > ANALYZE_JOB_MAX:
        ordered = sorted(analyze_jobs.items(), key=lambda item: float(item[1].get("updated_at", 0)))
        for job_id, _ in ordered[: len(analyze_jobs) - ANALYZE_JOB_MAX]:
            analyze_jobs.pop(job_id, None)


async def _maybe_wait_for_job(job_id: str, wait_seconds: float) -> Optional[Dict[str, Any]]:
    if wait_seconds <= 0:
        return None
    deadline = time.time() + min(wait_seconds, 10.0)
    while time.time() < deadline:
        job = analyze_jobs.get(job_id)
        if not job:
            return None
        if job.get("status") in {"succeeded", "failed"}:
            return job
        await asyncio.sleep(0.2)
    return analyze_jobs.get(job_id)


def _public_job_view(job: Dict[str, Any]) -> Dict[str, Any]:
    out = {
        "job_id": job.get("job_id"),
        "status": job.get("status"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "source": job.get("source"),
        "scope": job.get("scope"),
        "mode": "async",
    }
    if job.get("status") == "failed":
        out["error"] = job.get("error")
        if job.get("fallback") is not None:
            out["fallback"] = job.get("fallback")
    if job.get("status") == "succeeded":
        out["result"] = job.get("result")
    return out


def _account_analysis(analysis: Dict[str, Any]) -> None:
    singularity_state["analyses_run"] += 1
    singularity_state["analyses_model" if analysis.get("ok") else "analyses_static_only"] += 1
    singularity_state["improvements_suggested"] += int(analysis.get("findings_count") or 0)
    singularity_state["last_analysis_ts"] = time.time()
    _record_history("analyze", f"{analysis.get('source')}: mode={analysis.get('mode')} "
                               f"findings={analysis.get('findings_count')}")
    _broadcast_self_improvement("analysis_complete", {
        "source": analysis.get("source"),
        "findings_count": analysis.get("findings_count"),
        "scope": analysis.get("scope"),
        "mode": analysis.get("mode"),
    })


def _public_analysis(analysis: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in analysis.items() if k != "ok"}


def _unavailable_body(analysis: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "success": False,
        "error": "model_unavailable",
        "mode": "fallback_static_only",
        "origin": "model_unavailable",
        "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL,
        "model_status": analysis.get("model_status"),
        "static_findings": analysis.get("static_findings", []),
        "static_checks": analysis.get("static_checks"),
        "source": analysis.get("source"),
        "scope": analysis.get("scope"),
    }


async def _run_async_analyze_job(job_id: str, code: str, source_label: str, scope: str, scope_key: str) -> None:
    job = analyze_jobs.get(job_id)
    if not job:
        return
    job["status"] = "running"
    job["updated_at"] = time.time()
    try:
        analysis = await review_core.review_code(
            code, source_label=source_label, scope=scope, principal_scope_key=scope_key,
            deadline_s=review_core.REVIEW_DEADLINE_ASYNC_S,
        )
        _account_analysis(analysis)
        if analysis.get("ok"):
            job["status"] = "succeeded"
            job["result"] = {"success": True, "analysis": _public_analysis(analysis)}
            singularity_state["async_jobs_completed"] += 1
        else:
            job["status"] = "failed"
            job["error"] = f"model_unavailable:{analysis.get('model_status')}"
            job["fallback"] = _unavailable_body(analysis)
            singularity_state["async_jobs_failed"] += 1
    except Exception as exc:
        job["status"] = "failed"
        job["error"] = type(exc).__name__
        singularity_state["async_jobs_failed"] += 1
    job["updated_at"] = time.time()


def _load_code(request: AnalyzeRequest, http_request: Request) -> tuple[str, str]:
    if request.code:
        return request.code, "inline code"
    if not _request_is_admin(http_request):
        raise HTTPException(status_code=403, detail="file_path review requires administrator authorization")
    try:
        return review_core.read_review_file(request.file_path or "")
    except review_core.ReviewPathError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.reason)


# ── Routes ──────────────────────────────────────────────────────────
@router.post(
    "/analyze",
    response_model=SingularityAnalysisResponse,
    responses={
        202: {"model": AcceptedJobResponse, "description": "Analysis accepted"},
        503: {"description": "Model unavailable; only labelled static findings returned"},
    },
)
async def analyze_code(request: AnalyzeRequest, http_request: Request):
    """Model-backed code review plus labelled static checks."""
    validation_error = _validate_analyze_contract(request)
    if validation_error:
        raise HTTPException(status_code=422, detail=validation_error)

    code, source_label = _load_code(request, http_request)
    if not code or not code.strip():
        raise HTTPException(status_code=422, detail="No code provided (supply code or valid file_path)")
    scope_key = level_model.scope_key_for_request(http_request, "singularity")

    if request.mode == "async":
        _cleanup_analyze_jobs()
        job_id = str(uuid.uuid4())
        now = time.time()
        analyze_jobs[job_id] = {
            "job_id": job_id, "status": "queued", "created_at": now, "updated_at": now,
            "source": source_label, "scope": request.scope, "error": None, "result": None,
        }
        singularity_state["async_jobs_created"] += 1
        asyncio.create_task(_run_async_analyze_job(job_id, code, source_label, request.scope, scope_key))
        waited_job = await _maybe_wait_for_job(job_id, request.wait_seconds)
        return JSONResponse(status_code=202, content={
            "success": True,
            "accepted": True,
            "job": _public_job_view(waited_job or analyze_jobs[job_id]),
            "poll": f"/singularity/analyze/jobs/{job_id}",
        })

    async with conscious_action("singularity", "analyze", {
        "source": source_label,
        "scope": request.scope,
        "has_inline_code": bool(request.code),
    }) as ctx:
        analysis = await review_core.review_code(
            code, source_label=source_label, scope=request.scope, principal_scope_key=scope_key,
        )
        _account_analysis(analysis)
        ctx.set_result({"source": source_label, "mode": analysis.get("mode"),
                        "findings_count": analysis.get("findings_count")})

    if not analysis.get("ok"):
        return JSONResponse(status_code=503, content=_unavailable_body(analysis))
    return {"success": True, "analysis": _public_analysis(analysis)}


@router.get("/analyze/jobs/{job_id}")
async def analyze_job_status(job_id: str):
    _cleanup_analyze_jobs()
    job = analyze_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return {"success": True, "job": _public_job_view(job)}


@router.post("/improve")
async def improve_code(request: ImproveRequest, http_request: Request):
    """Model-proposed improvement as a diff. Nothing is applied."""
    validation_error = _validate_improve_contract(request)
    if validation_error:
        raise HTTPException(status_code=422, detail=validation_error)

    async with conscious_action("singularity", "improve", {
        "goal": request.goal[:200],
        "aggressive": request.aggressive,
    }) as ctx:
        proposal = await review_core.propose_improvement(
            request.code, goal=request.goal, aggressive=request.aggressive,
            principal_scope_key=level_model.scope_key_for_request(http_request, "singularity"),
        )
        ctx.set_result({"ok": bool(proposal.get("ok")), "changed": bool(proposal.get("changed"))})

    if not proposal.get("ok"):
        return JSONResponse(status_code=503, content={
            "success": False,
            "error": "model_unavailable",
            "origin": "model_unavailable",
            "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL,
            "model_status": proposal.get("model_status"),
            "improvement": None,
        })

    singularity_state["improvement_proposals"] += 1
    singularity_state["last_improvement_ts"] = time.time()
    _record_history("improve", f"goal={request.goal[:80]}, changes={len(proposal.get('changes') or [])}")
    _broadcast_self_improvement("improvement_proposed", {
        "goal": request.goal[:200],
        "changes_count": len(proposal.get("changes") or []),
        "syntax_ok": proposal.get("syntax_ok"),
    })
    return {
        "success": True,
        "applied": False,
        "origin": "model",
        "model": proposal.get("model"),
        "receipt_id": proposal.get("receipt_id"),
        "improvement": {
            "original_code": request.code,
            "improved_code": proposal["improved_code"],
            "diff": proposal["diff"],
            "changed": proposal["changed"],
            "changes": proposal.get("changes") or [],
            "diff_summary": proposal.get("diff_summary", ""),
            "syntax_ok": proposal.get("syntax_ok"),
            "syntax_error": proposal.get("syntax_error"),
            "code_redacted": proposal.get("code_redacted", False),
            "goal": request.goal,
            "note": "proposal only; review and apply manually",
        },
    }


def _model_view() -> Dict[str, Any]:
    stats = review_core.stats_snapshot()
    attempts = stats["model_successes"] + stats["model_failures"]
    return {
        "model_lane": "level_model (gpt-5.6-sol through the Oracle lane)",
        "model_successes": stats["model_successes"],
        "model_failures": stats["model_failures"],
        "model_attempts": attempts,
        "model_reliability": round(stats["model_successes"] / attempts, 3) if attempts else None,
        "model_consecutive_failures": stats["consecutive_failures"],
        "last_model_status": stats["last_model_status"],
        "last_model_at": stats["last_model_at"],
        "last_model_success_at": stats["last_model_success_at"],
        "findings_dropped_unverified": stats["findings_dropped_unverified"],
        "counters_scope": "since_boot",
        "counters_since": stats["since"],
    }


@router.get("/metrics")
async def get_metrics():
    """Tracked in-process metrics about reviews and proposals (since boot)."""
    _cleanup_analyze_jobs()
    running_jobs = sum(1 for job in analyze_jobs.values() if job.get("status") in {"queued", "running"})
    return {
        "success": True,
        "data": {
            "analyses_run": singularity_state["analyses_run"],
            "analyses_model": singularity_state["analyses_model"],
            "analyses_static_only": singularity_state["analyses_static_only"],
            "improvements_suggested": singularity_state["improvements_suggested"],
            "improvement_proposals": singularity_state["improvement_proposals"],
            "improvements_applied": 0,
            "last_analysis_ts": singularity_state["last_analysis_ts"],
            "last_improvement_ts": singularity_state["last_improvement_ts"],
            "avg_findings_per_analysis": round(
                singularity_state["improvements_suggested"] / max(1, singularity_state["analyses_run"]), 1),
            **_model_view(),
            "async_jobs": {
                "created": singularity_state["async_jobs_created"],
                "completed": singularity_state["async_jobs_completed"],
                "failed": singularity_state["async_jobs_failed"],
                "in_memory": len(analyze_jobs),
                "active": running_jobs,
            },
            "recent_history": singularity_state["history"][-10:],
        },
        "error": None,
    }


@router.get("/status")
async def singularity_status():
    _cleanup_analyze_jobs()
    running_jobs = sum(1 for job in analyze_jobs.values() if job.get("status") in {"queued", "running"})
    model = _model_view()
    last = model["last_model_status"]
    health = "unverified" if last is None else ("ok" if last == "ok" else "degraded")
    capabilities = ["static_python_checks", "async_analysis_jobs"]
    if health != "degraded":
        capabilities[:0] = ["model_code_review", "model_improvement_proposals"]
    return {
        "success": True,
        "data": {
            "level": 35,
            "name": "The Singularity",
            "status": "degraded" if health == "degraded" else "active",
            "model_health": health,
            "analyses_run": singularity_state["analyses_run"],
            "analyses_model": singularity_state["analyses_model"],
            "analyses_static_only": singularity_state["analyses_static_only"],
            "improvements_suggested": singularity_state["improvements_suggested"],
            "improvement_proposals": singularity_state["improvement_proposals"],
            "improvements_applied": 0,
            "last_analysis_ts": singularity_state["last_analysis_ts"],
            **model,
            "async_jobs_active": running_jobs,
            "file_review": "admin only; cortex_server source files up to 256 KB",
            "self_modification": "not implemented",
            "capabilities": capabilities,
        },
        "error": None,
    }
