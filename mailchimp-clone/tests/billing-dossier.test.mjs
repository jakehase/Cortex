import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingDossierSnapshot, createBillingDossierDashboardRoutes, createBillingDossierApiRoutes, createBillingDossierOpsRoutes, createBillingDossierPublicRoutes, createBillingDossierRegistryRoutes, summarizeBillingDossierFixtures } from '../packages/billing-dossier/index.mjs';

test('billing-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingDossierDashboardRoutes().length, 3);
  assert.equal(createBillingDossierApiRoutes().length, 4);
  assert.equal(createBillingDossierOpsRoutes().length, 3);
  assert.equal(createBillingDossierPublicRoutes().length, 3);
  assert.equal(createBillingDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingDossierFixtures().contacts, 2);
});

