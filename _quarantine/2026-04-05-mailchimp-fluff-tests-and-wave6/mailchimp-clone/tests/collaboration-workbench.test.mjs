import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationWorkbenchSnapshot, createCollaborationWorkbenchDashboardRoutes, createCollaborationWorkbenchApiRoutes, createCollaborationWorkbenchOpsRoutes, createCollaborationWorkbenchPublicRoutes, createCollaborationWorkbenchRegistryRoutes, summarizeCollaborationWorkbenchFixtures } from '../packages/collaboration-workbench/index.mjs';

test('collaboration-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationWorkbenchDashboardRoutes().length, 3);
  assert.equal(createCollaborationWorkbenchApiRoutes().length, 4);
  assert.equal(createCollaborationWorkbenchOpsRoutes().length, 3);
  assert.equal(createCollaborationWorkbenchPublicRoutes().length, 3);
  assert.equal(createCollaborationWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationWorkbenchFixtures().contacts, 2);
});

