import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsScorecardSnapshot, createInsightsScorecardDashboardRoutes, createInsightsScorecardApiRoutes, createInsightsScorecardOpsRoutes, createInsightsScorecardPublicRoutes, createInsightsScorecardRegistryRoutes, summarizeInsightsScorecardFixtures } from '../packages/insights-scorecard/index.mjs';

test('insights-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsScorecardDashboardRoutes().length, 3);
  assert.equal(createInsightsScorecardApiRoutes().length, 4);
  assert.equal(createInsightsScorecardOpsRoutes().length, 3);
  assert.equal(createInsightsScorecardPublicRoutes().length, 3);
  assert.equal(createInsightsScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsScorecardFixtures().contacts, 2);
});

