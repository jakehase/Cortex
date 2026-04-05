import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkHubSnapshot, createBenchmarkHubDashboardRoutes, createBenchmarkHubApiRoutes, createBenchmarkHubOpsRoutes, createBenchmarkHubPublicRoutes, createBenchmarkHubRegistryRoutes, summarizeBenchmarkHubFixtures } from '../packages/benchmark-hub/index.mjs';

test('benchmark-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkHubDashboardRoutes().length, 3);
  assert.equal(createBenchmarkHubApiRoutes().length, 4);
  assert.equal(createBenchmarkHubOpsRoutes().length, 3);
  assert.equal(createBenchmarkHubPublicRoutes().length, 3);
  assert.equal(createBenchmarkHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkHubFixtures().contacts, 2);
});

