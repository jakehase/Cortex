"""Fast verification hooks for Q&A Fastlane.

Expanded to catch shallow-but-confident answers and missing constraints.
"""
from __future__ import annotations

from typing import Dict, Any, List
import re


def _extract_constraints(text: str) -> List[str]:
    t = (text or "").lower()
    out: List[str] = []
    markers = [
        "at least", "at most", "no more than", "minimum", "maximum",
        "must", "should", "cannot", "without", "%", "percent",
        "budget", "deadline", "risk", "tradeoff", "constraint",
    ]
    for m in markers:
        if m in t:
            out.append(m)
    # number-like constraints
    if re.search(r"\b\d+(?:\.\d+)?\b", t):
        out.append("numeric")
    return sorted(set(out))


def fast_verify(answer: str, qtype: str, prompt: str = "") -> Dict[str, Any]:
    text = (answer or "").strip().lower()
    prompt_text = (prompt or "").strip().lower()

    # Avoid giving credit for merely repeating the user's constraints verbatim.
    analysis_text = text.replace(prompt_text, " ").strip() if prompt_text and prompt_text in text else text

    contradiction_detected = (
        ("always" in analysis_text and "never" in analysis_text)
        or ("best" in analysis_text and "worst" in analysis_text and "depends" not in analysis_text)
    )
    overclaim_detected = any(x in analysis_text for x in ["guaranteed", "100%", "certainly always", "zero risk", "no downside"])

    required_fields_ok = True
    if qtype == "comparative":
        required_fields_ok = (
            ("vs" in analysis_text) or ("compared" in analysis_text) or ("difference" in analysis_text) or ("tradeoff" in analysis_text)
        )
    elif qtype == "procedural":
        required_fields_ok = any(k in analysis_text for k in ["step", "1.", "first", "then", "next", "finally"])

    # New quality checks
    prompt_constraints = _extract_constraints(prompt_text)
    answer_constraints = _extract_constraints(analysis_text)
    missing_constraints = [c for c in prompt_constraints if c not in answer_constraints and c != "numeric"]

    too_short = len(analysis_text) < 40
    has_structure = any(k in analysis_text for k in ["because", "therefore", "however", "tradeoff", "risk", "verify"])
    shallow_confidence_risk = too_short and overclaim_detected

    return {
        "contradiction_detected": contradiction_detected,
        "overclaim_detected": overclaim_detected,
        "required_fields_ok": required_fields_ok,
        "missing_constraints": missing_constraints,
        "missing_constraints_count": len(missing_constraints),
        "too_short": too_short,
        "has_structure": has_structure,
        "shallow_confidence_risk": shallow_confidence_risk,
    }
