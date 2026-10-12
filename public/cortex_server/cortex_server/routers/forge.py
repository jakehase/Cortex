"""Forge Router (L27)

Forge is a *code scaffold generator* for Cortex levels.  Generated endpoints are
honest scaffolds: every handler other than ``/status`` raises HTTP 501 with
``error: not_implemented`` until a developer implements it, and generated code is
syntax-checked but never executed.  ``POST /review`` adds a provider-backed review
(``level_model``) on top of deterministic checks.

Design goals:
- Generate code safely (no execution).
- Human-in-the-loop workflow: propose → approve → commit (allowlist-only disk write).
- Input validation + size limits to prevent abuse.

NOTE: Commit is approval-gated and allowlist-restricted to cortex_server/{routers,modules}.
"""

from __future__ import annotations

import ast
import difflib
import hashlib
import json
import keyword
import time
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from textwrap import dedent
from typing import Any, Dict, List, Literal, Optional

import httpx

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from cortex_server.internal_addressing import health_probe_headers, internal_url
from cortex_server.modules.execution_capabilities import (
    ExecutionCapabilityDenied,
    ExecutionGrant,
    authorize_execution_request,
    execution_capability_status,
    resolve_authorized_path,
)
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
    require_action_capability,
)
from cortex_server.modules.level_route_status import capability_report

router = APIRouter()

COUNCIL_REVIEW_URL = internal_url("/council/review")
COUNCIL_TIMEOUT = 12.0


def _grant(http_request: Request, action: str) -> ExecutionGrant:
    try:
        return authorize_execution_request(http_request, action)
    except ExecutionCapabilityDenied as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error": exc.code, "message": exc.detail, "action": action},
        ) from exc


def _authorize_state_path(grant: ExecutionGrant, action: str) -> None:
    resolve_authorized_path(grant, action, _STATE_PATH)


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
    # Prevent escaping or closing docstrings in generated code, and keep
    # continuation lines inside the templates' 8-space dedent margin.
    desc = desc.replace("\\", "\\\\").replace('"', '\\"')
    return desc.replace("\r", "").replace("\n", "\n        ")


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


SCAFFOLD_BANNER = (
    "# FORGE SCAFFOLD (L27): generated stub, not an implementation.\n"
    "# Every endpoint below except /status raises HTTP 501 until a developer implements it.\n"
)


def _endpoint_stub(snake_name: str, method: str, path: str) -> str:
    """One honest 501 stub for an endpoint the caller asked for."""
    func_name = re.sub(r"[^a-z0-9_]", "_", path.strip("/").replace("/", "_").replace("{", "").replace("}", "").lower()) or "root"
    params = []
    for name in re.findall(r"\{([^}]*)\}", path):
        if name.isidentifier() and not keyword.iskeyword(name) and name not in params:
            params.append(name)
    signature = ", ".join(f"{name}: str" for name in params)
    return f'''

@router.{method.lower()}("{path}")
async def {snake_name}_{method.lower()}_{func_name}({signature}):
    """SCAFFOLD: {method} {path} is not implemented yet."""
    raise HTTPException(
        status_code=501,
        detail={{"success": False, "error": "not_implemented", "scaffold": True, "endpoint": "{method} {path}"}},
    )
'''


def _generate_standard_router(level_number: int, level_name: str, description: str, endpoints: Optional[List[str]]) -> str:
    """Generate a standard FastAPI router scaffold (unimplemented endpoints return 501)."""
    snake_name = _safe_snake(level_name)

    extra_endpoints = ""
    if endpoints:
        for ep in endpoints:
            parts = ep.strip().split(" ", 1)
            if len(parts) != 2:
                continue
            method, path = parts[0].upper(), parts[1]
            path = path if path.startswith("/") else f"/{path}"
            if method == "GET" and path == "/status":
                continue
            extra_endpoints += _endpoint_stub(snake_name, method, path)

    return SCAFFOLD_BANNER + dedent(
        f'''\
        """
        {level_name} Router - API endpoints for L{level_number} {level_name}.

        {description}
        """

        from fastapi import APIRouter, HTTPException

        router = APIRouter()


        @router.get("/status")
        async def {snake_name}_status():
            """Scaffold status: reports honestly that nothing is implemented yet."""
            return {{
                "success": True,
                "level": {level_number},
                "name": "{level_name}",
                "status": "scaffold",
                "implemented": False,
                "capabilities": [],
            }}
        '''
    ) + extra_endpoints


