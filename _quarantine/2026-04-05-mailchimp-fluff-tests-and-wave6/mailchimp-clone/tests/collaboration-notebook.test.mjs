import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationNotebookSnapshot, createCollaborationNotebookDashboardRoutes, createCollaborationNotebookApiRoutes, createCollaborationNotebookOpsRoutes, createCollaborationNotebookPublicRoutes, createCollaborationNotebookRegistryRoutes, summarizeCollaborationNotebookFixtures } from '../packages/collaboration-notebook/index.mjs';

test('collaboration-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationNotebookDashboardRoutes().length, 3);
  assert.equal(createCollaborationNotebookApiRoutes().length, 4);
  assert.equal(createCollaborationNotebookOpsRoutes().length, 3);
  assert.equal(createCollaborationNotebookPublicRoutes().length, 3);
  assert.equal(createCollaborationNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationNotebookFixtures().contacts, 2);
});

