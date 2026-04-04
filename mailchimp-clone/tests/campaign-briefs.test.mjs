import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignBriefsWorkspace, summarizeCampaignBriefs, validateCampaignBriefsPlan, createCampaignBriefsDashboardRoutes, createCampaignBriefsApiRoutes } from '../packages/campaign-briefs/index.mjs';

test('campaign-briefs exposes a real package surface with route manifests and validation', () => {
  const workspace = createCampaignBriefsWorkspace('Anchor Demo');
  const summary = summarizeCampaignBriefs(workspace);
  const validation = validateCampaignBriefsPlan({ owner: 'owner-1', milestones: ['plan', 'ship'], channels: ['email', 'app'] });
  const dashboardRoutes = createCampaignBriefsDashboardRoutes();
  const apiRoutes = createCampaignBriefsApiRoutes();

  assert.equal(summary.workspaceName, 'Anchor Demo');
  assert.equal(summary.metricCount, 3);
  assert.equal(validation.ok, true);
  assert.equal(dashboardRoutes.length, 3);
  assert.equal(apiRoutes.length, 2);
});
