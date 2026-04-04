import test from 'node:test';
import assert from 'node:assert/strict';
import { createRevenueAttributionDashboardRoutes, createRevenueAttributionApiRoutes, createRevenueAttributionOpsRoutes, createRevenueAttributionPublicRoutes } from '../packages/revenue-attribution/index.mjs';

test('revenue-attribution routes honor custom base paths and stable ids', () => {
  const dashboard = createRevenueAttributionDashboardRoutes('/labs/revenue-attribution');
  const api = createRevenueAttributionApiRoutes('/api/labs/revenue-attribution');
  const ops = createRevenueAttributionOpsRoutes('/ops/labs/revenue-attribution');
  const pub = createRevenueAttributionPublicRoutes('/public/labs/revenue-attribution');
  assert.equal(dashboard[0].path, '/labs/revenue-attribution');
  assert.equal(api[0].path, '/api/labs/revenue-attribution/overview');
  assert.equal(ops[0].path, '/ops/labs/revenue-attribution/health');
  assert.equal(pub[0].path, '/public/labs/revenue-attribution');
  assert.match(dashboard[0].id, /revenue\-attribution/);
  assert.match(api[2].id, /revenue\-attribution/);
});

