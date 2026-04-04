import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignExchangeSnapshot, createCampaignExchangeDashboardRoutes, createCampaignExchangeApiRoutes, createCampaignExchangeOpsRoutes, createCampaignExchangePublicRoutes, createCampaignExchangeRegistryRoutes, summarizeCampaignExchangeFixtures } from '../packages/campaign-exchange/index.mjs';

test('campaign-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignExchangeDashboardRoutes().length, 3);
  assert.equal(createCampaignExchangeApiRoutes().length, 4);
  assert.equal(createCampaignExchangeOpsRoutes().length, 3);
  assert.equal(createCampaignExchangePublicRoutes().length, 3);
  assert.equal(createCampaignExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignExchangeFixtures().contacts, 2);
});

