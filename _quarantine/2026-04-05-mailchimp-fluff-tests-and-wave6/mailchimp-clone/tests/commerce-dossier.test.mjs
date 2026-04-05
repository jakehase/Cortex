import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceDossierSnapshot, createCommerceDossierDashboardRoutes, createCommerceDossierApiRoutes, createCommerceDossierOpsRoutes, createCommerceDossierPublicRoutes, createCommerceDossierRegistryRoutes, summarizeCommerceDossierFixtures } from '../packages/commerce-dossier/index.mjs';

test('commerce-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceDossierDashboardRoutes().length, 3);
  assert.equal(createCommerceDossierApiRoutes().length, 4);
  assert.equal(createCommerceDossierOpsRoutes().length, 3);
  assert.equal(createCommerceDossierPublicRoutes().length, 3);
  assert.equal(createCommerceDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceDossierFixtures().contacts, 2);
});

