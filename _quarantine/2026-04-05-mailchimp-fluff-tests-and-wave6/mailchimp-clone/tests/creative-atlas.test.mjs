import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeAtlasSnapshot, createCreativeAtlasDashboardRoutes, createCreativeAtlasApiRoutes, createCreativeAtlasOpsRoutes, createCreativeAtlasPublicRoutes, createCreativeAtlasRegistryRoutes, summarizeCreativeAtlasFixtures } from '../packages/creative-atlas/index.mjs';

test('creative-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeAtlasDashboardRoutes().length, 3);
  assert.equal(createCreativeAtlasApiRoutes().length, 4);
  assert.equal(createCreativeAtlasOpsRoutes().length, 3);
  assert.equal(createCreativeAtlasPublicRoutes().length, 3);
  assert.equal(createCreativeAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeAtlasFixtures().contacts, 2);
});

