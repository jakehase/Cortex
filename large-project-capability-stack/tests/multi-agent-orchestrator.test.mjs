import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildShardPlan,
  buildHierarchicalWorkPlan,
  bindHierarchicalPlanToWorkGraph,
  deriveHierarchicalReplanDirectives,
  compileHierarchicalPlanLedger,
  summarizeShardFrontier,
  createLeaseState,
  acquireLease,
  releaseLease,
  detectOwnershipConflicts,
  recoverStaleLeases,
  createArtifactBus,
  publishArtifact,
  compileContextPack,
  buildContextGovernorReport,
  buildWaveFactPack,
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

test('shard planner preserves target files for acceptance-only split shards', () => {
  const plan = buildShardPlan({
    workGraph: {
      targetPath: '/tmp/project',
      workUnits: [{
        id: 'focus.example::continuation-001#16',
        title: 'Continuation slice',
        lane: 'continuation',
        domain: 'mailchimp_full_clone_continuation',
        fileAreas: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
        allowedFiles: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
        acceptanceChecks: ['one', 'two', 'three', 'four', 'five'],
        requiredVerifiers: ['tests', 'lint'],
        metadata: {
          assignmentContract: {
            artifactKind: 'product_diff',
            targetFiles: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
            verifierRequirements: ['tests', 'lint']
          }
        }
      }]
    },
    surfaceMatrix: { surfaces: [] },
    options: { maxFileAreasPerShard: 4, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 4 }
  });
  assert.equal(plan.shards.length, 2, 'acceptance checks should split into two serial shards');
  assert.deepEqual(plan.shards.map((shard) => shard.allowedFiles), [
    ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
    ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs']
  ]);
  assert.deepEqual(plan.shards.map((shard) => shard.metadata.assignmentContract.targetFiles), [
    ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
    ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs']
  ]);
});

test('hierarchical work planner is a shared agent-orchestration primitive, not product-specific planning', () => {
  const { workGraph, surfaceMatrix } = sampleGraph();
  const plan = buildHierarchicalWorkPlan({
    objective: {
      id: 'cross_product_delivery',
      title: 'Cross-product delivery objective',
      targetPath: workGraph.targetPath,
      requestedFidelity: 'production_slice'
    },
    workGraph,
    surfaceMatrix,
    options: {
      objectiveId: 'cross_product_delivery',
      requestedFidelity: 'production_slice'
    }
  });
  assert.equal(plan.summary.workUnitCoverage, 1);
  assert.ok(plan.summary.maxDepth >= 5);
  assert.ok(plan.nodes.some((node) => node.type === 'objective'));
  assert.ok(plan.nodes.some((node) => node.type === 'domain'));
  assert.ok(plan.nodes.some((node) => node.type === 'surface'));
  assert.ok(plan.nodes.some((node) => node.type === 'planning_stage'));
  assert.ok(plan.nodes.some((node) => node.type === 'implementation_step'));
  assert.ok(plan.nodes.some((node) => node.type === 'proof_gate'));
  assert.ok(plan.summary.novelPlannerFeatures.includes('failure_to_microplan_replanning'));
  assert.ok(plan.summary.novelPlannerFeatures.includes('proof_carrying_plan_ledger'));
  assert.ok(plan.summary.novelPlannerFeatures.includes('counterfactual_plan_twins'));
  assert.ok(plan.summary.counterfactualTwinCount >= plan.summary.workUnitCount);
  assert.ok(plan.summary.proofObligationCount >= plan.summary.workUnitCount);
  assert.equal(plan.summary.worldFirstCandidate.name, 'Counterfactual Proof-Twin Planner');
  assert.equal(plan.summary.worldFirstCandidate.externallyVerified, false);
  const alphaBinding = plan.workUnitBindings.find((binding) => binding.workUnitId === 'alpha');
  assert.ok(alphaBinding.counterfactualFailureTwins.some((twin) => twin.kind === 'zero_surviving_product_diff'));
  assert.ok(alphaBinding.proofObligationLedger.some((obligation) => obligation.gateId === 'verifier_evidence'));
  assert.equal(JSON.stringify(plan).toLowerCase().includes('mailchimp'), false);
  const directives = deriveHierarchicalReplanDirectives({
    hierarchicalPlan: plan,
    failedWorkUnitIds: ['alpha'],
    failureKind: 'zero_surviving_product_diff'
  });
  assert.equal(directives.length, 1);
  assert.equal(directives[0].action, 'split_to_target_microplan');
  assert.equal(directives[0].counterfactualFailureTwin.kind, 'zero_surviving_product_diff');
  assert.ok(directives[0].microSteps.some((step) => step.target.includes('src/alpha')));
});

test('shard planner can bind hierarchical plan slices into assignments before agents run', () => {
  const { workGraph, surfaceMatrix } = sampleGraph();
  const bound = bindHierarchicalPlanToWorkGraph({
    workGraph,
    surfaceMatrix,
    objective: { id: 'shared_agent_orchestration', title: 'Shared agent orchestration' }
  });
  assert.equal(bound.hierarchicalPlan.summary.workUnitCoverage, 1);
  assert.equal(bound.workGraph.summary.hierarchicalPlanning.enabled, true);
  assert.ok(bound.workGraph.workUnits.every((unit) => unit.inputRefs.includes('hierarchicalWorkPlanPolicy')));
  assert.ok(bound.workGraph.workUnits.every((unit) => unit.metadata.hierarchicalPlanning?.depthPath.length >= 6));

  const shardPlan = buildShardPlan({
    workGraph,
    surfaceMatrix,
    options: {
      hierarchicalPlanning: {
        enabled: true,
        objectiveId: 'shared_agent_orchestration',
        requestedFidelity: 'production_slice'
      },
      maxFileAreasPerShard: 2,
      maxFilesPerShard: 2,
      maxAcceptanceChecksPerShard: 2
    }
  });
  assert.equal(shardPlan.summary.hierarchicalPlanning.enabled, true);
  assert.equal(shardPlan.summary.hierarchicalPlanning.workUnitCoverage, 1);
  const alphaShard = shardPlan.shards.find((shard) => shard.rootWorkUnitId === 'alpha');
  assert.ok(alphaShard.inputRefs.includes('hierarchicalWorkPlanPolicy'));
  assert.ok(alphaShard.metadata.hierarchicalPlanning?.nodeId);
  assert.ok(alphaShard.metadata.assignmentContract.successPredicate.some((predicate) => /hierarchical plan node/.test(predicate)));
});

test('proof-carrying plan ledger credits only nodes with scoped diff, negative-space, integration, and verifier evidence', async () => {
  const workGraph = {
    targetPath: '/tmp/project',
    workUnits: [{
      id: 'alpha',
      title: 'Alpha feature',
      goal: 'ship alpha through the shared runtime',
      lane: 'frontend',
      domain: 'editor',
      fileAreas: ['src/alpha'],
      allowedFiles: ['src/alpha/index.mjs'],
      acceptanceChecks: ['alpha behavior works'],
      requiredVerifiers: ['tests'],
      metadata: {
        assignmentContract: {
          artifactKind: 'product_diff',
          targetFiles: ['src/alpha/index.mjs'],
          targetModules: ['src/alpha'],
          verifierRequirements: ['tests'],
          successPredicate: ['alpha behavior works']
        }
      }
    }]
  };
  const surfaceMatrix = { surfaces: [{ id: 'SURFACE_ALPHA', label: 'Alpha', issueIds: ['alpha'], requiredArtifacts: [] }] };
  const shardPlan = buildShardPlan({
    workGraph,
    surfaceMatrix,
    options: { hierarchicalPlanning: { enabled: true, objectiveId: 'ledger_proof' } }
  });

  const emptyLedger = compileHierarchicalPlanLedger({ hierarchicalPlan: shardPlan.hierarchicalPlan, patchQueue: createPatchQueue(), shardPlan });
  assert.equal(emptyLedger.summary.status, 'pending');
  assert.equal(emptyLedger.records[0].credited, false);
  assert.ok(emptyLedger.records[0].triggeredCounterfactualTwins.some((twin) => twin.kind === 'zero_surviving_product_diff'));

  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    id: 'patch-alpha',
    shardId: 'alpha',
    taskId: 'alpha',
    filePaths: ['src/alpha/index.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: shardPlan.shards[0].metadata.assignmentContract,
      implementation: { modifiedFiles: ['src/alpha/index.mjs'] },
      hierarchicalPlanningEvidence: {
        sourceOfTruthIntegrated: true,
        negativeSpaceReduced: true,
        reducedGaps: ['runtime path now consumes alpha behavior'],
        remainingGaps: 'none for this node'
      }
    }
  });
  const processed = await processPatchQueue(queue, { verifyFns: { tests: async () => ({ ok: true, verifier: 'tests' }) } });
  assert.equal(processed.queue.merged.length, 1);
  const ledger = compileHierarchicalPlanLedger({ hierarchicalPlan: shardPlan.hierarchicalPlan, patchQueue: processed.queue, shardPlan });
  assert.equal(ledger.summary.status, 'green');
  assert.equal(ledger.summary.completionEligible, true);
  assert.equal(ledger.records[0].credited, true);
  assert.deepEqual(ledger.records[0].unsatisfiedRequiredGateIds, []);
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

