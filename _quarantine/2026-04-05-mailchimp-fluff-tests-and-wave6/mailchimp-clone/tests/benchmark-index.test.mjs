import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkIndexSnapshot, createBenchmarkIndexDashboardRoutes, createBenchmarkIndexApiRoutes, createBenchmarkIndexOpsRoutes, createBenchmarkIndexPublicRoutes, createBenchmarkIndexRegistryRoutes, summarizeBenchmarkIndexFixtures } from '../packages/benchmark-index/index.mjs';

test('benchmark-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkIndexDashboardRoutes().length, 3);
  assert.equal(createBenchmarkIndexApiRoutes().length, 4);
  assert.equal(createBenchmarkIndexOpsRoutes().length, 3);
  assert.equal(createBenchmarkIndexPublicRoutes().length, 3);
  assert.equal(createBenchmarkIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkIndexFixtures().contacts, 2);
});

