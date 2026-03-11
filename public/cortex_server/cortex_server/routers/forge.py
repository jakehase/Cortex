"""Forge Router (L27)

Forge is a *code scaffold generator* for Cortex levels.

Design goals:
- Generate code safely (no execution).
- Human-in-the-loop workflow: propose → approve → commit (allowlist-only disk write).
- Input validation + size limits to prevent abuse.

NOTE: Commit is approval-gated and allowlist-restricted to cortex_server/{routers,modules}.
"""

from __future__ import annotations

import difflib
import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from textwrap import dedent
from typing import Any, Dict, List, Literal, Optional

import httpx

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter()

COUNCIL_REVIEW_URL = "http://localhost:8888/council/review"
COUNCIL_TIMEOUT = 12.0


# ---------------------------------------------------------------------------
# Limits / validation
# ---------------------------------------------------------------------------

MAX_LEVEL_NAME_LEN = 80
MAX_DESCRIPTION_LEN = 2000
MAX_ENDPOINTS = 25
MAX_ENDPOINT_LEN = 80

SAFE_LEVEL_NAME_RE = re.compile(r"^[A-Za-z0-9 _-]{1,80}$")
SAFE_ENDPOINT_RE = re.compile(r"^(GET|POST|PUT|PATCH|DELETE)\s+(/[A-Za-z0-9_\-/{}/]*)$")


def _now_iso() -> str:
    return datetime.now().isoformat()


def _validate_level_name(name: str) -> str:
    name = (name or "").strip()
    if not name or len(name) > MAX_LEVEL_NAME_LEN or not SAFE_LEVEL_NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid level_name. Use 1–80 chars: letters/numbers/spaces/_/-. "
                "(No quotes, slashes, or punctuation.)"
            ),
        )
    return name


def _safe_snake(name: str) -> str:
    # Used only for generated identifiers.
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "level"


def _sanitize_description(desc: str) -> str:
    desc = (desc or "").strip()
    if len(desc) > MAX_DESCRIPTION_LEN:
        raise HTTPException(status_code=400, detail=f"description too long (max {MAX_DESCRIPTION_LEN})")
    # Prevent closing docstrings in generated code.
    return desc.replace('"""', "\\\"\\\"\\\"")


def _validate_endpoints(endpoints: Optional[List[str]]) -> Optional[List[str]]:
    if endpoints is None:
        return None
    if not isinstance(endpoints, list):
        raise HTTPException(status_code=400, detail="endpoints must be a list of strings")
    if len(endpoints) > MAX_ENDPOINTS:
        raise HTTPException(status_code=400, detail=f"too many endpoints (max {MAX_ENDPOINTS})")

    out: List[str] = []
    for ep in endpoints:
        ep = (ep or "").strip()
        if not ep:
            continue
        if len(ep) > MAX_ENDPOINT_LEN:
            raise HTTPException(status_code=400, detail=f"endpoint too long: {ep[:40]}…")
        m = SAFE_ENDPOINT_RE.match(ep)
        if not m:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Invalid endpoint format. Use like: 'GET /status' or 'POST /process'. "
                    "Paths must start with /."
                ),
            )
        out.append(ep)

    return out or None


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

TEMPLATES: Dict[str, Dict[str, Any]] = {
    "standard_router": {
        "name": "Standard Router",
        "description": "FastAPI APIRouter with /status endpoint and Pydantic models",
        "includes": ["status", "pydantic_models", "docstrings"],
    },
    "module_with_router": {
        "name": "Module + Router",
        "description": "A module class with singleton + a router that wraps it",
        "includes": ["module_class", "singleton", "router", "status"],
    },
    "data_processor": {
        "name": "Data Processor",
        "description": "Router with /ingest, /process, /results endpoints",
        "includes": ["status", "ingest", "process", "results"],
    },
    "minimal": {
        "name": "Minimal",
        "description": "Bare-bones router with just /status",
        "includes": ["status"],
    },
}


