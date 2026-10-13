from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
import subprocess, uuid, os, json, hashlib, hmac, re, math, time
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

app = FastAPI()
LOGGER = logging.getLogger("cortex.oracle_executor")
WORKDIR = os.getenv("ORACLE_EXECUTOR_WORKDIR", "/root/clawd/deploy/oracle-workspace-lite")
OPENCLAW = os.getenv("OPENCLAW_BIN", "openclaw")
TIMEOUT = int(os.getenv("ORACLE_EXECUTOR_TIMEOUT", "60"))
AGENT_ID = os.getenv("ORACLE_EXECUTOR_AGENT", "oracle").strip() or "oracle"
EXPECTED_MODEL = os.getenv("ORACLE_EXECUTOR_MODEL", "gpt-5.6-sol").strip() or "gpt-5.6-sol"
AUTH_POLICY = os.getenv("ORACLE_EXECUTOR_AUTH_POLICY", "pmhnp_oauth_approved_2026-09-25").strip()
SERVICE_TIER_POLICY = os.getenv("ORACLE_EXECUTOR_SERVICE_TIER_POLICY", "provider_default_no_override").strip()
EXECUTOR_TOKEN = (os.getenv("ORACLE_EXECUTOR_TOKEN") or os.getenv("ORACLE_BRIDGE_TOKEN") or "").strip()
if EXECUTOR_TOKEN and len(EXECUTOR_TOKEN) < 32:
    raise RuntimeError("Oracle executor token must contain at least 32 characters")
THINKING = os.getenv("ORACLE_EXECUTOR_THINKING", "xhigh").strip().lower() or "xhigh"
if THINKING != "xhigh":
    raise RuntimeError("ORACLE_EXECUTOR_THINKING must remain xhigh")
if AUTH_POLICY != "pmhnp_oauth_approved_2026-09-25":
    raise RuntimeError("ORACLE_EXECUTOR_AUTH_POLICY must remain pmhnp_oauth_approved_2026-09-25")
if SERVICE_TIER_POLICY != "provider_default_no_override":
    raise RuntimeError("ORACLE_EXECUTOR_SERVICE_TIER_POLICY must not force a service tier")
LOCAL_EXECUTION = os.getenv("ORACLE_EXECUTOR_LOCAL", "true").strip().lower() not in {"0", "false", "no", "off"}
RESET_AGENT_SESSION = os.getenv("ORACLE_EXECUTOR_RESET_AGENT_SESSION", "false").strip().lower() not in {"0", "false", "no", "off"}
if RESET_AGENT_SESSION:
    raise RuntimeError("ORACLE_EXECUTOR_RESET_AGENT_SESSION must remain disabled for the local Oracle executor")
RESET_AGENT_SESSION_KEY = os.getenv("ORACLE_EXECUTOR_RESET_AGENT_SESSION_KEY", f"agent:{AGENT_ID}:main").strip() or f"agent:{AGENT_ID}:main"
OPENCLAW_STATE_DIR = os.path.abspath(
    os.getenv("OPENCLAW_STATE_DIR", "/var/lib/cortex-oracle/openclaw-state")
)
if OPENCLAW_STATE_DIR != "/var/lib/cortex-oracle/openclaw-state":
    raise RuntimeError("OPENCLAW_STATE_DIR must remain service-owned for the Oracle executor")
OPENCLAW_CONFIG_PATH = os.path.abspath(
    os.getenv(
        "OPENCLAW_CONFIG_PATH",
        "/opt/cortex/current/ops/config/oracle-openclaw.json",
    )
)
OPENCLAW_CONFIG_POLICY = "dedicated_immutable_oracle_only"
OPENCLAW_CONFIG_SHA256 = "b4722df66a893a41d1caeffe16a3cbac8b0d5db15b2da701718b89114abbdae4"
SESSION_ID = os.getenv("ORACLE_EXECUTOR_SESSION_ID", "oracle-gateway")
SESSION_MODE = os.getenv("ORACLE_EXECUTOR_SESSION_MODE", "ephemeral").strip().lower() or "ephemeral"
SESSION_BUCKET_MINUTES = max(1, int(os.getenv("ORACLE_EXECUTOR_SESSION_BUCKET_MINUTES", "60")))
SESSION_DIR = os.getenv(
    "ORACLE_EXECUTOR_SESSION_DIR",
    "/var/lib/cortex-oracle/openclaw-state/agents/oracle/sessions",
)
SESSION_RETENTION_COUNT = max(20, int(os.getenv("ORACLE_EXECUTOR_SESSION_RETENTION_COUNT", "300")))
SESSION_RETENTION_DAYS = max(1, int(os.getenv("ORACLE_EXECUTOR_SESSION_RETENTION_DAYS", "7")))
SESSION_CLEANUP_INTERVAL_SECONDS = max(60, int(os.getenv("ORACLE_EXECUTOR_SESSION_CLEANUP_INTERVAL_SECONDS", "1800")))
LAST_CLEANUP_AT = 0.0
_RUNTIME_PREFLIGHT = None
_RUNTIME_PREFLIGHT_AT = 0.0
_RUNTIME_PREFLIGHT_TTL_SECONDS = 60
_RUNTIME_PREFLIGHT_LOCK = threading.Lock()

