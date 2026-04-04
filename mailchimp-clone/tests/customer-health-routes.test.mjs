import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomerHealthDashboardRoutes, createCustomerHealthApiRoutes, createCustomerHealthOpsRoutes, createCustomerHealthPublicRoutes } from '../packages/customer-health/index.mjs';

test('customer-health routes honor custom base paths and stable ids', () => {
  const dashboard = createCustomerHealthDashboardRoutes('/labs/customer-health');
  const api = createCustomerHealthApiRoutes('/api/labs/customer-health');
  const ops = createCustomerHealthOpsRoutes('/ops/labs/customer-health');
  const pub = createCustomerHealthPublicRoutes('/public/labs/customer-health');
  assert.equal(dashboard[0].path, '/labs/customer-health');
  assert.equal(api[0].path, '/api/labs/customer-health/overview');
  assert.equal(ops[0].path, '/ops/labs/customer-health/health');
  assert.equal(pub[0].path, '/public/labs/customer-health');
  assert.match(dashboard[0].id, /customer\-health/);
  assert.match(api[2].id, /customer\-health/);
});

