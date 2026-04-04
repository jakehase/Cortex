import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeScorecardSnapshot, createCreativeScorecardDashboardRoutes, createCreativeScorecardApiRoutes, createCreativeScorecardOpsRoutes, createCreativeScorecardPublicRoutes, createCreativeScorecardRegistryRoutes, summarizeCreativeScorecardFixtures } from '../packages/creative-scorecard/index.mjs';

test('creative-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeScorecardDashboardRoutes().length, 3);
  assert.equal(createCreativeScorecardApiRoutes().length, 4);
  assert.equal(createCreativeScorecardOpsRoutes().length, 3);
  assert.equal(createCreativeScorecardPublicRoutes().length, 3);
  assert.equal(createCreativeScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeScorecardFixtures().contacts, 2);
});

