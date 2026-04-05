import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerGridSnapshot, createCustomerGridDashboardRoutes, createCustomerGridApiRoutes, createCustomerGridOpsRoutes, createCustomerGridPublicRoutes, createCustomerGridRegistryRoutes, summarizeCustomerGridFixtures } from '../packages/customer-grid/index.mjs';

test('customer-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerGridDashboardRoutes().length, 3);
  assert.equal(createCustomerGridApiRoutes().length, 4);
  assert.equal(createCustomerGridOpsRoutes().length, 3);
  assert.equal(createCustomerGridPublicRoutes().length, 3);
  assert.equal(createCustomerGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerGridFixtures().contacts, 2);
});

