import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceDossierSnapshot, createAudienceDossierDashboardRoutes, createAudienceDossierApiRoutes, createAudienceDossierOpsRoutes, createAudienceDossierPublicRoutes, createAudienceDossierRegistryRoutes, summarizeAudienceDossierFixtures } from '../packages/audience-dossier/index.mjs';

test('audience-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceDossierDashboardRoutes().length, 3);
  assert.equal(createAudienceDossierApiRoutes().length, 4);
  assert.equal(createAudienceDossierOpsRoutes().length, 3);
  assert.equal(createAudienceDossierPublicRoutes().length, 3);
  assert.equal(createAudienceDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceDossierFixtures().contacts, 2);
});

