#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildCortexCodexBoundary } from './cortex-codex-boundary.mjs';

function parseArgs(argv) {
  const args = { strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--strict') args.strict = true;
    else if (token === '--artifact-root') args.artifactRoot = argv[++index];
    else if (token === '--contract') args.contractPath = argv[++index];
    else if (token === '--route-gate-dir') args.routeGateDir = argv[++index];
    else if (token === '--cortex-url') args.cortexUrl = argv[++index];
  }
  return args;
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function fileInfo(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      exists: true,
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString(),
      ageMinutes: Number(((Date.now() - stat.mtimeMs) / 60000).toFixed(2))
    };
  } catch {
    return { path: filePath, exists: false };
  }
}

async function fetchJson(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: response.ok, status: response.status, json, text: json ? null : text.slice(0, 500) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function addCheck(checks, severity, ok, id, message, details = {}) {
  checks.push({ severity, ok: Boolean(ok), id, message, ...details });
}

function routeGateSnapshot(routeGateDir) {
  const files = ['prompt-history.json', 'prompt-fingerprints.json', 'last-good-plan.json', 'adaptive-routing-stats.json'];
  const infos = Object.fromEntries(files.map((name) => [name, fileInfo(path.join(routeGateDir, name))]));
  const stats = readJson(path.join(routeGateDir, 'adaptive-routing-stats.json'), null);
  return {
    dir: routeGateDir,
    files: infos,
    statsUpdatedAt: stats?.updatedAt || null,
    levelCount: stats?.byLevel ? Object.keys(stats.byLevel).length : 0,
    totalUses: stats?.byLevel ? Object.values(stats.byLevel).reduce((sum, entry) => sum + Number(entry?.uses || 0), 0) : null
  };
}

function summarizeRuntimeStatus(payload) {
  const runtime = payload?.json?.runtime || payload?.json || null;
  const processes = Array.isArray(runtime?.processes) ? runtime.processes : [];
  return {
    ok: payload?.ok === true,
    processCount: Number(runtime?.process_count ?? processes.length ?? 0),
    byStatus: runtime?.by_status || null,
    sampleProcessIds: processes.slice(0, 5).map((entry) => entry.process_id).filter(Boolean)
  };
}

function latestBudgetLedger(artifactRoot) {
  if (!artifactRoot) return null;
  const candidates = [];
  const stack = [artifactRoot];
  while (stack.length && candidates.length < 200) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/creative-worker-budget-ledger\.json$/.test(entry.name)) candidates.push(fileInfo(full));
    }
  }
  candidates.sort((a, b) => String(b.mtime || '').localeCompare(String(a.mtime || '')));
  const chosen = candidates[0] || null;
  return chosen ? { ...chosen, payload: readJson(chosen.path, null) } : null;
}

