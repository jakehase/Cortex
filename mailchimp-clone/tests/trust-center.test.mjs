import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrustCenterWorkspace, summarizeTrustCenter, validateTrustCenterPlan, createTrustCenterDashboardRoutes, createTrustCenterApiRoutes } from '../packages/trust-center/index.mjs';

test('trust-center exposes a real package surface with route manifests and validation', () => {
  const workspace = createTrustCenterWorkspace('Anchor Demo');
  const summary = summarizeTrustCenter(workspace);
  const validation = validateTrustCenterPlan({ owner: 'owner-1', milestones: ['plan', 'ship'], channels: ['email', 'app'] });
  const dashboardRoutes = createTrustCenterDashboardRoutes();
  const apiRoutes = createTrustCenterApiRoutes();

  assert.equal(summary.workspaceName, 'Anchor Demo');
  assert.equal(summary.metricCount, 3);
  assert.equal(validation.ok, true);
  assert.equal(dashboardRoutes.length, 3);
  assert.equal(apiRoutes.length, 2);
});
