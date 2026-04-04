import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkStudioSnapshot, createBenchmarkStudioDashboardRoutes, createBenchmarkStudioApiRoutes, createBenchmarkStudioOpsRoutes, createBenchmarkStudioPublicRoutes, summarizeBenchmarkStudioFixtures } from '../packages/benchmark-studio/index.mjs';

test('benchmark-studio package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildBenchmarkStudioSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkStudioDashboardRoutes().length, 3);
  assert.equal(createBenchmarkStudioApiRoutes().length, 3);
  assert.equal(createBenchmarkStudioOpsRoutes().length, 3);
  assert.equal(createBenchmarkStudioPublicRoutes().length, 3);
  assert.equal(summarizeBenchmarkStudioFixtures().contacts, 2);
});

