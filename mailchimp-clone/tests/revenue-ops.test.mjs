import test from 'node:test';
import assert from 'node:assert/strict';
import { createRevenueOpsWorkspace, summarizeRevenueOps, validateRevenueOpsPlan, createRevenueOpsDashboardRoutes, createRevenueOpsApiRoutes } from '../packages/revenue-ops/index.mjs';

test('revenue-ops exposes a real package surface with route manifests and validation', () => {
  const workspace = createRevenueOpsWorkspace('Anchor Demo');
  const summary = summarizeRevenueOps(workspace);
  const validation = validateRevenueOpsPlan({ owner: 'owner-1', milestones: ['plan', 'ship'], channels: ['email', 'app'] });
  const dashboardRoutes = createRevenueOpsDashboardRoutes();
  const apiRoutes = createRevenueOpsApiRoutes();

  assert.equal(summary.workspaceName, 'Anchor Demo');
  assert.equal(summary.metricCount, 3);
  assert.equal(validation.ok, true);
  assert.equal(dashboardRoutes.length, 3);
  assert.equal(apiRoutes.length, 2);
});
