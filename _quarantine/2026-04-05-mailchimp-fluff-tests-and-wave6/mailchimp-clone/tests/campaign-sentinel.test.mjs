import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignSentinelSnapshot, createCampaignSentinelDashboardRoutes, createCampaignSentinelApiRoutes, createCampaignSentinelOpsRoutes, createCampaignSentinelPublicRoutes, createCampaignSentinelRegistryRoutes, summarizeCampaignSentinelFixtures } from '../packages/campaign-sentinel/index.mjs';

test('campaign-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignSentinelDashboardRoutes().length, 3);
  assert.equal(createCampaignSentinelApiRoutes().length, 4);
  assert.equal(createCampaignSentinelOpsRoutes().length, 3);
  assert.equal(createCampaignSentinelPublicRoutes().length, 3);
  assert.equal(createCampaignSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignSentinelFixtures().contacts, 2);
});

