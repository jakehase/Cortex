import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { enforceArchitecture } from '../../large-project-capability-stack/packages/architecture-enforcer/index.mjs';

async function loadDeliverOutboundPayloads() {
  const mod = await import('/usr/lib/node_modules/openclaw/dist/plugin-sdk/deliver-runtime-20_kW0lQ.js');
  return mod.deliverOutboundPayloads;
}

async function defaultDeliver(payload) {
  const deliverOutboundPayloads = await loadDeliverOutboundPayloads();
  return deliverOutboundPayloads(payload);
}

const USER_VISIBLE_STATES = ['pending', 'running', 'internal_complete', 'notification_sent', 'delivery_confirmed', 'closed', 'failed'];
const DEFAULTS = {
  stateDir: '/root/clawd/state/completion-integrity',
  escalationAfterMs: 90_000,
  autoDeliveryAfterMs: 15_000,
  retryBackoffMs: 10_000,
  pollIntervalMs: 10_000,
  importantKeywords: ['fix', 'implement', 'deploy', 'restart', 'verify', 'debug', 'diagnose', 'migrate', 'patch', 'recover', 'continue', 'roadmap', 'clone'],
  lightweightKeywords: ['what happened', 'what changed', 'summarize', 'explain'],
  hardValidationModes: ['strict', 'important_only'],
};

const FIDELITY_LATTICE = ['prototype', 'production_slice', 'parity_for_scope', 'full_clone'];

