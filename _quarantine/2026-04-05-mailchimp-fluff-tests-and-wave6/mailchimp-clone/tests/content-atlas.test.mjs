import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentAtlasSnapshot, createContentAtlasDashboardRoutes, createContentAtlasApiRoutes, createContentAtlasOpsRoutes, createContentAtlasPublicRoutes, createContentAtlasRegistryRoutes, summarizeContentAtlasFixtures } from '../packages/content-atlas/index.mjs';

test('content-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentAtlasDashboardRoutes().length, 3);
  assert.equal(createContentAtlasApiRoutes().length, 4);
  assert.equal(createContentAtlasOpsRoutes().length, 3);
  assert.equal(createContentAtlasPublicRoutes().length, 3);
  assert.equal(createContentAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentAtlasFixtures().contacts, 2);
});

