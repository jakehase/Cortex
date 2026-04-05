import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsWatchtowerSnapshot, createInsightsWatchtowerDashboardRoutes, createInsightsWatchtowerApiRoutes, createInsightsWatchtowerOpsRoutes, createInsightsWatchtowerPublicRoutes, createInsightsWatchtowerRegistryRoutes, summarizeInsightsWatchtowerFixtures } from '../packages/insights-watchtower/index.mjs';

test('insights-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsWatchtowerDashboardRoutes().length, 3);
  assert.equal(createInsightsWatchtowerApiRoutes().length, 4);
  assert.equal(createInsightsWatchtowerOpsRoutes().length, 3);
  assert.equal(createInsightsWatchtowerPublicRoutes().length, 3);
  assert.equal(createInsightsWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsWatchtowerFixtures().contacts, 2);
});