class InvokeRequest(BaseModel):
    prompt: str
    system: str | None = None
    origin_channel: str | None = None
    scope_hash: str | None = None


def _require_authorized(request: Request) -> None:
    if not EXECUTOR_TOKEN:
        raise HTTPException(status_code=503, detail="oracle executor authentication is not configured")
    supplied = request.headers.get("x-bridge-token", "")
    if not supplied or not hmac.compare_digest(supplied, EXECUTOR_TOKEN):
        raise HTTPException(status_code=401, detail="oracle executor authentication failed")


def _model_matches_policy(model: str) -> bool:
    observed = str(model or "").strip().casefold()
    expected = EXPECTED_MODEL.casefold()
    return bool(observed and observed in {expected, expected.rsplit("/", 1)[-1]})


def _process_failure_detail(label: str, result) -> str:
    """Return useful diagnostics without reflecting provider or prompt content."""
    output = "\n".join(str(part) for part in (getattr(result, "stdout", ""), getattr(result, "stderr", "")) if part)
    encoded = output.encode("utf-8", errors="replace")
    return (
        f"{label}; returncode={getattr(result, 'returncode', 'unknown')}; "
        f"output_bytes={len(encoded)}; output_sha256={hashlib.sha256(encoded).hexdigest()}"
    )


