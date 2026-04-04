import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsNavigatorSnapshot, createAnalyticsNavigatorDashboardRoutes, createAnalyticsNavigatorApiRoutes, createAnalyticsNavigatorOpsRoutes, createAnalyticsNavigatorPublicRoutes, createAnalyticsNavigatorRegistryRoutes, summarizeAnalyticsNavigatorFixtures } from '../packages/analytics-navigator/index.mjs';

test('analytics-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsNavigatorDashboardRoutes().length, 3);
  assert.equal(createAnalyticsNavigatorApiRoutes().length, 4);
  assert.equal(createAnalyticsNavigatorOpsRoutes().length, 3);
  assert.equal(createAnalyticsNavigatorPublicRoutes().length, 3);
  assert.equal(createAnalyticsNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsNavigatorFixtures().contacts, 2);
});

