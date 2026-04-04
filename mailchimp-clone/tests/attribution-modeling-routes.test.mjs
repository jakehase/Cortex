import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttributionModelingDashboardRoutes, createAttributionModelingApiRoutes, createAttributionModelingOpsRoutes, createAttributionModelingPublicRoutes } from '../packages/attribution-modeling/index.mjs';

test('attribution-modeling routes honor custom base paths and stable ids', () => {
  const dashboard = createAttributionModelingDashboardRoutes('/labs/attribution-modeling');
  const api = createAttributionModelingApiRoutes('/api/labs/attribution-modeling');
  const ops = createAttributionModelingOpsRoutes('/ops/labs/attribution-modeling');
  const pub = createAttributionModelingPublicRoutes('/public/labs/attribution-modeling');
  assert.equal(dashboard[0].path, '/labs/attribution-modeling');
  assert.equal(api[0].path, '/api/labs/attribution-modeling/overview');
  assert.equal(ops[0].path, '/ops/labs/attribution-modeling/health');
  assert.equal(pub[0].path, '/public/labs/attribution-modeling');
  assert.match(dashboard[0].id, /attribution\-modeling/);
  assert.match(api[2].id, /attribution\-modeling/);
});

