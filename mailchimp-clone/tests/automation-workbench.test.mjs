import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationWorkbenchSnapshot, createAutomationWorkbenchDashboardRoutes, createAutomationWorkbenchApiRoutes, createAutomationWorkbenchOpsRoutes, createAutomationWorkbenchPublicRoutes, createAutomationWorkbenchRegistryRoutes, summarizeAutomationWorkbenchFixtures } from '../packages/automation-workbench/index.mjs';

test('automation-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationWorkbenchDashboardRoutes().length, 3);
  assert.equal(createAutomationWorkbenchApiRoutes().length, 4);
  assert.equal(createAutomationWorkbenchOpsRoutes().length, 3);
  assert.equal(createAutomationWorkbenchPublicRoutes().length, 3);
  assert.equal(createAutomationWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationWorkbenchFixtures().contacts, 2);
});

