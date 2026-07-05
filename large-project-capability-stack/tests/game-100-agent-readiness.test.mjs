import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createBenchmarkRunContract, evaluateBenchmarkThresholds } from '../packages/system-benchmark/index.mjs';
import {
  buildGame100AgentReadinessSurfaces,
  GAME_100_AGENT_ADMISSION_GATES,
  GAME_100_AGENT_READINESS_LADDER,
  GAME_100_AGENT_REPAIR_LANE,
  GAME_100_AGENT_SCHEDULER_POLICY,
  GAME_100_AGENT_VERIFICATION_POLICY
} from '../apps/system-benchmark/game-100-agent-surfaces.mjs';

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function runNode(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    ...options
  });
}

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-100-readiness-repo-'));
  write(path.join(root, 'project.godot'), '; Engine configuration file\n[application]\nconfig/name="Game100Fixture"\n');
  write(path.join(root, 'scripts/player/movement_controller.gd'), 'extends Node\n\nvar speed := 220.0\n\nfunc move_axis(axis: float) -> float:\n\treturn axis * speed\n');
  write(path.join(root, 'assets/manifest.json'), JSON.stringify({ assets: [], generatedFor: 'game100-test' }, null, 2));
  return root;
}

function readinessContract({ repoPath, surfaces = null } = {}) {
  const verifierPath = path.join(process.cwd(), 'apps/system-benchmark/verify-godot-game-surface.mjs');
  return createBenchmarkRunContract({
    benchmarkId: 'maplestory3d_100agent_readiness',
    benchmarkTier: 'tier3_game_vertical_slice_100agent',
    benchmarkClass: 'greenfield_game_vertical_slice',
    fidelity: 'production_slice',
    repoPath,
    requestedAgentCount: 100,
    executionBoundary: 'remote_execution_required',
    stopCondition: 'supervisor_green_or_blocker_report',
    scope: {
      durationTargetMinutes: 240,
      stopCondition: 'supervisor_green_or_blocker_report',
      surfaceReliability: {
        enabled: true,
        mode: 'tolerant_surface_reliability',
        greenMinVerifiedProductiveRatio: 0.95,
        yellowMinVerifiedProductiveRatio: 0.90,
        perfectVerifiedProductiveSurfaces: 100,
        maxToleratedFailedSurfaces: 5,
        requireClassifiedFailures: true,
        systemicFailureFails: true
      },
      productDiffMode: 'creative_product_work',
      requireRealProductDiffs: true,
      creativeProductWork: { required: true, promptMode: 'compact', budgetRequired: true, requireBudgetLedger: true },
      contextGovernor: { enabled: true, hardGate: true, maxWorkerTokens: 3200 },
      workerWorkspace: { mode: 'isolated_product_copy', copyPaths: ['project.godot', 'scripts', 'scenes', 'ui', 'assets'] },
      schedulerPolicy: GAME_100_AGENT_SCHEDULER_POLICY,
      admissionGates: GAME_100_AGENT_ADMISSION_GATES,
      gameVerification: GAME_100_AGENT_VERIFICATION_POLICY,
      repairLane: GAME_100_AGENT_REPAIR_LANE,
      proofLadder: GAME_100_AGENT_READINESS_LADDER,
      surfaces: surfaces || buildGame100AgentReadinessSurfaces({ verifierScriptPath: verifierPath })
    },
    verifierSet: [{ kind: 'game_100agent_readiness_preflight', command: 'node apps/system-benchmark/verify-game-100agent-readiness.mjs <run_contract.json>' }]
  });
}

test('game 100-agent surface matrix has 100 unique low-overlap Godot product surfaces', () => {
  const surfaces = buildGame100AgentReadinessSurfaces({ verifierScriptPath: path.join(process.cwd(), 'apps/system-benchmark/verify-godot-game-surface.mjs') });
  assert.equal(surfaces.length, 100);
  assert.equal(new Set(surfaces.map((surface) => surface.id)).size, 100);
  const primaryFiles = surfaces.map((surface) => surface.ownership.primaryProductFile);
  assert.equal(new Set(primaryFiles).size, 100);
  assert.equal(surfaces.every((surface) => surface.ownership.exclusive === true), true);
  assert.equal(surfaces.every((surface) => surface.verification.length > 0), true);
  assert.ok(new Set(surfaces.map((surface) => surface.lane)).size >= 8);
});

