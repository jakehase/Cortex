import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsFoundrySnapshot, createInsightsFoundryDashboardRoutes, createInsightsFoundryApiRoutes, createInsightsFoundryOpsRoutes, createInsightsFoundryPublicRoutes, createInsightsFoundryRegistryRoutes, summarizeInsightsFoundryFixtures } from '../packages/insights-foundry/index.mjs';

test('insights-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsFoundryDashboardRoutes().length, 3);
  assert.equal(createInsightsFoundryApiRoutes().length, 4);
  assert.equal(createInsightsFoundryOpsRoutes().length, 3);
  assert.equal(createInsightsFoundryPublicRoutes().length, 3);
  assert.equal(createInsightsFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsFoundryFixtures().contacts, 2);
});

