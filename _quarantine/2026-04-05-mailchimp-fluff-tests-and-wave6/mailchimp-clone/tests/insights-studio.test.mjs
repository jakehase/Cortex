import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsStudioSnapshot, createInsightsStudioDashboardRoutes, createInsightsStudioApiRoutes, createInsightsStudioOpsRoutes, createInsightsStudioPublicRoutes, createInsightsStudioRegistryRoutes, summarizeInsightsStudioFixtures } from '../packages/insights-studio/index.mjs';

test('insights-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsStudioDashboardRoutes().length, 3);
  assert.equal(createInsightsStudioApiRoutes().length, 4);
  assert.equal(createInsightsStudioOpsRoutes().length, 3);
  assert.equal(createInsightsStudioPublicRoutes().length, 3);
  assert.equal(createInsightsStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsStudioFixtures().contacts, 2);
});

