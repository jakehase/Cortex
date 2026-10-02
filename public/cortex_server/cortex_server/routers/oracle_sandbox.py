"""L20-style Oracle sandbox router for isolated model route tests."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import os, requests, json
from pathlib import Path

router = APIRouter()
OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
DEFAULT_TEST_MODEL = 'openai/gpt-5'
ALLOWED_SANDBOX_MODELS = {'openai/gpt-5', 'openai/gpt-5-mini', 'openai/gpt-5-nano'}

class SandboxRequest(BaseModel):
    prompt: str
    model: Optional[str] = DEFAULT_TEST_MODEL


def _load_openrouter_key() -> str:
    try:
        cfg = json.loads(Path('/root/.openclaw/openclaw.json').read_text())
        return cfg.get('env', {}).get('vars', {}).get('OPENROUTER_API_KEY', '') or os.getenv('OPENROUTER_API_KEY', '')
    except Exception:
        return os.getenv('OPENROUTER_API_KEY', '')

@router.get('/status')
async def status():
    key_configured = bool(_load_openrouter_key())
    return {
        'status': 'ready_unverified' if key_configured else 'unavailable',
        'sandbox': True,
        'configured': key_configured,
        'provider_verified': False,
        'level_hint': 20,
        'default_test_model': DEFAULT_TEST_MODEL,
        'allowed_models': sorted(ALLOWED_SANDBOX_MODELS),
    }

@router.post('/probe')
async def probe(req: SandboxRequest):
    model = (req.model or DEFAULT_TEST_MODEL).strip()
    if model not in ALLOWED_SANDBOX_MODELS:
        raise HTTPException(status_code=400, detail=f'Model not allowed in sandbox: {model}')
    prompt = str(req.prompt or '').strip()
    if not prompt:
        raise HTTPException(status_code=400, detail='Prompt cannot be empty')

    key = _load_openrouter_key()
    if not key:
        raise HTTPException(status_code=503, detail='OPENROUTER_API_KEY missing')

    try:
        r = requests.post(
            OPENROUTER_URL,
            headers={'Authorization': f'Bearer {key}', 'Content-Type':'application/json'},
            json={'model': model, 'messages':[{'role':'user','content':prompt}], 'max_tokens':64},
            timeout=45,
        )
    except requests.Timeout as exc:
        raise HTTPException(status_code=504, detail='OpenRouter probe timed out') from exc
    except requests.RequestException as exc:
        raise HTTPException(status_code=503, detail='OpenRouter probe transport unavailable') from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail='OpenRouter probe transport failed') from exc

    upstream_status = int(getattr(r, 'status_code', 0) or 0)
    if upstream_status < 200 or upstream_status >= 300:
        route_status = 504 if upstream_status in {408, 504} else 502
        raise HTTPException(
            status_code=route_status,
            detail=f'OpenRouter upstream returned HTTP {upstream_status or "unknown"}',
        )

    try:
        body = r.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail='OpenRouter upstream returned non-JSON') from exc

    choices = body.get('choices') if isinstance(body, dict) else None
    first = choices[0] if isinstance(choices, list) and choices else None
    message = first.get('message') if isinstance(first, dict) else None
    response_text = message.get('content') if isinstance(message, dict) else None
    provider_model = str(body.get('model') or '').strip() if isinstance(body, dict) else ''
    if not isinstance(response_text, str) or not response_text.strip() or not provider_model:
        raise HTTPException(status_code=502, detail='OpenRouter upstream returned an invalid completion schema')
    if provider_model.casefold() != model.casefold():
        raise HTTPException(status_code=502, detail='OpenRouter upstream returned a different model than requested')

    return {
        'status_code': upstream_status,
        'ok': True,
        'model': provider_model,
        'requested_model': model,
        'response': response_text.strip(),
        'body': body,
    }
