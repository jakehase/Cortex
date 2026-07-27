from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import subprocess, uuid, os, json, hashlib, re, math, time

app = FastAPI()
WORKDIR = "/root/clawd/deploy/oracle-workspace-lite"
OPENCLAW = os.getenv("OPENCLAW_BIN", "openclaw")
TIMEOUT = int(os.getenv("ORACLE_EXECUTOR_TIMEOUT", "60"))
AGENT_ID = os.getenv("ORACLE_EXECUTOR_AGENT", "oracle").strip() or "oracle"
THINKING = os.getenv("ORACLE_EXECUTOR_THINKING", "xhigh").strip().lower() or "xhigh"
if THINKING != "xhigh":
    raise RuntimeError("ORACLE_EXECUTOR_THINKING must remain xhigh")
LOCAL_EXECUTION = os.getenv("ORACLE_EXECUTOR_LOCAL", "true").strip().lower() not in {"0", "false", "no", "off"}
RESET_AGENT_SESSION = os.getenv("ORACLE_EXECUTOR_RESET_AGENT_SESSION", "true").strip().lower() not in {"0", "false", "no", "off"}
RESET_AGENT_SESSION_KEY = os.getenv("ORACLE_EXECUTOR_RESET_AGENT_SESSION_KEY", f"agent:{AGENT_ID}:main").strip() or f"agent:{AGENT_ID}:main"
SESSION_ID = os.getenv("ORACLE_EXECUTOR_SESSION_ID", "oracle-gateway")
SESSION_MODE = os.getenv("ORACLE_EXECUTOR_SESSION_MODE", "ephemeral").strip().lower() or "ephemeral"
SESSION_BUCKET_MINUTES = max(1, int(os.getenv("ORACLE_EXECUTOR_SESSION_BUCKET_MINUTES", "60")))
SESSION_DIR = os.getenv("ORACLE_EXECUTOR_SESSION_DIR", os.path.join(os.path.expanduser("~"), ".openclaw", "agents", "main", "sessions"))
SESSION_RETENTION_COUNT = max(20, int(os.getenv("ORACLE_EXECUTOR_SESSION_RETENTION_COUNT", "300")))
SESSION_RETENTION_DAYS = max(1, int(os.getenv("ORACLE_EXECUTOR_SESSION_RETENTION_DAYS", "7")))
SESSION_CLEANUP_INTERVAL_SECONDS = max(60, int(os.getenv("ORACLE_EXECUTOR_SESSION_CLEANUP_INTERVAL_SECONDS", "1800")))
LAST_CLEANUP_AT = 0.0

class InvokeRequest(BaseModel):
    prompt: str
    system: str | None = None

def _sanitize_session_id(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9._-]+", "-", value or "").strip("-")
    return clean or "oracle-gateway"

def _prompt_kind(prompt: str) -> str:
    p = (prompt or '').strip().lower()
    if p in {"hi", "hello", "hey", "yo"}:
        return "greet"
    if len(p) <= 120:
        return "short"
    return "general"

def _bucket_label() -> str:
    bucket_seconds = SESSION_BUCKET_MINUTES * 60
    bucket_start = math.floor(time.time() / bucket_seconds) * bucket_seconds
    return time.strftime('%Y%m%d%H%M', time.gmtime(bucket_start))

def _session_prefix() -> str:
    return f"{_sanitize_session_id(SESSION_ID)}-"

def _session_for_prompt(prompt: str) -> str:
    base = _sanitize_session_id(SESSION_ID)
    kind = _prompt_kind(prompt)
    mode = SESSION_MODE
    if mode in {'ephemeral', 'one-shot', 'oneshot', 'stateless'}:
        return f"{base}-{kind}-{uuid.uuid4().hex[:12]}"
    digest = hashlib.sha1((prompt or '').strip().lower().encode('utf-8')).hexdigest()[:10]
    return f"{base}-{kind}-{_bucket_label()}-{digest}"

def _matching_session_entries(session_dir: str = SESSION_DIR):
    prefix = _session_prefix()
    entries = []
    if not os.path.isdir(session_dir):
        return entries
    for name in os.listdir(session_dir):
        if not name.startswith(prefix) or not name.endswith('.jsonl'):
            continue
        path = os.path.join(session_dir, name)
        try:
            stat = os.stat(path)
        except FileNotFoundError:
            continue
        entries.append((stat.st_mtime, path))
    return sorted(entries, key=lambda item: item[0], reverse=True)

def _prune_local_sessions(now: float | None = None, session_dir: str = SESSION_DIR):
    now = time.time() if now is None else now
    cutoff = now - (SESSION_RETENTION_DAYS * 86400)
    removed = []
    for index, (mtime, path) in enumerate(_matching_session_entries(session_dir)):
        if index < SESSION_RETENTION_COUNT and mtime >= cutoff:
            continue
        try:
            os.remove(path)
            removed.append(os.path.basename(path))
        except FileNotFoundError:
            continue
    return removed

