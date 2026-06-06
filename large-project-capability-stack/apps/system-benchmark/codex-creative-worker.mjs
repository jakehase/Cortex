#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planCreativeBundleRuntime } from '../../packages/continuous-workload-controller/index.mjs';

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function fileSnapshot(workspace, relFiles) {
  const result = new Map();
  for (const rel of relFiles) {
    const abs = path.join(workspace, rel);
    result.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null);
  }
  return result;
}

function changedFiles(workspace, before, relFiles) {
  const changed = [];
  for (const rel of relFiles) {
    const abs = path.join(workspace, rel);
    const after = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (before.get(rel) !== after) changed.push(rel);
  }
  return changed;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}


function readFilePrefix(filePath, maxBytes = 512 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(Math.max(0, Number(maxBytes) || 0), stat.size);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, 0);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function shellCommandForDisplay(command, args) {
  return [command, ...args].map((part) => /[^A-Za-z0-9_./:=@+-]/.test(part) ? JSON.stringify(part) : part).join(' ');
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'required'].includes(String(value).trim().toLowerCase());
}

function parseJsonEnv(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function positiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parseActiveCodexCallSchedule(value) {
  const raw = String(value || '').trim();
  if (!raw) return { raw: '', entries: [], defaultLimit: null, valid: true, maxLimit: null };
  const entries = [];
  let defaultLimit = null;
  let valid = true;
  for (const part of raw.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const defaultMatch = /^default\s*:\s*(\d+)$/i.exec(part);
    const completedMatch = /^(?:completed|callsCompleted)\s*<\s*(\d+)\s*:\s*(\d+)$/i.exec(part);
    if (defaultMatch) {
      defaultLimit = positiveInt(defaultMatch[1], 0) || null;
      if (!defaultLimit) valid = false;
      continue;
    }
    if (completedMatch) {
      const completedBelow = positiveInt(completedMatch[1], 0);
      const limit = positiveInt(completedMatch[2], 0);
      if (!completedBelow || !limit) valid = false;
      else entries.push({ completedBelow, limit });
      continue;
    }
    valid = false;
  }
  entries.sort((a, b) => a.completedBelow - b.completedBelow);
  const maxLimit = Math.max(0, ...entries.map((entry) => entry.limit), defaultLimit || 0) || null;
  return { raw, entries, defaultLimit, valid: valid && (entries.length > 0 || defaultLimit != null), maxLimit };
}

function effectiveActiveCodexCallLimit(ledger, fallbackLimit, schedule) {
  if (!schedule?.valid || !schedule.entries?.length) return fallbackLimit || 0;
  const completed = Number(ledger?.callsCompleted || 0);
  const entry = schedule.entries.find((candidate) => completed < candidate.completedBelow);
  return entry?.limit || schedule.defaultLimit || fallbackLimit || 0;
}

function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, Math.max(1, Number(ms) || 1));
}

function trimMiddle(value = '', maxChars = 8000) {
  const text = String(value || '');
  const max = Math.max(200, Number(maxChars) || 8000);
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = Math.max(100, max - head - 80);
  return `${text.slice(0, head)}\n\n...[trimmed ${text.length - head - tail} chars by Cortex context governor]...\n\n${text.slice(-tail)}`;
}

function readFileSnippet(workspaceRoot, rel, maxChars = 8000) {
  try {
    const abs = path.join(workspaceRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return trimMiddle(fs.readFileSync(abs, 'utf8'), maxChars);
  } catch {
    return null;
  }
}

function parseCodexTokenUsage(logPath) {
  const text = readFilePrefix(logPath, 2 * 1024 * 1024);
  const values = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index].trim() !== 'tokens used') continue;
    const match = /([0-9][0-9,]*)/.exec(lines[index + 1] || '');
    if (match) values.push(Number(match[1].replace(/,/g, '')));
  }
  return {
    values,
    total: values.reduce((sum, value) => sum + value, 0),
    last: values.length ? values.at(-1) : 0,
    usageLimit: /You've hit your usage limit|usage limit|try again at/i.test(text)
  };
}

function normalizePromptMode(value) {
  const mode = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  if (['compact', 'compact_surface_brief'].includes(mode)) return 'compact';
  if (['full', 'full_context', 'legacy'].includes(mode)) return 'full_context';
  return 'full_context';
}

function normalizeCommandEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return entry.trim() || null;
  if (typeof entry.command === 'string') return entry.command.trim() || null;
  return null;
}

function looksLikeRunnableShellCommand(command) {
  const value = String(command || '').trim();
  if (!value || /\r?\n/.test(value)) return false;
  if (/^(?:Verifier passes|Runnable check|Command):\s+/i.test(value)) return false;
  if (/^(?:Semantic architecture evidence required|Real product behavior required|Acceptance criteria|required:)/i.test(value)) return false;
  return /^(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+)\s+)*(?:node|npm|npx|pnpm|yarn|bun|bash|sh|python3?|pytest|vitest|tsx|ts-node|go|cargo|make|cmake|deno|ruby|perl|java|mvn|gradle|git|grep|sed|awk|find|cat|test|\.\/|\.\.\/|\/)[\s/]/.test(value)
    || /^(?:(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+)\s+)*(?:node|npm|npx|pnpm|yarn|bun|bash|sh|python3?|pytest|vitest|tsx|ts-node|go|cargo|make|cmake|deno|ruby|perl|java|mvn|gradle|git|grep|sed|awk|find|cat|test)$/.test(value);
}

function runnableCommandEntry(entry) {
  const raw = normalizeCommandEntry(entry);
  if (!raw) return null;
  const verifierMatch = /^Verifier passes:\s*(.+)$/i.exec(raw);
  const runnableMatch = /^(?:Runnable check|Command):\s*(.+)$/i.exec(raw);
  const command = (verifierMatch?.[1] || runnableMatch?.[1] || raw).trim();
  return looksLikeRunnableShellCommand(command) ? command : null;
}

function verifierCatalogEntries(catalog) {
  if (!catalog || typeof catalog !== 'object') return [];
  return Object.values(catalog).filter(Boolean);
}

function commandListFromTaskAndPacket(taskPayload, packet) {
  const commands = [];
  const sources = [
    taskPayload?.acceptanceChecks,
    taskPayload?.runnableChecks,
    packet?.runnableChecks,
    verifierCatalogEntries(taskPayload?.inputs?.verifierCatalog),
    verifierCatalogEntries(taskPayload?.metadata?.verifierCatalog),
    verifierCatalogEntries(packet?.verifierCatalog)
  ];
  for (const source of sources) {
    for (const entry of Array.isArray(source) ? source : []) {
      const command = runnableCommandEntry(entry);
      if (command && !commands.includes(command)) commands.push(command);
    }
  }
  return commands;
}

