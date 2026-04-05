import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignStudioSnapshot, createCampaignStudioDashboardRoutes, createCampaignStudioApiRoutes, createCampaignStudioOpsRoutes, createCampaignStudioPublicRoutes, createCampaignStudioRegistryRoutes, summarizeCampaignStudioFixtures } from '../packages/campaign-studio/index.mjs';

test('campaign-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignStudioDashboardRoutes().length, 3);
  assert.equal(createCampaignStudioApiRoutes().length, 4);
  assert.equal(createCampaignStudioOpsRoutes().length, 3);
  assert.equal(createCampaignStudioPublicRoutes().length, 3);
  assert.equal(createCampaignStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignStudioFixtures().contacts, 2);
});

