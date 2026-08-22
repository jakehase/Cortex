import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileObjective, deriveSemanticWorkforcePlan } from '../packages/canonical-agent-work/index.mjs';
import { compileAgentWorkSpec } from '../packages/agent-work-dsl/index.mjs';

function items(count, prefix = 'src') {
  return Array.from({ length: count }, (_, index) => ({
    id: `surface_${index + 1}`,
    allowedFiles: [`${prefix}/surface-${index + 1}.mjs`],
    verification: [`node --check ${prefix}/surface-${index + 1}.mjs`]
  }));
}

test('semantic workforce chooses agent count when the operator omits one', () => {
  const plan = deriveSemanticWorkforcePlan({
    workItems: items(7),
    workforcePolicy: { mode: 'semantic_auto', maxAgents: 12 },
    fidelity: 'production_slice'
  });
  assert.equal(plan.selectionMode, 'semantic_auto');
  assert.equal(plan.requestedAgentCount, null);
  assert.equal(plan.targetAgentCount, 7);
  assert.equal(plan.independentReadyWorkItemCount, 7);
  assert.equal(plan.selectedWorkItemIds.length, 7);
});

test('semantic workforce respects overlap, dependencies, explicit caps, and hard capacity', () => {
  const workItems = [
    { id: 'root_a', allowedFiles: ['src/shared.mjs'] },
    { id: 'root_b', allowedFiles: ['src/shared.mjs'] },
    { id: 'root_c', allowedFiles: ['src/c.mjs'] },
    { id: 'dependent', allowedFiles: ['src/d.mjs'], deps: ['root_a'] }
  ];
  const plan = deriveSemanticWorkforcePlan({
    workItems,
    requestedAgentCount: 3,
    workforcePolicy: { mode: 'bounded_auto', maxAgents: 3, providerCapacity: 2, executionCapacity: 8 },
    budgets: { concurrency: 4 },
    completedWorkItemIds: []
  });
  assert.equal(plan.targetAgentCount, 2);
  assert.equal(plan.readyWorkItemCount, 3);
  assert.equal(plan.independentReadyWorkItemCount, 2);
  assert.equal(plan.maxAgentCount, 2);
  assert.ok(plan.decisionReasons.includes('file_overlap_reduced_parallelism'));
});

test('minimum policy never inflates beyond independent ready work', () => {
  const plan = deriveSemanticWorkforcePlan({
    workItems: items(2),
    workforcePolicy: { mode: 'semantic_auto', minAgents: 10, maxAgents: 12 }
  });
  assert.equal(plan.targetAgentCount, 2);
  assert.equal(plan.independentReadyWorkItemCount, 2);
});

test('unknown ownership is conservatively serialized and low-complexity prototype work is consolidated', () => {
  const unknownOwnership = deriveSemanticWorkforcePlan({
    workItems: [{ id: 'unknown_a' }, { id: 'unknown_b' }],
    workforcePolicy: { mode: 'semantic_auto', maxAgents: 12 }
  });
  assert.equal(unknownOwnership.targetAgentCount, 1);

  const prototype = deriveSemanticWorkforcePlan({
    workItems: items(8).map((item) => ({ ...item, verification: [] })),
    workforcePolicy: { mode: 'semantic_auto', maxAgents: 12 },
    fidelity: 'prototype'
  });
  assert.equal(prototype.targetAgentCount, 5);
  assert.ok(prototype.decisionReasons.includes('low_complexity_work_consolidation'));
});

