from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import subprocess
import os
import json
import hashlib
import re
import uuid
import math
import time

app = FastAPI()
CT101_HOST = os.getenv("CT101_HOST", "10.0.0.220")
CT101_USER = os.getenv("CT101_USER", "root")
CT101_KEY = os.getenv("CT101_KEY", "/opt/cortex-oracle-bridge/ct101_exec_key")
CT101_WORKDIR = os.getenv("CT101_WORKDIR", "/root/clawd/deploy/oracle-workspace-lite")
TIMEOUT = int(os.getenv("ORACLE_EXECUTOR_TIMEOUT", "60"))
AGENT_ID = os.getenv("ORACLE_EXECUTOR_AGENT", "oracle").strip() or "oracle"
THINKING = os.getenv("ORACLE_EXECUTOR_THINKING", "xhigh").strip().lower() or "xhigh"
if THINKING != "xhigh":
    raise RuntimeError("ORACLE_EXECUTOR_THINKING must remain xhigh")
EXPECTED_MODEL = os.getenv("ORACLE_EXECUTOR_EXPECTED_MODEL", "").strip()
LAST_EXECUTION_IDENTITY = {"model": None, "provider": None, "observedAt": None}
LOCAL_EXECUTION = os.getenv("ORACLE_EXECUTOR_LOCAL", "true").strip().lower() not in {"0", "false", "no", "off"}
RESET_AGENT_SESSION = os.getenv("ORACLE_EXECUTOR_RESET_AGENT_SESSION", "true").strip().lower() not in {"0", "false", "no", "off"}
RESET_AGENT_SESSION_KEY = os.getenv("ORACLE_EXECUTOR_RESET_AGENT_SESSION_KEY", f"agent:{AGENT_ID}:main").strip() or f"agent:{AGENT_ID}:main"
SESSION_ID = os.getenv("ORACLE_EXECUTOR_SESSION_ID", "oracle-prod-bridge")
SESSION_MODE = os.getenv("ORACLE_EXECUTOR_SESSION_MODE", "ephemeral").strip().lower() or "ephemeral"
SESSION_BUCKET_MINUTES = max(1, int(os.getenv("ORACLE_EXECUTOR_SESSION_BUCKET_MINUTES", "60")))
REMOTE_SESSION_DIR = os.getenv("ORACLE_EXECUTOR_REMOTE_SESSION_DIR", f"/root/.openclaw/agents/{AGENT_ID}/sessions")
SESSION_RETENTION_COUNT = max(20, int(os.getenv("ORACLE_EXECUTOR_SESSION_RETENTION_COUNT", "300")))
SESSION_RETENTION_DAYS = max(1, int(os.getenv("ORACLE_EXECUTOR_SESSION_RETENTION_DAYS", "7")))
SESSION_CLEANUP_INTERVAL_SECONDS = max(60, int(os.getenv("ORACLE_EXECUTOR_SESSION_CLEANUP_INTERVAL_SECONDS", "1800")))
LAST_CLEANUP_AT = 0.0


class InvokeRequest(BaseModel):
    prompt: str
    system: str | None = None


def _sanitize_session_id(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9._-]+", "-", value or "").strip("-")
    return clean or "oracle-prod-bridge"


def _prompt_kind(prompt: str) -> str:
    p = (prompt or "").strip().lower()
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
    if SESSION_MODE in {"ephemeral", "one-shot", "oneshot", "stateless"}:
        return f"{base}-{kind}-{uuid.uuid4().hex[:12]}"
    digest = hashlib.sha1((prompt or "").strip().lower().encode("utf-8")).hexdigest()[:10]
    return f"{base}-{kind}-{_bucket_label()}-{digest}"

def _build_remote_cleanup_cmd(now: float | None = None) -> str:
    now = time.time() if now is None else now
    cutoff = now - (SESSION_RETENTION_DAYS * 86400)
    script = (
        "import glob, os, time; "
        f"paths=sorted(glob.glob({json.dumps(os.path.join(REMOTE_SESSION_DIR, _session_prefix() + '*.jsonl'))}), key=os.path.getmtime, reverse=True); "
        f"cutoff={cutoff!r}; keep={SESSION_RETENTION_COUNT}; removed=[]; "
        "for idx, path in enumerate(paths):\n"
        "    mtime = os.path.getmtime(path)\n"
        "    if idx < keep and mtime >= cutoff:\n"
        "        continue\n"
        "    try:\n"
        "        os.remove(path)\n"
        "        removed.append(os.path.basename(path))\n"
        "    except FileNotFoundError:\n"
        "        pass\n"
        "print('\\n'.join(removed))"
    )
    return f"python3 -c {json.dumps(script)}"

def _strip_ansi(text: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text or "")

