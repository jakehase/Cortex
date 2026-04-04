import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkVaultSnapshot, createBenchmarkVaultDashboardRoutes, createBenchmarkVaultApiRoutes, createBenchmarkVaultOpsRoutes, createBenchmarkVaultPublicRoutes, createBenchmarkVaultRegistryRoutes, summarizeBenchmarkVaultFixtures } from '../packages/benchmark-vault/index.mjs';

test('benchmark-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkVaultDashboardRoutes().length, 3);
  assert.equal(createBenchmarkVaultApiRoutes().length, 4);
  assert.equal(createBenchmarkVaultOpsRoutes().length, 3);
  assert.equal(createBenchmarkVaultPublicRoutes().length, 3);
  assert.equal(createBenchmarkVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkVaultFixtures().contacts, 2);
});

