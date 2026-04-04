import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationWatchtowerSnapshot, createCollaborationWatchtowerDashboardRoutes, createCollaborationWatchtowerApiRoutes, createCollaborationWatchtowerOpsRoutes, createCollaborationWatchtowerPublicRoutes, createCollaborationWatchtowerRegistryRoutes, summarizeCollaborationWatchtowerFixtures } from '../packages/collaboration-watchtower/index.mjs';

test('collaboration-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationWatchtowerDashboardRoutes().length, 3);
  assert.equal(createCollaborationWatchtowerApiRoutes().length, 4);
  assert.equal(createCollaborationWatchtowerOpsRoutes().length, 3);
  assert.equal(createCollaborationWatchtowerPublicRoutes().length, 3);
  assert.equal(createCollaborationWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationWatchtowerFixtures().contacts, 2);
});

