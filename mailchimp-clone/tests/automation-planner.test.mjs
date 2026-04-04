import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationPlannerSnapshot, createAutomationPlannerDashboardRoutes, createAutomationPlannerApiRoutes, createAutomationPlannerOpsRoutes, createAutomationPlannerPublicRoutes, createAutomationPlannerRegistryRoutes, summarizeAutomationPlannerFixtures } from '../packages/automation-planner/index.mjs';

test('automation-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationPlannerDashboardRoutes().length, 3);
  assert.equal(createAutomationPlannerApiRoutes().length, 4);
  assert.equal(createAutomationPlannerOpsRoutes().length, 3);
  assert.equal(createAutomationPlannerPublicRoutes().length, 3);
  assert.equal(createAutomationPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationPlannerFixtures().contacts, 2);
});

