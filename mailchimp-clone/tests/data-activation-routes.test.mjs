import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataActivationDashboardRoutes, createDataActivationApiRoutes, createDataActivationOpsRoutes, createDataActivationPublicRoutes } from '../packages/data-activation/index.mjs';

test('data-activation routes honor custom base paths and stable ids', () => {
  const dashboard = createDataActivationDashboardRoutes('/labs/data-activation');
  const api = createDataActivationApiRoutes('/api/labs/data-activation');
  const ops = createDataActivationOpsRoutes('/ops/labs/data-activation');
  const pub = createDataActivationPublicRoutes('/public/labs/data-activation');
  assert.equal(dashboard[0].path, '/labs/data-activation');
  assert.equal(api[0].path, '/api/labs/data-activation/overview');
  assert.equal(ops[0].path, '/ops/labs/data-activation/health');
  assert.equal(pub[0].path, '/public/labs/data-activation');
  assert.match(dashboard[0].id, /data\-activation/);
  assert.match(api[2].id, /data\-activation/);
});

