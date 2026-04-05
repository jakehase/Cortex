import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationConsoleSnapshot, createAutomationConsoleDashboardRoutes, createAutomationConsoleApiRoutes, createAutomationConsoleOpsRoutes, createAutomationConsolePublicRoutes, createAutomationConsoleRegistryRoutes, summarizeAutomationConsoleFixtures } from '../packages/automation-console/index.mjs';

test('automation-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationConsoleDashboardRoutes().length, 3);
  assert.equal(createAutomationConsoleApiRoutes().length, 4);
  assert.equal(createAutomationConsoleOpsRoutes().length, 3);
  assert.equal(createAutomationConsolePublicRoutes().length, 3);
  assert.equal(createAutomationConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationConsoleFixtures().contacts, 2);
});

