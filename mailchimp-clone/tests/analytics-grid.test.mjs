import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsGridSnapshot, createAnalyticsGridDashboardRoutes, createAnalyticsGridApiRoutes, createAnalyticsGridOpsRoutes, createAnalyticsGridPublicRoutes, createAnalyticsGridRegistryRoutes, summarizeAnalyticsGridFixtures } from '../packages/analytics-grid/index.mjs';

test('analytics-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsGridDashboardRoutes().length, 3);
  assert.equal(createAnalyticsGridApiRoutes().length, 4);
  assert.equal(createAnalyticsGridOpsRoutes().length, 3);
  assert.equal(createAnalyticsGridPublicRoutes().length, 3);
  assert.equal(createAnalyticsGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsGridFixtures().contacts, 2);
});

