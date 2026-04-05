import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleNavigatorSnapshot, createLifecycleNavigatorDashboardRoutes, createLifecycleNavigatorApiRoutes, createLifecycleNavigatorOpsRoutes, createLifecycleNavigatorPublicRoutes, createLifecycleNavigatorRegistryRoutes, summarizeLifecycleNavigatorFixtures } from '../packages/lifecycle-navigator/index.mjs';

test('lifecycle-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleNavigatorDashboardRoutes().length, 3);
  assert.equal(createLifecycleNavigatorApiRoutes().length, 4);
  assert.equal(createLifecycleNavigatorOpsRoutes().length, 3);
  assert.equal(createLifecycleNavigatorPublicRoutes().length, 3);
  assert.equal(createLifecycleNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleNavigatorFixtures().contacts, 2);
});

