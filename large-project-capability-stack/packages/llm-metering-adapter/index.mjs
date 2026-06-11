import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API_TOKEN_MODE = 'api_token_metered';
const OAUTH_MESSAGE_MODE = 'oauth_message_metered';
const HYBRID_MODE = 'hybrid_unknown';

export const LLM_METERING_MODES = Object.freeze({
  API_TOKEN_MODE,
  OAUTH_MESSAGE_MODE,
  HYBRID_MODE
});

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function parseBool(value, fallback = false) {
  if (!hasValue(value)) return fallback;
  return /^(1|true|yes|on|required|oauth)$/i.test(String(value).trim());
}

function positiveInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function clampInt(value, min, max) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? Math.floor(parsed) : min;
  return Math.max(min, Math.min(max, safe));
}

function safeJsonParse(value, fallback = null) {
  if (!hasValue(value)) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

export function normalizeLlmMeteringMode(value = '') {
  const mode = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!mode || ['auto', 'detect', 'detected', 'default'].includes(mode)) return 'auto';
  if (['api', 'token', 'tokens', 'api_token', 'api_tokens', 'token_metered', 'api_token_metered', 'api_tokens_metered'].includes(mode)) return API_TOKEN_MODE;
  if (['oauth', 'chatgpt', 'message', 'messages', 'message_metered', 'oauth_message', 'oauth_messages', 'oauth_message_metered', 'chatgpt_message_metered'].includes(mode)) return OAUTH_MESSAGE_MODE;
  if (['hybrid', 'unknown', 'hybrid_unknown'].includes(mode)) return HYBRID_MODE;
  return HYBRID_MODE;
}

export function normalizeTokenBudgetMode(value = '', { meteringMode = HYBRID_MODE } = {}) {
  const mode = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['hard', 'hard_stop', 'token_hard_stop', 'enforce', 'enforced'].includes(mode)) return 'hard';
  if (['safety', 'soft', 'advisory', 'estimate', 'context_safety'].includes(mode)) return 'safety';
  return meteringMode === OAUTH_MESSAGE_MODE ? 'safety' : 'hard';
}

function defaultCodexAuthFileCandidates(env = process.env) {
  const candidates = [];
  if (hasValue(env.CODEX_AUTH_FILE)) candidates.push(path.resolve(String(env.CODEX_AUTH_FILE)));
  if (hasValue(env.CODEX_HOME)) candidates.push(path.join(path.resolve(String(env.CODEX_HOME)), 'auth.json'));
  if (hasValue(env.XDG_CONFIG_HOME)) candidates.push(path.join(path.resolve(String(env.XDG_CONFIG_HOME)), 'codex', 'auth.json'));
  const home = env.HOME || os.homedir?.();
  if (hasValue(home)) candidates.push(path.join(path.resolve(String(home)), '.codex', 'auth.json'));
  return [...new Set(candidates)];
}

