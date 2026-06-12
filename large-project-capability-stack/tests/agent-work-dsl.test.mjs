import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  AGENT_WORK_DEFAULT_RUNTIME,
  compileAgentWorkSpec,
  parseAgentWorkSpec,
  resolveAgentWorkRunInput,
  validateAgentWorkSpec,
  writeAgentWorkCompilation
} from '../packages/agent-work-dsl/index.mjs';

test('agent work DSL compiles objective, permissions, surfaces, and verifiers into current run contract shape', () => {
  const compiled = compileAgentWorkSpec({
    goalId: 'MailchimpDeepArchitectureRepair',
    outcome: 'repair selected executable Mailchimp architecture workflows without relaunch',
    repoPath: '/tmp/mailchimp-repo',
    fidelity: 'parity_for_scope',
    agents: 10,
    permissions: { allow: ['read_repo', 'write_product_code', 'run_tests'], forbid: ['relaunch_benchmark', 'external_send', 'touch_prod'] },
    doneWhen: ['all_surfaces_pass', 'full_npm_test_passes', 'no_truth_layer_overclaim'],
    surfaces: [
      {
        id: 'campaign_handoff',
        label: 'Campaign handoff and telemetry',
        files: ['packages/app/domain-campaigns.mjs', 'packages/app/job-handlers.mjs'],
        verify: ['node scripts/deep-architecture-verifier.mjs', 'node --test tests/campaign-pipeline.test.mjs']
      }
    ]
  }, { generatedAt: '2026-06-11T00:00:00.000Z', runId: 'agent-work-test-run' });

  assert.equal(compiled.runContract.schemaVersion, 'claw.agent_benchmark_run_contract.v1');
  assert.equal(compiled.runContract.fidelity, 'parity_for_scope');
  assert.equal(compiled.runContract.requestedAgentCount, 10);
  assert.equal(compiled.runContract.scope.permissionPolicy.forbid.includes('relaunch_benchmark'), true);
  assert.equal(compiled.safetyReport.relaunchAllowed, false);
  assert.equal(compiled.surfaceMatrix.surfaces[0].id, 'campaign_handoff');
  assert.equal(compiled.workGraph.workUnits[0].allowedFiles.includes('packages/app/domain-campaigns.mjs'), true);
  assert.equal(compiled.runContract.verifierSet.length, 2);
});

test('agent work DSL parses compact text syntax for AI-readable orchestration specs', () => {
  const parsed = parseAgentWorkSpec(`goal MailchimpDeepArchitectureRepair
repo /tmp/mailchimp-repo
fidelity parity_for_scope
agents 12
allow read_repo, write_product_code, run_tests
forbid relaunch_benchmark, external_send, touch_prod
done all_surfaces_pass, no_truth_layer_overclaim
surface campaign_handoff
  label: Campaign handoff and telemetry
  files: packages/app/domain-campaigns.mjs, packages/app/job-handlers.mjs
  verify: node scripts/deep-architecture-verifier.mjs
surface audience_import
  files: packages/app/domain-audience.mjs
  verify: node --test tests/audience-core.test.mjs`);
  assert.equal(parsed.goalId, 'MailchimpDeepArchitectureRepair');
  assert.equal(parsed.surfaces.length, 2);
  const compiled = compileAgentWorkSpec(parsed, { generatedAt: '2026-06-11T00:00:00.000Z', runId: 'text-spec-run' });
  assert.equal(compiled.runContract.scope.surfaces.length, 2);
  assert.equal(compiled.runContract.scope.doneWhen.includes('no_truth_layer_overclaim'), true);
});

