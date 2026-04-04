import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudienceIntelligenceWorkspace, summarizeAudienceIntelligence, validateAudienceIntelligencePlan, createAudienceIntelligenceDashboardRoutes, createAudienceIntelligenceApiRoutes } from '../packages/audience-intelligence/index.mjs';

test('audience-intelligence exposes a real package surface with route manifests and validation', () => {
  const workspace = createAudienceIntelligenceWorkspace('Anchor Demo');
  const summary = summarizeAudienceIntelligence(workspace);
  const validation = validateAudienceIntelligencePlan({ owner: 'owner-1', milestones: ['plan', 'ship'], channels: ['email', 'app'] });
  const dashboardRoutes = createAudienceIntelligenceDashboardRoutes();
  const apiRoutes = createAudienceIntelligenceApiRoutes();

  assert.equal(summary.workspaceName, 'Anchor Demo');
  assert.equal(summary.metricCount, 3);
  assert.equal(validation.ok, true);
  assert.equal(dashboardRoutes.length, 3);
  assert.equal(apiRoutes.length, 2);
});