test('tier3 game vertical slice 100-agent threshold requires scale, game gates, scheduler, admission, and repair convergence', () => {
  const pass = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier3_game_vertical_slice_100agent',
    metrics: {
      productiveIterationRate: 0.74,
      noOpRate: 0.06,
      repeatBlockerRate: 0.04,
      medianMinutesToMeaningfulProgress: 15,
      verificationIntegrity: 0.98,
      handoffEfficiency: 0.8,
      autonomyWindowMinutes: 250,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      surfaceReliabilityScore: 0.98,
      classifiedFailureIntegrity: 1,
      creativeWorkerEvidenceIntegrity: 0.9,
      creativeIterationIntegrity: 0.95,
      creativeProductDeltaIntegrity: 0.9,
      templateFallbackRate: 0,
      activeAgentScaleProof: 100,
      admissionGateIntegrity: 1,
      schedulerRecoveryIntegrity: 1,
      gameBuildGatePass: 1,
      gameSceneLoadGatePass: 1,
      gameInputCombatHarnessPass: 1,
      assetManifestGatePass: 1,
      repairLaneConverged: 1
    }
  });
  assert.equal(pass.ok, true);

  const fail = evaluateBenchmarkThresholds({
    benchmarkTier: 'tier3_game_vertical_slice_100agent',
    metrics: {
      ...Object.fromEntries(Object.keys(pass.thresholds).map((key) => [key, 1])),
      productiveIterationRate: 0.74,
      noOpRate: 0.06,
      repeatBlockerRate: 0.04,
      medianMinutesToMeaningfulProgress: 15,
      verificationIntegrity: 0.98,
      handoffEfficiency: 0.8,
      autonomyWindowMinutes: 250,
      truthIntegrityContradictions: 0,
      fakeGreenIncidents: 0,
      surfaceReliabilityScore: 1,
      classifiedFailureIntegrity: 1,
      creativeWorkerEvidenceIntegrity: 0.9,
      creativeIterationIntegrity: 0.95,
      creativeProductDeltaIntegrity: 0.9,
      templateFallbackRate: 0,
      activeAgentScaleProof: 50,
      gameBuildGatePass: 0,
      repairLaneConverged: 0
    }
  });
  assert.equal(fail.ok, false);
  assert.deepEqual(fail.failures.map((entry) => entry.metric), ['activeAgentScaleProof', 'gameBuildGatePass', 'repairLaneConverged']);
});

