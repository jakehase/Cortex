import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationHubSnapshot, createAutomationHubDashboardRoutes, createAutomationHubApiRoutes, createAutomationHubOpsRoutes, createAutomationHubPublicRoutes, createAutomationHubRegistryRoutes, summarizeAutomationHubFixtures } from '../packages/automation-hub/index.mjs';

test('automation-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationHubDashboardRoutes().length, 3);
  assert.equal(createAutomationHubApiRoutes().length, 4);
  assert.equal(createAutomationHubOpsRoutes().length, 3);
  assert.equal(createAutomationHubPublicRoutes().length, 3);
  assert.equal(createAutomationHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationHubFixtures().contacts, 2);
});

