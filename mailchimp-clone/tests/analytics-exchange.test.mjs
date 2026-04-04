import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsExchangeSnapshot, createAnalyticsExchangeDashboardRoutes, createAnalyticsExchangeApiRoutes, createAnalyticsExchangeOpsRoutes, createAnalyticsExchangePublicRoutes, createAnalyticsExchangeRegistryRoutes, summarizeAnalyticsExchangeFixtures } from '../packages/analytics-exchange/index.mjs';

test('analytics-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsExchangeDashboardRoutes().length, 3);
  assert.equal(createAnalyticsExchangeApiRoutes().length, 4);
  assert.equal(createAnalyticsExchangeOpsRoutes().length, 3);
  assert.equal(createAnalyticsExchangePublicRoutes().length, 3);
  assert.equal(createAnalyticsExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsExchangeFixtures().contacts, 2);
});

