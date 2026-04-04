import test from 'node:test';
import assert from 'node:assert/strict';
import { createContentLibraryWorkspace, summarizeContentLibrary, validateContentLibraryPlan, createContentLibraryDashboardRoutes, createContentLibraryApiRoutes } from '../packages/content-library/index.mjs';

test('content-library exposes a real package surface with route manifests and validation', () => {
  const workspace = createContentLibraryWorkspace('Anchor Demo');
  const summary = summarizeContentLibrary(workspace);
  const validation = validateContentLibraryPlan({ owner: 'owner-1', milestones: ['plan', 'ship'], channels: ['email', 'app'] });
  const dashboardRoutes = createContentLibraryDashboardRoutes();
  const apiRoutes = createContentLibraryApiRoutes();

  assert.equal(summary.workspaceName, 'Anchor Demo');
  assert.equal(summary.metricCount, 3);
  assert.equal(validation.ok, true);
  assert.equal(dashboardRoutes.length, 3);
  assert.equal(apiRoutes.length, 2);
});
