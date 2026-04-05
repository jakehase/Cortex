import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsCockpitSnapshot, createInsightsCockpitDashboardRoutes, createInsightsCockpitApiRoutes, createInsightsCockpitOpsRoutes, createInsightsCockpitPublicRoutes, createInsightsCockpitRegistryRoutes, summarizeInsightsCockpitFixtures } from '../packages/insights-cockpit/index.mjs';

test('insights-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsCockpitDashboardRoutes().length, 3);
  assert.equal(createInsightsCockpitApiRoutes().length, 4);
  assert.equal(createInsightsCockpitOpsRoutes().length, 3);
  assert.equal(createInsightsCockpitPublicRoutes().length, 3);
  assert.equal(createInsightsCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsCockpitFixtures().contacts, 2);
});

