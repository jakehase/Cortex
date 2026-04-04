import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceAtlasSnapshot, createEcommerceAtlasDashboardRoutes, createEcommerceAtlasApiRoutes, createEcommerceAtlasOpsRoutes, createEcommerceAtlasPublicRoutes, createEcommerceAtlasRegistryRoutes, summarizeEcommerceAtlasFixtures } from '../packages/ecommerce-atlas/index.mjs';

test('ecommerce-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceAtlasDashboardRoutes().length, 3);
  assert.equal(createEcommerceAtlasApiRoutes().length, 4);
  assert.equal(createEcommerceAtlasOpsRoutes().length, 3);
  assert.equal(createEcommerceAtlasPublicRoutes().length, 3);
  assert.equal(createEcommerceAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceAtlasFixtures().contacts, 2);
});

