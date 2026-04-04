import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataAtlasSnapshot, createDataAtlasDashboardRoutes, createDataAtlasApiRoutes, createDataAtlasOpsRoutes, createDataAtlasPublicRoutes, createDataAtlasRegistryRoutes, summarizeDataAtlasFixtures } from '../packages/data-atlas/index.mjs';

test('data-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataAtlasDashboardRoutes().length, 3);
  assert.equal(createDataAtlasApiRoutes().length, 4);
  assert.equal(createDataAtlasOpsRoutes().length, 3);
  assert.equal(createDataAtlasPublicRoutes().length, 3);
  assert.equal(createDataAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataAtlasFixtures().contacts, 2);
});

