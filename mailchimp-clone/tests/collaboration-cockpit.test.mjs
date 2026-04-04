import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationCockpitSnapshot, createCollaborationCockpitDashboardRoutes, createCollaborationCockpitApiRoutes, createCollaborationCockpitOpsRoutes, createCollaborationCockpitPublicRoutes, createCollaborationCockpitRegistryRoutes, summarizeCollaborationCockpitFixtures } from '../packages/collaboration-cockpit/index.mjs';

test('collaboration-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationCockpitDashboardRoutes().length, 3);
  assert.equal(createCollaborationCockpitApiRoutes().length, 4);
  assert.equal(createCollaborationCockpitOpsRoutes().length, 3);
  assert.equal(createCollaborationCockpitPublicRoutes().length, 3);
  assert.equal(createCollaborationCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationCockpitFixtures().contacts, 2);
});

