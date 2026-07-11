import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  profileClawhip,
  profileCortex,
  compareSystems,
  createBenchmarkRunContract,
  createScoreboardRow,
  upsertBenchmarkScoreboardRow,
  bootstrapTransferBenchmark,
  evaluateBenchmarkThresholds,
  REAL_WORKER_PRODUCT_STANDARD_POLICY,
  buildBenchmarkGroundTruth,
  deriveBenchmarkAutonomyMetrics,
  resolveBenchmarkLeaseTtlMs,
  resolveBenchmarkMaxRuntimeMs,
  resolveBenchmarkWorkerTimeoutMs
} from '../packages/system-benchmark/index.mjs';
import {
  buildShardPlan,
  compileSupervisorSnapshot,
  createArtifactBus,
  createLeaseState,
  createPatchArtifact,
  createPatchQueue,
  enqueuePatch,
  processPatchQueue
} from '../packages/multi-agent-orchestrator/index.mjs';
import { PMHNP_TIER2_SCENARIOS } from '../apps/system-benchmark/pmhnp-tier2-scenarios.mjs';

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test('live transfer verifier resolves verifier catalog from shard inputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-transfer-verifier-shard-inputs-'));
  const assignmentPath = path.join(root, 'assignment.json');
  write(assignmentPath, JSON.stringify({
    workspacePath: root,
    contextPack: {
      inputs: {
        verifierCatalog: {
          unrelated_context_command: {
            id: 'unrelated_context_command',
            command: 'node -e "process.exit(9)"'
          }
        }
      }
    },
    shard: {
      inputs: {
        verifierCatalog: {
          shard_command_1: {
            id: 'shard_command_1',
            command: 'node -e "console.log(JSON.stringify({ok:true,firstMeaningfulProgressMs:0,checkKinds:[\'shard-input-catalog\']}))"',
            purpose: 'prove shard input verifier catalog lookup',
            surfaceId: 'shard_input_surface'
          }
        }
      }
    }
  }, null, 2));

  const result = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/live-transfer-verifier.mjs'),
    '--assignment', assignmentPath,
    '--verifier', 'shard_command_1'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.surfaceId, 'shard_input_surface');
  assert.equal(payload.parsedOutputSummary.checkKinds.includes('shard-input-catalog'), true);
});

test('live transfer worker reuses creative-worker external verification evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-transfer-worker-reuse-external-verifier-'));
  const repo = path.join(root, 'repo');
  const target = 'packages/app/creative-surface.mjs';
  write(path.join(repo, target), 'export function existingCreativeSurface() { return { ok: true }; }\n');
  const verifierCommand = `${process.execPath} -e "process.exit(9)"`;
  const mockWorker = path.join(root, 'mock-creative-worker.mjs');
  write(mockWorker, `import fs from 'node:fs';\nimport path from 'node:path';\nconst workspace = process.env.CREATIVE_WORKER_WORKSPACE;\nconst target = process.env.CREATIVE_WORKER_ALLOWED_FILES.split(',')[0];\nfs.appendFileSync(path.join(workspace, target), '\\nexport function reusedExternalVerificationDelta() { return { ok: true, reused: true }; }\\n');\nconst verifierStdout = JSON.stringify({ ok: true, surfaceId: process.env.CREATIVE_WORKER_SURFACE_ID, durationMs: 1, firstMeaningfulProgressMs: 0, checkKinds: ['mock-reused-external-verifier'] });\nfs.writeFileSync(process.env.CREATIVE_WORKER_EVIDENCE_PATH, JSON.stringify({\n  ok: true,\n  surfaceId: process.env.CREATIVE_WORKER_SURFACE_ID,\n  startedAt: new Date().toISOString(),\n  finishedAt: new Date().toISOString(),\n  creativeRuntimeMs: 1,\n  minRuntimeMs: 0,\n  minIterations: 1,\n  iterationCount: 1,\n  iterations: [{ step: 'mock_iteration_1', changedAllowedFilesAfterIteration: [target] }],\n  filesChanged: [target],\n  productFilesChanged: [target],\n  externalVerification: {\n    enabled: true,\n    failureCount: 0,\n    runs: [\n      { iteration: 1, results: [{ command: ${JSON.stringify(verifierCommand)}, ok: false, exitCode: 9, durationMs: 1, stdout: JSON.stringify({ ok: false, checkKinds: ['stale-failed-verifier'] }), stderr: 'stale failure' }] },\n      { iteration: 2, results: [{ command: ${JSON.stringify(verifierCommand)}, ok: true, exitCode: 0, durationMs: 1, stdout: verifierStdout, stderr: '' }] }\n    ]\n  },\n  risks: [],\n  retryable: true\n}, null, 2));\n`);
  const assignmentPath = path.join(root, 'assignment.json');
  const resultPath = path.join(root, 'result.json');
  const logPath = path.join(root, 'worker.log');
  const verifierCatalog = {
    creative_surface_command_1: {
      id: 'creative_surface_command_1',
      command: verifierCommand,
      surfaceId: 'creative_surface'
    }
  };
  write(assignmentPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    workspacePath: repo,
    resultPath,
    logPath,
    verifierScriptPath: path.join(process.cwd(), 'apps/system-benchmark/live-transfer-verifier.mjs'),
    executionMode: 'test_live_worker',
    agentId: 'agent-1',
    lease: { leaseId: 'lease-1', attempt: 1 },
    contextPack: {
      inputs: {
        productDiffMode: 'creative_product_work',
        creativeProductWork: { required: true, minIterations: 1, workerCommand: `${process.execPath} ${mockWorker}` },
        verifierCatalog
      },
      guardrails: { allowedFiles: [target], fileAreas: [target] },
      acceptanceChecks: []
    },
    shard: {
      id: 'creative_surface',
      allowedFiles: [target],
      fileAreas: [target],
      requiredVerifiers: ['creative_surface_command_1'],
      inputs: { verifierCatalog },
      metadata: { surfaceId: 'creative_surface', productDiffMode: 'creative_product_work' }
    }
  }, null, 2));

  const result = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/live-transfer-worker.mjs'),
    '--assignment', assignmentPath
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_COMMAND: `${process.execPath} ${mockWorker}`,
      CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
      CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0'
    }
  });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(payload.ok, true);
  assert.equal(payload.implementation.metadata.creativeWorkerEvidence.productModifiedFiles.includes(target), true);
  assert.equal(payload.verifierResults.length, 1);
  assert.equal(payload.verifierResults[0].metadata.reusedFromCreativeWorkerExternalVerification, true);
  assert.equal(payload.verifierResults[0].metadata.iteration, 2);
  assert.equal(payload.verifierResults[0].metadata.checkKinds.includes('mock-reused-external-verifier'), true);
});

test('live transfer worker accepts conventional brownfield src product targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-transfer-worker-src-target-'));
  const repo = path.join(root, 'repo');
  const target = 'src/domain/appealDeadline.mjs';
  write(path.join(repo, target), 'export function assessAppealDeadline() { return { before: true }; }\n');
  const verifierCommand = `${process.execPath} -e "console.log(JSON.stringify({ ok: true, checkKinds: ['src-product-target'] }))"`;
  const mockWorker = path.join(root, 'mock-src-creative-worker.mjs');
  write(mockWorker, `import fs from 'node:fs';
import path from 'node:path';
const workspace = process.env.CREATIVE_WORKER_WORKSPACE;
const target = process.env.CREATIVE_WORKER_ALLOWED_FILES.split(',')[0];
fs.appendFileSync(path.join(workspace, target), '\\nexport const brownfieldSrcTargetAccepted = true;\\n');
fs.writeFileSync(process.env.CREATIVE_WORKER_EVIDENCE_PATH, JSON.stringify({
  ok: true,
  surfaceId: process.env.CREATIVE_WORKER_SURFACE_ID,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  creativeRuntimeMs: 1,
  minRuntimeMs: 0,
  minIterations: 1,
  iterationCount: 1,
  iterations: [{ step: 'mock_iteration_1', changedAllowedFilesAfterIteration: [target] }],
  filesChanged: [target],
  productFilesChanged: [target],
  externalVerification: { enabled: false, failureCount: 0, runs: [] },
  risks: [],
  retryable: true
}, null, 2));
`);
  const assignmentPath = path.join(root, 'assignment.json');
  const resultPath = path.join(root, 'result.json');
  const verifierCatalog = {
    src_surface_command_1: { id: 'src_surface_command_1', command: verifierCommand, surfaceId: 'src_surface' }
  };
  write(assignmentPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    workspacePath: repo,
    resultPath,
    logPath: path.join(root, 'worker.log'),
    verifierScriptPath: path.join(process.cwd(), 'apps/system-benchmark/live-transfer-verifier.mjs'),
    executionMode: 'test_live_worker',
    agentId: 'agent-src',
    lease: { leaseId: 'lease-src', attempt: 1 },
    contextPack: {
      inputs: {
        productDiffMode: 'creative_product_work',
        creativeProductWork: { required: true, minIterations: 1, workerCommand: `${process.execPath} ${mockWorker}` },
        verifierCatalog
      },
      guardrails: { allowedFiles: [target], fileAreas: [target] },
      acceptanceChecks: []
    },
    shard: {
      id: 'src_surface',
      allowedFiles: [target],
      fileAreas: [target],
      requiredVerifiers: ['src_surface_command_1'],
      inputs: { verifierCatalog },
      metadata: { surfaceId: 'src_surface', productDiffMode: 'creative_product_work' }
    }
  }, null, 2));

  const result = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/live-transfer-worker.mjs'),
    '--assignment', assignmentPath
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_COMMAND: `${process.execPath} ${mockWorker}`,
      CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
      CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0'
    }
  });

  const failureEvidence = fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf8') : '';
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${failureEvidence}`);
  const payload = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(payload.ok, true);
  assert.equal(payload.implementation.metadata.creativeWorkerEvidence.productModifiedFiles.includes(target), true);
  assert.equal(payload.verifierResults[0].ok, true);
});

test('live transfer worker recovers durable creative product checkpoint after wrapper timeout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-transfer-worker-timeout-checkpoint-'));
  const repo = path.join(root, 'repo');
  const target = 'packages/app/timeout-recovered-surface.mjs';
  write(path.join(repo, target), 'export function timeoutRecoveredSurface() { return { before: true }; }\n');
  const verifierCommand = `${process.execPath} -e "console.log(JSON.stringify({ ok: true, durationMs: 1, firstMeaningfulProgressMs: 0, checkKinds: ['timeout-recovery-verifier'] }))"`;
  const mockWorker = path.join(root, 'mock-timeout-creative-worker.mjs');
  write(mockWorker, `import fs from 'node:fs';
import path from 'node:path';
const workspace = process.env.CREATIVE_WORKER_WORKSPACE;
const target = process.env.CREATIVE_WORKER_ALLOWED_FILES.split(',')[0];
fs.appendFileSync(path.join(workspace, target), '\\nexport function recoveredAfterTimeoutCheckpoint() { return { ok: true, recovered: true }; }\\n');
fs.writeFileSync(process.env.CREATIVE_WORKER_EVIDENCE_PATH, JSON.stringify({
  ok: false,
  partial: true,
  stage: 'after_codex_iteration',
  checkpoint: { stage: 'after_codex_iteration', complete: false, productDeltaDurable: true, externalVerificationComplete: false },
  surfaceId: process.env.CREATIVE_WORKER_SURFACE_ID,
  startedAt: new Date().toISOString(),
  checkpointedAt: new Date().toISOString(),
  creativeRuntimeMs: 1,
  minRuntimeMs: 0,
  minIterations: 1,
  iterationCount: 1,
  iterations: [{ step: 'mock_iteration_1', changedAllowedFilesAfterIteration: [target] }],
  filesChanged: [target],
  productFilesChanged: [target],
  modifiedFiles: [target],
  productModifiedFiles: [target],
  externalVerification: { enabled: true, failureCount: 0, runs: [] },
  risks: ['simulated_external_verification_still_running'],
  retryable: true
}, null, 2));
setTimeout(() => {}, 5000);
`);
  const assignmentPath = path.join(root, 'assignment.json');
  const resultPath = path.join(root, 'result.json');
  const logPath = path.join(root, 'worker.log');
  const verifierCatalog = {
    timeout_recovered_surface_command_1: {
      id: 'timeout_recovered_surface_command_1',
      command: verifierCommand,
      surfaceId: 'timeout_recovered_surface'
    }
  };
  write(assignmentPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    workspacePath: repo,
    resultPath,
    logPath,
    verifierScriptPath: path.join(process.cwd(), 'apps/system-benchmark/live-transfer-verifier.mjs'),
    executionMode: 'test_live_worker',
    agentId: 'agent-timeout',
    lease: { leaseId: 'lease-timeout', attempt: 1 },
    contextPack: {
      inputs: {
        productDiffMode: 'creative_product_work',
        creativeProductWork: { required: true, minIterations: 1, workerCommand: `${process.execPath} ${mockWorker}` },
        verifierCatalog
      },
      guardrails: { allowedFiles: [target], fileAreas: [target] },
      acceptanceChecks: []
    },
    shard: {
      id: 'timeout_recovered_surface',
      allowedFiles: [target],
      fileAreas: [target],
      requiredVerifiers: ['timeout_recovered_surface_command_1'],
      inputs: { verifierCatalog },
      metadata: { surfaceId: 'timeout_recovered_surface', productDiffMode: 'creative_product_work' }
    }
  }, null, 2));

  const result = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/live-transfer-worker.mjs'),
    '--assignment', assignmentPath
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_COMMAND: `${process.execPath} ${mockWorker}`,
      CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
      CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0',
      CREATIVE_WORKER_COMMAND_TIMEOUT_MS: '250'
    }
  });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(payload.ok, true);
  assert.equal(payload.implementation.metadata.creativeWorkerEvidence.commandTimedOut, true);
  assert.equal(payload.implementation.metadata.creativeWorkerEvidence.recoveredFromCommandTimeout, true);
  assert.equal(payload.implementation.metadata.creativeWorkerEvidence.productModifiedFiles.includes(target), true);
  assert.equal(payload.verifierResults[0].ok, true);
  assert.equal(payload.verifierResults[0].metadata.reusedFromCreativeWorkerExternalVerification, undefined);
  assert.equal(payload.verifierResults[0].metadata.parsedOutputSummary.checkKinds.includes('timeout-recovery-verifier'), true);
});

test('system benchmark comparison distinguishes autonomy-leaning clawhip from truth-gated Cortex', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-benchmark-'));
  const claw = path.join(root, 'clawhip');
  const stack = path.join(root, 'stack');
  const mail = path.join(root, 'mailchimp');

  write(path.join(claw, 'README.md'), '# clawhip\nDiscord router monitor tmux');
  write(path.join(claw, 'Cargo.toml'), '[package]\nname = "clawhip"');
  write(path.join(claw, 'docs', 'event-contract-v1.md'), 'event contract');
  write(path.join(claw, 'src', 'router.rs'), 'fn main() {}');
  write(path.join(claw, 'src', 'monitor.rs'), 'fn monitor() {}');
  write(path.join(claw, 'src', 'plugins.rs'), 'fn plugins() {}');
  write(path.join(claw, 'src', 'tmux_wrapper.rs'), 'fn tmux() {}');
  write(path.join(claw, 'src', 'slack.rs'), 'fn slack() {}');

  write(path.join(stack, 'packages', 'task-contract', 'index.mjs'), 'export const x = 1;');
  write(path.join(stack, 'packages', 'issue-dag', 'index.mjs'), 'export const x = 1;');
  write(path.join(stack, 'packages', 'campaign-runtime', 'index.mjs'), 'export const x = 1;');
  write(path.join(stack, 'packages', 'architecture-enforcer', 'index.mjs'), 'export const x = 1;');
  write(path.join(stack, 'packages', 'surface-matrix', 'index.mjs'), 'export const x = 1;');
  write(path.join(stack, 'packages', 'recovery-ledger', 'index.mjs'), 'export const x = 1;');
  write(path.join(stack, 'packages', 'multi-agent-orchestrator', 'index.mjs'), 'export const x = 1;');
  write(path.join(stack, 'packages', 'certification', 'index.mjs'), 'export const x = 1;');
  write(path.join(stack, 'packages', 'code-value-audit', 'index.mjs'), 'export const x = 1;');
  write(path.join(mail, 'artifacts', 'qualification', 'orchestrator_real_repo', 'completion_summary.json'), '{"provenCoordinationScaleTier":100,"supervisorConfirmedCompletion":true}');

  const clawhip = profileClawhip({ repoRoot: claw });
  const cortex = profileCortex({ stackRoot: stack, mailchimpRoot: mail });
  const comparison = compareSystems({ cortex, clawhip });

  assert.equal(comparison.overall.betterForAutonomousCodingToday, 'clawhip');
  assert.equal(comparison.overall.betterForTruthAndClaimControl, 'cortex');
  assert.equal(comparison.categories.truthfulness_and_claim_control.winner, 'cortex');
});

test('system benchmark can compile run contracts and upsert scoreboard rows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-scoreboard-'));
  const scoreboardPath = path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json');
  const contract = createBenchmarkRunContract({
    benchmarkId: 'pmhnp_denial_copilot_transfer',
    benchmarkTier: 'tier1_smoke',
    repoPath: '/tmp/pmhnp-denial-copilot',
    scope: { surfaces: [] },
    verifierSet: [{ kind: 'node_script', command: 'node scripts/smoke-test.mjs' }],
    scoreboardPath,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'pmhnp_denial_copilot_transfer', 'run-001'),
    runId: 'run-001'
  });
  const row = createScoreboardRow({
    contract,
    metrics: { productiveIterationRate: 0.7, noOpRate: 0.1, verificationIntegrity: 1 },
    outcome: { pass: true },
    durationMinutes: 45,
    blockerSemantics: 'none',
    notes: 'green smoke run'
  });
  const scoreboard = upsertBenchmarkScoreboardRow({ scoreboardPath, row });
  assert.equal(scoreboard.rows.length, 1);
  assert.equal(scoreboard.rows[0].runId, 'run-001');
  assert.equal(scoreboard.rows[0].pass, true);
});

test('system benchmark threshold evaluation enforces tier requirements honestly', () => {
  const executionSmokePass = evaluateBenchmarkThresholds({
    benchmarkTier: 'execution_smoke',
    metrics: {
      productiveIterationRate: 1,
      noOpRate: 0,
      repeatBlockerRate: 0,
      medianMinutesToMeaningfulProgress: 0,
      verificationIntegrity: 1,
      handoffEfficiency: 1,
      autonomyWindowMinutes: 0,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      transferScore: 1
    }
  });
  assert.equal(executionSmokePass.ok, true);

  const realWorkerProductStandardPass = evaluateBenchmarkThresholds({
    benchmarkTier: 'real_worker_product_standard',
    metrics: {
      productiveIterationRate: 0.9144,
      noOpRate: 0.0856,
      repeatBlockerRate: 0.05,
      medianMinutesToMeaningfulProgress: 7,
      verificationIntegrity: 1,
      handoffEfficiency: 0.9144,
      autonomyWindowMinutes: 0,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      transferScore: 0.9144,
      creativeWorkerEvidenceIntegrity: 1,
      creativeIterationIntegrity: 1,
      creativeProductDeltaIntegrity: 1,
      templateFallbackRate: 0
    }
  });
  assert.equal(realWorkerProductStandardPass.ok, true);
  assert.equal(realWorkerProductStandardPass.thresholdPolicy.policyId, REAL_WORKER_PRODUCT_STANDARD_POLICY.policyId);

  const realWorkerProductStandardFail = evaluateBenchmarkThresholds({
    benchmarkTier: 'real_worker_product_standard',
    metrics: {
      productiveIterationRate: 0.89,
      noOpRate: 0.11,
      repeatBlockerRate: 0.11,
      medianMinutesToMeaningfulProgress: 7,
      verificationIntegrity: 1,
      handoffEfficiency: 0.89,
      autonomyWindowMinutes: 0,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      transferScore: 0.89,
      creativeWorkerEvidenceIntegrity: 1,
      creativeIterationIntegrity: 1,
      creativeProductDeltaIntegrity: 1,
      templateFallbackRate: 0
    }
  });
  assert.equal(realWorkerProductStandardFail.ok, false);
  assert.deepEqual(realWorkerProductStandardFail.failures.map((entry) => entry.metric), [
    'productiveIterationRate',
    'noOpRate',
    'repeatBlockerRate',
    'handoffEfficiency',
    'transferScore'
  ]);

  const productionQualityRepairSmokePass = evaluateBenchmarkThresholds({
    benchmarkTier: 'production_quality_repair_smoke',
    metrics: {
      productiveIterationRate: 1,
      noOpRate: 0,
      repeatBlockerRate: 0,
      medianMinutesToMeaningfulProgress: 1.42,
      verificationIntegrity: 1,
      handoffEfficiency: 1,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      transferScore: 1,
      creativeWorkerEvidenceIntegrity: 1,
      creativeIterationIntegrity: 1,
      creativeProductDeltaIntegrity: 1,
      templateFallbackRate: 0
    }
  });
  assert.equal(productionQualityRepairSmokePass.ok, true);

  const productionQualityRepairSmokeFail = evaluateBenchmarkThresholds({
    benchmarkTier: 'production_quality_repair_smoke',
    metrics: {
      productiveIterationRate: 1,
      noOpRate: 0,
      repeatBlockerRate: 0,
      verificationIntegrity: 1,
      handoffEfficiency: 1,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      transferScore: 1,
      creativeWorkerEvidenceIntegrity: 1,
      creativeIterationIntegrity: 0,
      creativeProductDeltaIntegrity: 0,
      templateFallbackRate: 0
    }
  });
  assert.equal(productionQualityRepairSmokeFail.ok, false);
  assert.deepEqual(productionQualityRepairSmokeFail.failures.map((entry) => entry.metric), [
    'creativeIterationIntegrity',
    'creativeProductDeltaIntegrity'
  ]);

  const tier1Pass = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier1_smoke',
    metrics: {
      productiveIterationRate: 0.7,
      noOpRate: 0.1,
      repeatBlockerRate: 0.05,
      medianMinutesToMeaningfulProgress: 8,
      verificationIntegrity: 1,
      handoffEfficiency: 0.8,
      autonomyWindowMinutes: 35,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0
    }
  });
  assert.equal(tier1Pass.ok, true);

  const tier1CreativeProduct240mPass = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier1_creative_product_240m',
    metrics: {
      productiveIterationRate: 0.7,
      noOpRate: 0.1,
      repeatBlockerRate: 0.05,
      medianMinutesToMeaningfulProgress: 8,
      verificationIntegrity: 1,
      handoffEfficiency: 0.8,
      autonomyWindowMinutes: 240,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      creativeWorkerEvidenceIntegrity: 1,
      creativeIterationIntegrity: 1,
      creativeProductDeltaIntegrity: 1,
      templateFallbackRate: 0
    }
  });
  assert.equal(tier1CreativeProduct240mPass.ok, true);

  const tier1CreativeProduct240mProductionArchitecturePass = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier1_creative_product_240m_production_architecture',
    metrics: {
      productiveIterationRate: 0.7,
      noOpRate: 0.1,
      repeatBlockerRate: 0.05,
      medianMinutesToMeaningfulProgress: 8,
      verificationIntegrity: 1,
      handoffEfficiency: 0.8,
      autonomyWindowMinutes: 240,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      creativeWorkerEvidenceIntegrity: 1,
      creativeIterationIntegrity: 1,
      creativeProductDeltaIntegrity: 1,
      templateFallbackRate: 0,
      testFailureRegressionCount: 0,
      routeCollisionCount: 0,
      duplicateNormalizedLineRatio: 0.18,
      architectureFitnessScore: 0.95,
      architectureViolationCount: 0,
      architectureGatePass: 1,
      integrationHardeningPass: 1,
      productionQualityGatePass: 1
    }
  });
  assert.equal(tier1CreativeProduct240mProductionArchitecturePass.ok, true);

  const tier1CreativeProduct240mProductionArchitectureFail = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier1_creative_product_240m_production_architecture',
    metrics: {
      productiveIterationRate: 0.7,
      noOpRate: 0.1,
      repeatBlockerRate: 0.05,
      medianMinutesToMeaningfulProgress: 8,
      verificationIntegrity: 1,
      handoffEfficiency: 0.8,
      autonomyWindowMinutes: 240,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      creativeWorkerEvidenceIntegrity: 1,
      creativeIterationIntegrity: 1,
      creativeProductDeltaIntegrity: 1,
      templateFallbackRate: 0,
      testFailureRegressionCount: 2,
      routeCollisionCount: 1,
      duplicateNormalizedLineRatio: 0.4,
      architectureFitnessScore: 0.5,
      architectureViolationCount: 3,
      architectureGatePass: 0,
      integrationHardeningPass: 0,
      productionQualityGatePass: 0
    }
  });
  assert.equal(tier1CreativeProduct240mProductionArchitectureFail.ok, false);
  assert.deepEqual(tier1CreativeProduct240mProductionArchitectureFail.failures.map((entry) => entry.metric), [
    'testFailureRegressionCount',
    'routeCollisionCount',
    'duplicateNormalizedLineRatio',
    'architectureFitnessScore',
    'architectureViolationCount',
    'architectureGatePass',
    'integrationHardeningPass',
    'productionQualityGatePass'
  ]);

  const tier1CreativeProduct240mShortFail = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier1_creative_product_240m',
    metrics: {
      productiveIterationRate: 1,
      noOpRate: 0,
      repeatBlockerRate: 0,
      medianMinutesToMeaningfulProgress: 1,
      verificationIntegrity: 1,
      handoffEfficiency: 1,
      autonomyWindowMinutes: 120,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      creativeWorkerEvidenceIntegrity: 1,
      creativeIterationIntegrity: 1,
      creativeProductDeltaIntegrity: 1,
      templateFallbackRate: 0
    }
  });
  assert.equal(tier1CreativeProduct240mShortFail.ok, false);
  assert.deepEqual(tier1CreativeProduct240mShortFail.failures.map((entry) => entry.metric), ['autonomyWindowMinutes']);

  const tier1ShortCanaryFail = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier1_smoke',
    metrics: {
      productiveIterationRate: 1,
      noOpRate: 0,
      repeatBlockerRate: 0,
      medianMinutesToMeaningfulProgress: 0,
      verificationIntegrity: 1,
      handoffEfficiency: 1,
      autonomyWindowMinutes: 0,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0
    }
  });
  assert.equal(tier1ShortCanaryFail.ok, false);
  assert.deepEqual(tier1ShortCanaryFail.failures.map((entry) => entry.metric), ['autonomyWindowMinutes']);

  const tier2Fail = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier2_functional',
    metrics: {
      productiveIterationRate: 1,
      noOpRate: 0,
      repeatBlockerRate: 0,
      medianMinutesToMeaningfulProgress: 0.1,
      verificationIntegrity: 1,
      handoffEfficiency: 1,
      autonomyWindowMinutes: 0.01,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      transferScore: null
    }
  });
  assert.equal(tier2Fail.ok, false);
  assert.deepEqual(tier2Fail.failures.map((entry) => entry.metric), ['autonomyWindowMinutes', 'transferScore']);

  const tier3GameTolerantGreen = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier3_game_vertical_slice_100agent',
    metrics: {
      productiveIterationRate: 0.98,
      noOpRate: 0.02,
      repeatBlockerRate: 0.02,
      medianMinutesToMeaningfulProgress: 12,
      verificationIntegrity: 1,
      handoffEfficiency: 0.98,
      autonomyWindowMinutes: 240,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      surfaceReliabilityScore: 0.98,
      classifiedFailureIntegrity: 1,
      creativeWorkerEvidenceIntegrity: 0.98,
      creativeIterationIntegrity: 0.98,
      creativeProductDeltaIntegrity: 0.98,
      templateFallbackRate: 0,
      activeAgentScaleProof: 100,
      admissionGateIntegrity: 0.98,
      schedulerRecoveryIntegrity: 1,
      gameBuildGatePass: 1,
      gameSceneLoadGatePass: 1,
      gameInputCombatHarnessPass: 1,
      assetManifestGatePass: 1,
      repairLaneConverged: 1
    }
  });
  assert.equal(tier3GameTolerantGreen.ok, true);

  const tier3GameBelowReliabilityFloor = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier3_game_vertical_slice_100agent',
    metrics: {
      productiveIterationRate: 0.89,
      noOpRate: 0.05,
      repeatBlockerRate: 0.05,
      medianMinutesToMeaningfulProgress: 12,
      verificationIntegrity: 1,
      handoffEfficiency: 0.89,
      autonomyWindowMinutes: 240,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      surfaceReliabilityScore: 0.89,
      classifiedFailureIntegrity: 1,
      creativeWorkerEvidenceIntegrity: 0.89,
      creativeIterationIntegrity: 0.89,
      creativeProductDeltaIntegrity: 0.89,
      templateFallbackRate: 0,
      activeAgentScaleProof: 100,
      admissionGateIntegrity: 0.89,
      schedulerRecoveryIntegrity: 1,
      gameBuildGatePass: 1,
      gameSceneLoadGatePass: 1,
      gameInputCombatHarnessPass: 1,
      assetManifestGatePass: 1,
      repairLaneConverged: 1
    }
  });
  assert.equal(tier3GameBelowReliabilityFloor.ok, false);
  assert.equal(tier3GameBelowReliabilityFloor.failures.some((entry) => entry.metric === 'surfaceReliabilityScore'), true);
  assert.equal(tier3GameBelowReliabilityFloor.failures.some((entry) => entry.metric === 'admissionGateIntegrity'), true);
});

test('system benchmark derives autonomy and runtime targets from benchmark scope', () => {
  const autonomy = deriveBenchmarkAutonomyMetrics({
    elapsedMs: 441,
    scope: { durationTargetMinutes: 60 }
  });
  assert.equal(autonomy.elapsedMinutes, 0.01);
  assert.equal(autonomy.autonomyWindowMinutes, 0.01);
  assert.equal(autonomy.durationTargetMinutes, 60);
  assert.equal(autonomy.durationTargetMet, false);
  assert.equal(autonomy.endedBeforeDurationTarget, true);
  assert.equal(autonomy.durationTargetGapMinutes, 59.99);

  const maxRuntimeMs = resolveBenchmarkMaxRuntimeMs({
    scope: { durationTargetMinutes: 60 },
    env: {}
  });
  assert.equal(maxRuntimeMs, (60 * 60 * 1000) + (3 * 60 * 1000));

  const leaseTtlMs = resolveBenchmarkLeaseTtlMs({
    scope: { durationTargetMinutes: 60 },
    env: {},
    maxRuntimeMs
  });
  assert.equal(leaseTtlMs, maxRuntimeMs);

  const envLeaseTtlMs = resolveBenchmarkLeaseTtlMs({
    scope: { durationTargetMinutes: 60 },
    env: { TRANSFER_BENCHMARK_LEASE_TTL_MS: '9000' },
    maxRuntimeMs
  });
  assert.equal(envLeaseTtlMs, 9000);

  const workerTimeoutMs = resolveBenchmarkWorkerTimeoutMs({
    scope: {
      durationTargetMinutes: 30,
      surfaces: [
        {
          id: 'endurance_surface',
          verification: ['PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS="${PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS_OVERRIDE:-1800000}" node verify.mjs endurance_surface']
        }
      ]
    },
    env: {},
    maxRuntimeMs: resolveBenchmarkMaxRuntimeMs({ scope: { durationTargetMinutes: 30 }, env: {} })
  });
  assert.equal(workerTimeoutMs, 1890000);

  const explicitWorkerTimeoutMs = resolveBenchmarkWorkerTimeoutMs({
    scope: { workerTimeoutMs: 12345 },
    env: {},
    maxRuntimeMs: 60000
  });
  assert.equal(explicitWorkerTimeoutMs, 12345);
});

test('system benchmark ground truth summary separates trusted passes from mechanical greens', () => {
  const summary = buildBenchmarkGroundTruth({
    generatedAt: '2026-04-16T06:00:00.000Z',
    rows: [
      {
        runId: 'a-001',
        benchmarkId: 'bench_a',
        tier: 'tier1_smoke',
        pass: false,
        mechanicalGreen: true,
        scaleProofReady: true,
        thresholdFailures: [{ metric: 'autonomyWindowMinutes' }],
        blockerFamily: 'benchmark_thresholds_unmet',
        notes: 'mechanical only'
      },
      {
        runId: 'b-001',
        benchmarkId: 'bench_b',
        tier: 'tier1_smoke',
        pass: true,
        mechanicalGreen: true,
        scaleProofReady: true,
        thresholdFailures: [],
        blockerFamily: null,
        notes: 'trusted pass'
      }
    ]
  });

  assert.equal(summary.trustedThresholdPassCount, 1);
  assert.equal(summary.mechanicalGreenCount, 2);
  assert.deepEqual(summary.benchmarksWithoutTrustedPass, ['bench_a']);
  assert.equal(summary.benchmarks.find((entry) => entry.benchmarkId === 'bench_a').latestStatus, 'mechanical_green_threshold_red');
});

test('system benchmark can bootstrap a transfer benchmark artifact root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-bootstrap-'));
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'pmhnp_denial_copilot_transfer',
    benchmarkTier: 'tier1_smoke',
    repoPath: '/tmp/pmhnp-denial-copilot',
    scope: {
      durationTargetMinutes: 60,
      surfaces: [
        {
          id: 'tebra_onboarding_flow',
          label: 'Tebra onboarding flow',
          allowedFiles: ['src/domain/tebraOnboarding.mjs'],
          verification: ['node scripts/smoke-test.mjs']
        }
      ]
    },
    verifierSet: [{ kind: 'node_script', command: 'node scripts/smoke-test.mjs' }],
    requestedAgentCount: 10,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'pmhnp_denial_copilot_transfer', 'bootstrap-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  assert.equal(fs.existsSync(path.join(bootstrap.root, 'run_contract.json')), true);
  assert.equal(fs.existsSync(path.join(bootstrap.root, 'surface_matrix.json')), true);
  assert.equal(fs.existsSync(path.join(bootstrap.root, 'scoreboard_row.json')), true);
  const matrix = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'surface_matrix.json'), 'utf8'));
  assert.equal(matrix.surfaces[0].id, 'tebra_onboarding_flow');
});

test('system benchmark transfer runner executes verifiers and updates artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-runner-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'pass.mjs'), "console.log('ok');\n");
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'transfer_runner_demo',
    benchmarkTier: 'tier1_smoke',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 15,
      surfaces: [
        {
          id: 'demo_surface',
          label: 'Demo surface',
          allowedFiles: ['pass.mjs'],
          verification: ['node pass.mjs']
        }
      ]
    },
    verifierSet: [{ kind: 'node_script', command: 'node pass.mjs' }],
    requestedAgentCount: 2,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'transfer_runner_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'completion_summary.json'), 'utf8'));
  const scoreboard = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json'), 'utf8'));
  assert.equal(completion.baselineReady, true);
  assert.equal(completion.thresholdPass, false);
  assert.equal(scoreboard.rows[0].blockerSemantics, 'baseline_ready');
});

test('system benchmark transfer orchestrator runner executes live worker farm honestly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-orchestrator-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'pass-a.mjs'), "console.log('a');\n");
  fs.writeFileSync(path.join(repo, 'pass-b.mjs'), "console.log('b');\n");
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'transfer_orchestrator_demo',
    benchmarkTier: 'tier1_smoke',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 15,
      surfaces: [
        {
          id: 'surface_a',
          label: 'Surface A',
          allowedFiles: ['pass-a.mjs'],
          verification: ['node pass-a.mjs']
        },
        {
          id: 'surface_b',
          label: 'Surface B',
          allowedFiles: ['pass-b.mjs'],
          verification: ['node pass-b.mjs']
        }
      ]
    },
    verifierSet: [
      { kind: 'node_script', command: 'node pass-a.mjs' },
      { kind: 'node_script', command: 'node pass-b.mjs' }
    ],
    requestedAgentCount: 2,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'transfer_orchestrator_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'completion_summary.json'), 'utf8'));
  const matrix = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'surface_matrix.json'), 'utf8'));
  const transferEvidence = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'transfer_evidence.json'), 'utf8'));
  const schedulerTruth = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'scheduler_truth.json'), 'utf8'));
  const scoreboard = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json'), 'utf8'));
  assert.equal(completion.thresholdPass, false);
  assert.equal(completion.supervisorConfirmedCompletion, true);
  assert.equal(completion.mechanicalGreen, true);
  assert.equal(completion.scaleProofReady, false);
  assert.equal(Array.isArray(completion.thresholdFailures), true);
  assert.equal(completion.thresholdFailures.some((entry) => entry.metric === 'autonomyWindowMinutes'), true);
  assert.equal(completion.blocker.scaleCredit.failures.some((failure) => failure.reason === 'insufficient_productive_merges'), true);
  assert.equal(completion.transferScore, 0);
  assert.match(completion.note, /scale credit is blocked/i);
  assert.equal(matrix.surfaces.every((surface) => surface.status === 'verified'), true);
  assert.equal(transferEvidence.requiresRealProductDiffs, true);
  assert.equal(transferEvidence.verificationScore, 1);
  assert.equal(transferEvidence.transferScore, 0);
  assert.equal(transferEvidence.verifiedSurfaceCount, 2);
  assert.equal(transferEvidence.productiveSurfaceCount, 0);
  assert.equal(schedulerTruth.scaleCredit.eligible, false);
  assert.equal(scoreboard.rows[0].pass, false);
  assert.equal(scoreboard.rows[0].productiveIterationRate, 0);
  assert.equal(scoreboard.rows[0].noOpRate, 1);
  assert.equal(scoreboard.rows[0].transferScore, 0);
  assert.equal(scoreboard.rows[0].blockerFamily, 'unproductive_scale_credit');
});

test('creative transfer orchestrator defaults to isolated worker workspaces and promotes only accepted deltas', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-orchestrator-creative-isolation-default-'));
  const repo = path.join(root, 'repo');
  const fakeWorker = path.join(root, 'fake-creative-worker.mjs');
  write(path.join(repo, 'packages', 'app', 'creative-default.mjs'), 'export const creativeDefaultBaseline = true;\n');
  write(fakeWorker, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const workspace = process.env.CREATIVE_WORKER_WORKSPACE;
const target = (process.env.CREATIVE_WORKER_ALLOWED_FILES || '').split(',').filter(Boolean).find((entry) => entry.endsWith('.mjs'));
if (!workspace || !target) process.exit(2);
fs.appendFileSync(path.join(workspace, target), '\\nexport function isolatedWorkerDefaultBehavior(input = {}) {\\n  const enabled = input.enabled !== false;\\n  return { kind: "isolated_worker_default", enabled, status: enabled ? "ready" : "disabled" };\\n}\\n');
fs.writeFileSync(process.env.CREATIVE_WORKER_EVIDENCE_PATH, JSON.stringify({
  ok: true,
  summary: 'fake creative worker updated the assigned product module',
  iterations: [{ kind: 'edit', changedAllowedFilesAfterIteration: [target] }],
  filesChanged: [target],
  productFilesChanged: [target],
  testsRun: [{ command: 'node --check ' + target, ok: true }]
}, null, 2));
`);
  fs.chmodSync(fakeWorker, 0o755);
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'transfer_orchestrator_creative_isolation_default',
    benchmarkTier: 'tier1_smoke',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 15,
      productDiffMode: 'creative_product_work',
      creativeProductWork: { required: true, minIterations: 1, minWorkerRuntimeMs: 0 },
      surfaces: [
        {
          id: 'creative_default_surface',
          label: 'Creative default surface',
          productFiles: ['packages/app/creative-default.mjs'],
          allowedFiles: ['packages/app/creative-default.mjs'],
          verification: ['node --check packages/app/creative-default.mjs']
        }
      ]
    },
    verifierSet: [{ kind: 'node_script', command: 'node --check packages/app/creative-default.mjs' }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'transfer_orchestrator_creative_isolation_default', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const env = {
    ...process.env,
    CREATIVE_WORKER_COMMAND: `${process.execPath} ${fakeWorker}`,
    CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
    CODEX_CREATIVE_MAX_ITERATIONS: '1',
    CREATIVE_WORKER_COMMAND_TIMEOUT_MS: '60000',
    ORCHESTRATOR_MAX_SPAWNS_PER_TICK: '1'
  };
  delete env.ORCHESTRATOR_WORKER_WORKSPACE_MODE;
  delete env.ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS;
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'summary.json'), 'utf8'));
  const patchQueue = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'patch_queue.json'), 'utf8'));
  assert.equal(summary.metrics.workerWorkspaceMode, 'isolated_product_copy');
  assert.equal(summary.metrics.isolatedWorkerWorkspaces, true);
  assert.equal(summary.metrics.workerWorkspacePromotionEnabled, true);
  assert.equal(patchQueue.merged.length, 1);
  assert.equal(patchQueue.rejected.length, 0);
  assert.match(fs.readFileSync(path.join(repo, 'packages', 'app', 'creative-default.mjs'), 'utf8'), /isolatedWorkerDefaultBehavior/);
});