def _extract_json_payload(raw: str):
    cleaned = _strip_ansi(raw).strip()
    if not cleaned:
        raise ValueError('empty response')
    decoder = json.JSONDecoder()
    try:
        candidate = decoder.decode(cleaned)
        payloads = candidate.get('result', {}).get('payloads') or candidate.get('payloads') if isinstance(candidate, dict) else None
        if payloads:
            return candidate
    except Exception:
        pass
    starts = [idx for idx, ch in enumerate(cleaned) if ch == '{']
    for start in starts:
        try:
            obj, _end = decoder.raw_decode(cleaned[start:])
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        payloads = obj.get('result', {}).get('payloads') or obj.get('payloads')
        if payloads:
            return obj
    raise ValueError('no response JSON object found in process output')

def _maybe_cleanup_remote_sessions():
    global LAST_CLEANUP_AT
    now = time.time()
    if now - LAST_CLEANUP_AT < SESSION_CLEANUP_INTERVAL_SECONDS:
        return []
    cleanup_cmd = [
        'ssh', '-i', CT101_KEY, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no',
        f'{CT101_USER}@{CT101_HOST}', _build_remote_cleanup_cmd(now),
    ]
    try:
        r = subprocess.run(cleanup_cmd, capture_output=True, text=True, timeout=60)
        LAST_CLEANUP_AT = now
        if r.returncode != 0:
            return []
        return [line.strip() for line in (r.stdout or '').splitlines() if line.strip()]
    except Exception:
        return []


@app.get('/health')
def health():
    return {
        "ok": True,
        "service": "oracle-executor",
        "mode": "ssh-ct101-openclaw",
        "ct101": CT101_HOST,
        "agentId": AGENT_ID,
        "thinking": THINKING,
        "modelIdentity": {
            "expected": EXPECTED_MODEL or None,
            "expectedSource": "env:ORACLE_EXECUTOR_EXPECTED_MODEL" if EXPECTED_MODEL else "unconfigured",
            "actualIdentityRequiredPerInvocation": True,
            "expectedMatchRequired": bool(EXPECTED_MODEL),
            "lastObserved": dict(LAST_EXECUTION_IDENTITY),
        },
        "healthScope": "configuration_and_last_observation_only",
        "providerCallMadeByHealth": False,
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

    reset_cmd = ""
    if RESET_AGENT_SESSION:
        reset_params = json.dumps({"key": RESET_AGENT_SESSION_KEY})
        reset_cmd = f"openclaw gateway call sessions.reset --params {json.dumps(reset_params)} --json >/dev/null && "
    local_flag = "--local " if LOCAL_EXECUTION else ""
    remote_cmd = (
        f"cd {CT101_WORKDIR} && "
        f"{reset_cmd}"
        f"openclaw agent {local_flag}--agent {json.dumps(AGENT_ID)} --session-id {session_id} --message {json.dumps(bridged_prompt)} "
        f"--thinking {THINKING} --timeout {TIMEOUT} --json"
    )
    cmd = [
        'ssh', '-i', CT101_KEY, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no',
        f'{CT101_USER}@{CT101_HOST}', remote_cmd
    ]

    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT + 20)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail='oracle executor timeout')

    if r.returncode != 0:
        raise HTTPException(status_code=503, detail=(r.stderr or r.stdout or 'executor failed')[:1200])

    try:
        data = _extract_json_payload('\n'.join(part for part in [r.stdout, r.stderr] if part))
        payloads = data.get('result', {}).get('payloads') or data.get('payloads') or []
        text = ''
        if payloads and isinstance(payloads[0], dict):
            text = (payloads[0].get('text') or '').strip()
        if not text:
            raise ValueError('empty response')
        meta = data.get('result', {}).get('meta') or data.get('meta') or {}
        agent_meta = meta.get('agentMeta') or {}
        actual_model = str(agent_meta.get('model') or '').strip()
        actual_provider = str(agent_meta.get('provider') or '').strip()
        if not actual_model or not actual_provider:
            raise ValueError('provider/model identity missing from successful executor payload')
        if EXPECTED_MODEL and actual_model != EXPECTED_MODEL:
            raise ValueError(f'executor model mismatch: expected={EXPECTED_MODEL!r} observed={actual_model!r}')
        global LAST_EXECUTION_IDENTITY
        LAST_EXECUTION_IDENTITY = {
            "model": actual_model,
            "provider": actual_provider,
            "observedAt": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        }
        cleaned = _maybe_cleanup_remote_sessions()
        return {
            'ok': True,
            'response': text,
            'model': actual_model,
            'provider': actual_provider,
            'sessionId': agent_meta.get('sessionId') or session_id,
            'cleanupRemoved': len(cleaned),
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f'invalid executor payload: {e}; raw={(r.stdout or r.stderr)[:800]}')
