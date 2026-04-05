import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationNavigatorSnapshot, createAutomationNavigatorDashboardRoutes, createAutomationNavigatorApiRoutes, createAutomationNavigatorOpsRoutes, createAutomationNavigatorPublicRoutes, createAutomationNavigatorRegistryRoutes, summarizeAutomationNavigatorFixtures } from '../packages/automation-navigator/index.mjs';

test('automation-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationNavigatorDashboardRoutes().length, 3);
  assert.equal(createAutomationNavigatorApiRoutes().length, 4);
  assert.equal(createAutomationNavigatorOpsRoutes().length, 3);
  assert.equal(createAutomationNavigatorPublicRoutes().length, 3);
  assert.equal(createAutomationNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationNavigatorFixtures().contacts, 2);
});