test('game100 aggregation credits malformed-but-recoverable Godot verifier stdout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game100-verifier-aggregation-'));
  const repo = path.join(root, 'repo');
  write(path.join(repo, 'project.godot'), '[application]\nconfig/name="Game Aggregation Fixture"\n');
  write(path.join(repo, 'scripts', 'game_surface.gd'), 'extends Node\nfunc existing_game_surface() -> bool:\n\treturn true\n');
  write(path.join(repo, 'invalid-game-verifier.mjs'), `const rawNewline = String.fromCharCode(10);
const output = [
  '{',
  '  "schemaVersion": "clawd.godot_game_surface_verifier.v1",',
  '  "ok": true,',
  '  "surfaceId": "game_surface",',
  '  "file": "scripts/game_surface.gd",',
  '  "kind": "asset_pipeline",',
  '  "lane": "assets_vfx_audio",',
  '  "durationMs": 1,',
  '  "firstMeaningfulProgressMs": 0,',
  '  "cyclesCompleted": 1,',
  '  "checkKinds": ["repo_exists", "godot_project_file_present", "assigned_file_is_godot_product_path", "assigned_product_file_present", "assigned_product_file_nontrivial", "godot_cli_available_when_required", "godot_headless_scene_load_harness", "godot_movement_combat_harness", "asset_manifest_present"],',
  '  "blockingFailureCount": 0,',
  '  "cycles": [{ "checks": [{ "id": "repo_exists", "ok": true, "stdout": "line one' + rawNewline + 'line two" }] }]',
  '}'
].join('\\n');
process.stdout.write(output);
`);
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'game100_verifier_aggregation_demo',
    benchmarkTier: 'tier3_game_vertical_slice_100agent',
    benchmarkClass: 'greenfield_game_vertical_slice',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 0,
      productDiffMode: 'deterministic_metadata_patch',
      requireRealProductDiffs: true,
      gameVerification: { required: true },
      surfaceReliability: {
        enabled: true,
        greenMinVerifiedProductiveRatio: 1,
        yellowMinVerifiedProductiveRatio: 1,
        perfectVerifiedProductiveSurfaces: 1,
        maxToleratedFailedSurfaces: 0,
        requireClassifiedFailures: true
      },
      surfaces: [{
        id: 'game_surface',
        label: 'Game Surface',
        allowedFiles: ['scripts/game_surface.gd'],
        productFiles: ['scripts/game_surface.gd'],
        targetFiles: ['scripts/game_surface.gd'],
        fileAreas: ['scripts/game_surface.gd'],
        verification: ['node invalid-game-verifier.mjs'],
        metadata: { game100AgentReadiness: true, primaryProductFile: 'scripts/game_surface.gd' }
      }]
    },
    verifierSet: [{ kind: 'godot_game_surface', command: 'node invalid-game-verifier.mjs' }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'game100_verifier_aggregation_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const gameEvidence = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'game_verification_evidence.json'), 'utf8'));
  const transferEvidence = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'transfer_evidence.json'), 'utf8'));
  assert.equal(transferEvidence.verifiedSurfaceCount, 1);
  assert.equal(gameEvidence.verifierOutputCount, 1);
  assert.equal(gameEvidence.greenVerifierOutputCount, 1);
  assert.equal(gameEvidence.gameBuildGatePass, 1);
  assert.equal(gameEvidence.gameSceneLoadGatePass, 1);
  assert.equal(gameEvidence.gameInputCombatHarnessPass, 1);
  assert.equal(gameEvidence.assetManifestGatePass, 1);
  assert.equal(gameEvidence.observedChecks.includes('godot_headless_scene_load_harness'), true);
});

test('transfer orchestrator rejects unsupported Agent Work v0.1 policies before worker launch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-agent-work-policy-unsupported-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'pass-a.mjs'), "console.log('a');\n");
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'agent_work_policy_unsupported_demo',
    benchmarkTier: 'tier1_smoke',
    repoPath: repo,
    scope: {
      budgets: { mystery_units: 1 },
      surfaces: [{ id: 'surface_a', label: 'Surface A', allowedFiles: ['pass-a.mjs'], verification: ['node pass-a.mjs'] }]
    },
    verifierSet: [{ kind: 'node_script', command: 'node pass-a.mjs' }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'agent_work_policy_unsupported_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });

  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(runner.status, 2, runner.stdout || runner.stderr);
  assert.equal(fs.existsSync(path.join(bootstrap.root, 'orchestrator_run', 'worker_events.json')), false);
  const policy = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'agent_work_policy_report.json'), 'utf8'));
  const blocker = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'blocker_report.json'), 'utf8'));
  assert.equal(policy.status, 'blocked_preflight');
  assert.equal(policy.unsupportedPolicies[0].key, 'mystery_units');
  assert.equal(blocker.blockerFamily, 'agent_work_unsupported_policy');
  assert.equal(blocker.unsupportedPolicy, true);
});

test('transfer orchestrator blocks real Codex product claim before deterministic worker launch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-claim-integrity-preflight-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/surface-a.mjs'), "export const surfaceA = 1;\n");
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'claim_integrity_preflight_demo',
    benchmarkTier: 'tier1_smoke',
    repoPath: repo,
    scope: {
      productDiffMode: 'semantic_product_architecture',
      semanticProductAdmission: { required: true, requireRuntimeExecution: true },
      surfaces: [{
        id: 'surface_a',
        label: 'Surface A',
        allowedFiles: ['packages/app/surface-a.mjs'],
        verification: ['node -e "console.log(JSON.stringify({ok:true,firstMeaningfulProgressMs:0}))"']
      }]
    },
    verifierSet: [{ kind: 'node_script', command: 'node -e "console.log(JSON.stringify({ok:true}))"' }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'claim_integrity_preflight_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const contractPath = path.join(bootstrap.root, 'run_contract.json');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  contract.metadata = { requestedClaim: 'real_codex_product_work' };
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);

  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), contractPath], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(runner.status, 2, runner.stdout || runner.stderr);
  assert.equal(fs.existsSync(path.join(bootstrap.root, 'orchestrator_run', 'worker_events.json')), false);
  const preflight = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'claim_integrity_preflight.json'), 'utf8'));
  const completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'completion_summary.json'), 'utf8'));
  const blocker = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'blocker_report.json'), 'utf8'));
  assert.equal(preflight.ok, false);
  assert.equal(preflight.requestedClaim, 'real_codex_product_work');
  assert.equal(preflight.blockingFailures.some((check) => check.id === 'real_codex_claim_uses_model_worker_mode'), true);
  assert.equal(completion.executionMode, 'claim_integrity_preflight_blocked');
  assert.equal(blocker.blockerFamily, 'claim_integrity_preflight_blocked');
});

test('transfer orchestrator enforces Agent Work worker prompt token budget as hard pre-spawn gate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-agent-work-policy-budget-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'pass-a.mjs'), "console.log('a');\n");
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'agent_work_policy_budget_demo',
    benchmarkTier: 'tier1_smoke',
    repoPath: repo,
    scope: {
      budgets: { worker_prompt_tokens: 1 },
      wavePolicy: { full_context_waves: 0 },
      surfaces: [{ id: 'surface_a', label: 'Surface A', allowedFiles: ['pass-a.mjs'], verification: ['node pass-a.mjs'] }]
    },
    verifierSet: [{ kind: 'node_script', command: 'node pass-a.mjs' }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'agent_work_policy_budget_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });

  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(runner.status, 1, runner.stdout || runner.stderr);
  const policy = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'agent_work_policy_report.json'), 'utf8'));
  const completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'completion_summary.json'), 'utf8'));
  const workerEvents = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'worker_events.json'), 'utf8'));
  assert.equal(policy.status, 'blocked');
  assert.equal(policy.runtimeChecks.some((check) => check.key === 'context_governor_budget' && check.ok === false), true);
  assert.equal(workerEvents.length, 0);
  assert.equal(completion.blocker.unsupportedPolicy, false);
  assert.match(completion.blocker.blocker, /policy enforcement failed/i);
});

test('Agent Work objective controller expands to a second wave when objective remains red', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-agent-work-objective-controller-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/surface-a.mjs'), 'export const surfaceA = 1;\n');
  fs.writeFileSync(path.join(repo, 'packages/app/surface-b.mjs'), 'export const surfaceB = 1;\n');
  fs.writeFileSync(path.join(repo, 'packages/app/surface-c.mjs'), 'export const surfaceC = 1;\n');
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'agent_work_objective_controller_demo',
    benchmarkTier: 'execution_smoke',
    repoPath: repo,
    scope: {
      productDiffMode: 'deterministic_metadata_patch',
      requireRealProductDiffs: true,
      budgets: { global_calls: 2 },
      wavePolicy: { max_waves: 2, bundle_size: 2, full_context_waves: 0, handoff: 'wave_factpack' },
      expansionPolicy: { triggers: ['objective_red', 'graph_exhausted'], max_cycles: 2, max_surfaces: 3, strategy: 'decompose_missing_surfaces' },
      evidenceSchemas: [{
        id: 'two_surface_threshold',
        gates: [
          { expression: 'verified_surface_count >= 2', metric: 'verified_surface_count', operator: '>=', expected: '2' },
          { expression: 'productive_surface_count >= 2', metric: 'productive_surface_count', operator: '>=', expected: '2' },
          { expression: 'transfer_score >= 1', metric: 'transfer_score', operator: '>=', expected: '1' }
        ]
      }],
      surfaces: [{
        id: 'surface_a',
        label: 'Surface A',
        allowedFiles: ['packages/app/surface-a.mjs'],
        verification: ['node --check packages/app/surface-a.mjs']
      }]
    },
    verifierSet: [{ kind: 'node_script', command: 'node --check packages/app/surface-a.mjs' }],
    requestedAgentCount: 2,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'agent_work_objective_controller_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });

  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  assert.match(packageJson.scripts['benchmark:transfer:orchestrate'], /run-agent-work-objective-controller\.mjs/);
  assert.match(packageJson.scripts['benchmark:transfer:orchestrate:finite'], /run-transfer-orchestrator-benchmark\.mjs/);
  const runner = spawnSync('npm', ['run', '-s', 'benchmark:transfer:orchestrate', '--', path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'objective_controller_summary.json'), 'utf8'));
  const inputResolution = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'controller_input_resolution.json'), 'utf8'));
  const completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'completion_summary.json'), 'utf8'));
  const wave1Completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'waves', 'wave-001', 'completion_summary.json'), 'utf8'));
  const wave1Blocker = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'waves', 'wave-001', 'blocker_report.json'), 'utf8'));
  const wave2Completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'waves', 'wave-002', 'completion_summary.json'), 'utf8'));
  const wave2Contract = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'waves', 'wave-002', 'run_contract.json'), 'utf8'));
  const wave2Policy = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'waves', 'wave-002', 'agent_work_policy_report.json'), 'utf8'));
  assert.equal(summary.status, 'passed');
  assert.equal(inputResolution.runtime.defaultRunner, 'objective_controller');
  assert.equal(summary.waveCount, 2);
  assert.equal(summary.expansionCount, 1);
  assert.equal(summary.expansions[0].shouldExpand, true);
  assert.equal(wave1Completion.thresholdPass, false);
  assert.equal(wave1Blocker.status, 'blocked');
  assert.equal(wave1Blocker.unsupportedPolicy, false);
  assert.equal(wave2Completion.thresholdPass, true);
  assert.equal(completion.thresholdPass, true);
  assert.equal(wave2Contract.scope.expansionPolicy && Object.keys(wave2Contract.scope.expansionPolicy).length, 0);
  assert.match(wave2Contract.scope.contextGovernor.previousWaveFactpackPath, /wave-001/);
  assert.equal(wave2Contract.scope.surfaces.length, 2);
  assert.deepEqual(wave2Contract.scope.surfaces.map((surface) => surface.id).sort(), ['surface_b', 'surface_c']);
  assert.equal(wave2Policy.status, 'green');
  assert.equal(wave2Policy.evidenceSchemaResults[0].ok, true);
});

test('Agent Work objective controller does not expand unsupported policy blockers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-agent-work-objective-controller-unsupported-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/surface-a.mjs'), 'export const surfaceA = 1;\n');
  fs.writeFileSync(path.join(repo, 'packages/app/surface-b.mjs'), 'export const surfaceB = 1;\n');
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'agent_work_objective_controller_unsupported_demo',
    benchmarkTier: 'execution_smoke',
    repoPath: repo,
    scope: {
      productDiffMode: 'deterministic_metadata_patch',
      requireRealProductDiffs: true,
      budgets: { global_calls: 2, unsupported_magic_budget: 1 },
      wavePolicy: { max_waves: 2, bundle_size: 1, full_context_waves: 0, handoff: 'wave_factpack' },
      expansionPolicy: { triggers: ['objective_red', 'graph_exhausted'], max_cycles: 2, max_surfaces: 2, strategy: 'decompose_missing_surfaces' },
      surfaces: [{
        id: 'surface_a',
        label: 'Surface A',
        allowedFiles: ['packages/app/surface-a.mjs'],
        verification: ['node --check packages/app/surface-a.mjs']
      }]
    },
    verifierSet: [{ kind: 'node_script', command: 'node --check packages/app/surface-a.mjs' }],
    requestedAgentCount: 2,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'agent_work_objective_controller_unsupported_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });

  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-agent-work-objective-controller.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(runner.status, 1, runner.stdout || runner.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'objective_controller_summary.json'), 'utf8'));
  const completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'completion_summary.json'), 'utf8'));
  const blocker = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'blocker_report.json'), 'utf8'));
  const wave1Blocker = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'waves', 'wave-001', 'blocker_report.json'), 'utf8'));
  assert.equal(summary.status, 'blocked');
  assert.equal(summary.waveCount, 1);
  assert.equal(summary.expansionCount, 0);
  assert.equal(summary.blocker.blockerFamily, 'objective_red_not_expandable');
  assert.equal(summary.blocker.expansionAllowedReason, 'unsupported_policy_blocker');
  assert.equal(completion.thresholdPass, false);
  assert.equal(blocker.blockerFamily, 'objective_red_not_expandable');
  assert.equal(wave1Blocker.blockerFamily, 'agent_work_unsupported_policy');
  assert.equal(fs.existsSync(path.join(bootstrap.root, 'waves', 'wave-002')), false);
});