def _generate_standard_router(level_number: int, level_name: str, description: str, endpoints: Optional[List[str]]) -> str:
    """Generate a standard FastAPI router file."""
    snake_name = _safe_snake(level_name)

    extra_endpoints = ""
    if endpoints:
        for ep in endpoints:
            parts = ep.strip().split(" ", 1)
            if len(parts) != 2:
                continue
            method, path = parts[0].upper(), parts[1]
            path = path if path.startswith("/") else f"/{path}"
            func_name = path.strip("/").replace("/", "_").replace("{", "").replace("}", "") or "root"
            extra_endpoints += f'''

@router.{method.lower()}("{path}")
async def {snake_name}_{func_name}():
    """TODO: Implement {method} {path}."""
    return {{"success": True, "message": "Not yet implemented"}}
'''

    return dedent(
        f'''\
        """
        {level_name} Router - API endpoints for L{level_number} {level_name}.

        {description}
        """

        from datetime import datetime
        from typing import Optional

        from fastapi import APIRouter, HTTPException
        from pydantic import BaseModel

        router = APIRouter()


        @router.get("/status")
        async def {snake_name}_status():
            """Return {level_name} status and capabilities."""
            return {{
                "success": True,
                "level": {level_number},
                "name": "{level_name}",
                "status": "active",
                "capabilities": [],
            }}
        {extra_endpoints}
    '''
    )


def _generate_module_with_router(level_number: int, level_name: str, description: str, endpoints: Optional[List[str]]) -> str:
    """Generate a module class + router wrapper."""
    class_name = "".join(word.capitalize() for word in level_name.replace("-", " ").replace("_", " ").split())
    snake_name = _safe_snake(level_name)

    return dedent(
        f'''\
        """
        {level_name} - L{level_number}: {description}
        """

        from datetime import datetime
        from typing import Optional

        from fastapi import APIRouter, HTTPException
        from pydantic import BaseModel


        class {class_name}:
            """L{level_number}: {description}"""

            def __init__(self):
                self.level = {level_number}
                self.name = "{level_name}"

            def status(self) -> dict:
                return {{
                    "level": self.level,
                    "name": self.name,
                    "status": "active",
                }}


        _{snake_name}_instance: Optional[{class_name}] = None


        def get_{snake_name}() -> {class_name}:
            global _{snake_name}_instance
            if _{snake_name}_instance is None:
                _{snake_name}_instance = {class_name}()
            return _{snake_name}_instance


        router = APIRouter()


        @router.get("/status")
        async def {snake_name}_status():
            return get_{snake_name}().status()
    '''
    )


def _generate_data_processor(level_number: int, level_name: str, description: str, endpoints: Optional[List[str]]) -> str:
    """Generate a data-processor style router."""
    snake_name = _safe_snake(level_name)

    return dedent(
        f'''\
        """
        {level_name} Router - L{level_number}: {description}
        """

        from datetime import datetime
        from typing import Any, Dict, List, Optional

        from fastapi import APIRouter, HTTPException
        from pydantic import BaseModel

        router = APIRouter()

        _store: List[dict] = []


        class IngestRequest(BaseModel):
            data: Dict[str, Any]
            source: Optional[str] = None


        class ProcessRequest(BaseModel):
            query: Optional[str] = None


        @router.get("/status")
        async def {snake_name}_status():
            return {{
                "success": True,
                "level": {level_number},
                "name": "{level_name}",
                "status": "active",
                "items_stored": len(_store),
            }}


        @router.post("/ingest")
        async def {snake_name}_ingest(request: IngestRequest):
            _store.append({{
                "data": request.data,
                "source": request.source,
                "ingested_at": datetime.now().isoformat(),
            }})
            return {{"success": True, "total_items": len(_store)}}


        @router.post("/process")
        async def {snake_name}_process(request: ProcessRequest):
            return {{
                "success": True,
                "processed_items": len(_store),
                "query": request.query,
                "results": [],
            }}


        @router.get("/results")
        async def {snake_name}_results():
            return {{"success": True, "results": _store[-20:]}}
    '''
    )


def _generate_minimal(level_number: int, level_name: str, description: str, endpoints: Optional[List[str]]) -> str:
    snake_name = _safe_snake(level_name)
    return dedent(
        f'''\
        """L{level_number}: {level_name} - {description}"""

        from fastapi import APIRouter

        router = APIRouter()


        @router.get("/status")
        async def {snake_name}_status():
            return {{"level": {level_number}, "name": "{level_name}", "status": "active"}}
    '''
    )


_GENERATORS = {
    "standard_router": _generate_standard_router,
    "module_with_router": _generate_module_with_router,
    "data_processor": _generate_data_processor,
    "minimal": _generate_minimal,
}


# ---------------------------------------------------------------------------
# Proposal store (persisted next to this router file)
# ---------------------------------------------------------------------------

