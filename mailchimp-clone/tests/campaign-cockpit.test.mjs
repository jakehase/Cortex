import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignCockpitSnapshot, createCampaignCockpitDashboardRoutes, createCampaignCockpitApiRoutes, createCampaignCockpitOpsRoutes, createCampaignCockpitPublicRoutes, createCampaignCockpitRegistryRoutes, summarizeCampaignCockpitFixtures } from '../packages/campaign-cockpit/index.mjs';

test('campaign-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignCockpitDashboardRoutes().length, 3);
  assert.equal(createCampaignCockpitApiRoutes().length, 4);
  assert.equal(createCampaignCockpitOpsRoutes().length, 3);
  assert.equal(createCampaignCockpitPublicRoutes().length, 3);
  assert.equal(createCampaignCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignCockpitFixtures().contacts, 2);
});

