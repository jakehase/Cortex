import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationIndexSnapshot, createCollaborationIndexDashboardRoutes, createCollaborationIndexApiRoutes, createCollaborationIndexOpsRoutes, createCollaborationIndexPublicRoutes, createCollaborationIndexRegistryRoutes, summarizeCollaborationIndexFixtures } from '../packages/collaboration-index/index.mjs';

test('collaboration-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationIndexDashboardRoutes().length, 3);
  assert.equal(createCollaborationIndexApiRoutes().length, 4);
  assert.equal(createCollaborationIndexOpsRoutes().length, 3);
  assert.equal(createCollaborationIndexPublicRoutes().length, 3);
  assert.equal(createCollaborationIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationIndexFixtures().contacts, 2);
});