function normalizeTargetAlias(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

const GENERIC_TARGET_ALIASES = new Set([
  'agency', 'approval', 'attribution', 'audience', 'billing', 'brand', 'calendar',
  'campaign', 'channel', 'collaboration', 'commerce', 'compliance', 'content',
  'dashboard', 'developer', 'settings', 'team'
]);

function targetAliasesForSurface() {
  const aliases = new Set();
  const add = (value) => {
    const normalized = normalizeTargetAlias(value)
      .replace(/^(?:domain|route|routes)-/, '')
      .replace(/-(?:dashboard|api|ops|public|runtime|routes?)$/i, '');
    if (normalized && normalized.length >= 3) aliases.add(normalized);
  };
  add(surfaceId);
  add(String(surfaceId || '').replace(/_(?:dashboard|api|ops|public)$/i, ''));
  for (const rel of productFiles) {
    const parts = String(rel || '').split('/').filter(Boolean);
    if (parts[0] === 'packages' && parts[1] && parts[1] !== 'app') add(parts[1]);
    add(path.basename(rel));
  }
  const values = Array.from(aliases).filter((entry) => entry.length >= 3);
  const specific = values.filter((entry) => !GENERIC_TARGET_ALIASES.has(entry));
  return specific.length ? specific : values;
}

function commandMatchesAssignedTarget(command, aliases = targetAliasesForSurface()) {
  const text = normalizeTargetAlias(command);
  if (!text) return false;
  if (/verify-mailchimp-no-generic-shim/.test(text)) {
    const normalizedSurface = normalizeTargetAlias(surfaceId);
    return text.includes(normalizedSurface) || productFiles.some((rel) => text.includes(normalizeTargetAlias(rel)) || text.includes(normalizeTargetAlias(path.basename(rel))));
  }
  return aliases.some((alias) => text.includes(alias));
}

function externalVerificationCommands() {
  const commands = commandListFromTaskAndPacket(task, cortexPacket);
  if (!targetedExternalVerificationOnly) return commands;
  const aliases = targetAliasesForSurface();
  const synthesizedTargetTests = allowedFiles
    .filter((rel) => /^tests\/.*\.test\.mjs$/i.test(String(rel || '')))
    .map((rel) => `node --test ${rel}`)
    .filter((command) => commandMatchesAssignedTarget(command, aliases));
  const filtered = stableOrdered([
    ...synthesizedTargetTests,
    ...commands.filter((command) => commandMatchesAssignedTarget(command, aliases))
  ]);
  return filtered.length ? filtered : commands;
}

function effectiveExternalVerificationFailures(verifications = []) {
  const latestByCommand = new Map();
  for (const entry of verifications) {
    for (const result of entry?.results || []) {
      latestByCommand.set(result.command || `__command_${latestByCommand.size}`, { ...result, iteration: entry.iteration });
    }
  }
  return Array.from(latestByCommand.values()).filter((result) => result.ok === false);
}

function summarizeCommandOutput(value = '', maxChars = 4000) {
  return trimMiddle(String(value || '').replace(/\u001b\[[0-9;]*m/g, ''), maxChars);
}

function computeRecentBurnRate(ledger, nowMs, windowMs) {
  const windowStart = nowMs - Math.max(60_000, Number(windowMs) || 600_000);
  const events = (ledger?.events || []).filter((event) => event?.type === 'codex_call_completed' && Number(event.tokensObserved || 0) > 0);
  const recent = events.filter((event) => {
    const atMs = Date.parse(event.at || '');
    return Number.isFinite(atMs) && atMs >= windowStart && atMs <= nowMs;
  });
  const tokens = recent.reduce((sum, event) => sum + Number(event.tokensObserved || 0), 0);
  const minutes = Math.max(1 / 60, (Math.min(Math.max(...recent.map((event) => Date.parse(event.at || '')).filter(Number.isFinite), nowMs), nowMs) - windowStart) / 60000);
  return {
    windowMs: Math.max(60_000, Number(windowMs) || 600_000),
    completedCalls: recent.length,
    tokens,
    tokensPerMinute: Math.round(tokens / Math.max(1 / 60, Math.max(1, windowMs / 60000)))
  };
}

function promptMetrics(promptText, mode) {
  const text = String(promptText || '');
  const lines = text.split(/\r?\n/);
  const repeatedLineCounts = new Map();
  for (const line of lines.map((entry) => entry.trim()).filter((entry) => entry.length > 40)) {
    repeatedLineCounts.set(line, (repeatedLineCounts.get(line) || 0) + 1);
  }
  const repeatedLongLineCount = Array.from(repeatedLineCounts.values()).filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
  return {
    mode,
    chars: text.length,
    approxTokens: Math.ceil(text.length / 4),
    lines: lines.length,
    repeatedLongLineCount,
    containsBudgetJson: /Budget policy: \{/.test(text),
    containsAssignedFileContext: /Bounded assigned-file context/.test(text)
  };
}

function acquireBudgetLock(lockPath, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return fs.openSync(lockPath, 'wx');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lockPath);
        if ((Date.now() - stat.mtimeMs) > 120_000) fs.unlinkSync(lockPath);
      } catch {}
      sleepMs(25 + Math.min(100, attempt));
    }
  }
  throw new Error(`budget_ledger_lock_timeout:${lockPath}`);
}

