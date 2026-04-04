import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionDossierSnapshot, createAttributionDossierDashboardRoutes, createAttributionDossierApiRoutes, createAttributionDossierOpsRoutes, createAttributionDossierPublicRoutes, createAttributionDossierRegistryRoutes, summarizeAttributionDossierFixtures } from '../packages/attribution-dossier/index.mjs';

test('attribution-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionDossierDashboardRoutes().length, 3);
  assert.equal(createAttributionDossierApiRoutes().length, 4);
  assert.equal(createAttributionDossierOpsRoutes().length, 3);
  assert.equal(createAttributionDossierPublicRoutes().length, 3);
  assert.equal(createAttributionDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionDossierFixtures().contacts, 2);
});

