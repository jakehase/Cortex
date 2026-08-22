import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acceptPatch, assertCurrentLease, stagePatch } from '../agent-work-runtime/index.mjs';

export const AGENT_WORK_PHASE5_WORKER_ADAPTER_SCHEMA = 'clawd.agent_work.phase5_worker_adapter.v1';
export const AGENT_WORK_PHASE5_CONTEXT_MANIFEST_SCHEMA = 'clawd.agent_work.phase5_context_manifest.v1';
export const AGENT_WORK_PHASE5_WORKER_EVIDENCE_SCHEMA = 'clawd.agent_work.phase5_worker_evidence.v1';
export const AGENT_WORK_PHASE5_PATCH_BUNDLE_SCHEMA = 'clawd.agent_work.phase5_patch_bundle.v1';
export const AGENT_WORK_PHASE5_MERGE_RECEIPT_SCHEMA = 'clawd.agent_work.phase5_merge_receipt.v1';
export const AGENT_WORK_PHASE5_EXECUTION_PACKET_SCHEMA = 'clawd.agent_work.phase5_worker_execution_packet.v1';

const SKIP_DIRS = new Set(['.git', 'node_modules']);

function nowIso() {
  return new Date().toISOString();
}

function clean(value = '') {
  return String(value ?? '').trim();
}

function stableList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value).replace(/\\/g, '/'))
    .filter(Boolean))].sort();
}

function orderedList(values = []) {
  return (Array.isArray(values) ? values : [values])
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => clean(value))
    .filter(Boolean);
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stableValue(value))).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => !['generatedAt', 'startedAt', 'completedAt', 'preparedAt', 'cleanedAt'].includes(key))
    .sort()
    .map((key) => [key, stableValue(value[key])]));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRel(filePath = '') {
  return clean(filePath).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function safeJoin(root, rel) {
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, normalizeRel(rel));
  if (full !== resolvedRoot && !full.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  return full;
}

function fileSha256(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? sha256(fs.readFileSync(filePath)) : null;
}

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? fs.readFileSync(filePath, 'utf8') : null;
}

function walkFiles(root, { prefix = '' } = {}) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, { prefix: rel }));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

function copyPath({ sourceRoot, targetRoot, rel }) {
  const source = safeJoin(sourceRoot, rel);
  const target = safeJoin(targetRoot, rel);
  if (!source || !target || !fs.existsSync(source)) return null;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true, dereference: false, errorOnExist: false });
  return normalizeRel(rel);
}

function pathAllowed(rel, allowedFiles = []) {
  const normalized = normalizeRel(rel);
  const allowed = stableList(allowedFiles);
  if (!allowed.length) return false;
  return allowed.some((entry) => {
    const rule = normalizeRel(entry);
    if (rule === '**/*' || rule === '*') return true;
    if (rule.endsWith('/**')) return normalized === rule.slice(0, -3) || normalized.startsWith(`${rule.slice(0, -3)}/`);
    if (rule.endsWith('/**/*')) return normalized.startsWith(`${rule.slice(0, -5)}/`);
    if (rule.endsWith('/')) return normalized.startsWith(rule);
    return normalized === rule;
  });
}

function snapshotFiles(root, files = null) {
  const rels = files ? stableList(files).filter((rel) => safeJoin(root, rel)) : walkFiles(root);
  const snapshots = {};
  for (const rel of rels) {
    const full = safeJoin(root, rel);
    const text = full ? readTextIfExists(full) : null;
    snapshots[normalizeRel(rel)] = {
      path: normalizeRel(rel),
      exists: text !== null,
      sha256: text === null ? null : sha256(text),
      bytes: text === null ? 0 : Buffer.byteLength(text),
      content: text
    };
  }
  return snapshots;
}

function isWorkerControlArtifact(rel = '') {
  const normalized = normalizeRel(rel);
  return normalized === 'agent_work_context_manifest.json'
    || normalized === 'worker_evidence.json'
    || normalized === 'provider_usage_ledger.json'
    || normalized.startsWith('.agent-work/');
}

