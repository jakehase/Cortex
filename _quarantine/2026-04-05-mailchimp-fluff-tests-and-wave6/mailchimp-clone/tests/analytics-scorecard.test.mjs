import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsScorecardSnapshot, createAnalyticsScorecardDashboardRoutes, createAnalyticsScorecardApiRoutes, createAnalyticsScorecardOpsRoutes, createAnalyticsScorecardPublicRoutes, createAnalyticsScorecardRegistryRoutes, summarizeAnalyticsScorecardFixtures } from '../packages/analytics-scorecard/index.mjs';

test('analytics-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsScorecardDashboardRoutes().length, 3);
  assert.equal(createAnalyticsScorecardApiRoutes().length, 4);
  assert.equal(createAnalyticsScorecardOpsRoutes().length, 3);
  assert.equal(createAnalyticsScorecardPublicRoutes().length, 3);
  assert.equal(createAnalyticsScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsScorecardFixtures().contacts, 2);
});

