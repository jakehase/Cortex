import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrustAutomationDashboardRoutes, createTrustAutomationApiRoutes, createTrustAutomationOpsRoutes, createTrustAutomationPublicRoutes } from '../packages/trust-automation/index.mjs';

test('trust-automation routes honor custom base paths and stable ids', () => {
  const dashboard = createTrustAutomationDashboardRoutes('/labs/trust-automation');
  const api = createTrustAutomationApiRoutes('/api/labs/trust-automation');
  const ops = createTrustAutomationOpsRoutes('/ops/labs/trust-automation');
  const pub = createTrustAutomationPublicRoutes('/public/labs/trust-automation');
  assert.equal(dashboard[0].path, '/labs/trust-automation');
  assert.equal(api[0].path, '/api/labs/trust-automation/overview');
  assert.equal(ops[0].path, '/ops/labs/trust-automation/health');
  assert.equal(pub[0].path, '/public/labs/trust-automation');
  assert.match(dashboard[0].id, /trust\-automation/);
  assert.match(api[2].id, /trust\-automation/);
});

