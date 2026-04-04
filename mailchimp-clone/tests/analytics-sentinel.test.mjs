import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsSentinelSnapshot, createAnalyticsSentinelDashboardRoutes, createAnalyticsSentinelApiRoutes, createAnalyticsSentinelOpsRoutes, createAnalyticsSentinelPublicRoutes, createAnalyticsSentinelRegistryRoutes, summarizeAnalyticsSentinelFixtures } from '../packages/analytics-sentinel/index.mjs';

test('analytics-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsSentinelDashboardRoutes().length, 3);
  assert.equal(createAnalyticsSentinelApiRoutes().length, 4);
  assert.equal(createAnalyticsSentinelOpsRoutes().length, 3);
  assert.equal(createAnalyticsSentinelPublicRoutes().length, 3);
  assert.equal(createAnalyticsSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsSentinelFixtures().contacts, 2);
});