def _require_exact_keys(value, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        raise RuntimeError(f"Oracle OpenClaw config has invalid {label} keys")


def _reject_secret_fields(value) -> None:
    if isinstance(value, dict):
        forbidden = {
            "apikey", "credential", "credentials", "password", "secret",
            "token", "writetoken", "scopehmacsecret", "sessionidentityhmacsecret",
        }
        for key, child in value.items():
            if str(key).replace("_", "").casefold() in forbidden:
                raise RuntimeError("Oracle OpenClaw config must not contain credentials")
            _reject_secret_fields(child)
    elif isinstance(value, list):
        for child in value:
            _reject_secret_fields(child)


def validate_oracle_openclaw_config(
    path: str | Path = OPENCLAW_CONFIG_PATH,
    *,
    expected_uid: int = 0,
    expected_gid: int = 0,
) -> dict:
    """Validate the immutable, least-privilege config used inside the helper."""
    config_path = Path(path)
    if config_path.is_symlink() or not config_path.is_file():
        raise RuntimeError("Oracle OpenClaw config is not a regular non-symlink file")
    info = config_path.stat()
    if (
        (info.st_mode & 0o777) != 0o644
        or info.st_uid != expected_uid
        or info.st_gid != expected_gid
    ):
        raise RuntimeError("Oracle OpenClaw config must have the approved owner and mode 0644")
    raw = config_path.read_bytes()
    observed_sha256 = hashlib.sha256(raw).hexdigest()
    if observed_sha256 != OPENCLAW_CONFIG_SHA256:
        raise RuntimeError("Oracle OpenClaw config does not match the approved immutable policy")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Oracle OpenClaw config is not valid JSON") from exc

    _require_exact_keys(payload, {"agents", "auth", "meta", "models", "plugins", "tools"}, "top-level")
    if payload["auth"] != {"order": {}, "profiles": {}}:
        raise RuntimeError("Oracle OpenClaw config must not embed auth profiles")

    agents = payload["agents"]
    _require_exact_keys(agents, {"defaults", "list"}, "agents")
    defaults = agents["defaults"]
    _require_exact_keys(
        defaults,
        {"maxConcurrent", "model", "models", "thinkingDefault", "workspace"},
        "agent defaults",
    )
    if (
        defaults.get("maxConcurrent") != 1
        or defaults.get("model") != {"primary": "openai/gpt-5.6-sol"}
        or defaults.get("models")
        != {"openai/gpt-5.6-sol": {"agentRuntime": {"id": "openclaw"}}}
        or defaults.get("thinkingDefault") != "xhigh"
        or defaults.get("workspace") != WORKDIR
    ):
        raise RuntimeError("Oracle OpenClaw config violates the fixed agent policy")
    expected_agent = {
        "default": True,
        "fastModeDefault": False,
        "id": "oracle",
        "name": "Oracle Bridge",
        "thinkingDefault": "xhigh",
        "workspace": WORKDIR,
    }
    if agents.get("list") != [expected_agent]:
        raise RuntimeError("Oracle OpenClaw config must define only the Oracle agent")

    models = payload["models"]
    _require_exact_keys(models, {"providers"}, "models")
    providers = models["providers"]
    _require_exact_keys(providers, {"openai"}, "model providers")
    openai = providers["openai"]
    _require_exact_keys(openai, {"api", "baseUrl", "models", "timeoutSeconds"}, "OpenAI provider")
    if (
        openai.get("api") != "openai-chatgpt-responses"
        or openai.get("baseUrl") != "https://chatgpt.com/backend-api/codex"
        or openai.get("timeoutSeconds") != 300
        or not isinstance(openai.get("models"), list)
        or not openai["models"]
    ):
        raise RuntimeError("Oracle OpenClaw config violates the approved provider policy")

    if payload["plugins"] != {
        "allow": ["openai"],
        "bundledDiscovery": "compat",
        "entries": {"openai": {"config": {"personality": "friendly"}, "enabled": True}},
    }:
        raise RuntimeError("Oracle OpenClaw config must enable only the bundled OpenAI plugin")
    if payload["tools"] != {
        "deny": ["web_search", "web_fetch", "browser"],
        "profile": "coding",
    }:
        raise RuntimeError("Oracle OpenClaw config violates the fixed tool policy")
    if payload["meta"] != {
        "lastTouchedAt": "2026-10-08T03:08:55.521Z",
        "lastTouchedVersion": "2026.7.1-2",
    }:
        raise RuntimeError("Oracle OpenClaw config version metadata is not pinned")

    _reject_secret_fields(payload)
    encoded = raw.decode("utf-8")
    for forbidden in (
        "/root/.openclaw",
        "/opt/openclaw-preastra-restore",
        "whatsapp",
        "cortex-memory-bridge",
        "cortex-route-gate",
    ):
        if forbidden in encoded:
            raise RuntimeError("Oracle OpenClaw config crosses the helper isolation boundary")
    return {
        "policy": OPENCLAW_CONFIG_POLICY,
        "sha256": observed_sha256,
        "path": str(config_path),
    }


def _validate_openclaw_runtime() -> dict:
    config = validate_oracle_openclaw_config()
    try:
        result = subprocess.run(
            [OPENCLAW, "models", "status", "--agent", AGENT_ID, "--json"],
            cwd=WORKDIR,
            env={
                **os.environ,
                "OPENCLAW_CONFIG_PATH": OPENCLAW_CONFIG_PATH,
                "OPENCLAW_STATE_DIR": OPENCLAW_STATE_DIR,
            },
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Oracle OpenClaw runtime preflight timed out") from exc
    if result.returncode != 0:
        raise RuntimeError(_process_failure_detail("Oracle OpenClaw runtime preflight failed", result))
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        digest = hashlib.sha256((result.stdout or "").encode()).hexdigest()
        raise RuntimeError(f"Oracle OpenClaw runtime preflight was not JSON; output_sha256={digest}") from exc
    auth = payload.get("auth") if isinstance(payload, dict) else None
    providers = auth.get("providers") if isinstance(auth, dict) else None
    openai = next(
        (row for row in providers or [] if isinstance(row, dict) and row.get("provider") == "openai"),
        None,
    )
    effective = openai.get("effective") if isinstance(openai, dict) else None
    profiles = openai.get("profiles") if isinstance(openai, dict) else None
    oauth = auth.get("oauth") if isinstance(auth, dict) else None
    oauth_providers = oauth.get("providers") if isinstance(oauth, dict) else None
    oauth_openai = next(
        (row for row in oauth_providers or [] if isinstance(row, dict) and row.get("provider") == "openai"),
        None,
    )
    expected_store = os.path.join(OPENCLAW_STATE_DIR, "agents/main/agent/openclaw-agent.sqlite")
    if (
        payload.get("agentId") != AGENT_ID
        or not isinstance(effective, dict)
        or effective.get("kind") != "profiles"
        or effective.get("detail") != expected_store
        or not isinstance(profiles, dict)
        or int(profiles.get("oauth") or 0) < 1
        or not isinstance(oauth_openai, dict)
        or oauth_openai.get("status") != "ok"
    ):
        raise RuntimeError("Oracle OpenClaw runtime preflight could not resolve mounted OAuth")
    return {
        "outcome": "green",
        "configPolicy": config["policy"],
        "configSha256": config["sha256"],
        "authType": "oauth",
        "profileCount": int(profiles.get("oauth") or 0),
    }


def _ensure_openclaw_runtime() -> dict:
    global _RUNTIME_PREFLIGHT, _RUNTIME_PREFLIGHT_AT
    observed_at = time.monotonic()
    if (
        _RUNTIME_PREFLIGHT is not None
        and observed_at - _RUNTIME_PREFLIGHT_AT < _RUNTIME_PREFLIGHT_TTL_SECONDS
    ):
        return dict(_RUNTIME_PREFLIGHT)
    with _RUNTIME_PREFLIGHT_LOCK:
        observed_at = time.monotonic()
        if (
            _RUNTIME_PREFLIGHT is None
            or observed_at - _RUNTIME_PREFLIGHT_AT >= _RUNTIME_PREFLIGHT_TTL_SECONDS
        ):
            _RUNTIME_PREFLIGHT = _validate_openclaw_runtime()
            _RUNTIME_PREFLIGHT_AT = observed_at
        return dict(_RUNTIME_PREFLIGHT)


def _completion_receipt(response: str, provider: str, model: str, session_id: str, payload_count: int) -> dict:
    completed_at = datetime.now(timezone.utc).isoformat()
    response_sha256 = hashlib.sha256(response.encode("utf-8")).hexdigest()
    source = f"{provider}:{model}"
    seed = "\0".join(("cortex.oracle.completion.v1", "provider_response", source, completed_at, response_sha256))
    return {
        "version": "cortex.oracle.completion.v1",
        "receipt_id": f"oracle_{hashlib.sha256(seed.encode('utf-8')).hexdigest()[:24]}",
        "kind": "provider_response",
        "source": source,
        "completed_at": completed_at,
        "response_sha256": response_sha256,
        "evidence": {
            "provider": provider,
            "model": model,
            "identity_source": "openclaw_agent_meta",
            "command_agent": AGENT_ID,
            "returncode": 0,
            "session_id_sha256": hashlib.sha256(session_id.encode("utf-8")).hexdigest(),
            "payload_count": payload_count,
            "execution_boundary": "cortex_oracle_executor",
            "auth_policy": AUTH_POLICY,
            "service_tier_policy": SERVICE_TIER_POLICY,
        },
    }


def _sign_response(payload: dict) -> str:
    if not EXECUTOR_TOKEN:
        return ""
    signed = json.dumps(
        {key: value for key, value in payload.items() if key != "helper_signature"},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hmac.new(EXECUTOR_TOKEN.encode("utf-8"), signed.encode("utf-8"), hashlib.sha256).hexdigest()

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
        if not name.startswith(prefix) or not name.endswith(('.jsonl', '.json', '.lock', '.tmp')):
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

def _maybe_cleanup_local_sessions():
    global LAST_CLEANUP_AT
    now = time.time()
    if now - LAST_CLEANUP_AT < SESSION_CLEANUP_INTERVAL_SECONDS:
        return []
    removed = _prune_local_sessions(now=now)
    LAST_CLEANUP_AT = now
    return removed

def health():
    return {
        "ok": True,
        "service": "oracle-executor",
        "mode": "gateway-agent",
        "agentId": AGENT_ID,
        "modelPolicy": EXPECTED_MODEL,
        "thinking": THINKING,
        "authPolicy": AUTH_POLICY,
        "serviceTierPolicy": SERVICE_TIER_POLICY,
        "requestAuthentication": "required",
        "localExecution": LOCAL_EXECUTION,
        "resetAgentSession": RESET_AGENT_SESSION,
        "resetAgentSessionKey": RESET_AGENT_SESSION_KEY,
        "openclawStatePolicy": "service_owned_with_mounted_main_oauth",
        "openclawConfigPolicy": OPENCLAW_CONFIG_POLICY,
        "openclawConfigPath": OPENCLAW_CONFIG_PATH,
        "sessionBase": SESSION_ID,
        "sessionMode": SESSION_MODE,
        "sessionBucketMinutes": SESSION_BUCKET_MINUTES,
        "sessionRetentionCount": SESSION_RETENTION_COUNT,
        "sessionRetentionDays": SESSION_RETENTION_DAYS,
        "sessionCleanupIntervalSeconds": SESSION_CLEANUP_INTERVAL_SECONDS,
    }


@app.get('/health')
def health_endpoint(request: Request):
    _require_authorized(request)
    try:
        runtime = _ensure_openclaw_runtime()
    except Exception as exc:
        if isinstance(exc, RuntimeError):
            detail = str(exc)
        else:
            detail = (
                "Oracle OpenClaw runtime preflight failed; "
                f"error_type={type(exc).__name__}; "
                f"detail_sha256={hashlib.sha256(str(exc).encode()).hexdigest()}"
            )
        LOGGER.error("oracle_runtime_preflight_failed %s", detail)
        raise HTTPException(status_code=503, detail=detail)
    return {
        **health(),
        "openclawRuntimePreflight": runtime["outcome"],
        "openclawConfigSha256": runtime["configSha256"],
        "openclawAuthType": runtime["authType"],
        "openclawOAuthProfileCount": runtime["profileCount"],
    }


def invoke(req: InvokeRequest):
    prompt = (req.prompt or '').strip()
    if not prompt:
        raise HTTPException(status_code=400, detail='prompt required')
    session_id = _session_for_prompt(prompt)
    system_text = (req.system or '').strip()
    bridged_prompt = (
        "You are the host-side Oracle executor for Cortex. "
        "Return only the answer text that Oracle should say. "
        "Do not add labels, confidence scores, priorities, disclaimers, or meta-commentary. "
        "Be concise but not shallow: answer the request directly with concrete substance. "
        "If the request is a greeting, reply with exactly one warm sentence offering help. "
        "If the request asks for a definition or explanation, answer in one or two crisp sentences. "
        "If the request asks for analysis, give the strongest direct answer you can in plain English. "
        "Avoid generic assistant filler like 'How can I assist you today?' or 'Live conditions can still shift'.\n\n"
        "CORTEX_ORACLE_REQUEST_V1\n"
        "Apply the system field as authoritative system instructions and the user field as the user request.\n"
        + json.dumps({"system": system_text, "user": prompt}, ensure_ascii=False, separators=(",", ":"))
    )
    if req.scope_hash and not re.fullmatch(r"[a-f0-9]{64}", req.scope_hash):
        raise HTTPException(status_code=400, detail='invalid principal scope digest')
    if RESET_AGENT_SESSION:
        reset_cmd = [
            OPENCLAW, 'gateway', 'call', 'sessions.reset',
            '--params', json.dumps({'key': RESET_AGENT_SESSION_KEY}),
            '--json',
        ]
        reset = subprocess.run(reset_cmd, cwd=WORKDIR, capture_output=True, text=True, timeout=30)
        if reset.returncode != 0:
            detail = _process_failure_detail('failed to reset oracle session', reset)
            LOGGER.error("oracle_reset_failed %s", detail)
            raise HTTPException(status_code=503, detail=detail)
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
    if req.origin_channel:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", req.origin_channel):
            raise HTTPException(status_code=400, detail='invalid origin channel')
        cmd.extend(['--channel', req.origin_channel])
    try:
        r = subprocess.run(cmd, cwd=WORKDIR, capture_output=True, text=True, timeout=TIMEOUT + 20)
    except subprocess.TimeoutExpired:
        LOGGER.error("oracle_invoke_timeout timeout_seconds=%d", TIMEOUT + 20)
        raise HTTPException(status_code=504, detail='oracle executor timeout')
    if r.returncode != 0:
        detail = _process_failure_detail('oracle executor failed', r)
        LOGGER.error("oracle_invoke_failed %s", detail)
        raise HTTPException(status_code=503, detail=detail)
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
        model = str(agent_meta.get('model') or '').strip()
        provider = str(agent_meta.get('provider') or '').strip()
        executed_agent = str(agent_meta.get('agentId') or agent_meta.get('agent') or '').strip()
        if not model or not provider:
            raise ValueError('missing provider model identity')
        if executed_agent and not hmac.compare_digest(executed_agent.casefold(), AGENT_ID.casefold()):
            raise ValueError('oracle agent identity mismatch')
        if not _model_matches_policy(model):
            raise ValueError('provider model violates approved policy')
        cleaned = _maybe_cleanup_local_sessions()
        payload = {
            'ok': True,
            'response': text,
            'model': model,
            'provider': provider,
            'sessionId': agent_meta.get('sessionId') or session_id,
            'cleanupRemoved': len(cleaned),
            'done': True,
            'origin': 'cortex_oracle_executor',
            'provider_invoked': True,
            'completion_receipt': _completion_receipt(text, provider, model, session_id, len(payloads)),
        }
        payload['helper_signature'] = _sign_response(payload)
        return payload
    except Exception as e:
        raise HTTPException(status_code=503, detail=f'invalid executor payload: {e}')


@app.post('/invoke')
def invoke_endpoint(req: InvokeRequest, request: Request):
    _require_authorized(request)
    return invoke(req)
