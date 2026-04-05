import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsHubSnapshot, createInsightsHubDashboardRoutes, createInsightsHubApiRoutes, createInsightsHubOpsRoutes, createInsightsHubPublicRoutes, createInsightsHubRegistryRoutes, summarizeInsightsHubFixtures } from '../packages/insights-hub/index.mjs';

test('insights-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsHubDashboardRoutes().length, 3);
  assert.equal(createInsightsHubApiRoutes().length, 4);
  assert.equal(createInsightsHubOpsRoutes().length, 3);
  assert.equal(createInsightsHubPublicRoutes().length, 3);
  assert.equal(createInsightsHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsHubFixtures().contacts, 2);
});