test('agent work DSL v0.1 compiles budgets, wave policy, expansion rules, evidence schemas, and templates', () => {
  const parsed = parseAgentWorkSpec(`goal NextEvolutionProbe
repo /tmp/agent-work-next
fidelity parity_for_scope
agents 20
forbid external_send, touch_prod
done all_surfaces_pass, no_truth_layer_overclaim

template node_test_surface
  lane: product_runtime
  verify: node --test {{test_path}}

budget
  token_cap: 24000000
  worker_prompt_tokens: 6000
  global_calls: 23

wave_policy
  max_waves: 24
  bundle_size: 5
  full_context_waves: 0
  handoff: wave_factpack

expansion_policy
  triggers: objective_red, graph_exhausted
  max_cycles: 20
  max_surfaces: 200
  strategy: decompose_missing_surfaces

evidence_schema productive_delta
  require: creative_product_delta_integrity >= 1
  require: verified_surface_count >= 1
  artifact: canonical_result_summary.json

surface campaign_delivery uses node_test_surface
  files: packages/app/campaigns.mjs
  test_path: tests/campaigns.test.mjs`);

  const compiled = compileAgentWorkSpec(parsed, { generatedAt: '2026-06-11T00:00:00.000Z', runId: 'next-evolution-test' });
  assert.equal(compiled.spec.languageVersion, 'v0.1');
  assert.equal(compiled.runContract.scope.budgets.token_cap, 24000000);
  assert.equal(compiled.runContract.scope.wavePolicy.full_context_waves, 0);
  assert.deepEqual(compiled.runContract.scope.expansionPolicy.triggers, ['objective_red', 'graph_exhausted']);
  assert.equal(compiled.runContract.scope.evidenceSchemas[0].gates[0].metric, 'creative_product_delta_integrity');
  assert.equal(compiled.runContract.scope.surfaces[0].verification[0], 'node --test tests/campaigns.test.mjs');
  assert.deepEqual(compiled.runContract.scope.surfaces[0].metadata.templateIds, ['node_test_surface']);
  assert.equal(compiled.runContract.scope.agentWorkLanguage.runtime.defaultRunner, 'objective_controller');
  assert.equal(compiled.runContract.metadata.agentWorkDsl.runtime.defaultRunnerScript, AGENT_WORK_DEFAULT_RUNTIME.defaultRunnerScript);
  assert.equal(compiled.runtime.defaultRunner, 'objective_controller');
  assert.equal(compiled.workGraph.policies.wavePolicy.bundle_size, 5);
  assert.equal(compiled.safetyReport.dynamicExpansionDeclared, true);
});

test('agent work DSL v0.1 rejects unresolved template placeholders', () => {
  assert.throws(() => compileAgentWorkSpec(`goal BadTemplate
repo /tmp/repo
template node_test_surface
  verify: node --test {{missing_test_path}}
surface bad_surface uses node_test_surface
  files: src/bad.mjs
`), /unresolved template token/);
});

test('agent work DSL defaults to execution_smoke without an endurance duration target', () => {
  const compiled = compileAgentWorkSpec({
    goalId: 'SmokeCanary',
    repoPath: '/tmp/repo',
    fidelity: 'production_slice',
    surfaces: [{ id: 'canary', files: ['src/canary.mjs'], verify: ['node --test tests/canary.test.mjs'] }]
  }, { generatedAt: '2026-06-11T00:00:00.000Z', runId: 'smoke-canary' });
  assert.equal(compiled.runContract.benchmarkTier, 'execution_smoke');
  assert.equal(compiled.runContract.scope.durationTargetMinutes, null);
  assert.equal(compiled.runContract.scope.requireRealProductDiffs, false);
});

test('agent work DSL can declare creative product-diff canary scope', () => {
  const compiled = compileAgentWorkSpec({
    goalId: 'ModelProductDiffCanary',
    repoPath: '/tmp/repo',
    fidelity: 'production_slice',
    benchmarkTier: 'execution_smoke',
    metadata: {
      productDiffMode: 'creative_product_work',
      requireRealProductDiffs: true,
      creativeProductWork: { required: true, minIterations: 1, minWorkerRuntimeMs: 0 },
      canonicalLandingEvidence: { enabled: true, minAddedLineCount: 1, minUniqueNormalizedAddedLineCount: 1 }
    },
    surfaces: [{ id: 'canary', files: ['packages/canary/index.mjs'], verify: ['node --test tests/canary.test.mjs'] }]
  }, { generatedAt: '2026-06-11T00:00:00.000Z', runId: 'model-canary' });
  assert.equal(compiled.runContract.scope.productDiffMode, 'creative_product_work');
  assert.equal(compiled.runContract.scope.requireRealProductDiffs, true);
  assert.equal(compiled.runContract.scope.creativeProductWork.required, true);
  assert.equal(compiled.runContract.scope.canonicalLandingEvidence.enabled, true);
});

