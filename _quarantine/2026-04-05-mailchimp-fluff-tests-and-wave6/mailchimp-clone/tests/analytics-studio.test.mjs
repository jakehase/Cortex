import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsStudioSnapshot, createAnalyticsStudioDashboardRoutes, createAnalyticsStudioApiRoutes, createAnalyticsStudioOpsRoutes, createAnalyticsStudioPublicRoutes, createAnalyticsStudioRegistryRoutes, summarizeAnalyticsStudioFixtures } from '../packages/analytics-studio/index.mjs';

test('analytics-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsStudioDashboardRoutes().length, 3);
  assert.equal(createAnalyticsStudioApiRoutes().length, 4);
  assert.equal(createAnalyticsStudioOpsRoutes().length, 3);
  assert.equal(createAnalyticsStudioPublicRoutes().length, 3);
  assert.equal(createAnalyticsStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsStudioFixtures().contacts, 2);
});