test('Agent Work objective controller can launch a bounded failed-surface repair wave', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-agent-work-objective-controller-repair-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/good-surface.mjs'), 'export const goodSurface = 1;\n');
  fs.writeFileSync(path.join(repo, 'packages/app/bad-surface.mjs'), 'export const badSurface = ;\n');
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'agent_work_objective_controller_failed_surface_repair_demo',
    benchmarkTier: 'execution_smoke',
    repoPath: repo,
    scope: {
      productDiffMode: 'deterministic_metadata_patch',
      requireRealProductDiffs: true,
      wavePolicy: { max_waves: 2, bundle_size: 1, full_context_waves: 0, handoff: 'wave_factpack' },
      expansionPolicy: { triggers: ['failed_surfaces'], max_cycles: 1, max_surfaces: 2, strategy: 'repair_failed_surfaces' },
      surfaces: [
        {
          id: 'good_surface',
          label: 'Good Surface',
          allowedFiles: ['packages/app/good-surface.mjs'],
          verification: ['node --check packages/app/good-surface.mjs']
        },
        {
          id: 'bad_surface',
          label: 'Bad Surface',
          allowedFiles: ['packages/app/bad-surface.mjs'],
          verification: ['node --check packages/app/bad-surface.mjs']
        }
      ]
    },
    verifierSet: [{ kind: 'node_script', command: 'node --check packages/app/good-surface.mjs' }],
    requestedAgentCount: 2,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'agent_work_objective_controller_failed_surface_repair_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });

  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-agent-work-objective-controller.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(runner.status, 1, runner.stdout || runner.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'objective_controller_summary.json'), 'utf8'));
  const wave1Completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'waves', 'wave-001', 'completion_summary.json'), 'utf8'));
  const wave2Contract = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'waves', 'wave-002', 'run_contract.json'), 'utf8'));
  const repairPlan = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'expansions', 'expansion-001', 'failed_surface_repair_plan.json'), 'utf8'));
  assert.equal(wave1Completion.thresholdPass, false);
  assert.equal(wave1Completion.blocker.blockerFamily, 'orchestrator_failure');
  assert.equal(summary.waveCount, 2);
  assert.equal(summary.expansionCount, 1);
  assert.equal(summary.expansions[0].reason, 'repair_failed_surfaces');
  assert.deepEqual(repairPlan.surfaces.map((surface) => surface.id), ['bad_surface']);
  assert.deepEqual(wave2Contract.scope.surfaces.map((surface) => surface.id), ['bad_surface']);
  assert.equal(wave2Contract.requestedAgentCount, 1);
  assert.equal(wave2Contract.metadata.agentWorkObjectiveController.originalRequestedAgentCount, 2);
  assert.equal(wave2Contract.metadata.agentWorkObjectiveController.effectiveRequestedAgentCount, 1);
  assert.equal(wave2Contract.metadata.agentWorkObjectiveController.requestedAgentCountAdjustedForRepairWave, true);
  assert.equal(wave2Contract.scope.surfaces[0].metadata.repairFailedSurface, true);
});

test('system benchmark transfer orchestrator can require deterministic product diffs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-orchestrator-product-diff-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'surface-a.mjs'), "export const a = 1;\n");
  fs.writeFileSync(path.join(repo, 'surface-b.mjs'), "export const b = 1;\n");
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'transfer_orchestrator_product_diff_demo',
    benchmarkTier: 'tier1_smoke',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 15,
      budgets: { global_calls: 2 },
      evidenceSchemas: [{
        id: 'productive_policy',
        gates: ['verified_surface_count >= 2', 'productive_surface_count >= 2', 'transfer_score >= 1']
      }],
      productDiffMode: 'deterministic_metadata_patch',
      requireRealProductDiffs: true,
      surfaces: [
        {
          id: 'surface_a',
          label: 'Surface A',
          allowedFiles: ['surface-a.mjs'],
          verification: ['node surface-a.mjs']
        },
        {
          id: 'surface_b',
          label: 'Surface B',
          allowedFiles: ['surface-b.mjs'],
          verification: ['node surface-b.mjs']
        }
      ]
    },
    verifierSet: [
      { kind: 'node_script', command: 'node surface-a.mjs' },
      { kind: 'node_script', command: 'node surface-b.mjs' }
    ],
    requestedAgentCount: 2,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'transfer_orchestrator_product_diff_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'completion_summary.json'), 'utf8'));
  const transferEvidence = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'transfer_evidence.json'), 'utf8'));
  const landingEvidence = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'landing_evidence.json'), 'utf8'));
  const policy = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'agent_work_policy_report.json'), 'utf8'));
  const patchQueue = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'patch_queue.json'), 'utf8'));
  assert.equal(completion.mechanicalGreen, true);
  assert.equal(completion.scaleProofReady, true);
  assert.equal(completion.transferScore, 1);
  assert.equal(transferEvidence.requiresRealProductDiffs, true);
  assert.equal(transferEvidence.productiveSurfaceCount, 2);
  assert.equal(landingEvidence.summary.status, 'green');
  assert.equal(policy.status, 'green');
  assert.equal(policy.runtimeChecks.some((check) => check.key === 'global_calls' && check.ok === true && check.workerSpawnCount === 2), true);
  assert.equal(policy.evidenceSchemaResults[0].ok, true);
  assert.equal(landingEvidence.summary.creditedPatchCount, 2);
  assert.equal(transferEvidence.surfaces.every((surface) => surface.landedProductDiff === true), true);
  assert.equal(patchQueue.merged.every((entry) => entry.filePaths.length === 1), true);
  assert.equal(patchQueue.merged.every((entry) => entry.canonicalLandingRecord?.eligible === true), true);
  assert.match(fs.readFileSync(path.join(repo, 'surface-a.mjs'), 'utf8'), /transferBenchmarkEvidence_surface_a/);
  assert.match(fs.readFileSync(path.join(repo, 'surface-b.mjs'), 'utf8'), /transferBenchmarkEvidence_surface_b/);
});

test('transfer orchestrator preserves zero-ms meaningful progress through verifier wrappers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-zero-progress-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'surface-a.mjs'), 'export const surfaceA = 1;\n');
  fs.writeFileSync(path.join(repo, 'zero-progress-verifier.mjs'), `console.log(JSON.stringify({
  ok: true,
  scenarioId: 'surface_a',
  surfaceId: 'surface_a',
  durationMs: 7200000,
  requestedDurationMs: 7200000,
  firstMeaningfulProgressMs: 0,
  firstMeaningfulProgressAt: new Date().toISOString(),
  cyclesCompleted: 3,
  checkKinds: ['file_exists', 'product_delta']
}));\n`);
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'transfer_orchestrator_zero_progress_demo',
    benchmarkTier: 'tier1_smoke',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 15,
      productDiffMode: 'deterministic_metadata_patch',
      requireRealProductDiffs: true,
      surfaces: [
        {
          id: 'surface_a',
          label: 'Surface A',
          allowedFiles: ['surface-a.mjs'],
          verification: ['node zero-progress-verifier.mjs']
        }
      ]
    },
    verifierSet: [{ kind: 'node_script', command: 'node zero-progress-verifier.mjs' }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'transfer_orchestrator_zero_progress_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const patchQueue = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'patch_queue.json'), 'utf8'));
  assert.equal(patchQueue.merged.length, 1);
  const result = JSON.parse(fs.readFileSync(patchQueue.merged[0].metadata.resultPath, 'utf8'));
  assert.equal(result.implementation.firstMeaningfulProgressMs, 0);
  assert.equal(result.verifierResults[0].firstMeaningfulProgressMs, 0);
  assert.equal(result.verifierResults[0].metadata.parsedOutputSummary.firstMeaningfulProgressMs, 0);
  const threshold = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'threshold_evaluation.json'), 'utf8'));
  assert.equal(threshold.meaningfulProgressEvidence.measuredSurfaceCount, 1);
  assert.ok(threshold.meaningfulProgressEvidence.medianMinutesToMeaningfulProgress < 1, JSON.stringify(threshold.meaningfulProgressEvidence));
});

test('transfer orchestrator semantic product mode credits concrete runtime architecture patches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-orchestrator-semantic-admission-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/app/storage'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/surface-a.mjs'), 'export const baselineSurfaceA = Object.freeze({ surfaceId: "surface_a", role: "primary_runtime" });\nexport function existingRuntime(input = {}) { return { ok: true, id: input.id || "surface-a", contract: baselineSurfaceA }; }\n');
  fs.writeFileSync(path.join(repo, 'packages/app/storage/surface-a-store.mjs'), 'export const baselineSurfaceAStore = Object.freeze({ surfaceId: "surface_a", role: "companion_store" });\nexport function saveSurfaceA(record = {}) { return { ...record, saved: true, contract: baselineSurfaceAStore }; }\n');
  const semanticVerifier = path.join(process.cwd(), 'apps/system-benchmark/verify-semantic-architecture-surface.mjs');
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'transfer_orchestrator_semantic_admission_demo',
    benchmarkTier: 'tier1_smoke',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 15,
      productDiffMode: 'semantic_product_architecture',
      requireSemanticProductAdmission: true,
      requireRealProductDiffs: true,
      semanticProductAdmission: { required: true, mode: 'semantic_product_architecture' },
      surfaces: [
        {
          id: 'surface_a',
          label: 'Surface A',
          allowedFiles: ['packages/app/surface-a.mjs', 'packages/app/storage/surface-a-store.mjs'],
          verification: [`node ${semanticVerifier} surface_a --file packages/app/surface-a.mjs --companion packages/app/storage/surface-a-store.mjs`]
        }
      ]
    },
    verifierSet: [
      { kind: 'semantic_architecture_surface', command: `node ${semanticVerifier}` }
    ],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'transfer_orchestrator_semantic_admission_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'completion_summary.json'), 'utf8'));
  const transferEvidence = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'transfer_evidence.json'), 'utf8'));
  const patchQueue = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'patch_queue.json'), 'utf8'));
  assert.equal(completion.mechanicalGreen, true);
  assert.equal(completion.thresholdPass, false);
  assert.equal(completion.transferScore, 1);
  assert.equal(transferEvidence.requiresSemanticProductAdmission, true);
  assert.equal(transferEvidence.productiveSurfaceCount, 1);
  assert.equal(patchQueue.rejected.length, 0);
  assert.equal(patchQueue.merged[0].admissionAudit.semanticProductAdmission.required, true);
  const semanticSource = [
    fs.readFileSync(path.join(repo, 'packages/app/surface-a.mjs'), 'utf8'),
    fs.readFileSync(path.join(repo, 'packages/app/storage/surface-a-store.mjs'), 'utf8')
  ].join('\n');
  assert.match(semanticSource, /semanticProductArchitectureRuntime_surface_a/);
});

test('semantic product architecture preset bootstraps isolated real-product fixture surfaces', () => {
  const stackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-semantic-preset-bootstrap-'));
  const init = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/init-transfer-benchmark.mjs'), 'semantic_product_architecture_smoke', stackRoot], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(init.status, 0, init.stdout || init.stderr);
  const output = JSON.parse(init.stdout);
  const contract = JSON.parse(fs.readFileSync(output.runContractPath, 'utf8'));
  assert.equal(contract.benchmarkId, 'semantic_product_architecture_smoke');
  assert.equal(contract.scope.productDiffMode, 'semantic_product_architecture');
  assert.equal(contract.scope.requireSemanticProductAdmission, true);
  assert.equal(contract.scope.proofCarryingClaims.enabled, true);
  assert.equal(contract.scope.proofCarryingClaims.mode, 'require_adversarial_survival');
  assert.equal(contract.scope.canonicalLandingEvidence.enabled, true);
  assert.equal(contract.scope.canonicalLandingEvidence.minAddedLineCount, 30);
  assert.equal(contract.scope.canonicalLandingEvidence.minUniqueNormalizedAddedLineCount, 25);
  assert.equal(contract.scope.surfaces.length, 100);
  assert.equal(contract.requestedAgentCount, 100);
  assert.ok(fs.existsSync(path.join(contract.repoPath, 'packages/app/audience-lifecycle.mjs')));
  assert.ok(contract.scope.surfaces.every((surface) => surface.allowedFiles.length === 2));
  assert.match(contract.scope.surfaces[0].verification[0], /verify-semantic-architecture-surface\.mjs/);
});

test('semantic continuous planner benchmark replenishes a second wave from blueprint negative space', () => {
  const stackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-semantic-continuous-planner-'));
  const artifactRoot = path.join(stackRoot, 'artifacts', 'benchmarks', 'mailchimp_semantic_continuous_planner_smoke', 'run-001');
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-semantic-continuous-planner-benchmark.mjs'),
    '--stack-root', process.cwd(),
    '--artifact-root', artifactRoot,
    '--agent-count', '2',
    '--waves', '2',
    '--surfaces-per-wave', '2',
    '--wave-duration-ms', '1',
    '--wave-min-cycles', '1',
    '--duration-target-minutes', '30',
    '--integration-proof',
    '--functional-proof-duration-ms', '1',
    '--functional-proof-min-cycles', '1',
    '--realism-proof',
    '--realism-proof-duration-ms', '1',
    '--realism-proof-min-cycles', '1',
    '--adversarial-recovery',
    '--crash-injections-per-wave', '1',
    '--stall-injections-per-wave', '0'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, BENCHMARK_HOST_ROLE: 'execution_plane', HOST_ROLE: 'execution_plane' }
  });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  const replenishment = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'replenishment_events.json'), 'utf8'));
  const waves = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'wave_summaries.json'), 'utf8'));
  assert.equal(completion.mechanicalGreen, true);
  assert.equal(completion.replenishmentGreen, true);
  assert.equal(completion.integrationGreen, true);
  assert.equal(completion.functionalProofGreen, true);
  assert.equal(completion.realismGreen, true);
  assert.equal(completion.adversarialRecoveryGreen, true);
  assert.equal(completion.crashInjectionCount, 2);
  assert.ok(completion.workerExitFailures >= 2);
  assert.equal(completion.claimLedgerGreen, true);
  assert.equal(completion.claimLedgerClaimCount, 4);
  assert.equal(completion.claimLedgerSurvivedCount, 4);
  assert.equal(completion.claimLedgerCounterclaimedCount, 0);
  assert.equal(completion.thresholdPass, false);
  assert.equal(completion.totalSurfaceCount, 4);
  assert.equal(completion.mergedShardCount, 4);
  assert.equal(completion.peakConcurrency, 2);
  assert.equal(completion.transferScore, 1);
  assert.equal(replenishment.events.some((entry) => entry.type === 'ready_queue_replenished' && entry.reason === 'previous_wave_complete_objective_still_red'), true);
  assert.ok(fs.existsSync(path.join(artifactRoot, 'integration_manifest.json')));
  const functionalProof = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'integration_functional_proof.json'), 'utf8'));
  assert.equal(functionalProof.ok, true);
  const realismProof = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'realism_proof.json'), 'utf8'));
  assert.equal(realismProof.ok, true);
  assert.equal(realismProof.parsed.cycles[0].browserApi.ok, true);
  assert.equal(realismProof.parsed.cycles[0].dbMigration.ok, true);
  assert.equal(realismProof.parsed.cycles[0].providerSandbox.ok, true);
  assert.equal(waves.waves.length, 2);
  assert.deepEqual(waves.waves.map((wave) => wave.productiveSurfaceCount), [2, 2]);
  assert.deepEqual(waves.waves.map((wave) => wave.claimLedgerStatus), ['green', 'green']);
  assert.deepEqual(waves.waves.map((wave) => wave.claimLedgerClaimCount), [2, 2]);
  assert.deepEqual(waves.waves.map((wave) => wave.landingMinAddedLineCount), [30, 30]);
  assert.deepEqual(waves.waves.map((wave) => wave.landingMinUniqueNormalizedAddedLineCount), [25, 25]);
  const firstWaveClaimLedger = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'waves', 'wave-001', 'claim_ledger.json'), 'utf8'));
  const firstWaveLandingEvidence = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'waves', 'wave-001', 'landing_evidence.json'), 'utf8'));
  assert.equal(firstWaveClaimLedger.summary.status, 'green');
  assert.equal(firstWaveClaimLedger.summary.claimCount, 2);
  assert.equal(firstWaveClaimLedger.summary.survivedCount, 2);
  assert.equal(firstWaveClaimLedger.summary.counterclaimedCount, 0);
  assert.equal(firstWaveLandingEvidence.policy.minAddedLineCount, 30);
  assert.equal(firstWaveLandingEvidence.policy.minUniqueNormalizedAddedLineCount, 25);
});

test('semantic continuous planner catalog generator sustains tier3 surface counts beyond the base 400-grid', () => {
  const stackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-semantic-continuous-catalog-'));
  const artifactRoot = path.join(stackRoot, 'artifacts', 'benchmarks', 'mailchimp_semantic_continuous_planner_tier3', 'catalog-only');
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-semantic-continuous-planner-benchmark.mjs'),
    '--stack-root', process.cwd(),
    '--artifact-root', artifactRoot,
    '--benchmark-tier', 'tier3_scale',
    '--agent-count', '75',
    '--waves', '8',
    '--surfaces-per-wave', '75',
    '--catalog-only'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const catalog = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'surface_catalog.json'), 'utf8'));
  const audit = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'catalog_audit.json'), 'utf8'));
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(catalog.requestedCount, 600);
  assert.equal(catalog.count, 600);
  assert.equal(audit.generatedCount, 600);
  assert.equal(audit.uniqueIdCount, 600);
  assert.equal(audit.uniquePrimaryFileCount, 600);
  assert.equal(audit.uniqueCompanionFileCount, 600);
  assert.equal(audit.expansionDepthCount, 2);
  assert.equal(audit.ok, true);
  assert.equal(completion.catalogOnly, true);
  assert.equal(completion.catalogAudit.ok, true);
  assert.equal(catalog.surfaces[399].expansionDepth, null);
  assert.equal(catalog.surfaces[400].expansionDepth, 'state_model');
  assert.notEqual(catalog.surfaces[0].id, catalog.surfaces[400].id);
  assert.notEqual(catalog.surfaces[0].primary, catalog.surfaces[400].primary);
});

test('mailchimp real parity preflight expands canonical surfaces into red leaf inventory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-phase9-preflight-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const artifactRoot = path.join(root, 'artifacts', 'phase9');
  write(path.join(mailchimpRoot, 'docs', 'MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json'), JSON.stringify({
    surfaces: [
      {
        id: 'email_builder',
        label: 'Email builder',
        purpose: 'Assemble message content with block editing, previews, and collaboration.',
        status: 'partial_or_shallow',
        confidence: 'medium',
        product_files: ['packages/app/routes/campaigns.mjs'],
        targeted_tests: ['tests/campaign-editor-depth.test.mjs'],
        open_gap_families: ['content_studio_depth'],
        required_work: [
          'Deepen drag/drop block editing and responsive preview parity.',
          'Add collaboration, approvals, reusable assets, and brand-kit inheritance.'
        ]
      }
    ]
  }, null, 2));
  write(path.join(mailchimpRoot, 'strict_1to1_contract.json'), JSON.stringify({ requestedFidelity: 'full_clone' }));
  write(path.join(mailchimpRoot, 'packages/app/routes/campaigns.mjs'), 'export const campaigns = true;');
  write(path.join(mailchimpRoot, 'tests/campaign-editor-depth.test.mjs'), 'import test from "node:test"; test("ok", () => {});');

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-real-parity-preflight.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  const inventory = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'real_parity_inventory.json'), 'utf8'));
  const blocker = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'blocker_report.json'), 'utf8'));
  assert.equal(completion.inventoryReady, true);
  assert.equal(completion.thresholdPass, false);
  assert.equal(completion.parityStatus, 'not_full_clone');
  assert.equal(inventory.canonicalSurfaceCount, 1);
  assert.equal(inventory.leafSurfaceCount, 3);
  assert.equal(inventory.redLeafSurfaceCount, 3);
  assert.equal(inventory.nextWorkQueue.length, 3);
  assert.equal(blocker.blockerKind, 'real_mailchimp_full_clone_matrix_red');
  assert.ok(inventory.leafSurfaces.every((surface) => surface.status === 'red'));
});

test('mailchimp real parity preflight honors executable leaf proof without treating html input hints as placeholder product code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-phase9-proof-preflight-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const artifactRoot = path.join(root, 'artifacts', 'phase9');
  const proofMap = path.join(root, 'proofs', 'lead-capture.json');
  write(path.join(mailchimpRoot, 'docs', 'MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json'), JSON.stringify({
    surfaces: [
      {
        id: 'signup_forms_popups',
        label: 'Signup forms and popup forms',
        purpose: 'Collect new leads through hosted, popup, and embedded capture surfaces with analytics.',
        status: 'partial_or_shallow',
        confidence: 'medium',
        product_files: ['packages/app/domain-leads.mjs', 'packages/app/routes/leads.mjs'],
        targeted_tests: ['tests/forms-landing.test.mjs'],
        open_gap_families: ['omnichannel_depth'],
        required_work: [
          'Deepen embedded, popup, modal, and hosted signup forms with targeting rules, scheduling, analytics, and branding/theming parity.',
          'Add publish lifecycle controls, placement management, consent/compliance states, and audience/journey integration depth.'
        ]
      }
    ]
  }, null, 2));
  write(path.join(mailchimpRoot, 'strict_1to1_contract.json'), JSON.stringify({ requestedFidelity: 'full_clone' }));
  write(path.join(mailchimpRoot, 'packages/app/domain-leads.mjs'), 'export const leadCapture = { channels: ["popup"] };');
  write(path.join(mailchimpRoot, 'packages/app/routes/leads.mjs'), '<input name="name" placeholder="Newsletter signup"><button>Publish</button>');
  write(path.join(mailchimpRoot, 'tests/forms-landing.test.mjs'), 'import test from "node:test"; test("ok", () => {});');
  write(proofMap, JSON.stringify({
    status: 'green',
    leafProofs: [
      {
        leafId: 'signup_forms_popups__req_01',
        status: 'green',
        testStatus: 'pass',
        productFiles: ['packages/app/domain-leads.mjs', 'packages/app/routes/leads.mjs'],
        targetedTests: ['tests/forms-landing.test.mjs'],
        proofKinds: ['analytics_telemetry', 'browser_ui', 'functional', 'product_diff'],
        assertions: ['targeting and analytics verified']
      },
      {
        leafId: 'signup_forms_popups__req_02',
        status: 'green',
        testStatus: 'pass',
        productFiles: ['packages/app/domain-leads.mjs', 'packages/app/routes/leads.mjs'],
        targetedTests: ['tests/forms-landing.test.mjs'],
        proofKinds: ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'provider_integration', 'security_policy'],
        assertions: ['publish lifecycle and handoff verified']
      },
      {
        leafId: 'signup_forms_popups__gap_omnichannel_depth',
        status: 'green',
        testStatus: 'pass',
        productFiles: ['packages/app/domain-leads.mjs', 'packages/app/routes/leads.mjs'],
        targetedTests: ['tests/forms-landing.test.mjs'],
        proofKinds: ['analytics_telemetry', 'browser_ui', 'functional', 'product_diff'],
        assertions: ['sms opt-in channel verified']
      }
    ]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-real-parity-preflight.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--artifact-root', artifactRoot,
    '--proof-map', proofMap
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  const inventory = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'real_parity_inventory.json'), 'utf8'));
  assert.equal(completion.thresholdPass, true);
  assert.equal(completion.parityStatus, 'full');
  assert.equal(inventory.greenLeafSurfaceCount, 3);
  assert.equal(inventory.redLeafSurfaceCount, 0);
  assert.equal(inventory.placeholderProductFiles.length, 0);
  assert.ok(inventory.leafSurfaces.every((surface) => surface.status === 'green'));
});

test('mailchimp autonomous continuation planner selects next strict gap from prior strict blocker artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-continuation-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const phase13ArtifactRoot = path.join(root, 'phase13');
  const artifactRoot = path.join(root, 'autonomous');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(phase13ArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    remainingStrictGaps: [
      'automation/journey parity: no Mailchimp-grade visual/orchestrated runtime parity',
      'audience/CRM parity: limited identity/lifecycle/warehouse realism'
    ]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', phase13ArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'automation_journey_visual_orchestration_layer');
  assert.equal(completion.mechanicalGreen, true);
  assert.equal(completion.thresholdPass, false);
  assert.equal(completion.blocker.blockerKind, 'semantic_product_work_gate_failed');
});

