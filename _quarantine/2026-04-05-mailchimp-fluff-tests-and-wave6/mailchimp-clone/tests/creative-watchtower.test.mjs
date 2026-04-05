import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeWatchtowerSnapshot, createCreativeWatchtowerDashboardRoutes, createCreativeWatchtowerApiRoutes, createCreativeWatchtowerOpsRoutes, createCreativeWatchtowerPublicRoutes, createCreativeWatchtowerRegistryRoutes, summarizeCreativeWatchtowerFixtures } from '../packages/creative-watchtower/index.mjs';

test('creative-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeWatchtowerDashboardRoutes().length, 3);
  assert.equal(createCreativeWatchtowerApiRoutes().length, 4);
  assert.equal(createCreativeWatchtowerOpsRoutes().length, 3);
  assert.equal(createCreativeWatchtowerPublicRoutes().length, 3);
  assert.equal(createCreativeWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeWatchtowerFixtures().contacts, 2);
});

