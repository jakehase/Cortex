"""
The Darwin Loop - Self-Optimization for The Cortex.
CRITICAL FIX: Requires human approval before deployment.
Non-blocking revision: uses async HTTP and thread offload for filesystem/compile work.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
import httpx
import ast
import asyncio

from cortex_server.internal_addressing import internal_url
from cortex_server.modules.execution_capabilities import (
    ExecutionCapabilityDenied,
    ExecutionGrant,
    authorize_execution_request,
    resolve_authorized_path,
)

router = APIRouter()

# Internal API endpoints
ORACLE_URL = internal_url("/oracle/chat")
BASE_DIR = "/app/cortex_server"
ORACLE_TIMEOUT = 25.0


class EvolveRequest(BaseModel):
    target_file: str
    issue: str
    auto_approve: bool = False  # CRITICAL: Default to False


class EvolveResponse(BaseModel):
    status: str
    message: str
    target_file: str
    validation_result: Optional[str]
    approval_required: bool = True


def _grant(http_request: Request, action: str) -> ExecutionGrant:
    try:
        return authorize_execution_request(http_request, action)
    except ExecutionCapabilityDenied as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error": exc.code, "message": exc.detail, "action": action},
        ) from exc


def _target_path(file_path: str, grant: ExecutionGrant, action: str) -> Path:
    raw = Path(file_path)
    candidate = raw if raw.is_absolute() else Path(BASE_DIR) / raw
    return resolve_authorized_path(grant, action, candidate, require_file=True)


def read_target_file(file_path: str, grant: ExecutionGrant) -> str:
    full_path = _target_path(file_path, grant, "darwin.evolve")
    with open(full_path, "r", encoding="utf-8") as f:
        return f.read()


async def consult_oracle(current_code: str, issue: str) -> str:
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

    async with httpx.AsyncClient(timeout=ORACLE_TIMEOUT) as client:
        resp = await client.post(ORACLE_URL, json=oracle_payload)
        resp.raise_for_status()
        response_text = resp.json().get("response", "")

    if "```python" in response_text:
        code = response_text.split("```python")[1].split("```")[0].strip()
    elif "```" in response_text:
        code = response_text.split("```")[1].split("```")[0].strip()
    else:
        code = response_text.strip()

    return code


def validate_code(code: str) -> tuple[bool, str]:
    try:
        ast.parse(code, filename="<darwin-proposal>", mode="exec")
        return True, "Code syntax is valid"
    except SyntaxError as e:
        error = f"{e.msg} at line {e.lineno}"
        return False, f"Syntax error: {error}"
    except Exception as e2:
        return False, f"Validation failed: {str(e2)}"


@router.post("/evolve", response_model=EvolveResponse)
async def darwin_evolve(request: EvolveRequest, http_request: Request):
    grant = _grant(http_request, "darwin.evolve")
    try:
        current_code = await asyncio.to_thread(read_target_file, request.target_file, grant)
    except ExecutionCapabilityDenied as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error": exc.code, "message": exc.detail, "action": "darwin.evolve"},
        ) from exc
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Read failed: {str(e)}")

    try:
        new_code = await consult_oracle(current_code, request.issue)
        if not new_code.strip():
            raise HTTPException(status_code=500, detail="Oracle returned empty code")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Oracle consultation timed out")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Oracle consultation failed: {str(e)}")

    is_valid, validation_msg = await asyncio.to_thread(validate_code, new_code)

    if not is_valid:
        return EvolveResponse(
            status="rejected",
            message=f"Code validation failed: {validation_msg}",
            target_file=request.target_file,
            validation_result=validation_msg,
            approval_required=False,
        )

    # The legacy auto_approve boolean is caller-authored, not a trusted grant.
    # Preserve generation/validation as a proposal, but never turn it into a
    # host write from this route.
    return EvolveResponse(
        status="pending_approval",
        message="Code validated; deployment is unavailable until a trusted persisted approval sink is configured.",
        target_file=request.target_file,
        validation_result=validation_msg,
        approval_required=True,
    )


@router.get("/status")
async def darwin_status():
    services = {}
    async with httpx.AsyncClient(timeout=2.0) as client:
        try:
            resp = await client.get(internal_url("/oracle/status"))
            services["oracle"] = "online" if resp.status_code == 200 else "offline"
        except Exception:
            services["oracle"] = "offline"

        try:
            resp = await client.get(internal_url("/lab/status"))
            services["lab"] = "online" if resp.status_code in [200, 422] else "offline"
        except Exception:
            services["lab"] = "offline"

    return {
        "status": "active",
        "services": services,
        "capabilities": ["capability_scoped_code_read", "oracle_consult", "syntax_validate", "proposal_only"],
        "security": "CAPABILITY_AND_TRUSTED_APPROVAL_REQUIRED",
        "deployment_available": False,
        "version": "12.2-ASYNC-SAFE",
    }
