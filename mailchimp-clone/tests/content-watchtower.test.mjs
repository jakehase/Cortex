import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentWatchtowerSnapshot, createContentWatchtowerDashboardRoutes, createContentWatchtowerApiRoutes, createContentWatchtowerOpsRoutes, createContentWatchtowerPublicRoutes, createContentWatchtowerRegistryRoutes, summarizeContentWatchtowerFixtures } from '../packages/content-watchtower/index.mjs';

test('content-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentWatchtowerDashboardRoutes().length, 3);
  assert.equal(createContentWatchtowerApiRoutes().length, 4);
  assert.equal(createContentWatchtowerOpsRoutes().length, 3);
  assert.equal(createContentWatchtowerPublicRoutes().length, 3);
  assert.equal(createContentWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentWatchtowerFixtures().contacts, 2);
});

