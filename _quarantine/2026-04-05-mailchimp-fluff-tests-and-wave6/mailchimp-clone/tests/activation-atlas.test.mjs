import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationAtlasSnapshot, createActivationAtlasDashboardRoutes, createActivationAtlasApiRoutes, createActivationAtlasOpsRoutes, createActivationAtlasPublicRoutes, createActivationAtlasRegistryRoutes, summarizeActivationAtlasFixtures } from '../packages/activation-atlas/index.mjs';

test('activation-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationAtlasDashboardRoutes().length, 3);
  assert.equal(createActivationAtlasApiRoutes().length, 4);
  assert.equal(createActivationAtlasOpsRoutes().length, 3);
  assert.equal(createActivationAtlasPublicRoutes().length, 3);
  assert.equal(createActivationAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationAtlasFixtures().contacts, 2);
});

