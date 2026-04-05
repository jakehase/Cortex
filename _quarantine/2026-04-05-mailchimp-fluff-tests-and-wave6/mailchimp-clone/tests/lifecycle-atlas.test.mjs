import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleAtlasSnapshot, createLifecycleAtlasDashboardRoutes, createLifecycleAtlasApiRoutes, createLifecycleAtlasOpsRoutes, createLifecycleAtlasPublicRoutes, createLifecycleAtlasRegistryRoutes, summarizeLifecycleAtlasFixtures } from '../packages/lifecycle-atlas/index.mjs';

test('lifecycle-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleAtlasDashboardRoutes().length, 3);
  assert.equal(createLifecycleAtlasApiRoutes().length, 4);
  assert.equal(createLifecycleAtlasOpsRoutes().length, 3);
  assert.equal(createLifecycleAtlasPublicRoutes().length, 3);
  assert.equal(createLifecycleAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleAtlasFixtures().contacts, 2);
});

