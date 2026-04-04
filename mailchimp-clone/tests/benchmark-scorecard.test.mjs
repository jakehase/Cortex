import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkScorecardSnapshot, createBenchmarkScorecardDashboardRoutes, createBenchmarkScorecardApiRoutes, createBenchmarkScorecardOpsRoutes, createBenchmarkScorecardPublicRoutes, createBenchmarkScorecardRegistryRoutes, summarizeBenchmarkScorecardFixtures } from '../packages/benchmark-scorecard/index.mjs';

test('benchmark-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBenchmarkScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBenchmarkScorecardDashboardRoutes().length, 3);
  assert.equal(createBenchmarkScorecardApiRoutes().length, 4);
  assert.equal(createBenchmarkScorecardOpsRoutes().length, 3);
  assert.equal(createBenchmarkScorecardPublicRoutes().length, 3);
  assert.equal(createBenchmarkScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBenchmarkScorecardFixtures().contacts, 2);
});

