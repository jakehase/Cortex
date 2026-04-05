import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationGridSnapshot, createAutomationGridDashboardRoutes, createAutomationGridApiRoutes, createAutomationGridOpsRoutes, createAutomationGridPublicRoutes, createAutomationGridRegistryRoutes, summarizeAutomationGridFixtures } from '../packages/automation-grid/index.mjs';

test('automation-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationGridDashboardRoutes().length, 3);
  assert.equal(createAutomationGridApiRoutes().length, 4);
  assert.equal(createAutomationGridOpsRoutes().length, 3);
  assert.equal(createAutomationGridPublicRoutes().length, 3);
  assert.equal(createAutomationGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationGridFixtures().contacts, 2);
});

