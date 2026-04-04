import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsGridSnapshot, createInsightsGridDashboardRoutes, createInsightsGridApiRoutes, createInsightsGridOpsRoutes, createInsightsGridPublicRoutes, createInsightsGridRegistryRoutes, summarizeInsightsGridFixtures } from '../packages/insights-grid/index.mjs';

test('insights-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsGridDashboardRoutes().length, 3);
  assert.equal(createInsightsGridApiRoutes().length, 4);
  assert.equal(createInsightsGridOpsRoutes().length, 3);
  assert.equal(createInsightsGridPublicRoutes().length, 3);
  assert.equal(createInsightsGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsGridFixtures().contacts, 2);
});

