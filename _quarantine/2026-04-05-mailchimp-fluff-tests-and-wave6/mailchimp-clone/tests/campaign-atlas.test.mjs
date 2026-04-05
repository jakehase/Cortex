import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignAtlasSnapshot, createCampaignAtlasDashboardRoutes, createCampaignAtlasApiRoutes, createCampaignAtlasOpsRoutes, createCampaignAtlasPublicRoutes, createCampaignAtlasRegistryRoutes, summarizeCampaignAtlasFixtures } from '../packages/campaign-atlas/index.mjs';

test('campaign-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignAtlasDashboardRoutes().length, 3);
  assert.equal(createCampaignAtlasApiRoutes().length, 4);
  assert.equal(createCampaignAtlasOpsRoutes().length, 3);
  assert.equal(createCampaignAtlasPublicRoutes().length, 3);
  assert.equal(createCampaignAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignAtlasFixtures().contacts, 2);
});

