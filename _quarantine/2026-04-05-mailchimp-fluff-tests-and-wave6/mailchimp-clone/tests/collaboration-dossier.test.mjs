import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationDossierSnapshot, createCollaborationDossierDashboardRoutes, createCollaborationDossierApiRoutes, createCollaborationDossierOpsRoutes, createCollaborationDossierPublicRoutes, createCollaborationDossierRegistryRoutes, summarizeCollaborationDossierFixtures } from '../packages/collaboration-dossier/index.mjs';

test('collaboration-dossier generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationDossierSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationDossierDashboardRoutes().length, 3);
  assert.equal(createCollaborationDossierApiRoutes().length, 4);
  assert.equal(createCollaborationDossierOpsRoutes().length, 3);
  assert.equal(createCollaborationDossierPublicRoutes().length, 3);
  assert.equal(createCollaborationDossierRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationDossierFixtures().contacts, 2);
});

