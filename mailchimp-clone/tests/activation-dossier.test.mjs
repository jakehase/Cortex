import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationDossierSnapshot, createActivationDossierDashboardRoutes, createActivationDossierApiRoutes, createActivationDossierOpsRoutes, createActivationDossierPublicRoutes, createActivationDossierRegistryRoutes, summarizeActivationDossierFixtures } from '../packages/activation-dossier/index.mjs';

test('activation-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationDossierDashboardRoutes().length, 3);
  assert.equal(createActivationDossierApiRoutes().length, 4);
  assert.equal(createActivationDossierOpsRoutes().length, 3);
  assert.equal(createActivationDossierPublicRoutes().length, 3);
  assert.equal(createActivationDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationDossierFixtures().contacts, 2);
});

