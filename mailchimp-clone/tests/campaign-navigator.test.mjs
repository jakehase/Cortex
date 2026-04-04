import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignNavigatorSnapshot, createCampaignNavigatorDashboardRoutes, createCampaignNavigatorApiRoutes, createCampaignNavigatorOpsRoutes, createCampaignNavigatorPublicRoutes, createCampaignNavigatorRegistryRoutes, summarizeCampaignNavigatorFixtures } from '../packages/campaign-navigator/index.mjs';

test('campaign-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignNavigatorDashboardRoutes().length, 3);
  assert.equal(createCampaignNavigatorApiRoutes().length, 4);
  assert.equal(createCampaignNavigatorOpsRoutes().length, 3);
  assert.equal(createCampaignNavigatorPublicRoutes().length, 3);
  assert.equal(createCampaignNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignNavigatorFixtures().contacts, 2);
});

