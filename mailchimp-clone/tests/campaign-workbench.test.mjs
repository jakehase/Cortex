import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignWorkbenchSnapshot, createCampaignWorkbenchDashboardRoutes, createCampaignWorkbenchApiRoutes, createCampaignWorkbenchOpsRoutes, createCampaignWorkbenchPublicRoutes, createCampaignWorkbenchRegistryRoutes, summarizeCampaignWorkbenchFixtures } from '../packages/campaign-workbench/index.mjs';

test('campaign-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignWorkbenchDashboardRoutes().length, 3);
  assert.equal(createCampaignWorkbenchApiRoutes().length, 4);
  assert.equal(createCampaignWorkbenchOpsRoutes().length, 3);
  assert.equal(createCampaignWorkbenchPublicRoutes().length, 3);
  assert.equal(createCampaignWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignWorkbenchFixtures().contacts, 2);
});