test('tier-100 isolated workspace lease model permits 100 hot-file reservations without shared write ownership', () => {
  const now = 1000;
  let sharedState = createLeaseState({ defaultTtlMs: 5000 });
  let acquired = acquireLease(sharedState, { taskId: 'shared-hot-file-1', agentId: 'agent-1', fileAreas: ['packages/app/view.mjs'] }, now);
  assert.equal(acquired.ok, true);
  sharedState = acquired.state;
  const sharedConflict = acquireLease(sharedState, { taskId: 'shared-hot-file-2', agentId: 'agent-2', fileAreas: ['packages/app/view.mjs'] }, now);
  assert.equal(sharedConflict.ok, false);
  assert.equal(sharedConflict.conflicts[0].type, 'file_area_owned');

  let isolatedState = createLeaseState({ defaultTtlMs: 5000 });
  for (let index = 0; index < 100; index += 1) {
    acquired = acquireLease(isolatedState, {
      taskId: `isolated-hot-file-${index + 1}`,
      agentId: `agent-${index + 1}`,
      fileAreas: [],
      metadata: {
        workerWorkspaceMode: 'isolated_product_copy',
        logicalFileAreas: ['packages/app/view.mjs']
      }
    }, now);
    assert.equal(acquired.ok, true, `expected isolated reservation ${index + 1} to avoid hot-file lease conflict`);
    isolatedState = acquired.state;
  }
  assert.equal(Object.keys(isolatedState.tasks).length, 100);
  assert.equal(Object.values(isolatedState.tasks).every((lease) => lease.metadata.workerWorkspaceMode === 'isolated_product_copy'), true);
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

test('context governor compacts worker packs and emits retrieval/model metadata', () => {
  const { workGraph, surfaceMatrix } = sampleGraph();
  const plan = buildShardPlan({ workGraph, surfaceMatrix, options: { maxFileAreasPerShard: 4, maxFilesPerShard: 4 } });
  const contract = compileTaskContract({ anchor: 'token efficiency architecture', targetPath: '/tmp/project', requestedScope: ['A1'], evidenceRequirements: ['tests'] });
  const alphaFirst = plan.shards.find((shard) => shard.id === 'alpha#1');
  alphaFirst.inputRefs = ['campaignBrief', 'largePriorTranscript'];
  const pack = compileContextPack({
    contract,
    shard: alphaFirst,
    shardPlan: plan,
    surfaceMatrix,
    artifactBus: createArtifactBus(),
    globalInputs: {
      campaignBrief: 'deliver alpha',
      largePriorTranscript: 'previous worker transcript\n'.repeat(2000)
    },
    contextGovernorOptions: {
      enabled: true,
      hardGate: true,
      maxWorkerTokens: 2200,
      maxInputChars: 240,
      maxTotalInputChars: 420,
      maxAllowedFiles: 2,
      maxFileAreas: 2
    },
    previousWaveFactpack: { schemaVersion: 'clawd.wave_factpack.v1', waveNumber: 3, summary: { mergedShardCount: 12 }, rejectedByReason: { verifier_failed: 2 }, recentFailures: [{ shardId: 'old' }] }
  });

  assert.equal(pack.contextGovernor.enabled, true);
  assert.equal(pack.modelTierPlan.worker.role, 'narrow_worker');
  assert.equal(pack.modelTierPlan.worker.promptMode, 'compact');
  assert.equal(pack.retrievalManifest.mode, 'on_demand_assigned_files_only');
  assert.ok(pack.retrievalManifest.inputHandles.some((entry) => entry.key === 'largePriorTranscript'));
  assert.equal(pack.dependencies.previousWaveFactpack.waveNumber, 3);
  assert.match(pack.contextCache.packDigest, /^[a-f0-9]{64}$/);
  assert.match(pack.contextCache.retrievalDigest, /^[a-f0-9]{64}$/);
  assert.ok(pack.contextFootprint.postGovernorApproxTokens <= 2200);
  assert.ok(pack.contextFootprint.projectedSavingsRatio > 1);
});

test('context governor hard gate blocks live workers before token burn', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-context-gate-'));
  const workspace = path.join(tmp, 'workspace');
  fs.mkdirSync(path.join(workspace, 'src/alpha'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src/alpha/index.mjs'), 'export const alpha = 1;\n');
  fs.writeFileSync(path.join(workspace, 'src/alpha/sidebar.mjs'), 'export const sidebar = 1;\n');
  fs.writeFileSync(path.join(workspace, 'src/alpha/header.mjs'), 'export const header = 1;\n');
  fs.writeFileSync(path.join(workspace, 'src/alpha/panel.mjs'), 'export const panel = 1;\n');
  const { workGraph, surfaceMatrix } = sampleGraph();
  const workerScript = path.join(tmp, 'worker.mjs');
  fs.writeFileSync(workerScript, `import fs from 'node:fs';\nfs.writeFileSync(process.argv.at(-1) || 'unexpected', '{}');\n`);

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 100,
    workerScriptPath: workerScript,
    verifierScriptPath: workerScript,
    workspacePath: workspace,
    runRoot: path.join(tmp, 'run'),
    maxRuntimeMs: 200,
    globalInputs: { largePriorTranscript: 'huge context\n'.repeat(5000) },
    contextGovernorOptions: { enabled: true, hardGate: true, maxWorkerTokens: 5 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.blocker, 'context_pack_budget_exceeded');
  assert.equal(result.metrics.workerSpawnCount, 0);
  assert.equal(result.contextGovernor.budgetFailureCount > 0, true);
  assert.equal(result.contextGovernor.contextCache.uniquePackDigestCount > 0, true);
  assert.equal(fs.existsSync(path.join(tmp, 'run', 'context_governor_report.json')), true);
  assert.equal(fs.existsSync(path.join(tmp, 'run', 'wave_factpack.json')), true);
});

test('wave factpack carries compact handoff facts without transcript replay', () => {
  const queue = createPatchQueue();
  queue.merged.push({ shardId: 'alpha#1' });
  queue.rejected.push({ shardId: 'beta#1', rejectionReason: 'verifier_failed' });
  const factpack = buildWaveFactPack({
    waveNumber: 2,
    runSummary: { agentCount: 100, shardCount: 2, mergedShardCount: 1, elapsedMs: 1234 },
    patchQueue: queue,
    workerEvents: [{ type: 'live_worker_exit', shardId: 'beta#1', agentId: 'agent-7', ok: false, reason: 'exit_1' }],
    contextGovernorReport: buildContextGovernorReport({ contextPacks: [], options: { enabled: true, hardGate: true }, agentCount: 100, shardCount: 2 })
  });
  assert.equal(factpack.schemaVersion, 'clawd.wave_factpack.v1');
  assert.deepEqual(factpack.mergedShardIds, ['alpha#1']);
  assert.equal(factpack.rejectedByReason.verifier_failed, 1);
  assert.equal(factpack.nextWaveInstructions.some((line) => /transcripts/i.test(line)), true);
});

test('patch queue merge gate waits on transient ownership conflicts and passes clean patches', async () => {
  const now = Date.now();
  let leaseState = createLeaseState({ defaultTtlMs: 5000 });
  leaseState = acquireLease(leaseState, { taskId: 'conflict-task', agentId: 'agent-9', fileAreas: ['src/conflict'] }, now).state;
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'blocked-shard',
    filePaths: ['src/conflict/file.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['src/conflict/file.mjs'],
        targetModules: ['src/conflict'],
        verifierRequirements: ['tests'],
        successPredicate: ['modify src/conflict/file.mjs']
      },
      implementation: { modifiedFiles: ['src/conflict/file.mjs'] }
    }
  });
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
  const verifyFns = {
    tests: async () => ({ ok: true }),
    lint: async () => ({ ok: true })
  };
  const processed = await processPatchQueue(queue, { leaseState, verifyFns });
  assert.equal(processed.queue.rejected.length, 0);
  assert.equal(processed.queue.queued.length, 1);
  assert.equal(processed.queue.queued[0].shardId, 'blocked-shard');
  assert.equal(processed.queue.merged.length, 1);
  assert.equal(processed.queue.merged[0].shardId, 'good-shard');

  leaseState = releaseLease(leaseState, { leaseId: leaseState.tasks['conflict-task'].leaseId, agentId: 'agent-9', reason: 'completed' }).state;
  const drained = await processPatchQueue(processed.queue, { leaseState, verifyFns });
  assert.equal(drained.queue.rejected.length, 0);
  assert.equal(drained.queue.queued.length, 0);
  assert.equal(drained.queue.merged.map((patch) => patch.shardId).sort().join(','), 'blocked-shard,good-shard');
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

test('patch queue rejects marker-only product deltas even with passing verifier evidence', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'marker-only-shard',
    filePaths: ['packages/app/view.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['packages/app/view.mjs'],
        targetModules: ['packages/app/view.mjs'],
        verifierRequirements: ['tests'],
        successPredicate: ['implement product runtime behavior, not marker-only adoption']
      },
      implementation: {
        modifiedFiles: ['packages/app/view.mjs'],
        metadata: {
          claimIntegrityKind: 'marker_only_remediation_delta',
          markerOnlyProductDelta: true
        }
      }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: {
      tests: async () => ({ ok: true })
    }
  });

  assert.equal(processed.queue.merged.length, 0);
  assert.equal(processed.queue.rejected.length, 1);
  assert.equal(processed.queue.rejected[0].rejectionCategory, 'no_op');
  assert.equal(processed.queue.rejected[0].rejectionReason, 'marker_only_product_delta');
});

