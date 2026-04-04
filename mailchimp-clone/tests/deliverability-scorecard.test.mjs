import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityScorecardSnapshot, createDeliverabilityScorecardDashboardRoutes, createDeliverabilityScorecardApiRoutes, createDeliverabilityScorecardOpsRoutes, createDeliverabilityScorecardPublicRoutes, createDeliverabilityScorecardRegistryRoutes, summarizeDeliverabilityScorecardFixtures } from '../packages/deliverability-scorecard/index.mjs';

test('deliverability-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityScorecardDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityScorecardApiRoutes().length, 4);
  assert.equal(createDeliverabilityScorecardOpsRoutes().length, 3);
  assert.equal(createDeliverabilityScorecardPublicRoutes().length, 3);
  assert.equal(createDeliverabilityScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityScorecardFixtures().contacts, 2);
});

