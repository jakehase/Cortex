"""
The Oracle - Local LLM Interface for The Cortex.

Configuration:
- TinyLlama (local): Default for basic/fast tasks
- OpenRouter (Kimi K2.5): High-priority/reasoning tasks

Adds two low-risk, flag-gated production helpers:
1) Format-aware error extraction + grouping (diagnostics only)
2) Soft latency-path hints for default routing (conservative)
"""
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Optional, Dict, Any
import subprocess
import requests
import time
import os
import json
import re
from pathlib import Path
from collections import deque

router = APIRouter()

OLLAMA_URL = "http://localhost:11434"
TINYLLAMA = "tinyllama"

# OpenRouter - from OpenClaw config
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_OR_MODEL = "openrouter/moonshotai/kimi-k2.5"

# Feature flags (low-risk, diagnostics-first)
ENABLE_ERROR_GROUPING = os.getenv("ORACLE_ENABLE_ERROR_GROUPING", "1") in {"1", "true", "TRUE", "yes"}
ENABLE_LATENCY_HINTS = os.getenv("ORACLE_ENABLE_LATENCY_HINTS", "1") in {"1", "true", "TRUE", "yes"}
LATENCY_HINT_THRESHOLD_MS = int(os.getenv("ORACLE_LATENCY_HINT_THRESHOLD_MS", "3500"))
HINT_COOLDOWN_SECONDS = int(os.getenv("ORACLE_HINT_COOLDOWN_SECONDS", "60"))


def _load_openrouter_key() -> str:
    """Load OpenRouter API key."""
    env_key = os.getenv("OPENROUTER_API_KEY", "")
    if env_key:
        return env_key

    try:
        config_path = Path.home() / ".openclaw" / "openclaw.json"
        if config_path.exists():
            with open(config_path, 'r') as f:
                config = json.load(f)
                return config.get("env", {}).get("vars", {}).get("OPENROUTER_API_KEY", "")
    except Exception:
        pass

    return ""


OPENROUTER_API_KEY = _load_openrouter_key()
IS_BUSY = False

# Rolling diagnostics state (in-memory, reset on process restart)
LATENCY_MS = {
    "tinyllama": deque(maxlen=30),
    "openrouter": deque(maxlen=30),
}
ROUTE_HINT_STATE = {
    "last_hint_at": 0.0,
    "last_hint": "none",
}
ERROR_GROUPS: Dict[str, Dict[str, Any]] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _record_latency(route: str, elapsed_ms: float) -> None:
    if route in LATENCY_MS:
        LATENCY_MS[route].append(float(elapsed_ms))


def _avg_latency(route: str) -> float:
    vals = LATENCY_MS.get(route) or []
    return (sum(vals) / len(vals)) if vals else 0.0


def _extract_error_fingerprint(exc: Exception) -> Dict[str, str]:
    """Extract lightweight format/error-class signal for grouping."""
    text = str(exc) or exc.__class__.__name__
    low = text.lower()

    if "json" in low and ("decode" in low or "parse" in low or "expect" in low):
        kind = "format.json_parse"
    elif "timeout" in low or "timed out" in low:
        kind = "network.timeout"
    elif "connection" in low and ("refused" in low or "reset" in low or "aborted" in low):
        kind = "network.connection"
    elif "429" in low or "rate limit" in low:
        kind = "provider.rate_limit"
    elif "401" in low or "unauthorized" in low or "forbidden" in low:
        kind = "provider.auth"
    elif "5" in low and "http" in low:
        kind = "provider.http_5xx"
    else:
        kind = f"generic.{exc.__class__.__name__.lower()}"

    snippet = re.sub(r"\s+", " ", text).strip()[:140]
    return {"kind": kind, "snippet": snippet}


def _record_error_group(source: str, exc: Exception) -> None:
    if not ENABLE_ERROR_GROUPING:
        return

    fp = _extract_error_fingerprint(exc)
    key = f"{source}:{fp['kind']}"
    item = ERROR_GROUPS.get(key) or {
        "source": source,
        "kind": fp["kind"],
        "count": 0,
        "first_seen_ms": _now_ms(),
        "last_seen_ms": _now_ms(),
        "sample": fp["snippet"],
    }
    item["count"] += 1
    item["last_seen_ms"] = _now_ms()
    ERROR_GROUPS[key] = item


def _should_hint_openrouter() -> bool:
    """Soft hint: prefer OpenRouter when local latency is persistently high."""
    if not ENABLE_LATENCY_HINTS or not OPENROUTER_API_KEY:
        return False

    avg_local = _avg_latency("tinyllama")
    if avg_local <= 0 or avg_local < LATENCY_HINT_THRESHOLD_MS:
        return False

    now = time.time()
    if now - ROUTE_HINT_STATE["last_hint_at"] < HINT_COOLDOWN_SECONDS:
        return False

    ROUTE_HINT_STATE["last_hint_at"] = now
    ROUTE_HINT_STATE["last_hint"] = "openrouter_due_to_local_latency"
    return True


