import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecyclePlannerSnapshot, createLifecyclePlannerDashboardRoutes, createLifecyclePlannerApiRoutes, createLifecyclePlannerOpsRoutes, createLifecyclePlannerPublicRoutes, createLifecyclePlannerRegistryRoutes, summarizeLifecyclePlannerFixtures } from '../packages/lifecycle-planner/index.mjs';

test('lifecycle-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecyclePlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecyclePlannerDashboardRoutes().length, 3);
  assert.equal(createLifecyclePlannerApiRoutes().length, 4);
  assert.equal(createLifecyclePlannerOpsRoutes().length, 3);
  assert.equal(createLifecyclePlannerPublicRoutes().length, 3);
  assert.equal(createLifecyclePlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecyclePlannerFixtures().contacts, 2);
});

