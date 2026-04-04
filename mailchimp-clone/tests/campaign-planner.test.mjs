import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignPlannerSnapshot, createCampaignPlannerDashboardRoutes, createCampaignPlannerApiRoutes, createCampaignPlannerOpsRoutes, createCampaignPlannerPublicRoutes, createCampaignPlannerRegistryRoutes, summarizeCampaignPlannerFixtures } from '../packages/campaign-planner/index.mjs';

test('campaign-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignPlannerDashboardRoutes().length, 3);
  assert.equal(createCampaignPlannerApiRoutes().length, 4);
  assert.equal(createCampaignPlannerOpsRoutes().length, 3);
  assert.equal(createCampaignPlannerPublicRoutes().length, 3);
  assert.equal(createCampaignPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignPlannerFixtures().contacts, 2);
});

