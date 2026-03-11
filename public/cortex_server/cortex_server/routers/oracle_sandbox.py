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
    return {
        'status': 'online',
        'sandbox': True,
        'level_hint': 20,
        'default_test_model': DEFAULT_TEST_MODEL,
        'allowed_models': sorted(ALLOWED_SANDBOX_MODELS),
    }

@router.post('/probe')
async def probe(req: SandboxRequest):
    model = (req.model or DEFAULT_TEST_MODEL).strip()
    if model not in ALLOWED_SANDBOX_MODELS:
        raise HTTPException(status_code=400, detail=f'Model not allowed in sandbox: {model}')

    key = _load_openrouter_key()
    if not key:
        raise HTTPException(status_code=503, detail='OPENROUTER_API_KEY missing')

    r = requests.post(
        OPENROUTER_URL,
        headers={'Authorization': f'Bearer {key}', 'Content-Type':'application/json'},
        json={'model': model, 'messages':[{'role':'user','content':req.prompt}], 'max_tokens':64},
        timeout=45,
    )
    try:
        body = r.json()
    except Exception:
        body = {'raw': r.text[:400]}
    return {'status_code': r.status_code, 'ok': r.status_code < 400, 'model': model, 'body': body}
