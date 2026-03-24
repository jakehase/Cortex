import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deliverOutboundPayloads } from '/usr/lib/node_modules/openclaw/dist/plugin-sdk/deliver-runtime-20_kW0lQ.js';

const USER_VISIBLE_STATES = ['pending', 'running', 'internal_complete', 'notification_sent', 'delivery_confirmed', 'closed', 'failed'];
const DEFAULTS = {
  stateDir: '/root/clawd/state/completion-integrity',
  escalationAfterMs: 90_000,
  autoDeliveryAfterMs: 15_000,
  retryBackoffMs: 10_000,
  pollIntervalMs: 10_000,
  importantKeywords: ['fix', 'implement', 'deploy', 'restart', 'verify', 'debug', 'diagnose', 'migrate', 'patch', 'recover'],
  lightweightKeywords: ['what happened', 'what changed', 'summarize', 'explain'],
  hardValidationModes: ['strict', 'important_only'],
};

function nowIso() { return new Date().toISOString(); }
function parseMs(v) { const n = Date.parse(v || ''); return Number.isFinite(n) ? n : 0; }
function safeJsonParse(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }
function loadJson(file, fallback) { try { return safeJsonParse(fs.readFileSync(file, 'utf8'), fallback); } catch { return fallback; } }
function saveJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function normalize(text) { return String(text || '').replace(/\s+/g, ' ').trim(); }
function normalizeSoft(text) { return normalize(text).toLowerCase(); }
function summarize(text, max = 240) { return normalize(text).slice(0, max); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16); }
function stripInternalEnvelope(text) {
  return String(text || '')
    .replace(/Conversation info \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, ' ')
    .replace(/Sender \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, ' ')
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
  if (/^(why|what|how|when|where|who|did|does|do|is|are|can|could|would|should)\b/.test(p)) return true;
  if (p.includes('?')) return true;
  return /(what happened|summarize|explain|why were you|diagnose why)/.test(p);
}
function isUserVisibleTask(prompt, cfg) {
  if (!prompt || looksCompletionEvent(prompt) || looksCron(prompt) || isConversationalQuestion(prompt)) return false;
  const p = normalizeSoft(sanitizePrompt(prompt));
  return /(fix|implement|do it|go ahead|set up|wire|restart|verify|debug|diagnose|install|push|commit|create|update|deploy|patch|recover)/.test(p);
}
function cleanSummary(text) { return summarize(sanitizePrompt(String(text || '').replace(/[{}\[\]"]+/g, '')), 280); }
function buildCompletionMessage(task) {
  const done = cleanSummary(task.completionSummary) || `Completed: ${task.prompt}`;
  return `Done: ${done}\nEvidence: completion-integrity recorded internal completion and confirmed outbound delivery progression for this task.\nWhat remains: ${task.validation?.required && !task.validation?.passed ? 'validator follow-up required' : 'none unless you want deeper verification.'}`;
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
  const deliver = deps.deliver || deliverOutboundPayloads;
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
    return next;
  }
  function loadStore() {
    const raw = loadJson(paths.tasks, { version: 2, tasks: [] });
    if (!raw || !Array.isArray(raw.tasks)) return { version: 2, tasks: [] };
    const migrated = { version: 2, tasks: raw.tasks.map(migrateTask) };
    return migrated;
  }
  function saveStore(store) { saveJson(paths.tasks, { version: 2, tasks: store.tasks.map(migrateTask) }); }
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
      const nextSummary = cleanSummary(summary) || task.completionSummary || `Completed: ${task.prompt}`;
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
      const pass = !task.validation.required || (summary.length >= 20 && !summary.includes('error:') && !summary.includes('failed'));
      task.validation.passed = pass;
      task.validation.lastRunAt = isoNow();
      task.validation.lastDetails = details;
      if (!pass) {
        task.validation.failures.push({ at: isoNow(), reason: 'summary_missing_or_failed' });
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
      return pending.length ? {
        appendSystemContext: [
          'COMPLETION_INTEGRITY',
          'A previously requested user-visible task completed and must be clearly disclosed before anything else.',
          'Use this structure naturally: done, evidence, what remains.',
          'Do not treat the task as closed until delivery is confirmed.',
          'Pending completed tasks:',
          ...pending.slice(-3).map((t) => `- ${t.completionSummary || t.prompt} [state=${t.status}; trust=${t.trustTier}]`),
        ].join('\n')
      } : undefined;
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
  const engine = createCompletionIntegrityEngine(cfg, { logger: api.logger, deliver: deliverOutboundPayloads });
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
