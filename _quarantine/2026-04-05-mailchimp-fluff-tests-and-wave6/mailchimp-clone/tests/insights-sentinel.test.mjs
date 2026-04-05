import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsSentinelSnapshot, createInsightsSentinelDashboardRoutes, createInsightsSentinelApiRoutes, createInsightsSentinelOpsRoutes, createInsightsSentinelPublicRoutes, createInsightsSentinelRegistryRoutes, summarizeInsightsSentinelFixtures } from '../packages/insights-sentinel/index.mjs';

test('insights-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsSentinelDashboardRoutes().length, 3);
  assert.equal(createInsightsSentinelApiRoutes().length, 4);
  assert.equal(createInsightsSentinelOpsRoutes().length, 3);
  assert.equal(createInsightsSentinelPublicRoutes().length, 3);
  assert.equal(createInsightsSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsSentinelFixtures().contacts, 2);
});

