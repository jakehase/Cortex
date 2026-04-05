import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerNavigatorSnapshot, createCustomerNavigatorDashboardRoutes, createCustomerNavigatorApiRoutes, createCustomerNavigatorOpsRoutes, createCustomerNavigatorPublicRoutes, createCustomerNavigatorRegistryRoutes, summarizeCustomerNavigatorFixtures } from '../packages/customer-navigator/index.mjs';

test('customer-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerNavigatorDashboardRoutes().length, 3);
  assert.equal(createCustomerNavigatorApiRoutes().length, 4);
  assert.equal(createCustomerNavigatorOpsRoutes().length, 3);
  assert.equal(createCustomerNavigatorPublicRoutes().length, 3);
  assert.equal(createCustomerNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerNavigatorFixtures().contacts, 2);
});

