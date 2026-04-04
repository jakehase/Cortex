import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationPlannerSnapshot, createActivationPlannerDashboardRoutes, createActivationPlannerApiRoutes, createActivationPlannerOpsRoutes, createActivationPlannerPublicRoutes, createActivationPlannerRegistryRoutes, summarizeActivationPlannerFixtures } from '../packages/activation-planner/index.mjs';

test('activation-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationPlannerDashboardRoutes().length, 3);
  assert.equal(createActivationPlannerApiRoutes().length, 4);
  assert.equal(createActivationPlannerOpsRoutes().length, 3);
  assert.equal(createActivationPlannerPublicRoutes().length, 3);
  assert.equal(createActivationPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationPlannerFixtures().contacts, 2);
});

