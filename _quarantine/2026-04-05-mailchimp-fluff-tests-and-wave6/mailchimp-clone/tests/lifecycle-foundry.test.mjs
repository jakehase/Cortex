import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleFoundrySnapshot, createLifecycleFoundryDashboardRoutes, createLifecycleFoundryApiRoutes, createLifecycleFoundryOpsRoutes, createLifecycleFoundryPublicRoutes, createLifecycleFoundryRegistryRoutes, summarizeLifecycleFoundryFixtures } from '../packages/lifecycle-foundry/index.mjs';

test('lifecycle-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleFoundryDashboardRoutes().length, 3);
  assert.equal(createLifecycleFoundryApiRoutes().length, 4);
  assert.equal(createLifecycleFoundryOpsRoutes().length, 3);
  assert.equal(createLifecycleFoundryPublicRoutes().length, 3);
  assert.equal(createLifecycleFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleFoundryFixtures().contacts, 2);
});