test('agent work DSL refuses forbidden relaunch actions and suspicious verifier commands', () => {
  const base = {
    goalId: 'NoRelaunchRepair',
    repoPath: '/tmp/repo',
    fidelity: 'production_slice',
    permissions: { allow: ['read_repo'], forbid: ['relaunch_benchmark'] },
    surfaces: [{ id: 'repair', files: ['src/repair.mjs'], verify: ['node --test tests/repair.test.mjs'] }]
  };
  assert.throws(() => compileAgentWorkSpec({ ...base, requestedActions: ['relaunch_benchmark'] }), /requested action relaunch_benchmark is forbidden/);
  assert.throws(() => compileAgentWorkSpec({ ...base, requestedActions: [], surfaces: [{ id: 'repair', files: ['src/repair.mjs'], verify: ['node launch_live_controller.mjs'] }] }), /forbidden capability relaunch_benchmark/);
});

test('agent work DSL blocks full-clone claims without explicit parity evidence gates', () => {
  const spec = {
    goalId: 'FullCloneAttempt',
    repoPath: '/tmp/repo',
    fidelity: 'full_clone',
    surfaces: [{ id: 'surface', files: ['src/surface.mjs'], verify: ['node --test tests/surface.test.mjs'] }]
  };
  const normalizedError = validateAgentWorkSpec({
    schemaVersion: 'claw.agent_work_spec.v0',
    generatedAt: '2026-06-11T00:00:00.000Z',
    goalId: 'full_clone_attempt',
    repoPath: '/tmp/repo',
    fidelity: 'full_clone',
    requestedAgentCount: 1,
    permissions: { allow: [], forbid: [] },
    requestedActions: [],
    doneWhen: [],
    stopCondition: 'supervisor_green_or_blocker_report',
    surfaces: [{ id: 'surface', allowedFiles: ['src/surface.mjs'], verification: ['node --test tests/surface.test.mjs'] }],
    metadata: {}
  });
  assert.equal(normalizedError.ok, false);
  assert.equal(normalizedError.errors.some((entry) => entry.includes('full_clone fidelity requires')), true);
  assert.throws(() => compileAgentWorkSpec(spec), /full_clone fidelity requires/);

  const compiled = compileAgentWorkSpec({ ...spec, doneWhen: ['parity_matrix_all_complete'] }, { generatedAt: '2026-06-11T00:00:00.000Z' });
  assert.equal(compiled.runContract.scope.truthGates.fullCloneParityRequired, true);
});

test('agent work DSL writes compiler artifacts consumed by existing benchmark runners', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-dsl-'));
  const result = writeAgentWorkCompilation({
    outputDir,
    input: {
      goalId: 'WebsiteAuditSwarm',
      repoPath: '/tmp/repo',
      fidelity: 'production_slice',
      agents: 4,
      permissions: { allow: ['read_repo', 'run_tests'], forbid: ['external_send'] },
      surfaces: [{ id: 'audit_report', files: ['src/audit.mjs'], verify: ['node --test tests/audit.test.mjs'] }]
    },
    options: { generatedAt: '2026-06-11T00:00:00.000Z', runId: 'write-test-run' }
  });
  assert.equal(fs.existsSync(result.files.runContractPath), true);
  assert.equal(JSON.parse(fs.readFileSync(result.files.runContractPath, 'utf8')).scope.surfaces[0].id, 'audit_report');
  assert.equal(JSON.parse(fs.readFileSync(result.files.runContractPath, 'utf8')).scope.agentWorkLanguage.runtime.defaultRunner, 'objective_controller');
  assert.equal(JSON.parse(fs.readFileSync(result.files.compilerReportPath, 'utf8')).runtime.defaultRunnerScript, AGENT_WORK_DEFAULT_RUNTIME.defaultRunnerScript);
  assert.equal(fs.existsSync(result.files.surfaceMatrixPath), true);
  assert.equal(fs.existsSync(result.files.workGraphPath), true);
  assert.equal(fs.existsSync(result.files.compilerReportPath), true);
});


