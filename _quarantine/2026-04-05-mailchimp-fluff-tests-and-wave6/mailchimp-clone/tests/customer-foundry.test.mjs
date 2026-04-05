import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerFoundrySnapshot, createCustomerFoundryDashboardRoutes, createCustomerFoundryApiRoutes, createCustomerFoundryOpsRoutes, createCustomerFoundryPublicRoutes, createCustomerFoundryRegistryRoutes, summarizeCustomerFoundryFixtures } from '../packages/customer-foundry/index.mjs';

test('customer-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerFoundryDashboardRoutes().length, 3);
  assert.equal(createCustomerFoundryApiRoutes().length, 4);
  assert.equal(createCustomerFoundryOpsRoutes().length, 3);
  assert.equal(createCustomerFoundryPublicRoutes().length, 3);
  assert.equal(createCustomerFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerFoundryFixtures().contacts, 2);
});

