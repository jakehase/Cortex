import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationStudioSnapshot, createAutomationStudioDashboardRoutes, createAutomationStudioApiRoutes, createAutomationStudioOpsRoutes, createAutomationStudioPublicRoutes, createAutomationStudioRegistryRoutes, summarizeAutomationStudioFixtures } from '../packages/automation-studio/index.mjs';

test('automation-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationStudioDashboardRoutes().length, 3);
  assert.equal(createAutomationStudioApiRoutes().length, 4);
  assert.equal(createAutomationStudioOpsRoutes().length, 3);
  assert.equal(createAutomationStudioPublicRoutes().length, 3);
  assert.equal(createAutomationStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationStudioFixtures().contacts, 2);
});