test('mailchimp autonomous continuation planner consumes prior next work queue before fallback strict gaps', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-queue-continuation-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-autonomous');
  const artifactRoot = path.join(root, 'audience-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, nextStrictGap: 'audience/CRM parity: limited identity/lifecycle/warehouse realism' }, null, 2));
  write(path.join(anchorArtifactRoot, 'next_work_queue.json'), JSON.stringify({
    count: 1,
    work: [{ strictGap: 'audience/CRM parity: limited identity/lifecycle/warehouse realism' }]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'audience_identity_lifecycle_warehouse_layer');
  assert.equal(planner.nextStrictGap, 'reporting/analytics parity: telemetry remains local rather than production pipeline parity');
});

test('mailchimp autonomous continuation planner maps phase9 leaf queue entries to global gap surfaces', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-leaf-queue-continuation-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-phase9');
  const artifactRoot = path.join(root, 'audience-leaf-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: false, benchmarkTier: 'phase9_full_clone_preflight', nextWorkQueueCount: 50 }, null, 2));
  write(path.join(anchorArtifactRoot, 'next_work_queue.json'), JSON.stringify({
    count: 1,
    work: [
      {
        id: 'audience_overview__req_01',
        parentSurfaceId: 'audience_overview',
        productGoal: 'Deepen audience summary cards and lifecycle insights.',
        allowedFiles: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
        targetedTests: ['tests/audience-core.test.mjs']
      },
      {
        id: 'audience_overview__req_02',
        parentSurfaceId: 'audience_overview',
        productGoal: 'Deepen audience import/export history.',
        allowedFiles: ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'],
        targetedTests: ['tests/audience-core.test.mjs']
      }
    ]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'mailchimp_global_gap_audience_overview_product_state_reconciliation');
  assert.match(planner.selected.sourceGap, /strict_1to1_gap_inventory id audience_overview/);
  assert.match(planner.nextStrictGap, /strict_1to1_gap_inventory id contacts_table/);
});

test('mailchimp autonomous continuation generates phase9 proof map and preflight credit for queued leaves', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-phase9-proof-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-phase9');
  const artifactRoot = path.join(root, 'audience-proof-continuation');
  const productFiles = ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs', 'packages/app/storage.mjs'];
  const targetedTests = ['tests/audience-core.test.mjs', 'tests/phase9-audience-parity.test.mjs'];
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(mailchimpRoot, 'docs', 'MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json'), JSON.stringify({
    surfaces: [{
      id: 'audience_overview',
      label: 'Audience overview',
      purpose: 'Show audience health metrics, lifecycle insights, imports, exports, and activity analytics.',
      status: 'partial_or_shallow',
      confidence: 'medium',
      product_files: productFiles,
      targeted_tests: targetedTests,
      open_gap_families: [],
      required_work: [
        'Deepen audience summary cards, health metrics, import/export history, suppression status, and lifecycle insights.',
        'Add richer overview drill-downs and action flows tied to segments, campaigns, automations, and commerce events.'
      ]
    }]
  }, null, 2));
  write(path.join(mailchimpRoot, 'strict_1to1_contract.json'), JSON.stringify({ requestedFidelity: 'full_clone' }, null, 2));
  for (const relPath of productFiles) write(path.join(mailchimpRoot, relPath), `export const proof_${path.basename(relPath).replace(/[^a-z0-9]/gi, '_')} = true;\n`);
  for (const relPath of targetedTests) write(path.join(mailchimpRoot, relPath), 'import test from "node:test";\ntest("phase9 audience proof", () => {});\n');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: false, benchmarkTier: 'phase9_full_clone_preflight', nextWorkQueueCount: 2 }, null, 2));
  write(path.join(anchorArtifactRoot, 'next_work_queue.json'), JSON.stringify({
    count: 2,
    work: [
      {
        id: 'audience_overview__req_01',
        parentSurfaceId: 'audience_overview',
        productGoal: 'Deepen audience summary cards, health metrics, import/export history, suppression status, and lifecycle insights.',
        allowedFiles: productFiles,
        targetedTests,
        proofKinds: ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'provider_integration']
      },
      {
        id: 'audience_overview__req_02',
        parentSurfaceId: 'audience_overview',
        productGoal: 'Add richer overview drill-downs and action flows tied to segments, campaigns, automations, and commerce events.',
        allowedFiles: productFiles,
        targetedTests,
        proofKinds: ['analytics_telemetry', 'browser_ui', 'db_persistence', 'functional', 'job_event', 'product_diff', 'provider_integration']
      }
    ]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot,
    '--apply'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  const phase9Proof = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'phase9-proof-map.json'), 'utf8'));
  const phase9Completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'phase9_real_parity', 'completion_summary.json'), 'utf8'));
  const runState = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'run_state_truth.json'), 'utf8'));
  assert.equal(completion.thresholdPass, true);
  assert.equal(completion.phase9Preflight.generatedLeavesGreen, true);
  assert.deepEqual(completion.phase9Preflight.generatedLeafIds, ['audience_overview__req_01', 'audience_overview__req_02']);
  assert.equal(phase9Proof.leafProofs.length, 2);
  assert.equal(phase9Completion.greenLeafSurfaceCount, 2);
  assert.equal(runState.terminalState, 'threshold_pass');
});

test('mailchimp autonomous continuation credits canonical phase9 leaves from test proof when next queue uses synthetic strict-gap id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-synthetic-phase9-proof-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-iteration');
  const artifactRoot = path.join(root, 'contacts-proof-continuation');
  const productFiles = ['packages/app/domain-audience.mjs', 'packages/app/routes/audience.mjs'];
  const selectedProductFiles = [...productFiles, 'packages/app/storage.mjs'];
  const targetedTests = ['tests/audience-core.test.mjs', 'tests/phase9-audience-parity.test.mjs'];
  const contactsStrictGap = 'Mailchimp global gap Contacts table product-state parity: strict_1to1_gap_inventory id contacts_table remains open until real product-surface diff or explicit product-state proof is admitted';
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(mailchimpRoot, 'docs', 'MAILCHIMP_CANONICAL_PARITY_MATRIX_2026-04-11.json'), JSON.stringify({
    surfaces: [{
      id: 'contacts_table',
      label: 'Contacts table',
      purpose: 'Manage contacts table state, saved columns, filters, bulk actions, imports, exports, and merge flows.',
      status: 'partial_or_shallow',
      confidence: 'medium',
      product_files: productFiles,
      targeted_tests: targetedTests,
      open_gap_families: [],
      required_work: [
        'Match full contacts-table parity: bulk actions, saved columns, sorting, filters, pagination, imports, exports, and merge/dedup flows.',
        'Deepen profile row actions, consent/suppression states, tags/groups/interests visibility, and contact timeline integration.'
      ]
    }]
  }, null, 2));
  write(path.join(mailchimpRoot, 'strict_1to1_contract.json'), JSON.stringify({ requestedFidelity: 'full_clone' }, null, 2));
  for (const relPath of selectedProductFiles) write(path.join(mailchimpRoot, relPath), `export const proof_${path.basename(relPath).replace(/[^a-z0-9]/gi, '_')} = true;\n`);
  write(path.join(mailchimpRoot, 'tests/audience-core.test.mjs'), 'import test from "node:test";\ntest("audience core proof", () => {});\n');
  write(path.join(mailchimpRoot, 'tests/phase9-audience-parity.test.mjs'), `
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
test('phase9 contacts proof writes executable leaf proof map', () => {
  const proofPath = process.env.MAILCLONE_PHASE9_PROOF_PATH;
  if (!proofPath) return;
  fs.mkdirSync(path.dirname(proofPath), { recursive: true });
  fs.writeFileSync(proofPath, JSON.stringify({
    schemaVersion: 'clawd.mailchimp.phase9.real_product_proof.v1',
    status: 'green',
    productSlices: ['contacts_table'],
    leafProofs: [
      {
        leafId: 'contacts_table__req_01',
        status: 'green',
        productFiles: ${JSON.stringify(productFiles)},
        targetedTests: ${JSON.stringify(targetedTests)},
        proofKinds: ['browser_ui', 'db_persistence', 'functional', 'product_diff'],
        testStatus: 'pass',
        testCommandExitCode: 0,
        assertions: ['saved column preferences persist', 'bulk actions and export table flows are executable']
      },
      {
        leafId: 'contacts_table__req_02',
        status: 'green',
        productFiles: ${JSON.stringify(productFiles)},
        targetedTests: ${JSON.stringify(targetedTests)},
        proofKinds: ['browser_ui', 'db_persistence', 'functional', 'product_diff', 'provider_integration'],
        testStatus: 'pass',
        testCommandExitCode: 0,
        assertions: ['profile row actions expose consent states', 'tags groups interests and provider fields are visible']
      }
    ]
  }, null, 2));
});
`);
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, selectedGlobalGapId: 'audience_overview', nextStrictGap: contactsStrictGap }, null, 2));
  write(path.join(anchorArtifactRoot, 'next_work_queue.json'), JSON.stringify({
    count: 1,
    work: [{ id: 'next_strict_gap_after_autonomous_slice', strictGap: contactsStrictGap, stopCondition: 'planner_selects_next_strict_gap_or_blocker_report' }]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot,
    '--apply'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  const testProof = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'test-phase9-proof-map.json'), 'utf8'));
  assert.equal(completion.thresholdPass, true);
  assert.deepEqual(completion.phase9Preflight.generatedLeafIds, ['contacts_table__req_01', 'contacts_table__req_02']);
  assert.equal(completion.phase9Preflight.generatedLeavesGreen, true);
  assert.deepEqual(testProof.leafProofs.map((entry) => entry.leafId), ['contacts_table__req_01', 'contacts_table__req_02']);
});

test('mailchimp autonomous continuation planner advances from reporting queue to AI gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-reporting-continuation-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-audience');
  const artifactRoot = path.join(root, 'reporting-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, nextStrictGap: 'reporting/analytics parity: telemetry remains local rather than production pipeline parity' }, null, 2));
  write(path.join(anchorArtifactRoot, 'next_work_queue.json'), JSON.stringify({
    count: 1,
    work: [{ strictGap: 'reporting/analytics parity: telemetry remains local rather than production pipeline parity' }]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'reporting_telemetry_pipeline_layer');
  assert.equal(planner.nextStrictGap, 'AI/predictive parity: recommendations still come from local Mailclone provider seams');
});

test('mailchimp autonomous continuation planner advances from AI predictive queue to integration gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-ai-continuation-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-reporting');
  const artifactRoot = path.join(root, 'ai-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, nextStrictGap: 'AI/predictive parity: recommendations still come from local Mailclone provider seams' }, null, 2));
  write(path.join(anchorArtifactRoot, 'next_work_queue.json'), JSON.stringify({
    count: 1,
    work: [{ strictGap: 'AI/predictive parity: recommendations still come from local Mailclone provider seams' }]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'ai_predictive_recommendation_runtime_layer');
  assert.equal(planner.nextStrictGap, 'integration/provider parity: connector auth/sync remains verified through local connector seams rather than real provider accounts');
});

test('mailchimp autonomous continuation planner advances from integration provider queue to security gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-integration-continuation-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-ai');
  const artifactRoot = path.join(root, 'integration-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, nextStrictGap: 'integration/provider parity: connector auth/sync remains verified through local connector seams rather than real provider accounts' }, null, 2));
  write(path.join(anchorArtifactRoot, 'next_work_queue.json'), JSON.stringify({
    count: 1,
    work: [{ strictGap: 'integration/provider parity: connector auth/sync remains verified through local connector seams rather than real provider accounts' }]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'integration_provider_account_sync_runtime_layer');
  assert.equal(planner.nextStrictGap, 'auth/session/security parity: improved, but full production security program remains unproven');
});

test('mailchimp autonomous continuation planner advances from security queue to persistence gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-security-continuation-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-integration');
  const artifactRoot = path.join(root, 'security-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, nextStrictGap: 'auth/session/security parity: improved, but full production security program remains unproven' }, null, 2));
  write(path.join(anchorArtifactRoot, 'next_work_queue.json'), JSON.stringify({
    count: 1,
    work: [{ strictGap: 'auth/session/security parity: improved, but full production security program remains unproven' }]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'auth_session_security_runtime_layer');
  assert.equal(planner.nextStrictGap, 'persistence/jobs/operational parity: SQLite wave is product-backed, but broader job-service replacement remains open');
});

test('mailchimp autonomous continuation planner selects persistence/jobs operational gap as a supported surface', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-persistence-continuation-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-security');
  const artifactRoot = path.join(root, 'persistence-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, nextStrictGap: 'persistence/jobs/operational parity: SQLite wave is product-backed, but broader job-service replacement remains open' }, null, 2));
  write(path.join(anchorArtifactRoot, 'next_work_queue.json'), JSON.stringify({
    count: 1,
    work: [{ strictGap: 'persistence/jobs/operational parity: SQLite wave is product-backed, but broader job-service replacement remains open' }]
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'persistence_jobs_operational_runtime_layer');
  assert.equal(planner.nextStrictGap, 'frontend interaction parity: client modules now exist for key builders, but the whole app is not yet a Mailchimp-grade full client application');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'persistence_jobs_operational_runtime_layer'));
});

test('mailchimp autonomous continuation expands from frontend shell into campaign editor visual builder gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-campaign-editor-visual-builder-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-frontend-shell');
  const artifactRoot = path.join(root, 'campaign-editor-visual-builder-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedStrictGap: 'frontend interaction parity: client modules now exist for key builders, but the whole app is not yet a Mailchimp-grade full client application',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'campaign_editor_visual_builder_runtime_layer');
  assert.equal(planner.selected.sourceGap, 'campaign editor parity: deeper visual builder runtime still lacks Mailchimp-grade block inspectors, asset transforms, style controls, and browser-backed interaction proof');
  assert.equal(planner.nextStrictGap, 'website builder parity: visual site designer exists, but Mailchimp-grade publish readiness, SEO audits, domain checks, experiments, analytics goals, and runtime API evidence remain open');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'campaign_editor_visual_builder_runtime_layer'));
  assert.ok(supported.fallbackRemainingStrictGaps.includes('campaign editor parity: deeper visual builder runtime still lacks Mailchimp-grade block inspectors, asset transforms, style controls, and browser-backed interaction proof'));
});

test('mailchimp autonomous continuation expands from campaign editor into website builder publish runtime gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-website-builder-publish-runtime-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-campaign-editor-visual-builder');
  const artifactRoot = path.join(root, 'website-builder-publish-runtime-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedStrictGap: 'campaign editor parity: deeper visual builder runtime still lacks Mailchimp-grade block inspectors, asset transforms, style controls, and browser-backed interaction proof',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'website_builder_publish_runtime_layer');
  assert.equal(planner.selected.sourceGap, 'website builder parity: visual site designer exists, but Mailchimp-grade publish readiness, SEO audits, domain checks, experiments, analytics goals, and runtime API evidence remain open');
  assert.equal(planner.nextStrictGap, 'landing pages and signup forms parity: builders exist, but Mailchimp-grade conversion runtime, attribution, consent receipts, landing-page experiments, and funnel API evidence remain open');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'website_builder_publish_runtime_layer'));
  assert.ok(supported.fallbackRemainingStrictGaps.includes('website builder parity: visual site designer exists, but Mailchimp-grade publish readiness, SEO audits, domain checks, experiments, analytics goals, and runtime API evidence remain open'));
});

test('mailchimp autonomous continuation expands from website builder into lead capture conversion runtime gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-lead-capture-conversion-runtime-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-website-builder-publish-runtime');
  const artifactRoot = path.join(root, 'lead-capture-conversion-runtime-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedStrictGap: 'website builder parity: visual site designer exists, but Mailchimp-grade publish readiness, SEO audits, domain checks, experiments, analytics goals, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'lead_capture_landing_page_conversion_runtime_layer');
  assert.equal(planner.selected.sourceGap, 'landing pages and signup forms parity: builders exist, but Mailchimp-grade conversion runtime, attribution, consent receipts, landing-page experiments, and funnel API evidence remain open');
  assert.equal(planner.nextStrictGap, 'commerce/revenue parity: commerce sync exists, but Mailchimp-grade order lifecycle, customer value profiles, abandoned-cart recovery, product recommendations, and runtime API evidence remain open');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'lead_capture_landing_page_conversion_runtime_layer'));
  assert.ok(supported.fallbackRemainingStrictGaps.includes('landing pages and signup forms parity: builders exist, but Mailchimp-grade conversion runtime, attribution, consent receipts, landing-page experiments, and funnel API evidence remain open'));
});

test('mailchimp autonomous continuation expands from lead capture into commerce revenue runtime gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-commerce-revenue-runtime-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-lead-capture-conversion-runtime');
  const artifactRoot = path.join(root, 'commerce-revenue-runtime-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedStrictGap: 'landing pages and signup forms parity: builders exist, but Mailchimp-grade conversion runtime, attribution, consent receipts, landing-page experiments, and funnel API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'commerce_revenue_attribution_runtime_layer');
  assert.equal(planner.selected.sourceGap, 'commerce/revenue parity: commerce sync exists, but Mailchimp-grade order lifecycle, customer value profiles, abandoned-cart recovery, product recommendations, and runtime API evidence remain open');
  assert.equal(planner.nextStrictGap, 'conversation inbox parity: basic threads exist, but Mailchimp-grade SLA policy, assignment history, reply macros, automation handoff, sentiment, and runtime API evidence remain open');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'commerce_revenue_attribution_runtime_layer'));
  assert.ok(supported.fallbackRemainingStrictGaps.includes('commerce/revenue parity: commerce sync exists, but Mailchimp-grade order lifecycle, customer value profiles, abandoned-cart recovery, product recommendations, and runtime API evidence remain open'));
});

test('mailchimp autonomous continuation expands from commerce into conversation inbox runtime gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-conversation-inbox-runtime-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-commerce-revenue-runtime');
  const artifactRoot = path.join(root, 'conversation-inbox-runtime-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedStrictGap: 'commerce/revenue parity: commerce sync exists, but Mailchimp-grade order lifecycle, customer value profiles, abandoned-cart recovery, product recommendations, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'conversation_inbox_sla_assignment_runtime_layer');
  assert.equal(planner.selected.sourceGap, 'conversation inbox parity: basic threads exist, but Mailchimp-grade SLA policy, assignment history, reply macros, automation handoff, sentiment, and runtime API evidence remain open');
  assert.equal(planner.nextStrictGap, 'surveys/feedback parity: basic score capture exists, but Mailchimp-grade sentiment analysis, feedback segmentation, delivery events, automation handoff, and runtime API evidence remain open');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'conversation_inbox_sla_assignment_runtime_layer'));
  assert.ok(supported.fallbackRemainingStrictGaps.includes('conversation inbox parity: basic threads exist, but Mailchimp-grade SLA policy, assignment history, reply macros, automation handoff, sentiment, and runtime API evidence remain open'));
});

test('mailchimp autonomous continuation expands from conversation inbox into survey feedback runtime gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-survey-feedback-runtime-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-conversation-inbox-runtime');
  const artifactRoot = path.join(root, 'survey-feedback-runtime-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedStrictGap: 'conversation inbox parity: basic threads exist, but Mailchimp-grade SLA policy, assignment history, reply macros, automation handoff, sentiment, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'survey_feedback_insights_runtime_layer');
  assert.equal(planner.selected.sourceGap, 'surveys/feedback parity: basic score capture exists, but Mailchimp-grade sentiment analysis, feedback segmentation, delivery events, automation handoff, and runtime API evidence remain open');
  assert.equal(planner.nextStrictGap, 'preferences center parity: hosted updates exist, but Mailchimp-grade consent ledger, double opt-in verification, suppression reconciliation, export runs, and runtime API evidence remain open');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'survey_feedback_insights_runtime_layer'));
  assert.ok(supported.fallbackRemainingStrictGaps.includes('surveys/feedback parity: basic score capture exists, but Mailchimp-grade sentiment analysis, feedback segmentation, delivery events, automation handoff, and runtime API evidence remain open'));
});

test('mailchimp autonomous continuation expands from survey feedback into preference center runtime gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-preference-center-runtime-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-survey-feedback-runtime');
  const artifactRoot = path.join(root, 'preference-center-runtime-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedStrictGap: 'surveys/feedback parity: basic score capture exists, but Mailchimp-grade sentiment analysis, feedback segmentation, delivery events, automation handoff, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'preference_center_consent_suppression_runtime_layer');
  assert.equal(planner.selected.sourceGap, 'preferences center parity: hosted updates exist, but Mailchimp-grade consent ledger, double opt-in verification, suppression reconciliation, export runs, and runtime API evidence remain open');
  assert.equal(planner.nextStrictGap, 'transactional messaging parity: basic journey dispatch exists, but Mailchimp-grade trigger event ledger, template render evidence, delivery attempts/retries, suppression handling, webhooks, and runtime API evidence remain open');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'preference_center_consent_suppression_runtime_layer'));
  assert.ok(supported.fallbackRemainingStrictGaps.includes('preferences center parity: hosted updates exist, but Mailchimp-grade consent ledger, double opt-in verification, suppression reconciliation, export runs, and runtime API evidence remain open'));
});

test('mailchimp autonomous continuation expands from preference center into transactional messaging runtime gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-transactional-messaging-runtime-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-preference-center-runtime');
  const artifactRoot = path.join(root, 'transactional-messaging-runtime-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedStrictGap: 'preferences center parity: hosted updates exist, but Mailchimp-grade consent ledger, double opt-in verification, suppression reconciliation, export runs, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'transactional_messaging_delivery_runtime_layer');
  assert.equal(planner.selected.sourceGap, 'transactional messaging parity: basic journey dispatch exists, but Mailchimp-grade trigger event ledger, template render evidence, delivery attempts/retries, suppression handling, webhooks, and runtime API evidence remain open');
  assert.equal(planner.nextStrictGap, 'mobile app parity: companion workflow exists, but Mailchimp-grade push registration, device trust/risk, offline sync batches, conflict resolution, notification ledger, and runtime API evidence remain open');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'transactional_messaging_delivery_runtime_layer'));
  assert.ok(supported.fallbackRemainingStrictGaps.includes('transactional messaging parity: basic journey dispatch exists, but Mailchimp-grade trigger event ledger, template render evidence, delivery attempts/retries, suppression handling, webhooks, and runtime API evidence remain open'));
});

test('mailchimp autonomous continuation expands from transactional messaging into mobile app runtime gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-mobile-app-runtime-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-transactional-messaging-runtime');
  const artifactRoot = path.join(root, 'mobile-app-runtime-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedStrictGap: 'transactional messaging parity: basic journey dispatch exists, but Mailchimp-grade trigger event ledger, template render evidence, delivery attempts/retries, suppression handling, webhooks, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'mobile_app_push_offline_runtime_layer');
  assert.equal(planner.selected.sourceGap, 'mobile app parity: companion workflow exists, but Mailchimp-grade push registration, device trust/risk, offline sync batches, conflict resolution, notification ledger, and runtime API evidence remain open');
  assert.equal(planner.nextStrictGap, 'content studio/template library parity: assets and templates exist, but Mailchimp-grade asset lifecycle approvals, brand governance, review lineage, usage telemetry, and runtime API evidence remain open');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'mobile_app_push_offline_runtime_layer'));
  assert.ok(supported.fallbackRemainingStrictGaps.includes('mobile app parity: companion workflow exists, but Mailchimp-grade push registration, device trust/risk, offline sync batches, conflict resolution, notification ledger, and runtime API evidence remain open'));
});

test('mailchimp autonomous continuation expands from mobile app into content studio runtime gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-content-studio-runtime-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-mobile-app-runtime');
  const artifactRoot = path.join(root, 'content-studio-runtime-continuation');
  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedStrictGap: 'mobile app parity: companion workflow exists, but Mailchimp-grade push registration, device trust/risk, offline sync batches, conflict resolution, notification ledger, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const planner = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'planner_decision.json'), 'utf8'));
  assert.equal(planner.selected.surface.id, 'content_studio_template_asset_runtime_layer');
  assert.equal(planner.selected.sourceGap, 'content studio/template library parity: assets and templates exist, but Mailchimp-grade asset lifecycle approvals, brand governance, review lineage, usage telemetry, and runtime API evidence remain open');
  assert.equal(planner.nextStrictGap, 'social calendar coordination parity: social publishing exists, but Mailchimp-grade campaign-linked social calendar placements, cross-channel timeline events, coordination ledgers, runtime snapshots, and API evidence remain open');

  const list = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--list-supported-gaps-json'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr || list.stdout);
  const supported = JSON.parse(list.stdout);
  assert.ok(supported.supportedSurfaces.some((surface) => surface.id === 'content_studio_template_asset_runtime_layer'));
  assert.ok(supported.supportedSurfaces.length >= 350);
  assert.match(supported.fallbackRemainingStrictGaps.at(-1), /Admin audit and operability governance and controls depth parity/);
});

test('mailchimp autonomous continuation blocks generic frontier catalog churn without semantic product work', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autonomous-frontier-semantic-gate-'));
  const mailchimpRoot = path.join(root, 'mailchimp-clone');
  const anchorArtifactRoot = path.join(root, 'prior-omnichannel-runtime');
  const artifactRoot = path.join(root, 'frontier-runtime-continuation');
  const firstFrontierGap = 'Email marketing campaigns primary runtime depth parity: Email marketing campaigns exists partially, but Mailchimp-grade primary runtime depth, normal workflow adoption, durable evidence, API/runtime proof, and full-clone parity evidence remain open';

  write(path.join(mailchimpRoot, 'surface-honesty.json'), JSON.stringify({ version: 1, policy: {}, surfaces: {} }, null, 2));
  write(path.join(mailchimpRoot, 'packages/app/domain-mailchimp-continuous-frontier.mjs'), `
export const MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_CONTRACT = {};
export function recordMailchimpFrontierRuntimeSlice() {}
export function recordMailchimpFrontierEvidenceEvent() {}
export function buildMailchimpContinuousFrontierRuntimeSnapshot() {}
export function persistMailchimpContinuousFrontierRuntimeSnapshot() {}
`);
  write(path.join(mailchimpRoot, 'packages/app/domain-current-product.mjs'), `export { MAILCHIMP_CONTINUOUS_FRONTIER_RUNTIME_CONTRACT } from './domain-mailchimp-continuous-frontier.mjs'; // domain-mailchimp-continuous-frontier
`);
  write(path.join(mailchimpRoot, 'packages/app/routes/current-product-ops.mjs'), `// /ops/mailchimp-frontier /api/ops/mailchimp-frontier/runtime
`);
  write(path.join(mailchimpRoot, 'packages/app/storage.mjs'), `// mailchimpFrontierSurfaceRuns mailchimpFrontierEvidenceEvents mailchimpFrontierRuntimeSnapshots
`);
  write(path.join(mailchimpRoot, 'tests/mailchimp-continuous-frontier-runtime.test.mjs'), `// mailchimp continuous frontier runtime records official-surface runs
`);
  write(path.join(mailchimpRoot, 'tests/current-product-parity.test.mjs'), `// current product parity fixture
`);
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    nextStrictGap: firstFrontierGap,
    configuredStrictQueueExhausted: false,
    globalFullClonePass: false
  }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-continuation.mjs'),
    '--mailchimp-root', mailchimpRoot,
    '--phase13-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot,
    '--apply',
    '--skip-tests'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  const threshold = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'threshold_evaluation.json'), 'utf8'));
  const implementation = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'implementation_manifest.json'), 'utf8'));
  assert.equal(completion.thresholdPass, false);
  assert.equal(completion.selectedSurfaceId, 'mailchimp_frontier_001_email_marketing_campaigns_primary_runtime_depth_runtime_layer');
  assert.equal(completion.blocker.blockerKind, 'semantic_product_work_gate_failed');
  assert.equal(completion.semanticWorkGate.ok, false);
  assert.equal(completion.semanticWorkGate.reason, 'no_product_diff_or_explicit_product_state_proof');
  assert.deepEqual(completion.semanticWorkGate.productChangedFiles, []);
  assert.ok(implementation.implementation.changedFiles.every((file) => file.startsWith('tests/')));
  assert.equal(threshold.metrics.semanticProductWorkAccepted, false);
  assert.equal(threshold.failures[0].reason, 'semantic_product_work_gate_failed');
});

test('mailchimp autonomous autopilot stops before unsupported queued strict gap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autopilot-unsupported-'));
  const runnerScript = path.join(root, 'fake-continuation-runner.mjs');
  const seedArtifactRoot = path.join(root, 'seed');
  const artifactRoot = path.join(root, 'autopilot');
  write(runnerScript, `#!/usr/bin/env node
if (process.argv.includes('--list-supported-gaps-json')) {
  console.log(JSON.stringify({ supportedSurfaces: [{ id: 'surface_a', strictGap: 'supported gap A' }] }));
  process.exit(0);
}
throw new Error('runner should not be invoked for unsupported gaps');
`);
  write(path.join(seedArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, nextStrictGap: 'unsupported security gap' }, null, 2));
  write(path.join(seedArtifactRoot, 'next_work_queue.json'), JSON.stringify({ count: 1, work: [{ strictGap: 'unsupported security gap' }] }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-autopilot.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--runner-script', runnerScript,
    '--seed-artifact-root', seedArtifactRoot,
    '--artifact-root', artifactRoot,
    '--max-iterations', '3'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 1, run.stdout || run.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(completion.iterationCount, 0);
  assert.equal(completion.blocker.blockerKind, 'unsupported_strict_gap_surface');
  assert.equal(completion.thresholdPass, false);
});

