import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsExchangeSnapshot, createInsightsExchangeDashboardRoutes, createInsightsExchangeApiRoutes, createInsightsExchangeOpsRoutes, createInsightsExchangePublicRoutes, createInsightsExchangeRegistryRoutes, summarizeInsightsExchangeFixtures } from '../packages/insights-exchange/index.mjs';

test('insights-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsExchangeDashboardRoutes().length, 3);
  assert.equal(createInsightsExchangeApiRoutes().length, 4);
  assert.equal(createInsightsExchangeOpsRoutes().length, 3);
  assert.equal(createInsightsExchangePublicRoutes().length, 3);
  assert.equal(createInsightsExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsExchangeFixtures().contacts, 2);
});