_STATE_PATH = Path(__file__).resolve().parent / "_forge_state.json"


class Proposal(BaseModel):
    id: str
    status: Literal["proposed", "approved", "rejected", "committed"] = "proposed"

    created_at: str
    approved_at: Optional[str] = None
    committed_at: Optional[str] = None
    rejected_at: Optional[str] = None

    template: str
    level_number: int
    level_name: str
    description: str
    endpoints: Optional[List[str]] = None

    filename: str
    code: str
    lines: int

    target_dir: Literal["routers", "modules"] = "routers"
    target_path: Optional[str] = None  # relative to target_dir

    approve_token: str
    approval_code: str
    approved_by: Optional[str] = None

    notified_at: Optional[str] = None

    committed_path: Optional[str] = None
    diff: Optional[str] = None

    council_review: Optional[dict] = None
    council_reviewed_at: Optional[str] = None


_PROPOSALS: Dict[str, Proposal] = {}




def _new_approval_code() -> str:
    """6-char approval code for WhatsApp confirm/deny."""
    for _ in range(2000):
        code = uuid.uuid4().hex[:6].upper()
        if all(getattr(p, 'approval_code', None) != code for p in _PROPOSALS.values()):
            return code
    return uuid.uuid4().hex[:10].upper()

def _load_state() -> None:
    global _PROPOSALS
    try:
        if not _STATE_PATH.exists():
            return
        raw = json.loads(_STATE_PATH.read_text(encoding="utf-8"))
        items = raw.get("proposals", []) if isinstance(raw, dict) else []
        out: Dict[str, Proposal] = {}
        for it in items:
            try:
                p = Proposal.model_validate(it)
                out[p.id] = p
            except Exception:
                continue
        _PROPOSALS = out
    except Exception:
        # Fail closed: start empty if state is corrupt.
        _PROPOSALS = {}


def _save_state() -> None:
    try:
        payload = {
            "saved_at": _now_iso(),
            "proposals": [p.model_dump() for p in _PROPOSALS.values()],
        }
        tmp = _STATE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(_STATE_PATH)
    except Exception:
        # Best-effort persistence.
        return


_load_state()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    level_number: int
    level_name: str
    description: str
    endpoints: Optional[List[str]] = None
    template: str = "standard_router"


class GenerateResponse(BaseModel):
    success: bool
    level_number: int
    level_name: str
    filename: str
    code: str
    lines: int


class ProposeRequest(GenerateRequest):
    target_dir: Literal["routers", "modules"] = "routers"
    # Optional explicit target path relative to target_dir (e.g. "my_level.py")
    target_path: Optional[str] = None


class ProposeResponse(BaseModel):
    success: bool = True
    proposal: Proposal


class ApproveRequest(BaseModel):
    id: str
    token: str
    approved_by: Optional[str] = None
    override: bool = Field(default=False, description="Allow override if Council is unavailable")


class CommitRequest(BaseModel):
    id: str
    token: str
    confirm: bool = Field(default=False, description="Must be true to write to disk")
    dry_run: bool = Field(default=True, description="If true, compute diff but do not write")
    overwrite: bool = Field(default=False, description="Allow overwriting existing file")

class DecisionRequest(BaseModel):
    code: str = Field(..., description="Short approval code shown in WhatsApp")
    decision: Literal["approve", "reject"]
    approved_by: Optional[str] = None
    auto_commit: bool = Field(default=True, description="If approve, auto-commit to disk")



# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------




async def _call_council_review(*, kind: str, title: str, context: Optional[str] = None,
                              target_path: Optional[str] = None, diff: Optional[str] = None,
                              code: Optional[str] = None) -> dict:
    payload: Dict[str, Any] = {
        "kind": kind,
        "title": title,
        "context": context,
        "target_path": target_path,
        "diff": diff,
        "code": code,
        "risk_tolerance": "low",
    }
    # Trim big fields proactively
    if payload.get("diff") and isinstance(payload["diff"], str) and len(payload["diff"]) > 12000:
        payload["diff"] = payload["diff"][:12000] + "\n…(truncated)"
    if payload.get("code") and isinstance(payload["code"], str) and len(payload["code"]) > 12000:
        payload["code"] = payload["code"][:12000] + "\n…(truncated)"

    async with httpx.AsyncClient(timeout=COUNCIL_TIMEOUT) as client:
        try:
            r = await client.post(COUNCIL_REVIEW_URL, json=payload)
            r.raise_for_status()
            j = r.json()
            if not isinstance(j, dict) or not j.get("success"):
                raise RuntimeError("council_review_failed")
            return j
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Council review failed: {e}")

