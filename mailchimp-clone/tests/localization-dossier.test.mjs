import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationDossierSnapshot, createLocalizationDossierDashboardRoutes, createLocalizationDossierApiRoutes, createLocalizationDossierOpsRoutes, createLocalizationDossierPublicRoutes, createLocalizationDossierRegistryRoutes, summarizeLocalizationDossierFixtures } from '../packages/localization-dossier/index.mjs';

test('localization-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationDossierDashboardRoutes().length, 3);
  assert.equal(createLocalizationDossierApiRoutes().length, 4);
  assert.equal(createLocalizationDossierOpsRoutes().length, 3);
  assert.equal(createLocalizationDossierPublicRoutes().length, 3);
  assert.equal(createLocalizationDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationDossierFixtures().contacts, 2);
});

