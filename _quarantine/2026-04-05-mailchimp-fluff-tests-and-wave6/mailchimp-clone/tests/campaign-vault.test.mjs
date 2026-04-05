import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignVaultSnapshot, createCampaignVaultDashboardRoutes, createCampaignVaultApiRoutes, createCampaignVaultOpsRoutes, createCampaignVaultPublicRoutes, createCampaignVaultRegistryRoutes, summarizeCampaignVaultFixtures } from '../packages/campaign-vault/index.mjs';

test('campaign-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignVaultDashboardRoutes().length, 3);
  assert.equal(createCampaignVaultApiRoutes().length, 4);
  assert.equal(createCampaignVaultOpsRoutes().length, 3);
  assert.equal(createCampaignVaultPublicRoutes().length, 3);
  assert.equal(createCampaignVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignVaultFixtures().contacts, 2);
});

