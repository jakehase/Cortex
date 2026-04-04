import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerPlannerSnapshot, createCustomerPlannerDashboardRoutes, createCustomerPlannerApiRoutes, createCustomerPlannerOpsRoutes, createCustomerPlannerPublicRoutes, createCustomerPlannerRegistryRoutes, summarizeCustomerPlannerFixtures } from '../packages/customer-planner/index.mjs';

test('customer-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerPlannerDashboardRoutes().length, 3);
  assert.equal(createCustomerPlannerApiRoutes().length, 4);
  assert.equal(createCustomerPlannerOpsRoutes().length, 3);
  assert.equal(createCustomerPlannerPublicRoutes().length, 3);
  assert.equal(createCustomerPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerPlannerFixtures().contacts, 2);
});

