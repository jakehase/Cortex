import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationDossierSnapshot, createAutomationDossierDashboardRoutes, createAutomationDossierApiRoutes, createAutomationDossierOpsRoutes, createAutomationDossierPublicRoutes, createAutomationDossierRegistryRoutes, summarizeAutomationDossierFixtures } from '../packages/automation-dossier/index.mjs';

test('automation-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationDossierDashboardRoutes().length, 3);
  assert.equal(createAutomationDossierApiRoutes().length, 4);
  assert.equal(createAutomationDossierOpsRoutes().length, 3);
  assert.equal(createAutomationDossierPublicRoutes().length, 3);
  assert.equal(createAutomationDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationDossierFixtures().contacts, 2);
});

