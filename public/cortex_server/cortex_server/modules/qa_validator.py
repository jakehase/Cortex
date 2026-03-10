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

    contradiction_detected = (
        ("always" in text and "never" in text)
        or ("best" in text and "worst" in text and "depends" not in text)
    )
    overclaim_detected = any(x in text for x in ["guaranteed", "100%", "certainly always", "zero risk", "no downside"])

    required_fields_ok = True
    if qtype == "comparative":
        required_fields_ok = (
            ("vs" in text) or ("compared" in text) or ("difference" in text) or ("tradeoff" in text)
        )
    elif qtype == "procedural":
        required_fields_ok = any(k in text for k in ["step", "1.", "first", "then", "next", "finally"])

    # New quality checks
    prompt_constraints = _extract_constraints(prompt_text)
    answer_constraints = _extract_constraints(text)
    missing_constraints = [c for c in prompt_constraints if c not in answer_constraints and c != "numeric"]

    too_short = len(text) < 40
    has_structure = any(k in text for k in ["because", "therefore", "however", "tradeoff", "risk", "verify"])
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
