import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsHubSnapshot, createAnalyticsHubDashboardRoutes, createAnalyticsHubApiRoutes, createAnalyticsHubOpsRoutes, createAnalyticsHubPublicRoutes, createAnalyticsHubRegistryRoutes, summarizeAnalyticsHubFixtures } from '../packages/analytics-hub/index.mjs';

test('analytics-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsHubDashboardRoutes().length, 3);
  assert.equal(createAnalyticsHubApiRoutes().length, 4);
  assert.equal(createAnalyticsHubOpsRoutes().length, 3);
  assert.equal(createAnalyticsHubPublicRoutes().length, 3);
  assert.equal(createAnalyticsHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsHubFixtures().contacts, 2);
});