def _validated_generate(req: GenerateRequest) -> GenerateResponse:
    level_name = _validate_level_name(req.level_name)
    description = _sanitize_description(req.description)
    endpoints = _validate_endpoints(req.endpoints)

    generator = _GENERATORS.get(req.template)
    if generator is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown template: {req.template}. Use /templates to list available.",
        )

    code = generator(
        level_number=int(req.level_number),
        level_name=level_name,
        description=description,
        endpoints=endpoints,
    )

    filename = _safe_snake(level_name) + ".py"

    return GenerateResponse(
        success=True,
        level_number=int(req.level_number),
        level_name=level_name,
        filename=filename,
        code=code,
        lines=code.count("\n") + 1,
    )


def _get_base_dirs() -> Dict[str, Path]:
    # forge.py lives in cortex_server/routers/forge.py
    base = Path(__file__).resolve().parents[1]
    return {
        "routers": base / "routers",
        "modules": base / "modules",
    }


def _safe_rel_path(rel: str) -> str:
    rel = (rel or "").strip().lstrip("/")
    if not rel:
        raise HTTPException(status_code=400, detail="target_path is empty")
    if ".." in rel or rel.startswith("~"):
        raise HTTPException(status_code=400, detail="target_path must not contain '..' or '~'")
    if not rel.endswith(".py"):
        raise HTTPException(status_code=400, detail="target_path must end with .py")
    if len(rel) > 160:
        raise HTTPException(status_code=400, detail="target_path too long")
    if not re.fullmatch(r"[A-Za-z0-9_./-]+", rel):
        raise HTTPException(status_code=400, detail="target_path contains invalid characters")
    return rel


