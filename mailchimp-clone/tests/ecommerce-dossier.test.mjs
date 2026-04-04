import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceDossierSnapshot, createEcommerceDossierDashboardRoutes, createEcommerceDossierApiRoutes, createEcommerceDossierOpsRoutes, createEcommerceDossierPublicRoutes, createEcommerceDossierRegistryRoutes, summarizeEcommerceDossierFixtures } from '../packages/ecommerce-dossier/index.mjs';

test('ecommerce-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceDossierDashboardRoutes().length, 3);
  assert.equal(createEcommerceDossierApiRoutes().length, 4);
  assert.equal(createEcommerceDossierOpsRoutes().length, 3);
  assert.equal(createEcommerceDossierPublicRoutes().length, 3);
  assert.equal(createEcommerceDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceDossierFixtures().contacts, 2);
});

