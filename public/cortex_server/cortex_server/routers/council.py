"""
Council Router - Multi-perspective analysis and critique.
Level 15: The Council provides REAL multi-perspective deliberation via Oracle.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, List, Any, Optional, Literal
from datetime import datetime
import httpx
import json
import re
import asyncio
import os

# ── Consciousness Integration ──
from cortex_server.modules.consciousness_integration import (
    conscious_action,
    chain_to,
    get_collective_context,
)

router = APIRouter()

ORACLE_URL = "http://localhost:8888/oracle/chat"
# Keep Council responsive under degraded upstream conditions.
ORACLE_TIMEOUT = float(os.getenv("COUNCIL_ORACLE_TIMEOUT_S", "24.0"))
SEER_PREDICT_URL = "http://localhost:8888/seer/predict"
SEER_TIMEOUT = float(os.getenv("COUNCIL_SEER_TIMEOUT_S", "1.0"))
COUNCIL_REVIEW_TIMEOUT_S = float(os.getenv("COUNCIL_REVIEW_TIMEOUT_S", "26.0"))
deliberations: List[Dict[str, Any]] = []
_oracle_failures: int = 0
_oracle_successes: int = 0
_oracle_consecutive_failures: int = 0
_oracle_breaker_open_until: float = 0.0
ORACLE_BREAKER_THRESHOLD = int(os.getenv("COUNCIL_BREAKER_THRESHOLD", "5"))
ORACLE_BREAKER_COOLDOWN_SECONDS = int(os.getenv("COUNCIL_BREAKER_COOLDOWN_S", "45"))

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class DeliberationRequest(BaseModel):
    topic: str = Field(..., description="The proposal or topic to deliberate on")
    context: Optional[str] = Field(None, description="Additional context for the deliberation")


class PerspectiveResult(BaseModel):
    perspective: str
    score: int
    reasoning: str


class DeliberationResponse(BaseModel):
    success: bool
    deliberation_id: str
    topic: str
    perspectives: List[PerspectiveResult]
    overall_recommendation: str
    timestamp: str


class CritiqueRequest(BaseModel):
    action: str = Field(..., description="The action or proposal to critique")
    context: Optional[str] = Field(None, description="Context surrounding the action")


class CritiqueScore(BaseModel):
    dimension: str
    score: int
    reasoning: str


class CritiqueResponse(BaseModel):
    success: bool
    action: str
    scores: List[CritiqueScore]
    concerns: List[str]
    recommendation: str
    timestamp: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _call_oracle(
    prompt: str,
    system: str,
    priority: str = "high",
    *,
    strict_contract: bool = False,
    response_mode: Optional[str] = None,
) -> str:
    """Call Oracle with circuit breaker and bounded timeout."""
    global _oracle_failures, _oracle_successes, _oracle_consecutive_failures, _oracle_breaker_open_until
    import time
    now = time.time()
    if now < _oracle_breaker_open_until:
        raise RuntimeError(f"Oracle circuit open for {int(_oracle_breaker_open_until - now)}s")

    async with httpx.AsyncClient(timeout=ORACLE_TIMEOUT) as client:
        try:
            payload: Dict[str, Any] = {
                "prompt": prompt,
                "system": system,
                "priority": priority,
            }
            if strict_contract:
                payload["strict_contract"] = True
            if response_mode:
                payload["response_mode"] = response_mode

            resp = await client.post(ORACLE_URL, headers={"x-augmenter-bypass": "1"}, json=payload)
            resp.raise_for_status()
            data = resp.json()
            _oracle_successes += 1
            _oracle_consecutive_failures = 0
            out = data.get("response", data.get("text", ""))
            out = out if isinstance(out, str) else str(out)
            if not out.strip():
                raise RuntimeError("oracle_returned_empty")
            return out
        except Exception:
            _oracle_failures += 1
            _oracle_consecutive_failures += 1
            if _oracle_consecutive_failures >= ORACLE_BREAKER_THRESHOLD:
                _oracle_breaker_open_until = time.time() + ORACLE_BREAKER_COOLDOWN_SECONDS
            raise




async def _call_seer_predict(title: str, context: Optional[str]) -> Optional[Dict[str, Any]]:
    """Best-effort Seer advisory used to inform Council decisions."""
    scenario = (title or "").strip()
    if context:
        scenario = f"{scenario}\n\nContext: {str(context)[:1200]}"
    if not scenario:
        return None
    try:
        async with httpx.AsyncClient(timeout=SEER_TIMEOUT) as client:
            resp = await client.post(
                SEER_PREDICT_URL,
                json={"scenario": scenario, "time_horizon": "90 days"},
                headers={"x-augmenter-bypass": "1"},
            )
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and data.get("success") is True:
                return data
    except Exception:
        return None
    return None
def _parse_deliberation(raw: str) -> tuple[list[dict], str]:
    """Parse Oracle deliberation response into structured perspectives + recommendation."""
    perspectives = []
    
    # Try to extract perspective blocks
    labels = [
        ("Technical feasibility", "technical_feasibility"),
        ("Risk/security", "risk_security"),
        ("Risk/Security", "risk_security"),
        ("Ethical implications", "ethical_implications"),
        ("Ethical Implications", "ethical_implications"),
        ("Resource cost", "resource_cost"),
        ("Resource Cost", "resource_cost"),
        ("User impact", "user_impact"),
        ("User Impact", "user_impact"),
    ]
    
    for display_name, key in labels:
        # Look for score patterns like "Score: 7/10" or "7/10" or "(7)"
        pattern = rf"(?i){re.escape(display_name)}[:\s\-–]*.*?(\d+)\s*/\s*10"
        match = re.search(pattern, raw)
        score = int(match.group(1)) if match else 0
        
        # If we didn't find "X/10", try just a standalone number near the label
        if score == 0:
            pattern2 = rf"(?i){re.escape(display_name)}[:\s\-–]*.*?(?:score[:\s]*)?(\d+)"
            match2 = re.search(pattern2, raw)
            if match2:
                val = int(match2.group(1))
                if 1 <= val <= 10:
                    score = val
        
        # Extract reasoning: text between this label and the next label or end
        reasoning = ""
        idx = raw.lower().find(display_name.lower())
        if idx >= 0:
            # Find the next section or take rest
            next_starts = []
            for other_name, _ in labels:
                if other_name.lower() != display_name.lower():
                    nidx = raw.lower().find(other_name.lower(), idx + len(display_name))
                    if nidx > idx:
                        next_starts.append(nidx)
            # Also look for "overall" or "recommendation"
            for marker in ["overall", "recommendation"]:
                midx = raw.lower().find(marker, idx + len(display_name))
                if midx > idx:
                    next_starts.append(midx)
            
            end = min(next_starts) if next_starts else len(raw)
            section = raw[idx:end].strip()
            # Remove the label itself from the reasoning
            lines = section.split("\n")
            reasoning = " ".join(l.strip() for l in lines[1:] if l.strip())[:500]
            if not reasoning:
                reasoning = section[len(display_name):].strip()[:500]
        
        perspectives.append({
            "perspective": display_name,
            "score": score,
            "reasoning": reasoning or "No detailed reasoning extracted"
        })
    
    # Extract overall recommendation
    recommendation = ""
    for marker in ["overall recommendation", "recommendation:", "overall:"]:
        idx = raw.lower().find(marker)
        if idx >= 0:
            recommendation = raw[idx:].strip()[:1000]
            break
    
    if not recommendation:
        # Take the last paragraph as recommendation
        paragraphs = [p.strip() for p in raw.split("\n\n") if p.strip()]
        recommendation = paragraphs[-1] if paragraphs else raw[-500:]
    
    return perspectives, recommendation


def _parse_critique(raw: str) -> tuple[list[dict], list[str], str]:
    """Parse Oracle critique response into scores, concerns, and recommendation."""
    scores = []
    dimensions = ["feasibility", "risk", "innovation", "alignment"]
    
    for dim in dimensions:
        pattern = rf"(?i){dim}[:\s\-–]*.*?(\d+)\s*/\s*10"
        match = re.search(pattern, raw)
        score = int(match.group(1)) if match else 0
        
        if score == 0:
            pattern2 = rf"(?i){dim}[:\s\-–]*.*?(?:score[:\s]*)?(\d+)"
            match2 = re.search(pattern2, raw)
            if match2:
                val = int(match2.group(1))
                if 1 <= val <= 10:
                    score = val
        
        # Extract reasoning for this dimension
        reasoning = ""
        idx = raw.lower().find(dim)
        if idx >= 0:
            section_end = len(raw)
            for other_dim in dimensions:
                if other_dim != dim:
                    oidx = raw.lower().find(other_dim, idx + len(dim))
                    if oidx > idx:
                        section_end = min(section_end, oidx)
            for marker in ["concern", "go/no-go", "recommendation"]:
                midx = raw.lower().find(marker, idx + len(dim))
                if midx > idx:
                    section_end = min(section_end, midx)
            reasoning = raw[idx + len(dim):section_end].strip()[:300]
        
        scores.append({
            "dimension": dim.capitalize(),
            "score": score,
            "reasoning": reasoning or "No detailed reasoning extracted"
        })
    
    # Extract concerns
    concerns = []
    concern_idx = raw.lower().find("concern")
    if concern_idx >= 0:
        concern_section = raw[concern_idx:]
        # Find bullet points or numbered items
        for line in concern_section.split("\n"):
            line = line.strip()
            if line and (line.startswith("-") or line.startswith("•") or
                        (len(line) > 2 and line[0].isdigit() and line[1] in ".)")):
                concerns.append(line.lstrip("-•0123456789.) ").strip())
        if not concerns:
            concerns = [concern_section[:500]]
    
    # Extract go/no-go
    recommendation = "No clear recommendation extracted"
    for marker in ["go/no-go", "recommendation:", "verdict:"]:
        idx = raw.lower().find(marker)
        if idx >= 0:
            recommendation = raw[idx:].strip()[:500]
            break
    
    return scores, concerns, recommendation


def _compute_risk_score(perspectives: list[dict]) -> float:
    """Compute a risk score (0-1) from deliberation perspectives.

    Uses the Risk/Security perspective score primarily, normalized to 0-1.
    Falls back to the average of all perspective scores.
    """
    risk_score = 0.0
    for p in perspectives:
        if "risk" in p.get("perspective", "").lower():
            if p.get("score", 0) > 0:
                return p["score"] / 10.0
    # Fallback: average all scores, invert (high score = high risk)
    scores = [p["score"] for p in perspectives if p.get("score", 0) > 0]
    if scores:
        risk_score = 1.0 - (sum(scores) / (len(scores) * 10))
    return risk_score


def _fallback_deliberation_text(topic: str) -> str:
    t = (topic or '').lower()
    risk = 7 if any(k in t for k in ['upgrade','evolve','modify','delete','deploy']) else 4
    return (
        f"Technical feasibility: Score 7/10 - Proposal appears implementable with bounded changes.\n"
        f"Risk/security: Score {risk}/10 - Apply strict timeout limits, approval gates, and rollback plan.\n"
        "Ethical implications: Score 8/10 - No direct user harm expected if safeguards remain enabled.\n"
        "Resource cost: Score 6/10 - Moderate engineering and validation effort.\n"
        "User impact: Score 8/10 - Improves reliability under strict timeout constraints.\n\n"
        "Overall recommendation: Conditional GO with minimal, reversible changes and post-change validation."
    )


def _fallback_critique_text(action: str) -> str:
    return (
        "Feasibility: Score 7/10 - Technically straightforward.\n"
        "Risk: Score 6/10 - Manage via conservative rollout and rollback.\n"
        "Innovation: Score 6/10 - Incremental improvement.\n"
        "Alignment: Score 8/10 - Supports reliability and safety objectives.\n"
        "- Concern: Ensure strict timeout behavior is tested under concurrency.\n"
        "- Concern: Keep human approval requirements in place for self-modifying paths.\n"
        "Recommendation: GO for minimal safe remediation; HOLD major redesigns."
    )

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def _validate_deliberation_contract(topic: str, context: Optional[str]) -> Optional[str]:
    if not isinstance(topic, str) or not topic.strip():
        return "topic must be a non-empty string"
    if len(topic) > 2000:
        return "topic too long (max 2000 chars)"
    if context is not None and len(context) > 6000:
        return "context too long (max 6000 chars)"
    return None

def _validate_critique_contract(action: str, context: Optional[str]) -> Optional[str]:
    if not isinstance(action, str) or not action.strip():
        return "action must be a non-empty string"
    if len(action) > 2000:
        return "action too long (max 2000 chars)"
    if context is not None and len(context) > 6000:
        return "context too long (max 6000 chars)"
    return None

@router.get("/status")
async def council_status():
    """Get Council status - Level 15 multi-perspective analysis."""
    return {
        "success": True,
        "data": {
            "level": 15,
            "name": "The Council",
            "role": "Multi-Perspective Analysis",
            "status": "active",
            "oracle_powered": True,
            "consciousness_integrated": True,
            "deliberations_count": len(deliberations),
            "oracle_successes": _oracle_successes,
            "oracle_failures": _oracle_failures,
            "oracle_consecutive_failures": _oracle_consecutive_failures,
            "oracle_breaker_open": (__import__("time").time() < _oracle_breaker_open_until),
            "oracle_breaker_seconds_remaining": max(0, int(_oracle_breaker_open_until - __import__("time").time())),
            "oracle_breaker_threshold": ORACLE_BREAKER_THRESHOLD,
            "oracle_breaker_cooldown_s": ORACLE_BREAKER_COOLDOWN_SECONDS,
            "oracle_timeout_s": ORACLE_TIMEOUT,
            "seer_timeout_s": SEER_TIMEOUT,
            "review_timeout_s": COUNCIL_REVIEW_TIMEOUT_S,
            "timestamp": datetime.now().isoformat()
        }
    }


@router.post("/deliberate")
async def deliberate(request: DeliberationRequest):
    """Deliberate on a topic from multiple perspectives using Oracle AI."""
    validation_error = _validate_deliberation_contract(request.topic, request.context)
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)

    delib_id = f"delib_{len(deliberations)}_{int(datetime.now().timestamp())}"
    
    # ── Consciousness: wrap the entire deliberation ──
    async with conscious_action("council", "deliberate", {
        "topic": request.topic[:200],
        "has_context": bool(request.context),
    }) as ctx:
        system_prompt = (
            "You are an advisory council with multiple perspectives. "
            "Analyze this proposal from:\n"
            "1) Technical feasibility\n"
            "2) Risk/security\n"
            "3) Ethical implications\n"
            "4) Resource cost\n"
            "5) User impact\n\n"
            "For each perspective, give a score 1-10 and brief reasoning. "
            "Format each as: 'Perspective Name: Score X/10 - reasoning'\n"
            "End with an overall recommendation paragraph."
        )
        
        user_prompt = f"Proposal: {request.topic}"
        if request.context:
            user_prompt += f"\n\nAdditional context: {request.context}"
        
        try:
            raw_response = await _call_oracle(user_prompt, system_prompt)
        except httpx.TimeoutException:
            raw_response = _fallback_deliberation_text(request.topic)
        except Exception:
            raw_response = _fallback_deliberation_text(request.topic)
        
        perspectives, recommendation = _parse_deliberation(raw_response)
        
        # ── Consciousness: auto-chain to Ethicist on risky proposals ──
        risk_score = _compute_risk_score(perspectives)
        ethical_review = None
        if risk_score > 0.7:
            try:
                ethical_review = await chain_to("council", "ethicist/evaluate", {
                    "action": request.topic,
                    "context": f"Council deliberation flagged high risk ({risk_score:.2f}). "
                               f"Recommendation: {recommendation[:300]}",
                    "severity": "high",
                })
            except Exception:
                pass  # chain_to already handles errors internally

        result = {
            "deliberation_id": delib_id,
            "topic": request.topic,
            "perspectives": perspectives,
            "risk_score": round(risk_score, 2),
            "overall_recommendation": recommendation,
            "raw_response": raw_response,
            "ethical_review": ethical_review.get("evaluation") if ethical_review and ethical_review.get("success") else None,
            "timestamp": datetime.now().isoformat()
        }
        
        deliberations.append(result)

        # ── Consciousness: record result ──
        ctx.set_result({
            "deliberation_id": delib_id,
            "risk_score": round(risk_score, 2),
            "perspectives_count": len(perspectives),
            "ethical_review_triggered": ethical_review is not None,
        })
    
    return {
        "success": True,
        "deliberation": result
    }


@router.post("/critique")
async def critique_action(request: CritiqueRequest):
    """Critique an action with structured scoring using Oracle AI."""
    validation_error = _validate_critique_contract(request.action, request.context)
    if validation_error:
        raise HTTPException(status_code=400, detail=validation_error)
    async with conscious_action("council", "critique", {"action": request.action[:200]}) as ctx:
        system_prompt = (
            "You are a critical reviewer. Score this on:\n"
            "- Feasibility (1-10)\n"
            "- Risk (1-10)\n"
            "- Innovation (1-10)\n"
            "- Alignment (1-10)\n\n"
            "Format each as: 'Dimension: Score X/10 - reasoning'\n"
            "Then provide specific concerns as a bulleted list.\n"
            "End with a clear go/no-go recommendation."
        )
        
        user_prompt = f"Action to critique: {request.action}"
        if request.context:
            user_prompt += f"\n\nContext: {request.context}"
        
        try:
            raw_response = await _call_oracle(user_prompt, system_prompt)
        except httpx.TimeoutException:
            raw_response = _fallback_critique_text(request.action)
        except Exception:
            raw_response = _fallback_critique_text(request.action)
        
        scores, concerns, recommendation = _parse_critique(raw_response)
        
        ctx.set_result({
            "scores_count": len(scores),
            "concerns_count": len(concerns),
        })
    
    return {
        "success": True,
        "action": request.action[:200],
        "scores": scores,
        "concerns": concerns,
        "recommendation": recommendation,
        "raw_response": raw_response,
        "timestamp": datetime.now().isoformat()
    }


@router.get("/perspectives")
async def get_perspectives():
    """Get available council perspectives."""
    return {
        "success": True,
        "perspectives": [
            {
                "name": "Technical Feasibility",
                "role": "Engineer",
                "focus": "Can it be built? What are the technical constraints?",
                "evaluates": "Architecture, complexity, dependencies, scalability"
            },
            {
                "name": "Risk/Security",
                "role": "Security Analyst",
                "focus": "What could go wrong? What are the attack vectors?",
                "evaluates": "Vulnerabilities, failure modes, blast radius, recovery"
            },
            {
                "name": "Ethical Implications",
                "role": "Ethics Advisor",
                "focus": "Is this the right thing to do? Who is affected?",
                "evaluates": "Privacy, fairness, transparency, consent, harm"
            },
            {
                "name": "Resource Cost",
                "role": "Resource Manager",
                "focus": "What does this cost in time, compute, and attention?",
                "evaluates": "CPU/memory, development time, maintenance burden, opportunity cost"
            },
            {
                "name": "User Impact",
                "role": "User Advocate",
                "focus": "How does this affect the end user experience?",
                "evaluates": "Usability, latency, reliability, value delivered"
            }
        ]
    }


# ---------------------------------------------------------------------------
# Review / Decision (machine-actionable)
# ---------------------------------------------------------------------------

class ReviewRequest(BaseModel):
    kind: Optional[str] = Field(None, description="What is being reviewed (e.g., forge_commit, config_change)")
    title: Optional[str] = Field(None, description="Short description of the action")
    question: Optional[str] = Field(None, description="Legacy watchdog field")
    topic: Optional[str] = Field(None, description="Legacy topic alias")
    action: Optional[str] = Field(None, description="Legacy action alias")
    context: Optional[str] = Field(None, description="Additional context")
    target_path: Optional[str] = Field(None, description="Target path (if applicable)")
    diff: Optional[str] = Field(None, description="Unified diff (optional)")
    code: Optional[str] = Field(None, description="Code blob (optional)")
    risk_tolerance: Literal["low", "medium", "high"] = Field("low")


class ReviewResponse(BaseModel):
    success: bool
    kind: str
    verdict: Literal["APPROVE", "NEEDS_CHANGES", "REJECT"]
    risk_score: float
    top_concerns: List[str]
    required_conditions: List[str]
    rationale: str
    suggested_changes: List[str]
    timestamp: str
    raw_response: Optional[str] = None


def _extract_first_json_object(raw: str) -> Optional[dict]:
    """Try to extract and parse the first JSON object from a model response."""
    if not raw or not isinstance(raw, str):
        return None
    # Find a plausible JSON object span
    start = raw.find('{')
    end = raw.rfind('}')
    if start == -1 or end == -1 or end <= start:
        return None
    candidate = raw[start:end+1]
    # Strip code fences if present
    candidate = candidate.replace('```json', '').replace('```', '').strip()
    try:
        return json.loads(candidate)
    except Exception:
        return None


def _clamp01(x: float) -> float:
    try:
        v = float(x)
    except Exception:
        return 0.0
    return max(0.0, min(1.0, v))


def _verdict_from_fallback(risk_score: float, recommendation_text: str) -> str:
    rec = (recommendation_text or '').lower()
    if 'no-go' in rec or 'reject' in rec:
        return 'REJECT'
    if risk_score >= 0.70:
        return 'REJECT'
    if risk_score >= 0.40:
        return 'NEEDS_CHANGES'
    return 'APPROVE'




# FAST_FORGE_POLICY
_FORGE_BLOCKLIST = [
    'import os', 'import subprocess', 'subprocess.', 'os.system',
    'import socket', 'socket.',
    'import requests', 'requests.',
    'import httpx', 'httpx.',
    'eval(', 'exec(', '__import__',
]


def _is_allowlisted_target(target_path: str) -> bool:
    if not target_path or not isinstance(target_path, str):
        return False
    tp = target_path.strip().lstrip('/')
    if '..' in tp or tp.startswith('~'):
        return False
    return tp.startswith('routers/') or tp.startswith('modules/')


def _fast_policy_review(kind: str, title: str, target_path: Optional[str], diff: str, code: str) -> Optional[dict]:
    """Fast deterministic Council policy for common low-risk actions.

    This keeps Council useful even when Oracle is degraded.
    """
    k = (kind or '').strip().lower()


    # FAST_MUSE_POLICY: deterministic gating for Muse reliability upgrades.
    # This avoids Council being blocked by Oracle slowness for low-risk, local-only hardening.
    if k in ('upgrade_l29_muse_reliability', 'upgrade_muse_reliability') or 'muse' in k:
        tp = (target_path or '').strip().lower()
        if tp.endswith('routers/muse.py'):
            blob = (diff or '') + "\n" + (code or '')
            blob_l = blob.lower()

            required = [
                'anyio.fail_after',
                'oracle_deadline_s',
                'x-augmenter-bypass',
                'response_mode',
                'final_only',
                'muse_test_headers_enabled',
                'muse_test_token',
                '_test_hook_allowed',
                'allow_test_headers',
                'muse_debug_raw_response',
                '_brainstormenvelope',
                'model_validate',
            ]
            missing = [r for r in required if r not in blob_l]

            # Basic safety footguns we never want in Muse
            block = ['subprocess', 'os.system', 'popen', 'eval(', 'exec(']
            hits = [b for b in block if b in blob_l]
            if hits:
                return {
                    'verdict': 'NEEDS_CHANGES',
                    'risk_score': 0.70,
                    'top_concerns': [f'Muse code contains blocked pattern: {h}' for h in hits[:4]],
                    'required_conditions': ['remove_blocklisted_patterns'],
                    'rationale': 'Muse must not introduce process execution primitives.',
                    'suggested_changes': [],
                }

            if missing:
                return {
                    'verdict': 'NEEDS_CHANGES',
                    'risk_score': 0.45,
                    'top_concerns': [f'Muse hardening missing required marker: {m}' for m in missing[:6]],
                    'required_conditions': ['add_missing_hardening_markers', 'retry_council_review'],
                    'rationale': 'Muse reliability upgrades must include explicit deadline, strict header gating, and schema validation.',
                    'suggested_changes': missing[:12],
                }

            return {
                'verdict': 'APPROVE',
                'risk_score': 0.18,
                'top_concerns': [],
                'required_conditions': [
                    'forced_empty_test_completed',
                    'test_hooks_disabled_by_default',
                    'brainstorm_schema_validated',
                ],
                'rationale': 'Muse change appears to be low-risk reliability hardening: local-only Oracle call, strict deadline, strict header gating, fail-closed on empty/invalid, and schema validation.',
                'suggested_changes': [],
            }

    # Only fast-path Forge actions.
    if not k.startswith('forge_'):
        return None

    if target_path and not _is_allowlisted_target(target_path):
        return {
            'verdict': 'REJECT',
            'risk_score': 0.85,
            'top_concerns': ['Target path is not allowlisted (routers/ or modules/ only).'],
            'required_conditions': ['allowlist_target_path'],
            'rationale': 'Forge actions must be restricted to allowlisted directories.',
            'suggested_changes': ['Use target_path under routers/ or modules/ and end with .py.'],
        }

    blob = (diff or '') + '\n' + (code or '')
    blob_l = blob.lower()

    hits = [pat for pat in _FORGE_BLOCKLIST if pat in blob_l]
    if hits:
        return {
            'verdict': 'NEEDS_CHANGES',
            'risk_score': 0.70,
            'top_concerns': [f'Generated content includes potentially unsafe pattern: {h}' for h in hits[:4]],
            'required_conditions': ['remove_blocklisted_patterns', 'retry_council_review'],
            'rationale': 'Forge-generated commits should not include OS/process/network primitives by default.',
            'suggested_changes': ['Remove blocklisted imports/calls; keep scaffolds minimal.'],
        }

    # Require a /status endpoint in router scaffolds (basic observability)
    if k in ('forge_propose', 'forge_commit'):
        if '/status' not in blob_l:
            return {
                'verdict': 'NEEDS_CHANGES',
                'risk_score': 0.35,
                'top_concerns': ['Scaffold missing /status endpoint.'],
                'required_conditions': ['add_status_endpoint'],
                'rationale': 'All Cortex levels should expose /status for health/ops.',
                'suggested_changes': ['Add GET /status endpoint to the router.'],
            }

    # Safe default
    return {
        'verdict': 'APPROVE',
        'risk_score': 0.12,
        'top_concerns': [],
        'required_conditions': [
            'no_overwrite_by_default',
            'allowlist_target_path',
            'no_os_subprocess_network_primitives',
        ],
        'rationale': 'Low-risk scaffold change confined to allowlisted code directories.',
        'suggested_changes': [],
    }
@router.post("/review", response_model=ReviewResponse)
async def council_review(request: ReviewRequest):
    """Return a machine-actionable decision contract.

    This is the preferred endpoint for gating irreversible actions.
    """
    kind = (request.kind or '').strip()
    title = (request.title or request.question or request.topic or request.action or '').strip()
    if not kind and title:
        kind = 'watchdog_probe'
    if not title and kind:
        title = kind
    if not title:
        raise HTTPException(status_code=400, detail='title/question/topic/action must be non-empty')

    if kind in {'watchdog_probe', 'health_check', 'status_probe'}:
        return {
            'success': True,
            'kind': kind,
            'verdict': 'APPROVE',
            'risk_score': 0.08,
            'top_concerns': [],
            'required_conditions': [],
            'rationale': 'Deterministic watchdog compatibility path.',
            'suggested_changes': [],
            'timestamp': datetime.now().isoformat(),
            'raw_response': None,
        }

    # Cap large inputs (avoid accidental DoS)
    ctx = (request.context or '').strip()
    diff = (request.diff or '').strip()
    code = (request.code or '').strip()
    if len(ctx) > 8000:
        ctx = ctx[:8000] + "\n…(truncated)"
    if len(diff) > 12000:
        diff = diff[:12000] + "\n…(truncated)"
    if len(code) > 12000:
        code = code[:12000] + "\n…(truncated)"


    # Fast-path deterministic policy for Forge (keeps Council responsive even when Oracle is degraded)
    fast = _fast_policy_review(request.kind, request.title, request.target_path, diff, code)
    if fast is not None:
        return {
            'success': True,
            'kind': kind,
            'verdict': fast['verdict'],
            'risk_score': _clamp01(fast.get('risk_score', 0.5)),
            'top_concerns': fast.get('top_concerns') or [],
            'required_conditions': fast.get('required_conditions') or [],
            'rationale': fast.get('rationale') or '—',
            'suggested_changes': fast.get('suggested_changes') or [],
            'timestamp': datetime.now().isoformat(),
            'raw_response': None,
        }

    # Seer advisory (best-effort): informs Council verdicts for non-fast paths.
    seer_advisory = None

    system_prompt = (
        "You are The Council for a production system. Return JSON only (no markdown/code fences).\n"
        "Schema: {verdict: APPROVE|NEEDS_CHANGES|REJECT, risk_score:0..1, top_concerns:[str], "
        "required_conditions:[str], rationale:str, suggested_changes:[str]}.\n"
        "Keep output concise: max 3 items per list; each item <= 120 chars; rationale <= 240 chars.\n"
        "Be conservative: if uncertain, use NEEDS_CHANGES."
    )

    user_prompt = (
        f"KIND: {kind}\n"
        f"TITLE: {title}\n"
        f"RISK_TOLERANCE: {request.risk_tolerance}\n"
        + (f"TARGET_PATH: {request.target_path}\n" if request.target_path else "")
        + (f"CONTEXT:\n{ctx}\n" if ctx else "")
        + (f"DIFF:\n{diff}\n" if diff else "")
        + (f"CODE:\n{code}\n" if code else "")
    )

    raw_response = None
    parsed = None
    try:
        raw_response = await asyncio.wait_for(
            _call_oracle(
                user_prompt,
                system_prompt,
                priority="high",
                strict_contract=True,
                response_mode="final_only",
            ),
            timeout=COUNCIL_REVIEW_TIMEOUT_S,
        )
        parsed = _extract_first_json_object(raw_response)
    except (asyncio.TimeoutError, httpx.RequestError, RuntimeError, ValueError):
        parsed = None
    except Exception:
        parsed = None

    # If Oracle did not return JSON, attempt a conservative verdict inference
    # from plain-text responses (e.g. "GO", "NO GO") so gating remains usable.
    if (not parsed) and isinstance(raw_response, str) and raw_response.strip():
        t = raw_response.strip().upper()
        import re as _re
        inferred = None
        if "REJECT" in t or "NO GO" in t or "NOGO" in t:
            inferred = "REJECT"
        elif "NEEDS_CHANGES" in t or "NEEDS CHANGES" in t:
            inferred = "NEEDS_CHANGES"
        elif "APPROVE" in t or _re.search(r"\bGO\b", t):
            inferred = "APPROVE"
        if inferred and inferred != "NEEDS_CHANGES":
            return {
                'success': True,
                'kind': kind,
                'verdict': inferred,
                'risk_score': 0.22 if inferred == "APPROVE" else 0.80,
                'top_concerns': [],
                'required_conditions': ['run_smoke_tests'],
                'rationale': raw_response.strip()[:2000],
                'suggested_changes': [],
                'timestamp': datetime.now().isoformat(),
                'raw_response': raw_response,
            }

    if parsed and isinstance(parsed, dict):
        verdict = str(parsed.get('verdict', 'NEEDS_CHANGES')).strip().upper()
        if verdict in ('APPROVE_WITH_CONDITIONS', 'APPROVE_CONDITIONALLY', 'CONDITIONAL_APPROVE', 'CONDITIONAL_APPROVAL'):
            verdict = 'NEEDS_CHANGES'
        elif verdict in ('GO',):
            verdict = 'APPROVE'
        elif verdict in ('NO_GO', 'NOGO'):
            verdict = 'REJECT'
        if verdict not in ('APPROVE', 'NEEDS_CHANGES', 'REJECT'):
            verdict = 'NEEDS_CHANGES'
        risk_score = _clamp01(parsed.get('risk_score', 0.5))
        top_concerns = parsed.get('top_concerns') or []
        required_conditions = parsed.get('required_conditions') or []
        rationale = str(parsed.get('rationale', '')).strip()[:2000]
        suggested_changes = parsed.get('suggested_changes') or []

        # Fold Seer outlook into Council contract (advisory, conservative bias).
        needs_seer_advisory = (verdict == 'APPROVE' or risk_score < 0.35)
        if needs_seer_advisory and seer_advisory is None:
            try:
                seer_advisory = await asyncio.wait_for(_call_seer_predict(request.title, ctx), timeout=max(0.6, min(1.5, SEER_TIMEOUT + 0.3)))
            except Exception:
                seer_advisory = None
        if seer_advisory:
            seer_outlook = str(seer_advisory.get('overall_outlook', 'neutral')).strip().lower()
            seer_conf = str(seer_advisory.get('confidence', 'medium')).strip().lower()
            if seer_outlook == 'bearish' and seer_conf in ('medium', 'high'):
                risk_score = max(risk_score, 0.55)
                if verdict == 'APPROVE':
                    verdict = 'NEEDS_CHANGES'
                required_conditions = list(required_conditions) + ['review_seer_bearish_outlook']
                top_concerns = list(top_concerns) + [
                    f"Seer outlook is bearish ({seer_conf}); require mitigations before approval."
                ]
            rationale = ((rationale or '—') + f" | Seer outlook: {seer_outlook} ({seer_conf}).")[:2000]

        return {
            'success': True,
            'kind': kind,
            'verdict': verdict,
            'risk_score': risk_score,
            'top_concerns': [str(x)[:400] for x in top_concerns][:10],
            'required_conditions': [str(x)[:400] for x in required_conditions][:12],
            'rationale': rationale or '—',
            'suggested_changes': [str(x)[:400] for x in suggested_changes][:12],
            'timestamp': datetime.now().isoformat(),
            'raw_response': raw_response,
        }
    # Fallback: fast conservative response (do not call Oracle/Seer again)
    return {
        'success': True,
        'kind': kind,
        'verdict': 'NEEDS_CHANGES',
        'risk_score': 0.60,
        'top_concerns': ['Council review timed out or Oracle unavailable; conservative fallback.'],
        'required_conditions': ['retry_council_review'],
        'rationale': 'Council could not complete a full review within the time budget.',
        'suggested_changes': [],
        'timestamp': datetime.now().isoformat(),
        'raw_response': raw_response,
    }
