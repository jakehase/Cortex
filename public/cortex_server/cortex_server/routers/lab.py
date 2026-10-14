"""Lab Router - Secure code execution endpoint."""
import asyncio
import hashlib
import json
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import os
from pathlib import Path
import shutil
import uuid

from cortex_server.modules import lab_analysis, lab_compute
from cortex_server.modules.level_model import scope_key_for_request
from cortex_server.modules.level_route_status import capability_report
from cortex_server.modules.runtime_trace import extract_trace_context, record_trace_event
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
    require_action_capability,
)
from cortex_server.modules.execution_capabilities import (
    ExecutionCapabilityDenied,
    authorize_execution_request,
    execution_capability_status,
    resolve_authorized_path,
)
from cortex_server.modules.health_status import DEGRADED, OPERATIONAL, RESTRICTED_BY_DESIGN

router = APIRouter()


class LabExecuteRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=65536)
    language: str = Field(default="python")
    timeout_seconds: int = Field(default=30, ge=1, le=120)


class LabTranscendRequest(BaseModel):
    """Static analysis request. Legacy hash-score knobs are no longer accepted."""

    code: str = Field(..., min_length=1, max_length=65536)
    task: str = Field(default="code execution task", max_length=2000)
    language: str = Field(default="python")
    stderr: Optional[str] = Field(default=None, max_length=20000)
    contract: Optional[Dict[str, Any]] = None
    model_review: bool = Field(default=False, description="Also request a provider-backed review via level_model")


class LabTranscendExecuteRequest(LabTranscendRequest):
    timeout_seconds: int = Field(default=30, ge=1, le=120)
    require_proof: bool = Field(default=True, description="Require the AST static check to pass (not a proof)")
    require_verifier_release: bool = Field(default=False, description="Require a provider-backed review verdict of no_blocking_risks")


class LabComputeRequest(BaseModel):
    expression: Optional[str] = Field(default=None, max_length=lab_compute.MAX_EXPRESSION_CHARS)
    expressions: Optional[List[str]] = Field(default=None, max_length=20)
    exact: bool = True
    caret_is_power: bool = True


LAB_EXECUTION_ACTION = "lab.python.execute"
LAB_REQUEST_ROOT = Path(
    os.getenv("CORTEX_LAB_REQUEST_ROOT", "/opt/clawdbot/state/cortex-execution/requests")
).expanduser()
LAB_WORKER_LAUNCHER = Path(
    os.getenv("CORTEX_REMOTE_WORKER_LAUNCHER", "/opt/cortex/current/scripts/codex-worker-launcher.mjs")
).expanduser()
LAB_WORKER_CONFIG = Path(
    os.getenv("CORTEX_REMOTE_WORKER_CONFIG", "/root/clawd/config/worker-launch/default.json")
).expanduser()


def _path_is_file(path: Path) -> bool:
    """Return file availability without letting service sandbox ACLs break status."""
    try:
        return path.is_file()
    except OSError:
        return False


def _path_is_dir(path: Path) -> bool:
    """Return directory availability without exposing inaccessible path details."""
    try:
        return path.is_dir()
    except OSError:
        return False


def _execution_http_error(exc: ExecutionCapabilityDenied) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code,
        detail={"error": exc.code, "message": exc.detail, "action": LAB_EXECUTION_ACTION},
    )


