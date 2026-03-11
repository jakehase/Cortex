import os
import subprocess
import re
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Literal, Dict, Any
import httpx

router = APIRouter()
INSTALL_TIMEOUT_SECONDS = 45
GENETICIST_URL = "http://localhost:8888/geneticist/apply_plan"


class ExtendRequest(BaseModel):
    filename: str
    code: str
    dependencies: Optional[List[str]] = []


class ExtendResponse(BaseModel):
    status: str
    message: str
    module: str


class GeneticistPlanRequest(BaseModel):
    code: str
    strategy: Literal["mutate", "evolve"]
    objective: str
    generations: Optional[int] = 1
    mutation_hint: Optional[str] = None
    trace_id: Optional[str] = None


def validate_router_code(code: str) -> bool:
    return "APIRouter" in code


def validate_filename(name: str) -> bool:
    return bool(re.fullmatch(r"[a-zA-Z0-9_\-]+\.py", name or ""))


def _validate_plan(req: GeneticistPlanRequest) -> None:
    if not isinstance(req.code, str) or not req.code.strip():
        raise HTTPException(status_code=400, detail="code must be a non-empty string")
    if not isinstance(req.objective, str) or not req.objective.strip():
        raise HTTPException(status_code=400, detail="objective must be a non-empty string")
    if req.strategy == "evolve":
        if not isinstance(req.generations, int) or req.generations < 1 or req.generations > 3:
            raise HTTPException(status_code=400, detail="generations must be between 1 and 3 for evolve")


@router.post("/extend", response_model=ExtendResponse)
def extend_router(request: ExtendRequest):
    if not validate_router_code(request.code):
        raise HTTPException(status_code=400, detail="Code must include APIRouter")
    if not validate_filename(request.filename):
        raise HTTPException(status_code=400, detail="Invalid filename")

    if request.dependencies:
        for dep in request.dependencies:
            subprocess.run(
                ["pip", "install", "--disable-pip-version-check", dep],
                check=True,
                capture_output=True,
                text=True,
                timeout=INSTALL_TIMEOUT_SECONDS,
            )

    target_path = os.path.join(
        "/app/cortex_server/routers",
        request.filename,
    )
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(request.code)

    module_name = os.path.splitext(request.filename)[0]
    return ExtendResponse(
        status="ok",
        message=f"Router written to {target_path}",
        module=module_name,
    )


@router.post("/reload", response_model=ExtendResponse)
def reload_router():
    return ExtendResponse(
        status="ok",
        message="Reload placeholder: manual restart required",
        module="",
    )


@router.get("/geneticist_contract")
def geneticist_contract() -> Dict[str, Any]:
    return {
        "success": True,
        "contract": {
            "purpose": "Architect creates plan, Geneticist executes code-improvement work",
            "request": {
                "code": "string (required)",
                "strategy": "mutate|evolve",
                "objective": "string (required)",
                "generations": "int 1..3 (required for evolve)",
                "mutation_hint": "string (optional)",
                "trace_id": "string (optional)",
            },
            "result": {
                "success": "boolean",
                "partial_success": "boolean (when applicable)",
                "result": "geneticist output payload",
            },
        },
    }


@router.post("/handoff_to_geneticist")
async def handoff_to_geneticist(request: GeneticistPlanRequest):
    _validate_plan(request)
    trace_id = request.trace_id or f"l9-l19-{int(time.time()*1000)}"

    payload = {
        "code": request.code,
        "strategy": request.strategy,
        "objective": request.objective,
        "generations": request.generations,
        "mutation_hint": request.mutation_hint,
        "trace_id": trace_id,
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(GENETICIST_URL, json=payload)
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
            data = resp.json()
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Geneticist handoff timeout")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Geneticist handoff failed: {str(exc)[:300]}")

    return {
        "success": bool(data.get("success", False)),
        "trace_id": trace_id,
        "handoff": payload,
        "geneticist": data,
    }


@router.get('/status')
def architect_status():
    return {
        'success': True,
        'level': 9,
        'name': 'Architect',
        'status': 'active',
        'capabilities': ['extend', 'reload', 'geneticist_contract', 'handoff_to_geneticist'],
    }
