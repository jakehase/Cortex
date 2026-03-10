"""
The Oracle - LLM Interface for The Cortex (Budget Configuration).

Updated for cost-efficient operation:
- DeepSeek V3.2: Critical reasoning (L5, L33, L35)
- Trinity Large Preview: Volume operations (L2 Ghost)
- Kimi K2.5: Fallback option
- TinyLlama: Local operations (always available)

All via OpenRouter for unified access.
"""
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Optional, Dict
import subprocess
import requests
import time
import os
import json
from pathlib import Path

router = APIRouter()

OLLAMA_URL = "http://localhost:11434"
TINYLLAMA_MODEL = "tinyllama"

# OpenRouter configuration
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Budget-optimized model configuration
MODELS = {
    "critical": "deepseek/deepseek-chat",  # L5 Oracle, L33 Ethicist, L35 Singularity
    "code": "deepseek/deepseek-chat",      # L27 Forge, L4 Lab
    "volume": "arcee-ai/trinity-large-preview",  # L2 Ghost (free)
    "fallback": "moonshotai/kimi-k2.5",    # Backup option
    "local": "tinyllama",                   # Always available
}

# Model pricing (output tokens per million)
PRICING = {
    "deepseek/deepseek-chat": 0.75,      # $0.75/M
    "arcee-ai/trinity-large-preview": 0.0,  # Free
    "moonshotai/kimi-k2.5": 2.00,        # $2/M
    "tinyllama": 0.0,                     # Free (local)
}

def _load_openrouter_key() -> str:
    """Load OpenRouter API key from environment or config."""
    # Check environment first
    env_key = os.getenv("OPENROUTER_API_KEY", "")
    if env_key:
        return env_key
    
    # Try config files
    try:
        possible_paths = [
            Path.home() / ".openclaw" / "openclaw.json",
            Path("/root/.openclaw/openclaw.json"),
        ]
        
        for config_path in possible_paths:
            if config_path.exists():
                with open(config_path, 'r') as f:
                    config = json.load(f)
                    key = config.get("env", {}).get("vars", {}).get("OPENROUTER_API_KEY", "")
                    if key:
                        return key
    except Exception:
        pass
    
    return ""

# Load key at startup
OPENROUTER_API_KEY = _load_openrouter_key()
if not OPENROUTER_API_KEY:
    print("[ORACLE] WARNING: OPENROUTER_API_KEY not configured. Budget models will fail.")

IS_BUSY = False


def call_openrouter(prompt: str, model: str, system: str = None, level: str = None) -> Dict:
    """Call OpenRouter API with budget-optimized configuration.
    
    Args:
        prompt: The user prompt
        model: OpenRouter model ID
        system: System prompt
        level: Which Cortex level is calling (for routing)
        
    Returns:
        Dict with response text and metadata
    """
    api_key = _load_openrouter_key()
    
    if not api_key:
        raise Exception("OPENROUTER_API_KEY not configured")
    
    # Route to appropriate model based on level
    if level:
        if level in ["ghost", "l2"]:
            model = MODELS["volume"]  # Trinity - free
        elif level in ["oracle", "l5", "ethicist", "l33", "singularity", "l35"]:
            model = MODELS["critical"]  # DeepSeek
        elif level in ["forge", "l27", "lab", "l4"]:
            model = MODELS["code"]  # DeepSeek
    
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
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 2000
    }
    
    response = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=180)
    response.raise_for_status()
    
    data = response.json()
    return {
        "response": data["choices"][0]["message"]["content"],
        "model": model,
        "cost_per_million": PRICING.get(model, 0)
    }


def ensure_ollama():
    """Ensure Ollama is running for local fallback."""
    result = subprocess.run(["which", "ollama"], capture_output=True)
    if result.returncode != 0:
        subprocess.run(
            "curl -fsSL https://ollama.com/install.sh | sh",
            shell=True,
            check=True
        )
    
    try:
        requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
    except requests.exceptions.ConnectionError:
        subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(3)
    
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        models = resp.json().get("models", [])
        if not any(m.get("name", "").startswith(TINYLLAMA_MODEL) for m in models):
            subprocess.run(["ollama", "pull", TINYLLAMA_MODEL], check=True)
    except Exception:
        pass


class ChatRequest(BaseModel):
    prompt: str
    system: Optional[str] = None
    model: Optional[str] = None
    level: Optional[str] = None  # Which Cortex level is calling
    priority: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    model: str
    done: bool
    cost_estimate: float = 0.0


