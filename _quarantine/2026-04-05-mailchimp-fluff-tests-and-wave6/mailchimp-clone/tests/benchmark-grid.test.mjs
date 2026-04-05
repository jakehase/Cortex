import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkGridSnapshot, createBenchmarkGridDashboardRoutes, createBenchmarkGridApiRoutes, createBenchmarkGridOpsRoutes, createBenchmarkGridPublicRoutes, createBenchmarkGridRegistryRoutes, summarizeBenchmarkGridFixtures } from '../packages/benchmark-grid/index.mjs';

test('benchmark-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkGridDashboardRoutes().length, 3);
  assert.equal(createBenchmarkGridApiRoutes().length, 4);
  assert.equal(createBenchmarkGridOpsRoutes().length, 3);
  assert.equal(createBenchmarkGridPublicRoutes().length, 3);
  assert.equal(createBenchmarkGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkGridFixtures().contacts, 2);
});

