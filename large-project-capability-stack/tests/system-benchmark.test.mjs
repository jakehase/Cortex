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
  resolveBenchmarkMaxRuntimeMs
} from '../packages/system-benchmark/index.mjs';
import {
  buildShardPlan,
  compileSupervisorSnapshot,
  createArtifactBus,
  createLeaseState,
  createPatchQueue
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
  const scoreboard = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'benchmarks', 'scoreboard.json'), 'utf8'));
  assert.equal(completion.thresholdPass, false);
  assert.equal(completion.supervisorConfirmedCompletion, true);
  assert.equal(completion.mechanicalGreen, true);
  assert.equal(completion.scaleProofReady, true);
  assert.equal(Array.isArray(completion.thresholdFailures), true);
  assert.equal(completion.thresholdFailures.some((entry) => entry.metric === 'autonomyWindowMinutes'), true);
  assert.equal(completion.blocker.durationTarget.durationTargetMinutes, 15);
  assert.equal(completion.blocker.durationTarget.endedBeforeDurationTarget, true);
  assert.equal(completion.transferScore, 0);
  assert.match(completion.note, /below the contract duration target/i);
  assert.equal(matrix.surfaces.every((surface) => surface.status === 'verified'), true);
  assert.equal(transferEvidence.requiresRealProductDiffs, true);
  assert.equal(transferEvidence.verificationScore, 1);
  assert.equal(transferEvidence.transferScore, 0);
  assert.equal(transferEvidence.verifiedSurfaceCount, 2);
  assert.equal(transferEvidence.productiveSurfaceCount, 0);
  assert.equal(scoreboard.rows[0].pass, false);
  assert.equal(scoreboard.rows[0].productiveIterationRate, 0);
  assert.equal(scoreboard.rows[0].noOpRate, 1);
  assert.equal(scoreboard.rows[0].transferScore, 0);
  assert.equal(scoreboard.rows[0].blockerFamily, 'benchmark_thresholds_unmet');
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
