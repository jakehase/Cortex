import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationAtlasSnapshot, createCollaborationAtlasDashboardRoutes, createCollaborationAtlasApiRoutes, createCollaborationAtlasOpsRoutes, createCollaborationAtlasPublicRoutes, createCollaborationAtlasRegistryRoutes, summarizeCollaborationAtlasFixtures } from '../packages/collaboration-atlas/index.mjs';

test('collaboration-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationAtlasDashboardRoutes().length, 3);
  assert.equal(createCollaborationAtlasApiRoutes().length, 4);
  assert.equal(createCollaborationAtlasOpsRoutes().length, 3);
  assert.equal(createCollaborationAtlasPublicRoutes().length, 3);
  assert.equal(createCollaborationAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationAtlasFixtures().contacts, 2);
});

