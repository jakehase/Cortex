import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionAtlasSnapshot, createAcquisitionAtlasDashboardRoutes, createAcquisitionAtlasApiRoutes, createAcquisitionAtlasOpsRoutes, createAcquisitionAtlasPublicRoutes, createAcquisitionAtlasRegistryRoutes, summarizeAcquisitionAtlasFixtures } from '../packages/acquisition-atlas/index.mjs';

test('acquisition-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionAtlasDashboardRoutes().length, 3);
  assert.equal(createAcquisitionAtlasApiRoutes().length, 4);
  assert.equal(createAcquisitionAtlasOpsRoutes().length, 3);
  assert.equal(createAcquisitionAtlasPublicRoutes().length, 3);
  assert.equal(createAcquisitionAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionAtlasFixtures().contacts, 2);
});

