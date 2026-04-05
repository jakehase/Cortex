import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataWatchtowerSnapshot, createDataWatchtowerDashboardRoutes, createDataWatchtowerApiRoutes, createDataWatchtowerOpsRoutes, createDataWatchtowerPublicRoutes, createDataWatchtowerRegistryRoutes, summarizeDataWatchtowerFixtures } from '../packages/data-watchtower/index.mjs';

test('data-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataWatchtowerDashboardRoutes().length, 3);
  assert.equal(createDataWatchtowerApiRoutes().length, 4);
  assert.equal(createDataWatchtowerOpsRoutes().length, 3);
  assert.equal(createDataWatchtowerPublicRoutes().length, 3);
  assert.equal(createDataWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataWatchtowerFixtures().contacts, 2);
});

