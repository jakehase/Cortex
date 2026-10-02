from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

import httpx

from cortex_server.modules.reasoning_failures import enrich_failure
from cortex_server.modules.reasoning_planner import dependency_failures, render_plan_templates
from cortex_server.modules.reasoning_retry_policy import retry_settings
from cortex_server.modules.reasoning_safety import evaluate_step_permission
from cortex_server.modules.runtime_constraint_compiler import compile_runtime_constraint_settings
from cortex_server.modules.verification_contracts import evaluate_contracts


JsonDict = Dict[str, Any]
StepBeliefContextFn = Callable[[JsonDict, Optional[JsonDict]], JsonDict]
RedactHeadersFn = Callable[[Dict[str, str]], Dict[str, str]]
ValidateEndpointFn = Callable[[str], None]
PayloadSizeOkFn = Callable[[Any], bool]
ExecuteSingleStepFn = Callable[..., Awaitable[JsonDict]]
ExecuteStepWithRetryFn = Callable[..., Awaitable[JsonDict]]
WorkflowPolicySettingsFn = Callable[[Optional[JsonDict]], JsonDict]
CancelledStepResultFn = Callable[[JsonDict], JsonDict]

def trim_response_body(body: Any, *, max_chars: int) -> Any:
    if isinstance(body, str):
        return body[:max_chars]
    try:
        return json.loads(json.dumps(body)[:max_chars])
    except Exception:
        return str(body)[:max_chars]



