import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsAtlasSnapshot, createInsightsAtlasDashboardRoutes, createInsightsAtlasApiRoutes, createInsightsAtlasOpsRoutes, createInsightsAtlasPublicRoutes, createInsightsAtlasRegistryRoutes, summarizeInsightsAtlasFixtures } from '../packages/insights-atlas/index.mjs';

test('insights-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsAtlasDashboardRoutes().length, 3);
  assert.equal(createInsightsAtlasApiRoutes().length, 4);
  assert.equal(createInsightsAtlasOpsRoutes().length, 3);
  assert.equal(createInsightsAtlasPublicRoutes().length, 3);
  assert.equal(createInsightsAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsAtlasFixtures().contacts, 2);
});

