import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyPlannerSnapshot, createLoyaltyPlannerDashboardRoutes, createLoyaltyPlannerApiRoutes, createLoyaltyPlannerOpsRoutes, createLoyaltyPlannerPublicRoutes, createLoyaltyPlannerRegistryRoutes, summarizeLoyaltyPlannerFixtures } from '../packages/loyalty-planner/index.mjs';

test('loyalty-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyPlannerDashboardRoutes().length, 3);
  assert.equal(createLoyaltyPlannerApiRoutes().length, 4);
  assert.equal(createLoyaltyPlannerOpsRoutes().length, 3);
  assert.equal(createLoyaltyPlannerPublicRoutes().length, 3);
  assert.equal(createLoyaltyPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyPlannerFixtures().contacts, 2);
});