def _strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text or "")

def _extract_json_payload(raw: str):
    cleaned = _strip_ansi(raw).strip()
    if not cleaned:
        raise ValueError('empty response')
    decoder = json.JSONDecoder()
    try:
        return decoder.decode(cleaned)
    except Exception:
        pass
    starts = [idx for idx, ch in enumerate(cleaned) if ch == '{']
    for start in starts:
        try:
            obj, end = decoder.raw_decode(cleaned[start:])
        except Exception:
            continue
        if cleaned[start + end:].strip():
            continue
        return obj
    raise ValueError('no JSON object found in stdout')

def _maybe_cleanup_local_sessions():
    global LAST_CLEANUP_AT
    now = time.time()
    if now - LAST_CLEANUP_AT < SESSION_CLEANUP_INTERVAL_SECONDS:
        return []
    removed = _prune_local_sessions(now=now)
    LAST_CLEANUP_AT = now
    return removed

@app.get('/health')
def health():
    return {
        "ok": True,
        "service": "oracle-executor",
        "mode": "gateway-agent",
        "agentId": AGENT_ID,
        "thinking": THINKING,
        "localExecution": LOCAL_EXECUTION,
        "resetAgentSession": RESET_AGENT_SESSION,
        "resetAgentSessionKey": RESET_AGENT_SESSION_KEY,
        "sessionBase": SESSION_ID,
        "sessionMode": SESSION_MODE,
        "sessionBucketMinutes": SESSION_BUCKET_MINUTES,
        "sessionRetentionCount": SESSION_RETENTION_COUNT,
        "sessionRetentionDays": SESSION_RETENTION_DAYS,
        "sessionCleanupIntervalSeconds": SESSION_CLEANUP_INTERVAL_SECONDS,
    }

@app.post('/invoke')
def invoke(req: InvokeRequest):
    prompt = (req.prompt or '').strip()
    if not prompt:
        raise HTTPException(status_code=400, detail='prompt required')
    session_id = _session_for_prompt(prompt)
    bridged_prompt = (
        "You are the host-side Oracle executor for Cortex. "
        "Return only the answer text that Oracle should say. "
        "Do not add labels, confidence scores, priorities, disclaimers, or meta-commentary. "
        "Be concise but not shallow: answer the request directly with concrete substance. "
        "If the request is a greeting, reply with exactly one warm sentence offering help. "
        "If the request asks for a definition or explanation, answer in one or two crisp sentences. "
        "If the request asks for analysis, give the strongest direct answer you can in plain English. "
        "Avoid generic assistant filler like 'How can I assist you today?' or 'Live conditions can still shift'.\n\n"
        f"User request: {prompt}"
    )
    if RESET_AGENT_SESSION:
        reset_cmd = [
            OPENCLAW, 'gateway', 'call', 'sessions.reset',
            '--params', json.dumps({'key': RESET_AGENT_SESSION_KEY}),
            '--json',
        ]
        reset = subprocess.run(reset_cmd, cwd=WORKDIR, capture_output=True, text=True, timeout=30)
        if reset.returncode != 0:
            raise HTTPException(status_code=503, detail=f'failed to reset oracle session: {(reset.stderr or reset.stdout)[:400]}')
    cmd = [OPENCLAW, 'agent']
    if LOCAL_EXECUTION:
        cmd.append('--local')
    cmd.extend([
        '--agent', AGENT_ID,
        '--session-id', session_id,
        '--message', bridged_prompt,
        '--thinking', THINKING,
        '--timeout', str(TIMEOUT),
        '--json',
    ])
    try:
        r = subprocess.run(cmd, cwd=WORKDIR, capture_output=True, text=True, timeout=TIMEOUT + 20)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail='oracle executor timeout')
    if r.returncode != 0:
        raise HTTPException(status_code=503, detail=(r.stderr or r.stdout or 'executor failed')[:1200])
    try:
        data = _extract_json_payload(r.stdout)
        payloads = data.get('result', {}).get('payloads') or data.get('payloads') or []
        text = ''
        if payloads and isinstance(payloads[0], dict):
            text = (payloads[0].get('text') or '').strip()
        if not text:
            raise ValueError('empty response')
        meta = data.get('result', {}).get('meta') or data.get('meta') or {}
        agent_meta = meta.get('agentMeta') or {}
        cleaned = _maybe_cleanup_local_sessions()
        return {
            'ok': True,
            'response': text,
            'model': agent_meta.get('model') or 'openclaw-gateway-agent',
            'provider': agent_meta.get('provider') or 'openclaw',
            'sessionId': agent_meta.get('sessionId') or session_id,
            'cleanupRemoved': len(cleaned),
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f'invalid executor payload: {e}; raw={(r.stdout or r.stderr)[:800]}')
