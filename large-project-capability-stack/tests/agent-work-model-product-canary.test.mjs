import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('model product canary generator writes failing fixture and creative product-diff contract', () => {
  const stackRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-model-canary-'));
  const outDir = path.join(temp, 'canary');
  const fixtureRoot = path.join(temp, 'fixture');
  const artifactRoot = path.join(temp, 'run');
  const generated = spawnSync(process.execPath, [
    path.join(stackRoot, 'apps/system-benchmark/create-agent-work-model-product-canary.mjs'),
    '--out', outDir,
    '--fixture-root', fixtureRoot,
    '--artifact-root', artifactRoot,
    '--run-id', 'model-canary-test',
    '--execution-boundary', 'remote_execution_required',
    '--worker-command', 'node apps/system-benchmark/codex-creative-worker.mjs'
  ], { cwd: stackRoot, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  const payload = JSON.parse(generated.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.benchmarkTier, 'execution_smoke');
  assert.equal(payload.productDiffMode, 'creative_product_work');
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'packages/canary/index.mjs')), true);
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'tests/canary.test.mjs')), true);

  const initialSource = fs.readFileSync(path.join(fixtureRoot, 'packages/canary/index.mjs'), 'utf8');
  const verifierSource = fs.readFileSync(path.join(fixtureRoot, 'tests/canary.test.mjs'), 'utf8');
  assert.match(initialSource, /ok: false/);
  assert.match(initialSource, /verified: false/);
  assert.match(verifierSource, /ok: true/);
  assert.match(verifierSource, /implementedBy: 'model-worker'/);

  const contract = JSON.parse(fs.readFileSync(path.join(outDir, 'compiled/run_contract.json'), 'utf8'));
  assert.equal(contract.runId, 'model-canary-test');
  assert.equal(contract.executionBoundary, 'remote_execution_required');
  assert.equal(contract.scope.productDiffMode, 'creative_product_work');
  assert.equal(contract.scope.requireRealProductDiffs, true);
  assert.equal(contract.scope.creativeProductWork.required, true);
  assert.equal(contract.scope.creativeProductWork.workerCommand, 'node apps/system-benchmark/codex-creative-worker.mjs');
  assert.equal(contract.scope.canonicalLandingEvidence.enabled, true);
  assert.equal(contract.scope.durationTargetMinutes, null);
});

test('model scale canary generator writes multi-surface short and official-endurance contracts', () => {
  const stackRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-work-model-scale-canary-'));

  const shortOut = path.join(temp, 'short');
  const shortFixture = path.join(temp, 'short-fixture');
  const shortRun = path.join(temp, 'short-run');
  const short = spawnSync(process.execPath, [
    path.join(stackRoot, 'apps/system-benchmark/create-agent-work-model-scale-canary.mjs'),
    '--out', shortOut,
    '--fixture-root', shortFixture,
    '--artifact-root', shortRun,
    '--run-id', 'scale-short-test',
    '--surface-count', '3',
    '--worker-command', 'node apps/system-benchmark/codex-creative-worker.mjs'
  ], { cwd: stackRoot, encoding: 'utf8' });
  assert.equal(short.status, 0, short.stderr || short.stdout);
  const shortPayload = JSON.parse(short.stdout);
  assert.equal(shortPayload.mode, 'short');
  assert.equal(shortPayload.surfaceCount, 3);
  assert.equal(shortPayload.benchmarkTier, 'execution_smoke');
  assert.equal(fs.existsSync(path.join(shortFixture, 'packages/canary-03/index.mjs')), true);
  const shortContract = JSON.parse(fs.readFileSync(path.join(shortOut, 'compiled/run_contract.json'), 'utf8'));
  assert.equal(shortContract.requestedAgentCount, 3);
  assert.equal(shortContract.scope.surfaces.length, 3);
  assert.equal(shortContract.scope.surfaces[0].verification[0], 'node --test tests/canary-01.test.mjs');
  assert.equal(shortContract.scope.durationTargetMinutes, null);
  assert.equal(shortContract.scope.creativeProductWork.officialVerifierOnly, false);
  assert.equal(shortContract.scope.wavePolicy.max_waves, 1);

  const enduranceOut = path.join(temp, 'endurance');
  const enduranceFixture = path.join(temp, 'endurance-fixture');
  const enduranceRun = path.join(temp, 'endurance-run');
  const endurance = spawnSync(process.execPath, [
    path.join(stackRoot, 'apps/system-benchmark/create-agent-work-model-scale-canary.mjs'),
    '--out', enduranceOut,
    '--fixture-root', enduranceFixture,
    '--artifact-root', enduranceRun,
    '--run-id', 'scale-endurance-test',
    '--surface-count', '2',
    '--mode', 'official_endurance',
    '--endurance-minutes', '30',
    '--worker-command', 'node apps/system-benchmark/codex-creative-worker.mjs'
  ], { cwd: stackRoot, encoding: 'utf8' });
  assert.equal(endurance.status, 0, endurance.stderr || endurance.stdout);
  const endurancePayload = JSON.parse(endurance.stdout);
  assert.equal(endurancePayload.mode, 'official_endurance');
  assert.equal(endurancePayload.benchmarkTier, 'tier1_creative_product_30m');
  assert.equal(endurancePayload.officialVerifierOnly, true);
  const enduranceContract = JSON.parse(fs.readFileSync(path.join(enduranceOut, 'compiled/run_contract.json'), 'utf8'));
  const enduranceMeta = JSON.parse(fs.readFileSync(path.join(enduranceOut, 'canary_meta.json'), 'utf8'));
  assert.equal(enduranceContract.requestedAgentCount, 2);
  assert.equal(enduranceContract.scope.durationTargetMinutes, 30);
  assert.equal(enduranceContract.scope.creativeProductWork.officialVerifierOnly, true);
  assert.equal(enduranceContract.scope.creativeProductWork.externalVerification, false);
  assert.match(enduranceContract.scope.surfaces[0].verification[0], /CANARY_ENDURANCE_MS=1800000/);
  assert.match(enduranceContract.scope.surfaces[0].verification[0], /PMHNP_BENCHMARK_SCENARIO_MIN_DURATION_MS=1800000/);
  assert.equal(enduranceMeta.recommendedRuntimeEnv.CREATIVE_WORKER_EXTERNAL_VERIFICATION, '0');
  assert.match(enduranceMeta.truthBoundary, /Official verifier commands are the endurance source of truth/);
});
