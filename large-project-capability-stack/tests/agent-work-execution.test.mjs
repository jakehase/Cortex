import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildWorkerAdapterContract,
  buildWorkerExecutionPacket,
  cleanupWorkerWorkspace,
  compileObjective,
  detectPatchConflicts,
  mergePatchBundle,
  provisionIsolatedWorkspace,
  providerUsageFromCodexJsonl,
  runCodexWorkerAdapter,
  validateWorkerExecutionEvidence,
  buildPatchBundle
} from '../packages/canonical-agent-work/index.mjs';
import {
  acquireLease,
  closeAgentWorkRuntime,
  openAgentWorkRuntime,
  recoverRuntimeState,
  transitionTask
} from '../packages/agent-work-runtime/index.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/agent-work-v1/v0-cortex-handoff.json'), 'utf8'));

function tmpDir(label = 'agent-work-execution-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function fakeCodexExecutable(dir, body) {
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, 'codex-fixture-worker.mjs');
  fs.writeFileSync(exe, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(exe, 0o755);
  return exe;
}

function makeRepo() {
  const repo = tmpDir('agent-work-canonical-');
  write(path.join(repo, 'src/product.mjs'), 'export const value = "before";\n');
  write(path.join(repo, 'src/other.mjs'), 'export const other = true;\n');
  return repo;
}

test('Phase 5 worker adapter preserves ordered Codex CLI arguments', () => {
  const adapter = buildWorkerAdapterContract({ command: '/home/jake/.local/bin/codex', args: ['exec', '--json', '--sandbox', 'workspace-write', 'prompt text'], model: 'codex-default' });
  assert.deepEqual(adapter.args, ['exec', '--json', '--sandbox', 'workspace-write', 'prompt text']);
  assert.equal(adapter.validation.ok, true);
});

test('Phase 5 Codex adapter records command/model/runtime/provider ledger while isolated from canonical source', () => {
  const repo = makeRepo();
  const execRoot = tmpDir('agent-work-exec-root-');
  const fakeCodex = fakeCodexExecutable(execRoot, `
import fs from 'node:fs';
fs.appendFileSync('src/product.mjs', 'export const workerChange = true;\\n');
fs.writeFileSync(process.env.AGENT_WORK_PROVIDER_LEDGER_PATH, JSON.stringify({ source: 'codex_fixture_ledger', model: process.env.AGENT_WORK_MODEL, codexCallsStarted: 1, codexCallsCompleted: 1, tokensObserved: 1234 }, null, 2));
`);
  const adapter = buildWorkerAdapterContract({ command: fakeCodex, model: 'codex-test-model' });
  assert.equal(adapter.validation.ok, true);
  const workspace = provisionIsolatedWorkspace({
    canonicalRoot: repo,
    executionRoot: execRoot,
    task: { taskId: 'task-product', allowedFiles: ['src/product.mjs'] },
    lease: { leaseId: 'lease-1', fencingToken: 1 },
    allowedFiles: ['src/product.mjs']
  });
  assert.equal(workspace.ok, true);
  const canonicalBefore = fs.readFileSync(path.join(repo, 'src/product.mjs'), 'utf8');
  const evidence = runCodexWorkerAdapter({ adapter, workspace, task: { taskId: 'task-product' }, prompt: 'Make a bounded change.' });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.commandLooksCodex, true);
  assert.equal(evidence.providerUsage.codexCallsCompleted, 1);
  assert.equal(evidence.providerUsage.tokensObserved > 0, true);
  assert.equal(evidence.runtimeMs > 0, true);
  assert.equal(evidence.realCodexProviderEvidence, false);
  assert.equal(fs.readFileSync(path.join(repo, 'src/product.mjs'), 'utf8'), canonicalBefore);
  assert.equal(validateWorkerExecutionEvidence(evidence, { requireRealCodexProviderEvidence: false }).ok, true);
  assert.equal(validateWorkerExecutionEvidence(evidence, { requireRealCodexProviderEvidence: true }).ok, false);

  const bundle = buildPatchBundle({ workspace, workerEvidence: evidence, task: { taskId: 'task-product', allowedFiles: ['src/product.mjs'] } });
  assert.equal(bundle.ok, true);
  assert.deepEqual(bundle.modifiedFiles.map((entry) => entry.path), ['src/product.mjs']);
  const conflictReport = detectPatchConflicts([bundle]);
  assert.equal(conflictReport.status, 'serializable');
  const receipt = mergePatchBundle({ canonicalRoot: repo, patchBundle: bundle, requireLease: false });
  assert.equal(receipt.ok, true);
  assert.match(fs.readFileSync(path.join(repo, 'src/product.mjs'), 'utf8'), /workerChange/);
  const cleanup = cleanupWorkerWorkspace({ workspace, preserve: [bundle.bundlePath] });
  assert.equal(cleanup.workspaceRemoved, true);
  assert.equal(cleanup.preservedEvidence.length >= 2, true);

  const packet = buildWorkerExecutionPacket({
    runId: 'phase5-fixture',
    adapter,
    contextManifest: workspace.contextManifest,
    workerEvidence: evidence,
    patchBundles: [bundle],
    mergeReceipts: [receipt],
    conflictReport,
    staleLeaseCheck: { rejected: true },
    cleanup,
    requireRealCodexProviderEvidence: false
  });
  assert.equal(packet.status, 'green');

  const realPacket = buildWorkerExecutionPacket({
    runId: 'phase5-fixture',
    adapter,
    contextManifest: workspace.contextManifest,
    workerEvidence: evidence,
    patchBundles: [bundle],
    mergeReceipts: [receipt],
    conflictReport,
    staleLeaseCheck: { rejected: true },
    cleanup,
    requireRealCodexProviderEvidence: true
  });
  assert.equal(realPacket.status, 'blocked');
  assert.equal(realPacket.blocker.code, 'real_codex_provider_evidence_required');
});

