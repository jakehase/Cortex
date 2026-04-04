import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudienceAtlasSnapshot, createAudienceAtlasDashboardRoutes, createAudienceAtlasApiRoutes, createAudienceAtlasOpsRoutes, createAudienceAtlasPublicRoutes, createAudienceAtlasRegistryRoutes, summarizeAudienceAtlasFixtures } from '../packages/audience-atlas/index.mjs';

test('audience-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAudienceAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAudienceAtlasDashboardRoutes().length, 3);
  assert.equal(createAudienceAtlasApiRoutes().length, 4);
  assert.equal(createAudienceAtlasOpsRoutes().length, 3);
  assert.equal(createAudienceAtlasPublicRoutes().length, 3);
  assert.equal(createAudienceAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAudienceAtlasFixtures().contacts, 2);
});

