"""L29 Muse — creative inspiration + brainstorming.

This router is intentionally conservative under low-risk tolerance:
- Calls Oracle with x-augmenter-bypass=1 and response_mode=final_only for predictable behavior.
- Enforces a strict wall-clock deadline (18s) for the entire Oracle call.
- Fails closed on empty/invalid Oracle output (never success:true with empty content).
- Strict input bounds.
- Strict schema validation for /brainstorm (exact counts 5/3/1).
- Test hooks (forced-empty) are gated behind env + token and use a header allowlist.
"""

from __future__ import annotations

import json
import os
import time
from typing import Dict, List, Optional, Literal

import anyio
import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError

router = APIRouter(tags=["muse"])

# ---------------------------------------------------------------------------
# Limits + state
# ---------------------------------------------------------------------------

MAX_TOPIC_CHARS = 500
MAX_PROBLEM_CHARS = 1200

# Hard wall-clock budget for Oracle call (must be < request-timeout middleware ~25s)
ORACLE_DEADLINE_S = 18

MUSE_TEST_HEADERS_ENABLED = os.getenv("MUSE_TEST_HEADERS_ENABLED", "false").strip().lower() in ("1", "true", "yes")
MUSE_TEST_TOKEN = os.getenv("MUSE_TEST_TOKEN", "").strip()
MUSE_DEBUG_RAW_RESPONSE = os.getenv("MUSE_DEBUG_RAW_RESPONSE", "false").strip().lower() in ("1", "true", "yes")

_creations_count: int = 0
_errors_count: int = 0
_last_error: Optional[str] = None
_last_oracle_ms: Optional[int] = None


def _set_error(msg: str) -> None:
    global _errors_count, _last_error
    _errors_count += 1
    _last_error = (msg or "unknown")[:500]


def _test_hook_allowed(http_request: Request) -> bool:
    if not MUSE_TEST_HEADERS_ENABLED:
        return False
    if not MUSE_TEST_TOKEN:
        return False
    return (http_request.headers.get("x-muse-test-token", "") or "") == MUSE_TEST_TOKEN


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

Style = Literal["brainstorm", "poem", "story", "essay"]


class InspireRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=MAX_TOPIC_CHARS)
    style: Optional[Style] = "brainstorm"


class InspireResponse(BaseModel):
    success: bool
    topic: str
    style: str
    content: str
    error: Optional[str] = None


class BrainstormRequest(BaseModel):
    problem: str = Field(..., min_length=1, max_length=MAX_PROBLEM_CHARS)


class _BrainstormItem(BaseModel):
    idea: str = Field(..., min_length=1, max_length=500)
    why_it_works: str = Field(..., min_length=1, max_length=1200)


class _BrainstormEnvelope(BaseModel):
    conventional: list[_BrainstormItem] = Field(..., min_length=5, max_length=5)
    unconventional: list[_BrainstormItem] = Field(..., min_length=3, max_length=3)
    moonshot: _BrainstormItem


class BrainstormResponse(BaseModel):
    success: bool
    problem: str
    conventional: List[Dict[str, str]]
    unconventional: List[Dict[str, str]]
    moonshot: Dict[str, str]
    raw_response: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Oracle helper
# ---------------------------------------------------------------------------

ORACLE_URL = "http://127.0.0.1:8888/oracle/chat"
_ORACLE_TIMEOUT = httpx.Timeout(ORACLE_DEADLINE_S, connect=3.0)


