import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsAdvisorSnapshot, createAnalyticsAdvisorDashboardRoutes, createAnalyticsAdvisorApiRoutes, createAnalyticsAdvisorOpsRoutes, createAnalyticsAdvisorPublicRoutes, createAnalyticsAdvisorRegistryRoutes, summarizeAnalyticsAdvisorFixtures } from '../packages/analytics-advisor/index.mjs';

test('analytics-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsAdvisorDashboardRoutes().length, 3);
  assert.equal(createAnalyticsAdvisorApiRoutes().length, 4);
  assert.equal(createAnalyticsAdvisorOpsRoutes().length, 3);
  assert.equal(createAnalyticsAdvisorPublicRoutes().length, 3);
  assert.equal(createAnalyticsAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsAdvisorFixtures().contacts, 2);
});

