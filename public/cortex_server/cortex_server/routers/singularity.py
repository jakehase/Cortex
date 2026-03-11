"""
Level 35 — The Singularity
Real self-improvement analysis powered by L5 Oracle (cloud reasoning).
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import asyncio
import ast
import httpx
import json
import random
import re
import time
import uuid

# ── Consciousness Integration ──
from cortex_server.modules.consciousness_integration import (
    conscious_action,
    chain_to,
)
from cortex_server.modules.unified_messaging import get_bus

router = APIRouter(tags=["Singularity"])

ORACLE_URL = "http://localhost:8888/oracle/chat"
ORACLE_TIMEOUT_SYNC = 20.0
ORACLE_TIMEOUT_ASYNC = 75.0
SINGULARITY_GUARD_TIMEOUT_SYNC = 22.0
SINGULARITY_GUARD_TIMEOUT_ASYNC = 90.0
ORACLE_BREAKER_THRESHOLD = 5
ORACLE_BREAKER_COOLDOWN_SECONDS = 20
ANALYZE_JOB_TTL_SECONDS = 60 * 60
ANALYZE_JOB_MAX = 200

# ── Module-level state ──────────────────────────────────────────────
singularity_state: Dict[str, Any] = {
    "analyses_run": 0,
    "improvements_suggested": 0,
    "improvements_applied": 0,
    "last_analysis_ts": None,
    "last_improvement_ts": None,
    "history": [],  # last N operations
    "oracle_successes": 0,
    "oracle_failures": 0,
    "oracle_consecutive_failures": 0,
    "oracle_breaker_open_until": 0.0,
    "oracle_recoveries": 0,
    "oracle_last_error": None,
    "async_jobs_created": 0,
    "async_jobs_completed": 0,
    "async_jobs_failed": 0,
    "quality_retry_attempts": 0,
    "quality_retry_improved": 0,
    "transient_retry_attempts": 0,
    "transient_retry_improved": 0,
}

analyze_jobs: Dict[str, Dict[str, Any]] = {}

MAX_HISTORY = 50

ALLOWED_FINDING_CATEGORIES = {
    "bug",
    "performance",
    "error_handling",
    "architecture",
    "refactoring",
    "security",
    "testing",
}
ALLOWED_SEVERITIES = {"low", "medium", "high", "critical"}
DEFAULT_SUGGESTION = "Review and apply if aligned with project goals."


# ── Request Models ──────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    code: Optional[str] = None
    file_path: Optional[str] = None  # path inside the cortex-brain container
    scope: str = "full"  # full | quick
    mode: str = "sync"  # sync | async
    wait_seconds: float = 0.0  # optional long-poll for async mode


class ImproveRequest(BaseModel):
    code: str
    goal: str = "general improvement"
    aggressive: bool = False


# ── Oracle helper ───────────────────────────────────────────────────
async def _ask_oracle(prompt: str, system: str, timeout_s: float) -> str:
    """Call L5 Oracle with retries + breaker for better stability."""
    now = time.time()
    if now < singularity_state.get("oracle_breaker_open_until", 0.0):
        raise RuntimeError(f"Oracle circuit open for {int(singularity_state['oracle_breaker_open_until'] - now)}s")

    request_variants = [
        {
            "prompt": prompt,
            "system": system,
            "model": "openai-codex/gpt-5.3-codex",
            "priority": "high",
            "response_mode": "final_only",
        }
    ]
    headers = {
        "x-augmenter-bypass": "1",
        "x-session-id": f"singularity-{uuid.uuid4().hex[:10]}",
        "x-router": "singularity",
    }

    last_exc: Optional[Exception] = None
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        for idx, payload in enumerate(request_variants):
            try:
                resp = await client.post(ORACLE_URL, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                singularity_state["oracle_successes"] += 1
                singularity_state["oracle_consecutive_failures"] = 0
                singularity_state["oracle_last_error"] = None
                if idx > 0:
                    singularity_state["oracle_recoveries"] += 1
                return data.get("response") or data.get("text") or json.dumps(data)
            except Exception as exc:
                last_exc = exc
                if idx < len(request_variants) - 1:
                    await asyncio.sleep(0.35)
                    continue

    singularity_state["oracle_failures"] += 1
    singularity_state["oracle_consecutive_failures"] += 1
    singularity_state["oracle_last_error"] = str(last_exc)[:240] if last_exc else "unknown"
    if singularity_state["oracle_consecutive_failures"] >= ORACLE_BREAKER_THRESHOLD:
        singularity_state["oracle_breaker_open_until"] = time.time() + ORACLE_BREAKER_COOLDOWN_SECONDS
    raise last_exc if last_exc else RuntimeError("oracle_failed_without_exception")


def _read_container_file(path: str) -> Optional[str]:
    """Read a file from the local container filesystem."""
    try:
        with open(path, "r") as f:
            return f.read()
    except Exception:
        return None


def _record_history(op: str, detail: str) -> None:
    """Append an entry to the rolling history."""
    singularity_state["history"].append({
        "op": op,
        "detail": detail[:200],
        "ts": time.time(),
    })
    if len(singularity_state["history"]) > MAX_HISTORY:
        singularity_state["history"] = singularity_state["history"][-MAX_HISTORY:]


def _broadcast_self_improvement(event_subtype: str, data: dict):
    """Broadcast a self_improvement event on the bus."""
    try:
        bus = get_bus()
        bus.broadcast("singularity", "self_improvement", {
            "subtype": event_subtype,
            **data,
        })
    except Exception:
        pass


def _validate_analyze_contract(request: AnalyzeRequest) -> Optional[str]:
    if not request.code and not request.file_path:
        return "provide code or file_path"
    if request.code and len(request.code) > 80000:
        return "code too large (max 80k chars)"
    if request.scope not in {"full", "quick"}:
        return "scope must be full or quick"
    if request.mode not in {"sync", "async"}:
        return "mode must be sync or async"
    # Keep below upstream request timeout budget (gateway can enforce ~25s hard cap).
    if request.wait_seconds < 0 or request.wait_seconds > 10:
        return "wait_seconds must be between 0 and 10"
    return None


def _validate_improve_contract(request: ImproveRequest) -> Optional[str]:
    if not request.code or not request.code.strip():
        return "code is required"
    if len(request.code) > 80000:
        return "code too large (max 80k chars)"
    if len(request.goal) > 1000:
        return "goal too long (max 1000 chars)"
    return None


def _cleanup_analyze_jobs() -> None:
    now = time.time()
    stale = []
    for job_id, job in analyze_jobs.items():
        if (now - float(job.get("updated_at", now))) > ANALYZE_JOB_TTL_SECONDS:
            stale.append(job_id)
    for job_id in stale:
        analyze_jobs.pop(job_id, None)

    # bound memory in long-running runtimes
    if len(analyze_jobs) > ANALYZE_JOB_MAX:
        ordered = sorted(analyze_jobs.items(), key=lambda item: float(item[1].get("updated_at", 0)))
        drop = len(analyze_jobs) - ANALYZE_JOB_MAX
        for job_id, _ in ordered[:drop]:
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
    if job.get("status") == "succeeded":
        out["result"] = job.get("result")
    return out


def _summary_to_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()[:280]
    if isinstance(value, dict):
        bits: List[str] = []
        for k in ("summary", "description", "note"):
            if value.get(k):
                bits.append(str(value.get(k)))
        cat = str(value.get("category", "")).strip()
        sev = str(value.get("severity", "")).strip()
        if cat or sev:
            bits.append(" ".join(x for x in [cat, sev] if x).strip())
        if not bits:
            bits.append(json.dumps(value)[:220])
        return " | ".join(bits)[:280]
    if isinstance(value, list):
        return "; ".join(str(x) for x in value[:3])[:280]
    if value is None:
        return ""
    return str(value)[:280]


def _normalize_category(value: Any) -> str:
    raw = str(value or "refactoring").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "coding_best_practices": "refactoring",
        "best_practice": "refactoring",
        "best_practices": "refactoring",
        "benchmark": "performance",
        "major_issue": "bug",
        "minor_issue": "refactoring",
    }
    raw = aliases.get(raw, raw)
    return raw if raw in ALLOWED_FINDING_CATEGORIES else "refactoring"


def _normalize_severity(value: Any) -> str:
    raw = str(value or "medium").strip().lower()
    aliases = {"minor": "low", "major": "high", "warn": "medium", "warning": "medium"}
    raw = aliases.get(raw, raw)
    return raw if raw in ALLOWED_SEVERITIES else "medium"


def _sanitize_findings(findings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    clean: List[Dict[str, Any]] = []
    seen = set()
    for item in findings or []:
        if not isinstance(item, dict):
            continue
        desc = str(item.get("description", "")).strip()
        if not desc:
            continue
        key = desc.lower()[:180]
        if key in seen:
            continue
        seen.add(key)
        clean.append({
            "category": _normalize_category(item.get("category")),
            "severity": _normalize_severity(item.get("severity")),
            "description": desc[:240],
            "suggestion": str(item.get("suggestion") or DEFAULT_SUGGESTION)[:280],
        })
    return clean[:5]


def _looks_low_signal(findings: List[Dict[str, Any]], raw: str) -> bool:
    if not findings:
        return True
    bad = 0
    generic_all = True
    for f in findings:
        d = str(f.get("description", "")).lower()
        s = str(f.get("suggestion", "")).lower()
        cat = _normalize_category(f.get("category"))
        generic = ("review and apply if aligned" in s and cat == "refactoring")
        generic_all = generic_all and generic
        if (
            "fallback analysis mode" in d
            or "would there be any levels" in d
            or "confidence:" in d
            or "priority:" in d
            or "enhancement pass" in d
            or "stackoverflow" in d
            or "sourced from" in d
            or "http://" in d
            or "https://" in d
            or d in {"issue: .", "issue:"}
            or (generic and len(d) < 80)
        ):
            bad += 1
    if generic_all:
        return True
    if bad / max(1, len(findings)) >= 0.5:
        return True
    if isinstance(raw, str) and "Would there be any levels that would enhance this?" in raw:
        return True
    return False


def _deterministic_quality_findings(code: str, scope: str) -> List[Dict[str, Any]]:
    findings: List[Dict[str, Any]] = []
    src = code or ""
    if "except" not in src and "try:" not in src:
        findings.append({
            "category": "error_handling",
            "severity": "medium",
            "description": "No explicit error-handling path detected for runtime failures.",
            "suggestion": "Add targeted try/except around failure-prone operations and return actionable error context.",
        })
    if ("def " in src or "class " in src) and ('"""' not in src and "'''" not in src):
        findings.append({
            "category": "refactoring",
            "severity": "low",
            "description": "Public code elements appear undocumented.",
            "suggestion": "Add concise docstrings for intent, inputs, outputs, and edge-case behavior.",
        })
    if "print(" in src and "logging" not in src:
        findings.append({
            "category": "architecture",
            "severity": "low",
            "description": "Diagnostic output uses print() instead of structured logging.",
            "suggestion": "Use structured logging to improve observability and production traceability.",
        })
    if not findings:
        findings.append({
            "category": "refactoring",
            "severity": "low",
            "description": "No critical defects detected in deterministic quick pass.",
            "suggestion": "Add tests for boundary inputs and invalid argument types to preserve reliability.",
        })
    limit = 3 if scope == "quick" else 5
    return findings[:limit]


