import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeDossierSnapshot, createCreativeDossierDashboardRoutes, createCreativeDossierApiRoutes, createCreativeDossierOpsRoutes, createCreativeDossierPublicRoutes, createCreativeDossierRegistryRoutes, summarizeCreativeDossierFixtures } from '../packages/creative-dossier/index.mjs';

test('creative-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeDossierDashboardRoutes().length, 3);
  assert.equal(createCreativeDossierApiRoutes().length, 4);
  assert.equal(createCreativeDossierOpsRoutes().length, 3);
  assert.equal(createCreativeDossierPublicRoutes().length, 3);
  assert.equal(createCreativeDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeDossierFixtures().contacts, 2);
});

