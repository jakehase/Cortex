import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerHealthSnapshot, createCustomerHealthDashboardRoutes, createCustomerHealthApiRoutes, createCustomerHealthOpsRoutes, createCustomerHealthPublicRoutes, summarizeCustomerHealthFixtures } from '../packages/customer-health/index.mjs';

test('customer-health package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildCustomerHealthSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerHealthDashboardRoutes().length, 3);
  assert.equal(createCustomerHealthApiRoutes().length, 3);
  assert.equal(createCustomerHealthOpsRoutes().length, 3);
  assert.equal(createCustomerHealthPublicRoutes().length, 3);
  assert.equal(summarizeCustomerHealthFixtures().contacts, 2);
});

