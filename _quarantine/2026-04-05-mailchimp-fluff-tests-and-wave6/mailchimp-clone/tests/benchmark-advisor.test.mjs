import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkAdvisorSnapshot, createBenchmarkAdvisorDashboardRoutes, createBenchmarkAdvisorApiRoutes, createBenchmarkAdvisorOpsRoutes, createBenchmarkAdvisorPublicRoutes, createBenchmarkAdvisorRegistryRoutes, summarizeBenchmarkAdvisorFixtures } from '../packages/benchmark-advisor/index.mjs';

test('benchmark-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkAdvisorDashboardRoutes().length, 3);
  assert.equal(createBenchmarkAdvisorApiRoutes().length, 4);
  assert.equal(createBenchmarkAdvisorOpsRoutes().length, 3);
  assert.equal(createBenchmarkAdvisorPublicRoutes().length, 3);
  assert.equal(createBenchmarkAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkAdvisorFixtures().contacts, 2);
});