def _fallback_findings_from_text(raw: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not isinstance(raw, str):
        return out
    bullet_lines = []
    for ln in raw.splitlines():
        t = ln.strip()
        if not t:
            continue
        if t.startswith(("-", "*", "•")) or re.match(r"^\d+[\).]\s+", t):
            bullet_lines.append(t)
    candidates = bullet_lines or [seg.strip() for seg in re.split(r"(?<=[.!?])\s+", raw) if seg.strip()]
    for seg in candidates[:8]:
        out.append({
            "category": "refactoring",
            "severity": "medium",
            "description": seg[:240],
            "suggestion": DEFAULT_SUGGESTION,
        })
    return out


def _analysis_quality_score(findings: List[Dict[str, Any]], raw: str, parse_fallback_used: bool) -> float:
    if not findings:
        return 0.0
    score = 0.0
    for f in findings:
        d = str(f.get("description", "")).strip()
        s = str(f.get("suggestion", "")).strip()
        c = _normalize_category(f.get("category"))
        sev = _normalize_severity(f.get("severity"))
        if len(d) >= 40:
            score += 0.18
        if c != "refactoring":
            score += 0.14
        if sev in {"high", "critical"}:
            score += 0.08
        if s and s != DEFAULT_SUGGESTION:
            score += 0.08
        if any(k in d.lower() for k in ["stackoverflow", "sourced from", "confidence:", "enhancement pass"]):
            score -= 0.22
    score = score / max(1.0, len(findings) * 0.38)
    if parse_fallback_used:
        score -= 0.12
    if isinstance(raw, str) and "Would there be any levels that would enhance this?" in raw:
        score -= 0.3
    return max(0.0, min(1.0, score))


def _can_attempt_quality_retry(guard_timeout: float, started_at: float, current_score: float) -> bool:
    if current_score >= 0.55:
        return False
    elapsed = max(0.0, time.time() - started_at)
    remaining = guard_timeout - elapsed
    return remaining >= 8.0


def _retry_system_prompt(scope: str) -> str:
    depth = "thorough" if scope == "full" else "quick-critical"
    return (
        "You are a senior code reviewer. Return ONLY a valid JSON object, no markdown, no prose, no code fences. "
        "JSON shape must be: {\"summary\": string, \"findings\": [{\"category\":...,\"severity\":...,\"description\":...,\"suggestion\":...}]}. "
        f"Use review depth={depth}. Allowed categories: bug, performance, error_handling, architecture, refactoring, security, testing. "
        "Allowed severity: low|medium|high|critical."
    )


def _is_transient_oracle_signal(raw: str) -> bool:
    txt = (raw or "").lower()
    needles = [
        "503",
        "service unavailable",
        "temporarily unavailable",
        "request timed out",
        "oracle timeout",
        "oracle unavailable",
        "circuit open",
    ]
    return any(n in txt for n in needles)


def _retry_delay_seconds() -> float:
    return random.uniform(0.35, 1.05)


async def _validator_structural_score(findings: List[Dict[str, Any]], summary: str) -> float:
    """Use L34 Validator to score whether the candidate payload is structurally acceptable."""
    try:
        result = await chain_to("singularity", "validator/validate", {
            "schema": "api_response",
            "data": {
                "success": True,
                "data": {
                    "summary": summary,
                    "findings": findings,
                },
                "error": "",
            },
            "strict": True,
        })
        if isinstance(result, dict) and result.get("valid") is True:
            return 1.0
    except Exception:
        pass
    return 0.0


def _normalize_structured_findings(parsed: Dict[str, Any]) -> tuple[List[Dict[str, Any]], str]:
    """Normalize different structured contracts into standard findings + summary."""
    findings: List[Dict[str, Any]] = []
    summary = _summary_to_text(parsed.get("summary", ""))

    candidate_findings = parsed.get("findings")
    if isinstance(candidate_findings, list):
        for f in candidate_findings:
            if isinstance(f, dict):
                findings.append({
                    "category": _normalize_category(f.get("category", "refactoring")),
                    "severity": _normalize_severity(f.get("severity", "medium")),
                    "description": str(f.get("description", ""))[:240],
                    "suggestion": str(f.get("suggestion") or DEFAULT_SUGGESTION)[:280],
                })

    findings = _sanitize_findings(findings)
    if findings:
        return findings[:5], summary

    # Accept looser dict contracts (e.g., finding1/finding2 keys).
    normalized: List[Dict[str, Any]] = []
    for key, value in parsed.items():
        if key in {"summary", "findings"}:
            continue
        if isinstance(value, (dict, list)):
            value_text = json.dumps(value)[:220]
        else:
            value_text = str(value)[:220]
        normalized.append({
            "category": "refactoring",
            "severity": "medium",
            "description": f"{key}: {value_text}",
            "suggestion": DEFAULT_SUGGESTION,
        })

    return _sanitize_findings(normalized)[:5], summary


def _parse_oracle_analysis_payload(raw: str) -> tuple[List[Dict[str, Any]], str]:
    """Try strict JSON first, then tolerant Python-literal recovery for machine outputs."""
    if not isinstance(raw, str) or not raw.strip():
        return [], ""

    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        return [], ""

    blob = match.group().strip()

    # 1) strict JSON
    try:
        parsed = json.loads(blob)
        if isinstance(parsed, dict):
            return _normalize_structured_findings(parsed)
    except Exception:
        pass

    # 2) tolerant Python-literal parse (handles single quotes, True/False/None)
    repair = blob
    repair = re.sub(r":\s*str\b", ': ""', repair)
    repair = re.sub(r":\s*None\b", ': null', repair)
    try:
        parsed_py = ast.literal_eval(repair)
        if isinstance(parsed_py, dict):
            return _normalize_structured_findings(parsed_py)
    except Exception:
        pass

    return [], ""


async def _perform_analysis(
    code: str,
    source_label: str,
    scope: str,
    http_request: Optional[Request],
    guard_timeout: float,
    oracle_timeout: float,
) -> Dict[str, Any]:
    depth_note = (
        "Do a thorough deep review." if scope == "full"
        else "Do a quick review focusing on the most critical issues."
    )
    system_prompt = (
        "You are a senior code reviewer. Return strict JSON only with keys: "
        "summary (string) and findings (array). Each finding must include "
        "category, severity, description, suggestion. Limit findings to 5. "
        f"Review depth: {'thorough' if scope == 'full' else 'quick critical pass'}. "
        f"Additional context: {depth_note}"
    )

    user_prompt = f"Source: {source_label}\n\n```\n{code}\n```"
    analysis_started = time.time()

    try:
        raw = await asyncio.wait_for(
            _ask_oracle(user_prompt, system_prompt, timeout_s=oracle_timeout),
            timeout=guard_timeout,
        )
        if http_request is not None:
            try:
                from cortex_server.middleware.hud_middleware import track_level, track_attempt
                track_level(http_request, 5, "Oracle", always_on=True)
                track_attempt(http_request, 5, "Oracle", status="success")
            except Exception:
                pass
    except (httpx.TimeoutException, asyncio.TimeoutError) as exc:
        raw = (
            "Fallback analysis mode (Oracle timeout). "
            f"Issue: {str(exc)}. Critical checks: validate inputs, add explicit "
            "error handling, and review complexity/performance hotspots."
        )
    except Exception as exc:
        raw = (
            "Fallback analysis mode (Oracle unavailable). "
            f"Issue: {str(exc)}. Critical checks: validate inputs, add explicit "
            "error handling, and review complexity/performance hotspots."
        )

    findings, summary = _parse_oracle_analysis_payload(raw)
    parse_fallback_used = False
    if not findings:
        parse_fallback_used = True
        findings = _fallback_findings_from_text(raw)
        if not summary:
            summary = "Fallback-parsed oracle analysis; structured JSON was unavailable."

    findings = _sanitize_findings(findings)
    base_quality_score = _analysis_quality_score(findings, raw, parse_fallback_used)
    validator_score = await _validator_structural_score(findings, summary)
    quality_score = min(1.0, (base_quality_score * 0.9) + (validator_score * 0.1))
    retry_attempted = False
    retry_improved = False
    transient_retry_attempted = False
    transient_retry_improved = False
    selected_candidate = "primary"

    # First retry path: transient Oracle instability (e.g., 503/timeouts).
    if _is_transient_oracle_signal(raw):
        elapsed = max(0.0, time.time() - analysis_started)
        remaining = guard_timeout - elapsed
        if remaining >= 8.0:
            transient_retry_attempted = True
            singularity_state["transient_retry_attempts"] += 1
            try:
                await asyncio.sleep(_retry_delay_seconds())
                retry_budget = max(8.0, min(16.0, remaining - 1.0))
                transient_raw = await asyncio.wait_for(
                    _ask_oracle(user_prompt, system_prompt, timeout_s=min(oracle_timeout, retry_budget)),
                    timeout=retry_budget + 1.0,
                )
                transient_findings, transient_summary = _parse_oracle_analysis_payload(transient_raw)
                transient_parse_fallback = False
                if not transient_findings:
                    transient_parse_fallback = True
                    transient_findings = _fallback_findings_from_text(transient_raw)
                    if not transient_summary:
                        transient_summary = "Fallback-parsed oracle analysis after transient retry."

                transient_findings = _sanitize_findings(transient_findings)
                transient_base_score = _analysis_quality_score(transient_findings, transient_raw, transient_parse_fallback)
                transient_validator_score = await _validator_structural_score(transient_findings, transient_summary)
                transient_score = min(1.0, (transient_base_score * 0.9) + (transient_validator_score * 0.1))

                # Best-of-two candidate selection.
                if transient_score > quality_score:
                    findings = transient_findings
                    summary = transient_summary
                    raw = transient_raw
                    parse_fallback_used = transient_parse_fallback
                    quality_score = transient_score
                    transient_retry_improved = True
                    selected_candidate = "transient_retry"
                    singularity_state["transient_retry_improved"] += 1
            except Exception:
                pass

    # Second retry path: strict machine-format retry when quality is still low.
    if _can_attempt_quality_retry(guard_timeout, analysis_started, quality_score):
        retry_attempted = True
        singularity_state["quality_retry_attempts"] += 1
        elapsed = max(0.0, time.time() - analysis_started)
        remaining = max(8.0, min(18.0, guard_timeout - elapsed - 1.0))
        try:
            retry_raw = await asyncio.wait_for(
                _ask_oracle(user_prompt, _retry_system_prompt(scope), timeout_s=min(oracle_timeout, remaining)),
                timeout=remaining + 1.0,
            )
            retry_findings, retry_summary = _parse_oracle_analysis_payload(retry_raw)
            retry_parse_fallback = False
            if not retry_findings:
                retry_parse_fallback = True
                retry_findings = _fallback_findings_from_text(retry_raw)
                if not retry_summary:
                    retry_summary = "Fallback-parsed oracle analysis; strict retry yielded non-JSON output."

            retry_findings = _sanitize_findings(retry_findings)
            retry_base_score = _analysis_quality_score(retry_findings, retry_raw, retry_parse_fallback)
            retry_validator_score = await _validator_structural_score(retry_findings, retry_summary)
            retry_score = min(1.0, (retry_base_score * 0.9) + (retry_validator_score * 0.1))
            # Best-of-two candidate selection (current best vs strict retry).
            if retry_score > quality_score:
                findings = retry_findings
                summary = retry_summary
                raw = retry_raw
                parse_fallback_used = retry_parse_fallback
                quality_score = retry_score
                retry_improved = True
                selected_candidate = "quality_retry"
                singularity_state["quality_retry_improved"] += 1
        except Exception:
            pass

    if _looks_low_signal(findings, raw):
        parse_fallback_used = True
        deterministic = _deterministic_quality_findings(code, scope)
        if deterministic:
            findings = _sanitize_findings(deterministic)[:5]
            summary = "Deterministic quality pass used due to low-signal Oracle output."

    summary = _summary_to_text(summary)
    if not summary and findings:
        summary = findings[0].get("description", "")[:220]

    improvement_count = len(findings)
    singularity_state["analyses_run"] += 1
    singularity_state["improvements_suggested"] += improvement_count
    singularity_state["last_analysis_ts"] = time.time()
    _record_history("analyze", f"{source_label}: {improvement_count} findings")

    _broadcast_self_improvement("analysis_complete", {
        "source": source_label,
        "findings_count": improvement_count,
        "scope": scope,
    })

    return {
        "source": source_label,
        "scope": scope,
        "findings": findings,
        "findings_count": improvement_count,
        "summary": summary,
        "raw_analysis": raw,
        "parse_fallback_used": parse_fallback_used,
        "quality_score": round(quality_score, 3),
        "retry_attempted": retry_attempted,
        "retry_improved": retry_improved,
        "transient_retry_attempted": transient_retry_attempted,
        "transient_retry_improved": transient_retry_improved,
        "selected_candidate": selected_candidate,
    }


async def _run_async_analyze_job(job_id: str, code: str, source_label: str, scope: str) -> None:
    job = analyze_jobs.get(job_id)
    if not job:
        return
    job["status"] = "running"
    job["updated_at"] = time.time()

    try:
        analysis = await _perform_analysis(
            code=code,
            source_label=source_label,
            scope=scope,
            http_request=None,
            guard_timeout=SINGULARITY_GUARD_TIMEOUT_ASYNC,
            oracle_timeout=ORACLE_TIMEOUT_ASYNC,
        )
        job["status"] = "succeeded"
        job["result"] = {"success": True, "analysis": analysis}
        job["updated_at"] = time.time()
        singularity_state["async_jobs_completed"] += 1
    except Exception as exc:
        job["status"] = "failed"
        job["error"] = str(exc)
        job["updated_at"] = time.time()
        singularity_state["async_jobs_failed"] += 1


# ── Routes ──────────────────────────────────────────────────────────
@router.post("/analyze")
async def analyze_code(request: AnalyzeRequest, http_request: Request):
    """Analyze code (string or file path) for improvements via Oracle.

    mode=sync (default) keeps legacy behavior.
    mode=async immediately schedules a background analysis job and returns a job id.
    """
    validation_error = _validate_analyze_contract(request)
    if validation_error:
        raise HTTPException(status_code=422, detail=validation_error)

    code = request.code
    if request.file_path and not code:
        code = _read_container_file(request.file_path)
        if code is None:
            raise HTTPException(status_code=422, detail=f"Could not read file: {request.file_path}")
    if not code or not code.strip():
        raise HTTPException(status_code=422, detail="No code provided (supply code or valid file_path)")

    source_label = request.file_path or "inline code"

    if request.mode == "async":
        _cleanup_analyze_jobs()
        job_id = str(uuid.uuid4())
        now = time.time()
        analyze_jobs[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "created_at": now,
            "updated_at": now,
            "source": source_label,
            "scope": request.scope,
            "error": None,
            "result": None,
        }
        singularity_state["async_jobs_created"] += 1
        asyncio.create_task(_run_async_analyze_job(job_id, code, source_label, request.scope))

        waited_job = await _maybe_wait_for_job(job_id, request.wait_seconds)
        payload = {
            "success": True,
            "accepted": True,
            "job": _public_job_view(waited_job or analyze_jobs[job_id]),
            "poll": f"/singularity/analyze/jobs/{job_id}",
        }
        return JSONResponse(status_code=202, content=payload)

    async with conscious_action("singularity", "analyze", {
        "file_path": request.file_path,
        "scope": request.scope,
        "has_inline_code": bool(request.code),
    }) as ctx:
        analysis = await _perform_analysis(
            code=code,
            source_label=source_label,
            scope=request.scope,
            http_request=http_request,
            guard_timeout=SINGULARITY_GUARD_TIMEOUT_SYNC,
            oracle_timeout=ORACLE_TIMEOUT_SYNC,
        )
        ctx.set_result({
            "source": source_label,
            "findings_count": analysis["findings_count"],
        })

    return {"success": True, "analysis": analysis}


@router.get("/analyze/jobs/{job_id}")
async def analyze_job_status(job_id: str):
    _cleanup_analyze_jobs()
    job = analyze_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return {"success": True, "job": _public_job_view(job)}


@router.post("/improve")
async def improve_code(request: ImproveRequest, http_request: Request):
    """Generate an improved version of code toward a specified goal via Oracle."""
    validation_error = _validate_improve_contract(request)
    if validation_error:
        raise HTTPException(status_code=422, detail=validation_error)

    async with conscious_action("singularity", "improve", {
        "goal": request.goal,
        "aggressive": request.aggressive,
    }) as ctx:
        system_prompt = (
            "You are a senior software engineer. Return strict JSON only with keys: "
            "improved_code (full code string), changes (array of {what, why}), and diff_summary (string). "
            f"Improvement goal: {request.goal}."
            f"{' Be bold with structural changes.' if request.aggressive else ' Prefer safe incremental changes.'}"
        )

        user_prompt = f"Goal: {request.goal}\n\nOriginal code:\n```\n{request.code}\n```"

        try:
            from cortex_server.middleware.hud_middleware import track_attempt
            track_attempt(http_request, 5, "Oracle", status="attempted")
        except Exception:
            pass
        try:
            raw = await asyncio.wait_for(
                _ask_oracle(user_prompt, system_prompt, timeout_s=ORACLE_TIMEOUT_SYNC),
                timeout=SINGULARITY_GUARD_TIMEOUT_SYNC,
            )
            try:
                from cortex_server.middleware.hud_middleware import track_level, track_attempt
                track_level(http_request, 5, "Oracle", always_on=True)
                track_attempt(http_request, 5, "Oracle", status="success")
            except Exception:
                pass
        except (httpx.TimeoutException, asyncio.TimeoutError) as exc:
            try:
                from cortex_server.middleware.hud_middleware import track_attempt
                track_attempt(http_request, 5, "Oracle", status="failed", error="timeout")
            except Exception:
                pass
            # Degrade gracefully: preserve endpoint reliability when Oracle is down.
            raw = json.dumps({
                "improved_code": request.code,
                "changes": [{
                    "what": "Fallback improvement path used",
                    "why": f"Oracle timeout: {str(exc)}",
                }],
                "diff_summary": "Oracle unavailable; returned safe no-op improvement for manual review.",
            })
        except Exception as exc:
            # Degrade gracefully on Oracle backend errors/circuit-open conditions.
            raw = json.dumps({
                "improved_code": request.code,
                "changes": [{
                    "what": "Fallback improvement path used",
                    "why": f"Oracle error: {str(exc)}",
                }],
                "diff_summary": "Oracle unavailable; returned safe no-op improvement for manual review.",
            })

        improved_code = ""
        changes: List[Dict[str, Any]] = []
        diff_summary = ""

        json_match = re.search(r"\{[\s\S]*\}", raw)
        if json_match:
            try:
                parsed = json.loads(json_match.group())
                improved_code = parsed.get("improved_code", "")
                changes = parsed.get("changes", [])
                diff_summary = parsed.get("diff_summary", "")
            except json.JSONDecodeError:
                pass

        if not improved_code:
            code_match = re.search(r"```(?:python)?\n([\s\S]*?)```", raw)
            if code_match:
                improved_code = code_match.group(1)

        validation_result = None
        if improved_code:
            try:
                validation_result = await chain_to("singularity", "validator/validate", {
                    "schema": "api_response",
                    "data": {
                        "success": True,
                        "data": {"improved_code": improved_code, "goal": request.goal},
                        "error": "",
                    },
                    "strict": True,
                })
            except Exception:
                validation_result = None

        validator_reached = isinstance(validation_result, dict)
        if validator_reached:
            try:
                from cortex_server.middleware.hud_middleware import track_level
                track_level(http_request, 34, "Validator", always_on=True)
            except Exception:
                pass
        validator_passed = bool(validator_reached and validation_result.get("valid") is True)

        if not validator_reached:
            return {
                "success": False,
                "error": "validator_unreachable",
                "fallback": "manual_review_required",
                "improvement": {
                    "original_code": request.code,
                    "improved_code": improved_code,
                    "changes": changes,
                    "diff_summary": diff_summary,
                    "goal": request.goal,
                    "validation": {"note": "Validator not reached"},
                    "raw_response": raw,
                },
            }

        if not validator_passed:
            return {
                "success": False,
                "error": "validator_rejected",
                "fallback": "manual_review_required",
                "improvement": {
                    "original_code": request.code,
                    "improved_code": improved_code,
                    "changes": changes,
                    "diff_summary": diff_summary,
                    "goal": request.goal,
                    "validation": validation_result,
                    "raw_response": raw,
                },
            }

        singularity_state["improvements_applied"] += 1
        singularity_state["last_improvement_ts"] = time.time()
        _record_history("improve", f"goal={request.goal}, changes={len(changes)}")

        _broadcast_self_improvement("improvement_applied", {
            "goal": request.goal,
            "changes_count": len(changes),
            "validated": validator_passed,
        })

        ctx.set_result({
            "goal": request.goal,
            "changes_count": len(changes),
            "validated": validator_passed,
        })

    return {
        "success": True,
        "improvement": {
            "original_code": request.code,
            "improved_code": improved_code,
            "changes": changes,
            "diff_summary": diff_summary,
            "goal": request.goal,
            "validation": validation_result if validation_result else {"note": "Validator not reached"},
            "validator_reached": validator_reached,
            "raw_response": raw,
        },
    }


@router.get("/metrics")
async def get_metrics():
    """Return real tracked metrics about analyses and improvements."""
    _cleanup_analyze_jobs()
    running_jobs = sum(1 for job in analyze_jobs.values() if job.get("status") in {"queued", "running"})
    return {
        "success": True,
        "data": {
            "analyses_run": singularity_state["analyses_run"],
            "improvements_suggested": singularity_state["improvements_suggested"],
            "improvements_applied": singularity_state["improvements_applied"],
            "last_analysis_ts": singularity_state["last_analysis_ts"],
            "last_improvement_ts": singularity_state["last_improvement_ts"],
            "avg_findings_per_analysis": round(
                singularity_state["improvements_suggested"]
                / max(1, singularity_state["analyses_run"]),
                1,
            ),
            "oracle_successes": singularity_state["oracle_successes"],
            "oracle_failures": singularity_state["oracle_failures"],
            "oracle_attempts": singularity_state["oracle_successes"] + singularity_state["oracle_failures"],
            "oracle_reliability": round(
                singularity_state["oracle_successes"]
                / max(1, singularity_state["oracle_successes"] + singularity_state["oracle_failures"]),
                3,
            ),
            "oracle_recoveries": singularity_state.get("oracle_recoveries", 0),
            "oracle_last_error": singularity_state.get("oracle_last_error"),
            "async_jobs": {
                "created": singularity_state.get("async_jobs_created", 0),
                "completed": singularity_state.get("async_jobs_completed", 0),
                "failed": singularity_state.get("async_jobs_failed", 0),
                "in_memory": len(analyze_jobs),
                "active": running_jobs,
            },
            "quality_retries": {
                "attempts": singularity_state.get("quality_retry_attempts", 0),
                "improved": singularity_state.get("quality_retry_improved", 0),
                "improvement_rate": round(
                    singularity_state.get("quality_retry_improved", 0)
                    / max(1, singularity_state.get("quality_retry_attempts", 0)),
                    3,
                ),
            },
            "transient_retries": {
                "attempts": singularity_state.get("transient_retry_attempts", 0),
                "improved": singularity_state.get("transient_retry_improved", 0),
                "improvement_rate": round(
                    singularity_state.get("transient_retry_improved", 0)
                    / max(1, singularity_state.get("transient_retry_attempts", 0)),
                    3,
                ),
            },
            "recent_history": singularity_state["history"][-10:],
        },
        "error": None,
    }


@router.get("/status")
async def singularity_status():
    _cleanup_analyze_jobs()
    running_jobs = sum(1 for job in analyze_jobs.values() if job.get("status") in {"queued", "running"})
    return {
        "success": True,
        "data": {
            "level": 35,
            "name": "The Singularity",
            "status": "active",
            "consciousness_integrated": True,
            "analyses_run": singularity_state["analyses_run"],
            "improvements_suggested": singularity_state["improvements_suggested"],
            "improvements_applied": singularity_state["improvements_applied"],
            "last_analysis_ts": singularity_state["last_analysis_ts"],
            "oracle_successes": singularity_state["oracle_successes"],
            "oracle_failures": singularity_state["oracle_failures"],
            "oracle_attempts": singularity_state["oracle_successes"] + singularity_state["oracle_failures"],
            "oracle_reliability": round(
                singularity_state["oracle_successes"]
                / max(1, singularity_state["oracle_successes"] + singularity_state["oracle_failures"]),
                3,
            ),
            "oracle_recoveries": singularity_state.get("oracle_recoveries", 0),
            "oracle_last_error": singularity_state.get("oracle_last_error"),
            "oracle_consecutive_failures": singularity_state["oracle_consecutive_failures"],
            "oracle_breaker_open": (time.time() < singularity_state.get("oracle_breaker_open_until", 0.0)),
            "oracle_breaker_seconds_remaining": max(0, int(singularity_state.get("oracle_breaker_open_until", 0.0) - time.time())),
            "quality_retry_attempts": singularity_state.get("quality_retry_attempts", 0),
            "quality_retry_improved": singularity_state.get("quality_retry_improved", 0),
            "transient_retry_attempts": singularity_state.get("transient_retry_attempts", 0),
            "transient_retry_improved": singularity_state.get("transient_retry_improved", 0),
            "async_jobs_active": running_jobs,
            "powered_by": "L5 Oracle (cloud reasoning)",
            "capabilities": [
                "code_analysis",
                "code_improvement",
                "self_improvement_tracking",
                "validator_chain",
                "async_analysis_jobs",
            ],
        },
        "error": None,
    }
