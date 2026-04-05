import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsDossierSnapshot, createIntegrationsDossierDashboardRoutes, createIntegrationsDossierApiRoutes, createIntegrationsDossierOpsRoutes, createIntegrationsDossierPublicRoutes, createIntegrationsDossierRegistryRoutes, summarizeIntegrationsDossierFixtures } from '../packages/integrations-dossier/index.mjs';

test('integrations-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsDossierDashboardRoutes().length, 3);
  assert.equal(createIntegrationsDossierApiRoutes().length, 4);
  assert.equal(createIntegrationsDossierOpsRoutes().length, 3);
  assert.equal(createIntegrationsDossierPublicRoutes().length, 3);
  assert.equal(createIntegrationsDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsDossierFixtures().contacts, 2);
});

