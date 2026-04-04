import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignSandboxesSnapshot, createCampaignSandboxesDashboardRoutes, createCampaignSandboxesApiRoutes, createCampaignSandboxesOpsRoutes, createCampaignSandboxesPublicRoutes, summarizeCampaignSandboxesFixtures } from '../packages/campaign-sandboxes/index.mjs';

test('campaign-sandboxes package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildCampaignSandboxesSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignSandboxesDashboardRoutes().length, 3);
  assert.equal(createCampaignSandboxesApiRoutes().length, 3);
  assert.equal(createCampaignSandboxesOpsRoutes().length, 3);
  assert.equal(createCampaignSandboxesPublicRoutes().length, 3);
  assert.equal(summarizeCampaignSandboxesFixtures().contacts, 2);
});

