import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentAtlasSnapshot, createConsentAtlasDashboardRoutes, createConsentAtlasApiRoutes, createConsentAtlasOpsRoutes, createConsentAtlasPublicRoutes, createConsentAtlasRegistryRoutes, summarizeConsentAtlasFixtures } from '../packages/consent-atlas/index.mjs';

test('consent-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentAtlasDashboardRoutes().length, 3);
  assert.equal(createConsentAtlasApiRoutes().length, 4);
  assert.equal(createConsentAtlasOpsRoutes().length, 3);
  assert.equal(createConsentAtlasPublicRoutes().length, 3);
  assert.equal(createConsentAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentAtlasFixtures().contacts, 2);
});

