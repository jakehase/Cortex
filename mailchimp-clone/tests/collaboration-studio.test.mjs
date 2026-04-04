import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationStudioSnapshot, createCollaborationStudioDashboardRoutes, createCollaborationStudioApiRoutes, createCollaborationStudioOpsRoutes, createCollaborationStudioPublicRoutes, createCollaborationStudioRegistryRoutes, summarizeCollaborationStudioFixtures } from '../packages/collaboration-studio/index.mjs';

test('collaboration-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationStudioDashboardRoutes().length, 3);
  assert.equal(createCollaborationStudioApiRoutes().length, 4);
  assert.equal(createCollaborationStudioOpsRoutes().length, 3);
  assert.equal(createCollaborationStudioPublicRoutes().length, 3);
  assert.equal(createCollaborationStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationStudioFixtures().contacts, 2);
});