test('mailchimp autonomous autopilot chains green continuation iterations without a manual trigger', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autopilot-chain-'));
  const runnerScript = path.join(root, 'fake-continuation-runner.mjs');
  const seedArtifactRoot = path.join(root, 'seed');
  const artifactRoot = path.join(root, 'autopilot');
  write(runnerScript, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n'); }
if (process.argv.includes('--list-supported-gaps-json')) {
  console.log(JSON.stringify({ supportedSurfaces: [{ id: 'surface_a', strictGap: 'gap A' }, { id: 'surface_b', strictGap: 'gap B' }] }));
  process.exit(0);
}
const anchor = arg('--phase13-artifact-root');
const artifactRoot = arg('--artifact-root');
const queue = readJson(path.join(anchor, 'next_work_queue.json'), { work: [] });
const strictGap = queue.work[0].strictGap;
const nextStrictGap = strictGap === 'gap A' ? 'gap B' : 'gap C';
writeJson(path.join(artifactRoot, 'completion_summary.json'), {
  thresholdPass: true,
  supervisorStatus: 'green',
  selectedStrictGap: strictGap,
  selectedSurfaceId: strictGap === 'gap A' ? 'surface_a' : 'surface_b',
  testsPassed: true,
  honestyGate: { ok: true, violationCount: 0 },
  nextStrictGap,
  blocker: null
});
writeJson(path.join(artifactRoot, 'next_work_queue.json'), { count: 1, work: [{ strictGap: nextStrictGap }] });
process.exit(0);
`);
  write(path.join(seedArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, nextStrictGap: 'gap A' }, null, 2));
  write(path.join(seedArtifactRoot, 'next_work_queue.json'), JSON.stringify({ count: 1, work: [{ strictGap: 'gap A' }] }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-autopilot.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--runner-script', runnerScript,
    '--seed-artifact-root', seedArtifactRoot,
    '--artifact-root', artifactRoot,
    '--max-iterations', '2'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(completion.thresholdPass, true);
  assert.equal(completion.iterationCount, 2);
  assert.equal(completion.stopReason, 'max_iterations_reached');
  assert.deepEqual(completion.iterations.map((entry) => entry.selectedStrictGap), ['gap A', 'gap B']);
});

test('mailchimp autonomous autopilot expands supported fallback gap after configured queue exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autopilot-fallback-expansion-'));
  const runnerScript = path.join(root, 'fake-continuation-runner.mjs');
  const seedArtifactRoot = path.join(root, 'seed');
  const artifactRoot = path.join(root, 'autopilot');
  write(runnerScript, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n'); }
if (process.argv.includes('--list-supported-gaps-json')) {
  console.log(JSON.stringify({ supportedSurfaces: [{ id: 'surface_a', strictGap: 'gap A' }, { id: 'surface_b', strictGap: 'gap B' }], fallbackRemainingStrictGaps: ['gap A', 'gap B'] }));
  process.exit(0);
}
const artifactRoot = arg('--artifact-root');
writeJson(path.join(artifactRoot, 'completion_summary.json'), {
  thresholdPass: true,
  supervisorStatus: 'green',
  selectedStrictGap: 'gap B',
  selectedSurfaceId: 'surface_b',
  testsPassed: true,
  honestyGate: { ok: true, violationCount: 0 },
  nextStrictGap: null,
  globalFullClonePass: true,
  blocker: null
});
writeJson(path.join(artifactRoot, 'next_work_queue.json'), { count: 0, work: [] });
process.exit(0);
`);
  write(path.join(seedArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, selectedStrictGap: 'gap A', configuredStrictQueueExhausted: true, globalFullClonePass: false }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-autopilot.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--runner-script', runnerScript,
    '--seed-artifact-root', seedArtifactRoot,
    '--artifact-root', artifactRoot,
    '--max-iterations', '1'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  const events = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'loop_events.json'), 'utf8'));
  assert.equal(completion.thresholdPass, true);
  assert.equal(completion.iterations[0].selectedStrictGap, 'gap B');
  assert.ok(events.events.some((entry) => entry.type === 'fallback_strict_gap_expanded_after_queue_exhaustion'));
});

test('mailchimp continuous queue expander selects SMS runtime after content studio exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-sms-'));
  const runnerScript = path.join(root, 'fake-continuation-runner.mjs');
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(runnerScript, `#!/usr/bin/env node
if (process.argv.includes('--list-supported-gaps-json')) {
  console.log(JSON.stringify({ supportedSurfaces: [{ id: 'sms_marketing_native_runtime_layer', strictGap: 'sms marketing parity: omnichannel programs exist, but Mailchimp-grade SMS consent receipts, quiet-hour compliance, carrier delivery attempts, link tracking, and runtime API evidence remain open' }] }));
  process.exit(0);
}
throw new Error('queue expander should only inspect supported gaps');
`);
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'content_studio_template_asset_runtime_layer',
    selectedStrictGap: 'content studio/template library parity: assets and templates exist, but Mailchimp-grade asset lifecycle approvals, brand governance, review lineage, usage telemetry, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--runner-script', runnerScript,
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'sms_marketing_native_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});

test('mailchimp continuous queue expander selects supported developer API/webhook runtime after ads exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-developer-'));
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'ads_retargeting_runtime_layer',
    selectedStrictGap: 'digital ads parity: ad channel programs exist, but Mailchimp-grade retargeting audiences, budget pacing, provider sync, conversion attribution, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'developer_webhooks_api_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});

test('mailchimp continuous queue expander selects supported billing entitlement runtime after developer exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-billing-'));
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'developer_webhooks_api_runtime_layer',
    selectedStrictGap: 'developer webhooks/API parity: API keys and webhooks exist, but Mailchimp-grade scoped keys, subscription lifecycle, signed delivery replay, request audit, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'billing_entitlements_usage_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});

test('mailchimp continuous queue expander selects supported team governance runtime after billing exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-team-'));
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'billing_entitlements_usage_runtime_layer',
    selectedStrictGap: 'billing/entitlements parity: plan pages exist, but Mailchimp-grade entitlement reconciliation, usage meters, trials, invoice/tax collection runs, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'team_governance_permissions_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});

test('mailchimp continuous queue expander selects supported settings domains deliverability runtime after team exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-deliverability-'));
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'team_governance_permissions_runtime_layer',
    selectedStrictGap: 'team roles/permissions parity: invitations and role updates exist, but Mailchimp-grade permission policy, delegated administration, SCIM provisioning, access review, region governance, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'settings_domains_deliverability_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});

test('mailchimp continuous queue expander selects supported dashboard home runtime after settings domains exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-dashboard-'));
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'settings_domains_deliverability_runtime_layer',
    selectedStrictGap: 'settings/domains parity: domain verification exists, but Mailchimp-grade DNS checks, DMARC alignment, sender reputation warmup, dedicated IP readiness, compliance review, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'dashboard_home_insights_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});

test('mailchimp continuous queue expander selects supported campaign experiment runtime after dashboard exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-experiment-'));
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'dashboard_home_insights_runtime_layer',
    selectedStrictGap: 'dashboard/home parity: summary cards exist, but Mailchimp-grade role-aware widgets, saved views, insight task queues, data freshness drilldowns, drillthrough telemetry, and runtime API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'campaign_experimentation_decision_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});

test('mailchimp continuous queue expander selects supported postcard direct-mail runtime after campaign experiment exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-postcard-'));
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'campaign_experimentation_decision_runtime_layer',
    selectedStrictGap: 'campaign experimentation parity: basic A/B campaign flows exist, but Mailchimp-grade variant allocation, dynamic content resolution, holdout compliance, winner decision audit, runtime snapshots, and API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'postcard_direct_mail_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});

test('mailchimp continuous queue expander selects supported cross-channel journey runtime after postcard exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-cross-channel-'));
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'postcard_direct_mail_runtime_layer',
    selectedStrictGap: 'postcard/direct-mail parity: omnichannel programs mention postcards, but Mailchimp-grade postal audience eligibility, creative proof approval, print vendor handoff, delivery tracking, runtime snapshots, and API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'cross_channel_journey_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});


test('mailchimp continuous queue expander selects supported social calendar runtime after cross-channel exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-social-calendar-'));
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'cross_channel_journey_runtime_layer',
    selectedStrictGap: 'cross-channel journey parity: automation nodes exist, but Mailchimp-grade email/SMS/ad/inbox/survey/postcard journey nodes, channel handoffs, decision audit, performance rollups, runtime snapshots, and API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'social_calendar_coordination_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});

test('mailchimp continuous queue expander selects supported omnichannel reporting runtime after social calendar exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-continuous-expander-omnichannel-reporting-'));
  const anchorArtifactRoot = path.join(root, 'anchor');
  const artifactRoot = path.join(root, 'expander');
  write(path.join(anchorArtifactRoot, 'completion_summary.json'), JSON.stringify({
    thresholdPass: true,
    selectedSurfaceId: 'social_calendar_coordination_runtime_layer',
    selectedStrictGap: 'social calendar coordination parity: social publishing exists, but Mailchimp-grade campaign-linked social calendar placements, cross-channel timeline events, coordination ledgers, runtime snapshots, and API evidence remain open',
    configuredStrictQueueExhausted: true,
    globalFullClonePass: false
  }, null, 2));
  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-continuous-queue-expander.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--anchor-artifact-root', anchorArtifactRoot,
    '--artifact-root', artifactRoot
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const queue = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'next_work_queue.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  assert.equal(queue.count, 1);
  assert.equal(queue.work[0].parentSurfaceId, 'omnichannel_reporting_attribution_runtime_layer');
  assert.equal(queue.work[0].supportedByContinuationRunner, true);
  assert.equal(summary.selectedSupportedByContinuationRunner, true);
});

test('mailchimp autonomous autopilot consumes queue expander output after finite queue exhaustion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailchimp-autopilot-queue-expander-'));
  const runnerScript = path.join(root, 'fake-continuation-runner.mjs');
  const queueExpanderScript = path.join(root, 'fake-queue-expander.mjs');
  const seedArtifactRoot = path.join(root, 'seed');
  const artifactRoot = path.join(root, 'autopilot');
  write(runnerScript, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n'); }
if (process.argv.includes('--list-supported-gaps-json')) {
  console.log(JSON.stringify({ supportedSurfaces: [{ id: 'expanded_surface', strictGap: 'expanded gap' }], fallbackRemainingStrictGaps: [] }));
  process.exit(0);
}
const artifactRoot = arg('--artifact-root');
writeJson(path.join(artifactRoot, 'completion_summary.json'), { thresholdPass: true, supervisorStatus: 'green', selectedStrictGap: 'expanded gap', selectedSurfaceId: 'expanded_surface', testsPassed: true, honestyGate: { ok: true }, nextStrictGap: null, globalFullClonePass: true, blocker: null });
writeJson(path.join(artifactRoot, 'next_work_queue.json'), { count: 0, work: [] });
process.exit(0);
`);
  write(queueExpanderScript, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\\n'); }
const artifactRoot = arg('--artifact-root');
writeJson(path.join(artifactRoot, 'completion_summary.json'), { thresholdPass: true, selectedStrictGap: 'expanded gap', selectedSurfaceId: 'expanded_surface', selectedSupportedByContinuationRunner: true });
writeJson(path.join(artifactRoot, 'next_work_queue.json'), { count: 1, work: [{ strictGap: 'expanded gap', parentSurfaceId: 'expanded_surface', supportedByContinuationRunner: true }] });
process.exit(0);
`);
  write(path.join(seedArtifactRoot, 'completion_summary.json'), JSON.stringify({ thresholdPass: true, selectedStrictGap: 'last finite gap', configuredStrictQueueExhausted: true, globalFullClonePass: false }, null, 2));

  const run = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/run-mailchimp-autonomous-autopilot.mjs'),
    '--mailchimp-root', path.join(root, 'mailchimp-clone'),
    '--runner-script', runnerScript,
    '--queue-expander-script', queueExpanderScript,
    '--seed-artifact-root', seedArtifactRoot,
    '--artifact-root', artifactRoot,
    '--max-iterations', '1'
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout || run.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'completion_summary.json'), 'utf8'));
  const events = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'loop_events.json'), 'utf8'));
  assert.equal(completion.thresholdPass, true);
  assert.equal(completion.iterations[0].selectedStrictGap, 'expanded gap');
  assert.equal(completion.queueExpansions[0].strictGap, 'expanded gap');
  assert.ok(events.events.some((entry) => entry.type === 'queue_expander_generated_next_work'));
});

test('semantic product admission rejects marker-only and source-syntax-only product claims', async () => {
  const baseContract = {
    artifactKind: 'product_diff',
    targetFiles: ['src/product.mjs'],
    targetModules: ['src/product.mjs'],
    verifierRequirements: ['tests'],
    successPredicate: ['Semantic architecture evidence required: real product behavior is wired through the source-of-truth runtime.']
  };
  const verifyFns = { tests: async () => ({ ok: true, verifier: 'tests', stdout: '{"ok":true}' }) };

  const markerQueue = enqueuePatch(createPatchQueue(), createPatchArtifact({
    shardId: 'semantic_marker_surface',
    filePaths: ['src/product.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: baseContract,
      contextPack: { inputs: { productDiffMode: 'semantic_product_architecture', semanticProductAdmission: { required: true } }, acceptanceChecks: baseContract.successPredicate },
      implementation: {
        modifiedFiles: ['src/product.mjs'],
        diff: '--- a/src/product.mjs\n+++ b/src/product.mjs\n@@\n+export const transferBenchmarkEvidence_surface = Object.freeze({\n+  "surfaceId": "surface",\n+  "generatedAt": "2026-05-09T00:00:00.000Z"\n+});',
        metadata: {
          productDiffMode: 'semantic_product_architecture',
          semanticProductAdmissionRequired: true,
          markerOnlyProductDelta: true,
          claimIntegrityKind: 'marker_only_remediation_delta'
        }
      }
    }
  }));
  const markerResult = await processPatchQueue(markerQueue, { verifyFns });
  assert.equal(markerResult.queue.merged.length, 0);
  assert.equal(markerResult.queue.rejected[0].rejectionReason, 'marker_only_product_delta');

  const syntaxQueue = enqueuePatch(createPatchQueue(), createPatchArtifact({
    shardId: 'semantic_syntax_surface',
    filePaths: ['src/product.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract: baseContract,
      contextPack: { inputs: { productDiffMode: 'semantic_product_architecture', semanticProductAdmission: { required: true } }, acceptanceChecks: baseContract.successPredicate },
      implementation: {
        modifiedFiles: ['src/product.mjs'],
        diff: '--- a/src/product.mjs\n+++ b/src/product.mjs\n@@\n+export { ProductRuntime } from "./product-runtime.mjs";\n+export type ProductRuntimeState = { enabled: boolean };',
        metadata: {
          productDiffMode: 'semantic_product_architecture',
          semanticProductAdmissionRequired: true
        }
      }
    }
  }));
  const syntaxResult = await processPatchQueue(syntaxQueue, { verifyFns });
  assert.equal(syntaxResult.queue.merged.length, 0);
  assert.equal(syntaxResult.queue.rejected[0].rejectionReason, 'source_syntax_only_product_delta');
});

test('semantic product admission credits only scoped runtime architecture diffs with evidence', async () => {
  const assignmentContract = {
    artifactKind: 'product_diff',
    targetFiles: ['src/product.mjs'],
    targetModules: ['src/product.mjs', 'src/storage.mjs'],
    verifierRequirements: ['tests'],
    successPredicate: ['Semantic architecture evidence required: real product behavior is wired through the source-of-truth runtime.']
  };
  const queue = enqueuePatch(createPatchQueue(), createPatchArtifact({
    shardId: 'semantic_runtime_surface',
    filePaths: ['src/product.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract,
      contextPack: { inputs: { productDiffMode: 'semantic_product_architecture', semanticProductAdmission: { required: true } }, acceptanceChecks: assignmentContract.successPredicate },
      implementation: {
        modifiedFiles: ['src/product.mjs'],
        diff: '--- a/src/product.mjs\n+++ b/src/product.mjs\n@@\n+export function resolveProductCommand(input, store) {\n+  const saved = store.save({ id: input.id, status: "admitted" });\n+  return { commandId: input.id, saved, runtimePath: "product" };\n+}',
        metadata: {
          productDiffMode: 'semantic_product_architecture',
          semanticProductAdmissionRequired: true,
          architectureEvidence: {
            ok: true,
            layerCount: 2,
            modifiedPrimaryRuntimeFiles: ['src/product.mjs'],
            evidencePrimaryRuntimeFiles: ['src/product.mjs', 'src/storage.mjs'],
            modifiedRequiredLayers: ['route_or_server'],
            signaledFiles: ['src/product.mjs', 'src/storage.mjs'],
            modifiedSignaledFiles: ['src/product.mjs'],
            runtimeIntegrationEvidence: { ok: true }
          }
        }
      }
    }
  }));
  const result = await processPatchQueue(queue, { verifyFns: { tests: async () => ({ ok: true, verifier: 'tests', stdout: '{"ok":true}' }) } });
  assert.equal(result.queue.rejected.length, 0);
  assert.equal(result.queue.merged.length, 1);
  assert.equal(result.queue.merged[0].admissionAudit.semanticProductAdmission.required, true);
  assert.equal(result.queue.merged[0].admissionAudit.architectureAdmission.required, true);
});

test('strict semantic product admission rejects export-only runtimes without verifier execution proof', async () => {
  const assignmentContract = {
    artifactKind: 'product_diff',
    targetFiles: ['src/product.mjs', 'src/storage.mjs'],
    targetModules: ['src/product.mjs', 'src/storage.mjs'],
    verifierRequirements: ['tests'],
    successPredicate: ['Semantic runtime must be referenced and executed by verifier evidence.']
  };
  const basePatch = {
    shardId: 'strict_semantic_runtime_surface',
    filePaths: ['src/product.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract,
      contextPack: {
        inputs: {
          productDiffMode: 'semantic_product_architecture',
          semanticProductAdmission: {
            required: true,
            requireRuntimeExecution: true,
            requireExistingProductCall: true
          }
        },
        acceptanceChecks: assignmentContract.successPredicate
      },
      implementation: {
        modifiedFiles: ['src/product.mjs'],
        diff: '--- a/src/product.mjs\n+++ b/src/product.mjs\n@@\n+export function semanticProductArchitectureRuntime_surface(input, context) {\n+  return { ok: true, input, context };\n+}',
        metadata: {
          productDiffMode: 'semantic_product_architecture',
          semanticProductAdmissionRequired: true,
          architectureEvidence: {
            ok: true,
            layerCount: 2,
            modifiedPrimaryRuntimeFiles: ['src/product.mjs'],
            evidencePrimaryRuntimeFiles: ['src/product.mjs', 'src/storage.mjs'],
            modifiedRequiredLayers: ['route_or_server'],
            signaledFiles: ['src/product.mjs', 'src/storage.mjs'],
            modifiedSignaledFiles: ['src/product.mjs'],
            runtimeIntegrationEvidence: { ok: true },
            markerOnly: false
          }
        }
      }
    }
  };

  const exportOnly = await processPatchQueue(enqueuePatch(createPatchQueue(), createPatchArtifact(basePatch)), {
    verifyFns: { tests: async () => ({ ok: true, verifier: 'tests' }) }
  });
  assert.equal(exportOnly.queue.merged.length, 0);
  assert.equal(exportOnly.queue.rejected[0].rejectionReason, 'export_only_semantic_runtime');

  const wiredPatch = createPatchArtifact({
    ...basePatch,
    metadata: {
      ...basePatch.metadata,
      implementation: {
        ...basePatch.metadata.implementation,
        metadata: {
          ...basePatch.metadata.implementation.metadata,
          architectureEvidence: {
            ...basePatch.metadata.implementation.metadata.architectureEvidence,
            runtimeIntegrationEvidence: {
              ok: true,
              generatedRuntimeReferenced: true,
              generatedRuntimeReferenceCount: 1,
              existingProductCallRequired: true,
              existingProductCallWired: true,
              existingProductExportName: 'existingRuntime'
            }
          }
        }
      }
    }
  });
  const missingExecutionProof = await processPatchQueue(enqueuePatch(createPatchQueue(), wiredPatch), {
    verifyFns: { tests: async () => ({ ok: true, verifier: 'tests' }) }
  });
  assert.equal(missingExecutionProof.queue.merged.length, 0);
  assert.equal(missingExecutionProof.queue.rejected[0].rejectionReason, 'missing_semantic_runtime_execution_proof');

  const admitted = await processPatchQueue(enqueuePatch(createPatchQueue(), wiredPatch), {
    verifyFns: {
      tests: async () => ({
        ok: true,
        verifier: 'tests',
        parsedOutputSummary: {
          semanticRuntimeExecution: {
            ok: true,
            runtimeName: 'semanticProductArchitectureRuntime_surface',
            integrationName: 'semanticProductArchitectureIntegratedCall_surface',
            integrationResult: {
              generatedRuntimeCalled: true,
              existingProductCall: { attempted: true, ok: true, exportName: 'existingRuntime' }
            }
          }
        }
      })
    }
  });
  assert.equal(admitted.queue.rejected.length, 0);
  assert.equal(admitted.queue.merged.length, 1);
  assert.equal(admitted.queue.merged[0].admissionAudit.runtimeExecutionProof.ok, true);
});

test('semantic product admission rejects normal-flow bridge fallback when existing-product flow is required', async () => {
  const assignmentContract = {
    artifactKind: 'product_diff',
    targetFiles: ['src/product.mjs', 'src/storage.mjs'],
    targetModules: ['src/product.mjs', 'src/storage.mjs'],
    verifierRequirements: ['tests'],
    successPredicate: ['Semantic normal-flow proof must be wired through an existing product function.']
  };
  const patch = createPatchArtifact({
    shardId: 'normal_flow_surface',
    filePaths: ['src/product.mjs'],
    requiredVerifiers: ['tests'],
    metadata: {
      assignmentContract,
      contextPack: {
        inputs: {
          productDiffMode: 'semantic_product_architecture',
          semanticProductAdmission: {
            required: true,
            requireRuntimeExecution: true,
            requireExistingProductCall: true,
            requireNormalFlowIntegration: true
          }
        },
        acceptanceChecks: assignmentContract.successPredicate
      },
      implementation: {
        modifiedFiles: ['src/product.mjs'],
        diff: '--- a/src/product.mjs\n+++ b/src/product.mjs\n@@\n+export function semanticProductArchitectureRuntime_surface(input, context) {\n+  return { ok: true, input, context };\n+}',
        metadata: {
          productDiffMode: 'semantic_product_architecture',
          semanticProductAdmissionRequired: true,
          architectureEvidence: {
            ok: true,
            layerCount: 2,
            modifiedPrimaryRuntimeFiles: ['src/product.mjs'],
            evidencePrimaryRuntimeFiles: ['src/product.mjs', 'src/storage.mjs'],
            modifiedRequiredLayers: ['route_or_server'],
            signaledFiles: ['src/product.mjs', 'src/storage.mjs'],
            modifiedSignaledFiles: ['src/product.mjs'],
            markerOnly: false,
            runtimeIntegrationEvidence: {
              ok: true,
              generatedRuntimeReferenced: true,
              generatedRuntimeReferenceCount: 2,
              existingProductCallRequired: true,
              existingProductCallWired: true,
              existingProductExportName: 'summarizeProduct'
            }
          }
        }
      }
    }
  });
  const verifierResult = (source) => ({
    ok: true,
    verifier: 'tests',
    parsedOutputSummary: {
      semanticRuntimeExecution: {
        ok: true,
        runtimeName: 'semanticProductArchitectureRuntime_surface',
        integrationName: 'semanticProductArchitectureIntegratedCall_surface',
        integrationResult: {
          generatedRuntimeCalled: true,
          existingProductCall: { attempted: true, ok: true, exportName: 'summarizeProduct' }
        },
        normalFlowProof: { ok: true, source, runtimeName: 'semanticProductArchitectureRuntime_surface' }
      }
    }
  });

  const fallback = await processPatchQueue(enqueuePatch(createPatchQueue(), patch), {
    verifyFns: { tests: async () => verifierResult('normal_flow_bridge') }
  });
  assert.equal(fallback.queue.merged.length, 0);
  assert.equal(fallback.queue.rejected[0].rejectionReason, 'missing_existing_product_normal_flow_proof');

  const admitted = await processPatchQueue(enqueuePatch(createPatchQueue(), patch), {
    verifyFns: { tests: async () => verifierResult('existing_product_function') }
  });
  assert.equal(admitted.queue.rejected.length, 0);
  assert.equal(admitted.queue.merged.length, 1);
  assert.equal(admitted.queue.merged[0].admissionAudit.normalFlowProof.ok, true);
});

test('mailchimp normal-flow verifier admits existing product functions with nested default parameters', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-mailchimp-normal-flow-default-param-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/default-surface.mjs'), `export function createDefaultSurfaceWorkspace() {
  return { id: 'workspace-1', name: 'Default Surface Workspace', scorecards: [{ id: 'reach', posture: 'healthy' }] };
}

