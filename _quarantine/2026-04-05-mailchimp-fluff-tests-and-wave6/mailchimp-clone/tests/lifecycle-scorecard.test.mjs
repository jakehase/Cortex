import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleScorecardSnapshot, createLifecycleScorecardDashboardRoutes, createLifecycleScorecardApiRoutes, createLifecycleScorecardOpsRoutes, createLifecycleScorecardPublicRoutes, createLifecycleScorecardRegistryRoutes, summarizeLifecycleScorecardFixtures } from '../packages/lifecycle-scorecard/index.mjs';

test('lifecycle-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleScorecardDashboardRoutes().length, 3);
  assert.equal(createLifecycleScorecardApiRoutes().length, 4);
  assert.equal(createLifecycleScorecardOpsRoutes().length, 3);
  assert.equal(createLifecycleScorecardPublicRoutes().length, 3);
  assert.equal(createLifecycleScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleScorecardFixtures().contacts, 2);
});

