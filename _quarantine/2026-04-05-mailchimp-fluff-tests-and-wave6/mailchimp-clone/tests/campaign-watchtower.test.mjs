import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignWatchtowerSnapshot, createCampaignWatchtowerDashboardRoutes, createCampaignWatchtowerApiRoutes, createCampaignWatchtowerOpsRoutes, createCampaignWatchtowerPublicRoutes, createCampaignWatchtowerRegistryRoutes, summarizeCampaignWatchtowerFixtures } from '../packages/campaign-watchtower/index.mjs';

test('campaign-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignWatchtowerDashboardRoutes().length, 3);
  assert.equal(createCampaignWatchtowerApiRoutes().length, 4);
  assert.equal(createCampaignWatchtowerOpsRoutes().length, 3);
  assert.equal(createCampaignWatchtowerPublicRoutes().length, 3);
  assert.equal(createCampaignWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignWatchtowerFixtures().contacts, 2);
});

