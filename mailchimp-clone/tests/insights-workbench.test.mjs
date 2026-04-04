import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsWorkbenchSnapshot, createInsightsWorkbenchDashboardRoutes, createInsightsWorkbenchApiRoutes, createInsightsWorkbenchOpsRoutes, createInsightsWorkbenchPublicRoutes, createInsightsWorkbenchRegistryRoutes, summarizeInsightsWorkbenchFixtures } from '../packages/insights-workbench/index.mjs';

test('insights-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsWorkbenchDashboardRoutes().length, 3);
  assert.equal(createInsightsWorkbenchApiRoutes().length, 4);
  assert.equal(createInsightsWorkbenchOpsRoutes().length, 3);
  assert.equal(createInsightsWorkbenchPublicRoutes().length, 3);
  assert.equal(createInsightsWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsWorkbenchFixtures().contacts, 2);
});