test('patch queue rejects semantic-bloat product deltas even with passing verifier evidence', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'focus.dashboard_home::semantic-frontier-001#01-primary_runtime_spine',
    filePaths: ['packages/app/index.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['packages/app/index.mjs'],
        targetModules: ['packages/app/index.mjs'],
        verifierRequirements: ['tests'],
        successPredicate: ['semantic architecture frontier must modify concrete runtime behavior']
      },
      contextPack: { shard: { metadata: { semanticDirector: true, architectureFrontier: true } } },
      implementation: {
        modifiedFiles: ['packages/app/index.mjs'],
        metadata: {
          claimIntegrityKind: 'semantic_bloat_delta',
          semanticBloatAudit: {
            semanticBloatSuspect: true,
            reasons: ['high_duplicate_normalized_added_line_ratio']
          },
          architectureEvidence: {
            ok: true,
            layerCount: 2,
            modifiedPrimaryRuntimeFiles: ['packages/app/index.mjs'],
            evidencePrimaryRuntimeFiles: ['packages/app/index.mjs', 'packages/app/domain-campaigns.mjs'],
            signaledFiles: ['packages/app/index.mjs', 'packages/app/domain-campaigns.mjs'],
            modifiedSignaledFiles: ['packages/app/index.mjs'],
            modifiedRequiredLayers: ['route_or_server'],
            runtimeIntegrationEvidence: { ok: true, signalCount: 2 },
            semanticBloatAudit: { semanticBloatSuspect: true },
            markerOnly: false
          }
        }
      }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: {
      tests: async () => ({ ok: true })
    }
  });

  assert.equal(processed.queue.merged.length, 0);
  assert.equal(processed.queue.rejected.length, 1);
  assert.equal(processed.queue.rejected[0].rejectionCategory, 'no_op');
  assert.equal(processed.queue.rejected[0].rejectionReason, 'semantic_bloat_product_delta');
});

test('patch queue rejects generic semantic shim product deltas when strict shim rejection is required', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'admin',
    filePaths: ['packages/app/routes/api-admin.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['packages/app/routes/api-admin.mjs'],
        targetModules: ['packages/app/routes/api-admin.mjs'],
        verifierRequirements: ['tests'],
        successPredicate: ['semantic product architecture with targeted behavior proof']
      },
      contextPack: {
        inputs: {
          productDiffMode: 'semantic_product_architecture',
          semanticProductAdmission: {
            required: true,
            rejectGenericSemanticShim: true
          }
        }
      },
      implementation: {
        modifiedFiles: ['packages/app/routes/api-admin.mjs'],
        diff: `--- a/packages/app/routes/api-admin.mjs
+++ b/packages/app/routes/api-admin.mjs
@@ semantic product architecture runtime @@
+export function semanticProductArchitectureRuntime_admin_lease_1(input = {}, context = {}) {
+  const persisted = typeof context.store?.save === 'function'
+    ? context.store.save(input)
+    : { ...input, persistenceMode: 'in_memory_semantic_benchmark' };
+  return { ok: true, persisted };
+}
+function semanticProductArchitectureFixtureState_admin_lease_1() {
+  const workspace = { id: 'workspace-1', name: 'Semantic benchmark workspace' };
+  const audience = { id: 'audience-1', name: 'Benchmark Audience' };
+  const campaign = { id: 'campaign-1', name: 'Benchmark Campaign' };
+  return { workspace, audience, campaign };
+}
+function semanticProductArchitectureFixtureRouter_admin_lease_1() {
+  const routes = [];
+  const router = { routes };
+  return router;
+}
+function semanticProductArchitectureExistingProductArgs_admin_lease_1() {
+  return [semanticProductArchitectureFixtureState_admin_lease_1()];
+}
+export function semanticProductArchitectureIntegratedCall_admin_lease_1(input = {}, context = {}) {
+  return semanticProductArchitectureRuntime_admin_lease_1(input, context);
+}
+export function semanticProductArchitectureNormalFlow_admin_lease_1(input = {}, context = {}) {
+  globalThis.__semanticProductArchitectureNormalFlowProofs ||= [];
+  globalThis.__semanticProductArchitectureNormalFlowProofs.push({ ok: true });
+  return semanticProductArchitectureIntegratedCall_admin_lease_1(input, context);
+}
+export const semanticProductArchitecturePadding_admin_lease_1 = [
+  'Semantic benchmark workspace',
+  'Benchmark Audience',
+  'Benchmark Campaign',
+  'semantic_runtime_verifier'
+];
+export const semanticProductArchitecturePadding2_admin_lease_1 = [
+  'Semantic benchmark workspace',
+  'Benchmark Audience',
+  'Benchmark Campaign',
+  'semantic_runtime_verifier'
+];
+export const semanticProductArchitecturePadding3_admin_lease_1 = [
+  'Semantic benchmark workspace',
+  'Benchmark Audience',
+  'Benchmark Campaign',
+  'semantic_runtime_verifier'
+];`,
        metadata: {
          semanticProductAdmissionRequired: true,
          architectureEvidence: {
            ok: true,
            layerCount: 2,
            modifiedPrimaryRuntimeFiles: ['packages/app/routes/api-admin.mjs'],
            evidencePrimaryRuntimeFiles: ['packages/app/routes/api-admin.mjs', 'packages/app/domain-core.mjs'],
            modifiedRequiredLayers: ['route_or_server'],
            signaledFiles: ['packages/app/routes/api-admin.mjs', 'packages/app/domain-core.mjs'],
            modifiedSignaledFiles: ['packages/app/routes/api-admin.mjs'],
            markerOnly: false,
            runtimeIntegrationEvidence: {
              ok: true,
              generatedRuntimeReferenced: true,
              existingProductCallWired: true
            }
          }
        }
      }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: {
      tests: async () => ({ ok: true })
    }
  });

  assert.equal(processed.queue.merged.length, 0);
  assert.equal(processed.queue.rejected.length, 1);
  assert.equal(processed.queue.rejected[0].rejectionCategory, 'no_op');
  assert.equal(processed.queue.rejected[0].rejectionReason, 'generic_semantic_shim_product_delta');
});

test('patch queue rejects semantic architecture claims without concrete runtime integration evidence', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'focus.reports_overview::semantic-frontier-001#18-integrated_user_path_evidence',
    filePaths: ['packages/app/routes/reports.mjs', 'packages/app/domain-commerce-revenue.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['packages/app/routes/reports.mjs', 'packages/app/domain-commerce-revenue.mjs'],
        targetModules: ['packages/app/routes/reports.mjs', 'packages/app/domain-commerce-revenue.mjs'],
        verifierRequirements: ['tests'],
        successPredicate: ['semantic architecture frontier must include concrete route and domain behavior']
      },
      contextPack: { shard: { metadata: { semanticDirector: true, architectureFrontier: true } } },
      implementation: {
        modifiedFiles: ['packages/app/routes/reports.mjs'],
        metadata: {
          architectureEvidence: {
            ok: true,
            layerCount: 2,
            modifiedPrimaryRuntimeFiles: ['packages/app/routes/reports.mjs'],
            evidencePrimaryRuntimeFiles: ['packages/app/routes/reports.mjs', 'packages/app/domain-commerce-revenue.mjs'],
            signaledFiles: ['packages/app/routes/reports.mjs', 'packages/app/domain-commerce-revenue.mjs'],
            modifiedSignaledFiles: ['packages/app/routes/reports.mjs'],
            modifiedRequiredLayers: ['route_or_server'],
            runtimeIntegrationEvidence: { ok: false, reason: 'missing_concrete_runtime_delta' },
            markerOnly: false
          }
        }
      }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: {
      tests: async () => ({ ok: true })
    }
  });

  assert.equal(processed.queue.merged.length, 0);
  assert.equal(processed.queue.rejected.length, 1);
  assert.equal(processed.queue.rejected[0].rejectionCategory, 'architecture_quality');
  assert.equal(processed.queue.rejected[0].rejectionReason, 'missing_concrete_runtime_integration_delta');
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

test('live worker farm skips rejected no-op leaves and continues to later ready work', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-noop-skip-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  fs.mkdirSync(path.join(workspaceRoot, 'modules', 'noop'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'modules', 'feature'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'modules', 'noop', 'source.mjs'), 'export const noop = false;\n');
  fs.writeFileSync(path.join(workspaceRoot, 'modules', 'feature', 'source.mjs'), 'export const parity = "pending";\n');

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true, verifier: 'tests' }));\n`);

  const implementationScript = path.join(tempRoot, 'implement-noop-then-work.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
if (assignment.shard.id === 'a-noop') {
  console.log(JSON.stringify({ ok: true, modifiedFiles: [], diffSummary: 'intentionally saturated no-op' }));
} else {
  const target = path.join(assignment.workspacePath, 'modules', 'feature', 'source.mjs');
  fs.writeFileSync(target, 'export const parity = "ready";\\n');
  console.log(JSON.stringify({ ok: true, modifiedFiles: ['modules/feature/source.mjs'], diffSummary: 'advanced later ready feature work' }));
}
`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [
      {
        id: 'a-noop',
        title: 'saturated no-op leaf',
        goal: 'already saturated work should not starve later leaves',
        lane: 'implementation',
        domain: 'parity',
        fileAreas: ['modules/noop'],
        allowedFiles: ['modules/noop/source.mjs'],
        acceptanceChecks: ['implementation reports no modified files'],
        requiredVerifiers: ['tests'],
        metadata: {
          assignmentContract: {
            artifactKind: 'product_diff',
            targetFiles: ['modules/noop/source.mjs'],
            targetModules: ['modules/noop'],
            verifierRequirements: ['tests'],
            successPredicate: ['modify modules/noop/source.mjs']
          }
        }
      },
      {
        id: 'b-feature',
        title: 'later feature leaf',
        goal: 'later ready work still runs after a no-op rejection',
        lane: 'implementation',
        domain: 'parity',
        fileAreas: ['modules/feature'],
        allowedFiles: ['modules/feature/source.mjs'],
        acceptanceChecks: ['implementation modifies feature source'],
        requiredVerifiers: ['tests'],
        metadata: {
          assignmentContract: {
            artifactKind: 'product_diff',
            targetFiles: ['modules/feature/source.mjs'],
            targetModules: ['modules/feature'],
            verifierRequirements: ['tests'],
            successPredicate: ['modify modules/feature/source.mjs']
          }
        }
      }
    ]
  };
  const surfaceMatrix = { surfaces: [{ id: 'NOOP_SKIP', label: 'No-op skip', issueIds: ['a-noop', 'b-feature'], requiredArtifacts: [] }] };

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
    maxRuntimeMs: 5000,
    pollMs: 20,
    maxSpawnsPerTick: 1,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 1, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.ok, false, 'the full run is not green because one leaf was correctly rejected');
  assert.equal(result.patchQueue.rejected.length, 1);
  assert.equal(result.patchQueue.rejected[0].shardId, 'a-noop');
  assert.equal(result.patchQueue.rejected[0].rejectionCategory, 'no_op');
  assert.equal(result.patchQueue.rejected[0].rejectionReason, 'zero_modified_files');
  assert.equal(result.patchQueue.merged.length, 1);
  assert.equal(result.patchQueue.merged[0].shardId, 'b-feature');
  assert.equal(result.patchQueue.merged[0].filePaths[0], 'modules/feature/source.mjs');
  assert.equal(result.summary.metrics.failedShards.length, 0, 'a no-op rejection is terminal for that leaf and should not be retried to attempt exhaustion');
  assert.ok(result.workerEvents.some((event) => event.type === 'no_schedulable_work_remaining'));
});

