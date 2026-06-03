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
  const patchQueue = JSON.parse(fs.readFileSync(path.join(bootstrap.root, 'orchestrator_run', 'patch_queue.json'), 'utf8'));
  assert.equal(completion.mechanicalGreen, true);
  assert.equal(completion.scaleProofReady, true);
  assert.equal(completion.transferScore, 1);
  assert.equal(transferEvidence.requiresRealProductDiffs, true);
  assert.equal(transferEvidence.productiveSurfaceCount, 2);
  assert.equal(landingEvidence.summary.status, 'green');
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
  assert.match(fs.readFileSync(path.join(repo, 'packages/app/creative-surface.mjs'), 'utf8'), /creativeProductBehavior/);
});

test('codex creative worker compact mode uses bounded brief and external verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-creative-compact-'));
  const workspace = path.join(root, 'repo');
  write(path.join(workspace, 'packages', 'app', 'creative-surface.mjs'), 'export function describeCreativeSurface(input = {}) { return { ok: true, input }; }\n');
  write(path.join(workspace, 'tests', 'noisy-other.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('unrelated noisy verifier fails if it is run', () => { assert.equal(4, 3); });\n`);
  write(path.join(workspace, 'tests', 'creative-surface.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { compactProductDelta } from '../packages/app/creative-surface.mjs';\ntest('compact product delta works', () => { assert.equal(compactProductDelta({ id: 'demo' }).kind, 'compact_delta'); });\n`);
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
    files: [{ path: 'packages/app/creative-surface.mjs', role: 'product_target', exists: true }],
    runnableChecks: [],
    budgetPolicy: { promptMode: 'compact' }
  }, null, 2));
  write(mockCodex, `#!/usr/bin/env node\nimport fs from 'node:fs';\nimport path from 'node:path';\nconst prompt = process.argv.at(-1) || '';\nfs.writeFileSync(path.join(process.cwd(), '__last_prompt.txt'), prompt);\nfs.appendFileSync(path.join(process.cwd(), 'packages/app/creative-surface.mjs'), \`\nconst compactDeltaKind = 'compact_delta';\nexport function compactProductDelta(input = {}) { return { kind: compactDeltaKind, id: input.id || null, verified: true }; }\n\`);\nconsole.log('tokens used');\nconsole.log('1,234');\n`);
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
      CREATIVE_WORKER_ALLOWED_FILES: 'packages/app/creative-surface.mjs,tests/creative-surface.test.mjs,tests/noisy-other.test.mjs',
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
