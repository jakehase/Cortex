import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignNotebookSnapshot, createCampaignNotebookDashboardRoutes, createCampaignNotebookApiRoutes, createCampaignNotebookOpsRoutes, createCampaignNotebookPublicRoutes, createCampaignNotebookRegistryRoutes, summarizeCampaignNotebookFixtures } from '../packages/campaign-notebook/index.mjs';

test('campaign-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignNotebookDashboardRoutes().length, 3);
  assert.equal(createCampaignNotebookApiRoutes().length, 4);
  assert.equal(createCampaignNotebookOpsRoutes().length, 3);
  assert.equal(createCampaignNotebookPublicRoutes().length, 3);
  assert.equal(createCampaignNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignNotebookFixtures().contacts, 2);
});

