import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingPlannerSnapshot, createBillingPlannerDashboardRoutes, createBillingPlannerApiRoutes, createBillingPlannerOpsRoutes, createBillingPlannerPublicRoutes, createBillingPlannerRegistryRoutes, summarizeBillingPlannerFixtures } from '../packages/billing-planner/index.mjs';

test('billing-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingPlannerDashboardRoutes().length, 3);
  assert.equal(createBillingPlannerApiRoutes().length, 4);
  assert.equal(createBillingPlannerOpsRoutes().length, 3);
  assert.equal(createBillingPlannerPublicRoutes().length, 3);
  assert.equal(createBillingPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingPlannerFixtures().contacts, 2);
});

