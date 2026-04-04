import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsConsoleSnapshot, createInsightsConsoleDashboardRoutes, createInsightsConsoleApiRoutes, createInsightsConsoleOpsRoutes, createInsightsConsolePublicRoutes, createInsightsConsoleRegistryRoutes, summarizeInsightsConsoleFixtures } from '../packages/insights-console/index.mjs';

test('insights-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsConsoleDashboardRoutes().length, 3);
  assert.equal(createInsightsConsoleApiRoutes().length, 4);
  assert.equal(createInsightsConsoleOpsRoutes().length, 3);
  assert.equal(createInsightsConsolePublicRoutes().length, 3);
  assert.equal(createInsightsConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsConsoleFixtures().contacts, 2);
});

