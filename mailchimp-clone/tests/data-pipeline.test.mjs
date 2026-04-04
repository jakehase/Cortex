import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataPipelineWorkspace, summarizeDataPipeline, validateDataPipelinePlan, createDataPipelineDashboardRoutes, createDataPipelineApiRoutes } from '../packages/data-pipeline/index.mjs';

test('data-pipeline exposes a real package surface with route manifests and validation', () => {
  const workspace = createDataPipelineWorkspace('Anchor Demo');
  const summary = summarizeDataPipeline(workspace);
  const validation = validateDataPipelinePlan({ owner: 'owner-1', milestones: ['plan', 'ship'], channels: ['email', 'app'] });
  const dashboardRoutes = createDataPipelineDashboardRoutes();
  const apiRoutes = createDataPipelineApiRoutes();

  assert.equal(summary.workspaceName, 'Anchor Demo');
  assert.equal(summary.metricCount, 3);
  assert.equal(validation.ok, true);
  assert.equal(dashboardRoutes.length, 3);
  assert.equal(apiRoutes.length, 2);
});
