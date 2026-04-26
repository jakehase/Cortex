import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildShardPlan,
  summarizeShardFrontier,
  createLeaseState,
  acquireLease,
  detectOwnershipConflicts,
  recoverStaleLeases,
  createArtifactBus,
  publishArtifact,
  compileContextPack,
  createPatchQueue,
  enqueuePatch,
  processPatchQueue,
  compileSupervisorSnapshot,
  runScaleSimulation,
  qualifyScaleTiers,
  runLiveWorkerFarm,
  qualifyLiveScaleTiers
} from '../packages/multi-agent-orchestrator/index.mjs';
import { compileTaskContract } from '../packages/task-contract/index.mjs';
import {
  FIXTURE_ROOT,
  VERIFIER_SCRIPT,
  WORKER_SCRIPT,
  buildDemoWorkGraph,
  buildLargeQualificationWorkGraph,
  buildDeterministicFailurePlan
} from '../apps/orchestrator-qualification/plan.mjs';
import { prepareLiveFixtureWorkspace } from '../apps/orchestrator-qualification/fixture-workspace.mjs';

function sampleGraph() {
  return {
    workGraph: {
      targetPath: '/tmp/project',
      workUnits: [
        {
          id: 'beta',
          title: 'Beta foundation',
          goal: 'finish beta',
          lane: 'backend',
          domain: 'core',
          fileAreas: ['src/beta', 'tests/beta'],
          allowedFiles: ['src/beta/index.mjs', 'src/beta/contracts.mjs'],
          acceptanceChecks: ['beta tests'],
          requiredVerifiers: ['tests']
        },
        {
          id: 'alpha',
          title: 'Alpha feature',
          goal: 'finish alpha',
          lane: 'frontend',
          domain: 'editor',
          deps: ['beta'],
          fileAreas: ['src/alpha', 'src/alpha/sidebar', 'src/alpha/header', 'tests/alpha'],
          allowedFiles: ['src/alpha/index.mjs', 'src/alpha/sidebar.mjs', 'src/alpha/header.mjs', 'src/alpha/panel.mjs', 'tests/alpha/editor.test.mjs'],
          acceptanceChecks: ['alpha tests', 'alpha lint', 'alpha smoke'],
          requiredVerifiers: ['tests', 'lint']
        }
      ]
    },
    surfaceMatrix: {
      surfaces: [
        { id: 'SURFACE_BETA', label: 'Beta', issueIds: ['beta'], requiredArtifacts: [] },
        { id: 'SURFACE_ALPHA', label: 'Alpha', issueIds: ['alpha'], requiredArtifacts: [] }
      ]
    }
  };
}

test('shard planner preserves lane/domain awareness and decomposes large work units', () => {
  const { workGraph, surfaceMatrix } = sampleGraph();
  const plan = buildShardPlan({ workGraph, surfaceMatrix, options: { maxFileAreasPerShard: 2, maxFilesPerShard: 2, maxAcceptanceChecksPerShard: 2 } });
  const alphaShards = plan.shards.filter((shard) => shard.rootWorkUnitId === 'alpha');
  assert.equal(alphaShards.length, 3);
  assert.deepEqual(alphaShards[0].dependencyShardIds, ['beta']);
  assert.deepEqual(alphaShards.slice(1).map((shard) => shard.dependencyShardIds[0]), ['alpha#1', 'alpha#2']);
  assert.equal(alphaShards[0].lane, 'frontend');
  assert.equal(alphaShards[0].domain, 'editor');
  assert.deepEqual(alphaShards[0].surfaceIds, ['SURFACE_ALPHA']);
  assert.equal(plan.summary.shardCount, 4);
});

test('lease manager blocks ownership collisions and deterministically recovers stale leases', () => {
  let state = createLeaseState({ defaultTtlMs: 1000 });
  const acquired = acquireLease(state, { taskId: 'alpha#1', agentId: 'agent-1', fileAreas: ['src/alpha'] }, 0);
  state = acquired.state;
  const conflicts = detectOwnershipConflicts(state, { taskId: 'beta', agentId: 'agent-2', fileAreas: ['src/alpha/sidebar'] }, 0);
  assert.equal(conflicts.length, 1);
  const recovered = recoverStaleLeases(state, { now: 2000, agentIds: ['agent-3'] });
  assert.equal(recovered.recoveredCount, 1);
  assert.equal(recovered.recoveryActions[0].nextAgentId, 'agent-3');
  assert.equal(recovered.state.tasks['alpha#1'].agentId, 'agent-3');
  assert.equal(recovered.state.tasks['alpha#1'].attempt, 2);
});

