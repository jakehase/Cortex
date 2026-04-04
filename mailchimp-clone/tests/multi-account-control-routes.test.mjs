import test from 'node:test';
import assert from 'node:assert/strict';
import { createMultiAccountControlDashboardRoutes, createMultiAccountControlApiRoutes, createMultiAccountControlOpsRoutes, createMultiAccountControlPublicRoutes } from '../packages/multi-account-control/index.mjs';

test('multi-account-control routes honor custom base paths and stable ids', () => {
  const dashboard = createMultiAccountControlDashboardRoutes('/labs/multi-account-control');
  const api = createMultiAccountControlApiRoutes('/api/labs/multi-account-control');
  const ops = createMultiAccountControlOpsRoutes('/ops/labs/multi-account-control');
  const pub = createMultiAccountControlPublicRoutes('/public/labs/multi-account-control');
  assert.equal(dashboard[0].path, '/labs/multi-account-control');
  assert.equal(api[0].path, '/api/labs/multi-account-control/overview');
  assert.equal(ops[0].path, '/ops/labs/multi-account-control/health');
  assert.equal(pub[0].path, '/public/labs/multi-account-control');
  assert.match(dashboard[0].id, /multi\-account\-control/);
  assert.match(api[2].id, /multi\-account\-control/);
});

