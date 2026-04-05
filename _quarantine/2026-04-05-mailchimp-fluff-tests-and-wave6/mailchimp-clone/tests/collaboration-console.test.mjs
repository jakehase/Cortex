import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationConsoleSnapshot, createCollaborationConsoleDashboardRoutes, createCollaborationConsoleApiRoutes, createCollaborationConsoleOpsRoutes, createCollaborationConsolePublicRoutes, createCollaborationConsoleRegistryRoutes, summarizeCollaborationConsoleFixtures } from '../packages/collaboration-console/index.mjs';

test('collaboration-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationConsoleDashboardRoutes().length, 3);
  assert.equal(createCollaborationConsoleApiRoutes().length, 4);
  assert.equal(createCollaborationConsoleOpsRoutes().length, 3);
  assert.equal(createCollaborationConsolePublicRoutes().length, 3);
  assert.equal(createCollaborationConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationConsoleFixtures().contacts, 2);
});