const args = parseArgs(process.argv.slice(2));
const cortexUrl = (args.cortexUrl || process.env.CORTEX_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const routeGateDir = args.routeGateDir || process.env.CORTEX_ROUTE_GATE_DIR || '/root/.openclaw/cortex-route-gate';
const contract = args.contractPath ? readJson(args.contractPath, null) : null;
const artifactRoot = args.artifactRoot || contract?.artifactRoot || null;
const checks = [];

const [health, runtimeStatusPayload] = await Promise.all([
  fetchJson(`${cortexUrl}/health`),
  fetchJson(`${cortexUrl}/orchestrator/runtime/status`)
]);
const runtimeStatus = summarizeRuntimeStatus(runtimeStatusPayload);
const routeGate = routeGateSnapshot(routeGateDir);
const budgetLedger = latestBudgetLedger(artifactRoot);
const boundary = buildCortexCodexBoundary({
  env: process.env,
  contract,
  workerCommand: process.env.CREATIVE_WORKER_COMMAND || contract?.scope?.creativeProductWork?.workerCommand || null,
  budgetLedgerPath: process.env.CREATIVE_WORKER_BUDGET_LEDGER_PATH || budgetLedger?.path || null,
  codexBin: process.env.CODEX_BIN || null,
  codexModel: process.env.CODEX_CREATIVE_MODEL || process.env.CODEX_MODEL || null,
  codexSandbox: process.env.CODEX_CREATIVE_SANDBOX || null,
  promptMode: process.env.CREATIVE_WORKER_PROMPT_MODE || process.env.CODEX_CREATIVE_PROMPT_MODE || contract?.scope?.creativeProductWork?.promptMode || null
});

addCheck(checks, 'error', health.ok && health.json?.status === 'healthy', 'cortex_health', 'Cortex /health is reachable and healthy', { status: health.status || null, error: health.error || null });
addCheck(checks, 'warning', runtimeStatus.ok, 'cortex_runtime_status_reachable', 'Cortex runtime status endpoint is reachable', runtimeStatus);
addCheck(checks, 'warning', runtimeStatus.processCount < 500, 'runtime_process_count_not_bloated', 'Runtime process queue is not obviously stale/bloated', { processCount: runtimeStatus.processCount, byStatus: runtimeStatus.byStatus });
addCheck(checks, 'warning', routeGate.files['prompt-history.json'].exists, 'route_gate_prompt_history_present', 'Route-gate prompt history file exists', routeGate.files['prompt-history.json']);
addCheck(checks, 'warning', routeGate.files['prompt-fingerprints.json'].exists, 'route_gate_prompt_fingerprints_present', 'Route-gate prompt fingerprint file exists', routeGate.files['prompt-fingerprints.json']);
addCheck(checks, 'warning', routeGate.files['adaptive-routing-stats.json'].exists, 'route_gate_adaptive_stats_present', 'Route-gate adaptive stats file exists', routeGate.files['adaptive-routing-stats.json']);
addCheck(checks, 'warning', !routeGate.files['adaptive-routing-stats.json'].exists || (routeGate.files['adaptive-routing-stats.json'].ageMinutes ?? Infinity) < 24 * 60, 'route_gate_adaptive_stats_fresh', 'Adaptive route stats updated in the last 24h', routeGate.files['adaptive-routing-stats.json']);
addCheck(checks, 'warning', boundary.behaviorChanging === false, 'dashboard_non_behavior_changing', 'Dashboard/boundary inspection is read-only and does not change Cortex routing behavior', { behaviorChanging: boundary.behaviorChanging });
addCheck(checks, 'warning', boundary.governors.budgetRequired || boundary.governors.budgetLedgerPath || !artifactRoot, 'budget_governor_visible_when_artifact_supplied', 'Budget governor state is visible when an artifact root/ledger is supplied', { budgetLedgerPath: boundary.governors.budgetLedgerPath, budgetRequired: boundary.governors.budgetRequired });

const errors = checks.filter((entry) => entry.severity === 'error' && !entry.ok);
const warnings = checks.filter((entry) => entry.severity === 'warning' && !entry.ok);
const dashboard = {
  schemaVersion: 'claw.cortex_ops_health_dashboard.v1',
  generatedAt: new Date().toISOString(),
  behaviorChanging: false,
  ok: errors.length === 0,
  warningCount: warnings.length,
  cortex: {
    baseUrl: cortexUrl,
    health: health.json || { ok: health.ok, status: health.status || null, error: health.error || null },
    runtimeStatus
  },
  routeGate,
  artifactRoot,
  budgetLedger: budgetLedger ? {
    path: budgetLedger.path,
    mtime: budgetLedger.mtime,
    callsStarted: budgetLedger.payload?.callsStarted ?? null,
    callsCompleted: budgetLedger.payload?.callsCompleted ?? null,
    activeCalls: budgetLedger.payload?.activeCalls ?? null,
    tokensObserved: budgetLedger.payload?.tokensObserved ?? null,
    globalStop: budgetLedger.payload?.globalStop || null,
    tokenBudgetMode: budgetLedger.payload?.tokenBudgetMode || budgetLedger.payload?.metering?.tokenBudgetMode || null
  } : null,
  cognitionBoundary: boundary,
  checks,
  recommendations: warnings.map((entry) => ({ id: entry.id, action: entry.message }))
};

console.log(JSON.stringify(dashboard, null, 2));
process.exit(args.strict && errors.length ? 1 : 0);