test('context pack compiler keeps local scope and dependency artifacts only', () => {
  const { workGraph, surfaceMatrix } = sampleGraph();
  const plan = buildShardPlan({ workGraph, surfaceMatrix, options: { maxFileAreasPerShard: 2, maxFilesPerShard: 2 } });
  const contract = compileTaskContract({ anchor: 'test', targetPath: '/tmp/project', requestedScope: ['A1'], evidenceRequirements: ['tests'] });
  let bus = createArtifactBus();
  bus = publishArtifact(bus, { type: 'shard_output', shardId: 'beta', taskId: 'beta', filePath: 'artifacts/beta.json' }).bus;
  const alphaFirst = plan.shards.find((shard) => shard.id === 'alpha#1');
  alphaFirst.inputRefs = ['campaignBrief'];
  const pack = compileContextPack({
    contract,
    shard: alphaFirst,
    shardPlan: plan,
    surfaceMatrix,
    artifactBus: bus,
    globalInputs: {
      campaignBrief: 'deliver alpha',
      extraSecret: 'should not be copied'
    }
  });
  assert.equal(pack.inputs.campaignBrief, 'deliver alpha');
  assert.equal(Object.prototype.hasOwnProperty.call(pack.inputs, 'extraSecret'), false);
  assert.equal(pack.dependencies.artifacts.length, 1);
  assert.equal(pack.guardrails.avoidWholeProjectPromptDump, true);
  assert.equal(pack.assignmentContract.artifactKind, 'verification_evidence');
  assert.equal(pack.assignmentContract.targetFiles.length, 2);
  assert.ok(pack.assignmentContract.targetFiles.every((file) => file.startsWith('src/alpha/')));
  assert.deepEqual(pack.assignmentContract.verifierRequirements, ['lint', 'tests']);
});

test('patch queue merge gate rejects ownership conflicts and passes clean patches', async () => {
  const now = Date.now();
  let leaseState = createLeaseState({ defaultTtlMs: 5000 });
  leaseState = acquireLease(leaseState, { taskId: 'conflict-task', agentId: 'agent-9', fileAreas: ['src/conflict'] }, now).state;
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, { shardId: 'bad-shard', filePaths: ['src/conflict/file.mjs'], requiredVerifiers: ['tests'] });
  queue = enqueuePatch(queue, {
    shardId: 'good-shard',
    filePaths: ['src/good/file.mjs'],
    requiredVerifiers: ['tests', 'lint'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['src/good/file.mjs'],
        targetModules: ['src/good'],
        verifierRequirements: ['tests', 'lint'],
        successPredicate: ['modify src/good/file.mjs']
      },
      implementation: { modifiedFiles: ['src/good/file.mjs'] }
    }
  });
  const processed = await processPatchQueue(queue, {
    leaseState,
    verifyFns: {
      tests: async () => ({ ok: true }),
      lint: async () => ({ ok: true })
    }
  });
  assert.equal(processed.queue.rejected.length, 1);
  assert.equal(processed.queue.merged.length, 1);
  assert.equal(processed.queue.merged[0].shardId, 'good-shard');
});

test('patch queue rejects no-op product diffs and ungrounded assignments', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'noop-shard',
    filePaths: [],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['src/feature/file.mjs'],
        targetModules: ['src/feature'],
        verifierRequirements: ['tests'],
        successPredicate: ['modify src/feature/file.mjs']
      },
      implementation: { modifiedFiles: [] }
    }
  });
  queue = enqueuePatch(queue, {
    shardId: 'ungrounded-shard',
    filePaths: ['src/feature/file.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: [],
        targetModules: [],
        verifierRequirements: [],
        successPredicate: []
      },
      implementation: { modifiedFiles: ['src/feature/file.mjs'] }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: {
      tests: async () => ({ ok: true })
    }
  });

  assert.equal(processed.queue.merged.length, 0);
  assert.equal(processed.queue.rejected.length, 2);
  assert.equal(processed.queue.rejected[0].rejectionCategory, 'no_op');
  assert.equal(processed.queue.rejected[0].rejectionReason, 'zero_modified_files');
  assert.equal(processed.queue.rejected[1].rejectionCategory, 'planner_failure');
  assert.equal(processed.queue.rejected[1].rejectionReason, 'ungrounded_assignment_contract');
});

