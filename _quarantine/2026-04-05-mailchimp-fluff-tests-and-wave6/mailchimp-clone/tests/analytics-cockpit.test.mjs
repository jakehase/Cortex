import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsCockpitSnapshot, createAnalyticsCockpitDashboardRoutes, createAnalyticsCockpitApiRoutes, createAnalyticsCockpitOpsRoutes, createAnalyticsCockpitPublicRoutes, createAnalyticsCockpitRegistryRoutes, summarizeAnalyticsCockpitFixtures } from '../packages/analytics-cockpit/index.mjs';

test('analytics-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsCockpitDashboardRoutes().length, 3);
  assert.equal(createAnalyticsCockpitApiRoutes().length, 4);
  assert.equal(createAnalyticsCockpitOpsRoutes().length, 3);
  assert.equal(createAnalyticsCockpitPublicRoutes().length, 3);
  assert.equal(createAnalyticsCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsCockpitFixtures().contacts, 2);
});

