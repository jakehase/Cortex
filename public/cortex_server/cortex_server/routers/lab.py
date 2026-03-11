"""Lab Router - Secure code execution endpoint."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import os
import subprocess
import uuid
import sys

from cortex_server.modules.l4_transcendence import build_l4_transcendence_bundle

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


def _run_python(code: str, timeout_seconds: int = 30) -> Dict[str, Any]:
    base_dir = "/tmp/cortex_lab"
    os.makedirs(base_dir, exist_ok=True, mode=0o755)
    script_path = f"{base_dir}/script_{uuid.uuid4().hex}.py"

    try:
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(code)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write script: {e}")

    python_exe = sys.executable
    if not python_exe or not os.path.exists(python_exe):
        python_exe = "/usr/bin/python3"
    if not os.path.exists(python_exe):
        python_exe = "python3"

    cmd = [python_exe, "-u", script_path]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout or "",
            "stderr": result.stderr or "",
            "exit_code": result.returncode,
            "timed_out": False,
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Execution timed out after {timeout_seconds} seconds",
            "exit_code": -1,
            "timed_out": True,
        }
    except Exception as e:
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
        except Exception:
            pass


@router.post("/execute")
async def lab_execute(request: LabExecuteRequest):
    """Execute code in an isolated python subprocess."""
    if request.language.strip().lower() not in ["python", "py"]:
        raise HTTPException(status_code=400, detail="Only Python is supported")
    return _run_python(request.code, timeout_seconds=request.timeout_seconds)


@router.post("/transcend/plan")
async def lab_transcend_plan(request: LabTranscendRequest):
    """Build complete L4 transcendence artifacts (all 10 ideas)."""
    if request.language.strip().lower() not in ["python", "py"]:
        raise HTTPException(status_code=400, detail="Only Python is supported")
    payload = request.model_dump()
    bundle = build_l4_transcendence_bundle(payload)
    return bundle


@router.post("/transcend/execute")
async def lab_transcend_execute(request: LabTranscendExecuteRequest):
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

    run = _run_python(request.code, timeout_seconds=request.timeout_seconds)
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
        'status': 'active',
        'capabilities': [
            'execute',
            'transcend_plan',
            'transcend_execute',
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