function nowIso() { return new Date().toISOString(); }
function parseMs(v) { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; }
function safeJsonParse(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }
function loadJson(file, fallback) { try { return safeJsonParse(fs.readFileSync(file, 'utf8'), fallback); } catch { return fallback; } }
function saveJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function normalize(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function normalizeSoft(text) { return normalize(text).toLowerCase(); }
function summarize(text, max = 240) { return normalize(text).slice(0, max); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }
function cleanPathCandidate(value) {
  return String(value || '').replace(/^['"`]+|['"`]+$/g, '').replace(/[),.;]+$/g, '').trim();
}
function extractStructuredField(text, label) {
  const pattern = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\b(?:Reply anchor|Anchor|Target path|Implementation surface|Diff scope|Fidelity|Scope|Stop condition|Surface matrix|Campaign mode|Supervisor status|Parity status|Honesty manifest|Honesty gate|Evidence|What remains|Blocker|Next action):|$)`, 'i');
  const match = String(text || '').match(pattern);
  return cleanPathCandidate(match?.[1] || '');
}
function parseJsonCodeBlock(text, labelPattern) {
  const fencePattern = '```json\\s*([\\s\\S]*?)```';
  const match = String(text || '').match(new RegExp(`${labelPattern}:\\s*${fencePattern}`, 'i'));
  if (match?.[1]) return safeJsonParse(match[1], null);
  const fallback = String(text || '').match(new RegExp(`${labelPattern}:\\s*([\\s\\S]+)$`, 'i'));
  return fallback?.[1] ? safeJsonParse(fallback[1], null) : null;
}
function extractReplyThreadContext(prompt) {
  const conversationInfo = parseJsonCodeBlock(prompt, 'Conversation info \\(untrusted metadata\\)') || {};
  const repliedMessage = parseJsonCodeBlock(prompt, 'Replied message \\(untrusted, for context\\)') || {};
  const summary = summarize(repliedMessage?.body || '', 220);
  return {
    present: Boolean(conversationInfo?.has_reply_context || conversationInfo?.reply_to_id || repliedMessage?.body),
    replyToId: normalize(conversationInfo?.reply_to_id || ''),
    senderLabel: normalize(repliedMessage?.sender_label || ''),
    summary,
  };
}
function stripInternalEnvelope(text) {
  return String(text || '')
    .replace(/Conversation info \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, ' ')
    .replace(/Sender \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, ' ')
    .replace(/Replied message \(untrusted, for context\):[\s\S]*?```[\s\S]*?```/gi, ' ')
    .replace(/Cortex upstream routing applied:[^\n]*/gi, ' ')
    .replace(/\bCORTEX_[A-Z0-9_]+\b[\s\S]*$/g, ' ')
    .trim();
}
function sanitizePrompt(text) {
  return normalize(stripInternalEnvelope(text));
}
function extractText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content === 'string') return value.content;
    if (Array.isArray(value.content)) return extractText(value.content);
    if (Array.isArray(value.messages)) return extractText(value.messages);
  }
  return '';
}
function looksCron(prompt) { return normalizeSoft(sanitizePrompt(prompt)).startsWith('[cron:'); }
function looksCompletionEvent(prompt) {
  const p = normalizeSoft(sanitizePrompt(prompt));
  return p.includes('internal task completion event') || p.includes('source: subagent') || p.includes('completed successfully');
}
function inferTrustTier(prompt, cfg) {
  const p = normalizeSoft(sanitizePrompt(prompt));
  if (looksCron(prompt)) return 'background';
  if (cfg.importantKeywords.some((w) => p.includes(w))) return 'important';
  if (cfg.lightweightKeywords.some((w) => p.includes(w))) return 'normal';
  return 'normal';
}
function isConversationalQuestion(prompt) {
  const p = normalizeSoft(sanitizePrompt(prompt));
  if (!p) return true;
  if (/^(why|what|how|when|where|who|did|does|is|are|can|could|would|should)\b/.test(p)) return true;
  if (/^do\b/.test(p) && p.includes('?')) return true;
  if (p.includes('?')) return true;
  return /(what happened|summarize|explain|why were you|diagnose why)/.test(p);
}
function isUserVisibleTask(prompt, cfg) {
  if (!prompt || looksCompletionEvent(prompt) || looksCron(prompt) || isConversationalQuestion(prompt)) return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(fix|implement|do it|go ahead|continue|set up|wire|restart|verify|debug|diagnose|install|push|commit|create|update|deploy|patch|recover|phase\s*[0-9]+|phases\s*[0-9-]+|roadmap|clone)/.test(p);
}
function needsObjectiveGrounding(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(implement|fix|build|wire|patch|deploy|create|update|continue|phase\s*[0-9]+|phases\s*[0-9-]+|roadmap|clone|follow the previous|follow the roadmap)/.test(p);
}
function needsCloneParityContract(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /((1:1|1-to-1|1 to 1|one-to-one|one to one)\s+clone|clone\s+(of\s+)?[^.\n]{0,80}(1:1|1-to-1|1 to 1|one-to-one|one to one)|full\s+clone|exact\s+clone)/.test(p);
}
function hasAmbiguousReference(prompt) {
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(\bdo it\b|\bthis\b|\bthat\b|\bit\b|previous roadmap|follow the previous|phase\s*[0-9]+|phases\s*[0-9-]+|same roadmap|that one)/.test(p);
}
function hasGroundingProof(summary, grounding = {}) {
  const p = normalizeSoft(summary);
  const hasAnchor = p.includes('anchor:');
  const hasTarget = p.includes('target path:') || p.includes('target repo:') || p.includes('codebase:');
  const hasDiff = p.includes('diff scope:') || p.includes('implementation surface:') || p.includes('product files:') || p.includes('scaffolding only');
  const replyAnchorRequired = Boolean(grounding?.replyThread?.required);
  const hasReplyAnchor = !replyAnchorRequired || p.includes('reply anchor:');
  return hasAnchor && hasTarget && hasDiff && hasReplyAnchor;
}
function hasCloneParityProof(summary, cloneParity = {}) {
  if (!cloneParity?.required) return true;
  const p = normalizeSoft(summary);
  const blockerMode = hasBlockerReport(summary);
  const hasFullStatus = p.includes('parity status: full');
  const hasBlockedStatus = p.includes('parity status: blocked') || p.includes('parity status: incomplete') || p.includes('parity status: not full');
  const hasCoverage = p.includes('surface coverage:');
  const hasEvidence = p.includes('parity evidence:') || p.includes('parity checks:') || p.includes('parity tests:');
  const hasRemaining = p.includes('remaining gaps:');
  const downgradeWords = /(prototype|first-pass|first pass|vertical slice|mvp|mini version|working slice|scaffold-only|scaffolding only|partial parity|parity status: partial)/.test(p);
  if (blockerMode) return hasBlockedStatus && hasCoverage && hasEvidence && hasRemaining;
  return hasFullStatus && hasCoverage && hasEvidence && hasRemaining && !downgradeWords;
}
function inferRequestedFidelity(prompt, cfg) {
  const p = normalizeSoft(sanitizePrompt(prompt));
  if (needsCloneParityContract(prompt, cfg)) return 'full_clone';
  if (/(parity|equivalent|mirror|match mailchimp|close match|high-fidelity|high fidelity)/.test(p)) return 'parity_for_scope';
  if (/(prototype|mock|sketch|wireframe|rough draft|rough pass)/.test(p)) return 'prototype';
  return 'production_slice';
}
function inferRequestedScope(prompt, replyThread) {
  const anchor = normalize(replyThread?.summary || '');
  if (anchor) return summarize(anchor, 220);
  return summarize(sanitizePrompt(prompt), 220);
}
function needsCampaignRuntime(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(until complete|do not stop|keep going|keep iterating|long-run|long run|multi-stage|multi stage|worker \+ supervisor \+ notifier|campaign runtime|persistent campaign|phase\s*[0-9]+|phases\s*[0-9-]+|program\s*[0-9]+|programs\s*[0-9-]+|roadmap|clone)/.test(p);
}
function needsSurfaceMatrix(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(roadmap|phase\s*[0-9]+|phases\s*[0-9-]+|program\s*[0-9]+|programs\s*[0-9-]+|surface|clone|parity)/.test(p);
}
function hasTaskContractProof(summary, contract = {}) {
  if (!contract?.required) return true;
  const p = normalizeSoft(summary);
  const hasFidelity = p.includes('fidelity:');
  const hasScope = p.includes('scope:');
  const hasStop = p.includes('stop condition:');
  return hasFidelity && hasScope && hasStop;
}
function hasBlockerReport(summary) {
  const p = normalizeSoft(summary);
  const supervisorRed = /supervisor status:\s*(red|blocked|incomplete|not complete)|supervisor confirmed completion:\s*(no|false)|allcomplete:\s*false/.test(p);
  return supervisorRed && p.includes('blocker:') && p.includes('next action:');
}
function hasCampaignRuntimeProof(summary, campaign = {}) {
  if (!campaign?.required) return true;
  const p = normalizeSoft(summary);
  const hasMode = p.includes('campaign mode: persistent') || p.includes('campaign mode: session') || p.includes('campaign mode: persistent_campaign');
  const supervisorGreen = /supervisor status:\s*(green|complete)|supervisor confirmed completion:\s*(yes|true)|allcomplete:\s*true/.test(p);
  return hasMode && (supervisorGreen || hasBlockerReport(summary));
}
function surfaceMatrixState(summary) {
  const p = normalizeSoft(summary);
  if (/surface matrix status:\s*(all_complete|complete|green)/.test(p)) return 'all_complete';
  if (/surface matrix status:\s*(blocked|red)/.test(p)) return 'blocked';
  if (/surface matrix status:\s*(partial|in_progress|in progress|yellow)/.test(p)) return 'partial';
  return 'missing';
}
function hasSurfaceMatrixProof(summary, surfaceMatrix = {}, cloneParity = {}, campaign = {}) {
  if (!surfaceMatrix?.required) return true;
  const p = normalizeSoft(summary);
  const hasMatrix = p.includes('surface matrix:') || p.includes('surface checklist:');
  const state = surfaceMatrixState(summary);
  if (!hasMatrix || state === 'missing') return false;
  if (campaign?.required && hasBlockerReport(summary)) return true;
  if (cloneParity?.required) return state === 'all_complete';
  return state === 'all_complete' || state === 'partial';
}
function needsHonestyGate(prompt, cfg) {
  if (inferTrustTier(prompt, cfg) !== 'important') return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(implement|fix|build|wire|patch|create|update|continue|clone|author|refactor|replace|ship|make this real)/.test(p);
}
function resolveExistingPath(targetPath) {
  const cleaned = cleanPathCandidate(targetPath);
  if (!cleaned) return null;
  if (fs.existsSync(cleaned)) return cleaned;
  const asDir = path.dirname(cleaned);
  return fs.existsSync(asDir) ? asDir : null;
}
function resolveRepoRoot(targetPath) {
  let current = resolveExistingPath(targetPath);
  if (!current) return null;
  if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolveExistingPath(targetPath);
}
function evaluateHonestyGate(summary, honesty = {}) {
  if (!honesty?.required) return { required: false, pass: true, targetPath: null, repoRoot: null, report: null, reason: null };
  const targetPath = extractStructuredField(summary, 'Target path');
  if (!targetPath) return { required: true, pass: false, targetPath: null, repoRoot: null, report: null, reason: 'honesty_target_path_missing' };
  const repoRoot = resolveRepoRoot(targetPath);
  if (!repoRoot) return { required: true, pass: false, targetPath, repoRoot: null, report: null, reason: 'honesty_target_path_unresolvable' };
  const report = enforceArchitecture(repoRoot);
  const pass = report?.honesty?.ok === true;
  return { required: true, pass, targetPath, repoRoot, report, reason: pass ? null : 'honesty_gate_failed' };
}
function cleanSummary(text, max = 280) { return summarize(sanitizePrompt(String(text || '').replace(/[{}\[\]"]+/g, '')), max); }
function buildCompletionMessage(task) {
  const done = cleanSummary(task.completionSummary) || `Completed: ${task.prompt}`;
  const blocked = hasBlockerReport(task.completionSummary || '');
  const lead = blocked ? 'Blocked' : 'Done';
  const remains = blocked
    ? 'follow the blocker + next-action path in the summary before treating this task as complete.'
    : task.validation?.required && !task.validation?.passed
      ? 'validator follow-up required'
      : 'none unless you want deeper verification.';
  const honesty = task.honesty?.required
    ? `\nHonesty gate: ${task.honesty?.status || 'unknown'}${task.honesty?.manifestPath ? ` (${task.honesty.manifestPath})` : ''}${task.honesty?.changedProductFiles?.length ? `; changed product surfaces=${task.honesty.changedProductFiles.join(', ')}` : ''}`
    : '';
  return `${lead}: ${done}\nEvidence: completion-integrity recorded internal completion and confirmed outbound delivery progression for this task.${honesty}\nWhat remains: ${remains}`;
}
function parseRuntimeMessageSignal(message) {
  const raw = normalize(extractText(message));
  const p = normalizeSoft(raw);
  if (!raw) return null;
  const looksSystem = p.startsWith('system:') || p.includes('exec completed') || p.includes('exec failed') || p.includes('process exited') || p.includes('process completed');
  if (!looksSystem) return null;
  if (/exec failed|code [1-9][0-9]*|signal sig|process exited .*code [1-9][0-9]*/i.test(raw)) {
    return { kind: 'failed', summary: summarize(raw, 400) };
  }
  if (/exec completed|process exited|process completed/i.test(raw)) {
    return { kind: 'completed', summary: summarize(raw, 400) };
  }
  return null;
}

export function createCompletionIntegrityEngine(config = {}, deps = {}) {
  const cfg = { ...DEFAULTS, ...config };
  cfg.escalationAfterMs = Math.max(5_000, Math.trunc(cfg.escalationAfterMs));
  cfg.autoDeliveryAfterMs = Math.max(1_000, Math.trunc(cfg.autoDeliveryAfterMs));
  cfg.retryBackoffMs = Math.max(1_000, Math.trunc(cfg.retryBackoffMs));
  cfg.pollIntervalMs = Math.max(1_000, Math.trunc(cfg.pollIntervalMs));

  const logger = deps.logger || console;
  const deliver = deps.deliver || defaultDeliver;
  const clock = deps.clock || (() => Date.now());
  const isoNow = deps.isoNow || (() => new Date(clock()).toISOString());

  const paths = {
    tasks: path.join(cfg.stateDir, 'tasks.json'),
    routes: path.join(cfg.stateDir, 'routes.json'),
    metrics: path.join(cfg.stateDir, 'metrics.json'),
    events: path.join(cfg.stateDir, 'events.ndjson'),
  };

  function migrateTask(task) {
    const next = { ...task };
    if (next.status === 'completed') next.status = 'internal_complete';
    if (next.status === 'announced') next.status = 'closed';
    if (!USER_VISIBLE_STATES.includes(next.status)) next.status = 'failed';
    next.updatedAt = next.updatedAt || next.closedAt || next.deliveryConfirmedAt || next.notificationSentAt || next.completedAt || next.createdAt || isoNow();
    next.history = Array.isArray(next.history) ? next.history : [{ from: null, to: next.status, at: next.updatedAt, migrated: true }];
    next.delivery = next.delivery || { attempts: 0, dedupeKeys: [], lastError: null };
    next.validation = next.validation || { required: false, mode: 'light', passed: true, runs: 0, failures: [] };
    next.trustTier = next.trustTier || 'normal';
    next.honesty = next.honesty || { required: false, proofPresent: false, targetPath: null, repoRoot: null, manifestPath: null, changedProductFiles: [], violations: [], status: null };
    next.contract = next.contract || { required: false, proofPresent: false, requestedFidelity: null, requestedScope: null, stopCondition: null };
    next.campaign = next.campaign || { required: false, proofPresent: false, modeRequired: null, supervisorStatus: null, blockerPresent: false };
    next.surfaceMatrix = next.surfaceMatrix || { required: false, proofPresent: false, status: null };
    return next;
  }
  function loadStore() {
    const raw = loadJson(paths.tasks, { version: 3, tasks: [] });
    if (!raw || !Array.isArray(raw.tasks)) return { version: 3, tasks: [] };
    const migrated = { version: 3, tasks: raw.tasks.map(migrateTask) };
    return migrated;
  }
  function saveStore(store) { saveJson(paths.tasks, { version: 3, tasks: store.tasks.map(migrateTask) }); }
  function loadRoutes() { return loadJson(paths.routes, []); }
  function saveRoutes(routes) { saveJson(paths.routes, routes.slice(-500)); }
  function loadMetrics() {
    return loadJson(paths.metrics, {
      version: 1,
      counters: {
        silent_success_count: 0,
        duplicate_reply_count: 0,
        false_done_count: 0,
        tool_error_count: 0,
        recovery_success_count: 0,
        validator_runs: 0,
        validator_failures: 0,
      },
      completion_to_notification_latency_ms: [],
      completion_to_delivery_confirmed_latency_ms: [],
      recovery_events: [],
      task_state_counts: {},
      updatedAt: null,
    });
  }
  function saveMetrics(metrics) { metrics.updatedAt = isoNow(); saveJson(paths.metrics, metrics); }
  function appendEvent(event) { fs.mkdirSync(path.dirname(paths.events), { recursive: true }); fs.appendFileSync(paths.events, JSON.stringify({ at: isoNow(), ...event }) + '\n'); }

  function taskStateCounts(tasks) {
    return tasks.reduce((acc, task) => { acc[task.status] = (acc[task.status] || 0) + 1; return acc; }, {});
  }
  function refreshStateMetrics() {
    const metrics = loadMetrics();
    metrics.task_state_counts = taskStateCounts(loadStore().tasks);
    saveMetrics(metrics);
  }
  function mutateMetrics(mutator) { const metrics = loadMetrics(); mutator(metrics); saveMetrics(metrics); }
  function recordCounter(name, delta = 1) { mutateMetrics((m) => { m.counters[name] = (m.counters[name] || 0) + delta; }); }
  function recordLatency(bucket, ms) { mutateMetrics((m) => { if (Number.isFinite(ms) && ms >= 0) m[bucket].push(ms); m[bucket] = m[bucket].slice(-200); }); }

  function upsertTask(task) {
    const store = loadStore();
    const idx = store.tasks.findIndex((x) => x.id === task.id);
    if (idx >= 0) store.tasks[idx] = task; else store.tasks.push(task);
    store.tasks = store.tasks.slice(-500);
    saveStore(store);
    refreshStateMetrics();
  }
  function mutateTask(taskId, mutator) {
    const store = loadStore();
    const task = store.tasks.find((x) => x.id === taskId);
    if (!task) return null;
    mutator(task);
    saveStore(store);
    refreshStateMetrics();
    return task;
  }
  function findLatestActiveTask(sessionKey) {
    const store = loadStore();
    return [...store.tasks].reverse().find((x) => x.sessionKey === sessionKey && ['pending', 'running', 'internal_complete', 'notification_sent', 'delivery_confirmed'].includes(x.status));
  }
  function rememberRoute(sessionKey, route) {
    const routes = loadRoutes().filter((x) => x.sessionKey !== sessionKey);
    routes.push({ ...route, updatedAt: isoNow() });
    saveRoutes(routes);
  }
  function getRoute(sessionKey) { return loadRoutes().find((x) => x.sessionKey === sessionKey); }

  function transitionTask(task, nextStatus, extras = {}) {
    if (!USER_VISIBLE_STATES.includes(nextStatus)) throw new Error(`invalid status ${nextStatus}`);
    const prev = task.status;
    task.status = nextStatus;
    task.updatedAt = isoNow();
    task.history = task.history || [];
    task.history.push({ from: prev, to: nextStatus, at: task.updatedAt, ...extras });
    Object.assign(task, extras);
    appendEvent({ type: 'state_transition', taskId: task.id, sessionKey: task.sessionKey, from: prev, to: nextStatus });
    return task;
  }

  function createTask(sessionKey, prompt) {
    const trustTier = inferTrustTier(prompt, cfg);
    const validationRequired = trustTier === 'important' && cfg.hardValidationModes.includes(cfg.validationMode || 'important_only');
    const groundingRequired = needsObjectiveGrounding(prompt, cfg);
    const cloneParityRequired = needsCloneParityContract(prompt, cfg);
    const campaignRequired = needsCampaignRuntime(prompt, cfg);
    const surfaceMatrixRequired = needsSurfaceMatrix(prompt, cfg);
    const replyThread = extractReplyThreadContext(prompt);
    const requestedFidelity = inferRequestedFidelity(prompt, cfg);
    const requestedScope = inferRequestedScope(prompt, replyThread);
    const task = {
      id: `${sessionKey}:${clock()}:${hash(prompt)}`,
      sessionKey,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      prompt: summarize(sanitizePrompt(prompt)),
      kind: 'user_visible',
      trustTier,
      status: 'pending',
      completionSummary: '',
      history: [{ from: null, to: 'pending', at: isoNow() }],
      delivery: { attempts: 0, dedupeKeys: [], lastError: null },
      validation: { required: validationRequired, mode: validationRequired ? 'strict' : 'light', passed: !validationRequired, runs: 0, failures: [] },
      honesty: {
        required: needsHonestyGate(prompt, cfg),
        proofPresent: false,
        targetPath: null,
        repoRoot: null,
        manifestPath: null,
        changedProductFiles: [],
        violations: [],
        status: null,
      },
      grounding: {
        required: groundingRequired,
        ambiguousReference: hasAmbiguousReference(prompt),
        proofPresent: false,
        replyThread: {
          present: replyThread.present,
          required: groundingRequired && replyThread.present,
          proofPresent: false,
          replyToId: replyThread.replyToId || null,
          senderLabel: replyThread.senderLabel || null,
          summary: replyThread.summary || null,
        },
      },
      cloneParity: {
        required: cloneParityRequired,
        proofPresent: false,
      },
      contract: {
        required: groundingRequired || cloneParityRequired || campaignRequired || surfaceMatrixRequired,
        proofPresent: false,
        requestedFidelity,
        requestedScope,
        stopCondition: campaignRequired ? 'supervisor_green_or_blocker_report' : 'completed_and_delivered',
      },
      campaign: {
        required: campaignRequired,
        proofPresent: false,
        modeRequired: campaignRequired ? 'persistent' : null,
        supervisorStatus: null,
        blockerPresent: false,
      },
      surfaceMatrix: {
        required: surfaceMatrixRequired,
        proofPresent: false,
        status: null,
      },
    };
    upsertTask(task);
    return task;
  }

  function startTask(taskId) { return mutateTask(taskId, (task) => { if (task.status === 'pending') transitionTask(task, 'running'); }); }
  function failTask(taskId, reason, source = 'runtime') {
    return mutateTask(taskId, (task) => {
      if (task.status === 'failed' || task.status === 'closed') return;
      transitionTask(task, 'failed', { failedAt: isoNow(), failureReason: summarize(reason, 400), failureSource: source });
      if (source === 'tool') recordCounter('tool_error_count');
    });
  }
  function completeInternally(taskId, summary, source = 'agent_end') {
    return mutateTask(taskId, (task) => {
      const summaryMax = task.cloneParity?.required ? 900 : task.grounding?.required ? 560 : 280;
      const nextSummary = cleanSummary(summary, summaryMax) || task.completionSummary || `Completed: ${task.prompt}`;
      if (task.status === 'internal_complete') {
        task.completionSummary = nextSummary;
        task.completedAt = task.completedAt || isoNow();
        task.completionSource = source;
        task.updatedAt = isoNow();
        return;
      }
      if (!['pending', 'running'].includes(task.status)) return;
      transitionTask(task, 'internal_complete', {
        completedAt: isoNow(),
        completionSummary: nextSummary,
        completionSource: source,
      });
    });
  }
  function runValidator(taskId, details = {}) {
    return mutateTask(taskId, (task) => {
      task.validation.runs += 1;
      recordCounter('validator_runs');
      const summary = normalizeSoft(`${task.completionSummary} ${JSON.stringify(details)}`);
      const contractPass = !task.contract?.required || hasTaskContractProof(task.completionSummary || '', task.contract || {});
      const groundingPass = !task.grounding?.required || hasGroundingProof(task.completionSummary || '', task.grounding || {});
      const campaignPass = !task.campaign?.required || hasCampaignRuntimeProof(task.completionSummary || '', task.campaign || {});
      const surfaceMatrixPass = !task.surfaceMatrix?.required || hasSurfaceMatrixProof(task.completionSummary || '', task.surfaceMatrix || {}, task.cloneParity || {}, task.campaign || {});
      const clonePass = !task.cloneParity?.required || hasCloneParityProof(task.completionSummary || '', task.cloneParity || {});
      const honestyCheck = evaluateHonestyGate(task.completionSummary || '', task.honesty || {});
      const honestyPass = honestyCheck.pass;
      const pass = !task.validation.required || (summary.length >= 20 && !summary.includes('error:') && !summary.includes('failed') && contractPass && groundingPass && campaignPass && surfaceMatrixPass && clonePass && honestyPass);
      task.validation.passed = pass;
      task.validation.lastRunAt = isoNow();
      task.validation.lastDetails = details;
      task.honesty = task.honesty || { required: false, proofPresent: false, targetPath: null, repoRoot: null, manifestPath: null, changedProductFiles: [], violations: [], status: null };
      task.honesty.proofPresent = honestyPass;
      task.honesty.targetPath = honestyCheck.targetPath || null;
      task.honesty.repoRoot = honestyCheck.repoRoot || null;
      task.honesty.manifestPath = honestyCheck.report?.honesty?.manifestPath || null;
      task.honesty.changedProductFiles = honestyCheck.report?.honesty?.changedProductFiles || [];
      task.honesty.violations = honestyCheck.report?.honesty?.violations || (honestyCheck.reason ? [{ rule: honestyCheck.reason, path: honestyCheck.targetPath || task.prompt, message: honestyCheck.reason }] : []);
      task.honesty.status = honestyPass ? 'green' : task.honesty.required ? 'red' : 'not_required';
      task.contract = task.contract || { required: false, proofPresent: false, requestedFidelity: null, requestedScope: null, stopCondition: null };
      task.contract.proofPresent = contractPass;
      task.grounding = task.grounding || { required: false, ambiguousReference: false, proofPresent: false, replyThread: { present: false, required: false, proofPresent: false } };
      task.grounding.proofPresent = groundingPass;
      task.grounding.replyThread = task.grounding.replyThread || { present: false, required: false, proofPresent: false };
      task.grounding.replyThread.proofPresent = !task.grounding.replyThread.required || normalizeSoft(task.completionSummary || '').includes('reply anchor:');
      task.campaign = task.campaign || { required: false, proofPresent: false, modeRequired: null, supervisorStatus: null, blockerPresent: false };
      task.campaign.proofPresent = campaignPass;
      task.campaign.blockerPresent = hasBlockerReport(task.completionSummary || '');
      task.campaign.supervisorStatus = /supervisor status:\s*(green|complete)|supervisor confirmed completion:\s*(yes|true)|allcomplete:\s*true/.test(normalizeSoft(task.completionSummary || ''))
        ? 'green'
        : /supervisor status:\s*(red|blocked|incomplete|not complete)|supervisor confirmed completion:\s*(no|false)|allcomplete:\s*false/.test(normalizeSoft(task.completionSummary || ''))
          ? 'red'
          : null;
      task.surfaceMatrix = task.surfaceMatrix || { required: false, proofPresent: false, status: null };
      task.surfaceMatrix.proofPresent = surfaceMatrixPass;
      task.surfaceMatrix.status = surfaceMatrixState(task.completionSummary || '');
      task.cloneParity = task.cloneParity || { required: false, proofPresent: false };
      task.cloneParity.proofPresent = clonePass;
      if (!pass) {
        const reason = task.grounding.replyThread.required && !task.grounding.replyThread.proofPresent
          ? 'reply_thread_anchor_missing'
          : task.honesty.required && !task.honesty.proofPresent
            ? (task.honesty.violations?.[0]?.rule || 'honesty_gate_failed')
          : task.contract.required && !task.contract.proofPresent
            ? 'task_contract_proof_missing'
          : task.campaign.required && !task.campaign.proofPresent
            ? (task.campaign.supervisorStatus === 'red' ? 'campaign_stopped_while_supervisor_red' : 'campaign_runtime_proof_missing')
          : task.surfaceMatrix.required && !task.surfaceMatrix.proofPresent
            ? 'surface_matrix_proof_missing_or_incomplete'
          : task.cloneParity.required && !task.cloneParity.proofPresent
            ? 'clone_parity_proof_missing_or_partial'
          : groundingPass
            ? 'summary_missing_or_failed'
            : 'objective_grounding_proof_missing';
        task.validation.failures.push({ at: isoNow(), reason });
        recordCounter('validator_failures');
      }
    });
  }
  function markNotificationSent(taskId, info = {}) {
    return mutateTask(taskId, (task) => {
      if (task.status !== 'internal_complete') return;
      transitionTask(task, 'notification_sent', { notificationSentAt: isoNow(), ...info });
      const latency = parseMs(task.notificationSentAt) - parseMs(task.completedAt);
      recordLatency('completion_to_notification_latency_ms', latency);
    });
  }
  function markDeliveryConfirmed(taskId, info = {}) {
    return mutateTask(taskId, (task) => {
      if (!['notification_sent', 'delivery_confirmed'].includes(task.status)) return;
      if (task.status !== 'delivery_confirmed') {
        transitionTask(task, 'delivery_confirmed', { deliveryConfirmedAt: isoNow(), ...info });
        const latency = parseMs(task.deliveryConfirmedAt) - parseMs(task.completedAt);
        recordLatency('completion_to_delivery_confirmed_latency_ms', latency);
      }
    });
  }
  function closeTask(taskId, reason = 'user_visible_delivery_confirmed') {
    return mutateTask(taskId, (task) => {
      if (!['delivery_confirmed', 'failed'].includes(task.status)) return;
      transitionTask(task, 'closed', { closedAt: isoNow(), closeReason: reason });
    });
  }

  function recoverStaleTasks() {
    const store = loadStore();
    const now = clock();
    let recovered = 0;
    for (const task of store.tasks) {
      if (['pending', 'running'].includes(task.status) && now - parseMs(task.updatedAt) >= cfg.escalationAfterMs) {
        task.recoveredAt = isoNow();
        task.recoveryReason = 'restart_or_stale_running';
        task.status = 'internal_complete';
        task.completedAt = task.completedAt || isoNow();
        task.history = task.history || [];
        task.history.push({ from: 'running', to: 'internal_complete', at: isoNow(), recovery: true });
        recovered += 1;
      }
    }
    if (recovered) {
      saveStore(store);
      refreshStateMetrics();
      mutateMetrics((m) => { m.counters.recovery_success_count += recovered; m.recovery_events.push({ at: isoNow(), recovered }); m.recovery_events = m.recovery_events.slice(-100); });
    }
    return recovered;
  }

  async function autoDeliverCompletedTasks(runtimeCfg = {}) {
    const store = loadStore();
    const now = clock();
    let changed = false;
    for (const task of store.tasks) {
      if (task.status !== 'internal_complete') continue;
      if (task.validation?.required && !task.validation?.passed) continue;
      if (now - parseMs(task.completedAt) < cfg.autoDeliveryAfterMs) continue;
      if (task.delivery?.lastAttemptAt && now - parseMs(task.delivery.lastAttemptAt) < cfg.retryBackoffMs) continue;
      const route = getRoute(task.sessionKey);
      if (!route?.channelId || !route?.to) continue;
      const dedupeKey = hash(`${task.id}:${task.completedAt || ''}:${task.completionSummary || ''}`);
      if (task.delivery?.dedupeKeys?.includes(dedupeKey)) {
        recordCounter('duplicate_reply_count');
        continue;
      }
      task.delivery = task.delivery || { attempts: 0, dedupeKeys: [], lastError: null };
      task.delivery.attempts += 1;
      task.delivery.lastAttemptAt = isoNow();
      changed = true;
      try {
        await deliver({
          cfg: runtimeCfg,
          channel: route.channelId,
          to: route.to,
          accountId: route.accountId,
          payloads: [{ text: buildCompletionMessage(task), replyToId: route.replyToId }],
          replyToId: route.replyToId,
          session: { key: task.sessionKey },
          bestEffort: false,
        });
        task.delivery.dedupeKeys.push(dedupeKey);
        task.delivery.lastError = null;
        task.notificationReceipt = { dedupeKey, channelId: route.channelId, to: route.to, replyToId: route.replyToId };
        task.notificationSentAt = isoNow();
        task.status = 'notification_sent';
        task.history = task.history || [];
        task.history.push({ from: 'internal_complete', to: 'notification_sent', at: task.notificationSentAt, auto: true });
        recordLatency('completion_to_notification_latency_ms', parseMs(task.notificationSentAt) - parseMs(task.completedAt));
      } catch (error) {
        task.delivery.lastError = String(error);
        logger.warn?.(`completion-integrity auto-delivery failed session=${task.sessionKey}: ${String(error)}`);
        recordCounter('tool_error_count');
      }
    }
    if (changed) { saveStore(store); refreshStateMetrics(); }
  }

  function maybeCountSilentSuccess(task) {
    if (task.status === 'internal_complete' && !task.notificationSentAt && clock() - parseMs(task.completedAt) >= cfg.escalationAfterMs) {
      recordCounter('silent_success_count');
      return true;
    }
    return false;
  }
  function validateFalseDone(task) {
    if ((task.status === 'delivery_confirmed' || task.status === 'closed') && task.validation?.required && !task.validation?.passed) {
      recordCounter('false_done_count');
      return true;
    }
    return false;
  }

  function getPendingAnnouncements(sessionKey) {
    return loadStore().tasks.filter((t) => t.sessionKey === sessionKey && ['internal_complete', 'notification_sent'].includes(t.status));
  }

  return {
    cfg,
    paths,
    createTask,
    startTask,
    failTask,
    completeInternally,
    runValidator,
    markNotificationSent,
    markDeliveryConfirmed,
    closeTask,
    rememberRoute,
    getRoute,
    loadStore,
    loadMetrics,
    autoDeliverCompletedTasks,
    recoverStaleTasks,
    getPendingAnnouncements,
    maybeCountSilentSuccess,
    validateFalseDone,
    isUserVisibleTask: (prompt) => isUserVisibleTask(prompt, cfg),
    inferTrustTier: (prompt) => inferTrustTier(prompt, cfg),
    buildPromptInjection(sessionKey) {
      const pending = getPendingAnnouncements(sessionKey);
      for (const task of pending) maybeCountSilentSuccess(task);
      const active = findLatestActiveTask(sessionKey);
      const lines = [];
      if (active?.grounding?.replyThread?.present) {
        lines.push(
          'REPLY_THREAD_GROUNDING',
          'This inbound message is a reply to an earlier message. Treat that replied message as the primary anchor before searching the repo or memory for alternatives.',
          active.grounding.replyThread.summary ? `Reply anchor summary: "${active.grounding.replyThread.summary}"` : `Reply anchor id: ${active.grounding.replyThread.replyToId || 'unknown'}`,
          active.grounding.replyThread.senderLabel ? `Reply anchor sender: ${active.grounding.replyThread.senderLabel}` : 'Reply anchor sender: unknown',
          '- Resolve phrases like "this", "that", "continue", "previous roadmap", and phase numbers against the replied message first.',
          '- Do not override a clear reply-thread anchor just because the repo contains other phase-shaped docs.',
          '- In your grounding proof, include `Reply anchor: ...` with the specific phase/program/scope extracted from the replied message.'
        );
      }
      if (active?.contract?.required) {
        lines.push(
          'TASK_CONTRACT',
          'Important execution task: lock a task contract before coding or claiming completion.',
          `- Fidelity: ${active.contract.requestedFidelity || 'production_slice'} (allowed lattice: ${FIDELITY_LATTICE.join(' < ')})`,
          `- Scope: ${active.contract.requestedScope || 'unspecified'}`,
          `- Stop condition: ${active.contract.stopCondition || 'completed_and_delivered'}`,
          'Required contract proof for completion:',
          '- Fidelity: ...',
          '- Scope: ...',
          '- Stop condition: ...',
          '- Do not silently shrink scope or downgrade fidelity mid-run.'
        );
      }
      if (active?.campaign?.required) {
        lines.push(
          'CAMPAIGN_RUNTIME',
          'This task requires campaign runtime semantics, not a one-shot pass.',
          '- One-shot “did one pass and stopped” behavior is invalid unless there is an explicit blocker report.',
          '- Use persistent campaign mode until the supervisor is green or a real blocker is documented.',
          'Required campaign proof for completion/reporting:',
          '- Campaign mode: persistent',
          '- Supervisor status: green (for completion) OR red with Blocker: ... and Next action: ... (for a blocker report)',
          '- If supervisor is red and there is no blocker report, keep going rather than stopping.'
        );
      }
      if (active?.surfaceMatrix?.required) {
        lines.push(
          'SURFACE_MATRIX',
          'This task requires a surface matrix/checklist derived from the requested scope.',
          '- Build/maintain a machine-readable surface matrix or checklist for the requested phases/programs/surfaces.',
          '- Supervisor truth gate must be derived from that matrix, not only from file existence.',
          'Required matrix proof for completion/reporting:',
          '- Surface matrix: <artifact path or identifier>',
          '- Surface matrix status: all_complete / partial / blocked',
          '- For full clone/parity claims, the matrix must be all_complete.'
        );
      }
      if (active?.cloneParity?.required) {
        lines.push(
          'CLONE_PARITY_CONTRACT',
          'A request for a 1:1/full/exact clone means parity-first, not MVP-first.',
          '- Do not silently reinterpret clone/parity work as a prototype, working slice, first pass, or mini version.',
          '- Completion is invalid unless the result is presented as full parity for the requested scope.',
          'Required clone proof for completion:',
          '- Parity status: full',
          '- Surface coverage: list the requested clone surfaces/programs covered',
          '- Parity evidence: list the concrete parity checks/tests run',
          '- Remaining gaps: none, or only clearly minor polish items',
          '- If the result is partial, prototype, scaffold, first-pass, or missing major surfaces, say so and do not claim completion.'
        );
      }
      if (active?.honesty?.required) {
        lines.push(
          'HONESTY_GATE',
          'This task is under the global surface-honesty policy for Cortex/OpenClaw work.',
          '- If you change real product files, update the target repo’s `surface-honesty.json` (or equivalent configured honesty manifest).',
          '- Changed product files must be declared, marked `real`, and carry concrete evidence.tests entries.',
          '- Do not claim completion unless the honesty gate is green for the target repo/path.',
          'Required honesty proof for completion/reporting:',
          '- Honesty manifest: <path>',
          '- Honesty gate: green / not_required',
          '- Changed product surfaces: <list or none>',
          '- Honesty evidence: <tests or executable checks that back the declared real surfaces>'
        );
      }
      if (active?.grounding?.required) {
        lines.push(
          'OBJECTIVE_GROUNDING',
          'Important implementation task: before coding or claiming completion, resolve the exact objective anchor.',
          'Required grounding proof for this task:',
          '- Anchor: name the exact prior artifact/message/roadmap you are following.',
          active?.grounding?.replyThread?.required ? '- Reply anchor: restate the replied message that the current request is anchored to.' : '- Reply anchor: include this only when the current message is a reply and the replied message sets scope.',
          '- Target path: name the repo/path/codebase you are changing.',
          '- Implementation surface: say whether this is product code, scaffolding/control-plane, docs/tests, or mixed.',
          '- Diff scope: before claiming implementation, verify changed files include real product-surface files; if not, explicitly say scaffolding only and do not claim feature completion.',
          '- If the anchor or target path cannot be named confidently, stop and ask instead of guessing.',
          active.grounding.ambiguousReference ? '- Warning: the prompt contains ambiguous references (for example: this / do it / previous roadmap / phase numbers). Resolve them against the immediately previous user-visible artifact first.' : '- Prompt does not look reference-ambiguous, but grounding proof is still required before claiming completion.'
        );
      }
      if (pending.length) {
        lines.push(
          'COMPLETION_INTEGRITY',
          'A previously requested user-visible task completed and must be clearly disclosed before anything else.',
          'Use this structure naturally: done, evidence, what remains.',
          'Do not treat the task as closed until delivery is confirmed.',
          'Pending completed tasks:',
          ...pending.slice(-3).map((t) => `- ${t.completionSummary || t.prompt} [state=${t.status}; trust=${t.trustTier}]`),
        );
      }
      return lines.length ? { appendSystemContext: lines.join('\n') } : undefined;
    },
    onMessageReceived(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      if (!sessionKey) return;
      rememberRoute(sessionKey, {
        sessionKey,
        channelId: ctx?.channelId,
        accountId: ctx?.accountId,
        to: typeof event?.from === 'string' ? event.from : undefined,
        conversationId: ctx?.conversationId,
        replyToId: event?.metadata?.messageId,
      });
    },
    onBeforePromptBuild(event, ctx) {
      const prompt = typeof event?.prompt === 'string' ? event.prompt : '';
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      if (!prompt || !sessionKey) return;
      const active = findLatestActiveTask(sessionKey);
      if (!active && isUserVisibleTask(prompt, cfg)) {
        const task = createTask(sessionKey, prompt);
        startTask(task.id);
      }
      return this.buildPromptInjection(sessionKey);
    },
    onSubagentEnded(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      if (!sessionKey) return;
      const task = findLatestActiveTask(sessionKey);
      if (!task) return;
      completeInternally(task.id, extractText(event?.result) || `Subagent completed for: ${task.prompt}`, 'subagent_ended');
      runValidator(task.id, { source: 'subagent_ended' });
    },
    onAgentEnd(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      if (!sessionKey) return;
      const task = findLatestActiveTask(sessionKey);
      if (!task) return;
      if (!event?.success) {
        failTask(task.id, 'agent_end reported failure');
        return;
      }
      const summary = extractText(event?.messages) || extractText(event?.result) || task.prompt;
      completeInternally(task.id, summary, 'agent_end');
      runValidator(task.id, { source: 'agent_end', success: true });
    },
    onMessageSent(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
      if (!sessionKey) return;
      const task = findLatestActiveTask(sessionKey);
      if (!task) return;
      if (task.status === 'internal_complete') markNotificationSent(task.id, { source: 'message_sent' });
      if (task.status === 'notification_sent') {
        const outboundText = normalizeSoft(event?.content || event?.text || '');
        const expected = normalizeSoft(buildCompletionMessage(task));
        if (!outboundText || expected.includes(outboundText.slice(0, 24)) || outboundText.includes('done:')) {
          markDeliveryConfirmed(task.id, { source: 'message_sent' });
          closeTask(task.id);
        }
      }
    },
    onBeforeMessageWrite(event, ctx) {
      const sessionKey = String(ctx?.sessionKey || event?.sessionKey || '');
      if (!sessionKey) return;
      const signal = parseRuntimeMessageSignal(event?.message);
      if (!signal) return;
      const task = [...loadStore().tasks].reverse().find((t) => t.sessionKey === sessionKey && ['pending', 'running', 'internal_complete'].includes(t.status));
      if (!task) return;
      if (signal.kind === 'failed') {
        failTask(task.id, signal.summary, 'runtime_message');
        return;
      }
      completeInternally(task.id, signal.summary, 'runtime_message');
      runValidator(task.id, { source: 'runtime_message', signal: signal.kind });
    },
  };
}

export default function register(api) {
  const cfg = api.config || api.pluginConfig || {};
  const engine = createCompletionIntegrityEngine(cfg, { logger: api.logger, deliver: defaultDeliver });
  let timer = null;

  api.on('message_received', async (event, ctx) => engine.onMessageReceived(event, ctx));
  api.on('before_prompt_build', async (event, ctx) => engine.onBeforePromptBuild(event, ctx));
  api.on('subagent_ended', async (event, ctx) => engine.onSubagentEnded(event, ctx));
  api.on('agent_end', async (event, ctx) => engine.onAgentEnd(event, ctx));
  api.on('message_sent', async (event, ctx) => engine.onMessageSent(event, ctx));
  api.on('before_message_write', (event, ctx) => engine.onBeforeMessageWrite(event, ctx));
  api.on('after_tool_call', async (event, ctx) => {
    const output = event?.result;
    const errorText = typeof output?.error === 'string' ? output.error : (output?.ok === false ? JSON.stringify(output) : '');
    if (!errorText) return;
    const sessionKey = String(ctx?.sessionKey || ctx?.sessionId || '');
    const task = sessionKey ? engine.loadStore().tasks.find((t) => t.sessionKey === sessionKey && ['pending', 'running', 'internal_complete', 'notification_sent'].includes(t.status)) : null;
    if (task) engine.failTask(task.id, errorText, 'tool');
  });
  api.on('gateway_start', async () => {
    engine.recoverStaleTasks();
    if (timer) clearInterval(timer);
    timer = setInterval(() => { void engine.autoDeliverCompletedTasks(api.config); }, engine.cfg.pollIntervalMs);
    void engine.autoDeliverCompletedTasks(api.config);
  });
  api.on('gateway_stop', async () => { if (timer) clearInterval(timer); timer = null; });
}
