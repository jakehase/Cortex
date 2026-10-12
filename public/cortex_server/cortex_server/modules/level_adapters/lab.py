"""ExecutionEngine adapter for L4 Lab: exact calculation of expressions found
in the message (AST whitelist, no code execution) and static AST risk analysis
of Python code blocks. Running code is never auto-run (sandbox + approval)."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters._safe_level_common import clip, code_blocks, require_query

LEVEL = 4
NAME = "lab"
NEEDS_MODEL = False
SAFE_AUTORUN = True  # pure computation / static analysis only
DEFAULT_DEADLINE_S = 5.0

_NON_CALC_FENCE = re.compile(r"```(?!\s*(?:calc|math)\b)[^\n]*\n.*?```", re.S | re.I)
_RUN_INTENT = re.compile(r"\b(run|execute|exec|test it|try it|output of)\b", re.I)


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.modules import lab_analysis, lab_compute

    text = require_query(query)
    blocks = code_blocks(text)
    # Code inside non-calc fences is analysed, not evaluated as arithmetic.
    calc_source = _NON_CALC_FENCE.sub(" ", text)
    results: List[Dict[str, Any]] = []
    for expression in lab_compute.extract_expressions(calc_source, limit=5):
        try:
            value = lab_compute.evaluate(expression)
        except lab_compute.LabComputeError:
            continue
        results.append({k: value[k] for k in ("expression", "value", "exact_repr", "decimal", "type", "exact", "notes")})
    python_blocks = [b for b in blocks if b["language"] in {"python", ""}]
    analyses = []
    for block in python_blocks[:2]:
        report = lab_analysis.static_analysis(block["code"])
        if report.get("parse_ok") or block["language"] == "python":
            analyses.append({
                "static_check_passed": report["static_check_passed"],
                "parse_ok": report["parse_ok"],
                "findings": report["findings"][:10],
                "method": report["method"],
            })
    if not results and not analyses:
        raise ExecutionBlocked("no_calculation_or_python_code_in_message")
    wants_run = bool(analyses) and bool(_RUN_INTENT.search(text))
    parts = []
    for r in results:
        if not r["exact"]:
            parts.append(f"{r['expression']} ≈ {r['decimal']} (floating point)")
        elif r["type"] == "rational" and str(r["decimal"]).endswith("…"):
            parts.append(f"{r['expression']} = {r['exact_repr']} ≈ {r['decimal']} (exact fraction)")
        else:
            parts.append(f"{r['expression']} = {r['decimal']} (exact)")
    for a in analyses:
        if not a["parse_ok"]:
            parts.append("code does not parse: " + "; ".join(f"line {f['line']}: {f['detail']}" for f in a["findings"][:2]))
        else:
            risky = [f"{f['rule']}@{f['line']}" for f in a["findings"] if f["severity"] in {"high", "medium"}]
            parts.append("static AST screen " + ("passed" if a["static_check_passed"] else "FAILED")
                         + (f" (findings: {', '.join(risky[:6])})" if risky else ""))
    if wants_run:
        parts.append("Executing code needs the approval-gated Lab sandbox (/lab/execute); it was not run.")
    return {
        "operation": "lab.compute",
        "origin": "deterministic",
        "summary": clip("Lab: " + " | ".join(parts), 1500),
        "data": {
            "results": results,
            "static_analysis": analyses,
            "execution": {"performed": False, "requires_approval": wants_run},
        },
    }
