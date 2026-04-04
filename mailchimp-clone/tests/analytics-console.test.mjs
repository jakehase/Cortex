import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsConsoleSnapshot, createAnalyticsConsoleDashboardRoutes, createAnalyticsConsoleApiRoutes, createAnalyticsConsoleOpsRoutes, createAnalyticsConsolePublicRoutes, createAnalyticsConsoleRegistryRoutes, summarizeAnalyticsConsoleFixtures } from '../packages/analytics-console/index.mjs';

test('analytics-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsConsoleDashboardRoutes().length, 3);
  assert.equal(createAnalyticsConsoleApiRoutes().length, 4);
  assert.equal(createAnalyticsConsoleOpsRoutes().length, 3);
  assert.equal(createAnalyticsConsolePublicRoutes().length, 3);
  assert.equal(createAnalyticsConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsConsoleFixtures().contacts, 2);
});

