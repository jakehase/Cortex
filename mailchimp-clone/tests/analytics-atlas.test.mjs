import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsAtlasSnapshot, createAnalyticsAtlasDashboardRoutes, createAnalyticsAtlasApiRoutes, createAnalyticsAtlasOpsRoutes, createAnalyticsAtlasPublicRoutes, createAnalyticsAtlasRegistryRoutes, summarizeAnalyticsAtlasFixtures } from '../packages/analytics-atlas/index.mjs';

test('analytics-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsAtlasDashboardRoutes().length, 3);
  assert.equal(createAnalyticsAtlasApiRoutes().length, 4);
  assert.equal(createAnalyticsAtlasOpsRoutes().length, 3);
  assert.equal(createAnalyticsAtlasPublicRoutes().length, 3);
  assert.equal(createAnalyticsAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsAtlasFixtures().contacts, 2);
});