test('live worker farm treats deterministic quality-gate result failures as terminal rejections', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-quality-reject-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  fs.mkdirSync(path.join(workspaceRoot, 'modules', 'client-shell'), { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, 'modules', 'later'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'modules', 'client-shell', 'source.mjs'), 'export const shell = "thin";\n');
  fs.writeFileSync(path.join(workspaceRoot, 'modules', 'later', 'source.mjs'), 'export const later = "pending";\n');

  const fakeWorkerScript = path.join(tempRoot, 'fake-quality-worker.mjs');
  fs.writeFileSync(fakeWorkerScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
if (assignment.shard.id === 'a-quality-fail') {
  fs.writeFileSync(path.join(assignment.workspacePath, 'modules/client-shell/source.mjs'), 'export const shell = "thin-with-marker";\\n');
  fs.writeFileSync(assignment.resultPath, JSON.stringify({
    ok: false,
    shardId: assignment.shard.id,
    implementation: {
      ok: true,
      modifiedFiles: ['modules/client-shell/source.mjs'],
      diffSummary: 'implemented thin shell marker without concrete runtime',
      metadata: {
        semanticBloatAudit: {
          runtimeIntegrationEvidence: { ok: false, reason: 'missing_concrete_runtime_delta' }
        }
      }
    }
  }, null, 2));
  process.exit(1);
}
fs.writeFileSync(path.join(assignment.workspacePath, 'modules/later/source.mjs'), 'export const later = "ready";\\n');
fs.writeFileSync(assignment.resultPath, JSON.stringify({
  ok: true,
  shardId: assignment.shard.id,
  implementation: {
    ok: true,
    modifiedFiles: ['modules/later/source.mjs'],
    diffSummary: 'implemented later work'
  },
  verifierResults: [{ ok: true, verifier: 'tests' }]
}, null, 2));
`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [
      {
        id: 'a-quality-fail',
        title: 'quality-gate failed client shell leaf',
        goal: 'terminally reject deterministic worker result failures',
        lane: 'frontend_architecture',
        domain: 'parity',
        fileAreas: ['modules/client-shell'],
        allowedFiles: ['modules/client-shell/source.mjs'],
        acceptanceChecks: ['requires concrete runtime delta'],
        requiredVerifiers: ['tests']
      },
      {
        id: 'b-later',
        title: 'later ready work after quality rejection',
        goal: 'later work should still execute after deterministic quality rejection',
        lane: 'frontend_architecture',
        domain: 'parity',
        fileAreas: ['modules/later'],
        allowedFiles: ['modules/later/source.mjs'],
        acceptanceChecks: ['modifies later runtime'],
        requiredVerifiers: ['tests']
      }
    ]
  };
  const surfaceMatrix = { surfaces: [{ id: 'QUALITY_REJECT', label: 'Quality reject', issueIds: ['a-quality-fail', 'b-later'], requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 1,
    workerScriptPath: fakeWorkerScript,
    verifierScriptPath: fakeWorkerScript,
    implementationScriptPath: fakeWorkerScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 5000,
    pollMs: 20,
    maxSpawnsPerTick: 1,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 1, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.patchQueue.rejected.length, 1);
  assert.equal(result.patchQueue.rejected[0].shardId, 'a-quality-fail');
  assert.equal(result.patchQueue.rejected[0].rejectionCategory, 'quality_gate_failed');
  assert.equal(result.patchQueue.rejected[0].rejectionReason, 'missing_concrete_runtime_delta');
  assert.equal(result.patchQueue.merged.length, 1);
  assert.equal(result.patchQueue.merged[0].shardId, 'b-later');
  assert.equal(result.summary.metrics.failedShards.length, 0);
  assert.ok(result.workerEvents.some((event) => event.type === 'live_worker_result_terminal_rejection'));
});


test('live worker farm terminally rejects non-retryable creative provider stops', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-creative-provider-stop-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  fs.mkdirSync(path.join(workspaceRoot, 'modules', 'creative'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'modules/creative/source.mjs'), 'export const creative = "pending";\n');

  const fakeWorkerScript = path.join(tempRoot, 'fake-creative-provider-stop-worker.mjs');
  fs.writeFileSync(fakeWorkerScript, `
import fs from 'node:fs';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
fs.writeFileSync(assignment.resultPath, JSON.stringify({
  ok: false,
  shardId: assignment.shard.id,
  implementation: {
    ok: false,
    modifiedFiles: [],
    diffSummary: 'creative worker stopped at provider usage limit',
    metadata: {
      productDiffMode: 'creative_product_work',
      creativeWorkerEvidence: {
        retryable: false,
        budget: { stopReason: 'codex_usage_limit_observed' },
        failureReasons: ['creative_worker_command_failed']
      }
    }
  },
  verifierResults: [],
  reason: 'codex_usage_limit_observed'
}, null, 2));
process.exit(2);
`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [{
      id: 'creative-provider-stop',
      title: 'provider stop should not retry',
      goal: 'avoid useless attempts after Codex usage limit',
      lane: 'token_governance',
      domain: 'benchmark',
      fileAreas: ['modules/creative'],
      allowedFiles: ['modules/creative/source.mjs'],
      acceptanceChecks: ['do not retry provider stop'],
      requiredVerifiers: ['tests']
    }]
  };
  const surfaceMatrix = { surfaces: [{ id: 'CREATIVE_PROVIDER_STOP', label: 'Creative provider stop', issueIds: ['creative-provider-stop'], requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 1,
    workerScriptPath: fakeWorkerScript,
    verifierScriptPath: fakeWorkerScript,
    implementationScriptPath: fakeWorkerScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 5000,
    pollMs: 20,
    maxSpawnsPerTick: 1,
    maxAttemptsPerTask: 3,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 1, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.patchQueue.rejected.length, 1);
  assert.equal(result.patchQueue.rejected[0].shardId, 'creative-provider-stop');
  assert.equal(result.patchQueue.rejected[0].rejectionCategory, 'non_retryable_creative_worker_stop');
  assert.equal(result.patchQueue.rejected[0].rejectionReason, 'codex_usage_limit_observed');
  assert.equal(result.summary.metrics.failedShards.length, 0, 'provider-limit stop is terminal and should not retry to attempt exhaustion');
  assert.ok(result.workerEvents.some((event) => event.type === 'live_worker_result_terminal_rejection'));
});

test('live worker farm preserves admission failure reason over successful runtime-delta evidence', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-admission-reason-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  fs.mkdirSync(path.join(workspaceRoot, 'modules', 'client-shell'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'modules/client-shell/source.mjs'), 'export const shell = "thin";\n');

  const fakeWorkerScript = path.join(tempRoot, 'fake-admission-worker.mjs');
  fs.writeFileSync(fakeWorkerScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
fs.writeFileSync(path.join(assignment.workspacePath, 'modules/client-shell/source.mjs'), 'export const shell = "runtime-but-shallow";\\n');
fs.writeFileSync(assignment.resultPath, JSON.stringify({
  ok: false,
  shardId: assignment.shard.id,
  admissionFailure: {
    category: 'quality_gate_failed',
    reason: 'shallow_or_single_layer_semantic_patch',
    architectureEvidence: { ok: false, reason: 'shallow_or_single_layer_semantic_patch' }
  },
  implementation: {
    ok: true,
    modifiedFiles: ['modules/client-shell/source.mjs'],
    diffSummary: 'runtime-looking but architecturally shallow patch',
    metadata: {
      architectureEvidence: { ok: false, reason: 'shallow_or_single_layer_semantic_patch' },
      semanticBloatAudit: { runtimeIntegrationEvidence: { ok: true, reason: 'concrete_runtime_delta_present' } }
    }
  },
  verifierResults: [{ ok: true, verifier: 'tests' }]
}, null, 2));
process.exit(1);
`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [{
      id: 'a-shallow-architecture',
      title: 'shallow architecture result',
      goal: 'preserve the real admission failure when terminally rejected',
      lane: 'frontend_architecture',
      domain: 'parity',
      fileAreas: ['modules/client-shell'],
      allowedFiles: ['modules/client-shell/source.mjs'],
      acceptanceChecks: ['requires multi-layer architecture evidence'],
      requiredVerifiers: ['tests']
    }]
  };
  const surfaceMatrix = { surfaces: [{ id: 'ADMISSION_REASON', label: 'Admission reason', issueIds: ['a-shallow-architecture'], requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 1,
    workerScriptPath: fakeWorkerScript,
    verifierScriptPath: fakeWorkerScript,
    implementationScriptPath: fakeWorkerScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 5000,
    pollMs: 20,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 1, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.patchQueue.rejected.length, 1);
  assert.equal(result.patchQueue.rejected[0].rejectionCategory, 'quality_gate_failed');
  assert.equal(result.patchQueue.rejected[0].rejectionReason, 'shallow_or_single_layer_semantic_patch');
  assert.ok(!result.workerEvents.some((event) => event.rejectionReason === 'concrete_runtime_delta_present'));
});

test('live worker farm admits queued ownership patches before spawning overlapping follow-up work', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-overlap-run-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  const moduleRoot = path.join(workspaceRoot, 'modules', 'shared');
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'source.mjs'), 'export const markers = [];\n');

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true, verifier: process.argv[2] || 'tests' }));\n`);

  const implementationScript = path.join(tempRoot, 'implement.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignmentPath = process.argv[index + 1];
const assignment = JSON.parse(fs.readFileSync(assignmentPath, 'utf8'));
const target = path.join(assignment.workspacePath, 'modules', 'shared', 'source.mjs');
fs.appendFileSync(target, '\\nexport const ' + assignment.shard.id.replace(/[^a-zA-Z0-9_]/g, '_') + ' = true;\\n');
console.log(JSON.stringify({ ok: true, modifiedFiles: [path.relative(assignment.workspacePath, target)], diffSummary: 'updated shared module for ' + assignment.shard.id }));
`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [
      {
        id: 'shared-a',
        title: 'shared A',
        goal: 'update shared module A',
        lane: 'implementation',
        domain: 'parity',
        fileAreas: ['modules/shared'],
        allowedFiles: ['modules/shared/source.mjs'],
        acceptanceChecks: ['shared A verifier passes'],
        requiredVerifiers: ['tests']
      },
      {
        id: 'shared-b',
        title: 'shared B',
        goal: 'update shared module B',
        lane: 'implementation',
        domain: 'parity',
        fileAreas: ['modules/shared'],
        allowedFiles: ['modules/shared/source.mjs'],
        acceptanceChecks: ['shared B verifier passes'],
        requiredVerifiers: ['tests']
      }
    ]
  };
  const surfaceMatrix = { surfaces: [{ id: 'SHARED', label: 'Shared parity', issueIds: ['shared-a', 'shared-b'], requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 2,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: verifierScript,
    implementationScriptPath: implementationScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 20000,
    pollMs: 20,
    maxSpawnsPerTick: 2,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 1, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.patchQueue.rejected.length, 0);
  assert.equal(result.patchQueue.merged.length, 2);
  assert.equal(result.metrics.stateLossEvents, 0);
});

