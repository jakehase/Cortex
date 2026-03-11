"""Autonomy Governor Router.

Cortex-native API wrapper around the Autonomy Governor engine used to
manage dynamic risk budgets for OpenClaw cron automation.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter(tags=["AutonomyGovernor"])

ENGINE_SCRIPT = "/root/.openclaw/workspace/tools/autonomy_governor.py"


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


def _run_engine(args: list[str], timeout: int = 90) -> Dict[str, Any]:
    cmd = ["python3", ENGINE_SCRIPT] + args
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise HTTPException(status_code=504, detail=f"governor engine timeout: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"governor engine execution failed: {e}")

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "unknown error").strip()
        raise HTTPException(status_code=500, detail=f"governor engine failed: {err}")

    try:
        return json.loads(proc.stdout)
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
async def policy_apply(req: PolicyPatchRequest) -> Dict[str, Any]:
    """Patch governor policy (deep-merge)."""
    return _run_engine(["policy_patch", "--patch-json", json.dumps(req.patch)], timeout=60)


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
async def execute(req: ExecuteRequest) -> Dict[str, Any]:
    """Execute one governor cycle (bounded actuation + snapshot)."""
    args = ["execute"]
    if req.forceBand:
        args.extend(["--force-band", req.forceBand.upper()])
    if req.maxChanges is not None:
        args.extend(["--max-changes", str(req.maxChanges)])
    return _run_engine(args, timeout=120)


@router.post("/rollback")
async def rollback(req: RollbackRequest) -> Dict[str, Any]:
    """Rollback cron jobs to previous (or specified) governor snapshot."""
    args = ["rollback"]
    if req.snapshotId:
        args.extend(["--snapshot-id", req.snapshotId])
    return _run_engine(args, timeout=60)


@router.get("/history")
async def history(
    hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=200, ge=1, le=2000),
) -> Dict[str, Any]:
    """Read recent governor decision history."""
    return _run_engine(["history", "--hours", str(hours), "--limit", str(limit)], timeout=60)