async def _run_python(
    code: str,
    timeout_seconds: int = 30,
    *,
    http_request: Request,
    authorization: ActionAuthorization,
    trace_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Run Python only through the fixed remote OS-isolation adapter."""
    assert_action_authorized(authorization)
    try:
        grant = authorize_execution_request(http_request, LAB_EXECUTION_ACTION)
        request_root = resolve_authorized_path(
            grant,
            LAB_EXECUTION_ACTION,
            LAB_REQUEST_ROOT,
            must_exist=True,
            require_directory=True,
        )
    except ExecutionCapabilityDenied as exc:
        raise _execution_http_error(exc) from exc

    node = shutil.which("node")
    if (
        not node
        or not LAB_WORKER_LAUNCHER.is_absolute()
        or not LAB_WORKER_LAUNCHER.is_file()
        or not LAB_WORKER_CONFIG.is_absolute()
        or not LAB_WORKER_CONFIG.is_file()
    ):
        raise HTTPException(
            status_code=503,
            detail={"error": "remote_execution_adapter_unavailable", "degraded": True},
        )

    code_bytes = code.encode("utf-8")
    script_path = request_root / f"lab-{uuid.uuid4().hex}.py"
    descriptor = os.open(script_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(code_bytes)
            handle.flush()
            os.fsync(handle.fileno())
        record_trace_event(trace_context, "remote_sandbox_admitted", {
            "code_sha256": hashlib.sha256(code_bytes).hexdigest(),
            "bytes": len(code_bytes),
            "timeout_seconds": timeout_seconds,
            "execution_plane": "configured_remote",
        })
        proc = await asyncio.create_subprocess_exec(
            node,
            str(LAB_WORKER_LAUNCHER),
            "sandbox-python",
            "--config", str(LAB_WORKER_CONFIG),
            "--code-file", str(script_path),
            "--timeout-seconds", str(timeout_seconds),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=float(timeout_seconds) + 50.0
            )
        except asyncio.TimeoutError as exc:
            proc.kill()
            await proc.wait()
            raise HTTPException(
                status_code=504,
                detail={"error": "remote_execution_adapter_timeout", "degraded": True},
            ) from exc
        try:
            receipt = json.loads(stdout_bytes.decode("utf-8", errors="strict"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=502,
                detail={"error": "remote_execution_receipt_invalid", "degraded": True},
            ) from exc
        expected_hash = hashlib.sha256(code_bytes).hexdigest()
        valid_receipt = bool(
            isinstance(receipt, dict)
            and receipt.get("schemaVersion") == "clawd.remote_python_sandbox.v1"
            and receipt.get("action") == "sandbox-python"
            and receipt.get("executionConfirmed") is True
            and receipt.get("isolation") == "bubblewrap_unshare_all_no_network_ro_runtime"
            and receipt.get("cleanupConfirmed") is True
            and isinstance(receipt.get("input"), dict)
            and receipt["input"].get("sha256") == expected_hash
        )
        if not valid_receipt:
            record_trace_event(trace_context, "remote_sandbox_receipt_rejected", {
                "launcher_exit_code": proc.returncode,
                "stderr_sha256": hashlib.sha256(stderr_bytes).hexdigest(),
            })
            raise HTTPException(
                status_code=502,
                detail={"error": "remote_execution_receipt_unverified", "degraded": True},
            )
        result = {
            "success": receipt.get("ok") is True,
            "stdout": str(receipt.get("stdout") or ""),
            "stderr": str(receipt.get("stderr") or ""),
            "exit_code": int(receipt.get("exitCode", -1)),
            "timed_out": bool(receipt.get("timedOut")),
            "stdout_truncated": bool(receipt.get("stdoutTruncated")),
            "stderr_truncated": bool(receipt.get("stderrTruncated")),
            "execution_plane": "remote",
            "isolation": receipt.get("isolation"),
            "cleanup_confirmed": True,
            "receipt_sha256": hashlib.sha256(stdout_bytes).hexdigest(),
        }
        record_trace_event(trace_context, "remote_sandbox_finished", {
            "success": result["success"],
            "exit_code": result["exit_code"],
            "timed_out": result["timed_out"],
            "receipt_sha256": result["receipt_sha256"],
        })
        return result
    finally:
        try:
            script_path.unlink(missing_ok=True)
        except OSError:
            pass


@router.post("/execute")
async def lab_execute(
    request: LabExecuteRequest,
    http_request: Request,
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    """Execute code only when a real OS-isolated worker is available."""
    if request.language.strip().lower() not in ["python", "py"]:
        raise HTTPException(status_code=400, detail="Only Python is supported")
    trace_context = extract_trace_context(http_request, defaults={"tool_name": "lab.execute", "scope": "lab:execute"})
    return await _run_python(
        request.code,
        timeout_seconds=request.timeout_seconds,
        http_request=http_request,
        authorization=authorization,
        trace_context=trace_context,
    )


@router.post("/compute")
async def lab_compute_endpoint(request: LabComputeRequest):
    """Exact deterministic calculation (AST whitelist; no code execution)."""
    items = list(request.expressions or [])
    if request.expression is not None:
        items.insert(0, request.expression)
    if not items:
        raise HTTPException(status_code=422, detail={"error": "malformed", "message": "expression or expressions is required"})
    if len(items) > 20:
        raise HTTPException(status_code=422, detail={"error": "bound_exceeded", "message": "at most 20 expressions"})
    results: List[Dict[str, Any]] = []
    for item in items:
        try:
            results.append({"ok": True, **lab_compute.evaluate(item, exact=request.exact, caret_is_power=request.caret_is_power)})
        except lab_compute.LabComputeError as exc:
            results.append({"ok": False, "expression": str(item)[:200], "error": exc.code, "message": exc.message})
    if len(results) == 1 and not results[0]["ok"]:
        raise HTTPException(status_code=422, detail={"error": results[0]["error"], "message": results[0]["message"]})
    first = results[0]
    return {
        "success": all(row["ok"] for row in results),
        "level": 4,
        "operation": "lab.compute",
        "origin": "deterministic",
        "method": "ast_whitelist",
        "value": first.get("value") if first["ok"] else None,
        "exact_repr": first.get("exact_repr") if first["ok"] else None,
        "results": results,
    }


def _require_python(language: str) -> None:
    if language.strip().lower() not in ["python", "py"]:
        raise HTTPException(status_code=400, detail="Only Python is supported")


@router.post("/transcend/plan")
async def lab_transcend_plan(request: LabTranscendRequest, http_request: Request = None):
    """AST static risk analysis (+ optional model review). Never executes code."""
    _require_python(request.language)
    payload = request.model_dump()
    review = None
    if request.model_review:
        static = lab_analysis.static_analysis(request.code, request.contract)
        review = await lab_analysis.model_review(
            request.code,
            task=request.task,
            static=static,
            principal_scope_key=scope_key_for_request(http_request, "lab"),
            stderr=request.stderr,
        )
    return lab_analysis.analysis_bundle(payload, review=review)


@router.post("/transcend/execute")
async def lab_transcend_execute(
    request: LabTranscendExecuteRequest,
    http_request: Request,
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    """Static gate (+ optional model gate), then sandbox execution.

    Gate order:
      1) AST static check (if require_proof) — heuristic screen, not a proof
      2) provider-backed review verdict no_blocking_risks (if require_verifier_release)
      3) remote OS-isolated sandbox execution (action capability + execution grant)
    """
    _require_python(request.language)
    static = lab_analysis.static_analysis(request.code, request.contract)
    if request.require_proof and not static["static_check_passed"]:
        return {
            "success": False,
            "blocked": True,
            "gate": "static_analysis",
            "reason": "static_check_failed",
            "static_analysis": static,
        }
    review = None
    if request.require_verifier_release:
        review = await lab_analysis.model_review(
            request.code,
            task=request.task,
            static=static,
            principal_scope_key=scope_key_for_request(http_request, "lab"),
            stderr=request.stderr,
        )
        if not review.get("ok"):
            return {
                "success": False,
                "blocked": True,
                "gate": "model_review",
                "reason": "model_unavailable",
                "static_analysis": static,
                "model_review": review,
            }
        if (review.get("review") or {}).get("verdict") != "no_blocking_risks":
            return {
                "success": False,
                "blocked": True,
                "gate": "model_review",
                "reason": "review_not_released",
                "static_analysis": static,
                "model_review": review,
            }

    trace_context = extract_trace_context(http_request, defaults={"tool_name": "lab.transcend_execute", "scope": "lab:transcend_execute"})
    run = await _run_python(
        request.code,
        timeout_seconds=request.timeout_seconds,
        http_request=http_request,
        authorization=authorization,
        trace_context=trace_context,
    )
    return {
        "success": bool(run.get("success")),
        "blocked": False,
        "execution": run,
        "static_analysis": static,
        "model_review": review if review is not None else {"requested": False},
    }


_STATUS_CAPABILITIES = {
    "compute": [("POST", "/compute")],
    "static_code_analysis": [("POST", "/transcend/plan")],
    "sandbox_execute": [("POST", "/execute")],
    "gated_sandbox_execute": [("POST", "/transcend/execute")],
}


@router.get('/status')
async def lab_status(request: Request = None):
    policy = execution_capability_status(required_actions=(LAB_EXECUTION_ACTION,))
    adapter_ready = bool(
        shutil.which("node")
        and _path_is_file(LAB_WORKER_LAUNCHER)
        and _path_is_file(LAB_WORKER_CONFIG)
        and _path_is_dir(LAB_REQUEST_ROOT)
    )
    available = bool(policy["enabled"] and adapter_ready)
    status = (
        OPERATIONAL
        if available
        else RESTRICTED_BY_DESIGN
        if not policy["enabled"]
        else DEGRADED
    )
    blocked = {}
    if not available:
        reason = (
            "execution_capability_not_configured"
            if not policy["enabled"]
            else "remote_os_isolated_worker_not_configured"
        )
        blocked = {
            "sandbox_execute": reason,
            "gated_sandbox_execute": reason,
        }
    report = capability_report(request, "/lab", _STATUS_CAPABILITIES, extra_unavailable=blocked)
    return {
        'success': True,
        'level': 4,
        'name': 'Lab',
        'status': status,
        'execution': {
            'available': available,
            'reason': None if available else reason,
            'defaultDeny': True,
            'executionPlane': 'configured_remote',
            'isolation': 'bubblewrap_unshare_all_no_network_ro_runtime',
            'capabilityPolicy': policy,
        },
        'compute': {'method': 'ast_whitelist', 'functions': lab_compute.supported_functions()},
        'analysis': {'method': lab_analysis.METHOD, 'model_review': 'optional, via level_model'},
        'capabilities': report["capabilities"],
        'unavailable': report["unavailable"],
        'mounted_routes': report["mounted_routes"],
    }
