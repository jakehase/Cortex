import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsFoundrySnapshot, createAnalyticsFoundryDashboardRoutes, createAnalyticsFoundryApiRoutes, createAnalyticsFoundryOpsRoutes, createAnalyticsFoundryPublicRoutes, createAnalyticsFoundryRegistryRoutes, summarizeAnalyticsFoundryFixtures } from '../packages/analytics-foundry/index.mjs';

test('analytics-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsFoundryDashboardRoutes().length, 3);
  assert.equal(createAnalyticsFoundryApiRoutes().length, 4);
  assert.equal(createAnalyticsFoundryOpsRoutes().length, 3);
  assert.equal(createAnalyticsFoundryPublicRoutes().length, 3);
  assert.equal(createAnalyticsFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsFoundryFixtures().contacts, 2);
});

