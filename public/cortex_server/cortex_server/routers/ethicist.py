"""
Level 33 — The Ethicist
Real ethical analysis powered by L5 Oracle (cloud reasoning).
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Dict, Any
import httpx
import json
import re
import time

# ── Consciousness Integration ──
from cortex_server.modules.consciousness_integration import (
    conscious_action,
    subscribe_to,
)
from cortex_server.modules.unified_messaging import get_bus

router = APIRouter(tags=["Ethicist"])

ORACLE_URL = "http://localhost:8888/oracle/chat"
ORACLE_TIMEOUT = 90.0

# ── Module-level state ──────────────────────────────────────────────
ethicist_state: Dict[str, Any] = {
    "evaluations": 0,
    "reviews": 0,
    "approvals": 0,
    "cautions": 0,
    "rejections": 0,
    "last_evaluation_ts": None,
}

# ── Ethical Framework ───────────────────────────────────────────────
ETHICAL_FRAMEWORK = {
    "name": "Cortex Ethical Analysis Framework v2",
    "version": "2.0",
    "dimensions": [
        {
            "id": "privacy",
            "name": "Privacy Impact",
            "description": "Evaluates data collection, storage, sharing, and potential for re-identification. Higher scores indicate greater privacy risk.",
            "weight": 0.25,
            "scale": "1-10 (1=minimal risk, 10=severe risk)",
        },
        {
            "id": "fairness",
            "name": "Fairness & Bias Risk",
            "description": "Assesses potential for discriminatory outcomes, representation gaps, and equitable treatment across demographics.",
            "weight": 0.20,
            "scale": "1-10 (1=minimal bias risk, 10=severe bias risk)",
        },
        {
            "id": "transparency",
            "name": "Transparency",
            "description": "Measures explainability, auditability, and clarity of decision-making processes.",
            "weight": 0.20,
            "scale": "1-10 (1=fully transparent, 10=completely opaque)",
        },
        {
            "id": "safety",
            "name": "Safety",
            "description": "Evaluates potential for harm—physical, psychological, financial, or reputational—to individuals or groups.",
            "weight": 0.20,
            "scale": "1-10 (1=minimal harm potential, 10=severe harm potential)",
        },
        {
            "id": "consent",
            "name": "Consent & Autonomy",
            "description": "Checks whether affected parties have meaningful choice, informed consent, and the ability to opt out.",
            "weight": 0.15,
            "scale": "1-10 (1=full autonomy preserved, 10=no autonomy)",
        },
    ],
    "recommendations": {
        "APPROVE": "Risk score ≤ 0.3 — Action is ethically sound with minimal concerns.",
        "CAUTION": "Risk score 0.31-0.6 — Action may proceed with mitigations in place.",
        "REJECT": "Risk score > 0.6 — Action poses unacceptable ethical risk and should not proceed without major changes.",
    },
    "principles": [
        "Beneficence: Actions should aim to do good and improve outcomes.",
        "Non-maleficence: Avoid causing harm, even unintentionally.",
        "Justice: Distribute benefits and burdens fairly.",
        "Autonomy: Respect individual choice and informed consent.",
        "Accountability: Maintain clear responsibility chains for decisions.",
        "Proportionality: Interventions should be proportionate to the problem.",
        "Reversibility: Prefer actions that can be undone if problems emerge.",
    ],
}


# ── Request / Response Models ───────────────────────────────────────
class EvaluateRequest(BaseModel):
    action: str
    context: str = ""
    severity: str = "medium"


class ReviewRequest(BaseModel):
    content: str
    content_type: str = "code"  # code | text | policy
    focus: Optional[str] = None  # optional focus area


# ── Oracle helper ───────────────────────────────────────────────────
async def _ask_oracle(prompt: str, system: str) -> str:
    """Call L5 Oracle with high priority (cloud model)."""
    async with httpx.AsyncClient(timeout=ORACLE_TIMEOUT) as client:
        resp = await client.post(
            ORACLE_URL,
            json={
                "prompt": prompt,
                "system": system,
                "model": "tinyllama",
                "priority": "high",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        # Oracle may return {"response": "..."} or {"text": "..."}
        return data.get("response") or data.get("text") or json.dumps(data)


def _parse_evaluation(raw: str) -> Dict[str, Any]:
    """Best-effort parse of Oracle evaluation into structured data."""
    result: Dict[str, Any] = {
        "dimensions": {
            "privacy": {"score": None, "reasoning": ""},
            "fairness": {"score": None, "reasoning": ""},
            "transparency": {"score": None, "reasoning": ""},
            "safety": {"score": None, "reasoning": ""},
            "consent": {"score": None, "reasoning": ""},
        },
        "risk_score": None,
        "recommendation": "CAUTION",
        "raw_analysis": raw,
    }

    # Try to extract JSON block from Oracle response
    json_match = re.search(r"\{[\s\S]*\}", raw)
    if json_match:
        try:
            parsed = json.loads(json_match.group())
            # If Oracle returned structured JSON, use it directly
            if "dimensions" in parsed or "risk_score" in parsed:
                for key in result["dimensions"]:
                    if key in parsed.get("dimensions", {}):
                        dim = parsed["dimensions"][key]
                        if isinstance(dim, dict):
                            result["dimensions"][key] = dim
                        elif isinstance(dim, (int, float)):
                            result["dimensions"][key]["score"] = dim
                if "risk_score" in parsed:
                    result["risk_score"] = float(parsed["risk_score"])
                if "recommendation" in parsed:
                    result["recommendation"] = parsed["recommendation"]
                return result
        except (json.JSONDecodeError, ValueError):
            pass

    # Fallback: regex extraction of scores
    dimension_names = {
        "privacy": ["privacy"],
        "fairness": ["fairness", "bias"],
        "transparency": ["transparency"],
        "safety": ["safety"],
        "consent": ["consent", "autonomy"],
    }
    for dim_key, keywords in dimension_names.items():
        for kw in keywords:
            # Look for patterns like "Privacy impact: 7/10" or "Privacy: 7"
            pattern = rf"(?i){kw}[^:]*?[:：]\s*(?:score\s*)?(\d+)"
            match = re.search(pattern, raw)
            if match:
                score = int(match.group(1))
                result["dimensions"][dim_key]["score"] = min(10, max(1, score))
                # Grab a sentence or two of reasoning after the score
                after = raw[match.end():match.end() + 300]
                reasoning_match = re.search(r"[.–—:]\s*(.+?)(?:\n|$)", after)
                if reasoning_match:
                    result["dimensions"][dim_key]["reasoning"] = reasoning_match.group(1).strip()
                break

    # Extract risk_score
    risk_match = re.search(r"(?i)(?:overall\s+)?risk[_ ]?score[^:]*?[:：]\s*(0?\.\d+|1\.0|0|1)", raw)
    if risk_match:
        result["risk_score"] = float(risk_match.group(1))

    # Extract recommendation
    rec_match = re.search(r"(?i)recommendation[^:]*?[:：]\s*(APPROVE|CAUTION|REJECT)", raw)
    if rec_match:
        result["recommendation"] = rec_match.group(1).upper()

    # Compute risk_score from dimension scores if not extracted
    if result["risk_score"] is None:
        scores = [
            d["score"]
            for d in result["dimensions"].values()
            if d["score"] is not None
        ]
        if scores:
            result["risk_score"] = round(sum(scores) / (len(scores) * 10), 2)

    # Derive recommendation from risk_score if not extracted
    if result["risk_score"] is not None and not rec_match:
        if result["risk_score"] <= 0.3:
            result["recommendation"] = "APPROVE"
        elif result["risk_score"] <= 0.6:
            result["recommendation"] = "CAUTION"
        else:
            result["recommendation"] = "REJECT"

    return result


# ── Consciousness: broadcast helper ─────────────────────────────────

def _broadcast_ethical_alert(evaluation: Dict[str, Any], action: str):
    """Broadcast an ethical_alert on the bus when a REJECT decision is made."""
    try:
        bus = get_bus()
        bus.broadcast("ethicist", "ethical_alert", {
            "action": action[:300],
            "recommendation": evaluation.get("recommendation"),
            "risk_score": evaluation.get("risk_score"),
            "dimensions": {
                k: v.get("score") for k, v in evaluation.get("dimensions", {}).items()
            },
        })
    except Exception:
        pass  # never break router logic


# ── Routes ──────────────────────────────────────────────────────────
@router.post("/evaluate")
async def evaluate_action(request: EvaluateRequest):
    """Perform a real ethical evaluation via Oracle cloud model."""

    # ── Consciousness: wrap the evaluation ──
    async with conscious_action("ethicist", "evaluate", {
        "action": request.action[:200],
        "severity": request.severity,
    }) as ctx:
        system_prompt = (
            "You are an AI ethics advisor. Evaluate this action across:\n"
            "1) Privacy impact (score 1-10)\n"
            "2) Fairness/bias risk (1-10)\n"
            "3) Transparency (1-10)\n"
            "4) Safety (1-10)\n"
            "5) Consent/autonomy (1-10)\n\n"
            "For each dimension, explain your reasoning in 1-2 sentences.\n"
            "Provide an overall risk_score (0.0-1.0 where 1.0 is highest risk) "
            "and a clear recommendation: APPROVE, CAUTION, or REJECT.\n\n"
            "Respond in this JSON format:\n"
            '{"dimensions": {"privacy": {"score": N, "reasoning": "..."}, '
            '"fairness": {"score": N, "reasoning": "..."}, '
            '"transparency": {"score": N, "reasoning": "..."}, '
            '"safety": {"score": N, "reasoning": "..."}, '
            '"consent": {"score": N, "reasoning": "..."}}, '
            '"risk_score": 0.X, "recommendation": "APPROVE|CAUTION|REJECT"}'
        )
        user_prompt = f"Action: {request.action}\nContext: {request.context}\nSeverity: {request.severity}"

        try:
            raw = await _ask_oracle(user_prompt, system_prompt)
            evaluation = _parse_evaluation(raw)

            # Strict contract gate: all five dimensions + risk_score required.
            required_dims = ["privacy", "fairness", "transparency", "safety", "consent"]
            missing_dims = []
            for d in required_dims:
                score = (evaluation.get("dimensions", {}).get(d, {}) or {}).get("score")
                if not isinstance(score, (int, float)):
                    missing_dims.append(d)

            risk_score = evaluation.get("risk_score")
            if missing_dims or not isinstance(risk_score, (int, float)):
                return {
                    "success": False,
                    "error": "unstructured_or_incomplete_evaluation",
                    "fallback": "manual_review_required",
                    "missing_dimensions": missing_dims,
                    "evaluation": evaluation,
                }
        except httpx.TimeoutException:
            return {
                "success": False,
                "error": "Oracle timeout — ethical evaluation could not be completed in time",
                "fallback": "manual_review_required",
            }
        except Exception as exc:
            return {
                "success": False,
                "error": f"Oracle error: {str(exc)}",
                "fallback": "manual_review_required",
            }

        # Update state
        ethicist_state["evaluations"] += 1
        ethicist_state["last_evaluation_ts"] = time.time()
        rec = evaluation.get("recommendation", "CAUTION")
        if rec == "APPROVE":
            ethicist_state["approvals"] += 1
        elif rec == "REJECT":
            ethicist_state["rejections"] += 1
            # ── Consciousness: broadcast ethical_alert on REJECT ──
            _broadcast_ethical_alert(evaluation, request.action)
        else:
            ethicist_state["cautions"] += 1

        # ── Consciousness: record result ──
        ctx.set_result({
            "recommendation": rec,
            "risk_score": evaluation.get("risk_score"),
        })

    return {
        "success": True,
        "evaluation": evaluation,
    }


@router.post("/review")
async def review_content(request: ReviewRequest):
    """Review code or content for ethical concerns via Oracle."""

    async with conscious_action("ethicist", "review", {
        "content_type": request.content_type,
        "focus": request.focus,
    }) as ctx:
        system_prompt = (
            "You are an AI ethics reviewer specializing in code and content analysis. "
            "Review the following content and identify:\n"
            "1) **Bias patterns** — Any hardcoded assumptions, discriminatory logic, or exclusionary behavior\n"
            "2) **Privacy leaks** — Logging of PII, exposed secrets, data exfiltration risks\n"
            "3) **Harmful patterns** — Code that could cause harm, dark patterns, manipulative UX\n"
            "4) **Consent issues** — Missing opt-outs, silent data collection, unclear terms\n"
            "5) **Security concerns** — Injection risks, unsafe defaults, missing validation\n\n"
            "For each issue found, provide:\n"
            "- severity: low/medium/high/critical\n"
            "- description: what the issue is\n"
            "- location: where in the content (quote the relevant part)\n"
            "- recommendation: how to fix it\n\n"
            "Return ONLY valid JSON array (no markdown, no prose). "
            "Each item: {\"severity\":\"low|medium|high|critical\",\"description\":\"...\",\"location\":\"...\",\"recommendation\":\"...\"}. "
            "If no issues are found, return [] exactly."
        )
        focus_note = f"\nFocus especially on: {request.focus}" if request.focus else ""
        user_prompt = f"Content type: {request.content_type}{focus_note}\n\n```\n{request.content}\n```"

        try:
            raw = await _ask_oracle(user_prompt, system_prompt)
        except httpx.TimeoutException:
            return {"success": False, "error": "Oracle timeout during ethical review"}
        except Exception as exc:
            return {"success": False, "error": f"Oracle error: {str(exc)}"}

        ethicist_state["reviews"] += 1

        # Strict structured parse (JSON array only)
        issues = None
        parse_error = None
        try:
            parsed = json.loads(raw.strip())
            if isinstance(parsed, list):
                issues = parsed
            else:
                parse_error = "issues_not_list"
        except Exception:
            parse_error = "unstructured_review_output"

        if issues is None:
            ctx.set_result({
                "issue_count": 0,
                "content_type": request.content_type,
                "fallback": "manual_review_required",
            })
            return {
                "success": False,
                "error": parse_error or "unstructured_review_output",
                "fallback": "manual_review_required",
                "review": {
                    "content_type": request.content_type,
                    "issues": [],
                    "raw_analysis": raw,
                    "issue_count": 0,
                },
            }

        # Normalize issue objects
        normalized = []
        for item in issues:
            if isinstance(item, dict):
                normalized.append({
                    "severity": str(item.get("severity", "medium")).lower(),
                    "description": str(item.get("description", "")).strip(),
                    "location": str(item.get("location", "")).strip(),
                    "recommendation": str(item.get("recommendation", "")).strip(),
                })

        ctx.set_result({
            "issue_count": len(normalized),
            "content_type": request.content_type,
        })

    return {
        "success": True,
        "review": {
            "content_type": request.content_type,
            "issues": normalized,
            "raw_analysis": raw,
            "issue_count": len(normalized),
        },
    }


@router.get("/guidelines")
async def get_guidelines():
    """Return the ethical framework and principles used for evaluations."""
    return {
        "success": True,
        "data": ETHICAL_FRAMEWORK,
    }


@router.get("/status")
async def ethicist_status():
    return {
        "success": True,
        "data": {
            "level": 33,
            "name": "The Ethicist",
            "status": "active",
            "consciousness_integrated": True,
            "evaluations": ethicist_state["evaluations"],
            "reviews": ethicist_state["reviews"],
            "approvals": ethicist_state["approvals"],
            "cautions": ethicist_state["cautions"],
            "rejections": ethicist_state["rejections"],
            "last_evaluation_ts": ethicist_state["last_evaluation_ts"],
            "approval_rate": round(
                ethicist_state["approvals"]
                / max(1, ethicist_state["evaluations"]),
                2,
            ),
            "powered_by": "L5 Oracle (cloud reasoning)",
        },
        "error": None,
    }
