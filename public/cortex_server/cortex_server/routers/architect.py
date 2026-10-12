"""Level 9: Architect router.

Safe surface: ``POST /architect/design`` (model-backed design advice; no side
effects), ``GET /architect/status`` and ``GET /architect/geneticist_contract``.

Host-mutating legacy routes are honest refusals: ``/extend`` used to write
caller code into the live routers directory and ``pip install`` arbitrary
packages; it is disabled in code (generated code goes through Forge's reviewed,
approval-gated proposal flow).  ``/reload`` was a placeholder that returned
``"ok"``; it now returns 501.
"""

import re
import time
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from cortex_server.modules import architect as architect_core
from cortex_server.modules.level_model import scope_key_for_request
from cortex_server.modules.level_route_status import capability_report

router = APIRouter()


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


class DesignRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=architect_core.MAX_QUERY_CHARS)
    kind: architect_core.DesignKind = "auto"
    constraints: Optional[str] = Field(default=None, max_length=4000)
    current_stack: Optional[str] = Field(default=None, max_length=2000)
    context: Optional[str] = Field(default=None, max_length=architect_core.MAX_CONTEXT_CHARS)


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


_LAST_DESIGN: Dict[str, Any] = {"ok_at": None, "failed_at": None, "last_status": None}


@router.post("/design")
async def architect_design(request: DesignRequest, http_request: Request = None):
    """Model-backed design advice: components, data flow, data model, infra, risks, trade-offs."""
    if not request.query.strip():
        raise HTTPException(status_code=422, detail="query must be non-empty")
    result = await architect_core.design(
        request.query,
        principal_scope_key=scope_key_for_request(http_request, "architect"),
        kind=request.kind,
        constraints=request.constraints,
        context=request.context,
        current_stack=request.current_stack,
    )
    if result.get("success"):
        _LAST_DESIGN["ok_at"] = time.time()
        _LAST_DESIGN["last_status"] = "ok"
    else:
        _LAST_DESIGN["failed_at"] = time.time()
        _LAST_DESIGN["last_status"] = result.get("status") or "failed"
    return {"level": 9, "name": "Architect", **result}


@router.post("/extend", response_model=ExtendResponse)
def extend_router(request: ExtendRequest):
    """Disabled: request-driven router writes and package installs are not allowed."""
    raise HTTPException(
        status_code=403,
        detail={
            "error": "architect_extend_disabled",
            "message": (
                "Writing router files and installing packages from a request is disabled. "
                "Use POST /architect/design for advice and Forge's reviewed, approval-gated "
                "propose/approve/commit flow for code."
            ),
            "wrote_files": False,
            "installed_packages": False,
        },
    )


@router.post("/reload", response_model=ExtendResponse)
def reload_router():
    raise HTTPException(
        status_code=501,
        detail={"error": "not_implemented", "implemented": False,
                "message": "Router hot-reload is not implemented; a manual restart is required."},
    )


@router.get("/geneticist_contract")
def geneticist_contract() -> Dict[str, Any]:
    return {
        "success": True,
        "contract": {
            "purpose": "Architect creates plan, Geneticist proposes measured code candidates (never writes)",
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
                "selected": "best candidate by the declared fitness rule",
                "candidates": "all candidates with deterministic fitness",
            },
        },
    }


@router.post("/handoff_to_geneticist")
async def handoff_to_geneticist(request: GeneticistPlanRequest, http_request: Request = None):
    """In-process handoff to the Geneticist proposal core (no HTTP self-call, no writes)."""
    _validate_plan(request)
    trace_id = request.trace_id or f"l9-l19-{int(time.time()*1000)}"
    from cortex_server.routers import geneticist as geneticist_router

    objective = request.objective if request.strategy == "evolve" or not request.mutation_hint \
        else f"{request.objective}\nMutation hint: {request.mutation_hint}"
    result = await geneticist_router.propose_candidates_core(
        code=request.code,
        objective=objective,
        strategy=request.strategy,
        candidates=2,
        principal_scope_key=scope_key_for_request(http_request, "geneticist"),
        owner=geneticist_router.principal_owner(http_request),
    )
    return {
        "success": bool(result.get("success")),
        "trace_id": trace_id,
        "handoff": {"strategy": request.strategy, "objective": request.objective},
        "geneticist": result,
    }


_STATUS_CAPABILITIES = {
    "design": [("POST", "/design")],
    "geneticist_contract": [("GET", "/geneticist_contract")],
    "handoff_to_geneticist": [("POST", "/handoff_to_geneticist")],
    "extend": [("POST", "/extend")],
    "reload": [("POST", "/reload")],
}


@router.get('/status')
def architect_status(request: Request = None):
    report = capability_report(
        request,
        "/architect",
        _STATUS_CAPABILITIES,
        extra_unavailable={
            "extend": "disabled_in_code (router writes and pip installs are not allowed)",
            "reload": "not_implemented",
        },
    )
    return {
        'success': True,
        'level': 9,
        'name': 'Architect',
        'status': 'active' if "design" in report["capabilities"] else 'limited',
        'mode': 'advice_only',
        'capabilities': report["capabilities"],
        'unavailable': report["unavailable"],
        'mounted_routes': report["mounted_routes"],
        'model_lane': {
            'last_success_at': _LAST_DESIGN["ok_at"],
            'last_failure_at': _LAST_DESIGN["failed_at"],
            'last_status': _LAST_DESIGN["last_status"],
        },
    }