test('live worker farm treats allowedFiles as lease ownership to prevent shared-file concurrent writes', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-allowed-file-lease-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  const moduleRoot = path.join(workspaceRoot, 'modules', 'shared');
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'source.mjs'), 'export const markers = [];\n');

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true }));\n`);

  const implementationScript = path.join(tempRoot, 'implement-locking.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
const lock = path.join(assignment.workspacePath, 'modules', 'shared', '.active-writer');
const violation = path.join(assignment.workspacePath, 'modules', 'shared', 'violation.txt');
if (fs.existsSync(lock)) fs.writeFileSync(violation, 'concurrent-write');
fs.writeFileSync(lock, assignment.shard.id);
await new Promise((resolve) => setTimeout(resolve, 250));
const target = path.join(assignment.workspacePath, 'modules', 'shared', 'source.mjs');
fs.appendFileSync(target, '\\nexport const ' + assignment.shard.id.replace(/[^a-zA-Z0-9_]/g, '_') + ' = true;\\n');
fs.rmSync(lock, { force: true });
console.log(JSON.stringify({ ok: true, modifiedFiles: ['modules/shared/source.mjs'], diffSummary: 'updated shared allowed file for ' + assignment.shard.id }));
`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [
      {
        id: 'shared-allowed-a',
        title: 'shared allowed A',
        goal: 'update shared file A',
        lane: 'implementation',
        domain: 'parity',
        fileAreas: ['modules/a-only'],
        allowedFiles: ['modules/shared/source.mjs'],
        acceptanceChecks: ['shared A verifier passes'],
        requiredVerifiers: ['tests']
      },
      {
        id: 'shared-allowed-b',
        title: 'shared allowed B',
        goal: 'update shared file B',
        lane: 'implementation',
        domain: 'parity',
        fileAreas: ['modules/b-only'],
        allowedFiles: ['modules/shared/source.mjs'],
        acceptanceChecks: ['shared B verifier passes'],
        requiredVerifiers: ['tests']
      }
    ]
  };
  const surfaceMatrix = { surfaces: [{ id: 'SHARED_ALLOWED', label: 'Shared allowed file parity', issueIds: ['shared-allowed-a', 'shared-allowed-b'], requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 2,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: verifierScript,
    implementationScriptPath: implementationScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 20000,
    pollMs: 20,
    maxSpawnsPerTick: 2,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 1, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.patchQueue.merged.length, 2);
  assert.equal(fs.existsSync(path.join(moduleRoot, 'violation.txt')), false, 'shared allowed file should not be written concurrently');
});

test('live worker farm scans past currently conflicting ready shards to keep independent agents busy', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-scan-past-conflict-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  for (const relPath of ['modules/shared/source.mjs', 'modules/independent/source.mjs']) {
    fs.mkdirSync(path.dirname(path.join(workspaceRoot, relPath)), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, relPath), 'export const seed = true;\n');
  }

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true }));\n`);
  const implementationScript = path.join(tempRoot, 'implement-scan.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
await new Promise((resolve) => setTimeout(resolve, 300));
const targetRel = assignment.shard.allowedFiles[0];
fs.appendFileSync(path.join(assignment.workspacePath, targetRel), '\\nexport const ' + assignment.shard.id.replace(/[^a-zA-Z0-9_]/g, '_') + ' = true;\\n');
console.log(JSON.stringify({ ok: true, modifiedFiles: [targetRel], diffSummary: 'updated ' + targetRel }));
`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [
      {
        id: 'a-shared-first',
        title: 'shared first',
        goal: 'hold shared ownership first',
        lane: 'same-lane',
        domain: 'same-domain',
        fileAreas: ['modules/shared'],
        allowedFiles: ['modules/shared/source.mjs'],
        acceptanceChecks: ['shared first done'],
        requiredVerifiers: ['tests']
      },
      {
        id: 'b-shared-conflicts',
        title: 'shared conflicting second',
        goal: 'should not waste the second free agent while shared is leased',
        lane: 'same-lane',
        domain: 'same-domain',
        fileAreas: ['modules/shared'],
        allowedFiles: ['modules/shared/source.mjs'],
        acceptanceChecks: ['shared second done'],
        requiredVerifiers: ['tests']
      },
      {
        id: 'c-independent-ready',
        title: 'independent ready work',
        goal: 'should spawn immediately even though the previous ready shard conflicts',
        lane: 'same-lane',
        domain: 'same-domain',
        fileAreas: ['modules/independent'],
        allowedFiles: ['modules/independent/source.mjs'],
        acceptanceChecks: ['independent done'],
        requiredVerifiers: ['tests']
      }
    ]
  };
  const surfaceMatrix = { surfaces: [{ id: 'SCAN_PAST_CONFLICT', label: 'Scan past conflict', issueIds: workGraph.workUnits.map((unit) => unit.id), requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 2,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: verifierScript,
    implementationScriptPath: implementationScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 20000,
    pollMs: 20,
    maxSpawnsPerTick: 2,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 1, maxAcceptanceChecksPerShard: 1 }
  });

  const firstTwoSpawnIds = result.workerEvents.filter((event) => event.type === 'live_worker_spawned').slice(0, 2).map((event) => event.shardId);
  assert.deepEqual(firstTwoSpawnIds, ['a-shared-first', 'c-independent-ready']);
  assert.equal(result.ok, true);
  assert.equal(result.patchQueue.merged.length, 3);
});

