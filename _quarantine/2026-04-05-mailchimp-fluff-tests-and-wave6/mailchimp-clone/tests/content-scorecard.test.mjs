import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentScorecardSnapshot, createContentScorecardDashboardRoutes, createContentScorecardApiRoutes, createContentScorecardOpsRoutes, createContentScorecardPublicRoutes, createContentScorecardRegistryRoutes, summarizeContentScorecardFixtures } from '../packages/content-scorecard/index.mjs';

test('content-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentScorecardDashboardRoutes().length, 3);
  assert.equal(createContentScorecardApiRoutes().length, 4);
  assert.equal(createContentScorecardOpsRoutes().length, 3);
  assert.equal(createContentScorecardPublicRoutes().length, 3);
  assert.equal(createContentScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentScorecardFixtures().contacts, 2);
});

