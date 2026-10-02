"""Autonomy Governor Router.

Cortex-native API wrapper around the Autonomy Governor engine used to
manage dynamic risk budgets for OpenClaw cron automation.
"""

from __future__ import annotations

import json
import hashlib
import re
import subprocess
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
    require_action_capability,
)

router = APIRouter(tags=["AutonomyGovernor"])

ENGINE_SCRIPT = "/root/.openclaw/workspace/tools/autonomy_governor.py"
_SAFE_ENGINE_ENUM_FIELDS = frozenset({"band", "mode", "state", "status", "type"})
_SAFE_ENGINE_ENUM_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,63}$")


def _sanitize_engine_result(value: Any) -> Any:
    """Allowlist operational scalars while fingerprinting arbitrary tool text."""

    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for raw_key, child in list(value.items())[:256]:
            key = str(raw_key)
            normalized = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
            if isinstance(child, str):
                if (
                    normalized in _SAFE_ENGINE_ENUM_FIELDS
                    and _SAFE_ENGINE_ENUM_RE.fullmatch(child)
                ):
                    out[key] = child
                else:
                    encoded = child.encode("utf-8", errors="replace")
                    out[key] = "[REDACTED]"
                    out[f"{key}_sha256"] = hashlib.sha256(encoded).hexdigest()
                    out[f"{key}_bytes"] = len(encoded)
            else:
                out[key] = _sanitize_engine_result(child)
        return out
    if isinstance(value, list):
        return [_sanitize_engine_result(item) for item in value[:256]]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    rendered = str(value)
    encoded = rendered.encode("utf-8", errors="replace")
    return {
        "value": "[REDACTED]",
        "value_sha256": hashlib.sha256(encoded).hexdigest(),
        "value_bytes": len(encoded),
    }


class EvaluateRequest(BaseModel):
    forceBand: Optional[str] = Field(default=None, description="GREEN|YELLOW|RED")
    maxChanges: Optional[int] = Field(default=None, ge=0, le=50)


class ExecuteRequest(BaseModel):
    forceBand: Optional[str] = Field(default=None, description="GREEN|YELLOW|RED")
    maxChanges: Optional[int] = Field(default=None, ge=0, le=50)


class RollbackRequest(BaseModel):
    snapshotId: Optional[str] = None


class PolicyPatchRequest(BaseModel):
    patch: Dict[str, Any]


def _run_engine(
    args: list[str],
    timeout: int = 90,
    *,
    authorization: Optional[ActionAuthorization] = None,
    action_required: bool = False,
) -> Dict[str, Any]:
    if action_required:
        assert_action_authorized(authorization)
    cmd = ["python3", ENGINE_SCRIPT] + args
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise HTTPException(
            status_code=504,
            detail=f"governor engine timeout ({type(e).__name__})",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"governor engine execution failed ({type(e).__name__})",
        )

    if proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"governor engine failed with exit code {int(proc.returncode)}",
        )

    try:
        return _sanitize_engine_result(json.loads(proc.stdout))
    except Exception:
        raise HTTPException(status_code=500, detail="governor engine produced non-JSON output")


@router.get("/status")
async def status() -> Dict[str, Any]:
    """Current governor state + preview."""
    return _run_engine(["status"], timeout=60)


@router.get("/policy")
async def policy_get() -> Dict[str, Any]:
    """Read active governor policy."""
    return _run_engine(["policy_get"], timeout=60)


@router.post("/policy/apply")
async def policy_apply(
    req: PolicyPatchRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> Dict[str, Any]:
    """Patch governor policy (deep-merge)."""
    raise HTTPException(
        status_code=503,
        detail="governor mutation requires child-process action enforcement",
    )


@router.post("/evaluate")
async def evaluate(req: EvaluateRequest) -> Dict[str, Any]:
    """Dry-run evaluation: compute band and proposed actions only."""
    args = ["evaluate"]
    if req.forceBand:
        args.extend(["--force-band", req.forceBand.upper()])
    if req.maxChanges is not None:
        args.extend(["--max-changes", str(req.maxChanges)])
    return _run_engine(args, timeout=90)


@router.post("/execute")
async def execute(
    req: ExecuteRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> Dict[str, Any]:
    """Execute one governor cycle (bounded actuation + snapshot)."""
    raise HTTPException(
        status_code=503,
        detail="governor execution requires child-process action enforcement",
    )


@router.post("/rollback")
async def rollback(
    req: RollbackRequest,
    authorization: ActionAuthorization = Depends(require_action_capability),
) -> Dict[str, Any]:
    """Rollback cron jobs to previous (or specified) governor snapshot."""
    raise HTTPException(
        status_code=503,
        detail="governor rollback requires child-process action enforcement",
    )


@router.get("/history")
async def history(
    hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=200, ge=1, le=2000),
) -> Dict[str, Any]:
    """Read recent governor decision history."""
    return _run_engine(["history", "--hours", str(hours), "--limit", str(limit)], timeout=60)