test('patch queue rejects product-only verifier skips unless explicitly allowed', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'product-only-shard',
    filePaths: ['src/feature/file.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['src/feature/file.mjs'],
        targetModules: ['src/feature'],
        verifierRequirements: ['tests'],
        successPredicate: ['modify src/feature/file.mjs']
      },
      implementation: { modifiedFiles: ['src/feature/file.mjs'] }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: {
      tests: async () => ({ ok: true, skipped: true, reason: 'product_only_mode' })
    }
  });

  assert.equal(processed.queue.merged.length, 0);
  assert.equal(processed.queue.rejected.length, 1);
  assert.equal(processed.queue.rejected[0].rejectionReason, 'no_non_skipped_verifier_evidence');
  assert.equal(processed.queue.rejected[0].admissionAudit.productOnlySkipAllowed, false);
});

test('patch queue admits product diffs with real scoped changes when product-only skips are explicitly allowed', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'product-only-shard',
    filePaths: ['src/feature/file.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      allowProductOnlyVerifierSkip: true,
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['src/feature/file.mjs'],
        targetModules: ['src/feature'],
        verifierRequirements: ['tests'],
        successPredicate: ['modify src/feature/file.mjs']
      },
      implementation: { modifiedFiles: ['src/feature/file.mjs'] }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: {
      tests: async () => ({ ok: true, skipped: true, reason: 'product_only_mode' })
    }
  });

  assert.equal(processed.queue.rejected.length, 0);
  assert.equal(processed.queue.merged.length, 1);
  assert.equal(processed.queue.merged[0].shardId, 'product-only-shard');
  assert.equal(processed.queue.merged[0].admissionAudit.admissibleVerifierEvidence, true);
  assert.equal(processed.queue.merged[0].admissionAudit.productOnlyVerifierSkip, true);
  assert.equal(processed.queue.merged[0].admissionAudit.productOnlySkipAllowed, true);
});

test('hierarchical supervision aggregates lane/domain state and escalations', () => {
  const { workGraph, surfaceMatrix } = sampleGraph();
  const plan = buildShardPlan({ workGraph, surfaceMatrix, options: { maxFileAreasPerShard: 2, maxFilesPerShard: 2 } });
  let queue = createPatchQueue();
  queue.merged.push({ id: 'patch-beta', shardId: 'beta', filePaths: ['src/beta/index.mjs'] });
  let leaseState = createLeaseState({ defaultTtlMs: 1000 });
  leaseState = acquireLease(leaseState, { taskId: 'alpha#1', agentId: 'agent-1', fileAreas: ['src/alpha'] }, 0).state;
  const snapshot = compileSupervisorSnapshot({ shardPlan: plan, leaseState, patchQueue: queue, blockers: [{ type: 'manual_blocker', shardId: 'alpha#3' }], now: 500 });
  assert.equal(snapshot.topLevel.status, 'red');
  assert.equal(snapshot.lanes.find((lane) => lane.id === 'backend').status, 'green');
  assert.equal(snapshot.lanes.find((lane) => lane.id === 'frontend').status, 'red');
  assert.ok(snapshot.escalations.some((entry) => entry.shardId === 'alpha#3'));
});

test('hierarchical supervision clears rejected patch escalations once the same shard later merges', () => {
  const { workGraph, surfaceMatrix } = sampleGraph();
  const plan = buildShardPlan({ workGraph, surfaceMatrix, options: { maxFileAreasPerShard: 2, maxFilesPerShard: 2 } });
  let queue = createPatchQueue();
  queue.rejected.push({ id: 'patch-alpha-old', shardId: 'alpha#1', filePaths: ['src/alpha/index.mjs'] });
  queue.merged.push({ id: 'patch-alpha-new', shardId: 'alpha#1', filePaths: ['src/alpha/index.mjs'] });
  const snapshot = compileSupervisorSnapshot({ shardPlan: plan, patchQueue: queue, now: 500 });
  assert.equal(snapshot.topLevel.status, 'amber');
  assert.equal(snapshot.escalationCount, 0);
  assert.equal(snapshot.shards.find((shard) => shard.id === 'alpha#1').status, 'green');
  assert.ok(!snapshot.escalations.some((entry) => entry.patchId === 'patch-alpha-old'));
});