def call_openrouter(prompt: str, system: str = None) -> str:
    """Call OpenRouter API."""
    api_key = _load_openrouter_key()
    if not api_key:
        raise Exception("OPENROUTER_API_KEY not configured")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": "http://localhost:8000",
        "X-Title": "The Cortex",
        "Content-Type": "application/json"
    }

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": DEFAULT_OR_MODEL,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 2000
    }

    t0 = time.perf_counter()
    try:
        response = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=180)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        _record_error_group("openrouter", e)
        raise
    finally:
        _record_latency("openrouter", (time.perf_counter() - t0) * 1000.0)


def ensure_ollama():
    """Ensure Ollama is running."""
    result = subprocess.run(["which", "ollama"], capture_output=True)
    if result.returncode != 0:
        subprocess.run("curl -fsSL https://ollama.com/install.sh | sh", shell=True, check=True)

    try:
        requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
    except requests.exceptions.ConnectionError:
        subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(3)

    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        models = resp.json().get("models", [])
        if not any(m.get("name", "").startswith(TINYLLAMA) for m in models):
            subprocess.run(["ollama", "pull", TINYLLAMA], check=True)
    except Exception as e:
        _record_error_group("ollama", e)


class ChatRequest(BaseModel):
    prompt: str
    system: Optional[str] = None
    priority: Optional[str] = None  # 'high' = OpenRouter, default = TinyLlama (+ soft latency hints)


class ChatResponse(BaseModel):
    response: str
    model: str
    done: bool


def _load_persona() -> str:
    """Load persona."""
    try:
        with open("cortex_server/config/persona.txt", 'r') as f:
            return f.read().strip()
    except Exception:
        return "You are The Cortex, a multi-level AI system. Be helpful."


def _call_tinyllama_sync(prompt: str, system: str) -> ChatResponse:
    """Call local TinyLlama."""
    t0 = time.perf_counter()
    try:
        resp = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": TINYLLAMA,
                "prompt": prompt,
                "system": system,
                "stream": False
            },
            timeout=60
        )
        resp.raise_for_status()
        data = resp.json()

        return ChatResponse(
            response=data.get("response", ""),
            model=TINYLLAMA,
            done=True
        )
    except Exception as e:
        _record_error_group("tinyllama", e)
        raise
    finally:
        _record_latency("tinyllama", (time.perf_counter() - t0) * 1000.0)


@router.post("/chat", response_model=ChatResponse)
async def oracle_chat(request: ChatRequest):
    """Chat with Oracle.

    - Default: TinyLlama (local, fast, free)
    - priority='high': OpenRouter (better reasoning)
    - Optional soft hint: route default traffic to OpenRouter if local latency degrades.
    """
    global IS_BUSY

    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    system = request.system or _load_persona()

    # High priority = OpenRouter
    if request.priority == 'high' and OPENROUTER_API_KEY:
        IS_BUSY = True
        try:
            response_text = call_openrouter(request.prompt, system)
            return ChatResponse(
                response=response_text,
                model=DEFAULT_OR_MODEL,
                done=True
            )
        except Exception:
            # Fallback to TinyLlama
            ensure_ollama()
            result = await run_in_threadpool(_call_tinyllama_sync, request.prompt, system)
            return result
        finally:
            IS_BUSY = False

    # Default path = TinyLlama, unless soft latency hint says otherwise.
    IS_BUSY = True
    try:
        if _should_hint_openrouter():
            try:
                response_text = call_openrouter(request.prompt, system)
                return ChatResponse(
                    response=response_text,
                    model=DEFAULT_OR_MODEL,
                    done=True
                )
            except Exception:
                # Soft hint only; fallback immediately to local path.
                pass

        ensure_ollama()
        result = await run_in_threadpool(_call_tinyllama_sync, request.prompt, system)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
    finally:
        IS_BUSY = False


@router.get("/status")
async def oracle_status():
    """Check Oracle status."""
    grouped = sorted(ERROR_GROUPS.values(), key=lambda x: x.get("last_seen_ms", 0), reverse=True)[:8]
    status = {
        "status": "online",
        "default_model": TINYLLAMA,
        "high_priority_model": DEFAULT_OR_MODEL,
        "openrouter_key_configured": bool(OPENROUTER_API_KEY),
        "is_busy": IS_BUSY,
        "feature_flags": {
            "error_grouping": ENABLE_ERROR_GROUPING,
            "latency_hints": ENABLE_LATENCY_HINTS,
            "latency_hint_threshold_ms": LATENCY_HINT_THRESHOLD_MS,
            "hint_cooldown_seconds": HINT_COOLDOWN_SECONDS,
        },
        "latency": {
            "tinyllama_avg_ms": round(_avg_latency("tinyllama"), 1),
            "openrouter_avg_ms": round(_avg_latency("openrouter"), 1),
            "samples": {
                "tinyllama": len(LATENCY_MS["tinyllama"]),
                "openrouter": len(LATENCY_MS["openrouter"]),
            },
            "last_hint": ROUTE_HINT_STATE.get("last_hint", "none"),
        },
        "error_groups": grouped,
    }

    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
        data = resp.json()
        status["local_models"] = [m.get("name") for m in data.get("models", [])]
    except Exception as e:
        _record_error_group("ollama", e)
        status["local_status"] = f"offline: {str(e)}"

    return status
