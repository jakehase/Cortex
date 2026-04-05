import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalizationAtlasSnapshot, createLocalizationAtlasDashboardRoutes, createLocalizationAtlasApiRoutes, createLocalizationAtlasOpsRoutes, createLocalizationAtlasPublicRoutes, createLocalizationAtlasRegistryRoutes, summarizeLocalizationAtlasFixtures } from '../packages/localization-atlas/index.mjs';

test('localization-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLocalizationAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLocalizationAtlasDashboardRoutes().length, 3);
  assert.equal(createLocalizationAtlasApiRoutes().length, 4);
  assert.equal(createLocalizationAtlasOpsRoutes().length, 3);
  assert.equal(createLocalizationAtlasPublicRoutes().length, 3);
  assert.equal(createLocalizationAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLocalizationAtlasFixtures().contacts, 2);
});

