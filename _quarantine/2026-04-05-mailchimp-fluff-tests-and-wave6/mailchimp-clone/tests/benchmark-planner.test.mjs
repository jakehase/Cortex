import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkPlannerSnapshot, createBenchmarkPlannerDashboardRoutes, createBenchmarkPlannerApiRoutes, createBenchmarkPlannerOpsRoutes, createBenchmarkPlannerPublicRoutes, createBenchmarkPlannerRegistryRoutes, summarizeBenchmarkPlannerFixtures } from '../packages/benchmark-planner/index.mjs';

test('benchmark-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkPlannerDashboardRoutes().length, 3);
  assert.equal(createBenchmarkPlannerApiRoutes().length, 4);
  assert.equal(createBenchmarkPlannerOpsRoutes().length, 3);
  assert.equal(createBenchmarkPlannerPublicRoutes().length, 3);
  assert.equal(createBenchmarkPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkPlannerFixtures().contacts, 2);
});

