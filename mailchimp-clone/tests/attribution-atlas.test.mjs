import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionAtlasSnapshot, createAttributionAtlasDashboardRoutes, createAttributionAtlasApiRoutes, createAttributionAtlasOpsRoutes, createAttributionAtlasPublicRoutes, createAttributionAtlasRegistryRoutes, summarizeAttributionAtlasFixtures } from '../packages/attribution-atlas/index.mjs';

test('attribution-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionAtlasDashboardRoutes().length, 3);
  assert.equal(createAttributionAtlasApiRoutes().length, 4);
  assert.equal(createAttributionAtlasOpsRoutes().length, 3);
  assert.equal(createAttributionAtlasPublicRoutes().length, 3);
  assert.equal(createAttributionAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionAtlasFixtures().contacts, 2);
});