def _compute_diff(old: str, new: str, path: str) -> str:
    a = old.splitlines(keepends=True)
    b = new.splitlines(keepends=True)
    return "".join(
        difflib.unified_diff(a, b, fromfile=f"a/{path}", tofile=f"b/{path}")
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
async def forge_status():
    pending = sum(1 for p in _PROPOSALS.values() if p.status == "proposed")
    approved = sum(1 for p in _PROPOSALS.values() if p.status == "approved")
    committed = sum(1 for p in _PROPOSALS.values() if p.status == "committed")

    return {
        "success": True,
        "level": 27,
        "name": "Forge",
        "status": "active",
        "templates_available": len(TEMPLATES),
        "proposals": {
            "pending": pending,
            "approved": approved,
            "committed": committed,
            "total": len(_PROPOSALS),
        },
        "capabilities": [
            "auto_module_generation",
            "skeleton_router_creation",
            "template_selection",
            "code_preview",
            "propose_approve_commit",
            "diff_preview",
            "allowlist_disk_write",
        ],
    }


@router.get("/health")
async def forge_health():
    # Simple alias for monitoring systems.
    return await forge_status()


@router.get("/templates")
async def list_templates():
    return {"success": True, "templates": TEMPLATES}


@router.post("/generate", response_model=GenerateResponse)
async def generate_router(request: GenerateRequest):
    # Back-compat: just generate & return code.
    return _validated_generate(request)


@router.post("/propose", response_model=ProposeResponse)
async def propose_router(request: ProposeRequest):
    gen = _validated_generate(request)

    # Council gate (machine-actionable review)
    council = await _call_council_review(
        kind="forge_propose",
        title=f"Forge propose: {gen.filename}",
        context=f"template={request.template}; target_dir={request.target_dir}; target_path={request.target_path or gen.filename}",
        target_path=f"{request.target_dir}/{request.target_path or gen.filename}",
        code=gen.code,
    )

    proposal_id = str(uuid.uuid4())
    token = uuid.uuid4().hex
    approval_code = _new_approval_code()

    target_path = request.target_path
    if target_path is not None:
        target_path = _safe_rel_path(target_path)

    prop = Proposal(
        id=proposal_id,
        created_at=_now_iso(),
        template=request.template,
        level_number=gen.level_number,
        level_name=gen.level_name,
        description=_sanitize_description(request.description),
        endpoints=_validate_endpoints(request.endpoints),
        filename=gen.filename,
        code=gen.code,
        lines=gen.lines,
        target_dir=request.target_dir,
        target_path=target_path,
        approve_token=token,
        approval_code=approval_code,
        council_review=council,
        council_reviewed_at=_now_iso(),
    )

    _PROPOSALS[prop.id] = prop
    _save_state()

    return ProposeResponse(success=True, proposal=prop)



@router.get("/inbox")
async def forge_inbox(request: Request, limit: int = 5, include_notified: bool = False, mark_notified: bool = True):
    """Return WhatsApp-friendly pending approvals (Council-approved proposals)."""
    try:
        from cortex_server.middleware.hud_middleware import track_level
        track_level(request, 27, "Forge", always_on=False)
    except Exception:
        pass
    limit = max(1, min(25, int(limit)))

    items = []
    for prop in sorted(_PROPOSALS.values(), key=lambda x: x.created_at):
        if prop.status != "proposed":
            continue
        verdict = (prop.council_review or {}).get("verdict")
        if verdict != "APPROVE":
            continue
        if (not include_notified) and prop.notified_at:
            continue
        items.append(prop)
        if len(items) >= limit:
            break

    if mark_notified and items:
        now = _now_iso()
        for prop in items:
            if not prop.notified_at:
                prop.notified_at = now
                _PROPOSALS[prop.id] = prop
        _save_state()

    lines = []
    for prop in items:
        tgt = f"{prop.target_dir}/{prop.target_path or prop.filename}"
        lines.append(f"[{prop.approval_code}] {tgt} • template={prop.template} • lines={prop.lines}")

    message = "\n".join(lines) if lines else "(no pending approvals)"

    return {
        "success": True,
        "total": len(items),
        "items": [
            {
                "approval_code": p.approval_code,
                "id": p.id,
                "target": f"{p.target_dir}/{p.target_path or p.filename}",
                "template": p.template,
                "lines": p.lines,
                "council": p.council_review,
                "created_at": p.created_at,
            }
            for p in items
        ],
        "message": message,
        "instructions": "Reply: APPROVE <code> or REJECT <code>",
    }


@router.post("/decision")
async def forge_decision(request: DecisionRequest):
    code = (request.code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="code required")

    prop = next((p for p in _PROPOSALS.values() if getattr(p, 'approval_code', None) == code), None)
    if not prop:
        raise HTTPException(status_code=404, detail="unknown approval code")

    if request.decision == "reject":
        prop.status = "rejected"
        prop.rejected_at = _now_iso()
        prop.approved_by = request.approved_by
        _PROPOSALS[prop.id] = prop
        _save_state()
        return {"success": True, "message": f"Rejected {code}", "proposal": prop.model_dump(exclude={"code", "approve_token"})}

    verdict = (prop.council_review or {}).get('verdict')
    if verdict != 'APPROVE':
        raise HTTPException(status_code=409, detail=f"Council verdict not APPROVE (verdict={verdict}).")

    prop.status = "approved"
    prop.approved_at = _now_iso()
    prop.approved_by = request.approved_by
    _PROPOSALS[prop.id] = prop
    _save_state()

    if request.auto_commit:
        cr = await commit_proposal(CommitRequest(id=prop.id, token=prop.approve_token, confirm=True, dry_run=False, overwrite=False))
        return {"success": True, "message": f"Approved+Committed {code}", "commit": cr}

    return {"success": True, "message": f"Approved {code} (not committed)", "proposal": prop.model_dump(exclude={"code", "approve_token"})}


@router.get("/proposals")
async def list_proposals(status: Optional[str] = None, limit: int = 50):
    limit = max(1, min(200, int(limit)))
    items = list(_PROPOSALS.values())
    items.sort(key=lambda p: p.created_at, reverse=True)

    if status:
        items = [p for p in items if p.status == status]

    return {
        "success": True,
        "total": len(items),
        "proposals": [p.model_dump(exclude={"code", "approve_token", "approval_code"}) for p in items[:limit]],
    }


@router.get("/proposals/{proposal_id}")
async def get_proposal(proposal_id: str):
    p = _PROPOSALS.get(proposal_id)
    if not p:
        raise HTTPException(status_code=404, detail="proposal not found")
    return {"success": True, "proposal": p.model_dump()}


@router.post("/approve")
async def approve_proposal(request: ApproveRequest):
    p = _PROPOSALS.get(request.id)
    if not p:
        raise HTTPException(status_code=404, detail="proposal not found")
    if request.token != p.approve_token:
        raise HTTPException(status_code=403, detail="invalid approval token")
    if p.status in ("committed",):
        return {"success": True, "proposal": p.model_dump(exclude={"code"}), "message": "Already committed."}

    # Council verdict gate
    verdict = None
    try:
        verdict = (p.council_review or {}).get("verdict")
    except Exception:
        verdict = None

    if verdict != "APPROVE":
        # Allow override only when Council explicitly asked for retry (Oracle unavailable).
        reqs = ((p.council_review or {}).get("required_conditions") or [])
        if not (request.override and "retry_council_review" in reqs):
            raise HTTPException(status_code=409, detail=f"Council verdict not APPROVE (verdict={verdict}).")

    p.status = "approved"
    p.approved_at = _now_iso()
    p.approved_by = request.approved_by

    _PROPOSALS[p.id] = p
    _save_state()

    return {
        "success": True,
        "proposal": p.model_dump(exclude={"code"}),
        "message": "Approved. You can now /forge/commit with confirm=true.",
    }


@router.post("/reject")
async def reject_proposal(request: ApproveRequest):
    p = _PROPOSALS.get(request.id)
    if not p:
        raise HTTPException(status_code=404, detail="proposal not found")
    if request.token != p.approve_token:
        raise HTTPException(status_code=403, detail="invalid approval token")
    if p.status == "committed":
        raise HTTPException(status_code=400, detail="cannot reject a committed proposal")

    p.status = "rejected"
    p.rejected_at = _now_iso()
    p.approved_by = request.approved_by

    _PROPOSALS[p.id] = p
    _save_state()

    return {"success": True, "proposal": p.model_dump(exclude={"code"}), "message": "Rejected."}


@router.post("/commit")
async def commit_proposal(request: CommitRequest):
    p = _PROPOSALS.get(request.id)
    if not p:
        raise HTTPException(status_code=404, detail="proposal not found")
    if request.token != p.approve_token:
        raise HTTPException(status_code=403, detail="invalid token")
    if p.status != "approved":
        raise HTTPException(status_code=400, detail=f"proposal must be approved before commit (status={p.status})")

    base_dirs = _get_base_dirs()
    base_dir = base_dirs.get(p.target_dir)
    if not base_dir or not base_dir.exists():
        raise HTTPException(status_code=500, detail=f"target_dir not available: {p.target_dir}")

    rel = p.target_path or p.filename
    rel = _safe_rel_path(rel)
    dest = (base_dir / rel).resolve()
    base_res = base_dir.resolve()
    if not str(dest).startswith(str(base_res)):
        raise HTTPException(status_code=400, detail="target_path escapes allowlist")

    exists = dest.exists()
    if exists and not request.overwrite:
        raise HTTPException(status_code=409, detail="target file exists; pass overwrite=true to replace")

    old = ""
    if exists:
        old = dest.read_text(encoding="utf-8", errors="replace")

    diff = _compute_diff(old, p.code, f"{p.target_dir}/{rel}") if exists else ""

    council2 = await _call_council_review(
        kind="forge_commit",
        title=f"Forge commit: {p.target_dir}/{rel}",
        context=f"exists={exists}; overwrite={request.overwrite}; dry_run={request.dry_run}; confirm={request.confirm}",
        target_path=f"{p.target_dir}/{rel}",
        diff=diff,
        code=p.code,
    )
    if council2.get('verdict') != 'APPROVE':
        raise HTTPException(status_code=409, detail=f"Council blocked commit (verdict={council2.get('verdict')}).")
    p.council_review = council2
    p.council_reviewed_at = _now_iso()


    if request.dry_run or not request.confirm:
        return {
            "success": True,
            "dry_run": True,
            "confirm_required": True,
            "target": str(dest),
            "exists": exists,
            "diff": diff,
            "message": "Dry run only. Re-run with confirm=true and dry_run=false to write.",
        }

    # Write to disk (atomic)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    tmp.write_text(p.code.rstrip() + "\n", encoding="utf-8")
    tmp.replace(dest)

    p.status = "committed"
    p.committed_at = _now_iso()
    p.committed_path = str(dest)
    p.diff = diff if diff else None

    _PROPOSALS[p.id] = p
    _save_state()

    return {
        "success": True,
        "target": str(dest),
        "exists": exists,
        "diff": diff,
        "message": "Committed.",
        "proposal": p.model_dump(exclude={"code"}),
    }
