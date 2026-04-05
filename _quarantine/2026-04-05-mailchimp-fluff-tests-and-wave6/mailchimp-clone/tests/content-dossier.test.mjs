import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentDossierSnapshot, createContentDossierDashboardRoutes, createContentDossierApiRoutes, createContentDossierOpsRoutes, createContentDossierPublicRoutes, createContentDossierRegistryRoutes, summarizeContentDossierFixtures } from '../packages/content-dossier/index.mjs';

test('content-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentDossierDashboardRoutes().length, 3);
  assert.equal(createContentDossierApiRoutes().length, 4);
  assert.equal(createContentDossierOpsRoutes().length, 3);
  assert.equal(createContentDossierPublicRoutes().length, 3);
  assert.equal(createContentDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentDossierFixtures().contacts, 2);
});

