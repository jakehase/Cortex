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
