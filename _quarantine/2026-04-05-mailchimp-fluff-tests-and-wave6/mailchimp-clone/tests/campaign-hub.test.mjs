import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignHubSnapshot, createCampaignHubDashboardRoutes, createCampaignHubApiRoutes, createCampaignHubOpsRoutes, createCampaignHubPublicRoutes, createCampaignHubRegistryRoutes, summarizeCampaignHubFixtures } from '../packages/campaign-hub/index.mjs';

test('campaign-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignHubDashboardRoutes().length, 3);
  assert.equal(createCampaignHubApiRoutes().length, 4);
  assert.equal(createCampaignHubOpsRoutes().length, 3);
  assert.equal(createCampaignHubPublicRoutes().length, 3);
  assert.equal(createCampaignHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignHubFixtures().contacts, 2);
});

