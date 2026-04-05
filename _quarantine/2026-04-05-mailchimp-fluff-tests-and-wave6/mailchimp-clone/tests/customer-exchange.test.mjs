import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerExchangeSnapshot, createCustomerExchangeDashboardRoutes, createCustomerExchangeApiRoutes, createCustomerExchangeOpsRoutes, createCustomerExchangePublicRoutes, createCustomerExchangeRegistryRoutes, summarizeCustomerExchangeFixtures } from '../packages/customer-exchange/index.mjs';

test('customer-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerExchangeDashboardRoutes().length, 3);
  assert.equal(createCustomerExchangeApiRoutes().length, 4);
  assert.equal(createCustomerExchangeOpsRoutes().length, 3);
  assert.equal(createCustomerExchangePublicRoutes().length, 3);
  assert.equal(createCustomerExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerExchangeFixtures().contacts, 2);
});

