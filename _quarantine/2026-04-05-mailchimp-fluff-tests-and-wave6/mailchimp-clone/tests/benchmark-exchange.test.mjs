import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkExchangeSnapshot, createBenchmarkExchangeDashboardRoutes, createBenchmarkExchangeApiRoutes, createBenchmarkExchangeOpsRoutes, createBenchmarkExchangePublicRoutes, createBenchmarkExchangeRegistryRoutes, summarizeBenchmarkExchangeFixtures } from '../packages/benchmark-exchange/index.mjs';

test('benchmark-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkExchangeDashboardRoutes().length, 3);
  assert.equal(createBenchmarkExchangeApiRoutes().length, 4);
  assert.equal(createBenchmarkExchangeOpsRoutes().length, 3);
  assert.equal(createBenchmarkExchangePublicRoutes().length, 3);
  assert.equal(createBenchmarkExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkExchangeFixtures().contacts, 2);
});

