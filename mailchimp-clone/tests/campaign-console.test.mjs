import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignConsoleSnapshot, createCampaignConsoleDashboardRoutes, createCampaignConsoleApiRoutes, createCampaignConsoleOpsRoutes, createCampaignConsolePublicRoutes, createCampaignConsoleRegistryRoutes, summarizeCampaignConsoleFixtures } from '../packages/campaign-console/index.mjs';

test('campaign-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignConsoleDashboardRoutes().length, 3);
  assert.equal(createCampaignConsoleApiRoutes().length, 4);
  assert.equal(createCampaignConsoleOpsRoutes().length, 3);
  assert.equal(createCampaignConsolePublicRoutes().length, 3);
  assert.equal(createCampaignConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignConsoleFixtures().contacts, 2);
});

