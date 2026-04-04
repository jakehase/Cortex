import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceScorecardSnapshot, createCommerceScorecardDashboardRoutes, createCommerceScorecardApiRoutes, createCommerceScorecardOpsRoutes, createCommerceScorecardPublicRoutes, createCommerceScorecardRegistryRoutes, summarizeCommerceScorecardFixtures } from '../packages/commerce-scorecard/index.mjs';

test('commerce-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceScorecardDashboardRoutes().length, 3);
  assert.equal(createCommerceScorecardApiRoutes().length, 4);
  assert.equal(createCommerceScorecardOpsRoutes().length, 3);
  assert.equal(createCommerceScorecardPublicRoutes().length, 3);
  assert.equal(createCommerceScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceScorecardFixtures().contacts, 2);
});