export function summarizeDefaultSurface(workspace = createDefaultSurfaceWorkspace()) {
  return { id: workspace.id, name: workspace.name, metricCount: workspace.scorecards.length };
}
`);
  const verifier = path.join(process.cwd(), 'apps/system-benchmark/verify-mailchimp-production-surface.mjs');
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'mailchimp_normal_flow_default_param_demo',
    benchmarkTier: 'tier1_smoke',
    benchmarkClass: 'mailchimp_normal_flow_api_transfer',
    fidelity: 'production_slice',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 1,
      productDiffMode: 'semantic_product_architecture',
      requireSemanticProductAdmission: true,
      requireRealProductDiffs: true,
      semanticProductAdmission: {
        required: true,
        mode: 'semantic_product_architecture',
        requireRuntimeExecution: true,
        requireExistingProductCall: true,
        requireNormalFlowIntegration: true,
        requireExistingProductNormalFlow: true
      },
      surfaces: [
        {
          id: 'default_surface',
          label: 'Default parameter product surface',
          allowedFiles: ['packages/app/default-surface.mjs'],
          verification: [`node ${verifier} default_surface --file packages/app/default-surface.mjs --duration-ms 0 --min-cycles 1 --cycle-interval-ms 250 --require-normal-flow --require-existing-product-normal-flow`]
        }
      ]
    },
    verifierSet: [{ kind: 'mailchimp_product_surface', command: `node ${verifier}` }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'mailchimp_normal_flow_default_param_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const patchQueue = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'patch_queue.json'), 'utf8'));
  assert.equal(patchQueue.rejected.length, 0);
  assert.equal(patchQueue.merged.length, 1);
  const result = JSON.parse(fs.readFileSync(patchQueue.merged[0].metadata.resultPath, 'utf8'));
  const semanticRuntimeExecution = result.verifierResults[0].metadata.parsedOutputSummary.semanticRuntimeExecution;
  assert.equal(semanticRuntimeExecution.normalFlowProof.source, 'existing_product_function');
  const source = fs.readFileSync(path.join(repo, 'packages/app/default-surface.mjs'), 'utf8');
  assert.match(source, /summarizeDefaultSurface\(workspace = createDefaultSurfaceWorkspace\(\)\) \{\n\s+const semanticProductArchitectureNormalFlow_default_surface_/);
});

test('mailchimp strict validator worker emits non-generic runtime evidence that survives anti-shim admission', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-mailchimp-strict-surface-runtime-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/app'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/strict-surface.mjs'), `export function summarizeStrictSurface(state = { db: { reports: [{ opens: 3, clicks: 1 }] }, workspace: { id: 'workspace-1' } }, workspaceId = state.workspace?.id || 'workspace-1') {
  const reports = Array.isArray(state?.db?.reports) ? state.db.reports : [];
  return { workspaceId, reportCount: reports.length, openTotal: reports.reduce((sum, report) => sum + Number(report.opens || 0), 0) };
}
`);
  fs.writeFileSync(path.join(repo, 'tests/strict-surface.test.mjs'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStrictSurface } from '../packages/app/strict-surface.mjs';

test('strict surface summary stays executable', () => {
  assert.deepEqual(summarizeStrictSurface({ workspace: { id: 'w1' }, db: { reports: [{ opens: 2 }, { opens: 5 }] } }), { workspaceId: 'w1', reportCount: 2, openTotal: 7 });
});
`);
  const verifier = path.join(process.cwd(), 'apps/system-benchmark/verify-mailchimp-production-surface.mjs');
  const antiShim = path.join(process.cwd(), 'apps/system-benchmark/verify-mailchimp-no-generic-shim.mjs');
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'mailchimp_strict_surface_runtime_demo',
    benchmarkTier: 'tier1_smoke',
    benchmarkClass: 'mailchimp_strict_surface_runtime_transfer',
    fidelity: 'production_slice',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 1,
      productDiffMode: 'semantic_product_architecture',
      requireSemanticProductAdmission: true,
      requireRealProductDiffs: true,
      semanticProductAdmission: {
        required: true,
        mode: 'semantic_product_architecture',
        requireRuntimeExecution: true,
        requireExistingProductCall: true,
        requireNormalFlowIntegration: true,
        requireExistingProductNormalFlow: true,
        runSurfaceVerificationCommandsDuringLive: true,
        rejectGenericSemanticShim: true
      },
      surfaces: [
        {
          id: 'strict_surface',
          label: 'Strict surface runtime',
          allowedFiles: ['packages/app/strict-surface.mjs'],
          verification: [
            'node --test tests/strict-surface.test.mjs',
            `node ${verifier} strict_surface --file packages/app/strict-surface.mjs --duration-ms 0 --min-cycles 12 --cycle-interval-ms 250 --require-normal-flow --require-existing-product-normal-flow`,
            `node ${antiShim} strict_surface --file packages/app/strict-surface.mjs --max-generic-line-ratio 0`
          ]
        }
      ]
    },
    verifierSet: [{ kind: 'mailchimp_product_surface', command: `node ${verifier}` }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'mailchimp_strict_surface_runtime_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const patchQueue = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'patch_queue.json'), 'utf8'));
  assert.equal(patchQueue.rejected.length, 0);
  assert.equal(patchQueue.merged.length, 1);
  const result = JSON.parse(fs.readFileSync(patchQueue.merged[0].metadata.resultPath, 'utf8'));
  const verifierOutputs = result.verifierResults.map((entry) => entry.metadata?.parsedOutputSummary || entry.metadata || {});
  const semanticRuntimeExecution = verifierOutputs.find((entry) => entry.semanticRuntimeExecution)?.semanticRuntimeExecution;
  assert.equal(semanticRuntimeExecution.ok, true);
  assert.equal(semanticRuntimeExecution.strictProductSurfaceRuntime, true);
  assert.equal(semanticRuntimeExecution.normalFlowProof.source, 'existing_product_function');
  const surfaceVerifierResult = result.verifierResults.find((entry) => /verify-mailchimp-production-surface/.test(entry.command || ''));
  assert.equal(surfaceVerifierResult.metadata.parsedOutputSummary.cyclesCompleted, 12);
  assert.equal(surfaceVerifierResult.metadata.parsedOutputSummary.semanticRuntimeExecution.ok, true);
  assert.ok(surfaceVerifierResult.metadata.stdoutOriginalLength <= 12000, `expected compact verifier stdout below live-transfer-verifier truncation limit, got ${surfaceVerifierResult.metadata.stdoutOriginalLength}`);
  const verifierStdoutJson = JSON.parse(surfaceVerifierResult.metadata.stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .pop());
  assert.equal(verifierStdoutJson.cycleDetailsIncluded, false);
  const antiShimResult = result.verifierResults.find((entry) => /verify-mailchimp-no-generic-shim/.test(entry.command || ''));
  assert.equal(antiShimResult.ok, true);
  const source = fs.readFileSync(path.join(repo, 'packages/app/strict-surface.mjs'), 'utf8');
  assert.match(source, /mailchimpStrictProductSurfaceRuntime_strict_surface_/);
  assert.doesNotMatch(source, /semanticProductArchitectureRuntime_/);
});

test('mailchimp normal-flow verifier supplies editor-state fixtures for client inspector functions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-mailchimp-editor-normal-flow-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'apps/web/public'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'apps/web/public/editor-client.mjs'), `export function normalizeEditorBlock(block = {}, index = 0) {
  return {
    id: block.id || ` + "`block-${index + 1}`" + `,
    type: block.type || 'text',
    sectionName: block.sectionName || ` + "`Block ${index + 1}`" + `,
    title: block.title || '',
    body: block.body || '',
    stylePreset: block.stylePreset || 'default',
    alignment: block.alignment || 'left',
    widthPercent: Number(block.widthPercent || 100),
    personalization: block.personalization || { mergeTags: [], fallback: '' }
  };
}

export function createEditorState({ blocks = [], settings = {}, viewport = 'desktop' } = {}) {
  return {
    viewport,
    selectedBlockId: blocks[0]?.id || 'block-1',
    settings,
    blocks: blocks.map((block, index) => normalizeEditorBlock(block, index)),
    history: [],
    future: []
  };
}

export function buildBlockInspectorState(state, blockId = state.selectedBlockId) {
  const block = state.blocks.find((entry) => entry.id === blockId) || state.blocks[0] || normalizeEditorBlock({}, 0);
  return {
    blockId: block.id,
    panel: 'design',
    editableFields: ['sectionName', 'title', 'body', 'stylePreset', 'alignment', 'widthPercent'],
    style: {
      preset: block.stylePreset,
      alignment: block.alignment,
      widthPercent: block.widthPercent
    },
    personalization: block.personalization || { mergeTags: [], fallback: '' }
  };
}
`);
  const verifier = path.join(process.cwd(), 'apps/system-benchmark/verify-mailchimp-production-surface.mjs');
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'mailchimp_editor_normal_flow_fixture_demo',
    benchmarkTier: 'tier1_smoke',
    benchmarkClass: 'mailchimp_normal_flow_client_transfer',
    fidelity: 'production_slice',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 1,
      productDiffMode: 'semantic_product_architecture',
      requireSemanticProductAdmission: true,
      requireRealProductDiffs: true,
      semanticProductAdmission: {
        required: true,
        mode: 'semantic_product_architecture',
        requireRuntimeExecution: true,
        requireExistingProductCall: true,
        requireNormalFlowIntegration: true,
        requireExistingProductNormalFlow: true
      },
      surfaces: [
        {
          id: 'editor',
          label: 'Editor client normal-flow fixture surface',
          allowedFiles: ['apps/web/public/editor-client.mjs'],
          verification: [`node ${verifier} editor --file apps/web/public/editor-client.mjs --duration-ms 0 --min-cycles 1 --cycle-interval-ms 250 --require-normal-flow --require-existing-product-normal-flow`]
        }
      ]
    },
    verifierSet: [{ kind: 'mailchimp_product_surface', command: `node ${verifier}` }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'mailchimp_editor_normal_flow_fixture_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const patchQueue = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'patch_queue.json'), 'utf8'));
  assert.equal(patchQueue.rejected.length, 0);
  assert.equal(patchQueue.merged.length, 1);
  const result = JSON.parse(fs.readFileSync(patchQueue.merged[0].metadata.resultPath, 'utf8'));
  const semanticRuntimeExecution = result.verifierResults[0].metadata.parsedOutputSummary.semanticRuntimeExecution;
  assert.equal(semanticRuntimeExecution.ok, true);
  assert.equal(semanticRuntimeExecution.integrationResult.existingProductCall.exportName, 'buildBlockInspectorState');
  assert.equal(semanticRuntimeExecution.integrationResult.existingProductCall.ok, true);
  assert.equal(semanticRuntimeExecution.normalFlowProof.source, 'existing_product_function');
});

test('mailchimp normal-flow verifier admits barrel re-export surfaces by wrapping the re-exported product function', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-mailchimp-normal-flow-reexport-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/app'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/source-surface.mjs'), `export function buildWebsitePublishRuntimeSnapshot(state, workspaceId) {
  return { workspaceId, websiteCount: state?.db?.websites?.length || 0, publishReady: true };
}
`);
  fs.writeFileSync(path.join(repo, 'packages/app/barrel-surface.mjs'), `export * from './source-surface.mjs';
`);
  const verifier = path.join(process.cwd(), 'apps/system-benchmark/verify-mailchimp-production-surface.mjs');
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'mailchimp_normal_flow_reexport_demo',
    benchmarkTier: 'tier1_smoke',
    benchmarkClass: 'mailchimp_normal_flow_api_transfer',
    fidelity: 'production_slice',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 1,
      productDiffMode: 'semantic_product_architecture',
      requireSemanticProductAdmission: true,
      requireRealProductDiffs: true,
      semanticProductAdmission: {
        required: true,
        mode: 'semantic_product_architecture',
        requireRuntimeExecution: true,
        requireExistingProductCall: true,
        requireNormalFlowIntegration: true,
        requireExistingProductNormalFlow: true
      },
      surfaces: [
        {
          id: 'barrel_surface',
          label: 'Barrel re-export product surface',
          allowedFiles: ['packages/app/barrel-surface.mjs'],
          verification: [`node ${verifier} barrel_surface --file packages/app/barrel-surface.mjs --duration-ms 0 --min-cycles 1 --cycle-interval-ms 250 --require-normal-flow --require-existing-product-normal-flow`]
        }
      ]
    },
    verifierSet: [{ kind: 'mailchimp_product_surface', command: `node ${verifier}` }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'mailchimp_normal_flow_reexport_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const patchQueue = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'patch_queue.json'), 'utf8'));
  assert.equal(patchQueue.rejected.length, 0);
  assert.equal(patchQueue.merged.length, 1);
  const result = JSON.parse(fs.readFileSync(patchQueue.merged[0].metadata.resultPath, 'utf8'));
  const semanticRuntimeExecution = result.verifierResults[0].metadata.parsedOutputSummary.semanticRuntimeExecution;
  assert.equal(semanticRuntimeExecution.normalFlowProof.source, 'existing_product_function');
  assert.equal(semanticRuntimeExecution.integrationResult.existingProductCall.ok, true);
  const source = fs.readFileSync(path.join(repo, 'packages/app/barrel-surface.mjs'), 'utf8');
  assert.match(source, /import \{ buildWebsitePublishRuntimeSnapshot as semanticProductExisting_buildWebsitePublishRuntimeSnapshot_source_surface \}/);
  assert.match(source, /export function buildWebsitePublishRuntimeSnapshot\(\.\.\.args\) \{\n\s+const semanticProductArchitectureNormalFlow_barrel_surface_/);
});

test('system benchmark transfer orchestrator runner writes blocker artifacts when execution crashes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-orchestrator-crash-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'pass-a.mjs'), "console.log('a');\n");
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'transfer_orchestrator_crash_demo',
    benchmarkTier: 'tier1_smoke',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 15,
      surfaces: [
        {
          id: 'surface_a',
          label: 'Surface A',
          allowedFiles: ['pass-a.mjs'],
          verification: ['node pass-a.mjs']
        }
      ]
    },
    verifierSet: [
      { kind: 'node_script', command: 'node pass-a.mjs' }
    ],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'transfer_orchestrator_crash_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      TRANSFER_BENCHMARK_TEST_FORCE_CRASH: '1'
    }
  });
  assert.equal(runner.status, 1, runner.stdout || runner.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'completion_summary.json'), 'utf8'));
  const blocker = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'blocker_report.json'), 'utf8'));
  const notifier = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'notifier_eligibility.json'), 'utf8'));
  const orchestratorSummary = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_summary.json'), 'utf8'));
  assert.equal(completion.thresholdPass, false);
  assert.equal(completion.supervisorConfirmedCompletion, false);
  assert.match(completion.note, /crashed before it could finalize benchmark artifacts/i);
  assert.equal(blocker.status, 'blocked');
  assert.equal(notifier.kind, 'blocker');
  assert.equal(notifier.eligible, true);
  assert.equal(orchestratorSummary.crashed, true);
});

test('supervisor snapshot stays amber until every shard is complete', () => {
  const shardPlan = buildShardPlan({
    workGraph: {
      targetPath: '/tmp/demo',
      workUnits: [
        {
          id: 'surface_a',
          title: 'Surface A',
          lane: 'transfer_validation',
          domain: 'surface_a',
          allowedFiles: ['a.mjs'],
          fileAreas: ['a.mjs'],
          deps: []
        },
        {
          id: 'surface_b',
          title: 'Surface B',
          lane: 'transfer_validation',
          domain: 'surface_b',
          allowedFiles: ['b.mjs'],
          fileAreas: ['b.mjs'],
          deps: []
        }
      ]
    },
    surfaceMatrix: { surfaces: [] }
  });
  const snapshot = compileSupervisorSnapshot({
    shardPlan,
    leaseState: createLeaseState(),
    patchQueue: createPatchQueue(),
    artifactBus: createArtifactBus()
  });
  assert.equal(snapshot.topLevel.status, 'amber');
  assert.equal(snapshot.topLevel.counts.ready, 2);
  assert.equal(snapshot.topLevel.counts.complete, 0);
});

test('tier2 PMHNP functional catalog is low-overlap and bootstraps correctly', () => {
  assert.ok(PMHNP_TIER2_SCENARIOS.length >= 10);
  const uniqueFiles = new Set(PMHNP_TIER2_SCENARIOS.flatMap((entry) => entry.allowedFiles));
  assert.equal(uniqueFiles.size, PMHNP_TIER2_SCENARIOS.length);

  const stackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-tier2-bootstrap-'));
  const init = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/init-transfer-benchmark.mjs'), 'pmhnp_denial_copilot_transfer_tier2', stackRoot], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(init.status, 0, init.stdout || init.stderr);
  const output = JSON.parse(init.stdout);
  const contract = JSON.parse(fs.readFileSync(output.runContractPath, 'utf8'));
  assert.equal(contract.benchmarkId, 'pmhnp_denial_copilot_transfer_tier2');
  assert.equal(contract.scope.surfaces.length, PMHNP_TIER2_SCENARIOS.length);
  assert.equal(contract.requestedAgentCount, 10);
  assert.equal(contract.scope.durationTargetMinutes, Math.ceil(PMHNP_TIER2_SCENARIOS.length / contract.requestedAgentCount) * 120);
  assert.match(contract.scope.surfaces[0].verification[0], /PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS/);
  assert.match(contract.scope.surfaces[0].verification[0], /verify-pmhnp-functional-scenario\.mjs/);
});

test('tier1 PMHNP transfer preset bootstraps endurance-capable functional surfaces', () => {
  const stackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-tier1-bootstrap-'));
  const init = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/init-transfer-benchmark.mjs'), 'pmhnp_denial_copilot_transfer', stackRoot], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(init.status, 0, init.stdout || init.stderr);
  const output = JSON.parse(init.stdout);
  const contract = JSON.parse(fs.readFileSync(output.runContractPath, 'utf8'));
  assert.equal(contract.benchmarkId, 'pmhnp_denial_copilot_transfer');
  assert.equal(contract.scope.durationTargetMinutes, 60);
  assert.equal(contract.scope.surfaces.length, PMHNP_TIER2_SCENARIOS.length);
  assert.match(contract.scope.surfaces[0].verification[0], /PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS/);
  assert.match(contract.scope.surfaces[0].verification[0], /PMHNP_BENCHMARK_SCENARIO_MIN_CYCLES/);
  assert.match(contract.scope.surfaces[0].verification[0], /verify-pmhnp-functional-scenario\.mjs/);
});

test('creative product benchmark requires creative worker evidence beyond verifier sleep', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-creative-product-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'packages/app'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'packages/app/creative-surface.mjs'), 'export function describeCreativeSurface(input = {}) { return { ok: true, input }; }\n');
  fs.writeFileSync(path.join(repo, 'tests/creative-surface.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { describeCreativeSurface } from '../packages/app/creative-surface.mjs';\ntest('creative surface works', () => { assert.equal(describeCreativeSurface({ id: 1 }).ok, true); });\n`);
  const mockWorker = path.join(root, 'mock-creative-worker.mjs');
  fs.writeFileSync(mockWorker, `import fs from 'node:fs';\nconst task = JSON.parse(fs.readFileSync(process.env.CREATIVE_WORKER_TASK_PATH, 'utf8'));\nconst target = task.allowedFiles[0];\nfs.appendFileSync(target, '\\nexport function creativeProductBehavior(input = {}) { return { ok: true, creative: true, id: input.id || null }; }\\n');\nfs.writeFileSync(process.env.CREATIVE_WORKER_EVIDENCE_PATH, JSON.stringify({ summary: 'Added concrete creative behavior', iterations: [{step:'inspect'}, {step:'design'}, {step:'edit'}], productDecisions: ['Expose creativeProductBehavior'], filesChanged: [target], testsRun: ['node --test tests/creative-surface.test.mjs'] }, null, 2));\n`);
  const bootstrap = bootstrapTransferBenchmark({
    benchmarkId: 'creative_product_demo',
    benchmarkTier: 'tier1_creative_product_30m',
    repoPath: repo,
    scope: {
      durationTargetMinutes: 0.01,
      productDiffMode: 'creative_product_work',
      requireRealProductDiffs: true,
      requireSemanticProductAdmission: true,
      semanticProductAdmission: { required: true, requireRuntimeExecution: true, rejectGenericSemanticShim: true },
      creativeProductWork: { required: true, minIterations: 3, minWorkerRuntimeMs: 0 },
      canonicalLandingEvidence: { enabled: true, mode: 'block_on_failed_landing', minAddedLineCount: 1, minUniqueNormalizedAddedLineCount: 1 },
      surfaces: [
        {
          id: 'creative_surface',
          label: 'Creative Surface',
          allowedFiles: ['packages/app/creative-surface.mjs'],
          verification: ['node --test tests/creative-surface.test.mjs']
        }
      ]
    },
    verifierSet: [{ kind: 'node_test', command: 'node --test tests/creative-surface.test.mjs' }],
    requestedAgentCount: 1,
    artifactRoot: path.join(root, 'artifacts', 'benchmarks', 'creative_product_demo', 'run-001'),
    scoreboardPath: path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json')
  });
  const runner = spawnSync(process.execPath, [path.join(process.cwd(), 'apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs'), path.join(bootstrap.root, 'run_contract.json')], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_COMMAND: `${process.execPath} ${mockWorker}`,
      CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0'
    }
  });
  assert.equal(runner.status, 0, runner.stdout || runner.stderr);
  const completion = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'completion_summary.json'), 'utf8'));
  const creativeEvidence = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'creative_worker_evidence.json'), 'utf8'));
  const patchQueue = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'patch_queue.json'), 'utf8'));
  assert.equal(completion.mechanicalGreen, true);
  assert.equal(completion.scaleProofReady, true);
  assert.equal(completion.thresholdPass, false);
  assert.equal(completion.thresholdFailures.some((entry) => entry.metric === 'autonomyWindowMinutes'), true);
  assert.equal(completion.thresholdFailures.some((entry) => entry.metric === 'minCreativeWorkerMinutes'), false);
  assert.equal(creativeEvidence.creativeWorkerEvidenceIntegrity, 1);
  assert.equal(creativeEvidence.creativeIterationIntegrity, 1);
  assert.equal(creativeEvidence.creativeProductDeltaIntegrity, 1);
  assert.equal(creativeEvidence.templateFallbackRate, 0);
  assert.equal(patchQueue.merged.length, 1);
  assert.equal(patchQueue.rejected.some((entry) => entry.rejectionReason === 'export_only_semantic_runtime'), false);
  const assignmentFile = fs.readdirSync(path.join(bootstrap.root, 'orchestrator_run', 'assignments')).find((entry) => entry.endsWith('.json'));
  const assignment = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'assignments', assignmentFile), 'utf8'));
  assert.equal(assignment.contextPack.inputs.semanticProductAdmission.requireRuntimeExecution, false);
  assert.equal(assignment.shard.metadata.semanticRuntimeExecutionRequired, false);
  assert.match(fs.readFileSync(path.join(repo, 'packages/app/creative-surface.mjs'), 'utf8'), /creativeProductBehavior/);
});

test('codex creative worker compact mode uses bounded brief and external verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-compact-'));
  const workspace = path.join(root, 'repo');
  write(path.join(workspace, 'src', 'domain', 'creative-surface.mjs'), 'export function describeCreativeSurface(input = {}) { return { ok: true, input }; }\n');
  write(path.join(workspace, 'tests', 'noisy-other.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('unrelated noisy verifier fails if it is run', () => { assert.equal(4, 3); });\n`);
  write(path.join(workspace, 'tests', 'creative-surface.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { compactProductDelta } from '../src/domain/creative-surface.mjs';\ntest('compact product delta works', () => { assert.equal(compactProductDelta({ id: 'demo' }).kind, 'compact_delta'); });\n`);
  const taskPath = path.join(root, 'task.json');
  const evidencePath = path.join(root, 'evidence.json');
  const packetPath = path.join(root, 'cortex-packet.json');
  const ledgerPath = path.join(root, 'ledger.json');
  const mockCodex = path.join(root, 'mock-codex.mjs');
  write(taskPath, JSON.stringify({
    goal: 'Add compact-mode product delta for creative surface',
    acceptanceChecks: [
      'Semantic architecture evidence required: real product behavior is wired through the source-of-truth runtime.',
      'Verifier passes: node --test tests/noisy-other.test.mjs'
    ]
  }, null, 2));
  write(packetPath, JSON.stringify({
    schemaVersion: 'claw.cortex_creative_context_packet.v1',
    cortexRoute: 'test_compact_route',
    surface: { id: 'creative_surface', goal: 'Add compact product behavior' },
    instructions: ['Implement real product behavior only.'],
    files: [{ path: 'src/domain/creative-surface.mjs', role: 'product_target', exists: true }],
    runnableChecks: [],
    budgetPolicy: { promptMode: 'compact' }
  }, null, 2));
  write(mockCodex, `#!/usr/bin/env node\nimport fs from 'node:fs';\nimport path from 'node:path';\nconst prompt = process.argv.at(-1) || '';\nfs.writeFileSync(path.join(process.cwd(), '__last_prompt.txt'), prompt);\nfs.appendFileSync(path.join(process.cwd(), 'src/domain/creative-surface.mjs'), \`\nconst compactDeltaKind = 'compact_delta';\nexport function compactProductDelta(input = {}) { return { kind: compactDeltaKind, id: input.id || null, verified: true }; }\n\`);\nconsole.log('tokens used');\nconsole.log('1,234');\n`);
  fs.chmodSync(mockCodex, 0o755);
  const worker = path.resolve('apps/system-benchmark/codex-creative-worker.mjs');
  const spawned = spawnSync(process.execPath, [worker], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_TASK_PATH: taskPath,
      CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
      CREATIVE_WORKER_WORKSPACE: workspace,
      CREATIVE_WORKER_ALLOWED_FILES: 'src/domain/creative-surface.mjs,tests/creative-surface.test.mjs,tests/noisy-other.test.mjs',
      CREATIVE_WORKER_SURFACE_ID: 'creative_surface',
      CREATIVE_WORKER_AGENT_ID: 'agent-compact',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_CORTEX_PACKET_PATH: packetPath,
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_LEDGER_PATH: ledgerPath,
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: '8000',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_ACTIVE_CODEX_CALL_SCHEDULE: 'completed<1:1,default:1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '1000',
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_MODEL: 'mock-model',
      CODEX_CREATIVE_SANDBOX: 'danger-full-access'
    }
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.ok, true);
  assert.equal(evidence.prompt.mode, 'compact');
  assert.equal(evidence.prompt.codexShouldRunTests, false);
  assert.equal(evidence.externalVerification.failureCount, 0);
  assert.equal(evidence.externalVerification.runs[0].results[0].command, 'node --test tests/creative-surface.test.mjs');
  assert.deepEqual(evidence.externalVerification.effectiveCommands, ['node --test tests/creative-surface.test.mjs']);
  assert.ok(evidence.prompt.audit[0].chars <= 9000);
  assert.equal(evidence.budget.events.at(-1).usage.total, 1234);
  assert.equal(evidence.budget.activeCodexCallSchedule.raw, 'completed<1:1,default:1');
  assert.equal(evidence.budget.activeCodexCallSchedule.valid, true);
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.activeCodexCallSchedule.raw, 'completed<1:1,default:1');
  assert.equal(ledger.events.find((entry) => entry.type === 'codex_call_reserved').effectiveMaxActiveCodexCalls, 1);
  const prompt = fs.readFileSync(path.join(workspace, '__last_prompt.txt'), 'utf8');
  assert.match(prompt, /compact surface brief/i);
  assert.doesNotMatch(prompt, /Bounded assigned-file context/);
});

