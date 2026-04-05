import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeNavigatorSnapshot, createCreativeNavigatorDashboardRoutes, createCreativeNavigatorApiRoutes, createCreativeNavigatorOpsRoutes, createCreativeNavigatorPublicRoutes, createCreativeNavigatorRegistryRoutes, summarizeCreativeNavigatorFixtures } from '../packages/creative-navigator/index.mjs';

test('creative-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeNavigatorDashboardRoutes().length, 3);
  assert.equal(createCreativeNavigatorApiRoutes().length, 4);
  assert.equal(createCreativeNavigatorOpsRoutes().length, 3);
  assert.equal(createCreativeNavigatorPublicRoutes().length, 3);
  assert.equal(createCreativeNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeNavigatorFixtures().contacts, 2);
});

