import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignFoundrySnapshot, createCampaignFoundryDashboardRoutes, createCampaignFoundryApiRoutes, createCampaignFoundryOpsRoutes, createCampaignFoundryPublicRoutes, createCampaignFoundryRegistryRoutes, summarizeCampaignFoundryFixtures } from '../packages/campaign-foundry/index.mjs';

test('campaign-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignFoundryDashboardRoutes().length, 3);
  assert.equal(createCampaignFoundryApiRoutes().length, 4);
  assert.equal(createCampaignFoundryOpsRoutes().length, 3);
  assert.equal(createCampaignFoundryPublicRoutes().length, 3);
  assert.equal(createCampaignFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignFoundryFixtures().contacts, 2);
});