test('codex creative worker rewrites stack-local external verifier scripts for isolated workspaces', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-stack-verifier-'));
  const workspace = path.join(root, 'repo');
  write(path.join(workspace, 'packages', 'app', 'route-surface.mjs'), 'export function routeSurfaceRuntime() { return { kind: "initial" }; }\n');
  write(path.join(workspace, 'tests', 'pq-summary.mjs'), `import assert from 'node:assert/strict';\nimport { routeSurfaceRuntime } from '../packages/app/route-surface.mjs';\nassert.equal(routeSurfaceRuntime().kind, 'rewritten_route');\nconsole.log('# tests 1');\nconsole.log('# pass 1');\nconsole.log('# fail 0');\n`);
  write(path.join(workspace, 'artifacts', 'controller-state.json'), JSON.stringify({
    waveSummaries: [{
      waveNumber: 1,
      shardCount: 1,
      mergedShardCount: 1,
      rejectedPatchCount: 0,
      durationMinutes: 1,
      activeWorkerMinutes: 1,
      uniqueAgentIds: ['agent-stack-verifier'],
      mergedProductFiles: ['packages/app/route-surface.mjs'],
      addedLineCount: 2,
      uniqueNormalizedAddedLineCount: 2,
      architectureEvidenceSummary: {
        evaluatedMergedPatchCount: 1,
        architectureEvidenceOkCount: 1,
        architectureLayeredDesignOkCount: 1,
        architectureRuntimeIntegrationOkCount: 1,
        architectureProductDeltaOkCount: 1,
        architectureBoilerplateViolationCount: 0
      }
    }]
  }, null, 2));
  const verifierCommand = 'node apps/system-benchmark/evaluate-production-quality-gate.mjs --repo-path . --artifact-root artifacts/production-quality-route-check --state-path artifacts/controller-state.json --test-command "node tests/pq-summary.mjs"';
  const taskPath = path.join(root, 'task.json');
  const evidencePath = path.join(root, 'evidence.json');
  const packetPath = path.join(root, 'cortex-packet.json');
  const ledgerPath = path.join(root, 'ledger.json');
  const mockCodex = path.join(root, 'mock-codex.mjs');
  write(taskPath, JSON.stringify({
    goal: 'Repair stack-local production quality verifier invocation from isolated worker workspace',
    acceptanceChecks: [`Verifier passes: ${verifierCommand}`]
  }, null, 2));
  write(packetPath, JSON.stringify({
    schemaVersion: 'claw.cortex_creative_context_packet.v1',
    cortexRoute: 'test_stack_verifier_route',
    surface: { id: 'route_surface', goal: 'Repair route surface production quality' },
    files: [{ path: 'packages/app/route-surface.mjs', role: 'product_target', exists: true }],
    budgetPolicy: { promptMode: 'compact' }
  }, null, 2));
  write(mockCodex, `#!/usr/bin/env node\nimport fs from 'node:fs';\nimport path from 'node:path';\nfs.writeFileSync(path.join(process.cwd(), 'packages/app/route-surface.mjs'), [\n  "const routeSurfaceKind = 'rewritten_route';",\n  "export function routeSurfaceRuntime() {",\n  "  return { kind: routeSurfaceKind, source: 'codex_worker' };",\n  "}",\n  ""\n].join('\\n'));\nconsole.log('tokens used');\nconsole.log('1,234');\n`);
  fs.chmodSync(mockCodex, 0o755);
  const worker = path.resolve('apps/system-benchmark/codex-creative-worker.mjs');
  const spawned = spawnSync(process.execPath, [worker], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_TASK_PATH: taskPath,
      CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
      CREATIVE_WORKER_WORKSPACE: workspace,
      CREATIVE_WORKER_ALLOWED_FILES: 'packages/app/route-surface.mjs,tests/pq-summary.mjs',
      CREATIVE_WORKER_SURFACE_ID: 'route_surface',
      CREATIVE_WORKER_AGENT_ID: 'agent-stack-verifier',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_CORTEX_PACKET_PATH: packetPath,
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_LEDGER_PATH: ledgerPath,
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: '8000',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '1000',
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_MODEL: 'mock-model',
      CODEX_CREATIVE_SANDBOX: 'danger-full-access'
    }
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  assert.doesNotMatch(`${spawned.stdout}\n${spawned.stderr}`, /Cannot find module/);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.ok, true);
  assert.equal(evidence.externalVerification.failureCount, 0);
  assert.equal(evidence.externalVerification.runs[0].results[0].ok, true);
  assert.match(evidence.externalVerification.effectiveCommands[0], /apps\/system-benchmark\/evaluate-production-quality-gate\.mjs/);
  assert.doesNotMatch(evidence.externalVerification.effectiveCommands[0], /^node apps\/system-benchmark\//);
  const gate = JSON.parse(fs.readFileSync(path.join(workspace, 'artifacts', 'production-quality-route-check', 'production_quality_gate.json'), 'utf8'));
  assert.equal(gate.ok, true);
});

test('production quality gate derives diff metrics from a benchmark repo when controller aggregates are absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-quality-diff-derived-'));
  const repo = path.join(root, 'repo');
  const baseline = path.join(root, 'baseline');
  const artifactRoot = path.join(root, 'quality');
  write(path.join(repo, 'packages', 'app', 'routes', 'alpha.mjs'), `export function registerAlpha(router) {\n  router.register('GET', '/api/alpha', async () => {});\n}\n`);
  write(path.join(repo, 'tests', 'summary.mjs'), `console.log('# tests 1');\nconsole.log('# pass 0');\nconsole.log('# fail 1');\n`);
  for (const args of [
    ['init'],
    ['config', 'user.email', 'quality-gate-test@openclaw.local'],
    ['config', 'user.name', 'Quality Gate Test'],
    ['add', '-A'],
    ['commit', '--allow-empty', '--no-gpg-sign', '-m', 'baseline']
  ]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  fs.cpSync(repo, baseline, { recursive: true });
  fs.appendFileSync(path.join(repo, 'packages', 'app', 'routes', 'alpha.mjs'), `\nexport function alphaReleasePayload() {\n  return {\n    ok: true,\n    route: '/api/alpha'\n  };\n}\n\nexport function alphaReleasePreviewPayload() {\n  return {\n    ok: true,\n    route: '/api/alpha'\n  };\n}\n`);

  const gate = spawnSync(process.execPath, [
    'apps/system-benchmark/evaluate-production-quality-gate.mjs',
    '--repo-path', repo,
    '--baseline-repo-path', baseline,
    '--artifact-root', artifactRoot,
    '--test-command', 'node tests/summary.mjs',
    '--max-route-collisions', '0',
    '--max-duplicate-normalized-line-ratio', '0.5',
    '--min-architecture-fitness-score', '0',
    '--max-architecture-violations', '999'
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(gate.status, 0, gate.stderr || gate.stdout);
  const report = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'production_quality_gate.json'), 'utf8'));
  assert.equal(report.ok, true);
  assert.equal(report.metrics.routeCollisionCount, 0);
  assert.equal(report.metrics.testFailureRegressionCount, 0);
  assert.equal(report.metrics.changedProductFileCount, 1);
  assert.deepEqual(report.metrics.changedProductFiles, ['packages/app/routes/alpha.mjs']);
  assert.equal(report.metrics.architectureGatePass, 1);
  assert.equal(report.metrics.productionQualityGatePass, 1);
  assert.equal(typeof report.metrics.duplicateNormalizedLineRatio, 'number');
  assert.equal(report.metrics.addedLineCount, 6);
  assert.equal(report.metrics.uniqueNormalizedAddedLineCount, 4);
  assert.equal(report.duplicateLineAudit.ignoredStructuralLineCount >= 6, true);
  assert.deepEqual(report.duplicateLineAudit.topDuplicateNormalizedLines.slice(0, 2), [
    { line: "ok: true,", count: 2 },
    { line: "route: '/api/alpha'", count: 2 }
  ]);
});

test('production quality gate materializes baseline ref when baseline repo path is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-quality-baseline-ref-'));
  const repo = path.join(root, 'repo');
  const artifactRoot = path.join(root, 'quality');
  write(path.join(repo, 'packages', 'app', 'routes', 'alpha.mjs'), `export function registerAlpha(router) {\n  router.register('GET', '/api/alpha', async () => {});\n}\n`);
  write(path.join(repo, 'tests', 'summary.mjs'), `console.log('# tests 2');\nconsole.log('# pass 1');\nconsole.log('# fail 1');\n`);
  for (const args of [
    ['init'],
    ['config', 'user.email', 'quality-gate-test@openclaw.local'],
    ['config', 'user.name', 'Quality Gate Test'],
    ['add', '-A'],
    ['commit', '--allow-empty', '--no-gpg-sign', '-m', 'baseline']
  ]) {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  const baselineHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  write(path.join(artifactRoot, 'baseline_head.txt'), `${baselineHead}\n`);
  fs.writeFileSync(path.join(repo, 'tests', 'summary.mjs'), `console.log('# tests 2');\nconsole.log('# pass 0');\nconsole.log('# fail 2');\n`);

  const gate = spawnSync(process.execPath, [
    'apps/system-benchmark/evaluate-production-quality-gate.mjs',
    '--repo-path', repo,
    '--artifact-root', artifactRoot,
    '--test-command', 'node tests/summary.mjs',
    '--max-test-failure-regression', '1',
    '--max-route-collisions', '0',
    '--max-duplicate-normalized-line-ratio', '0.5',
    '--min-architecture-fitness-score', '0',
    '--max-architecture-violations', '999'
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(gate.status, 1, gate.stderr || gate.stdout);
  const report = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'production_quality_gate.json'), 'utf8'));
  assert.equal(report.ok, false);
  assert.equal(report.baselineRef, baselineHead);
  assert.equal(report.baselineMaterialization.materialized, true);
  assert.equal(report.baselineTestSummary.fail, 1);
  assert.equal(report.finalTestSummary.fail, 2);
  assert.equal(report.metrics.testFailureRegressionCount, 1);
});

test('route collision checker is a narrow verifier independent of full production quality evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'route-collision-checker-'));
  write(path.join(root, 'packages', 'app', 'routes', 'alpha.mjs'), `export function registerAlpha(router) {\n  router.register('GET', '/api/alpha', async () => {});\n}\n`);
  write(path.join(root, 'packages', 'app', 'routes', 'beta.mjs'), `export function registerBeta(router) {\n  router.register('GET', '/api/beta', async () => {});\n}\n`);
  const pass = spawnSync(process.execPath, ['apps/system-benchmark/check-route-collisions.mjs', '--repo-path', root, '--max-route-collisions', '0'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(pass.status, 0, pass.stderr || pass.stdout);
  const passReport = JSON.parse(pass.stdout);
  assert.equal(passReport.metrics.routeCollisionCount, 0);

  fs.appendFileSync(path.join(root, 'packages', 'app', 'routes', 'beta.mjs'), `\nrouter.register('GET', '/api/alpha', async () => {});\n`);
  const fail = spawnSync(process.execPath, ['apps/system-benchmark/check-route-collisions.mjs', '--repo-path', root, '--max-route-collisions', '0'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(fail.status, 0);
  const failReport = JSON.parse(fail.stdout);
  assert.equal(failReport.metrics.routeCollisionCount, 1);

  const scopedPass = spawnSync(process.execPath, ['apps/system-benchmark/check-route-collisions.mjs', '--repo-path', root, '--route', 'GET /api/beta', '--require-routes-present', '--max-route-collisions', '0'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(scopedPass.status, 0, scopedPass.stderr || scopedPass.stdout);
  const scopedPassReport = JSON.parse(scopedPass.stdout);
  assert.equal(scopedPassReport.metrics.routeCollisionCount, 0);
  assert.equal(scopedPassReport.metrics.globalRouteCollisionCount, 1);
  assert.deepEqual(scopedPassReport.policy.routes, ['GET /api/beta']);

  const scopedFail = spawnSync(process.execPath, ['apps/system-benchmark/check-route-collisions.mjs', '--repo-path', root, '--route', 'GET /api/alpha', '--require-routes-present', '--max-route-collisions', '0'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(scopedFail.status, 0);
  const scopedFailReport = JSON.parse(scopedFail.stdout);
  assert.equal(scopedFailReport.metrics.routeCollisionCount, 1);

  const missingRoute = spawnSync(process.execPath, ['apps/system-benchmark/check-route-collisions.mjs', '--repo-path', root, '--route', 'GET /api/missing', '--require-routes-present', '--max-route-collisions', '0'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(missingRoute.status, 0);
  const missingRouteReport = JSON.parse(missingRoute.stdout);
  assert.equal(missingRouteReport.metrics.missingRouteCount, 1);
});

test('codex creative worker runs game external verification against isolated workspace repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-game-workspace-verifier-'));
  const workspace = path.join(root, 'worker-repo');
  const canonicalRepo = path.join(root, 'canonical-repo');
  const target = 'scripts/player/game_surface.gd';
  write(path.join(workspace, 'project.godot'), '; worker fixture\n');
  write(path.join(canonicalRepo, 'project.godot'), '; canonical fixture with no target file\n');
  const taskPath = path.join(root, 'task.json');
  const evidencePath = path.join(root, 'evidence.json');
  const packetPath = path.join(root, 'cortex-packet.json');
  const ledgerPath = path.join(root, 'ledger.json');
  const recordPath = path.join(root, 'verifier-record.json');
  const mockVerifier = path.join(root, 'mock-game-verifier.mjs');
  const mockCodex = path.join(root, 'mock-codex.mjs');
  write(mockVerifier, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
function arg(name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; }
const repoPath = path.resolve(arg('--repo-path') || '.');
const file = arg('--file') || 'scripts/player/game_surface.gd';
const targetPath = path.join(repoPath, file);
const ok = fs.existsSync(targetPath) && fs.readFileSync(targetPath, 'utf8').includes('workspaceVerifiedGameSurface');
fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({ repoPath, targetPath, ok }, null, 2));
console.log(JSON.stringify({ ok, repoPath, file, checkKinds: ['mock-game-workspace-verifier'] }));
process.exit(ok ? 0 : 1);
`);
  fs.chmodSync(mockVerifier, 0o755);
  write(mockCodex, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const target = path.join(process.cwd(), ${JSON.stringify(target)});
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, [
  'extends Node',
  '',
  'func workspaceVerifiedGameSurface() -> bool:',
  '\treturn true',
  ''
].join('\\n'));
console.log('tokens used');
console.log('1,234');
`);
  fs.chmodSync(mockCodex, 0o755);
  const verifierCommand = `node ${mockVerifier} --repo-path "\${GAME_100_AGENT_REPO_PATH:-.}" --surface 'player_game_surface' --file '${target}' --kind 'runtime_gameplay' --lane 'player_controller'`;
  write(taskPath, JSON.stringify({
    goal: 'Create a Godot game surface and verify it in the isolated worker repo',
    acceptanceChecks: [`Verifier passes: ${verifierCommand}`]
  }, null, 2));
  write(packetPath, JSON.stringify({
    schemaVersion: 'claw.cortex_creative_context_packet.v1',
    cortexRoute: 'test_game_workspace_verifier_route',
    surface: { id: 'player_game_surface', goal: 'Create a worker-local game surface' },
    files: [{ path: target, role: 'product_target', exists: false }],
    budgetPolicy: { promptMode: 'compact' }
  }, null, 2));
  const worker = path.resolve('apps/system-benchmark/codex-creative-worker.mjs');
  const spawned = spawnSync(process.execPath, [worker], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      GAME_100_AGENT_REPO_PATH: canonicalRepo,
      CREATIVE_WORKER_TASK_PATH: taskPath,
      CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
      CREATIVE_WORKER_WORKSPACE: workspace,
      CREATIVE_WORKER_ALLOWED_FILES: target,
      CREATIVE_WORKER_SURFACE_ID: 'player_game_surface',
      CREATIVE_WORKER_AGENT_ID: 'agent-game-workspace-verifier',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_CORTEX_PACKET_PATH: packetPath,
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_LEDGER_PATH: ledgerPath,
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: '8000',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '1000',
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_MODEL: 'mock-model',
      CODEX_CREATIVE_SANDBOX: 'danger-full-access'
    }
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  assert.equal(evidence.ok, true);
  assert.equal(evidence.externalVerification.failureCount, 0);
  assert.equal(record.repoPath, workspace);
  assert.notEqual(record.repoPath, canonicalRepo);
  assert.equal(record.ok, true);
});

test('codex creative worker usage-limit detector ignores product retry copy on successful Codex calls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-usage-detector-'));
  const workspace = path.join(root, 'repo');
  write(path.join(workspace, 'packages', 'app', 'reports-surface.mjs'), 'export function reportsSurfaceState(input = {}) { return { input, status: "initial" }; }\n');
  const taskPath = path.join(root, 'task.json');
  const evidencePath = path.join(root, 'evidence.json');
  const ledgerPath = path.join(root, 'ledger.json');
  const mockCodex = path.join(root, 'mock-codex.mjs');
  write(taskPath, JSON.stringify({
    goal: 'Add reports retry product copy without tripping Codex usage detector',
    acceptanceChecks: []
  }, null, 2));
  write(mockCodex, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
fs.appendFileSync(path.join(process.cwd(), 'packages/app/reports-surface.mjs'), [
  '',
  'export function reportsRetryNotice(health = {}) {',
  '  const retryAt = health.retryAvailableAt || null;',
  '  return {',
  '    status: retryAt ? "waiting" : "ready",',
  '    message: retryAt ? \`Telemetry refresh is paused by retry backoff. Try again at \${retryAt}.\` : "Telemetry refresh is ready.",',
  '    retryAt',
  '  };',
  '}',
  ''
].join('\\n'));
console.log('Telemetry refresh is paused by retry backoff. Try again at 2026-06-08T01:05:00Z.');
console.log('tokens used');
console.log('2,345');
`);
  fs.chmodSync(mockCodex, 0o755);
  const worker = path.resolve('apps/system-benchmark/codex-creative-worker.mjs');
  const spawned = spawnSync(process.execPath, [worker], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_TASK_PATH: taskPath,
      CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
      CREATIVE_WORKER_WORKSPACE: workspace,
      CREATIVE_WORKER_ALLOWED_FILES: 'packages/app/reports-surface.mjs',
      CREATIVE_WORKER_SURFACE_ID: 'reports_surface',
      CREATIVE_WORKER_AGENT_ID: 'agent-usage-detector',
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_LEDGER_PATH: ledgerPath,
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_MIN_ITERATIONS: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '1000',
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_MODEL: 'mock-model',
      CODEX_CREATIVE_SANDBOX: 'danger-full-access'
    }
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(evidence.ok, true);
  assert.equal(evidence.budget.events.at(-1).usage.usageLimit, false);
  assert.equal(evidence.budget.stopReason, null);
  assert.equal(ledger.globalStop, null);
  assert.equal(ledger.events.at(-1).usageLimit, false);
  assert.equal(evidence.risks.includes('codex_usage_limit_observed'), false);
});

test('codex creative worker usage-limit detector ignores product 429 copy on failed Codex calls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-usage-429-'));
  const workspace = path.join(root, 'repo');
  write(path.join(workspace, 'packages', 'app', 'provider-surface.mjs'), 'export function providerSurfaceState(input = {}) { return { input, status: "initial" }; }\n');
  const taskPath = path.join(root, 'task.json');
  const evidencePath = path.join(root, 'evidence.json');
  const ledgerPath = path.join(root, 'ledger.json');
  const mockCodex = path.join(root, 'mock-codex.mjs');
  write(taskPath, JSON.stringify({
    goal: 'Add provider rate-limited product copy without tripping Codex usage detector',
    acceptanceChecks: []
  }, null, 2));
  write(mockCodex, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
fs.appendFileSync(path.join(process.cwd(), 'packages/app/provider-surface.mjs'), [
  '',
  'export function providerRateLimitNotice(account = {}) {',
  '  return {',
  '    status: "rate_limited",',
  '    httpStatus: 429,',
  '    message: (account.displayName || "Provider") + " is rate limiting Mailchimp sync requests."',
  '  };',
  '}',
  ''
].join('\\n'));
console.log('httpStatus: 429');
console.log('Provider is rate limiting Mailchimp sync requests.');
process.exit(1);
`);
  fs.chmodSync(mockCodex, 0o755);
  const worker = path.resolve('apps/system-benchmark/codex-creative-worker.mjs');
  const spawned = spawnSync(process.execPath, [worker], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_TASK_PATH: taskPath,
      CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
      CREATIVE_WORKER_WORKSPACE: workspace,
      CREATIVE_WORKER_ALLOWED_FILES: 'packages/app/provider-surface.mjs',
      CREATIVE_WORKER_SURFACE_ID: 'provider_surface',
      CREATIVE_WORKER_AGENT_ID: 'agent-usage-429',
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_LEDGER_PATH: ledgerPath,
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_MIN_ITERATIONS: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '1000',
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_MODEL: 'mock-model',
      CODEX_CREATIVE_SANDBOX: 'danger-full-access'
    }
  });
  assert.equal(spawned.status, 1);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(evidence.ok, false);
  assert.equal(evidence.budget.events.at(-1).usage.usageLimit, false);
  assert.equal(evidence.budget.stopReason, null);
  assert.equal(ledger.globalStop, null);
  assert.equal(ledger.events.at(-1).usageLimit, false);
  assert.equal(evidence.risks.includes('codex_usage_limit_observed'), false);
});

test('codex creative worker treats auth refresh failure as non-retryable blocker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-auth-failure-'));
  const workspace = path.join(root, 'repo');
  write(path.join(workspace, 'packages', 'app', 'auth-surface.mjs'), 'export function authSurfaceState(input = {}) { return { input, status: "initial" }; }\n');
  const taskPath = path.join(root, 'task.json');
  const evidencePath = path.join(root, 'evidence.json');
  const ledgerPath = path.join(root, 'ledger.json');
  const mockCodex = path.join(root, 'mock-codex.mjs');
  write(taskPath, JSON.stringify({
    goal: 'Probe Codex auth failure classification',
    acceptanceChecks: []
  }, null, 2));
  write(mockCodex, `#!/usr/bin/env node
console.error('2026-06-11T17:16:46Z ERROR failed to connect to websocket: HTTP error: 401 Unauthorized');
console.error('ERROR: Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.');
process.exit(1);
`);
  fs.chmodSync(mockCodex, 0o755);
  const worker = path.resolve('apps/system-benchmark/codex-creative-worker.mjs');
  const spawned = spawnSync(process.execPath, [worker], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_TASK_PATH: taskPath,
      CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
      CREATIVE_WORKER_WORKSPACE: workspace,
      CREATIVE_WORKER_ALLOWED_FILES: 'packages/app/auth-surface.mjs',
      CREATIVE_WORKER_SURFACE_ID: 'auth_surface',
      CREATIVE_WORKER_AGENT_ID: 'agent-auth-failure',
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_LEDGER_PATH: ledgerPath,
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_MIN_ITERATIONS: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '1000',
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_MODEL: 'mock-model',
      CODEX_CREATIVE_SANDBOX: 'danger-full-access'
    }
  });
  assert.equal(spawned.status, 1);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(evidence.ok, false);
  assert.equal(evidence.retryable, false);
  assert.equal(evidence.budget.stopReason, 'codex_auth_failure_observed');
  assert.equal(evidence.budget.events.at(-1).usage.authFailure, true);
  assert.equal(evidence.budget.events.at(-1).usage.usageLimit, false);
  assert.equal(ledger.globalStop.reason, 'codex_auth_failure_observed');
  assert.equal(ledger.events.at(-1).authFailure, true);
});

test('codex creative worker prompt-token hard stop fires before reservation or Codex spawn', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-prompt-budget-'));
  const workspace = path.join(root, 'repo');
  write(path.join(workspace, 'packages', 'app', 'budget-surface.mjs'), 'export function budgetSurfaceState(input = {}) { return { input, status: "initial" }; }\n');
  const taskPath = path.join(root, 'task.json');
  const evidencePath = path.join(root, 'evidence.json');
  const ledgerPath = path.join(root, 'ledger.json');
  const invokedPath = path.join(root, 'codex-invoked');
  const mockCodex = path.join(root, 'mock-codex.mjs');
  write(taskPath, JSON.stringify({
    goal: 'Probe hard prompt-token stop before spending a Codex call',
    acceptanceChecks: []
  }, null, 2));
  write(mockCodex, `#!/usr/bin/env node
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(invokedPath)}, 'invoked');
console.log('tokens used');
console.log('123');
`);
  fs.chmodSync(mockCodex, 0o755);

  const worker = path.resolve('apps/system-benchmark/codex-creative-worker.mjs');
  const spawned = spawnSync(process.execPath, [worker], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_TASK_PATH: taskPath,
      CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
      CREATIVE_WORKER_WORKSPACE: workspace,
      CREATIVE_WORKER_ALLOWED_FILES: 'packages/app/budget-surface.mjs',
      CREATIVE_WORKER_SURFACE_ID: 'budget_surface',
      CREATIVE_WORKER_AGENT_ID: 'agent-prompt-budget',
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_LEDGER_PATH: ledgerPath,
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_MIN_ITERATIONS: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET: '1',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET_MODE: 'hard',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '1000',
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_MODEL: 'mock-model',
      CODEX_CREATIVE_SANDBOX: 'danger-full-access'
    }
  });

  assert.equal(spawned.status, 1, spawned.stderr || spawned.stdout);
  assert.equal(fs.existsSync(invokedPath), false);
  assert.equal(fs.existsSync(ledgerPath), false);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.ok, false);
  assert.equal(evidence.budget.stopReason, 'creative_prompt_token_budget_exceeded');
  assert.equal(evidence.budget.events.at(-1).type, 'prompt_budget_stop_before_codex');
  assert.equal(evidence.budget.events.at(-1).promptTokenBudget, 1);
});

