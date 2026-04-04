import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyScorecardSnapshot, createLoyaltyScorecardDashboardRoutes, createLoyaltyScorecardApiRoutes, createLoyaltyScorecardOpsRoutes, createLoyaltyScorecardPublicRoutes, createLoyaltyScorecardRegistryRoutes, summarizeLoyaltyScorecardFixtures } from '../packages/loyalty-scorecard/index.mjs';

test('loyalty-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyScorecardDashboardRoutes().length, 3);
  assert.equal(createLoyaltyScorecardApiRoutes().length, 4);
  assert.equal(createLoyaltyScorecardOpsRoutes().length, 3);
  assert.equal(createLoyaltyScorecardPublicRoutes().length, 3);
  assert.equal(createLoyaltyScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyScorecardFixtures().contacts, 2);
});

