import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsAdvisorSnapshot, createInsightsAdvisorDashboardRoutes, createInsightsAdvisorApiRoutes, createInsightsAdvisorOpsRoutes, createInsightsAdvisorPublicRoutes, createInsightsAdvisorRegistryRoutes, summarizeInsightsAdvisorFixtures } from '../packages/insights-advisor/index.mjs';

test('insights-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsAdvisorDashboardRoutes().length, 3);
  assert.equal(createInsightsAdvisorApiRoutes().length, 4);
  assert.equal(createInsightsAdvisorOpsRoutes().length, 3);
  assert.equal(createInsightsAdvisorPublicRoutes().length, 3);
  assert.equal(createInsightsAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsAdvisorFixtures().contacts, 2);
});