test('codex creative worker can fail closed after compact external verifier failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-fail-closed-'));
  const workspace = path.join(root, 'repo');
  const verifierCommand = `CREATIVE_SURFACE_CHECK=1 node --input-type=module -e "import { compactProductDelta } from './packages/app/creative-surface.mjs'; if (compactProductDelta({ id: 'demo' }).kind !== 'compact_delta') process.exit(1);"`;
  write(path.join(workspace, 'packages', 'app', 'creative-surface.mjs'), 'export function compactProductDelta(input = {}) { return { kind: "initial", id: input.id || null }; }\n');
  const taskPath = path.join(root, 'task.json');
  const evidencePath = path.join(root, 'evidence.json');
  const packetPath = path.join(root, 'cortex-packet.json');
  const ledgerPath = path.join(root, 'ledger.json');
  const mockCodex = path.join(root, 'mock-codex.mjs');
  write(taskPath, JSON.stringify({
    goal: 'Add compact-mode product delta for creative surface',
    acceptanceChecks: [`Verifier passes: ${verifierCommand}`]
  }, null, 2));
  write(packetPath, JSON.stringify({
    schemaVersion: 'claw.cortex_creative_context_packet.v1',
    cortexRoute: 'test_compact_route',
    surface: { id: 'creative_surface', goal: 'Add compact product behavior' },
    instructions: ['Implement real product behavior only.'],
    files: [{ path: 'packages/app/creative-surface.mjs', role: 'product_target', exists: true }],
    budgetPolicy: { promptMode: 'compact' }
  }, null, 2));
  write(mockCodex, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const marker = path.join(process.cwd(), '__mock_iteration_count');
const count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) : 0;
fs.writeFileSync(marker, String(count + 1));
const nextSource = [
  "const compactDeltaKind = 'broken_delta';",
  "export function compactProductDelta(input = {}) { return { kind: compactDeltaKind, id: input.id || null, verified: true }; }",
  ''
].join(String.fromCharCode(10));
fs.writeFileSync(path.join(process.cwd(), 'packages/app/creative-surface.mjs'), nextSource);
console.log('tokens used');
console.log(count === 0 ? '1,111' : '9,999');
`);
  fs.chmodSync(mockCodex, 0o755);
  const worker = path.resolve('apps/system-benchmark/codex-creative-worker.mjs');
  const spawned = spawnSync(process.execPath, [worker], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_TASK_PATH: taskPath,
      CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
      CREATIVE_WORKER_WORKSPACE: workspace,
      CREATIVE_WORKER_ALLOWED_FILES: 'packages/app/creative-surface.mjs',
      CREATIVE_WORKER_SURFACE_ID: 'creative_surface',
      CREATIVE_WORKER_AGENT_ID: 'agent-fail-closed',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_CORTEX_PACKET_PATH: packetPath,
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_LEDGER_PATH: ledgerPath,
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: '8000',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE: '1',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '2',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '2',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '2',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '1000',
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_MODEL: 'mock-model',
      CODEX_CREATIVE_SANDBOX: 'danger-full-access'
    }
  });
  assert.equal(spawned.status, 1, spawned.stderr || spawned.stdout);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(evidence.ok, false);
  assert.equal(evidence.retryable, false);
  assert.equal(evidence.iterations.length, 1);
  assert.equal(evidence.prompt.stopOnExternalVerificationFailure, true);
  assert.equal(evidence.externalVerification.failureCount, 1);
  assert.ok(evidence.risks.includes('creative_external_verification_failed_stop'));
  assert.equal(evidence.budget.stopReason, 'creative_external_verification_failed_stop');
  assert.equal(evidence.budget.events.some((entry) => entry.type === 'creative_external_verification_failed_stop'), true);
  assert.equal(ledger.callsCompleted, 1);
  assert.equal(fs.readFileSync(path.join(workspace, '__mock_iteration_count'), 'utf8'), '1');
});

test('codex creative worker clears stale external verifier failures after a repair iteration passes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-repair-'));
  const workspace = path.join(root, 'repo');
  const verifierCommand = `node --input-type=module -e "import { compactProductDelta } from './packages/app/creative-surface.mjs'; if (compactProductDelta({ id: 'demo' }).kind !== 'compact_delta') process.exit(1);"`;
  write(path.join(workspace, 'packages', 'app', 'creative-surface.mjs'), 'export function compactProductDelta(input = {}) { return { kind: "initial", id: input.id || null }; }\n');
  write(path.join(workspace, 'tests', 'creative-surface.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { compactProductDelta } from '../packages/app/creative-surface.mjs';\ntest('compact product delta works', () => { assert.equal(compactProductDelta({ id: 'demo' }).kind, 'compact_delta'); });\n`);
  const taskPath = path.join(root, 'task.json');
  const evidencePath = path.join(root, 'evidence.json');
  const packetPath = path.join(root, 'cortex-packet.json');
  const ledgerPath = path.join(root, 'ledger.json');
  const mockCodex = path.join(root, 'mock-codex.mjs');
  write(taskPath, JSON.stringify({
    goal: 'Repair compact-mode product delta for creative surface',
    acceptanceChecks: [`Verifier passes: ${verifierCommand}`]
  }, null, 2));
  write(packetPath, JSON.stringify({
    schemaVersion: 'claw.cortex_creative_context_packet.v1',
    cortexRoute: 'test_compact_route',
    surface: { id: 'creative_surface', goal: 'Repair compact product behavior' },
    instructions: ['Implement real product behavior only.'],
    files: [{ path: 'packages/app/creative-surface.mjs', role: 'product_target', exists: true }],
    budgetPolicy: { promptMode: 'compact' }
  }, null, 2));
  write(mockCodex, `#!/usr/bin/env node\nimport fs from 'node:fs';\nimport path from 'node:path';\nconst marker = path.join(process.cwd(), '__mock_iteration_count');\nconst count = fs.existsSync(marker) ? Number(fs.readFileSync(marker, 'utf8')) : 0;\nfs.writeFileSync(marker, String(count + 1));\nconst kind = count === 0 ? 'broken_delta' : 'compact_delta';\nfs.writeFileSync(path.join(process.cwd(), 'packages/app/creative-surface.mjs'), \`const compactDeltaKind = '\${kind}';\nexport function compactProductDelta(input = {}) { return { kind: compactDeltaKind, id: input.id || null, verified: true }; }\n\`);\nconsole.log('tokens used');\nconsole.log(count === 0 ? '1,111' : '2,222');\n`);
  fs.chmodSync(mockCodex, 0o755);
  const worker = path.resolve('apps/system-benchmark/codex-creative-worker.mjs');
  const spawned = spawnSync(process.execPath, [worker], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_TASK_PATH: taskPath,
      CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
      CREATIVE_WORKER_WORKSPACE: workspace,
      CREATIVE_WORKER_ALLOWED_FILES: 'packages/app/creative-surface.mjs',
      CREATIVE_WORKER_SURFACE_ID: 'creative_surface',
      CREATIVE_WORKER_AGENT_ID: 'agent-repair',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_CORTEX_PACKET_PATH: packetPath,
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_LEDGER_PATH: ledgerPath,
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: '8000',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '2',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '2',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '2',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '1000',
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_MODEL: 'mock-model',
      CODEX_CREATIVE_SANDBOX: 'danger-full-access'
    }
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.ok, true);
  assert.equal(evidence.iterations.length, 2);
  assert.equal(evidence.externalVerification.rawFailureCount, 1);
  assert.equal(evidence.externalVerification.failureCount, 0);
  assert.equal(evidence.externalVerification.runs[0].results[0].ok, false);
  assert.equal(evidence.externalVerification.runs[1].results[0].ok, true);
});

test('codex creative worker targeted verification does not overmatch generic campaign alias', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-campaign-alias-'));
  const workspace = path.join(root, 'repo');
  write(path.join(workspace, 'packages', 'campaign-ops', 'routes', 'campaign-ops-api.mjs'), 'export function campaignOpsApiDelta() { return { kind: "initial" }; }\n');
  write(path.join(workspace, 'tests', 'campaign-briefs.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('unrelated campaign family verifier fails if run', () => { assert.equal(4, 3); });\n`);
  write(path.join(workspace, 'tests', 'campaign-ops.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { campaignOpsApiDelta } from '../packages/campaign-ops/routes/campaign-ops-api.mjs';\ntest('campaign ops target verifier passes', () => { assert.equal(campaignOpsApiDelta().kind, 'campaign_ops_delta'); });\n`);
  const taskPath = path.join(root, 'task.json');
  const evidencePath = path.join(root, 'evidence.json');
  const packetPath = path.join(root, 'cortex-packet.json');
  const ledgerPath = path.join(root, 'ledger.json');
  const mockCodex = path.join(root, 'mock-codex.mjs');
  write(taskPath, JSON.stringify({
    goal: 'Add campaign ops API product delta',
    acceptanceChecks: ['Verifier passes: node --test tests/campaign-briefs.test.mjs']
  }, null, 2));
  write(packetPath, JSON.stringify({
    schemaVersion: 'claw.cortex_creative_context_packet.v1',
    cortexRoute: 'test_campaign_ops_route',
    surface: { id: 'campaign_ops_api', goal: 'Add campaign ops API product behavior' },
    files: [{ path: 'packages/campaign-ops/routes/campaign-ops-api.mjs', role: 'product_target', exists: true }],
    budgetPolicy: { promptMode: 'compact' }
  }, null, 2));
  write(mockCodex, `#!/usr/bin/env node\nimport fs from 'node:fs';\nimport path from 'node:path';\nfs.writeFileSync(path.join(process.cwd(), 'packages/campaign-ops/routes/campaign-ops-api.mjs'), \`const campaignOpsDeltaKind = 'campaign_ops_delta';\nexport function campaignOpsApiDelta() { return { kind: campaignOpsDeltaKind, routed: true }; }\n\`);\nconsole.log('tokens used');\nconsole.log('1,234');\n`);
  fs.chmodSync(mockCodex, 0o755);
  const worker = path.resolve('apps/system-benchmark/codex-creative-worker.mjs');
  const spawned = spawnSync(process.execPath, [worker], {
    cwd: workspace,
    encoding: 'utf8',
    env: {
      ...process.env,
      CREATIVE_WORKER_TASK_PATH: taskPath,
      CREATIVE_WORKER_EVIDENCE_PATH: evidencePath,
      CREATIVE_WORKER_WORKSPACE: workspace,
      CREATIVE_WORKER_ALLOWED_FILES: 'packages/campaign-ops/routes/campaign-ops-api.mjs,tests/campaign-briefs.test.mjs,tests/campaign-ops.test.mjs',
      CREATIVE_WORKER_SURFACE_ID: 'campaign_ops_api',
      CREATIVE_WORKER_AGENT_ID: 'agent-campaign-alias',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_CORTEX_PACKET_PATH: packetPath,
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_LEDGER_PATH: ledgerPath,
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: '8000',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '1000',
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_MODEL: 'mock-model',
      CODEX_CREATIVE_SANDBOX: 'danger-full-access'
    }
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(evidence.ok, true);
  assert.deepEqual(evidence.externalVerification.effectiveCommands, ['node --test tests/campaign-ops.test.mjs']);
  assert.equal(evidence.externalVerification.runs[0].results[0].command, 'node --test tests/campaign-ops.test.mjs');
});

test('creative readiness rejects shared workspaces for creative product-work launches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-readiness-shared-workspace-reject-'));
  const contractPath = path.join(root, 'run_contract.json');
  const mockCodex = path.join(root, 'codex');
  write(mockCodex, '#!/usr/bin/env bash\necho mock codex\n');
  fs.chmodSync(mockCodex, 0o755);
  write(contractPath, JSON.stringify({
    benchmarkId: 'creative_shared_workspace_reject_probe',
    runId: 'creative-shared-workspace-reject-test',
    benchmarkTier: 'tier2_functional',
    benchmarkClass: 'real_worker_product_standard',
    fidelity: 'production_slice',
    executionBoundary: 'remote_execution_required',
    requestedAgentCount: 1,
    scope: {
      durationTargetMinutes: 10,
      productDiffMode: 'creative_product_work',
      creativeProductWork: {
        required: true,
        minIterations: 1,
        minWorkerRuntimeMs: 0,
        workerCommand: `node ${path.resolve('apps/system-benchmark/codex-creative-worker.mjs')}`
      },
      surfaces: [
        {
          id: 'shared_workspace_probe',
          lane: 'campaigns',
          goal: 'Probe workspace isolation readiness',
          productFiles: ['packages/app/domain-campaigns.mjs'],
          targetFiles: ['packages/app/domain-campaigns.mjs'],
          verification: ['node -e "console.log(JSON.stringify({ ok: true }))"']
        }
      ]
    }
  }, null, 2));

  const verifier = path.resolve('apps/system-benchmark/verify-creative-relaunch-readiness.mjs');
  const spawned = spawnSync(process.execPath, [verifier, contractPath], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      BENCHMARK_HOST_ROLE: 'execution_plane',
      LLM_METERING_MODE: 'api_token_metered',
      CREATIVE_WORKER_COMMAND: `node ${path.resolve('apps/system-benchmark/codex-creative-worker.mjs')}`,
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_SANDBOX: 'workspace-write',
      ORCHESTRATOR_WORKER_WORKSPACE_MODE: 'shared',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '1',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '100000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '40000',
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      ORCHESTRATOR_CONTEXT_GOVERNOR: '1',
      ORCHESTRATOR_CONTEXT_GOVERNOR_HARD_GATE: '1',
      ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS: '4000',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET: '4000',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET_MODE: 'hard',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE: '1',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      TRANSFER_BENCHMARK_MAX_RUNTIME_MS: '1800000',
      CODEX_CREATIVE_ITERATION_TIMEOUT_MS: '300000',
      CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS: '600000',
      CREATIVE_WORKER_COMMAND_TIMEOUT_MS: '1110000',
      ORCHESTRATOR_WORKER_TIMEOUT_MS: '1200000',
      MAILCHIMP_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE: '0'
    }
  });
  assert.equal(spawned.status, 1, spawned.stderr || spawned.stdout);
  const result = JSON.parse(spawned.stdout);
  assert.equal(result.checks.find((entry) => entry.id === 'creative_product_work_uses_isolated_worker_workspaces')?.ok, false);
});

test('creative readiness rejects game100 launches without retry and external-verifier timeout budget', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-readiness-game100-timeout-budget-'));
  const contractPath = path.join(root, 'run_contract.json');
  const mockCodex = path.join(root, 'codex');
  write(mockCodex, '#!/usr/bin/env bash\necho mock codex\n');
  fs.chmodSync(mockCodex, 0o755);
  const surfaces = Array.from({ length: 100 }, (_, index) => ({
    id: `game_surface_${index + 1}`,
    lane: 'gameplay',
    goal: `Game surface ${index + 1}`,
    productFiles: [`scripts/generated/game_surface_${index + 1}.gd`],
    targetFiles: [`scripts/generated/game_surface_${index + 1}.gd`],
    verification: ['node -e "console.log(JSON.stringify({ ok: true }))"']
  }));
  write(contractPath, JSON.stringify({
    benchmarkId: 'maplestory3d_100agent_readiness',
    runId: 'game100-timeout-budget-test',
    benchmarkTier: 'tier3_game_vertical_slice_100agent',
    benchmarkClass: 'greenfield_game_vertical_slice',
    fidelity: 'production_slice',
    executionBoundary: 'remote_execution_required',
    requestedAgentCount: 100,
    scope: {
      durationTargetMinutes: 240,
      productDiffMode: 'creative_product_work',
      creativeProductWork: {
        required: true,
        minIterations: 1,
        minWorkerRuntimeMs: 0,
        workerCommand: `node ${path.resolve('apps/system-benchmark/codex-creative-worker.mjs')}`,
        repairExternalVerificationFailures: true
      },
      surfaces
    }
  }, null, 2));

  const verifier = path.resolve('apps/system-benchmark/verify-creative-relaunch-readiness.mjs');
  const spawned = spawnSync(process.execPath, [verifier, contractPath], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      BENCHMARK_HOST_ROLE: 'execution_plane',
      LLM_METERING_MODE: 'api_token_metered',
      CREATIVE_WORKER_COMMAND: `node ${path.resolve('apps/system-benchmark/codex-creative-worker.mjs')}`,
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_SANDBOX: 'workspace-write',
      ORCHESTRATOR_WORKER_WORKSPACE_MODE: 'isolated_product_copy',
      ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS: 'tests',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '2',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '2',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '10',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '100',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '12000000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '40000',
      CREATIVE_WORKER_TOKEN_BUDGET_MODE: 'safety',
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: '16000',
      ORCHESTRATOR_CONTEXT_GOVERNOR: '1',
      ORCHESTRATOR_CONTEXT_GOVERNOR_HARD_GATE: '1',
      ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS: '5000',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET: '5000',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET_MODE: 'hard',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION_TIMEOUT_MS: '14700000',
      CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE: '0',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      TRANSFER_BENCHMARK_MAX_RUNTIME_MS: '20400000',
      CODEX_CREATIVE_ITERATION_TIMEOUT_MS: '300000',
      CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS: '14400000',
      CREATIVE_WORKER_COMMAND_TIMEOUT_MS: '15600000',
      ORCHESTRATOR_WORKER_TIMEOUT_MS: '18900000',
      CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0',
      GAME_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE: '14400000'
    }
  });
  assert.equal(spawned.status, 1, spawned.stderr || spawned.stdout);
  const result = JSON.parse(spawned.stdout);
  assert.equal(result.checks.find((entry) => entry.id === 'game100_retry_budget_global_calls')?.ok, false);
  assert.equal(result.checks.find((entry) => entry.id === 'creative_worker_command_timeout_tolerates_external_verification')?.ok, false);
});

test('creative readiness allows OAuth message-metered compact single-pass bundles with strict external verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-readiness-oauth-single-pass-'));
  const contractPath = path.join(root, 'run_contract.json');
  const mockCodex = path.join(root, 'codex');
  write(mockCodex, '#!/usr/bin/env bash\necho mock codex\n');
  fs.chmodSync(mockCodex, 0o755);
  write(contractPath, JSON.stringify({
    benchmarkId: 'mailchimp_token_conservation_100agent_pilot',
    runId: 'mailchimp-token-conservation-100agent-test',
    benchmarkTier: 'tier2_functional',
    benchmarkClass: 'real_repo_mailchimp_campaign_email_builder_creative_product_work_lowoverlap_rerun',
    fidelity: 'production_slice',
    executionBoundary: 'remote_execution_required',
    requestedAgentCount: 100,
    scope: {
      durationTargetMinutes: 10,
      productDiffMode: 'creative_product_work',
      creativeProductWork: {
        required: true,
        minIterations: 1,
        minWorkerRuntimeMs: 0,
        workerCommand: `node ${path.resolve('apps/system-benchmark/codex-creative-worker.mjs')}`
      },
      surfaces: [
        {
          id: 'campaign_index__oauth_bundle_probe',
          lane: 'campaigns',
          goal: 'Probe message-metered compact readiness',
          productFiles: ['packages/app/domain-campaigns.mjs'],
          targetFiles: ['packages/app/domain-campaigns.mjs']
        }
      ]
    }
  }, null, 2));

  const verifier = path.resolve('apps/system-benchmark/verify-creative-relaunch-readiness.mjs');
  const spawned = spawnSync(process.execPath, [verifier, contractPath], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      BENCHMARK_HOST_ROLE: 'execution_plane',
      LLM_METERING_MODE: 'oauth_message_metered',
      CREATIVE_WORKER_COMMAND: `node ${path.resolve('apps/system-benchmark/codex-creative-worker.mjs')}`,
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_SANDBOX: 'workspace-write',
      ORCHESTRATOR_WORKER_WORKSPACE_MODE: 'isolated_product_copy',
      ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS: 'tests',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '1',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '12',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '14',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '500000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '120000',
      CREATIVE_WORKER_TOKEN_BUDGET_MODE: 'safety',
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: '36000',
      ORCHESTRATOR_CONTEXT_GOVERNOR: '1',
      ORCHESTRATOR_CONTEXT_GOVERNOR_HARD_GATE: '1',
      ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS: '3200',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET: '3200',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET_MODE: 'hard',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '0',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE: '1',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      TRANSFER_BENCHMARK_MAX_RUNTIME_MS: '1800000',
      CODEX_CREATIVE_ITERATION_TIMEOUT_MS: '300000',
      CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS: '600000',
      CREATIVE_WORKER_COMMAND_TIMEOUT_MS: '1110000',
      ORCHESTRATOR_WORKER_TIMEOUT_MS: '1200000',
      CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0',
      MAILCHIMP_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE: '0'
    }
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const result = JSON.parse(spawned.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.checks.find((entry) => entry.id === 'compact_fallback_or_message_metered_single_pass')?.ok, true);
  assert.equal(result.checks.find((entry) => entry.id === 'oauth_single_pass_call_limit_bounded')?.ok, true);
  assert.equal(result.checks.find((entry) => entry.id === 'oauth_single_pass_global_calls_bounded')?.ok, true);
});

test('creative readiness allows bounded external-verification repair loop when explicitly configured', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-readiness-bounded-repair-loop-'));
  const contractPath = path.join(root, 'run_contract.json');
  const mockCodex = path.join(root, 'codex');
  write(mockCodex, '#!/usr/bin/env bash\necho mock codex\n');
  fs.chmodSync(mockCodex, 0o755);
  write(contractPath, JSON.stringify({
    benchmarkId: 'mailchimp_real_claim_repair_loop_probe',
    runId: 'mailchimp-real-claim-repair-loop-test',
    benchmarkTier: 'tier2_functional',
    benchmarkClass: 'real_repo_mailchimp_creative_product_work_repair_loop_probe',
    fidelity: 'production_slice',
    executionBoundary: 'remote_execution_required',
    requestedAgentCount: 1,
    scope: {
      durationTargetMinutes: 10,
      productDiffMode: 'creative_product_work',
      creativeProductWork: {
        required: true,
        minIterations: 1,
        minWorkerRuntimeMs: 0,
        workerCommand: `node ${path.resolve('apps/system-benchmark/codex-creative-worker.mjs')}`,
        repairExternalVerificationFailures: true
      },
      surfaces: [
        {
          id: 'campaign_index__repair_loop_probe',
          lane: 'campaigns',
          goal: 'Probe bounded verifier repair readiness',
          productFiles: ['packages/app/domain-campaigns.mjs'],
          targetFiles: ['packages/app/domain-campaigns.mjs']
        }
      ]
    }
  }, null, 2));

  const verifier = path.resolve('apps/system-benchmark/verify-creative-relaunch-readiness.mjs');
  const spawned = spawnSync(process.execPath, [verifier, contractPath], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      BENCHMARK_HOST_ROLE: 'execution_plane',
      LLM_METERING_MODE: 'oauth_message_metered',
      CREATIVE_WORKER_COMMAND: `node ${path.resolve('apps/system-benchmark/codex-creative-worker.mjs')}`,
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_SANDBOX: 'workspace-write',
      ORCHESTRATOR_WORKER_WORKSPACE_MODE: 'isolated_product_copy',
      ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS: 'tests',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '2',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '2',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '2',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '2',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '500000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '120000',
      CREATIVE_WORKER_TOKEN_BUDGET_MODE: 'safety',
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: '4000',
      ORCHESTRATOR_CONTEXT_GOVERNOR: '1',
      ORCHESTRATOR_CONTEXT_GOVERNOR_HARD_GATE: '1',
      ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS: '4000',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET: '4000',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET_MODE: 'hard',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE: '0',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      TRANSFER_BENCHMARK_MAX_RUNTIME_MS: '1800000',
      CODEX_CREATIVE_ITERATION_TIMEOUT_MS: '300000',
      CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS: '600000',
      CREATIVE_WORKER_COMMAND_TIMEOUT_MS: '1110000',
      ORCHESTRATOR_WORKER_TIMEOUT_MS: '1200000',
      CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0',
      MAILCHIMP_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE: '0'
    }
  });
  assert.equal(spawned.status, 0, spawned.stderr || spawned.stdout);
  const result = JSON.parse(spawned.stdout);
  assert.equal(result.ok, true);
  const repairCheck = result.checks.find((entry) => entry.id === 'compact_external_verification_fail_closed');
  assert.equal(repairCheck?.ok, true);
  assert.equal(repairCheck?.boundedExternalVerificationRepairLoop, true);
});

test('creative readiness rejects compact verifier repair loops that hide late surface verifiers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-readiness-verifier-cap-'));
  const contractPath = path.join(root, 'run_contract.json');
  const mockCodex = path.join(root, 'codex');
  write(mockCodex, '#!/usr/bin/env bash\necho mock codex\n');
  fs.chmodSync(mockCodex, 0o755);
  write(contractPath, JSON.stringify({
    benchmarkId: 'mailchimp_real_claim_verifier_cap_probe',
    runId: 'mailchimp-real-claim-verifier-cap-test',
    benchmarkTier: 'tier2_functional',
    benchmarkClass: 'real_repo_mailchimp_creative_product_work_repair_loop_probe',
    fidelity: 'production_slice',
    executionBoundary: 'remote_execution_required',
    requestedAgentCount: 1,
    scope: {
      durationTargetMinutes: 10,
      productDiffMode: 'creative_product_work',
      creativeProductWork: {
        required: true,
        minIterations: 1,
        minWorkerRuntimeMs: 0,
        workerCommand: `node ${path.resolve('apps/system-benchmark/codex-creative-worker.mjs')}`,
        repairExternalVerificationFailures: true
      },
      surfaces: [
        {
          id: 'audience',
          lane: 'audience',
          goal: 'Probe full targeted verifier visibility',
          productFiles: ['packages/app/domain-audience.mjs'],
          targetFiles: ['packages/app/domain-audience.mjs'],
          verification: [
            'node --test tests/audience-core.test.mjs',
            'node --test tests/audience-funnels.test.mjs',
            'node --test tests/audience-intelligence.test.mjs',
            'node --test tests/audience-warehouse-lifecycle.test.mjs'
          ]
        }
      ]
    }
  }, null, 2));

  const verifier = path.resolve('apps/system-benchmark/verify-creative-relaunch-readiness.mjs');
  const spawned = spawnSync(process.execPath, [verifier, contractPath], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
    env: {
      ...process.env,
      BENCHMARK_HOST_ROLE: 'execution_plane',
      LLM_METERING_MODE: 'oauth_message_metered',
      CREATIVE_WORKER_COMMAND: `node ${path.resolve('apps/system-benchmark/codex-creative-worker.mjs')}`,
      CODEX_BIN: mockCodex,
      CODEX_CREATIVE_SANDBOX: 'workspace-write',
      ORCHESTRATOR_WORKER_WORKSPACE_MODE: 'isolated_product_copy',
      ORCHESTRATOR_WORKER_WORKSPACE_COPY_PATHS: 'tests',
      CREATIVE_WORKER_CORTEX_REQUIRED: '1',
      CREATIVE_WORKER_BUDGET_REQUIRED: '1',
      CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
      CODEX_CREATIVE_MAX_ITERATIONS: '2',
      CREATIVE_WORKER_PER_WORKER_CODEX_CALL_LIMIT: '2',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '2',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '2',
      CREATIVE_WORKER_GLOBAL_TOKEN_LIMIT: '500000',
      CREATIVE_WORKER_TOKEN_RESERVATION_ESTIMATE: '120000',
      CREATIVE_WORKER_TOKEN_BUDGET_MODE: 'safety',
      CREATIVE_WORKER_PROMPT_MODE: 'compact',
      CREATIVE_WORKER_COMPACT_BRIEF_MAX_CHARS: '4000',
      ORCHESTRATOR_CONTEXT_GOVERNOR: '1',
      ORCHESTRATOR_CONTEXT_GOVERNOR_HARD_GATE: '1',
      ORCHESTRATOR_CONTEXT_GOVERNOR_MAX_WORKER_TOKENS: '4000',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET: '4000',
      CREATIVE_WORKER_PROMPT_TOKEN_BUDGET_MODE: 'hard',
      CREATIVE_WORKER_COMPACT_FAIL_CLOSED: '1',
      CREATIVE_WORKER_REQUIRE_REPAIR_SIGNAL_FOR_RETRY: '1',
      CREATIVE_WORKER_CODEX_RUN_TESTS: '0',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION: '1',
      CREATIVE_WORKER_STOP_ON_EXTERNAL_VERIFICATION_FAILURE: '0',
      CREATIVE_WORKER_TARGETED_EXTERNAL_VERIFICATION_ONLY: '1',
      CREATIVE_WORKER_EXTERNAL_VERIFICATION_MAX_COMMANDS: '3',
      TRANSFER_BENCHMARK_MAX_RUNTIME_MS: '1800000',
      CODEX_CREATIVE_ITERATION_TIMEOUT_MS: '300000',
      CREATIVE_WORKER_BUDGET_RESERVATION_TIMEOUT_MS: '600000',
      CREATIVE_WORKER_COMMAND_TIMEOUT_MS: '1110000',
      ORCHESTRATOR_WORKER_TIMEOUT_MS: '1200000',
      CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0',
      MAILCHIMP_BENCHMARK_SURFACE_MIN_DURATION_MS_OVERRIDE: '0'
    }
  });
  assert.equal(spawned.status, 1, spawned.stderr || spawned.stdout);
  const result = JSON.parse(spawned.stdout);
  const coverageCheck = result.checks.find((entry) => entry.id === 'compact_external_verification_covers_surface_verifiers');
  assert.equal(coverageCheck?.ok, false);
  assert.equal(coverageCheck?.externalVerificationMaxCommands, 3);
  assert.equal(coverageCheck?.maxSurfaceVerifierCommandCount, 4);
});
