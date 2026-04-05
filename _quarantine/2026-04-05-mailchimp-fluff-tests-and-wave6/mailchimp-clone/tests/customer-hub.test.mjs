import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerHubSnapshot, createCustomerHubDashboardRoutes, createCustomerHubApiRoutes, createCustomerHubOpsRoutes, createCustomerHubPublicRoutes, createCustomerHubRegistryRoutes, summarizeCustomerHubFixtures } from '../packages/customer-hub/index.mjs';

test('customer-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerHubDashboardRoutes().length, 3);
  assert.equal(createCustomerHubApiRoutes().length, 4);
  assert.equal(createCustomerHubOpsRoutes().length, 3);
  assert.equal(createCustomerHubPublicRoutes().length, 3);
  assert.equal(createCustomerHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerHubFixtures().contacts, 2);
});

