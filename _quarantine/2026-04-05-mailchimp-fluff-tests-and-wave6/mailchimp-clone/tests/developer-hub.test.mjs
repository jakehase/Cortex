import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeveloperHubWorkspace, summarizeDeveloperHub, validateDeveloperHubPlan, createDeveloperHubDashboardRoutes, createDeveloperHubApiRoutes } from '../packages/developer-hub/index.mjs';

test('developer-hub exposes a real package surface with route manifests and validation', () => {
  const workspace = createDeveloperHubWorkspace('Anchor Demo');
  const summary = summarizeDeveloperHub(workspace);
  const validation = validateDeveloperHubPlan({ owner: 'owner-1', milestones: ['plan', 'ship'], channels: ['email', 'app'] });
  const dashboardRoutes = createDeveloperHubDashboardRoutes();
  const apiRoutes = createDeveloperHubApiRoutes();

  assert.equal(summary.workspaceName, 'Anchor Demo');
  assert.equal(summary.metricCount, 3);
  assert.equal(validation.ok, true);
  assert.equal(dashboardRoutes.length, 3);
  assert.equal(apiRoutes.length, 2);
});
