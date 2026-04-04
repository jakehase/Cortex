import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkSentinelSnapshot, createBenchmarkSentinelDashboardRoutes, createBenchmarkSentinelApiRoutes, createBenchmarkSentinelOpsRoutes, createBenchmarkSentinelPublicRoutes, createBenchmarkSentinelRegistryRoutes, summarizeBenchmarkSentinelFixtures } from '../packages/benchmark-sentinel/index.mjs';

test('benchmark-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkSentinelDashboardRoutes().length, 3);
  assert.equal(createBenchmarkSentinelApiRoutes().length, 4);
  assert.equal(createBenchmarkSentinelOpsRoutes().length, 3);
  assert.equal(createBenchmarkSentinelPublicRoutes().length, 3);
  assert.equal(createBenchmarkSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkSentinelFixtures().contacts, 2);
});

