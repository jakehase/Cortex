import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsIndexSnapshot, createAnalyticsIndexDashboardRoutes, createAnalyticsIndexApiRoutes, createAnalyticsIndexOpsRoutes, createAnalyticsIndexPublicRoutes, createAnalyticsIndexRegistryRoutes, summarizeAnalyticsIndexFixtures } from '../packages/analytics-index/index.mjs';

test('analytics-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsIndexDashboardRoutes().length, 3);
  assert.equal(createAnalyticsIndexApiRoutes().length, 4);
  assert.equal(createAnalyticsIndexOpsRoutes().length, 3);
  assert.equal(createAnalyticsIndexPublicRoutes().length, 3);
  assert.equal(createAnalyticsIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsIndexFixtures().contacts, 2);
});

