import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleDossierSnapshot, createLifecycleDossierDashboardRoutes, createLifecycleDossierApiRoutes, createLifecycleDossierOpsRoutes, createLifecycleDossierPublicRoutes, createLifecycleDossierRegistryRoutes, summarizeLifecycleDossierFixtures } from '../packages/lifecycle-dossier/index.mjs';

test('lifecycle-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleDossierDashboardRoutes().length, 3);
  assert.equal(createLifecycleDossierApiRoutes().length, 4);
  assert.equal(createLifecycleDossierOpsRoutes().length, 3);
  assert.equal(createLifecycleDossierPublicRoutes().length, 3);
  assert.equal(createLifecycleDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleDossierFixtures().contacts, 2);
});