function diffSnapshots(before = {}, after = {}) {
  const rels = stableList([...Object.keys(before), ...Object.keys(after)]).filter((rel) => !isWorkerControlArtifact(rel));
  return rels.filter((rel) => before[rel]?.sha256 !== after[rel]?.sha256 || before[rel]?.exists !== after[rel]?.exists)
    .map((rel) => ({
      path: rel,
      beforeExists: before[rel]?.exists === true,
      beforeSha256: before[rel]?.sha256 || null,
      beforeContent: before[rel]?.content ?? null,
      afterExists: after[rel]?.exists === true,
      afterSha256: after[rel]?.sha256 || null,
      afterContent: after[rel]?.content ?? null
    }));
}

function slug(value = 'item') {
  return clean(value || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

function commandLooksCodex(command = '') {
  return /(^|[/\s_-])codex([\s_.-]|$)|codex-creative-worker/i.test(String(command || ''));
}

function providerUsageFromLedger(ledger = {}) {
  const usage = ledger?.providerUsage || ledger || {};
  const callsStarted = Number(usage.codexCallsStarted ?? usage.callsStarted ?? usage.started ?? 0) || 0;
  const callsCompleted = Number(usage.codexCallsCompleted ?? usage.callsCompleted ?? usage.completed ?? 0) || 0;
  const tokensObserved = Number(usage.tokensObserved ?? usage.totalTokens ?? usage.tokens ?? usage.input_tokens ?? usage.output_tokens ?? 0) || 0;
  return {
    ledgerPresent: Boolean(ledger && Object.keys(ledger).length),
    source: clean(usage.source || ledger.source || 'missing'),
    model: clean(usage.model || ledger.model || ''),
    codexCallsStarted: callsStarted,
    codexCallsCompleted: callsCompleted,
    tokensObserved,
    raw: usage
  };
}

export function providerUsageFromCodexJsonl(stdout = '', { model = '' } = {}) {
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  let callsStarted = 0;
  let callsCompleted = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let reasoningOutputTokens = 0;
  const eventTypes = [];
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const type = clean(event.type || event.event || event.kind);
    if (type) eventTypes.push(type);
    if (type === 'turn.started') callsStarted += 1;
    if (type === 'turn.completed') callsCompleted += 1;
    const usage = event.usage || event.response?.usage || event.data?.usage || null;
    if (usage) {
      inputTokens += Number(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? 0) || 0;
      cachedInputTokens += Number(usage.cached_input_tokens ?? usage.cachedInputTokens ?? 0) || 0;
      outputTokens += Number(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? 0) || 0;
      reasoningOutputTokens += Number(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens ?? 0) || 0;
    }
  }
  const tokensObserved = inputTokens + outputTokens + reasoningOutputTokens;
  return {
    ledgerPresent: callsStarted > 0 || callsCompleted > 0 || tokensObserved > 0,
    source: 'codex_cli_jsonl',
    model: clean(model),
    codexCallsStarted: callsStarted,
    codexCallsCompleted: callsCompleted,
    tokensObserved,
    raw: {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      eventTypes
    }
  };
}

function providerUsageIsRealCodex(usage = {}) {
  return usage.ledgerPresent === true
    && /codex/i.test(usage.source || '')
    && !/fixture|synthetic|mock|fake|test/i.test(usage.source || '')
    && usage.codexCallsStarted > 0
    && usage.codexCallsCompleted > 0
    && usage.tokensObserved > 0;
}

export function buildWorkerAdapterContract({
  adapterId = 'codex-v1',
  provider = 'codex',
  command = 'codex',
  args = [],
  model = null,
  timeoutMs = 10 * 60_000,
  outputLimitBytes = 256 * 1024,
  contextTokenBudget = 24_000,
  contextByteBudget = 256 * 1024,
  requireProviderUsage = true,
  allowShell = false,
  generatedAt = nowIso()
} = {}) {
  const adapter = {
    schemaVersion: AGENT_WORK_PHASE5_WORKER_ADAPTER_SCHEMA,
    generatedAt,
    adapterId: clean(adapterId || 'codex-v1'),
    provider: clean(provider || 'codex'),
    command: clean(command || 'codex'),
    args: orderedList(args),
    model: clean(model || ''),
    timeoutMs: Math.max(1000, Number(timeoutMs || 0) || 10 * 60_000),
    outputLimitBytes: Math.max(4096, Number(outputLimitBytes || 0) || 256 * 1024),
    contextTokenBudget: Math.max(1000, Number(contextTokenBudget || 0) || 24_000),
    contextByteBudget: Math.max(4096, Number(contextByteBudget || 0) || 256 * 1024),
    requireProviderUsage: requireProviderUsage !== false,
    allowShell: allowShell === true,
    commandLooksCodex: commandLooksCodex(command),
    truthBoundary: 'The adapter contract defines how worker evidence must be collected; it does not by itself prove that a model call happened.'
  };
  adapter.digest = sha256(adapter);
  adapter.validation = {
    ok: adapter.provider === 'codex' && adapter.commandLooksCodex && Boolean(adapter.model),
    checks: [
      { id: 'provider_codex', ok: adapter.provider === 'codex' },
      { id: 'command_invokes_codex', ok: adapter.commandLooksCodex },
      { id: 'model_recorded', ok: Boolean(adapter.model) },
      { id: 'shell_disabled_by_default', ok: adapter.allowShell === false }
    ]
  };
  return adapter;
}

export function buildContextManifest({
  canonicalRoot,
  task = {},
  allowedFiles = task.allowedFiles || task.files || [],
  contextTokenBudget = 24_000,
  contextByteBudget = 256 * 1024,
  generatedAt = nowIso()
} = {}) {
  const root = path.resolve(canonicalRoot || '.');
  const files = stableList(allowedFiles).flatMap((rel) => {
    if (rel === '**/*') return walkFiles(root);
    const full = safeJoin(root, rel);
    if (!full || !fs.existsSync(full)) return [normalizeRel(rel)];
    if (fs.statSync(full).isDirectory()) return walkFiles(full).map((child) => `${normalizeRel(rel)}/${child}`);
    return [normalizeRel(rel)];
  });
  const entries = files.map((rel) => {
    const full = safeJoin(root, rel);
    const exists = Boolean(full && fs.existsSync(full) && fs.statSync(full).isFile());
    const bytes = exists ? fs.statSync(full).size : 0;
    return {
      path: normalizeRel(rel),
      exists,
      bytes,
      sha256: exists ? fileSha256(full) : null
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const estimatedTokens = Math.ceil(totalBytes / 4);
  const manifest = {
    schemaVersion: AGENT_WORK_PHASE5_CONTEXT_MANIFEST_SCHEMA,
    generatedAt,
    taskId: clean(task.taskId || task.id || 'task'),
    canonicalRoot: root,
    allowedFiles: stableList(allowedFiles),
    entries,
    totalBytes,
    estimatedTokens,
    budgets: { contextTokenBudget, contextByteBudget },
    withinBudget: totalBytes <= contextByteBudget && estimatedTokens <= contextTokenBudget,
    digest: null,
    truthBoundary: 'The context manifest bounds worker input files and budgets; it is not a completion or quality claim.'
  };
  manifest.digest = sha256(manifest);
  return manifest;
}

export function provisionIsolatedWorkspace({
  canonicalRoot,
  executionRoot,
  task = {},
  lease = {},
  allowedFiles = task.allowedFiles || task.files || [],
  contextTokenBudget = 24_000,
  contextByteBudget = 256 * 1024,
  generatedAt = nowIso()
} = {}) {
  if (!canonicalRoot) throw new Error('canonicalRoot is required');
  if (!executionRoot) throw new Error('executionRoot is required');
  const taskId = clean(task.taskId || task.id || 'task');
  const leaseId = clean(lease.leaseId || 'lease');
  const workspacePath = path.join(path.resolve(executionRoot), 'worker_workspaces', `${slug(taskId)}__${slug(leaseId)}`);
  fs.rmSync(workspacePath, { recursive: true, force: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  const contextManifest = buildContextManifest({ canonicalRoot, task, allowedFiles, contextTokenBudget, contextByteBudget, generatedAt });
  if (!contextManifest.withinBudget) {
    return {
      ok: false,
      isolated: true,
      workspacePath,
      blocker: {
        code: 'context_budget_exceeded',
        summary: 'Worker context exceeds the configured Phase 5 budget.',
        observed: { totalBytes: contextManifest.totalBytes, estimatedTokens: contextManifest.estimatedTokens, budgets: contextManifest.budgets },
        nextAction: 'Reduce allowedFiles or raise the explicit context budget before spawning the worker.'
      },
      contextManifest
    };
  }
  const copiedFiles = [];
  for (const entry of contextManifest.entries) {
    const copied = copyPath({ sourceRoot: canonicalRoot, targetRoot: workspacePath, rel: entry.path });
    if (copied) copiedFiles.push(copied);
  }
  const baselineFiles = snapshotFiles(workspacePath);
  const workspace = {
    ok: true,
    isolated: true,
    preparedAt: generatedAt,
    canonicalRoot: path.resolve(canonicalRoot),
    executionRoot: path.resolve(executionRoot),
    workspacePath,
    taskId,
    leaseId,
    fencingToken: lease.fencingToken ?? null,
    allowedFiles: stableList(allowedFiles),
    copiedFiles: stableList(copiedFiles),
    contextManifest,
    baselineFiles,
    baselineDigest: sha256(baselineFiles),
    truthBoundary: 'Worker workspace isolation means the worker receives a copied context and cannot modify canonical source unless the merge lane later applies a patch bundle.'
  };
  workspace.manifestPath = writeJson(path.join(workspacePath, 'agent_work_context_manifest.json'), workspace);
  return workspace;
}

export function runCodexWorkerAdapter({
  adapter,
  workspace,
  task = {},
  prompt = '',
  providerLedgerPath = null,
  env = {},
  generatedAt = nowIso()
} = {}) {
  if (!adapter?.command) throw new Error('adapter.command is required');
  if (!workspace?.workspacePath) throw new Error('workspace.workspacePath is required');
  const started = Date.now();
  const ledgerPath = providerLedgerPath || path.join(workspace.workspacePath, 'provider_usage_ledger.json');
  const before = workspace.baselineFiles || snapshotFiles(workspace.workspacePath);
  const run = spawnSync(adapter.command, adapter.args || [], {
    cwd: workspace.workspacePath,
    encoding: 'utf8',
    timeout: adapter.timeoutMs,
    shell: adapter.allowShell === true,
    maxBuffer: adapter.outputLimitBytes,
    env: {
      ...process.env,
      ...env,
      AGENT_WORK_TASK_ID: clean(task.taskId || task.id || workspace.taskId || 'task'),
      AGENT_WORK_PROMPT: prompt,
      AGENT_WORK_PROVIDER_LEDGER_PATH: ledgerPath,
      AGENT_WORK_MODEL: adapter.model || '',
      AGENT_WORK_ALLOWED_FILES: JSON.stringify(workspace.allowedFiles || [])
    }
  });
  const completedAt = nowIso();
  const runtimeMs = Math.max(1, Date.now() - started);
  const after = snapshotFiles(workspace.workspacePath);
  const modifiedFiles = diffSnapshots(before, after);
  const ledger = readJsonIfExists(ledgerPath) || {};
  const ledgerUsage = providerUsageFromLedger(ledger);
  const jsonlUsage = providerUsageFromCodexJsonl(run.stdout || '', { model: adapter.model || '' });
  const providerUsage = ledgerUsage.ledgerPresent ? ledgerUsage : jsonlUsage;
  if (!providerUsage.model && adapter.model) providerUsage.model = adapter.model;
  const evidence = {
    schemaVersion: AGENT_WORK_PHASE5_WORKER_EVIDENCE_SCHEMA,
    generatedAt,
    completedAt,
    taskId: clean(task.taskId || task.id || workspace.taskId || 'task'),
    workerId: clean(task.workerId || adapter.adapterId || 'worker'),
    adapterId: adapter.adapterId,
    provider: adapter.provider,
    model: adapter.model || providerUsage.model || null,
    command: [adapter.command, ...(adapter.args || [])].join(' ').trim(),
    commandLooksCodex: commandLooksCodex([adapter.command, ...(adapter.args || [])].join(' ')),
    exitCode: run.status,
    signal: run.signal || null,
    timedOut: run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGTERM',
    runtimeMs,
    stdout: String(run.stdout || '').slice(0, adapter.outputLimitBytes),
    stderr: String(run.stderr || '').slice(0, adapter.outputLimitBytes),
    providerUsageLedgerPath: fs.existsSync(ledgerPath) ? ledgerPath : null,
    providerUsage,
    realCodexProviderEvidence: providerUsageIsRealCodex(providerUsage),
    workspace: { path: workspace.workspacePath, isolated: workspace.isolated === true, baselineDigest: workspace.baselineDigest },
    modifiedFiles,
    ok: run.status === 0 && !run.error,
    digest: null,
    truthBoundary: 'Worker evidence records command/model/runtime/provider ledger and workspace deltas. Only non-fixture provider usage can support a real Codex worker claim.'
  };
  evidence.digest = sha256(evidence);
  evidence.evidencePath = writeJson(path.join(workspace.workspacePath, 'worker_evidence.json'), evidence);
  return evidence;
}

export function buildPatchBundle({
  workspace,
  workerEvidence,
  task = {},
  patchRoot,
  allowedFiles = workspace?.allowedFiles || task.allowedFiles || task.files || [],
  generatedAt = nowIso()
} = {}) {
  if (!workspace?.workspacePath) throw new Error('workspace is required');
  if (!workerEvidence) throw new Error('workerEvidence is required');
  const root = patchRoot || path.join(workspace.executionRoot || path.dirname(workspace.workspacePath), 'patch_bundles');
  fs.mkdirSync(root, { recursive: true });
  const modifiedFiles = workerEvidence.modifiedFiles || [];
  const outOfScope = modifiedFiles.filter((entry) => !pathAllowed(entry.path, allowedFiles));
  const provisional = {
    schemaVersion: AGENT_WORK_PHASE5_PATCH_BUNDLE_SCHEMA,
    generatedAt,
    taskId: clean(task.taskId || task.id || workerEvidence.taskId || workspace.taskId || 'task'),
    workerId: workerEvidence.workerId,
    sourceWorkspace: workspace.workspacePath,
    allowedFiles: stableList(allowedFiles),
    workerEvidenceDigest: workerEvidence.digest,
    modifiedFiles,
    outOfScopeFiles: outOfScope.map((entry) => entry.path),
    ok: outOfScope.length === 0 && workerEvidence.ok === true,
    blocker: null,
    patchId: null,
    truthBoundary: 'A patch bundle is staged evidence only. It does not alter canonical source until merge admission applies it.'
  };
  if (!provisional.ok) {
    provisional.blocker = outOfScope.length
      ? { code: 'worker_modified_unowned_files', summary: 'Worker changed files outside its allowed file set.', outOfScopeFiles: provisional.outOfScopeFiles }
      : { code: 'worker_command_failed', summary: 'Worker command did not complete successfully.', exitCode: workerEvidence.exitCode, timedOut: workerEvidence.timedOut };
  }
  provisional.patchId = `patch-${sha256(provisional).slice(0, 16)}`;
  const bundleDir = path.join(root, provisional.patchId);
  fs.mkdirSync(bundleDir, { recursive: true });
  for (const entry of modifiedFiles) {
    const safeRel = normalizeRel(entry.path);
    const fileRoot = path.join(bundleDir, 'files', safeRel.replace(/\//g, '__'));
    writeJson(`${fileRoot}.json`, entry);
    if (entry.afterExists) {
      fs.writeFileSync(`${fileRoot}.after`, entry.afterContent ?? '');
    }
  }
  provisional.bundleDir = bundleDir;
  provisional.bundlePath = writeJson(path.join(bundleDir, 'patch_bundle.json'), provisional);
  provisional.bundleDigest = sha256(provisional);
  writeJson(provisional.bundlePath, provisional);
  return provisional;
}

export function detectPatchConflicts(patchBundles = []) {
  const bundles = patchBundles.filter(Boolean);
  const byPath = new Map();
  const conflicts = [];
  for (const bundle of bundles) {
    for (const file of bundle.modifiedFiles || []) {
      const rel = normalizeRel(file.path);
      const prior = byPath.get(rel);
      if (prior && prior.afterSha256 !== file.afterSha256) {
        conflicts.push({
          path: rel,
          patchIds: [prior.patchId, bundle.patchId],
          reason: 'same_file_different_after_digest',
          firstAfterSha256: prior.afterSha256,
          secondAfterSha256: file.afterSha256
        });
      }
      if (!prior) byPath.set(rel, { patchId: bundle.patchId, afterSha256: file.afterSha256 });
    }
  }
  return {
    schemaVersion: 'clawd.agent_work.phase5_conflict_report.v1',
    generatedAt: nowIso(),
    status: conflicts.length ? 'conflicted' : 'serializable',
    conflicts,
    checkedPatchIds: bundles.map((bundle) => bundle.patchId).filter(Boolean),
    truthBoundary: 'Conflict detection blocks overlapping divergent writes; it does not repair semantic conflicts by itself.'
  };
}

export function mergePatchBundle({
  canonicalRoot,
  patchBundle,
  runtime = null,
  taskId = patchBundle?.taskId,
  leaseId = null,
  fencingToken = null,
  requireLease = true,
  verifierResults = [],
  generatedAt = nowIso()
} = {}) {
  if (!canonicalRoot) throw new Error('canonicalRoot is required');
  if (!patchBundle) throw new Error('patchBundle is required');
  if (patchBundle.ok !== true) {
    return {
      schemaVersion: AGENT_WORK_PHASE5_MERGE_RECEIPT_SCHEMA,
      generatedAt,
      ok: false,
      state: 'blocked',
      patchId: patchBundle.patchId,
      blocker: patchBundle.blocker || { code: 'patch_bundle_not_green' },
      truthBoundary: 'Non-green patch bundles cannot enter the merge lane.'
    };
  }
  if (requireLease && runtime) assertCurrentLease(runtime, { taskId, leaseId, fencingToken });
  const root = path.resolve(canonicalRoot);
  const conflicts = [];
  for (const file of patchBundle.modifiedFiles || []) {
    const full = safeJoin(root, file.path);
    if (!full) {
      conflicts.push({ path: file.path, reason: 'unsafe_path' });
      continue;
    }
    const currentSha = fileSha256(full);
    if ((file.beforeSha256 || null) !== (currentSha || null)) {
      conflicts.push({ path: file.path, reason: 'canonical_file_changed_since_worker_baseline', expectedBeforeSha256: file.beforeSha256 || null, currentSha256: currentSha || null });
    }
  }
  if (conflicts.length) {
    return {
      schemaVersion: AGENT_WORK_PHASE5_MERGE_RECEIPT_SCHEMA,
      generatedAt,
      ok: false,
      state: 'conflicted',
      patchId: patchBundle.patchId,
      conflicts,
      nextAction: 'Route the patch to rebase/repair; do not overwrite canonical source.',
      truthBoundary: 'Merge admission failed closed because canonical source no longer matched the worker baseline.'
    };
  }
  if (runtime) stagePatch(runtime, { taskId, leaseId, fencingToken, patchId: patchBundle.patchId, artifactPath: patchBundle.bundlePath });
  const appliedFiles = [];
  for (const file of patchBundle.modifiedFiles || []) {
    const full = safeJoin(root, file.path);
    if (!full) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (file.afterExists) fs.writeFileSync(full, file.afterContent ?? '');
    else if (fs.existsSync(full)) fs.rmSync(full, { force: true });
    appliedFiles.push(file.path);
  }
  if (runtime) acceptPatch(runtime, { taskId, leaseId, fencingToken, patchId: patchBundle.patchId });
  const receipt = {
    schemaVersion: AGENT_WORK_PHASE5_MERGE_RECEIPT_SCHEMA,
    generatedAt,
    ok: true,
    state: 'merged',
    patchId: patchBundle.patchId,
    taskId,
    appliedFiles: stableList(appliedFiles),
    verifierResults,
    lease: leaseId ? { leaseId, fencingToken } : null,
    canonicalRoot: root,
    digest: null,
    truthBoundary: 'Canonical source was changed only by the merge lane after baseline, scope, lease, and patch-bundle checks.'
  };
  receipt.digest = sha256(receipt);
  if (patchBundle.bundleDir) receipt.receiptPath = writeJson(path.join(patchBundle.bundleDir, 'merge_receipt.json'), receipt);
  return receipt;
}

export function cleanupWorkerWorkspace({ workspace, preserve = [] } = {}) {
  if (!workspace?.workspacePath) throw new Error('workspace is required');
  const preserved = stableList([
    workspace.manifestPath,
    path.join(workspace.workspacePath, 'worker_evidence.json'),
    ...(preserve || [])
  ]).filter((filePath) => filePath && fs.existsSync(filePath));
  const evidenceRoot = path.join(workspace.executionRoot || os.tmpdir(), 'preserved_worker_evidence', `${slug(workspace.taskId)}__${slug(workspace.leaseId)}`);
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const copied = [];
  for (const filePath of preserved) {
    const dest = path.join(evidenceRoot, path.basename(filePath));
    fs.copyFileSync(filePath, dest);
    copied.push(dest);
  }
  fs.rmSync(workspace.workspacePath, { recursive: true, force: true });
  return {
    generatedAt: nowIso(),
    workspaceRemoved: !fs.existsSync(workspace.workspacePath),
    evidenceRoot,
    preservedEvidence: copied,
    truthBoundary: 'Cleanup may remove ephemeral workspaces only after evidence has been copied into the execution artifact root.'
  };
}

export function validateWorkerExecutionEvidence(workerEvidence = {}, { requireRealCodexProviderEvidence = false } = {}) {
  const providerUsage = workerEvidence.providerUsage || {};
  const checks = [
    { id: 'command_recorded', ok: Boolean(workerEvidence.command) },
    { id: 'command_invokes_codex', ok: workerEvidence.commandLooksCodex === true || commandLooksCodex(workerEvidence.command) },
    { id: 'model_recorded', ok: Boolean(workerEvidence.model) },
    { id: 'runtime_positive', ok: Number(workerEvidence.runtimeMs || 0) > 0 },
    { id: 'provider_ledger_present', ok: providerUsage.ledgerPresent === true },
    { id: 'provider_calls_completed', ok: Number(providerUsage.codexCallsStarted || 0) > 0 && Number(providerUsage.codexCallsCompleted || 0) > 0 },
    { id: 'provider_tokens_observed', ok: Number(providerUsage.tokensObserved || 0) > 0 },
    { id: 'isolated_workspace', ok: workerEvidence.workspace?.isolated === true }
  ];
  if (requireRealCodexProviderEvidence) {
    checks.push({ id: 'real_codex_provider_evidence', ok: workerEvidence.realCodexProviderEvidence === true });
  }
  return {
    ok: checks.every((check) => check.ok),
    checks,
    truthBoundary: requireRealCodexProviderEvidence
      ? 'This validation requires non-fixture Codex provider evidence.'
      : 'This validation proves the worker evidence shape and ledger fields, but does not require a non-fixture provider call.'
  };
}

export function buildWorkerExecutionPacket({
  runId = 'agent_work_run',
  adapter = null,
  contextManifest = null,
  workerEvidence = null,
  patchBundles = [],
  mergeReceipts = [],
  conflictReport = null,
  staleLeaseCheck = null,
  cleanup = null,
  requireRealCodexProviderEvidence = true,
  generatedAt = nowIso()
} = {}) {
  const evidenceValidation = validateWorkerExecutionEvidence(workerEvidence || {}, { requireRealCodexProviderEvidence });
  const bundleList = patchBundles.filter(Boolean);
  const receiptList = mergeReceipts.filter(Boolean);
  const checks = {
    adapterContractGreen: adapter?.validation?.ok === true,
    contextWithinBudget: contextManifest?.withinBudget === true,
    workerEvidenceGreen: evidenceValidation.ok,
    patchBundlesGreen: bundleList.length > 0 && bundleList.every((bundle) => bundle.ok === true),
    conflictsSerializedOrBlocked: conflictReport ? ['serializable', 'conflicted'].includes(conflictReport.status) : false,
    staleLeaseRejected: staleLeaseCheck?.rejected === true,
    mergeLaneOnly: receiptList.length > 0 && receiptList.every((receipt) => receipt.ok === true && receipt.state === 'merged'),
    cleanupPreservedEvidence: cleanup?.workspaceRemoved === true && (cleanup.preservedEvidence || []).length > 0
  };
  const green = Object.values(checks).every(Boolean);
  return {
    schemaVersion: AGENT_WORK_PHASE5_EXECUTION_PACKET_SCHEMA,
    generatedAt,
    runId,
    status: green ? 'green' : 'blocked',
    requireRealCodexProviderEvidence,
    checks,
    evidenceValidation,
    artifacts: {
      adapterDigest: adapter?.digest || null,
      contextDigest: contextManifest?.digest || null,
      workerEvidencePath: workerEvidence?.evidencePath || null,
      patchBundlePaths: bundleList.map((bundle) => bundle.bundlePath).filter(Boolean),
      mergeReceiptPaths: receiptList.map((receipt) => receipt.receiptPath).filter(Boolean),
      cleanupEvidenceRoot: cleanup?.evidenceRoot || null
    },
    blocker: green ? null : {
      code: requireRealCodexProviderEvidence && workerEvidence?.realCodexProviderEvidence !== true ? 'real_codex_provider_evidence_required' : 'phase5_execution_checks_incomplete',
      summary: 'Phase 5 worker execution packet is not green until every worker, isolation, patch, lease, merge, cleanup, and provider-evidence check passes.',
      failedChecks: Object.entries(checks).filter(([, ok]) => !ok).map(([id]) => id),
      nextAction: requireRealCodexProviderEvidence && workerEvidence?.realCodexProviderEvidence !== true
        ? 'Run the same isolated worker path with an approved real Codex/provider call and a non-fixture provider usage ledger.'
        : 'Complete the failed Phase 5 execution checks and rebuild the packet.'
    },
    truthBoundary: green
      ? 'Phase 5 packet is green for the supplied bounded worker execution evidence. It does not prove independent verifier service, release qualification, 12-worker tier, six-hour soak, or full parity.'
      : 'Blocked Phase 5 packet cannot be used as worker-execution completion evidence.'
  };
}

export function writeWorkerExecutionPacket(packet, artifactRoot) {
  const root = path.resolve(artifactRoot || '.');
  return writeJson(path.join(root, 'worker_execution_packet.json'), packet);
}
