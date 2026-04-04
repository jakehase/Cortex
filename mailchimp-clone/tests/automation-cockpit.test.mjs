import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationCockpitSnapshot, createAutomationCockpitDashboardRoutes, createAutomationCockpitApiRoutes, createAutomationCockpitOpsRoutes, createAutomationCockpitPublicRoutes, createAutomationCockpitRegistryRoutes, summarizeAutomationCockpitFixtures } from '../packages/automation-cockpit/index.mjs';

test('automation-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationCockpitDashboardRoutes().length, 3);
  assert.equal(createAutomationCockpitApiRoutes().length, 4);
  assert.equal(createAutomationCockpitOpsRoutes().length, 3);
  assert.equal(createAutomationCockpitPublicRoutes().length, 3);
  assert.equal(createAutomationCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationCockpitFixtures().contacts, 2);
});

