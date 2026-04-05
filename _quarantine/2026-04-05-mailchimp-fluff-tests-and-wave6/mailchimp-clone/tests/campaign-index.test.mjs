import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignIndexSnapshot, createCampaignIndexDashboardRoutes, createCampaignIndexApiRoutes, createCampaignIndexOpsRoutes, createCampaignIndexPublicRoutes, createCampaignIndexRegistryRoutes, summarizeCampaignIndexFixtures } from '../packages/campaign-index/index.mjs';

test('campaign-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignIndexDashboardRoutes().length, 3);
  assert.equal(createCampaignIndexApiRoutes().length, 4);
  assert.equal(createCampaignIndexOpsRoutes().length, 3);
  assert.equal(createCampaignIndexPublicRoutes().length, 3);
  assert.equal(createCampaignIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignIndexFixtures().contacts, 2);
});

