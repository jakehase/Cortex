import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationGridSnapshot, createCollaborationGridDashboardRoutes, createCollaborationGridApiRoutes, createCollaborationGridOpsRoutes, createCollaborationGridPublicRoutes, createCollaborationGridRegistryRoutes, summarizeCollaborationGridFixtures } from '../packages/collaboration-grid/index.mjs';

test('collaboration-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationGridDashboardRoutes().length, 3);
  assert.equal(createCollaborationGridApiRoutes().length, 4);
  assert.equal(createCollaborationGridOpsRoutes().length, 3);
  assert.equal(createCollaborationGridPublicRoutes().length, 3);
  assert.equal(createCollaborationGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationGridFixtures().contacts, 2);
});

