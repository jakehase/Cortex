import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationSentinelSnapshot, createCollaborationSentinelDashboardRoutes, createCollaborationSentinelApiRoutes, createCollaborationSentinelOpsRoutes, createCollaborationSentinelPublicRoutes, createCollaborationSentinelRegistryRoutes, summarizeCollaborationSentinelFixtures } from '../packages/collaboration-sentinel/index.mjs';

test('collaboration-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationSentinelDashboardRoutes().length, 3);
  assert.equal(createCollaborationSentinelApiRoutes().length, 4);
  assert.equal(createCollaborationSentinelOpsRoutes().length, 3);
  assert.equal(createCollaborationSentinelPublicRoutes().length, 3);
  assert.equal(createCollaborationSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationSentinelFixtures().contacts, 2);
});

