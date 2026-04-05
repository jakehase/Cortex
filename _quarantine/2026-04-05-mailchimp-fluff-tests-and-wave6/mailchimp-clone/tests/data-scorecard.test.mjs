import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataScorecardSnapshot, createDataScorecardDashboardRoutes, createDataScorecardApiRoutes, createDataScorecardOpsRoutes, createDataScorecardPublicRoutes, createDataScorecardRegistryRoutes, summarizeDataScorecardFixtures } from '../packages/data-scorecard/index.mjs';

test('data-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataScorecardDashboardRoutes().length, 3);
  assert.equal(createDataScorecardApiRoutes().length, 4);
  assert.equal(createDataScorecardOpsRoutes().length, 3);
  assert.equal(createDataScorecardPublicRoutes().length, 3);
  assert.equal(createDataScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataScorecardFixtures().contacts, 2);
});

