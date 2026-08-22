"""Q&A Fastlane v1 helpers."""
from __future__ import annotations

from typing import Dict, List, Any


def classify_qtype(prompt: str) -> str:
    p = (prompt or "").strip().lower()
    if not p:
        return "factual"
    if any(k in p for k in ["how to", "how do i", "steps", "procedure", "install", "configure"]):
        return "procedural"
    if any(k in p for k in ["vs", "versus", "compare", "difference", "better than"]):
        return "comparative"
    if any(k in p for k in ["why", "explain", "what causes", "reason"]):
        return "explanatory"
    if any(k in p for k in ["opinion", "should i", "best", "recommend", "worth it"]):
        return "opinionated"
    return "factual"


def build_template(qtype: str) -> Dict[str, Any]:
    templates = {
        "factual": {
            "answer": "",
            "key_points": [],
            "sources": []
        },
        "explanatory": {
            "summary": "",
            "mechanism": "",
            "examples": [],
            "sources": []
        },
        "comparative": {
            "topic_a": "",
            "topic_b": "",
            "differences": [],
            "tradeoffs": [],
            "recommendation": ""
        },
        "procedural": {
            "goal": "",
            "steps": [],
            "pitfalls": [],
            "verification": ""
        },
        "opinionated": {
            "position": "",
            "pros": [],
            "cons": [],
            "caveats": []
        }
    }
    return templates.get(qtype, templates["factual"])


def confidence_score(answer: str, checks: Dict[str, Any]) -> float:
    score = 0.45
    if answer and len(answer.strip()) > 20:
        score += 0.12
    if checks.get("required_fields_ok"):
        score += 0.12
    if not checks.get("contradiction_detected"):
        score += 0.1
    if not checks.get("overclaim_detected"):
        score += 0.08
    if checks.get("retrieval_hits", 0) > 0:
        score += 0.05
    if checks.get("has_structure"):
        score += 0.06
    if checks.get("missing_constraints_count", 0) > 0:
        score -= min(0.15, 0.05 * checks.get("missing_constraints_count", 0))
    if checks.get("shallow_confidence_risk"):
        score -= 0.12
    return max(0.0, min(1.0, score))


def should_escalate(confidence: float, risk_flags: List[str], threshold: float = 0.72) -> bool:
    if confidence < threshold:
        return True
    high_risk = {"medical", "legal", "financial", "safety", "security"}
    return any(flag in high_risk for flag in (risk_flags or []))
