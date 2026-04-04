import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationFoundrySnapshot, createAutomationFoundryDashboardRoutes, createAutomationFoundryApiRoutes, createAutomationFoundryOpsRoutes, createAutomationFoundryPublicRoutes, createAutomationFoundryRegistryRoutes, summarizeAutomationFoundryFixtures } from '../packages/automation-foundry/index.mjs';

test('automation-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationFoundryDashboardRoutes().length, 3);
  assert.equal(createAutomationFoundryApiRoutes().length, 4);
  assert.equal(createAutomationFoundryOpsRoutes().length, 3);
  assert.equal(createAutomationFoundryPublicRoutes().length, 3);
  assert.equal(createAutomationFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationFoundryFixtures().contacts, 2);
});

