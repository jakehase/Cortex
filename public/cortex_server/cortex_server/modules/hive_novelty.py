"""L12 Hive plan templates (formerly the "six novelty algorithms").

The earlier version presented sha256 hash values as auction bids, verifier
confidences, dependency densities and novelty scores.  None of those numbers
measured anything, so they are gone.  What remains is an honest plan view over
subtasks that came from a real source (the model decomposition in
``hive_swarm`` or a caller-supplied task list):

* SAS  -> each subtask's assigned read-only level, with its basis;
* CBS  -> counterfactual prompt templates, only for assumptions the caller gave;
* DFH  -> solver-diversity prompt templates (clearly labelled templates);
* VEP  -> not run at plan time; the executed swarm checks synthesis citations;
* ATH  -> topology derived from the subtask structure (independent -> star);
* NSEB -> retired: there is no novelty signal to budget against.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

TEMPLATES = ["SAS", "CBS", "DFH", "VEP", "ATH"]
RETIRED = ["NSEB"]


def _normalise_subtasks(
    subtasks: Optional[List[Dict[str, Any]]],
    tasks: Optional[List[str]],
) -> tuple[List[Dict[str, Any]], str]:
    if subtasks:
        rows = []
        for idx, row in enumerate(subtasks, start=1):
            if not isinstance(row, dict) or not str(row.get("question") or "").strip():
                continue
            rows.append({
                "task_id": str(row.get("id") or f"t{idx}"),
                "task": str(row.get("question")).strip()[:300],
                "assigned_level": str(row.get("level") or "unassigned"),
                "purpose": str(row.get("purpose") or "")[:200],
            })
        return rows, "model_decomposition"
    rows = [
        {"task_id": f"t{idx}", "task": t.strip()[:300], "assigned_level": "unassigned", "purpose": ""}
        for idx, t in enumerate(tasks or [], start=1)
        if isinstance(t, str) and t.strip()
    ]
    return rows, "caller_supplied"


def build_l3_novel_plan(
    goal: str,
    context: Optional[str] = None,
    tasks: Optional[List[str]] = None,
    assumptions: Optional[List[str]] = None,
    worker_pool: Optional[List[str]] = None,
    options: Optional[Dict[str, Any]] = None,
    subtasks: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Build a plan view; never invents tasks, scores or votes."""

    rows, basis = _normalise_subtasks(subtasks, tasks)
    if not rows:
        return {
            "goal": goal,
            "context": context,
            "task_count": 0,
            "tasks": [],
            "status": "needs_decomposition",
            "note": "No subtasks were supplied and none were produced by a decomposition step.",
        }

    sas = {
        "algorithm": "SAS",
        "kind": "assignment",
        "basis": basis,
        "assignments": [
            {"task_id": r["task_id"], "task": r["task"], "assigned_level": r["assigned_level"]}
            for r in rows
        ],
    }
    if worker_pool:
        sas["worker_pool_note"] = "worker_pool ignored: Cortex has no worker capability data to auction against"

    clean_assumptions = [a.strip()[:200] for a in (assumptions or []) if isinstance(a, str) and a.strip()][:4]
    cbs = {
        "algorithm": "CBS",
        "kind": "prompt_template",
        "branches": [
            {
                "branch_id": f"cf-{i:02d}",
                "assumption": a,
                "prompt": f"Given goal: {goal}. Assume: {a}. Produce best plan, top risk, and fallback.",
            }
            for i, a in enumerate(clean_assumptions, start=1)
        ],
    }
    if not clean_assumptions:
        cbs["note"] = "no assumptions supplied; no counterfactual branches generated"

    dfh = {
        "algorithm": "DFH",
        "kind": "prompt_template",
        "challenge_sets": [
            {
                "task_id": r["task_id"],
                "strategy_prompts": [
                    {"strategy": s, "instruction": f"Apply {s} to task: {r['task']}"}
                    for s in ("literal_solver", "contrarian_solver", "causal_solver")
                ],
            }
            for r in rows
        ],
    }
    vep = {
        "algorithm": "VEP",
        "status": "not_run_at_plan_time",
        "note": "When the swarm executes, synthesis citations are checked against subtasks that actually produced evidence.",
    }
    ath = {
        "algorithm": "ATH",
        "basis": "structure",
        "topology": "star",
        "rationale": "Decomposed subtasks are independent, so a coordinator fans out and merges results.",
        "edges": [{"from": "coordinator", "to": r["task_id"]} for r in rows],
    }
    return {
        "goal": goal,
        "context": context,
        "task_count": len(rows),
        "tasks": [{"task_id": r["task_id"], "task": r["task"], "assigned_level": r["assigned_level"],
                   "purpose": r["purpose"]} for r in rows],
        "task_basis": basis,
        "plan_templates": {
            "1_sas": sas,
            "2_cbs": cbs,
            "3_dfh": dfh,
            "4_vep": vep,
            "5_ath": ath,
        },
        "retired": {"6_nseb": "removed: earlier novelty scores were sha256 values, not a signal"},
        "execution_order": ["SAS", "ATH", "VEP"],
        "status": "planned",
    }


__all__ = ["RETIRED", "TEMPLATES", "build_l3_novel_plan"]