test('Godot game surface verifier validates assigned product file and asset manifest statically', () => {
  const repo = fixtureRepo();
  const result = runNode(path.join(process.cwd(), 'apps/system-benchmark/verify-godot-game-surface.mjs'), [
    '--repo-path', repo,
    '--surface', 'player_movement_controller',
    '--file', 'scripts/player/movement_controller.gd',
    '--kind', 'runtime_gameplay',
    '--lane', 'player_controller',
    '--check-asset-manifest'
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.checkKinds.includes('assigned_product_file_present'), true);
  assert.equal(payload.checkKinds.includes('asset_manifest_present'), true);
});

test('game 100-agent readiness verifier passes complete contract and fails undersized matrices', () => {
  const repo = fixtureRepo();
  const contract = readinessContract({ repoPath: repo });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-100-contract-'));
  const contractPath = path.join(root, 'run_contract.json');
  write(contractPath, JSON.stringify(contract, null, 2));

  const pass = runNode(path.join(process.cwd(), 'apps/system-benchmark/verify-game-100agent-readiness.mjs'), [contractPath]);
  assert.equal(pass.status, 0, pass.stderr || pass.stdout);
  const passPayload = JSON.parse(pass.stdout);
  assert.equal(passPayload.ok, true);
  assert.equal(passPayload.surfaceCount, 100);

  const undersized = readinessContract({ repoPath: repo, surfaces: contract.scope.surfaces.slice(0, 25) });
  const undersizedPath = path.join(root, 'undersized_contract.json');
  write(undersizedPath, JSON.stringify(undersized, null, 2));
  const fail = runNode(path.join(process.cwd(), 'apps/system-benchmark/verify-game-100agent-readiness.mjs'), [undersizedPath, '--contract-only']);
  assert.notEqual(fail.status, 0);
  const failPayload = JSON.parse(fail.stdout);
  assert.equal(failPayload.ok, false);
  assert.equal(failPayload.blockingFailures.some((entry) => entry.id === 'surface_matrix_has_100_surfaces'), true);
});

test('creative Godot worker can create a new assigned product file before deterministic target resolution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-100-creative-new-file-'));
  const workspace = path.join(root, 'repo');
  write(path.join(workspace, 'project.godot'), '; fixture\n');
  const resultPath = path.join(root, 'result.json');
  const logPath = path.join(root, 'worker.log');
  const fakeWorkerPath = path.join(root, 'fake-creative-worker.mjs');
  write(fakeWorkerPath, `
import fs from 'node:fs';
import path from 'node:path';
const workspace = process.env.CREATIVE_WORKER_WORKSPACE;
const file = process.env.CREATIVE_WORKER_ALLOWED_FILES.split(',')[0];
fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
fs.writeFileSync(path.join(workspace, file), 'extends Node\\n\\nfunc created_by_agent() -> bool:\\n\\treturn true\\n');
fs.writeFileSync(process.env.CREATIVE_WORKER_EVIDENCE_PATH, JSON.stringify({
  summary: 'Created the assigned Godot gameplay file.',
  iterations: [{ step: 'edit', outcome: 'created assigned file' }],
  productDecisions: ['Use a small Godot script surface for the new system.'],
  filesChanged: [file],
  testsRun: [{ command: 'not run in fixture', ok: true }],
  risks: []
}, null, 2));
`);
  const assignmentPath = path.join(root, 'assignment.json');
  write(assignmentPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    workspacePath: workspace,
    resultPath,
    logPath,
    agentId: 'agent-new-file',
    executionMode: 'creative',
    verifierScriptPath: path.join(process.cwd(), 'apps/system-benchmark/verify-godot-game-surface.mjs'),
    lease: { leaseId: 'lease-new-file', attempt: 1 },
    shard: {
      id: 'player_new_combo_surface',
      title: 'Create new combo gameplay script',
      allowedFiles: ['scripts/player/new_combo_surface.gd'],
      fileAreas: ['scripts/player/new_combo_surface.gd'],
      requiredVerifiers: [],
      metadata: {
        surfaceId: 'player_new_combo_surface',
        productDiffMode: 'creative_product_work',
        creativeProductWorkRequired: true
      }
    },
    contextPack: {
      inputs: {
        productDiffMode: 'creative_product_work',
        creativeProductWork: { required: true, minIterations: 1 }
      },
      guardrails: { allowedFiles: ['scripts/player/new_combo_surface.gd'] },
      acceptanceChecks: []
    }
  }, null, 2));

  const result = runNode(path.join(process.cwd(), 'apps/system-benchmark/live-transfer-worker.mjs'), ['--assignment', assignmentPath], {
    env: {
      ...process.env,
      CREATIVE_WORKER_COMMAND: `${process.execPath} ${fakeWorkerPath}`,
      CREATIVE_WORKER_MIN_ITERATIONS_OVERRIDE: '1',
      CREATIVE_WORKER_MIN_RUNTIME_MS_OVERRIDE: '0',
      CODEX_CREATIVE_MAX_ITERATIONS: '1',
      CREATIVE_WORKER_CORTEX_REQUIRED: '0'
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(payload.ok, true);
  assert.equal(payload.implementation.metadata.benchmarkMode, 'creative_product_work');
  assert.deepEqual(payload.implementation.modifiedFiles, ['scripts/player/new_combo_surface.gd']);
  assert.match(fs.readFileSync(path.join(workspace, 'scripts/player/new_combo_surface.gd'), 'utf8'), /created_by_agent/);
});
