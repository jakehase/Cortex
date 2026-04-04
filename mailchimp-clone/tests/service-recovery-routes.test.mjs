import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceRecoveryDashboardRoutes, createServiceRecoveryApiRoutes, createServiceRecoveryOpsRoutes, createServiceRecoveryPublicRoutes } from '../packages/service-recovery/index.mjs';

test('service-recovery routes honor custom base paths and stable ids', () => {
  const dashboard = createServiceRecoveryDashboardRoutes('/labs/service-recovery');
  const api = createServiceRecoveryApiRoutes('/api/labs/service-recovery');
  const ops = createServiceRecoveryOpsRoutes('/ops/labs/service-recovery');
  const pub = createServiceRecoveryPublicRoutes('/public/labs/service-recovery');
  assert.equal(dashboard[0].path, '/labs/service-recovery');
  assert.equal(api[0].path, '/api/labs/service-recovery/overview');
  assert.equal(ops[0].path, '/ops/labs/service-recovery/health');
  assert.equal(pub[0].path, '/public/labs/service-recovery');
  assert.match(dashboard[0].id, /service\-recovery/);
  assert.match(api[2].id, /service\-recovery/);
});

