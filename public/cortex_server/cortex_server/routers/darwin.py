"""The Darwin Loop - Self-Optimization for The Cortex.

Allows the system to patch its own code through AI-guided refactoring.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import requests
import subprocess
import os
import tempfile

router = APIRouter()

# Internal API endpoints
ORACLE_URL = "http://localhost:8888/oracle/chat"
ARCHITECT_EXTEND = "http://localhost:8888/architect/extend"
LAB_EXECUTE = "http://localhost:8888/lab/execute"

BASE_DIR = "/root/cortex_server/cortex_server"


class EvolveRequest(BaseModel):
    target_file: str  # e.g., "routers/hive.py"
    issue: str  # Description of what needs fixing


class EvolveResponse(BaseModel):
    status: str
    message: str
    target_file: str
    validation_result: Optional[str]


def read_target_file(file_path: str) -> str:
    """Read the current code from the target file."""
    full_path = os.path.join(BASE_DIR, file_path)
    if not os.path.exists(full_path):
        raise FileNotFoundError(f"Target file not found: {file_path}")
    with open(full_path, "r") as f:
        return f.read()


def consult_oracle(current_code: str, issue: str) -> str:
    """Ask Oracle to refactor the code."""
    system_prompt = """You are an expert Python programmer. Your task is to refactor code to fix the specified issue.
Rules:
1. Return ONLY valid Python code (no markdown, no explanations)
2. Maintain the same file structure and imports
3. Ensure the code is syntactically correct
4. Keep the router and endpoint definitions intact
5. Focus on the specific issue mentioned"""

    oracle_payload = {
        "prompt": f"Current code:\n```\n{current_code[:2000]}\n```\n\nIssue to fix: {issue}\n\nProvide the refactored Python code:",
        "system": system_prompt,
        "model": "tinyllama"
    }
    
    resp = requests.post(ORACLE_URL, json=oracle_payload, timeout=90)
    resp.raise_for_status()
    
    # Extract code from response (handle potential markdown)
    response_text = resp.json().get("response", "")
    
    # Remove markdown code blocks if present
    if "```python" in response_text:
        code = response_text.split("```python")[1].split("```")[0].strip()
    elif "```" in response_text:
        code = response_text.split("```")[1].split("```")[0].strip()
    else:
        code = response_text.strip()
    
    return code


def validate_code(code: str) -> tuple[bool, str]:
    """Validate Python code using py_compile."""
    # Local validation only (avoid f-string escaping issues)
    import tempfile
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        subprocess.run(['python3', '-m', 'py_compile', temp_path], 
                     check=True, capture_output=True, text=True)
        os.unlink(temp_path)
        return True, "Code syntax is valid"
    except subprocess.CalledProcessError as e:
        error = e.stderr if e.stderr else str(e)
        return False, f"Syntax error: {error}"
    except Exception as e2:
        return False, f"Validation failed: {str(e2)}"


def deploy_patch(file_path: str, new_code: str) -> bool:
    """Deploy the validated patch using direct file write."""
    full_path = os.path.join(BASE_DIR, file_path)
    try:
        with open(full_path, "w") as f:
            f.write(new_code)
        return True
    except Exception as e:
        raise Exception(f"Deployment failed: {str(e)}")


@router.post("/evolve", response_model=EvolveResponse)
async def darwin_evolve(request: EvolveRequest):
    """
    The Darwin Loop - Self-optimize code:
    1. Read current code
    2. Consult Oracle for refactoring
    3. Validate new code
    4. Deploy if valid
    """
    # Step 1: Read
    try:
        current_code = read_target_file(request.target_file)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Read failed: {str(e)}")
    
    # Step 2: Consult Oracle
    try:
        new_code = consult_oracle(current_code, request.issue)
        if not new_code.strip():
            raise HTTPException(status_code=500, detail="Oracle returned empty code")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Oracle consultation failed: {str(e)}")
    
    # Step 3: Validate
    is_valid, validation_msg = validate_code(new_code)
    
    if not is_valid:
        return EvolveResponse(
            status="rejected",
            message=f"Code validation failed: {validation_msg}",
            target_file=request.target_file,
            validation_result=validation_msg
        )
    
    # Step 4: Deploy
    try:
        deploy_patch(request.target_file, new_code)
        return EvolveResponse(
            status="evolved",
            message=f"Successfully patched {request.target_file}",
            target_file=request.target_file,
            validation_result=validation_msg
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deployment failed: {str(e)}")


@router.get("/status")
async def darwin_status():
    """Check Darwin Loop system status."""
    services = {}
    
    try:
        resp = requests.get("http://localhost:8888/oracle/status", timeout=2)
        services["oracle"] = "online" if resp.status_code == 200 else "offline"
    except:
        services["oracle"] = "offline"
    
    try:
        resp = requests.get("http://localhost:8888/lab/execute", timeout=2)
        services["lab"] = "online" if resp.status_code in [200, 422] else "offline"
    except:
        services["lab"] = "offline"
    
    return {
        "status": "active",
        "services": services,
        "capabilities": ["code_read", "oracle_consult", "syntax_validate", "deploy_patch"],
        "version": "12.0"
    }