def _generate_module_with_router(level_number: int, level_name: str, description: str, endpoints: Optional[List[str]]) -> str:
    """Generate a module class + router wrapper."""
    class_name = "".join(word.capitalize() for word in level_name.replace("-", " ").replace("_", " ").split())
    snake_name = _safe_snake(level_name)

    return SCAFFOLD_BANNER + dedent(
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
                    "status": "scaffold",
                    "implemented": False,
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

    return SCAFFOLD_BANNER + dedent(
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
                "status": "scaffold",
                "implemented": False,
                "items_stored": len(_store),
                "storage": "in-process memory (lost on restart)",
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
            """SCAFFOLD: processing logic is not implemented yet."""
            raise HTTPException(
                status_code=501,
                detail={{"success": False, "error": "not_implemented", "scaffold": True, "endpoint": "POST /process"}},
            )


        @router.get("/results")
        async def {snake_name}_results():
            return {{"success": True, "results": _store[-20:]}}
    '''
    )


def _generate_minimal(level_number: int, level_name: str, description: str, endpoints: Optional[List[str]]) -> str:
    snake_name = _safe_snake(level_name)
    return SCAFFOLD_BANNER + dedent(
        f'''\
        """L{level_number}: {level_name} - {description}"""

        from fastapi import APIRouter

        router = APIRouter()


        @router.get("/status")
        async def {snake_name}_status():
            return {{"level": {level_number}, "name": "{level_name}", "status": "scaffold", "implemented": False}}
    '''
    )


_GENERATORS = {
    "standard_router": _generate_standard_router,
    "module_with_router": _generate_module_with_router,
    "data_processor": _generate_data_processor,
    "minimal": _generate_minimal,
}


# ---------------------------------------------------------------------------
# Proposal store (mutable state must stay outside the immutable release)
# ---------------------------------------------------------------------------

_STATE_PATH = Path(
    os.getenv("CORTEX_FORGE_STATE_PATH", "/opt/clawdbot/state/forge/proposals.json")
).expanduser()
if not _STATE_PATH.is_absolute():
    raise ValueError("CORTEX_FORGE_STATE_PATH must be absolute")
_STATE_ERROR: Optional[str] = None


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
    global _PROPOSALS, _STATE_ERROR
    try:
        if not _STATE_PATH.exists():
            _STATE_ERROR = None
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
        _STATE_ERROR = None
    except Exception as exc:
        # Fail closed: start empty if state is corrupt.
        _PROPOSALS = {}
        _STATE_ERROR = f"load_failed:{type(exc).__name__}"


def _save_state() -> None:
    global _STATE_ERROR
    tmp: Optional[Path] = None
    try:
        payload = {
            "saved_at": _now_iso(),
            "proposals": [p.model_dump() for p in _PROPOSALS.values()],
        }
        _STATE_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(_STATE_PATH.parent, 0o700)
        tmp = _STATE_PATH.with_name(f".{_STATE_PATH.name}.{os.getpid()}.tmp")
        data = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
        descriptor = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        except BaseException:
            try:
                os.close(descriptor)
            except OSError:
                pass
            raise
        os.replace(tmp, _STATE_PATH)
        directory = os.open(_STATE_PATH.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        _STATE_ERROR = None
    except Exception as exc:
        _STATE_ERROR = f"save_failed:{type(exc).__name__}"
        try:
            if tmp is not None:
                tmp.unlink(missing_ok=True)
        except Exception:
            pass
        raise


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
    scaffold: bool = True
    syntax_ok: bool = True
    not_implemented_endpoints: List[str] = Field(default_factory=list)
    code_sha256: Optional[str] = None
    note: str = "Scaffold only: endpoints other than /status raise HTTP 501 until implemented."


class ReviewRequest(BaseModel):
    """Review inline code, or a scaffold generated from a GenerateRequest. No writes."""

    code: Optional[str] = Field(default=None, max_length=60_000)
    generate: Optional[GenerateRequest] = None
    intent: str = Field(default="", max_length=2000)


class ForgeReviewOut(BaseModel):
    summary: str = Field(min_length=1, max_length=1200)
    verdict: Literal["approve", "revise", "reject"]
    risks: List[Dict[str, str]] = Field(default_factory=list, max_length=8)
    missing_tests: List[str] = Field(default_factory=list, max_length=8)
    implementation_gaps: List[str] = Field(default_factory=list, max_length=10)
    suggested_changes: List[str] = Field(default_factory=list, max_length=8)


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
                              code: Optional[str] = None,
                              http_request: Optional[Request] = None) -> dict:
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

    # In-process Council review: the former HTTP self-call carried no write
    # token and timed out (12 s) before a real model review could finish.
    from cortex_server.modules.level_model import scope_key_for_request
    from cortex_server.routers import council

    try:
        j = await council.council_review_core(
            kind=payload["kind"],
            title=payload["title"],
            context=payload.get("context"),
            target_path=payload.get("target_path"),
            diff=payload.get("diff"),
            code=payload.get("code"),
            risk_tolerance="low",
            principal_scope_key=scope_key_for_request(http_request, "council"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Council review failed: {type(e).__name__}")
    if not isinstance(j, dict) or not j.get("success"):
        raise HTTPException(status_code=502, detail="Council review failed: no validated decision")
    return j

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
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise HTTPException(status_code=500, detail=f"generated scaffold failed syntax validation (line {exc.lineno})") from exc

    return GenerateResponse(
        success=True,
        level_number=int(req.level_number),
        level_name=level_name,
        filename=filename,
        code=code,
        lines=code.count("\n") + 1,
        scaffold=True,
        syntax_ok=True,
        not_implemented_endpoints=_not_implemented_endpoints(tree),
        code_sha256=hashlib.sha256(code.encode("utf-8")).hexdigest(),
    )


def _route_of(node: ast.AST) -> Optional[str]:
    for dec in getattr(node, "decorator_list", []):
        if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.args \
                and isinstance(dec.args[0], ast.Constant) and isinstance(dec.args[0].value, str):
            return f"{dec.func.attr.upper()} {dec.args[0].value}"
    return None


def _not_implemented_endpoints(tree: ast.AST) -> List[str]:
    """Routes in generated code whose handler raises 501 (deterministic AST scan)."""
    out: List[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        route = _route_of(node)
        if not route:
            continue
        for inner in ast.walk(node):
            if isinstance(inner, ast.keyword) and inner.arg == "status_code" and \
                    isinstance(inner.value, ast.Constant) and inner.value.value == 501:
                out.append(route)
                break
    return out


def static_scaffold_checks(code: str) -> Dict[str, Any]:
    """Deterministic checks used by /review (and its adapter)."""
    from cortex_server.modules.lab_analysis import static_analysis

    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return {"syntax_ok": False, "error": {"line": exc.lineno, "message": str(exc.msg)}, "static_check_passed": False}
    risk = static_analysis(code)
    fake_success = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict):
            values = {k.value: v for k, v in zip(node.value.keys, node.value.values) if isinstance(k, ast.Constant)}
            msg = values.get("message")
            if "success" in values and isinstance(msg, ast.Constant) and isinstance(msg.value, str) \
                    and "not yet implemented" in msg.value.lower():
                fake_success.append(node.lineno)
    routes = sorted({r for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                     for r in [_route_of(n)] if r})
    return {
        "syntax_ok": True,
        "routes": routes,
        "not_implemented_endpoints": _not_implemented_endpoints(tree),
        "fake_success_stubs_at_lines": fake_success,
        "risk_findings": risk.get("findings", [])[:20],
        "static_check_passed": bool(risk.get("static_check_passed")) and not fake_success,
    }


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

_STATUS_CAPABILITIES = {
    "scaffold_generation": [("POST", "/generate")],
    "template_listing": [("GET", "/templates")],
    "model_code_review": [("POST", "/review")],
    "propose": [("POST", "/propose")],
    "reject": [("POST", "/reject")],
    "proposal_listing": [("GET", "/proposals"), ("GET", "/proposals/{proposal_id}")],
    "approve": [("POST", "/approve")],
    "decision_by_code": [("POST", "/decision")],
    "commit_to_disk": [("POST", "/commit")],
    "approval_inbox": [("GET", "/inbox")],
}
_ACTION_FOR_CAPABILITY = {
    "propose": "forge.propose",
    "reject": "forge.reject",
    "approve": "forge.approve",
    "decision_by_code": "forge.decision",
    "commit_to_disk": "forge.commit",
}
_REVIEW_LANE: Dict[str, Any] = {"last_ok_at": None, "last_failure_at": None, "last_status": None}


@router.get("/status")
async def forge_status(request: Request = None):
    pending = sum(1 for p in _PROPOSALS.values() if p.status == "proposed")
    approved = sum(1 for p in _PROPOSALS.values() if p.status == "approved")
    committed = sum(1 for p in _PROPOSALS.values() if p.status == "committed")

    capability_policy = execution_capability_status(
        required_actions=("forge.propose", "forge.reject"),
    )
    state_healthy = _STATE_ERROR is None and _STATE_PATH.is_absolute()
    enabled_actions = set(execution_capability_status(required_action_prefixes=("forge.",)).get("executableActions") or [])
    token_ready = bool(capability_policy.get("capabilityTokenConfigured")) and bool(capability_policy.get("allowedRoots"))
    blocked: Dict[str, str] = {}
    for name, action in _ACTION_FOR_CAPABILITY.items():
        if action not in enabled_actions or not token_ready:
            blocked[name] = f"execution action {action} not enabled"
        elif not state_healthy:
            blocked[name] = "proposal state unavailable"
    report = capability_report(request, "/forge", _STATUS_CAPABILITIES, extra_unavailable=blocked)
    return {
        "success": True,
        "level": 27,
        "name": "Forge",
        "status": "active" if report["capabilities"] else "limited",
        "templates_available": len(TEMPLATES),
        "proposals": {
            "pending": pending,
            "approved": approved,
            "committed": committed,
            "total": len(_PROPOSALS),
        },
        "capabilities": report["capabilities"],
        "unavailable": report["unavailable"],
        "mounted_routes": report["mounted_routes"],
        "scaffold_policy": "generated endpoints raise HTTP 501 until implemented; generated code is never executed",
        "review_lane": dict(_REVIEW_LANE),
        "executionCapabilityPolicy": capability_policy,
        "state": {
            "healthy": state_healthy,
            "error": _STATE_ERROR,
            "mutableExternalPath": True,
        },
    }


@router.get("/health")
async def forge_health(request: Request = None):
    # Simple alias for monitoring systems.
    return await forge_status(request)


@router.get("/templates")
async def list_templates():
    return {"success": True, "templates": TEMPLATES}


@router.post("/generate", response_model=GenerateResponse)
async def generate_router(request: GenerateRequest):
    # Back-compat: just generate & return code.
    return _validated_generate(request)


FORGE_REVIEW_SYSTEM = (
    "You are L27 Forge's code reviewer. Review the supplied FastAPI router/module code against the stated intent. "
    "Report concrete risks (security, correctness, missing validation, unsafe I/O), the tests that are missing, and "
    "the implementation gaps (endpoints that are stubs or do not do what the intent needs). Scaffolds that raise 501 "
    "are honest placeholders: list them as gaps, not as bugs. Never claim code works if it is a stub. Return ONLY JSON "
    "with keys: summary, verdict (approve|revise|reject), risks[{risk, severity}], missing_tests[], "
    "implementation_gaps[], suggested_changes[]."
)


async def review_code(code: str, *, intent: str, principal_scope_key: str) -> Dict[str, Any]:
    """Static checks + provider-backed review. Model failure -> static_checks_only, no invented review."""
    from cortex_server.modules import level_model

    static = static_scaffold_checks(code)
    prompt = (
        f"Intent: {intent or 'unspecified'}\n\n"
        f"Deterministic checks: {json.dumps({k: v for k, v in static.items() if k != 'risk_findings'})[:3000]}\n"
        f"Static risk findings: {json.dumps(static.get('risk_findings', []))[:3000]}\n\n"
        f"Code:\n```python\n{code[:40000]}\n```"
    )
    result = await level_model.level_model_json(
        level=27, name="forge", system=FORGE_REVIEW_SYSTEM, prompt=prompt,
        principal_scope_key=principal_scope_key, schema=ForgeReviewOut, deadline_s=60.0,
    )
    _REVIEW_LANE["last_status"] = result.get("status")
    if not result.get("ok"):
        _REVIEW_LANE["last_failure_at"] = time.time()
        payload = level_model.unavailable_payload(result, operation="forge.review")
        payload.update(review=None, fallback="static_checks_only", static_checks=static)
        return payload
    _REVIEW_LANE["last_ok_at"] = time.time()
    return {
        "success": True,
        "operation": "forge.review",
        "origin": "model",
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
        "review": result.get("data"),
        "static_checks": static,
    }


@router.post("/review")
async def forge_review(request: ReviewRequest, http_request: Request = None):
    """Read-only review of inline code or a freshly generated scaffold. Never writes or executes."""
    from cortex_server.modules.level_model import scope_key_for_request

    if bool(request.code) == bool(request.generate):
        raise HTTPException(status_code=400, detail="provide exactly one of code or generate")
    generated = None
    code = request.code or ""
    if request.generate is not None:
        generated = _validated_generate(request.generate)
        code = generated.code
    result = await review_code(
        code, intent=request.intent or (request.generate.description if request.generate else ""),
        principal_scope_key=scope_key_for_request(http_request, "forge"),
    )
    if generated is not None:
        result["generated"] = {"filename": generated.filename, "lines": generated.lines,
                               "code_sha256": generated.code_sha256}
    return result


@router.post("/propose", response_model=ProposeResponse)
async def propose_router(
    request: ProposeRequest,
    http_request: Request,
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    assert_action_authorized(authorization)
    grant = _grant(http_request, "forge.propose")
    _authorize_state_path(grant, "forge.propose")
    gen = _validated_generate(request)

    # Council gate (machine-actionable review)
    council = await _call_council_review(
        kind="forge_propose",
        title=f"Forge propose: {gen.filename}",
        context=f"template={request.template}; target_dir={request.target_dir}; target_path={request.target_path or gen.filename}",
        target_path=f"{request.target_dir}/{request.target_path or gen.filename}",
        code=gen.code,
        http_request=http_request,
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
    try:
        _save_state()
    except Exception as exc:
        _PROPOSALS.pop(prop.id, None)
        raise HTTPException(
            status_code=503,
            detail="Forge proposal persistence is unavailable",
        ) from exc

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

    # GET is read-only.  Legacy mark_notified is retained in the schema but no
    # longer mutates approval state; callers must use an authorized POST flow.
    mark_notified = False

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
async def forge_decision(request: DecisionRequest, http_request: Request):
    grant = _grant(http_request, "forge.decision")
    _authorize_state_path(grant, "forge.decision")
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
        return {
            "success": True,
            "message": f"Approved {code}; auto-commit is disabled at the capability boundary",
            "auto_commit": False,
            "commit_required": True,
            "proposal": prop.model_dump(exclude={"code", "approve_token"}),
        }

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
    return {"success": True, "proposal": p.model_dump(exclude={"approve_token", "approval_code"})}


@router.post("/approve")
async def approve_proposal(request: ApproveRequest, http_request: Request):
    grant = _grant(http_request, "forge.approve")
    _authorize_state_path(grant, "forge.approve")
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
async def reject_proposal(
    request: ApproveRequest,
    http_request: Request,
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    assert_action_authorized(authorization)
    grant = _grant(http_request, "forge.reject")
    _authorize_state_path(grant, "forge.reject")
    p = _PROPOSALS.get(request.id)
    if not p:
        raise HTTPException(status_code=404, detail="proposal not found")
    if request.token != p.approve_token:
        raise HTTPException(status_code=403, detail="invalid approval token")
    if p.status == "committed":
        raise HTTPException(status_code=400, detail="cannot reject a committed proposal")

    before = p.model_copy(deep=True)
    p.status = "rejected"
    p.rejected_at = _now_iso()
    p.approved_by = request.approved_by

    _PROPOSALS[p.id] = p
    try:
        _save_state()
    except Exception as exc:
        _PROPOSALS[p.id] = before
        raise HTTPException(
            status_code=503,
            detail="Forge proposal persistence is unavailable",
        ) from exc

    return {"success": True, "proposal": p.model_dump(exclude={"code", "approve_token", "approval_code"}), "message": "Rejected."}


@router.post("/commit")
async def commit_proposal(request: CommitRequest, http_request: Request):
    grant = _grant(http_request, "forge.commit")
    _authorize_state_path(grant, "forge.commit")
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
    if dest != base_res and base_res not in dest.parents:
        raise HTTPException(status_code=400, detail="target_path escapes allowlist")
    try:
        dest = resolve_authorized_path(grant, "forge.commit", dest)
    except ExecutionCapabilityDenied as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error": exc.code, "message": exc.detail, "action": "forge.commit"},
        ) from exc

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
        http_request=http_request,
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
