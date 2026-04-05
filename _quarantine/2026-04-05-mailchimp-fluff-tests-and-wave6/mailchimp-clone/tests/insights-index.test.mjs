import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsIndexSnapshot, createInsightsIndexDashboardRoutes, createInsightsIndexApiRoutes, createInsightsIndexOpsRoutes, createInsightsIndexPublicRoutes, createInsightsIndexRegistryRoutes, summarizeInsightsIndexFixtures } from '../packages/insights-index/index.mjs';

test('insights-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsIndexDashboardRoutes().length, 3);
  assert.equal(createInsightsIndexApiRoutes().length, 4);
  assert.equal(createInsightsIndexOpsRoutes().length, 3);
  assert.equal(createInsightsIndexPublicRoutes().length, 3);
  assert.equal(createInsightsIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsIndexFixtures().contacts, 2);
});

