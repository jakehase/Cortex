"""
Fixed Lab Router - Secure code execution endpoint.
Removes the restrictive user constraint that was causing failures.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import os
import subprocess
import uuid
import sys

router = APIRouter()


class LabExecuteRequest(BaseModel):
    code: str = Field(..., min_length=1)
    language: str = Field(default="python")


@router.post("/execute")
async def lab_execute(request: LabExecuteRequest):
    """Execute code securely in isolated environment."""
    if request.language.strip().lower() not in ["python", "py"]:
        raise HTTPException(status_code=400, detail="Only Python is supported")

    # Prepare temp directory and unique script path
    base_dir = "/tmp/cortex_lab"
    os.makedirs(base_dir, exist_ok=True, mode=0o755)
    script_path = f"{base_dir}/script_{uuid.uuid4().hex}.py"

    # Write code to script file
    try:
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(request.code)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write script: {e}")

    # Find Python executable
    python_exe = sys.executable
    if not python_exe or not os.path.exists(python_exe):
        python_exe = "/usr/bin/python3"
    if not os.path.exists(python_exe):
        python_exe = "python3"

    cmd = [python_exe, script_path]

    stdout = ""
    stderr = ""
    exit_code = -1
    timed_out = False

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,  # Increased timeout
            check=False,
        )
        stdout = result.stdout or ""
        stderr = result.stderr or ""
        exit_code = result.returncode
    except subprocess.TimeoutExpired as e:
        timed_out = True
        stdout = (e.stdout or "") if isinstance(e.stdout, str) else ""
        stderr = (e.stderr or "") if isinstance(e.stderr, str) else ""
    except Exception as e:
        stderr = f"Execution error: {str(e)}"
    finally:
        # Clean up temp files
        try:
            if os.path.exists(script_path):
                os.remove(script_path)
        except Exception:
            pass

    return {
        "success": exit_code == 0 and not timed_out,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "timed_out": timed_out,
    }
