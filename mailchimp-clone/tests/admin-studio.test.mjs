import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminStudioWorkspace, summarizeAdminStudio, validateAdminStudioPlan, createAdminStudioDashboardRoutes, createAdminStudioApiRoutes } from '../packages/admin-studio/index.mjs';

test('admin-studio exposes a real package surface with route manifests and validation', () => {
  const workspace = createAdminStudioWorkspace('Anchor Demo');
  const summary = summarizeAdminStudio(workspace);
  const validation = validateAdminStudioPlan({ owner: 'owner-1', milestones: ['plan', 'ship'], channels: ['email', 'app'] });
  const dashboardRoutes = createAdminStudioDashboardRoutes();
  const apiRoutes = createAdminStudioApiRoutes();

  assert.equal(summary.workspaceName, 'Anchor Demo');
  assert.equal(summary.metricCount, 3);
  assert.equal(validation.ok, true);
  assert.equal(dashboardRoutes.length, 3);
  assert.equal(apiRoutes.length, 2);
});
