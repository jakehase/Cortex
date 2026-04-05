import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignScorecardSnapshot, createCampaignScorecardDashboardRoutes, createCampaignScorecardApiRoutes, createCampaignScorecardOpsRoutes, createCampaignScorecardPublicRoutes, createCampaignScorecardRegistryRoutes, summarizeCampaignScorecardFixtures } from '../packages/campaign-scorecard/index.mjs';

test('campaign-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignScorecardDashboardRoutes().length, 3);
  assert.equal(createCampaignScorecardApiRoutes().length, 4);
  assert.equal(createCampaignScorecardOpsRoutes().length, 3);
  assert.equal(createCampaignScorecardPublicRoutes().length, 3);
  assert.equal(createCampaignScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignScorecardFixtures().contacts, 2);
});

