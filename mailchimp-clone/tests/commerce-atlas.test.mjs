import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceAtlasSnapshot, createCommerceAtlasDashboardRoutes, createCommerceAtlasApiRoutes, createCommerceAtlasOpsRoutes, createCommerceAtlasPublicRoutes, createCommerceAtlasRegistryRoutes, summarizeCommerceAtlasFixtures } from '../packages/commerce-atlas/index.mjs';

test('commerce-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceAtlasDashboardRoutes().length, 3);
  assert.equal(createCommerceAtlasApiRoutes().length, 4);
  assert.equal(createCommerceAtlasOpsRoutes().length, 3);
  assert.equal(createCommerceAtlasPublicRoutes().length, 3);
  assert.equal(createCommerceAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceAtlasFixtures().contacts, 2);
});

