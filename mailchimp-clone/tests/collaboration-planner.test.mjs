import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationPlannerSnapshot, createCollaborationPlannerDashboardRoutes, createCollaborationPlannerApiRoutes, createCollaborationPlannerOpsRoutes, createCollaborationPlannerPublicRoutes, createCollaborationPlannerRegistryRoutes, summarizeCollaborationPlannerFixtures } from '../packages/collaboration-planner/index.mjs';

test('collaboration-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationPlannerDashboardRoutes().length, 3);
  assert.equal(createCollaborationPlannerApiRoutes().length, 4);
  assert.equal(createCollaborationPlannerOpsRoutes().length, 3);
  assert.equal(createCollaborationPlannerPublicRoutes().length, 3);
  assert.equal(createCollaborationPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationPlannerFixtures().contacts, 2);
});

