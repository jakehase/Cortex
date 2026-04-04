import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationDossierSnapshot, createExperimentationDossierDashboardRoutes, createExperimentationDossierApiRoutes, createExperimentationDossierOpsRoutes, createExperimentationDossierPublicRoutes, createExperimentationDossierRegistryRoutes, summarizeExperimentationDossierFixtures } from '../packages/experimentation-dossier/index.mjs';

test('experimentation-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationDossierDashboardRoutes().length, 3);
  assert.equal(createExperimentationDossierApiRoutes().length, 4);
  assert.equal(createExperimentationDossierOpsRoutes().length, 3);
  assert.equal(createExperimentationDossierPublicRoutes().length, 3);
  assert.equal(createExperimentationDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationDossierFixtures().contacts, 2);
});