def workflow_policy_settings(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    return compile_runtime_constraint_settings(workflow_metadata)



def effective_step_timeout(step: JsonDict, workflow_metadata: Optional[JsonDict], *, step_timeout_max_s: float) -> float:
    policy_settings = workflow_policy_settings(workflow_metadata)
    policy_timeout = policy_settings.get("step_timeout_seconds")
    timeout_s = step.get("timeout_seconds")
    chosen = timeout_s if timeout_s is not None else policy_timeout
    timeout = step_timeout_max_s
    if chosen is not None:
        try:
            timeout = min(step_timeout_max_s, max(0.1, float(chosen)))
        except Exception:
            timeout = step_timeout_max_s

    # execute_step_with_retry sets this private, per-attempt value immediately
    # before the call.  Unlike authored timeout metadata it may legitimately be
    # below the normal 100 ms floor because a workflow deadline is authoritative.
    remaining = step.get("_remaining_workflow_budget_seconds")
    if remaining is not None:
        try:
            timeout = min(timeout, max(0.0, float(remaining)))
        except Exception:
            pass
    return timeout



def runtime_routing_summary(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    metadata = dict(workflow_metadata or {})
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    routing_r9 = policy.get("routing_r9") if isinstance(policy.get("routing_r9"), dict) else {}
    if not routing_r9:
        return {"enabled": False}
    applied = workflow_policy_settings(workflow_metadata)
    return {
        "enabled": bool(routing_r9.get("enabled")),
        "selected_chain": applied.get("routing_selected_chain") or routing_r9.get("selected_chain"),
        "default_chain": routing_r9.get("default_chain"),
        "allowed_chain_ids": list(routing_r9.get("allowed_chain_ids") or []),
        "coarse_choice": routing_r9.get("coarse_choice"),
        "utility": routing_r9.get("utility"),
        "estimated_quality": routing_r9.get("estimated_quality"),
        "override_reason": applied.get("routing_override_reason"),
        "runtime_controls": {
            "execution_mode": applied.get("execution_mode"),
            "same_tick_drain": applied.get("same_tick_drain"),
            "step_timeout_seconds": applied.get("step_timeout_seconds"),
            "retry_max_attempts": applied.get("retry_max_attempts"),
            "retry_on_timeout": applied.get("retry_on_timeout"),
        },
    }



def runtime_homeostasis_summary(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    metadata = dict(workflow_metadata or {})
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    homeostasis = policy.get("homeostasis") if isinstance(policy.get("homeostasis"), dict) else {}
    if not homeostasis:
        return {"enabled": False}
    effort = homeostasis.get("effort") if isinstance(homeostasis.get("effort"), dict) else {}
    guardrails = homeostasis.get("guardrails") if isinstance(homeostasis.get("guardrails"), dict) else {}
    applied = workflow_policy_settings(workflow_metadata)
    return {
        "enabled": bool(homeostasis.get("enabled")),
        "mode": homeostasis.get("mode"),
        "intent": homeostasis.get("intent"),
        "risk_tier": homeostasis.get("risk_tier"),
        "prefer_chain": guardrails.get("prefer_chain"),
        "allowed_chains": list(guardrails.get("allowed_chains") or []),
        "reasoning_depth": effort.get("reasoning_depth"),
        "human_review_required": bool(effort.get("human_review_required")),
        "escalation_recommended": bool(effort.get("escalation_recommended")),
        "runtime_controls": {
            "execution_mode": applied.get("execution_mode"),
            "max_parallelism": applied.get("max_parallelism"),
            "same_tick_drain": applied.get("same_tick_drain"),
            "verification_mode": applied.get("verification_mode"),
            "step_timeout_seconds": applied.get("step_timeout_seconds"),
            "retry_max_attempts": applied.get("retry_max_attempts"),
            "retry_on_timeout": applied.get("retry_on_timeout"),
        },
    }



def runtime_world_state_summary(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    metadata = dict(workflow_metadata or {})
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    world_state = policy.get("world_state") if isinstance(policy.get("world_state"), dict) else {}
    if not world_state:
        return {"enabled": False}
    applied = workflow_policy_settings(workflow_metadata)
    return {
        "enabled": bool(world_state.get("enabled")),
        "entity_count": int(world_state.get("entity_count", 0) or 0),
        "kind_set": list(world_state.get("kind_set") or []),
        "avg_confidence": world_state.get("avg_confidence"),
        "max_confidence": world_state.get("max_confidence"),
        "low_confidence_entities": list(world_state.get("low_confidence_entities") or []),
        "runtime_controls": {
            "verification_mode": applied.get("verification_mode"),
            "same_tick_drain": applied.get("same_tick_drain"),
        },
    }



def runtime_modulation_summary(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    metadata = dict(workflow_metadata or {})
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    modulation = policy.get("modulation") if isinstance(policy.get("modulation"), dict) else {}
    profile = modulation.get("profile") if isinstance(modulation.get("profile"), dict) else {}
    state = modulation.get("state") if isinstance(modulation.get("state"), dict) else {}
    if not modulation:
        return {"enabled": False}
    applied = workflow_policy_settings(workflow_metadata)
    return {
        "enabled": bool(modulation.get("enabled")),
        "tempo": profile.get("tempo"),
        "reasoning_depth": profile.get("reasoning_depth"),
        "deep_reasoning_required": bool(profile.get("deep_reasoning_required")),
        "focus_gain": state.get("focus_gain"),
        "learning_gain": state.get("learning_gain"),
        "runtime_controls": {
            "max_parallelism": applied.get("max_parallelism"),
            "same_tick_drain": applied.get("same_tick_drain"),
            "step_timeout_seconds": applied.get("step_timeout_seconds"),
        },
    }



def runtime_workspace_summary(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    metadata = dict(workflow_metadata or {})
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    workspace = policy.get("workspace") if isinstance(policy.get("workspace"), dict) else {}
    if not workspace:
        return {"enabled": False}
    applied = workflow_policy_settings(workflow_metadata)
    return {
        "enabled": bool(workspace.get("enabled")),
        "selected": workspace.get("selected"),
        "broadcast_count": int(workspace.get("broadcast_count", 0) or 0),
        "broadcast_topics": [str(row.get("topic") or "") for row in (workspace.get("broadcast_payload") or []) if isinstance(row, dict) and str(row.get("topic") or "").strip()],
        "runtime_controls": {
            "same_tick_drain": applied.get("same_tick_drain"),
            "execution_mode": applied.get("execution_mode"),
        },
    }



def runtime_truth_engine_summary(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    metadata = dict(workflow_metadata or {})
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    truth_engine = policy.get("truth_engine") if isinstance(policy.get("truth_engine"), dict) else {}
    if not truth_engine:
        return {"enabled": False}
    applied = workflow_policy_settings(workflow_metadata)
    return {
        "enabled": bool(truth_engine.get("enabled")),
        "guard_action": truth_engine.get("guard_action"),
        "calibrated_confidence": truth_engine.get("calibrated_confidence"),
        "contradiction_count": truth_engine.get("contradiction_count"),
        "runtime_controls": {
            "verification_mode": applied.get("verification_mode"),
            "same_tick_drain": applied.get("same_tick_drain"),
            "max_parallelism": applied.get("max_parallelism"),
        },
    }



def runtime_plasticity_summary(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    metadata = dict(workflow_metadata or {})
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    plasticity = policy.get("plasticity") if isinstance(policy.get("plasticity"), dict) else {}
    metrics = plasticity.get("metrics") if isinstance(plasticity.get("metrics"), dict) else {}
    if not plasticity:
        return {"enabled": False}
    applied = workflow_policy_settings(workflow_metadata)
    return {
        "enabled": bool(plasticity.get("enabled")),
        "alert": bool(plasticity.get("alert")),
        "rollback_recommended": bool(plasticity.get("rollback_recommended")),
        "reasons": list(plasticity.get("reasons") or []),
        "retention_regression_after_update": metrics.get("retention_regression_after_update"),
        "forward_transfer_gain": metrics.get("forward_transfer_gain"),
        "runtime_controls": {
            "same_tick_drain": applied.get("same_tick_drain"),
            "max_parallelism": applied.get("max_parallelism"),
        },
    }



def runtime_embodiment_summary(workflow_metadata: Optional[JsonDict]) -> JsonDict:
    metadata = dict(workflow_metadata or {})
    policy = metadata.get("policy") if isinstance(metadata.get("policy"), dict) else {}
    embodiment = policy.get("embodiment") if isinstance(policy.get("embodiment"), dict) else {}
    regulation = embodiment.get("regulation") if isinstance(embodiment.get("regulation"), dict) else {}
    if not embodiment:
        return {"enabled": False}
    applied = workflow_policy_settings(workflow_metadata)
    return {
        "enabled": bool(embodiment.get("enabled")),
        "risk": embodiment.get("risk"),
        "pause_noncritical_work": bool(embodiment.get("pause_noncritical_work")),
        "regulation_mode": regulation.get("mode"),
        "runtime_controls": {
            "execution_mode": applied.get("execution_mode"),
            "max_parallelism": applied.get("max_parallelism"),
            "same_tick_drain": applied.get("same_tick_drain"),
            "verification_mode": applied.get("verification_mode"),
            "step_timeout_seconds": applied.get("step_timeout_seconds"),
        },
    }



def cancelled_step_result(step: JsonDict, *, step_index: int, reason: str) -> JsonDict:
    step_id = str(step.get("node_id") or f"step_{step_index}")
    return {
        "step": step_index,
        "node_id": step_id,
        "title": step.get("title") or step_id,
        "endpoint": step.get("endpoint"),
        "method": str(step.get("method") or "POST").upper(),
        "request": {
            "payload": step.get("payload", {}),
            "headers": {},
            "timeout_s": step.get("timeout_seconds"),
        },
        "status_code": None,
        "response": None,
        "error": reason,
        "error_code": reason,
        "elapsed_ms": 0.0,
        "success": False,
        "cancelled": True,
    }



def step_retry_settings(step: JsonDict, workflow_metadata: Optional[JsonDict]) -> JsonDict:
    policy_settings = workflow_policy_settings(workflow_metadata)
    return retry_settings(step, policy_settings)



def retry_result_matches_policy(result: JsonDict, retry_settings: JsonDict) -> bool:
    is_timeout = str(result.get("error_type") or "") == "timeout" or str(result.get("error") or "").startswith("timeout:")
    if is_timeout and not bool(retry_settings.get("retry_on_timeout", True)):
        return False

    status_filters = [int(x) for x in (retry_settings.get("retry_on_status_codes") or []) if str(x).strip()]
    error_filters = [str(x).lower() for x in (retry_settings.get("retry_on_error_types") or []) if str(x).strip()]

    if not status_filters and not error_filters:
        return True

    status_code = result.get("status_code")
    error_type = str(result.get("error_type") or ("timeout" if is_timeout else "")).lower().strip()

    status_ok = True if not status_filters else (status_code is not None and int(status_code) in status_filters)
    error_ok = True if not error_filters else (bool(error_type) and error_type in error_filters)
    return status_ok and error_ok


async def execute_single_step(
    client: httpx.AsyncClient,
    step: JsonDict,
    *,
    step_index: int,
    results_by_node: Dict[str, JsonDict],
    workflow_metadata: Optional[JsonDict] = None,
    base_url: str,
    max_step_response_chars: int,
    step_timeout_max_s: float,
    redact_headers_fn: RedactHeadersFn,
    validate_endpoint_fn: ValidateEndpointFn,
    payload_size_ok_fn: PayloadSizeOkFn,
    step_belief_context_fn: StepBeliefContextFn,
) -> JsonDict:
    step_id = str(step.get("node_id") or f"step_{step_index}")
    url = f"{base_url}{step['endpoint']}"
    method = str(step.get("method") or "POST").upper()
    payload = step.get("payload", {})
    headers = step.get("headers", {})
    step_timeout = effective_step_timeout(step, workflow_metadata, step_timeout_max_s=step_timeout_max_s)
    policy_settings = workflow_policy_settings(workflow_metadata)
    routing_summary = runtime_routing_summary(workflow_metadata)
    homeostasis_summary = runtime_homeostasis_summary(workflow_metadata)
    world_state_summary = runtime_world_state_summary(workflow_metadata)
    modulation_summary = runtime_modulation_summary(workflow_metadata)
    workspace_summary = runtime_workspace_summary(workflow_metadata)
    truth_engine_summary = runtime_truth_engine_summary(workflow_metadata)
    plasticity_summary = runtime_plasticity_summary(workflow_metadata)
    embodiment_summary = runtime_embodiment_summary(workflow_metadata)

    validate_endpoint_fn(step.get("endpoint", ""))

    belief_context = step_belief_context_fn(step, workflow_metadata)
    compact_belief_context = {
        "task_id": belief_context.get("task_id"),
        "selected_ids": belief_context.get("selected_ids"),
        "selected_count": len(belief_context.get("selected_ids") or []),
        "filters": belief_context.get("filters"),
    }
    request_view = {"payload": payload, "headers": redact_headers_fn(headers), "timeout_s": step_timeout}
    phase_runtime_summaries = {
        "routing": routing_summary,
        "homeostasis": homeostasis_summary,
        "world_state": world_state_summary,
        "modulation": modulation_summary,
        "workspace": workspace_summary,
        "truth_engine": truth_engine_summary,
        "plasticity": plasticity_summary,
        "embodiment": embodiment_summary,
    }

    # Approval digests bind the payload that will actually reach the sink, not
    # an authored template that can resolve to a different recipient/target.
    try:
        resolved_payload = render_plan_templates(payload, results_by_node)
        if resolved_payload not in (None, {}) and not payload_size_ok_fn(resolved_payload):
            raise ValueError("payload too large")
    except Exception as exc:  # noqa: BLE001
        return {
            "step": step_index,
            "node_id": step_id,
            "title": step.get("title") or step_id,
            "endpoint": step["endpoint"],
            "method": method,
            "request": request_view,
            "status_code": None,
            "response": None,
            "error": str(exc)[:300],
            "policy": policy_settings,
            "belief_context": compact_belief_context,
            "elapsed_ms": 0.0,
            "success": False,
            **phase_runtime_summaries,
        }
    resolved_step = dict(step)
    resolved_step["payload"] = resolved_payload
    safety = evaluate_step_permission(resolved_step, workflow_metadata=workflow_metadata or {})
    request_view = {"payload": resolved_payload, "headers": redact_headers_fn(headers), "timeout_s": step_timeout}

    def safety_block_result(decision: JsonDict) -> JsonDict:
        return {
            "step": step_index,
            "node_id": step_id,
            "title": step.get("title") or step_id,
            "endpoint": step["endpoint"],
            "method": method,
            "request": request_view,
            "status_code": None,
            "response": None,
            "error": f"safety_block:{decision.get('reason')}",
            "policy": policy_settings,
            "belief_context": compact_belief_context,
            "safety": decision,
            "elapsed_ms": 0.0,
            "success": False,
            **phase_runtime_summaries,
        }

    if not bool(safety.get("allow")):
        return safety_block_result(safety)

    blocked_by = dependency_failures(step, results_by_node)
    if blocked_by:
        return {
            "step": step_index,
            "node_id": step_id,
            "title": step.get("title") or step_id,
            "endpoint": step["endpoint"],
            "method": method,
            "request": request_view,
            "status_code": None,
            "response": None,
            "error": f"blocked_by_failed_dependencies:{','.join(blocked_by)}",
            "blocked_by": blocked_by,
            "policy": policy_settings,
            "belief_context": compact_belief_context,
            "safety": safety,
            "elapsed_ms": 0.0,
            "success": False,
            **phase_runtime_summaries,
        }

    contracts = list(step.get("contracts") or [])
    if bool(policy_settings.get("strict_requires_contracts")) and str(policy_settings.get("verification_mode") or "basic") == "strict" and not contracts:
        return {
            "step": step_index,
            "node_id": step_id,
            "title": step.get("title") or step_id,
            "endpoint": step["endpoint"],
            "method": method,
            "request": request_view,
            "status_code": None,
            "response": None,
            "error": "policy_requires_contracts",
            "error_code": "policy_requires_contracts",
            "verification": {"pre": {"ok": False, "count": 0, "results": []}, "post": {"ok": False, "count": 0, "results": []}},
            "policy": policy_settings,
            "belief_context": compact_belief_context,
            "safety": safety,
            "elapsed_ms": 0.0,
            "success": False,
            **phase_runtime_summaries,
        }

    pre_verification = evaluate_contracts(
        contracts,
        stage="pre",
        step=resolved_step,
        workflow_metadata=workflow_metadata or {},
        results_by_node=results_by_node,
    )
    if not bool(pre_verification.get("ok", True)):
        return {
            "step": step_index,
            "node_id": step_id,
            "title": step.get("title") or step_id,
            "endpoint": step["endpoint"],
            "method": method,
            "request": request_view,
            "status_code": None,
            "response": None,
            "error": "pre_verification_failed",
            "error_code": "pre_verification_failed",
            "verification": {"pre": pre_verification, "post": {"ok": True, "count": 0, "results": []}},
            "policy": policy_settings,
            "belief_context": compact_belief_context,
            "safety": safety,
            "elapsed_ms": 0.0,
            "success": False,
            **phase_runtime_summaries,
        }

    # One-use approvals are consumed atomically only after dependencies and
    # preconditions pass, immediately before the sensitive HTTP sink.
    if bool(safety.get("approval_required")):
        consumed_safety = evaluate_step_permission(
            resolved_step,
            workflow_metadata=workflow_metadata or {},
            consume_approval=True,
        )
        if not bool(consumed_safety.get("allow")):
            return safety_block_result(consumed_safety)
        safety = consumed_safety

    t0 = time.monotonic()
    try:
        if method == "GET":
            resp = await client.get(url, params=resolved_payload, headers=headers, timeout=step_timeout)
        else:
            resp = await client.post(url, json=resolved_payload, headers=headers, timeout=step_timeout)

        elapsed = round((time.monotonic() - t0) * 1000, 1)
        try:
            body = resp.json()
        except Exception:
            body = resp.text or ""

        result = {
            "step": step_index,
            "node_id": step_id,
            "title": step.get("title") or step_id,
            "endpoint": step["endpoint"],
            "method": method,
            "request": {"payload": resolved_payload, "headers": redact_headers_fn(headers), "timeout_s": step_timeout},
            "status_code": resp.status_code,
            "response": trim_response_body(body, max_chars=max_step_response_chars),
            "elapsed_ms": elapsed,
            "success": 200 <= resp.status_code < 400,
            "policy": policy_settings,
            "belief_context": compact_belief_context,
            "safety": safety,
            **phase_runtime_summaries,
        }
        post_verification = evaluate_contracts(
            contracts,
            stage="post",
            step=resolved_step,
            workflow_metadata=workflow_metadata or {},
            results_by_node=results_by_node,
            response=result,
        )
        result["verification"] = {"pre": pre_verification, "post": post_verification}
        result["policy"] = policy_settings
        if not bool(post_verification.get("ok", True)):
            result["success"] = False
            result["error"] = "post_verification_failed"
        return result
    except httpx.TimeoutException as exc:
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        return {
            "step": step_index,
            "node_id": step_id,
            "title": step.get("title") or step_id,
            "endpoint": step["endpoint"],
            "method": method,
            "request": request_view,
            "status_code": None,
            "response": None,
            "error": f"timeout:{type(exc).__name__}",
            "error_type": "timeout",
            "error_code": "timeout",
            "verification": {"pre": pre_verification, "post": {"ok": False, "count": 0, "results": []}},
            "policy": policy_settings,
            "belief_context": compact_belief_context,
            "safety": safety,
            "elapsed_ms": elapsed,
            "success": False,
            **phase_runtime_summaries,
        }
    except Exception as exc:
        elapsed = round((time.monotonic() - t0) * 1000, 1)
        return {
            "step": step_index,
            "node_id": step_id,
            "title": step.get("title") or step_id,
            "endpoint": step["endpoint"],
            "method": method,
            "request": request_view,
            "status_code": None,
            "response": None,
            "error": str(exc)[:300],
            "verification": {"pre": pre_verification, "post": {"ok": False, "count": 0, "results": []}},
            "policy": policy_settings,
            "belief_context": compact_belief_context,
            "safety": safety,
            "elapsed_ms": elapsed,
            "success": False,
            **phase_runtime_summaries,
        }



def workflow_deadline_at(workflow_metadata: Optional[JsonDict], *, started_at: Optional[datetime] = None) -> Optional[datetime]:
    metadata = dict(workflow_metadata or {})
    policy_settings = workflow_policy_settings(workflow_metadata)
    raw = policy_settings.get("workflow_deadline_seconds", metadata.get("workflow_deadline_seconds"))
    try:
        seconds = float(raw) if raw is not None else 0.0
    except Exception:
        seconds = 0.0
    if seconds <= 0:
        return None
    base = started_at or datetime.now(timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    return base.astimezone(timezone.utc) + timedelta(seconds=seconds)



def remaining_deadline_seconds(deadline_at: Optional[datetime]) -> Optional[float]:
    if deadline_at is None:
        return None
    normalized = deadline_at
    if normalized.tzinfo is None:
        normalized = normalized.replace(tzinfo=timezone.utc)
    return max(
        0.0,
        (normalized.astimezone(timezone.utc) - datetime.now(timezone.utc)).total_seconds(),
    )



def deadline_exceeded(deadline_at: Optional[datetime]) -> bool:
    remaining = remaining_deadline_seconds(deadline_at)
    return remaining is not None and remaining <= 0.0



def _step_with_remaining_deadline(
    step: JsonDict, deadline_at: Optional[datetime]
) -> JsonDict:
    remaining = remaining_deadline_seconds(deadline_at)
    if remaining is None:
        return step
    bounded = dict(step)
    bounded["_remaining_workflow_budget_seconds"] = remaining
    return bounded



def deadline_result(step: JsonDict, *, step_index: int, deadline_at: Optional[datetime], redact_headers_fn: RedactHeadersFn) -> JsonDict:
    return {
        "step": step_index,
        "node_id": str(step.get("node_id") or f"step_{step_index}"),
        "title": step.get("title") or str(step.get("node_id") or f"step_{step_index}"),
        "endpoint": step.get("endpoint"),
        "method": str(step.get("method") or "POST").upper(),
        "request": {"payload": step.get("payload", {}), "headers": redact_headers_fn(step.get("headers", {})), "timeout_s": step.get("timeout_seconds")},
        "status_code": None,
        "response": None,
        "error": "workflow_deadline_exceeded",
        "error_type": "deadline",
        "deadline_at": deadline_at.isoformat() if deadline_at else None,
        "elapsed_ms": 0.0,
        "success": False,
        "cancelled": True,
    }



def compensation_steps(step: JsonDict) -> List[JsonDict]:
    metadata = step.get("metadata") if isinstance(step.get("metadata"), dict) else {}
    raw = metadata.get("compensation")
    if isinstance(raw, dict):
        return [dict(raw)]
    if isinstance(raw, list):
        return [dict(item) for item in raw if isinstance(item, dict)]
    return []


async def execute_compensation_steps(
    client: httpx.AsyncClient,
    step: JsonDict,
    *,
    step_index: int,
    results_by_node: Dict[str, JsonDict],
    workflow_metadata: Optional[JsonDict] = None,
    execute_single_step_fn: ExecuteSingleStepFn,
) -> JsonDict:
    compensation_results: List[JsonDict] = []
    for idx, comp in enumerate(compensation_steps(step), start=1):
        comp_step = dict(comp)
        comp_step.setdefault("node_id", f"{step.get('node_id') or 'step'}:compensate:{idx}")
        comp_step.setdefault("title", f"Compensate {step.get('title') or step.get('node_id') or 'step'}")
        comp_step.setdefault("method", "POST")
        comp_step["failure_mode"] = "continue"
        md = dict(comp_step.get("metadata") or {})
        md.pop("compensation", None)
        md["is_compensation"] = True
        comp_step["metadata"] = md
        result = await execute_single_step_fn(
            client,
            comp_step,
            step_index=step_index,
            results_by_node=results_by_node,
            workflow_metadata=workflow_metadata,
        )
        compensation_results.append(result)
    return {
        "triggered": bool(compensation_results),
        "success": all(bool(r.get("success")) for r in compensation_results) if compensation_results else False,
        "results": compensation_results,
    }


async def execute_step_with_retry(
    client: httpx.AsyncClient,
    step: JsonDict,
    *,
    step_index: int,
    results_by_node: Dict[str, JsonDict],
    workflow_metadata: Optional[JsonDict] = None,
    deadline_at: Optional[datetime] = None,
    execute_single_step_fn: ExecuteSingleStepFn,
    step_belief_context_fn: StepBeliefContextFn,
    redact_headers_fn: RedactHeadersFn,
) -> JsonDict:
    retry_settings = step_retry_settings(step, workflow_metadata)
    max_attempts = int(retry_settings.get("max_attempts", 1) or 1)
    backoff = float(retry_settings.get("retry_backoff_seconds", 0.0) or 0.0)
    max_cumulative_backoff = float(
        retry_settings.get("max_cumulative_retry_backoff_seconds", 0.0) or 0.0
    )
    attempts = 0
    cumulative_backoff = 0.0
    last_result: Optional[JsonDict] = None

    def deadline_outcome() -> JsonDict:
        outcome = deadline_result(
            step,
            step_index=step_index,
            deadline_at=deadline_at,
            redact_headers_fn=redact_headers_fn,
        )
        outcome["policy"] = workflow_policy_settings(workflow_metadata)
        outcome["homeostasis"] = runtime_homeostasis_summary(workflow_metadata)
        outcome["attempts"] = attempts
        outcome["max_attempts"] = max_attempts
        outcome["retry_count"] = max(0, attempts)
        outcome["cumulative_retry_backoff_seconds"] = cumulative_backoff
        return outcome

    while attempts < max_attempts:
        if deadline_exceeded(deadline_at):
            return deadline_outcome()
        attempts += 1
        attempt_step = _step_with_remaining_deadline(step, deadline_at)
        result = await execute_single_step_fn(
            client,
            attempt_step,
            step_index=step_index,
            results_by_node=results_by_node,
            workflow_metadata=workflow_metadata,
        )
        if not isinstance(result.get("belief_context"), dict):
            backfilled_context = step_belief_context_fn(step, workflow_metadata)
            result["belief_context"] = {
                "task_id": backfilled_context.get("task_id"),
                "selected_ids": backfilled_context.get("selected_ids"),
                "selected_count": len(backfilled_context.get("selected_ids") or []),
                "filters": backfilled_context.get("filters"),
            }
        if not isinstance(result.get("policy"), dict):
            result["policy"] = workflow_policy_settings(workflow_metadata)
        if not isinstance(result.get("routing"), dict):
            result["routing"] = runtime_routing_summary(workflow_metadata)
        if not isinstance(result.get("homeostasis"), dict):
            result["homeostasis"] = runtime_homeostasis_summary(workflow_metadata)
        if not isinstance(result.get("world_state"), dict):
            result["world_state"] = runtime_world_state_summary(workflow_metadata)
        if not isinstance(result.get("modulation"), dict):
            result["modulation"] = runtime_modulation_summary(workflow_metadata)
        if not isinstance(result.get("workspace"), dict):
            result["workspace"] = runtime_workspace_summary(workflow_metadata)
        if not isinstance(result.get("truth_engine"), dict):
            result["truth_engine"] = runtime_truth_engine_summary(workflow_metadata)
        if not isinstance(result.get("plasticity"), dict):
            result["plasticity"] = runtime_plasticity_summary(workflow_metadata)
        if not isinstance(result.get("embodiment"), dict):
            result["embodiment"] = runtime_embodiment_summary(workflow_metadata)
        result = enrich_failure(result)
        result["attempts"] = attempts
        result["max_attempts"] = max_attempts
        result["retry_backoff_seconds"] = backoff
        result["cumulative_retry_backoff_seconds"] = cumulative_backoff
        if bool(result.get("success")):
            result["retry_count"] = max(0, attempts - 1)
            return result
        can_retry = str(step.get("failure_mode") or "continue") == "retry" and attempts < max_attempts and retry_result_matches_policy(result, retry_settings)
        if not can_retry:
            if str(step.get("failure_mode") or "continue") == "compensate":
                result["compensation"] = await execute_compensation_steps(
                    client,
                    step,
                    step_index=step_index,
                    results_by_node=results_by_node,
                    workflow_metadata=workflow_metadata,
                    execute_single_step_fn=execute_single_step_fn,
                )
            result["retry_count"] = max(0, attempts - 1)
            return result
        last_result = result
        if backoff > 0:
            remaining = remaining_deadline_seconds(deadline_at)
            if remaining is not None and remaining <= 0.0:
                return deadline_outcome()
            sleep_for = backoff if remaining is None else min(backoff, remaining)
            cumulative_remaining = max(0.0, max_cumulative_backoff - cumulative_backoff)
            sleep_for = min(sleep_for, cumulative_remaining)
            if sleep_for <= 0.0:
                break
            deadline_truncated = remaining is not None and sleep_for < backoff
            await asyncio.sleep(sleep_for)
            cumulative_backoff += sleep_for
            if deadline_truncated:
                return deadline_outcome()

    final = dict(last_result or deadline_result(step, step_index=step_index, deadline_at=deadline_at, redact_headers_fn=redact_headers_fn))
    final["attempts"] = attempts
    final["max_attempts"] = max_attempts
    final["retry_count"] = max(0, attempts - 1)
    final["cumulative_retry_backoff_seconds"] = cumulative_backoff
    return final


async def execute_workflow(
    workflow: JsonDict,
    *,
    execute_step_with_retry_fn: ExecuteStepWithRetryFn,
    workflow_policy_settings_fn: Optional[WorkflowPolicySettingsFn] = None,
    cancelled_step_result_fn: Optional[Callable[..., JsonDict]] = None,
    redact_headers_fn: RedactHeadersFn,
) -> JsonDict:
    execution_id = f"exec_{uuid.uuid4().hex[:8]}"
    results_by_node: Dict[str, JsonDict] = {}
    step_results: List[JsonDict] = []
    overall_status = "success"
    started_at_dt = datetime.now(timezone.utc)
    started_at = started_at_dt.isoformat()
    workflow_metadata = workflow.get("metadata") or {}
    policy_settings_getter = workflow_policy_settings_fn or workflow_policy_settings
    policy_settings = policy_settings_getter(workflow_metadata)
    execution_mode = str(policy_settings.get("execution_mode") or "sequential")
    max_parallelism = max(1, int(policy_settings.get("max_parallelism", 1) or 1))
    if not bool(policy_settings.get("enforce_policy", True)):
        execution_mode = "sequential"
        max_parallelism = 1
    deadline_at = workflow_deadline_at(workflow_metadata, started_at=started_at_dt)
    steps = list(workflow.get("steps") or [])
    pending = {str((step or {}).get("node_id") or f"step_{idx}"): (idx, dict(step)) for idx, step in enumerate(steps, start=1)}
    cancelled_step = cancelled_step_result_fn or cancelled_step_result

    async with httpx.AsyncClient(timeout=30.0) as client:
        while pending:
            if deadline_exceeded(deadline_at):
                overall_status = "partial_failure"
                for node_id, (idx, step) in list(pending.items()):
                    cancelled = deadline_result(step, step_index=idx, deadline_at=deadline_at, redact_headers_fn=redact_headers_fn)
                    step_results.append(cancelled)
                    results_by_node[str(cancelled.get("node_id") or f"step_{idx}")] = cancelled
                    del pending[node_id]
                break

            ready: List[Tuple[int, JsonDict]] = []
            for node_id, (idx, step) in pending.items():
                deps = [str(x) for x in (step.get("depends_on") or []) if str(x).strip()]
                if any(dep not in results_by_node for dep in deps):
                    continue
                ready.append((idx, step))
            if not ready:
                overall_status = "partial_failure"
                for node_id, (idx, step) in list(pending.items()):
                    cancelled = cancelled_step(step, step_index=idx, reason="blocked_due_to_unmet_dependencies")
                    step_results.append(cancelled)
                    results_by_node[str(cancelled.get("node_id") or f"step_{idx}")] = cancelled
                    del pending[node_id]
                break

            ready.sort(key=lambda item: item[0])
            while ready:
                if deadline_exceeded(deadline_at):
                    overall_status = "partial_failure"
                    for node_id, (idx, step) in list(pending.items()):
                        cancelled = deadline_result(step, step_index=idx, deadline_at=deadline_at, redact_headers_fn=redact_headers_fn)
                        step_results.append(cancelled)
                        results_by_node[str(cancelled.get("node_id") or f"step_{idx}")] = cancelled
                        del pending[node_id]
                    ready = []
                    break
                batch = ready[: max_parallelism if execution_mode == "parallel" else 1]
                ready = ready[len(batch):]
                coros = [
                    execute_step_with_retry_fn(
                        client,
                        step,
                        step_index=idx,
                        results_by_node=dict(results_by_node),
                        workflow_metadata=workflow_metadata,
                        deadline_at=deadline_at,
                    )
                    for idx, step in batch
                ]
                batch_results = await asyncio.gather(*coros)
                halt_triggered = False
                for (idx, step), step_result in zip(batch, batch_results):
                    node_key = str(step_result.get("node_id") or f"step_{idx}")
                    step_results.append(step_result)
                    results_by_node[node_key] = step_result
                    pending.pop(node_key, None)
                    if not bool(step_result.get("success")):
                        overall_status = "partial_failure"
                        if str(step.get("failure_mode") or "continue") == "halt":
                            halt_triggered = True
                if halt_triggered:
                    for node_id, (idx, step) in list(pending.items()):
                        cancelled = cancelled_step(step, step_index=idx, reason="cancelled_due_to_halt")
                        step_results.append(cancelled)
                        results_by_node[str(cancelled.get("node_id") or f"step_{idx}")] = cancelled
                        del pending[node_id]
                    ready = []
                    break

    return {
        "execution_id": execution_id,
        "status": overall_status,
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "deadline_at": deadline_at.isoformat() if deadline_at else None,
        "steps": sorted(step_results, key=lambda row: int(row.get("step") or 0)),
        "results_by_node": results_by_node,
        "total_steps": len(step_results),
        "successful_steps": sum(1 for s in step_results if s.get("success")),
    }


__all__ = [
    "cancelled_step_result",
    "compensation_steps",
    "deadline_exceeded",
    "deadline_result",
    "effective_step_timeout",
    "execute_compensation_steps",
    "execute_single_step",
    "execute_step_with_retry",
    "execute_workflow",
    "remaining_deadline_seconds",
    "retry_result_matches_policy",
    "runtime_homeostasis_summary",
    "runtime_routing_summary",
    "runtime_world_state_summary",
    "runtime_modulation_summary",
    "runtime_workspace_summary",
    "runtime_truth_engine_summary",
    "runtime_plasticity_summary",
    "runtime_embodiment_summary",
    "step_retry_settings",
    "trim_response_body",
    "workflow_deadline_at",
    "workflow_policy_settings",
]
