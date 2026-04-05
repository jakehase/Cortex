import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityDossierSnapshot, createDeliverabilityDossierDashboardRoutes, createDeliverabilityDossierApiRoutes, createDeliverabilityDossierOpsRoutes, createDeliverabilityDossierPublicRoutes, createDeliverabilityDossierRegistryRoutes, summarizeDeliverabilityDossierFixtures } from '../packages/deliverability-dossier/index.mjs';

test('deliverability-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityDossierDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityDossierApiRoutes().length, 4);
  assert.equal(createDeliverabilityDossierOpsRoutes().length, 3);
  assert.equal(createDeliverabilityDossierPublicRoutes().length, 3);
  assert.equal(createDeliverabilityDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityDossierFixtures().contacts, 2);
});

