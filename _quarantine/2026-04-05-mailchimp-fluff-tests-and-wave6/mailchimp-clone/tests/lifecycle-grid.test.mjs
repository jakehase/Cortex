import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleGridSnapshot, createLifecycleGridDashboardRoutes, createLifecycleGridApiRoutes, createLifecycleGridOpsRoutes, createLifecycleGridPublicRoutes, createLifecycleGridRegistryRoutes, summarizeLifecycleGridFixtures } from '../packages/lifecycle-grid/index.mjs';

test('lifecycle-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleGridDashboardRoutes().length, 3);
  assert.equal(createLifecycleGridApiRoutes().length, 4);
  assert.equal(createLifecycleGridOpsRoutes().length, 3);
  assert.equal(createLifecycleGridPublicRoutes().length, 3);
  assert.equal(createLifecycleGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleGridFixtures().contacts, 2);
});

