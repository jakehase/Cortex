import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkWatchtowerSnapshot, createBenchmarkWatchtowerDashboardRoutes, createBenchmarkWatchtowerApiRoutes, createBenchmarkWatchtowerOpsRoutes, createBenchmarkWatchtowerPublicRoutes, createBenchmarkWatchtowerRegistryRoutes, summarizeBenchmarkWatchtowerFixtures } from '../packages/benchmark-watchtower/index.mjs';

test('benchmark-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkWatchtowerDashboardRoutes().length, 3);
  assert.equal(createBenchmarkWatchtowerApiRoutes().length, 4);
  assert.equal(createBenchmarkWatchtowerOpsRoutes().length, 3);
  assert.equal(createBenchmarkWatchtowerPublicRoutes().length, 3);
  assert.equal(createBenchmarkWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkWatchtowerFixtures().contacts, 2);
});

