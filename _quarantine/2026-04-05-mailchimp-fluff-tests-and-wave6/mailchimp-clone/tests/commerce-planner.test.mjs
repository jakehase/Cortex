import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommercePlannerSnapshot, createCommercePlannerDashboardRoutes, createCommercePlannerApiRoutes, createCommercePlannerOpsRoutes, createCommercePlannerPublicRoutes, createCommercePlannerRegistryRoutes, summarizeCommercePlannerFixtures } from '../packages/commerce-planner/index.mjs';

test('commerce-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommercePlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommercePlannerDashboardRoutes().length, 3);
  assert.equal(createCommercePlannerApiRoutes().length, 4);
  assert.equal(createCommercePlannerOpsRoutes().length, 3);
  assert.equal(createCommercePlannerPublicRoutes().length, 3);
  assert.equal(createCommercePlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommercePlannerFixtures().contacts, 2);
});

