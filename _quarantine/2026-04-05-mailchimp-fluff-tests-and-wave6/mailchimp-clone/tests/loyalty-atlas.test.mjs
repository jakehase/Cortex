import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyAtlasSnapshot, createLoyaltyAtlasDashboardRoutes, createLoyaltyAtlasApiRoutes, createLoyaltyAtlasOpsRoutes, createLoyaltyAtlasPublicRoutes, createLoyaltyAtlasRegistryRoutes, summarizeLoyaltyAtlasFixtures } from '../packages/loyalty-atlas/index.mjs';

test('loyalty-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyAtlasDashboardRoutes().length, 3);
  assert.equal(createLoyaltyAtlasApiRoutes().length, 4);
  assert.equal(createLoyaltyAtlasOpsRoutes().length, 3);
  assert.equal(createLoyaltyAtlasPublicRoutes().length, 3);
  assert.equal(createLoyaltyAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyAtlasFixtures().contacts, 2);
});

