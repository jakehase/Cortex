import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentDossierSnapshot, createConsentDossierDashboardRoutes, createConsentDossierApiRoutes, createConsentDossierOpsRoutes, createConsentDossierPublicRoutes, createConsentDossierRegistryRoutes, summarizeConsentDossierFixtures } from '../packages/consent-dossier/index.mjs';

test('consent-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentDossierDashboardRoutes().length, 3);
  assert.equal(createConsentDossierApiRoutes().length, 4);
  assert.equal(createConsentDossierOpsRoutes().length, 3);
  assert.equal(createConsentDossierPublicRoutes().length, 3);
  assert.equal(createConsentDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentDossierFixtures().contacts, 2);
});

