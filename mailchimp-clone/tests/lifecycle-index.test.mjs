import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleIndexSnapshot, createLifecycleIndexDashboardRoutes, createLifecycleIndexApiRoutes, createLifecycleIndexOpsRoutes, createLifecycleIndexPublicRoutes, createLifecycleIndexRegistryRoutes, summarizeLifecycleIndexFixtures } from '../packages/lifecycle-index/index.mjs';

test('lifecycle-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleIndexDashboardRoutes().length, 3);
  assert.equal(createLifecycleIndexApiRoutes().length, 4);
  assert.equal(createLifecycleIndexOpsRoutes().length, 3);
  assert.equal(createLifecycleIndexPublicRoutes().length, 3);
  assert.equal(createLifecycleIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleIndexFixtures().contacts, 2);
});

