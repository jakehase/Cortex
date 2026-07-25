from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

from cortex_server.modules.reasoning_approvals import grant_allows_step
from cortex_server.modules.reasoning_safety import evaluate_step_permission


ContractStage = Literal["pre", "post", "any"]
ContractKind = Literal[
    "dependency_success",
    "response_status",
    "response_path_exists",
    "response_path_equals",
    "approval_required",
]


class VerificationContract(BaseModel):
    contract_id: str = Field(default_factory=lambda: f"vc_{uuid4().hex[:10]}")
    stage: ContractStage = "post"
    kind: ContractKind
    description: str = ""
    target_node: Optional[str] = None
    path: Optional[str] = None
    expected: Any = None
    status_codes: List[int] = Field(default_factory=list)
    approval_scope: str = "workflow"
    required: bool = True


class VerificationResult(BaseModel):
    contract_id: str
    kind: str
    passed: bool
    stage: str
    reason: str = ""
    observed: Any = None
    required: bool = True


def _extract_path(value: Any, path: Optional[str]) -> Any:
    if not path:
        return value
    current = value
    for raw in [seg for seg in str(path).split(".") if seg != ""]:
        if isinstance(current, dict):
            if raw not in current:
                raise KeyError(path)
            current = current[raw]
        elif isinstance(current, (list, tuple)):
            idx = int(raw)
            current = current[idx]
        else:
            raise KeyError(path)
    return current


def normalize_contracts(items: List[Dict[str, Any]] | List[VerificationContract] | None) -> List[VerificationContract]:
    out: List[VerificationContract] = []
    for item in items or []:
        if isinstance(item, VerificationContract):
            out.append(item)
        elif isinstance(item, dict):
            out.append(VerificationContract(**item))
    return out


def evaluate_contracts(
    contracts: List[Dict[str, Any]] | List[VerificationContract] | None,
    *,
    stage: ContractStage,
    step: Optional[Dict[str, Any]] = None,
    workflow_metadata: Optional[Dict[str, Any]] = None,
    results_by_node: Optional[Dict[str, Dict[str, Any]]] = None,
    response: Optional[Dict[str, Any]] = None,
    user_id: Any = None,
    role: Any = None,
    approved: Any = None,
) -> Dict[str, Any]:
    normalized = [c for c in normalize_contracts(contracts) if c.stage in {stage, "any"}]
    results: List[Dict[str, Any]] = []
    overall = True
    response = response or {}
    results_by_node = results_by_node or {}
    workflow_metadata = dict(workflow_metadata or {})
    step = dict(step or {})

    for contract in normalized:
        passed = True
        reason = ""
        observed: Any = None
        try:
            if contract.kind == "dependency_success":
                target = str(contract.target_node or "")
                dep = results_by_node.get(target) or {}
                observed = {"target_node": target, "success": bool(dep.get("success"))}
                passed = bool(dep.get("success"))
                reason = f"dependency {target} {'ok' if passed else 'not_successful'}"
            elif contract.kind == "response_status":
                observed = response.get("status_code")
                allowed = set(int(x) for x in (contract.status_codes or [])) or {200}
                passed = int(response.get("status_code") or 0) in allowed
                reason = f"status_code={observed} allowed={sorted(allowed)}"
            elif contract.kind == "response_path_exists":
                observed = _extract_path(response.get("response"), contract.path)
                passed = observed is not None
                reason = f"path_exists:{contract.path}"
            elif contract.kind == "response_path_equals":
                observed = _extract_path(response.get("response"), contract.path)
                passed = observed == contract.expected
                reason = f"path_equals:{contract.path}"
            elif contract.kind == "approval_required":
                contract_step = step
                risk = evaluate_step_permission(contract_step, workflow_metadata=workflow_metadata)["risk"]
                approval_grant = grant_allows_step(
                    contract_step,
                    workflow_metadata=workflow_metadata,
                    risk=risk,
                    required_scope=contract.approval_scope,
                )
                grant_metadata = (
                    approval_grant.get("metadata")
                    if approval_grant and isinstance(approval_grant.get("metadata"), dict)
                    else {}
                )
                caller_role = role.strip() if isinstance(role, str) else ""
                authorized_role = str(grant_metadata.get("role") or "").strip()
                authorized = bool(
                    approval_grant
                    and (not authorized_role or (caller_role and caller_role == authorized_role))
                )
                observed = {
                    "approval_scope": contract.approval_scope,
                    "approval_grant_id": approval_grant.get("grant_id") if approval_grant else None,
                }
                passed = authorized
                reason = f"approval_scope={contract.approval_scope}"
        except Exception as exc:  # noqa: BLE001
            passed = False
            reason = f"contract_error:{type(exc).__name__}:{exc}"
        if contract.required and not passed:
            overall = False
        results.append(
            VerificationResult(
                contract_id=contract.contract_id,
                kind=contract.kind,
                passed=passed,
                stage=contract.stage,
                reason=reason,
                observed=observed,
                required=contract.required,
            ).model_dump()
        )

    return {
        "ok": overall,
        "count": len(results),
        "results": results,
    }


__all__ = [
    "VerificationContract",
    "VerificationResult",
    "evaluate_contracts",
    "normalize_contracts",
]