test('Phase 5 provider usage can be derived from Codex JSONL events without worker self-report', () => {
  const stdout = [
    JSON.stringify({ type: 'thread.started' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 25, reasoning_output_tokens: 5 } })
  ].join('\n');
  const usage = providerUsageFromCodexJsonl(stdout, { model: 'gpt-5.5-codex' });
  assert.equal(usage.ledgerPresent, true);
  assert.equal(usage.source, 'codex_cli_jsonl');
  assert.equal(usage.codexCallsStarted, 1);
  assert.equal(usage.codexCallsCompleted, 1);
  assert.equal(usage.tokensObserved, 130);
  assert.equal(usage.raw.cachedInputTokens, 40);
});

test('Phase 5 patch bundles reject out-of-scope worker writes before merge admission', () => {
  const repo = makeRepo();
  const execRoot = tmpDir('agent-work-exec-root-');
  const fakeCodex = fakeCodexExecutable(execRoot, `
import fs from 'node:fs';
fs.appendFileSync('src/product.mjs', 'export const inScope = true;\\n');
fs.writeFileSync('src/unowned.mjs', 'export const outOfScope = true;\\n');
fs.writeFileSync(process.env.AGENT_WORK_PROVIDER_LEDGER_PATH, JSON.stringify({ source: 'codex_fixture_ledger', model: process.env.AGENT_WORK_MODEL, codexCallsStarted: 1, codexCallsCompleted: 1, tokensObserved: 55 }, null, 2));
`);
  const adapter = buildWorkerAdapterContract({ command: fakeCodex, model: 'codex-test-model' });
  const workspace = provisionIsolatedWorkspace({ canonicalRoot: repo, executionRoot: execRoot, task: { taskId: 'task-product', allowedFiles: ['src/product.mjs'] }, lease: { leaseId: 'lease-1' }, allowedFiles: ['src/product.mjs'] });
  const evidence = runCodexWorkerAdapter({ adapter, workspace, task: { taskId: 'task-product' } });
  const bundle = buildPatchBundle({ workspace, workerEvidence: evidence, task: { taskId: 'task-product', allowedFiles: ['src/product.mjs'] } });
  assert.equal(bundle.ok, false);
  assert.equal(bundle.blocker.code, 'worker_modified_unowned_files');
  assert.deepEqual(bundle.outOfScopeFiles, ['src/unowned.mjs']);
  const receipt = mergePatchBundle({ canonicalRoot: repo, patchBundle: bundle, requireLease: false });
  assert.equal(receipt.ok, false);
  assert.equal(fs.existsSync(path.join(repo, 'src/unowned.mjs')), false);
});

