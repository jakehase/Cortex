import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsWorkbenchSnapshot, createAnalyticsWorkbenchDashboardRoutes, createAnalyticsWorkbenchApiRoutes, createAnalyticsWorkbenchOpsRoutes, createAnalyticsWorkbenchPublicRoutes, createAnalyticsWorkbenchRegistryRoutes, summarizeAnalyticsWorkbenchFixtures } from '../packages/analytics-workbench/index.mjs';

test('analytics-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsWorkbenchDashboardRoutes().length, 3);
  assert.equal(createAnalyticsWorkbenchApiRoutes().length, 4);
  assert.equal(createAnalyticsWorkbenchOpsRoutes().length, 3);
  assert.equal(createAnalyticsWorkbenchPublicRoutes().length, 3);
  assert.equal(createAnalyticsWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsWorkbenchFixtures().contacts, 2);
});