test('live worker farm uses primary source product files for continuation adoption leases instead of broad hot allowed files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-primary-source-lease-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  for (const relPath of ['packages/app/domain-a.mjs', 'packages/app/domain-b.mjs', 'packages/app/storage.mjs', 'packages/app/view.mjs']) {
    fs.mkdirSync(path.dirname(path.join(workspaceRoot, relPath)), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, relPath), `export const seed = ${JSON.stringify(relPath)};\n`);
  }

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true }));\n`);
  const implementationScript = path.join(tempRoot, 'implement-primary-source.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
const targetRel = assignment.shard.metadata.sourceProductFile;
await new Promise((resolve) => setTimeout(resolve, 300));
fs.appendFileSync(path.join(assignment.workspacePath, targetRel), '\\nexport const ' + assignment.shard.id.replace(/[^a-zA-Z0-9_]/g, '_') + ' = true;\\n');
console.log(JSON.stringify({ ok: true, modifiedFiles: [targetRel], diffSummary: 'updated primary source file ' + targetRel }));
`);

  const broadAllowedFiles = ['packages/app/domain-a.mjs', 'packages/app/domain-b.mjs', 'packages/app/storage.mjs', 'packages/app/view.mjs'];
  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [
      {
        id: 'focus.surface_a::continuation-001#1',
        title: 'surface A continuation primary runtime adoption',
        goal: 'update surface A primary runtime source',
        lane: 'continuation',
        domain: 'mailchimp',
        fileAreas: ['packages/app'],
        allowedFiles: broadAllowedFiles,
        acceptanceChecks: ['primary source A updated'],
        requiredVerifiers: ['tests'],
        metadata: {
          continuationFullClone: true,
          primaryProductAdoptionRequired: true,
          sourceProductFile: 'packages/app/domain-a.mjs',
          sourceProductFiles: ['packages/app/domain-a.mjs'],
          primaryAdoptionFiles: broadAllowedFiles
        }
      },
      {
        id: 'focus.surface_b::continuation-001#1',
        title: 'surface B continuation primary runtime adoption',
        goal: 'update surface B primary runtime source',
        lane: 'continuation',
        domain: 'mailchimp',
        fileAreas: ['packages/app'],
        allowedFiles: broadAllowedFiles,
        acceptanceChecks: ['primary source B updated'],
        requiredVerifiers: ['tests'],
        metadata: {
          continuationFullClone: true,
          primaryProductAdoptionRequired: true,
          sourceProductFile: 'packages/app/domain-b.mjs',
          sourceProductFiles: ['packages/app/domain-b.mjs'],
          primaryAdoptionFiles: broadAllowedFiles
        }
      }
    ]
  };
  const surfaceMatrix = { surfaces: [{ id: 'PRIMARY_SOURCE_LEASES', label: 'Primary source leases', issueIds: workGraph.workUnits.map((unit) => unit.id), requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 2,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: verifierScript,
    implementationScriptPath: implementationScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 20000,
    pollMs: 20,
    maxSpawnsPerTick: 2,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.patchQueue.merged.length, 2);
  assert.ok(result.metrics.peakConcurrentWorkers >= 2, `expected source-file lease narrowing to permit concurrent primary adoption work, got ${result.metrics.peakConcurrentWorkers}`);
});

test('live worker farm rotates broad primary-adoption lease targets across hot Mailchimp layers', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-rotated-primary-leases-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  const broadAllowedFiles = [
    'apps/web/public/app-shell-client.mjs',
    'apps/web/public/app-shell.css',
    'apps/web/public/app-shell.jsx',
    'apps/web/server.mjs',
    'packages/app/view.mjs',
    'packages/app/routes/public.mjs',
    'packages/app/routes/api-admin.mjs',
    'packages/app/domain-current-product-ops.mjs',
    'packages/app/domain-website-builder.mjs',
    'packages/app/persistence-io.mjs',
    'packages/app/storage.mjs',
    'packages/app/job-handlers.mjs'
  ];
  for (const relPath of broadAllowedFiles) {
    fs.mkdirSync(path.dirname(path.join(workspaceRoot, relPath)), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, relPath), `export const seed = ${JSON.stringify(relPath)};\n`);
  }

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true }));\n`);
  const implementationScript = path.join(tempRoot, 'implement-lease-target.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
const targetRel = assignment.lease.fileAreas[0] || assignment.shard.allowedFiles[0];
await new Promise((resolve) => setTimeout(resolve, 250));
const symbolName = assignment.shard.id.replace(/[^a-zA-Z0-9_]/g, '_');
const addedLine = 'export function ' + symbolName + '_runtimeEvidence() { return { target: ' + JSON.stringify(targetRel) + ', shard: ' + JSON.stringify(assignment.shard.id) + ' }; }';
fs.appendFileSync(path.join(assignment.workspacePath, targetRel), '\\n' + addedLine + '\\n');
const evidenceFile = assignment.shard.allowedFiles.find((filePath) => filePath !== targetRel) || targetRel;
console.log(JSON.stringify({
  ok: true,
  modifiedFiles: [targetRel],
  diffSummary: 'updated rotated lease target ' + targetRel,
  diff: 'diff --git a/' + targetRel + ' b/' + targetRel + '\\n@@\\n+' + addedLine + '\\n',
  metadata: {
    architectureEvidence: {
      ok: true,
      layerCount: 2,
      modifiedPrimaryRuntimeFiles: [targetRel],
      evidencePrimaryRuntimeFiles: [targetRel, evidenceFile],
      modifiedRequiredLayers: ['runtime_layer'],
      signaledFiles: [targetRel, evidenceFile],
      modifiedSignaledFiles: [targetRel],
      runtimeIntegrationEvidence: { ok: true },
      semanticBloatAudit: { semanticBloatSuspect: false }
    }
  }
}));
`);

  const workUnits = Array.from({ length: 16 }, (_, index) => {
    const phase = ['primary_runtime_spine', 'interactive_state_and_commands', 'operational_persistence_and_jobs', 'integrated_user_path_evidence'][index % 4];
    return {
      id: `focus.synthetic_mailchimp_surface_${index + 1}::semantic-frontier-001#${String(index + 1).padStart(2, '0')}-${phase}`,
      title: `Synthetic Mailchimp surface ${index + 1}`,
      goal: 'exercise broad primary product adoption scheduling without collapsing onto the same hot shell files',
      lane: `surface_${index + 1}`,
      domain: 'mailchimp',
      fileAreas: ['packages/app'],
      allowedFiles: broadAllowedFiles,
      acceptanceChecks: ['rotated lease target updated'],
      requiredVerifiers: ['tests'],
      metadata: {
        continuationFullClone: true,
        primaryProductAdoptionRequired: true,
        semanticPhaseId: phase,
        focusId: `focus.synthetic_mailchimp_surface_${index + 1}`,
        primaryAdoptionFiles: broadAllowedFiles,
        assignmentContract: {
          artifactKind: 'product_diff',
          targetFiles: broadAllowedFiles,
          targetModules: ['packages/app'],
          verifierRequirements: ['tests'],
          successPredicate: ['rotated lease target updated']
        }
      }
    };
  });
  const surfaceMatrix = { surfaces: [{ id: 'ROTATED_PRIMARY_LEASES', label: 'Rotated primary leases', issueIds: workUnits.map((unit) => unit.id), requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph: { targetPath: workspaceRoot, workUnits },
    surfaceMatrix,
    agentCount: 16,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: verifierScript,
    implementationScriptPath: implementationScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 30000,
    pollMs: 20,
    maxSpawnsPerTick: 16,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: broadAllowedFiles.length, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.patchQueue.merged.length, 16);
  assert.ok(result.metrics.peakConcurrentWorkers >= 7, `expected rotated lease targets to prove at least 7 concurrent workers, got ${result.metrics.peakConcurrentWorkers}`);
  assert.ok(result.metrics.observedAgentCount >= 7, `expected rotated lease targets to use at least 7 agents, got ${result.metrics.observedAgentCount}`);
});

test('isolated worker workspaces decouple high-scale launch concurrency from hot file leases and promote additive deltas', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-isolated-hot-file-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'src', 'shared.mjs'), 'export const base = true;\n');

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true }));\n`);
  const implementationScript = path.join(tempRoot, 'implement-isolated-hot-file.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
await new Promise((resolve) => setTimeout(resolve, 250));
const target = path.join(assignment.workspacePath, 'src/shared.mjs');
const symbolName = assignment.shard.id.replace(/[^a-zA-Z0-9_]/g, '_');
const line = 'export const ' + symbolName + ' = ' + JSON.stringify(assignment.agentId) + ';';
fs.appendFileSync(target, line + '\\n');
console.log(JSON.stringify({ ok: true, modifiedFiles: ['src/shared.mjs'], diffSummary: 'isolated hot-file additive delta ' + assignment.shard.id, diff: 'diff --git a/src/shared.mjs b/src/shared.mjs\\n@@\\n+' + line + '\\n' }));
`);

  const workUnits = Array.from({ length: 12 }, (_, index) => ({
    id: `hot-file-${index + 1}`,
    title: `Hot file shard ${index + 1}`,
    goal: 'prove isolated workers can run concurrently while targeting one hot product file',
    lane: 'hot_file_parallelism',
    domain: 'scheduler',
    fileAreas: ['src/shared.mjs'],
    allowedFiles: ['src/shared.mjs'],
    acceptanceChecks: ['append one additive runtime line'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['src/shared.mjs'],
        targetModules: ['src'],
        verifierRequirements: ['tests'],
        successPredicate: ['append one additive runtime line']
      }
    }
  }));

  const result = await runLiveWorkerFarm({
    workGraph: { targetPath: workspaceRoot, workUnits },
    surfaceMatrix: { surfaces: [{ id: 'HOT_FILE_PARALLELISM', label: 'Hot file parallelism', issueIds: workUnits.map((unit) => unit.id), requiredArtifacts: [] }] },
    agentCount: 12,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: verifierScript,
    implementationScriptPath: implementationScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 30000,
    pollMs: 20,
    maxSpawnsPerTick: 12,
    workerWorkspaceMode: 'isolated_copy',
    workerWorkspaceCopyPaths: ['src'],
    promoteMergedWorkerWorkspaceChanges: true,
    canonicalLandingEvidence: true,
    landingEvidencePolicy: { mode: 'block_on_failed_landing', productPaths: ['src/shared.mjs'] },
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 1, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.patchQueue.merged.length, 12);
  assert.equal(result.patchQueue.rejected.length, 0);
  assert.ok(result.metrics.peakConcurrentWorkers >= 10, `expected isolated mode to spawn the hot-file burst concurrently, got ${result.metrics.peakConcurrentWorkers}`);
  assert.equal(result.metrics.workerWorkspaceMode, 'isolated_copy');
  assert.equal(result.patchQueue.merged.every((patch) => patch.workspacePromotionRecord?.ok === true), true);
  assert.equal(result.patchQueue.merged.every((patch) => patch.canonicalLandingRecord?.eligible === true), true);
  assert.equal(result.landingEvidence?.summary?.status, 'green');
  const finalText = fs.readFileSync(path.join(workspaceRoot, 'src', 'shared.mjs'), 'utf8');
  for (const unit of workUnits) assert.match(finalText, new RegExp(unit.id.replace(/-/g, '_')));
});

