import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkFoundrySnapshot, createBenchmarkFoundryDashboardRoutes, createBenchmarkFoundryApiRoutes, createBenchmarkFoundryOpsRoutes, createBenchmarkFoundryPublicRoutes, createBenchmarkFoundryRegistryRoutes, summarizeBenchmarkFoundryFixtures } from '../packages/benchmark-foundry/index.mjs';

test('benchmark-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkFoundryDashboardRoutes().length, 3);
  assert.equal(createBenchmarkFoundryApiRoutes().length, 4);
  assert.equal(createBenchmarkFoundryOpsRoutes().length, 3);
  assert.equal(createBenchmarkFoundryPublicRoutes().length, 3);
  assert.equal(createBenchmarkFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkFoundryFixtures().contacts, 2);
});