def _load_persona() -> str:
    """Load the current persona from config file."""
    persona_path = "cortex_server/config/persona.txt"
    try:
        with open(persona_path, 'r') as f:
            return f.read().strip()
    except Exception:
        return """You are The Cortex, a multi-level AI system with 36 specialized levels.
You operate through orchestration of specialized capabilities.
Be genuinely helpful, have opinions, be resourceful."""


def _generate_sync(payload: dict, model: str) -> ChatResponse:
    """Synchronous function to call Ollama - runs in threadpool."""
    resp = requests.post(
        f"{OLLAMA_URL}/api/generate",
        json=payload,
        timeout=60
    )
    resp.raise_for_status()
    data = resp.json()
    
    return ChatResponse(
        response=data.get("response", ""),
        model=data.get("model", model),
        done=True,
        cost_estimate=0.0
    )


@router.post("/chat", response_model=ChatResponse)
async def oracle_chat(request: ChatRequest):
    """Send a prompt to the LLM and get a response.
    
    Budget-optimized routing:
    - L2 Ghost → Trinity (free)
    - L5/L33/L35 → DeepSeek (critical reasoning)
    - L4/L27 → DeepSeek (code)
    - Fallback → TinyLlama (local)
    """
    global IS_BUSY
    
    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")
    
    # Determine which model to use
    use_model = request.model
    
    if not use_model:
        # Auto-route based on level
        if request.level:
            level_lower = request.level.lower()
            if level_lower in ["ghost", "l2"]:
                use_model = MODELS["volume"]  # Trinity - free
            elif level_lower in ["oracle", "l5", "ethicist", "l33", "singularity", "l35"]:
                use_model = MODELS["critical"]  # DeepSeek
            elif level_lower in ["forge", "l27", "lab", "l4"]:
                use_model = MODELS["code"]  # DeepSeek
            else:
                use_model = MODELS["fallback"]  # Kimi
        else:
            # Default to DeepSeek for budget operation
            use_model = MODELS["critical"]
    
    # Check if we should use OpenRouter
    is_openrouter = not use_model.startswith("tinyllama")
    
    if is_openrouter and OPENROUTER_API_KEY:
        IS_BUSY = True
        try:
            result = call_openrouter(
                prompt=request.prompt,
                model=use_model,
                system=request.system or _load_persona(),
                level=request.level
            )
            return ChatResponse(
                response=result["response"],
                model=result["model"],
                done=True,
                cost_estimate=result.get("cost_per_million", 0)
            )
        except Exception as e:
            # Fallback to local Ollama
            ensure_ollama()
            payload = {
                "model": TINYLLAMA_MODEL,
                "prompt": request.prompt,
                "system": request.system or _load_persona(),
                "stream": False
            }
            result = await run_in_threadpool(_generate_sync, payload, TINYLLAMA_MODEL)
            return result
        finally:
            IS_BUSY = False
    else:
        # Use local Ollama
        ensure_ollama()
        
        payload = {
            "model": TINYLLAMA_MODEL,
            "prompt": request.prompt,
            "system": request.system or _load_persona(),
            "stream": False
        }
        
        IS_BUSY = True
        try:
            result = await run_in_threadpool(_generate_sync, payload, TINYLLAMA_MODEL)
            return result
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")
        finally:
            IS_BUSY = False


@router.get("/status")
async def oracle_status():
    """Check Oracle status and configuration."""
    status = {
        "status": "online",
        "configuration": "budget_optimized",
        "models": MODELS,
        "pricing": PRICING,
        "default_model": MODELS["critical"],
        "openrouter_key_configured": bool(OPENROUTER_API_KEY),
        "is_busy": IS_BUSY
    }
    
    # Check local Ollama
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
        data = resp.json()
        status["local_models"] = [m.get("name") for m in data.get("models", [])]
    except Exception as e:
        status["local_status"] = f"offline: {str(e)}"
    
    return status


@router.get("/models")
async def list_models():
    """List available models and their pricing."""
    return {
        "success": True,
        "models": MODELS,
        "pricing_per_million_tokens": PRICING,
        "recommendations": {
            "critical_reasoning": MODELS["critical"],
            "code_generation": MODELS["code"],
            "volume_operations": MODELS["volume"],
            "fallback": MODELS["fallback"],
            "local": MODELS["local"]
        }
    }
