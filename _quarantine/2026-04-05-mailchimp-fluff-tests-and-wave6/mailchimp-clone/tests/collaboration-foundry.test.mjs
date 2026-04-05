import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationFoundrySnapshot, createCollaborationFoundryDashboardRoutes, createCollaborationFoundryApiRoutes, createCollaborationFoundryOpsRoutes, createCollaborationFoundryPublicRoutes, createCollaborationFoundryRegistryRoutes, summarizeCollaborationFoundryFixtures } from '../packages/collaboration-foundry/index.mjs';

test('collaboration-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationFoundryDashboardRoutes().length, 3);
  assert.equal(createCollaborationFoundryApiRoutes().length, 4);
  assert.equal(createCollaborationFoundryOpsRoutes().length, 3);
  assert.equal(createCollaborationFoundryPublicRoutes().length, 3);
  assert.equal(createCollaborationFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationFoundryFixtures().contacts, 2);
});