test('agent work DSL CLI compiles text specs into run_contract artifacts without launching a benchmark', () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-dsl-cli-'));
  const specPath = path.join(temp, 'spec.aw');
  const outDir = path.join(temp, 'compiled');
  fs.writeFileSync(specPath, `goal CurrentOrchestrationDslProbe
repo ${JSON.stringify(root).slice(1, -1)}
fidelity production_slice
agents 3
forbid relaunch_benchmark, external_send
surface compiler_probe
  files: packages/agent-work-dsl/index.mjs
  verify: node --test tests/agent-work-dsl.test.mjs
`);
  const run = spawnSync(process.execPath, [path.join(root, 'apps/system-benchmark/compile-agent-work-dsl.mjs'), specPath, '--out', outDir, '--run-id', 'cli-test-run'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.defaultRunner, 'objective_controller');
  assert.match(payload.defaultCommand, /run-agent-work-objective-controller\.mjs/);
  assert.equal(payload.relaunchAllowed, false);
  assert.equal(fs.existsSync(path.join(outDir, 'run_contract.json')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outDir, 'run_contract.json'), 'utf8')).runId, 'cli-test-run');
});

test('runner ingestion resolves text DSL specs and materializes current run contract artifacts', () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-run-input-'));
  const specPath = path.join(temp, 'handoff.aw');
  const outDir = path.join(temp, 'compiled');
  fs.writeFileSync(specPath, `goal CortexRunnerIngestion
repo ${root}
fidelity production_slice
agents 2
forbid external_send, relaunch_benchmark
surface dsl_runner
  files: packages/agent-work-dsl/index.mjs
  verify: node --test tests/agent-work-dsl.test.mjs
`);
  const resolved = resolveAgentWorkRunInput(specPath, { outputDir: outDir, runId: 'runner-ingestion-test', generatedAt: '2026-06-11T00:00:00.000Z' });
  assert.equal(resolved.inputKind, 'agent_work_text_spec');
  assert.equal(resolved.compiledFromAgentWorkDsl, true);
  assert.equal(resolved.runtime.defaultRunner, 'objective_controller');
  assert.equal(resolved.runContract.runId, 'runner-ingestion-test');
  assert.equal(fs.existsSync(path.join(outDir, 'run_contract.json')), true);
  assert.equal(JSON.parse(fs.readFileSync(resolved.runContractPath, 'utf8')).scope.surfaces[0].id, 'dsl_runner');
});

test('transfer runner accepts agent work DSL input and blocks at execution boundary before launching workers', () => {
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-transfer-runner-'));
  const artifactRoot = path.join(temp, 'artifact');
  const specPath = path.join(temp, 'boundary.aw');
  const deploymentManifestPath = path.join(temp, 'deployment_manifest.json');
  fs.writeFileSync(deploymentManifestPath, JSON.stringify({
    schemaVersion: 'claw.agent_work_deployment_manifest.v0',
    bundleId: 'boundary-manifest',
    git: { commit: 'abc123', dirty: false },
    fileCount: 1,
    aggregateSha256: 'digest'
  }, null, 2));
  fs.writeFileSync(specPath, `goal BoundaryProbe
repo ${root}
artifact_root ${artifactRoot}
scoreboard ${path.join(temp, 'scoreboard.json')}
fidelity production_slice
agents 1
execution_boundary remote_execution_required
forbid external_send, relaunch_benchmark
surface boundary_probe
  files: packages/agent-work-dsl/index.mjs
  verify: node --test tests/agent-work-dsl.test.mjs
`);
  const run = spawnSync(process.execPath, [path.join(root, 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), specPath], {
    cwd: root,
    env: { ...process.env, BENCHMARK_HOST_ROLE: 'control_plane', AGENT_WORK_DEPLOYMENT_MANIFEST: deploymentManifestPath },
    encoding: 'utf8'
  });
  assert.equal(run.status, 2, run.stderr || run.stdout);
  assert.equal(fs.existsSync(path.join(artifactRoot, 'runner_input_resolution.json')), true);
  const blocker = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'blocker_report.json'), 'utf8'));
  assert.equal(blocker.status, 'blocked');
  assert.equal(blocker.requiredHostRole, 'execution_plane');
  assert.equal(JSON.parse(fs.readFileSync(path.join(artifactRoot, 'deployment_manifest.json'), 'utf8')).bundleId, 'boundary-manifest');
  assert.equal(JSON.parse(fs.readFileSync(path.join(artifactRoot, 'runner_input_resolution.json'), 'utf8')).deploymentManifest.bundleId, 'boundary-manifest');
});