test('scale simulation completes with recovery and no state loss', async () => {
  const { workGraph, surfaceMatrix } = buildDemoWorkGraph();
  const result = await runScaleSimulation({
    workGraph,
    surfaceMatrix,
    agentCount: 8,
    maxTicks: 300,
    plannerOptions: { maxFileAreasPerShard: 2, maxFilesPerShard: 3, maxAcceptanceChecksPerShard: 2 }
  });
  assert.equal(result.ok, true);
  assert.ok(result.metrics.recoveryCount >= 1 || result.metrics.workerExitFailures >= 1);
  assert.equal(result.metrics.stateLossEvents, 0);
  assert.equal(result.supervisor.topLevel.status, 'green');
});

test('scale qualification reports the highest passing tier honestly', async () => {
  const { workGraph, surfaceMatrix } = buildDemoWorkGraph();
  const report = await qualifyScaleTiers({
    tiers: [4, 8],
    workGraph,
    surfaceMatrix,
    options: { plannerOptions: { maxFileAreasPerShard: 2, maxFilesPerShard: 3, maxAcceptanceChecksPerShard: 2 }, maxTicks: 300 }
  });
  assert.equal(report.highestPassingTier, 8);
  assert.equal(report.allRequestedTiersPassed, true);
  assert.equal(report.tiers.length, 2);
});

test('frontier summary reports >100 ready shards for the live corpus', () => {
  const { workGraph, surfaceMatrix } = buildLargeQualificationWorkGraph({ familyCount: 30, workspaceRoot: FIXTURE_ROOT });
  const plan = buildShardPlan({ workGraph, surfaceMatrix, options: { maxFileAreasPerShard: 1, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 4 } });
  const frontier = summarizeShardFrontier(plan.shards);
  assert.equal(plan.summary.shardCount, 120);
  assert.ok(frontier.initialReadyCount >= 100);
  assert.ok(frontier.maxReadyCount >= 100);
});

test('live worker farm recovers injected failures without state loss', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-live-run-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  const seed = buildLargeQualificationWorkGraph({ familyCount: 3, workspaceRoot });
  prepareLiveFixtureWorkspace({ rootPath: workspaceRoot, fixtures: seed.fixtures });
  const shardPlan = buildShardPlan({ workGraph: seed.workGraph, surfaceMatrix: seed.surfaceMatrix, options: { maxFileAreasPerShard: 1, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 4 } });
  const failures = buildDeterministicFailurePlan({ shardPlan, leaseTtlMs: 1000 }).slice(0, 2);
  const result = await runLiveWorkerFarm({
    workGraph: seed.workGraph,
    surfaceMatrix: seed.surfaceMatrix,
    agentCount: 4,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: VERIFIER_SCRIPT,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 60000,
    pollMs: 20,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 4 },
    failureInjections: failures,
    globalInputs: seed.globalInputs
  });
  assert.equal(result.ok, true);
  assert.ok(result.metrics.recoveryCount >= 1 || result.metrics.workerExitFailures >= 1);
  assert.equal(result.metrics.stateLossEvents, 0);
  assert.equal(result.supervisor.topLevel.status, 'green');
});

test('live qualification ladder reports the highest passing tier honestly', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-live-ladder-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  const seed = buildLargeQualificationWorkGraph({ familyCount: 3, workspaceRoot });
  prepareLiveFixtureWorkspace({ rootPath: workspaceRoot, fixtures: seed.fixtures });
  const report = await qualifyLiveScaleTiers({
    tiers: [4, 8],
    workGraph: seed.workGraph,
    surfaceMatrix: seed.surfaceMatrix,
    options: {
      workerScriptPath: WORKER_SCRIPT,
      verifierScriptPath: VERIFIER_SCRIPT,
      workspacePath: workspaceRoot,
      runRoot,
      leaseTtlMs: 1000,
      maxRuntimeMs: 60000,
      pollMs: 20,
      plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 4 },
      globalInputs: seed.globalInputs
    }
  });
  assert.equal(report.highestPassingTier, 8);
  assert.equal(report.allRequestedTiersPassed, true);
  assert.equal(report.tiers.every((tier) => tier.executionMode === 'live_multiprocess_worker_farm'), true);
});

