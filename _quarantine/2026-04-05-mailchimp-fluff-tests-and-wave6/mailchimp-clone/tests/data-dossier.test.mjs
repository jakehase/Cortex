import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataDossierSnapshot, createDataDossierDashboardRoutes, createDataDossierApiRoutes, createDataDossierOpsRoutes, createDataDossierPublicRoutes, createDataDossierRegistryRoutes, summarizeDataDossierFixtures } from '../packages/data-dossier/index.mjs';

test('data-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataDossierDashboardRoutes().length, 3);
  assert.equal(createDataDossierApiRoutes().length, 4);
  assert.equal(createDataDossierOpsRoutes().length, 3);
  assert.equal(createDataDossierPublicRoutes().length, 3);
  assert.equal(createDataDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataDossierFixtures().contacts, 2);
});

