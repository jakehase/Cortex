import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativePlannerSnapshot, createCreativePlannerDashboardRoutes, createCreativePlannerApiRoutes, createCreativePlannerOpsRoutes, createCreativePlannerPublicRoutes, createCreativePlannerRegistryRoutes, summarizeCreativePlannerFixtures } from '../packages/creative-planner/index.mjs';

test('creative-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativePlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativePlannerDashboardRoutes().length, 3);
  assert.equal(createCreativePlannerApiRoutes().length, 4);
  assert.equal(createCreativePlannerOpsRoutes().length, 3);
  assert.equal(createCreativePlannerPublicRoutes().length, 3);
  assert.equal(createCreativePlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativePlannerFixtures().contacts, 2);
});

