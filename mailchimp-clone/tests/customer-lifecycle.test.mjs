import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerLifecycleSnapshot, createCustomerLifecycleDashboardRoutes, createCustomerLifecycleApiRoutes, createCustomerLifecycleOpsRoutes, createCustomerLifecyclePublicRoutes, summarizeCustomerLifecycleFixtures } from '../packages/customer-lifecycle/index.mjs';

test('customer-lifecycle package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildCustomerLifecycleSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerLifecycleDashboardRoutes().length, 3);
  assert.equal(createCustomerLifecycleApiRoutes().length, 3);
  assert.equal(createCustomerLifecycleOpsRoutes().length, 3);
  assert.equal(createCustomerLifecyclePublicRoutes().length, 3);
  assert.equal(summarizeCustomerLifecycleFixtures().contacts, 2);
});
