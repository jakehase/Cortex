import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeGridSnapshot, createCreativeGridDashboardRoutes, createCreativeGridApiRoutes, createCreativeGridOpsRoutes, createCreativeGridPublicRoutes, createCreativeGridRegistryRoutes, summarizeCreativeGridFixtures } from '../packages/creative-grid/index.mjs';

test('creative-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeGridDashboardRoutes().length, 3);
  assert.equal(createCreativeGridApiRoutes().length, 4);
  assert.equal(createCreativeGridOpsRoutes().length, 3);
  assert.equal(createCreativeGridPublicRoutes().length, 3);
  assert.equal(createCreativeGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeGridFixtures().contacts, 2);
});

