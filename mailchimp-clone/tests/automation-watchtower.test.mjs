import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationWatchtowerSnapshot, createAutomationWatchtowerDashboardRoutes, createAutomationWatchtowerApiRoutes, createAutomationWatchtowerOpsRoutes, createAutomationWatchtowerPublicRoutes, createAutomationWatchtowerRegistryRoutes, summarizeAutomationWatchtowerFixtures } from '../packages/automation-watchtower/index.mjs';

test('automation-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationWatchtowerDashboardRoutes().length, 3);
  assert.equal(createAutomationWatchtowerApiRoutes().length, 4);
  assert.equal(createAutomationWatchtowerOpsRoutes().length, 3);
  assert.equal(createAutomationWatchtowerPublicRoutes().length, 3);
  assert.equal(createAutomationWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationWatchtowerFixtures().contacts, 2);
});

