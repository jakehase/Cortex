from __future__ import annotations

from typing import Any, Dict, List

from cortex_server.modules.latency_budget_governor import classify_task_archetype
from cortex_server.modules.reasoning_beliefs import select_influential_beliefs
from cortex_server.modules.reasoning_kernel import build_policy_decision, model_dump_compat
from cortex_server.modules.routing_autotune import get_policy_snapshot


def build_workflow_policy(*, name: str, goal: str = "", description: str = "", steps: List[Dict[str, Any]] | None = None, metadata: Dict[str, Any] | None = None) -> Dict[str, Any]:
    steps = list(steps or [])
    metadata = dict(metadata or {})
    query = " ".join(x for x in [name, goal, description] if x).strip()
    archetype = classify_task_archetype(query)
    route_policy = get_policy_snapshot()
    belief_subjects = [str(x) for x in (metadata.get("policy_belief_subjects") or []) if str(x).strip()]
    belief_predicates = [str(x) for x in (metadata.get("policy_belief_predicates") or []) if str(x).strip()]
    policy_task_id = str(metadata.get("task_id") or metadata.get("kernel_task_id") or "").strip() or None
    belief_query = None if (belief_subjects or belief_predicates) else query
    belief_influences = select_influential_beliefs(
        task_id=policy_task_id,
        subjects=belief_subjects or None,
        predicates=belief_predicates or None,
        query=belief_query,
        limit=6,
    )
    if not belief_influences:
        belief_influences = select_influential_beliefs(
            task_id=None,
            subjects=belief_subjects or None,
            predicates=belief_predicates or None,
            query=belief_query,
            limit=6,
        )
    belief_ids = [str(row.get("claim_id") or "") for row in belief_influences if str(row.get("claim_id") or "").strip()]

    dep_total = sum(len((step.get("depends_on") or [])) for step in steps if isinstance(step, dict))
    node_count = max(1, len(steps))
    dependency_density = dep_total / node_count
    root_count = sum(1 for step in steps if isinstance(step, dict) and not (step.get("depends_on") or []))
    has_waits = any(bool(((step.get("metadata") or {}).get("wait_until")) or ((step.get("metadata") or {}).get("delay_seconds") is not None)) for step in steps if isinstance(step, dict))
    has_contracts = any(bool(step.get("contracts")) for step in steps if isinstance(step, dict))
    cadence_seconds = int(metadata.get("cadence_seconds", 0) or 0)
    long_running = cadence_seconds > 0 or has_waits
    requested_execution_mode = str(metadata.get("execution_mode") or "").strip().lower()
    if requested_execution_mode in {"parallel", "sequential"}:
        execution_mode = requested_execution_mode
    else:
        execution_mode = "parallel" if root_count > 1 and not long_running else "sequential"
    requested_parallelism = int(metadata.get("max_parallelism", 0) or 0)
    max_parallelism = max(1, min(8, requested_parallelism or (root_count if execution_mode == "parallel" else 1)))
    requested_verification_mode = str(metadata.get("verification_mode") or "").strip().lower()
    if requested_verification_mode in {"basic", "strict"}:
        verification_mode = requested_verification_mode
    else:
        verification_mode = "strict" if has_contracts or archetype in {"coding", "planning", "ops_triage"} else "basic"

    risk_flags: List[str] = []
    if has_contracts:
        risk_flags.append("verification")
    if dependency_density >= 0.5:
        risk_flags.append("dependency_dense")
    if long_running:
        risk_flags.append("long_running")
    if execution_mode == "parallel":
        risk_flags.append("parallelizable")

    decisions = [
        build_policy_decision(
            domain="routing",
            chosen="deliberate" if archetype in {"coding", "planning", "ops_triage"} or dependency_density >= 0.5 else "fastlane",
            rationale=f"archetype={archetype}, dependency_density={dependency_density:.2f}",
            confidence=0.78,
            alternatives=["fastlane", "deliberate"],
            inputs={"archetype": archetype, "dependency_density": round(dependency_density, 3), "route_policy": route_policy, "belief_ids": belief_ids},
        ),
        build_policy_decision(
            domain="scheduler",
            chosen="managed_runtime" if long_running or dependency_density > 0 else "immediate",
            rationale=f"long_running={long_running}, has_waits={has_waits}",
            confidence=0.8,
            alternatives=["immediate", "managed_runtime"],
            inputs={"cadence_seconds": cadence_seconds, "has_waits": has_waits, "execution_mode": execution_mode, "belief_ids": belief_ids},
        ),
        build_policy_decision(
            domain="verification",
            chosen=verification_mode,
            rationale=f"contracts={has_contracts}",
            confidence=0.76,
            alternatives=["basic", "strict"],
            inputs={"contracts_present": has_contracts, "belief_ids": belief_ids},
        ),
        build_policy_decision(
            domain="memory",
            chosen="durable_process" if long_running else "task_scoped",
            rationale=f"cadence_seconds={cadence_seconds}",
            confidence=0.72,
            alternatives=["task_scoped", "durable_process"],
            inputs={"cadence_seconds": cadence_seconds, "belief_ids": belief_ids},
        ),
    ]

    settings = {
        "execution_mode": execution_mode,
        "max_parallelism": max_parallelism,
        "verification_mode": verification_mode,
        "same_tick_drain": bool(metadata.get("same_tick_drain", True)),
        "strict_requires_contracts": bool(metadata.get("strict_requires_contracts", False)),
        "enforce_policy": bool(metadata.get("enforce_policy", True)),
        "step_timeout_seconds": metadata.get("step_timeout_seconds"),
        "retry_max_attempts": int(metadata.get("retry_max_attempts", 2 if archetype in {"coding", "ops_triage"} else 1) or 1),
        "retry_backoff_seconds": float(metadata.get("retry_backoff_seconds", 0.0) or 0.0),
        "retry_on_timeout": bool(metadata.get("retry_on_timeout", True)),
        "retry_on_status_codes": [int(x) for x in (metadata.get("retry_on_status_codes") or []) if str(x).strip()],
        "retry_on_error_types": [str(x).lower() for x in (metadata.get("retry_on_error_types") or []) if str(x).strip()],
        "workflow_deadline_seconds": metadata.get("workflow_deadline_seconds"),
    }

    return {
        "archetype": archetype,
        "belief_influences": belief_influences,
        "belief_influence_ids": belief_ids,
        "dependency_density": round(dependency_density, 3),
        "root_count": root_count,
        "long_running": long_running,
        "risk_flags": risk_flags,
        "route_policy_snapshot": route_policy,
        "settings": settings,
        "decisions": [model_dump_compat(d) for d in decisions],
    }


__all__ = ["build_workflow_policy"]
