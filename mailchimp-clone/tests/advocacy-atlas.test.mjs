import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyAtlasSnapshot, createAdvocacyAtlasDashboardRoutes, createAdvocacyAtlasApiRoutes, createAdvocacyAtlasOpsRoutes, createAdvocacyAtlasPublicRoutes, createAdvocacyAtlasRegistryRoutes, summarizeAdvocacyAtlasFixtures } from '../packages/advocacy-atlas/index.mjs';

test('advocacy-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyAtlasDashboardRoutes().length, 3);
  assert.equal(createAdvocacyAtlasApiRoutes().length, 4);
  assert.equal(createAdvocacyAtlasOpsRoutes().length, 3);
  assert.equal(createAdvocacyAtlasPublicRoutes().length, 3);
  assert.equal(createAdvocacyAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyAtlasFixtures().contacts, 2);
});

