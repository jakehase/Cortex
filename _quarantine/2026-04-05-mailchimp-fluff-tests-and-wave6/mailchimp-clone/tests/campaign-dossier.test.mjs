import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignDossierSnapshot, createCampaignDossierDashboardRoutes, createCampaignDossierApiRoutes, createCampaignDossierOpsRoutes, createCampaignDossierPublicRoutes, createCampaignDossierRegistryRoutes, summarizeCampaignDossierFixtures } from '../packages/campaign-dossier/index.mjs';

test('campaign-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCampaignDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCampaignDossierDashboardRoutes().length, 3);
  assert.equal(createCampaignDossierApiRoutes().length, 4);
  assert.equal(createCampaignDossierOpsRoutes().length, 3);
  assert.equal(createCampaignDossierPublicRoutes().length, 3);
  assert.equal(createCampaignDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCampaignDossierFixtures().contacts, 2);
});