test('live worker farm supports implement+verify execution and records real modified files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-implement-run-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  const moduleRoot = path.join(workspaceRoot, 'modules', 'feature-a');
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'manifest.json'), JSON.stringify({ id: 'feature-a' }, null, 2));
  fs.writeFileSync(path.join(moduleRoot, 'source.mjs'), 'export const parity = "not-ready";\n');
  fs.writeFileSync(path.join(moduleRoot, 'test.mjs'), 'import assert from "node:assert/strict"; import { parity } from "./source.mjs"; assert.equal(parity, "ready");\n');
  fs.writeFileSync(path.join(moduleRoot, 'smoke.mjs'), 'import { parity } from "./source.mjs"; if (parity !== "ready") process.exit(2);\n');

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [mode, workspacePath, moduleId] = process.argv.slice(2);
const moduleRoot = path.join(workspacePath, 'modules', moduleId);
const file = mode === 'lint' ? 'source.mjs' : mode === 'tests' ? 'test.mjs' : 'smoke.mjs';
const args = mode === 'lint' ? ['--check', path.join(moduleRoot, file)] : [path.join(moduleRoot, file)];
try {
  const stdout = execFileSync(process.execPath, args, { cwd: moduleRoot, encoding: 'utf8', stdio: 'pipe' });
  console.log(JSON.stringify({ ok: true, verifier: mode, stdout: String(stdout || '').trim() }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, verifier: mode, stdout: String(error.stdout || '').trim(), stderr: String(error.stderr || '') + String(error.message || '') }));
  process.exit(3);
}
`);

  const implementationScript = path.join(tempRoot, 'implement.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignmentPath = process.argv[index + 1];
const assignment = JSON.parse(fs.readFileSync(assignmentPath, 'utf8'));
const target = path.join(assignment.workspacePath, 'modules', assignment.shard.metadata.fixtureModuleId, 'source.mjs');
fs.writeFileSync(target, 'export const parity = "ready";\\n');
console.log(JSON.stringify({ ok: true, modifiedFiles: [path.relative(assignment.workspacePath, target)], diffSummary: 'promoted feature-a parity to ready' }));
`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [{
      id: 'feature-a.impl',
      title: 'feature-a implementation',
      goal: 'bring feature-a to ready state',
      lane: 'implementation',
      domain: 'parity',
      fileAreas: ['modules/feature-a'],
      allowedFiles: ['modules/feature-a/source.mjs'],
      acceptanceChecks: ['tests pass after implementation'],
      requiredVerifiers: ['tests', 'lint'],
      metadata: { fixtureModuleId: 'feature-a' }
    }]
  };
  const surfaceMatrix = { surfaces: [{ id: 'FEATURE_A', label: 'Feature A parity', issueIds: ['feature-a.impl'], requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 1,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: verifierScript,
    implementationScriptPath: implementationScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 20000,
    pollMs: 20,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 4 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.patchQueue.merged.length, 1);
  assert.equal(result.patchQueue.merged[0].diffSummary, 'promoted feature-a parity to ready');
  assert.deepEqual(result.patchQueue.merged[0].filePaths, ['modules/feature-a/source.mjs']);
  assert.equal(result.patchQueue.merged[0].metadata.implementation.modifiedFiles[0], 'modules/feature-a/source.mjs');
});

test('live worker farm stops deterministic implementation failures after the configured attempt cap', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-implement-fail-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  const moduleRoot = path.join(workspaceRoot, 'modules', 'feature-a');
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'manifest.json'), JSON.stringify({ id: 'feature-a' }, null, 2));
  fs.writeFileSync(path.join(moduleRoot, 'source.mjs'), 'export const parity = "broken";\n');

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true }));\n`);
  const implementationScript = path.join(tempRoot, 'implement-fail.mjs');
  fs.writeFileSync(implementationScript, `process.stderr.write('deterministic failure'); process.exit(2);\n`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [{
      id: 'feature-a.impl',
      title: 'feature-a implementation',
      goal: 'fail deterministically',
      lane: 'implementation',
      domain: 'parity',
      fileAreas: ['modules/feature-a'],
      allowedFiles: ['modules/feature-a/source.mjs'],
      acceptanceChecks: ['implementation succeeds'],
      requiredVerifiers: ['tests'],
      metadata: { fixtureModuleId: 'feature-a' }
    }]
  };
  const surfaceMatrix = { surfaces: [{ id: 'FEATURE_A', label: 'Feature A parity', issueIds: ['feature-a.impl'], requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 1,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: verifierScript,
    implementationScriptPath: implementationScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 20000,
    maxAttemptsPerTask: 2,
    pollMs: 20,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 4 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.metrics.failedShards.length, 1);
  assert.equal(result.summary.metrics.failedShards[0].attempts, 2);
});