test('isolated worker promotion appends whole suffix blocks instead of dropping duplicate syntax lines', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-isolated-suffix-block-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, 'src', 'shared.mjs'), 'export const base = true;\n');

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true }));\n`);
  const implementationScript = path.join(tempRoot, 'implement-suffix-block.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
const target = path.join(assignment.workspacePath, 'src/shared.mjs');
const symbolName = assignment.shard.id.replace(/[^a-zA-Z0-9_]/g, '_');
const block = [
  'export function ' + symbolName + '() {',
  '  const shared = true;',
  '  return { ok: shared };',
  '}',
  ''
].join('\\n');
fs.appendFileSync(target, block);
console.log(JSON.stringify({ ok: true, modifiedFiles: ['src/shared.mjs'], diffSummary: 'append suffix block ' + assignment.shard.id }));
`);

  const workUnits = Array.from({ length: 4 }, (_, index) => ({
    id: `suffix-block-${index + 1}`,
    title: `Suffix block shard ${index + 1}`,
    goal: 'prove isolated worker promotion preserves complete syntax blocks when many shards append duplicate braces',
    lane: 'suffix_block_parallelism',
    domain: 'scheduler',
    fileAreas: ['src/shared.mjs'],
    allowedFiles: ['src/shared.mjs'],
    acceptanceChecks: ['append one complete exported function block'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['src/shared.mjs'],
        targetModules: ['src'],
        verifierRequirements: ['tests'],
        successPredicate: ['append one complete exported function block']
      }
    }
  }));

  const result = await runLiveWorkerFarm({
    workGraph: { targetPath: workspaceRoot, workUnits },
    surfaceMatrix: { surfaces: [{ id: 'SUFFIX_BLOCK_PARALLELISM', label: 'Suffix block parallelism', issueIds: workUnits.map((unit) => unit.id), requiredArtifacts: [] }] },
    agentCount: 4,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: verifierScript,
    implementationScriptPath: implementationScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 30000,
    pollMs: 20,
    maxSpawnsPerTick: 4,
    workerWorkspaceMode: 'isolated_copy',
    workerWorkspaceCopyPaths: ['src'],
    promoteMergedWorkerWorkspaceChanges: true,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 1, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.patchQueue.merged.length, 4);
  assert.equal(result.patchQueue.rejected.length, 0);
  const finalFile = path.join(workspaceRoot, 'src', 'shared.mjs');
  const syntax = spawnSync(process.execPath, ['--check', finalFile], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
  const finalText = fs.readFileSync(finalFile, 'utf8');
  for (const unit of workUnits) assert.match(finalText, new RegExp(`function ${unit.id.replace(/-/g, '_')}`));
});

test('live worker farm rotates agent ids across short tasks instead of reusing the first idle workers', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-agent-rotation-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
  for (let index = 1; index <= 12; index += 1) {
    fs.writeFileSync(path.join(workspaceRoot, 'src', `feature-${index}.mjs`), `export const feature${index} = false;\n`);
  }

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true }));\n`);
  const implementationScript = path.join(tempRoot, 'implement.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
const targetRel = assignment.shard.allowedFiles[0];
fs.writeFileSync(path.join(assignment.workspacePath, targetRel), 'export const completed = true;\\n');
console.log(JSON.stringify({ ok: true, modifiedFiles: [targetRel], diffSummary: 'completed ' + assignment.shard.id }));
`);
  const workUnits = Array.from({ length: 12 }, (_, index) => ({
    id: `feature-${index + 1}`,
    title: `Feature ${index + 1}`,
    goal: 'exercise short task agent rotation',
    lane: `lane-${index + 1}`,
    domain: 'rotation',
    fileAreas: [`src/feature-${index + 1}.mjs`],
    allowedFiles: [`src/feature-${index + 1}.mjs`],
    acceptanceChecks: ['short task completes'],
    requiredVerifiers: ['tests']
  }));
  const surfaceMatrix = { surfaces: [{ id: 'ROTATION', label: 'Rotation', issueIds: workUnits.map((unit) => unit.id), requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph: { targetPath: workspaceRoot, workUnits },
    surfaceMatrix,
    agentCount: 8,
    workerScriptPath: WORKER_SCRIPT,
    verifierScriptPath: verifierScript,
    implementationScriptPath: implementationScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 30000,
    pollMs: 20,
    maxSpawnsPerTick: 2,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 1, maxAcceptanceChecksPerShard: 1 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.patchQueue.merged.length, 12);
  assert.ok(result.metrics.observedAgentCount >= 8, `expected short-task waves to rotate through all 8 agents, got ${result.metrics.observedAgentCount}`);
  assert.equal(result.metrics.agentDispatchPolicy, 'prefer_unobserved_then_least_recently_dispatched');
});

test('live worker farm renews leases for long-running implementation workers', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-implement-slow-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  const moduleRoot = path.join(workspaceRoot, 'modules', 'feature-a');
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'source.mjs'), 'export const parity = "not-ready";\n');

  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true }));\n`);
  const implementationScript = path.join(tempRoot, 'implement-slow.mjs');
  fs.writeFileSync(implementationScript, `
