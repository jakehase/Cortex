import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleHubSnapshot, createLifecycleHubDashboardRoutes, createLifecycleHubApiRoutes, createLifecycleHubOpsRoutes, createLifecycleHubPublicRoutes, createLifecycleHubRegistryRoutes, summarizeLifecycleHubFixtures } from '../packages/lifecycle-hub/index.mjs';

test('lifecycle-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleHubDashboardRoutes().length, 3);
  assert.equal(createLifecycleHubApiRoutes().length, 4);
  assert.equal(createLifecycleHubOpsRoutes().length, 3);
  assert.equal(createLifecycleHubPublicRoutes().length, 3);
  assert.equal(createLifecycleHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleHubFixtures().contacts, 2);
});

