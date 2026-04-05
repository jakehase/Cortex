import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerDossierSnapshot, createCustomerDossierDashboardRoutes, createCustomerDossierApiRoutes, createCustomerDossierOpsRoutes, createCustomerDossierPublicRoutes, createCustomerDossierRegistryRoutes, summarizeCustomerDossierFixtures } from '../packages/customer-dossier/index.mjs';

test('customer-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerDossierDashboardRoutes().length, 3);
  assert.equal(createCustomerDossierApiRoutes().length, 4);
  assert.equal(createCustomerDossierOpsRoutes().length, 3);
  assert.equal(createCustomerDossierPublicRoutes().length, 3);
  assert.equal(createCustomerDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerDossierFixtures().contacts, 2);
});