import fs from 'node:fs';
import path from 'node:path';
await new Promise((resolve) => setTimeout(resolve, 1500));
const index = process.argv.indexOf('--assignment');
const assignment = JSON.parse(fs.readFileSync(process.argv[index + 1], 'utf8'));
const target = path.join(assignment.workspacePath, 'modules', 'feature-a', 'source.mjs');
fs.writeFileSync(target, 'export const parity = "ready";\\n');
console.log(JSON.stringify({ ok: true, modifiedFiles: ['modules/feature-a/source.mjs'], diffSummary: 'slow worker completed after lease renewal' }));
`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [{
      id: 'feature-a.impl',
      title: 'feature-a implementation',
      goal: 'complete after the initial lease TTL',
      lane: 'implementation',
      domain: 'parity',
      fileAreas: ['modules/feature-a'],
      allowedFiles: ['modules/feature-a/source.mjs'],
      acceptanceChecks: ['implementation succeeds'],
      requiredVerifiers: ['tests']
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
    leaseTtlMs: 500,
    maxRuntimeMs: 10000,
    pollMs: 20,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 4 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.metrics.staleLeaseCount, 0);
  assert.equal(result.metrics.lateResultsIgnored, 0);
  assert.equal(result.patchQueue.merged.length, 1);
  assert.ok(result.artifactBus.events.some((event) => event.type === 'live_worker_lease_renewed'));
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
  assert.equal(result.summary.metrics.stateLossEvents, 0, 'attempt exhaustion is a worker/verifier failure, not continuity loss for every unattempted shard');
});

test('live worker farm times out wedged workers and writes terminal artifacts', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-worker-timeout-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  const moduleRoot = path.join(workspaceRoot, 'modules', 'feature-timeout');
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'source.mjs'), 'export const parity = "pending";\n');

  const wedgedWorker = path.join(tempRoot, 'wedged-worker.mjs');
  fs.writeFileSync(wedgedWorker, `setInterval(() => {}, 1000);\n`);
  const verifierScript = path.join(tempRoot, 'verifier.mjs');
  fs.writeFileSync(verifierScript, `console.log(JSON.stringify({ ok: true }));\n`);

  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [{
      id: 'feature-timeout.impl',
      title: 'feature-timeout implementation',
      goal: 'time out a wedged worker process',
      lane: 'implementation',
      domain: 'parity',
      fileAreas: ['modules/feature-timeout'],
      allowedFiles: ['modules/feature-timeout/source.mjs'],
      acceptanceChecks: ['implementation completes'],
      requiredVerifiers: ['tests'],
      metadata: {
        assignmentContract: {
          artifactKind: 'product_diff',
          targetFiles: ['modules/feature-timeout/source.mjs'],
          targetModules: ['modules/feature-timeout'],
          verifierRequirements: ['tests'],
          successPredicate: ['modify modules/feature-timeout/source.mjs']
        }
      }
    }]
  };
  const surfaceMatrix = { surfaces: [{ id: 'FEATURE_TIMEOUT', label: 'Feature timeout parity', issueIds: ['feature-timeout.impl'], requiredArtifacts: [] }] };

  const result = await runLiveWorkerFarm({
    workGraph,
    surfaceMatrix,
    agentCount: 1,
    workerScriptPath: wedgedWorker,
    verifierScriptPath: verifierScript,
    workspacePath: workspaceRoot,
    runRoot,
    leaseTtlMs: 1000,
    maxRuntimeMs: 5000,
    workerTimeoutMs: 80,
    workerKillGraceMs: 250,
    maxAttemptsPerTask: 1,
    pollMs: 20,
    plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 4 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.metrics.workerTimeoutCount, 1);
  assert.equal(result.metrics.workerExitFailures, 1);
  assert.equal(result.summary.metrics.failedShards.length, 1);
  assert.ok(fs.existsSync(path.join(runRoot, 'summary.json')));
  assert.ok(fs.existsSync(path.join(runRoot, 'supervisor.json')));
  const events = JSON.parse(fs.readFileSync(path.join(runRoot, 'worker_events.json'), 'utf8'));
  assert.ok(events.some((event) => event.type === 'live_worker_timeout' && event.shardId === 'feature-timeout.impl'));
});

test('live worker farm records worker spawn errors instead of crashing the controller', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-stack-spawn-error-'));
  const previousNodeBinary = process.env.ORCHESTRATOR_NODE_BINARY;
  process.env.ORCHESTRATOR_NODE_BINARY = path.join(tempRoot, 'missing-node');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const runRoot = path.join(tempRoot, 'runs');
  const moduleRoot = path.join(workspaceRoot, 'modules', 'feature-a');
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.writeFileSync(path.join(moduleRoot, 'source.mjs'), 'export const parity = "pending";\n');
  const workGraph = {
    targetPath: workspaceRoot,
    workUnits: [{
      id: 'feature-a.impl',
      title: 'feature-a implementation',
      goal: 'surface spawn failures as worker failures',
      lane: 'implementation',
      domain: 'parity',
      fileAreas: ['modules/feature-a'],
      allowedFiles: ['modules/feature-a/source.mjs'],
      acceptanceChecks: ['implementation succeeds'],
      requiredVerifiers: ['tests'],
      metadata: {
        assignmentContract: {
          artifactKind: 'product_diff',
          targetFiles: ['modules/feature-a/source.mjs'],
          targetModules: ['modules/feature-a'],
          verifierRequirements: ['tests'],
          successPredicate: ['modify modules/feature-a/source.mjs']
        }
      }
    }]
  };
  const surfaceMatrix = { surfaces: [{ id: 'FEATURE_A', label: 'Feature A parity', issueIds: ['feature-a.impl'], requiredArtifacts: [] }] };

  try {
    const result = await runLiveWorkerFarm({
      workGraph,
      surfaceMatrix,
      agentCount: 1,
      workerScriptPath: WORKER_SCRIPT,
      verifierScriptPath: VERIFIER_SCRIPT,
      workspacePath: workspaceRoot,
      runRoot,
      leaseTtlMs: 1000,
      maxRuntimeMs: 5000,
      maxAttemptsPerTask: 1,
      pollMs: 20,
      plannerOptions: { maxFileAreasPerShard: 1, maxFilesPerShard: 4, maxAcceptanceChecksPerShard: 4 }
    });

    assert.equal(result.ok, false);
    assert.equal(result.metrics.workerSpawnFailures, 1);
    assert.equal(result.summary.metrics.failedShards.length, 1);
    const events = JSON.parse(fs.readFileSync(path.join(runRoot, 'worker_events.json'), 'utf8'));
    const failedExit = events.find((event) => event.type === 'live_worker_exit' && event.ok === false);
    assert.equal(failedExit?.spawnError?.code, 'ENOENT');
  } finally {
    if (previousNodeBinary === undefined) delete process.env.ORCHESTRATOR_NODE_BINARY;
    else process.env.ORCHESTRATOR_NODE_BINARY = previousNodeBinary;
  }
});

test('semantic frontier patch queue rejects shallow single-layer architecture evidence', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'focus.frontend_client_shell_state::semantic-frontier-001#01-interactive_state_and_commands',
    filePaths: ['packages/app/routes/public.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      contextPack: { shard: { metadata: { semanticDirector: true, architectureFrontier: true } } },
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['packages/app/routes/public.mjs'],
        targetModules: ['packages/app/routes/public.mjs'],
        verifierRequirements: ['tests'],
        successPredicate: ['Wire architecture into a primary runtime route']
      },
      implementation: {
        modifiedFiles: ['packages/app/routes/public.mjs'],
        metadata: {
          architectureEvidence: {
            ok: false,
            modifiedPrimaryRuntimeFiles: ['packages/app/routes/public.mjs'],
            layerCount: 1,
            signaledFiles: ['packages/app/routes/public.mjs'],
            markerOnly: false,
            reason: 'shallow_or_single_layer_semantic_patch'
          }
        }
      }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: { tests: async () => ({ ok: true }) }
  });

  assert.equal(processed.queue.merged.length, 0);
  assert.equal(processed.queue.rejected.length, 1);
  assert.equal(processed.queue.rejected[0].rejectionCategory, 'architecture_quality');
  assert.equal(processed.queue.rejected[0].rejectionReason, 'shallow_or_single_layer_semantic_patch');
});

test('semantic frontier patch queue admits multi-layer architecture evidence', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'focus.frontend_client_shell_state::semantic-frontier-001#01-interactive_state_and_commands',
    filePaths: ['apps/web/public/app-shell.jsx', 'packages/app/routes/public.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      contextPack: { shard: { metadata: { semanticDirector: true, architectureFrontier: true } } },
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['apps/web/public/app-shell.jsx', 'packages/app/routes/public.mjs'],
        targetModules: ['apps/web/public/app-shell.jsx', 'packages/app/routes/public.mjs'],
        verifierRequirements: ['tests'],
        successPredicate: ['Wire architecture into a primary runtime route and shell']
      },
      implementation: {
        modifiedFiles: ['apps/web/public/app-shell.jsx', 'packages/app/routes/public.mjs'],
        metadata: {
          architectureEvidence: {
            ok: true,
            modifiedPrimaryRuntimeFiles: ['apps/web/public/app-shell.jsx', 'packages/app/routes/public.mjs'],
            layerCount: 2,
            layers: ['client_shell', 'route_or_server'],
            signaledFiles: ['apps/web/public/app-shell.jsx', 'packages/app/routes/public.mjs'],
            runtimeIntegrationEvidence: {
              ok: true,
              files: ['apps/web/public/app-shell.jsx', 'packages/app/routes/public.mjs'],
              signalCount: 3,
              reason: 'concrete_runtime_delta_present'
            },
            markerOnly: false,
            reason: 'semantic_architecture_gate_passed'
          }
        }
      }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: { tests: async () => ({ ok: true }) }
  });

  assert.equal(processed.queue.rejected.length, 0);
  assert.equal(processed.queue.merged.length, 1);
  assert.equal(processed.queue.merged[0].admissionAudit.architectureAdmission.required, true);
});

test('non-semantic continuation patches are not rejected for missing semantic architecture evidence', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'focus.ai_predictive_ops_realism::continuation-001#21#1',
    filePaths: ['packages/app/ai-provider.mjs', 'packages/app/predictive-model.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      contextPack: { shard: { metadata: { focusGroup: 'ai_predictive' } } },
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['packages/app/ai-provider.mjs', 'packages/app/predictive-model.mjs'],
        targetModules: ['packages/app/ai-provider.mjs', 'packages/app/predictive-model.mjs'],
        verifierRequirements: ['tests'],
        successPredicate: ['Implement API rate limit webhook delivery runtime behavior']
      },
      implementation: {
        modifiedFiles: ['packages/app/ai-provider.mjs', 'packages/app/predictive-model.mjs'],
        metadata: { architectureEvidence: null }
      }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: { tests: async () => ({ ok: true }) }
  });

  assert.equal(processed.queue.rejected.length, 0);
  assert.equal(processed.queue.merged.length, 1);
  assert.equal(processed.queue.merged[0].admissionAudit.architectureAdmission.required, false);
});

test('semantic frontier patch queue admits incremental patches backed by adopted primary runtime evidence', async () => {
  let queue = createPatchQueue();
  queue = enqueuePatch(queue, {
    shardId: 'focus.signup_forms_popups::semantic-frontier-001#07-operational_persistence_and_jobs',
    filePaths: ['packages/app/jobs.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      contextPack: { shard: { metadata: { semanticDirector: true, architectureFrontier: true } } },
      assignmentContract: {
        artifactKind: 'product_diff',
        targetFiles: ['packages/app/domain-growth.mjs', 'packages/app/jobs.mjs'],
        targetModules: ['packages/app/domain-growth.mjs', 'packages/app/jobs.mjs'],
        verifierRequirements: ['tests'],
        successPredicate: ['Wire persistence and jobs into primary runtime architecture']
      },
      implementation: {
        modifiedFiles: ['packages/app/jobs.mjs'],
        metadata: {
          architectureEvidence: {
            ok: true,
            phaseId: 'operational_persistence_and_jobs',
            modifiedPrimaryRuntimeFiles: ['packages/app/jobs.mjs'],
            adoptedPrimaryRuntimeFiles: ['packages/app/domain-growth.mjs', 'packages/app/jobs.mjs'],
            evidencePrimaryRuntimeFiles: ['packages/app/domain-growth.mjs', 'packages/app/jobs.mjs'],
            layerCount: 2,
            layers: ['domain_or_persistence', 'jobs_runtime'],
            modifiedLayers: ['jobs_runtime'],
            requiredLayers: ['domain_or_persistence', 'jobs_runtime'],
            presentRequiredLayers: ['domain_or_persistence', 'jobs_runtime'],
            modifiedRequiredLayers: ['jobs_runtime'],
            signaledFiles: ['packages/app/domain-growth.mjs', 'packages/app/jobs.mjs'],
            modifiedSignaledFiles: ['packages/app/jobs.mjs'],
            runtimeIntegrationEvidence: {
              ok: true,
              files: ['packages/app/jobs.mjs'],
              signalCount: 2,
              reason: 'concrete_runtime_delta_present'
            },
            markerOnly: false,
            reason: 'semantic_architecture_gate_passed'
          }
        }
      }
    }
  });

  const processed = await processPatchQueue(queue, {
    verifyFns: { tests: async () => ({ ok: true }) }
  });

  assert.equal(processed.queue.rejected.length, 0);
  assert.equal(processed.queue.merged.length, 1);
  assert.equal(processed.queue.merged[0].admissionAudit.architectureAdmission.required, true);
});
