import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionDossierSnapshot, createAcquisitionDossierDashboardRoutes, createAcquisitionDossierApiRoutes, createAcquisitionDossierOpsRoutes, createAcquisitionDossierPublicRoutes, createAcquisitionDossierRegistryRoutes, summarizeAcquisitionDossierFixtures } from '../packages/acquisition-dossier/index.mjs';

test('acquisition-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionDossierDashboardRoutes().length, 3);
  assert.equal(createAcquisitionDossierApiRoutes().length, 4);
  assert.equal(createAcquisitionDossierOpsRoutes().length, 3);
  assert.equal(createAcquisitionDossierPublicRoutes().length, 3);
  assert.equal(createAcquisitionDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionDossierFixtures().contacts, 2);
});

