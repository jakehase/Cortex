import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildCortexCodexBoundary, inferWorkerRuntimeKind } from '../apps/system-benchmark/cortex-codex-boundary.mjs';
import { defaultCortexCodexCognitionBoundary } from '../packages/system-benchmark/index.mjs';

test('Cortex/Codex boundary labels wrapper execution without changing behavior', () => {
  const boundary = buildCortexCodexBoundary({
    env: {
      CREATIVE_WORKER_CORTEX_REQUIRED: 'true',
      CREATIVE_WORKER_BUDGET_REQUIRED: 'true',
      CREATIVE_WORKER_GLOBAL_CODEX_CALL_LIMIT: '10',
      CREATIVE_WORKER_MAX_ACTIVE_CODEX_CALLS: '2'
    },
    cortexPacket: { cortexRoute: 'L24_nexus+L27_forge', source: 'test_packet' },
    workerCommand: 'node /repo/apps/system-benchmark/codex-creative-worker.mjs',
    budgetLedgerPath: '/tmp/creative-worker-budget-ledger.json',
    codexBin: '/home/jake/.local/bin/codex',
    codexModel: 'gpt-5.5',
    codexSandbox: 'danger-full-access',
    promptMode: 'compact',
    meteringPlan: { mode: 'oauth_message_metered', tokenBudgetMode: 'safety' }
  });

  assert.equal(boundary.schemaVersion, 'claw.cortex_codex_boundary.v1');
  assert.equal(boundary.behaviorChanging, false);
  assert.equal(boundary.claimLabel, 'cortex_context_governed_codex_product_worker');
  assert.equal(boundary.cortex.role, 'control_plane_context_routing_memory_truth_supervision');
  assert.equal(boundary.codex.role, 'execution_plane_cli_model_worker');
  assert.equal(boundary.codex.workerRuntimeKind, 'codex_cli_via_creative_wrapper');
  assert.equal(boundary.governors.budgetRequired, true);
  assert.equal(boundary.warnings.length, 0);
});

test('Cortex/Codex boundary distinguishes raw Codex from wrapped product worker', () => {
  assert.equal(inferWorkerRuntimeKind('/home/jake/.local/bin/codex exec --model gpt-5.5'), 'raw_codex_cli');
  const boundary = buildCortexCodexBoundary({
    env: {},
    workerCommand: '/home/jake/.local/bin/codex exec --model gpt-5.5'
  });
  assert.equal(boundary.claimLabel, 'raw_codex_cli_execution');
  assert.equal(boundary.warnings.includes('raw_codex_cli_has_no_creative_wrapper_boundary'), true);
});

test('default run-contract boundary is non-behavior-changing metadata', () => {
  const boundary = defaultCortexCodexCognitionBoundary();
  assert.equal(boundary.behaviorChanging, false);
  assert.equal(boundary.requiredForCreativeWorkers, true);
  assert.equal(boundary.budgetGovernorsMustRemainEnabled, true);
});

test('Cortex ops dashboard is read-only JSON even when Cortex endpoint is unavailable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ops-dashboard-'));
  fs.writeFileSync(path.join(root, 'prompt-history.json'), '[]\n');
  fs.writeFileSync(path.join(root, 'prompt-fingerprints.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'last-good-plan.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'adaptive-routing-stats.json'), JSON.stringify({ updatedAt: new Date().toISOString(), byLevel: { 2: { uses: 1 } } }, null, 2));

  const result = spawnSync(process.execPath, [
    path.join(process.cwd(), 'apps/system-benchmark/cortex-ops-health-dashboard.mjs'),
    '--route-gate-dir', root,
    '--cortex-url', 'http://127.0.0.1:9'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'claw.cortex_ops_health_dashboard.v1');
  assert.equal(payload.behaviorChanging, false);
  assert.equal(payload.routeGate.dir, root);
  assert.equal(payload.checks.some((entry) => entry.id === 'dashboard_non_behavior_changing'), true);
});
