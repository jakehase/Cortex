import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationWatchtowerSnapshot, createActivationWatchtowerDashboardRoutes, createActivationWatchtowerApiRoutes, createActivationWatchtowerOpsRoutes, createActivationWatchtowerPublicRoutes, createActivationWatchtowerRegistryRoutes, summarizeActivationWatchtowerFixtures } from '../packages/activation-watchtower/index.mjs';

test('activation-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationWatchtowerDashboardRoutes().length, 3);
  assert.equal(createActivationWatchtowerApiRoutes().length, 4);
  assert.equal(createActivationWatchtowerOpsRoutes().length, 3);
  assert.equal(createActivationWatchtowerPublicRoutes().length, 3);
  assert.equal(createActivationWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationWatchtowerFixtures().contacts, 2);
});