async def _call_oracle(prompt: str, system: str, *, extra_headers: dict | None = None, allow_test_headers: bool = False) -> str:
    """Call Oracle with strict deadline + strict header allowlist."""

    global _last_oracle_ms
    t0 = time.monotonic()

    allowed_test = {"x-oracle-force-empty-response"}

    # Base headers (always)
    headers = {
        "x-augmenter-bypass": "1",
    }

    # Allowlisted test headers only when explicitly enabled + authorized
    if allow_test_headers and isinstance(extra_headers, dict):
        for k, v in extra_headers.items():
            k = str(k).lower().strip()
            if k in allowed_test:
                headers[k] = str(v)

    try:
        with anyio.fail_after(ORACLE_DEADLINE_S):
            async with httpx.AsyncClient(timeout=_ORACLE_TIMEOUT) as client:
                resp = await client.post(
                    ORACLE_URL,
                    headers=headers,
                    json={
                        "prompt": prompt,
                        "system": system,
                        "priority": "normal",
                        "response_mode": "final_only",
                    },
                )
                resp.raise_for_status()
                data = resp.json() if resp.content else {}

        out = data.get("response") or data.get("text") or ""
        if not isinstance(out, str):
            out = str(out)
        out = out.strip()
        if not out:
            raise ValueError("oracle_empty_response")
        return out

    finally:
        try:
            _last_oracle_ms = int((time.monotonic() - t0) * 1000)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/status")
async def muse_status():
    return {
        "success": True,
        "level": 29,
        "name": "Muse",
        "status": "active",
        "creations_count": _creations_count,
        "errors_count": _errors_count,
        "last_error": _last_error,
        "last_oracle_ms": _last_oracle_ms,
        "limits": {
            "max_topic_chars": MAX_TOPIC_CHARS,
            "max_problem_chars": MAX_PROBLEM_CHARS,
            "oracle_deadline_s": ORACLE_DEADLINE_S,
        },
        "capabilities": ["creative_writing", "ideation", "brainstorming"],
    }


@router.post("/inspire", response_model=InspireResponse)
async def inspire(request: InspireRequest, http_request: Request):
    global _creations_count, _last_error

    style = (request.style or "brainstorm").strip().lower()

    system_prompt = (
        "Reply exact. "
        "You are a creative muse — an endlessly inventive source of original ideas, "
        "vivid imagery, and surprising perspectives. Your work is evocative, bold, and "
        "never generic. You surprise people with the depth and originality of your output."
    )

    if style == "brainstorm":
        user_prompt = (
            f"Generate a brainstorm about: {request.topic}\n\n"
            "Give 6 unique angles nobody has considered. "
            "Each should be genuinely surprising and thought-provoking. "
            "Number them 1-6."
        )
    else:
        user_prompt = (
            f"Generate a {style} about: {request.topic}\n\n"
            "Be original, evocative, and surprising. "
            "Make it memorable and craft it with care."
        )
    allow_test = _test_hook_allowed(http_request)
    extra: dict = {}
    if allow_test and http_request.headers.get("x-muse-test-oracle-empty", "") == "1":
        extra["x-oracle-force-empty-response"] = "1"

    try:
        content = await _call_oracle(user_prompt, system_prompt, extra_headers=(extra if allow_test else None), allow_test_headers=allow_test)
        _creations_count += 1
        _last_error = None
        return InspireResponse(success=True, topic=request.topic, style=style, content=content)

    except (TimeoutError, httpx.TimeoutException):
        _set_error("oracle_timeout")
        return InspireResponse(success=False, topic=request.topic, style=style, content="", error="oracle_timeout")
    except httpx.HTTPStatusError:
        _set_error("oracle_http_status")
        return InspireResponse(success=False, topic=request.topic, style=style, content="", error="oracle_http_status")
    except httpx.RequestError:
        _set_error("oracle_request_error")
        return InspireResponse(success=False, topic=request.topic, style=style, content="", error="oracle_request_error")
    except ValueError as e:
        _set_error(str(e) or "oracle_value_error")
        return InspireResponse(success=False, topic=request.topic, style=style, content="", error=str(e) or "oracle_value_error")
    except Exception as e:
        _set_error(f"inspire_error:{type(e).__name__}")
        return InspireResponse(success=False, topic=request.topic, style=style, content="", error="oracle_unknown_error")


