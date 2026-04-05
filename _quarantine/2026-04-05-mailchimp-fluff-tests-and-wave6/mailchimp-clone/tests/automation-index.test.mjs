import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationIndexSnapshot, createAutomationIndexDashboardRoutes, createAutomationIndexApiRoutes, createAutomationIndexOpsRoutes, createAutomationIndexPublicRoutes, createAutomationIndexRegistryRoutes, summarizeAutomationIndexFixtures } from '../packages/automation-index/index.mjs';

test('automation-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationIndexDashboardRoutes().length, 3);
  assert.equal(createAutomationIndexApiRoutes().length, 4);
  assert.equal(createAutomationIndexOpsRoutes().length, 3);
  assert.equal(createAutomationIndexPublicRoutes().length, 3);
  assert.equal(createAutomationIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationIndexFixtures().contacts, 2);
});

