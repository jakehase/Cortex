import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationScorecardSnapshot, createActivationScorecardDashboardRoutes, createActivationScorecardApiRoutes, createActivationScorecardOpsRoutes, createActivationScorecardPublicRoutes, createActivationScorecardRegistryRoutes, summarizeActivationScorecardFixtures } from '../packages/activation-scorecard/index.mjs';

test('activation-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationScorecardDashboardRoutes().length, 3);
  assert.equal(createActivationScorecardApiRoutes().length, 4);
  assert.equal(createActivationScorecardOpsRoutes().length, 3);
  assert.equal(createActivationScorecardPublicRoutes().length, 3);
  assert.equal(createActivationScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationScorecardFixtures().contacts, 2);
});

