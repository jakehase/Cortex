import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bindObjectiveContract, buildInventory, computeParity, writeParityArtifacts } from '../packages/full-parity-engine/index.mjs';

const objective = {
  anchor: 'Jake requested parity for the declared fixture', targetPath: '/tmp/target', fidelity: 'production_slice',
  scope: ['accounts', 'campaigns'], implementationSurface: 'product code', stopCondition: 'parity_matrix_green_or_gap_inventory',
  doneWhen: ['all required surfaces are observed and independently verified']
};

test('objective binder rejects ambiguous contracts and accepts grounded contracts', () => {
  assert.equal(bindObjectiveContract({}).ok, false);
  assert.equal(bindObjectiveContract(objective).ok, true);
});

test('negative space produces work and blocks parity claims', () => {
  const referenceInventory = buildInventory({ source: 'reference', surfaces: [
    { id: 'accounts', files: ['src/accounts.mjs'], verifiers: ['accounts_test'] },
    { id: 'campaigns', files: ['src/campaigns.mjs'], verifiers: ['campaigns_test'] }
  ] });
  const implementationInventory = buildInventory({ source: 'implementation', surfaces: [
    { id: 'accounts', evidence: ['src/accounts.mjs'], verifiers: ['accounts_test'] }
  ] });
  const result = computeParity({ objective, referenceInventory, implementationInventory, verifierResults: { accounts_test: { status: 'passed', evidence: ['tests/accounts.test.mjs'] } } });
  assert.equal(result.parityMatrix.missingCount, 1);
  assert.deepEqual(result.supervisorTruth.missingSurfaceIds, ['campaigns']);
  assert.equal(result.workGraph.taskCount, 1);
  assert.equal(result.claimPacket.rejectedClaims.includes('full_clone'), true);
});

test('green matrix requires observed evidence and passing independent verifiers', () => {
  const surfaces = [{ id: 'accounts', files: ['src/accounts.mjs'], verifiers: ['accounts_test'] }];
  const result = computeParity({
    objective,
    referenceInventory: buildInventory({ source: 'reference', surfaces }),
    implementationInventory: buildInventory({ source: 'implementation', surfaces: [{ ...surfaces[0], evidence: ['src/accounts.mjs'] }] }),
    verifierResults: { accounts_test: { status: 'passed', evidence: ['tests/accounts.test.mjs'] } }
  });
  assert.equal(result.supervisorTruth.parityGreen, true);
  assert.equal(result.claimPacket.allowedClaims.includes('parity_for_declared_scope'), true);
});

test('CLI writes the complete replay contract', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpe-'));
  const objectivePath = path.join(temp, 'objective.json');
  const referencePath = path.join(temp, 'reference.json');
  const implementationPath = path.join(temp, 'implementation.json');
  const verifiersPath = path.join(temp, 'verifiers.json');
  fs.writeFileSync(objectivePath, JSON.stringify(objective));
  fs.writeFileSync(referencePath, JSON.stringify({ source: 'reference', surfaces: [{ id: 'accounts', verifiers: ['accounts_test'] }] }));
  fs.writeFileSync(implementationPath, JSON.stringify({ source: 'implementation', surfaces: [] }));
  fs.writeFileSync(verifiersPath, JSON.stringify({ accounts_test: { status: 'passed', evidence: ['tests/accounts.test.mjs'] } }));
  const run = spawnSync(process.execPath, ['apps/system-benchmark/full-parity-engine-dry-run.mjs', '--objective', objectivePath, '--reference', referencePath, '--implementation', implementationPath, '--verifiers', verifiersPath, '--out', path.join(temp, 'out')], { cwd: path.resolve(new URL('..', import.meta.url).pathname), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).parityGreen, false);
  for (const file of ['objective_contract.json', 'negative_space_inventory.json', 'parity_matrix.json', 'verifier_matrix.json', 'work_graph.json', 'supervisor_truth.json', 'claim_packet.json', 'artifact_manifest.json']) {
    assert.equal(fs.existsSync(path.join(temp, 'out', file)), true, file);
  }
});

test('CLI can produce a verifier-backed green result for a fully observed fixture', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpe-green-'));
  for (const [name, value] of Object.entries({
    'objective.json': objective,
    'reference.json': { source: 'reference', surfaces: [{ id: 'accounts', verifiers: ['accounts_test'] }] },
    'implementation.json': { source: 'implementation', surfaces: [{ id: 'accounts', evidence: ['src/accounts.mjs'], verifiers: ['accounts_test'] }] },
    'verifiers.json': { accounts_test: { status: 'passed', evidence: ['tests/accounts.test.mjs'] } }
  })) fs.writeFileSync(path.join(temp, name), JSON.stringify(value));
  const run = spawnSync(process.execPath, [
    'apps/system-benchmark/full-parity-engine-dry-run.mjs',
    '--objective', path.join(temp, 'objective.json'), '--reference', path.join(temp, 'reference.json'),
    '--implementation', path.join(temp, 'implementation.json'), '--verifiers', path.join(temp, 'verifiers.json'),
    '--out', path.join(temp, 'out')
  ], { cwd: path.resolve(new URL('..', import.meta.url).pathname), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const summary = JSON.parse(run.stdout);
  assert.equal(summary.parityGreen, true);
  assert.equal(summary.claimStatus, 'allowed_for_fidelity');
});
