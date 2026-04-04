import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationHubSnapshot, createCollaborationHubDashboardRoutes, createCollaborationHubApiRoutes, createCollaborationHubOpsRoutes, createCollaborationHubPublicRoutes, createCollaborationHubRegistryRoutes, summarizeCollaborationHubFixtures } from '../packages/collaboration-hub/index.mjs';

test('collaboration-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationHubDashboardRoutes().length, 3);
  assert.equal(createCollaborationHubApiRoutes().length, 4);
  assert.equal(createCollaborationHubOpsRoutes().length, 3);
  assert.equal(createCollaborationHubPublicRoutes().length, 3);
  assert.equal(createCollaborationHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationHubFixtures().contacts, 2);
});

