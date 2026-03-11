"""L3 Hive novelty algorithms.

Implements six orchestration ideas:
1) Swarm Auction Scheduler (SAS)
2) Counterfactual Branch Swarm (CBS)
3) Disagreement-First Hive (DFH)
4) Verifier-Escrow Parallelism (VEP)
5) Adaptive Topology Hive (ATH)
6) Novelty-Seeking Exploration Budget (NSEB)
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Dict, List, Optional, Tuple
import re


_DEFAULT_WORKERS = [
    "worker-alpha",
    "worker-bravo",
    "worker-charlie",
    "worker-delta",
    "worker-echo",
]


def _stable_float(*parts: str) -> float:
    raw = "|".join(str(p) for p in parts)
    digest = sha256(raw.encode("utf-8")).hexdigest()[:12]
    value = int(digest, 16) / float(16 ** 12)
    return round(value, 6)


def _split_goal(goal: str, max_tasks: int = 8) -> List[str]:
    text = (goal or "").strip()
    if not text:
        return []
    parts = re.split(r"\b(?:and then|then|and|,|;|\|)\b", text, flags=re.IGNORECASE)
    parts = [p.strip(" .") for p in parts if p and p.strip(" .")]
    if len(parts) >= 2:
        return parts[:max_tasks]
    return [
        f"Collect evidence for: {text}",
        f"Evaluate options for: {text}",
        f"Produce validated recommendation for: {text}",
    ][:max_tasks]


def _task_domain(task: str) -> str:
    t = (task or "").lower()
    if any(k in t for k in ["price", "quote", "cost", "finance", "loan"]):
        return "finance"
    if any(k in t for k in ["research", "source", "evidence", "compare"]):
        return "research"
    if any(k in t for k in ["test", "validate", "check", "verify"]):
        return "validation"
    if any(k in t for k in ["design", "architecture", "plan", "topology"]):
        return "architecture"
    return "general"


@dataclass
class AuctionConfig:
    risk_weight: float = 0.35
    cost_weight: float = 0.25
    novelty_weight: float = 0.20
    speed_weight: float = 0.20


def swarm_auction_scheduler(
    tasks: List[str],
    workers: Optional[List[str]] = None,
    config: Optional[AuctionConfig] = None,
) -> Dict[str, Any]:
    workers = list(workers or _DEFAULT_WORKERS)
    if not workers:
        workers = list(_DEFAULT_WORKERS)
    cfg = config or AuctionConfig()

    assignments: List[Dict[str, Any]] = []
    all_bids: List[Dict[str, Any]] = []

    for idx, task in enumerate(tasks, start=1):
        task_id = f"t{idx:02d}"
        domain = _task_domain(task)
        bids: List[Tuple[float, Dict[str, Any]]] = []
        for w in workers:
            value = _stable_float("value", task, w)
            risk = _stable_float("risk", task, w)
            cost = _stable_float("cost", task, w)
            speed = _stable_float("speed", task, w)
            novelty = _stable_float("novelty", task, w)

            domain_fit = 0.1 if domain in w else 0.0
            score = (
                value
                - cfg.risk_weight * risk
                - cfg.cost_weight * cost
                + cfg.speed_weight * speed
                + cfg.novelty_weight * novelty
                + domain_fit
            )
            record = {
                "worker": w,
                "value": round(value, 4),
                "risk": round(risk, 4),
                "cost": round(cost, 4),
                "speed": round(speed, 4),
                "novelty": round(novelty, 4),
                "domain_fit": round(domain_fit, 4),
                "score": round(score, 4),
            }
            bids.append((score, record))

        bids.sort(key=lambda x: x[0], reverse=True)
        winner = bids[0][1]
        assignments.append(
            {
                "task_id": task_id,
                "task": task,
                "domain": domain,
                "winner": winner["worker"],
                "winning_score": winner["score"],
                "top_bids": [b[1] for b in bids[:3]],
            }
        )
        all_bids.extend(
            {
                "task_id": task_id,
                "task": task,
                **b[1],
            }
            for b in bids
        )

    return {
        "algorithm": "SAS",
        "summary": "Swarm Auction Scheduler assigned each task to highest expected-value bid under risk/cost/novelty weighting.",
        "worker_pool": workers,
        "assignments": assignments,
        "bid_count": len(all_bids),
        "weights": {
            "risk_weight": cfg.risk_weight,
            "cost_weight": cfg.cost_weight,
            "speed_weight": cfg.speed_weight,
            "novelty_weight": cfg.novelty_weight,
        },
    }


def counterfactual_branch_swarm(goal: str, assumptions: Optional[List[str]] = None, max_branches: int = 4) -> Dict[str, Any]:
    base_assumptions = assumptions or [
        "baseline: current constraints hold",
        "optimistic: approvals and pricing improve",
        "conservative: approvals tighten and prices worsen",
        "regulatory shock: policy/market terms shift unexpectedly",
    ]
    branches = []
    for i, a in enumerate(base_assumptions[: max(2, max_branches)], start=1):
        branch_id = f"cf-{i:02d}"
        risk_bias = round(0.25 + i * 0.12, 2)
        branches.append(
            {
                "branch_id": branch_id,
                "assumption": a,
                "risk_bias": min(0.95, risk_bias),
                "objective": f"Solve goal under assumption '{a}'",
                "prompt": f"Given goal: {goal}. Assume: {a}. Produce best plan, top risk, and fallback.",
            }
        )
    return {
        "algorithm": "CBS",
        "summary": "Counterfactual Branch Swarm generates parallel assumption-branches and compares outcomes before merge.",
        "branches": branches,
        "merge_rule": "Select robust options that survive >=2 branch worlds; flag fragile branch-specific wins.",
    }


def disagreement_first_hive(tasks: List[str], strategies: Optional[List[str]] = None) -> Dict[str, Any]:
    strategy_pool = strategies or [
        "literal_solver",
        "contrarian_solver",
        "causal_solver",
        "probabilistic_solver",
    ]
    challenge_sets = []
    for idx, task in enumerate(tasks, start=1):
        task_id = f"t{idx:02d}"
        selected = strategy_pool[:3]
        challenge_sets.append(
            {
                "task_id": task_id,
                "task": task,
                "strategy_prompts": [
                    {
                        "strategy": s,
                        "instruction": f"Apply {s} to task: {task}",
                    }
                    for s in selected
                ],
                "consensus_policy": "Require explicit disagreement map before synthesis.",
            }
        )
    return {
        "algorithm": "DFH",
        "summary": "Disagreement-First Hive intentionally creates solver diversity before consensus.",
        "challenge_sets": challenge_sets,
    }


def verifier_escrow_parallelism(assignments: List[Dict[str, Any]], verifier_count: int = 3, release_threshold: float = 0.67) -> Dict[str, Any]:
    verifier_count = max(2, int(verifier_count))
    releases: List[Dict[str, Any]] = []

    for row in assignments:
        task_id = str(row.get("task_id"))
        worker = str(row.get("winner", "unknown"))
        votes = []
        for v in range(1, verifier_count + 1):
            conf = _stable_float("verify", task_id, worker, f"v{v}")
            votes.append({"verifier": f"verifier-{v}", "confidence": round(conf, 4), "pass": conf >= release_threshold})

        avg_conf = sum(v["confidence"] for v in votes) / len(votes)
        pass_count = sum(1 for v in votes if v["pass"])
        released = pass_count >= 2 and avg_conf >= release_threshold

        releases.append(
            {
                "task_id": task_id,
                "worker": worker,
                "released": released,
                "escrow_state": "released" if released else "held",
                "pass_count": pass_count,
                "avg_confidence": round(avg_conf, 4),
                "votes": votes,
            }
        )

    return {
        "algorithm": "VEP",
        "summary": "Verifier-Escrow Parallelism holds outputs until independent verifier quorum passes.",
        "release_threshold": release_threshold,
        "releases": releases,
        "released_count": sum(1 for r in releases if r["released"]),
        "held_count": sum(1 for r in releases if not r["released"]),
    }


def adaptive_topology_hive(tasks: List[str], disagreement_density: float, dependency_density: float) -> Dict[str, Any]:
    parallelism_ratio = 1.0 - max(0.0, min(1.0, dependency_density))

    if dependency_density >= 0.6:
        topology = "tree"
        rationale = "High dependency density favors staged tree execution."
    elif disagreement_density >= 0.5 and parallelism_ratio >= 0.5:
        topology = "mesh"
        rationale = "High disagreement + high parallelism favors mesh cross-checking."
    else:
        topology = "star"
        rationale = "Mixed constraints favor star coordinator with independent workers."

    nodes = [f"n{i:02d}" for i in range(1, max(2, len(tasks)) + 1)]
    edges: List[Tuple[str, str]] = []
    if topology == "star":
        center = nodes[0]
        edges = [(center, n) for n in nodes[1:]]
    elif topology == "tree":
        for i in range(1, len(nodes)):
            parent = nodes[(i - 1) // 2]
            edges.append((parent, nodes[i]))
    else:  # mesh (bounded ring+chords to avoid quadratic blowup)
        for i in range(len(nodes)):
            edges.append((nodes[i], nodes[(i + 1) % len(nodes)]))
            if len(nodes) > 3:
                edges.append((nodes[i], nodes[(i + 2) % len(nodes)]))

    return {
        "algorithm": "ATH",
        "summary": "Adaptive Topology Hive selects star/tree/mesh based on dependency and disagreement signals.",
        "topology": topology,
        "rationale": rationale,
        "signals": {
            "disagreement_density": round(disagreement_density, 4),
            "dependency_density": round(dependency_density, 4),
            "parallelism_ratio": round(parallelism_ratio, 4),
        },
        "edges": [{"from": a, "to": b} for a, b in edges],
    }


def novelty_seeking_exploration_budget(tasks: List[str], budget_fraction: float = 0.25) -> Dict[str, Any]:
    fraction = min(0.6, max(0.1, float(budget_fraction)))
    scored = []
    for idx, task in enumerate(tasks, start=1):
        novelty = _stable_float("nseb", task, str(idx))
        scored.append({"task_id": f"t{idx:02d}", "task": task, "novelty_score": round(novelty, 4)})

    scored.sort(key=lambda x: x["novelty_score"], reverse=True)
    explore_n = max(1, int(round(len(scored) * fraction)))
    explore = scored[:explore_n]
    exploit = scored[explore_n:]

    return {
        "algorithm": "NSEB",
        "summary": "Novelty-Seeking Exploration Budget reserves bounded swarm capacity for high-novelty probes.",
        "budget_fraction": fraction,
        "explore_count": len(explore),
        "exploit_count": len(exploit),
        "explore": explore,
        "exploit": exploit,
    }


def build_l3_novel_plan(
    goal: str,
    context: Optional[str] = None,
    tasks: Optional[List[str]] = None,
    assumptions: Optional[List[str]] = None,
    worker_pool: Optional[List[str]] = None,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    opts = options or {}
    base_tasks = [t.strip() for t in (tasks or []) if isinstance(t, str) and t.strip()]
    if not base_tasks:
        base_tasks = _split_goal(goal, max_tasks=int(opts.get("max_tasks", 6)))

    sas = swarm_auction_scheduler(
        base_tasks,
        workers=worker_pool,
        config=AuctionConfig(
            risk_weight=float(opts.get("risk_weight", 0.35)),
            cost_weight=float(opts.get("cost_weight", 0.25)),
            novelty_weight=float(opts.get("novelty_weight", 0.20)),
            speed_weight=float(opts.get("speed_weight", 0.20)),
        ),
    )
    cbs = counterfactual_branch_swarm(goal=goal, assumptions=assumptions, max_branches=int(opts.get("max_branches", 4)))
    dfh = disagreement_first_hive(base_tasks)
    vep = verifier_escrow_parallelism(
        assignments=sas.get("assignments", []),
        verifier_count=int(opts.get("verifier_count", 3)),
        release_threshold=float(opts.get("release_threshold", 0.67)),
    )

    disagreement_density = min(1.0, len(dfh.get("challenge_sets", [])) / max(1, len(base_tasks))) * 0.7
    dependency_density = min(1.0, _stable_float("dep", goal, context or ""))
    ath = adaptive_topology_hive(base_tasks, disagreement_density=disagreement_density, dependency_density=dependency_density)
    nseb = novelty_seeking_exploration_budget(base_tasks, budget_fraction=float(opts.get("budget_fraction", 0.25)))

    return {
        "goal": goal,
        "context": context,
        "task_count": len(base_tasks),
        "tasks": [{"task_id": f"t{i:02d}", "task": t} for i, t in enumerate(base_tasks, start=1)],
        "implemented_ideas": {
            "1_sas": sas,
            "2_cbs": cbs,
            "3_dfh": dfh,
            "4_vep": vep,
            "5_ath": ath,
            "6_nseb": nseb,
        },
        "execution_order": ["NSEB", "SAS", "DFH", "CBS", "ATH", "VEP"],
        "status": "planned",
    }
