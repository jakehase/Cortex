import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionModelingSnapshot, createAttributionModelingDashboardRoutes, createAttributionModelingApiRoutes, createAttributionModelingOpsRoutes, createAttributionModelingPublicRoutes, summarizeAttributionModelingFixtures } from '../packages/attribution-modeling/index.mjs';

test('attribution-modeling package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildAttributionModelingSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionModelingDashboardRoutes().length, 3);
  assert.equal(createAttributionModelingApiRoutes().length, 3);
  assert.equal(createAttributionModelingOpsRoutes().length, 3);
  assert.equal(createAttributionModelingPublicRoutes().length, 3);
  assert.equal(summarizeAttributionModelingFixtures().contacts, 2);
});

