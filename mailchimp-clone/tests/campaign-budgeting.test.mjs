import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignBudgetingSnapshot, createCampaignBudgetingDashboardRoutes, createCampaignBudgetingApiRoutes, createCampaignBudgetingOpsRoutes, createCampaignBudgetingPublicRoutes, summarizeCampaignBudgetingFixtures } from '../packages/campaign-budgeting/index.mjs';

test('campaign-budgeting package deepens continuation breadth and route catalogs', () => {
  const snapshot = buildCampaignBudgetingSnapshot('Continuation Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Continuation Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignBudgetingDashboardRoutes().length, 3);
  assert.equal(createCampaignBudgetingApiRoutes().length, 3);
  assert.equal(createCampaignBudgetingOpsRoutes().length, 3);
  assert.equal(createCampaignBudgetingPublicRoutes().length, 3);
  assert.equal(summarizeCampaignBudgetingFixtures().contacts, 2);
});
