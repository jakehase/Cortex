"""
Level 19 — The Geneticist
Model-generated code candidates, deterministic fitness, and measured selection.

* Candidates come from the model through ``level_model`` (authenticated,
  in-process, principal-scoped, receipt-validated, strict JSON schema).  The old
  path made unauthenticated HTTP self-calls and accepted any fenced code block
  from a chatty answer as ``success: true``; both are gone.
* Every candidate is scored by :mod:`cortex_server.modules.geneticist_fitness`
  (compile, lint, complexity delta, diff size, new L4 static-risk findings, and
  the caller's tests — statically, or in the Lab sandbox when the caller
  presents an approval capability and execution grant).  Selection follows the
  declared ``SCORE_RULE``; a candidate that does not compile is never selected.
* Nothing here writes files except ``POST /apply``, which stays behind the
  execution grant, ``confirm``, the Sentinel preflight, a provider-backed
  Council-schema review of the exact diff, and a consumed action capability.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List, Literal
import asyncio
import difflib
from pathlib import Path
import uuid
import httpx
import time

from cortex_server.internal_addressing import internal_url
from cortex_server.modules import geneticist_fitness
from cortex_server.modules import level_model
from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
    require_action_capability,
)
from cortex_server.modules.execution_capabilities import (
    ExecutionCapabilityDenied,
    ExecutionGrant,
    authorize_execution_request,
    execution_capability_status,
    resolve_authorized_path,
)
from cortex_server.modules.level_route_status import capability_report

router = APIRouter(tags=["Geneticist"])

SENTINEL_WATCH_URL = internal_url('/sentinel/watch')
SENTINEL_SCAN_URL = internal_url('/sentinel/scan')

async def _sentinel_apply_gate() -> dict:
    """Preflight check before applying changes (no side effects)."""
    targets = [
        internal_url('/health'),
        internal_url('/oracle/status'),
        internal_url('/augmenter/status'),
    ]
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            for t in targets:
                watch_response = await client.post(SENTINEL_WATCH_URL, json={
                    'name': 'apply-gate',
                    'watch_type': 'endpoint',
                    'target': t,
                    'timeout_seconds': 1.5,
                })
                watch_response.raise_for_status()
                watch_payload = watch_response.json()
                if not isinstance(watch_payload, dict) or watch_payload.get('success') is not True or not watch_payload.get('watch_id'):
                    raise RuntimeError('malformed_sentinel_watch_response')
            r = await client.post(SENTINEL_SCAN_URL, json={})
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {'success': False, 'error': f'sentinel_apply_gate_failed:{type(e).__name__}:{e}'}


# ── Guardrails / limits ─────────────────────────────────────────────
_MAX_CODE_LEN = 200_000
_MAX_MODEL_CODE_LEN = 40_000
_MAX_HINT_LEN = 500
_MAX_FITNESS_GOAL_LEN = 500
_MAX_TESTS_LEN = 20_000
_MAX_CANDIDATES = 4
_MODEL_CONCURRENCY = 2
_ALLOWED_MUTATION_TYPES = (
    "optimize",
    "error_handling",
    "naming",
    "extract_function",
    "type_hints",
    "simplify",
    "refactor",
    "bug_fix",
)

# Model-lane circuit breaker (counts real level_model failures)
_oracle_consecutive_failures = 0
_oracle_cooldown_until = 0.0
_ORACLE_FAILURE_THRESHOLD = 3
_ORACLE_COOLDOWN_SECONDS = 45
_MODEL_LANE: Dict[str, Any] = {"last_ok_at": None, "last_failure_at": None, "last_status": None}
_SLOTS_BY_LOOP: Dict[int, asyncio.Semaphore] = {}


def _model_slots() -> asyncio.Semaphore:
    """Per-event-loop semaphore bounding concurrent candidate generation."""
    key = id(asyncio.get_running_loop())
    slots = _SLOTS_BY_LOOP.get(key)
    if slots is None:
        if len(_SLOTS_BY_LOOP) > 16:
            _SLOTS_BY_LOOP.clear()
        slots = _SLOTS_BY_LOOP[key] = asyncio.Semaphore(_MODEL_CONCURRENCY)
    return slots

# ── Module-level state ──────────────────────────────────────────────
# In-memory, principal-scoped proposal store.  Proposals are never applied
# unless /geneticist/apply passes every gate.  Lost on restart (reported in status).
_PROPOSALS: Dict[str, Dict[str, Any]] = {}
_MAX_PROPOSALS = 100
_EVICTED: Dict[str, float] = {}

def _grant(http_request: Request, action: str) -> ExecutionGrant:
    try:
        return authorize_execution_request(http_request, action)
    except ExecutionCapabilityDenied as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error": exc.code, "message": exc.detail, "action": action},
        ) from exc


def _safe_path(
    grant: ExecutionGrant,
    action: str,
    value: str | Path,
    *,
    require_file: bool = False,
) -> Path:
    try:
        return resolve_authorized_path(grant, action, value, require_file=require_file)
    except ExecutionCapabilityDenied as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error": exc.code, "message": exc.detail, "action": action},
        ) from exc


def _ensure_trailing_nl(s: str) -> str:
    if not isinstance(s, str):
        return ""
    return s if s.endswith("\n") else (s + "\n")


def _unified_diff(old: str, new: str, from_name: str = "before", to_name: str = "after") -> str:
    old = _ensure_trailing_nl(old)
    new = _ensure_trailing_nl(new)
    return "".join(
        difflib.unified_diff(
            old.splitlines(keepends=True),
            new.splitlines(keepends=True),
            fromfile=from_name,
            tofile=to_name,
        )
    )


def principal_owner(http_request: Any) -> str:
    """Stable owner key for proposal isolation (credential + principal fields)."""
    principal = getattr(getattr(http_request, "state", None), "cortex_principal", None)
    if principal is None:
        return "anonymous"
    fields = [str(getattr(principal, name, "") or "") for name in
              ("role", "credential_id", "tenant_id", "workspace_id", "user_id", "agent_id")]
    return "|".join(fields)


def _store_proposal(data: Dict[str, Any]) -> str:
    if len(_PROPOSALS) >= _MAX_PROPOSALS:
        oldest = sorted(_PROPOSALS.items(), key=lambda kv: kv[1].get("ts", 0))[:10]
        for k, _ in oldest:
            _PROPOSALS.pop(k, None)
            _EVICTED[k] = time.time()
        while len(_EVICTED) > 1000:
            _EVICTED.pop(next(iter(_EVICTED)))
    pid = str(uuid.uuid4())
    _PROPOSALS[pid] = data
    return pid


def _get_proposal(pid: str, owner: Optional[str] = None) -> Dict[str, Any]:
    p = _PROPOSALS.get(pid)
    if not p:
        if pid in _EVICTED:
            raise HTTPException(status_code=410, detail="proposal_id was evicted from the in-memory store")
        raise HTTPException(status_code=404, detail="proposal_id not found")
    stored_owner = p.get("owner")
    if owner is not None and stored_owner is not None and stored_owner != owner:
        raise HTTPException(status_code=404, detail="proposal_id not found")
    return p


geneticist_state: Dict[str, Any] = {

    "mutations_performed": 0,
    "evolutions_run": 0,
    "proposals_created": 0,
    "applies_performed": 0,
    "architect_handoffs": 0,
    "last_mutation_ts": None,
    "last_evolution_ts": None,
    "mutation_log": [],
    "rejected_contracts": 0,
    "last_error": None,
}

MAX_LOG = 50


class MutateRequest(BaseModel):
    code: str
    mutation_hint: Optional[str] = None
    tests: Optional[str] = None


class EvolveRequest(BaseModel):
    code: str
    fitness_goal: str = "make it better"
    generations: int = 1
    tests: Optional[str] = None


class ProposeRequest(BaseModel):
    """Create a proposal (no side effects).

    Inline ``code`` is the safe path.  ``target_path`` reads a file only with the
    ``geneticist.propose`` execution grant under the configured roots.
    """

    strategy: Literal["mutate", "evolve"] = "mutate"
    code: Optional[str] = None
    target_path: Optional[str] = None
    mutation_hint: Optional[str] = None
    fitness_goal: Optional[str] = None
    generations: int = 1
    candidates: int = Field(default=2, ge=1, le=_MAX_CANDIDATES)
    tests: Optional[str] = Field(default=None, max_length=_MAX_TESTS_LEN)
    run_tests_in_sandbox: bool = Field(
        default=False,
        description="Execute tests in the Lab sandbox (requires action capability + lab execution grant)",
    )


class ApplyRequest(BaseModel):
    proposal_id: str
    confirm: bool = False
    force: bool = False
    write_path: Optional[str] = None


class ProposalGetRequest(BaseModel):
    proposal_id: str


class ArchitectHandoffRequest(BaseModel):
    code: str
    strategy: Literal["mutate", "evolve"]
    objective: str
    generations: Optional[int] = 1
    mutation_hint: Optional[str] = None
    trace_id: Optional[str] = None


class CandidateOut(BaseModel):
    """Strict model contract for one candidate."""

    code: str = Field(min_length=1, max_length=_MAX_MODEL_CODE_LEN)
    mutation_type: Literal[
        "optimize", "error_handling", "naming", "extract_function", "type_hints", "simplify", "refactor", "bug_fix"
    ]
    description: str = Field(min_length=1, max_length=1200)
    expected_effect: Optional[str] = Field(default=None, max_length=600)


class CouncilDecision(BaseModel):
    """Council decision contract (same fields as routers.council)."""

    verdict: Literal["APPROVE", "NEEDS_CHANGES", "REJECT"]
    risk_score: float = Field(ge=0.0, le=1.0)
    top_concerns: List[str] = Field(default_factory=list, max_length=6)
    required_conditions: List[str] = Field(default_factory=list, max_length=6)
    rationale: str = Field(min_length=1, max_length=1200)
    suggested_changes: List[str] = Field(default_factory=list, max_length=6)


def _reject(detail: str) -> None:
    geneticist_state["rejected_contracts"] += 1
    geneticist_state["last_error"] = detail
    raise HTTPException(status_code=400, detail=detail)


def _require_code(code: str) -> str:
    if not isinstance(code, str) or not code.strip():
        _reject("code must be a non-empty string")
    if len(code) > _MAX_CODE_LEN:
        _reject(f"code exceeds max length ({_MAX_CODE_LEN})")
    return code


def _validate_mutation_hint(hint: Optional[str]) -> Optional[str]:
    if hint is None:
        return None
    if not isinstance(hint, str):
        _reject("mutation_hint must be a string")
    if len(hint) > _MAX_HINT_LEN:
        _reject(f"mutation_hint exceeds max length ({_MAX_HINT_LEN})")
    return hint


def _validate_generations(generations: int) -> int:
    if not isinstance(generations, int):
        _reject("generations must be an integer")
    if generations < 1 or generations > 3:
        _reject("generations must be between 1 and 3")
    return generations


def _validate_fitness_goal(goal: str) -> str:
    if not isinstance(goal, str) or not goal.strip():
        _reject("fitness_goal must be a non-empty string")
    if len(goal) > _MAX_FITNESS_GOAL_LEN:
        _reject(f"fitness_goal exceeds max length ({_MAX_FITNESS_GOAL_LEN})")
    return goal


def _validate_tests(tests: Optional[str]) -> Optional[str]:
    if tests is None or not str(tests).strip():
        return None
    if len(tests) > _MAX_TESTS_LEN:
        _reject(f"tests exceed max length ({_MAX_TESTS_LEN})")
    return tests


def _oracle_breaker_open() -> bool:
    return time.time() < _oracle_cooldown_until


def _oracle_breaker_seconds_remaining() -> int:
    if not _oracle_breaker_open():
        return 0
    return int(max(0, _oracle_cooldown_until - time.time()))


def _note_model_result(result: Dict[str, Any]) -> None:
    global _oracle_consecutive_failures, _oracle_cooldown_until
    _MODEL_LANE["last_status"] = result.get("status")
    if result.get("ok"):
        _oracle_consecutive_failures = 0
        _MODEL_LANE["last_ok_at"] = time.time()
        return
    _MODEL_LANE["last_failure_at"] = time.time()
    if result.get("status") in {"model_unavailable", "timeout", "model_unverified", "busy"}:
        _oracle_consecutive_failures += 1
        if _oracle_consecutive_failures >= _ORACLE_FAILURE_THRESHOLD:
            _oracle_cooldown_until = time.time() + _ORACLE_COOLDOWN_SECONDS


def _record_mutation(mutation_type: str, description: str) -> None:
    geneticist_state["mutation_log"].append({
        "type": mutation_type,
        "description": description[:200],
        "ts": time.time(),
    })
    if len(geneticist_state["mutation_log"]) > MAX_LOG:
        geneticist_state["mutation_log"] = geneticist_state["mutation_log"][-MAX_LOG:]


def _healthy_sentinel_result(row: Any) -> bool:
    if not isinstance(row, dict) or row.get("ok") is not True:
        return False
    try:
        status_code = int(row.get("status_code"))
    except (TypeError, ValueError):
        return False
    return 0 < status_code < 400


GENETICIST_SYSTEM = (
    "You are L19 Geneticist, an expert Python engineer producing ONE improved version of the user's code. "
    "Preserve the public behaviour and every public name/signature unless the objective explicitly asks to change "
    "them. Make a real, focused improvement toward the objective (performance, clarity, robustness, typing, "
    "simplicity or a bug fix). Never add network access, subprocess calls, file writes, eval/exec or new "
    "third-party dependencies. Return the COMPLETE new code, not a diff. Return ONLY a JSON object with keys: "
    "code (string, full code), mutation_type (one of optimize|error_handling|naming|extract_function|type_hints|"
    "simplify|refactor|bug_fix), description (what changed and why), expected_effect (short)."
)

_APPROACHES = (
    "Prefer the smallest change that clearly satisfies the objective.",
    "Take a different approach from the obvious one: restructure if it makes the code clearly better.",
    "Prioritise robustness: edge cases, input validation and clear error handling.",
    "Prioritise readability and idiomatic Python (naming, comprehensions, type hints).",
)


async def _generate_candidate(
    *, code: str, objective: str, approach: str, index: int, total: int,
    principal_scope_key: str, tests: Optional[str],
) -> Dict[str, Any]:
    prompt = (
        f"Objective: {objective}\n"
        f"Candidate {index + 1} of {total}. Approach: {approach}\n"
        + (f"\nThe result must pass these tests:\n```python\n{tests[:6000]}\n```\n" if tests else "")
        + f"\nOriginal code:\n```python\n{code[:_MAX_MODEL_CODE_LEN]}\n```"
    )
    async with _model_slots():
        result = await level_model.level_model_json(
            level=19,
            name="geneticist",
            system=GENETICIST_SYSTEM,
            prompt=prompt,
            principal_scope_key=principal_scope_key,
            schema=CandidateOut,
            deadline_s=90.0,
        )
    _note_model_result(result)
    return result


async def _sandbox_runner(http_request: Request) -> Any:
    """Return an async runner for tests in the Lab sandbox (approval-gated), or raise."""
    authorization = await require_action_capability(http_request)
    from cortex_server.routers import lab as lab_router

    async def run(code: str, tests: str) -> Dict[str, Any]:
        program = f"{code}\n\n# --- caller-supplied tests ---\n{tests}\n"
        try:
            return await lab_router._run_python(
                program, timeout_seconds=30, http_request=http_request, authorization=authorization,
            )
        except HTTPException as exc:
            return {"success": False, "exit_code": -1, "timed_out": False,
                    "stderr": f"sandbox_unavailable: {exc.detail}", "execution_plane": None}

    return run


async def propose_candidates_core(
    *,
    code: str,
    objective: str,
    strategy: str,
    candidates: int,
    principal_scope_key: str,
    owner: str,
    tests: Optional[str] = None,
    target_path: Optional[str] = None,
    sandbox_runner: Any = None,
    store: bool = True,
) -> Dict[str, Any]:
    """Generate K model candidates, measure each, select by SCORE_RULE. Never writes files."""

    if _oracle_breaker_open():
        return {
            "success": False,
            "error": "model_breaker_open",
            "origin": "model_unavailable",
            "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL,
            "retry_after_s": _oracle_breaker_seconds_remaining(),
        }
    total = max(1, min(_MAX_CANDIDATES, int(candidates or 1)))
    results = await asyncio.gather(*(
        _generate_candidate(
            code=code, objective=objective, approach=_APPROACHES[i % len(_APPROACHES)], index=i, total=total,
            principal_scope_key=principal_scope_key, tests=tests,
        )
        for i in range(total)
    ))
    rows: List[Dict[str, Any]] = []
    failures: List[Dict[str, Any]] = []
    for index, result in enumerate(results):
        if not result.get("ok"):
            failures.append({"candidate": index, "status": result.get("status"), "error": result.get("error")})
            continue
        data = result.get("data") or {}
        candidate_code = str(data.get("code") or "")
        test_run = None
        if sandbox_runner is not None and tests:
            test_run = await sandbox_runner(candidate_code, tests)
        fitness = geneticist_fitness.evaluate(code, candidate_code, tests=tests, test_run=test_run)
        rows.append({
            "id": f"c{index + 1}",
            "mutation_type": data.get("mutation_type"),
            "description": data.get("description"),
            "expected_effect": data.get("expected_effect"),
            "code": candidate_code,
            "diff": _unified_diff(code, candidate_code, from_name=target_path or "input",
                                  to_name=f"{target_path or 'input'}:{strategy}:c{index + 1}"),
            "fitness": fitness,
            "model": result.get("model"),
            "receipt_id": result.get("receipt_id"),
        })
    if not rows:
        first = results[0] if results else {}
        payload = level_model.unavailable_payload(first, operation="geneticist.propose")
        payload["failures"] = failures
        geneticist_state["last_error"] = str(first.get("status"))
        return payload
    selected = geneticist_fitness.select(rows)
    response: Dict[str, Any] = {
        "operation": "geneticist.propose",
        "origin": "model",
        "strategy": strategy,
        "objective": objective,
        "target_path": target_path,
        "selection_rule": geneticist_fitness.SCORE_RULE,
        "candidates": [
            {k: v for k, v in row.items() if k != "code"} | {"code_chars": len(row["code"])} for row in rows
        ],
        "model_failures": failures,
        "tests_mode": "sandbox" if (sandbox_runner is not None and tests) else ("static" if tests else "none"),
    }
    if selected is None:
        response.update(success=False, error="no_viable_candidate", selected_id=None)
        geneticist_state["last_error"] = "no_viable_candidate"
        return response
    proposal_id = None
    if store:
        proposal_id = _store_proposal({
            "ts": time.time(),
            "owner": owner,
            "strategy": strategy,
            "target_path": target_path,
            "objective": objective,
            "original_code": code,
            "new_code": selected["code"],
            "mutation_type": selected["mutation_type"],
            "description": selected["description"],
            "diff": selected["diff"],
            "fitness": selected["fitness"],
            "receipt_id": selected["receipt_id"],
        })
        geneticist_state["proposals_created"] += 1
    response.update(
        success=True,
        proposal_id=proposal_id,
        selected_id=selected["id"],
        selected={k: v for k, v in selected.items()},
        mutation_type=selected["mutation_type"],
        description=selected["description"],
        diff=selected["diff"],
    )
    return response


@router.post("/propose")
async def propose_change(request: ProposeRequest, http_request: Request = None):
    """Generate measured candidates + diff. NEVER writes to disk (see /apply)."""

    code = (request.code or "").strip("\n")
    target_path = (request.target_path or "").strip() or None
    if target_path:
        grant = _grant(http_request, "geneticist.propose")
        p = _safe_path(grant, "geneticist.propose", Path(target_path), require_file=True)
        code = p.read_text(encoding="utf-8", errors="replace")
        target_path = str(p)
    code = _require_code(code)
    tests = _validate_tests(request.tests)
    if request.strategy == "mutate":
        hint = _validate_mutation_hint(request.mutation_hint)
        objective = f"Apply one meaningful improvement{f' of type {hint}' if hint else ''}."
    else:
        goal = _validate_fitness_goal(request.fitness_goal or "make it better")
        _validate_generations(request.generations)
        objective = goal
    runner = await _sandbox_runner(http_request) if (request.run_tests_in_sandbox and tests) else None
    result = await propose_candidates_core(
        code=code,
        objective=objective,
        strategy=request.strategy,
        candidates=request.candidates,
        principal_scope_key=level_model.scope_key_for_request(http_request, "geneticist"),
        owner=principal_owner(http_request),
        tests=tests,
        target_path=target_path,
        sandbox_runner=runner,
    )
    if result.get("success"):
        new_code = (result.get("selected") or {}).get("code", "")
        key = "mutated_code" if request.strategy == "mutate" else "evolved_code"
        result[key] = new_code
    return result


@router.get("/proposal/{proposal_id}")
async def get_proposal(proposal_id: str, http_request: Request = None):
    """Fetch a stored proposal (read-only, owner-scoped)."""
    prop = _get_proposal(proposal_id, principal_owner(http_request))
    return {
        "success": True,
        "proposal_id": proposal_id,
        "strategy": prop.get("strategy"),
        "target_path": prop.get("target_path"),
        "description": prop.get("description"),
        "mutation_type": prop.get("mutation_type"),
        "objective": prop.get("objective"),
        "fitness": prop.get("fitness"),
        "diff": prop.get("diff"),
        "new_code": prop.get("new_code"),
        "created_ts": prop.get("ts"),
    }


async def _council_review_of_diff(prop: Dict[str, Any], write_path: str, http_request: Any) -> Dict[str, Any]:
    """Provider-backed review of the exact diff using the Council decision contract."""
    system = (
        "You are The Council reviewing an irreversible code write for a production system. Judge the exact diff: "
        "correctness, behavioural change, security (network/subprocess/file writes/eval), and whether the target "
        "path is appropriate. Be conservative: if uncertain, NEEDS_CHANGES. Return ONLY JSON with keys verdict "
        "(APPROVE|NEEDS_CHANGES|REJECT), risk_score (0..1), top_concerns[], required_conditions[], rationale, "
        "suggested_changes[]."
    )
    fitness = prop.get("fitness") or {}
    prompt = (
        f"KIND: geneticist_apply\nTARGET_PATH: {write_path}\nOBJECTIVE: {str(prop.get('objective') or '')[:500]}\n"
        f"MEASURED FITNESS: compiles={fitness.get('compiles')} lint={((fitness.get('lint') or {}).get('count'))} "
        f"new_high_risks={len(fitness.get('new_high_risks') or [])} tests={((fitness.get('tests') or {}).get('status'))}\n"
        f"DIFF:\n{str(prop.get('diff') or '')[:12000]}"
    )
    result = await level_model.level_model_json(
        level=15,
        name="council",
        system=system,
        prompt=prompt,
        principal_scope_key=level_model.scope_key_for_request(http_request, "geneticist-apply-review"),
        schema=CouncilDecision,
        deadline_s=60.0,
    )
    if not result.get("ok"):
        return {"ok": False, "status": result.get("status"), "origin": "model_unavailable"}
    return {"ok": True, "origin": "model", "decision": result.get("data"),
            "model": result.get("model"), "receipt_id": result.get("receipt_id")}


@router.post("/apply")
async def apply_proposal(
    request: ApplyRequest,
    http_request: Request,
    authorization: ActionAuthorization = Depends(require_action_capability),
):
    """Apply a proposal only behind every gate (grant, confirm, Sentinel, Council model review, action capability)."""
    grant = _grant(http_request, "geneticist.apply")
    prop = _get_proposal(request.proposal_id, principal_owner(http_request))
    if not request.confirm:
        return {
            "success": False,
            "error": "confirm=false — refusing to apply. Re-call with confirm=true to apply.",
            "proposal_id": request.proposal_id,
            "target_path": prop.get("target_path"),
            "diff": prop.get("diff"),
        }

    # Required Sentinel preflight fails closed on every missing, malformed, or
    # unhealthy result.  A caller-authored force boolean cannot bypass it.
    gate = await _sentinel_apply_gate()
    sc = gate.get('scan') if isinstance(gate, dict) and gate.get('success') is True else None
    valid_scan = isinstance(sc, dict)
    results = sc.get('results') if valid_scan else None
    try:
        issues_found = int(sc['issues_found']) if valid_scan else -1
        watchers_checked = int(sc['watchers_checked']) if valid_scan else -1
    except (KeyError, TypeError, ValueError):
        issues_found = -1
        watchers_checked = -1
        valid_scan = False
    valid_scan = bool(
        valid_scan
        and isinstance(results, list)
        and watchers_checked >= 3
        and len(results) >= 3
        and all(_healthy_sentinel_result(row) for row in results)
    )
    if not valid_scan or issues_found != 0:
        return {
            'success': False,
            'blocked': True,
            'error': 'sentinel_gate_unavailable' if not valid_scan else 'sentinel_gate_failed',
            'message': 'Required Sentinel preflight did not produce a complete healthy receipt.',
            'sentinel': {
                'issues_found': issues_found,
                'watchers_checked': watchers_checked,
                'results': (results or [])[:6] if isinstance(results, list) else [],
            },
        }

    write_path = (request.write_path or prop.get("target_path") or "").strip()
    if not write_path:
        write_path = str(Path("/opt/clawdbot/geneticist_applied") / f"{request.proposal_id}.txt")
    p = _safe_path(grant, "geneticist.apply", Path(write_path))

    new_code = prop.get("new_code") or ""
    if not isinstance(new_code, str) or not new_code.strip():
        raise HTTPException(status_code=400, detail="proposal new_code missing")

    council = await _council_review_of_diff(prop, str(p), http_request)
    if not council.get("ok"):
        return {"success": False, "blocked": True, "error": "council_review_unavailable",
                "message": "A provider-backed Council review of the exact diff is required before any write.",
                "council": council}
    if (council.get("decision") or {}).get("verdict") != "APPROVE":
        return {"success": False, "blocked": True, "error": "council_review_not_approved", "council": council}

    # The consumed, principal-bound action capability is the explicit approval.
    assert_action_authorized(authorization)

    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(new_code, encoding="utf-8")
    tmp.replace(p)

    geneticist_state["applies_performed"] += 1
    return {
        "success": True,
        "applied": True,
        "proposal_id": request.proposal_id,
        "write_path": str(p),
        "strategy": prop.get("strategy"),
        "diff": prop.get("diff"),
        "council": council,
    }


async def _mutate_code(request: MutateRequest, http_request: Any = None):
    code = _require_code(request.code)
    hint = _validate_mutation_hint(request.mutation_hint)
    tests = _validate_tests(request.tests)
    result = await propose_candidates_core(
        code=code,
        objective=f"Apply one meaningful improvement{f' of type/intent: {hint}' if hint else ''}.",
        strategy="mutate",
        candidates=1,
        principal_scope_key=level_model.scope_key_for_request(http_request, "geneticist"),
        owner=principal_owner(http_request),
        tests=tests,
        store=False,
    )
    if not result.get("success"):
        return result
    selected = result["selected"]
    geneticist_state["mutations_performed"] += 1
    geneticist_state["last_mutation_ts"] = time.time()
    _record_mutation(str(selected.get("mutation_type")), str(selected.get("description")))
    return {
        "success": True,
        "origin": "model",
        "mutation": {
            "original_code": code,
            "mutated_code": selected["code"],
            "mutation_type": selected["mutation_type"],
            "description": selected["description"],
            "fitness": selected["fitness"],
            "receipt_id": selected.get("receipt_id"),
        },
    }


@router.post("/mutate")
async def mutate_code(request: MutateRequest, http_request: Request = None):
    """One model candidate with measured fitness (pure transform; never writes)."""
    return await _mutate_code(request, http_request)


async def _evolve_code(request: EvolveRequest, http_request: Any = None):
    code = _require_code(request.code)
    fitness_goal = _validate_fitness_goal(request.fitness_goal)
    generations = _validate_generations(request.generations)
    tests = _validate_tests(request.tests)
    current_code = code
    evolution_log: List[Dict[str, Any]] = []
    for gen in range(1, generations + 1):
        result = await propose_candidates_core(
            code=current_code,
            objective=fitness_goal,
            strategy="evolve",
            candidates=2,
            principal_scope_key=level_model.scope_key_for_request(http_request, "geneticist"),
            owner=principal_owner(http_request),
            tests=tests,
            store=False,
        )
        if not result.get("success"):
            evolution_log.append({
                "generation": gen,
                "status": "error",
                "error_code": result.get("error") or result.get("status") or "model_unavailable",
                "candidates": result.get("candidates", []),
            })
            break
        selected = result["selected"]
        evolution_log.append({
            "generation": gen,
            "status": "success",
            "selected_id": result["selected_id"],
            "description": selected["description"],
            "fitness": selected["fitness"],
            "alternatives": [
                {"id": c["id"], "score": c["fitness"]["score"], "viable": c["fitness"]["viable"]}
                for c in result["candidates"]
            ],
        })
        current_code = selected["code"]

    run_success = len(evolution_log) > 0 and all(step.get("status") == "success" for step in evolution_log)
    partial_success = any(step.get("status") == "success" for step in evolution_log) and not run_success
    if not run_success:
        last = evolution_log[-1] if evolution_log else {}
        geneticist_state["last_error"] = last.get("error_code")
    geneticist_state["evolutions_run"] += 1
    geneticist_state["last_evolution_ts"] = time.time()
    _record_mutation("evolution", f"goal={fitness_goal}, gens={generations}, success={run_success}")
    return {
        "success": run_success,
        "partial_success": partial_success,
        "selection_rule": geneticist_fitness.SCORE_RULE,
        "evolution": {
            "original_code": code,
            "evolved_code": current_code if any(s.get("status") == "success" for s in evolution_log) else None,
            "fitness_goal": fitness_goal,
            "generations_requested": generations,
            "generations_run": len(evolution_log),
            "evolution_log": evolution_log,
        },
    }


@router.post("/evolve")
async def evolve_code(request: EvolveRequest, http_request: Request = None):
    """Generational selection: each generation keeps the best measured viable candidate."""
    return await _evolve_code(request, http_request)


@router.get("/contract")
async def geneticist_contract():
    return {
        "success": True,
        "contract": {
            "accepted_handoff": {
                "code": "string (required)",
                "strategy": "mutate|evolve",
                "objective": "string (required)",
                "generations": "int 1..3 (required for evolve)",
                "mutation_hint": "string (optional, for mutate)",
                "trace_id": "string (optional)",
            },
            "behavior": {
                "mutate": "one model candidate, deterministic fitness",
                "evolve": "per generation: 2 candidates, best viable by SCORE_RULE carries forward",
                "propose": "K candidates (1..4), fitness, selection; stored owner-scoped; never writes",
            },
            "selection_rule": geneticist_fitness.SCORE_RULE,
        },
    }


@router.post("/apply_plan")
async def apply_architect_plan(request: ArchitectHandoffRequest, http_request: Request = None):
    """L9→L19 handoff: pure model transform with fitness; never writes."""
    _require_code(request.code)
    _validate_fitness_goal(request.objective)
    _validate_mutation_hint(request.mutation_hint)
    if request.strategy == "evolve":
        _validate_generations(request.generations or 1)

    geneticist_state["architect_handoffs"] += 1

    if request.strategy == "mutate":
        result = await _mutate_code(MutateRequest(code=request.code, mutation_hint=request.mutation_hint or request.objective), http_request)
    else:
        result = await _evolve_code(EvolveRequest(code=request.code, fitness_goal=request.objective, generations=request.generations or 1), http_request)

    return {
        "success": result.get("success", False),
        "strategy": request.strategy,
        "trace_id": request.trace_id,
        "objective": request.objective,
        "result": result,
    }


_STATUS_CAPABILITIES = {
    "propose": [("POST", "/propose")],
    "mutate": [("POST", "/mutate")],
    "evolve": [("POST", "/evolve")],
    "architect_handoff": [("POST", "/apply_plan")],
    "proposal_read": [("GET", "/proposal/{proposal_id}")],
    "apply": [("POST", "/apply")],
}


@router.get("/status")
async def geneticist_status(request: Request = None):
    capability_policy = execution_capability_status(required_action_prefixes=("geneticist.",))
    report = capability_report(request, "/geneticist", _STATUS_CAPABILITIES)
    recent_ok = _MODEL_LANE["last_ok_at"] is not None and time.time() - _MODEL_LANE["last_ok_at"] < 900
    if _oracle_breaker_open():
        health = "degraded"
    elif not report["capabilities"]:
        health = "limited"
    elif recent_ok:
        health = "active"
    else:
        health = "idle_unverified"
    return {
        "success": True,
        "data": {
            "level": 19,
            "name": "The Geneticist",
            "status": health,
            "capabilities": report["capabilities"],
            "unavailable": report["unavailable"],
            "mounted_routes": report["mounted_routes"],
            "mutations_performed": geneticist_state["mutations_performed"],
            "evolutions_run": geneticist_state["evolutions_run"],
            "proposals_created": geneticist_state["proposals_created"],
            "applies_performed": geneticist_state["applies_performed"],
            "architect_handoffs": geneticist_state["architect_handoffs"],
            "last_mutation_ts": geneticist_state["last_mutation_ts"],
            "last_evolution_ts": geneticist_state["last_evolution_ts"],
            "recent_mutations": geneticist_state["mutation_log"][-5:],
            "rejected_contracts": geneticist_state["rejected_contracts"],
            "last_error": geneticist_state["last_error"],
            "model_lane": {
                "via": "level_model (in-process OpenClaw lane, receipt-validated)",
                "last_success_at": _MODEL_LANE["last_ok_at"],
                "last_failure_at": _MODEL_LANE["last_failure_at"],
                "last_status": _MODEL_LANE["last_status"],
                "consecutive_failures": _oracle_consecutive_failures,
                "breaker_open": _oracle_breaker_open(),
                "breaker_seconds_remaining": _oracle_breaker_seconds_remaining(),
            },
            "proposal_store": {"kind": "memory", "count": len(_PROPOSALS), "max": _MAX_PROPOSALS,
                               "owner_scoped": True, "survives_restart": False},
            "selection_rule": geneticist_fitness.SCORE_RULE,
            "mutation_types": list(_ALLOWED_MUTATION_TYPES),
            "executionCapabilityPolicy": capability_policy,
        },
        "error": None,
    }