function codexAuthFileExists(env = process.env) {
  return defaultCodexAuthFileCandidates(env).some((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

export function detectLlmMeteringMode({ env = process.env, hasCodexAuthFile = null } = {}) {
  const explicit = normalizeLlmMeteringMode(
    env.CREATIVE_WORKER_METERING_MODE
      || env.CONTINUOUS_CONTROLLER_METERING_MODE
      || env.LLM_METERING_MODE
      || env.CODEX_METERING_MODE
      || ''
  );
  if (explicit !== 'auto') {
    return {
      mode: explicit,
      confidence: 'explicit',
      evidence: { explicitMode: explicit }
    };
  }

  const apiKeyPresent = [
    env.OPENAI_API_KEY,
    env.CODEX_API_KEY,
    env.OPENAI_API_TOKEN,
    env.OPENAI_PROJECT_API_KEY
  ].some(hasValue);
  const oauthHint = parseBool(env.CODEX_USE_OAUTH)
    || parseBool(env.CODEX_OAUTH)
    || /oauth|chatgpt|browser|account/i.test(String(env.CODEX_AUTH_MODE || env.CODEX_LOGIN_METHOD || env.CODEX_ACCOUNT_MODE || ''));
  const authFilePresent = hasCodexAuthFile == null ? codexAuthFileExists(env) : Boolean(hasCodexAuthFile);

  if (apiKeyPresent && !oauthHint) {
    return { mode: API_TOKEN_MODE, confidence: 'env_api_key', evidence: { apiKeyPresent: true, oauthHint: false, authFilePresent } };
  }
  if (oauthHint) {
    return { mode: OAUTH_MESSAGE_MODE, confidence: 'env_oauth_hint', evidence: { apiKeyPresent, oauthHint: true, authFilePresent } };
  }
  if (!apiKeyPresent && authFilePresent) {
    return { mode: OAUTH_MESSAGE_MODE, confidence: 'codex_auth_file_without_api_key', evidence: { apiKeyPresent: false, oauthHint: false, authFilePresent } };
  }
  return { mode: HYBRID_MODE, confidence: 'unknown', evidence: { apiKeyPresent, oauthHint: false, authFilePresent } };
}

export function readCreativeWorkerMeteringPlanFromEnv(env = process.env) {
  const fromEnv = safeJsonParse(env.CREATIVE_WORKER_METERING_PLAN || env.CONTINUOUS_CONTROLLER_METERING_PLAN, null);
  if (fromEnv && typeof fromEnv === 'object') return fromEnv;
  const detected = detectLlmMeteringMode({ env });
  return {
    schemaVersion: 'claw.llm_metering_adapter.v1',
    mode: detected.mode,
    confidence: detected.confidence,
    budgetAxis: detected.mode === OAUTH_MESSAGE_MODE ? 'messages' : detected.mode === API_TOKEN_MODE ? 'tokens' : 'hybrid',
    tokenBudgetMode: normalizeTokenBudgetMode(env.CREATIVE_WORKER_TOKEN_BUDGET_MODE, { meteringMode: detected.mode }),
    source: 'worker_env_fallback',
    evidence: detected.evidence
  };
}

export function resolveLlmMeteringAdapter({
  env = process.env,
  requestedAgentCount = 0,
  selectedLogicalSurfaceCount = 0,
  requestedBundleSize = 1,
  waveMaxAttemptsPerTask = 1,
  promptMode = 'compact',
  compactBriefMaxChars = 9000,
  controllerGlobalTokenLimit = 0,
  inheritedWaveTokenLimit = 0,
  tokenReservationEstimate = 0,
  maxActiveCodexCalls = 0,
  hasCodexAuthFile = null
} = {}) {
  const detected = detectLlmMeteringMode({ env, hasCodexAuthFile });
  const mode = detected.mode;
  const logicalCount = Math.max(0, Number(selectedLogicalSurfaceCount || requestedAgentCount || 0));
  const requestedBundle = Math.max(1, Number(requestedBundleSize || 1));
  const attempts = Math.max(1, Number(waveMaxAttemptsPerTask || 1));
  const inheritedActiveCap = positiveInt(maxActiveCodexCalls, positiveInt(env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS, 8));
  const envTokenReservation = positiveInt(tokenReservationEstimate, positiveInt(env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE, 0));
  const envCompactBrief = positiveInt(compactBriefMaxChars, positiveInt(env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS, 9000));
  const modeBudgetAxis = mode === OAUTH_MESSAGE_MODE ? 'messages' : mode === API_TOKEN_MODE ? 'tokens' : 'hybrid';

  let effectiveBundleSize = requestedBundle;
  let perWorkerCallLimit = positiveInt(env.CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT, attempts);
  let targetMessagesPerWave = null;
  let tokenBudgetMode = normalizeTokenBudgetMode(env.CREATIVE_WORKER_TOKEN_BUDGET_MODE, { meteringMode: mode });
  let effectiveCompactBriefMaxChars = envCompactBrief;
  let contextTotalMaxChars = positiveInt(env.CREATIVE_WORKER_CONTEXT_TOTAL_MAX_CHARS, 0) || null;
  let contextFileMaxChars = positiveInt(env.CREATIVE_WORKER_CONTEXT_FILE_MAX_CHARS, 0) || null;
  let adaptiveTokenBudgetEnabled = mode !== OAUTH_MESSAGE_MODE;

  if (mode === OAUTH_MESSAGE_MODE) {
    targetMessagesPerWave = clampInt(env.CONTINUOUS_CONTROLLER_OAUTH_TARGET_MESSAGES_PER_WAVE || env.LLM_METERING_OAUTH_TARGET_MESSAGES_PER_WAVE || 12, 1, 1000);
    const defaultOauthBundle = logicalCount > 0 ? Math.max(2, Math.ceil(logicalCount / targetMessagesPerWave)) : 2;
    const maxOauthBundle = clampInt(env.CONTINUOUS_CONTROLLER_OAUTH_MAX_BUNDLE_SIZE || env.LLM_METERING_OAUTH_MAX_BUNDLE_SIZE || 8, 1, 50);
    const forcedOauthBundle = positiveInt(env.CONTINUOUS_CONTROLLER_OAUTH_BUNDLE_SIZE || env.LLM_METERING_OAUTH_BUNDLE_SIZE, 0);
    effectiveBundleSize = forcedOauthBundle || Math.min(maxOauthBundle, Math.max(requestedBundle, defaultOauthBundle));
    perWorkerCallLimit = positiveInt(env.CREATIVE_WORKER_OAUTH_PER_WORKER_CALL_LIMIT || env.LLM_METERING_OAUTH_PER_WORKER_CALL_LIMIT, 1);
    tokenBudgetMode = 'safety';
    effectiveCompactBriefMaxChars = Math.max(envCompactBrief, positiveInt(env.CONTINUOUS_CONTROLLER_OAUTH_COMPACT_BRIEF_MAX_CHARS || env.LLM_METERING_OAUTH_COMPACT_BRIEF_MAX_CHARS, 36_000));
    contextTotalMaxChars = Math.max(contextTotalMaxChars || 0, positiveInt(env.CREATIVE_WORKER_OAUTH_CONTEXT_TOTAL_MAX_CHARS || env.LLM_METERING_OAUTH_CONTEXT_TOTAL_MAX_CHARS, 48_000));
    contextFileMaxChars = Math.max(contextFileMaxChars || 0, positiveInt(env.CREATIVE_WORKER_OAUTH_CONTEXT_FILE_MAX_CHARS || env.LLM_METERING_OAUTH_CONTEXT_FILE_MAX_CHARS, 10_000));
    adaptiveTokenBudgetEnabled = false;
  }

  const estimatedPhysicalCallCount = logicalCount > 0 ? Math.ceil(logicalCount / Math.max(1, effectiveBundleSize)) : 0;
  const plannedMessages = Math.max(1, estimatedPhysicalCallCount) * Math.max(1, perWorkerCallLimit);
  const slack = mode === OAUTH_MESSAGE_MODE ? Math.max(1, Math.ceil(plannedMessages * 0.15)) : 0;
  const globalCallLimit = mode === OAUTH_MESSAGE_MODE
    ? positiveInt(env.CREATIVE_WORKER_OAUTH_GLOBAL_CODEX_CALL_LIMIT || env.LLM_METERING_OAUTH_GLOBAL_CODEX_CALL_LIMIT, plannedMessages + slack)
    : Math.max(plannedMessages, logicalCount * attempts, positiveInt(env.CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT, 0));
  const defaultActiveCap = mode === OAUTH_MESSAGE_MODE
    ? Math.max(1, Math.min(estimatedPhysicalCallCount || 1, targetMessagesPerWave || estimatedPhysicalCallCount || 1, inheritedActiveCap || 12))
    : Math.max(1, Math.min(inheritedActiveCap || 8, estimatedPhysicalCallCount || logicalCount || 1));
  const activeCodexCallCap = positiveInt(mode === OAUTH_MESSAGE_MODE ? env.CREATIVE_WORKER_OAUTH_MAX_ACTIVE_CODEX_CALLS : '', 0) || defaultActiveCap;
  const reservationEstimate = mode === OAUTH_MESSAGE_MODE
    ? Math.max(1, envTokenReservation || 120_000)
    : Math.max(1, envTokenReservation || 80_000);

  return {
    schemaVersion: 'claw.llm_metering_adapter.v1',
    generatedAt: new Date().toISOString(),
    mode,
    budgetAxis: modeBudgetAxis,
    confidence: detected.confidence,
    evidence: detected.evidence,
    promptMode: String(promptMode || 'compact'),
    requestedAgentCount: Number(requestedAgentCount || 0),
    selectedLogicalSurfaceCount: logicalCount,
    requestedBundleSize: requestedBundle,
    effectiveBundleSize,
    estimatedPhysicalCallCount,
    targetMessagesPerWave,
    waveMaxAttemptsPerTask: attempts,
    perWorkerCallLimit,
    globalCallLimit,
    activeCodexCallCap,
    tokenBudgetMode,
    hardTokenBudget: tokenBudgetMode === 'hard',
    adaptiveTokenBudgetEnabled,
    controllerGlobalTokenLimit: Number(controllerGlobalTokenLimit || 0) || null,
    inheritedWaveTokenLimit: Number(inheritedWaveTokenLimit || 0) || null,
    tokenReservationEstimate: reservationEstimate,
    compactBriefMaxChars: effectiveCompactBriefMaxChars,
    contextTotalMaxChars,
    contextFileMaxChars,
    intent: mode === OAUTH_MESSAGE_MODE
      ? 'Optimize scarce OAuth/ChatGPT Codex messages by bundling multiple logical surfaces into fewer physical Codex calls while keeping per-surface supervisor evidence.'
      : mode === API_TOKEN_MODE
        ? 'Optimize API/token-metered Codex work by enforcing hard token reservations and smaller focused prompts.'
        : 'Use conservative hybrid metering until the auth/metering source is explicit.'
  };
}

export function envFromLlmMeteringPlan(plan = {}, { physicalWorkerCount = null } = {}) {
  const physical = Math.max(1, Number(physicalWorkerCount || plan.estimatedPhysicalCallCount || 1));
  const perWorker = Math.max(1, Number(plan.perWorkerCallLimit || 1));
  const plannedCalls = physical * perWorker;
  const globalLimit = Math.max(plannedCalls, Number(plan.globalCallLimit || 0) || plannedCalls);
  const env = {
    CREATIVE_WORKER_METERING_MODE: plan.mode || HYBRID_MODE,
    CREATIVE_WORKER_TOKEN_BUDGET_MODE: plan.tokenBudgetMode || normalizeTokenBudgetMode('', { meteringMode: plan.mode || HYBRID_MODE }),
    ORCHESTRATOR_MAX_ATTEMPTS_PER_TASK: String(perWorker),
    CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: String(globalLimit),
    CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: String(perWorker),
    CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: String(Math.max(1, Math.min(Number(plan.activeCodexCallCap || physical), physical))),
    CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: String(Math.max(1, Number(plan.tokenReservationEstimate || 1))),
    CREATIVE_WORKER_METERING_PLAN: JSON.stringify({ ...plan, actualPhysicalWorkerCount: physical, actualGlobalCallLimit: globalLimit })
  };
  if (plan.compactBriefMaxChars) env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS = String(plan.compactBriefMaxChars);
  if (plan.contextTotalMaxChars) env.CREATIVE_WORKER_CONTEXT_TOTAL_MAX_CHARS = String(plan.contextTotalMaxChars);
  if (plan.contextFileMaxChars) env.CREATIVE_WORKER_CONTEXT_FILE_MAX_CHARS = String(plan.contextFileMaxChars);
  if (plan.mode === OAUTH_MESSAGE_MODE) {
    env.CREATIVE_WORKER_COMPACT_FAIL_CLOSED = '0';
    env.CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY = '1';
  }
  return env;
}
