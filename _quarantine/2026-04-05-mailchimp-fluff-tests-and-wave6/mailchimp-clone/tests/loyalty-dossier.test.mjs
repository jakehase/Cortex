import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyDossierSnapshot, createLoyaltyDossierDashboardRoutes, createLoyaltyDossierApiRoutes, createLoyaltyDossierOpsRoutes, createLoyaltyDossierPublicRoutes, createLoyaltyDossierRegistryRoutes, summarizeLoyaltyDossierFixtures } from '../packages/loyalty-dossier/index.mjs';

test('loyalty-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyDossierDashboardRoutes().length, 3);
  assert.equal(createLoyaltyDossierApiRoutes().length, 4);
  assert.equal(createLoyaltyDossierOpsRoutes().length, 3);
  assert.equal(createLoyaltyDossierPublicRoutes().length, 3);
  assert.equal(createLoyaltyDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyDossierFixtures().contacts, 2);
});

