import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkCockpitSnapshot, createBenchmarkCockpitDashboardRoutes, createBenchmarkCockpitApiRoutes, createBenchmarkCockpitOpsRoutes, createBenchmarkCockpitPublicRoutes, createBenchmarkCockpitRegistryRoutes, summarizeBenchmarkCockpitFixtures } from '../packages/benchmark-cockpit/index.mjs';

test('benchmark-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkCockpitDashboardRoutes().length, 3);
  assert.equal(createBenchmarkCockpitApiRoutes().length, 4);
  assert.equal(createBenchmarkCockpitOpsRoutes().length, 3);
  assert.equal(createBenchmarkCockpitPublicRoutes().length, 3);
  assert.equal(createBenchmarkCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkCockpitFixtures().contacts, 2);
});

