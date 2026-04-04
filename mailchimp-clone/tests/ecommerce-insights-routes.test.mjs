import test from 'node:test';
import assert from 'node:assert/strict';
import { createEcommerceInsightsDashboardRoutes, createEcommerceInsightsApiRoutes, createEcommerceInsightsOpsRoutes, createEcommerceInsightsPublicRoutes } from '../packages/ecommerce-insights/index.mjs';

test('ecommerce-insights routes honor custom base paths and stable ids', () => {
  const dashboard = createEcommerceInsightsDashboardRoutes('/labs/ecommerce-insights');
  const api = createEcommerceInsightsApiRoutes('/api/labs/ecommerce-insights');
  const ops = createEcommerceInsightsOpsRoutes('/ops/labs/ecommerce-insights');
  const pub = createEcommerceInsightsPublicRoutes('/public/labs/ecommerce-insights');
  assert.equal(dashboard[0].path, '/labs/ecommerce-insights');
  assert.equal(api[0].path, '/api/labs/ecommerce-insights/overview');
  assert.equal(ops[0].path, '/ops/labs/ecommerce-insights/health');
  assert.equal(pub[0].path, '/public/labs/ecommerce-insights');
  assert.match(dashboard[0].id, /ecommerce\-insights/);
  assert.match(api[2].id, /ecommerce\-insights/);
});

