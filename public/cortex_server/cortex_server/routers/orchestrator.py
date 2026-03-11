"""
Level 26: The Orchestrator / Conductor — Real Workflow Execution

Coordinates multi-level workflows by accepting step definitions, executing
them sequentially via async HTTP, and storing results for replay.

NOTE: This is L26 Workflow Conductor, NOT L36 Meta-Conductor.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, List, Any, Optional
from datetime import datetime
import os
import json
import uuid
import time
import asyncio
import httpx

router = APIRouter()

# ── In-memory state ────────────────────────────────────────────────────────
workflows: Dict[str, Dict[str, Any]] = {}
_stats = {
    "workflows_created": 0,
    "workflows_executed": 0,
}

BASE_URL = "http://127.0.0.1:8888"

MAX_WORKFLOW_STEPS = int(os.getenv("ORCHESTRATOR_MAX_STEPS", "25"))
MAX_PAYLOAD_BYTES = int(os.getenv("ORCHESTRATOR_MAX_PAYLOAD_BYTES", "51200"))
STEP_TIMEOUT_MAX_S = float(os.getenv("ORCHESTRATOR_STEP_TIMEOUT_MAX_S", "20"))
MAX_STEP_RESPONSE_CHARS = int(os.getenv("ORCHESTRATOR_MAX_STEP_RESPONSE_CHARS", "4000"))
MAX_EXECUTIONS_PER_WORKFLOW = int(os.getenv("ORCHESTRATOR_MAX_EXECUTIONS_PER_WORKFLOW", "20"))
SENTINEL_SCAN_URL = "http://127.0.0.1:8888/sentinel/scan"


# ── Models ─────────────────────────────────────────────────────────────────

class WorkflowStep(BaseModel):
    """A single step in a workflow."""
    endpoint: str          # e.g. "/oracle/chat" or "/librarian/search"
    method: str = "POST"   # GET or POST
    payload: Dict[str, Any] = {}
    headers: Dict[str, str] = {}
    timeout_seconds: Optional[float] = None


class CreateWorkflowRequest(BaseModel):
    """Workflow definition."""
    name: str
    steps: List[WorkflowStep]
    metadata: Optional[Dict[str, Any]] = {}


# ── Helpers ─────────────────────────────────────────────────────────────────



def _redact_headers(h: Any) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not isinstance(h, dict):
        return out
    for k,v in h.items():
        lk=str(k).lower()
        if lk in ("authorization","x-bridge-token","x-api-key","cookie"):
            out[str(k)] = "[REDACTED]"
        else:
            out[str(k)] = str(v)[:200]
    return out

def _validate_endpoint(ep: str) -> None:
    if not isinstance(ep, str) or not ep.startswith('/'):
        raise HTTPException(status_code=400, detail='Invalid endpoint (must start with /)')
    if '..' in ep or ep.startswith('//'):
        raise HTTPException(status_code=400, detail='Invalid endpoint (path traversal)')


def _payload_size_ok(obj: Any) -> bool:
    try:
        b = len(json.dumps(obj).encode('utf-8'))
        return b <= MAX_PAYLOAD_BYTES
    except Exception:
        return False


async def _sentinel_preflight() -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.post(SENTINEL_SCAN_URL, json={})
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {"success": False, "error": f"sentinel_preflight_failed:{type(e).__name__}:{e}"}

async def _execute_workflow(workflow: Dict[str, Any]) -> Dict[str, Any]:
    """Execute all steps sequentially. Returns execution record."""
    execution_id = f"exec_{uuid.uuid4().hex[:8]}"
    step_results: List[Dict[str, Any]] = []
    overall_status = "success"
    started_at = datetime.now().isoformat()

    async with httpx.AsyncClient(timeout=30.0) as client:
        for i, step in enumerate(workflow["steps"]):
            url = f"{BASE_URL}{step['endpoint']}"
            method = step.get("method", "POST").upper()
            payload = step.get("payload", {})
            headers = step.get("headers", {})
            timeout_s = step.get("timeout_seconds")
            step_timeout = min(STEP_TIMEOUT_MAX_S, float(timeout_s)) if timeout_s else STEP_TIMEOUT_MAX_S

            _validate_endpoint(step.get("endpoint", ""))

            t0 = time.monotonic()
            try:
                if payload not in (None, {}) and (not _payload_size_ok(payload)):
                    raise ValueError("payload too large")
                if method == "GET":
                    resp = await client.get(url, params=payload, headers=headers, timeout=step_timeout)
                else:
                    resp = await client.post(url, json=payload, headers=headers, timeout=step_timeout)

                elapsed = round((time.monotonic() - t0) * 1000, 1)

                # Try to parse JSON, fall back to text (capped)
                try:
                    body = resp.json()
                except Exception:
                    body = (resp.text or "")
                # cap response size
                if isinstance(body, str):
                    body = body[:MAX_STEP_RESPONSE_CHARS]
                else:
                    try:
                        body = json.loads(json.dumps(body)[:MAX_STEP_RESPONSE_CHARS])
                    except Exception:
                        body = str(body)[:MAX_STEP_RESPONSE_CHARS]

                step_results.append({
                    "step": i + 1,
                    "endpoint": step["endpoint"],
                    "method": method,
                    "request": {"payload": payload, "headers": _redact_headers(headers), "timeout_s": step_timeout},
                    "status_code": resp.status_code,
                    "response": body,
                    "elapsed_ms": elapsed,
                    "success": 200 <= resp.status_code < 400,
                })

                if not (200 <= resp.status_code < 400):
                    overall_status = "partial_failure"

            except Exception as exc:
                elapsed = round((time.monotonic() - t0) * 1000, 1)
                step_results.append({
                    "step": i + 1,
                    "endpoint": step["endpoint"],
                    "method": method,
                    "request": {"payload": payload, "headers": _redact_headers(headers), "timeout_s": step_timeout},
                    "status_code": None,
                    "response": None,
                    "error": str(exc)[:300],
                    "elapsed_ms": elapsed,
                    "success": False,
                })
                overall_status = "partial_failure"

    execution = {
        "execution_id": execution_id,
        "status": overall_status,
        "started_at": started_at,
        "completed_at": datetime.now().isoformat(),
        "steps": step_results,
        "total_steps": len(step_results),
        "successful_steps": sum(1 for s in step_results if s["success"]),
    }

    _stats["workflows_executed"] += 1
    return execution


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("/status")
async def conductor_status():
    """Get Conductor status — L26 Workflow Orchestration."""
    return {
        "success": True,
        "data": {
            "level": 26,
            "name": "The Orchestrator",
            "role": "Workflow Orchestration",
            "description": "Coordinates multi-level execution workflows (NOT L36 Meta-Conductor)",
            "status": "active",
            "workflows_created": _stats["workflows_created"],
            "workflows_executed": _stats["workflows_executed"],
            "workflows_stored": len(workflows),
            "always_on": True,
            "timestamp": datetime.now().isoformat(),
        },
        "error": None,
    }


@router.post("/workflow")
async def create_and_run_workflow(request: CreateWorkflowRequest):
    """Create a workflow, store it, then execute it immediately."""
    workflow_id = f"wf_{uuid.uuid4().hex[:12]}"

    if len(request.steps) > MAX_WORKFLOW_STEPS:
        raise HTTPException(status_code=400, detail=f"too many steps (max {MAX_WORKFLOW_STEPS})")

    workflow = {
        "workflow_id": workflow_id,
        "name": request.name,
        "steps": [step.dict() for step in request.steps],
        "metadata": request.metadata or {},
        "created_at": datetime.now().isoformat(),
        "executions": [],
    }

    _stats["workflows_created"] += 1

    # Optional preflight gate
    if (request.metadata or {}).get("requires_preflight") is True:
        gate = await _sentinel_preflight()
        if isinstance(gate, dict) and gate.get("success") and isinstance(gate.get("scan"), dict):
            if int(gate["scan"].get("issues_found") or 0) > 0:
                return {"success": False, "error": "sentinel_gate_failed", "sentinel": gate.get("scan"), "workflow_id": workflow_id}

    # Execute immediately
    execution = await _execute_workflow(workflow)
    workflow["executions"].append(execution)
    if len(workflow["executions"]) > MAX_EXECUTIONS_PER_WORKFLOW:
        workflow["executions"] = workflow["executions"][-MAX_EXECUTIONS_PER_WORKFLOW:]
    workflow["last_status"] = execution["status"]
    workflow["last_run"] = execution["completed_at"]

    workflows[workflow_id] = workflow

    return {
        "success": True,
        "workflow_id": workflow_id,
        "name": request.name,
        "execution": execution,
    }

@router.post("/workflow_async")
async def create_and_run_workflow_async(request: CreateWorkflowRequest):
    """Create a workflow, store it, then execute it in the background."""
    workflow_id = f"wf_{uuid.uuid4().hex[:12]}"

    if len(request.steps) > MAX_WORKFLOW_STEPS:
        raise HTTPException(status_code=400, detail=f"too many steps (max {MAX_WORKFLOW_STEPS})")

    workflow = {
        "workflow_id": workflow_id,
        "name": request.name,
        "steps": [step.dict() for step in request.steps],
        "metadata": request.metadata or {},
        "created_at": datetime.now().isoformat(),
        "executions": [],
    }

    _stats["workflows_created"] += 1
    workflows[workflow_id] = workflow

    async def _runner():
        try:
            # Optional preflight gate
            if (request.metadata or {}).get("requires_preflight") is True:
                gate = await _sentinel_preflight()
                if isinstance(gate, dict) and gate.get("success") and isinstance(gate.get("scan"), dict):
                    if int(gate["scan"].get("issues_found") or 0) > 0:
                        workflow["executions"].append({
                            "execution_id": f"exec_{uuid.uuid4().hex[:8]}",
                            "status": "blocked",
                            "started_at": datetime.now().isoformat(),
                            "completed_at": datetime.now().isoformat(),
                            "steps": [],
                            "total_steps": 0,
                            "successful_steps": 0,
                            "sentinel": gate.get("scan"),
                        })
                        workflow["last_status"] = "blocked"
                        workflow["last_run"] = datetime.now().isoformat()
                        return

            execution = await _execute_workflow(workflow)
            workflow["executions"].append(execution)
            if len(workflow["executions"]) > MAX_EXECUTIONS_PER_WORKFLOW:
                workflow["executions"] = workflow["executions"][-MAX_EXECUTIONS_PER_WORKFLOW:]
            workflow["last_status"] = execution["status"]
            workflow["last_run"] = execution["completed_at"]
        except Exception as e:
            workflow["executions"].append({
                "execution_id": f"exec_{uuid.uuid4().hex[:8]}",
                "status": "error",
                "error": str(e)[:300],
                "started_at": datetime.now().isoformat(),
                "completed_at": datetime.now().isoformat(),
                "steps": [],
                "total_steps": 0,
                "successful_steps": 0,
            })
            workflow["last_status"] = "error"
            workflow["last_run"] = datetime.now().isoformat()

    asyncio.create_task(_runner())

    return {
        "success": True,
        "workflow_id": workflow_id,
        "name": request.name,
        "scheduled": True,
    }



@router.get("/workflows")
async def list_workflows():
    """List all stored workflows with last execution status."""
    items = []
    for wf_id, wf in workflows.items():
        items.append({
            "workflow_id": wf_id,
            "name": wf["name"],
            "steps_count": len(wf["steps"]),
            "executions_count": len(wf["executions"]),
            "last_status": wf.get("last_status", "never_run"),
            "last_run": wf.get("last_run"),
            "created_at": wf["created_at"],
        })

    return {
        "success": True,
        "workflows": items,
        "total": len(items),
    }




@router.get("/workflow/{workflow_id}")
async def get_workflow(workflow_id: str, executions_limit: int = 5):
    """Get a stored workflow including recent execution traces."""
    wf = workflows.get(workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")
    lim = max(0, min(int(executions_limit), MAX_EXECUTIONS_PER_WORKFLOW))
    wf_view = dict(wf)
    wf_view["executions"] = list(wf.get("executions", []))[-lim:] if lim else []
    return {"success": True, "workflow": wf_view}


@router.get("/execution/{execution_id}")
async def get_execution(execution_id: str):
    """Lookup an execution trace across all workflows."""
    for wf in workflows.values():
        for ex in wf.get("executions", []):
            if ex.get("execution_id") == execution_id:
                return {"success": True, "workflow_id": wf.get("workflow_id"), "execution": ex}
    raise HTTPException(status_code=404, detail=f"Execution '{execution_id}' not found")
@router.post("/run/{workflow_id}")
async def rerun_workflow(workflow_id: str):
    """Re-run an existing stored workflow by ID."""
    wf = workflows.get(workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_id}' not found")

    execution = await _execute_workflow(wf)
    wf["executions"].append(execution)
    if len(wf["executions"]) > MAX_EXECUTIONS_PER_WORKFLOW:
        wf["executions"] = wf["executions"][-MAX_EXECUTIONS_PER_WORKFLOW:]
    wf["last_status"] = execution["status"]
    wf["last_run"] = execution["completed_at"]

    return {
        "success": True,
        "workflow_id": workflow_id,
        "name": wf["name"],
        "execution": execution,
    }
