import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollaborationScorecardSnapshot, createCollaborationScorecardDashboardRoutes, createCollaborationScorecardApiRoutes, createCollaborationScorecardOpsRoutes, createCollaborationScorecardPublicRoutes, createCollaborationScorecardRegistryRoutes, summarizeCollaborationScorecardFixtures } from '../packages/collaboration-scorecard/index.mjs';

test('collaboration-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCollaborationScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCollaborationScorecardDashboardRoutes().length, 3);
  assert.equal(createCollaborationScorecardApiRoutes().length, 4);
  assert.equal(createCollaborationScorecardOpsRoutes().length, 3);
  assert.equal(createCollaborationScorecardPublicRoutes().length, 3);
  assert.equal(createCollaborationScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCollaborationScorecardFixtures().contacts, 2);
});

