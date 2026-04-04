import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignAdvisorSnapshot, createCampaignAdvisorDashboardRoutes, createCampaignAdvisorApiRoutes, createCampaignAdvisorOpsRoutes, createCampaignAdvisorPublicRoutes, createCampaignAdvisorRegistryRoutes, summarizeCampaignAdvisorFixtures } from '../packages/campaign-advisor/index.mjs';

test('campaign-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignAdvisorDashboardRoutes().length, 3);
  assert.equal(createCampaignAdvisorApiRoutes().length, 4);
  assert.equal(createCampaignAdvisorOpsRoutes().length, 3);
  assert.equal(createCampaignAdvisorPublicRoutes().length, 3);
  assert.equal(createCampaignAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignAdvisorFixtures().contacts, 2);
});

