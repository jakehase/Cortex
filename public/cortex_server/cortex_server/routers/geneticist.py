"""
Level 19 — The Geneticist
Real code evolution and mutation powered by L5 Oracle (cloud reasoning).
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List, Literal
import difflib
from pathlib import Path
import uuid
import httpx
import json
import re
import time

router = APIRouter(tags=["Geneticist"])

SENTINEL_WATCH_URL = 'http://127.0.0.1:8888/sentinel/watch'
SENTINEL_SCAN_URL = 'http://127.0.0.1:8888/sentinel/scan'

async def _sentinel_apply_gate() -> dict:
    """Preflight check before applying changes (no side effects)."""
    targets = [
        'http://127.0.0.1:8888/health',
        'http://127.0.0.1:8888/oracle/status',
        'http://127.0.0.1:8888/augmenter/status',
    ]
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            for t in targets:
                await client.post(SENTINEL_WATCH_URL, json={
                    'name': 'apply-gate',
                    'watch_type': 'endpoint',
                    'target': t,
                    'timeout_seconds': 1.5,
                })
            r = await client.post(SENTINEL_SCAN_URL, json={})
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {'success': False, 'error': f'sentinel_apply_gate_failed:{type(e).__name__}:{e}'}

# Use Augmenter as the primary call surface for reliability (validate/repair + fail-fast).
# Bypass is handled inside Augmenter when it calls Oracle.
AUGMENTER_URL = "http://localhost:8888/augmenter/chat"
AUGMENTER_TIMEOUT = 25.0

# Legacy (kept for reference; not used by default)
ORACLE_URL = "http://localhost:8888/oracle/chat"
ORACLE_TIMEOUT = 25.0

# ── Guardrails / limits ─────────────────────────────────────────────
_MAX_CODE_LEN = 200_000
_MAX_HINT_LEN = 500
_MAX_FITNESS_GOAL_LEN = 500
_ALLOWED_MUTATION_TYPES = {
    "optimize",
    "error_handling",
    "naming",
    "extract_function",
    "type_hints",
    "simplify",
    "unknown",
}

# Oracle circuit breaker
_oracle_consecutive_failures = 0
_oracle_cooldown_until = 0.0
_ORACLE_FAILURE_THRESHOLD = 3
_ORACLE_COOLDOWN_SECONDS = 45

# ── Module-level state ──────────────────────────────────────────────
# In-memory proposal store (safe-by-default). Proposals are never applied
# unless the user explicitly calls /geneticist/apply with confirm=true.
_PROPOSALS: Dict[str, Dict[str, Any]] = {}
_MAX_PROPOSALS = 100

# Where apply() is allowed to write.
_ALLOWED_WRITE_ROOTS = [
    Path("/root/.openclaw/workspace").resolve(),
    Path("/opt/clawdbot").resolve(),
]


def _allowed_path(p: Path) -> bool:
    rp = p.resolve()
    return any(root == rp or root in rp.parents for root in _ALLOWED_WRITE_ROOTS)


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


def _store_proposal(data: Dict[str, Any]) -> str:
    # cap store
    if len(_PROPOSALS) >= _MAX_PROPOSALS:
        # drop oldest by ts
        oldest = sorted(_PROPOSALS.items(), key=lambda kv: kv[1].get("ts", 0))[:10]
        for k, _ in oldest:
            _PROPOSALS.pop(k, None)
    pid = str(uuid.uuid4())
    _PROPOSALS[pid] = data
    return pid


def _get_proposal(pid: str) -> Dict[str, Any]:
    p = _PROPOSALS.get(pid)
    if not p:
        raise HTTPException(status_code=404, detail="proposal_id not found")
    return p


geneticist_state: Dict[str, Any] = {

    "mutations_performed": 0,
    "evolutions_run": 0,
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


class EvolveRequest(BaseModel):
    code: str
    fitness_goal: str = "make it better"
    generations: int = 1


class ProposeRequest(BaseModel):
    """Create a proposal (no side effects).

    If target_path is provided, the code will be loaded from that file (and code is optional).
    """

    strategy: Literal["mutate", "evolve"] = "mutate"
    code: Optional[str] = None
    target_path: Optional[str] = None
    mutation_hint: Optional[str] = None
    fitness_goal: Optional[str] = None
    generations: int = 1


class ApplyRequest(BaseModel):
    proposal_id: str
    confirm: bool = False
    force: bool = False
    # Optional override location (defaults to proposal target_path or a sandbox file)
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


def _oracle_breaker_open() -> bool:
    return time.time() < _oracle_cooldown_until


def _oracle_breaker_seconds_remaining() -> int:
    if not _oracle_breaker_open():
        return 0
    return int(max(0, _oracle_cooldown_until - time.time()))


async def _ask_oracle(prompt: str, system: str, *, strict: bool = False) -> str:
    """Ask Augmenter (preferred) or Oracle (strict-contract lane).

    - Default: call Augmenter for reliability.
    - strict=True: call Oracle directly with x-augmenter-bypass=1 so we can use
      Oracle's strict-contract enforcement (json-only, verifier repair, etc.).
    """
    global _oracle_consecutive_failures, _oracle_cooldown_until

    if _oracle_breaker_open():
        raise HTTPException(
            status_code=503,
            detail=f"Oracle circuit breaker open ({_oracle_breaker_seconds_remaining()}s remaining)",
        )

    try:
        if strict:
            async with httpx.AsyncClient(timeout=ORACLE_TIMEOUT) as client:
                resp = await client.post(
                    ORACLE_URL,
                    headers={"x-augmenter-bypass": "1"},
                    json={
                        "prompt": prompt,
                        "system": system,
                        "response_mode": "final_only",
                        "priority": "normal",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                text = data.get("response") or data.get("text") or json.dumps(data)
                _oracle_consecutive_failures = 0
                return text

        async with httpx.AsyncClient(timeout=AUGMENTER_TIMEOUT) as client:
            resp = await client.post(
                AUGMENTER_URL,
                json={
                    "prompt": prompt,
                    "response_mode": "final_only",
                    # Geneticist is normally not worth heavy orchestration.
                    "priority": "normal",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            text = data.get("response") or data.get("text") or json.dumps(data)
            _oracle_consecutive_failures = 0
            return text
    except HTTPException:
        raise
    except Exception:
        _oracle_consecutive_failures += 1
        if _oracle_consecutive_failures >= _ORACLE_FAILURE_THRESHOLD:
            _oracle_cooldown_until = time.time() + _ORACLE_COOLDOWN_SECONDS
        raise


def _record_mutation(mutation_type: str, description: str) -> None:
    geneticist_state["mutation_log"].append({
        "type": mutation_type,
        "description": description[:200],
        "ts": time.time(),
    })
    if len(geneticist_state["mutation_log"]) > MAX_LOG:
        geneticist_state["mutation_log"] = geneticist_state["mutation_log"][-MAX_LOG:]


def _is_hud_only_response(text: str) -> bool:
    if not isinstance(text, str):
        return False
    s = text.strip()
    return s.startswith("[ALIVE HUD") and "```" not in s and "{" not in s


async def _oracle_retry_for_code(prompt: str, system: str, raw_first: str) -> str:
    """Retry once when the model returns HUD-only / non-actionable text."""
    if not _is_hud_only_response(raw_first):
        return raw_first
    retry_system = system + "\n\nIMPORTANT: Return ONLY valid JSON. No HUD/status-only text."
    return await _ask_oracle(prompt, retry_system)


@router.post("/propose")
async def propose_change(request: ProposeRequest):
    """Generate a change proposal + diff.

    This endpoint NEVER writes to disk. Use /apply with confirm=true to apply.
    """

    # Load code either from request.code or from a file.
    code = (request.code or "").strip()
    target_path = (request.target_path or "").strip() or None
    if target_path:
        p = Path(target_path)
        if not p.exists() or not p.is_file():
            _reject("target_path must point to an existing file")
        if not _allowed_path(p):
            _reject("target_path is outside allowed roots")
        code = p.read_text(encoding="utf-8", errors="replace")

    code = _require_code(code)

    strategy = request.strategy
    if strategy == "mutate":
        hint = _validate_mutation_hint(request.mutation_hint)
        hint_text = f"\nThe user hints this mutation type: {hint}\n" if hint else ""

        system_prompt = (
            "You are a code geneticist. Apply ONE meaningful mutation to this code. "
            "Types of mutations you can apply:\n"
            "- optimize a loop\n"
            "- add error handling\n"
            "- improve naming\n"
            "- extract a function\n"
            "- add type hints\n"
            "- simplify logic\n\n"
            f"{hint_text}"
            "Return JSON tool call only (no markdown, no code fences).\n"
            "Schema (exact): {\n"
            "  \"function\": \"geneticist_mutate\",\n"
            "  \"arguments\": {\n"
            "    \"mutated_code\": \"...full mutated code...\",\n"
            "    \"mutation_type\": \"optimize|error_handling|naming|extract_function|type_hints|simplify\",\n"
            "    \"description\": \"What was changed and why\"\n"
            "  }\n"
            "}"
        )
        user_prompt = f"Return JSON tool call only (json only).\n\nOriginal code:\n{code}"

        raw = await _ask_oracle(user_prompt, system_prompt, strict=True)
        raw = await _oracle_retry_for_code(user_prompt, system_prompt, raw)

        parsed = None
        try:
            parsed = json.loads(raw.strip())
        except Exception:
            parsed = None

        # One-shot repair attempt: ask again with an explicit JSON-only instruction.
        if not isinstance(parsed, dict):
            repair_system = system_prompt + "\n\nREPAIR: You MUST output JSON tool call only, matching the schema exactly."
            raw2 = await _ask_oracle(user_prompt, repair_system)
            try:
                parsed = json.loads(raw2.strip())
                raw = raw2
            except Exception:
                parsed = None

        if not isinstance(parsed, dict):
            return {
                "success": False,
                "error": "Model did not return JSON tool call",
                "error_code": "contract_failed",
                "raw_response": raw[:1200],
            }

        # Accept {function,arguments} shape (Oracle strict-contract may canonicalize tool calls)
        fn = str(parsed.get("function") or "")
        args = parsed.get("arguments") if isinstance(parsed.get("arguments"), dict) else {}

        mutated_code = str(args.get("mutated_code") or "")
        mutation_type = str(args.get("mutation_type") or "unknown").strip()
        description = str(args.get("description") or "")

        # Fallback: some models emit a write-like tool call with {content: "..."}
        if (not mutated_code.strip()) and isinstance(args.get("content"), str):
            mutated_code = str(args.get("content") or "")
            if mutation_type == "unknown":
                mutation_type = str(hint or "unknown").strip() or "unknown"
            if not description:
                description = f"tool_call:{fn}"
        if mutation_type not in _ALLOWED_MUTATION_TYPES:
            mutation_type = "unknown"

        if not mutated_code.strip():
            return {
                "success": False,
                "error": "mutated_code missing/empty",
                "error_code": "contract_failed",
                "raw_response": raw[:1200],
            }

        from_name = target_path or "input"
        to_name = (target_path or "input") + ":mutated"
        diff = _unified_diff(code, mutated_code, from_name=from_name, to_name=to_name)

        proposal_id = _store_proposal({
            "ts": time.time(),
            "strategy": "mutate",
            "target_path": target_path,
            "original_code": code,
            "new_code": mutated_code,
            "mutation_type": mutation_type,
            "description": description,
            "diff": diff,
        })

        return {
            "success": True,
            "proposal_id": proposal_id,
            "strategy": "mutate",
            "target_path": target_path,
            "mutation_type": mutation_type,
            "description": description,
            "diff": diff,
            "mutated_code": mutated_code,
        }

    # evolve
    goal = _validate_fitness_goal(request.fitness_goal or "make it better")
    generations = _validate_generations(request.generations)

    system_prompt = (
        "You are a code geneticist. Evolve this code to better satisfy the fitness goal. "
        "Return JSON tool call only (no markdown, no code fences).\n"
        "Schema (exact): {\n"
        "  \"function\": \"geneticist_evolve\",\n"
        "  \"arguments\": {\n"
        "    \"evolved_code\": \"...full evolved code...\",\n"
        "    \"description\": \"What was changed and why\"\n"
        "  }\n"
        "}"
    )
    user_prompt = f"Return JSON tool call only (json only).\n\nFitness goal: {goal}\n\nOriginal code:\n{code}"

    raw = await _ask_oracle(user_prompt, system_prompt, strict=True)
    raw = await _oracle_retry_for_code(user_prompt, system_prompt, raw)

    parsed = None
    try:
        parsed = json.loads(raw.strip())
    except Exception:
        parsed = None

    # One-shot repair attempt
    if not isinstance(parsed, dict):
        repair_system = system_prompt + "\n\nREPAIR: You MUST output JSON tool call only, matching schema exactly."
        raw2 = await _ask_oracle(user_prompt, repair_system)
        try:
            parsed = json.loads(raw2.strip())
            raw = raw2
        except Exception:
            parsed = None

    if not isinstance(parsed, dict):
        return {
            "success": False,
            "error": "Model did not return JSON tool call",
            "error_code": "contract_failed",
            "raw_response": raw[:1200],
        }

    args = parsed.get("arguments") if isinstance(parsed.get("arguments"), dict) else {}
    evolved_code = str(args.get("evolved_code") or "")
    description = str(args.get("description") or "")

    if not evolved_code.strip():
        return {
            "success": False,
            "error": "evolved_code missing/empty",
            "error_code": "contract_failed",
            "raw_response": raw[:1200],
        }

    from_name = target_path or "input"
    to_name = (target_path or "input") + ":evolved"
    diff = _unified_diff(code, evolved_code, from_name=from_name, to_name=to_name)

    proposal_id = _store_proposal({
        "ts": time.time(),
        "strategy": "evolve",
        "target_path": target_path,
        "fitness_goal": goal,
        "generations": generations,
        "original_code": code,
        "new_code": evolved_code,
        "description": description,
        "diff": diff,
    })

    return {
        "success": True,
        "proposal_id": proposal_id,
        "strategy": "evolve",
        "target_path": target_path,
        "fitness_goal": goal,
        "generations": generations,
        "description": description,
        "diff": diff,
        "evolved_code": evolved_code,
    }


@router.get("/proposal/{proposal_id}")
async def get_proposal(proposal_id: str):
    """Fetch a stored proposal (read-only)."""
    prop = _get_proposal(proposal_id)
    return {
        "success": True,
        "proposal_id": proposal_id,
        "strategy": prop.get("strategy"),
        "target_path": prop.get("target_path"),
        "description": prop.get("description"),
        "mutation_type": prop.get("mutation_type"),
        "fitness_goal": prop.get("fitness_goal"),
        "generations": prop.get("generations"),
        "diff": prop.get("diff"),
        "new_code": prop.get("new_code"),
        "created_ts": prop.get("ts"),
    }


@router.post("/apply")
async def apply_proposal(request: ApplyRequest):
    """Apply a stored proposal to disk (explicit approval required)."""
    prop = _get_proposal(request.proposal_id)
    if not request.confirm:
        return {
            "success": False,
            "error": "confirm=false — refusing to apply. Re-call with confirm=true to apply.",
            "proposal_id": request.proposal_id,
            "target_path": prop.get("target_path"),
            "diff": prop.get("diff"),
        }

    # L21 Sentinel apply gate: refuse to apply if core services are unhealthy (unless force=true).
    gate = await _sentinel_apply_gate()
    if isinstance(gate, dict) and gate.get('success') and isinstance(gate.get('scan'), dict):
        sc = gate['scan']
        if int(sc.get('issues_found') or 0) > 0 and not getattr(request, 'force', False):
            return {
                'success': False,
                'error': 'sentinel_gate_failed',
                'message': 'Sentinel reports issues; refusing to apply. Re-run with force=true to override.',
                'sentinel': {
                    'issues_found': sc.get('issues_found'),
                    'watchers_checked': sc.get('watchers_checked'),
                    'results': (sc.get('results') or [])[:6],
                },
            }



    # Determine write path.
    write_path = (request.write_path or prop.get("target_path") or "").strip()
    if not write_path:
        # safe default: write into container sandbox (no host side-effects)
        sandbox = Path("/opt/clawdbot/geneticist_applied")
        sandbox.mkdir(parents=True, exist_ok=True)
        write_path = str(sandbox / f"{request.proposal_id}.txt")

    p = Path(write_path)
    if not _allowed_path(p):
        raise HTTPException(status_code=400, detail="write_path is outside allowed roots")

    new_code = prop.get("new_code") or ""
    if not isinstance(new_code, str) or not new_code.strip():
        raise HTTPException(status_code=400, detail="proposal new_code missing")

    # Write atomically
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(new_code, encoding="utf-8")
    tmp.replace(p)

    geneticist_state["mutations_performed"] += 1 if prop.get("strategy") == "mutate" else 0
    geneticist_state["evolutions_run"] += 1 if prop.get("strategy") == "evolve" else 0

    return {
        "success": True,
        "applied": True,
        "proposal_id": request.proposal_id,
        "write_path": str(p),
        "strategy": prop.get("strategy"),
        "diff": prop.get("diff"),
        "new_code": new_code,
        "note": "Applied inside Cortex container. Use /geneticist/proposal/{id} to retrieve content, or target_path/write_path to write into a mounted location.",
    }


@router.post("/mutate")
async def mutate_code(request: MutateRequest):
    code = _require_code(request.code)
    hint = _validate_mutation_hint(request.mutation_hint)

    hint_text = ""
    if hint:
        hint_text = f"\nThe user hints this mutation type: {hint}\n"

    system_prompt = (
        "You are a code geneticist. Apply ONE meaningful mutation to this code. "
        "Types of mutations you can apply:\n"
        "- optimize a loop\n"
        "- add error handling\n"
        "- improve naming\n"
        "- extract a function\n"
        "- add type hints\n"
        "- simplify logic\n\n"
        f"{hint_text}"
        "Return the mutated code and explain what you changed and why.\n\n"
        "Return as JSON: {\n"
        '  "mutated_code": "...full mutated code...",\n'
        '  "mutation_type": "one of: optimize, error_handling, naming, extract_function, type_hints, simplify",\n'
        '  "description": "What was changed and why"\n'
        "}"
    )

    user_prompt = f"Original code:\n```\n{code}\n```"

    try:
        raw = await _ask_oracle(user_prompt, system_prompt)
        raw = await _oracle_retry_for_code(user_prompt, system_prompt, raw)
    except HTTPException:
        raise
    except httpx.TimeoutException:
        geneticist_state["last_error"] = "Oracle timeout during mutation"
        return {"success": False, "error": "Oracle timeout during mutation", "error_code": "oracle_timeout"}
    except Exception as exc:
        geneticist_state["last_error"] = str(exc)
        return {"success": False, "error": f"Oracle error: {str(exc)}", "error_code": "oracle_error"}

    mutated_code = ""
    mutation_type = "unknown"
    description = ""

    # Prefer strict JSON-only responses (Augmenter is asked for final_only);
    # fallback to first JSON object substring if the model still chatters.
    parsed = None
    try:
        parsed = json.loads(raw.strip()) if raw.strip().startswith('{') else None
    except Exception:
        parsed = None

    if parsed is None:
        json_match = re.search(r"\{[\s\S]*\}", raw)
        if json_match:
            try:
                parsed = json.loads(json_match.group())
            except Exception:
                parsed = None

    if isinstance(parsed, dict):
        mutated_code = parsed.get("mutated_code", "")
        mutation_type = str(parsed.get("mutation_type", "unknown")).strip()
        description = parsed.get("description", "")

    if mutation_type not in _ALLOWED_MUTATION_TYPES:
        mutation_type = "unknown"

    if not mutated_code:
        code_match = re.search(r"```(?:python)?\n([\s\S]*?)```", raw)
        if code_match:
            mutated_code = code_match.group(1)

    if not mutated_code:
        geneticist_state["last_error"] = "No mutated code extracted"
        return {
            "success": False,
            "error": "No mutated code extracted from Oracle response",
            "error_code": "parse_failed",
            "raw_response": raw[:1000],
        }

    if not description:
        description = raw[:300]

    geneticist_state["mutations_performed"] += 1
    geneticist_state["last_mutation_ts"] = time.time()
    _record_mutation(mutation_type, description)

    return {
        "success": True,
        "mutation": {
            "original_code": code,
            "mutated_code": mutated_code,
            "mutation_type": mutation_type,
            "description": description,
            "raw_response": raw,
        },
    }


@router.post("/evolve")
async def evolve_code(request: EvolveRequest):
    code = _require_code(request.code)
    fitness_goal = _validate_fitness_goal(request.fitness_goal)
    generations = _validate_generations(request.generations)

    current_code = code
    evolution_log: List[Dict[str, Any]] = []

    system_prompt = (
        "You are a code geneticist performing directed evolution. "
        f"The fitness goal is: {fitness_goal}\n\n"
        "Evolve the code toward this goal. Make meaningful improvements "
        "that move the code closer to the fitness target.\n\n"
        "Return as JSON: {\n"
        '  "evolved_code": "...full evolved code...",\n'
        '  "changes": ["change 1 description", "change 2 description"],\n'
        '  "fitness_improvement": "explanation of how this is closer to the goal"\n'
        "}"
    )

    for gen in range(1, generations + 1):
        user_prompt = (
            f"Generation {gen}/{generations}\n"
            f"Fitness goal: {fitness_goal}\n\n"
            f"Current code:\n```\n{current_code}\n```"
        )

        try:
            raw = await _ask_oracle(user_prompt, system_prompt)
            raw = await _oracle_retry_for_code(user_prompt, system_prompt, raw)
        except HTTPException as he:
            evolution_log.append({"generation": gen, "status": "error", "error": str(he.detail), "error_code": "oracle_breaker_open"})
            break
        except httpx.TimeoutException:
            evolution_log.append({"generation": gen, "status": "timeout", "error": "Oracle timeout", "error_code": "oracle_timeout"})
            break
        except Exception as exc:
            evolution_log.append({"generation": gen, "status": "error", "error": str(exc), "error_code": "oracle_error"})
            break

        evolved_code = ""
        changes: List[str] = []
        fitness_improvement = ""

        json_match = re.search(r"\{[\s\S]*\}", raw)
        if json_match:
            try:
                parsed = json.loads(json_match.group())
                evolved_code = parsed.get("evolved_code", "")
                changes = parsed.get("changes", [])
                fitness_improvement = parsed.get("fitness_improvement", "")
            except json.JSONDecodeError:
                pass

        if not evolved_code:
            code_match = re.search(r"```(?:python)?\n([\s\S]*?)```", raw)
            if code_match:
                evolved_code = code_match.group(1)

        if not evolved_code:
            evolution_log.append({
                "generation": gen,
                "status": "error",
                "error": "No evolved code extracted",
                "error_code": "parse_failed",
            })
            break

        evolution_log.append({
            "generation": gen,
            "status": "success",
            "changes": changes,
            "fitness_improvement": fitness_improvement,
        })
        current_code = evolved_code

    run_success = len(evolution_log) > 0 and all(step.get("status") == "success" for step in evolution_log)
    partial_success = any(step.get("status") == "success" for step in evolution_log) and not run_success

    if not run_success:
        last = evolution_log[-1] if evolution_log else {}
        geneticist_state["last_error"] = last.get("error") or last.get("error_code")

    geneticist_state["evolutions_run"] += 1
    geneticist_state["last_evolution_ts"] = time.time()
    _record_mutation("evolution", f"goal={fitness_goal}, gens={generations}, success={run_success}")

    return {
        "success": run_success,
        "partial_success": partial_success,
        "evolution": {
            "original_code": code,
            "evolved_code": current_code,
            "fitness_goal": fitness_goal,
            "generations_requested": generations,
            "generations_run": len(evolution_log),
            "evolution_log": evolution_log,
        },
    }


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
                "mutate": "single targeted improvement",
                "evolve": "goal-directed improvement over N generations",
            },
        },
    }


@router.post("/apply_plan")
async def apply_architect_plan(request: ArchitectHandoffRequest):
    """Deterministic L9→L19 handoff endpoint."""
    _require_code(request.code)
    _validate_fitness_goal(request.objective)
    _validate_mutation_hint(request.mutation_hint)
    if request.strategy == "evolve":
        _validate_generations(request.generations or 1)

    geneticist_state["architect_handoffs"] += 1

    if request.strategy == "mutate":
        result = await mutate_code(MutateRequest(code=request.code, mutation_hint=request.mutation_hint or request.objective))
    else:
        result = await evolve_code(EvolveRequest(code=request.code, fitness_goal=request.objective, generations=request.generations or 1))

    return {
        "success": result.get("success", False),
        "strategy": request.strategy,
        "trace_id": request.trace_id,
        "objective": request.objective,
        "result": result,
    }


@router.get("/status")
async def geneticist_status():
    return {
        "success": True,
        "data": {
            "level": 19,
            "name": "The Geneticist",
            "status": "active" if not _oracle_breaker_open() else "degraded",
            "mutations_performed": geneticist_state["mutations_performed"],
            "evolutions_run": geneticist_state["evolutions_run"],
            "architect_handoffs": geneticist_state["architect_handoffs"],
            "last_mutation_ts": geneticist_state["last_mutation_ts"],
            "last_evolution_ts": geneticist_state["last_evolution_ts"],
            "recent_mutations": geneticist_state["mutation_log"][-5:],
            "rejected_contracts": geneticist_state["rejected_contracts"],
            "last_error": geneticist_state["last_error"],
            "oracle_consecutive_failures": _oracle_consecutive_failures,
            "oracle_breaker_open": _oracle_breaker_open(),
            "oracle_breaker_seconds_remaining": _oracle_breaker_seconds_remaining(),
            "powered_by": "L38 Augmenter -> L5 Oracle (OpenClaw baseline)",
            "mutation_types": [
                "optimize",
                "error_handling",
                "naming",
                "extract_function",
                "type_hints",
                "simplify",
            ],
        },
        "error": None,
    }
