import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyDossierSnapshot, createAdvocacyDossierDashboardRoutes, createAdvocacyDossierApiRoutes, createAdvocacyDossierOpsRoutes, createAdvocacyDossierPublicRoutes, createAdvocacyDossierRegistryRoutes, summarizeAdvocacyDossierFixtures } from '../packages/advocacy-dossier/index.mjs';

test('advocacy-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyDossierDashboardRoutes().length, 3);
  assert.equal(createAdvocacyDossierApiRoutes().length, 4);
  assert.equal(createAdvocacyDossierOpsRoutes().length, 3);
  assert.equal(createAdvocacyDossierPublicRoutes().length, 3);
  assert.equal(createAdvocacyDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyDossierFixtures().contacts, 2);
});

