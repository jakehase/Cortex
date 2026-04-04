import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleWatchtowerSnapshot, createLifecycleWatchtowerDashboardRoutes, createLifecycleWatchtowerApiRoutes, createLifecycleWatchtowerOpsRoutes, createLifecycleWatchtowerPublicRoutes, createLifecycleWatchtowerRegistryRoutes, summarizeLifecycleWatchtowerFixtures } from '../packages/lifecycle-watchtower/index.mjs';

test('lifecycle-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleWatchtowerDashboardRoutes().length, 3);
  assert.equal(createLifecycleWatchtowerApiRoutes().length, 4);
  assert.equal(createLifecycleWatchtowerOpsRoutes().length, 3);
  assert.equal(createLifecycleWatchtowerPublicRoutes().length, 3);
  assert.equal(createLifecycleWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleWatchtowerFixtures().contacts, 2);
});