test('Phase 5 merge lane blocks divergent conflicts and stale lease admission', () => {
  const repo = makeRepo();
  const execRoot = tmpDir('agent-work-exec-root-');
  function makeBundle(label, value) {
    const fakeCodex = fakeCodexExecutable(path.join(execRoot, label), `
import fs from 'node:fs';
fs.writeFileSync('src/product.mjs', 'export const value = "${value}";\\n');
fs.writeFileSync(process.env.AGENT_WORK_PROVIDER_LEDGER_PATH, JSON.stringify({ source: 'codex_fixture_ledger', model: process.env.AGENT_WORK_MODEL, codexCallsStarted: 1, codexCallsCompleted: 1, tokensObserved: 99 }, null, 2));
`);
    const adapter = buildWorkerAdapterContract({ command: fakeCodex, model: 'codex-test-model' });
    const workspace = provisionIsolatedWorkspace({ canonicalRoot: repo, executionRoot: execRoot, task: { taskId: `task-${label}`, allowedFiles: ['src/product.mjs'] }, lease: { leaseId: `lease-${label}` }, allowedFiles: ['src/product.mjs'] });
    const evidence = runCodexWorkerAdapter({ adapter, workspace, task: { taskId: `task-${label}` } });
    return buildPatchBundle({ workspace, workerEvidence: evidence, task: { taskId: `task-${label}`, allowedFiles: ['src/product.mjs'] }, patchRoot: path.join(execRoot, 'patches') });
  }
  const first = makeBundle('one', 'first');
  const second = makeBundle('two', 'second');
  const conflictReport = detectPatchConflicts([first, second]);
  assert.equal(conflictReport.status, 'conflicted');
  assert.equal(conflictReport.conflicts[0].path, 'src/product.mjs');
  assert.equal(mergePatchBundle({ canonicalRoot: repo, patchBundle: first, requireLease: false }).ok, true);
  const secondReceipt = mergePatchBundle({ canonicalRoot: repo, patchBundle: second, requireLease: false });
  assert.equal(secondReceipt.ok, false);
  assert.equal(secondReceipt.state, 'conflicted');
  assert.equal(secondReceipt.conflicts[0].reason, 'canonical_file_changed_since_worker_baseline');

  const runRoot = tmpDir('agent-work-runtime-');
  const planned = compileObjective({ input: fixture, outputDir: runRoot, config: { executionBoundary: 'control_plane_allowed' } });
  assert.equal(planned.ok, true);
  const runtime = openAgentWorkRuntime({ runRoot });
  const taskId = Object.keys(recoverRuntimeState(runtime).projection.state.tasks)[0];
  transitionTask(runtime, { taskId, state: 'ready', expectedStateVersion: 1 });
  const oldLease = acquireLease(runtime, { taskId, workerId: 'old-worker' });
  const newLease = acquireLease(runtime, { taskId, workerId: 'new-worker' });
  const leaseBundle = { ...makeBundle('lease', 'lease'), taskId };
  assert.throws(() => mergePatchBundle({ canonicalRoot: repo, patchBundle: leaseBundle, runtime, taskId, leaseId: oldLease.leaseId, fencingToken: oldLease.fencingToken }), /stale_fencing_token/);
  const staleLeaseCheck = { rejected: true, reason: 'stale_fencing_token' };
  assert.equal(staleLeaseCheck.rejected, true);
  assert.equal(mergePatchBundle({ canonicalRoot: repo, patchBundle: leaseBundle, runtime, taskId, leaseId: newLease.leaseId, fencingToken: newLease.fencingToken }).ok, true);
  closeAgentWorkRuntime(runtime);
});