function mutateBudgetLedger(ledgerPath, mutator) {
  if (!ledgerPath) return mutator(null);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const lockPath = `${ledgerPath}.lock`;
  const lockFd = acquireBudgetLock(lockPath);
  try {
    const ledger = readJson(ledgerPath, {
      schemaVersion: 'claw.creative_worker_budget_ledger.v1',
      generatedAt: new Date().toISOString(),
      updatedAt: null,
      callsStarted: 0,
      callsCompleted: 0,
      activeCalls: 0,
      activeReservations: {},
      tokensObserved: 0,
      globalStop: null,
      workers: {},
      events: []
    });
    ledger.schemaVersion ||= 'claw.creative_worker_budget_ledger.v1';
    ledger.workers ||= {};
    ledger.events ||= [];
    ledger.activeReservations ||= {};
    const result = mutator(ledger) || {};
    ledger.updatedAt = new Date().toISOString();
    if (ledger.events.length > 500) ledger.events = ledger.events.slice(-500);
    fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    return result;
  } finally {
    fs.closeSync(lockFd);
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

function summarizeCortexPacket(packet) {
  if (!packet || typeof packet !== 'object') return 'No Cortex context packet loaded.';
  const lines = [
    `Cortex packet schema: ${packet.schemaVersion || 'unknown'}`,
    `Cortex route: ${packet.cortexRoute || packet.route || 'context_governor'}`,
    `Surface: ${packet.surface?.id || packet.surfaceId || 'unknown'} — ${packet.surface?.label || ''}`.trim(),
    `Intent: ${packet.intent || packet.goal || packet.surface?.goal || 'scoped product improvement'}`,
    `Budget policy: ${JSON.stringify(packet.budgetPolicy || packet.budget || {})}`,
    'Cortex instructions:',
    ...((packet.instructions || packet.guardrails || []).slice(0, 12).map((entry) => `- ${entry}`)),
    'Relevant files:',
    ...((packet.files || packet.relevantFiles || []).slice(0, 12).map((entry) => {
      if (typeof entry === 'string') return `- ${entry}`;
      return `- ${entry.path || entry.rel || 'unknown'}${entry.exists === false ? ' (missing)' : ''}`;
    })),
    'Runnable checks:',
    ...((packet.runnableChecks || []).slice(0, 8).map((entry) => `- ${entry.command || entry}`))
  ];
  return lines.filter(Boolean).join('\n');
}

function extractFileSignals(workspaceRoot, rel, maxSignals = 14) {
  const text = readFileSnippet(workspaceRoot, rel, 48 * 1024);
  if (text === null) return { path: rel, exists: false, signals: [] };
  const signals = [];
  const patterns = [
    /^\s*import\s+.+from\s+['"][^'"]+['"];?/,
    /^\s*export\s+(?:async\s+)?(?:function|const|class)\s+[A-Za-z0-9_$]+/,
    /^\s*(?:async\s+)?function\s+[A-Za-z0-9_$]+/,
    /^\s*(?:router|app)\.(?:get|post|put|patch|delete)\s*\(/,
    /^\s*(?:case\s+['"][^'"]+['"]|if\s*\(|const\s+[A-Za-z0-9_$]+\s*=\s*(?:z\.|Object\.freeze|\[|\{))/
  ];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 220) continue;
    if (patterns.some((pattern) => pattern.test(line))) signals.push(trimmed);
    if (signals.length >= maxSignals) break;
  }
  return { path: rel, exists: true, signals };
}

function compactJson(value, maxChars = 1800) {
  if (value == null) return '';
  return trimMiddle(JSON.stringify(value, null, 2), maxChars);
}

function buildCompactSurfaceBrief({ iteration, elapsedMs, changedSoFar = [], repairSummary = '', externalVerifications = [] } = {}) {
  const commands = externalVerificationCommands();
  const bundle = task.bundle || cortexPacket?.surface?.bundle || null;
  const bundleEnabled = bundle?.enabled === true;
  const packetFiles = stableOrdered([
    ...productFiles,
    ...allowedFiles,
    ...((cortexPacket?.files || cortexPacket?.relevantFiles || []).map((entry) => typeof entry === 'string' ? entry : entry?.path || entry?.rel).filter(Boolean))
  ]).slice(0, 8);
  const fileSignals = packetFiles.map((rel) => extractFileSignals(workspace, rel));
  const failedExternal = effectiveExternalVerificationFailures(externalVerifications);
  const brief = [
    `Surface: ${surfaceId}`,
    `Goal: ${task.goal || task.title || cortexPacket?.surface?.goal || cortexPacket?.intent || 'Improve assigned product surface.'}`,
    `Iteration: ${iteration}; elapsedMs=${elapsedMs}; promptMode=compact`,
    bundleEnabled ? `Bundled product-slice mode: source surfaces=${(bundle.sourceSurfaceIds || []).join(', ')}; minimum product targets to modify=${bundle.minProductTargetsToModify || 1}` : '',
    bundleEnabled && Array.isArray(bundle.sourceSurfaces) && bundle.sourceSurfaces.length ? `Bundled source objectives:\n${bundle.sourceSurfaces.slice(0, 8).map((surface, index) => `- ${index + 1}. ${surface.id || 'surface'}: ${surface.productGoal || surface.label || ''}`).join('\n')}` : '',
    `Product targets: ${productFiles.join(', ')}`,
    `Allowed files: ${allowedFiles.join(', ')}`,
    commands.length ? `External verifier/test commands (wrapper/harness owns these; do not run them inside Codex):\n${commands.map((command) => `- ${command}`).join('\n')}` : 'External verifier/test commands: none provided.',
    repairSummary ? `Repair signal from previous wrapper/verifier result:\n${trimMiddle(repairSummary, 2600)}` : '',
    failedExternal.length ? `Latest external verifier failures:\n${failedExternal.map((result) => `- ${result.command}: exit ${result.exitCode}; ${trimMiddle(result.stderr || result.stdout || '', 600)}`).join('\n')}` : '',
    'Cortex packet essentials:',
    compactJson({
      route: cortexPacket?.cortexRoute || cortexPacket?.route || null,
      intent: cortexPacket?.intent || null,
      instructions: (cortexPacket?.instructions || cortexPacket?.guardrails || []).slice(0, 8),
      budgetPolicy: cortexPacket?.budgetPolicy || cortexPacket?.budget || null,
      verifierCatalog: cortexPacket?.verifierCatalog || null
    }, 1200),
    'File signals (imports/exports/routes/functions only; inspect assigned files directly if needed):',
    fileSignals.map((entry) => `### ${entry.path}${entry.exists ? '' : ' (missing)'}\n${entry.signals.length ? entry.signals.map((line) => `- ${line}`).join('\n') : '- no compact signals extracted'}`).join('\n\n'),
    changedSoFar.length ? `Changed allowed files so far:\n${changedSoFar.map((rel) => `- ${rel}`).join('\n')}` : 'Changed allowed files so far: none.',
    'Required product delta:',
    bundleEnabled
      ? `- Modify at least ${Math.max(1, Number(bundle.minProductTargetsToModify || 1))} product target file(s) with one coherent behavior/data-contract slice across the bundle.`
      : '- Modify at least one product target with real surface-specific behavior, validation, route/domain logic, state shaping, or user-visible data contract.',
    '- No docs-only/tests-only/comment-only/marker-only/generic shim changes.',
    '- Keep scope tight; use assigned files and direct imports rather than broad repository exploration.'
  ].filter(Boolean).join('\n\n');
  return trimMiddle(brief, compactBriefMaxChars);
}

function addedLinesBetween(before = '', after = '') {
  const beforeCounts = new Map();
  for (const line of String(before || '').split(/\r?\n/)) beforeCounts.set(line, (beforeCounts.get(line) || 0) + 1);
  const added = [];
  for (const line of String(after || '').split(/\r?\n/)) {
    const remaining = beforeCounts.get(line) || 0;
    if (remaining > 0) beforeCounts.set(line, remaining - 1);
    else added.push(line);
  }
  return added;
}

function analyzeCreativeDelta(changed = []) {
  const addedLines = [];
  for (const rel of changed) {
    const beforeContent = before.get(rel) || '';
    const afterContent = fs.existsSync(path.join(workspace, rel)) ? fs.readFileSync(path.join(workspace, rel), 'utf8') : '';
    addedLines.push(...addedLinesBetween(beforeContent, afterContent));
  }
  const meaningfulAdded = addedLines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*') && !line.startsWith('<!--'));
  const uniqueNormalized = new Set(meaningfulAdded.map((line) => line.replace(/\s+/g, ' ')));
  const addedText = addedLines.join('\n');
  const genericShimPattern = /semanticProductArchitecture(?:Runtime|FixtureState|FixtureRouter|ExistingProductArgs|IntegratedCall|NormalFlow)_|__semanticProductArchitectureNormalFlowProofs|in_memory_semantic_benchmark/.test(addedText);
  return {
    addedLineCount: addedLines.length,
    meaningfulAddedLineCount: meaningfulAdded.length,
    uniqueMeaningfulAddedLineCount: uniqueNormalized.size,
    duplicateMeaningfulAddedRatio: meaningfulAdded.length > 0 ? Number(((meaningfulAdded.length - uniqueNormalized.size) / meaningfulAdded.length).toFixed(4)) : 0,
    genericShimPattern,
    weakOrGeneric: genericShimPattern || meaningfulAdded.length < 2
  };
}

function summarizeVerificationFailures(verifications = []) {
  const failures = effectiveExternalVerificationFailures(verifications);
  if (!failures.length) return '';
  return failures.map((result) => [
    `Command: ${result.command}`,
    `Iteration: ${result.iteration || 'unknown'}`,
    `Exit: ${result.exitCode}`,
    result.stdout ? `stdout: ${summarizeCommandOutput(result.stdout, 1200)}` : '',
    result.stderr ? `stderr: ${summarizeCommandOutput(result.stderr, 1200)}` : ''
  ].filter(Boolean).join('\n')).join('\n\n');
}

function runExternalVerification(iteration) {
  const commands = externalVerificationCommands().slice(0, externalVerificationMaxCommands);
  if (!externalVerificationEnabled || !commands.length) return { iteration, enabled: externalVerificationEnabled, results: [] };
  const results = [];
  for (const command of commands) {
    const startedAtMs = Date.now();
    const spawned = spawnSync('/bin/bash', ['-c', command], {
      cwd: workspace,
      encoding: 'utf8',
      timeout: externalVerificationTimeoutMs,
      stdio: 'pipe'
    });
    results.push({
      command,
      ok: !spawned.error && spawned.status === 0,
      exitCode: spawned.status ?? (spawned.error ? 1 : 0),
      signal: spawned.signal || null,
      error: spawned.error?.message || null,
      durationMs: Date.now() - startedAtMs,
      stdout: summarizeCommandOutput(spawned.stdout || '', 3000),
      stderr: summarizeCommandOutput([spawned.stderr, spawned.error?.message].filter(Boolean).join('\n'), 3000)
    });
    if (results.at(-1).ok === false) break;
  }
  return { iteration, enabled: true, results };
}

const taskPath = process.env.CREATIVE_WORKER_TASK_PATH;
const evidencePath = process.env.CREATIVE_WORKER_EVIDENCE_PATH;
const workspace = path.resolve(process.env.CREATIVE_WORKER_WORKSPACE || process.cwd());
const surfaceId = process.env.CREATIVE_WORKER_SURFACE_ID || 'surface';
const agentId = process.env.CREATIVE_WORKER_AGENT_ID || null;
const allowedFiles = parseList(process.env.CREATIVE_WORKER_ALLOWED_FILES);
const minIterations = Math.max(1, Number(process.env.CREATIVE_WORKER_MIN_ITERATIONS || 3));
const minRuntimeMs = Math.max(0, Number(process.env.CREATIVE_WORKER_MIN_RUNTIME_MS || 0));
const baseIterationTimeoutMs = clamp(process.env.CODEX_CREATIVE_ITERATION_TIMEOUT_MS || 420000, 30000, 1800000);
const codexBin = process.env.CODEX_BIN || 'codex';
const codexModel = process.env.CODEX_CREATIVE_MODEL || process.env.CODEX_MODEL || 'gpt-5.5';
const codexSandbox = process.env.CODEX_CREATIVE_SANDBOX || 'workspace-write';
const maxIterations = Math.max(minIterations, Number(process.env.CODEX_CREATIVE_MAX_ITERATIONS || Math.max(minIterations, 12)));

if (!taskPath || !evidencePath) {
  console.error('codex_creative_worker_missing_required_env');
  process.exit(2);
}

const task = readJson(taskPath, {});
const productFiles = allowedFiles.filter((rel) => /^(apps|packages)\//.test(rel) && !/(^|\/)tests?\//i.test(rel));
const startedAt = Date.now();
const startedIso = new Date(startedAt).toISOString();
const runDir = path.dirname(evidencePath);
const cortexPacketPath = process.env.CREATIVE_WORKER_CORTEX_PACKET_PATH || process.env.CORTEX_CONTEXT_PACKET_PATH || task.cortexContextPacketPath || '';
const cortexRequired = parseBool(process.env.CREATIVE_WORKER_CORTEX_REQUIRED || process.env.CORTEX_REQUIRED, false);
const cortexPacket = cortexPacketPath ? readJson(cortexPacketPath, null) : null;
const budgetLedgerPath = process.env.CREATIVE_WORKER_BUDGET_LEDGER_PATH || task.budgetLedgerPath || '';
const budgetRequired = parseBool(process.env.CREATIVE_WORKER_BUDGET_REQUIRED, false);
const globalCallLimit = positiveInt(process.env.CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT, 0);
const globalTokenLimit = positiveInt(process.env.CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT, 0);
const baseTokenReservationEstimate = positiveInt(process.env.CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE, 0);
const perWorkerCallLimit = positiveInt(process.env.CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT, 0);
const maxActiveCodexCalls = positiveInt(process.env.CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS, 0);
const activeCodexCallSchedule = parseActiveCodexCallSchedule(process.env.CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE || '');
const budgetReservationTimeoutMs = positiveInt(process.env.CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS, 30 * 60 * 1000);
const budgetReservationPollMs = positiveInt(process.env.CREATIVE_WORKER_BUDGET_RESERVATION_POLL_MS, 1000);
const activeReservationTtlMs = positiveInt(process.env.CREATIVE_WORKER_ACTIVE_RESERVATION_TTL_MS, Math.max(30 * 60 * 1000, budgetReservationTimeoutMs + 60_000));
const contextSnippetMaxChars = positiveInt(process.env.CREATIVE_WORKER_CONTEXT_FILE_MAX_CHARS, 9000);
const contextTotalMaxChars = positiveInt(process.env.CREATIVE_WORKER_CONTEXT_TOTAL_MAX_CHARS, 32000);
const promptMode = normalizePromptMode(process.env.CREATIVE_WORKER_PROMPT_MODE || process.env.CODEX_CREATIVE_PROMPT_MODE || task.promptMode || 'full_context');
const compactBriefMaxChars = positiveInt(process.env.CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS || task.compactBriefMaxChars, 12000);
const externalVerificationEnabled = parseBool(process.env.CREATIVE_WORKER_EXTERNAL_VERIFICATION, promptMode === 'compact');
const externalVerificationTimeoutMs = positiveInt(process.env.CREATIVE_WORKER_EXTERNAL_VERIFICATION_TIMEOUT_MS, 90_000);
const externalVerificationMaxCommands = positiveInt(process.env.CREATIVE_WORKER_EXTERNAL_VERIFICATION_MAX_COMMANDS, 3);
const targetedExternalVerificationOnly = parseBool(process.env.CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY, false);
const codexShouldRunTests = parseBool(process.env.CREATIVE_WORKER_CODEX_RUN_TESTS, promptMode !== 'compact');
const requireRepairSignalForRetry = parseBool(process.env.CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY, promptMode === 'compact');
const stopOnExternalVerificationFailure = parseBool(process.env.CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE, false);
const compactFailClosedFallback = parseBool(process.env.CREATIVE_WORKER_COMPACT_FAIL_CLOSED, promptMode === 'compact');
const maxObservedTokensPerMinute = positiveInt(process.env.CREATIVE_WORKER_MAX_OBSERVED_TOKENS_PER_MINUTE, 0);
const burnRateWindowMs = positiveInt(process.env.CREATIVE_WORKER_BURN_RATE_WINDOW_MS, 10 * 60 * 1000);
const repairSummaryPath = process.env.CREATIVE_WORKER_REPAIR_SUMMARY_PATH || '';
const initialRepairSummary = process.env.CREATIVE_WORKER_REPAIR_SUMMARY || (repairSummaryPath ? readFilePrefix(repairSummaryPath, 8000) : '');
const inheritedBundleRuntimePlan = parseJsonEnv(process.env.CREATIVE_WORKER_BUNDLE_RUNTIME_PLAN, null);
const computedBundleRuntimePlan = planCreativeBundleRuntime({
  bundle: task.bundle || cortexPacket?.surface?.bundle || {},
  baseIterationTimeoutMs,
  baseTokenReservationEstimate,
  maxComplexityFactor: positiveInt(process.env.CREATIVE_WORKER_BUNDLE_MAX_COMPLEXITY_FACTOR, 4),
  maxIterationTimeoutMs: positiveInt(process.env.CREATIVE_WORKER_BUNDLE_MAX_ITERATION_TIMEOUT_MS, 1_800_000),
  maxTokenReservationEstimate: positiveInt(process.env.CREATIVE_WORKER_BUNDLE_MAX_TOKEN_RESERVATION_ESTIMATE, 0)
});
const bundleRuntimePlan = inheritedBundleRuntimePlan?.enabled === true
  ? {
      ...computedBundleRuntimePlan,
      ...inheritedBundleRuntimePlan,
      inheritedFromParentWorker: true
    }
  : computedBundleRuntimePlan;
const iterationTimeoutMs = Math.max(30_000, Number(bundleRuntimePlan.iterationTimeoutMs || computedBundleRuntimePlan.iterationTimeoutMs || baseIterationTimeoutMs));
const tokenReservationEstimate = Math.max(0, Number(bundleRuntimePlan.tokenReservationEstimate || computedBundleRuntimePlan.tokenReservationEstimate || baseTokenReservationEstimate));

if (cortexRequired && !cortexPacket) {
  writeJson(evidencePath, {
    ok: false,
    summary: 'Creative worker refused to run raw Codex because Cortex context is required but no Cortex context packet was available.',
    surfaceId,
    agentId,
    iterations: [],
    productDecisions: [],
    filesChanged: [],
    testsRun: [],
    risks: ['cortex_context_required_missing'],
    failureReason: 'cortex_context_required_missing',
    cortex: { required: true, packetPath: cortexPacketPath || null, packetPresent: false }
  });
  process.exit(2);
}

if (budgetRequired && !budgetLedgerPath) {
  writeJson(evidencePath, {
    ok: false,
    summary: 'Creative worker refused to run because a shared budget ledger is required but not configured.',
    surfaceId,
    agentId,
    iterations: [],
    productDecisions: [],
    filesChanged: [],
    testsRun: [],
    risks: ['creative_budget_ledger_required_missing'],
    failureReason: 'creative_budget_ledger_required_missing',
    cortex: { required: cortexRequired, packetPath: cortexPacketPath || null, packetPresent: Boolean(cortexPacket) }
  });
  process.exit(2);
}
if (budgetRequired && activeCodexCallSchedule.raw && !activeCodexCallSchedule.valid) {
  writeJson(evidencePath, {
    ok: false,
    summary: 'Creative worker refused to run because CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE is invalid.',
    surfaceId,
    agentId,
    iterations: [],
    productDecisions: [],
    filesChanged: [],
    testsRun: [],
    risks: ['creative_active_codex_call_schedule_invalid'],
    failureReason: 'creative_active_codex_call_schedule_invalid',
    budget: { activeCodexCallSchedule: activeCodexCallSchedule.raw },
    cortex: { required: cortexRequired, packetPath: cortexPacketPath || null, packetPresent: Boolean(cortexPacket) }
  });
  process.exit(2);
}
if (!allowedFiles.length || !productFiles.length) {
  writeJson(evidencePath, {
    ok: false,
    summary: 'Codex creative worker did not run because no writable product files were assigned.',
    iterations: [],
    productDecisions: [],
    filesChanged: [],
    testsRun: [],
    risks: ['missing allowed product files'],
    failureReason: 'missing_allowed_product_files'
  });
  process.exit(2);
}

const before = fileSnapshot(workspace, allowedFiles);
const iterations = [];
let lastExitCode = 0;
let lastSignal = null;
let lastError = null;
let budgetStopReason = null;
const budgetEvents = [];

function buildAssignedFileContext() {
  const sections = [];
  let used = 0;
  for (const rel of stableOrdered([...productFiles, ...allowedFiles])) {
    if (used >= contextTotalMaxChars) break;
    const snippet = readFileSnippet(workspace, rel, Math.min(contextSnippetMaxChars, contextTotalMaxChars - used));
    if (snippet === null) {
      sections.push(`### ${rel}\n[MISSING IN WORKER WORKSPACE]`);
      continue;
    }
    used += snippet.length;
    sections.push(`### ${rel}\n\`\`\`\n${snippet}\n\`\`\``);
  }
  return sections.join('\n\n');
}

function stableOrdered(list) {
  const out = [];
  for (const entry of list || []) {
    const value = String(entry || '').trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function reserveBudget(iteration) {
  if (!budgetLedgerPath) return { ok: true, active: false, reservationId: null };
  const workerKey = agentId || surfaceId || 'unknown-worker';
  const deadline = Date.now() + budgetReservationTimeoutMs;
  while (true) {
    const outcome = mutateBudgetLedger(budgetLedgerPath, (ledger) => {
      const nowMs = Date.now();
      ledger.activeReservations ||= {};
      for (const [reservationId, reservation] of Object.entries(ledger.activeReservations)) {
        const startedAtMs = Number(reservation?.startedAtMs || 0);
        if (!startedAtMs || (nowMs - startedAtMs) > activeReservationTtlMs) {
          delete ledger.activeReservations[reservationId];
          ledger.events.push({ at: new Date().toISOString(), type: 'codex_call_reservation_reaped', reservationId, ageMs: startedAtMs ? nowMs - startedAtMs : null });
        }
      }
      ledger.activeCalls = Object.keys(ledger.activeReservations).length;
      if (ledger.globalStop) return { ok: false, reason: ledger.globalStop.reason || 'creative_budget_global_stop', globalStop: ledger.globalStop };
      ledger.workers[workerKey] ||= { callsStarted: 0, callsCompleted: 0, tokensObserved: 0 };
      const worker = ledger.workers[workerKey];
      if (maxObservedTokensPerMinute) {
        const burnRate = computeRecentBurnRate(ledger, nowMs, burnRateWindowMs);
        ledger.burnRateGovernor ||= {};
        ledger.burnRateGovernor.latest = { ...burnRate, limitTokensPerMinute: maxObservedTokensPerMinute, checkedAt: new Date().toISOString() };
        if (burnRate.tokensPerMinute > maxObservedTokensPerMinute) {
          return { ok: false, wait: true, reason: 'creative_burn_rate_limit_wait', burnRate, limit: maxObservedTokensPerMinute };
        }
      }
      const effectiveMaxActiveCodexCalls = effectiveActiveCodexCallLimit(ledger, maxActiveCodexCalls, activeCodexCallSchedule);
      if (activeCodexCallSchedule.raw) {
        ledger.activeCodexCallSchedule = {
          raw: activeCodexCallSchedule.raw,
          entries: activeCodexCallSchedule.entries,
          defaultLimit: activeCodexCallSchedule.defaultLimit,
          fallbackLimit: maxActiveCodexCalls || null,
          effectiveLimit: effectiveMaxActiveCodexCalls || null,
          callsCompleted: Number(ledger.callsCompleted || 0),
          updatedAt: new Date().toISOString()
        };
      }
      if (effectiveMaxActiveCodexCalls && Number(ledger.activeCalls || 0) >= effectiveMaxActiveCodexCalls) {
        return { ok: false, wait: true, reason: 'creative_active_codex_call_limit_wait', activeCalls: ledger.activeCalls, limit: effectiveMaxActiveCodexCalls, activeCodexCallSchedule: ledger.activeCodexCallSchedule || null };
      }
      if (globalCallLimit && Number(ledger.callsStarted || 0) >= globalCallLimit) {
        ledger.globalStop = { reason: 'creative_global_call_limit_reached', limit: globalCallLimit, at: new Date().toISOString() };
        return { ok: false, reason: 'creative_global_call_limit_reached', globalStop: ledger.globalStop };
      }
      if (globalTokenLimit && Number(ledger.tokensObserved || 0) >= globalTokenLimit) {
        ledger.globalStop = { reason: 'creative_global_token_limit_reached', limit: globalTokenLimit, tokensObserved: ledger.tokensObserved, at: new Date().toISOString() };
        return { ok: false, reason: 'creative_global_token_limit_reached', globalStop: ledger.globalStop };
      }
      if (globalTokenLimit && tokenReservationEstimate) {
        const projectedReservedTokens = Number(ledger.tokensObserved || 0) + ((Number(ledger.activeCalls || 0) + 1) * tokenReservationEstimate);
        if (projectedReservedTokens > globalTokenLimit) {
          ledger.globalStop = { reason: 'creative_global_reserved_token_limit_reached', limit: globalTokenLimit, tokensObserved: ledger.tokensObserved, activeCalls: ledger.activeCalls, tokenReservationEstimate, projectedReservedTokens, at: new Date().toISOString() };
          return { ok: false, reason: 'creative_global_reserved_token_limit_reached', globalStop: ledger.globalStop };
        }
      }
      if (perWorkerCallLimit && Number(worker.callsStarted || 0) >= perWorkerCallLimit) {
        return { ok: false, reason: 'creative_per_worker_call_limit_reached', limit: perWorkerCallLimit };
      }
      const reservationId = `${workerKey}:${surfaceId}:iteration-${iteration}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      ledger.activeReservations[reservationId] = { workerKey, surfaceId, iteration, startedAt: new Date().toISOString(), startedAtMs: nowMs };
      ledger.activeCalls = Object.keys(ledger.activeReservations).length;
      ledger.callsStarted = Number(ledger.callsStarted || 0) + 1;
      worker.callsStarted = Number(worker.callsStarted || 0) + 1;
      ledger.events.push({ at: new Date().toISOString(), type: 'codex_call_reserved', reservationId, workerKey, surfaceId, iteration, callsStarted: ledger.callsStarted, callsCompleted: ledger.callsCompleted || 0, activeCalls: ledger.activeCalls, maxActiveCodexCalls: maxActiveCodexCalls || null, effectiveMaxActiveCodexCalls: effectiveMaxActiveCodexCalls || null, activeCodexCallSchedule: activeCodexCallSchedule.raw || null, tokenReservationEstimate: tokenReservationEstimate || null });
      return { ok: true, active: true, reservationId, waitedMs: budgetReservationTimeoutMs - Math.max(0, deadline - Date.now()) };
    });
    if (outcome.ok || !outcome.wait) return outcome;
    if (Date.now() >= deadline) return { ok: false, reason: outcome.reason === 'creative_burn_rate_limit_wait' ? 'creative_burn_rate_limit_timeout' : 'creative_active_codex_call_limit_timeout', activeCalls: outcome.activeCalls, burnRate: outcome.burnRate || null, limit: outcome.limit };
    budgetEvents.push({ iteration, type: outcome.reason || 'budget_wait_for_active_codex_slot', activeCalls: outcome.activeCalls, burnRate: outcome.burnRate || null, limit: outcome.limit });
    sleepMs(Math.min(budgetReservationPollMs, Math.max(1, deadline - Date.now())));
  }
}

function completeBudget(reservation, iteration, logPath, exitCode) {
  if (!budgetLedgerPath || !reservation?.active) return null;
  const usage = parseCodexTokenUsage(logPath);
  const workerKey = agentId || surfaceId || 'unknown-worker';
  const result = mutateBudgetLedger(budgetLedgerPath, (ledger) => {
    ledger.activeReservations ||= {};
    if (reservation.reservationId && ledger.activeReservations[reservation.reservationId]) delete ledger.activeReservations[reservation.reservationId];
    ledger.activeCalls = Object.keys(ledger.activeReservations).length;
    ledger.workers[workerKey] ||= { callsStarted: 0, callsCompleted: 0, tokensObserved: 0 };
    const worker = ledger.workers[workerKey];
    ledger.callsCompleted = Number(ledger.callsCompleted || 0) + 1;
    worker.callsCompleted = Number(worker.callsCompleted || 0) + 1;
    ledger.tokensObserved = Number(ledger.tokensObserved || 0) + usage.total;
    worker.tokensObserved = Number(worker.tokensObserved || 0) + usage.total;
    const event = { at: new Date().toISOString(), type: 'codex_call_completed', reservationId: reservation.reservationId, workerKey, surfaceId, iteration, exitCode, tokensObserved: usage.total, tokenValues: usage.values, usageLimit: usage.usageLimit, activeCalls: ledger.activeCalls };
    ledger.events.push(event);
    if (usage.usageLimit) ledger.globalStop = { reason: 'codex_usage_limit_observed', at: new Date().toISOString(), reservationId: reservation.reservationId, surfaceId };
    else if (globalTokenLimit && Number(ledger.tokensObserved || 0) >= globalTokenLimit) ledger.globalStop = { reason: 'creative_global_token_limit_reached', limit: globalTokenLimit, tokensObserved: ledger.tokensObserved, at: new Date().toISOString() };
    return { usage, globalStop: ledger.globalStop || null };
  });
  budgetEvents.push({ iteration, reservationId: reservation.reservationId, usage: result.usage, globalStop: result.globalStop });
  return result;
}

function buildPrompt({ iteration, elapsedMs, changedSoFar, mode = promptMode, repairSummary = '', externalVerifications = [] }) {
  const bundle = task.bundle || cortexPacket?.surface?.bundle || null;
  const bundleEnabled = bundle?.enabled === true;
  const phase = iteration === 1
    ? 'inspect the assigned surface and make a concrete product-code improvement'
    : 'repair or harden the already-touched product code based on the real repair signal; do not merely repeat prior changes';
  const verifierInstruction = codexShouldRunTests
    ? 'Run relevant targeted tests from the acceptance checks when feasible.'
    : 'Do not run verifier/test commands inside Codex; the wrapper/orchestrator owns verification outside Codex. If a sanity check is absolutely required, keep it to one narrow non-test command directly tied to the edited file.';
  if (mode === 'compact') {
    const compactBrief = buildCompactSurfaceBrief({ iteration, elapsedMs, changedSoFar, repairSummary, externalVerifications });
    return `You are a Codex CLI implementation worker in a 100-agent Mailchimp product benchmark.

Use the compact surface brief below. Make one concrete, surface-specific product-code improvement. Token discipline matters: inspect only the assigned product target first, avoid repo-wide search, do not run tests, and do not browse broadly unless the brief is clearly stale.

${compactBrief}

Rules:
- ${phase}.
- Modify at least one assigned product source file under apps/ or packages/.
- Do not add benchmark-only generic semanticProductArchitecture shims.
- Do not make docs-only, tests-only, marker-only, or comment-only changes.
- Keep changes small enough to survive targeted external verification.
- ${verifierInstruction}
- At the end, summarize product behavior changed, design decision, files changed, and remaining risks in a few bullets only.
- The wrapper writes final evidence; do not waste time creating artifact spam.`;
  }
  const cortexSection = summarizeCortexPacket(cortexPacket);
  const fileContext = buildAssignedFileContext();
  return `You are one worker in a 100-agent Mailchimp product benchmark.

Task JSON path: ${taskPath}
Evidence JSON path you may update: ${evidencePath}
Workspace: ${workspace}
Surface id: ${surfaceId}
Agent id: ${agentId || 'unknown'}
Iteration: ${iteration}
Elapsed creative worker ms so far: ${elapsedMs}
Minimum iterations required: ${minIterations}
Minimum creative runtime ms required: ${minRuntimeMs}

Goal/title:
${task.goal || task.title || 'Improve the assigned Mailchimp product surface.'}

Allowed files only:
${allowedFiles.map((rel) => `- ${rel}`).join('\n')}

Product files that must receive any credited code delta:
${productFiles.map((rel) => `- ${rel}`).join('\n')}

${bundleEnabled ? `Bundled product-slice requirement:
- Source surfaces: ${(bundle.sourceSurfaceIds || []).join(', ')}
- Modify at least ${Math.max(1, Number(bundle.minProductTargetsToModify || 1))} product target file(s).
- Make the edits read as one coherent product behavior/data-contract slice, not unrelated tiny changes.
${Array.isArray(bundle.sourceSurfaces) && bundle.sourceSurfaces.length ? `- Source objectives:\n${bundle.sourceSurfaces.slice(0, 8).map((surface, index) => `  ${index + 1}. ${surface.id || 'surface'}: ${surface.productGoal || surface.label || ''}`).join('\n')}` : ''}` : ''}

Acceptance checks from harness:
${(task.acceptanceChecks || []).map((entry) => `- ${normalizeCommandEntry(entry) || entry}`).join('\n') || '- No extra acceptance checks provided.'}

Cortex context packet / route:
${cortexSection}

Bounded assigned-file context, prepacked by the Cortex governor:
${fileContext || '[No file context available; rely only on assigned files and targeted commands.]'}

Current changed allowed files so far:
${changedSoFar.length ? changedSoFar.map((rel) => `- ${rel}`).join('\n') : '- none yet'}

${repairSummary ? `Repair signal from previous external verification/quality gate:\n${trimMiddle(repairSummary, 5000)}\n` : ''}

Rules:
- ${phase}.
- ${bundleEnabled ? `Modify at least ${Math.max(1, Number(bundle.minProductTargetsToModify || 1))} assigned product source file(s) under apps/ or packages/.` : 'Modify at least one assigned product source file under apps/ or packages/.'}
- Do not add benchmark-only generic semanticProductArchitecture shims.
- Do not make docs-only, tests-only, marker-only, or comment-only changes.
- Keep changes small enough to survive the targeted tests.
- Prefer real product behavior, validation, state shaping, route/domain logic, or user-visible data contracts for this specific surface.
- Treat the Cortex context packet as the planning/context authority; do not perform broad repo exploration unless a targeted check proves the packet is stale.
- Use the bounded file context above first; if more context is needed, inspect only assigned or directly imported files.
- ${verifierInstruction}
- Update ${evidencePath} as JSON if useful, but the wrapper will also write final evidence.

At the end of this iteration, summarize: product behavior changed, design decision, files changed, commands/tests run, and remaining risks.`;
}

const externalVerifications = [];
const promptAudit = [];
let activePromptMode = promptMode;
let compactFallbackUsed = false;
let repairSummary = initialRepairSummary;

for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
  const elapsedMs = Date.now() - startedAt;
  const changedSoFar = changedFiles(workspace, before, allowedFiles);
  if (iteration > minIterations && elapsedMs >= minRuntimeMs && changedSoFar.some((rel) => productFiles.includes(rel))) {
    const delta = analyzeCreativeDelta(changedSoFar);
    const verifierFailures = summarizeVerificationFailures(externalVerifications);
    if (!delta.weakOrGeneric && !verifierFailures) break;
    if (requireRepairSignalForRetry && !verifierFailures && !delta.weakOrGeneric) break;
  }

  const promptPath = path.join(runDir, `${surfaceId}__codex-prompt-${iteration}.txt`);
  const lastMessagePath = path.join(runDir, `${surfaceId}__codex-last-message-${iteration}.txt`);
  const logPath = path.join(runDir, `${surfaceId}__codex-iteration-${iteration}.log`);
  const budgetReservation = reserveBudget(iteration);
  if (!budgetReservation.ok) {
    budgetStopReason = budgetReservation.reason || 'creative_budget_stop';
    budgetEvents.push({ iteration, type: 'budget_stop_before_codex', reason: budgetStopReason, globalStop: budgetReservation.globalStop || null });
    break;
  }
  const promptText = buildPrompt({ iteration, elapsedMs, changedSoFar, mode: activePromptMode, repairSummary, externalVerifications });
  fs.writeFileSync(promptPath, promptText);
  promptAudit.push({ iteration, ...promptMetrics(promptText, activePromptMode) });
  const args = [
    'exec',
    '--cd', workspace,
    '--skip-git-repo-check',
    '--sandbox', codexSandbox,
    '--color', 'never',
    '--model', codexModel,
    '--output-last-message', lastMessagePath,
    fs.readFileSync(promptPath, 'utf8')
  ];
  const iterStartedAt = Date.now();
  fs.writeFileSync(logPath, [
    `$ ${shellCommandForDisplay(codexBin, args.slice(0, -1))} <prompt>`,
    `startedAt=${new Date(iterStartedAt).toISOString()}`,
    `stdoutStderr=streamed_to_this_file`,
    '--- codex output ---',
    ''
  ].join('\n'));
  const logFd = fs.openSync(logPath, 'a');
  let spawned;
  try {
    spawned = spawnSync(codexBin, args, {
      cwd: workspace,
      timeout: iterationTimeoutMs,
      stdio: ['ignore', logFd, logFd]
    });
  } finally {
    fs.closeSync(logFd);
  }
  const iterFinishedAt = Date.now();
  lastExitCode = spawned.status ?? (spawned.error ? 1 : 0);
  lastSignal = spawned.signal || null;
  lastError = spawned.error ? spawned.error.message : null;
  fs.appendFileSync(logPath, [
    '',
    '--- wrapper footer ---',
    `finishedAt=${new Date(iterFinishedAt).toISOString()}`,
    `exitCode=${lastExitCode}`,
    `signal=${lastSignal || ''}`,
    `error=${lastError || ''}`,
    ''
  ].join('\n'));
  const budgetCompletion = completeBudget(budgetReservation, iteration, logPath, lastExitCode);
  iterations.push({
    step: `codex_iteration_${iteration}`,
    startedAt: new Date(iterStartedAt).toISOString(),
    finishedAt: new Date(iterFinishedAt).toISOString(),
    durationMs: iterFinishedAt - iterStartedAt,
    exitCode: lastExitCode,
    signal: lastSignal,
    error: lastError,
    promptMode: activePromptMode,
    promptMetrics: promptAudit.at(-1) || null,
    promptPath,
    logPath,
    lastMessagePath: fs.existsSync(lastMessagePath) ? lastMessagePath : null,
    changedAllowedFilesAfterIteration: changedFiles(workspace, before, allowedFiles),
    tokenUsage: budgetCompletion?.usage || null,
    budgetGlobalStop: budgetCompletion?.globalStop || null
  });

  if (budgetCompletion?.globalStop) {
    budgetStopReason = budgetCompletion.globalStop.reason || 'creative_budget_global_stop';
    break;
  }
  if (spawned.error?.code === 'ETIMEDOUT') break;
  if (lastExitCode !== 0) break;

  const changedAfterIteration = changedFiles(workspace, before, allowedFiles);
  const deltaAfterIteration = analyzeCreativeDelta(changedAfterIteration);
  const verification = runExternalVerification(iteration);
  if (verification.results.length) externalVerifications.push(verification);
  const verifierFailureSummary = summarizeVerificationFailures(externalVerifications);
  const changedProductAfterIteration = changedAfterIteration.filter((rel) => productFiles.includes(rel));
  const needsRepair = changedProductAfterIteration.length === 0 || deltaAfterIteration.weakOrGeneric || Boolean(verifierFailureSummary);
  const repairSignals = [
    changedProductAfterIteration.length === 0 ? 'No assigned product file changed.' : '',
    deltaAfterIteration.genericShimPattern ? 'Generic semantic shim pattern detected.' : '',
    deltaAfterIteration.meaningfulAddedLineCount < 2 ? 'Product delta is too small/comment-only/marker-like.' : '',
    verifierFailureSummary
  ].filter(Boolean);
  repairSummary = repairSignals.join('\n\n');
  if (stopOnExternalVerificationFailure && verifierFailureSummary) {
    budgetStopReason = 'creative_external_verification_failed_stop';
    budgetEvents.push({
      iteration,
      type: 'creative_external_verification_failed_stop',
      reason: budgetStopReason,
      failureSummary: trimMiddle(verifierFailureSummary, 4000)
    });
    break;
  }
  if (needsRepair && activePromptMode === 'compact' && compactFailClosedFallback && !compactFallbackUsed && (changedProductAfterIteration.length === 0 || deltaAfterIteration.weakOrGeneric)) {
    activePromptMode = 'full_context';
    compactFallbackUsed = true;
  }
  if (iteration >= minIterations && (Date.now() - startedAt) >= minRuntimeMs && !needsRepair) break;
  if (iteration >= minIterations && requireRepairSignalForRetry && needsRepair && !repairSummary) break;
}

const finishedAt = Date.now();
const changed = changedFiles(workspace, before, allowedFiles);
const changedProductFiles = changed.filter((rel) => productFiles.includes(rel));
const finalDelta = analyzeCreativeDelta(changed);
const externalVerificationFailures = effectiveExternalVerificationFailures(externalVerifications);
const rawExternalVerificationFailureCount = externalVerifications.flatMap((entry) => (entry.results || []).filter((result) => result.ok === false)).length;
const testsRun = iterations
  .flatMap((entry) => {
    const text = entry.logPath ? readFilePrefix(entry.logPath) : '';
    return Array.from(text.matchAll(/(?:npm test|node --test|node\s+apps\/[^\n\r]+|node\s+tests\/[^\n\r]+)/g)).map((match) => match[0]);
  })
  .concat(externalVerifications.flatMap((entry) => (entry.results || []).map((result) => result.command)))
  .slice(0, 20);
const compactQualityFailed = promptMode === 'compact' && finalDelta.weakOrGeneric;
const ok = lastExitCode === 0 && changedProductFiles.length > 0 && iterations.length >= minIterations && (finishedAt - startedAt) >= minRuntimeMs && externalVerificationFailures.length === 0 && !finalDelta.genericShimPattern && !compactQualityFailed;
const risks = [];
if (lastExitCode !== 0) risks.push(`codex_exit_${lastExitCode}`);
if (lastSignal) risks.push(`codex_signal_${lastSignal}`);
if (lastError) risks.push(lastError);
if (budgetStopReason) risks.push(budgetStopReason);
if (!changedProductFiles.length) risks.push('no_product_file_changed');
if (iterations.length < minIterations) risks.push('too_few_iterations');
if ((finishedAt - startedAt) < minRuntimeMs) risks.push('creative_runtime_below_minimum');
if (externalVerificationFailures.length) risks.push('external_verification_failed');
if (finalDelta.genericShimPattern) risks.push('generic_semantic_shim_detected');
if (compactQualityFailed) risks.push('compact_quality_gate_failed');

writeJson(evidencePath, {
  ok,
  summary: ok
    ? `Codex creative worker completed ${iterations.length} iteration(s) for ${surfaceId} and changed ${changedProductFiles.join(', ')}.`
    : `Codex creative worker did not satisfy benchmark requirements for ${surfaceId}.`,
  surfaceId,
  agentId,
  startedAt: startedIso,
  finishedAt: new Date(finishedAt).toISOString(),
  creativeRuntimeMs: finishedAt - startedAt,
  minRuntimeMs,
  minIterations,
  iterations,
  productDecisions: iterations.map((entry, index) => `Iteration ${index + 1} delegated to Codex CLI for scoped product-work planning/editing/testing.`),
  filesChanged: changed,
  productFilesChanged: changedProductFiles,
  testsRun,
  risks,
  retryable: !(budgetStopReason === 'codex_usage_limit_observed'
    || budgetStopReason === 'creative_global_token_limit_reached'
    || budgetStopReason === 'creative_global_reserved_token_limit_reached'
    || budgetStopReason === 'creative_global_call_limit_reached'
    || budgetStopReason === 'creative_external_verification_failed_stop'
    || risks.includes('generic_semantic_shim_detected')),
  prompt: {
    mode: promptMode,
    finalMode: activePromptMode,
    compactBriefMaxChars,
    compactFailClosedFallback,
    compactFallbackUsed,
    codexShouldRunTests,
    requireRepairSignalForRetry,
    stopOnExternalVerificationFailure,
    audit: promptAudit
  },
  externalVerification: {
    enabled: externalVerificationEnabled,
    timeoutMs: externalVerificationTimeoutMs,
    maxCommands: externalVerificationMaxCommands,
    targetedOnly: targetedExternalVerificationOnly,
    effectiveCommands: externalVerificationCommands().slice(0, externalVerificationMaxCommands),
    runs: externalVerifications,
    failureCount: externalVerificationFailures.length,
    rawFailureCount: rawExternalVerificationFailureCount
  },
  productDelta: finalDelta,
  cortex: {
    required: cortexRequired,
    packetPath: cortexPacketPath || null,
    packetPresent: Boolean(cortexPacket),
    route: cortexPacket?.cortexRoute || cortexPacket?.route || null,
    budgetPolicy: cortexPacket?.budgetPolicy || cortexPacket?.budget || null
  },
  budget: {
    ledgerPath: budgetLedgerPath || null,
    required: budgetRequired,
    globalCallLimit,
    globalTokenLimit,
    baseTokenReservationEstimate,
    tokenReservationEstimate,
    bundleRuntimePlan,
    perWorkerCallLimit,
    maxActiveCodexCalls,
    activeCodexCallSchedule: activeCodexCallSchedule.raw ? {
      raw: activeCodexCallSchedule.raw,
      entries: activeCodexCallSchedule.entries,
      defaultLimit: activeCodexCallSchedule.defaultLimit,
      valid: activeCodexCallSchedule.valid,
      maxLimit: activeCodexCallSchedule.maxLimit
    } : null,
    maxObservedTokensPerMinute,
    burnRateWindowMs,
    reservationTimeoutMs: budgetReservationTimeoutMs,
    activeReservationTtlMs,
    stopReason: budgetStopReason,
    events: budgetEvents
  },
  codex: {
    command: codexBin,
    model: codexModel,
    sandbox: codexSandbox,
    maxIterations,
    baseIterationTimeoutMs,
    iterationTimeoutMs,
    lastExitCode,
    lastSignal,
    lastError
  }
});

process.exit(ok ? 0 : 1);
