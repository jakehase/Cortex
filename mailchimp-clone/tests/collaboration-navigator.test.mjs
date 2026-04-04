import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationNavigatorSnapshot, createCollaborationNavigatorDashboardRoutes, createCollaborationNavigatorApiRoutes, createCollaborationNavigatorOpsRoutes, createCollaborationNavigatorPublicRoutes, createCollaborationNavigatorRegistryRoutes, summarizeCollaborationNavigatorFixtures } from '../packages/collaboration-navigator/index.mjs';

test('collaboration-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationNavigatorDashboardRoutes().length, 3);
  assert.equal(createCollaborationNavigatorApiRoutes().length, 4);
  assert.equal(createCollaborationNavigatorOpsRoutes().length, 3);
  assert.equal(createCollaborationNavigatorPublicRoutes().length, 3);
  assert.equal(createCollaborationNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationNavigatorFixtures().contacts, 2);
});

