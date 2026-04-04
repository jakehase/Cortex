import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkNavigatorSnapshot, createBenchmarkNavigatorDashboardRoutes, createBenchmarkNavigatorApiRoutes, createBenchmarkNavigatorOpsRoutes, createBenchmarkNavigatorPublicRoutes, createBenchmarkNavigatorRegistryRoutes, summarizeBenchmarkNavigatorFixtures } from '../packages/benchmark-navigator/index.mjs';

test('benchmark-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkNavigatorDashboardRoutes().length, 3);
  assert.equal(createBenchmarkNavigatorApiRoutes().length, 4);
  assert.equal(createBenchmarkNavigatorOpsRoutes().length, 3);
  assert.equal(createBenchmarkNavigatorPublicRoutes().length, 3);
  assert.equal(createBenchmarkNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkNavigatorFixtures().contacts, 2);
});

