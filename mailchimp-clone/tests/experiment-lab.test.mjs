import test from 'node:test';
import assert from 'node:assert/strict';
import { createExperimentLabWorkspace, summarizeExperimentLab, validateExperimentLabPlan, createExperimentLabDashboardRoutes, createExperimentLabApiRoutes } from '../packages/experiment-lab/index.mjs';

test('experiment-lab exposes a real package surface with route manifests and validation', () => {
  const workspace = createExperimentLabWorkspace('Anchor Demo');
  const summary = summarizeExperimentLab(workspace);
  const validation = validateExperimentLabPlan({ owner: 'owner-1', milestones: ['plan', 'ship'], channels: ['email', 'app'] });
  const dashboardRoutes = createExperimentLabDashboardRoutes();
  const apiRoutes = createExperimentLabApiRoutes();

  assert.equal(summary.workspaceName, 'Anchor Demo');
  assert.equal(summary.metricCount, 3);
  assert.equal(validation.ok, true);
  assert.equal(dashboardRoutes.length, 3);
  assert.equal(apiRoutes.length, 2);
});