@router.post("/brainstorm", response_model=BrainstormResponse)
async def brainstorm(request: BrainstormRequest, http_request: Request):
    global _creations_count, _last_error

    system_prompt = (
        "Return JSON only. You are an innovation consultant. "
        "Return valid JSON in this exact format: "
        '{"conventional": [{"idea": "...", "why_it_works": "..."}], '
        '"unconventional": [{"idea": "...", "why_it_works": "..."}], '
        '"moonshot": {"idea": "...", "why_it_works": "..."}}. '
        "conventional must have exactly 5 items; unconventional exactly 3; moonshot exactly 1 object." 
    )

    user_prompt = (
        f"For this problem: {request.problem}\n\n"
        "Generate: (1) 5 conventional solutions (2) 3 unconventional/lateral solutions (3) 1 moonshot idea. "
        "Return JSON only."
    )
    allow_test = _test_hook_allowed(http_request)
    extra: dict = {}
    if allow_test and http_request.headers.get("x-muse-test-oracle-empty", "") == "1":
        extra["x-oracle-force-empty-response"] = "1"

    raw: str = ""
    try:
        raw = await _call_oracle(user_prompt, system_prompt, extra_headers=(extra if allow_test else None), allow_test_headers=allow_test)

        json_str = raw.strip()
        if "```json" in json_str:
            json_str = json_str.split("```json", 1)[1].split("```", 1)[0].strip()
        elif "```" in json_str:
            json_str = json_str.split("```", 1)[1].split("```", 1)[0].strip()

        parsed = json.loads(json_str)
        env = _BrainstormEnvelope.model_validate(parsed)

        _creations_count += 1
        _last_error = None
        return BrainstormResponse(
            success=True,
            problem=request.problem,
            conventional=[i.model_dump() for i in env.conventional],
            unconventional=[i.model_dump() for i in env.unconventional],
            moonshot=env.moonshot.model_dump(),
        )

    except (TimeoutError, httpx.TimeoutException):
        _set_error("oracle_timeout")
        return BrainstormResponse(success=False, problem=request.problem, conventional=[], unconventional=[], moonshot={"idea": "", "why_it_works": ""}, error="oracle_timeout")
    except httpx.HTTPStatusError:
        _set_error("oracle_http_status")
        return BrainstormResponse(success=False, problem=request.problem, conventional=[], unconventional=[], moonshot={"idea": "", "why_it_works": ""}, error="oracle_http_status")
    except httpx.RequestError:
        _set_error("oracle_request_error")
        return BrainstormResponse(success=False, problem=request.problem, conventional=[], unconventional=[], moonshot={"idea": "", "why_it_works": ""}, error="oracle_request_error")
    except json.JSONDecodeError:
        _set_error("oracle_invalid_json")
        raw_out = raw if MUSE_DEBUG_RAW_RESPONSE else None
        if isinstance(raw_out, str) and raw_out and len(raw_out) > 1200:
            raw_out = raw_out[:1200] + "…"
        return BrainstormResponse(success=False, problem=request.problem, conventional=[], unconventional=[], moonshot={"idea": "", "why_it_works": ""}, raw_response=raw_out, error="oracle_invalid_json")
    except ValidationError:
        _set_error("oracle_invalid_json_schema")
        raw_out = raw if MUSE_DEBUG_RAW_RESPONSE else None
        if isinstance(raw_out, str) and raw_out and len(raw_out) > 1200:
            raw_out = raw_out[:1200] + "…"
        return BrainstormResponse(success=False, problem=request.problem, conventional=[], unconventional=[], moonshot={"idea": "", "why_it_works": ""}, raw_response=raw_out, error="oracle_invalid_json_schema")
    except ValueError as e:
        _set_error(str(e) or "oracle_value_error")
        return BrainstormResponse(success=False, problem=request.problem, conventional=[], unconventional=[], moonshot={"idea": "", "why_it_works": ""}, error=str(e) or "oracle_value_error")
    except Exception as e:
        _set_error(f"brainstorm_error:{type(e).__name__}")
        return BrainstormResponse(success=False, problem=request.problem, conventional=[], unconventional=[], moonshot={"idea": "", "why_it_works": ""}, error="oracle_unknown_error")
