import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignGridSnapshot, createCampaignGridDashboardRoutes, createCampaignGridApiRoutes, createCampaignGridOpsRoutes, createCampaignGridPublicRoutes, createCampaignGridRegistryRoutes, summarizeCampaignGridFixtures } from '../packages/campaign-grid/index.mjs';

test('campaign-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignGridDashboardRoutes().length, 3);
  assert.equal(createCampaignGridApiRoutes().length, 4);
  assert.equal(createCampaignGridOpsRoutes().length, 3);
  assert.equal(createCampaignGridPublicRoutes().length, 3);
  assert.equal(createCampaignGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignGridFixtures().contacts, 2);
});

