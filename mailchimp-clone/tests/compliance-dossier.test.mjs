import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceDossierSnapshot, createComplianceDossierDashboardRoutes, createComplianceDossierApiRoutes, createComplianceDossierOpsRoutes, createComplianceDossierPublicRoutes, createComplianceDossierRegistryRoutes, summarizeComplianceDossierFixtures } from '../packages/compliance-dossier/index.mjs';

test('compliance-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceDossierDashboardRoutes().length, 3);
  assert.equal(createComplianceDossierApiRoutes().length, 4);
  assert.equal(createComplianceDossierOpsRoutes().length, 3);
  assert.equal(createComplianceDossierPublicRoutes().length, 3);
  assert.equal(createComplianceDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceDossierFixtures().contacts, 2);
});

