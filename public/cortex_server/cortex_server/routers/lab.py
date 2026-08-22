"""Lab Router - Secure code execution endpoint."""
import asyncio
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import os
import uuid
import sys

from cortex_server.modules.l4_transcendence import build_l4_transcendence_bundle
from cortex_server.modules.runtime_trace import classify_command, extract_trace_context, record_trace_event
from cortex_server.modules.execution_capabilities import unsafe_lab_execution_enabled

router = APIRouter()


class LabExecuteRequest(BaseModel):
    code: str = Field(..., min_length=1)
    language: str = Field(default="python")
    timeout_seconds: int = Field(default=30, ge=1, le=120)


class LabTranscendRequest(BaseModel):
    code: str = Field(..., min_length=1)
    task: str = Field(default="code execution task")
    language: str = Field(default="python")
    stderr: Optional[str] = None
    contract: Optional[Dict[str, Any]] = None
    scenarios: Optional[List[Dict[str, Any]]] = None
    hypotheses: Optional[List[str]] = None
    candidates: Optional[List[Dict[str, Any]]] = None
    tests: Optional[List[str]] = None
    diff: Optional[str] = None
    stdin: Optional[str] = None
    env: Optional[Dict[str, str]] = None
    history: Optional[List[Dict[str, Any]]] = None
    verifier_count: int = Field(default=3, ge=2, le=8)
    verifier_threshold: float = Field(default=0.67, ge=0.3, le=0.95)
    dependency_density: float = Field(default=0.35, ge=0.0, le=1.0)
    failure_rate: float = Field(default=0.2, ge=0.0, le=1.0)


class LabTranscendExecuteRequest(LabTranscendRequest):
    timeout_seconds: int = Field(default=30, ge=1, le=120)
    require_proof: bool = Field(default=True)
    require_verifier_release: bool = Field(default=False)


async def _stream_reader(stream, chunks: List[str], *, context: Optional[Dict[str, Any]], kind: str) -> None:
    while True:
        line = await stream.readline()
        if not line:
            break
        text = line.decode("utf-8", "replace")
        chunks.append(text)
        record_trace_event(context, kind, {"chunk": text[:500]})


