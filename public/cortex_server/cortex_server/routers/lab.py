"""
Lab Router - Secure code execution endpoint.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import os
import subprocess
import uuid

router = APIRouter()


class LabExecuteRequest(BaseModel):
    code: str = Field(..., min_length=1)
    language: str = Field(...)


@router.post("/execute")
async def lab_execute(request: LabExecuteRequest):
    """Execute code securely using a restricted local user."""
    if request.language.strip().lower() != "python":
        raise HTTPException(status_code=400, detail="Unsupported language")

    # Prepare temp directory and unique script path
    base_dir = "/tmp/cortex_lab"
    os.makedirs(base_dir, exist_ok=True)
    script_path = f"{base_dir}/script_{uuid.uuid4().hex}.py"

    # Write code to script file
    try:
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(request.code)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write script: {e}")

    cmd = [
        "sudo", "-u", "cortex_runner",
        "env", "PYTHONPATH=/root/cortex_server/venv/lib/python3.11/site-packages",
        "/root/cortex_server/venv/bin/python3", script_path
    ]

    stdout = ""
    stderr = ""
    exit_code = -1
    timed_out = False

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        stdout = result.stdout or ""
        stderr = result.stderr or ""
        exit_code = result.returncode
    except subprocess.TimeoutExpired as e:
        timed_out = True
        stdout = (e.stdout or "") if isinstance(e.stdout, str) else ""
        stderr = (e.stderr or "") if isinstance(e.stderr, str) else ""
    finally:
        # Clean up temp files
        try:
            if os.path.exists(script_path):
                os.remove(script_path)
        except Exception:
            pass

    return {
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "timed_out": timed_out,
    }
