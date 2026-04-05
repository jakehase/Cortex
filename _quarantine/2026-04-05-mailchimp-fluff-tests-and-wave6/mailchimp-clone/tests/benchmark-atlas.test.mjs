import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkAtlasSnapshot, createBenchmarkAtlasDashboardRoutes, createBenchmarkAtlasApiRoutes, createBenchmarkAtlasOpsRoutes, createBenchmarkAtlasPublicRoutes, createBenchmarkAtlasRegistryRoutes, summarizeBenchmarkAtlasFixtures } from '../packages/benchmark-atlas/index.mjs';

test('benchmark-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkAtlasDashboardRoutes().length, 3);
  assert.equal(createBenchmarkAtlasApiRoutes().length, 4);
  assert.equal(createBenchmarkAtlasOpsRoutes().length, 3);
  assert.equal(createBenchmarkAtlasPublicRoutes().length, 3);
  assert.equal(createBenchmarkAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkAtlasFixtures().contacts, 2);
});