async def _run_python(code: str, timeout_seconds: int = 30, *, trace_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    # A service-user Python subprocess inherits host files, credentials, and
    # network access.  It is not a sandbox.  Keep the implementation dormant
    # until an external isolated worker can provide the required OS boundary.
    if not unsafe_lab_execution_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "error": "lab_execution_unavailable",
                "message": "raw code execution is disabled until an OS-isolated worker is configured",
                "degraded": True,
            },
        )
    base_dir = "/tmp/cortex_lab"
    os.makedirs(base_dir, exist_ok=True, mode=0o755)
    script_path = f"{base_dir}/script_{uuid.uuid4().hex}.py"

    try:
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(code)
        record_trace_event(trace_context, "file_written", {"file_path": script_path, "bytes": len(code.encode("utf-8")), "language": "python"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write script: {e}")

    python_exe = sys.executable
    if not python_exe or not os.path.exists(python_exe):
        python_exe = "/usr/bin/python3"
    if not os.path.exists(python_exe):
        python_exe = "python3"

    cmd = [python_exe, "-u", script_path]
    command_kind = classify_command(cmd)
    record_trace_event(
        trace_context,
        "command_started",
        {
            "command": cmd,
            "command_text": " ".join(cmd),
            "command_kind": command_kind,
            "timeout_seconds": timeout_seconds,
            "working_dir": base_dir,
        },
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_chunks: List[str] = []
        stderr_chunks: List[str] = []
        stdout_task = asyncio.create_task(_stream_reader(proc.stdout, stdout_chunks, context=trace_context, kind="command_stdout"))
        stderr_task = asyncio.create_task(_stream_reader(proc.stderr, stderr_chunks, context=trace_context, kind="command_stderr"))
        try:
            exit_code = await asyncio.wait_for(proc.wait(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            await asyncio.gather(stdout_task, stderr_task)
            record_trace_event(
                trace_context,
                "command_finished",
                {
                    "command": cmd,
                    "command_text": " ".join(cmd),
                    "command_kind": command_kind,
                    "exit_code": -1,
                    "timed_out": True,
                    "success": False,
                },
            )
            return {
                "success": False,
                "stdout": "".join(stdout_chunks),
                "stderr": f"Execution timed out after {timeout_seconds} seconds",
                "exit_code": -1,
                "timed_out": True,
            }
        await asyncio.gather(stdout_task, stderr_task)
        stdout = "".join(stdout_chunks)
        stderr = "".join(stderr_chunks)
        record_trace_event(
            trace_context,
            "command_finished",
            {
                "command": cmd,
                "command_text": " ".join(cmd),
                "command_kind": command_kind,
                "exit_code": exit_code,
                "timed_out": False,
                "success": exit_code == 0,
                "stdout_preview": stdout[:800],
                "stderr_preview": stderr[:800],
            },
        )
        return {
            "success": exit_code == 0,
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": exit_code,
            "timed_out": False,
        }
    except Exception as e:
        record_trace_event(
            trace_context,
            "command_finished",
            {
                "command": cmd,
                "command_text": " ".join(cmd),
                "command_kind": command_kind,
                "exit_code": -1,
                "timed_out": False,
                "success": False,
                "error": str(e),
            },
        )
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Execution error: {str(e)}",
            "exit_code": -1,
            "timed_out": False,
        }
    finally:
        try:
            if os.path.exists(script_path):
                os.remove(script_path)
                record_trace_event(trace_context, "file_deleted", {"file_path": script_path})
        except Exception:
            pass


@router.post("/execute")
async def lab_execute(request: LabExecuteRequest, http_request: Request):
    """Execute code only when a real OS-isolated worker is available."""
    if request.language.strip().lower() not in ["python", "py"]:
        raise HTTPException(status_code=400, detail="Only Python is supported")
    trace_context = extract_trace_context(http_request, defaults={"tool_name": "lab.execute", "scope": "lab:execute"})
    return await _run_python(request.code, timeout_seconds=request.timeout_seconds, trace_context=trace_context)


@router.post("/transcend/plan")
async def lab_transcend_plan(request: LabTranscendRequest):
    """Build complete L4 transcendence artifacts (all 10 ideas)."""
    if request.language.strip().lower() not in ["python", "py"]:
        raise HTTPException(status_code=400, detail="Only Python is supported")
    payload = request.model_dump()
    bundle = build_l4_transcendence_bundle(payload)
    return bundle


@router.post("/transcend/execute")
async def lab_transcend_execute(request: LabTranscendExecuteRequest, http_request: Request):
    """Run transcendence planning + guarded execution.

    Gate order:
      1) Proof-Carrying Execution (if require_proof)
      2) Verifier escrow release (optional)
      3) Execute code
    """
    if request.language.strip().lower() not in ["python", "py"]:
        raise HTTPException(status_code=400, detail="Only Python is supported")

    payload = request.model_dump()
    bundle = build_l4_transcendence_bundle(payload)
    artifacts = bundle.get("artifacts") if isinstance(bundle.get("artifacts"), dict) else {}

    pce = artifacts.get("1_pce") if isinstance(artifacts.get("1_pce"), dict) else {}
    escrow = artifacts.get("5_verifier_escrow") if isinstance(artifacts.get("5_verifier_escrow"), dict) else {}

    if request.require_proof and not bool(pce.get("proved")):
        return {
            "success": False,
            "blocked": True,
            "gate": "proof_carrying_execution",
            "reason": "proof_not_satisfied",
            "proof": pce,
            "transcendence": bundle,
        }

    if request.require_verifier_release and str(escrow.get("escrow_state")) != "released":
        return {
            "success": False,
            "blocked": True,
            "gate": "verifier_escrow",
            "reason": "escrow_held",
            "escrow": escrow,
            "transcendence": bundle,
        }

    trace_context = extract_trace_context(http_request, defaults={"tool_name": "lab.transcend_execute", "scope": "lab:transcend_execute"})
    run = await _run_python(request.code, timeout_seconds=request.timeout_seconds, trace_context=trace_context)
    return {
        "success": bool(run.get("success")),
        "blocked": False,
        "execution": run,
        "transcendence": bundle,
    }


@router.get('/status')
async def lab_status():
    return {
        'success': True,
        'level': 4,
        'name': 'Lab',
        'status': 'degraded',
        'execution': {
            'available': False,
            'reason': 'os_isolated_worker_not_configured',
            'defaultDeny': True,
        },
        'capabilities': [
            'transcend_plan',
            'proof_carrying_execution',
            'counterfactual_runner',
            'causal_debugger',
            'voi_planner',
            'verifier_escrow',
            'adaptive_topology',
            'semantic_delta_jit',
            'program_market_auction',
            'deterministic_replay_capsule',
            'self_modeling_twin',
        ],
    }