test('semantic workforce digest excludes volatile generation time', async () => {
  const first = deriveSemanticWorkforcePlan({ workItems: items(3), workforcePolicy: { mode: 'semantic_auto' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = deriveSemanticWorkforcePlan({ workItems: items(3), workforcePolicy: { mode: 'semantic_auto' } });
  assert.notEqual(first.generatedAt, second.generatedAt);
  assert.equal(first.digest, second.digest);
});

test('semantic workforce adapts down under provider and verifier backpressure', () => {
  const plan = deriveSemanticWorkforcePlan({
    workItems: items(12),
    workforcePolicy: { mode: 'semantic_auto', maxAgents: 12 },
    telemetry: {
      previousTargetAgentCount: 12,
      providerErrorRate: 0.3,
      productiveMergeRate: 0.4,
      verifierBacklog: 30
    }
  });
  assert.equal(plan.targetAgentCount, 6);
  assert.ok(plan.decisionReasons.includes('provider_error_backoff'));
  assert.ok(plan.decisionReasons.includes('low_productive_merge_backoff'));
  assert.ok(plan.decisionReasons.includes('verifier_backpressure'));
});

test('Agent Work language supports auto workforce without requestedAgentCount', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-auto-language-'));
  const spec = {
    schemaVersion: 'claw.agent_work_spec.v0',
    generatedAt: '2026-07-11T00:00:00.000Z',
    goalId: 'auto_workforce',
    outcome: 'Run independent surfaces with semantic workforce sizing',
    benchmarkId: 'auto_workforce',
    runId: 'auto-workforce-language',
    repoPath: root,
    artifactRoot: path.join(root, 'run'),
    fidelity: 'production_slice',
    workforcePolicy: { mode: 'semantic_auto', maxAgents: 8 },
    executionBoundary: 'control_plane_allowed',
    stopCondition: 'supervisor_green_or_blocker_report',
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send'] },
    doneWhen: ['independent_acceptance_green'],
    surfaces: items(4)
  };
  const compiled = compileAgentWorkSpec(spec, { generatedAt: spec.generatedAt, runId: spec.runId });
  assert.equal(compiled.validation.ok, true, JSON.stringify(compiled.validation));
  assert.equal(compiled.runContract.requestedAgentCount, null);
  assert.equal(compiled.runContract.scope.workforcePolicy.mode, 'semantic_auto');
});

test('canonical Agent Work planning selects and materializes an automatic runtime agent count', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-auto-facade-'));
  const repo = path.join(root, 'repo');
  const out = path.join(root, 'run');
  fs.mkdirSync(path.join(repo, 'packages/app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/domain-core.mjs'), 'export const core = true;\n');
  const result = compileObjective({
    input: {
      objective: 'Build routes, storage, permissions, integrations, jobs, UI, and tests',
      repoPath: repo,
      fidelity: 'production_slice',
      executionBoundary: 'control_plane_allowed',
      permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send'] },
      doneWhen: ['independent_acceptance_green'],
      surfaces: items(6, 'packages/app')
    },
    outputDir: out,
    config: { executionBoundary: 'control_plane_allowed' }
  });
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  const workforce = JSON.parse(fs.readFileSync(path.join(out, 'semantic_workforce_plan.json'), 'utf8'));
  const contract = JSON.parse(fs.readFileSync(path.join(out, 'run_contract.json'), 'utf8'));
  assert.equal(workforce.selectionMode, 'semantic_auto');
  assert.equal(workforce.targetAgentCount > 1, true);
  assert.equal(contract.requestedAgentCount, workforce.targetAgentCount);
  assert.equal(contract.scope.workforcePolicy.requestedAgentCountSource, 'semantic_auto');
  assert.equal(result.artifacts.semanticWorkforcePlan, path.join(out, 'semantic_workforce_plan.json'));
});

test('objective controller consumes semantic workforce target for its wave contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-auto-controller-'));
  const artifactRoot = path.join(root, 'artifacts');
  const spec = {
    schemaVersion: 'claw.agent_work_spec.v0',
    generatedAt: '2026-07-11T00:00:00.000Z',
    goalId: 'auto_controller',
    outcome: 'Prove the controller consumes automatic workforce sizing',
    benchmarkId: 'auto_controller',
    benchmarkTier: 'execution_smoke',
    runId: 'auto-controller',
    repoPath: root,
    artifactRoot,
    fidelity: 'production_slice',
    workforcePolicy: { mode: 'semantic_auto', maxAgents: 8 },
    executionBoundary: 'control_plane_allowed',
    stopCondition: 'supervisor_green_or_blocker_report',
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['external_send'] },
    doneWhen: ['independent_acceptance_green'],
    surfaces: items(4)
  };
  const compiled = compileAgentWorkSpec(spec, { generatedAt: spec.generatedAt, runId: spec.runId });
  const contractPath = path.join(root, 'run_contract.json');
  fs.writeFileSync(contractPath, `${JSON.stringify(compiled.runContract, null, 2)}\n`);
  const script = path.resolve(new URL('../apps/system-benchmark/run-agent-work-objective-controller.mjs', import.meta.url).pathname);
  const run = spawnSync(process.execPath, [script, contractPath, '--artifact-root', artifactRoot, '--max-waves', '1', '--dry-run'], {
    cwd: path.resolve(new URL('..', import.meta.url).pathname),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stderr || run.stdout);
  const workforce = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'waves/wave-001/semantic_workforce_plan.json'), 'utf8'));
  const waveContract = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'waves/wave-001/run_contract.json'), 'utf8'));
  assert.equal(workforce.targetAgentCount, 4);
  assert.equal(waveContract.requestedAgentCount, 4);
  assert.equal(waveContract.metadata.agentWorkObjectiveController.semanticWorkforcePlanDigest, workforce.digest);
});
