import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsNavigatorSnapshot, createInsightsNavigatorDashboardRoutes, createInsightsNavigatorApiRoutes, createInsightsNavigatorOpsRoutes, createInsightsNavigatorPublicRoutes, createInsightsNavigatorRegistryRoutes, summarizeInsightsNavigatorFixtures } from '../packages/insights-navigator/index.mjs';

test('insights-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsNavigatorDashboardRoutes().length, 3);
  assert.equal(createInsightsNavigatorApiRoutes().length, 4);
  assert.equal(createInsightsNavigatorOpsRoutes().length, 3);
  assert.equal(createInsightsNavigatorPublicRoutes().length, 3);
  assert.equal(createInsightsNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsNavigatorFixtures().contacts, 2);
});

